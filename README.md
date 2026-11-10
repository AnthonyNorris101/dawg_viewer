# Dawg Viewer

Desktop app for the UGA Motorsports data logger (ILTM). Replaces the Python
app in `FSAE_Data_Acquisition/Software`. Runs on Windows, macOS and Linux.

Done:
  - [x] live data view, with a live track map and lap timer.
  - [x] log/csv download.
  - [x] csv data viewer.
  - [x] Pi Toolbox-style analysis in the viewer: worksheets, laps from a GPS
        start/finish line, lap overlays against distance with time slip,
        math channels, XY (G-G) plots, histograms, track maps, statistics.
  - [x] more layouts and savable/premade presets (worksheets, export/import).
  - [x] spectrum (FFT) panel, lowpass/highpass filters, G-G envelope, launch
        and wheel-slip analysis, GPS gap filling from speed and heading.
  - [x] edit channel titles, colours, groups and ADC calibrations from the app;
        Car tab for car specs. Both save to the device profile.
  - [x] car map under the channel list that shows where each sensor is;
        dots can be moved with ✎ Edit next to the map.
  - [x] aero inputs in the Car tab and an Aero panel: grip against speed
        compared with what the tyres and the aero should give.
  - [x] − / + zoom on each plot; y axes ignore spikes and zoom with the wheel.
  - [x] polynomial and known-point (curve fit) calibrations, with a graph of
        the fit in the channel editor.
  - [x] Test mode: a simulated car for trying the app without the logger.
  - [x] filtered channels (low/high/band-pass, band-stop) made from the channel
        list or a spectrum, with a preview of what the filter keeps.
  - [x] saved setups (sheets, plots, made channels) in the config folder, and
        a start-up choice between last session, a saved setup or fresh.
  - [x] live data in the Viewer: every sheet and panel on the incoming stream.
  - [x] compare runs: save a G-G envelope or aero grip curve and overlay it on
        any other log or live data, with the difference worked out.
  - [x] live data placed by the logger's clock (Time_tx) when it's sent.
  - [x] lap setup: laps from a start/finish line, separate start and finish
        lines, standing starts (acceleration runs) or only hand-placed marks.


Check out the docs for information, if you are making commits to the project
ensure that your changes make their way in as well. [docs/](docs/README.md).

## Using it

1. Join the same network as the logger.
2. Start Dawg Viewer and pick the device at the top of the **Live** tab.

The app finds the logger by itself (UDP discovery), learns channel names from
it and shows the data. Pinned channels appear as cards; pick channels from the
list on the left to plot them. Scroll on a plot to zoom, shift+scroll to pan,
drag to zoom to a range; **Resume live** goes back to following new data.

### Analysing a log (Viewer tab)

Open a log, then:

- **Worksheets** (tabs under the plots) hold pages of panels. Double-click a
  tab to rename it. They're remembered for the next log; **Premade sheets**
  builds Driver / Engine / Chassis sheets from the log's channels.
- **Add** a Plot (channels against time), XY (one channel against another,
  e.g. AccelY vs AccelX for a G-G diagram), Histogram or Track map. Clicking a
  channel in the list puts it in the active panel (red edge).
- **Laps:** in the Laps tab put the cursor where the car crosses the
  start/finish line and click **Set start/finish at cursor**, or click
  **Set start/finish** on a track map and click the line. Without GPS, split
  laps by hand at the cursor. Click a lap to zoom to it. **Laps from** changes
  how laps are found: a start/finish line (circuits), separate start and
  finish lines (each run is start → finish), launches (each standing start is
  a run of the set length, 75 m for acceleration, plus launches added in the
  Launch panel) or only your own marks.
- **Overlay:** tick laps, pick the reference with the radio button and click
  **Overlay ticked laps**. Plots switch to lap distance, one line per lap;
  add the **Time slip** channel to see where time is gained or lost.
- **Math channels…** makes channels from formulas, e.g.
  `hypot(AccelX, AccelY)` or `deriv(smooth(StrAngle, 0.05))`.
- **Stats** shows min/avg/max over the part in view; **Values** shows every
  channel at the cursor.
- **Export setup** saves worksheets, math channels and the start/finish line
  to a file the rest of the team can import.
- **Spectrum** shows the frequency content of dampers or accelerometers;
  then make a clean channel with e.g. `lowpass(AccelZ, 15)`.
- **Launch** finds standing starts and plots g against the traction-limit
  target and wheel slip against the target band (set the car in the **Car**
  tab).
- **✎** next to a channel (Live or Viewer) sets its title, colour, group, unit
  and ADC calibration (two-point or gain/offset). It saves to the device
  profile and applies to live data immediately.

The first launch may ask to allow network access (Windows Firewall, macOS):
allow it, or no data can arrive. Only one program can listen on the telemetry
port, so close the old Python app first.

## Configuration

Everything is plain YAML that can be edited by hand. **Open config folder** in
the app shows where it is; `README.txt` in that folder explains each file.

- `settings.yaml` — app settings (device to connect to, refresh rate, ...).
- `devices/*.yaml` — one file per device: ports, discovery id, commands,
  signal renames, calibrations and how channels are displayed. Copy a file and
  change its `id` to add a device.

The folder is chosen in this order:

1. `--config <folder>` or the `DAWG_CONFIG` environment variable;
2. a `dawg_config` folder next to the app (next to the `.app` on macOS) —
   ship one with the app for a portable copy;
3. the user config folder (`%AppData%\DawgViewer`,
   `~/Library/Application Support/DawgViewer`, `~/.config/DawgViewer`),
   created with defaults on first run.

`docs/device-protocol.md` describes what a device must send, e.g. for the
Arduino UNO Q.

## Development

Needs Go, Node.js, the Wails v3 CLI (`wails3`) and [just](https://just.systems).
Run `just` to list every command. The common ones:

```bash
just install      # download Go and frontend dependencies
just run          # run the app with hot reload
just simulate     # run the app fed by fake logger data, e.g. just simulate -rate 20
just sim          # fake logger data only (for an app that's already running)
just test         # Go vet/tests + frontend tests, types, lint and formatting
just build        # build for this OS into bin/
```

The simulator (`cmd/iltm-sim`) speaks the logger's protocol (discovery,
telemetry at 50 Hz, name sync), so the app works without the car. With
`just simulate` it stops when you close the app.

## Releases

Every push to `main` runs `.github/workflows/release.yml`: tests, then builds
on Windows, macOS and Linux runners, then publishes a GitHub release tagged
`v<version>-build.<n>` with:

- Windows: installer (`-setup.exe`) and portable zip
- macOS: universal (Apple Silicon + Intel) `.app` in a zip, plus a `.dmg`
- Linux: `.deb`, `.rpm`, AppImage and portable `.tar.gz`

The portable downloads include a `dawg_config` folder next to the app. Pull
requests run the test job, including the frontend build; platform packaging runs
for non-PR events. Pull requests are not released.

To release a new version, set it and push to `main`:

```bash
just version 0.2.0
```

`just version` on its own shows the current one. The app shows its version at
the right of the tab bar.

Layout:

```
internal/itv      ITV encoding used on the wire
internal/link     UDP listener, discovery, TCP commands
internal/live     packets -> named, calibrated rows for the UI
internal/config   config folder, settings and device profiles (defaults/ is seeded on first run)
internal/calib    linear and Steinhart-Hart calibrations
services/         Wails services the frontend calls
cmd/iltm-sim      logger simulator
frontend/src      React UI (live/, views/, plot/, analysis/, viewer/)
```
