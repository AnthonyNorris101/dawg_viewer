# Configuration

All configuration is plain YAML in one folder. The app's **Open config
folder** button shows where it is. The default files carry comments
explaining each setting, because they're copied into users' folders where
these docs aren't available.

```
<config folder>/
  settings.yaml          app settings
  devices/*.yaml         one profile per device
  cache/*.names.yaml     signal names last learned from each device (written by the app, safe to delete)
  README.txt             what's in the folder and where the app looks for it
```

## Where the folder is

Checked in this order:

1. `--config <folder>` or the `DAWG_CONFIG` environment variable;
2. a `dawg_config` folder next to the app (next to the `.app` bundle on
   macOS) — the portable option; the release zips ship with one;
3. the user config folder: `%AppData%\DawgViewer`,
   `~/Library/Application Support/DawgViewer`, `~/.config/DawgViewer`.

Whichever folder is used, missing top-level files are filled in from the
defaults built into the app. Default device profiles are only written when
there is no `devices/` folder yet, so a profile you delete stays deleted. No
existing file is ever overwritten.

## settings.yaml

| Key | Default | Meaning |
|---|---|---|
| `device` | `g26-iltm` | profile id to connect to on start; updated when you pick a device |
| `frame_rate` | 20 | live view updates per second (max 120) |
| `history_minutes` | 30 | live data kept for plots |
| `stale_after_s` | 2 | seconds without data before the status says "No new data" |
| `logs_dir` | `logs` | where downloaded logs go (relative to the config folder) |

When the app saves `device`, it rewrites only that line so your comments and
layout stay as they are.

## Device profiles

| Key | Meaning |
|---|---|
| `id`, `name` | unique id (used in `settings.yaml`) and display name |
| `address` | device IP; optional, used if discovery and telemetry don't reveal it |
| `telemetry.listen` | UDP address the app listens on (default `0.0.0.0:5002`) |
| `telemetry.only_from_device` | only use data from this device (default true); see below |
| `discovery.enabled`, `port`, `request`, `device_id` | discovery settings; `device_id` must match the device's reply |
| `commands.port` | TCP command port (2002) |
| `commands.pad_to` | zero-pad commands to this many bytes; see below |
| `commands.name_sync` | which command asks the device to resend names |
| `commands.list` | named commands: `{ id, data, description }` |
| `rename` | signal id → name, overriding what the device sends |
| `combine` | `{ name, hi, lo }`: add two channels into one |
| `calibrations` | channel name → `linear` (mult/div/add) or `steinhart_f` (3 points, r_fixed, adc_max) |
| `channels` | channel name → `label`, `unit`, `precision`, `pinned`, `large`, `order`, `warn_min/max`, `crit_min/max` |

Unknown keys are reported as errors (catches typos). A broken profile is
listed in the app instead of stopping the others from loading.

### Why `only_from_device`

Discovery requests don't name a device, and every device answers any request
and then sends its data to whoever asked. With the car and a UNO Q on one
network, both would send to the laptop and their packets would mix. With the
option on, only the device that answered with the profile's `device_id` (or
sends from `address`) is used. Turn it off only when discovery can't work on
the network and the address isn't known.

### Why `pad_to: 256` for the ILTM

The firmware reads a command with `readBytes(buf, 256)`, which waits for 256
bytes or 1 s before acting, and that pauses its WiFi telemetry. Padding to 256
bytes makes it act at once. Zero padding decodes as empty id-0 names, which
the firmware ignores. Set it to 0 to send unpadded commands like the old
Python app.

### Why the ILTM profile renames 111/113/115

The firmware names ids 111, 113 and 115 all `PosLat_L`; they are the low
halves of latitude, longitude and altitude. The `combine` entries then rebuild
full-precision `PosLat`, `PosLong`, `PosAlt`.
