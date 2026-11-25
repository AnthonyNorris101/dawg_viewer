package tracks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const (
	lat0 = 33.95
	lon0 = -83.37
)

func point(x, y float64) (float64, float64) {
	rad := math.Pi / 180
	return lat0 + y/(rad*earthRadiusM), lon0 + x/(rad*earthRadiusM*math.Cos(lat0*rad))
}

func way(name string, xy ...float64) Way {
	w := Way{Name: name}
	for i := 0; i+1 < len(xy); i += 2 {
		lat, lon := point(xy[i], xy[i+1])
		w.Lat = append(w.Lat, lat)
		w.Lon = append(w.Lon, lon)
	}
	return w
}

func circuit() []Way {
	pit := way("Pit Lane", 100, 0, 150, -12, 250, -12, 300, 0)
	pit.Pit = true
	return []Way{
		way("Main Circuit", 0, 0, 100, 0, 200, 0, 300, 0, 400, 0),
		way("", 0, 200, 0, 100, 0, 0),
		way("Main Circuit", 400, 0, 400, 100, 400, 200, 200, 200, 0, 200),
		way("Short Cut", 200, 0, 210, 100, 200, 200),
		way("Kart Track", 600, 0, 660, 0, 660, 40, 600, 40, 600, 0),
		way("Stub", 900, 0, 920, 0),
		pit,
	}
}

func TestStitchJoinsPiecesIntoLoops(t *testing.T) {
	got := Stitch(circuit())
	if len(got) != 3 {
		t.Fatalf("got %d tracks, want 3: %+v", len(got), got)
	}
	main := got[0]
	if !main.Closed || main.Name != "Main Circuit" {
		t.Fatalf("first track = %q closed %v, want the closed main circuit", main.Name, main.Closed)
	}
	if math.Abs(main.Length-1200) > 2 {
		t.Fatalf("main circuit is %.1f m, want 1200", main.Length)
	}
	if len(main.Lat) != 10 {
		t.Fatalf("main circuit has %d points, want 10 with the start not repeated", len(main.Lat))
	}
	turns := 0.0
	n := len(main.Lat)
	for i := 0; i < n; i++ {
		a := bearing(main.Lat[i], main.Lon[i], main.Lat[(i+1)%n], main.Lon[(i+1)%n])
		b := bearing(main.Lat[(i+1)%n], main.Lon[(i+1)%n], main.Lat[(i+2)%n], main.Lon[(i+2)%n])
		turns += turn(a, b)
	}
	if math.Abs(turns-2*math.Pi) > 0.01 {
		t.Fatalf("the main circuit turns through %.2f rad, want one full turn", turns)
	}
	kart := got[1]
	if !kart.Closed || kart.Name != "Kart Track" || math.Abs(kart.Length-200) > 1 || len(kart.Lat) != 4 {
		t.Fatalf("second track = %+v, want the 200 m kart loop", kart)
	}
	cut := got[2]
	if cut.Closed || cut.Name != "Short Cut" || math.Abs(cut.Length-201) > 1 {
		t.Fatalf("third track = %q closed %v %.0f m, want the open short cut", cut.Name, cut.Closed, cut.Length)
	}
}

func TestStitchFollowsAnOpenTrackFromEitherEnd(t *testing.T) {
	got := Stitch([]Way{
		way("Hill Climb", 100, 0, 200, 0),
		way("Hill Climb", 100, 0, 0, 0),
		way("Hill Climb", 300, 50, 200, 0),
	})
	if len(got) != 1 || got[0].Closed || len(got[0].Lat) != 4 {
		t.Fatalf("got %+v, want one open track of 4 points", got)
	}
	if math.Abs(got[0].Length-(200+math.Hypot(100, 50))) > 1 {
		t.Fatalf("length %.1f", got[0].Length)
	}
	for i := 1; i < len(got[0].Lon); i++ {
		if (got[0].Lon[i] > got[0].Lon[i-1]) != (got[0].Lon[1] > got[0].Lon[0]) {
			t.Fatalf("points are not in order along the track: %v", got[0].Lon)
		}
	}
}

