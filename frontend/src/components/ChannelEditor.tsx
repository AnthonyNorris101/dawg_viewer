import { useEffect, useMemo, useState } from 'react'
import type { Calibration, ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'
import { LiveService } from '../../bindings/dawg_viewer/services'
import { defaultGroup } from '../data/groups'
import {
  applyCal,
  calFn,
  fitQuality,
  gainOf,
  polyFit,
  sortedPoints,
  toRaw,
  type Point,
} from '../data/calibration'
import { CHANNEL_COLORS } from '../data/session'
import { info, useInfo } from '../live/connection'
import { toolbarButton, toolbarButtonActive } from '../ui'
import { CalGraph } from './CalGraph'

export interface ChannelEditorProps {
  name: string
  color: string
  unit: string
  precision: number
  group: string
  groups: string[]
  canCalibrate: boolean
  currentValue: () => number | undefined
  valueSource: string
  onClose: () => void
  onSaved?: (before: Calibration | undefined, after: Calibration | null) => void
}

type CalMode = 'keep' | 'none' | 'two' | 'gain' | 'poly' | 'points'
type FitKind = 'table' | 1 | 2 | 3 | 4

const FITS: [FitKind, string][] = [
  [1, 'Straight line'],
  [2, 'Quadratic (x²)'],
  [3, 'Cubic (x³)'],
  [4, '4th order'],
  ['table', 'Straight lines between points'],
]

const POWERS = ['', '', '²', '³', '⁴', '⁵', '⁶']

function initialMode(cal: Calibration | undefined): CalMode {
  if (!cal) return 'none'
  if (cal.type === 'linear') return 'gain'
  if (cal.type === 'table' || (cal.type === 'poly' && cal.points?.length)) return 'points'
  if (cal.type === 'poly') return 'poly'
  return 'keep'
}

function formula(coeffs: number[]): string {
  const terms = coeffs
    .map((c, k) => ({ c, k }))
    .filter(({ c, k }) => c !== 0 || k === 0)
    .map(({ c, k }, i) => {
      const mag = Number(Math.abs(c).toPrecision(6)).toString()
      const sign = c < 0 ? (i ? ' − ' : '−') : i ? ' + ' : ''
      return `${sign}${mag}${k === 0 ? '' : k === 1 ? '·raw' : `·raw${POWERS[k] ?? `^${k}`}`}`
    })
  return `value = ${terms.join('')}`
}

const field =
  'rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-red-500'
const label = 'text-[11px] tracking-wider text-zinc-500 uppercase'

const num = (s: string) => (s.trim() === '' ? NaN : Number(s))
const fmt = (v: number | undefined, p = 4) =>
  v === undefined || !Number.isFinite(v) ? '–' : Number(v.toPrecision(p + 2)).toString()

export function ChannelEditor(props: ChannelEditorProps) {
  const { name, onClose } = props
  const live = useInfo()
  const meta: ChannelMeta | undefined = live?.channels?.[name]
  const cal: Calibration | undefined = live?.calibrations?.[name]

  const [title, setTitle] = useState(meta?.label ?? '')
  const [group, setGroup] = useState(meta?.group ?? '')
  const [color, setColor] = useState(meta?.color ?? '')
  const [unit, setUnit] = useState(meta?.unit ?? '')
  const [precision, setPrecision] = useState(String(meta?.precision ?? props.precision))
  const [mode, setMode] = useState<CalMode>(initialMode(cal))
  const [gain, setGain] = useState(cal?.type === 'linear' ? String(gainOf(cal)) : '1')
  const [offset, setOffset] = useState(cal?.type === 'linear' ? String(cal.add) : '0')
  const [raw1, setRaw1] = useState('')
  const [val1, setVal1] = useState('')
  const [raw2, setRaw2] = useState('')
  const [val2, setVal2] = useState('')
  const [coeffText, setCoeffText] = useState<string[]>(
    cal?.type === 'poly' && cal.coeffs?.length ? cal.coeffs.map(String) : ['0', '1'],
  )
  const [rangeText, setRangeText] = useState<[string, string]>(['0', '4095'])
  const [rows, setRows] = useState<[string, string][]>(
    (cal?.type === 'poly' || cal?.type === 'table') && cal.points?.length
      ? cal.points.map(([r, v]) => [String(r), String(v)])
      : [
          ['', ''],
          ['', ''],
          ['', ''],
        ],
  )
  const [fit, setFit] = useState<FitKind>(
    cal?.type === 'table'
      ? 'table'
      : cal?.type === 'poly' && cal.degree
        ? (cal.degree as FitKind)
        : 1,
  )
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState<number | undefined>(undefined)

  const { currentValue } = props
  useEffect(() => {
    const tick = () => setNow(currentValue())
    const t = setInterval(tick, 300)
    const first = setTimeout(tick, 0)
    return () => {
      clearInterval(t)
      clearTimeout(first)
    }
  }, [currentValue])

  const rawNow = now === undefined ? undefined : toRaw(now, cal)
  const inferred = defaultGroup(name) ?? ''

  const points = useMemo<Point[]>(
    () =>
      rows.filter(([r, v]) => r.trim() !== '' || v.trim() !== '').map(([r, v]) => [num(r), num(v)]),
    [rows],
  )

  const next = useMemo((): { cal: Calibration | null; problem: string } => {
    switch (mode) {
      case 'poly': {
        const coeffs = coeffText.map(num)
        if (coeffs.length === 0 || !coeffs.every(Number.isFinite))
          return { cal: null, problem: 'Every coefficient must be a number' }
        return { cal: { type: 'poly', mult: 0, div: 0, add: 0, coeffs }, problem: '' }
      }
      case 'points': {
        if (!points.every((p) => p.every(Number.isFinite)))
          return { cal: null, problem: 'Every point needs a raw reading and a value' }
        const distinct = new Set(points.map((p) => p[0])).size
        const pts = sortedPoints(points)
        if (fit === 'table') {
          if (pts.length < 2) return { cal: null, problem: 'Enter at least 2 points' }
          if (distinct < pts.length)
            return { cal: null, problem: 'Two points have the same raw reading' }
          return { cal: { type: 'table', mult: 0, div: 0, add: 0, points: pts }, problem: '' }
        }
        if (distinct < fit + 1)
          return {
            cal: null,
            problem: `A ${FITS.find((f) => f[0] === fit)?.[1].toLowerCase()} fit needs at least ${fit + 1} points at different raw readings`,
          }
        const coeffs = polyFit(pts, fit)
        if (!coeffs) return { cal: null, problem: "These points can't be fitted" }
        return {
          cal: { type: 'poly', mult: 0, div: 0, add: 0, coeffs, degree: fit, points: pts },
          problem: '',
        }
      }
      case 'keep':
        return { cal: cal ?? null, problem: '' }
      case 'none':
        return { cal: null, problem: '' }
      case 'gain': {
        const m = num(gain)
        const a = num(offset)
        if (!Number.isFinite(m) || m === 0)
          return { cal: null, problem: 'Gain must be a number other than 0' }
        if (!Number.isFinite(a)) return { cal: null, problem: 'Offset must be a number' }
        return { cal: { type: 'linear', mult: m, div: 1, add: a }, problem: '' }
      }
      case 'two': {
        const [r1, v1, r2, v2] = [raw1, val1, raw2, val2].map(num)
        if (![r1, v1, r2, v2].every(Number.isFinite)) {
          return { cal: null, problem: 'Fill in both points' }
        }
        if (r1 === r2) return { cal: null, problem: 'The two raw readings must differ' }
        const m = (v2 - v1) / (r2 - r1)
        return { cal: { type: 'linear', mult: m, div: 1, add: v1 - m * r1 }, problem: '' }
      }
    }
  }, [mode, cal, gain, offset, raw1, val1, raw2, val2, coeffText, points, fit])

  const graph = useMemo(() => {
    if (!['two', 'gain', 'poly', 'points'].includes(mode)) return null
    const fn = calFn(next.cal)
    const shown: Point[] =
      mode === 'points'
        ? points.filter((p) => p.every(Number.isFinite))
        : mode === 'two'
          ? ([
              [num(raw1), num(val1)],
              [num(raw2), num(val2)],
            ].filter((p) => p.every(Number.isFinite)) as Point[])
          : []
    let range: [number, number]
    const xs = shown.map((p) => p[0])
    if (rawNow !== undefined && Number.isFinite(rawNow)) xs.push(rawNow)
    if (mode === 'poly' || mode === 'gain' || xs.length < 2) {
      const a = num(rangeText[0])
      const b = num(rangeText[1])
      range = Number.isFinite(a) && Number.isFinite(b) && b > a ? [a, b] : [0, 4095]
    } else {
      const lo = Math.min(...xs)
      const hi = Math.max(...xs)
      const pad = (hi - lo) * 0.1 || 1
      range = [lo - pad, hi + pad]
    }
    const quality = fn && shown.length >= 2 && mode === 'points' ? fitQuality(shown, fn) : null
    return { fn: next.problem ? null : fn, shown, range, quality }
  }, [mode, next, points, raw1, val1, raw2, val2, rangeText, rawNow])

  const save = async () => {
    if (props.canCalibrate && next.problem) {
      setError(next.problem)
      return
    }
    const p = num(precision)
    const m: ChannelMeta = {
      ...(meta ?? { order: 0 }),
      label: title.trim() || undefined,
      unit: unit.trim() || undefined,
      color: color || undefined,
      group: group.trim() && (group.trim() !== inferred || meta?.group) ? group.trim() : undefined,
      precision:
        Number.isFinite(p) && (meta?.precision != null || p !== props.precision)
          ? Math.max(0, Math.min(6, Math.round(p)))
          : meta?.precision,
    }
    const after = props.canCalibrate ? next.cal : (cal ?? null)
    setSaving(true)
    setError('')
    try {
      const i = await LiveService.SaveChannel({ name, meta: m, calibration: after })
      info.set(i)
      const changed = JSON.stringify(cal ?? null) !== JSON.stringify(after)
      if (changed) props.onSaved?.(cal, after)
      onClose()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setSaving(false)
    }
  }

  const [resetArmed, setResetArmed] = useState(false)
  const reset = async () => {
    if (!resetArmed) {
      setResetArmed(true)
      return
    }
    setSaving(true)
    setError('')
    try {
      const kept: ChannelMeta = {
        order: meta?.order ?? 0,
        pinned: meta?.pinned,
        large: meta?.large,
        warnMin: meta?.warnMin,
        warnMax: meta?.warnMax,
        critMin: meta?.critMin,
        critMax: meta?.critMax,
      }
      const after = props.canCalibrate ? null : (cal ?? null)
      info.set(await LiveService.SaveChannel({ name, meta: kept, calibration: after }))
      if (cal && !after) props.onSaved?.(cal, null)
      onClose()
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setSaving(false)
    }
  }

  const fillRaw = (set: (v: string) => void) => () => {
    if (rawNow !== undefined && Number.isFinite(rawNow)) set(fmt(rawNow, 6))
  }
  const swatch = color || props.color

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label={`Edit ${name}`}
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-2xl flex-col rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
          <span className="size-3 rounded-sm" style={{ background: swatch }} />
          <h2 className="text-sm font-semibold">{name}</h2>
          <span className="text-xs text-zinc-500">saved to the device profile</span>
          <button
            type="button"
            aria-label="Close"
            className="ml-auto text-zinc-500 hover:text-zinc-200"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          <section className="grid grid-cols-[6rem_1fr] items-center gap-x-3 gap-y-2">
            <span className="text-zinc-400">Title</span>
            <input
              aria-label="Title"
              className={field}
              placeholder={name}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <span className="text-zinc-400">Group</span>
            <div>
              <input
                aria-label="Group"
                className={`${field} w-full`}
                list="channel-groups"
                placeholder={inferred || props.group}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              />
              <datalist id="channel-groups">
                {props.groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </div>
            <span className="text-zinc-400">Colour</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {CHANNEL_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Colour ${c}`}
                  className={`size-5 rounded ${color === c ? 'ring-2 ring-zinc-100' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                />
              ))}
              <input
                aria-label="Custom colour"
                type="color"
                className="h-5 w-8 cursor-pointer rounded border border-zinc-700 bg-transparent"
                value={swatch.startsWith('#') && swatch.length === 7 ? swatch : '#ffffff'}
                onChange={(e) => setColor(e.target.value)}
              />
              <button
                type="button"
                className={color ? toolbarButton : toolbarButtonActive}
                onClick={() => setColor('')}
              >
                Auto
              </button>
            </div>
            <span className="text-zinc-400">Unit</span>
            <div className="flex items-center gap-3">
              <input
                aria-label="Unit"
                className={`${field} w-24`}
                placeholder={props.unit}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
              <label className="flex items-center gap-1 text-zinc-400">
                Decimals
                <input
                  aria-label="Decimals"
                  type="number"
                  min={0}
                  max={6}
                  className={`${field} w-14`}
                  value={precision}
                  onChange={(e) => setPrecision(e.target.value)}
                />
              </label>
            </div>
          </section>

          {props.canCalibrate && (
            <section className="space-y-2 border-t border-zinc-800 pt-3">
              <h3 className={label}>Calibration (raw ADC → value)</h3>
              <p className="text-zinc-500">
                {props.valueSource}: {fmt(now)} {unit || props.unit}
                {rawNow !== undefined && cal && <> · raw {fmt(rawNow, 6)}</>}
                {rawNow === undefined && now !== undefined && (
                  <> · raw unknown (the current calibration can't be reversed)</>
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {cal && cal.type !== 'linear' && (
                  <button
                    type="button"
                    className={mode === 'keep' ? toolbarButtonActive : toolbarButton}
                    onClick={() => setMode('keep')}
                  >
                    Keep {cal.type}
                  </button>
                )}
                {(
                  [
                    ['none', 'None (raw)'],
                    ['two', 'Two-point'],
                    ['gain', 'Gain & offset'],
                    ['poly', 'Polynomial'],
                    ['points', 'Known points (curve fit)'],
                  ] as [CalMode, string][]
                ).map(([m, text]) => (
                  <button
                    key={m}
                    type="button"
                    className={mode === m ? toolbarButtonActive : toolbarButton}
                    onClick={() => setMode(m)}
                  >
                    {text}
                  </button>
                ))}
              </div>

              {mode === 'two' && (
                <div className="space-y-1.5">
                  <p className="text-zinc-500">
                    Put the sensor at two known positions (e.g. damper fully extended and
                    compressed, or 0 and a known pressure) and record the raw reading at each.
                  </p>
                  {(
                    [
                      [raw1, setRaw1, val1, setVal1],
                      [raw2, setRaw2, val2, setVal2],
                    ] as const
                  ).map(([r, setR, v, setV], i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <span className="w-12 text-zinc-400">Point {i + 1}</span>
                      <input
                        aria-label={`Raw ${i + 1}`}
                        className={`${field} w-24`}
                        placeholder="raw"
                        value={r}
                        onChange={(e) => setR(e.target.value)}
                      />
                      <button
                        type="button"
                        className={toolbarButton}
                        disabled={rawNow === undefined}
                        title="Fill in the raw reading right now"
                        onClick={fillRaw(setR)}
                      >
                        Use current
                      </button>
                      <span className="text-zinc-500">→</span>
                      <input
                        aria-label={`Value ${i + 1}`}
                        className={`${field} w-24`}
                        placeholder="value"
                        value={v}
                        onChange={(e) => setV(e.target.value)}
                      />
                      <span className="text-zinc-500">{unit || props.unit}</span>
                    </div>
                  ))}
                </div>
              )}

              {mode === 'gain' && (
                <div className="flex flex-wrap items-center gap-2 text-zinc-400">
                  value = raw ×
                  <input
                    aria-label="Gain"
                    className={`${field} w-24`}
                    value={gain}
                    onChange={(e) => setGain(e.target.value)}
                  />
                  +
                  <input
                    aria-label="Offset"
                    className={`${field} w-24`}
                    value={offset}
                    onChange={(e) => setOffset(e.target.value)}
                  />
                </div>
              )}

              {mode === 'poly' && (
                <div className="space-y-1.5">
                  <p className="text-zinc-500">
                    value = a₀ + a₁·raw + a₂·raw² + … (from a datasheet or a fit you did elsewhere).
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {coeffText.map((c, k) => (
                      <label key={k} className="flex items-center gap-1 text-zinc-400">
                        a{k}
                        <input
                          aria-label={`Coefficient a${k}`}
                          className={`${field} w-28`}
                          value={c}
                          onChange={(e) =>
                            setCoeffText(coeffText.map((x, j) => (j === k ? e.target.value : x)))
                          }
                        />
                      </label>
                    ))}
                    <button
                      type="button"
                      className={toolbarButton}
                      disabled={coeffText.length >= 7}
                      onClick={() => setCoeffText([...coeffText, '0'])}
                    >
                      + term
                    </button>
                    <button
                      type="button"
                      className={toolbarButton}
                      disabled={coeffText.length <= 1}
                      onClick={() => setCoeffText(coeffText.slice(0, -1))}
                    >
                      − term
                    </button>
                  </div>
                </div>
              )}

              {mode === 'points' && (
                <div className="space-y-1.5">
                  <p className="text-zinc-500">
                    Put the sensor at as many known positions as you can and record the raw reading
                    at each. The curve is fitted through them.
                  </p>
                  <div className="space-y-1">
                    {rows.map(([r, v], i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <span className="w-6 text-right text-zinc-500">{i + 1}</span>
                        <input
                          aria-label={`Point ${i + 1} raw`}
                          className={`${field} w-24`}
                          placeholder="raw"
                          value={r}
                          onChange={(e) =>
                            setRows(rows.map((x, j) => (j === i ? [e.target.value, x[1]] : x)))
                          }
                        />
                        <button
                          type="button"
                          className={toolbarButton}
                          disabled={rawNow === undefined}
                          title="Fill in the raw reading right now"
                          onClick={fillRaw((val) =>
                            setRows(rows.map((x, j) => (j === i ? [val, x[1]] : x))),
                          )}
                        >
                          Use current
                        </button>
                        <span className="text-zinc-500">→</span>
                        <input
                          aria-label={`Point ${i + 1} value`}
                          className={`${field} w-24`}
                          placeholder="value"
                          value={v}
                          onChange={(e) =>
                            setRows(rows.map((x, j) => (j === i ? [x[0], e.target.value] : x)))
                          }
                        />
                        <span className="text-zinc-500">{unit || props.unit}</span>
                        <button
                          type="button"
                          aria-label={`Remove point ${i + 1}`}
                          className="text-zinc-600 hover:text-zinc-200 disabled:opacity-30"
                          disabled={rows.length <= 2}
                          onClick={() => setRows(rows.filter((_, j) => j !== i))}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className={toolbarButton}
                      onClick={() => setRows([...rows, ['', '']])}
                    >
                      + Add point
                    </button>
                    <label className="ml-auto flex items-center gap-1 text-zinc-400">
                      Fit
                      <select
                        aria-label="Fit"
                        className={field}
                        value={String(fit)}
                        onChange={(e) =>
                          setFit(
                            e.target.value === 'table'
                              ? 'table'
                              : (Number(e.target.value) as FitKind),
                          )
                        }
                      >
                        {FITS.map(([k, text]) => (
                          <option key={String(k)} value={String(k)}>
                            {text}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
              )}

              {(mode === 'poly' || mode === 'gain') && (
                <div className="flex items-center gap-2 text-zinc-500">
                  Graph raw from
                  <input
                    aria-label="Graph from"
                    className={`${field} w-20`}
                    value={rangeText[0]}
                    onChange={(e) => setRangeText([e.target.value, rangeText[1]])}
                  />
                  to
                  <input
                    aria-label="Graph to"
                    className={`${field} w-20`}
                    value={rangeText[1]}
                    onChange={(e) => setRangeText([rangeText[0], e.target.value])}
                  />
                </div>
              )}

              {graph && (
                <div className="space-y-1">
                  <CalGraph
                    fn={graph.fn}
                    points={graph.shown}
                    range={graph.range}
                    current={rawNow}
                    unit={unit || props.unit}
                  />
                  <p className={next.problem ? 'text-amber-300' : 'text-zinc-400'}>
                    {next.problem ||
                      [
                        next.cal?.type === 'linear'
                          ? formula([next.cal.add, gainOf(next.cal)])
                          : next.cal?.type === 'poly'
                            ? formula(next.cal.coeffs ?? [])
                            : 'straight lines between the points (beyond the ends the end lines carry on)',
                        graph.quality &&
                          `fit R² ${graph.quality.r2.toFixed(4)}, worst point off by ${fmt(graph.quality.maxError, 3)} ${unit || props.unit}`,
                        rawNow !== undefined &&
                          `now ${fmt(applyCal(rawNow, next.cal))} ${unit || props.unit} (yellow line)`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                  </p>
                </div>
              )}
            </section>
          )}

          {error && <p className="text-red-300">{error}</p>}
        </div>

        <footer className="flex items-center gap-2 border-t border-zinc-800 px-4 py-2">
          <button
            type="button"
            className={
              resetArmed
                ? 'rounded border border-red-500/60 px-2 py-1 text-xs text-red-300'
                : toolbarButton
            }
            disabled={saving}
            title="Clear this sensor's title, colour, group, unit, decimals, car-map spot and calibration (dashboard cards and warning limits stay)"
            onClick={() => void reset()}
            onBlur={() => setResetArmed(false)}
          >
            {resetArmed ? 'Click again to reset' : 'Reset to defaults'}
          </button>
          <span className="text-xs text-zinc-500">
            Applies to live data now and to logs opened from now on.
          </span>
          <button type="button" className={`${toolbarButton} ml-auto`} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={toolbarButtonActive}
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  )
}
