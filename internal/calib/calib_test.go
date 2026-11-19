package calib

import (
	"math"
	"testing"
)

func TestSteinhartRadTemp(t *testing.T) {
	pts := [3]SteinhartPoint{{336, 266}, {999, 176}, {2924, 68}}
	conv, _, err := Steinhart(pts, 1000, 4095, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range pts {
		if got := conv(p.ADC); math.Abs(got-p.TempF) > 1e-6 {
			t.Errorf("adc %g: got %g °F, want %g", p.ADC, got, p.TempF)
		}
	}
	if v := conv(2000); !(v < 176 && v > 68) {
		t.Errorf("adc 2000 gave %g °F, expected between 68 and 176", v)
	}
	if v := conv(4095); !math.IsNaN(v) {
		t.Errorf("adc at the rail should be NaN, got %g", v)
	}
}

func TestSteinhartCoefficientsMatchPython(t *testing.T) {
	_, c, err := Steinhart([3]SteinhartPoint{{3500, 0}, {2200, 25}, {900, 100}}, 1000, 4095, true)
	if err != nil {
		t.Fatal(err)
	}
	want := [3]float64{-0.0005319958009701995, 0.0007756343782961949, -3.4935162902244892e-06}
	for i := range want {
		if math.Abs(c[i]-want[i]) > 1e-12*math.Max(1, math.Abs(want[i]))+1e-15 {
			t.Errorf("coefficient %d: got %.17g, want %.17g", i, c[i], want[i])
		}
	}
}

func TestLinear(t *testing.T) {
	conv, err := Linear(2000, 3276, -250)
	if err != nil {
		t.Fatal(err)
	}
	if got := conv(3276); math.Abs(got-1750) > 1e-9 {
		t.Fatalf("got %g", got)
	}
	if _, err := Linear(1, 0, 0); err == nil {
		t.Fatal("div 0 should fail")
	}
}

func TestPoly(t *testing.T) {
	conv, err := Poly([]float64{1, 2, 3})
	if err != nil {
		t.Fatal(err)
	}
	if got := conv(2); got != 1+4+12 {
		t.Fatalf("poly(2) = %g", got)
	}
	if _, err := Poly(nil); err == nil {
		t.Fatal("empty poly accepted")
	}
}

func TestTable(t *testing.T) {
	conv, err := Table([][2]float64{{1000, 10}, {0, 0}, {2000, 40}})
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range [][2]float64{{0, 0}, {500, 5}, {1000, 10}, {1500, 25}, {2000, 40}, {3000, 70}, {-1000, -10}} {
		if got := conv(c[0]); math.Abs(got-c[1]) > 1e-9 {
			t.Errorf("table(%g) = %g, want %g", c[0], got, c[1])
		}
	}
	if _, err := Table([][2]float64{{1, 1}, {1, 2}}); err == nil {
		t.Fatal("duplicate raw accepted")
	}
}

func TestFitPoly(t *testing.T) {
	want := []float64{-3.5, 0.02, 4e-6}
	var pts [][2]float64
	for x := 300.0; x <= 3800; x += 350 {
		y := want[0] + want[1]*x + want[2]*x*x
		pts = append(pts, [2]float64{x, y})
	}
	got, err := FitPoly(pts, 2)
	if err != nil {
		t.Fatal(err)
	}
	for k := range want {
		if math.Abs(got[k]-want[k]) > 1e-9*math.Max(1, math.Abs(want[k]))+1e-12 {
			t.Errorf("coeff %d = %g, want %g", k, got[k], want[k])
		}
	}
	line, err := FitPoly([][2]float64{{0, 1}, {1, 3}, {2, 5}, {3, 7.2}}, 1)
	if err != nil || math.Abs(line[1]-2.06) > 1e-9 {
		t.Fatalf("line fit = %v, %v", line, err)
	}
	if _, err := FitPoly(pts[:2], 2); err == nil {
		t.Fatal("underdetermined fit accepted")
	}
}
