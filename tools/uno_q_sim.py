#!/usr/bin/env python3
"""
Fake ILTM logger for the Arduino UNO Q (or any computer with Python 3.8+).

Sends simulated car data that Dawg Viewer reads exactly like the real logger:
  - answers "UGAMS_DISCOVER" on UDP 4999, then sends data only to the
    computer that asked;
  - sends ITV telemetry (float32 values, id 0 = milliseconds since start) to
    UDP 5002, and the id -> name list every 10 s;
  - accepts one command per TCP connection on 2002: resends the names on
    Name_Sync_Req (command 3) and turns the file server on/off (command 6);
  - while the file server is on, serves the files in --logs-dir over HTTP the
    way the firmware does (GET /files?dir=/logs, GET /download?name=logs/x).
    Fake .bin logs in the firmware's format are written there at start-up;
    any other .bin or .csv files you put in the folder are served too.

Only the Python standard library is used. Run it on the board's Linux side:
    python3 uno_q_sim.py                 # 50 packets/s, device id UNOQ-SIM
    python3 uno_q_sim.py --rate 20       # slower
    python3 uno_q_sim.py --target 192.168.1.50   # send straight to one computer
    python3 uno_q_sim.py --logs-dir /home/arduino/logs --fake-logs 0

In Dawg Viewer pick the "Arduino UNO Q (simulator)" device; its profile
(devices/uno_q_sim.yaml) expects the id UNOQ-SIM and the file server on port
8080. The byte layout is described in docs/device-protocol.md.
"""

import argparse
import datetime
import json
import math
import os
import socket
import struct
import threading
import time
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

TAU = 2 * math.pi

# ITV type codes (Firmware/ILTM_Module/ITV.h)
T_NAME = 0x00
T_F32 = 0x04
T_STRING = 0x05
FIXED_SIZES = {0x01: 1, 0x02: 2, 0x03: 4, 0x04: 4, 0x06: 1, 0x07: 1, 0x08: 8}

# SD-card log format (Firmware/ILTM_Module/DataLogger.h)
LOG_MAGIC = 0xDEADBEEF
LOG_VERSION = 2
ENTRIES_PER_FRAME = 56

CMD_NAME_SYNC = 3
CMD_FILESERVER = 6


def speed(t):
    return 38 + 18 * math.sin(TAU * t / 23) + 7 * math.sin(TAU * t / 6.1 + 1)


def pedal(t):
    return math.sin(TAU * t / 23 + 0.9)


def steer(t):
    return 70 * math.sin(TAU * t / 11) + 20 * math.sin(TAU * t / 3.7)


# (id, name, value at time t). Ids and names follow the car's vehicle config.
SIGNALS = [
    (11, "RPM", lambda t: 4000 + speed(t) * 110),
    (12, "CLT1", lambda t: 95 - 30 * math.exp(-t / 60)),
    (13, "OilTemp", lambda t: 105 - 25 * math.exp(-t / 90)),
    (16, "OilPres", lambda t: 42 + speed(t) * 0.35),
    (17, "AFR", lambda t: 13.2 + 0.8 * math.sin(TAU * t / 4.3)),
    (18, "BatV", lambda t: 13.6 + 0.2 * math.sin(TAU * t / 40)),
    (28, "FBPS", lambda t: max(0.0, (-60 * pedal(t) - 20) * 14)),
    (29, "RBPS", lambda t: max(0.0, (-60 * pedal(t) - 20) * 8)),
    (36, "RadTemp", lambda t: 1400 - 500 * math.exp(-t / 120)),  # raw ADC counts
    (40, "StrAngle", steer),
    (52, "TPS1", lambda t: max(0.0, min(100.0, 50 + 60 * pedal(t)))),
    (55, "Gear", lambda t: min(5.0, max(1.0, math.floor(speed(t) / 12)))),
    (101, "AccelX", lambda t: 0.9 * math.cos(TAU * t / 23)),
    (102, "AccelY", lambda t: steer(t) / 70 * 1.4),
    (103, "AccelZ", lambda t: 1 + 0.15 * math.sin(TAU * t / 0.21)),
    (104, "Yaw", lambda t: (t * 12) % 360 - 180),
    (110, "PosLat_H", lambda t: 33.9480 + 0.0004 * math.sin(TAU * t / 60)),
    (111, "PosLat_L", lambda t: 0.0),
    (112, "PosLong_H", lambda t: -83.3770 + 0.0004 * math.cos(TAU * t / 60)),
    (113, "PosLong_L", lambda t: 0.0),
]


# ---------------------------------------------------------------- telemetry


def itv_name(sig_id, name):
    data = name.encode()[:255]
    return bytes([sig_id, T_NAME, len(data)]) + data


