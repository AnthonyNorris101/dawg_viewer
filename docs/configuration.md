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
  maps/                  map imagery downloaded for the track maps (written by the app, safe to delete)
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
defaults built into the app. Each built-in device profile is offered once: it
is copied into `devices/` the first time a version of the app that contains it
starts, and recorded in `cache/offered_devices.txt`. So a profile added in a
new release (like `base_station.yaml`) appears by itself, and a profile you
delete stays deleted. Deleting `cache/` makes the app offer the built-in
profiles you don't have once more. No existing file is ever overwritten, so
changes to a built-in profile you already have don't reach your copy.

## settings.yaml

| Key | Default | Meaning |
|---|---|---|
| `device` | `g26-iltm` | profile id to connect to on start; updated when you pick a device |
| `frame_rate` | 20 | live view updates per second (max 120) |
| `history_minutes` | 30 | live data kept for plots |
| `stale_after_s` | 2 | seconds without data before the status says "No new data" |
| `logs_dir` | `logs` | where downloaded logs go (relative to the config folder) |
| `csv_rate_hz` | 100 | samples per second of `_Normalized.csv` and of `.bin`/long-CSV logs opened in the Viewer (1–1000) |
| `live_backup` | `true` | while connected, also save every received value to `<date>_<time>_live_<device>.csv` (when recording started, UTC) in `logs_dir`; `false` turns it off. The **Backup log** checkbox in the Live tab changes this line. |
| `map_sources` | none | extra map backgrounds for the track maps, or replacements for the built-in ones; see [Map backgrounds](#map-backgrounds) |
| `track_search` | Overpass on, name search off | where the simulator looks for track outlines online; see [Track search](#track-search) |

When the app saves `device`, it rewrites only that line so your comments and
layout stay as they are.

### Map backgrounds

The track maps can draw imagery under the GPS trace. Two sources are built in:

| Id | Shown as | Imagery |
|---|---|---|
| `satellite` | Satellite (USA) | USGS National Map aerial photography (NAIP Plus). United States only. |
| `streets` | Street map | OpenStreetMap |

Nothing is downloaded until someone picks a background from a map's **Map**
menu. The app then fetches only the tiles the map is showing and saves each
one as `maps/<id>/<zoom>/<x>/<y>.tile` in the config folder. A saved tile is
never fetched again, so a place you have looked at keeps working offline.
Delete `maps/` (or one source's folder) to free the space or to pick up newer
imagery.

`map_sources` adds tile servers, or replaces a built-in one when it reuses
that id:

```yaml
map_sources:
  - id: team-imagery
    name: Team imagery
    url: https://tiles.example.com/{z}/{x}/{y}.jpg
    max_zoom: 19
    attribution: Imagery © Example
```

| Key | Meaning |
|---|---|
| `id` | 1–32 lowercase letters, digits, `-` or `_`; also the folder name under `maps/` |
| `name` | label in the **Map** menu (defaults to the id) |
| `url` | `http://` or `https://` address containing `{z}`, `{x}` and `{y}` (standard Web Mercator tile numbers), or `{bbox}` for servers that take a Web Mercator (EPSG:3857) bounding box as `xmin,ymin,xmax,ymax` |
| `max_zoom` | deepest zoom level to request, 0–22 (default 19) |
| `attribution` | credit line drawn in the corner of the map |

Tiles must be 256 px images. A source that fails validation is reported with
the other settings errors and left out; the rest still load. Check a tile
server's terms before adding it: many commercial imagery services need an API
key or do not allow their tiles to be stored.

### Track search

The simulator's Lap page can fetch a track outline from OpenStreetMap. Nothing is sent until someone presses a search button there.

```yaml
track_search:
  geocoder: https://nominatim.openstreetmap.org/search
  overpass:
    - https://overpass-api.de/api/interpreter
    - https://overpass.private.coffee/api/interpreter
```

| Key | Default | Meaning |
|---|---|---|
| `overpass` | the two servers above | [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) servers asked for the ways tagged `highway=raceway` in an area, tried in order until one answers. `overpass: []` turns every online lookup off. |
| `geocoder` | empty (name search off) | a [Nominatim](https://nominatim.org/)-style search address that turns a typed name into a place. Without it only **Search around the open log** works. |

Name search is off by default on purpose. The public Nominatim server has a [usage policy](https://operations.osmfoundation.org/policies/nominatim/) that whoever turns it on is responsible for following. Read it before adding the `geocoder` line. In short it asks for:

- no more than one request a second, counted across everyone using the app;
- searches started by a person only: no automatic, repeated or bulk lookups and no search-as-you-type;
- a `User-Agent` that identifies the app;
- results to be cached;
- OpenStreetMap to be credited;
- no personal or confidential data in the search text;
- acceptance that access can be withdrawn at any time.

The app is built to that: a lookup runs only on a button press, requests are spaced at least 1.1 s apart, each carries `DawgViewer/<version>` as its `User-Agent`, every answer is kept for 30 days as `track-search/<hash>.json` in the config folder and reused instead of asking again, the results list credits OpenStreetMap, and a server that answers 403, 406 or 429 is reported and left alone for 30 s. Removing the `geocoder` line, or setting `overpass: []`, switches the feature off without a new build.

The public Overpass servers are shared services with their own rules, listed with each server on the [Overpass API page](https://wiki.openstreetmap.org/wiki/Overpass_API). The main one (`overpass-api.de`) asks apps to identify themselves, cache answers, stay far below 10,000 requests and 1 GB a day counted across all users, and wait 30 s after a 429 or 406; it also warns that it is often overloaded, which is why a second server is tried. A few searches by a team are well inside that. Point `overpass` at another instance if the team has one.

Each address must start with `http://` or `https://`; anything else is reported with the other settings errors and online lookups stay off until it is fixed.

## Device profiles

| Key | Meaning |
|---|---|
| `id`, `name` | unique id (used in `settings.yaml`) and display name |
| `address` | device IP; optional, used if discovery and telemetry don't reveal it |
| `accepted_addresses` | optional additional telemetry source IPs for a device with multiple known addresses; these do not replace discovery |
| `telemetry.listen` | UDP address the app listens on (default `0.0.0.0:5002`) |
| `telemetry.only_from_device` | only use data from this device (default true); see below |
| `discovery.enabled`, `port`, `request`, `device_id` | discovery settings; `device_id` must match the device's reply |
| `commands.port` | TCP command port (2002) |
| `commands.pad_to` | zero-pad commands to this many bytes; see below |
| `commands.name_sync` | which command asks the device to resend names |
| `commands.list` | named commands: `{ id, data, description }` |
| `fileserver` | the logger's HTTP file server: `port` (80), `logs_dir` (`/logs`), and the `enable`/`disable` command names. Leave it out for devices without one; the Logs tab then says there are no logs to download. |
| `rename` | signal id → name, overriding what the device sends |
| `combine` | `{ name, hi, lo }`: add two channels into one |
| `calibrations` | channel name → `linear` (mult/div/add), `poly` (`coeffs` a₀…aₙ, value = a₀ + a₁·raw + …; optional `points` and `degree` it was fitted from), `table` (`points` [[raw, value], …], straight lines between them), `steinhart_f` (3 points, r_fixed, adc_max) or `gear` (gear-position sensor ADC → gear; see below) |
| `channels` | channel name → `label`, `unit`, `precision`, `color` (`#rrggbb`), `group` (heading in the channel list), `pos` (`[x, y]` spot on the car map, 0–1 from the left and from the front), `pinned`, `large`, `order`, `warn_min/max`, `crit_min/max` |
| `car` | car specs for the analysis tools: `mass`, `wheelbase`, `cg_height`, `rear_weight` (0–1), `tire_radius`, `tire_mu`, `primary`, `gears` (list), `final_drive`, `redline`, `launch_gear`, `slip_low`, `slip_high` (0–1), `target_g`, `cla` and `cda` (m², 0 = no aero), `aero_front` (front share of downforce, 0–1), `air_density` (kg/m³). Missing values use typical FSAE numbers, except `cla`, `cda` and `target_g`, where 0 means not set. The simulator adds more keys; see [Simulator inputs](#simulator-inputs). |

Unknown keys are reported as errors (catches typos). A broken profile is
listed in the app instead of stopping the others from loading.

### Why `only_from_device`

Discovery requests don't name a device, and every device answers any request
and then sends its data to whoever asked. With the car and a UNO Q on one
network, both would send to the laptop and their packets would mix. With the
option on, only the device that answered with the profile's `device_id` (or
sends from `address`) is used. Turn it off only when discovery can't work on
the network and the address isn't known.
On a computer with several network adapters, a matching device may answer
discovery from more than one address. The app accepts telemetry from each
matching address and uses the address that sends data for subsequent commands.

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

### Adding the file server to an existing config

Config folders created before the Logs tab existed have no `fileserver`
section, because existing files are never overwritten. Add this to
`devices/g26_iltm.yaml` (or delete the `devices/` folder to get fresh
defaults):

```yaml
fileserver:
  port: 80
  logs_dir: /logs
  enable: Enable_FileServer
  disable: Disable_FileServer
```

For `devices/uno_q_sim.yaml` use `port: 8080`, and add the two commands to
`commands.list` if they aren't there:

```yaml
    Enable_FileServer:  { id: 6, data: 1 }
    Disable_FileServer: { id: 6, data: 0 }
```

### Fitted calibrations (`poly`, `table`)

The channel editor's "Known points" mode saves the points you entered along
with the fit, so they can be edited again later:

```yaml
calibrations:
  OilPres: { type: poly, coeffs: [-10.5, 0.026, -1.2e-06], degree: 2, points: [[400, 0], [1200, 21], [2400, 48], [3600, 70]] }
  FuelLevel: { type: table, points: [[400, 0], [1200, 21], [2400, 48], [3600, 70]] }
```

Written by hand, a `poly` with `points` and `degree` but no `coeffs` is fitted
(least squares) when the profile loads. A `table` carries its first and last
lines on beyond the end points rather than clamping, so an out-of-range
reading still moves.

### The `gear` calibration

Turns the gear-position sensor's 12-bit ADC reading (`GearRaw`, SIM input on
CAN 213 bytes 2–3) into a gear number. The ranges are fixed in
`gearFromADC` in `internal/config/config.go`:

| ADC reading | Gear |
|---|---|
| 386–684 | 1 |
| 685–1064 | 0 (neutral) |
| 1065–1334 | 2 |
| 1335–2013 | 3 |
| 2014–2465 | 4 |
| 2466–2999 | 5 |
| 3000–3688 | 6 |

Anything else gives no value: the sample is dropped rather than shown as a
wrong gear (a disconnected or shorted sensor reads near 0 or 4095). Neutral
sits between 1 and 2, as on the shifter. Like other calibrations it applies to
the live view, `_Normalized.csv` and logs opened in the Viewer, not to the raw
long CSV. To change the ranges, edit `gearFromADC` and its test
(`TestGearCalibration`).

### Simulator inputs

The app comes with a set of G26 car values (`internal/config/stock/car.yaml`
in the source, with a note on where each came from). A `car:` key that is
missing or 0 in the profile uses the stock value when there is one, and the
typical value in the tables otherwise. The Car tab tags the first "G26 stock"
and the second "typical", and leaves both out of the profile on Save until
they are changed.

The Sim tab reads these extra keys from the profile's `car:` section. The Car
tab writes them, so editing the YAML by hand is optional. Its **Import car
values…** button copies the `car:` block of another device file onto the page,
which is how one car's numbers are carried to another computer or profile. A key that is
missing or 0 uses the value in the last column.

| Key | Meaning | If missing |
|---|---|---|
| `torque` | engine torque curve at the crank, full throttle: `[[rpm, N·m], ...]`, at least two points, RPM above 0 | a stand-in restricted 600 cc curve, which the app labels as not yours |
| `drive_eff` | share of crank torque that reaches the tires, 0–1 | 0.9 |
| `shift_time` | seconds with no drive during an upshift | 0.12 |
| `launch_rpm` | engine speed held while the clutch slips off the line | the RPM of peak torque |
| `tire_mu_lat` | sideways tire grip; `tire_mu` is then used for braking and traction only | same as `tire_mu` |
| `tire` | Magic Formula coefficients by their MF 5.2 names in lowercase, for example `{fnomin: 700, pcy1: 1.4, pky1: 30}`. Recognised: `fnomin`; `pcy1`, `pdy1`, `pdy2`, `pey1`, `pey2`, `pky1`, `pky2`, `pky4`, `alpmax` (cornering, with the largest trusted slip angle in radians); `ppy1`–`ppy4`, `nompres`, `inflpres` (pressure terms, nominal and running pressure in Pa); `pcx1`, `pdx1`, `pdx2`, `pex1`, `pex2`, `pkx1`, `pkx2`, `pkx3` (drive and brake); `rbx1`, `rbx2`, `rcx1`, `rby1`, `rby2`, `rcy1` (combined slip). The Car tab writes this, including from an imported `.tir` file. | each missing coefficient is built from `tire_mu`, `tire_mu_lat` and `tire_load_grip`, with typical shape and stiffness values |
| `tire_load_grip` | share of its grip a tire keeps when its load doubles, 0–1 (1 = grip does not fall with load; FSAE slicks are about 0.85–0.92) | 0.9 |
| `roll_res` | rolling resistance coefficient | 0.02 |
| `track_front`, `track_rear` | track widths, m | 1.2, 1.15 |
| `spring_front`, `spring_rear` | spring rates, N/mm | 35, 44 |
| `motion_front`, `motion_rear` | motion ratios, spring travel ÷ wheel travel | 0.9 |
| `arb_front`, `arb_rear` | anti-roll bar roll stiffness, N·m/deg | 0 (no bar) |
| `rc_front`, `rc_rear` | roll center heights, m | 0 (on the ground) |
| `unsprung_front`, `unsprung_rear` | unsprung mass per corner, kg | 9, 10 |
| `tire_rate` | tire vertical stiffness, N/mm | 110 |

`mass` is the car with the driver. Because 0 means "not set", a value that
has a non-zero default cannot be set to exactly 0.

### Saved setups (`presets/`)

A setup is a view: the Viewer's sheets, plots and made channels, the
start/finish line, and the launch, Sim, damper and split settings. Each one
is `presets/<name>.json` in the config folder. The app writes the setup in
use back to its file as you work, so the file always matches the screen.
Copy these files to share a setup with the team; delete one to remove it.
Car values are not in a setup; they stay in the device profile.

### Sample log

The first time the app uses a config folder it writes `Run-1 sample.csv` into
the logs folder and notes that in `cache/offered_sample.txt`. Deleting the
log is enough to be rid of it; it is not written again.

### Session (`session.json`)

`session.json` in the config folder is written by the app. It holds which
setup is in use, the last log opened, the unnamed view (the view that is not
a setup), and small choices such as the map background and the Live tab
layout. The app reads it when it starts, so the same config folder gives the
same view on another computer or after a reinstall. It is safe to delete:
the app then starts with the premade sheets and no setup in use, and the
setups in `presets/` are untouched.

The first time a version with `session.json` runs, it copies the view it
finds in the app's own browser storage into the file. After that the file
is what counts and the browser storage is only a working copy.

### Saved tracks (`tracks/`)

**Save track** on the simulator's Lap page writes the track on screen as
`tracks/<name>.json` in the config folder: its sections or outline points,
whether it is a closed loop, its width and its smoothing. Copy these files to
share a track with the team; delete one to remove it. Answers from online
track searches are kept apart, in `track-search/`, and can be deleted at any
time.

### Editing a profile from the app

The ✎ button on a channel (Live and Viewer channel lists) and the Car tab
write to the selected device's profile. They change only the lines they own,
so comments and hand formatting elsewhere survive:

- the channel's line under `channels:` is replaced by one flow-style line
  (`{ label: …, unit: …, color: …, group: … }`) keeping its other keys;
- its line under `calibrations:` is replaced, added or removed;
- the whole `car:` block is rewritten.

A missing section is appended at the end of the file. The edited text is
loaded with the same strict decoder before it is written, so an edit that
would break the profile is refused and nothing is saved. New calibrations
reach a running live session straight away (`Session.SetCalibrations`) without
reconnecting; logs pick them up the next time they are opened (see the Viewer
notes in [frontend.md](frontend.md) for wide CSVs).

Channels with no `group` are grouped by name: Accel*/Yaw → Accelerometer,
RPM/TPS/CLT/Oil/AFR/Gear/BatV → Engine, FBPS/RBPS → Brakes, PosLat/PosLong →
GPS, damper/shock/travel → Suspension, VSS/Speed → Vehicle, StrAngle →
Driver (`frontend/src/data/groups.ts`).

Channels with no `pos` are put on the car map by name in the same way
(`frontend/src/data/sensors.ts`); dragging a dot in the Car tab writes `pos`.
