package itv

import (
	"errors"
	"math"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	var b []byte
	b = AppendName(b, 11, "RPM")
	b = AppendF32(b, 11, 6512.5)
	b = AppendU8(b, 2, 7)
	b = AppendCmd(b, 1, 3)
	b = AppendU16(b, 3, 0xBEEF)
	b = AppendU32(b, 4, 0xDEADBEEF)
	b = AppendU64(b, 5, math.MaxUint64)
	b = AppendBool(b, 6, true)
	b = AppendString(b, 7, "hello")

	got, err := Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	want := []Field{
		{ID: 11, Type: TypeName, Str: "RPM"},
		{ID: 11, Type: TypeF32, Num: 6512.5},
		{ID: 2, Type: TypeU8, Num: 7, Int: 7},
		{ID: 1, Type: TypeCmd, Num: 3, Int: 3},
		{ID: 3, Type: TypeU16, Num: 0xBEEF, Int: 0xBEEF},
		{ID: 4, Type: TypeU32, Num: 0xDEADBEEF, Int: 0xDEADBEEF},
		{ID: 5, Type: TypeU64, Num: math.MaxUint64, Int: math.MaxUint64},
		{ID: 6, Type: TypeBool, Num: 1, Int: 1},
		{ID: 7, Type: TypeString, Str: "hello"},
	}
	if len(got) != len(want) {
		t.Fatalf("got %d fields, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("field %d: got %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestFirmwareBytes(t *testing.T) {
	got, err := Decode([]byte{0x00, 0x04, 0x00, 0x40, 0x9A, 0x44})
	if err != nil || len(got) != 1 || got[0].Num != 1234 {
		t.Fatalf("f32: %+v %v", got, err)
	}
	cmd := AppendU8(AppendCmd(nil, 1, 3), 2, 0)
	if string(cmd) != "\x01\x07\x03\x02\x01\x00" {
		t.Fatalf("command bytes: % X", cmd)
	}
}

func TestMalformedKeepsEarlierFields(t *testing.T) {
	b := AppendF32(nil, 20, 1.5)
	cases := map[string][]byte{
		"truncated number": append(b, 21, TypeF32, 0x00),
		"truncated string": append(b, 21, TypeName, 9, 'a'),
		"missing length":   append(b, 21, TypeName),
		"unknown type":     append(b, 21, 0x42, 0, 0, 0, 0),
	}
	for name, in := range cases {
		got, err := Decode(in)
		if err == nil {
			t.Errorf("%s: expected an error", name)
		}
		if len(got) != 1 || got[0].ID != 20 || got[0].Num != 1.5 {
			t.Errorf("%s: lost the valid field: %+v", name, got)
		}
	}
	if _, err := Decode(append(b, 21, 0x42)); !errors.Is(err, ErrUnknownType) {
		t.Errorf("want ErrUnknownType, got %v", err)
	}
}

func TestZeroPaddingIsHarmless(t *testing.T) {
	b := make([]byte, 256)
	copy(b, AppendU8(AppendCmd(nil, 1, 3), 2, 0))
	got, err := Decode(b)
	if err != nil {
		t.Fatal(err)
	}
	if got[0].ID != 1 || got[0].Int != 3 {
		t.Fatalf("command lost: %+v", got[0])
	}
	for _, f := range got[2:] {
		if f.ID != 0 || f.Type != TypeName || f.Str != "" {
			t.Fatalf("unexpected padding field %+v", f)
		}
	}
}

func FuzzDecode(f *testing.F) {
	f.Add(AppendName(AppendF32(nil, 1, 2), 3, "x"))
	f.Fuzz(func(t *testing.T, b []byte) { _, _ = Decode(b) })
}
