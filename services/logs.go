package services

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"dawg_viewer/internal/config"
	"dawg_viewer/internal/fileserver"
	"dawg_viewer/internal/logfile"
)

const EventLogProgress = "logs:progress"

func init() {
	application.RegisterEvent[LogProgress](EventLogProgress)
}

type RemoteLog struct {
	Name       string `json:"name"`
	Number     int    `json:"number"`
	Date       string `json:"date"`
	Downloaded bool   `json:"downloaded"`
}

type LocalLog struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Kind     string `json:"kind"`
	Size     int64  `json:"size"`
	Modified int64  `json:"modified"`
}

type LogProgress struct {
	File    string `json:"file"`
	Index   int    `json:"index"`
	Count   int    `json:"count"`
	Stage   string `json:"stage"`
	Done    int64  `json:"done"`
	Total   int64  `json:"total"`
	Message string `json:"message"`
}

type ViewerChannel struct {
	Name string `json:"name"`
	Unit string `json:"unit"`
}

type ViewerLog struct {
	Name     string          `json:"name"`
	Path     string          `json:"path"`
	Rows     int             `json:"rows"`
	Note     string          `json:"note"`
	DataURL  string          `json:"dataUrl"`
	Channels []ViewerChannel `json:"channels"`
}

func (t deviceTarget) options() logfile.Options {
	convs, _ := t.profile.Converters()
	cal := map[string]func(float64) float64{}
	for name, c := range convs {
		cal[name] = c
	}
	var combine []logfile.Combine
	for _, c := range t.profile.Combine {
		combine = append(combine, logfile.Combine{Name: c.Name, Hi: c.Hi, Lo: c.Lo})
	}
	return logfile.Options{Hz: t.csvHz, Rename: t.profile.RenameByID(), Calibrate: cal, Combine: combine}
}

type LogService struct {
	live *LiveService

	mu       sync.Mutex
	serverOn *deviceTarget
	blobs    map[string][]byte
}

const logDataPath = "/logdata/"

func LogDataMiddleware(s *LogService) application.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s.serveBlob(w, r, next)
		})
	}
}

func (s *LogService) serveBlob(w http.ResponseWriter, r *http.Request, next http.Handler) {
	token, ok := strings.CutPrefix(r.URL.Path, logDataPath)
	if !ok {
		next.ServeHTTP(w, r)
		return
	}
	s.mu.Lock()
	blob, found := s.blobs[token]
	delete(s.blobs, token)
	s.mu.Unlock()
	if !found {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(blob)))
	w.Write(blob)
}

