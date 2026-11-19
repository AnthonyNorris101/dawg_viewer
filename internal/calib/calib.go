package calib

import (
	"errors"
	"fmt"
	"math"
	"sort"
)

type Converter func(raw float64) float64

func Linear(mult, div, add float64) (Converter, error) {
	if div == 0 {
		return nil, errors.New("calib: linear div is 0")
	}
	return func(raw float64) float64 { return raw*mult/div + add }, nil
}

type SteinhartPoint struct{ ADC, TempF float64 }

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
		y[i] = 1 / ((p.TempF + 459.67) * 5 / 9)
	}
	coef, err := solve3(a, y)
	if err != nil {
		return nil, coef, err
	}

	conv := func(adc float64) float64 {
		l := math.Log(toR(adc))
		k := 1 / (coef[0] + coef[1]*l + coef[2]*l*l*l)
		return k*9/5 - 459.67
	}
	return conv, coef, nil
}

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

func Poly(coeffs []float64) (Converter, error) {
	if len(coeffs) == 0 {
		return nil, errors.New("calib: poly needs at least one coefficient")
	}
	c := append([]float64(nil), coeffs...)
	return func(raw float64) float64 {
		y := 0.0
		for k := len(c) - 1; k >= 0; k-- {
			y = y*raw + c[k]
		}
		return y
	}, nil
}

func Table(points [][2]float64) (Converter, error) {
	if len(points) < 2 {
		return nil, errors.New("calib: table needs at least 2 points")
	}
	pts := append([][2]float64(nil), points...)
	sort.Slice(pts, func(i, j int) bool { return pts[i][0] < pts[j][0] })
	for i := 1; i < len(pts); i++ {
		if pts[i][0] == pts[i-1][0] {
			return nil, fmt.Errorf("calib: table has two points at raw %g", pts[i][0])
		}
	}
	return func(raw float64) float64 {
		i := sort.Search(len(pts), func(i int) bool { return pts[i][0] >= raw })
		i = max(1, min(i, len(pts)-1))
		x0, y0 := pts[i-1][0], pts[i-1][1]
		x1, y1 := pts[i][0], pts[i][1]
		return y0 + (y1-y0)*(raw-x0)/(x1-x0)
	}, nil
}

func FitPoly(points [][2]float64, degree int) ([]float64, error) {
	n := degree + 1
	if degree < 0 || len(points) < n {
		return nil, fmt.Errorf("calib: a degree %d fit needs at least %d points, got %d", degree, n, len(points))
	}
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, p := range points {
		lo, hi = min(lo, p[0]), max(hi, p[0])
	}
	mid, half := (lo+hi)/2, (hi-lo)/2
	if half == 0 {
		half = 1
	}
	a := make([][]float64, n)
	for r := range a {
		a[r] = make([]float64, n+1)
	}
	pow := make([]float64, 2*n)
	for _, p := range points {
		t := (p[0] - mid) / half
		pow[0] = 1
		for k := 1; k < 2*n; k++ {
			pow[k] = pow[k-1] * t
		}
		for r := 0; r < n; r++ {
			for c := 0; c < n; c++ {
				a[r][c] += pow[r+c]
			}
			a[r][n] += pow[r] * p[1]
		}
	}
	for col := 0; col < n; col++ {
		p := col
		for r := col + 1; r < n; r++ {
			if math.Abs(a[r][col]) > math.Abs(a[p][col]) {
				p = r
			}
		}
		if math.Abs(a[p][col]) < 1e-12 {
			return nil, errors.New("calib: fit points are degenerate (too many at the same raw reading)")
		}
		a[col], a[p] = a[p], a[col]
		for r := 0; r < n; r++ {
			if r == col {
				continue
			}
			f := a[r][col] / a[col][col]
			for c := col; c <= n; c++ {
				a[r][c] -= f * a[col][c]
			}
		}
	}
	out := make([]float64, n)
	for m := 0; m < n; m++ {
		c := a[m][n] / a[m][m] / math.Pow(half, float64(m))
		b := 1.0
		for k := 0; k <= m; k++ {
			if k > 0 {
				b = b * float64(m-k+1) / float64(k)
			}
			out[k] += c * b * math.Pow(-mid, float64(m-k))
		}
	}
	return out, nil
}
