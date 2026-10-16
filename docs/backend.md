# Backend

The Go code is split into packages that each depend only on the ones below:

```
main.go          starts Wails, reads --config
services/        what the frontend can call; thin
internal/live    a session: packets → rows, status, frames
internal/link    network I/O only
internal/itv     the wire encoding
internal/config  config folder, settings, device profiles, name cache
internal/logfile SD-card .bin logs → CSV, 100 Hz tables, CSV loading
internal/fileserver HTTP client for the logger's file server
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
- `target()` gives other services the selected profile, the device's address
  (from the live session, else the profile's `address`) and the logs folder.

`LogService` backs the Logs tab and the Viewer tab:

- `RemoteLogs` sends the profile's `fileserver.enable` command (once per
  device), then lists `.bin` and `.csv` files. It retries the listing for a few seconds
  because the logger's HTTP server takes a moment to start.
- `Download` saves each file into `logs_dir`; for `.bin` files it runs
  `logfile.Convert`, which writes the long CSV and the `_Normalized.csv`
  (100 Hz). `.csv` files are kept as they are. Progress goes out as
  `logs:progress` events.
- `FinishRemote` sends `fileserver.disable`. While the file server is on the
  firmware stops logging and disables CAN, so this is called when the Logs
  tab closes and when the app shuts down.
- `Load` reads a file with `logfile.Load`, using the selected profile's
  renames, calibrations and `combine` list and `csv_rate_hz`. It returns only
  metadata (name, rows, channel names and units, a note on how it was
  processed) plus a one-time `dataUrl`. The columns themselves are packed into
  one little-endian float64 block — time, then each channel — and served from
  that URL by `LogDataMiddleware` on the app's asset server. The block is
  deleted once fetched (at most two are kept). This avoids base64 inside JSON,
  which made a 724,000-row CSV a 131 MB string; float64 keeps GPS values
  exact.
- `LocalLogs`, `ConvertLocal`, `PickFile` (native file dialog),
  `LogsFolder`, `OpenLogsFolder`.

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

## internal/logfile

Reads the ILTM's SD-card logs (`Firmware/ILTM_Module/DataLogger.h`, version 2)
and any CSV log, and turns them into CSVs and tables for the viewer.

### Decoding `.bin`

- **Header:** `0xDEADBEEF`, version byte, signal count, then `[id][len][name]`
  per signal. Only version 2 is read (what the current firmware writes); the
  version 1 logs in the Archive aren't supported.
- **Body:** COBS frames ending in `0x00`, each holding up to 56 nine-byte
  entries (`u32 ms`, `u8 id`, `f32`) plus a CRC32 of the entry bytes. A frame
  that fails COBS, length or CRC checks is skipped; the rest is still read.
- **CRC:** the firmware feeds `esp_crc32_le` a seed of `0xFFFFFFFF` and XORs
  the result with `0xFFFFFFFF`, which is CRC-32 with initial value 0 and no
  final XOR: `^crc32.Update(0xFFFFFFFF, crc32.IEEETable, data)`. The Python
  app XORed the standard CRC with a constant, which only matches full
  56-entry blocks.
- `Encode` writes the same format; the tests and the simulators use it.

### The two CSVs made from a `.bin` (`Convert`)

- `<name>.csv` — the long CSV the Python app made:
  `timestamp_ms,id,signal,value`, one row per logged value, names after the
  profile's `rename`, `UNKNOWN_<id>` for ids missing from the header. Values
  are **as logged** (no calibration) and written with the shortest decimal
  that reproduces the float32 exactly. Python wrote 4 decimals, which cut GPS
  to about 11 m.
- `<name>_Normalized.csv` — one column per channel on an even time grid
  (`csv_rate_hz`, 100 by default). Calibrations from the profile are applied
  and `combine` channels (full-precision `PosLat`, `PosLong`, `PosAlt`) are
  added, so values match the live view. Logged channels are written at
  float32 precision; combined channels at full float64 precision.

`Normalize` interpolates linearly in time between each channel's samples and
holds the first/last value at the edges. Columns are sorted by name; two ids
with the same name become `Name_<id>`; where several samples share a
timestamp the last one wins. The Python version reindexed onto the grid and
kept only samples that landed exactly on a grid timestamp, then interpolated
by row position; this uses every sample and interpolates by time. A log whose
timestamps would need more than 5 million grid rows (bad timestamps) is
rejected instead of exhausting memory.

### Loading for the viewer (`Load`)

| File | What happens |
|---|---|
| `.bin` | decoded, renamed, calibrated, combined and resampled like `_Normalized.csv` |
| long CSV (`timestamp_ms,id,signal[_name],value`) | calibrated, combined and resampled |
| any other CSV | used as is: first column is time, the rest are channels |

Calibrations are only applied to the first two, which hold raw logged values;
a wide CSV such as `_Normalized.csv` has already been processed.

Wide CSVs are read leniently because the Archive holds several layouts:

- **Delimiter:** comma, tab or semicolon, whichever the header uses most.
  With semicolons, decimal commas (`90,25`) are accepted, as Excel writes them
  in many locales. A byte-order mark is ignored.
- **Columns:** empty names become `Column N`, duplicates get ` (2)`, ` (3)`.
  Columns with no numbers (e.g. `source`) are dropped. Empty cells are filled
  from the previous value, then the next.
- **Units row:** a non-numeric row straight after the header is read as
  units and shown in the viewer.
- **Time:** numbers or ISO date-times. Milliseconds if the values are epoch
  milliseconds (above 1e11), the header contains "ms", the units row says
  `ms`, or the times are ISO; otherwise seconds. Rows are sorted by time.
- **Broken time columns:**
  - If the times mix two clocks (some seconds-since-boot, most epoch ms),
    only rows on the majority clock are kept.
  - Rows outside Tukey's fences — more than 3 interquartile ranges beyond the
    middle half, with at least a minute of slack — are dropped as corrupt.
  - If the time column has fewer distinct values than 1% of the rows (the
    Log46 files were exported with float32 epoch ms, leaving 2–4 distinct
    values), rows are shown in file order and the time axis counts rows.

  Each of these sets `Table.Note`, which the viewer shows next to the file
  name.

Tests: frames built with a literal port of the firmware's COBS and CRC code;
`Encode` byte-identical to that; normalization, calibration, combining,
precision of the written values, the row limit, `Convert`, every CSV layout
found in the Archive (including the broken time columns), and error cases.

## internal/fileserver

Client for the logger's HTTP server (`Firmware/ILTM_Module/FileServer.h`):
`List` (`GET /files?dir=`) and `Download` (`GET /download?name=`). The
firmware adds the leading `/` to `name` itself, so it is sent without one.
Names in the listing are reduced to the base name because older ESP32 cores
return full paths. Downloads go to a `.part` file that is renamed when
complete, and a short body is treated as an error.

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
  1 s like the firmware, and resends names on `Name_Sync_Req` (3);
- generates three 60 s logs in a temp folder at start-up and serves them
  like the firmware's file server on `-http-port` (default 80) while
  command 6 is on.

Signal ids and names follow the ILTM's vehicle config. Ids 111 and 113 copy
the firmware's naming mistake (`PosLat_L`) so the app's rename fix gets
exercised. `RadTemp` is sent as raw ADC counts so the calibration is used.
