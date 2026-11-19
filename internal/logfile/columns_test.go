package logfile

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"testing"
)

func materializeColumns(tab *Table) []byte {
	blob := make([]byte, 0, tab.ColumnBytes())
	if len(tab.TimeMS) > 0 {
		start := tab.TimeMS[0]
		for _, ms := range tab.TimeMS {
			blob = binary.LittleEndian.AppendUint64(blob, math.Float64bits((ms-start)/1000))
		}
	}
	for _, col := range tab.Values {
		for _, v := range col {
			blob = binary.LittleEndian.AppendUint64(blob, math.Float64bits(v))
		}
	}
	return blob
}

func TestWriteColumnsMatchesMaterializedProtocol(t *testing.T) {
	tab := &Table{Columns: []string{"GPS", "RPM"}, TimeMS: make([]float64, 10000), Values: make([][]float64, 2)}
	for c := range tab.Values {
		tab.Values[c] = make([]float64, len(tab.TimeMS))
		for i := range tab.TimeMS {
			tab.TimeMS[i] = 1_000_000 + float64(i)*10
			tab.Values[c][i] = 33.948 + float64(i+c)/1e7
		}
	}
	tab.Values[0][0] = math.NaN()
	tab.Values[0][1] = math.Inf(1)
	tab.Values[0][2] = math.Copysign(0, -1)
	var out bytes.Buffer
	if err := tab.WriteColumns(&out); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out.Bytes(), materializeColumns(tab)) || int64(out.Len()) != tab.ColumnBytes() {
		t.Fatal("streamed columns differ from the existing Float64 protocol")
	}
	if err := (&Table{}).WriteColumns(io.Discard); err != nil {
		t.Fatal(err)
	}
}

type failedColumnWriter struct{}

func (failedColumnWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

func TestWriteColumnsStopsOnWriteFailure(t *testing.T) {
	tab := &Table{TimeMS: make([]float64, 10000)}
	if err := tab.WriteColumns(failedColumnWriter{}); !errors.Is(err, io.ErrClosedPipe) {
		t.Fatalf("got %v, want closed pipe", err)
	}
}

func BenchmarkColumnTransfer(b *testing.B) {
	for _, rows := range []int{15_000, 100_000, 1_000_000} {
		name := map[int]string{15_000: "5min_50Hz_60ch", 100_000: "100k_60ch", 1_000_000: "1m_60ch"}[rows]
		tab := &Table{TimeMS: make([]float64, rows), Columns: make([]string, 60), Values: make([][]float64, 60)}
		for c := range tab.Values {
			tab.Values[c] = make([]float64, rows)
		}
		for _, streaming := range []bool{false, true} {
			mode := "materialized"
			if streaming {
				mode = "streamed"
			}
			b.Run(name+"/"+mode, func(b *testing.B) {
				b.ReportAllocs()
				b.SetBytes(tab.ColumnBytes())
				for b.Loop() {
					if streaming {
						if err := tab.WriteColumns(io.Discard); err != nil {
							b.Fatal(err)
						}
					} else {
						_, _ = io.Discard.Write(materializeColumns(tab))
					}
				}
			})
		}
	}
}
