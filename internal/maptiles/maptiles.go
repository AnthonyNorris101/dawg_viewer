package maptiles

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	Path         = "/maptiles/"
	maxTileBytes = 4 << 20
	retryAfter   = 60 * time.Second
	worldHalf    = 20037508.342789244
)

type Source struct {
	ID          string `yaml:"id" json:"id"`
	Name        string `yaml:"name" json:"name"`
	URL         string `yaml:"url" json:"-"`
	MaxZoom     int    `yaml:"max_zoom" json:"maxZoom"`
	Attribution string `yaml:"attribution" json:"attribution"`
}

func Defaults() []Source {
	return []Source{
		{
			ID:          "satellite",
			Name:        "Satellite (USA)",
			URL:         "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage?bbox={bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image",
			MaxZoom:     19,
			Attribution: "USGS The National Map: Orthoimagery",
		},
		{
			ID:          "streets",
			Name:        "Street map",
			URL:         "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
			MaxZoom:     19,
			Attribution: "© OpenStreetMap contributors",
		},
	}
}

var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,31}$`)

func (s Source) Validate() error {
	if !idPattern.MatchString(s.ID) {
		return fmt.Errorf("map source id %q must be 1-32 lowercase letters, digits, - or _", s.ID)
	}
	if !strings.HasPrefix(s.URL, "https://") && !strings.HasPrefix(s.URL, "http://") {
		return fmt.Errorf("map source %s: url must start with http:// or https://", s.ID)
	}
	if !strings.Contains(s.URL, "{bbox}") &&
		!(strings.Contains(s.URL, "{z}") && strings.Contains(s.URL, "{x}") && strings.Contains(s.URL, "{y}")) {
		return fmt.Errorf("map source %s: url needs {z}, {x} and {y}, or {bbox}", s.ID)
	}
	if s.MaxZoom < 0 || s.MaxZoom > 22 {
		return fmt.Errorf("map source %s: max_zoom must be 0-22", s.ID)
	}
	return nil
}

func Merge(custom []Source) ([]Source, error) {
	out := Defaults()
	var errs []error
	for _, c := range custom {
		if c.MaxZoom == 0 {
			c.MaxZoom = 19
		}
		if c.Name == "" {
			c.Name = c.ID
		}
		if err := c.Validate(); err != nil {
			errs = append(errs, err)
			continue
		}
		replaced := false
		for i := range out {
			if out[i].ID == c.ID {
				out[i] = c
				replaced = true
			}
		}
		if !replaced {
			out = append(out, c)
		}
	}
	return out, errors.Join(errs...)
}

func (s Source) TileURL(z, x, y int) string {
	size := 2 * worldHalf / float64(int(1)<<z)
	xmin := -worldHalf + float64(x)*size
	ymax := worldHalf - float64(y)*size
	f := func(v float64) string { return strconv.FormatFloat(v, 'f', 3, 64) }
	bbox := f(xmin) + "," + f(ymax-size) + "," + f(xmin+size) + "," + f(ymax)
	return strings.NewReplacer(
		"{z}", strconv.Itoa(z), "{x}", strconv.Itoa(x), "{y}", strconv.Itoa(y), "{bbox}", bbox,
	).Replace(s.URL)
}

type Server struct {
	Dir       func() string
	Sources   func() []Source
	UserAgent string
	Client    *http.Client

	mu      sync.Mutex
	failed  map[string]time.Time
	pending map[string]*fetch
	slots   chan struct{}
	once    sync.Once
}

type fetch struct {
	done chan struct{}
	data []byte
	err  error
}

func (s *Server) init() {
	s.once.Do(func() {
		s.failed = map[string]time.Time{}
		s.pending = map[string]*fetch{}
		s.slots = make(chan struct{}, 4)
		if s.Client == nil {
			s.Client = &http.Client{Timeout: 20 * time.Second}
		}
	})
}

func (s *Server) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rest, ok := strings.CutPrefix(r.URL.Path, Path)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		s.init()
		src, z, x, y, err := s.parse(rest)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}
		data, cached, err := s.tile(r.Context(), src, z, x, y)
		if err != nil {
			if r.Context().Err() == nil {
				slog.WarnContext(r.Context(), "map tile unavailable", "source", src.ID, "error", err)
			}
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		w.Header().Set("Content-Type", http.DetectContentType(data))
		w.Header().Set("Cache-Control", "max-age=86400")
		if cached {
			w.Header().Set("X-Tile-Cache", "hit")
		} else {
			w.Header().Set("X-Tile-Cache", "miss")
		}
		_, _ = w.Write(data)
	})
}

func (s *Server) parse(rest string) (Source, int, int, int, error) {
	parts := strings.Split(rest, "/")
	if len(parts) != 4 {
		return Source{}, 0, 0, 0, errors.New("expected source/z/x/y")
	}
	var src *Source
	for _, c := range s.Sources() {
		if c.ID == parts[0] {
			src = &c
			break
		}
	}
	if src == nil {
		return Source{}, 0, 0, 0, fmt.Errorf("unknown map source %q", parts[0])
	}
	var n [3]int
	for i, p := range parts[1:] {
		v, err := strconv.Atoi(p)
		if err != nil || v < 0 || strconv.Itoa(v) != p {
			return Source{}, 0, 0, 0, errors.New("tile coordinates must be whole numbers")
		}
		n[i] = v
	}
	if n[0] > src.MaxZoom || n[1] >= 1<<n[0] || n[2] >= 1<<n[0] {
		return Source{}, 0, 0, 0, errors.New("tile is outside the map")
	}
	return *src, n[0], n[1], n[2], nil
}

func (s *Server) tile(ctx context.Context, src Source, z, x, y int) ([]byte, bool, error) {
	dir := s.Dir()
	if dir == "" {
		return nil, false, errors.New("the config folder is not ready")
	}
	file := filepath.Join(dir, src.ID, strconv.Itoa(z), strconv.Itoa(x), strconv.Itoa(y)+".tile")
	if data, err := os.ReadFile(file); err == nil && len(data) > 0 {
		return data, true, nil
	}
	key := src.ID + "/" + src.URL + "/" + file
	s.mu.Lock()
	if at, bad := s.failed[key]; bad && time.Since(at) < retryAfter {
		s.mu.Unlock()
		return nil, false, errors.New("not downloaded: the last try failed a moment ago (offline?)")
	}
	f, running := s.pending[key]
	if !running {
		f = &fetch{done: make(chan struct{})}
		s.pending[key] = f
		go s.download(f, key, src.TileURL(z, x, y), file)
	}
	s.mu.Unlock()
	select {
	case <-f.done:
		return f.data, false, f.err
	case <-ctx.Done():
		return nil, false, ctx.Err()
	}
}

func (s *Server) download(f *fetch, key, url, file string) {
	s.slots <- struct{}{}
	f.data, f.err = s.get(url)
	<-s.slots
	if f.err == nil {
		f.err = writeFile(file, f.data)
	}
	s.mu.Lock()
	delete(s.pending, key)
	if f.err != nil {
		s.failed[key] = time.Now()
	} else {
		delete(s.failed, key)
	}
	s.mu.Unlock()
	close(f.done)
}

func (s *Server) get(url string) ([]byte, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if s.UserAgent != "" {
		req.Header.Set("User-Agent", s.UserAgent)
	}
	resp, err := s.Client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("the map server answered %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxTileBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > maxTileBytes {
		return nil, errors.New("the map server sent an empty or oversized tile")
	}
	if kind := http.DetectContentType(data); !strings.HasPrefix(kind, "image/") {
		return nil, fmt.Errorf("the map server sent %s, not an image", kind)
	}
	return data, nil
}

func writeFile(file string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(file), ".tile-*")
	if err != nil {
		return err
	}
	_, werr := tmp.Write(data)
	cerr := tmp.Close()
	if err := errors.Join(werr, cerr); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	if err := os.Rename(tmp.Name(), file); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	return nil
}
