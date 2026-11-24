package logdata

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"dawg_viewer/internal/logfile"
)

func testTable() *logfile.Table {
	return &logfile.Table{TimeMS: []float64{1000, 1010}, Columns: []string{"RPM"}, Values: [][]float64{{4000, 4100}}}
}

func TestStoreConsumesTransferOnceAcrossConcurrentRequests(t *testing.T) {
	var store Store
	url := store.Add(testTable())
	h := store.Middleware(http.NotFoundHandler())
	var successful atomic.Int32
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
			if rec.Code == http.StatusOK {
				successful.Add(1)
				if rec.Body.Len() != 32 || rec.Header().Get("Content-Length") != "32" {
					t.Error("unexpected transfer length")
				}
			} else if rec.Code != http.StatusNotFound {
				t.Errorf("unexpected status %d", rec.Code)
			}
		})
	}
	wg.Wait()
	if successful.Load() != 1 {
		t.Fatalf("served %d times", successful.Load())
	}
}

func TestStoreBoundsPendingTransfersAndClearsOnShutdown(t *testing.T) {
	var store Store
	first := store.Add(testTable())
	store.Add(testTable())
	last := store.Add(testTable())
	h := store.Middleware(http.NotFoundHandler())
	for _, tc := range []struct {
		url  string
		code int
	}{{first, http.StatusNotFound}, {last, http.StatusOK}} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.url, nil))
		if rec.Code != tc.code {
			t.Fatalf("got %d, want %d", rec.Code, tc.code)
		}
	}
	url := store.Add(testTable())
	store.Clear()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
	if rec.Code != http.StatusNotFound {
		t.Fatal("cleared transfer is still available")
	}
}

type failingResponse struct {
	header http.Header
	writes int
}

func (w *failingResponse) Header() http.Header { return w.header }
func (w *failingResponse) WriteHeader(int)     {}
func (w *failingResponse) Write([]byte) (int, error) {
	w.writes++
	return 0, io.ErrClosedPipe
}

func TestStoreStopsOnCancellationAndWriterFailure(t *testing.T) {
	for _, cancelRequest := range []bool{false, true} {
		var store Store
		url := store.Add(testTable())
		h := store.Middleware(http.NotFoundHandler())
		ctx, cancel := context.WithCancel(context.Background())
		if cancelRequest {
			cancel()
		}
		w := &failingResponse{header: http.Header{}}
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, url, nil).WithContext(ctx))
		cancel()
		if cancelRequest && w.writes != 0 || !cancelRequest && w.writes != 1 {
			t.Fatalf("unexpected writes: %d (canceled: %v)", w.writes, cancelRequest)
		}
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, url, nil))
		if rec.Code != http.StatusNotFound {
			t.Fatal("failed transfer must release its table")
		}
	}
}