type fake struct {
	geocoder, overpass atomic.Int32
	query              atomic.Value
	agent              atomic.Value
	geocode            func(w http.ResponseWriter)
	failFirst          bool
}

func overpassBody(ways []Way) string {
	type pt struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	}
	type el struct {
		Type     string            `json:"type"`
		ID       int               `json:"id"`
		Tags     map[string]string `json:"tags"`
		Geometry []pt              `json:"geometry"`
	}
	var out struct {
		Elements []el `json:"elements"`
	}
	for i, w := range ways {
		e := el{Type: "way", ID: i + 1, Tags: map[string]string{"highway": "raceway"}}
		if w.Name != "" {
			e.Tags["name"] = w.Name
		}
		for j := range w.Lat {
			e.Geometry = append(e.Geometry, pt{w.Lat[j], w.Lon[j]})
		}
		out.Elements = append(out.Elements, e)
	}
	out.Elements = append(out.Elements, el{Type: "node", ID: 99})
	b, _ := json.Marshal(out)
	return string(b)
}

func (f *fake) server(t *testing.T) (*httptest.Server, *Finder) {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/search", func(w http.ResponseWriter, r *http.Request) {
		f.geocoder.Add(1)
		f.agent.Store(r.UserAgent())
		if r.URL.Query().Get("format") != "jsonv2" || r.URL.Query().Get("q") == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		if f.geocode != nil {
			f.geocode(w)
			return
		}
		fmt.Fprintf(w, `[{"lat":"47.07","lon":"8.19","boundingbox":["47.06","47.08","8.18","8.20"],"display_name":"Somewhere Else, Luzern, Schweiz"},
			{"lat":"%f","lon":"%f","boundingbox":["33.94","33.96","-83.38","-83.36"],"display_name":"Test Raceway, Winder Highway, Hall County, Georgia, United States"}]`, lat0, lon0)
	})
	answer := func(w http.ResponseWriter, r *http.Request) {
		f.overpass.Add(1)
		if r.Method != http.MethodPost || r.ParseForm() != nil {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		q := r.PostForm.Get("data")
		f.query.Store(q)
		if strings.Contains(q, "(47.") {
			fmt.Fprint(w, `{"elements":[]}`)
			return
		}
		fmt.Fprint(w, overpassBody(circuit()))
	}
	mux.HandleFunc("/down", func(w http.ResponseWriter, r *http.Request) {
		f.overpass.Add(1)
		http.Error(w, "busy", http.StatusGatewayTimeout)
	})
	mux.HandleFunc("/api/interpreter", answer)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	dir := t.TempDir()
	finder := &Finder{
		UserAgent: "DawgViewer/test",
		Gap:       time.Millisecond,
		Dir:       func() string { return dir },
		Config: func() Config {
			servers := []string{srv.URL + "/api/interpreter"}
			if f.failFirst {
				servers = append([]string{srv.URL + "/down"}, servers...)
			}
			return Config{Geocoder: srv.URL + "/search", Overpass: servers}
		},
	}
	return srv, finder
}

