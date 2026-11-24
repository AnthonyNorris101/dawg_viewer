import type { LapSelection } from '../viewer/useViewerNavigation'
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { rangeStats, type Stats } from '../analysis/stats'
import { bestLap, findSpeed, formatLapTime, type Lap, type SpeedUnit } from '../analysis/track'
import { channelTitle, type Channel, type Session } from '../data/session'
import type { ViewSync } from '../plot/sync'
import { setSplits, updateTrack, useSplits, useTrack, type LapMode } from '../state/analysis'

const MODE_HELP: Record<LapMode, string> = {
  loop: 'A new lap each time the car passes the start/finish point.',
  gates:
    'A run from crossing the start line to crossing the finish line, e.g. acceleration or an autocross with a separate finish.',
  launch:
    'A run from every standing start, plus launches you add in the Launch panel. Good for acceleration without GPS lines.',
  manual: 'Nothing automatic: laps are split only where you mark them.',
}

function emptyLaps(mode: LapMode, gps: boolean, start: boolean, finish: boolean): string {
  if (mode === 'launch')
    return 'No standing starts found. Add one by hand in the Launch panel (Add your own launch).'
  if (mode === 'manual') return 'Put the cursor where each lap starts and mark it.'
  if (!gps) return 'This log has no GPS. Switch Laps from to Launches or Only my marks.'
  if (mode === 'gates') {
    if (!start) return 'Put the cursor where the car crosses the start line and set it.'
    if (!finish) return 'Now put the cursor where the car crosses the finish line and set it.'
    return 'The car never went from the start line to the finish line. Try a bigger gate.'
  }
  return 'Set the start/finish line: put the cursor where the car crosses it, or use "Set start/finish" on a track map.'
}
import { toolbarButton, toolbarButtonActive } from '../ui'
import type { Analysis } from '../viewer/analysis'
import type { XView } from '../viewer/xview'

type Tab = 'laps' | 'stats' | 'values'

interface Props {
  analysis: Analysis
  view: XView
  sync: ViewSync
  plotted: Channel[]
  selection: LapSelection
  onSelection: (s: LapSelection) => void
  onZoomLap: (lap: Lap) => void
  overlay: boolean
  onOverlay: (on: boolean) => void
  onClose: () => void
}

