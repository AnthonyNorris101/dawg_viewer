package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"dawg_viewer/internal/logfile"
)

type fileServer struct {
	port int
	dir  string

	mu  sync.Mutex
	srv *http.Server
}

func newFileServer(port int) (*fileServer, error) {
	dir, err := os.MkdirTemp("", "iltm-sim-logs")
	if err != nil {
		return nil, err
	}
	names := map[uint8]string{0: "Time_tx"}
	for _, s := range signals {
		names[s.id] = s.name
	}
	start := time.Now().UTC().Add(-time.Hour)
	for n := 1; n <= 3; n++ {
		var entries []logfile.LogEntry
		for ms := 0; ms < 60_000; ms += 20 {
			t := float64(ms)/1000 + float64(n*60)
			for _, s := range signals {
				entries = append(entries, logfile.LogEntry{TimeStampMS: uint32(ms + n*60_000), ID: s.id, Value: float32(s.gen(t))})
			}
		}
		name := fmt.Sprintf("%s_data%d.bin", start.Add(time.Duration(n)*time.Minute).Format("2006-01-02_15-04-05"), n)
		if err := os.WriteFile(filepath.Join(dir, name), logfile.Encode(names, entries), 0o644); err != nil {
			return nil, err
		}
	}
	return &fileServer{port: port, dir: dir}, nil
}

func (f *fileServer) set(on bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if on == (f.srv != nil) {
		return
	}
	if !on {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		f.srv.Shutdown(ctx)
		cancel()
		f.srv = nil
		log.Printf("file server stopped")
		return
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/files", func(w http.ResponseWriter, r *http.Request) {
		names := []string{}
		if strings.Trim(r.URL.Query().Get("dir"), "/") == "logs" {
			entries, _ := os.ReadDir(f.dir)
			for _, e := range entries {
				names = append(names, e.Name())
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(names)
	})
	mux.HandleFunc("/download", func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimLeft(r.URL.Query().Get("name"), "/")
		rest, ok := strings.CutPrefix(name, "logs/")
		if !ok || strings.Contains(rest, "/") {
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
		http.ServeFile(w, r, filepath.Join(f.dir, rest))
	})
	f.srv = &http.Server{Addr: net.JoinHostPort("", strconv.Itoa(f.port)), Handler: mux}
	srv := f.srv
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("file server: %v", err)
		}
	}()
	log.Printf("file server on port %d serving %s", f.port, f.dir)
}
