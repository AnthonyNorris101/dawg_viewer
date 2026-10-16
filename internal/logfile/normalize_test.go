package logfile

import (
	"bytes"
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

func TestNormalizeInterpolatesOnAGrid(t *testing.T) {
	log := &Log{
		Names: map[uint8]string{1: "A", 2: "B", 3: "Dup", 4: "Dup"},
		Entries: []LogEntry{
			{1000, 1, 0}, {1020, 1, 20}, {1005, 2, 5}, {1013, 3, 1}, {1013, 4, 2},
			{1020, 2, 7}, {1020, 2, 9},
		},
	}
	tab := Normalize(log, 100)
	if strings.Join(tab.Columns, ",") != "A,B,Dup_3,Dup_4" {
		t.Fatalf("columns %v", tab.Columns)
	}
	wantTime := []float64{1000, 1010, 1020}
	if len(tab.TimeMS) != 3 {
		t.Fatalf("time %v", tab.TimeMS)
	}
	for i := range wantTime {
		if tab.TimeMS[i] != wantTime[i] {
			t.Fatalf("time %v", tab.TimeMS)
		}
	}
	check := func(col string, want ...float64) {
		t.Helper()
		for c, name := range tab.Columns {
			if name != col {
				continue
			}
			for i := range want {
				if math.Abs(tab.Values[c][i]-want[i]) > 1e-9 {
					t.Fatalf("%s: got %v, want %v", col, tab.Values[c], want)
				}
			}
			return
		}
		t.Fatalf("no column %s", col)
	}
	check("A", 0, 10, 20)
	check("B", 5, 5+4.0/3, 9)
	check("Dup_3", 1, 1, 1)
}

func TestConvertWritesBothCSVs(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "x_data1.bin")
	os.WriteFile(bin, Encode(map[uint8]string{11: "RPM", 113: "PosLat_L"}, []LogEntry{{0, 11, 1}, {10, 113, 2}, {20, 11, 3}}), 0o644)

	c, err := Convert(bin, map[uint8]string{113: "PosLong_L"}, 100)
	if err != nil {
		t.Fatal(err)
	}
	long, _ := os.ReadFile(c.CSV)
	norm, _ := os.ReadFile(c.Normalized)
	if !strings.Contains(string(long), "10,113,PosLong_L,2.0000") {
		t.Fatalf("rename not applied:\n%s", long)
	}
	if want := "timestamp_ms,PosLong_L,RPM\n0,2,1\n10,2,2\n20,2,3\n"; string(norm) != want {
		t.Fatalf("normalized:\n%s", norm)
	}
}

func TestLoadCSVFormats(t *testing.T) {
	cases := map[string]struct {
		in       string
		columns  string
		firstMS  float64
		lastMS   float64
		firstVal float64
	}{
		"normalized": {"timestamp_ms,RPM,TPS\n2743,785.5,1\n2753,786,2\n", "RPM,TPS", 2743, 2753, 785.5},
		"long":       {"timestamp_ms,id,signal_name,value\n0,11,RPM,1.0\n10,11,RPM,3.0\n", "RPM", 0, 10, 1},
		"seconds with gaps and text": {
			"timestamp,source,RPM,VSS\n3838.811,CAN,,1\n3842.981,CAN,0,\n", "RPM,VSS", 3838811, 3842981, 0},
		"tabs, unit row, epoch ms": {
			"Time\tsource\tRPM\ns\t\t\n1762640265216.000\t10000000\t8214\n1762640265226.000\t10000000\t8220\n",
			"source,RPM", 1762640265216, 1762640265226, 10000000},
		"iso timestamps": {
			"timestamp,RPM,Brake\n2025-09-11T20:35:59.248803,3210.0,\n2025-09-11T20:35:59.348803,3218.0,\n",
			"RPM", 0, 0, 3210},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			tab, err := LoadCSV(strings.NewReader(tc.in), 100)
			if err != nil {
				t.Fatal(err)
			}
			if got := strings.Join(tab.Columns, ","); got != tc.columns {
				t.Fatalf("columns %q, want %q", got, tc.columns)
			}
			if tc.lastMS != 0 && (tab.TimeMS[0] != tc.firstMS || tab.TimeMS[len(tab.TimeMS)-1] != tc.lastMS) {
				t.Fatalf("time %v", tab.TimeMS)
			}
			if name == "iso timestamps" && math.Abs(tab.TimeMS[1]-tab.TimeMS[0]-100) > 1e-6 {
				t.Fatalf("iso time step %v", tab.TimeMS)
			}
			if tab.Values[0][0] != tc.firstVal {
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
