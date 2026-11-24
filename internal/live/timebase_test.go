package live

import (
	"math"
	"math/rand"
	"testing"
	"time"

	"dawg_viewer/internal/config"
	"dawg_viewer/internal/itv"
)

func TestTimebaseUndoesNetworkJitter(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	var tb timebase
	const trueOffset = 5.0
	var placed []float64
	for i := 0; i < 500; i++ {
		tx := float64(i) * 0.02
		delay := 0.002 + r.Float64()*0.08
		rx := tx + trueOffset + delay
		got := tb.place(rx, tx)
		if got > rx+1e-12 {
			t.Fatalf("row %d placed after it arrived: %v > %v", i, got, rx)
		}
		placed = append(placed, got)
	}
	for i := 400; i < 500; i++ {
		if d := placed[i] - placed[i-1]; math.Abs(d-0.02) > 0.002 {
			t.Fatalf("spacing at %d = %v, want 0.02 (jitter not removed)", i, d)
		}
		if e := placed[i] - (float64(i)*0.02 + trueOffset); e < 0 || e > 0.003 {
			t.Fatalf("row %d is %v s from its true time", i, e)
		}
	}
}

func TestTimebaseFollowsRestartsAndDrift(t *testing.T) {
	var tb timebase
	tb.place(10, 1000)
	if got := tb.place(10.5, 2); got != 10.5 {
		t.Errorf("after a logger restart got %v, want arrival time 10.5", got)
	}
	var slow timebase
	for i := 0; i <= 600; i++ {
		tx := float64(i)
		rx := tx * (1 + 100e-6)
		if got := slow.place(rx, tx); rx-got > 0.001 {
			t.Fatalf("drift not followed at %d s: lag %v", i, rx-got)
		}
	}
}

func TestLiveRowsUseTheLoggersClock(t *testing.T) {
	_, rec, conn := startTestSession(t, config.Profile{ID: "test"})
	var names []byte
	names = itv.AppendName(names, 0, "Time_tx")
	names = itv.AppendName(names, 11, "RPM")
	conn.Write(names)
	for i := 0; i < 5; i++ {
		conn.Write(itv.AppendF32(itv.AppendF32(nil, 11, float32(6000+i)), 0, float32(1000+20*i)))
	}
	rows := rec.waitRows(t, 5)
	for i := 1; i < 5; i++ {
		if d := rows[i].T - rows[i-1].T; math.Abs(d-0.02) > 1e-6 {
			t.Errorf("rows sent in one burst are %v s apart, want 0.02", d)
		}
	}
	time.Sleep(600 * time.Millisecond)
	rec.mu.Lock()
	timing := rec.status.Timing
	rec.mu.Unlock()
	if timing != "device" {
		t.Errorf("timing = %q, want device", timing)
	}
}

func TestLiveRowsWithoutClockUseArrival(t *testing.T) {
	_, rec, conn := startTestSession(t, config.Profile{ID: "test"})
	conn.Write(itv.AppendName(nil, 11, "RPM"))
	conn.Write(itv.AppendF32(nil, 11, 6000))
	rec.waitRows(t, 1)
	time.Sleep(600 * time.Millisecond)
	rec.mu.Lock()
	timing := rec.status.Timing
	rec.mu.Unlock()
	if timing != "arrival" {
		t.Errorf("timing = %q, want arrival", timing)
	}
}
