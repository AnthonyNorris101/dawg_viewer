# Backend

The Go code is split into packages that each depend only on the ones below:

```
main.go          starts Wails, reads --config
services/        what the frontend can call; thin
internal/live    a session: packets → rows, status, frames
internal/link    network I/O only
internal/itv     the wire encoding
internal/config  config folder, settings, device profiles, name cache
internal/calib   calibration maths
cmd/iltm-sim     a fake logger for testing
```

## main.go

`--config <dir>` (or `--config=<dir>`) is parsed by hand instead of with the
`flag` package because the OS can pass extra arguments to GUI apps (e.g.
`-psn_…` on macOS), which `flag` would reject.

## services

`LiveService` connects to one device at a time and streams its data. Event
names: `live:frame`, `live:status`, `live:channels`; they're registered with
`application.RegisterEvent` so the generated bindings are typed.

- On start-up it connects to the device in `settings.yaml`, but a busy port
  or missing profile doesn't stop the app opening; the UI shows the problem
  and lets the user pick again.
- `Connect` saves the chosen device in `settings.yaml`.
- `Reload` re-reads all config and reconnects.
- The `emitter` type forwards session output to Wails events.

## internal/itv

The ID-Type-Value encoding from `Firmware/ILTM_Module/ITV.h`: every field is
`[id u8][type u8][value]`, multi-byte values little-endian.

| Type | Value |
|---|---|
| `0x00` name | `[len u8][utf-8]`; registers a name for the id |
| `0x01` u8, `0x02` u16, `0x03` u32, `0x08` u64 | integers |
| `0x04` f32 | float |
| `0x05` string | `[len u8][utf-8]` |
| `0x06` bool | 1 byte |
| `0x07` command | u8 command enum |

- `Field.Num` holds every non-string value as a float64 (bool is 0 or 1).
  `Field.Int` keeps the exact integer, which `Num` can't for u64 > 2^53.
- `Decode` returns the fields decoded before a malformed one plus an error,
  matching how the firmware and the old Python decoder stop at the first bad
  field.
- Names longer than 255 bytes are cut by `AppendName`.
- Zero padding decodes as empty id-0 names. That is why padding command
  packets to 256 bytes is safe for the firmware (see `pad_to` below); a test
  checks it.

## internal/link

Network I/O only: the UDP telemetry listener, discovery and one-shot TCP
commands.

### ListenUDP / Listener

- The bind happens before `ListenUDP` returns, so a busy port (e.g. the old
  Python app still running) is reported straight away.
- Each datagram is copied out of the reusable read buffer before being sent
  on, so the next read can't overwrite it.
- The reader has a separate stop channel so `Close` can't deadlock when the
  consumer has stopped reading.
- `Close` waits until the socket is really closed, so the next session can
  bind the same port immediately (tested by `TestRestartRebindsSamePort`).

### Discover

- Opens a fresh socket on a random port. The firmware replies to the
  request's source port, so no fixed local port is needed.
- Sends to 255.255.255.255 **and** to each network's directed broadcast
  address (`broadcastAddrs`): on machines with several adapters, common on
  Windows, 255.255.255.255 only goes out of one of them.
- Reads replies until a 1 s read deadline, so it can never hang.

### SendCommand

Opens a TCP connection, writes the payload (zero-padded to `padTo` if larger)
and waits for the device to close the connection, like the Python app. A read
timeout counts as success: the device acted on the command but never closed.

## internal/live

Turns packets from one device into rows and hands them to the UI at a fixed
frame rate. The data model and goroutine layout are in
[architecture.md](architecture.md); details here.

