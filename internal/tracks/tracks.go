package tracks

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	maxBytes     = 8 << 20
	minGap       = 1100 * time.Millisecond
	coolDown     = 30 * time.Second
	cacheFor     = 30 * 24 * time.Hour
	nearRadiusM  = 3000
	padDeg       = 0.003
	maxBoxDeg    = 0.15
	maxPlaces    = 4
	maxQueryLen  = 120
	overpassWait = 12
	requestWait  = 15 * time.Second
)

var ErrNoGeocoder = errors.New("searching by name is turned off: no geocoder is set under track_search in settings.yaml")

type Track struct {
	Name   string    `json:"name"`
	Place  string    `json:"place"`
	Lat    []float64 `json:"lat"`
	Lon    []float64 `json:"lon"`
	Closed bool      `json:"closed"`
	Length float64   `json:"length"`
}

type Config struct {
	Geocoder string   `yaml:"geocoder" json:"geocoder"`
	Overpass []string `yaml:"overpass" json:"overpass"`
}

func DefaultOverpass() []string {
	return []string{
		"https://overpass-api.de/api/interpreter",
		"https://overpass.private.coffee/api/interpreter",
	}
}

func (c Config) Servers() []string {
	if c.Overpass == nil {
		return DefaultOverpass()
	}
	return c.Overpass
}

func (c Config) Validate() error {
	for _, u := range append([]string{c.Geocoder}, c.Overpass...) {
		if u == "" {
			continue
		}
		p, err := url.Parse(u)
		if err != nil || (p.Scheme != "https" && p.Scheme != "http") || p.Host == "" {
			return fmt.Errorf("track_search: %q must be an http:// or https:// address", u)
		}
	}
	return nil
}

type Finder struct {
	UserAgent string
	Client    *http.Client
	Config    func() Config
	Dir       func() string
	Gap       time.Duration

	mu      sync.Mutex
	last    time.Time
	refused map[string]time.Time
}

func (f *Finder) client() *http.Client {
	if f.Client != nil {
		return f.Client
	}
	return &http.Client{Timeout: requestWait}
}

func (f *Finder) Search(ctx context.Context, query string) ([]Track, error) {
	query = strings.Join(strings.Fields(query), " ")
	if query == "" {
		return nil, errors.New("type the name of a track or a place")
	}
	if len(query) > maxQueryLen {
		return nil, errors.New("that name is too long")
	}
	cfg := f.Config()
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if cfg.Geocoder == "" {
		return nil, ErrNoGeocoder
	}
	u := cfg.Geocoder + "?" + url.Values{"q": {query}, "format": {"jsonv2"}, "limit": {"8"}}.Encode()
	body, err := f.fetch(ctx, http.MethodGet, u, "")
	if err != nil {
		return nil, fmt.Errorf("place search: %w", err)
	}
	var places []struct {
		Lat     string   `json:"lat"`
		Lon     string   `json:"lon"`
		Box     []string `json:"boundingbox"`
		Display string   `json:"display_name"`
	}
	if err := json.Unmarshal(body, &places); err != nil {
		return nil, errors.New("place search: the answer was not understood")
	}
	if len(places) == 0 {
		return nil, fmt.Errorf("no place called %q was found", query)
	}
	if len(places) > maxPlaces {
		places = places[:maxPlaces]
	}
	for _, p := range places {
		lat, e1 := strconv.ParseFloat(p.Lat, 64)
		lon, e2 := strconv.ParseFloat(p.Lon, 64)
		if e1 != nil || e2 != nil {
			continue
		}
		area := around(lat, lon)
		if box, ok := parseBox(p.Box); ok {
			area = box
		}
		found, err := f.raceways(ctx, cfg, area)
		if err != nil {
			return nil, err
		}
		if len(found) > 0 {
			for i := range found {
				found[i].Place = shortPlace(p.Display)
				if found[i].Name == "" {
					found[i].Name = firstPart(p.Display)
				}
			}
			return found, nil
		}
	}
	return []Track{}, nil
}

func (f *Finder) Near(ctx context.Context, lat, lon float64) ([]Track, error) {
	if !(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
		return nil, errors.New("that is not a position on Earth")
	}
	cfg := f.Config()
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	found, err := f.raceways(ctx, cfg, around(lat, lon))
	if err != nil {
		return nil, err
	}
	for i := range found {
		if found[i].Name == "" {
			found[i].Name = "Unnamed track"
		}
	}
	return found, nil
}

func around(lat, lon float64) string {
	return fmt.Sprintf("(around:%d,%.6f,%.6f)", nearRadiusM, lat, lon)
}

func parseBox(box []string) (string, bool) {
	if len(box) != 4 {
		return "", false
	}
	var v [4]float64
	for i, s := range box {
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return "", false
		}
		v[i] = f
	}
	south, north, west, east := v[0], v[1], v[2], v[3]
	if north-south > maxBoxDeg || east-west > maxBoxDeg || north < south || east < west {
		return "", false
	}
	return fmt.Sprintf("(%.6f,%.6f,%.6f,%.6f)", south-padDeg, west-padDeg, north+padDeg, east+padDeg), true
}

