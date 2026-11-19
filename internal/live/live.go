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

	Timing   string `json:"timing"`
	LateRows uint64 `json:"lateRows"`

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

	calibrations chan map[string]config.Calibration
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

	s := &Session{
		opts:         opts,
		sink:         sink,
		cancel:       cancel,
		listener:     lst,
		done:         make(chan struct{}),
		calibrations: make(chan map[string]config.Calibration, 1),
	}
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

func (s *Session) SetCalibrations(c map[string]config.Calibration) {
	select {
	case s.calibrations <- c:
	case <-s.done:
	}
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

	pending   []Row
	pendingTx []float64
	clock     timebase
	timing    string
	lastOut   float64

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

	strict      bool
	configAddrs map[netip.Addr]bool
	discovered  map[netip.Addr]bool
	ignored     map[netip.Addr]uint64
	status      Status
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
		discovered: map[netip.Addr]bool{},
		nameReqErr: make(chan error, 1),
		lastOut:    math.Inf(-1),
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
	calErrs := h.setCalibrations(p.Calibrations)
	if p.Address != "" {
		if a, err := netip.ParseAddr(p.Address); err == nil {
			h.device, h.deviceSource = a, "config"
		}
	}
	configured := map[netip.Addr]bool{}
	for _, raw := range append([]string{p.Address}, p.AcceptedAddresses...) {
		if a, err := netip.ParseAddr(raw); err == nil {
			configured[a.Unmap()] = true
		}
	}
	h.configAddrs = configured

	onlyFromDevice := p.Telemetry.OnlyFromDevice == nil || *p.Telemetry.OnlyFromDevice
	h.strict = onlyFromDevice && (p.Discovery.Enabled || len(h.configAddrs) > 0)
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

func (h *hub) setCalibrations(cals map[string]config.Calibration) []string {
	var errs []string
	h.calibrate = map[string]calib.Converter{}
	for name, c := range cals {
		conv, err := c.Converter()
		if err != nil {
			errs = append(errs, fmt.Sprintf("calibration %s: %v", name, err))
			continue
		}
		h.calibrate[name] = conv
	}
	sort.Strings(errs)
	return errs
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
			h.flush(true)
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
			h.discovered[f.Addr] = true
			if h.deviceSource != "telemetry" {
				h.device, h.deviceSource = f.Addr, "discovery"
			}
			delete(h.ignored, f.Addr)
			h.status.Firmware = f.Firmware
		case c := <-h.session.calibrations:
			if errs := h.setCalibrations(c); len(errs) > 0 {
				h.status.Error = errs[0]
			}
		case err := <-h.nameReqErr:
			h.nameReqRun = false
			if err != nil {
				h.status.Error = "name request failed: " + err.Error()
			}
		case <-frameT.C:
			h.flush(false)
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
	if p.From.IsValid() && !p.From.IsLoopback() && (h.deviceSource != "telemetry" || h.device != p.From) {
		h.device, h.deviceSource = p.From, "telemetry"
	}
	delete(h.ignored, p.From)

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
	h.timing = "arrival"
	txSec := math.NaN()
	if tx, ok := row.V[h.names[idTimeTx]]; ok {
		if h.haveTx {
			row.V["TX_INT"] = tx - h.lastTx
		}
		h.lastTx, h.haveTx = tx, true
		txSec = tx / 1000
		row.T = h.clock.place(row.T, txSec)
		h.timing = "device"
	}
	h.status.Timing = h.timing
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
	h.pendingTx = append(h.pendingTx, txSec)
}

func (h *hub) accepts(a netip.Addr) bool {
	return a.IsValid() && (h.discovered[a.Unmap()] || h.configAddrs[a.Unmap()])
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

func (h *hub) flush(all bool) {
	if len(h.pending) == 0 {
		return
	}
	for i, tx := range h.pendingTx {
		if !math.IsNaN(tx) {
			r := &h.pending[i]
			r.T = tx + h.clock.offset
			r.V["RX_DELAY"] = r.V["Time_rx"] - r.T*1000
		}
	}
	idx := make([]int, len(h.pending))
	for i := range idx {
		idx[i] = i
	}
	sort.SliceStable(idx, func(a, b int) bool { return h.pending[idx[a]].T < h.pending[idx[b]].T })
	rows := make([]Row, len(idx))
	txs := make([]float64, len(idx))
	for i, j := range idx {
		rows[i], txs[i] = h.pending[j], h.pendingTx[j]
	}
	h.pending, h.pendingTx = rows, txs
	n := len(h.pending)
	if !all && h.timing == "device" {
		horizon := time.Since(h.start).Seconds() - holdBack
		n = sort.Search(n, func(i int) bool { return h.pending[i].T > horizon })
		if n == 0 {
			return
		}
	}
	out := h.pending[:n:n]
	for i := range out {
		if out[i].T <= h.lastOut {
			out[i].T = h.lastOut + 1e-6
			h.status.LateRows++
		}
		h.lastOut = out[i].T
	}
	h.session.sink.Frame(Frame{Rows: out})
	h.pending = append([]Row(nil), h.pending[n:]...)
	h.pendingTx = append([]float64(nil), h.pendingTx[n:]...)
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