export const Sidebar = memo(function Sidebar(props: Props) {
  const [tab, setTab] = useState<Tab>('laps')
  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-800 bg-zinc-900/40">
      <div className="flex items-center gap-1 border-b border-zinc-800 px-2">
        {(['laps', 'stats', 'values'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`border-b-2 px-2 py-1.5 text-xs capitalize ${
              tab === t
                ? 'border-red-500 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t}
          </button>
        ))}
        <button
          type="button"
          aria-label="Hide side panel"
          className="ml-auto px-1 text-zinc-600 hover:text-zinc-200"
          onClick={props.onClose}
        >
          ✕
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'laps' && <LapsTab {...props} />}
        {tab === 'stats' && <StatsTab {...props} />}
        {tab === 'values' && (
          <ValuesTab session={props.analysis.session} view={props.view} sync={props.sync} />
        )}
      </div>
    </aside>
  )
})

const label = 'text-[11px] tracking-wider text-zinc-500 uppercase'
const input =
  'w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-200 outline-none focus:border-red-500'
const select =
  'min-w-0 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-xs text-zinc-200 outline-none focus:border-red-500'

function useLastCursor(view: XView, sync: ViewSync, textRef: RefObject<HTMLSpanElement | null>) {
  const sample = useRef(-1)
  useEffect(() => {
    sample.current = -1
    return sync.onCursor((idx) => {
      if (idx == null) return
      sample.current = view.samplesAt(idx)[0] ?? -1
      if (textRef.current) textRef.current.textContent = view.formatX(view.x[idx])
    })
  }, [view, sync, textRef])
  return sample
}

function LapsTab({
  analysis,
  view,
  sync,
  selection,
  onSelection,
  onZoomLap,
  overlay,
  onOverlay,
}: Props) {
  const t = useTrack()
  const allSplits = useSplits()
  const { session, gps, laps, distance, distanceLabel } = analysis
  const cursorText = useRef<HTMLSpanElement>(null)
  const cursorSample = useLastCursor(view, sync, cursorText)
  const splits = allSplits[session.path] ?? []
  const best = bestLap(laps)
  const speed = useMemo(
    () => (t.speedChannel && session.byId.get(t.speedChannel)) || findSpeed(session.channels),
    [session, t.speedChannel],
  )
  const lapSpeed = useMemo(
    () =>
      speed ? new Map(laps.map((l) => [l.key, rangeStats(speed.data, l.start, l.end)])) : null,
    [laps, speed],
  )
  const selected = new Set(selection.keys)

  const atCursor = (fn: (i: number) => void) => () => {
    const i = cursorSample.current
    if (i >= 0 && i < session.time.length) fn(i)
  }
  const setBeacon = atCursor((i) => {
    if (gps) updateTrack({ beacon: { lat: gps.lat[i], lon: gps.lon[i] } })
  })
  const setFinish = atCursor((i) => {
    if (gps) updateTrack({ finish: { lat: gps.lat[i], lon: gps.lon[i] } })
  })
  const mode = t.lapMode ?? 'loop'
  const split = atCursor((i) => setSplits(session.path, [...splits, session.time[i]]))

  const toggle = (key: string) => {
    const keys = selected.has(key)
      ? selection.keys.filter((k) => k !== key)
      : [...selection.keys, key]
    const refKey = keys.includes(selection.refKey) ? selection.refKey : (keys[0] ?? '')
    onSelection({ keys, refKey })
  }

  return (
    <div className="space-y-4 p-3 text-xs">
      <section className="space-y-2">
        <h3 className={label}>Lap timing</h3>
        <p className="text-zinc-500">
          Cursor at{' '}
          <span ref={cursorText} className="text-zinc-300 tabular-nums">
            – (hover a plot)
          </span>
        </p>
        <label className="flex items-center gap-1.5 text-zinc-400">
          Laps from
          <select
            aria-label="Laps from"
            className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200 outline-none focus:border-red-500"
            value={mode}
            onChange={(e) => updateTrack({ lapMode: e.target.value as LapMode })}
          >
            <option value="loop">Start/finish line (loop)</option>
            <option value="gates">Separate start and finish lines</option>
            <option value="launch">Launches (accel runs)</option>
            <option value="manual">Only my marks</option>
          </select>
        </label>
        <p className="text-zinc-500">{MODE_HELP[mode]}</p>

        {(mode === 'loop' || mode === 'gates') &&
          (gps ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={toolbarButton} onClick={setBeacon}>
                {mode === 'gates'
                  ? t.beacon
                    ? 'Move start line to cursor'
                    : 'Set start line at cursor'
                  : t.beacon
                    ? 'Move start/finish to cursor'
                    : 'Set start/finish at cursor'}
              </button>
              {mode === 'gates' && (
                <button type="button" className={toolbarButton} onClick={setFinish}>
                  {t.finish ? 'Move finish line to cursor' : 'Set finish line at cursor'}
                </button>
              )}
              {(t.beacon || (mode === 'gates' && t.finish)) && (
                <button
                  type="button"
                  className={toolbarButton}
                  onClick={() => updateTrack({ beacon: null, finish: null })}
                >
                  Clear
                </button>
              )}
            </div>
          ) : (
            <p className="text-amber-300/80">
              No GPS in this log, so lines can't be used. Pick Launches or Only my marks.
            </p>
          ))}
        {gps && (mode === 'loop' || mode === 'gates') && t.beacon && (
          <div className="flex flex-wrap items-center gap-3 text-zinc-400">
            <label
              className="flex items-center gap-1"
              title="How close to the line's point counts as crossing it"
            >
              Gate
              <input
                type="number"
                min={2}
                max={100}
                className={input}
                value={t.radius}
                onChange={(e) => updateTrack({ radius: Math.max(2, Number(e.target.value) || 15) })}
              />
              m
            </label>
            {mode === 'loop' && (
              <label
                className="flex items-center gap-1"
                title="Ignore crossings sooner than this after the last one"
              >
                Min lap
                <input
                  type="number"
                  min={1}
                  className={input}
                  value={t.minLap}
                  onChange={(e) =>
                    updateTrack({ minLap: Math.max(1, Number(e.target.value) || 10) })
                  }
                />
                s
              </label>
            )}
          </div>
        )}
        {mode === 'launch' && (
          <div className="space-y-1">
            <label
              className="flex items-center gap-1.5 whitespace-nowrap text-zinc-400"
              title="Each run ends this far from its start. 0 runs until the car stops (2 min at most)."
            >
              Run length
              <input
                type="number"
                min={0}
                className={input}
                value={t.runLength ?? 75}
                onChange={(e) =>
                  updateTrack({ runLength: Math.max(0, Number(e.target.value) || 0) })
                }
              />
              m
            </label>
            <p className="text-zinc-600">
              75 m is the FSAE acceleration event; 0 runs until the car stops.
            </p>
          </div>
        )}
        {(mode === 'loop' || mode === 'manual') && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={toolbarButton} onClick={split}>
              {mode === 'manual' ? 'Mark a lap at cursor' : 'Split lap at cursor'}
            </button>
            {splits.length > 0 && (
              <button
                type="button"
                className={toolbarButton}
                onClick={() => setSplits(session.path, [])}
              >
                Clear {splits.length} mark{splits.length === 1 ? '' : 's'}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className={label}>Laps</h3>
        {laps.length === 0 ? (
          <p className="text-zinc-500">{emptyLaps(mode, !!gps, !!t.beacon, !!t.finish)}</p>
        ) : (
          <table className="w-full tabular-nums">
            <thead className="text-zinc-500">
              <tr className="text-left">
                <th className="w-5 font-normal" title="Overlay">
                  ⧉
                </th>
                <th className="font-normal">Lap</th>
                <th className="text-right font-normal">Time</th>
                <th className="text-right font-normal">Δ best</th>
                {lapSpeed && <th className="text-right font-normal">Max {speed!.name}</th>}
                <th className="w-8 text-right font-normal" title="Reference lap">
                  Ref
                </th>
              </tr>
            </thead>
            <tbody>
              {laps.map((l) => {
                const isBest = best?.key === l.key
                return (
                  <tr key={l.key} className="hover:bg-zinc-800/60">
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Overlay lap ${l.label}`}
                        checked={selected.has(l.key)}
                        onChange={() => toggle(l.key)}
                        className="accent-red-500"
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-zinc-300 underline-offset-2 hover:underline"
                        title="Zoom to this lap"
                        onClick={() => onZoomLap(l)}
                      >
                        {l.label}
                      </button>
                    </td>
                    <td className={`text-right ${isBest ? 'text-fuchsia-400' : 'text-zinc-200'}`}>
                      {formatLapTime(l.time)}
                    </td>
                    <td className="text-right text-zinc-400">
                      {l.kind === 'lap' && best && !isBest
                        ? `+${(l.time - best.time).toFixed(3)}`
                        : ''}
                    </td>
                    {lapSpeed && (
                      <td className="text-right text-zinc-400">
                        {lapSpeed.get(l.key)?.max.toFixed(speed!.precision)}
                      </td>
                    )}
                    <td className="text-right">
                      <input
                        type="radio"
                        name="ref-lap"
                        aria-label={`Reference lap ${l.label}`}
                        checked={selection.refKey === l.key && selected.has(l.key)}
                        onChange={() =>
                          onSelection({
                            keys: selected.has(l.key) ? selection.keys : [...selection.keys, l.key],
                            refKey: l.key,
                          })
                        }
                        className="accent-red-500"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        {laps.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className={overlay ? toolbarButtonActive : toolbarButton}
              disabled={!distance || selection.keys.length === 0}
              title={
                distance
                  ? 'Plot the ticked laps on top of each other against lap distance'
                  : 'Needs GPS or a speed channel for distance'
              }
              onClick={() => onOverlay(!overlay)}
            >
              {overlay ? 'Back to time' : 'Overlay ticked laps'}
            </button>
            {best && (
              <button
                type="button"
                className={toolbarButton}
                title="Tick the two fastest laps, the fastest as reference"
                onClick={() => {
                  const fastest = laps
                    .filter((l) => l.kind === 'lap')
                    .sort((a, b) => a.time - b.time)
                    .slice(0, 2)
                  onSelection({ keys: fastest.map((l) => l.key), refKey: best.key })
                }}
              >
                Two fastest
              </button>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className={label}>Distance</h3>
        <div className="flex flex-wrap items-center gap-2 text-zinc-400">
          <select
            aria-label="Distance from"
            className={select}
            value={t.distance}
            onChange={(e) => updateTrack({ distance: e.target.value as typeof t.distance })}
          >
            <option value="auto">Automatic</option>
            <option value="gps">GPS</option>
            <option value="speed">Speed channel</option>
          </select>
          {t.distance !== 'gps' && (
            <>
              <select
                aria-label="Speed channel"
                className={select}
                value={t.speedChannel}
                onChange={(e) => updateTrack({ speedChannel: e.target.value })}
              >
                <option value="">{findSpeed(session.channels)?.name ?? 'Speed channel'}</option>
                {session.channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {channelTitle(c)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Speed unit"
                className={select}
                value={t.speedUnit}
                onChange={(e) => updateTrack({ speedUnit: e.target.value as SpeedUnit | 'auto' })}
              >
                <option value="auto">unit: auto</option>
                <option value="mph">mph</option>
                <option value="km/h">km/h</option>
                <option value="m/s">m/s</option>
              </select>
            </>
          )}
        </div>
        <p className="text-zinc-500">
          {distance
            ? `From ${distanceLabel}: ${(distance[distance.length - 1] / 1000).toFixed(2)} km this outing`
            : 'No distance: this log has neither GPS nor a speed channel.'}
        </p>
        {gps && (
          <label
            className="flex items-start gap-2 text-zinc-400"
            title="Where the GPS position drops out or stops updating, rebuild the path from speed and heading (Yaw, or lateral g ÷ speed), pinned to the fixes on both sides"
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-red-500"
              checked={t.fuse}
              onChange={(e) => updateTrack({ fuse: e.target.checked })}
            />
            <span>
              Fill GPS gaps from speed and heading
              {analysis.fusion && (
                <span className="block text-zinc-500">
                  {analysis.fusion.gaps === 0
                    ? 'No GPS dropouts in this log'
                    : `Filled ${analysis.fusion.gaps} dropout${analysis.fusion.gaps === 1 ? '' : 's'} (${analysis.fusion.gapSeconds.toFixed(1)} s)`}
                  {' · heading from '}
                  {analysis.fusion.heading === 'yaw'
                    ? 'Yaw'
                    : analysis.fusion.heading === 'accel'
                      ? 'lateral g'
                      : 'none (straight lines)'}
                </span>
              )}
            </span>
          </label>
        )}
        <label className="flex items-center gap-2 text-zinc-400">
          <input
            type="checkbox"
            className="accent-red-500"
            checked={t.normalize}
            onChange={(e) => updateTrack({ normalize: e.target.checked })}
          />
          Stretch overlaid laps to the reference lap's length
        </label>
      </section>
    </div>
  )
}

const fmt = (v: number, p: number) => (Number.isFinite(v) ? v.toFixed(p) : '–')

function StatsTab({ view, sync, plotted }: Props) {
  const [rows, setRows] = useState<{ key: string; ch: Channel; slot: string; st: Stats }[]>([])
  const rangeRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let queued = 0
    const compute = () => {
      queued = 0
      const r = sync.range()
      const sets = view.visible(r)
      if (rangeRef.current) {
        const [a, b] = r ? [r.min, r.max] : view.bounds
        rangeRef.current.textContent = `${view.formatX(a)} → ${view.formatX(b)}`
      }
      setRows(
        plotted.flatMap((ch) =>
          sets.map((s) => ({
            key: `${ch.id}@${s.slot}`,
            ch,
            slot: view.slots[s.slot]?.label ?? '',
            st: rangeStats(ch.data, s.start, s.end),
          })),
        ),
      )
    }
    queued = requestAnimationFrame(compute)
    const off = sync.onRange(() => {
      if (!queued) queued = requestAnimationFrame(compute)
    })
    return () => {
      off()
      if (queued) cancelAnimationFrame(queued)
    }
  }, [view, sync, plotted])

  return (
    <div className="space-y-2 p-3 text-xs">
      <p className="text-zinc-500">
        Channels on this sheet, over the part in view:{' '}
        <span ref={rangeRef} className="text-zinc-300 tabular-nums" />
      </p>
      {rows.length === 0 ? (
        <p className="text-zinc-600">Plot some channels to see their statistics.</p>
      ) : (
        <table className="w-full tabular-nums">
          <thead className="text-zinc-500">
            <tr className="text-left">
              <th className="font-normal">Channel</th>
              <th className="text-right font-normal">Min</th>
              <th className="text-right font-normal">Avg</th>
              <th className="text-right font-normal">Max</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ key, ch, slot, st }) => (
              <tr
                key={key}
                className="hover:bg-zinc-800/60"
                title={`σ ${fmt(st.std, ch.precision)}`}
              >
                <td className="max-w-32 truncate text-zinc-300">
                  <span
                    className="mr-1.5 inline-block size-2 rounded-full"
                    style={{ background: ch.color }}
                  />
                  {channelTitle(ch)}
                  {slot && <span className="text-zinc-500"> {slot}</span>}
                </td>
                <td className="text-right text-zinc-400">{fmt(st.min, ch.precision)}</td>
                <td className="text-right text-zinc-200">{fmt(st.mean, ch.precision)}</td>
                <td className="text-right text-zinc-400">{fmt(st.max, ch.precision)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ValuesTab({ session, view, sync }: { session: Session; view: XView; sync: ViewSync }) {
  const [query, setQuery] = useState('')
  const els = useRef(new Map<string, HTMLTableCellElement>())
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? session.channels.filter((c) => c.name.toLowerCase().includes(q)) : session.channels
  }, [session, query])

  useEffect(
    () =>
      sync.onCursor((idx) => {
        if (idx == null) return
        const i = view.samplesAt(idx)[0] ?? -1
        for (const ch of shown) {
          const el = els.current.get(ch.id)
          if (el) el.textContent = i >= 0 ? fmt(ch.data[i], ch.precision) : '–'
        }
      }),
    [session, view, sync, shown],
  )

  return (
    <div className="space-y-2 p-3 text-xs">
      <input
        aria-label="Filter values"
        className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 outline-none placeholder:text-zinc-500 focus:border-red-500"
        placeholder="Filter channels"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        spellCheck={false}
      />
      <p className="text-zinc-500">
        Every channel at the cursor{view.mode === 'distance' ? ` (${view.slots[0]?.label})` : ''}.
      </p>
      <table className="w-full tabular-nums">
        <tbody>
          {shown.map((ch) => (
            <tr key={ch.id} className="hover:bg-zinc-800/60">
              <td className="max-w-40 truncate text-zinc-400">{channelTitle(ch)}</td>
              <td
                ref={(el) => {
                  if (el) els.current.set(ch.id, el)
                  else els.current.delete(ch.id)
                }}
                className="text-right text-zinc-100"
              >
                –
              </td>
              <td className="w-10 pl-1 text-zinc-600">{ch.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
