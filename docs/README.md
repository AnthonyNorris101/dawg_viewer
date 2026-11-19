# Dawg Viewer technical overview

This page is the technical entry point to the repository documentation. For installation and application workflows, start with the [user-facing README](../README.md) and [user guide](user-guide.md). Contributors should start with [CONTRIBUTING.md](../CONTRIBUTING.md), which collects the development workflow and contributor references.

## System at a glance

Dawg Viewer is a Wails desktop application. The Go backend owns device networking, configuration, log decoding, and file delivery. The React and TypeScript frontend owns live presentation, Viewer state, and numerical analysis. Wails generated bindings expose service calls; Wails events carry live frames and status.

```text
logger ── UDP / discovery / TCP ──> Go services ── Wails events and calls ──> React UI
                                     │                                  │
                                     └── log decode and transfer ───────┘
```

The live pipeline decodes sparse telemetry packets into named and calibrated rows, then batches rows into frames. The frontend turns those rows into channel columns for plots and readouts. Logs follow a separate path through decoding or CSV loading and are delivered to the Viewer as typed columns. See [architecture](architecture.md) for timing, concurrency, and memory ownership.

## Repository map

| Path | Responsibility |
|---|---|
| `main.go` | Application startup, embedded frontend assets, Wails service registration |
| `services/` | Wails boundary and orchestration for live data, logs, and setups |
| `internal/link/`, `internal/itv/`, `internal/live/` | Network I/O, wire decoding, and live session processing |
| `internal/config/`, `internal/calib/` | User configuration, device profiles, and calibration |
| `internal/logfile/`, `internal/logdata/`, `internal/fileserver/` | Log conversion, column encoding, one-time transfer, and logger downloads |
| `frontend/src/live/`, `frontend/src/plot/` | Live store, refresh behavior, and plot lifecycle |
| `frontend/src/analysis/`, `frontend/src/viewer/` | Pure analysis stages and Viewer orchestration |
| `cmd/` | Logger simulator and version management tools |
| `docs/` | User, protocol, architecture, and development references |

The package-level backend guide is [backend.md](backend.md); the frontend guide is [frontend.md](frontend.md).

## Interfaces and references

- [Device protocol](device-protocol.md): telemetry fields, discovery, command sync, and SD-card log format.
- [Configuration](configuration.md): YAML settings, device profiles, calibration, and saved setups.
- [Architecture](architecture.md): data flow, concurrency boundaries, clock alignment, and CSV transfer constraints.
- [Frontend](frontend.md): update model, plot lifecycle, Viewer analysis, and module ownership.
- [Backend](backend.md): Go services and package responsibilities.
- [Development](development.md): toolchain, simulator, tests, CI, packaging, and versioning.
- [Dawg Viewer 0.3.0 changelog](changelog/0.3.0.md): release highlights, reliability improvements, and upgrade notes.

## Technical constraints

The logger sends sparse channel updates; missing values in a packet retain their previous value in the live store. Device timestamps are used when available, with arrival time as fallback. The backend retains only pending live rows; the frontend owns the live history. Imported logs are still processed in memory, although Go streams encoded columns in chunks to avoid a second full encoded matrix. See [architecture](architecture.md) and [backend](backend.md) for details and limits.