def itv_f32(sig_id, value):
    return struct.pack("<BBf", sig_id, T_F32, value)


def name_packet():
    packet = itv_name(0, "Time_tx")
    for sig_id, name, _ in SIGNALS:
        packet += itv_name(sig_id, name)
    return packet


def data_packet(t):
    packet = b"".join(itv_f32(sig_id, gen(t)) for sig_id, _, gen in SIGNALS)
    return packet + itv_f32(0, t * 1000)


def parse_command(data):
    """Returns (command, data byte) from an ITV command packet, or None."""
    fields, i = {}, 0
    while i + 2 <= len(data):
        field_id, field_type = data[i], data[i + 1]
        i += 2
        if field_type in (T_NAME, T_STRING):
            if i >= len(data):
                break
            i += 1 + data[i]
            continue
        size = FIXED_SIZES.get(field_type)
        if size is None or i + size > len(data):
            break
        fields.setdefault(field_id, int.from_bytes(data[i : i + size], "little"))
        i += size
    if 1 not in fields:
        return None
    return fields[1], fields.get(2, 0)


# ----------------------------------------------------------------- SD logs


def firmware_crc(data):
    # The firmware's esp_crc32_le(0xFFFFFFFF, ...) ^ 0xFFFFFFFF is CRC-32 with
    # initial value 0 and no final XOR.
    return zlib.crc32(data, 0xFFFFFFFF) ^ 0xFFFFFFFF


def cobs_encode(src):
    out = bytearray([0])
    code_idx, code = 0, 1
    for b in src:
        if b != 0:
            out.append(b)
            code += 1
            if code != 0xFF:
                continue
        out[code_idx] = code
        code_idx = len(out)
        out.append(0)
        code = 1
    out[code_idx] = code
    return bytes(out)


def encode_log(names, entries):
    """names: {id: name}; entries: [(timestamp_ms, id, value)]."""
    out = bytearray(struct.pack("<IBB", LOG_MAGIC, LOG_VERSION, len(names)))
    for sig_id in sorted(names):
        name = names[sig_id].encode()[:255]
        out += bytes([sig_id, len(name)]) + name
    for i in range(0, len(entries), ENTRIES_PER_FRAME):
        data = b"".join(struct.pack("<IBf", *e) for e in entries[i : i + ENTRIES_PER_FRAME])
        data += struct.pack("<I", firmware_crc(data))
        out += cobs_encode(data) + b"\x00"
    return bytes(out)


def write_fake_logs(folder, count, seconds=60, rate=50):
    if count <= 0 or any(f.endswith(".bin") for f in os.listdir(folder)):
        return
    names = {0: "Time_tx", **{sig_id: name for sig_id, name, _ in SIGNALS}}
    start = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=1)
    step_ms = 1000 // rate
    for n in range(1, count + 1):
        base_ms = n * seconds * 1000
        entries = []
        for ms in range(0, seconds * 1000, step_ms):
            t = (base_ms + ms) / 1000
            for sig_id, _, gen in SIGNALS:
                entries.append((base_ms + ms, sig_id, gen(t)))
        stamp = (start + datetime.timedelta(minutes=n)).strftime("%Y-%m-%d_%H-%M-%S")
        path = os.path.join(folder, f"{stamp}_data{n}.bin")
        with open(path, "wb") as f:
            f.write(encode_log(names, entries))
        print(f"wrote fake log {path}")


# ------------------------------------------------------------- file server


class FileServer:
    """The firmware's file server: on while command 6 = 1, off when 0."""

    def __init__(self, folder, port):
        self.folder = folder
        self.port = port
        self.server = None
        self.lock = threading.Lock()

    def set(self, on):
        with self.lock:
            if on and self.server is None:
                handler = type("Handler", (LogHandler,), {"folder": self.folder})
                try:
                    self.server = ThreadingHTTPServer(("", self.port), handler)
                except OSError as e:
                    print(f"file server failed to start on port {self.port}: {e}")
                    return
                threading.Thread(target=self.server.serve_forever, daemon=True).start()
                print(f"file server on port {self.port} serving {self.folder}")
            elif not on and self.server is not None:
                server, self.server = self.server, None
                threading.Thread(target=lambda: (server.shutdown(), server.server_close()), daemon=True).start()
                print("file server stopped")


