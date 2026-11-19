# Dawg Viewer

Dawg Viewer is a desktop telemetry and log analysis application for UGA Motorsports. It connects to the team's ILTM logger over a local network and runs on Windows, macOS, and Linux.

## Features

- Monitor live telemetry with configurable plots, pinned channels, a track map, and lap timing.
- Download and open logger recordings, then analyze laps, compare runs, and build worksheets.
- Use signal math, filtering, calibration, spectrum, launch, and aerodynamic analysis tools.
- Try the app without a logger using Test Mode or the included logger simulator.

## Get started

Download the latest package from [GitHub Releases](https://github.com/UGA-Motorsports-FSAE-IC/dawg_viewer/releases). Join the logger's network, start Dawg Viewer, and select the device in the Live tab. The first launch may ask for permission to receive network traffic.

To explore without a logger, start the app and choose **Test mode**. For detailed Live and Viewer workflows, see the [user guide](docs/user-guide.md).

## Configuration

Configuration is stored as editable YAML. Use **Open config folder** in the app to find it. The [configuration guide](docs/configuration.md) explains device profiles and settings; the [device protocol](docs/device-protocol.md) describes how to connect another logger or relay.

## Development

Install Go, Node.js, the Wails v3 CLI, and [just](https://just.systems), then run:

```sh
just install
just simulate
```

`just simulate` runs the desktop app with simulated logger data. Run `just` to list commands and `just test` for the standard Go and frontend checks. See the [development guide](docs/development.md) and [contribution guide](CONTRIBUTING.md) for details.

## Project layout

```text
cmd/                 Simulator and version tools
internal/            Protocol, logging, configuration, and analysis support
services/            Wails services exposed to the frontend
frontend/src/         React and TypeScript application
docs/                 User, architecture, protocol, and development documentation
```

The [documentation index](docs/README.md) links to the full guides. Architecture details are in [docs/architecture.md](docs/architecture.md).
