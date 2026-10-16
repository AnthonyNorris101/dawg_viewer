package fileserver

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func firmwareLike(t *testing.T, files map[string]string) *Client {
	mux := http.NewServeMux()
	mux.HandleFunc("/files", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("dir") != "/logs" {
			w.Write([]byte("[]"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`["2026-10-16_12-00-00_data1.bin","/logs/2026-10-16_12-05-00_data2.bin"]`))
	})
	mux.HandleFunc("/download", func(w http.ResponseWriter, r *http.Request) {
		body, ok := files["/"+r.URL.Query().Get("name")]
		if !ok {
			http.Error(w, "File not found", http.StatusNotFound)
			return
		}
		w.Write([]byte(body))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	host, port, _ := net.SplitHostPort(srv.Listener.Addr().String())
	p, _ := strconv.Atoi(port)
	return New(netip.MustParseAddr(host), p)
}

func TestListAndDownload(t *testing.T) {
	c := firmwareLike(t, map[string]string{"/logs/2026-10-16_12-00-00_data1.bin": "log bytes"})
	names, err := c.List(context.Background(), "/logs")
	if err != nil {
		t.Fatal(err)
	}
	if len(names) != 2 || names[1] != "2026-10-16_12-05-00_data2.bin" {
		t.Fatalf("names %v", names)
	}

	dst := filepath.Join(t.TempDir(), "data1.bin")
	var last int64
	err = c.Download(context.Background(), "/logs/2026-10-16_12-00-00_data1.bin", dst, func(done, _ int64) { last = done })
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(dst); string(b) != "log bytes" || last != 9 {
		t.Fatalf("got %q, progress %d", b, last)
	}

	missing := filepath.Join(t.TempDir(), "nope.bin")
	if err := c.Download(context.Background(), "/logs/nope.bin", missing, nil); err == nil {
		t.Fatal("missing file should fail")
	}
	if _, err := os.Stat(missing + ".part"); err == nil {
		t.Fatal("partial file left behind")
	}
}
