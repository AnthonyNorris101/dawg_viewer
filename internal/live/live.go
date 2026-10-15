package live

import (
	"context"
	"fmt"
	"math"
	"net/netip"
	"sort"
	"sync"
	"time"

	"dawg_viewer/internal/calib"
	"dawg_viewer/internal/config"
	"dawg_viewer/internal/itv"
	"dawg_viewer/internal/link"
)

const (
	idTimeTx  = 0
	idCommand = 1
)

type Row struct {
	T float64            `json:"t"`
	V map[string]float64 `json:"v"`
}

type Frame struct {
	Rows []Row `json:"rows"`
}

type Channel struct {
	Name string `json:"name"`

	ID   int                `json:"id"`
	Meta config.ChannelMeta `json:"meta"`
}

type Status struct {
	Profile      string  `json:"profile"`
	ProfileName  string  `json:"profileName"`
	State        string  `json:"state"`
	Listen       string  `json:"listen"`
	DeviceIP     string  `json:"deviceIp"`
	DeviceSource string  `json:"deviceSource"`
	Firmware     string  `json:"firmware"`
	Packets      uint64  `json:"packets"`
	PacketRate   float64 `json:"packetRate"`

	LastPacketMs int64  `json:"lastPacketMs"`
	BadPackets   uint64 `json:"badPackets"`
	UnknownIDs   []int  `json:"unknownIds"`

	Filtering bool `json:"filtering"`

	Ignored []IgnoredSender `json:"ignored"`
	Error   string          `json:"error"`

	StartedAt int64 `json:"startedAt"`
}

type IgnoredSender struct {
	Addr    string `json:"addr"`
	Packets uint64 `json:"packets"`
}

type Sink interface {
	Frame(Frame)
	Status(Status)
	Channels([]Channel)
}

type Options struct {
	Profile    config.Profile
	ConfigDir  string
	FrameRate  int
	StaleAfter time.Duration
}

type Session struct {
	opts     Options
	sink     Sink
	cancel   context.CancelFunc
	listener *link.Listener
	done     chan struct{}

	mu       sync.Mutex
	status   Status
	channels []Channel
}

func Start(parent context.Context, opts Options, sink Sink) (*Session, error) {
	if opts.FrameRate <= 0 {
		opts.FrameRate = 20
	}
	if opts.StaleAfter <= 0 {
		opts.StaleAfter = 2 * time.Second
	}
	ctx, cancel := context.WithCancel(parent)
	packets := make(chan link.Packet, 1024)
	lst, err := link.ListenUDP(opts.Profile.Telemetry.Listen, packets)
	if err != nil {
		cancel()
		return nil, err
	}

	s := &Session{opts: opts, sink: sink, cancel: cancel, listener: lst, done: make(chan struct{})}
	h := newHub(opts, s)
	h.status.Listen = lst.Addr().String()
	s.status = h.status

	found := make(chan link.Found, 4)
	if opts.Profile.Discovery.Enabled {
		go discoverLoop(ctx, opts.Profile.Discovery, found)
	}
	go func() {
		defer close(s.done)
		h.run(ctx, packets, lst, found)
	}()
	return s, nil
}

func (s *Session) Stop() {
	s.cancel()
	<-s.done
	s.listener.Close()
}

func (s *Session) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

func (s *Session) Channels() []Channel {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Channel(nil), s.channels...)
}

func discoverLoop(ctx context.Context, d config.Discovery, out chan<- link.Found) {
	retry := time.Second
	for {
		found, _ := link.Discover(ctx, d.Port, d.Request, time.Second)
		wait := retry
		for _, f := range found {
			if d.DeviceID == "" || f.ID == d.DeviceID {
				select {
				case out <- f:
				case <-ctx.Done():
					return
				}
				wait = 15 * time.Second
				break
			}
		}
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return
		}
	}
}

type hub struct {
	opts    Options
	session *Session
	start   time.Time

	names      map[uint8]string
	namesDirty bool
	rename     map[uint8]string
	calibrate  map[string]calib.Converter
	combine    []config.Combine
	latest     map[string]float64
	known      map[string]bool
	channels   []Channel
	unknown    map[uint8]bool

	pending []Row

	lastRx     time.Time
	lastTx     float64
	haveTx     bool
	rateCount  uint64
	rateSince  time.Time
	nameReqAt  time.Time
	nameReqRun bool
	nameReqErr chan error

	device       netip.Addr
	deviceSource string

	strict     bool
	configAddr netip.Addr
	discovered netip.Addr
	ignored    map[netip.Addr]uint64
	status     Status
}