- **Reserved ids:** the firmware reserves 0–9. Id 0 is `Time_tx` (the
  sender's clock); a packet with id 1 is a command (time-sync request) and is
  dropped, since it shares the port but isn't data.
- **Unknown ids:** the field is skipped but the rest of the packet is kept.
  The Python app dropped the whole packet. The app then asks the device to
  resend names (`requestNames`), at most every 2 s and one request at a time.
- **Names:** learned from name packets, overridden by `rename`, cached to
  `cache/<device>.names.yaml` every 2 s when changed. Id 0 defaults to
  `Time_tx`.
- **Calibration:** applied by channel name. NaN or infinite results are
  dropped from the row.
- **Computed channels** (as in the old app): `Time_rx` (receive time, ms),
  `RX_INT` (gap since the previous data packet, ms), `TX_INT` (gap in
  `Time_tx`). `combine` entries add hi + lo whenever either half arrives;
  the firmware splits GPS doubles into two floats.
- **Device address:** from discovery, else the packet source, else the
  profile's `address`. Name requests go there.
- **Only the profile's device is used** (`only_from_device`, default true when
  discovery is on or an address is set). Discovery requests don't name a
  device, and every device answers any request and then sends its data to
  whoever asked, so with the car and a UNO Q on one network their packets
  would mix. Packets from other senders are counted in `Status.Ignored`;
  until the device is found nothing is accepted and the UI says "Looking for
  device".
- **Rediscovery:** after the device is found, discovery repeats every 15 s.
  That keeps the device sending here if its address changes or it restarts.
  The cost: it also takes the stream from any other laptop watching the same
  device. Fixing that needs devices to check an id in the request.
- **Status states:** `listening` (no data yet), `receiving`, `stale` (no
  packet for `stale_after_s`), `error`, `stopped`.
- `Start` returns an error immediately if the port is busy. `Stop` waits
  until the port is free again.

## internal/config

See [configuration.md](configuration.md) for the user-facing side.

- `Locate` picks the folder: override (`--config` / `DAWG_CONFIG`), then a
  portable `dawg_config` next to the app, then the user config folder.
- `appDir` is the folder the user sees: the executable's folder, or the
  folder holding the `.app` bundle on macOS.
- `seed` writes missing top-level default files, and the default device
  profiles only when there is no `devices/` folder yet. Existing files are
  never overwritten, and deleted profiles stay deleted.
- YAML is decoded with `KnownFields(true)` so typos like `adress:` are
  reported. `LoadProfiles` reports broken files individually instead of
  failing them all; duplicate ids are rejected.
- `SaveDevice` rewrites only the `device:` line of `settings.yaml` so the
  user's comments and layout stay exactly as they were (re-encoding the YAML
  would drop blank lines).
- `OnlyFromDevice` is a `*bool` so "not set" can default to true.
- Writes go through a temp file and rename.

## internal/calib

Matches `Software/src/Calibration_Helpers.py` so constants carry over.

- `Linear`: `value * mult / div + add`, the form the firmware uses for CAN
  signals.
- `Steinhart`: fits `1/T = a + b·ln(R) + c·ln(R)³` through three
  (ADC, °F) points for a thermistor read through a divider with a fixed
  resistor, and converts ADC counts to °F. `thermistorToGround` matches the
  Python default (true). It returns NaN at the ADC rail. The 3×3 system is
  solved by Gaussian elimination with partial pivoting; the test checks the
  coefficients against an independent Cramer's-rule calculation and that the
  `RadTemp` points map back onto themselves.

## cmd/iltm-sim

Pretends to be the ILTM so the app can be tested without the car:

- answers `UGAMS_DISCOVER` on UDP 4999, then sends only to whoever asked;
- sends ITV telemetry (float32 values, id 0 = ms since start) to UDP 5002 and
  the name list every 10 s;
- accepts one command per TCP connection on 2002, reading up to 256 bytes or
  1 s like the firmware, and resends names on `Name_Sync_Req` (3).

Signal ids and names follow the ILTM's vehicle config. Ids 111 and 113 copy
the firmware's naming mistake (`PosLat_L`) so the app's rename fix gets
exercised. `RadTemp` is sent as raw ADC counts so the calibration is used.
