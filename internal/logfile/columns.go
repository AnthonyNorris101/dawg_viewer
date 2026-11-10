package logfile

import (
	"encoding/binary"
	"io"
	"math"
)

func (t *Table) ColumnBytes() int64 {
	return int64(len(t.TimeMS)) * int64(len(t.Columns)+1) * 8
}

func (t *Table) WriteColumns(w io.Writer) error {
	var buffer [64 * 1024]byte
	origin := 0.0
	if len(t.TimeMS) > 0 {
		origin = t.TimeMS[0]
	}
	write := func(values []float64, timeColumn bool) error {
		for len(values) > 0 {
			count := min(len(values), len(buffer)/8)
			if timeColumn {
				for i, ms := range values[:count] {
					binary.LittleEndian.PutUint64(buffer[i*8:], math.Float64bits((ms-origin)/1000))
				}
			} else {
				for i, v := range values[:count] {
					binary.LittleEndian.PutUint64(buffer[i*8:], math.Float64bits(v))
				}
			}
			n, err := w.Write(buffer[:count*8])
			if err != nil {
				return err
			}
			if n != count*8 {
				return io.ErrShortWrite
			}
			values = values[count:]
		}
		return nil
	}
	if err := write(t.TimeMS, true); err != nil {
		return err
	}
	for _, col := range t.Values {
		if err := write(col, false); err != nil {
			return err
		}
	}
	return nil
}
