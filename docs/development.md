# Development

Needs Go, Node.js, the Wails v3 CLI (`wails3`) and [just](https://just.systems).
Run `just` to list every command.

## just

On Windows the recipes run in PowerShell so Git Bash isn't needed, with
`-ExecutionPolicy Bypass` for that process only: some machines block
PowerShell scripts, which stops `npm` (installed as `npm.ps1`) from running.
Elsewhere they run in `sh`.

- `just simulate` builds the simulator, starts it in the background, then
  runs `wails3 dev`; when the app closes (or Ctrl+C) the simulator is stopped
  too, so no stray process keeps the ports.
- `just sim` runs only the simulator.
- `just test` runs Go vet and tests, then frontend tests, type check, lint and
  format check. `just test-race` adds the race detector (needs a C compiler).
- `just bindings` regenerates `frontend/bindings` after changing Go services.

## Simulator

`cmd/iltm-sim` speaks the ILTM's protocol; see [backend.md](backend.md).

`tools/uno_q_sim.py` is the Python version for the Arduino UNO Q (standard
library only). It uses the id `UNOQ-SIM` and correct GPS names, and has the
same file server on port 8080: at start-up it writes three fake `.bin` logs
into `--logs-dir` (default `tools/logs`, ignored by git) if that folder has
none, and serves every file there, so `.bin` or `.csv` files you copy in can
be pulled from the Logs tab. Its log encoder produces byte-for-byte the same
files as `logfile.Encode`. See [device-protocol.md](device-protocol.md).

## Tests

- `internal/itv`: round trips, real firmware bytes, malformed input, zero
  padding, and a fuzz target (`just fuzz`).
- `internal/calib`: RadTemp points map back onto themselves; coefficients
  match an independent calculation.
- `internal/config`: seeding, never overwriting, broken profiles reported,
  saving the device without changing anything else, the name cache.
- `internal/live`: end to end over real loopback UDP — names, renames,
  calibration, combined channels, unknown ids keeping the packet, command
  packets ignored, the sender filter, the name cache, and restarting on the
  same port.
- `frontend/src`: Vitest tests cover telemetry history, live state, layout,
  log loading, app navigation and Logs actions. Run them with
  `npm --prefix frontend run test` or use `test:watch` while editing.

`bindings/` is generated, so ESLint ignores it.

## CI and releases

`.github/workflows/release.yml`:

1. **Test** (Ubuntu): regenerates bindings and builds `frontend/dist` first —
   the Go program embeds it and won't compile without it — then Go vet and
   race tests, frontend tests, lint and format check.
2. **Build** on Windows, macOS and Linux runners in parallel (one failing
   doesn't stop the others):
   - Windows: installer (NSIS, installed with Chocolatey) and a portable zip;
   - macOS: universal (Apple Silicon + Intel) `.app` zip, plus a `.dmg`;
   - Linux: `.deb`, `.rpm`, AppImage and a portable tarball.

   The portable downloads include a `dawg_config` folder so settings travel
   with the app. The AppImage and `.dmg` steps may fail without failing the
   run; the file is then left out of the release.
3. **Release** (pushes to `main` only): tag `v<info.version>-build.<run>`,
   version from `build/config.yml`, all files plus `SHA256SUMS.txt`.

Pull requests run steps 1 and 2 so packaging problems show up before merging.

### Version number

The version is written in eight places across five files, because each
platform's packaging reads its own: `info.version` in `build/config.yml`,
`file_version` and `ProductVersion` in `build/windows/info.json` (the `.exe`'s
file details), `CFBundleShortVersionString` and `CFBundleVersion` in
`build/darwin/Info.plist` and `Info.dev.plist`, and `version` in
`build/linux/nfpm/nfpm.yaml`. Wails can regenerate those files from
`build/config.yml`, but that rewrites them entirely, so instead
`cmd/setversion` (`just version X.Y.Z`) edits just the version fields. With no
argument it prints the version; `-check` fails if the files disagree, which
the test job runs so a release can't ship with mixed numbers.

`main.go` embeds `build/config.yml` and reads `info.version` at build time
(`dev` if it can't), and the frontend shows it in the tab bar. The release
tag adds the CI run number: `v0.2.0-build.17`.

The shared setup (`.github/actions/setup`) installs Go, Node, GTK 4 and
WebKitGTK 6 on Linux (what Wails builds against there), the Wails CLI at the
version in `go.mod`, and the frontend packages. nfpm, which builds the `.deb`
and `.rpm`, reads `GIT_COMMITTER_NAME`/`EMAIL` for the maintainer field.

Builds aren't code-signed, so Windows SmartScreen and macOS Gatekeeper warn on
first launch.
