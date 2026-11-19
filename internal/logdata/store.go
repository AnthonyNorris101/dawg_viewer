package logdata

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"dawg_viewer/internal/logfile"
)

const Path = "/logdata/"

type Store struct {
	mu     sync.Mutex
	tables map[string]*logfile.Table
}

func (s *Store) Add(table *logfile.Table) string {
	var b [16]byte
	rand.Read(b[:])
	token := hex.EncodeToString(b[:])
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tables == nil || len(s.tables) >= 2 {
		s.tables = map[string]*logfile.Table{}
	}
	s.tables[token] = table
	return Path + token
}

func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tables = nil
}

func (s *Store) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.URL.Path, Path)
		if !ok {
			next.ServeHTTP(w, r)
			return
		}
		s.mu.Lock()
		table, found := s.tables[token]
		delete(s.tables, token)
		s.mu.Unlock()
		if !found {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", strconv.FormatInt(table.ColumnBytes(), 10))
		if err := table.WriteColumns(requestWriter{r.Context(), w}); err != nil && r.Context().Err() == nil {
			slog.ErrorContext(r.Context(), "log data transfer failed", "error", err)
		}
	})
}

type requestWriter struct {
	ctx context.Context
	w   io.Writer
}

func (w requestWriter) Write(b []byte) (int, error) {
	if err := w.ctx.Err(); err != nil {
		return 0, err
	}
	return w.w.Write(b)
}