func newHub(opts Options, s *Session) *hub {
	p := opts.Profile
	h := &hub{
		opts:       opts,
		session:    s,
		start:      time.Now(),
		names:      config.LoadNames(opts.ConfigDir, p.ID),
		rename:     map[uint8]string{},
		calibrate:  map[string]calib.Converter{},
		combine:    p.Combine,
		latest:     map[string]float64{},
		known:      map[string]bool{},
		unknown:    map[uint8]bool{},
		ignored:    map[netip.Addr]uint64{},
		nameReqErr: make(chan error, 1),
	}
	if _, ok := h.names[idTimeTx]; !ok {
		h.names[idTimeTx] = "Time_tx"
	}
	for id, name := range p.Rename {
		if id >= 0 && id <= 255 {
			h.rename[uint8(id)] = name
			h.names[uint8(id)] = name
		}
	}
	var calErrs []string
	for name, c := range p.Calibrations {
		conv, err := buildCalibration(c)
		if err != nil {
			calErrs = append(calErrs, fmt.Sprintf("calibration %s: %v", name, err))
			continue
		}
		h.calibrate[name] = conv
	}
	if p.Address != "" {
		if a, err := netip.ParseAddr(p.Address); err == nil {
			h.device, h.deviceSource = a, "config"
			h.configAddr = a
		}
	}

	onlyFromDevice := p.Telemetry.OnlyFromDevice == nil || *p.Telemetry.OnlyFromDevice
	h.strict = onlyFromDevice && (p.Discovery.Enabled || h.configAddr.IsValid())
	h.status = Status{
		Profile:      p.ID,
		ProfileName:  p.Name,
		State:        "listening",
		LastPacketMs: -1,
		StartedAt:    h.start.UnixMilli(),
	}
	if len(calErrs) > 0 {
		h.status.Error = calErrs[0]
	}
	h.rateSince = h.start
	return h
}

func buildCalibration(c config.Calibration) (calib.Converter, error) {
	switch c.Type {
	case "linear":
		div := c.Div
		if div == 0 {
			div = 1
		}
		mult := c.Mult
		if mult == 0 {
			mult = 1
		}
		return calib.Linear(mult, div, c.Add)
	case "steinhart_f":
		if len(c.Points) != 3 {
			return nil, fmt.Errorf("needs exactly 3 points, got %d", len(c.Points))
		}
		var pts [3]calib.SteinhartPoint
		for i, p := range c.Points {
			pts[i] = calib.SteinhartPoint{ADC: p[0], TempF: p[1]}
		}
		rFixed, adcMax := c.RFixed, c.ADCMax
		if rFixed == 0 {
			rFixed = 1000
		}
		if adcMax == 0 {
			adcMax = 4095
		}
		toGround := c.ThermistorToGround == nil || *c.ThermistorToGround
		conv, _, err := calib.Steinhart(pts, rFixed, adcMax, toGround)
		return conv, err
	default:
		return nil, fmt.Errorf("unknown type %q (use linear or steinhart_f)", c.Type)
	}
}

func (h *hub) run(ctx context.Context, packets <-chan link.Packet, lst *link.Listener, found <-chan link.Found) {
	listenDone := lst.Done()
	frameT := time.NewTicker(time.Second / time.Duration(h.opts.FrameRate))
	statusT := time.NewTicker(500 * time.Millisecond)
	saveT := time.NewTicker(2 * time.Second)
	defer frameT.Stop()
	defer statusT.Stop()
	defer saveT.Stop()

	h.publishStatus(time.Now())
	for {
		select {
		case <-ctx.Done():
			h.flush()
			h.saveNames()
			h.status.State = "stopped"
			h.publishStatus(time.Now())
			return
		case p := <-packets:
			h.handle(ctx, p)
		case <-listenDone:
			listenDone = nil
			if ctx.Err() == nil {
				h.status.State = "error"
				h.status.Error = fmt.Sprintf("stopped listening: %v", lst.Err())
				h.publishStatus(time.Now())
			}
		case f := <-found:
			h.device, h.deviceSource = f.Addr, "discovery"
			h.discovered = f.Addr
			delete(h.ignored, f.Addr)
			h.status.Firmware = f.Firmware
		case err := <-h.nameReqErr:
			h.nameReqRun = false
			if err != nil {
				h.status.Error = "name request failed: " + err.Error()
			}
		case <-frameT.C:
			h.flush()
		case now := <-statusT.C:
			h.publishStatus(now)
		case <-saveT.C:
			h.saveNames()
		}
	}
}

