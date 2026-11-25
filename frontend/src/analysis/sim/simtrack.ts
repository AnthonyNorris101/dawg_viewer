import { biquad } from '../spectrum'
import { validFix } from '../track'

const G = 9.80665
const RAD = Math.PI / 180
const EARTH_R = 6371008.8
const MAX_CURVATURE = 0.25
const MIN_SPEED = 4
export const SKIDPAD_RADIUS = 9.125
export const ACCEL_LENGTH = 75

export interface SimTrack {
  name: string
  s: Float64Array
  k: Float64Array
  x: Float64Array
  y: Float64Array
  length: number
  closed: boolean
  standing: boolean
  origin?: { lat: number; lon: number }
}

function pathOf(s: Float64Array, k: Float64Array) {
  const n = s.length
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  let heading = 0
  for (let i = 1; i < n; i++) {
    const ds = s[i] - s[i - 1]
    const mid = heading + (k[i - 1] * ds) / 2
    x[i] = x[i - 1] + Math.cos(mid) * ds
    y[i] = y[i - 1] + Math.sin(mid) * ds
    heading += k[i - 1] * ds
  }
  return { x, y }
}

export function skidpadTrack(radius = SKIDPAD_RADIUS, step = 0.25): SimTrack {
  const length = 2 * Math.PI * radius
  const n = Math.max(8, Math.round(length / step))
  const s = Float64Array.from({ length: n }, (_, i) => (i * length) / n)
  const k = new Float64Array(n).fill(1 / radius)
  return {
    name: `Skidpad (${radius.toFixed(2)} m radius)`,
    s,
    k,
    ...pathOf(s, k),
    length,
    closed: true,
    standing: false,
  }
}

export function straightTrack(length = ACCEL_LENGTH, step = 0.25): SimTrack {
  const n = Math.max(2, Math.round(length / step) + 1)
  const s = Float64Array.from({ length: n }, (_, i) => (i * length) / (n - 1))
  const k = new Float64Array(n)
  return {
    name: `Acceleration (${length} m)`,
    s,
    k,
    ...pathOf(s, k),
    length,
    closed: false,
    standing: true,
  }
}

export interface Segment {
  length: number
  radius: number
}

export function parseSegments(text: string): { segments: Segment[]; errors: string[] } {
  const segments: Segment[] = []
  const errors: string[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) return
    const parts = line.split(/[\s,;]+/)
    const kind = parts[0].toLowerCase()
    const num = (p: string | undefined) => Number((p ?? '').replace(/(m|deg|°)$/i, ''))
    const fail = (why: string) => errors.push(`Line ${i + 1}: ${why}`)
    if (kind === 's' || kind === 'straight') {
      const length = num(parts[1])
      if (!(length > 0)) return fail('a straight needs a length in metres, e.g. "straight 60"')
      segments.push({ length, radius: 0 })
    } else if (['l', 'left', 'r', 'right'].includes(kind)) {
      const radius = num(parts[1])
      const amount = num(parts[2])
      if (!(radius > 0) || !(amount > 0))
        return fail('a corner needs a radius and a length, e.g. "left 12 25" or "right 9 180deg"')
      const length = /(deg|°)$/i.test(parts[2] ?? '') ? radius * amount * RAD : amount
      segments.push({ length, radius: kind.startsWith('l') ? radius : -radius })
    } else {
      fail(`"${parts[0]}" is not straight, left or right`)
    }
  })
  return { segments, errors }
}

export function segmentsTrack(
  segments: Segment[],
  o: { name?: string; closed?: boolean; standing?: boolean; step?: number } = {},
): SimTrack | null {
  const step = o.step ?? 0.5
  const total = segments.reduce((a, b) => a + b.length, 0)
  if (!(total > 1)) return null
  const closed = o.closed ?? false
  const n = Math.max(2, Math.round(total / step) + (closed ? 0 : 1))
  const s = new Float64Array(n)
  const k = new Float64Array(n)
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  let seg = 0
  let from = 0
  let end = segments[0].length
  let x0 = 0
  let y0 = 0
  let heading = 0
  const along = (radius: number, d: number): [number, number, number] => {
    if (radius === 0) return [x0 + Math.cos(heading) * d, y0 + Math.sin(heading) * d, heading]
    const turned = heading + d / radius
    return [
      x0 + radius * (Math.sin(turned) - Math.sin(heading)),
      y0 - radius * (Math.cos(turned) - Math.cos(heading)),
      turned,
    ]
  }
  for (let i = 0; i < n; i++) {
    s[i] = (i * total) / (closed ? n : n - 1)
    while (seg < segments.length - 1 && s[i] >= end) {
      ;[x0, y0, heading] = along(segments[seg].radius, segments[seg].length)
      from = end
      end += segments[++seg].length
    }
    k[i] = segments[seg].radius === 0 ? 0 : 1 / segments[seg].radius
    ;[x[i], y[i]] = along(segments[seg].radius, s[i] - from)
  }
  return {
    name: o.name ?? 'Custom track',
    s,
    k,
    x,
    y,
    length: total,
    closed,
    standing: o.standing ?? !closed,
  }
}

export type CurvatureSource = 'auto' | 'gps' | 'accel'

export interface LogTrackInput {
  time: Float64Array
  distance: Float64Array
  speed: Float64Array | null
  latG: Float64Array | null
  gps: { lat: ArrayLike<number>; lon: ArrayLike<number> } | null
}

export interface LogTrackOptions {
  name?: string
  source?: CurvatureSource
  smooth?: number
  step?: number
  closed?: boolean
  standing?: boolean
}

