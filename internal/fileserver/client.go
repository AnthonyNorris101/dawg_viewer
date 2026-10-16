package fileserver

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	base string
	http *http.Client
}

func New(addr netip.Addr, port int) *Client {
	return &Client{
		base: "http://" + net.JoinHostPort(addr.String(), strconv.Itoa(port)),
		http: &http.Client{},
	}
}

func (c *Client) List(ctx context.Context, dir string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	resp, err := c.get(ctx, "/files", url.Values{"dir": {dir}})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var names []string
	if err := json.NewDecoder(resp.Body).Decode(&names); err != nil {
		return nil, fmt.Errorf("file list: %w", err)
	}
	for i, n := range names {
		names[i] = path.Base(n)
	}
	return names, nil
}

func (c *Client) Download(ctx context.Context, remote, dst string, progress func(done, total int64)) error {
	resp, err := c.get(ctx, "/download", url.Values{"name": {strings.TrimPrefix(remote, "/")}})
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	tmp := dst + ".part"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	pr := &progressReader{r: resp.Body, total: resp.ContentLength, fn: progress}
	_, err = io.Copy(f, pr)
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil && resp.ContentLength > 0 && pr.done != resp.ContentLength {
		err = fmt.Errorf("download stopped at %d of %d bytes", pr.done, resp.ContentLength)
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

func (c *Client) get(ctx context.Context, p string, q url.Values) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base+p+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 200))
		resp.Body.Close()
		return nil, fmt.Errorf("%s: %s %s", p, resp.Status, strings.TrimSpace(string(body)))
	}
	return resp, nil
}

type progressReader struct {
	r     io.Reader
	done  int64
	total int64
	last  time.Time
	fn    func(done, total int64)
}

func (p *progressReader) Read(b []byte) (int, error) {
	n, err := p.r.Read(b)
	p.done += int64(n)
	if p.fn != nil && (err != nil || time.Since(p.last) > 100*time.Millisecond) {
		p.last = time.Now()
		p.fn(p.done, p.total)
	}
	return n, err
}
