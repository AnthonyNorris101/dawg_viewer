import { useEffect, useMemo, useRef, useState } from 'react'
import {
  checkFilter,
  FILTER_KINDS,
  filterExpr,
  filterGain,
  filterSuffix,
  startingPoints,
  type FilterKind,
  type FilterSpec,
} from '../analysis/filters'
import { formatTick } from '../analysis/stats'
import { shapeGain, uniform, welch, type GainPoint } from '../analysis/spectrum'
import { channelTitle, type Session } from '../data/session'
import { mathDefs, newMathId } from '../state/analysis'
import { toolbarButton, toolbarButtonActive } from '../ui'

export interface FilterStart {
  channelIds: string[]
  band?: [number, number]
  panelId?: number
  edit?: { id: string; name: string; spec: FilterSpec }
}

const NOT_SENSORS = new Set(['Math', 'Analysis'])

const field =
  'rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-red-500'
const W = 680
const H = 270
const M = { left: 44, right: 12, top: 26, bottom: 30 }
const DB_RANGE = 70
const KIND_LABEL = Object.fromEntries(FILTER_KINDS.map(([k, label]) => [k, label]))

const round = (v: number) => Number(v.toPrecision(3))

export function FilterDialog({
  session,
  start,
  onClose,
  onCreated,
}: {
  session: Session
  start: FilterStart
  onClose: () => void
  onCreated: (names: string[], panelId?: number) => void
}) {
  const rate = session.sampleRate
  const nyq = rate / 2
  const [selected, setSelected] = useState<string[]>(start.channelIds)
  const [previewId, setPreviewId] = useState(start.channelIds[0] ?? '')
  const spec = start.edit?.spec
  const [kind, setKind] = useState<FilterKind>(spec?.kind ?? (start.band ? 'band' : 'low'))
  const [loText, setLoText] = useState(
    String(round(spec?.lo || start.band?.[0] || Math.min(2, nyq / 10))),
  )
  const [hiText, setHiText] = useState(
    String(round(spec?.hi || start.band?.[1] || Math.min(20, nyq * 0.4))),
  )
  const [stages, setStages] = useState(spec?.stages ?? 1)
  const [points, setPoints] = useState<GainPoint[]>(spec?.points ?? [])
  const [drag, setDrag] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [tunedFrom, setTunedFrom] = useState<Exclude<FilterKind, 'custom'> | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [suffixText, setSuffixText] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const chosen = session.channels.filter((c) => selected.includes(c.id))
  const ch = session.byId.get(selected.includes(previewId) ? previewId : (selected[0] ?? ''))
  const lo = Number(loText)
  const hi = Number(hiText)
  const problem = checkFilter(kind, lo, hi, rate, points)
  const suffix = suffixText.trim() || filterSuffix(kind, lo, hi)
  const expr = ch ? filterExpr(kind, ch.name, lo, hi, stages, points) : ''
  const groups = useMemo(() => {
    const out = new Map<string, typeof session.channels>()
    for (const c of session.channels) {
      const list = out.get(c.group)
      if (list) list.push(c)
      else out.set(c.group, [c])
    }
    return [...out]
  }, [session])
  const toggle = (ids: string[], on: boolean) =>
    setSelected((cur) =>
      on ? [...new Set([...cur, ...ids])] : cur.filter((x) => !ids.includes(x)),
    )

  const psd = useMemo(() => {
    if (!ch) return null
    const u = uniform(session.time, ch.data, 0, session.time.length - 1)
    if (!u) return null
    const size = Math.min(2048, 2 ** Math.floor(Math.log2(Math.max(64, u.values.length / 4))))
    return welch(u.values, u.rate, size)
  }, [ch, session.time])

  const fMin = Math.max(0.05, psd ? psd.freq[1] : 0.1)
  const fMax = Math.max(fMin * 10, nyq)
  const lx = (f: number) =>
    M.left +
    ((Math.log10(f) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin))) *
      (W - M.left - M.right)
  const ph = H - M.top - M.bottom
  const gy = (g: number) => M.top + ph - g * ph

  const gainAt = (f: number) => filterGain(kind, f, lo, hi, stages, points)

  const spectra = (() => {
    if (!psd) return { before: '', after: '' }
    const db: [number, number][] = []
    for (let k = 1; k < psd.freq.length; k++) {
      const p = psd.psd[k]
      if (p > 0 && psd.freq[k] >= fMin) db.push([psd.freq[k], 10 * Math.log10(p)])
    }
    if (db.length < 2) return { before: '', after: '' }
    const top = Math.max(...db.map((d) => d[1]))
    const bottom = top - DB_RANGE
    const area = (pts: (readonly [number, number])[]) =>
      `M${pts[0][0].toFixed(1)},${gy(0)}` +
      pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join('') +
      `L${pts[pts.length - 1][0].toFixed(1)},${gy(0)}Z`
    const y = (d: number) => gy(Math.max(0, Math.min(1, (d - bottom) / DB_RANGE)))
    return {
      before: area(db.map(([f, d]) => [lx(f), y(d)] as const)),
      after: problem
        ? ''
        : area(
            db.map(([f, d]) => [lx(f), y(d + 20 * Math.log10(Math.max(gainAt(f), 1e-6)))] as const),
          ),
    }
  })()

  const response = problem
    ? ''
    : Array.from({ length: 240 }, (_, i) => {
        const f = 10 ** (Math.log10(fMin) + ((Math.log10(fMax) - Math.log10(fMin)) * i) / 239)
        return `${i ? 'L' : 'M'}${lx(f).toFixed(1)},${gy(gainAt(f)).toFixed(1)}`
      }).join('')

  const ticks = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].filter(
    (t) => t >= fMin && t <= fMax,
  )

  const toGraph = (e: { clientX: number; clientY: number }): GainPoint | null => {
    const ctm = svgRef.current?.getScreenCTM()
    if (!ctm) return null
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    const t = (p.x - M.left) / (W - M.left - M.right)
    const f = 10 ** (Math.log10(fMin) + t * (Math.log10(fMax) - Math.log10(fMin)))
    const g = (M.top + ph - p.y) / ph
    return [Math.min(fMax, Math.max(fMin, f)), Math.min(1, Math.max(0, g))]
  }

  const handles: GainPoint[] =
    kind === 'custom' ? points : problem ? [] : startingPoints(kind, lo, hi, stages, fMin, fMax)

  const tune = (next: GainPoint[]) => {
    if (kind !== 'custom') setTunedFrom(kind)
    setPoints(next)
    setKind('custom')
  }

  const startTuning = () => {
    if (kind !== 'custom') tune(handles)
  }

  const movePoint = (i: number, at: GainPoint) =>
    setPoints((pts) => {
      const next = pts.slice()
      const lower = i > 0 ? next[i - 1][0] * 1.03 : fMin
      const upper = i < next.length - 1 ? next[i + 1][0] / 1.03 : fMax
      next[i] = [
        Number(Math.min(upper, Math.max(lower, at[0])).toPrecision(3)),
        Number(at[1].toFixed(3)),
      ]
      return next
    })

  const withPoint = (pts: GainPoint[], at: GainPoint): GainPoint[] => {
    const f = Number(at[0].toPrecision(3))
    if (pts.some((p) => Math.abs(Math.log(p[0] / f)) < 0.03)) return pts
    const g = Number(shapeGain(pts, f).toFixed(3))
    return [...pts, [f, g] as GainPoint].sort((a, b) => a[0] - b[0])
  }

  const create = () => {
    if (chosen.length === 0) return setError('Tick at least one channel')
    if (problem) return setError(problem)
    if (start.edit && ch) {
      const edit = start.edit
      mathDefs.set(
        mathDefs
          .get()
          .map((d) =>
            d.id === edit.id
              ? { ...d, expr: filterExpr(kind, ch.name, lo, hi, stages, points) }
              : d,
          ),
      )
      onCreated([edit.name], start.panelId)
      return
    }
    let defs = mathDefs.get()
    const made: string[] = []
    const clashes: string[] = []
    for (const c of chosen) {
      const name = `${c.name} ${suffix}`
      const existing = defs.find((d) => d.name === name)
      if (!existing && session.channels.some((x) => x.name === name)) {
        clashes.push(name)
        continue
      }
      const def = {
        id: existing?.id ?? newMathId(),
        name,
        expr: filterExpr(kind, c.name, lo, hi, stages, points),
        unit: c.unit,
        precision: c.precision,
      }
      defs = existing ? defs.map((d) => (d.id === existing.id ? def : d)) : [...defs, def]
      made.push(name)
    }
    if (made.length === 0) return setError(`Already taken by log channels: ${clashes.join(', ')}`)
    mathDefs.set(defs)
    onCreated(made, start.panelId)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label="Filter channels"
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-3xl flex-col rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
          <h2 className="text-sm font-semibold">
            {start.edit ? `Edit ${start.edit.name}` : 'Filter channels'}
          </h2>
          <span className="text-xs text-zinc-500">
            {start.edit
              ? `filter of ${ch ? channelTitle(ch) : 'its source'}; change it to cut more or add frequencies back`
              : 'makes a filtered copy of each; the originals stay as they are'}
          </span>
          <button
            type="button"
            aria-label="Close"
            className="ml-auto text-zinc-500 hover:text-zinc-200"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-xs">
          {!start.edit && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2 text-zinc-400">
                <span>Channels to filter</span>
                <span className="text-zinc-500">
                  {selected.length} ticked · sampled at {rate} Hz
                </span>
                <button
                  type="button"
                  className={`${toolbarButton} ml-auto`}
                  onClick={() =>
                    setSelected(
                      session.channels.filter((c) => !NOT_SENSORS.has(c.group)).map((c) => c.id),
                    )
                  }
                >
                  Every sensor
                </button>
                <button type="button" className={toolbarButton} onClick={() => setSelected([])}>
                  Clear
                </button>
              </div>
              <div className="max-h-44 space-y-1.5 overflow-y-auto rounded border border-zinc-800 p-2">
                {groups.map(([group, list]) => {
                  const ids = list.map((c) => c.id)
                  const all = ids.every((id) => selected.includes(id))
                  return (
                    <div key={group}>
                      <label className="flex items-center gap-1.5 text-[11px] tracking-wider text-zinc-500 uppercase">
                        <input
                          type="checkbox"
                          className="accent-red-500"
                          aria-label={`All of ${group}`}
                          checked={all}
                          onChange={(e) => toggle(ids, e.target.checked)}
                        />
                        {group}
                      </label>
                      <div className="grid grid-cols-3 gap-x-3 pl-5">
                        {list.map((c) => (
                          <label
                            key={c.id}
                            className="flex min-w-0 items-center gap-1.5 text-zinc-300"
                          >
                            <input
                              type="checkbox"
                              className="accent-red-500"
                              checked={selected.includes(c.id)}
                              onChange={(e) => toggle([c.id], e.target.checked)}
                            />
                            <span className="truncate" title={c.name}>
                              {channelTitle(c)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="flex flex-wrap gap-1.5">
              {FILTER_KINDS.map(([k, text]) => (
                <button
                  key={k}
                  type="button"
                  className={kind === k ? toolbarButtonActive : toolbarButton}
                  onClick={() => (k === 'custom' ? startTuning() : setKind(k))}
                >
                  {text}
                </button>
              ))}
            </div>
            <p className="min-h-4 truncate text-zinc-500">
              {FILTER_KINDS.find((f) => f[0] === kind)?.[2]}
            </p>
          </div>

          {kind === 'custom' ? (
            <div className="flex h-7 items-center gap-3 text-zinc-400">
              <span>
                Your own curve
                {tunedFrom ? `, started from the ${KIND_LABEL[tunedFrom].toLowerCase()}` : ''}
              </span>
              {tunedFrom && (
                <button type="button" className={toolbarButton} onClick={() => setKind(tunedFrom)}>
                  Back to {KIND_LABEL[tunedFrom].toLowerCase()}
                </button>
              )}
            </div>
          ) : (
            <div className="flex h-7 items-center gap-3 text-zinc-400">
              {kind !== 'low' && (
                <label className="flex items-center gap-1.5">
                  {kind === 'high' ? 'Cutoff' : 'From'}
                  <input
                    aria-label="Low cutoff"
                    className={`${field} w-20`}
                    value={loText}
                    onChange={(e) => setLoText(e.target.value)}
                  />
                  Hz
                </label>
              )}
              {kind !== 'high' && (
                <label className="flex items-center gap-1.5">
                  {kind === 'low' ? 'Cutoff' : 'to'}
                  <input
                    aria-label="High cutoff"
                    className={`${field} w-20`}
                    value={hiText}
                    onChange={(e) => setHiText(e.target.value)}
                  />
                  Hz
                </label>
              )}
              <label
                className="flex items-center gap-1.5"
                title="Steeper cuts more sharply at the cutoff but rings more on sudden steps"
              >
                Steepness
                <select
                  aria-label="Steepness"
                  className={field}
                  value={stages}
                  onChange={(e) => setStages(Number(e.target.value))}
                >
                  <option value={1}>Gentle</option>
                  <option value={2}>Medium</option>
                  <option value={4}>Steep</option>
                </select>
              </label>
            </div>
          )}

          {chosen.length > 1 && (
            <label className="flex items-center gap-1.5 text-zinc-400">
              Preview
              <select
                aria-label="Preview channel"
                className={field}
                value={ch?.id ?? ''}
                onChange={(e) => setPreviewId(e.target.value)}
              >
                {chosen.map((c) => (
                  <option key={c.id} value={c.id}>
                    {channelTitle(c)}
                  </option>
                ))}
              </select>
            </label>
          )}
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className={`w-full touch-none rounded border border-zinc-800 bg-zinc-950 select-none ${kind === 'custom' ? 'cursor-crosshair' : ''}`}
            role="img"
            aria-label="Signal frequency content and the filter"
            onPointerMove={(e) => {
              const at = toGraph(e)
              if (!at) return
              if (drag != null) movePoint(drag, at)
              setHover(at[0])
            }}
            onPointerLeave={() => setHover(null)}
            onPointerUp={() => setDrag(null)}
            onDoubleClick={(e) => {
              if (e.target !== e.currentTarget || handles.length === 0) return
              const at = toGraph(e)
              if (at) tune(withPoint(handles, at))
            }}
          >
            <g stroke="#27272a">
              {ticks.map((t) => (
                <line key={t} x1={lx(t)} x2={lx(t)} y1={M.top} y2={M.top + ph} />
              ))}
              {[0, 0.5, 1].map((g) => (
                <line key={g} x1={M.left} x2={W - M.right} y1={gy(g)} y2={gy(g)} />
              ))}
            </g>
            {spectra.before && (
              <path d={spectra.before} fill="#71717a" fillOpacity="0.45" pointerEvents="none" />
            )}
            {spectra.after && (
              <path
                d={spectra.after}
                fill="#22d3ee"
                fillOpacity="0.28"
                stroke="#22d3ee"
                strokeOpacity="0.8"
                strokeWidth="1"
                pointerEvents="none"
              />
            )}
            {hover != null && (
              <line
                x1={lx(hover)}
                x2={lx(hover)}
                y1={M.top}
                y2={M.top + ph}
                stroke="#a1a1aa"
                strokeDasharray="3 3"
                pointerEvents="none"
              />
            )}
            {response && (
              <path
                d={response}
                fill="none"
                stroke="#f87171"
                strokeWidth="2.5"
                pointerEvents="none"
              />
            )}
            {handles.map(([f, g], i) => (
              <circle
                key={i}
                cx={lx(f)}
                cy={gy(g)}
                r={drag === i ? 7 : 6}
                fill={drag === i ? '#f87171' : '#fafafa'}
                stroke="#09090b"
                strokeWidth="1.5"
                className="cursor-grab"
                onPointerDown={(e) => {
                  svgRef.current?.setPointerCapture(e.pointerId)
                  if (kind !== 'custom') tune(handles)
                  setDrag(i)
                }}
                onDoubleClick={() => handles.length > 2 && tune(handles.filter((_, j) => j !== i))}
              >
                <title>{`${f} Hz: keep ${Math.round(g * 100)}%`}</title>
              </circle>
            ))}
            <g fill="#a1a1aa" fontSize="10">
              {ticks.map((t) => (
                <text key={t} x={lx(t)} y={H - 16} textAnchor="middle">
                  {formatTick(t, t)}
                </text>
              ))}
              <text x={(M.left + W - M.right) / 2} y={H - 3} textAnchor="middle">
                frequency (Hz)
              </text>
              <text x={M.left - 6} y={gy(1) + 3} textAnchor="end">
                keep
              </text>
              <text x={M.left - 6} y={gy(0) + 3} textAnchor="end">
                cut
              </text>
              <text x={M.left - 6} y={gy(0.5) + 3} textAnchor="end">
                50%
              </text>
            </g>
            <g fontSize="11" pointerEvents="none">
              <rect x={M.left + 2} y={4} width={8} height={8} fill="#71717a" />
              <text x={M.left + 14} y={12} fill="#a1a1aa">
                before
              </text>
              <rect x={M.left + 62} y={4} width={8} height={8} fill="#22d3ee" />
              <text x={M.left + 74} y={12} fill="#a1a1aa">
                after
              </text>
              <line
                x1={M.left + 116}
                x2={M.left + 132}
                y1={8}
                y2={8}
                stroke="#f87171"
                strokeWidth="2.5"
              />
              <text x={M.left + 136} y={12} fill="#a1a1aa">
                filter
              </text>
              {hover != null && !problem && (
                <text x={W - M.right} y={12} textAnchor="end" fill="#fafafa">
                  {`${Number(hover.toPrecision(3))} Hz · keeps ${Math.round(gainAt(hover) * 100)}% (${
                    gainAt(hover) > 1e-6 ? (20 * Math.log10(gainAt(hover))).toFixed(1) : '−∞'
                  } dB)`}
                </text>
              )}
            </g>
          </svg>
          <p className="text-zinc-500">
            Grey is the signal's frequency content now (whole log, 70 dB range), blue is what it
            will be after the filter. Drag any dot on the red curve to reshape it; double-click to
            add or remove a dot. Zero-phase, so peaks don't shift in time.
          </p>

          {kind === 'custom' && (
            <div className="flex flex-wrap gap-1.5">
              {points.map(([f, g], i) => (
                <span
                  key={i}
                  className="flex items-center gap-1 rounded border border-zinc-800 px-1.5 py-0.5 text-zinc-400"
                >
                  <input
                    aria-label={`Point ${i + 1} frequency`}
                    className="w-14 bg-transparent text-right text-zinc-100 outline-none"
                    defaultValue={f}
                    key={`f${i}-${f}`}
                    onBlur={(e) => {
                      const v = Number(e.target.value)
                      if (v > 0) movePoint(i, [v, g])
                    }}
                  />
                  Hz
                  <input
                    aria-label={`Point ${i + 1} keep`}
                    className="w-9 bg-transparent text-right text-zinc-100 outline-none"
                    defaultValue={Math.round(g * 100)}
                    key={`g${i}-${g}`}
                    onBlur={(e) => {
                      const v = Number(e.target.value)
                      if (v >= 0 && v <= 100) movePoint(i, [f, v / 100])
                    }}
                  />
                  %
                </span>
              ))}
            </div>
          )}

          {!start.edit && (
            <div className="flex flex-wrap items-center gap-3 text-zinc-400">
              <label className="flex items-center gap-1.5">
                Name ending
                <input
                  aria-label="Name ending"
                  className={`${field} w-36`}
                  placeholder={filterSuffix(kind, lo, hi)}
                  value={suffixText}
                  onChange={(e) => setSuffixText(e.target.value)}
                />
              </label>
              <span className="min-w-0 flex-1 truncate text-zinc-500">
                {chosen.length === 0
                  ? 'no channels ticked'
                  : `makes ${chosen
                      .slice(0, 3)
                      .map((c) => `${c.name} ${suffix}`)
                      .join(', ')}${chosen.length > 3 ? ` and ${chosen.length - 3} more` : ''}`}
              </span>
            </div>
          )}
          <code className="block truncate text-zinc-500">{expr}</code>
          {(error || problem) && <p className="text-amber-300">{error || problem}</p>}
        </div>

        <footer className="flex items-center gap-2 border-t border-zinc-800 px-4 py-2">
          <span className="text-xs text-zinc-500">
            {start.edit
              ? 'Saving updates this channel everywhere it is plotted.'
              : 'New channels appear under Math in the channel list, for every sheet and log.'}
          </span>
          <button type="button" className={`${toolbarButton} ml-auto`} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={toolbarButtonActive}
            disabled={!!problem || chosen.length === 0}
            onClick={create}
          >
            {start.edit
              ? 'Save changes'
              : chosen.length > 1
                ? `Create ${chosen.length} channels`
                : 'Create channel'}
          </button>
        </footer>
      </div>
    </div>
  )
}
