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

## Relaying (UNO Q between the car and the pits)

A relay can forward the car's UDP datagrams byte-for-byte; the app doesn't
care which device sent them. Give the relay its own profile so it can have
its own discovery id, and if the relay doesn't forward the name-sync command
back to the car, make sure name packets keep flowing (the ILTM sends one
every 10 s).
