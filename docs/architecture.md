# Architecture

Dawg Viewer is one desktop program with two halves:

- a **Go backend** that owns networking, decoding, device configuration, and log loading, and
- a **React frontend** that owns viewer state, numerical analysis, and rendering.

They talk through Wails: the frontend calls Go methods, and Go pushes events
to the frontend.

## On the car

The ILTM logger (ESP32, `Firmware/ILTM_Module`) reads the CAN bus (ECU, SIM
boards) and a VectorNav IMU, gives every value a signal id, and:

- writes everything to `.bin` logs on its SD card;
- sends, about 50 times a second, a UDP packet holding every signal updated in
  the last 100 ms, plus the id → name list every 10 s;
- answers discovery, accepts commands on TCP 2002, and can run an HTTP file
  server for downloading logs.

The wire format is in [device-protocol.md](device-protocol.md).

## Data model

From wire to screen, data takes these shapes:

1. **Packet** — one UDP datagram of ITV fields `[id][type][value]`. Three
   kinds: data packets (float values), name packets (type `0x00`, mapping ids
   to names) and command packets (contain id 1, e.g. time-sync requests; the
   app ignores them).
2. **Signal id → channel name** — the device sends numbers; the backend keeps
   an id → name table learned from name packets, overridden by the profile's
   `rename` list, and cached to disk. After this step everything is keyed by
   channel name.
3. **Row** (`live.Row`) — one data packet after decoding, naming and
   calibrating:

   ```go
   type Row struct {
       T float64            // seconds since the session started (see timing below)
       V map[string]float64 // channel name → value, only channels this packet carried
   }
   ```

   One packet becomes exactly one row. When the packet carries the device's
   clock (`Time_tx`), `T` is that time mapped onto the session's clock;
   otherwise `T` is when the laptop received it. The status says which
   ("timing": `device` or `arrival`). Rows are sparse.
   On the way in, raw values are calibrated, computed channels are added
   (`Time_rx`, `RX_INT`, `TX_INT`, `RX_DELAY`, full-precision
   `PosLat`/`PosLong`/`PosAlt`)
   and fields with unknown ids are left out (the rest of the packet is kept).
4. **Frame** (`live.Frame`) — every row received since the previous frame,
   sent 20 times a second (`frame_rate`). Each packet stays its own row, so
   plots get full resolution.
5. **Channel** and **Status** — side information. A channel (name, signal id
   or -1 when computed, display settings) is announced when it first appears.
   Status (state, packet rate, last packet age, device address, unknown ids,
   ignored senders, errors) is sent twice a second.

## What runs in the backend

`services.LiveService` handles device/configuration calls and saved setups.
`services.LogService` handles downloads, conversion, and opening logs. LiveService owns one
`live.Session` at a time, for the selected device profile; switching devices
stops the session (freeing port 5002) before starting the next.

A session runs these goroutines:

| Goroutine | Waits on | Hands results over by |
|---|---|---|
| UDP listener (`link.ListenUDP`) | reading port 5002 | `packets` channel |
| discovery loop (`live.discoverLoop`) | a 1 s read deadline, then a 1 s or 15 s sleep | `found` channel |
| name request (one at a time) | TCP to the device, up to ~3 s | `nameReqErr` channel |
| **hub** (`hub.run`) | nothing — it only `select`s on the channels above and its timers | events to the frontend |

The hub does all the work for each packet: drop it if it isn't from the
profile's device, decode it, ignore commands, learn names, build the row. It
also emits a frame every 1/frame_rate s, a status every 0.5 s, and saves the
name cache every 2 s if it changed.

The live backend keeps **no telemetry history**: only the latest value per channel (needed
to rebuild the GPS values), the name table and rows not yet sent. Its memory
stays bounded by the live pipeline. Separately, opening a log retains a loaded
table in `internal/logdata` until its one-time URL is fetched.

## How backend and frontend talk

```
           Go                                       React
   LiveService  ◄── calls ──────────────────  Info() Status() Channels()
                                              Connect(id) Disconnect() Reload()
                                              OpenConfigFolder()
   session/hub  ─── live:frame    (20/s)  ──►  store.append(rows)
                ─── live:status   (2/s)   ──►  status bar
                ─── live:channels (on new) ──►  channel list
```

- **Calls** are ordinary Go methods. Wails generates TypeScript for them in
  `frontend/bindings/` (`just bindings`); the frontend awaits them like async
  functions. They're used for actions and for loading state on start-up.
- **Events** carry the data. The frontend subscribes once (`startLive` in
  `frontend/src/live/connection.ts`).

