package live

import "math"

const (
	clockDrift    = 200e-6
	clockBackJump = 2.0
	clockFwdJump  = 60.0
	holdBack      = 0.12
)

type timebase struct {
	have   bool
	offset float64
	lastTx float64
	lastRx float64
}

func (tb *timebase) place(rx, tx float64) float64 {
	d := rx - tx
	if !tb.have || tx < tb.lastTx-clockBackJump || tx > tb.lastTx+clockFwdJump {
		tb.offset = d
		tb.have = true
	} else {
		tb.offset = math.Min(d, tb.offset+clockDrift*math.Max(0, rx-tb.lastRx))
	}
	tb.lastTx, tb.lastRx = tx, rx
	return tx + tb.offset
}
