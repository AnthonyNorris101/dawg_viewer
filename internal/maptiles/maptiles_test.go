package maptiles

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

var png = []byte("\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89")

func newServer(t *testing.T, upstream http.HandlerFunc) (*Server, *httptest.Server, http.Handler) {
	t.Helper()
	up := httptest.NewServer(upstream)
	t.Cleanup(up.Close)
	dir := t.TempDir()
	s := &Server{
		Dir: func() string { return dir },
		Sources: func() []Source {
			return []Source{
				{ID: "xyz", URL: up.URL + "/{z}/{x}/{y}.png", MaxZoom: 19},
				{ID: "box", URL: up.URL + "/export?bbox={bbox}", MaxZoom: 19},
			}
		},
		UserAgent: "DawgViewer/test",
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	return s, up, s.Middleware(next)
}

func get(h http.Handler, path string) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestTilesAreFetchedOnceAndThenServedFromDisk(t *testing.T) {
	var hits atomic.Int32
	var agent, path atomic.Value
	_, up, h := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		agent.Store(r.UserAgent())
		path.Store(r.URL.Path)
		_, _ = w.Write(png)
	})
	first := get(h, "/maptiles/xyz/17/34567/52345")
	if first.Code != 200 || first.Header().Get("X-Tile-Cache") != "miss" || first.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("first: %d %v", first.Code, first.Header())
	}
	if agent.Load() != "DawgViewer/test" || path.Load() != "/17/34567/52345.png" {
		t.Fatalf("upstream saw %v %v", agent.Load(), path.Load())
	}
	up.Close()
	second := get(h, "/maptiles/xyz/17/34567/52345")
	if second.Code != 200 || second.Header().Get("X-Tile-Cache") != "hit" || hits.Load() != 1 {
		t.Fatalf("second: %d %v after %d fetches", second.Code, second.Header(), hits.Load())
	}
	if other := get(h, "/other"); other.Code != http.StatusTeapot {
		t.Fatalf("other paths must pass through, got %d", other.Code)
	}
}

func TestBadRequestsNeverReachTheMapServer(t *testing.T) {
	var hits atomic.Int32
	_, _, h := newServer(t, func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		_, _ = w.Write(png)
	})
	for _, p := range []string{
		"/maptiles/nope/1/0/0", "/maptiles/xyz/1/2/0", "/maptiles/xyz/20/0/0", "/maptiles/xyz/1/-1/0",
		"/maptiles/xyz/1/0", "/maptiles/xyz/1/0/0/0", "/maptiles/xyz/01/0/0", "/maptiles/xyz/a/b/c",
		"/maptiles/../xyz/1/0/0",
	} {
		if rec := get(h, p); rec.Code != http.StatusNotFound {
			t.Errorf("%s: got %d", p, rec.Code)
		}
	}
	if hits.Load() != 0 {
		t.Fatalf("%d bad requests were forwarded", hits.Load())
	}
}

func TestFailuresAreNotCachedOrRetriedStraightAway(t *testing.T) {
	var hits atomic.Int32
	var mode atomic.Value
	mode.Store("html")
	_, _, h := newServer(t, func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		switch mode.Load() {
		case "html":
			_, _ = w.Write([]byte("<html>sign in</html>"))
		case "error":
			w.WriteHeader(http.StatusForbidden)
		default:
			_, _ = w.Write(png)
		}
	})
	if rec := get(h, "/maptiles/xyz/3/1/1"); rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "not an image") {
		t.Fatalf("html: %d %s", rec.Code, rec.Body)
	}
	mode.Store("ok")
	if rec := get(h, "/maptiles/xyz/3/1/1"); rec.Code != http.StatusBadGateway || hits.Load() != 1 {
		t.Fatalf("retried at once: %d after %d fetches", rec.Code, hits.Load())
	}
	mode.Store("error")
	if rec := get(h, "/maptiles/xyz/3/2/2"); rec.Code != http.StatusBadGateway {
		t.Fatalf("403: %d", rec.Code)
	}
	mode.Store("ok")
	if rec := get(h, "/maptiles/xyz/3/3/3"); rec.Code != 200 {
		t.Fatalf("another tile should still load: %d", rec.Code)
	}
}

func TestBoundingBoxAndMerge(t *testing.T) {
	s := Source{ID: "box", URL: "https://example.test/export?bbox={bbox}&z={z}"}
	if got := s.TileURL(1, 1, 0); got != "https://example.test/export?bbox=0.000,0.000,20037508.343,20037508.343&z=1" {
		t.Fatal(got)
	}
	all, err := Merge([]Source{
		{ID: "satellite", URL: "https://example.test/{z}/{x}/{y}", Attribution: "Team"},
		{ID: "extra", URL: "https://example.test/{z}/{x}/{y}"},
		{ID: "Bad Id", URL: "https://example.test/{z}/{x}/{y}"},
		{ID: "nourl", URL: "ftp://example.test/{z}/{x}/{y}"},
		{ID: "noxy", URL: "https://example.test/tiles"},
	})
	if err == nil || strings.Count(err.Error(), "\n") != 2 {
		t.Fatalf("want three problems, got %v", err)
	}
	if len(all) != 3 || all[0].Attribution != "Team" || all[0].MaxZoom != 19 || all[2].ID != "extra" || all[2].Name != "extra" {
		t.Fatalf("merged: %+v", all)
	}
	for _, d := range Defaults() {
		if err := d.Validate(); err != nil {
			t.Fatal(err)
		}
	}
}
