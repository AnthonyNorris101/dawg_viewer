package logfile

import (
	"bytes"
	"encoding/binary"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func espCRC32LE(crc uint32, data []byte) uint32 {
	crc = ^crc
	for _, b := range data {
		crc ^= uint32(b)
		for i := 0; i < 8; i++ {
			if crc&1 != 0 {
				crc = crc>>1 ^ 0xEDB88320
			} else {
				crc >>= 1
			}
		}
	}
	return ^crc
}

func firmwareFrame(entries []LogEntry) []byte {
	buf, codeIdx, code := []byte{0}, 0, byte(1)
	add := func(b byte) {
		if b != 0 {
			buf = append(buf, b)
			code++
			if code != 0xFF {
				return
			}
		}
		buf[codeIdx] = code
		codeIdx = len(buf)
		buf = append(buf, 0)
		code = 1
	}

	crc := uint32(0xFFFFFFFF)
	for _, e := range entries {
		raw := binary.LittleEndian.AppendUint32(nil, e.TimeStampMS)
		raw = append(raw, e.ID)
		raw = binary.LittleEndian.AppendUint32(raw, math.Float32bits(e.Value))
		crc = espCRC32LE(crc, raw)
		for _, b := range raw {
			add(b)
		}
	}
	for _, b := range binary.LittleEndian.AppendUint32(nil, crc^0xFFFFFFFF) {
		add(b)
	}
	buf[codeIdx] = code
	return append(buf, 0x00)
}

func header(names map[uint8]string) []byte {
	b := binary.LittleEndian.AppendUint32(nil, MAGIC)
	b = append(b, VERSION, byte(len(names)))
	for id, n := range names {
		b = append(b, id, byte(len(n)))
		b = append(b, n...)
	}
	return b
}

func entries(n int, start uint32) []LogEntry {
	out := make([]LogEntry, n)
	for i := range out {
		out[i] = LogEntry{TimeStampMS: start + uint32(i), ID: uint8(11 + i%2), Value: float32(i) * 1.5}
	}
	return out
}

func TestDecodesFirmwareFrames(t *testing.T) {
	full, partial := entries(56, 0), entries(10, 1000)
	file := header(map[uint8]string{11: "RPM", 12: "CLT1"})
	file = append(file, firmwareFrame(full)...)
	file = append(file, firmwareFrame(partial)...)

	log, err := Decode(bytes.NewReader(file))
	if err != nil {
		t.Fatal(err)
	}
	want := append(full, partial...)
	if len(log.Entries) != len(want) {
		t.Fatalf("got %d entries, want %d", len(log.Entries), len(want))
	}
	for i := range want {
		if log.Entries[i] != want[i] {
			t.Fatalf("entry %d: got %+v, want %+v", i, log.Entries[i], want[i])
		}
	}
}

func TestSkipsCorruptFrame(t *testing.T) {
	bad := firmwareFrame(entries(5, 0))
	bad[3] ^= 0x40
	file := append(header(map[uint8]string{11: "RPM"}), bad...)
	file = append(file, firmwareFrame(entries(5, 100))...)

	log, err := Decode(bytes.NewReader(file))
	if err != nil {
		t.Fatal(err)
	}
	if len(log.Entries) != 5 || log.Entries[0].TimeStampMS != 100 {
		t.Fatalf("entries %+v", log.Entries)
	}
}

func TestBinToCSV(t *testing.T) {
	bin := filepath.Join(t.TempDir(), "2026-10-16_12-00-00_data3.bin")
	src := append(header(map[uint8]string{11: "RPM"}), firmwareFrame(entries(3, 0))...)
	if err := os.WriteFile(bin, src, 0o644); err != nil {
		t.Fatal(err)
	}

	csvPath, _, err := BinToCSV(bin)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(csvPath)
	want := "timestamp_ms,id,signal,value\n0,11,RPM,0\n1,12,UNKNOWN_12,1.5\n2,11,RPM,3\n"
	if string(got) != want {
		t.Fatalf("csv:\n%s", got)
	}
	if after, _ := os.ReadFile(bin); !bytes.Equal(after, src) {
		t.Fatal("the .bin file was changed")
	}
}
