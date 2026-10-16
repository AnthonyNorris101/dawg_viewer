package logfile

import (
	"bufio"
	"fmt"
	"io"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"
)

type Table struct {
	TimeMS  []float64
	Columns []string
	Values  [][]float64
}

type sample struct {
	t float64
	v float64
}

func columnNames(log *Log) map[uint8]string {
	count := map[string]int{}
	for _, n := range log.Names {
		count[n]++
	}
	out := map[uint8]string{}
	for id, n := range log.Names {
		if count[n] > 1 {
			n = fmt.Sprintf("%s_%d", n, id)
		}
		out[id] = n
	}
	return out
}

func Normalize(log *Log, hz int) *Table {
	names := columnNames(log)
	series := map[string][]sample{}
	for _, e := range log.Entries {
		name, ok := names[e.ID]
		if !ok {
			name = fmt.Sprintf("UNKNOWN_%d", e.ID)
		}
		v := float64(e.Value)
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		series[name] = append(series[name], sample{float64(e.TimeStampMS), v})
	}
	return resample(series, hz)
}

func resample(series map[string][]sample, hz int) *Table {
	t := &Table{}
	if len(series) == 0 {
		return t
	}
	if hz <= 0 {
		hz = 100
	}
	step := float64(1000 / hz)

	start, end := math.Inf(1), math.Inf(-1)
	for name, s := range series {
		sort.SliceStable(s, func(i, j int) bool { return s[i].t < s[j].t })
		s = dedupeLast(s)
		series[name] = s
		start = math.Min(start, s[0].t)
		end = math.Max(end, s[len(s)-1].t)
		t.Columns = append(t.Columns, name)
	}
	sort.Strings(t.Columns)

	for x := start; x < end+step; x += step {
		t.TimeMS = append(t.TimeMS, x)
	}
	for _, name := range t.Columns {
		t.Values = append(t.Values, interpolate(series[name], t.TimeMS))
	}
	return t
}

func dedupeLast(s []sample) []sample {
	out := s[:0]
	for i, p := range s {
		if i+1 < len(s) && s[i+1].t == p.t {
			continue
		}
		out = append(out, p)
	}
	return out
}

func interpolate(s []sample, grid []float64) []float64 {
	out := make([]float64, len(grid))
	j := 0
	for i, x := range grid {
		for j+1 < len(s) && s[j+1].t <= x {
			j++
		}
		switch {
		case x <= s[0].t:
			out[i] = s[0].v
		case j+1 >= len(s):
			out[i] = s[len(s)-1].v
		default:
			a, b := s[j], s[j+1]
			out[i] = a.v + (b.v-a.v)*(x-a.t)/(b.t-a.t)
		}
	}
	return out
}

func WriteTableCSV(w io.Writer, t *Table) error {
	bw := bufio.NewWriter(w)
	bw.WriteString("timestamp_ms")
	for _, c := range t.Columns {
		bw.WriteByte(',')
		bw.WriteString(c)
	}
	bw.WriteByte('\n')
	for i, ts := range t.TimeMS {
		bw.WriteString(strconv.FormatFloat(ts, 'f', -1, 64))
		for c := range t.Columns {
			bw.WriteByte(',')
			bw.WriteString(strconv.FormatFloat(t.Values[c][i], 'g', -1, 64))
		}
		bw.WriteByte('\n')
	}
	return bw.Flush()
}

type Converted struct {
	CSV        string
	Normalized string
	Table      *Table
}

func Convert(binPath string, rename map[uint8]string, hz int) (*Converted, error) {
	in, err := os.Open(binPath)
	if err != nil {
		return nil, err
	}
	log, err := Decode(in)
	in.Close()
	if err != nil {
		return nil, fmt.Errorf("%s: %w", binPath, err)
	}
	for id, name := range rename {
		if _, ok := log.Names[id]; ok {
			log.Names[id] = name
		}
	}

	base := strings.TrimSuffix(binPath, ".bin")
	c := &Converted{CSV: base + ".csv", Normalized: base + "_Normalized.csv", Table: Normalize(log, hz)}
	if err := writeFile(c.CSV, func(w io.Writer) error { return WriteCSV(w, log) }); err != nil {
		return nil, err
	}
	if err := writeFile(c.Normalized, func(w io.Writer) error { return WriteTableCSV(w, c.Table) }); err != nil {
		return nil, err
	}
	return c, nil
}

func writeFile(path string, write func(io.Writer) error) error {
	f, err := os.Create(path + ".tmp")
	if err != nil {
		return err
	}
	if err := write(f); err != nil {
		f.Close()
		os.Remove(f.Name())
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(path+".tmp", path)
}