func (h *hub) handle(ctx context.Context, p link.Packet) {
	if h.strict && !h.accepts(p.From) {
		h.ignored[p.From]++
		return
	}
	fields, err := itv.Decode(p.Data)
	if err != nil {
		h.status.BadPackets++
	}
	if len(fields) == 0 {
		return
	}
	h.status.Packets++
	h.rateCount++
	if h.deviceSource != "discovery" && p.From.IsValid() && !p.From.IsLoopback() {
		h.device, h.deviceSource = p.From, "telemetry"
	}

	for _, f := range fields {
		if f.ID == idCommand && !f.IsText() {
			return
		}
	}

	row := Row{T: p.At.Sub(h.start).Seconds(), V: map[string]float64{}}
	needNames := false
	for _, f := range fields {
		if f.Type == itv.TypeName {
			h.learnName(f.ID, f.Str)
			continue
		}
		if f.IsText() {
			continue
		}
		name, ok := h.names[f.ID]
		if !ok {
			h.unknown[f.ID] = true
			needNames = true
			continue
		}
		v := f.Num
		if conv, ok := h.calibrate[name]; ok {
			v = conv(v)
		}
		if math.IsNaN(v) || math.IsInf(v, 0) {
			continue
		}
		row.V[name] = v
	}
	if needNames {
		h.requestNames(ctx, p.At)
	}
	if len(row.V) == 0 {
		return
	}

	row.V["Time_rx"] = row.T * 1000
	if !h.lastRx.IsZero() {
		row.V["RX_INT"] = float64(p.At.Sub(h.lastRx).Microseconds()) / 1000
	}
	h.lastRx = p.At
	if tx, ok := row.V[h.names[idTimeTx]]; ok {
		if h.haveTx {
			row.V["TX_INT"] = tx - h.lastTx
		}
		h.lastTx, h.haveTx = tx, true
	}
	for k, v := range row.V {
		h.latest[k] = v
	}
	for _, c := range h.combine {
		_, hiNew := row.V[c.Hi]
		_, loNew := row.V[c.Lo]
		hi, okHi := h.latest[c.Hi]
		lo, okLo := h.latest[c.Lo]
		if (hiNew || loNew) && okHi && okLo {
			row.V[c.Name] = hi + lo
		}
	}

	h.noteChannels(row.V)
	h.pending = append(h.pending, row)
}

func (h *hub) accepts(a netip.Addr) bool {
	return a.IsValid() && (a == h.discovered || a == h.configAddr)
}

func (h *hub) learnName(id uint8, name string) {
	if name == "" {
		return
	}
	if r, ok := h.rename[id]; ok {
		name = r
	}
	if h.names[id] != name {
		h.names[id] = name
		h.namesDirty = true
	}
	delete(h.unknown, id)
}

func (h *hub) requestNames(ctx context.Context, now time.Time) {
	cmds := h.opts.Profile.Commands
	cmd, ok := cmds.List[cmds.NameSync]
	if !ok || h.nameReqRun || now.Sub(h.nameReqAt) < 2*time.Second || !h.device.IsValid() {
		return
	}
	h.nameReqAt, h.nameReqRun = now, true
	payload := itv.AppendU8(itv.AppendCmd(nil, idCommand, cmd.ID), 2, cmd.Data)
	dev, port, pad := h.device, cmds.Port, cmds.PadTo
	go func() { h.nameReqErr <- link.SendCommand(ctx, dev, port, payload, pad) }()
}

func (h *hub) noteChannels(v map[string]float64) {
	added := false
	for name := range v {
		if h.known[name] {
			continue
		}
		h.known[name] = true
		id := -1
		for i, n := range h.names {
			if n == name {
				id = int(i)
				break
			}
		}
		h.channels = append(h.channels, Channel{Name: name, ID: id, Meta: h.opts.Profile.Channels[name]})
		added = true
	}
	if !added {
		return
	}
	sort.Slice(h.channels, func(i, j int) bool { return h.channels[i].Name < h.channels[j].Name })
	list := append([]Channel(nil), h.channels...)
	h.session.mu.Lock()
	h.session.channels = list
	h.session.mu.Unlock()
	h.session.sink.Channels(list)
}

func (h *hub) flush() {
	if len(h.pending) == 0 {
		return
	}
	h.session.sink.Frame(Frame{Rows: h.pending})
	h.pending = nil
}

func (h *hub) publishStatus(now time.Time) {
	st := &h.status
	if dt := now.Sub(h.rateSince).Seconds(); dt >= 1 {
		st.PacketRate = float64(h.rateCount) / dt
		h.rateCount, h.rateSince = 0, now
	}
	if !h.lastRx.IsZero() {
		st.LastPacketMs = now.Sub(h.lastRx).Milliseconds()
	}
	if st.State != "error" && st.State != "stopped" {
		switch {
		case h.lastRx.IsZero():
			st.State = "listening"
		case now.Sub(h.lastRx) > h.opts.StaleAfter:
			st.State = "stale"
		default:
			st.State = "receiving"
		}
	}
	if h.device.IsValid() {
		st.DeviceIP, st.DeviceSource = h.device.String(), h.deviceSource
	}
	st.UnknownIDs = st.UnknownIDs[:0]
	for id := range h.unknown {
		st.UnknownIDs = append(st.UnknownIDs, int(id))
	}
	sort.Ints(st.UnknownIDs)

	st.Filtering = h.strict
	st.Ignored = st.Ignored[:0]
	for a, n := range h.ignored {
		st.Ignored = append(st.Ignored, IgnoredSender{a.String(), n})
	}
	sort.Slice(st.Ignored, func(i, j int) bool { return st.Ignored[i].Addr < st.Ignored[j].Addr })

	snap := *st
	snap.UnknownIDs = append([]int{}, st.UnknownIDs...)
	snap.Ignored = append([]IgnoredSender{}, st.Ignored...)
	h.session.mu.Lock()
	h.session.status = snap
	h.session.mu.Unlock()
	h.session.sink.Status(snap)
}

func (h *hub) saveNames() {
	if !h.namesDirty {
		return
	}
	if err := config.SaveNames(h.opts.ConfigDir, h.opts.Profile.ID, h.names); err == nil {
		h.namesDirty = false
	}
}
