# User guide

## Connect to a logger

Join the same network as the logger, start Dawg Viewer, then choose the device at the top of the Live tab. The app discovers supported loggers, reads their channel names, and plots incoming values. Select channels in the list to add them to the active plot. Pinned channels appear as value cards.

Scroll on a plot to zoom, use Shift+scroll to pan, or drag across a range to zoom in. Choose **Resume live** to follow incoming data again. The optional track map shows position and lap timing.

Only one application can listen on the telemetry port at a time. Close the previous logger viewer if Dawg Viewer receives no data.

## Open and analyze a log

Open a local log from the Viewer or download one from the logger in the Logs tab. The Viewer supports worksheets containing time plots, XY plots, histograms, track maps, spectrum panels, and analysis tools.

- Add channels to the active panel from the channel list. Use worksheets to organize panels; premade sheets create Driver, Engine, and Chassis views.
- Set a start/finish line on a track map or at the cursor. Without GPS, add lap marks by hand. Lap modes also support separate start and finish lines and standing-start runs.
- Select laps and overlay them by distance. Add the Time slip channel to see where a lap gains or loses time against its reference.
- Use Math channels to derive signals, such as `hypot(AccelX, AccelY)`. Statistics summarize the visible range; Values reports channels at the cursor.
- Spectrum panels show frequency content. Filters can create a cleaner channel, for example `lowpass(AccelZ, 15)`.
- Launch and Aero panels use vehicle specifications from the Car tab. Comparisons can overlay saved G-G envelopes and aero grip curves on another log or live session.
- Export a setup to share worksheets, made channels, and analysis settings with teammates.

The channel editor changes display metadata and calibration in the selected device profile. Calibration changes apply to live data immediately and to logs when they are next loaded.

## Test without a logger

Choose **Test mode** in the app to start a simulated car and open a sample outing. Developers can also run `just simulate` from the repository; see the [development guide](development.md).

## Configuration and protocol

Use **Open config folder** to inspect settings and device profiles. See [configuration](configuration.md) for available options and [device protocol](device-protocol.md) for requirements when adding a logger or relay.
