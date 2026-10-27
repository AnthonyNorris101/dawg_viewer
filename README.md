# Dawg Viewer

Desktop app for the UGA Motorsports data logger (ILTM). Replaces the Python
app in `FSAE_Data_Acquisition/Software`. Runs on Windows, macOS and Linux.

Done:
  - [x] live data view.
  - [x] log/csv download.
  - [x] csv data viewer.

Todo:
  - [ ] more layouts
  - [ ] savable/premade presets


Check out the docs for information, if you are making commits to the project
ensure that your changes make their way in as well. [docs/](docs/README.md).

## Using it

1. Join the same network as the logger.
2. Start Dawg Viewer and pick the device at the top of the **Live** tab.

The app finds the logger by itself (UDP discovery), learns channel names from
it and shows the data. Pinned channels appear as cards; pick channels from the
list on the left to plot them. Scroll on a plot to zoom, shift+scroll to pan,
drag to zoom to a range; **Resume live** goes back to following new data.

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
just test         # Go tests + frontend type check, lint and format check
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
requests are tested and built but not released.

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
frontend/src      React UI (live/, views/, plot/)
```
