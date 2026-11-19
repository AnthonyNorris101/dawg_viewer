# Frontend

React + TypeScript + Tailwind, built with Vite, plots drawn with uPlot.

```
src/App.tsx        tabs (Live / Logs / Viewer / Car / Settings)
src/live/          live view: connection, store, follow mode, cards, plots, status bar
src/views/         LiveView, LogsView, ViewerView, CarView, SettingsView
src/viewer/        pure session analysis plus focused React controllers
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
and layouts across tab switches. Logs, Car, and Settings mount only while selected.

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
names match). `ViewerView` remounts per file. Opening a log from the Logs tab
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
two-column grid; time plots default to full width, the others to half. Rows
are at least 17rem tall (the Launch panel takes two), and the grid scrolls
when a sheet has more than fits, so panels never get squeezed into each
other. A panel clips its own contents and its legend gets at most two lines
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

### Side panel (components/Sidebar.tsx)

- Laps: lap table (best lap in purple, Δ to best, max speed), tick laps to
  overlay and pick the reference, start/finish and splits "at cursor". The
  cursor is the last position the pointer was over a plot, since moving to
  the button leaves the plot.
- Stats: min, average and max over the part in view for every channel on the
  worksheet's time plots (per lap when overlaying), recomputed once per
  animation frame while zooming.
- Values: every channel at the cursor, written to the DOM directly.

### Settings storage (state/storage.ts)

Workbook, math channels, track settings and splits are small JSON values in
the webview's localStorage, validated when read so a bad or old value falls
back to the default. Storage can be missing or throw, so every access is
wrapped and the app works without it.

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

### Setups (state/setup.ts, components/SetupsDialog.tsx, services/presets.go)

A setup is the workbook (sheets and panels), math channels (including
filters), the track settings (start/finish, gate, distance source) and the
launch settings, as one JSON object (`dawgViewerSetup: 1`, the same shape as
Export setup). Named setups are files in `<config>/presets/`, written and
listed by `LiveService.SavePreset` / `Presets` / `LoadPreset` /
`DeletePreset`; names are kept as file names with characters Windows can't
use replaced. A setup can remember the log that was open.

Everything is also autosaved to localStorage as before. When the app opens
and there is something to go back to (a saved setup, a last log or a saved
workbook) it asks: pick up where you left off (keep the autosave, reopen the
last log), start fresh (premade sheets and default math), or use a saved
setup. "Ask me this when the app opens" turns the question off. Applying a
setup writes the stores and tells an open Viewer to swap its workbook
(`onWorkbook`), so it works with or without a log open.

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

The Car tab edits the profile's `car:` section. Zero or missing values use
typical FSAE numbers, so the analysis works before anyone fills them in.

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
If the data's ClA is under 70% of the entered one the panel says so. Like the
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

`useAnalysis` applies the profile's channel settings (title, colour, unit,
decimals, group) to the loaded log every time the profile changes, so an edit
shows at once without reloading. `name` stays the raw channel name, which math
expressions use; only the displayed title changes. Saving a calibration while
a `.bin` or long CSV is open reloads it so the backend applies it; for a wide
CSV (already converted) the Viewer converts that column itself as
new(old⁻¹(value)), assuming the file was made with the previous calibration.

## Live track map (live/LiveMap.tsx)

The Live tab's "Track map" shows the car on the GPS trace with the last two
minutes highlighted, and lap times from the same start/finish beacon as the
Viewer. The map draws raw GPS (no gap filling). Lap timing only looks at rows newer than the last one it checked
(found by time, since the store drops old rows), so it costs nothing per
frame. The map re-fits the track as it grows until you zoom or pan.

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
