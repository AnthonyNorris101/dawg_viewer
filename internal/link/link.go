package link

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"strconv"
	"time"
)

type Packet struct {
	Data []byte
	From netip.Addr
	At   time.Time
}

type Listener struct {
	conn net.PacketConn
	stop chan struct{}
	done chan struct{}
	err  error
}

func ListenUDP(addr string, out chan<- Packet) (*Listener, error) {
	conn, err := net.ListenPacket("udp4", addr)
	if err != nil {
		return nil, fmt.Errorf("can't listen on UDP %s: %w", addr, err)
	}
	l := &Listener{conn: conn, stop: make(chan struct{}), done: make(chan struct{})}
	go func() {
		defer close(l.done)
		buf := make([]byte, 65535)
		for {
			n, from, err := conn.ReadFrom(buf)
			if err != nil {
				l.err = err
				return
			}
			p := Packet{Data: append([]byte(nil), buf[:n]...), At: time.Now()}
			if ua, ok := from.(*net.UDPAddr); ok {
				p.From = ua.AddrPort().Addr().Unmap()
			}
			select {
			case out <- p:
			case <-l.stop:
				return
			}
		}
	}()
	return l, nil
}

func (l *Listener) Addr() net.Addr { return l.conn.LocalAddr() }

func (l *Listener) Done() <-chan struct{} { return l.done }

func (l *Listener) Err() error { return l.err }

func (l *Listener) Close() {
	select {
	case <-l.stop:
	default:
		close(l.stop)
	}
	l.conn.Close()
	<-l.done
}

type Found struct {
	Type     string     `json:"type"`
	ID       string     `json:"id"`
	Port     int        `json:"port"`
	Firmware string     `json:"firmware"`
	Addr     netip.Addr `json:"-"`
}

func Discover(ctx context.Context, port int, request string, wait time.Duration) ([]Found, error) {
	conn, err := net.ListenPacket("udp4", ":0")
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	sent := 0
	var lastErr error
	for _, dst := range broadcastAddrs() {
		_, err := conn.WriteTo([]byte(request), &net.UDPAddr{IP: dst.AsSlice(), Port: port})
		if err != nil {
			lastErr = err
			continue
		}
		sent++
	}
	if sent == 0 {
		return nil, fmt.Errorf("discovery request not sent: %w", lastErr)
	}

	deadline := time.Now().Add(wait)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	conn.SetReadDeadline(deadline)

	var found []Found
	seen := map[netip.Addr]bool{}
	buf := make([]byte, 2048)
	for {
		n, from, err := conn.ReadFrom(buf)
		if err != nil {
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				return found, nil
			}
			return found, err
		}
		var f Found
		if json.Unmarshal(buf[:n], &f) != nil || f.Type != "UGAMS_DATA" {
			continue
		}
		f.Addr = from.(*net.UDPAddr).AddrPort().Addr().Unmap()
		if !seen[f.Addr] {
			seen[f.Addr] = true
			found = append(found, f)
		}
	}
}

func broadcastAddrs() []netip.Addr {
	out := []netip.Addr{netip.AddrFrom4([4]byte{255, 255, 255, 255})}
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, ifc := range ifaces {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagBroadcast == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, _ := ifc.Addrs()
		for _, a := range addrs {
			ipn, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipn.IP.To4()
			mask := ipn.Mask
			if ip4 == nil || len(mask) != 4 {
				continue
			}
			var b [4]byte
			for i := range b {
				b[i] = ip4[i] | ^mask[i]
			}
			out = append(out, netip.AddrFrom4(b))
		}
	}
	return out
}

func SendCommand(ctx context.Context, host netip.Addr, port int, payload []byte, padTo int) error {
	if !host.IsValid() {
		return errors.New("no device address to send the command to")
	}
	if padTo > len(payload) {
		payload = append(payload, make([]byte, padTo-len(payload))...)
	}
	d := net.Dialer{Timeout: 2 * time.Second}
	conn, err := d.DialContext(ctx, "tcp4", net.JoinHostPort(host.String(), strconv.Itoa(port)))
	if err != nil {
		return err
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err := conn.Write(payload); err != nil {
		return err
	}
	_, err = io.Copy(io.Discard, conn)
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return nil
	}
	return err
}