The frontend side is described in [frontend.md](frontend.md). In short, the
`LiveStore` turns sparse rows into equal-length columns, and plots, cards and
the follow controller read those columns directly on every frame without
going through React.

### One value, end to end

The car reads RPM from the ECU's CAN frame `0x5F0` and sends
`0B 04 <6500.0>`. The listener receives it; the hub checks the sender, decodes
it, looks up 11 → `RPM` and adds `{RPM: 6500}` to a row. Within 50 ms the next
frame carries that row to the frontend, which appends it to the `RPM` column;
the RPM card shows 6500 with a green border, and the plot extends and slides
to keep the last 30 s in view.

## Concurrency

The rule is **one owner per piece of data**; shared data is either handed
over and never touched again, or copied.

- **Each blocking operation gets its own goroutine** so nothing slow sits in
  the data path. A goroutine blocked on a socket doesn't hold an OS thread; Go
  parks it and runs others. A slow TCP name request can never hold up
  incoming telemetry.
- **The hub owns all session state**, so the data path needs no locks. Other
  goroutines only send it messages over channels.
- **Handing data out safely:**
  - `hub.flush` passes the `pending` slice to Wails and sets `pending = nil`;
    the hub never touches that slice again, so Wails can encode it on its own
    time.
  - Status is sent as a copy because the hub reuses its `UnknownIDs` and
    `Ignored` slices.
  - The listener reads into one reusable 64 KB buffer, so it copies each
    packet's bytes before passing them on.
- **Synchronization boundaries**, where state is shared:
  - `Session.mu` — the frontend can call `Status()` and `Channels()` at any
    time from Wails' goroutines; the hub stores a copy under the lock and
    those calls read the copy.
  - `LiveService.mu` — makes `Connect`, `Disconnect` and `Reload` run one at
    a time, so two quick clicks can't start two sessions or fight over the
    port.
  - `LogService.mu` tracks remote file-server ownership; `logdata.Store.mu`
    protects pending one-time table transfers. The table is removed under the
    lock before encoding, so only one request can claim it.
- **The frontend needs none of this**: JavaScript is single-threaded, so each
  event is handled to completion before the next.

The race detector runs in the tests and CI (`just test-race`).

## Memory

Live sessions usually contain five minutes or less of continuous data. At 50 Hz
with 60 channels plus time, five minutes represents about 7.32 MB of Float64
samples, before capacity overhead and derived channels. This is a workload
assumption, not a new retention limit. The configured row cap remains
`history_minutes × 60 × 60` (108,000 rows at the default 30 minutes); filling it
drops the oldest quarter.

The Live tab reads mutable store views directly. Watching live data in the Viewer
publishes an immutable snapshot at most once a second while that tab is visible.
A store revision prevents copies and analysis when no rows changed. Metadata-only
snapshot updates reuse the existing sample buffers.

CSV logs can be much larger. `logfile.Table.WriteColumns` sends a loaded table in
64 KiB chunks instead of allocating a second complete encoded matrix in Go.
The browser still fetches one full ArrayBuffer and creates zero-copy Float64
column views. Parsing, sorting, normalization, and frontend analysis remain
in-memory; streaming the transfer does not make arbitrarily large files cheap.
See [backend.md](backend.md) for the log transfer implementation.

## Timing: device clock vs arrival time

Over WiFi, packets arrive late and in bursts (the ESP32 queues them while
busy), so plotting rows at their arrival time distorts the time axis: a burst
of five packets 20 ms apart lands at one instant. When packets carry
`Time_tx` the hub places each row at the device's time instead:

- `timebase` keeps an offset with `T = Time_tx + offset`. A packet can only be
  delayed, never early, so `arrival − Time_tx` is the true offset plus that
  packet's delay; the smallest value seen is the best estimate. The offset
  follows new minimums immediately and may rise by at most 200 µs per second
  so it can follow clock drift between the ESP32 and the laptop (each is
  within ~50 ppm). A device clock jumping back more than 2 s or forward more
  than 60 s is a restart and resets the offset.
- Rows wait in the hub for 120 ms before they are sent, so packets that
  arrive out of order are sorted first. They are stamped when they leave the
  buffer, with the newest offset, which matters for bursts: the offset is
  only accurate once the burst's last packet has arrived.
- A row that would still go before one already sent is placed just after it
  and counted in the status as "late". `RX_DELAY` is each row's network delay
  above the minimum, useful for judging the WiFi link.

Packets without `Time_tx` (e.g. a relay that drops it) fall back to arrival
time with no buffering. Logs downloaded from the SD card always use the
logger's timestamps.
