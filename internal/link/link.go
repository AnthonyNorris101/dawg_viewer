// Package link holds the network I/O used to talk to a logger: the UDP
// telemetry listener, the UGAMS discovery exchange and one-shot TCP commands.
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

// Packet is one UDP datagram received from a device.
type Packet struct {
	Data []byte
	From netip.Addr
	At   time.Time
}

// Listener receives UDP datagrams until closed.
type Listener struct {
	conn net.PacketConn
	stop chan struct{}
	done chan struct{}
	err  error
}

// ListenUDP binds addr and delivers every datagram on out. The bind happens
// before it returns so a busy port is reported immediately.
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

// Addr is the bound local address.
func (l *Listener) Addr() net.Addr { return l.conn.LocalAddr() }

// Done is closed when the listener stops, by Close or by a socket error.
func (l *Listener) Done() <-chan struct{} { return l.done }

// Err is the error that stopped the listener; read it after Done is closed.
func (l *Listener) Err() error { return l.err }

// Close releases the port and waits until it is free to bind again.
func (l *Listener) Close() {
	select {
	case <-l.stop:
	default:
		close(l.stop)
	}
	l.conn.Close()
	<-l.done
}

// Found is a device that answered discovery.
type Found struct {
	Type     string     `json:"type"`
	ID       string     `json:"id"`
	Port     int        `json:"port"`
	Firmware string     `json:"firmware"`
	Addr     netip.Addr `json:"-"`
}

// Discover broadcasts request to port on every IPv4 network this computer is
// on and collects UGAMS_DATA replies until wait has passed. The firmware
// answers to the request's source port, so no fixed local port is needed.
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

// broadcastAddrs returns the limited broadcast address plus the directed
// broadcast address of each IPv4 network. On machines with several adapters
// (common on Windows) 255.255.255.255 only goes out of one of them.
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

// SendCommand opens a TCP connection, writes payload (zero-padded to padTo
// bytes when padTo is larger) and waits for the device to close the
// connection, like the old Python app did.
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
		return nil // the device acted on it but never closed; nothing more to read
	}
	return err
}
