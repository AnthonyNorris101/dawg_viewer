package main

import (
	"encoding/json"
	"flag"
	"log"
	"math"
	"net"
	"strconv"
	"sync"
	"time"

	"dawg_viewer/internal/itv"
)

type signal struct {
	id   uint8
	name string
	gen  func(t float64) float64
}

const tau = 2 * math.Pi

func speed(t float64) float64 { return 38 + 18*math.Sin(tau*t/23) + 7*math.Sin(tau*t/6.1+1) }
func pedal(t float64) float64 { return math.Sin(tau*t/23 + 0.9) }
func steer(t float64) float64 { return 70*math.Sin(tau*t/11) + 20*math.Sin(tau*t/3.7) }

var signals = []signal{
	{11, "RPM", func(t float64) float64 { return 4000 + speed(t)*110 }},
	{12, "CLT1", func(t float64) float64 { return 95 - 30*math.Exp(-t/60) }},
	{13, "OilTemp", func(t float64) float64 { return 105 - 25*math.Exp(-t/90) }},
	{16, "OilPres", func(t float64) float64 { return 42 + speed(t)*0.35 }},
	{17, "AFR", func(t float64) float64 { return 13.2 + 0.8*math.Sin(tau*t/4.3) }},
	{18, "BatV", func(t float64) float64 { return 13.6 + 0.2*math.Sin(tau*t/40) }},
	{28, "FBPS", func(t float64) float64 { return math.Max(0, (-60*pedal(t)-20)*14) }},
	{29, "RBPS", func(t float64) float64 { return math.Max(0, (-60*pedal(t)-20)*8) }},
	{36, "RadTemp", func(t float64) float64 { return 1400 - 500*math.Exp(-t/120) }},
	{40, "StrAngle", steer},
	{52, "TPS1", func(t float64) float64 { return math.Max(0, math.Min(100, 50+60*pedal(t))) }},
	{55, "Gear", func(t float64) float64 { return math.Min(5, math.Max(1, math.Floor(speed(t)/12))) }},
	{101, "AccelX", func(t float64) float64 { return 0.9 * math.Cos(tau*t/23) }},
	{102, "AccelY", func(t float64) float64 { return steer(t) / 70 * 1.4 }},
	{103, "AccelZ", func(t float64) float64 { return 1 + 0.15*math.Sin(tau*t/0.21) }},
	{104, "Yaw", func(t float64) float64 { return math.Mod(t*12, 360) - 180 }},
	{110, "PosLat_H", func(t float64) float64 { return 33.9480 + 0.0004*math.Sin(tau*t/60) }},
	{111, "PosLat_L", func(t float64) float64 { return 0 }},
	{112, "PosLong_H", func(t float64) float64 { return -83.3770 + 0.0004*math.Cos(tau*t/60) }},
	{113, "PosLat_L", func(t float64) float64 { return 0 }},
}

func namePacket() []byte {
	b := itv.AppendName(nil, 0, "Time_tx")
	for _, s := range signals {
		b = itv.AppendName(b, s.id, s.name)
	}
	return b
}

func main() {
	id := flag.String("id", "G26-ILTM", "device id reported to discovery")
	target := flag.String("target", "255.255.255.255", "where to send telemetry until discovered")
	port := flag.Int("port", 5002, "telemetry UDP port")
	rate := flag.Int("rate", 50, "telemetry packets per second")
	discPort := flag.Int("discovery-port", 4999, "discovery UDP port")
	cmdPort := flag.Int("cmd-port", 2002, "command TCP port")
	flag.Parse()

	var mu sync.Mutex
	dest := &net.UDPAddr{IP: net.ParseIP(*target), Port: *port}
	sendNames := make(chan struct{}, 1)

	out, err := net.ListenPacket("udp4", ":0")
	if err != nil {
		log.Fatal(err)
	}

	go func() {
		conn, err := net.ListenPacket("udp4", net.JoinHostPort("", strconv.Itoa(*discPort)))
		if err != nil {
			log.Printf("discovery disabled: %v", err)
			return
		}
		buf := make([]byte, 128)
		for {
			n, from, err := conn.ReadFrom(buf)
			if err != nil {
				return
			}
			if string(buf[:n]) != "UGAMS_DISCOVER" {
				continue
			}
			ua := from.(*net.UDPAddr)
			reply, _ := json.Marshal(map[string]any{"type": "UGAMS_DATA", "id": *id, "port": 5000, "firmware": "sim"})
			conn.WriteTo(reply, ua)
			mu.Lock()
			if !dest.IP.Equal(ua.IP) {
				log.Printf("discovered by %s; sending telemetry there", ua.IP)
			}
			dest = &net.UDPAddr{IP: ua.IP, Port: *port}
			mu.Unlock()
		}
	}()

	go func() {
		l, err := net.Listen("tcp4", net.JoinHostPort("", strconv.Itoa(*cmdPort)))
		if err != nil {
			log.Printf("commands disabled: %v", err)
			return
		}
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				buf := make([]byte, 256)
				c.SetReadDeadline(time.Now().Add(time.Second))
				n := 0
				for n < len(buf) {
					m, err := c.Read(buf[n:])
					n += m
					if err != nil {
						break
					}
				}
				fields, _ := itv.Decode(buf[:n])
				for _, f := range fields {
					if f.ID == 1 {
						log.Printf("command %d from %s (%d bytes)", f.Int, c.RemoteAddr(), n)
						if f.Int == 3 {
							select {
							case sendNames <- struct{}{}:
							default:
							}
						}
					}
				}
			}(c)
		}
	}()

	log.Printf("sending %d channels at %d Hz to %s (until discovered)", len(signals), *rate, dest)
	start := time.Now()
	tick := time.NewTicker(time.Second / time.Duration(*rate))
	names := time.NewTicker(10 * time.Second)
	send := func(b []byte) {
		mu.Lock()
		d := dest
		mu.Unlock()
		if _, err := out.WriteTo(b, d); err != nil {
			log.Printf("send: %v", err)
		}
	}
	send(namePacket())
	for {
		select {
		case <-names.C:
			send(namePacket())
		case <-sendNames:
			send(namePacket())
		case <-tick.C:
			t := time.Since(start).Seconds()
			var b []byte
			for _, s := range signals {
				b = itv.AppendF32(b, s.id, float32(s.gen(t)))
			}
			b = itv.AppendF32(b, 0, float32(t*1000))
			send(b)
		}
	}
}
