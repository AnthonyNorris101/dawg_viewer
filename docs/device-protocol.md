# Device protocol

What a device (the ILTM, or an Arduino UNO Q relaying or simulating it) has to
do for Dawg Viewer to show its data live. This is the protocol implemented by
`Firmware/ILTM_Module`; `cmd/iltm-sim` in this repo is a working example.

All multi-byte numbers are little-endian. Ports below are the defaults; each
is set in the device's profile (`devices/*.yaml`).

## 1. Telemetry — required

Send UDP datagrams to the computer on port **5002**. Each datagram is a
sequence of ITV fields:

```
[id u8][type u8][value]
```

| type | value                      | size     |
|------|----------------------------|----------|
| 0x00 | name: `[len u8][utf-8]`    | 1 + len  |
| 0x01 | u8                         | 1        |
| 0x02 | u16                        | 2        |
| 0x03 | u32                        | 4        |
| 0x04 | float32                    | 4        |
| 0x05 | string: `[len u8][utf-8]`  | 1 + len  |
| 0x06 | bool                       | 1        |
| 0x07 | command (u8)               | 1        |
| 0x08 | u64                        | 8        |

- **Data packets** carry the latest value of each signal as float32
  (`0x04`). The ILTM sends every signal updated in the last 100 ms, 20–50
  times a second. A signal missing from a packet keeps its previous value in
  the app.
- **Id 0** is the sender's clock in milliseconds (`Time_tx`). Include it in
  each data packet; the app derives `TX_INT` from it.
- **Ids 1–9 are reserved.** A packet containing id 1 is treated as a
  command, not data.
- **Name packets** map ids to channel names with type `0x00` fields, e.g.
  `0B 00 03 'R' 'P' 'M'` names id 11 "RPM". Send one at start-up and then
  every ~10 s. Values for ids without a name are held back (the app shows
  "waiting for names") until a name arrives. The app caches names per device,
  so a device only has to send them once.

Example data packet, RPM (id 11) = 6500 and Time_tx = 1000 ms:

```
0B 04 00 20 CB 45   00 04 00 00 7A 44
```

Keep datagrams under 1400 bytes so they aren't fragmented.

## 2. Discovery — optional, recommended

The app broadcasts the text `UGAMS_DISCOVER` to UDP port **4999** about once
a second until it gets an answer, then every 15 s. Reply to the source
address and port of the request with JSON:

```json
{"type":"UGAMS_DATA","id":"UNOQ-SIM","port":5000,"firmware":"0.1.0"}
```

`id` must match `discovery.device_id` in the profile. After answering, send
telemetry to the address that asked instead of broadcasting it. Without
discovery the device has to broadcast (255.255.255.255:5002) or be configured
with the computer's address.

## 3. Name-sync command — optional

When it sees ids it has no name for, the app connects by TCP to the device on
port **2002**, sends

```
01 07 03   02 01 00
```

(command id 3 = Name_Sync_Req, data 0), optionally zero-padded to
`commands.pad_to` bytes, and waits for the device to close the connection.
Answer by sending a name packet to the telemetry port. If the device doesn't
implement this, the periodic name packets are enough.

## 4. File server — optional, for the Logs tab

Command 6 turns an HTTP server on (data 1) and off (data 0), sent the same way
as the name-sync command. The app sends 6/1 when the Logs tab connects and 6/0
when the tab closes or the app quits. The ILTM uses port 80; the UNO Q profile
and `tools/uno_q_sim.py` use 8080, since ports below 1024 need root on Linux.

| Request | Response |
|---|---|
| `GET /files?dir=/logs` | JSON array of file names in the logs folder, e.g. `["2026-10-16_12-00-00_data1.bin"]` |
| `GET /download?name=logs/<file>` | the file's bytes, with `Content-Length` |

- `.bin` files must use the SD-card log format below; the app converts them
  to CSV after downloading. `.csv` files are saved as they are.
- Name files `YYYY-MM-DD_HH-MM-SS_data<N>.<ext>` (UTC) so the app can show the
  date and sort by `N`; other names still work.

### SD-card log format (version 2)

All little-endian.

```
header   u32 0xDEADBEEF, u8 version (2), u8 signal count,
         then per signal: u8 id, u8 name length, name bytes
frames   repeated: COBS-encoded block, then a 0x00 byte
block    up to 56 entries of { u32 timestamp_ms, u8 id, f32 value }
         followed by u32 CRC
```

The CRC is CRC-32 (polynomial 0xEDB88320) over the entry bytes with initial
value 0 and no final XOR. In Python that's
`zlib.crc32(data, 0xFFFFFFFF) ^ 0xFFFFFFFF`; in Go,
`^crc32.Update(0xFFFFFFFF, crc32.IEEETable, data)`. A frame with a bad CRC is
skipped. `tools/uno_q_sim.py` (`encode_log`) writes exactly this format.

## Relaying (UNO Q between the car and the pits)

A relay can forward the car's UDP datagrams byte-for-byte; the app doesn't
care which device sent them. Give the relay its own profile so it can have
its own discovery id, and if the relay doesn't forward the name-sync command
back to the car, make sure name packets keep flowing (the ILTM sends one
every 10 s).
