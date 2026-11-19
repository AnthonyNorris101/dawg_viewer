# Dawg Viewer

Dawg Viewer is a desktop telemetry and log analysis app for UGA Motorsports. Connect to the team's ILTM logger over a local network, follow live vehicle data, or open recordings for deeper analysis. It runs on Windows, macOS, and Linux.

## Start using Dawg Viewer

Download the latest version from [GitHub Releases](https://github.com/UGA-Motorsports-FSAE-IC/dawg_viewer/releases). Join the logger's Wi-Fi or local network, open Dawg Viewer, and choose the device in the Live tab. If your computer asks for network permission, allow Dawg Viewer to receive traffic.

Choose **Test mode** from the top bar to explore with simulated live data and a sample outing. You do not need a logger for this mode.

### Follow live data

The Live tab displays incoming channels and pinned values. Choose channels from the list to add them to a plot. Scroll over a plot to zoom, use Shift+scroll to pan, or drag over a range to zoom in. Select **Resume live** to return to the newest data. Use **Track map** to see the vehicle's position and lap timing.

### Open and explore a recording

Open a local recording in the Viewer, or use the Logs tab to download one from the logger. Organize plots on worksheets, choose laps from a start/finish line or manual marks, and overlay laps by distance. Add the Time slip channel to compare pace through a lap.

The Viewer also includes XY and histogram plots, track maps, statistics, signal math, filtering, spectrum, launch and aero analysis, and saved setups. The [user guide](docs/user-guide.md) walks through these tools in more detail.

### Adjust settings

Use **Open config folder** to edit settings or device profiles as YAML. The app can store a portable `dawg_config` folder next to the program; otherwise it uses your operating system's user configuration folder. See the [configuration guide](docs/configuration.md) for paths and options.

For another logger or a relay, see the [device protocol](docs/device-protocol.md). Close other telemetry applications before launching Dawg Viewer because only one application can listen on the telemetry port at a time.

## Contributing and technical references

The [contribution guide](CONTRIBUTING.md) is the main contributor entry point. It links to setup, testing, development, documentation standards, and the technical references. For a system overview, see the [technical documentation](docs/README.md).
