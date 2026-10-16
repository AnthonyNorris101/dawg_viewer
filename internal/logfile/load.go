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

func Load(path string, rename map[uint8]string, hz int) (*Table, error) {
	if strings.EqualFold(filepath.Ext(path), ".bin") {
		f, err := os.Open(path)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		log, err := Decode(f)
		if err != nil {
			return nil, err
		}
		for id, name := range rename {
			if _, ok := log.Names[id]; ok {
				log.Names[id] = name
			}
		}
		return Normalize(log, hz), nil
	}

	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return LoadCSV(f, hz)
}

func LoadCSV(r io.Reader, hz int) (*Table, error) {
	br := bufio.NewReader(r)
	first, err := br.Peek(4096)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, bufio.ErrBufferFull) {
		return nil, err
	}
	line, _, _ := strings.Cut(string(first), "\n")

	cr := csv.NewReader(br)
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true
	cr.TrimLeadingSpace = true
	if strings.Count(line, "\t") > strings.Count(line, ",") {
		cr.Comma = '\t'
	}

	header, err := cr.Read()
	if err != nil {
		return nil, fmt.Errorf("reading header: %w", err)
	}
	for i := range header {
		header[i] = strings.TrimSpace(strings.TrimPrefix(header[i], "\uFEFF"))
	}
	if len(header) < 2 {
		return nil, errors.New("expected a time column and at least one data column")
	}

	if isLong(header) {
		return loadLong(cr, hz)
	}
	return loadWide(cr, header)
}

func isLong(h []string) bool {
	return len(h) >= 4 && strings.EqualFold(h[0], "timestamp_ms") && strings.EqualFold(h[1], "id") &&
		(strings.EqualFold(h[2], "signal") || strings.EqualFold(h[2], "signal_name")) && strings.EqualFold(h[3], "value")
}

func loadLong(cr *csv.Reader, hz int) (*Table, error) {
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
	return Normalize(log, hz), nil
}

func loadWide(cr *csv.Reader, header []string) (*Table, error) {
	var times []float64
	cols := make([][]float64, len(header)-1)
	numeric := make([]bool, len(header)-1)
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
		t, iso, ok := parseTime(strings.TrimSpace(rec[0]))
		if !ok {
			continue
		}
		isoTime = isoTime || iso
		times = append(times, t)
		for c := range cols {
			v := math.NaN()
			if c+1 < len(rec) {
				if f, err := strconv.ParseFloat(strings.TrimSpace(rec[c+1]), 64); err == nil {
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

	scale := 1000.0
	if isoTime || strings.Contains(strings.ToLower(header[0]), "ms") || times[0] > 1e11 {
		scale = 1
	}
	order := make([]int, len(times))
	for i := range order {
		order[i] = i
	}
	sort.SliceStable(order, func(a, b int) bool { return times[order[a]] < times[order[b]] })

	t := &Table{TimeMS: make([]float64, len(times))}
	for i, o := range order {
		t.TimeMS[i] = times[o] * scale
	}
	for c, name := range header[1:] {
		if !numeric[c] {
			continue
		}
		vals := make([]float64, len(order))
		for i, o := range order {
			vals[i] = cols[c][o]
		}
		fillGaps(vals)
		t.Columns = append(t.Columns, name)
		t.Values = append(t.Values, vals)
	}
	if len(t.Columns) == 0 {
		return nil, errors.New("no numeric columns")
	}
	return t, nil
}

func parseTime(s string) (float64, bool, bool) {
	if f, err := strconv.ParseFloat(s, 64); err == nil {
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
