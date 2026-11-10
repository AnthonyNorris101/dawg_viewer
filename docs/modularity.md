# Module ownership and data handling

The current implementation separates numerical functions, React coordination,
and transport. Live sessions usually contain at most five minutes of continuous
data, while imported CSV logs can be substantially larger. Five minutes is a
workload assumption; configuration and retention limits have not been changed.

## Frontend boundaries

| Module | Owns | Does not own |
|---|---|---|
| `data/columns.ts` | Zero-copy Session construction with explicit metadata | Wails calls, active profile selection |
| `analysis/settings.ts` | Track/lap settings types | Persistence or React subscriptions |
| `viewer/analysis.ts` | Pure fusion, distance, laps, derived channels, math stages | Global live state, React effects |
| `viewer/useAnalysis.ts` | Settings subscriptions and stage memoization | Device calls or plot mounting |
| `viewer/useViewerWorkbook.ts` | Workbook initialization, persistence, layout dispatch, setup notifications | Numerical data |
| `viewer/useViewerNavigation.ts` | Selection, overlays, synchronization, zoom, live following | Stored workbook format |
| `viewer/useRecalibration.ts` | Session-specific CSV overrides and raw-file reload decisions | Calibration editor rendering |
| `state/workbook.ts` | Workbook structure and operations across worksheets | UI traversal of workbook internals |
| `state/panels.ts` | Panel kinds and toolbar metadata, shared with validation | Panel-specific rendering or calculations |
| `live/snapshot.ts` | Revision-aware immutable snapshots from an injected store | The application's connection singleton |
| `live/liveSession.ts` | Supplies connection state to the snapshot reader | Snapshot construction rules |

Display metadata is applied separately from numerical analysis. Changing a title,
colour, precision, or group preserves derived numeric buffers. Effective units
participate in invalidation because they affect distance and fusion. Math edits
invalidate math results without invalidating distance. Session buffers are
immutable once published; mutable LiveStore views never escape as Viewer snapshots.

Viewer time plots compare series structure separately from data. Existing plots
receive new data without losing manual y zoom, range synchronization, observers,
or subscriptions. Structural changes rebuild the plot. Dynamic bounds, lap
markers, minimum spans, and cursor readouts use the latest view.

The Live tab continues to read store views directly at frame rate. Watching in
Viewer still snapshots at most once a second while visible. Unchanged sample
revisions reuse the Session; metadata changes reuse the copied sample buffers.
New data still triggers a full immutable snapshot. At the usual five minutes and
50 Hz, 60 channels plus time contain about 7.32 MB of samples, before capacity
and derived-channel overhead, so a worker/chunking framework is not required for
this refactor.

## Go boundaries and CSV memory

`LogService.Load` selects the file/profile and returns Viewer metadata.
`internal/logdata.Store` owns pending one-time table transfers, and
`logfile.Table.WriteColumns` encodes their data. `services/logdata.go` is the
small Wails middleware adapter. These boundaries preserve the exported service
contract and existing generated bindings.

Transfer ownership moves from Load to the store and then to the first HTTP
request claiming its token. The table must not be mutated after registration.
Encoding runs outside the store mutex. URLs are single-use; pending transfers
retain the existing two-table policy and are cleared at shutdown. Writer errors
stop encoding; the declared length and frontend size check detect incomplete
data. Request cancellation stops encoding at the next chunk.

Encoding uses a 64 KiB buffer rather than an additional complete matrix. The
wire protocol is unchanged: little-endian Float64 time in relative seconds,
followed by each full channel. The frontend fetches a full ArrayBuffer and views
the columns without copying.

### Reproducible encoding benchmark

Run from the repository root:

```powershell
go test ./internal/logfile -run '^$' -bench BenchmarkColumnTransfer -benchtime=3x -count=3 -benchmem
```

Measured November 9, 2026, with Go 1.27.3, Windows/amd64, on the execution host
reported as `Virtual CPU @ 3.41GHz`. The benchmark compares the previous
materialized encoding algorithm with streaming to `io.Discard`, using synthetic
Float64 tables. Table allocation is outside the timed operation.

| Samples and channels | Previous extra allocation per encode | Streaming extra allocation per encode |
|---|---:|---:|
| 15,000 x 60 (five minutes at 50 Hz) | About 7.32 MB | 65,536 bytes |
| 100,000 x 60 | About 48.8 MB | 65,536 bytes |
| 1,000,000 x 60 | About 488 MB | 65,536 bytes |

These are encoder allocations, not peak application memory or end-to-end CSV
import times. Repeated timing varied substantially on this shared host, so no
specific desktop speedup is claimed. Byte-equivalence tests cover GPS precision,
non-finite values, signed zero, and multiple transfer chunks. Other tests cover
writer failure, concurrent token claims, pending-transfer bounds, and shutdown
cleanup.

## Remaining large-CSV limits

Parsing, sorting, normalization, and the resulting table remain in memory. The
frontend still fetches every column and computes full-log analysis on the main
thread. Streaming removes the avoidable second Go matrix; it does not make
arbitrarily large CSVs bounded-memory operations.

If representative larger CSVs still cause problems, measure parse, normalize,
transfer, initial analysis, and interaction separately before extending the
architecture. The next targeted changes would be worker execution for measured
analysis bottlenecks, viewport summaries for measured rendering bottlenecks, or
disk-backed/chunked columns if the table itself exceeds usable memory. Those
changes need cancellation, stale-result protection, and numeric parity tests;
they are not implemented or required by the typical live workload.

See [frontend.md](frontend.md), [backend.md](backend.md), and
[dev_2.md](dev_2.md) for the branch's current behavior.
