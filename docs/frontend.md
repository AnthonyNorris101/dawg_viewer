# Frontend

React + TypeScript + Tailwind, built with Vite, plots drawn with uPlot.

```
src/App.tsx        tabs (Live / Logs / Viewer)
src/live/          live view: connection, store, follow mode, cards, plots, status bar
src/views/         LiveView, LogsView, ViewerView
src/viewer/        turning a loaded log into a viewer session
src/plot/          uPlot wrapper and shared plot view state
src/components/    channel list and viewer plot panel
src/state/         plot layout reducer
src/data/          viewer session type and shared colours
```

## Guiding rule: high-rate updates bypass React

Data arrives 20 times a second and the cursor moves at pointer rate. Routing
those through React state would re-render the tree every time. So:

- values, card colours, legend readouts and plot data are written straight to
  the DOM or handed straight to uPlot from store subscriptions;
- React re-renders only for slow-changing things: status (2/s), the channel
  list, profile info and plot layout.

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

## Cards (live/PinnedCards.tsx)

Pinned channels from the profile, in `order`. Values, warn/crit background
and the age border are written to the DOM on each frame and every 500 ms
(ages keep growing when no data arrives). The border goes from green when
fresh to red at 10 s and then dims — the same curve as the old InfoBox
widget (`ageColor` in `live/format.ts`).

## Plots (live/LivePlotPanel.tsx)

- Selected channels the device hasn't sent yet are shown as waiting, off the
  plot; the plot is rebuilt when they first appear.
- On every store update the plot gets fresh column views (`setData(…, false)`
  keeps the current x range for follow mode to set).
- Legend values show the cursor position, or the newest value when the cursor
  is off the plot.

## Layout (state/layout.ts)

Layouts support five charts and fifteen channel entries total. The Profiles
button beside the version opens all profile controls for the active Live or
Viewer layout. Named profiles are stored locally; Default is built in, and saved
layouts can be replaced after confirmation or deleted. Profiles may also remember
a finite Live time window and custom plot heights.

Plots have resize handles at the upper- and lower-right corners. Drag up from the
upper handle or down from the lower handle to set a custom height, use the arrow
keys while a handle is focused for precise changes, or press Home/double-click to
return to automatic sizing. Custom heights stay
local and are not included in offline share codes because pixel sizes are specific
to a window and display.

Offline sharing hashes exact UTF-8 channel names with SHA-256. Version 1 uses
22-bit prefixes for caches up to 256 names, or 32-bit prefixes for larger caches.
The Base32 code includes chart counts and a CRC-16 for typing errors. Full
five-chart layouts use 75 characters (22-bit) or 105 characters (32-bit), excluding
optional spaces. Names learned from Live or opened logs are cached locally.
Import previews the layout before applying it. Missing or ambiguous hashes remain
unresolved and retry when new names arrive. Matching is disabled when cache size
would exceed the conservative 0.1% ambiguity bound for fifteen entries. Hashes
cannot reconstruct names that the recipient has never learned.

A reducer for the list of plot panels and which one is active. Untouched
panels keep their object identity so memoised plots don't rebuild. Removing
the last panel empties it instead, so there's always one.

## Tabs (App.tsx)

Views stay mounted and are hidden with CSS, so live data and plot layouts
survive tab switches.

## Logs tab (views/LogsView.tsx)

Two lists: logs on the logger (Connect, Download selected, Download latest,
Done) and files in the logs folder (Open, and Convert for `.bin`). The view is
only mounted while its tab is open: opening it loads the local list, and
closing it calls `FinishRemote` so the logger starts recording again.
Download progress comes from `logs:progress` events.

## Viewer tab

`viewer/openLog.ts` loads a file through `LogService.Load`, fetches its
`dataUrl` once as an `ArrayBuffer`, and builds a `Session` whose columns are
`Float64Array` views straight into that buffer (no copying) (units and precision come from the current device profile when the
names match). `ViewerView` remounts per file, so the plot layout starts fresh
with RPM/TPS1, temperatures and accelerations if present, else the first
channels. Opening a log from the Logs tab switches to the Viewer.
