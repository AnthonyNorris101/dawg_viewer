# Frontend

React + TypeScript + Tailwind, built with Vite, plots drawn with uPlot.

```
src/App.tsx        tabs (Live / Logs / Viewer / Sim / Car / Settings)
src/live/          live view: connection, store, follow mode, cards, plots, status bar
src/views/         LiveView, LogsView, ViewerView, SimView, CarView, SettingsView
src/viewer/        pure session analysis plus focused React controllers
src/analysis/      pure numerical stages; analysis/sim/ is the vehicle simulation
src/sim/           the Sim tab's pages
src/plot/          uPlot wrapper and shared plot view state
src/components/    channel list and viewer plot panel
src/state/         persistence, analysis settings, workbook/layout reducers, panel metadata
src/data/          session types, zero-copy column construction, calibration and sensor data
```

Settings provides a Live plot layout choice. Default keeps the vertical stack;
Bento places Live plots and the optional track map in a two-column grid.
Items have independent width/height choices and can be dragged into explicit
row/column slots, including empty cells; compatible saved slots are retained.
Returning to Default stacks plots in visible grid order, reading left to right,
then top to bottom. Viewer worksheets are independent of this choice.
The selection persists between launches; item order and sizing are session-local.

## Guiding rule: high-rate updates bypass React

Data arrives 20 times a second and the cursor moves at pointer rate. Routing
those through React state would re-render the tree every time. So:

- values, card colours, legend readouts and plot data are written straight to
  the DOM or handed straight to uPlot from store subscriptions;
- React re-renders only for slow-changing things: status (2/s), the channel
  list, profile info and plot layout.

Nothing is drawn that can't be seen:

- live views redraw from `onLiveFrame` (live/connection.ts), which runs at most
  once per animation frame and only while the Live tab is shown
  (`setLiveShown`, set by App). Lap timing still reads every row as it
  arrives, so nothing is missed while you're on another tab;
- uPlot plots leave their ViewSync group while they are off screen (scrolled
  away or on a hidden tab) and rejoin, picking up the current range and any
  held-back data, when they come back (`mountPlot`, IntersectionObserver with a
  200 px margin). Canvas panels skip repaints the same way (`mountCanvas`).

## live/connection.ts

- `startLive` subscribes to the backend events once and loads the current
  state with `refresh`. It's safe to call twice.
- A status with a new `startedAt` means a new session; its rows count from its
  own start, so the store is reset.
- `observable` is a tiny value holder for `useSyncExternalStore`.
- `colorFor` gives each channel a stable colour in order of first appearance.
- History is sized as `history_minutes × 60 × MAX_RATE_HZ` rows, with
  `MAX_RATE_HZ = 60` as an assumed upper bound on the device's packet rate.

## live/store.ts — LiveStore

Turns sparse rows into columns: one time column plus one column per channel,
all the same length, as `Float64Array`s (float64 so combined GPS values keep
their precision).

- A row that doesn't carry a channel repeats its previous value. The device
  only sends what changed recently, so this is the right reading of the data.
- A channel's first value is copied back over the rows before it. Together
  with the rule above, plots never see gaps, and uPlot can use the columns
  directly without copying or merging.
- Columns grow by doubling up to `maxRows`; after that the oldest quarter is
  dropped when full. This bounds memory.
- `times()` and `column()` return views that are only valid until the next
  append.
- `lastUpdate(name)` is the time of the newest row that actually carried the
  channel (not a repeated value); cards use it for their age colour.

## live/follow.ts — follow mode

One module-level controller keeps all live plots on the newest window
(10 s … All). It remembers the range it last set. Any range change it didn't
set came from the user zooming or panning, so it stops following and the view
holds still until "Resume live". It lives outside React so the window, the
follow flag and the "expected range" can't get out of step between renders.

## plot/sync.ts — ViewSync

Shared view state for a group of plots (the live view has one, the log viewer
another): uPlot cursor sync key, the shared x range, and cursor/range
listeners. It lives outside React for the same pointer-rate reason. When one
plot's range changes it's copied to the others; those fire their own scale
hooks, and the "same range" check stops the echo.

## plot/mountPlot.ts

- One y scale per unit so channels with unrelated magnitudes stay readable.
  Live channels without a unit get a scale of their own (the name is used as
  the scale key).
- Only the first two units get an axis (left, right). Every plot reserves the
  same gutters so x positions line up across panels; more axes would shift
  the plot area.
- Wheel zooms about the pointer, shift+wheel or a horizontal wheel pans,
  within the current data bounds.
- A left click on a time plot pins one sample across the synced plots and their
  readouts. Another click moves the pin; Escape clears it. Dragging still zooms.
  Live pins clear when their sample leaves the rolling buffer.
- Each y scale is fitted to the data in view. With "ignore spikes" (↕ in the
  panel header, on by default) it ignores the most extreme 0.1% of the
  visible points (from a sample of at most 4,000 per axis), so one glitch or
  dropped-packet zero can't flatten the trace. Right-click a time plot to set
  fixed bounds per y axis or return an axis to automatic scaling. The context
  menu also links to channel editing and, in Viewer, filtering. Histogram menus
  expose bin count, XY menus expose axis bounds, and Spectrum menus expose FFT
  window size. `zoom(factor)` backs the − / + header buttons and zooms
  x about the middle of the view, which the other synced plots follow.

## Cards (live/PinnedCards.tsx)

Pinned channels from the profile, in `order`. Values, warn/crit background
and the age border are written to the DOM on each frame and every 500 ms
(ages keep growing when no data arrives). The border goes from green when
fresh to red at 10 s and then dims — the same curve as the old InfoBox
widget (`ageColor` in `live/format.ts`).

## Plots (live/LivePlotPanel.tsx)

- Selected channels the device hasn't sent yet are shown as waiting, off the
  plot; the plot is rebuilt when they first appear.
- On every live frame the plot gets fresh column views (`update`, which is
  `setData(…, false)` while visible and keeps the current x range for follow
  mode to set).
- Each plot is at least 17rem tall; more plots than fit make the list scroll
  rather than squeeze.
- Legend values show the cursor position, or the newest value when the cursor
  is off the plot.

## Layout (state/layout.ts)

A reducer for the list of plot panels and which one is active. Untouched
panels keep their object identity so memoised plots don't rebuild. Removing
the last panel empties it instead, so there's always one.

## Tabs (App.tsx)

Live and Viewer stay mounted and are hidden with CSS, preserving their data
and layouts across tab switches. Logs, Sim, Car, and Settings mount only while selected.
Sim keeps its page, what-if changes and track choice in `state/sim.ts`, so
remounting it loses nothing.

## Logs tab (views/LogsView.tsx)

Two lists: logs on the logger (Connect, Download selected, Download latest,
Done) and files in the logs folder (Open, and Convert for `.bin`). The view is
only mounted while its tab is open: opening it loads the local list, and
closing it calls `FinishRemote` so the logger starts recording again.
Download progress comes from `logs:progress` events. App owns a synchronous
in-flight guard for log opening, shared by the Logs tab, Viewer file picker,
setups, and reloads. While it is held, the Logs tab disables its local Open
buttons and shows an opening status; additional open requests are ignored.

