import { shapeGain, type GainPoint } from './spectrum'

export type FilterKind = 'low' | 'high' | 'band' | 'stop' | 'custom'

export const FILTER_KINDS: [FilterKind, string, string][] = [
  ['low', 'Low-pass', 'keeps slow changes, removes noise and vibration above the cutoff'],
  ['high', 'High-pass', 'keeps fast changes, removes drift and slow trends below the cutoff'],
  ['band', 'Band-pass', 'keeps only the frequencies between the two cutoffs'],
  ['stop', 'Band-stop', 'removes the frequencies between the two cutoffs (e.g. one vibration)'],
  [
    'custom',
    'Fine-tune',
    'your own curve: drag the dots to keep exactly as much of each frequency as you want',
  ],
]

export interface FilterSpec {
  kind: FilterKind
  lo: number
  hi: number
  stages: number
  points: GainPoint[]
}

export const stageSpread = (stages: number) => (2 ** (1 / stages) - 1) ** 0.25

const lp = (f: number, fc: number, stages: number) => {
  const r = ((f * stageSpread(stages)) / fc) ** 4
  return (1 / (1 + r)) ** stages
}
const hp = (f: number, fc: number, stages: number) => {
  const r = (f / (fc * stageSpread(stages))) ** 4
  return (r / (1 + r)) ** stages
}

export function filterGain(
  kind: FilterKind,
  f: number,
  lo: number,
  hi: number,
  stages = 1,
  points: readonly GainPoint[] = [],
) {
  switch (kind) {
    case 'custom':
      return shapeGain(points, f)
    case 'low':
      return lp(f, hi, stages)
    case 'high':
      return hp(f, lo, stages)
    case 'band':
      return hp(f, lo, stages) * lp(f, hi, stages)
    case 'stop':
      return 1 - hp(f, lo, stages) * lp(f, hi, stages)
  }
}

const hz = (v: number) => Number(v.toPrecision(4)).toString()

const keep = (g: number) => Number(g.toFixed(3)).toString()

export function filterExpr(
  kind: FilterKind,
  channel: string,
  lo: number,
  hi: number,
  stages = 1,
  points: readonly GainPoint[] = [],
) {
  const x = `[${channel}]`
  const s = stages > 1 ? `, ${stages}` : ''
  switch (kind) {
    case 'custom':
      return `shape(${x}, ${points.map(([f, g]) => `${hz(f)}, ${keep(g)}`).join(', ')})`
    case 'low':
      return `lowpass(${x}, ${hz(hi)}${s})`
    case 'high':
      return `highpass(${x}, ${hz(lo)}${s})`
    case 'band':
      return `bandpass(${x}, ${hz(lo)}, ${hz(hi)}${s})`
    case 'stop':
      return `bandstop(${x}, ${hz(lo)}, ${hz(hi)}${s})`
  }
}

export function filterSuffix(kind: FilterKind, lo: number, hi: number) {
  switch (kind) {
    case 'custom':
      return 'tuned'
    case 'low':
      return `<${hz(hi)}Hz`
    case 'high':
      return `>${hz(lo)}Hz`
    case 'band':
      return `${hz(lo)}-${hz(hi)}Hz`
    case 'stop':
      return `no ${hz(lo)}-${hz(hi)}Hz`
  }
}

export const filterName = (kind: FilterKind, channel: string, lo: number, hi: number) =>
  `${channel} ${filterSuffix(kind, lo, hi)}`

export function checkFilter(
  kind: FilterKind,
  lo: number,
  hi: number,
  rate: number,
  points: readonly GainPoint[] = [],
): string {
  const nyq = rate / 2
  if (kind === 'custom') {
    if (points.length < 2) return 'Fine-tune needs at least 2 points'
    return ''
  }
  const needLo = kind !== 'low'
  const needHi = kind !== 'high'
  if (needLo && !(lo > 0)) return 'The low cutoff must be above 0 Hz'
  if (needHi && !(hi > 0)) return 'The high cutoff must be above 0 Hz'
  if (needLo && kind === 'high' && lo >= nyq)
    return `The cutoff must be below ${hz(nyq)} Hz (half the ${hz(rate)} Hz sample rate)`
  if (needHi && hi >= nyq)
    return `The cutoff must be below ${hz(nyq)} Hz (half the ${hz(rate)} Hz sample rate)`
  if (needLo && needHi && !(lo < hi)) return 'The low cutoff must be below the high cutoff'
  return ''
}

const NUM = String.raw`(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)`

export function parseFilter(expr: string): { source: string; spec: FilterSpec } | null {
  const m = /^\s*(lowpass|highpass|bandpass|bandstop|shape)\(\s*\[([^\]]+)\]\s*,(.*)\)\s*$/i.exec(
    expr,
  )
  if (!m) return null
  const args = m[3].split(',').map((a) => a.trim())
  if (!args.every((a) => new RegExp(`^${NUM}$`, 'i').test(a))) return null
  const v = args.map(Number)
  const fn = m[1].toLowerCase()
  const base = { lo: 0, hi: 0, stages: 1, points: [] as GainPoint[] }
  switch (fn) {
    case 'lowpass':
      if (v.length < 1 || v.length > 2) return null
      return { source: m[2], spec: { ...base, kind: 'low', hi: v[0], stages: v[1] ?? 1 } }
    case 'highpass':
      if (v.length < 1 || v.length > 2) return null
      return { source: m[2], spec: { ...base, kind: 'high', lo: v[0], stages: v[1] ?? 1 } }
    case 'bandpass':
    case 'bandstop':
      if (v.length < 2 || v.length > 3) return null
      return {
        source: m[2],
        spec: {
          ...base,
          kind: fn === 'bandpass' ? 'band' : 'stop',
          lo: v[0],
          hi: v[1],
          stages: v[2] ?? 1,
        },
      }
    default: {
      if (v.length < 2 || v.length % 2) return null
      const points: GainPoint[] = []
      for (let i = 0; i < v.length; i += 2) points.push([v[i], v[i + 1]])
      return { source: m[2], spec: { ...base, kind: 'custom', points } }
    }
  }
}

export function startingPoints(
  kind: Exclude<FilterKind, 'custom'>,
  lo: number,
  hi: number,
  stages: number,
  fMin: number,
  fMax: number,
): GainPoint[] {
  const fs = new Set<number>()
  const add = (f: number) => f >= fMin && f <= fMax && fs.add(Number(f.toPrecision(3)))
  add(fMin)
  add(fMax)
  for (const c of [kind !== 'low' ? lo : 0, kind !== 'high' ? hi : 0]) {
    if (c > 0) for (const k of [0.3, 0.5, 0.7, 1, 1.4, 2, 3.3]) add(c * k)
  }
  return [...fs]
    .sort((a, b) => a - b)
    .map((f) => [f, Number(filterGain(kind, f, lo, hi, stages).toFixed(3))] as GainPoint)
}