func firstPart(display string) string {
	return strings.TrimSpace(strings.SplitN(display, ",", 2)[0])
}

func shortPlace(display string) string {
	parts := strings.Split(display, ",")
	if len(parts) > 3 {
		parts = append(parts[:2], parts[len(parts)-1])
	}
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return strings.Join(parts, ", ")
}

type element struct {
	Type     string            `json:"type"`
	ID       int64             `json:"id"`
	Tags     map[string]string `json:"tags"`
	Geometry []struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	} `json:"geometry"`
}

func (f *Finder) raceways(ctx context.Context, cfg Config, area string) ([]Track, error) {
	servers := cfg.Servers()
	if len(servers) == 0 {
		return nil, errors.New("online track lookups are turned off (track_search: overpass is empty in settings.yaml)")
	}
	query := fmt.Sprintf(`[out:json][timeout:%d];way["highway"="raceway"]%s;out tags geom;`, overpassWait, area)
	var failures []string
	for _, server := range servers {
		body, err := f.fetch(ctx, http.MethodPost, server, url.Values{"data": {query}}.Encode())
		if err != nil {
			failures = append(failures, err.Error())
			if ctx.Err() != nil {
				break
			}
			continue
		}
		var answer struct {
			Elements []element `json:"elements"`
		}
		if err := json.Unmarshal(body, &answer); err != nil {
			failures = append(failures, "the map server's answer was not understood")
			continue
		}
		return Stitch(waysOf(answer.Elements)), nil
	}
	return nil, fmt.Errorf("could not reach a map server: %s", strings.Join(failures, "; "))
}

func waysOf(elements []element) []Way {
	var ways []Way
	for _, e := range elements {
		if e.Type != "way" || len(e.Geometry) < 2 {
			continue
		}
		w := Way{Name: e.Tags["name"], Pit: isPit(e.Tags)}
		for _, p := range e.Geometry {
			w.Lat = append(w.Lat, p.Lat)
			w.Lon = append(w.Lon, p.Lon)
		}
		ways = append(ways, w)
	}
	return ways
}

func isPit(tags map[string]string) bool {
	if tags["service"] == "pit_lane" || tags["raceway"] == "pit_lane" || tags["pit_lane"] == "yes" {
		return true
	}
	name := strings.ToLower(tags["name"])
	return strings.Contains(name, "pit lane") || strings.Contains(name, "pitlane") || strings.Contains(name, "pit road")
}

func (f *Finder) fetch(ctx context.Context, method, address, form string) ([]byte, error) {
	file := ""
	if dir := f.Dir(); dir != "" {
		sum := sha256.Sum256([]byte(method + "\n" + address + "\n" + form))
		file = filepath.Join(dir, hex.EncodeToString(sum[:16])+".json")
		if info, err := os.Stat(file); err == nil && time.Since(info.ModTime()) < cacheFor {
			if data, err := os.ReadFile(file); err == nil && len(data) > 0 {
				return data, nil
			}
		}
	}
	if err := f.pace(ctx); err != nil {
		return nil, err
	}
	var payload io.Reader
	if form != "" {
		payload = strings.NewReader(form)
	}
	req, err := http.NewRequestWithContext(ctx, method, address, payload)
	if err != nil {
		return nil, err
	}
	if form != "" {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	req.Header.Set("Accept", "application/json")
	if f.UserAgent != "" {
		req.Header.Set("User-Agent", f.UserAgent)
	}
	host := req.URL.Host
	f.mu.Lock()
	at, cooling := f.refused[host]
	f.mu.Unlock()
	if cooling && time.Since(at) < coolDown {
		return nil, fmt.Errorf("%s refused a request a moment ago; wait %d s before searching again", host, int(coolDown.Seconds()))
	}
	resp, err := f.client().Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("%s did not answer in time", host)
		}
		return nil, fmt.Errorf("%s could not be reached (offline?)", host)
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusNotAcceptable:
		f.mu.Lock()
		if f.refused == nil {
			f.refused = map[string]time.Time{}
		}
		f.refused[host] = time.Now()
		f.mu.Unlock()
		return nil, fmt.Errorf("%s refused the request (%s); wait a while before searching again", host, resp.Status)
	case resp.StatusCode != http.StatusOK:
		return nil, fmt.Errorf("%s answered %s", host, resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("%s: the answer was cut short", host)
	}
	if len(data) > maxBytes {
		return nil, fmt.Errorf("%s sent more than %d MB", host, maxBytes>>20)
	}
	if file != "" && json.Valid(data) {
		if err := os.MkdirAll(filepath.Dir(file), 0o755); err == nil {
			_ = os.WriteFile(file, data, 0o644)
		}
	}
	return data, nil
}

func (f *Finder) pace(ctx context.Context) error {
	gap := f.Gap
	if gap <= 0 {
		gap = minGap
	}
	f.mu.Lock()
	wait := gap - time.Since(f.last)
	if wait < 0 {
		wait = 0
	}
	f.last = time.Now().Add(wait)
	f.mu.Unlock()
	if wait == 0 {
		return nil
	}
	select {
	case <-time.After(wait):
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
