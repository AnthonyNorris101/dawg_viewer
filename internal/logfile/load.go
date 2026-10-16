package logfile

import (
	"bufio"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Source string

const (
	SourceBin  Source = "bin"
	SourceLong Source = "long"
	SourceWide Source = "wide"
)

func Load(path string, opts Options) (*Table, Source, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()

	if strings.EqualFold(filepath.Ext(path), ".bin") {
		log, err := Decode(f)
		if err != nil {
			return nil, "", err
		}
		applyRename(log, opts.Rename)
		t, err := Normalize(log, opts)
		return t, SourceBin, err
	}
	return LoadCSV(f, opts)
}

func LoadCSV(r io.Reader, opts Options) (*Table, Source, error) {
	br := bufio.NewReader(r)
	first, err := br.Peek(4096)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, bufio.ErrBufferFull) {
		return nil, "", err
	}
	line, _, _ := strings.Cut(string(first), "\n")

	cr := csv.NewReader(br)
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true
	cr.Comma = detectDelimiter(line)

	header, err := cr.Read()
	if err != nil {
		return nil, "", fmt.Errorf("reading header: %w", err)
	}
	for i := range header {
		header[i] = strings.TrimSpace(strings.TrimPrefix(header[i], "\uFEFF"))
	}
	if len(header) < 2 {
		return nil, "", errors.New("expected a time column and at least one data column")
	}

	if isLong(header) {
		t, err := loadLong(cr, opts)
		return t, SourceLong, err
	}
	t, err := loadWide(cr, header, cr.Comma == ';')
	return t, SourceWide, err
}

func detectDelimiter(line string) rune {
	best, count := ',', strings.Count(line, ",")
	for _, d := range []rune{'\t', ';'} {
		if n := strings.Count(line, string(d)); n > count {
			best, count = d, n
		}
	}
	return best
}

func isLong(h []string) bool {
	return len(h) >= 4 && strings.EqualFold(h[0], "timestamp_ms") && strings.EqualFold(h[1], "id") &&
		(strings.EqualFold(h[2], "signal") || strings.EqualFold(h[2], "signal_name")) && strings.EqualFold(h[3], "value")
}

func loadLong(cr *csv.Reader, opts Options) (*Table, error) {
	log := &Log{Names: map[uint8]string{}}
	for {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(rec) < 4 {
			continue
		}
		ts, err1 := strconv.ParseUint(strings.TrimSpace(rec[0]), 10, 32)
		id, err2 := strconv.ParseUint(strings.TrimSpace(rec[1]), 10, 8)
		v, err3 := strconv.ParseFloat(strings.TrimSpace(rec[3]), 32)
		if err1 != nil || err2 != nil || err3 != nil {
			continue
		}
		log.Names[uint8(id)] = strings.TrimSpace(rec[2])
		log.Entries = append(log.Entries, LogEntry{TimeStampMS: uint32(ts), ID: uint8(id), Value: float32(v)})
	}
	if len(log.Entries) == 0 {
		return nil, errors.New("no data rows")
	}
	return Normalize(log, opts)
}

func uniqueNames(header []string) []string {
	out := make([]string, len(header))
	seen := map[string]int{}
	for i, h := range header {
		if h == "" {
			h = fmt.Sprintf("Column %d", i+1)
		}
		seen[h]++
		if n := seen[h]; n > 1 {
			h = fmt.Sprintf("%s (%d)", h, n)
		}
		out[i] = h
	}
	return out
}