class LogHandler(BaseHTTPRequestHandler):
    folder = "."

    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)
        if url.path == "/files":
            self.list_files(query.get("dir", ["/"])[0])
        elif url.path == "/download":
            self.download(query.get("name", [""])[0])
        else:
            self.send_error(404, "Not found")

    def list_files(self, folder):
        names = []
        if folder.strip("/") == "logs":
            names = sorted(f for f in os.listdir(self.folder) if os.path.isfile(os.path.join(self.folder, f)))
        body = json.dumps(names).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def download(self, name):
        rel = name.lstrip("/")
        if not rel.startswith("logs/") or "/" in rel[5:] or ".." in rel:
            self.send_error(404, "File not found")
            return
        path = os.path.join(self.folder, rel[5:])
        if not os.path.isfile(path):
            self.send_error(404, "File not found")
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(os.path.getsize(path)))
        self.send_header("Content-Disposition", f'attachment; filename="{rel[5:]}"')
        self.end_headers()
        with open(path, "rb") as f:
            while chunk := f.read(64 * 1024):
                self.wfile.write(chunk)

    def log_message(self, fmt, *args):
        pass


# --------------------------------------------------------------- simulator


class Sim:
    def __init__(self, args):
        self.args = args
        self.dest = (args.target, args.port)
        self.lock = threading.Lock()
        self.names_requested = threading.Event()
        self.out = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.out.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        os.makedirs(args.logs_dir, exist_ok=True)
        write_fake_logs(args.logs_dir, args.fake_logs)
        self.files = FileServer(args.logs_dir, args.http_port)

    def send(self, packet):
        with self.lock:
            dest = self.dest
        try:
            self.out.sendto(packet, dest)
        except OSError as e:
            print(f"send to {dest[0]} failed: {e}")

    def discovery(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("", self.args.discovery_port))
        except OSError as e:
            print(f"discovery disabled: {e}")
            return
        reply = json.dumps(
            {"type": "UGAMS_DATA", "id": self.args.id, "port": 5000, "firmware": "uno-q-sim"}
        ).encode()
        while True:
            data, addr = sock.recvfrom(128)
            if data != b"UGAMS_DISCOVER":
                continue
            sock.sendto(reply, addr)
            with self.lock:
                changed = self.dest[0] != addr[0]
                self.dest = (addr[0], self.args.port)
            if changed:
                print(f"discovered by {addr[0]}; sending telemetry there")

    def commands(self):
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            server.bind(("", self.args.cmd_port))
        except OSError as e:
            print(f"commands disabled: {e}")
            return
        server.listen(4)
        while True:
            conn, addr = server.accept()
            threading.Thread(target=self.handle_command, args=(conn, addr), daemon=True).start()

    def handle_command(self, conn, addr):
        # Like the firmware: read up to 256 bytes or until 1 s passes.
        conn.settimeout(1.0)
        data = b""
        try:
            while len(data) < 256:
                chunk = conn.recv(256 - len(data))
                if not chunk:
                    break
                data += chunk
        except socket.timeout:
            pass
        finally:
            conn.close()
        parsed = parse_command(data)
        if parsed is None:
            return
        cmd, value = parsed
        print(f"command {cmd} (data {value}) from {addr[0]} ({len(data)} bytes)")
        if cmd == CMD_NAME_SYNC:
            self.names_requested.set()
        elif cmd == CMD_FILESERVER:
            self.files.set(value == 1)

    def run(self):
        threading.Thread(target=self.discovery, daemon=True).start()
        threading.Thread(target=self.commands, daemon=True).start()
        print(
            f"sending {len(SIGNALS)} channels at {self.args.rate} Hz to "
            f"{self.dest[0]}:{self.dest[1]} (until discovered as {self.args.id})"
        )

        period = 1.0 / self.args.rate
        start = time.monotonic()
        next_tick = start
        next_names = start
        while True:
            now = time.monotonic()
            if now >= next_names or self.names_requested.is_set():
                self.names_requested.clear()
                self.send(name_packet())
                next_names = now + 10
            self.send(data_packet(now - start))
            next_tick += period
            delay = next_tick - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            else:
                next_tick = time.monotonic()  # fell behind; don't try to catch up


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    p = argparse.ArgumentParser(description="Fake ILTM logger for Dawg Viewer.")
    p.add_argument("--id", default="UNOQ-SIM", help="device id reported to discovery")
    p.add_argument("--target", default="255.255.255.255", help="where to send data until discovered")
    p.add_argument("--port", type=int, default=5002, help="telemetry UDP port")
    p.add_argument("--rate", type=float, default=50, help="packets per second")
    p.add_argument("--discovery-port", type=int, default=4999, help="discovery UDP port")
    p.add_argument("--cmd-port", type=int, default=2002, help="command TCP port")
    p.add_argument("--http-port", type=int, default=8080, help="file server port (80 needs root on Linux)")
    p.add_argument("--logs-dir", default=os.path.join(here, "logs"), help="folder of .bin/.csv files to serve")
    p.add_argument("--fake-logs", type=int, default=3, help="fake .bin logs to write if the folder has none")
    try:
        Sim(p.parse_args()).run()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