## Viewer tab

`viewer/openLog.ts` is the Wails/fetch adapter. It loads through `LogService.Load`, fetches its
`dataUrl` once as an `ArrayBuffer`, and builds a `Session` whose columns are
`Float64Array` views straight into that buffer using `data/columns.ts` (no copying) (units and precision come from the current device profile when the
names match). `ViewerView` remounts per file. A log with north and east velocity (`VelNorth`, `VelEast`, as a VectorNav logs them) but no speed channel gets a `GPS Speed` channel in mph, their vector sum, so distance, laps, premade sheets and the simulator have a speed to work with. A log with accelerometer channels also gets `Lat G`, `Long G` and `Vert G` (`analysis/accel.ts`): the raw channel converted to g and low-passed at 2 Hz with a zero-phase filter, with `Long G` positive when speeding up and `Vert G` positive at rest. A rigidly mounted IMU on a car with an engine reports vibration several times larger than the car's real acceleration, and sampling it at the log rate folds that vibration into every frequency, so the raw channels overstate g; what the car is actually doing sits below about 2 Hz. The raw channels are left as they are for the spectrum and vibration tools. `accelAxes` also works out which way each axis points and stores it as the channel's `hint`, which is shown in brackets after the name: forward from the sign of acceleration against speed, sideways and yaw from their correlation with the heading change (velocity north/east, or GPS positions), vertical from its sign at rest. `Lat G` keeps the sensor's sign. Premade sheets, the G-G plot, and the Launch and Aero panels use the clean channels when they exist. Opening a log from the Logs tab
switches to the Viewer.

The Viewer works like Pi Toolbox: worksheets of panels, laps from a GPS
start/finish beacon, lap overlays against distance with time slip, math
channels, and the side panel with lap times, statistics and every value at
the cursor.

```
src/analysis/     maths with no UI: expressions, GPS/laps/distance, overlays, stats
src/viewer/       analysis.ts (log → derived channels), xview.ts (what the x axis is)
src/state/        layout (panels), workbook (worksheets), analysis settings, storage
src/components/   PlotPanel, XYPanel, HistogramPanel, TrackMapPanel, Sidebar,
                  MathEditor, WorksheetTabs, PanelFrame (shared panel chrome)
src/plot/         mountPlot (uPlot), canvas.ts (canvas panels), trackMap.ts
```

### Derived channels (viewer/analysis.ts)

`useAnalysis(session)` adds channels to the loaded log in stages, each its
own `useMemo`, so changing one setting only redoes what depends on it:

1. GPS: `PosLat`/`PosLong` (or `Lat`, `Latitude`, `Lon`, …). A log counts as
   having GPS only if at least 10 sampled rows hold a real fix; (0, 0) is "no
   fix".
2. Distance: from GPS (haversine between fixes) or by integrating a speed
   channel (`VSS`, `Speed`, …). Held values (the 100 Hz CSV repeats a value
   until the next update) add nothing, and a jump faster than 120 m/s since the
   previous fix is treated as a bad fix and skipped. The speed unit is guessed
   from the channel's unit and defaults to mph; it can be set in the Laps tab.
3. Laps, by the "Laps from" setting (`TrackSettings.lapMode`, see Lap modes
   below). In the default loop mode: beacon crossings plus manual splits
   (times, stored per log path), then `buildLaps`. The segment before the first
   boundary is the out lap and the one after the last is the in lap; they are
   left out when shorter than 1 s and are never the best lap.
4. `Distance`, `Lap Number`, `Lap Time` and `Lap Distance` channels (group
   Analysis), unless the log already has channels with those names.
5. Math channels (group Math).

The derived `Session` keeps the original `time` array, so plots and the zoom
stay put when laps or math channels change.

### Beacon (analysis/track.ts)

Pi Toolbox times laps from a beacon; with GPS the beacon is a point. A
crossing is the closest sample of each visit within the gate radius (15 m by
default). Using the closest sample of a whole visit, rather than the first
sample inside the circle, makes the lap time independent of the radius. A
visit sooner than "min lap" seconds after the last crossing is ignored, which
covers stopping near the line and GPS wander. The beacon is set from the
cursor, or by clicking a track map (the click snaps to the nearest point of
the track so the gate sits on the racing line). It is remembered between logs
because the track rarely changes; splits are per log.

### Lap modes

"Laps from" in the Laps tab picks how laps (or runs) are found:

- Start/finish line (loop, the default): a lap from each beacon crossing to
  the next, plus manual splits, with out and in laps.
- Separate start and finish lines (gates): a second beacon, `finish`, set the
  same way. `pairGates` pairs each start crossing with the next finish
  crossing, so a run is start line to finish line (acceleration, or an
  autocross whose finish is somewhere else). Finish crossings use a min lap of
  1 s.
- Launches: `findLaunches` on ground speed (from distance, or the speed
  channel) finds every standing start; each run starts there and ends
  `runLength` metres later (`runEnd`, 75 m by default for FSAE acceleration;
  0 or no distance ends it when the launch ends). Launches added by hand in the
  Launch panel are runs too. No GPS lines are needed.
- Only my marks: no automatic laps, just `buildLaps` over the manual splits.

The modes other than loop go through `buildRuns`: runs are sorted, overlapping
ones are dropped, they are numbered 1, 2, … and there is no out or in lap. The
time plots draw a lap marker at each run's start and a second one at its end
when the next run doesn't start there.

### Overlays and time slip (analysis/overlay.ts, viewer/xview.ts)

