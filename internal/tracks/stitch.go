package tracks

import (
	"math"
	"sort"
)

const (
	earthRadiusM = 6371008.8
	minTrackM    = 60
	maxTurnRad   = 2.6
)

type Way struct {
	Name string
	Pit  bool
	Lat  []float64
	Lon  []float64
}

type node struct{ lat, lon int64 }

type edge struct {
	name   string
	lat    []float64
	lon    []float64
	length float64
	used   bool
}

func key(lat, lon float64) node {
	return node{int64(math.Round(lat * 1e7)), int64(math.Round(lon * 1e7))}
}

func metres(lat1, lon1, lat2, lon2 float64) float64 {
	rad := math.Pi / 180
	x := (lon2 - lon1) * rad * math.Cos((lat1+lat2)/2*rad)
	y := (lat2 - lat1) * rad
	return math.Hypot(x, y) * earthRadiusM
}

func bearing(lat1, lon1, lat2, lon2 float64) float64 {
	rad := math.Pi / 180
	return math.Atan2((lat2-lat1)*rad, (lon2-lon1)*rad*math.Cos((lat1+lat2)/2*rad))
}

func turn(a, b float64) float64 {
	d := math.Abs(a - b)
	if d > math.Pi {
		d = 2*math.Pi - d
	}
	return d
}

func (e *edge) ends() (node, node) {
	n := len(e.lat) - 1
	return key(e.lat[0], e.lon[0]), key(e.lat[n], e.lon[n])
}

func (e *edge) reversed() *edge {
	n := len(e.lat)
	r := &edge{name: e.name, length: e.length, lat: make([]float64, n), lon: make([]float64, n)}
	for i := range e.lat {
		r.lat[n-1-i] = e.lat[i]
		r.lon[n-1-i] = e.lon[i]
	}
	return r
}

func split(ways []Way) []*edge {
	seen := map[node]int{}
	for _, w := range ways {
		n := len(w.Lat)
		for i := range w.Lat {
			k := key(w.Lat[i], w.Lon[i])
			if i == 0 || i == n-1 {
				seen[k] += 2
			} else {
				seen[k]++
			}
		}
	}
	var edges []*edge
	for _, w := range ways {
		start := 0
		for i := 1; i < len(w.Lat); i++ {
			if i < len(w.Lat)-1 && seen[key(w.Lat[i], w.Lon[i])] < 2 {
				continue
			}
			e := &edge{name: w.Name, lat: w.Lat[start : i+1], lon: w.Lon[start : i+1]}
			for j := start + 1; j <= i; j++ {
				e.length += metres(w.Lat[j-1], w.Lon[j-1], w.Lat[j], w.Lon[j])
			}
			if e.length > 0 {
				edges = append(edges, e)
			}
			start = i
		}
	}
	return edges
}

func Stitch(ways []Way) []Track {
	var kept []Way
	for _, w := range ways {
		if !w.Pit && len(w.Lat) >= 2 && len(w.Lat) == len(w.Lon) {
			kept = append(kept, w)
		}
	}
	edges := split(kept)
	sort.SliceStable(edges, func(i, j int) bool { return edges[i].length > edges[j].length })
	at := map[node][]*edge{}
	for _, e := range edges {
		a, b := e.ends()
		at[a] = append(at[a], e)
		if b != a {
			at[b] = append(at[b], e)
		}
	}

	tracks := []Track{}
	for _, first := range edges {
		if first.used {
			continue
		}
		first.used = true
		chain := []*edge{first}
		head, tail := first.ends()
		closed := head == tail
		for pass := 0; pass < 2 && !closed; pass++ {
			for {
				last := chain[len(chain)-1]
				n := len(last.lat)
				heading := bearing(last.lat[n-2], last.lon[n-2], last.lat[n-1], last.lon[n-1])
				var next *edge
				best := maxTurnRad
				for _, c := range at[tail] {
					if c.used {
						continue
					}
					o := c
					if a, _ := c.ends(); a != tail {
						o = c.reversed()
					}
					t := turn(heading, bearing(o.lat[0], o.lon[0], o.lat[1], o.lon[1]))
					if c.name != "" && c.name == last.name {
						t -= 0.2
					}
					if t < best {
						best, next = t, c
					}
				}
				if next == nil {
					break
				}
				next.used = true
				if a, _ := next.ends(); a != tail {
					r := next.reversed()
					r.used = true
					next = r
				}
				chain = append(chain, next)
				_, tail = next.ends()
				if tail == head {
					closed = true
					break
				}
			}
			if !closed && pass == 0 {
				for i, j := 0, len(chain)-1; i < j; i, j = i+1, j-1 {
					chain[i], chain[j] = chain[j], chain[i]
				}
				for i := range chain {
					chain[i] = chain[i].reversed()
				}
				head, tail = tail, head
			}
		}

		t := Track{Closed: closed}
		names := map[string]float64{}
		for i, e := range chain {
			from := 0
			if i > 0 {
				from = 1
			}
			t.Lat = append(t.Lat, e.lat[from:]...)
			t.Lon = append(t.Lon, e.lon[from:]...)
			t.Length += e.length
			if e.name != "" {
				names[e.name] += e.length
			}
		}
		longest := 0.0
		for name, length := range names {
			if length > longest || (length == longest && name < t.Name) {
				longest, t.Name = length, name
			}
		}
		if closed && len(t.Lat) > 1 {
			t.Lat = t.Lat[:len(t.Lat)-1]
			t.Lon = t.Lon[:len(t.Lon)-1]
		}
		if t.Length >= minTrackM && len(t.Lat) >= 3 {
			tracks = append(tracks, t)
		}
	}
	sort.SliceStable(tracks, func(i, j int) bool {
		if tracks[i].Closed != tracks[j].Closed {
			return tracks[i].Closed
		}
		return tracks[i].Length > tracks[j].Length
	})
	return tracks
}
