package logfile

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"math"
	"os"
	"strings"
)

const (
	MAGIC   = 0xDEADBEEF
	VERSION = 2

	entrySize = 9
	crcSize   = 4
)

type LogEntry struct {
	TimeStampMS uint32
	ID          uint8
	Value       float32
}

type Log struct {
	Names   map[uint8]string
	Entries []LogEntry
}

func BinToCSV(binPath string) (string, *Log, error) {
	in, err := os.Open(binPath)
	if err != nil {
		return "", nil, err
	}
	defer in.Close()

	log, err := Decode(in)
	if err != nil {
		return "", nil, fmt.Errorf("%s: %w", binPath, err)
	}

	csvPath := strings.TrimSuffix(binPath, ".bin") + ".csv"
	out, err := os.Create(csvPath)
	if err != nil {
		return "", nil, err
	}
	if err := WriteCSV(out, log); err != nil {
		out.Close()
		return "", nil, err
	}
	return csvPath, log, out.Close()
}

func Decode(r io.Reader) (*Log, error) {
	br := bufio.NewReader(r)

	var hdr struct {
		Magic      uint32
		Version    uint8
		NumSignals uint8
	}
	if err := binary.Read(br, binary.LittleEndian, &hdr); err != nil {
		return nil, fmt.Errorf("reading header: %w", err)
	}
	if hdr.Magic != MAGIC || hdr.Version != VERSION {
		return nil, fmt.Errorf("not a version %d log (magic 0x%08X, version %d)", VERSION, hdr.Magic, hdr.Version)
	}

	log := &Log{Names: map[uint8]string{}}
	for i := 0; i < int(hdr.NumSignals); i++ {
		var idLen [2]byte
		if _, err := io.ReadFull(br, idLen[:]); err != nil {
			return nil, err
		}
		name := make([]byte, idLen[1])
		if _, err := io.ReadFull(br, name); err != nil {
			return nil, err
		}
		log.Names[idLen[0]] = string(name)
	}

	for {
		frame, err := br.ReadBytes(0x00)
		frame = bytes.TrimSuffix(frame, []byte{0x00})
		if len(frame) > 0 {
			log.Entries = append(log.Entries, decodeFrame(frame)...)
		}
		if errors.Is(err, io.EOF) {
			return log, nil
		}
		if err != nil {
			return nil, err
		}
	}
}

func decodeFrame(frame []byte) []LogEntry {
	payload := cobsDecode(frame)
	if len(payload) < crcSize {
		return nil
	}
	data := payload[:len(payload)-crcSize]
	crc := binary.LittleEndian.Uint32(payload[len(data):])
	if len(data)%entrySize != 0 || crc != ^crc32.Update(0xFFFFFFFF, crc32.IEEETable, data) {
		return nil
	}

	entries := make([]LogEntry, 0, len(data)/entrySize)
	for off := 0; off < len(data); off += entrySize {
		b := data[off : off+entrySize]
		entries = append(entries, LogEntry{
			TimeStampMS: binary.LittleEndian.Uint32(b[0:4]),
			ID:          b[4],
			Value:       math.Float32frombits(binary.LittleEndian.Uint32(b[5:9])),
		})
	}
	return entries
}

func cobsDecode(in []byte) []byte {
	out := make([]byte, 0, len(in))
	for i := 0; i < len(in); {
		code := int(in[i])
		if code == 0 || i+code > len(in) {
			return nil
		}
		out = append(out, in[i+1:i+code]...)
		i += code
		if code < 0xFF && i < len(in) {
			out = append(out, 0)
		}
	}
	return out
}

func WriteCSV(w io.Writer, log *Log) error {
	bw := bufio.NewWriter(w)
	fmt.Fprintln(bw, "timestamp_ms,id,signal,value")
	for _, e := range log.Entries {
		name, ok := log.Names[e.ID]
		if !ok {
			name = fmt.Sprintf("UNKNOWN_%d", e.ID)
		}
		fmt.Fprintf(bw, "%d,%d,%s,%.4f\n", e.TimeStampMS, e.ID, name, e.Value)
	}
	return bw.Flush()
}
