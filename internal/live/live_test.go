package live

import (
	"context"
	"math"
	"net"
	"sync"
	"testing"
	"time"

	"dawg_viewer/internal/config"
	"dawg_viewer/internal/itv"
)

type recorder struct {
	mu       sync.Mutex
	rows     []Row
	channels []Channel
	status   Status
}

func (r *recorder) Frame(f Frame) {
	r.mu.Lock()
	r.rows = append(r.rows, f.Rows...)
	r.mu.Unlock()
}
func (r *recorder) Status(s Status) { r.mu.Lock(); r.status = s; r.mu.Unlock() }
func (r *recorder) Channels(c []Channel) {
	r.mu.Lock()
	r.channels = c
	r.mu.Unlock()
}

func (r *recorder) waitRows(t *testing.T, n int) []Row {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		if len(r.rows) >= n {
			out := append([]Row(nil), r.rows...)
			r.mu.Unlock()
			return out
		}
		r.mu.Unlock()
		time.Sleep(10 * time.Millisecond)
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	t.Fatalf("timed out waiting for %d rows, have %d", n, len(r.rows))
	return nil
}

func startTestSession(t *testing.T, p config.Profile) (*Session, *recorder, *net.UDPConn) {
	t.Helper()
	p.Telemetry.Listen = "127.0.0.1:0"
	rec := &recorder{}
	s, err := Start(context.Background(), Options{Profile: p, ConfigDir: t.TempDir(), FrameRate: 50}, rec)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Stop)
	dst, err := net.ResolveUDPAddr("udp4", s.Status().Listen)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := net.DialUDP("udp4", nil, dst)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	return s, rec, conn
}

func TestPacketsBecomeRows(t *testing.T) {
	p := config.Profile{
		ID:     "test",
		Rename: map[int]string{113: "PosLong_L"},
		Combine: []config.Combine{
			{Name: "PosLong", Hi: "PosLong_H", Lo: "PosLong_L"},
		},
		Calibrations: map[string]config.Calibration{
			"Brake": {Type: "linear", Mult: 2000, Div: 3276, Add: -250},
		},
	}
	_, rec, conn := startTestSession(t, p)

	var names []byte
	names = itv.AppendName(names, 0, "Time_tx")
	names = itv.AppendName(names, 11, "RPM")
	names = itv.AppendName(names, 28, "Brake")
	names = itv.AppendName(names, 112, "PosLong_H")
	names = itv.AppendName(names, 113, "PosLat_L")
	conn.Write(names)

	conn.Write(itv.AppendU64(itv.AppendU32(itv.AppendCmd(nil, 1, 1), 2, 7), 3, 99))

	var data []byte
	data = itv.AppendF32(data, 77, 1)
	data = itv.AppendF32(data, 11, 6500)
	data = itv.AppendF32(data, 28, 3276)
	data = itv.AppendF32(data, 112, -83.25)
	data = itv.AppendF32(data, 113, 0.0001)
	data = itv.AppendF32(data, 0, 1000)
	conn.Write(data)
	conn.Write(itv.AppendF32(itv.AppendF32(nil, 11, 6600), 0, 1020))

	rows := rec.waitRows(t, 2)
	first := rows[0].V
	if first["RPM"] != 6500 {
		t.Errorf("RPM = %v (packet with an unknown id was dropped?)", first["RPM"])
	}
	if math.Abs(first["Brake"]-1750) > 1e-3 {
		t.Errorf("Brake calibration: got %v, want 1750", first["Brake"])
	}
	if _, wrong := first["PosLat_L"]; wrong {
		t.Error("rename by id not applied")
	}
	if got, want := first["PosLong"], float64(float32(-83.25))+float64(float32(0.0001)); got != want {
		t.Errorf("PosLong = %v, want %v", got, want)
	}
	if _, ok := first["Time_rx"]; !ok {
		t.Error("Time_rx missing")
	}
	second := rows[1].V
	if second["TX_INT"] != 20 {
		t.Errorf("TX_INT = %v, want 20", second["TX_INT"])
	}
	if _, ok := second["RX_INT"]; !ok {
		t.Error("RX_INT missing")
	}

	time.Sleep(600 * time.Millisecond)
	rec.mu.Lock()
	st := rec.status
	nch := len(rec.channels)
	rec.mu.Unlock()
	if len(st.UnknownIDs) != 1 || st.UnknownIDs[0] != 77 {
		t.Errorf("unknown ids = %v, want [77]", st.UnknownIDs)
	}
	if st.State != "receiving" || st.Packets != 4 {
		t.Errorf("status: %+v", st)
	}
	if nch == 0 {
		t.Error("no channels announced")
	}
}

