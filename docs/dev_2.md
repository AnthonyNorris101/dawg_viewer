# Current branch behavior

This file describes the checked-out implementation. Older feature-port plans are
historical context; they do not override current code or tests. Changes should
preserve this branch's analysis, Car tab, setups, test mode, and backend integration.

## Settings and Live layouts

Settings is a top-level destination after Car. It uses a centered, vertically
scrolling column without a settings sidebar. The current control selects Default
or Bento for the Live plot layout and persists under `dawg.live-layout-mode.v1`.
Missing/invalid storage selects Default. The control is a button with a choice
menu, rather than a native select.

Default stacks time plots vertically. Bento includes time plots and the optional
track map in a two-column grid, with independent half/full width and short/tall
height choices. It uses one-pixel dividers. Stable item IDs keep graphs mounted
through presentation changes. A shared graph container owns vertical scrolling.

Bento currently stores explicit row/column slots in session state. Dragging can
swap items or place them into an empty slot. Compatible slots survive subsequent
placement, so empty cells can remain. It is not a dense-compaction-only layout.
Returning to Default orders plots by their visible row and column. Layout and
sizing state are session-local; only the Default/Bento preference persists.
Viewer worksheets do not use this setting or layout model.

## Viewer and saved state

Viewer supports worksheets, time plots, lap overlays, XY/G-G, histograms, maps,
FFT, filters, math channels, launch/aero analysis, comparisons, and live watching.
Workbooks persist globally under `dawg.workbook.v1`. Setups store workbook,
analysis settings, made channels, and references; they can be imported/exported
or saved in the config folder. Device profile metadata and calibrations drive
channel editing; Live layouts are not saved per profile.

Viewer analysis is divided between pure stages and focused React controllers.
See [frontend.md](frontend.md) and [modularity.md](modularity.md) for current
ownership, data-update behavior, and performance limits.

## Tests and builds

Vitest covers analysis, live snapshots/history, plot lifecycle, Viewer controllers,
layout, loading, and navigation. Go tests cover decoding, normalization, column
encoding/delivery, configuration, calibration, file serving, and live telemetry.
`just test` runs the normal gates. PR CI regenerates bindings and builds the
frontend, then runs Go vet/race tests and frontend tests/lint/formatting. Platform
packaging runs for non-PR events. See [development.md](development.md).
