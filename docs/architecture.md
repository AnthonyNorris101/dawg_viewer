# Architecture

Dawg Viewer is one desktop program with two halves:

- a **Go backend** that does all networking, decoding and state, and
- a **React frontend** that only displays.

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
       T float64            // seconds since the session started, laptop clock
       V map[string]float64 // channel name → value, only channels this packet carried
   }
   ```

   One packet becomes exactly one row. `T` is when the laptop received it;
   the device's own clock is kept as the `Time_tx` channel. Rows are sparse.
   On the way in, raw values are calibrated, computed channels are added
   (`Time_rx`, `RX_INT`, `TX_INT`, full-precision `PosLat`/`PosLong`/`PosAlt`)
   and fields with unknown ids are left out (the rest of the packet is kept).
4. **Frame** (`live.Frame`) — every row received since the previous frame,
   sent 20 times a second (`frame_rate`). Each packet stays its own row, so
   plots get full resolution.
5. **Channel** and **Status** — side information. A channel (name, signal id
   or -1 when computed, display settings) is announced when it first appears.
   Status (state, packet rate, last packet age, device address, unknown ids,
   ignored senders, errors) is sent twice a second.

## What runs in the backend

`services.LiveService` is the only thing the frontend talks to. It owns one
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

The backend keeps **no history**: only the latest value per channel (needed
to rebuild the GPS values), the name table and rows not yet sent. Its memory
stays flat however long it runs.

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
- **Only two mutexes**, where state really is shared:
  - `Session.mu` — the frontend can call `Status()` and `Channels()` at any
    time from Wails' goroutines; the hub stores a copy under the lock and
    those calls read the copy.
  - `LiveService.mu` — makes `Connect`, `Disconnect` and `Reload` run one at
    a time, so two quick clicks can't start two sessions or fight over the
    port.
- **The frontend needs none of this**: JavaScript is single-threaded, so each
  event is handled to completion before the next.

The race detector runs in the tests and CI (`just test-race`).

## Memory

The live chart history is capped at `history_minutes × 60 × 60` rows (108,000
at the default 30 minutes; about 50 MB with the ILTM's ~55 channels). When it
fills, the oldest quarter is dropped. The cap is by rows, so a faster device
gets less time in the same memory. In a 20× speed test (≈980 packets/s) the
frontend heap levelled off around 45 MB and the backend around 140 MB.
