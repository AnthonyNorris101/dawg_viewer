package logfile

import (
	"encoding/binary"
	"hash/crc32"
	"math"
	"sort"
)

const entriesPerFrame = 56

func Encode(names map[uint8]string, entries []LogEntry) []byte {
	ids := make([]int, 0, len(names))
	for id := range names {
		ids = append(ids, int(id))
	}
	sort.Ints(ids)

	out := binary.LittleEndian.AppendUint32(nil, MAGIC)
	out = append(out, VERSION, byte(len(ids)))
	for _, id := range ids {
		n := names[uint8(id)]
		out = append(out, uint8(id), byte(len(n)))
		out = append(out, n...)
	}

	for len(entries) > 0 {
		n := min(entriesPerFrame, len(entries))
		data := make([]byte, 0, n*entrySize)
		for _, e := range entries[:n] {
			data = binary.LittleEndian.AppendUint32(data, e.TimeStampMS)
			data = append(data, e.ID)
			data = binary.LittleEndian.AppendUint32(data, math.Float32bits(e.Value))
		}
		data = binary.LittleEndian.AppendUint32(data, ^crc32.Update(0xFFFFFFFF, crc32.IEEETable, data))
		out = append(cobsEncode(out, data), 0x00)
		entries = entries[n:]
	}
	return out
}

func cobsEncode(dst, src []byte) []byte {
	codeIdx := len(dst)
	dst = append(dst, 0)
	code := byte(1)
	for _, b := range src {
		if b != 0 {
			dst = append(dst, b)
			code++
			if code != 0xFF {
				continue
			}
		}
		dst[codeIdx] = code
		codeIdx = len(dst)
		dst = append(dst, 0)
		code = 1
	}
	dst[codeIdx] = code
	return dst
}