func TestSearchFindsThePlaceThenItsTracks(t *testing.T) {
	f := &fake{failFirst: true}
	_, finder := f.server(t)
	got, err := finder.Search(context.Background(), "  test   raceway ")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].Name != "Main Circuit" || !got[0].Closed {
		t.Fatalf("got %+v", got)
	}
	if got[0].Place != "Test Raceway, Winder Highway, United States" {
		t.Fatalf("place = %q", got[0].Place)
	}
	if f.agent.Load() != "DawgViewer/test" {
		t.Fatalf("user agent = %v", f.agent.Load())
	}
	q := f.query.Load().(string)
	if !strings.Contains(q, `way["highway"="raceway"](33.937000,-83.383000,33.963000,-83.357000)`) || !strings.Contains(q, "out tags geom") {
		t.Fatalf("overpass query = %s", q)
	}
	if f.geocoder.Load() != 1 || f.overpass.Load() != 4 {
		t.Fatalf("requests: geocoder %d, overpass %d, want 1 and 4 (two places, a failing server first)", f.geocoder.Load(), f.overpass.Load())
	}
	if _, err := finder.Search(context.Background(), "test raceway"); err != nil {
		t.Fatal(err)
	}
	if f.geocoder.Load() != 1 || f.overpass.Load() != 6 {
		t.Fatalf("a repeated search asked again: geocoder %d, overpass %d (only the failing server may be retried)", f.geocoder.Load(), f.overpass.Load())
	}
}

func TestNearSkipsTheGeocoder(t *testing.T) {
	f := &fake{}
	_, finder := f.server(t)
	got, err := finder.Near(context.Background(), lat0, lon0)
	if err != nil || len(got) != 3 {
		t.Fatalf("got %d tracks, err %v", len(got), err)
	}
	if f.geocoder.Load() != 0 {
		t.Fatal("a search around a point must not use the geocoder")
	}
	if q := f.query.Load().(string); !strings.Contains(q, "(around:3000,33.950000,-83.370000)") {
		t.Fatalf("overpass query = %s", q)
	}
	if _, err := finder.Near(context.Background(), 95, 0); err == nil {
		t.Fatal("want an error for a latitude of 95")
	}
}

func TestSearchNeedsAGeocoderAndReportsRefusals(t *testing.T) {
	f := &fake{geocode: func(w http.ResponseWriter) { http.Error(w, "slow down", http.StatusTooManyRequests) }}
	srv, finder := f.server(t)
	if _, err := finder.Search(context.Background(), "x"); err == nil || !strings.Contains(err.Error(), "refused the request") {
		t.Fatalf("err = %v, want a refusal", err)
	}
	f.geocode = func(w http.ResponseWriter) { fmt.Fprint(w, `[]`) }
	if _, err := finder.Search(context.Background(), "again"); err == nil || !strings.Contains(err.Error(), "refused a request a moment ago") {
		t.Fatalf("err = %v, want the search held back after a refusal", err)
	}
	if f.geocoder.Load() != 1 {
		t.Fatalf("the geocoder was asked %d times, want 1: a refused server must be left alone for a while", f.geocoder.Load())
	}
	finder.refused = nil
	if _, err := finder.Search(context.Background(), "nowhere"); err == nil || !strings.Contains(err.Error(), "no place called") {
		t.Fatalf("err = %v, want no place found", err)
	}
	finder.Config = func() Config { return Config{Overpass: []string{srv.URL + "/api/interpreter"}} }
	if _, err := finder.Search(context.Background(), "x"); !errors.Is(err, ErrNoGeocoder) {
		t.Fatalf("err = %v, want ErrNoGeocoder", err)
	}
	if _, err := finder.Search(context.Background(), " "); err == nil {
		t.Fatal("want an error for an empty name")
	}
	finder.Config = func() Config { return Config{Overpass: []string{}} }
	if _, err := finder.Near(context.Background(), lat0, lon0); err == nil || !strings.Contains(err.Error(), "turned off") {
		t.Fatalf("err = %v, want lookups turned off", err)
	}
	finder.Config = func() Config { return Config{Overpass: []string{"ftp://example.com"}} }
	if _, err := finder.Near(context.Background(), lat0, lon0); err == nil {
		t.Fatal("want an error for a non-http server")
	}
}

func TestDefaults(t *testing.T) {
	if got := (Config{}).Servers(); len(got) == 0 {
		t.Fatal("no default Overpass servers")
	}
	if (Config{}).Geocoder != "" {
		t.Fatal("name search must be off by default")
	}
}
