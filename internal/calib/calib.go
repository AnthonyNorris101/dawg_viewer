// Package calib converts raw sensor readings to engineering units. The maths
// matches Software/src/Calibration_Helpers.py so constants carry over.
package calib

import (
	"errors"
	"fmt"
	"math"
)

// Converter turns one raw reading into a calibrated value. It returns NaN when
// the reading can't be converted (e.g. an ADC value at the rail).
type Converter func(raw float64) float64

// Linear is value*Mult/Div + Add, the form the firmware uses for CAN signals.
func Linear(mult, div, add float64) (Converter, error) {
	if div == 0 {
		return nil, errors.New("calib: linear div is 0")
	}
	return func(raw float64) float64 { return raw*mult/div + add }, nil
}

// SteinhartPoint is one (ADC reading, temperature °F) calibration pair.
type SteinhartPoint struct{ ADC, TempF float64 }

// Steinhart fits 1/T = a + b·ln(R) + c·ln(R)³ through three points for a
// thermistor read by a divider with a fixed resistor, and returns a converter
// from ADC counts to °F. thermistorToGround matches the Python default (true).
func Steinhart(pts [3]SteinhartPoint, rFixed, adcMax float64, thermistorToGround bool) (Converter, [3]float64, error) {
	toR := func(adc float64) float64 {
		if thermistorToGround {
			if adcMax-adc == 0 {
				return math.NaN()
			}
			return rFixed * adc / (adcMax - adc)
		}
		if adc == 0 {
			return math.NaN()
		}
		return rFixed * (adcMax - adc) / adc
	}

	var a [3][3]float64
	var y [3]float64
	for i, p := range pts {
		r := toR(p.ADC)
		if !(r > 0) {
			return nil, [3]float64{}, fmt.Errorf("calib: point %d (adc %g) gives no usable resistance", i+1, p.ADC)
		}
		l := math.Log(r)
		a[i] = [3]float64{1, l, l * l * l}
		y[i] = 1 / ((p.TempF + 459.67) * 5 / 9) // °F → K
	}
	coef, err := solve3(a, y)
	if err != nil {
		return nil, coef, err
	}

	conv := func(adc float64) float64 {
		l := math.Log(toR(adc))
		k := 1 / (coef[0] + coef[1]*l + coef[2]*l*l*l)
		return k*9/5 - 459.67 // K → °F
	}
	return conv, coef, nil
}

// solve3 solves a·x = y by Gaussian elimination with partial pivoting.
func solve3(a [3][3]float64, y [3]float64) ([3]float64, error) {
	for col := 0; col < 3; col++ {
		p := col
		for r := col + 1; r < 3; r++ {
			if math.Abs(a[r][col]) > math.Abs(a[p][col]) {
				p = r
			}
		}
		if math.Abs(a[p][col]) < 1e-300 {
			return [3]float64{}, errors.New("calib: calibration points are degenerate")
		}
		a[col], a[p] = a[p], a[col]
		y[col], y[p] = y[p], y[col]
		for r := col + 1; r < 3; r++ {
			f := a[r][col] / a[col][col]
			for c := col; c < 3; c++ {
				a[r][c] -= f * a[col][c]
			}
			y[r] -= f * y[col]
		}
	}
	var x [3]float64
	for r := 2; r >= 0; r-- {
		s := y[r]
		for c := r + 1; c < 3; c++ {
			s -= a[r][c] * x[c]
		}
		x[r] = s / a[r][r]
	}
	return x, nil
}