function smooth(a: Float64Array, half: number): Float64Array {
  if (half < 1) return a
  const n = a.length
  const sum = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + a[i]
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half)
    const hi = Math.min(n - 1, i + half)
    out[i] = (sum[hi + 1] - sum[lo]) / (hi - lo + 1)
  }
  return out
}

function filled(a: ArrayLike<number>, start: number, end: number): Float64Array {
  const out = new Float64Array(end - start + 1)
  let last = 0
  for (let i = start; i <= end; i++)
    if (Number.isFinite(a[i])) {
      last = a[i]
      break
    }
  for (let i = start; i <= end; i++) {
    if (Number.isFinite(a[i])) last = a[i]
    out[i - start] = last
  }
  return out
}

export function trackFromLog(
  inp: LogTrackInput,
  start: number,
  end: number,
  o: LogTrackOptions = {},
): SimTrack | null {
  const step = o.step ?? 1
  const d0 = inp.distance[start]
  const length = inp.distance[end] - d0
  const count = end - start + 1
  if (!(length > 20) || count < 20) return null
  const n = Math.floor(length / step) + 1
  const s = new Float64Array(n)
  const at = new Float64Array(n)
  let i = start
  for (let j = 0; j < n; j++) {
    s[j] = j * step
    const target = d0 + s[j]
    while (i < end && inp.distance[i + 1] < target) i++
    const a = inp.distance[i]
    const b = inp.distance[Math.min(end, i + 1)]
    at[j] = i - start + (b > a ? Math.min(1, Math.max(0, (target - a) / (b - a))) : 0)
  }
  const pick = (col: Float64Array) =>
    Float64Array.from(at, (f) => {
      const lo = Math.floor(f)
      const hi = Math.min(col.length - 1, lo + 1)
      return col[lo] + (col[hi] - col[lo]) * (f - lo)
    })

  let fixes = 0
  if (inp.gps)
    for (let q = start; q <= end; q++) if (validFix(inp.gps.lat[q], inp.gps.lon[q])) fixes++
  const hasGps = fixes > count / 2
  const hasAccel = !!inp.latG && !!inp.speed
  const source = o.source === 'gps' || o.source === 'accel' ? o.source : hasAccel ? 'accel' : 'gps'
  if ((source === 'gps' && !hasGps) || (source === 'accel' && !hasAccel)) return null

  let x: Float64Array | null = null
  let y: Float64Array | null = null
  let origin: SimTrack['origin']
  if (hasGps && inp.gps) {
    const lat = filled(inp.gps.lat, start, end)
    const lon = filled(inp.gps.lon, start, end)
    const lat0 = lat[0]
    const lon0 = lon[0]
    const kx = Math.cos(lat0 * RAD) * RAD * EARTH_R
    const ky = RAD * EARTH_R
    x = pick(Float64Array.from(lon, (v) => (v - lon0) * kx))
    y = pick(Float64Array.from(lat, (v) => (v - lat0) * ky))
    origin = { lat: lat0, lon: lon0 }
  }

  const side = inp.latG ? pick(filled(inp.latG, start, end)) : null
  let k: Float64Array
  if (source === 'accel' && inp.latG && inp.speed) {
    const rate = (count - 1) / Math.max(1e-6, inp.time[end] - inp.time[start])
    const ay = biquad(filled(inp.latG, start, end), rate, 2, 'low')
    const v = biquad(filled(inp.speed, start, end), rate, 2, 'low')
    const raw = Float64Array.from(ay, (a, q) => {
      const speed = Math.max(MIN_SPEED, v[q])
      return Math.max(-MAX_CURVATURE, Math.min(MAX_CURVATURE, (a * G) / (speed * speed)))
    })
    k = smooth(pick(raw), Math.round((o.smooth ?? 3) / step / 2))
  } else {
    const half = Math.max(1, Math.round((o.smooth ?? 4) / step / 2))
    const sx = smooth(smooth(x as Float64Array, half), half)
    const sy = smooth(smooth(y as Float64Array, half), half)
    const reach = Math.max(1, Math.round(2 / step))
    const heading = new Float64Array(n)
    let turns = 0
    let prev = 0
    for (let j = 0; j < n; j++) {
      const a = Math.max(0, j - reach)
      const b = Math.min(n - 1, j + reach)
      const h = Math.atan2(sy[b] - sy[a], sx[b] - sx[a])
      if (j > 0) {
        if (h - prev > Math.PI) turns -= 1
        else if (h - prev < -Math.PI) turns += 1
      }
      prev = h
      heading[j] = h + turns * 2 * Math.PI
    }
    const raw = new Float64Array(n)
    for (let j = 0; j < n; j++) {
      const a = Math.max(0, j - reach)
      const b = Math.min(n - 1, j + reach)
      const bend = b > a ? (heading[b] - heading[a]) / (s[b] - s[a]) : 0
      raw[j] = Math.max(-MAX_CURVATURE, Math.min(MAX_CURVATURE, bend))
    }
    k = smooth(raw, half)
    if (side) {
      let agree = 0
      for (let j = 0; j < n; j++) agree += k[j] * side[j]
      if (agree < 0) for (let j = 0; j < n; j++) k[j] = -k[j]
    }
  }

  const path = x && y ? { x, y } : pathOf(s, k)
  return {
    name: o.name ?? 'Logged lap',
    s,
    k,
    ...path,
    length,
    closed: o.closed ?? false,
    standing: o.standing ?? false,
    origin,
  }
}