func (s *LogService) keepBlob(blob []byte) string {
	var b [16]byte
	rand.Read(b[:])
	token := hex.EncodeToString(b[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.blobs == nil || len(s.blobs) >= 2 {
		s.blobs = map[string][]byte{}
	}
	s.blobs[token] = blob
	return token
}

func NewLogService(live *LiveService) *LogService {
	return &LogService{live: live}
}

func (s *LogService) ServiceShutdown() error {
	return s.FinishRemote()
}

func (s *LogService) fileServerTarget() (deviceTarget, *config.FileServer, error) {
	t, err := s.live.target()
	if err != nil {
		return t, nil, err
	}
	fs := t.profile.FileServer
	if fs == nil {
		return t, nil, fmt.Errorf("%s has no fileserver section, so its logs can't be downloaded; see docs/configuration.md", filepath.Base(t.profile.File))
	}
	if !t.addr.IsValid() {
		return t, nil, errors.New("the device's address isn't known yet; connect to it in the Live tab first")
	}
	return t, fs, nil
}

func (s *LogService) RemoteLogs() ([]RemoteLog, error) {
	t, fs, err := s.fileServerTarget()
	if err != nil {
		return nil, err
	}

	s.mu.Lock()
	needEnable := s.serverOn == nil || s.serverOn.addr != t.addr
	s.mu.Unlock()
	if needEnable {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := t.sendCommand(ctx, fs.Enable)
		cancel()
		if err != nil {
			return nil, fmt.Errorf("turning on the file server: %w", err)
		}
		s.mu.Lock()
		s.serverOn = &t
		s.mu.Unlock()
	}

	client := fileserver.New(t.addr, fs.Port)
	var names []string
	for attempt := 0; ; attempt++ {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		names, err = client.List(ctx, fs.LogsDir)
		cancel()
		if err == nil || attempt == 12 {
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	if err != nil {
		return nil, fmt.Errorf("listing logs on %s: %w", t.addr, err)
	}

	logs := []RemoteLog{}
	for _, n := range names {
		if ext := strings.ToLower(filepath.Ext(n)); ext != ".bin" && ext != ".csv" {
			continue
		}
		_, statErr := os.Stat(filepath.Join(t.logsDir, n))
		logs = append(logs, RemoteLog{Name: n, Number: logNumber(n), Date: logDate(n), Downloaded: statErr == nil})
	}
	sort.Slice(logs, func(i, j int) bool { return logs[i].Number > logs[j].Number })
	return logs, nil
}

func (s *LogService) Download(names []string) ([]LocalLog, error) {
	t, fs, err := s.fileServerTarget()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(t.logsDir, 0o755); err != nil {
		return nil, err
	}
	client := fileserver.New(t.addr, fs.Port)

	var out []LocalLog
	var failed []string
	for i, name := range names {
		p := LogProgress{File: name, Index: i + 1, Count: len(names)}
		report := func(stage, msg string) {
			p.Stage, p.Message = stage, msg
			emit(EventLogProgress, p)
		}

		report("downloading", "")
		dst := filepath.Join(t.logsDir, filepath.Base(name))
		err := client.Download(context.Background(), strings.TrimSuffix(fs.LogsDir, "/")+"/"+name, dst, func(done, total int64) {
			p.Done, p.Total = done, total
			report("downloading", "")
		})
		if err != nil {
			failed = append(failed, name)
			report("error", err.Error())
			continue
		}

		if !strings.EqualFold(filepath.Ext(dst), ".bin") {
			if l, err := localLog(dst); err == nil {
				out = append(out, l)
			}
			report("done", "")
			continue
		}

		report("converting", "")
		c, err := logfile.Convert(dst, t.options())
		if err != nil {
			failed = append(failed, name)
			report("error", err.Error())
			continue
		}
		if l, err := localLog(c.Normalized); err == nil {
			out = append(out, l)
		}
		report("done", "")
	}
	if len(failed) > 0 {
		return out, fmt.Errorf("couldn't get %s", strings.Join(failed, ", "))
	}
	return out, nil
}

func (s *LogService) FinishRemote() error {
	s.mu.Lock()
	t := s.serverOn
	s.serverOn = nil
	s.mu.Unlock()
	if t == nil || t.profile.FileServer == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := t.sendCommand(ctx, t.profile.FileServer.Disable); err != nil {
		return fmt.Errorf("turning off the file server (the logger stays paused until it's off): %w", err)
	}
	return nil
}

func (s *LogService) LocalLogs() ([]LocalLog, error) {
	t, err := s.live.target()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(t.logsDir)
	if errors.Is(err, os.ErrNotExist) {
		return []LocalLog{}, nil
	}
	if err != nil {
		return nil, err
	}
	logs := []LocalLog{}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if l, err := localLog(filepath.Join(t.logsDir, e.Name())); err == nil && l.Kind != "" {
			logs = append(logs, l)
		}
	}
	sort.Slice(logs, func(i, j int) bool { return logs[i].Modified > logs[j].Modified })
	return logs, nil
}

func (s *LogService) ConvertLocal(path string) (LocalLog, error) {
	t, err := s.live.target()
	if err != nil {
		return LocalLog{}, err
	}
	c, err := logfile.Convert(path, t.options())
	if err != nil {
		return LocalLog{}, err
	}
	return localLog(c.Normalized)
}

func (s *LogService) PickFile() (string, error) {
	dialog := application.Get().Dialog.OpenFile().
		SetTitle("Open a log").
		AddFilter("Logs (*.csv, *.bin)", "*.csv;*.bin;*.tsv;*.txt").
		AddFilter("All files", "*.*")
	if t, err := s.live.target(); err == nil {
		if _, err := os.Stat(t.logsDir); err == nil {
			dialog.SetDirectory(t.logsDir)
		}
	}
	return dialog.PromptForSingleSelection()
}

func (s *LogService) Load(path string) (*ViewerLog, error) {
	opts := logfile.Options{}
	profile := ""
	if t, err := s.live.target(); err == nil {
		opts, profile = t.options(), t.profile.Name
	}
	tab, source, err := logfile.Load(path, opts)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	if len(tab.TimeMS) == 0 || len(tab.Columns) == 0 {
		return nil, fmt.Errorf("%s has no data", filepath.Base(path))
	}

	rows := len(tab.TimeMS)
	blob := make([]byte, 0, (len(tab.Columns)+1)*rows*8)
	start := tab.TimeMS[0]
	for _, ms := range tab.TimeMS {
		blob = binary.LittleEndian.AppendUint64(blob, math.Float64bits((ms-start)/1000))
	}
	for _, col := range tab.Values {
		for _, v := range col {
			blob = binary.LittleEndian.AppendUint64(blob, math.Float64bits(v))
		}
	}
	v := &ViewerLog{Name: filepath.Base(path), Path: path, Rows: rows, DataURL: logDataPath + s.keepBlob(blob)}
	if source != logfile.SourceWide {
		hz := opts.Hz
		if hz <= 0 {
			hz = logfile.DefaultHz
		}
		v.Note = fmt.Sprintf("resampled to %d Hz", hz)
		if profile != "" {
			v.Note += ", renames and calibrations from " + profile
		}
	}
	if tab.Note != "" {
		if v.Note != "" {
			v.Note += "; "
		}
		v.Note += tab.Note
	}
	for c, name := range tab.Columns {
		v.Channels = append(v.Channels, ViewerChannel{Name: name, Unit: tab.Units[c]})
	}
	return v, nil
}

func (s *LogService) LogsFolder() (string, error) {
	t, err := s.live.target()
	return t.logsDir, err
}

func (s *LogService) OpenLogsFolder() error {
	t, err := s.live.target()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(t.logsDir, 0o755); err != nil {
		return err
	}
	return application.Get().Env.OpenFileManager(t.logsDir, false)
}

func localLog(path string) (LocalLog, error) {
	st, err := os.Stat(path)
	if err != nil {
		return LocalLog{}, err
	}
	name := filepath.Base(path)
	kind := ""
	switch lower := strings.ToLower(name); {
	case strings.HasSuffix(lower, "_normalized.csv"):
		kind = "normalized"
	case strings.HasSuffix(lower, ".csv"), strings.HasSuffix(lower, ".tsv"):
		kind = "csv"
	case strings.HasSuffix(lower, ".bin"):
		kind = "bin"
	}
	return LocalLog{Name: name, Path: path, Kind: kind, Size: st.Size(), Modified: st.ModTime().UnixMilli()}, nil
}

var (
	logNumberRe = regexp.MustCompile(`data(\d+)\.\w+$`)
	logDateRe   = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})`)
)

func logNumber(name string) int {
	if m := logNumberRe.FindStringSubmatch(name); m != nil {
		n, _ := strconv.Atoi(m[1])
		return n
	}
	return -1
}

func logDate(name string) string {
	if m := logDateRe.FindStringSubmatch(name); m != nil {
		return fmt.Sprintf("%s %s:%s:%s UTC", m[1], m[2], m[3], m[4])
	}
	return ""
}
