package calib

import (
	"math"
	"testing"
)

// The RadTemp points hard-coded in the Python app must map back onto
// themselves, and a mid-range reading must land between its neighbours.
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

// Same inputs as Calibration_Helpers.py's __main__. The expected values were
// computed independently with Cramer's rule on the same equations.
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
