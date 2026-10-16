package services

import (
	"encoding/binary"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadServesColumnsOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "lap.csv")
	os.WriteFile(path, []byte("timestamp_ms,RPM,TPS1\n1000,4000,10\n1010,4100,12\n1020,4200,15\n"), 0o644)

	s := NewLogService(NewLiveService(t.TempDir()))
	v, err := s.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if v.Rows != 3 || len(v.Channels) != 2 || v.Channels[0].Name != "RPM" || v.Note != "" {
		t.Fatalf("metadata %+v", v)
	}

	nextCalled := false
	h := LogDataMiddleware(s)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { nextCalled = true }))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, v.DataURL, nil))
	body := rec.Body.Bytes()
	if rec.Code != http.StatusOK || len(body) != 3*3*8 {
		t.Fatalf("status %d, %d bytes", rec.Code, len(body))
	}
	f := func(i int) float64 { return math.Float64frombits(binary.LittleEndian.Uint64(body[i*8:])) }
	if f(0) != 0 || f(2) != 0.02 || f(3) != 4000 || f(8) != 15 {
		t.Fatalf("values %v %v %v %v", f(0), f(2), f(3), f(8))
	}

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, v.DataURL, nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("second fetch: %d, want 404", rec.Code)
	}

	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/index.html", nil))
	if !nextCalled {
		t.Fatal("other requests must reach the asset server")
	}
}

func TestLoadReportsUnreadableFiles(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notes.csv")
	os.WriteFile(path, []byte("just,some\ntext,here\n"), 0o644)
	if _, err := NewLogService(NewLiveService(t.TempDir())).Load(path); err == nil {
		t.Fatal("expected an error")
	}
}