uPlot needs one x array for all series, so each overlaid lap is resampled onto
a shared distance grid (at most 5000 points, at least 0.25 m apart). For each
grid point we keep the sample before it and the fraction towards the next, so
any channel can be resampled on demand and cached per channel and lap. Laps
other than the reference are stretched to the reference lap's length by
default (Pi Toolbox's distance correction): a wider line makes a lap a few
metres longer, and without stretching every corner after the first would
drift. Time slip is lap time at each distance minus the reference lap's.

`XView` hides the difference between the two modes from the panels: `x`,
`bounds`, `series(channels)` (one series per channel, or per channel and lap
"slot" with a dash pattern per lap), `samplesAt(idx)` (the sample under the
cursor for each slot) and `visible(range)` (the samples in view for each
slot). XY, histogram and map panels draw "what's in view" through
`visible`, so they follow the zoom in both modes.

A new `ViewSync` is made only when switching between time and an overlay. The
time view itself is rebuilt when laps change (for the lap markers) but keeps
its sync, so the zoom survives setting a beacon or adding a math channel.

### Math channels (analysis/math.ts)

A recursive-descent parser builds a tree once; evaluation works on whole
columns (a constant stays a number until it meets a column), so a 700,000-row
log takes milliseconds. Precedence from low to high: `?:`, `||`, `&&`,
comparisons, `+ -`, `* / %`, unary `- !`, then `^` (right-associative, so
`-2^2` is −4 and `2^-1` is 0.5). Names are identifiers with letters, digits,
`_` and `.`, or anything in `[brackets]` or `"quotes"`; a channel wins over
the constants `pi`, `e`, `g0` and the time variable `t`.

Time-series functions use the log's time column: `deriv` is a central
difference, `integ` the trapezoid rule, `smooth(x, s)` a centred moving
average over s seconds (NaN-safe, via prefix sums) and `delay(x, s)` a shift.
Because logged values are held between updates, derivatives of raw channels
are spiky; `deriv(smooth(x, 0.05))` is the usual fix.

`computeAll` evaluates definitions in dependency order, so one math channel
can use another regardless of list order. A failing definition (unknown
channel, cycle, name clash with a log channel) gets an error shown in the
editor and the rest still work. Definitions are global, like Pi Toolbox's
function library, and ship with three examples.

### Panels and worksheets (state/layout.ts, state/workbook.ts)

A panel has a `kind`: `time` (any number of channels), `xy` (`[x, y]`),
`histogram` (`[channel]`) or `map` (`[colour channel]`). Clicking a channel in
the list acts on the active panel: toggle for time plots, "newest pick is Y,
previous Y becomes X" for XY, replace for histogram and map. Panels sit in a
two-column grid; time plots default to full width, the others to half. The
grid's rows are quarter-height units of at least 4.25rem. A panel spans
`panelRows(panel)` of them: 4 by default (17rem), 8 for the Launch and Aero
panels, or `panel.rows` once the user has dragged the handle on its bottom
edge (`PanelFrame`), which steps a row at a time between 2 and 24; a
double-click clears it. The grid scrolls when a sheet has more than fits,
so panels never get squeezed into each other. A panel clips its own contents and its legend gets at most two lines
before it scrolls.

A workbook is a list of worksheets, each with its own layout. It is saved to
localStorage on every change and restored for the next log; panels that name
channels the log doesn't have show what's missing instead of failing. With no
saved workbook (or "Premade sheets") the Driver, Engine and Chassis sheets are
built from whichever usual channels the log has. "Export setup" writes the
workbook, math channels and beacon to one JSON file for the team.

### Canvas panels (plot/canvas.ts, plot/trackMap.ts)

XY, histogram and map panels draw on canvases rather than uPlot: XY needs no
x-sorted data and the map needs equal scales. Each uses two canvases, a base
redrawn when the range changes and a cursor layer redrawn at pointer rate, and
both repaint at most once per animation frame. The XY panel draws at most
40,000 points (striding beyond that, which looks the same at panel size);
when both axes are accelerations it uses equal scales and grip circles (a G-G
diagram). While the range is changing (wheel zoom, dragging the slide bar)
the G-G envelope from the previous range is reused and recomputed 160 ms after
the range settles.

The map projects GPS to metres around the track's centre (equirectangular is
exact enough over a few km). Drawing skips points less than ~1 px from the
last drawn one, and a coloured trace is drawn as 24 paths, one per colour
bucket, instead of one stroke per segment, so a whole outing redraws quickly.

### Map backgrounds (plot/tiles.ts, state/mapBackground.ts)

