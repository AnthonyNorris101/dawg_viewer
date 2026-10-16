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

const (
	DefaultHz = 100
	maxRows   = 5_000_000
)

type Combine struct {
	Name string
	Hi   string
	Lo   string
}

type Options struct {
	Hz        int
	Rename    map[uint8]string
	Calibrate map[string]func(float64) float64
	Combine   []Combine
}

func (o Options) hz() int {
	if o.Hz <= 0 {
		return DefaultHz
	}
	return o.Hz
}

type Table struct {
	Note    string
	TimeMS  []float64
	Columns []string
	Units   []string
	Precise []bool
	Values  [][]float64
}

func (t *Table) column(name string) int {
	for i, c := range t.Columns {
		if c == name {
			return i
		}
	}
	return -1
}

func (t *Table) add(name, unit string, precise bool, values []float64) {
	i := sort.SearchStrings(t.Columns, name)
	t.Columns = append(t.Columns[:i], append([]string{name}, t.Columns[i:]...)...)
	t.Units = append(t.Units[:i], append([]string{unit}, t.Units[i:]...)...)
	t.Precise = append(t.Precise[:i], append([]bool{precise}, t.Precise[i:]...)...)
	t.Values = append(t.Values[:i], append([][]float64{values}, t.Values[i:]...)...)
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

func applyRename(log *Log, rename map[uint8]string) {
	for id, name := range rename {
		if _, ok := log.Names[id]; ok {
			log.Names[id] = name
		}
	}
}

func Normalize(log *Log, opts Options) (*Table, error) {
	names := columnNames(log)
	series := map[string][]sample{}
	for _, e := range log.Entries {
		name, ok := names[e.ID]
		if !ok {
			name = fmt.Sprintf("UNKNOWN_%d", e.ID)
		}
		v := float64(e.Value)
		if conv, ok := opts.Calibrate[log.Names[e.ID]]; ok {
			v = conv(v)
		}
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		series[name] = append(series[name], sample{float64(e.TimeStampMS), v})
	}

	t, err := resample(series, opts.hz())
	if err != nil {
		return nil, err
	}
	for _, c := range opts.Combine {
		hi, lo := t.column(c.Hi), t.column(c.Lo)
		if hi < 0 || lo < 0 || t.column(c.Name) >= 0 {
			continue
		}
		sum := make([]float64, len(t.TimeMS))
		for i := range sum {
			sum[i] = t.Values[hi][i] + t.Values[lo][i]
		}
		t.add(c.Name, t.Units[hi], true, sum)
	}
	return t, nil
}

func resample(series map[string][]sample, hz int) (*Table, error) {
	t := &Table{}
	if len(series) == 0 {
		return t, nil
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

	if rows := (end-start)/step + 1; rows > maxRows {
		return nil, fmt.Errorf("the log spans %.1f hours, too long to resample at %d Hz (bad timestamps?)", (end-start)/3.6e6, hz)
	}
	for x := start; x < end+step; x += step {
		t.TimeMS = append(t.TimeMS, x)
	}
	for _, name := range t.Columns {
		t.Values = append(t.Values, interpolate(series[name], t.TimeMS))
		t.Units = append(t.Units, "")
		t.Precise = append(t.Precise, false)
	}
	return t, nil
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

func formatTableValue(v float64, precise bool) string {
	if precise {
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return strconv.FormatFloat(float64(float32(v)), 'f', -1, 32)
}

func WriteTableCSV(w io.Writer, t *Table) error {
	bw := bufio.NewWriter(w)
	bw.WriteString("timestamp_ms")
	for _, c := range t.Columns {
		bw.WriteByte(',')
		bw.WriteString(csvField(c))
	}
	bw.WriteByte('\n')
	for i, ts := range t.TimeMS {
		bw.WriteString(strconv.FormatFloat(ts, 'f', -1, 64))
		for c := range t.Columns {
			bw.WriteByte(',')
			bw.WriteString(formatTableValue(t.Values[c][i], t.Precise[c]))
		}
		bw.WriteByte('\n')
	}
	return bw.Flush()
}

func csvField(s string) string {
	if strings.ContainsAny(s, ",\"\n") {
		return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
	}
	return s
}

type Converted struct {
	CSV        string
	Normalized string
	Table      *Table
}

func Convert(binPath string, opts Options) (*Converted, error) {
	in, err := os.Open(binPath)
	if err != nil {
		return nil, err
	}
	log, err := Decode(in)
	in.Close()
	if err != nil {
		return nil, fmt.Errorf("%s: %w", binPath, err)
	}
	applyRename(log, opts.Rename)
	table, err := Normalize(log, opts)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", binPath, err)
	}

	base := strings.TrimSuffix(binPath, ".bin")
	c := &Converted{CSV: base + ".csv", Normalized: base + "_Normalized.csv", Table: table}
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
