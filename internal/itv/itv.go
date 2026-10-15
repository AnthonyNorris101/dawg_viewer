package itv

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

const (
	TypeName   uint8 = 0x00
	TypeU8     uint8 = 0x01
	TypeU16    uint8 = 0x02
	TypeU32    uint8 = 0x03
	TypeF32    uint8 = 0x04
	TypeString uint8 = 0x05
	TypeBool   uint8 = 0x06
	TypeCmd    uint8 = 0x07
	TypeU64    uint8 = 0x08
)

var fixedSize = [...]int{
	TypeU8:   1,
	TypeU16:  2,
	TypeU32:  4,
	TypeF32:  4,
	TypeBool: 1,
	TypeCmd:  1,
	TypeU64:  8,
}

type Field struct {
	ID   uint8
	Type uint8

	Num float64

	Int uint64

	Str string
}

func (f Field) IsText() bool { return f.Type == TypeName || f.Type == TypeString }

var (
	ErrTruncated   = errors.New("itv: truncated field")
	ErrUnknownType = errors.New("itv: unknown type")
)

func Decode(b []byte) ([]Field, error) {
	fields := make([]Field, 0, len(b)/6)
	i := 0
	for i+2 <= len(b) {
		id, t := b[i], b[i+1]
		i += 2

		if t == TypeName || t == TypeString {
			if i >= len(b) {
				return fields, fmt.Errorf("%w: id %d string length", ErrTruncated, id)
			}
			n := int(b[i])
			i++
			if i+n > len(b) {
				return fields, fmt.Errorf("%w: id %d string body", ErrTruncated, id)
			}
			fields = append(fields, Field{ID: id, Type: t, Str: string(b[i : i+n])})
			i += n
			continue
		}

		if int(t) >= len(fixedSize) || fixedSize[t] == 0 {
			return fields, fmt.Errorf("%w 0x%02X (id %d)", ErrUnknownType, t, id)
		}
		size := fixedSize[t]
		if i+size > len(b) {
			return fields, fmt.Errorf("%w: id %d needs %d bytes", ErrTruncated, id, size)
		}
		raw := b[i : i+size]
		i += size

		f := Field{ID: id, Type: t}
		switch t {
		case TypeF32:
			f.Num = float64(math.Float32frombits(binary.LittleEndian.Uint32(raw)))
		case TypeBool:
			if raw[0] != 0 {
				f.Int, f.Num = 1, 1
			}
		default:
			switch size {
			case 1:
				f.Int = uint64(raw[0])
			case 2:
				f.Int = uint64(binary.LittleEndian.Uint16(raw))
			case 4:
				f.Int = uint64(binary.LittleEndian.Uint32(raw))
			case 8:
				f.Int = binary.LittleEndian.Uint64(raw)
			}
			f.Num = float64(f.Int)
		}
		fields = append(fields, f)
	}
	return fields, nil
}

func AppendU8(dst []byte, id, v uint8) []byte { return append(dst, id, TypeU8, v) }

func AppendCmd(dst []byte, id, v uint8) []byte { return append(dst, id, TypeCmd, v) }

func AppendBool(dst []byte, id uint8, v bool) []byte {
	var b byte
	if v {
		b = 1
	}
	return append(dst, id, TypeBool, b)
}

func AppendU16(dst []byte, id uint8, v uint16) []byte {
	return binary.LittleEndian.AppendUint16(append(dst, id, TypeU16), v)
}

func AppendU32(dst []byte, id uint8, v uint32) []byte {
	return binary.LittleEndian.AppendUint32(append(dst, id, TypeU32), v)
}

func AppendU64(dst []byte, id uint8, v uint64) []byte {
	return binary.LittleEndian.AppendUint64(append(dst, id, TypeU64), v)
}

func AppendF32(dst []byte, id uint8, v float32) []byte {
	return binary.LittleEndian.AppendUint32(append(dst, id, TypeF32), math.Float32bits(v))
}

func AppendName(dst []byte, id uint8, name string) []byte {
	return appendText(dst, id, TypeName, name)
}

func AppendString(dst []byte, id uint8, s string) []byte {
	return appendText(dst, id, TypeString, s)
}

func appendText(dst []byte, id, t uint8, s string) []byte {
	if len(s) > 255 {
		s = s[:255]
	}
	dst = append(dst, id, t, uint8(len(s)))
	return append(dst, s...)
}
