package logfile

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestRecordingLoadsLikeAConvertedLog(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "logs")
	r, err := CreateRecording(dir, "live.csv")
	if err != nil {
		t.Fatal(err)
	}
	for i, v := range []float32{1000, 2000, 3000} {
		if err := r.Write(LogEntry{TimeStampMS: uint32(i * 10), ID: 11, Value: v}, "RPM"); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.Write(LogEntry{TimeStampMS: 20, ID: 28, Value: 0.5}, "Brake, front"); err != nil {
		t.Fatal(err)
	}
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}

	tab, source, err := Load(r.Path(), Options{Hz: 100})
	if err != nil || source != SourceLong {
		t.Fatalf("Load: %v, source %q", err, source)
	}
	if len(tab.TimeMS) != 3 || tab.Columns[0] != "Brake, front" || tab.Columns[1] != "RPM" || tab.Values[1][2] != 3000 {
		t.Fatalf("table: %+v", tab)
	}

	if _, err := CreateRecording(dir, "live.csv"); !errors.Is(err, os.ErrExist) {
		t.Fatalf("second CreateRecording with the same name: %v, want ErrExist", err)
	}
}