func loadWide(cr *csv.Reader, header []string, decimalComma bool) (*Table, error) {
	names := uniqueNames(header)
	parseNum := func(s string) (float64, bool) {
		s = strings.TrimSpace(s)
		if decimalComma {
			s = strings.Replace(s, ",", ".", 1)
		}
		f, err := strconv.ParseFloat(s, 64)
		return f, err == nil
	}

	var times []float64
	cols := make([][]float64, len(names)-1)
	numeric := make([]bool, len(names)-1)
	var units []string
	isoTime := false

	for {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(rec) == 0 {
			continue
		}
		t, iso, ok := parseTime(strings.TrimSpace(rec[0]), parseNum)
		if !ok {
			if times == nil && units == nil {
				units = rec
			}
			continue
		}
		isoTime = isoTime || iso
		times = append(times, t)
		for c := range cols {
			v := math.NaN()
			if c+1 < len(rec) {
				if f, ok := parseNum(rec[c+1]); ok {
					v = f
					numeric[c] = true
				}
			}
			cols[c] = append(cols[c], v)
		}
	}
	if len(times) == 0 {
		return nil, errors.New("no rows with a readable time in the first column")
	}

	t := &Table{}
	var order []int
	if distinct := countDistinct(times); distinct*100 < len(times) {
		order = make([]int, len(times))
		t.TimeMS = make([]float64, len(times))
		for i := range order {
			order[i] = i
			t.TimeMS[i] = float64(i) * 1000
		}
		t.Note = fmt.Sprintf("the time column has only %d different values, so rows are shown in file order and the time axis counts rows", distinct)
	} else {
		keep, epochMS := consistentTimes(times, isoTime)
		if len(keep) == 0 {
			return nil, errors.New("no rows with a usable time in the first column")
		}
		timeUnit := ""
		if len(units) > 0 {
			timeUnit = strings.ToLower(strings.TrimSpace(units[0]))
		}
		scale := 1000.0
		if isoTime || epochMS || strings.Contains(strings.ToLower(header[0]), "ms") || timeUnit == "ms" {
			scale = 1
		}
		order = keep
		sort.SliceStable(order, func(a, b int) bool { return times[order[a]] < times[order[b]] })
		t.TimeMS = make([]float64, len(order))
		for i, o := range order {
			t.TimeMS[i] = times[o] * scale
		}
		if skipped := len(times) - len(order); skipped > 0 {
			t.Note = fmt.Sprintf("skipped %d rows whose time didn't fit the rest of the file", skipped)
		}
	}
	for c, name := range names[1:] {
		if !numeric[c] {
			continue
		}
		vals := make([]float64, len(order))
		for i, o := range order {
			vals[i] = cols[c][o]
		}
		fillGaps(vals)
		unit := ""
		if c+1 < len(units) {
			unit = strings.TrimSpace(units[c+1])
		}
		t.Columns = append(t.Columns, name)
		t.Units = append(t.Units, unit)
		t.Precise = append(t.Precise, true)
		t.Values = append(t.Values, vals)
	}
	if len(t.Columns) == 0 {
		return nil, errors.New("no numeric columns")
	}
	return t, nil
}

const epochMSThreshold = 1e11

func consistentTimes(times []float64, iso bool) ([]int, bool) {
	big := 0
	for _, t := range times {
		if t > epochMSThreshold {
			big++
		}
	}
	epochMS := !iso && big*2 > len(times)

	var keep []int
	for i, t := range times {
		if iso || (t > epochMSThreshold) == epochMS {
			keep = append(keep, i)
		}
	}
	if len(keep) == 0 {
		return nil, epochMS
	}

	sorted := make([]float64, len(keep))
	for i, k := range keep {
		sorted[i] = times[k]
	}
	sort.Float64s(sorted)
	q1, q3 := sorted[len(sorted)/4], sorted[len(sorted)*3/4]
	minute := 60.0
	if iso || epochMS {
		minute *= 1000
	}
	margin := math.Max(3*(q3-q1), minute)
	out := keep[:0]
	for _, k := range keep {
		if times[k] >= q1-margin && times[k] <= q3+margin {
			out = append(out, k)
		}
	}
	return out, epochMS
}

func parseTime(s string, parseNum func(string) (float64, bool)) (float64, bool, bool) {
	if f, ok := parseNum(s); ok {
		return f, false, true
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.999999999", "2006-01-02 15:04:05.999999999"} {
		if t, err := time.Parse(layout, s); err == nil {
			return float64(t.UnixNano()) / 1e6, true, true
		}
	}
	return 0, false, false
}

func fillGaps(v []float64) {
	last := math.NaN()
	for i := range v {
		if math.IsNaN(v[i]) {
			v[i] = last
		} else {
			last = v[i]
		}
	}
	next := math.NaN()
	for i := len(v) - 1; i >= 0; i-- {
		if math.IsNaN(v[i]) {
			v[i] = next
		} else {
			next = v[i]
		}
	}
}

func countDistinct(v []float64) int {
	seen := make(map[float64]struct{}, 64)
	for _, x := range v {
		seen[x] = struct{}{}
		if len(seen)*100 >= len(v) {
			return len(seen)
		}
	}
	return len(seen)
}
