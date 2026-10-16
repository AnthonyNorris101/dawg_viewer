package logfile

import (
	"bytes"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEncodeMatchesFirmware(t *testing.T) {
	names := map[uint8]string{11: "RPM", 12: "CLT1"}
	es := entries(130, 0)
	got := Encode(names, es)

	var frames []byte
	for rest := es; len(rest) > 0; {
		n := min(56, len(rest))
		frames = append(frames, firmwareFrame(rest[:n])...)
		rest = rest[n:]
	}
	if !bytes.HasSuffix(got, frames) || len(got)-len(frames) != len(header(names)) {
		t.Fatal("frames differ from what the firmware writes")
	}
	log, err := Decode(bytes.NewReader(got))
	if err != nil || len(log.Entries) != 130 || log.Names[12] != "CLT1" {
		t.Fatalf("round trip: %+v, %v", log, err)
	}
}

func column(t *testing.T, tab *Table, name string) []float64 {
	t.Helper()
	if i := tab.column(name); i >= 0 {
		return tab.Values[i]
	}
	t.Fatalf("no column %q in %v", name, tab.Columns)
	return nil
}

func near(t *testing.T, what string, got []float64, want ...float64) {
	t.Helper()
	for i := range want {
		if math.Abs(got[i]-want[i]) > 1e-9 {
			t.Fatalf("%s: got %v, want %v", what, got, want)
		}
	}
}

func TestNormalizeInterpolatesOnAGrid(t *testing.T) {
	log := &Log{
		Names: map[uint8]string{1: "A", 2: "B", 3: "Dup", 4: "Dup"},
		Entries: []LogEntry{
			{1000, 1, 0}, {1020, 1, 20}, {1005, 2, 5}, {1013, 3, 1}, {1013, 4, 2},
			{1020, 2, 7}, {1020, 2, 9},
		},
	}
	tab, err := Normalize(log, Options{Hz: 100})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(tab.Columns, ",") != "A,B,Dup_3,Dup_4" {
		t.Fatalf("columns %v", tab.Columns)
	}
	near(t, "time", tab.TimeMS, 1000, 1010, 1020)
	near(t, "A", column(t, tab, "A"), 0, 10, 20)
	near(t, "B", column(t, tab, "B"), 5, 5+4.0/3, 9)
	near(t, "Dup_3", column(t, tab, "Dup_3"), 1, 1, 1)
}

func TestNormalizeCalibratesAndCombines(t *testing.T) {
	log := &Log{
		Names: map[uint8]string{36: "RadTemp", 110: "PosLat_H", 111: "PosLat_L"},
		Entries: []LogEntry{
			{0, 36, 100}, {0, 110, 33.948}, {0, 111, 0.0000018},
			{10, 36, 200}, {10, 110, 33.948}, {10, 111, 0.0000036},
		},
	}
	tab, err := Normalize(log, Options{
		Hz:        100,
		Calibrate: map[string]func(float64) float64{"RadTemp": func(v float64) float64 { return v / 10 }},
		Combine:   []Combine{{Name: "PosLat", Hi: "PosLat_H", Lo: "PosLat_L"}, {Name: "Missing", Hi: "X", Lo: "Y"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	near(t, "RadTemp", column(t, tab, "RadTemp"), 10, 20)
	lat := column(t, tab, "PosLat")
	if want := float64(float32(33.948)) + float64(float32(0.0000018)); lat[0] != want {
		t.Fatalf("PosLat = %v, want %v", lat[0], want)
	}
	if strings.Join(tab.Columns, ",") != "PosLat,PosLat_H,PosLat_L,RadTemp" {
		t.Fatalf("columns %v", tab.Columns)
	}

	var csv bytes.Buffer
	if err := WriteTableCSV(&csv, tab); err != nil {
		t.Fatal(err)
	}
	row := strings.Split(strings.Split(csv.String(), "\n")[1], ",")
	if row[1] != "33.948001861572266" && !strings.HasPrefix(row[1], "33.94800") {
		t.Fatalf("PosLat written as %q", row[1])
	}
	if len(row[1]) < 12 {
		t.Fatalf("PosLat lost precision: %q", row[1])
	}
	if row[2] != "33.948" || row[4] != "10" {
		t.Fatalf("row %v", row)
	}
}

func TestNormalizeRejectsHugeSpans(t *testing.T) {
	log := &Log{Names: map[uint8]string{1: "A"}, Entries: []LogEntry{{0, 1, 1}, {4_000_000_000, 1, 2}}}
	if _, err := Normalize(log, Options{Hz: 100}); err == nil || !strings.Contains(err.Error(), "too long") {
		t.Fatalf("expected a span error, got %v", err)
	}
}

func TestConvertWritesBothCSVs(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "x_data1.bin")
	os.WriteFile(bin, Encode(map[uint8]string{11: "RPM", 113: "PosLat_L"}, []LogEntry{{0, 11, 1}, {10, 113, 2.25}, {20, 11, 3}}), 0o644)

	c, err := Convert(bin, Options{Rename: map[uint8]string{113: "PosLong_L"}})
	if err != nil {
		t.Fatal(err)
	}
	long, _ := os.ReadFile(c.CSV)
	norm, _ := os.ReadFile(c.Normalized)
	if !strings.Contains(string(long), "10,113,PosLong_L,2.25\n") {
		t.Fatalf("long csv:\n%s", long)
	}
	if want := "timestamp_ms,PosLong_L,RPM\n0,2.25,1\n10,2.25,2\n20,2.25,3\n"; string(norm) != want {
		t.Fatalf("normalized:\n%s", norm)
	}
}

func TestLoadAppliesOptionsToRawLogsOnly(t *testing.T) {
	opts := Options{Hz: 100, Calibrate: map[string]func(float64) float64{"RPM": func(v float64) float64 { return v * 2 }}}
	dir := t.TempDir()

	bin := filepath.Join(dir, "a.bin")
	os.WriteFile(bin, Encode(map[uint8]string{11: "RPM"}, []LogEntry{{0, 11, 10}, {10, 11, 20}}), 0o644)
	tab, src, err := Load(bin, opts)
	if err != nil || src != SourceBin {
		t.Fatalf("bin: %v %v", src, err)
	}
	near(t, "bin RPM", column(t, tab, "RPM"), 20, 40)

	tab, src, err = LoadCSV(strings.NewReader("timestamp_ms,id,signal,value\n0,11,RPM,10\n10,11,RPM,20\n"), opts)
	if err != nil || src != SourceLong {
		t.Fatalf("long: %v %v", src, err)
	}
	near(t, "long RPM", column(t, tab, "RPM"), 20, 40)

	tab, src, err = LoadCSV(strings.NewReader("timestamp_ms,RPM\n0,10\n10,20\n"), opts)
	if err != nil || src != SourceWide {
		t.Fatalf("wide: %v %v", src, err)
	}
	near(t, "wide RPM", column(t, tab, "RPM"), 10, 20)
}

func TestLoadCSVFormats(t *testing.T) {
	cases := map[string]struct {
		in      string
		columns string
		units   string
		times   []float64
		first   float64
	}{
		"normalized": {
			in:      "timestamp_ms,RPM,TPS\n2743,785.5,1\n2753,786,2\n",
			columns: "RPM,TPS", units: ",", times: []float64{2743, 2753}, first: 785.5},
		"long from the old app": {
			in:      "timestamp_ms,id,signal_name,value\n0,11,RPM,1.0\n10,11,RPM,3.0\n",
			columns: "RPM", units: "", times: []float64{0, 10}, first: 1},
		"seconds, gaps, text column": {
			in:      "timestamp,source,RPM,VSS\n3838.811,CAN,,1\n3842.981,CAN,0,\n",
			columns: "RPM,VSS", units: ",", times: []float64{3838811, 3842981}, first: 0},
		"tabs, units row, epoch ms": {
			in:      "Time\tsource\tRPM\ns\t\trpm\n1762640265216.000\t10000000\t8214\n1762640265226.000\t10000000\t8220\n",
			columns: "source,RPM", units: ",rpm", times: []float64{1762640265216, 1762640265226}, first: 10000000},
		"iso timestamps": {
			in:      "timestamp,RPM,Brake\n2025-09-11T20:35:59.248803,3210.0,\n2025-09-11T20:35:59.348803,3218.0,\n",
			columns: "RPM", units: "", first: 3210},
		"semicolons and decimal commas": {
			in:      "time;Oil Temp;Speed\n0,5;90,25;12\n1,0;91,5;13\n",
			columns: "Oil Temp,Speed", units: ",", times: []float64{500, 1000}, first: 90.25},
		"duplicate and empty names": {
			in:      "t,RPM,RPM,\n0,1,2,3\n1,4,5,6\n",
			columns: "RPM,RPM (2),Column 4", units: ",,", times: []float64{0, 1000}, first: 1},
		"byte order mark": {
			in:      "\uFEFFtimestamp_ms,RPM\n0,1\n10,2\n",
			columns: "RPM", units: "", times: []float64{0, 10}, first: 1},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			tab, _, err := LoadCSV(strings.NewReader(tc.in), Options{Hz: 100})
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.Join(tab.Columns, ","); got != tc.columns {
				t.Fatalf("columns %q, want %q", got, tc.columns)
			}
			if got := strings.Join(tab.Units, ","); got != tc.units {
				t.Fatalf("units %q, want %q", got, tc.units)
			}
			if tc.times != nil {
				near(t, "time", tab.TimeMS, tc.times...)
			}
			if tab.Values[0][0] != tc.first {
				t.Fatalf("first value %v", tab.Values[0][0])
			}
			for _, col := range tab.Values {
				for _, v := range col {
					if math.IsNaN(v) {
						t.Fatalf("gap left in %v", col)
					}
				}
			}
		})
	}
}

func TestLoadCSVErrors(t *testing.T) {
	for name, in := range map[string]string{
		"empty":       "",
		"one column":  "time\n1\n2\n",
		"no numbers":  "time,name\n1,a\n2,b\n",
		"no times":    "time,RPM\nx,1\ny,2\n",
		"long, empty": "timestamp_ms,id,signal,value\n",
	} {
		if _, _, err := LoadCSV(strings.NewReader(in), Options{}); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestTabsWithEmptyCellsKeepTheirColumns(t *testing.T) {
	tab, _, err := LoadCSV(strings.NewReader("t\tA\tB\tC\n0\t\t2\t3\n1\t1\t\t3\n"), Options{})
	if err != nil {
		t.Fatal(err)
	}
	near(t, "A", column(t, tab, "A"), 1, 1)
	near(t, "B", column(t, tab, "B"), 2, 2)
	near(t, "C", column(t, tab, "C"), 3, 3)
}

func TestLoadCSVDropsRowsOnAnotherClock(t *testing.T) {
	in := "timestamp,RPM\n3838.8,1\n3839.9,2\n"
	for i := 0; i < 20; i++ {
		in += fmt.Sprintf("%d,%d\n", 1762640265216+i*10, 100+i)
	}
	in += "4.77675E+11,99\n1762623237000,98\n"

	tab, _, err := LoadCSV(strings.NewReader(in), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(tab.TimeMS) != 20 || tab.TimeMS[0] != 1762640265216 || tab.TimeMS[19] != 1762640265406 {
		t.Fatalf("time %v", tab.TimeMS)
	}
	near(t, "RPM", column(t, tab, "RPM"), 100, 101, 102)
	if tab.Note != "skipped 4 rows whose time didn't fit the rest of the file" {
		t.Fatalf("note %q", tab.Note)
	}
}

func TestLoadCSVKeepsShortFiles(t *testing.T) {
	tab, _, err := LoadCSV(strings.NewReader("t,A\n0,1\n0.01,2\n30,3\n"), Options{})
	if err != nil || len(tab.TimeMS) != 3 || tab.Note != "" {
		t.Fatalf("%v %v %q", tab, err, tab.Note)
	}
}

func TestLoadCSVFallsBackToRowOrderForUselessTimes(t *testing.T) {
	in := "Time\tRPM\n"
	for i := 0; i < 300; i++ {
		ts := "1762640265216.000"
		if i%10 == 0 {
			ts = "1762640003072.000"
		}
		in += fmt.Sprintf("%s\t%d\n", ts, i)
	}
	tab, _, err := LoadCSV(strings.NewReader(in), Options{})
	if err != nil {
		t.Fatal(err)
	}
	if len(tab.TimeMS) != 300 || tab.TimeMS[1] != 1000 || column(t, tab, "RPM")[299] != 299 {
		t.Fatalf("rows %d, time[1] %v", len(tab.TimeMS), tab.TimeMS[1])
	}
	if !strings.Contains(tab.Note, "only 2 different values") {
		t.Fatalf("note %q", tab.Note)
	}
}
