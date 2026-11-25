# User guide

## The first start

The first time Dawg Viewer runs with no log to go back to, it opens a sample log, `Run-1 sample.csv`, in the Viewer so there is something to look at. It is real data measured on the G26, and a blue **SAMPLE LOG** label stays at the top of the window while it is open so it is not taken for your own session. The app comes with the sheets the sample is shown in, the start/finish line for it, the G26 car values on the Car tab, and the team's shock dyno table on the simulator's Dampers page. The sample is an ordinary file in the logs folder: delete it there and it does not come back.

## Connect to a logger

Join the same network as the logger, start Dawg Viewer, then choose the device at the top of the Live tab. The app discovers supported loggers, reads their channel names, and plots incoming values. Select channels in the list to add them to the active plot. Pinned channels appear as value cards.

Scroll on a plot to zoom, use Shift+scroll to pan, or drag across a range to zoom in. Choose **Resume live** to follow incoming data again. The optional track map shows position and lap timing.

While connected, the app also saves everything it receives to a backup log in the logs folder, named `<date>_<time>_live_<device>.csv` (UTC). If the SD-card log is lost or can't be downloaded, open the backup from the Logs tab or the Viewer like any other log. Use the **Backup log** checkbox at the top of the Live tab to turn it on or off; the change applies right away and is remembered. While a file is being written, its name is shown next to the checkbox. Turning the backup back on starts a new file.

Only one application can listen on the telemetry port at a time. Close the previous logger viewer if Dawg Viewer receives no data.

## Open and analyze a log

Open a local log from the Viewer or download one from the logger in the Logs tab. The Viewer supports worksheets containing time plots, XY plots, histograms, track maps, spectrum panels, and analysis tools.

- Add channels to the active panel from the channel list. Use worksheets to organize panels; premade sheets create Driver, Engine, and Chassis views.
- Drag the bottom edge of a plot down to make it taller, or up to make it shorter. It moves in quarter-height steps. The other plots are never squeezed below their normal minimum height, so the sheet scrolls once they no longer fit. Double-click the edge to go back to the usual height. The height is saved with the sheet.
- Set a start/finish line on a track map or at the cursor. Without GPS, add lap marks by hand. Lap modes also support separate start and finish lines and standing-start runs.
- Select laps and overlay them by distance. Add the Time slip channel to see where a lap gains or loses time against its reference.
- Every channel says where it comes from. In the channel list each one is tagged **measured** (straight from a sensor, as logged), **filtered** (sensor data with noise removed), **calculated** (worked out from measured data, such as GPS speed, laps and math channels) or **theoretical** (simulated from the Car tab; nothing measured). Anything that is not a raw measurement also carries that word in its name on plots, for example `Lat G · filtered` and `Sim Speed · theoretical`. On the Car tab, a value marked **typical** was filled in by the app and not entered for your car.
- Accelerometer and gyro channels say which way they point, worked out from each log: `+accel −brake` for the forward axis (from speed), `+right −left` or `+left −right` for the sideways axis and yaw rate (from the GPS heading), and whether the vertical axis reads −1 g or +1 g at rest. `Vert G` is 1 at rest, above 1 when the car is pushed up (a bump or compression) and below 1 when it goes light. A direction is left off when the log has no speed or GPS to work it out from.
- Use `Lat G`, `Long G` and `Vert G` for what the car is doing. They are the accelerometer channels in g with engine and road vibration filtered out (2 Hz low-pass); the raw `AccelX`/`AccelY`/`AccelZ` channels read much higher than the real g on a rigidly mounted sensor and are best kept for the Spectrum panel.
- Use Math channels to derive signals, such as `hypot(AccelX, AccelY)`. Statistics summarize the visible range; Values reports channels at the cursor.
- Spectrum panels show frequency content. Filters can create a cleaner channel, for example `lowpass(AccelZ, 15)`.
- Launch and Aero panels use vehicle specifications from the Car tab. Comparisons can overlay saved G-G envelopes and aero grip curves on another log or live session.
- Export a setup to share worksheets, made channels, and analysis settings with teammates.

