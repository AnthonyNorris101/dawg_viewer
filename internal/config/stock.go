package config

import (
	"compress/gzip"
	"embed"
	"errors"
	"io"
	"os"
	"path/filepath"
)

//go:embed stock
var stock embed.FS

const (
	SampleLogName  = "Run-1 sample.csv"
	sampleEmbedded = "stock/run-1-sample.csv.gz"
	sampleOffered  = "offered_sample.txt"
)

func StockCar() Car {
	b, err := stock.ReadFile("stock/car.yaml")
	if err != nil {
		return Car{}
	}
	c, err := ParseCar(b)
	if err != nil {
		return Car{}
	}
	return c
}

func StockSetup() string {
	b, err := stock.ReadFile("stock/setup.json")
	if err != nil {
		return ""
	}
	return string(b)
}

func SamplePath(dir string, s Settings) string {
	p := filepath.Join(ResolvePath(dir, s.LogsDir), SampleLogName)
	if _, err := os.Stat(p); err != nil {
		return ""
	}
	return p
}

func seedSample(dir string) error {
	marker := filepath.Join(dir, "cache", sampleOffered)
	if _, err := os.Stat(marker); err == nil {
		return nil
	}
	s, _ := LoadSettings(dir)
	logs := ResolvePath(dir, s.LogsDir)
	dst := filepath.Join(logs, SampleLogName)
	if _, err := os.Stat(dst); errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(logs, 0o755); err != nil {
			return err
		}
		if err := writeSample(dst); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(filepath.Dir(marker), 0o755); err != nil {
		return err
	}
	return os.WriteFile(marker, []byte(SampleLogName+"\n"), 0o644)
}

func writeSample(dst string) error {
	src, err := stock.Open(sampleEmbedded)
	if err != nil {
		return err
	}
	defer src.Close()
	zr, err := gzip.NewReader(src)
	if err != nil {
		return err
	}
	defer zr.Close()
	tmp := dst + ".part"
	out, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, zr); err != nil {
		out.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}