`mountTrackMap` takes an optional `background()` that returns the chosen map
source or null. When there is one, the base canvas draws Web Mercator tiles
under the trace: `zoomFor` picks the shallowest zoom that is at least as
detailed as the screen (never deeper than the source's `maxZoom`),
`tilesIn` lists the tiles covering the view (at most 80, stepping to a
shallower zoom if more would be needed), and each tile is drawn at the
position its corners project to, so the imagery lines up with the map's own
metre projection. A 30% dark veil goes over the imagery and the track gets a
dark casing so the trace stays readable, and the source's attribution is drawn
in the bottom corner.

Tiles are `<img>` elements loaded from the app's own `/maptiles/…` path (see
[backend.md](backend.md#internalmaptiles)); the frontend never contacts a tile
server. `plot/tiles.ts` keeps up to 400 decoded images, asks the map to
repaint when one arrives, and does not ask again for a failed tile for 60 s.

The chosen source id is one value for the whole app (`mapBackground.v1` in
localStorage, default off). `MapBackgroundSelect` lists the sources from
`Info.mapSources` and is shown on the Viewer's map panels, the Live track map
and the Sim tab's lap map.

### Side panel (components/Sidebar.tsx)

- Laps: lap table (best lap in purple, Δ to best, max speed), tick laps to
  overlay and pick the reference, start/finish and splits "at cursor". The
  cursor is the last position the pointer was over a plot, since moving to
  the button leaves the plot.
- Stats: min, average and max over the part in view for every channel on the
  worksheet's time plots (per lap when overlaying). The range label follows
  the zoom every frame; the figures are recomputed once the range has held
  still for 150 ms, since they scan every sample in view (`watchRange` in
  plot/sync.ts).
- Values: every channel at the cursor, written to the DOM directly.

### Settings storage (state/storage.ts)

Workbook, math channels, track settings and splits are small JSON values in
the webview's localStorage, validated when read so a bad or old value falls
back to the default. Storage can be missing or throw, so every access is
wrapped and the app works without it. `save` tells the `onStored` listeners,
which is how the session (see Setups) copies every change into the config
folder; `persisted` stores expose their `key` and reload when
`restoreEntries` puts stored values back.

### Spectrum panel (analysis/spectrum.ts)

The samples in view are resampled onto an even time grid (logs are not
always evenly spaced) and run through Welch's method: Hann-windowed segments
of 256–4096 points with 50% overlap, each segment's mean removed, the power
averaged and scaled to a one-sided power spectral density, drawn in dB.
Longer windows give finer frequency bins but a noisier estimate; averaging
more segments does the opposite. The peak shown ignores everything below
0.5 Hz so driving inputs don't hide vibration. A held value repeated at
100 Hz (a slow channel in a normalized CSV) adds stair-step harmonics at the
original update rate; they are real artefacts of the data, not of the FFT.

`lowpass(x, hz)` and `highpass(x, hz)` math functions are second-order
Butterworth filters run forwards then backwards (zero phase, so filtered
data doesn't lag; the response is fourth order and −6 dB at the cutoff).
`bandpass(x, lo, hi)` is a high-pass at lo then a low-pass at hi, and
`bandstop(x, lo, hi)` is x minus that band. All four take an optional last
argument, steepness 1–4, which stacks that many stages; each stage's cutoff
is moved out by (2^(1/n) − 1)^(−1/4) so the whole filter is still −6 dB at
the cutoff you asked for, with less droop in the band it keeps.

### Filtered channels (components/FilterDialog.tsx, analysis/filters.ts)

"∿" on a channel in the Viewer's list, "∿ Filter…" in the Viewer toolbar
(starts with the active panel's channels) or "∿ Filter…" on a spectrum panel
(starts with that spectrum's channels) opens a dialog that writes one of
those expressions per ticked channel as new math channels named
"<channel> <ending>" (so they live in the Math group for every sheet and log,
and can be edited in Math channels). Channels can be ticked one by one, a
whole group at a time, or all at once ("Every sensor" skips Math and
Analysis channels).

"∿" on a filtered channel reopens its filter (the expression is read back
with `parseFilter`), so it can be widened, narrowed or fine-tuned and saved
in place under the same name. The graph works like an audio EQ: the
channel's spectrum before (grey) and predicted after (blue, the before
spectrum times the filter's gain squared), the filter curve in red with dots
on it, and a readout of frequency, keep % and dB under the pointer. Every
filter type shows its dots (its gain at the ends of the range and at
0.3–3.3× each cutoff); dragging one, or double-clicking to add or remove one,
turns it into a fine-tuned curve, with a button to go back to the filter it
started from. The controls row keeps the same height in both modes so the
graph doesn't move under the pointer. It is saved as `shape(x, hz1, keep1, hz2, keep2, …)`: the keep
fraction is interpolated linearly against log frequency, held flat beyond
the end points, and applied in the frequency domain to the whole log
(mirror-padded by 2 s each end and zero phase). From a spectrum that is zoomed in, the band starts at the
zoomed range. The preview draws the channel's spectrum over the whole log
(grey, top 60 dB) under the filter's gain (red), computed from the same
formula the filters follow. Making a channel with a name that already
belongs to a math channel replaces it; a name a log channel already uses is
refused.

### G-G envelope (analysis/gg.ts)

When both axes of an XY panel are accelerations the panel uses equal scales
and draws the grip envelope: the samples are split into 36 directions and the
98th-percentile radius of each is taken, so single noise spikes don't
inflate it; directions without data are interpolated from their neighbours.
The area is the polygon's (shoelace formula) and the "G-G circle" is the
circle with the same area. Both follow the zoom and are drawn per lap when
overlaying.

### Launch analysis (analysis/launch.ts, components/LaunchPanel.tsx)

A launch is a standstill (wheel speed under 0.5 m/s; the speed channel is
used for this because GPS-derived speed jitters at rest) followed by
reaching 8 m/s within 4 s, with the throttle above 50% if the log has one.
Each launch is plotted against time since it started: longitudinal g, the
target g and wheel slip. Metrics use ground speed (GPS when available):
0–60 km/h time, 75 m time (the FSAE acceleration event), peak and 0–1 s
average g and peak slip. The sign of AccelX is chosen so launches are
positive.

The target is the rear-drive traction limit: drive force = μ × rear load,
with rear load = static rear share + m·a·h/L, which gives
a = μ·g·(b/L) / (1 − μ·h/L). Slip is (driven wheel − ground) ÷ ground. With no
driven-wheel channel set, driven-wheel speed comes from RPM through the
primary, gear (from the gear channel, else the launch gear) and final drive.
That "engine-side slip" includes clutch slip, which is what makes it useful
for tuning the clutch release.

### Channel editor calibrations (components/ChannelEditor.tsx, data/calibration.ts)

Modes: none, two-point, gain & offset, polynomial (type the coefficients) and
known points (any number of raw → value pairs, fitted with a least-squares
polynomial of degree 1–4 or joined with straight lines). Fitting works on
raw readings rescaled to −1…1 so a cubic over 0–4095 stays well conditioned,
then expands back to coefficients in raw units. A graph under the inputs
shows the points, the curve and the current raw reading (yellow), with the
fit's R² and worst point. The Go side (`internal/calib`) applies `poly` and
`table` with the same maths. "Raw now" and recalibrating a converted CSV need
the old calibration reversed: linear exactly, poly and table by tabulating the
curve over its points' range (or 0–4095) and bisecting.

### Test mode (testmode/)

"Test mode" in the top bar runs the simulated car (testmode/sim.ts, the same
model the browser demo uses) in the frontend: rows go straight into the live
store at 50 Hz, backend live events are ignored while it's on, and the
status line says so. It also opens a sample outing in the Viewer. Channels
marked raw in the sim go through the profile's calibrations, so the channel
editor can be tried too. Profile edits (channel settings, car specs) still
save to the real profile. The simulated car has front and rear wheel speeds;
the Launch panel uses channels named like those as driven wheel and ground
speed by default.

### Live data in the Viewer (live/liveSession.ts)

"Watch live data" turns the live store into a Viewer session (`live://session`)
once a second while the Viewer tab is showing, by copying the time column and
every live channel. The Viewer keeps the same LoadedLog (the path doesn't
change), so the sheets, panels, math and filtered channels, laps and
analysis all run on it with the current setup. While following, each update
moves the range to the newest data: if the view starts at the first sample
it grows, otherwise it keeps its span and slides. Panning or zooming away
from the end stops following until "Follow live". Opening a log or "stop"
ends it. The aero fit needs at least four speed bands spread over 8 m/s, so
a few seconds of live data don't give a confident wrong answer.

### Comparing runs (state/references.ts, components/CompareControls.tsx)

"Save for comparing" on a G-G (XY with two accelerations) or Aero panel stores
what the panel has worked out for the data in view, under a name: the G-G
envelope polygon, its area and equal-area radius, or the aero grip-per-speed
bands with the fitted μ and ClA. These live in localStorage and travel inside
setups. "Compare to" on any G-G or Aero panel (another log, another lap
range, or live data) draws a saved result as a dashed amber line and says
how far off it is: envelope area change for G-G, and for aero the change in
summed grip over the speed bands both have in common (plus both ClA values
when there's a fit). Saving under a name that already exists replaces it.

### Simulated sessions

`simSession(name, parts)` (`sim/simSession.ts`) lays simulated laps end to end
in one `Session` so the Viewer can show them like a log. Each lap is sampled
at close to 100 Hz, with the step chosen so the lap's last sample lands
exactly on its simulated time; one extra sample before the first lap and one
after the last keep `buildLaps` from making out- and in-laps. The session sets
two optional `Session` fields:

- `simulated: true`. `useAnalysis` then ignores the device profile's channel
  labels and units (they describe sensors, and a unit change there would
  relabel values without converting them), `derivedChannels` marks Distance
  and the lap channels as theoretical, `useSimChannels` adds nothing, the
  Viewer shows the SIMULATED badge and `App` treats it like the test-mode
  log: it is not remembered as the last log, Reload returns it unchanged, and
  the Sim tab is given the real session that was open before it (`simOf`).
- `fixedLaps`: the lap boundaries in seconds. `useAnalysis` uses them as the
  split times and forces manual lap mode, so the start/finish settings do not
  apply.

Every channel has `origin: 'theory'`. `Channel.origin` is an explicit
provenance that `originOf` returns before its name and group rules, because
`withMeta` regroups channels by name (Speed goes to Vehicle, Lat G to
Accelerometer) and the group alone would no longer say where the data came
from. Tracks without `origin` are placed at `NOWHERE` (1°N 1°E) so the map
panels have coordinates.

`showSimSheet` (`state/setup.ts`) adds a "Simulated lap" sheet to the saved
workbook with `withSimSheet`, or selects it if it is already there, before
`App` switches to the Viewer.

### Setups (state/setup.ts, state/session.ts, components/SetupsDialog.tsx, services/presets.go)

A setup is the workbook (sheets and panels), math channels (including
filters), the track settings (start/finish, gate, distance source), the
launch settings, lap references, the Sim settings, the damper table, and the
split and launch marks, as one JSON object (`dawgViewerSetup: 1`, the same
shape as Export setup). `originalSetup` is that object with every default.
Named setups are files in `<config>/presets/`, written and listed by
`LiveService.SavePreset` / `Presets` / `LoadPreset` / `DeletePreset`; names
are kept as file names with characters Windows can't use replaced. A setup
can remember the log that was open. Car values are not in a setup.

`state/session.ts` keeps the config folder in step with the stores:

- `startSession` runs in `main.tsx` before the first render. It asks
  `LiveService.Stock` for the stock setup, which `setStockSetup` lays over
  the defaults in `originalSetup`, and for the sample log. With no
  `session.json`, no saved workbook and no last log it applies the original
  view. Once per config folder (`sampleShown` in `session.json`), when there
  is no last log, `App` opens the sample log (`firstBootLog`) instead of
  asking how to start, and a view with no start/finish line is given the
  stock one so the sample shows laps. Likewise once per config folder
  (`dampersOffered`), a view with no damper table is given the stock one.
  `App` shows a "SAMPLE LOG" label while the open log is `sampleLog()`. It reads
  `session.json` (`LiveService.LoadSession`), restores the other stored
  choices, then applies the setup in use from its file, or the unnamed view
  when no setup is in use or its file is gone. With no `session.json` it
  keeps what localStorage had, which moves an older install's view into the
  folder. Rendering waits at most 3 s for it.
- Every `save` in `state/storage.ts` calls the `onStored` listeners. The
  session debounces these (`SAVE_DELAY_MS`) and writes the setup in use with
  `SavePreset`, then `session.json` with `SaveSession`, skipping a file
  whose text has not changed. Writes run one at a time, and a waiting one
  is sent early on `pagehide`. A failed write shows in `saveState` and is
  retried after `SAVE_RETRY_MS`.
- `session.json` holds `setup` (the name in use, or empty), `lastLog`,
  `askOnStart`, `unnamed` (the view that is not a setup), `sampleShown`,
  `dampersOffered` and `other` (every remaining `dawg.` localStorage entry, as stored).
- `openSetup`, `createSetup`, `removeSetup`, `openUnnamed`, `startFresh` and
  `importSetup` first write any waiting change to the setup it belongs to,
  then switch. `createSetup` starts from `originalSetup` or from the stores.
  Leaving the unnamed view keeps a copy of it in `session.json`; deleting
  the setup in use, Start fresh and Import setup go back to it.

localStorage is still what the stores read and write, so the app works when
the backend cannot be reached; the folder wins when both exist. When the app
opens and there is something to go back to (a saved setup, a last log or a
saved workbook) it asks: pick up where you left off (reopen the last log),
start fresh (premade sheets and default math in the unnamed view), or use a
saved setup. "Ask me this when the app opens" turns the question off.
Applying a setup writes the stores and tells an open Viewer to swap its
workbook (`onWorkbook`), so it works with or without a log open. `App` shows
the setup in use and `saveState` next to the Setups button.

Made channels (group Math) have a delete button in the channel list, which
removes the math channel and takes it out of every panel. "Reset to defaults"
in the channel editor clears a sensor's title, colour, group, unit,
decimals, car-map spot and calibration; dashboard cards and warning limits
stay.

Launches can also be marked by hand ("Add your own launch"), since a log
starts whenever the car is switched on: a start and end time typed in, taken
from the cursor (⌖) or from the range the time plots are zoomed to. They're
measured with the same code as found launches (`manualLaunch`, from the
first sample at or after the start), listed first as "Yours n", and kept per
log path in localStorage (`launchMarks.v1`).

### Car specs (data/car.ts, views/CarView.tsx)

The Car tab edits the profile's `car:` section. `withDefaults(car, stock)`
resolves each value: the profile's, else the stock G26 car's
(`Info.stockCar`), else a typical FSAE number (`DEFAULT_CAR`), so the
analysis works before anyone fills them in. `stockKeys` lists the values
taken from the stock car; the Car tab tags those "G26 stock" and counts them
in a note, `SimView` says how many the simulation is running on, and the
Engine page tags its peak tiles and chart when the torque curve is the stock
one. `useCar` returns the same object until a value changes, so the
simulation is not rerun by unrelated profile reloads.

"Import car values…" sends the text of a picked device file to
`LiveService.ReadCarFile` and puts the returned car into the form's draft
through `withDefaults`. It only fills the page; Save is still what writes the
profile.

Save (`forProfile(car, base, entered)`) leaves a value out of the profile
while it is still the stock or typical one and was not in the profile
before, so a value nobody has set keeps its tag after the page is saved and
follows the stock car if a later version changes it.

The torque curve is a list of `[rpm, N·m]` points at the crank
(`components/TorqueEditor.tsx`). With fewer than two points in the profile
the car uses `PLACEHOLDER_TORQUE`, a stand-in restricted 600 cc curve;
`hasTorqueCurve` tells the two apart so the UI can say the curve is not the
team's, and `forProfile` saves an empty list rather than writing the stand-in
into the profile. `SimView` shows the "Not your engine" alert above every Sim
page while the stand-in is in use, quoting its peak torque and power;
`carEntered` (data/car.ts) tells whether the profile holds any car value at
all, in which case the alert also names `Info.configDir.path`. "Import dyno file…" reads a CSV with `parseTorqueCsv`
(`analysis/sim/torqueCsv.ts`): any common delimiter, an optional header,
torque in N·m or lb·ft or power in kW or hp, thinned to at most 60 points.
"Measured at the wheels" divides by the drivetrain efficiency to get crank
torque.

The tire model card (`components/TireEditor.tsx`) lists the Magic Formula
coefficients by their MF 5.2 names. A blank box means "use the value built
from the simple inputs", shown as the placeholder, so only typed or imported
coefficients are stored in the profile's `tire` map. It plots force against
slip angle and slip ratio at half, one and one and a half times the nominal
load and shows B, C, D, E and the slip at the peak. Importing a `.tir` file
also sets Peak μ and Cornering μ to the file's values, because the Launch and
Aero panels read those.

The Suspension section takes springs, motion ratios, anti-roll bars, track
widths, roll centers, unsprung mass and tire rate; the summary under it
(wheel rates, ride frequencies, roll stiffness, roll gradient, share of
lateral load transfer) comes from `analysis/sim/suspension.ts`.

### Car map (components/CarDiagram.tsx, data/sensors.ts)

A top view of the car drawn in SVG on a 200 × 400 box, nose up. Each channel
gets a dot at its profile `pos` or, failing that, the usual spot for its name.
Dots on the same spot are spread on a small ring. The hovered channel is a
module-level observable shared by the channel lists and both diagrams, so
pointing at a row lights its dot and pointing at a dot highlights (and
scrolls to) its row. The caption is HTML under the drawing, since SVG text at
the sidebar's scale would be too small to read. The highlighted dot gets a
steady ring plus a short CSS pulse that runs twice, rather than an endless
animation that would keep the page repainting.

"✎ Edit" next to the sidebar map (and the bottom of the Car tab) opens the
editor (components/SensorEditor.tsx): a large map whose dots can be dragged,
and a list with "Put on car" for sensors with no usual spot and "Reset" for
moved ones. A drop is saved through `SaveChannel` with the channel's other
settings and calibration unchanged; a press without a move saves nothing.
Computed channels (math, distance, laps) aren't offered, since they aren't
sensors.

### Aero (analysis/aero.ts, components/AeroPanel.tsx)

The Car tab takes ClA, CdA, aero balance and air density. With weight W and
μ from the Car tab, the most grip the tyres can give at speed v is
μ · (W + ½ρ·ClA·v²) ÷ W, in g. The Aero panel plots combined (or lateral) g
against speed for the laps or range in view, bins it in 2 m/s speed bands and
takes the 98th percentile of each band as the measured envelope (white). It
draws the tyre-only line (μ), the limit with the entered aero, and a weighted
least-squares fit of envelope = a + b·v² through the bands; a is the μ the
data shows and 2·b·W ÷ (ρ·a) the ClA it shows. "Grip used" is the envelope
over the limit, averaged by sample count below and above the middle speed.
If the data's ClA is under 70% of the entered one the panel says so. The panel reads the filtered `Lat G` and `Long G` channels when the log has them, names the channels it used next to the legend, and has a Data choice to switch to the raw accelerometer channels. Like the
G-G envelope, the bands are reused while the range is changing.

### GPS gap filling (analysis/fusion.ts)

Every stretch between two GPS fixes (a new position, not a held repeat) is
rebuilt by dead reckoning from speed and heading, then pinned to both fixes
by spreading the end error linearly over the stretch, so errors can't build
up. Heading comes from a Yaw/Heading channel if there is one; its sign and
offset are found by comparing it with the GPS course on good stretches (it
is used only if they agree closely). Otherwise heading is integrated from
lateral acceleration ÷ speed, with the sign found the same way. Without
either, stretches are straight lines between fixes. Stretches longer than
0.5 s or 2.5× the usual fix interval are reported as dropouts. The map,
distance and lap timing all use the filled positions; it can be turned off
in the Laps tab.

### Channel settings and groups

`data/origin.ts` classifies every channel as measured, filtered, calculated or
theoretical from its id, group and (for math channels) expression. Channels
that are not raw measurements get the word appended to their label when they
are built (`withMeta`, `derivedChannels`, `mathChannels`, `simChannels`), so
legends, axes and pickers all show it; the channel list shows it as a tag on
every row instead.

`useAnalysis` applies the profile's channel settings (title, colour, unit,
decimals, group) to the loaded log every time the profile changes, so an edit
shows at once without reloading. `name` stays the raw channel name, which math
expressions use; only the displayed title changes. Saving a calibration while
a `.bin` or long CSV is open reloads it so the backend applies it; for a wide
CSV (already converted) the Viewer converts that column itself as
new(old⁻¹(value)), assuming the file was made with the previous calibration.

### Simulated channels (viewer/simChannels.ts, viewer/useSimChannels.ts)

`useSimChannels` wraps the result of `useAnalysis` and, when the Sim tab's
"Simulated channels in the Viewer" box is ticked, appends the group `Sim`:
`Sim Speed` (in the log's speed unit), `Sim Long G`, `Sim Lat G`, `Sim Gear`,
`Sim RPM` and `Sim Time Gap` (real − simulated time since the start of the
lap, s). Each timed lap (the first 60) is rebuilt as a track and simulated
with the Car tab's car, and the result is written back onto the log's own
samples by lap distance, so the channels behave like any other in time plots,
lap overlays, XY plots and math. Samples outside timed laps are NaN. The
filter dialog's "Every sensor" button skips them, as it does math and
analysis channels.

A lap is treated as closed when its end is within 25 m of its start, and as a
standing start when it begins below 1.5 m/s; other laps enter at the logged
speed.

## Sim tab (views/SimView.tsx, sim/, analysis/sim/)

The simulator answers "what should this car be able to do" from the Car tab's
numbers and compares it with a log. Everything numerical is in
`analysis/sim/` as pure functions of a `CarSpecs` (no React, no stores), which
is what the tests exercise; `sim/` and `views/SimView.tsx` only lay the
results out. `SimView` takes the Viewer's open session, runs it through
`useAnalysis` for distance, laps and filled GPS, and works without a log
too.

### Model

It is a point-mass, quasi-steady-state model: at every speed the car has a
most-it-can-do in each direction, and a run is stitched together from those
limits. It does not model transients, dampers, tire temperature or the driver.

- `powertrain.ts`: torque is interpolated from the curve and held flat
  outside it. `wheelForce` is torque × overall ratio × `driveEff` ÷ tire
  radius, zero above redline; in the launch gear below the clutch speed the
  engine is held at `launchRpm` (peak-torque RPM if unset) as if the clutch
  were slipping. `shiftPoints` finds, for each gear, the speed where the next
  gear starts to give more force, or redline.
- `suspension.ts`: wheel rate = spring × motion ratio², in series with the
  tire for ride rate; ride frequency from the sprung corner mass; roll
  stiffness per axle from wheel rates over the track width plus the bar; roll
  gradient from the sprung mass's roll arm; lateral load transfer per axle
  from the unsprung mass, the roll center height and the axle's share of roll
  stiffness.
- `tire.ts`: the Pacejka Magic Formula, F = D·sin(C·atan(B·s − E·(B·s −
  atan(B·s)))), in the MF 5.2 pure-slip form without camber. For cornering,
  D = (pDy1 + pDy2·dfz)·Fz, the stiffness K = pKy1·Fz0·sin(pKy4·atan(Fz ÷
  (pKy2·Fz0))) with pKy4 = 2 unless a file fits it, and B = K ÷ (C·D); drive and brake use the pDx/pKx set with
  slip ratio. `tireOf` builds the coefficients: anything in the profile's
  `tire` map wins, and the rest comes from the Car tab's simple values (peak
  μ, cornering μ, grip kept at double load) with typical shape and stiffness
  numbers, so the model works before anyone has tire data. `axlePeak` finds
  the most two tires at different loads can give at one shared slip angle,
  which is a little less than the sum of their separate peaks.
  `combinedEnvelope` runs the MF combined-slip weighting functions (rBx, rCx,
  rBy, rCy) over a grid of slip angle and slip ratio and returns how much
  drive or brake force is left for each share of cornering force in use.
  `parseTir` reads those coefficients from an MF 5.2 or MF 6 `.tir` file, or
  from a MATLAB `.m` tire model that assigns the same names, applying the
  scaling factors and sign conventions. The cornering limit is never taken
  beyond the file's tested slip angle (`ALPMAX`). Drive, brake and
  combined-slip numbers are skipped when the file's slip-ratio range is
  empty, since they are then template values, and the import note says when
  a cornering fit has no peak or is lopsided left to right. Curvature uses
  the average of the left and right branches.
- `grip.ts`: `cornering` finds the highest lateral g at which neither axle
  needs more than `axlePeak` gives after load transfer and downforce, and
  reports how hard each end is working, which is the understeer/oversteer
  answer. `handling` adds the linear-range understeer gradient from the axle
  cornering stiffnesses and the slip angle each axle runs at. `tractionForce` (rear-drive, with longitudinal load transfer) and
  `brakeForce` are found the same way. `buildLimits` tabulates all of them,
  drive force in the best gear, and resistance (drag + rolling) every
  0.25 m/s up to 80 m/s, and finds top speed where drive meets resistance,
  capped at redline in top gear.
- `straight.ts`: `simulateRun` time-steps a standing start with gear changes
  (no drive for `shiftTime`) and reports 75 m, 0–60 and 0–100 km/h times and
  how long the car was traction-limited.
- `lapsim.ts`: `simulateLap` works on a track given as distance and
  curvature. Corner speed at each point comes from the lateral limit; a
  forward pass accelerates from each point as hard as the engine and the
  remaining grip allow (the tire's combined-slip envelope), carrying the gear
  as state
  (upshift at the shift speed, no drive for `shiftTime`, downshift only once
  10% below the lower gear's shift speed so the car cannot hunt between
  gears); a backward pass applies the braking limit. Closed tracks are run as
  three laps and the middle one is kept, so the lap starts and ends at
  matching speeds. Every point is labelled with what limits it (`LIMIT`:
  braking, cornering, traction, power, shifting).

### Tracks (analysis/sim/simtrack.ts)

A `SimTrack` is distance, curvature and an x/y path for drawing.
`skidpadTrack` and `straightTrack` are the two event shapes;
`segmentsTrack` builds one from typed lines such as `straight 60` and
`left 9 180deg`. `trackFromLog` rebuilds a logged lap on a 1 m grid. Its
default takes curvature from the car's own motion, lateral g ÷ speed², after
a 2 Hz zero-phase low-pass, because that is clean wherever the car has an
accelerometer; the alternative differentiates the smoothed GPS path, with the
sign checked against lateral g. Curvature is clamped to a 4 m radius. The lap
page offers both and the smoothing length, since too little smoothing turns
noise into corners and too much rounds real corners off and makes the lap too
fast.

`segmentsTrack` places its points exactly along each straight and arc, so a
typed circuit that really closes ends where it started.

### Track files (analysis/sim/trackfile.ts)

`readTrackFile(name, bytes)` turns an imported file into either section lines
for the typed track or an outline of points:

- `parseOltra` reads an OptimumLap `.OLTra` track. The format is not
  published; the reader relies on what a real file shows: .NET `BinaryWriter`
  output, a flag byte, then length-prefixed UTF-8 strings (file version,
  dates, id, name, circuit type…) and, further on, three arrays in a row, each
  an `int32` count followed by that many `float64`s: section length (m),
  corner radius (m, 0 for a straight) and direction (+1 left, −1 right,
  0 straight). It finds the arrays by looking for three equal counts whose
  third array holds only −1, 0 and 1.
- `parseTrackTable` reads a table of sections (type, length, radius).
- `parsePathTable` reads points: `x`/`y` (or `x_m`/`y_m`) in metres or
  latitude/longitude, with an optional width (`width`, or `w_tr_right_m` +
  `w_tr_left_m`). GPX (`trkpt`/`rtept`), KML (`coordinates`) and GeoJSON (the
  longest coordinate list) are read as latitude/longitude outlines.

An outline counts as a closed loop when its ends are within 15 m or four
average point spacings of each other. `sim/importTrack.ts` puts the result
into the simulator's settings.

### Outlines and the ideal line (analysis/sim/raceline.ts)

`trackFromPath` builds a `SimTrack` from points: outlines sparser than 1.5 m
are first rounded with a centripetal Catmull-Rom spline, the path is resampled
every 1.5 m, smoothed with a few shrink-free (Taubin) passes, given curvature
from the circle through each three neighbouring points and finally
interpolated onto the 0.5 m grid the lap simulation is run on. `fromLatLon`
converts latitude/longitude to local metres.

A recorded GPS path needs more than that: a centimetre of position noise at
1.5 m spacing is a curvature error near 0.01 1/m, which is most of a g at
speed. With `smoothM` set, `trackFromPath` instead averages the positions
twice over that many metres, takes curvature from points 2 m either side and
averages the curvature over the same distance, as `trackFromLog` does for its
GPS source. The driven line of a logged lap is built this way with the Lap
page's smoothing (at least 1.5 m); an outline uses `PathTrack.smooth`, which
is 3 m for an imported GPX file and 0 otherwise.

`racingLine(track, room, weight)` moves each point of the 1.5 m path sideways,
at most `room` metres, to minimise the sum of squared second differences of
the path (its bending) plus `weight` times the squared first differences (its
length). It is solved by projected successive over-relaxation, coarse grid
first (6 m, 3 m, 1.5 m). Because moving points along the original normals
bunches them on the inside of corners and biases that sum, the result is then
re-spaced evenly along itself and solved again three times, with the limits
recomputed from each point's distance to the original path. An open track
keeps its start on the original path; a track marked closed whose ends do not
meet is treated as open with both ends held.

`idealLine` runs `racingLine` for six weights (`LINE_WEIGHTS`, from pure
minimum bending to strongly favouring a short path) and returns the one with
the lowest simulated lap time, with the distance along the original path and
the sideways offset of every point for plotting. This is a search within one
family of smooth lines, not a minimum-time optimisation.

### Comparing with the log (analysis/sim/fromlog.ts)

- `correlate` puts the real speed onto the simulated lap's distance grid and
  returns the lap-time gap, the average and RMS speed difference, R², the
  share of the lap where the real car is within 3% of the simulated speed,
  and the time lost split by what was limiting the simulated car at that
  point. A loss under "power" on a car with good grip numbers points at the
  torque curve or the driver's throttle; a loss under "cornering" points at
  the tire and aero numbers or at line.
- The lap page's envelope table compares the 98th percentile of the real
  lap's lateral, braking and accelerating g with the same percentile of the
  simulated lap, so a tire μ that is set too high or too low shows as a ratio
  away from 1. The real signals are low-passed at 2 Hz first so vibration is
  not counted as grip.
- `logInputs` (viewer/simChannels.ts) gathers what the comparison needs from
  a log. An accelerometer channel with no unit is taken as m/s² when more
  than 2% of its samples are beyond ±4, since no car pulls 4 g; otherwise it
  is taken as g (`accelInG` in `analysis/accel.ts`).
- `torqueFromLog` estimates the torque curve from the log: full-throttle
  samples (throttle within the top 10% of its logged range, so raw sensor
  counts work as well as percent), in a gear identified from
  RPM ÷ speed within 5% of a known ratio, not traction-limited, are turned
  into crank torque from mass × acceleration + resistance and binned every
  250 rpm (at least 6 samples a bin). It uses the longitudinal accelerometer
  when there is one and the slope of speed otherwise, where a three-part
  slope check drops samples next to a shift. It leaves out rotating inertia,
  so low gears read a few percent low, and it is only as good as the mass and
  drag on the Car tab.

### Pages (sim/)

`SimView` computes the car's limits, the 75 m run and the chosen lap once and
shows four headline numbers; the pages below draw from the same results.
`state/sim.ts` persists the open page, track choice, sweep setup and the
what-if changes (`sim.v1`).

- What-if (`WhatIf.tsx`, `analysis/sim/sweep.ts`): `SIM_PARAMS` lists the
  values that can be changed, with units and sensible sweep ranges;
  `withOverrides` returns a changed copy of the car. Nothing is saved to the
  profile. Every page then shows both cars.
- Engine & gearing: torque and power, tire force per gear against the grip
  limit and resistance, shift table, and the torque estimate with "Use this
  as the car's curve" (`LiveService.SaveCar`).
- Acceleration: the 75 m run against the log's best launch, found with the
  launch analysis.
- Lap (`useSimLap.ts`, `LapSection.tsx`, `SimTrackMap.tsx`): track choice,
  speed trace with the limit strip, map coloured by limit or speed, time lost
  by phase and the envelope table. `TrackTools.tsx` holds the online search
  (`LiveService.FindTracks` / `TracksNear`, shown according to
  `Info.trackSearch`) and the ideal-line controls; `importTrack.ts` the file
  import. The chosen outline is stored with the other simulator settings
  (`SimSettings.path`), so it survives a restart without another lookup.
  With the ideal line on, `useSimLap` returns it as `line` next to the
  unchanged main result: for typed and outline tracks it is worked out on the
  track itself, for a logged lap on the lap's GPS path rebuilt with
  `trackFromPath`, so both times in that comparison come from the same
  geometry. The map then draws the line, the original path dashed and a band
  as wide as the room plus the car, and can be zoomed and dragged.
  `pace` is the best timed lap of the open log divided by the simulated time
  of that same lap; the page multiplies theoretical times by it for the
  "likely lap".
  `trackLibrary.ts` turns the track on screen into the saved-track file
  (`dawgViewerTrack: 1`, kind `segments` or `path`, with width and smoothing)
  and back; `SavedTracks` in `TrackTools.tsx` lists, saves, opens and deletes
  them through `LiveService`. A logged lap is saved as its raw GPS path plus
  the smoothing in use, so opening it rebuilds the same driven line.
  `simSession.ts` turns simulated laps into a `Session` for the Viewer; see
  [Simulated sessions](#simulated-sessions).
- Skidpad & balance: skidpad time and g on the 9.125 m radius (15.25 m inner
  diameter plus half a 3 m lane), roll gradient, front share of lateral load
  transfer, understeer gradient, front and rear slip angles, and which end
  saturates first at skidpad speed and at 90 km/h.
- Dampers (`DamperSection.tsx`, `analysis/sim/damper.ts`, `state/dampers.ts`):
  `parseShockDyno` reads a shock dyno table and keeps, for every shock and
  setting, the force at the highest speed of each dyno run with that run's
  zero-speed force taken out, compression and rebound separately. Blank cells
  are skipped, not read as zero. `dampingRatio` is force ÷ speed, times the
  motion ratio squared, over 2·√(wheel rate × sprung corner mass). The parsed
  table is kept in localStorage (`dampers.v1`), not in the profile.
- Sweeps: one parameter stepped across a range against 75 m time, skidpad
  time, lap time or top speed. Tire pressure is one of them: with the MF 6
  pressure terms (pPy1–pPy4) set, `latCurve` scales cornering grip by
  1 + pPy3·dp + pPy4·dp² and changes the stiffness curve, where dp is the
  relative difference between running and nominal pressure.

Charts are `components/SimChart.tsx`, a small SVG line/point chart sized by a
`ResizeObserver`. uPlot is not used here because these plots are a few hundred
points against speed, RPM or distance with no shared time axis.

## Live track map (live/LiveMap.tsx)

The Live tab's "Track map" shows the car on the GPS trace with the last two
minutes highlighted, and lap times from the same start/finish beacon as the
Viewer. The map draws raw GPS (no gap filling). Lap timing only looks at rows newer than the last one it checked
(found by time, since the store drops old rows), so it costs nothing per
frame. The map re-fits the track as it grows until you zoom or pan. It takes
the same map background as the Viewer's maps.

## Viewer module boundaries

- `data/columns.ts` constructs a Session from Float64 columns and explicit metadata.
  It imports neither Wails services nor the live connection. Test mode uses the
  same constructor. Its caller owns the buffer and keeps it immutable.
- `analysis/settings.ts` defines track/lap settings independently of persisted
  stores. `state/analysis.ts` owns their current values and React subscriptions.
- `viewer/analysis.ts` contains pure stages for fusion, distance, laps/runs,
  derived channels, and math. All data and settings are arguments.
- `viewer/useAnalysis.ts` subscribes to settings and memoizes these stages. The
  view passes active-profile metadata explicitly. Numeric dependencies use the
  effective units; cosmetic changes apply display metadata without recalculating
  distance, laps, or math. Unit changes invalidate the affected analysis.
- `viewer/useViewerWorkbook.ts` owns workbook initialization, persistence, layout
  dispatch, and setup notifications.
- `viewer/useViewerNavigation.ts` owns lap selection, overlay/time views,
  synchronization, pending zooms, and live following.
- `viewer/useRecalibration.ts` owns per-session CSV column overrides and the raw
  log reload decision. Reloading a session discards its temporary overrides.
- `state/panels.ts` supplies the panel kinds and toolbar labels/help. Layout and
  saved-workbook validation share those kinds; panel rendering remains explicit
  in ViewerView so each panel's distinct inputs are visible.

`PlotPanel` distinguishes series structure from sample data. Data-only updates
call the existing mounted plot's `update`, preserving manual y zoom and observers.
Changes to channel identity, scale, title, colour, dash, or synchronization rebuild
the plot. Bounds, minimum span, markers, and cursor values read the latest view,
so they do not capture a stale live snapshot.

`live/snapshot.ts` builds immutable Viewer snapshots from an injected LiveStore.
`live/liveSession.ts` supplies the application's connection state. App still
refreshes once a second only while watching in the visible Viewer tab. No sample
revision change means no new snapshot; metadata-only changes reuse numeric buffers.
Each changed sample batch is still copied in full, appropriate to the usual
five-minute session. Longer retained histories remain supported by existing settings.