The channel editor changes display metadata and calibration in the selected device profile. Calibration changes apply to live data immediately and to logs when they are next loaded.

### Setups

A setup is a view: the worksheets and plots, made channels, start/finish line, and the launch, Sim, damper and split settings. Car values are not part of a setup; they belong to the car's device profile, so switching setups never changes the car.

- The name of the setup in use is shown next to the **Setups** button at the top of the window, followed by "saved". There is no Save button: what you change is written into that setup's file about half a second later.
- **Setups** → **New setup** makes a setup and switches to it. It starts from the original view, which is the view the app comes with (premade sheets, default settings and the sample log's start/finish line), unless "What's open now" is picked, which copies the view on screen.
- A setup stays in use when another log is opened, so a new CSV shows the same sheets, channels and settings. Panels that name a channel the new log does not have stay empty.
- **Use** switches to another setup. **Unnamed view** is the view that has no file of its own; it is where the app starts before any setup is made and where an imported setup file lands.
- Each setup is one file in the config folder's `presets` folder. Copy a file to a teammate's `presets` folder to share it. Everything else the app remembers, including which setup is in use and the last log, is in `session.json` in the same config folder, so reinstalling or moving the app does not lose it.
- If the name next to **Setups** turns red, the app could not write to the config folder. It keeps trying; hover over the name for the reason.

## Put the track under the GPS trace

Every track map (the Viewer's map panels, the Live track map and the Sim tab's lap map) has a **Map** menu. Choose **Satellite (USA)** or **Street map** and the app looks up the place the GPS data came from and draws the imagery under the trace. The choice applies to all maps and is remembered; it starts as **Off**.

Imagery is downloaded the first time a place is shown at a given zoom and kept in the config folder, so it is still there with no internet at the track. Look at the venue once while online, at the zoom you want, before you leave. The satellite source is USGS aerial photography and only covers the United States; see [configuration](configuration.md#map-backgrounds) to add another tile server.

## Simulate the car

The **Sim** tab works out what the car described on the Car tab should be able to do and sets that against a log. It has six pages, and the four numbers at the top (75 m acceleration, skidpad lap, lap time, top speed) follow every change.

Start on the **Car** tab. The simulator needs the engine torque curve, gearing, tires, aero and suspension that are entered there. The app comes with values for the G26, and uses each one wherever the selected device has no value of its own. Those are tagged **G26 stock** on the Car tab, on the Sim tab and on the Engine page: they come from the team spec sheet, the 8/8/26 dyno run and the team tire model, a few are assumptions (the driver is taken as 68 kg), and none was measured by the app. Changing a value and pressing **Save** puts yours in the device profile; a stock value you leave alone is not written, so it stays tagged. Values with no stock number are tagged **typical**. To start from a car someone has already entered, **Import car values…** fills the page from the `car:` block of a device file (the `devices/*.yaml` file in their config folder); nothing is saved until you press **Save**. Tires use the Magic Formula: the **Tire model** card starts from typical coefficients built around your peak μ, and you can type coefficients over them or use **Import tire file…** with a `.tir` file or a MATLAB tire model fitted to tire test data. Until you give it a torque curve it uses a stand-in for a restricted 600 cc engine. While that is the case every page of the Sim tab carries a "Not your engine" warning with the stand-in's peak torque and power (58 N·m, 80 hp), so those are not mistaken for dyno numbers, and the Engine page tags its peak tiles and chart as stand-in. If no car values at all have been entered for the selected device, the warning says that too and names the config folder the app is reading, which is the first thing to check when values you expected are missing. Replace the stand-in with **Import dyno file…** (a CSV with RPM and torque or power), by typing points, or from a log as described below.

- **Engine & gearing** draws torque and power, the force at the tires in every gear against the grip limit and drag, and the best shift points. **Estimate from the open log** rebuilds a torque curve from full-throttle pulls in the open log; **Use this as the car's curve** saves it to the profile.
- **Acceleration** runs a standing-start 75 m and overlays the best real launch from the open log.
- **Lap** drives the simulated car around a track: a lap from the open log, the skidpad, the acceleration strip, a track you type or import as straights and corners, or a track outline. See [Tracks and the ideal line](#tracks-and-the-ideal-line). With a logged lap it overlays the real speed trace, colours the lap by what limits the car at each point (braking, cornering, traction, power, shifting), and adds up where the real lap loses time against the simulation. The table at the bottom compares the most g the real car pulled with the most the simulated car did, which tells you whether the tire and aero numbers on the Car tab are right.
- **Skidpad & balance** gives the skidpad time, roll gradient, the front share of lateral load transfer, the understeer gradient and slip angles, and which end of the car runs out of grip first.
- **Dampers** reads a shock dyno table (the AvgCurves sheet saved as CSV: Shock, Setting, TestSpeed_ips, Velocity_ips, Comp_lb, Rebound_lb), plots force against shaft speed for the settings you tick, and works out the percent of critical damping each click setting gives on this car at 25 and 125 mm/s. The forces are measured on the dyno; the damping ratio is calculated from the Car tab's wheel rate, motion ratio and masses. It does not recommend settings.
- **Sweeps** steps one car value across a range and plots the result, for example final drive against 75 m time. **Tire pressure (hot)** is one of the values: it changes cornering grip and stiffness when the imported tire file has pressure coefficients, and has no effect otherwise. Stay inside the pressures the tire was tested at.

**What-if car** changes any value for the comparison without saving it; every page then shows the Car tab's car and the what-if car side by side.

With **Simulated channels in the Viewer** ticked, every timed lap of the open log gets `Sim Speed`, `Sim Long G`, `Sim Lat G`, `Sim Gear`, `Sim RPM` and `Sim Time Gap` channels, so any Viewer plot can lay the simulated car over the real one.

### Tracks and the ideal line

The Lap page's **Track** menu has two ways to bring a track in.

**A track I type in or import (OptimumLap)** is a list of straights and corners, one per line (`straight 60`, `left 9 180deg`, `right 15 20`). **Import track file…** fills the list from:

- an OptimumLap track (`.OLTra`). OptimumLap does not publish this format; the reader was worked out from, and checked against, a real track file, so a file written by a very different OptimumLap version may be refused. If one is, export the track's section table and import that instead.
- a table (CSV, tab or semicolon separated) with one row per section: its type (`Straight`, `Left` or `Right`), length in metres and, for corners, radius in metres.

**A track outline (from a file or found online)** is the middle of the road as a string of points. **Import track file…** also reads these: a table with `x` and `y` columns in metres (`x_m`, `y_m` work too, and `w_tr_right_m` + `w_tr_left_m` or `width` set the track width), a table with latitude and longitude, or a GPX, KML or GeoJSON file. An outline with latitude and longitude can be drawn over the map background.

The same page can look an outline up in OpenStreetMap:

- **Search around the open log** lists the race tracks mapped within 3 km of where the open log was recorded.
- **Search by name** finds a place by name and lists the race tracks there. It is off until the team turns it on; see [Track search](configuration.md#track-search).

A search runs only when you press the button, sends the name or the log's position to public OpenStreetMap servers, and saves the answer in the config folder (`track-search/`) so the same search works offline afterwards. Only roads mapped as race tracks (`highway=raceway`) are found, which covers permanent circuits and kart tracks but not a cone course in a car park. Outlines there are traced by hand from aerial photos, so treat corner radii as approximate, and expect a circuit with several layouts to come back as its main loop plus leftover pieces. Credit OpenStreetMap (© OpenStreetMap contributors) if you publish a result built on one.

Tick **Work out the ideal line** to let the car leave the middle of the track:

- For a typed, imported or outline track, set **Track width** (cone to cone or kerb to kerb; the app does not know it). The car's centre can move half of the width left over after the car itself, which is taken as the wider of the Car tab's two track widths plus 0.2 m of tire.
- For a lap from the open log, set **Room either side of the driven line**. The line then may move that far from the path the GPS recorded, so this shows how much time a different line near the driven one could be worth. It needs GPS.

The app tries six lines that fit in that room, from the one with the least total cornering to shorter ones that cut distance, runs the car down each and keeps the quickest. The **Ideal line** card gives its lap time against the middle of the track (or the driven line), its length and where it sits across the track; the map draws it over the room it had, with **+**, **−** and dragging to look closely. This is a search among smooth lines, a close stand-in for the fastest line and not a proof of it, and the time is theoretical: it carries every assumption of the tire and car model and knows nothing about bumps, cones or the driver.

An outline has its own **Smooth over** setting: the distance the path is averaged over before corner radii are read off it. Leave it at 0 for a drawn or surveyed outline. A path recorded by GPS needs a few metres, because centimetres of position noise turn into large swings in corner radius; a GPX file is taken to be a recorded drive and starts at 3 m.

**Saved tracks.** Type a name next to **Save track** to keep the track on screen: its sections or outline, whether it is a closed loop, its width and its smoothing. It is written as `tracks/<name>.json` in the config folder, so it is still there next time and can be copied to a teammate. Pick it from **Saved tracks** to open it again; **Delete** asks once more before removing the file. Saving also works on a lap from the open log that has GPS: that saves the path the car drove on that lap as an outline, so the same course can be simulated later without the log. It is the line that was driven, not the middle of the track, and it says so when opened. The skidpad and the acceleration strip have nothing to save.

**Simulated laps in the Viewer.** **View this simulated lap in the Viewer** opens the lap as if it were a log, at 100 samples a second, with these channels: Speed (km/h), Long G, Lat G, RPM, Gear, Throttle, Limit (what holds the car back: 0 braking, 1 cornering, 2 traction, 3 power, 4 shifting), Curvature, Latitude, Longitude, X and Y, and Line Offset when the ideal line is on. Each simulated run is its own lap, in this order: the lap as simulated, the driven line from GPS (logged laps with the ideal line on), the ideal line, the what-if car. The Viewer's lap list then shows their times and can overlay them like real laps. The Viewer switches to a sheet called "Simulated lap", made the first time and left alone after that, so it can be rearranged like any other sheet.

Nothing in such a log was measured. The Viewer shows a SIMULATED badge next to its name and every channel carries the theoretical tag, including the distance and lap channels worked out from it; labels and units from the device profile are not applied to it. A track with no real location (typed sections, x/y outlines) is drawn at a made-up position, 1°N 1°E, only so the track map has something to draw. The simulated log is not saved with the logs: open it again from the Sim tab when you need it. While it is open, the Sim tab keeps using the real log that was open before.

With a log open, the page also gives a **likely lap**. It takes the best timed lap in the log, compares it with the simulation of that same lap, and applies the same gap to the track on screen: if the driver was 6% slower than the simulation there, the likely lap is the theoretical time plus 6%. For a logged lap with the ideal line on, it scales the measured lap time by the share the ideal line gains in the simulation instead. The gap between a driver and the simulation changes from track to track (it is mostly braking and traction), so this is a rough guide, and it is only as good as the Car tab.

The simulation treats the car as a point with a speed-dependent grip limit, so it does not model transients, dampers, tire temperature or the driver. Read its numbers as what the car could do, and trust differences between two setups more than absolute times. It is only as good as the Car tab: a lap that does not line up with the real one usually means a value there is off.

## Test without a logger

Choose **Test mode** in the app to start a simulated car and open a sample outing. Developers can also run `just simulate` from the repository; see the [development guide](development.md).

## Configuration and protocol

Use **Open config folder** to inspect settings and device profiles. See [configuration](configuration.md) for available options and [device protocol](device-protocol.md) for requirements when adding a logger or relay.