func TestNamesAreCachedPerDevice(t *testing.T) {
	dir := t.TempDir()
	p := config.Profile{ID: "cache-test", Telemetry: config.Telemetry{Listen: "127.0.0.1:0"}}
	rec := &recorder{}
	s, err := Start(context.Background(), Options{Profile: p, ConfigDir: dir, FrameRate: 50}, rec)
	if err != nil {
		t.Fatal(err)
	}
	dst, _ := net.ResolveUDPAddr("udp4", s.Status().Listen)
	conn, _ := net.DialUDP("udp4", nil, dst)
	conn.Write(itv.AppendName(nil, 42, "OilTemp"))
	time.Sleep(100 * time.Millisecond)
	conn.Close()
	s.Stop()

	if got := config.LoadNames(dir, "cache-test")[42]; got != "OilTemp" {
		t.Fatalf("cached name = %q", got)
	}
}

func TestBusyPortFailsFast(t *testing.T) {
	l, err := net.ListenPacket("udp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	p := config.Profile{ID: "busy", Telemetry: config.Telemetry{Listen: l.LocalAddr().String()}}
	if s, err := Start(context.Background(), Options{Profile: p, ConfigDir: t.TempDir()}, &recorder{}); err == nil {
		s.Stop()
		t.Skip("this OS allows two sockets on one UDP port")
	}
}

func TestRestartRebindsSamePort(t *testing.T) {
	p := config.Profile{ID: "rebind", Telemetry: config.Telemetry{Listen: "127.0.0.1:0"}}
	dir := t.TempDir()
	s, err := Start(context.Background(), Options{Profile: p, ConfigDir: dir}, &recorder{})
	if err != nil {
		t.Fatal(err)
	}
	p.Telemetry.Listen = s.Status().Listen
	s.Stop()
	for i := 0; i < 20; i++ {
		s, err := Start(context.Background(), Options{Profile: p, ConfigDir: dir}, &recorder{})
		if err != nil {
			t.Fatalf("restart %d: %v", i, err)
		}
		s.Stop()
	}
}

func TestOnlyTheProfilesDeviceIsAccepted(t *testing.T) {
	off := false
	cases := []struct {
		name    string
		profile config.Profile
		accept  bool
	}{
		{"other sender", config.Profile{ID: "a", Address: "10.9.9.9"}, false},
		{"profile address", config.Profile{ID: "b", Address: "127.0.0.1"}, true},
		{"filter off", config.Profile{ID: "c", Address: "10.9.9.9",
			Telemetry: config.Telemetry{OnlyFromDevice: &off}}, true},
		{"nothing to match", config.Profile{ID: "d"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, rec, conn := startTestSession(t, tc.profile)
			conn.Write(itv.AppendF32(itv.AppendName(nil, 11, "RPM"), 11, 5000))
			time.Sleep(700 * time.Millisecond)

			rec.mu.Lock()
			rows := len(rec.rows)
			rec.mu.Unlock()
			st := s.Status()
			if got := rows > 0; got != tc.accept {
				t.Fatalf("accepted = %v, want %v (status %+v)", got, tc.accept, st)
			}
			if !tc.accept && (len(st.Ignored) != 1 || st.Ignored[0].Addr != "127.0.0.1" || !st.Filtering) {
				t.Fatalf("ignored sender not reported: %+v", st)
			}
		})
	}
}
