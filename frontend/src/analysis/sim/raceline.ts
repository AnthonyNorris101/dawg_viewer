import type { SimTrack } from './simtrack'

const MAX_CURVATURE = 0.25
const LINE_MAX_CURVATURE = 1
const EARTH_R = 6371008.8
const JOIN_WITHIN_M = 3
export const LINE_SPACING = 1.5
export const LINE_WEIGHTS = [0, 5e-4, 2e-3, 5e-3, 1e-2, 2e-2]
const MAX_POINTS = 1600
const SIM_STEP = 0.5
const JOIN_WITHIN_RAD = 0.35
const SWEEPS = 600
const OVER_RELAX = 1.8
const REFINE_PASSES = 3

export interface PathOptions {
  closed: boolean
  standing?: boolean
  origin?: { lat: number; lon: number }
  spacing?: number
  smooth?: number
  smoothM?: number
}

interface Path {
  x: Float64Array
  y: Float64Array
}

function clean(x: ArrayLike<number>, y: ArrayLike<number>, closed: boolean) {
  const px: number[] = []
  const py: number[] = []
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue
    const last = px.length - 1
    if (last >= 0 && Math.hypot(x[i] - px[last], y[i] - py[last]) < 1e-6) continue
    px.push(x[i])
    py.push(y[i])
  }
  if (closed && px.length > 2) {
    const last = px.length - 1
    if (Math.hypot(px[0] - px[last], py[0] - py[last]) < 1e-6) {
      px.pop()
      py.pop()
    }
  }
  return { px, py }
}

function spline(px: number[], py: number[], closed: boolean, spacing: number) {
  const n = px.length
  const ox: number[] = []
  const oy: number[] = []
  const at = (i: number): [number, number] => {
    if (closed) {
      const j = ((i % n) + n) % n
      return [px[j], py[j]]
    }
    if (i < 0) return [2 * px[0] - px[1], 2 * py[0] - py[1]]
    if (i >= n) return [2 * px[n - 1] - px[n - 2], 2 * py[n - 1] - py[n - 2]]
    return [px[i], py[i]]
  }
  const knot = (a: [number, number], b: [number, number]) =>
    Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])))
  const mix = (a: [number, number], b: [number, number], ta: number, tb: number, t: number) => {
    const f = (t - ta) / (tb - ta)
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] as [number, number]
  }
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)
    const t1 = knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)
    const parts = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / spacing))
    for (let q = 0; q < parts; q++) {
      const t = t1 + ((t2 - t1) * q) / parts
      const a1 = mix(p0, p1, 0, t1, t)
      const a2 = mix(p1, p2, t1, t2, t)
      const a3 = mix(p2, p3, t2, t3, t)
      const b1 = mix(a1, a2, 0, t2, t)
      const b2 = mix(a2, a3, t1, t3, t)
      const c = mix(b1, b2, t1, t2, t)
      ox.push(c[0])
      oy.push(c[1])
    }
  }
  if (!closed) {
    ox.push(px[n - 1])
    oy.push(py[n - 1])
  }
  return { px: ox, py: oy }
}

function resample(px: number[], py: number[], closed: boolean, spacing: number): Path | null {
  const m = px.length
  if (m < 2) return null
  const dist = [0]
  for (let i = 1; i < m; i++)
    dist.push(dist[i - 1] + Math.hypot(px[i] - px[i - 1], py[i] - py[i - 1]))
  if (closed) dist.push(dist[m - 1] + Math.hypot(px[0] - px[m - 1], py[0] - py[m - 1]))
  const total = dist[dist.length - 1]
  const n = Math.round(total / spacing) + (closed ? 0 : 1)
  if (n < 5) return null
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  let j = 1
  for (let i = 0; i < n; i++) {
    const d = (i * total) / (closed ? n : n - 1)
    while (j < dist.length - 1 && dist[j] < d) j++
    const f = (d - dist[j - 1]) / Math.max(1e-9, dist[j] - dist[j - 1])
    const a = j - 1
    const b = j % m
    x[i] = px[a] + (px[b] - px[a]) * f
    y[i] = py[a] + (py[b] - py[a]) * f
  }
  return { x, y }
}

function relax(p: Path, closed: boolean, passes: number) {
  const n = p.x.length
  const step = (f: number) => {
    const nx = Float64Array.from(p.x)
    const ny = Float64Array.from(p.y)
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const a = (i - 1 + n) % n
      const b = (i + 1) % n
      nx[i] = p.x[i] + f * ((p.x[a] + p.x[b]) / 2 - p.x[i])
      ny[i] = p.y[i] + f * ((p.y[a] + p.y[b]) / 2 - p.y[i])
    }
    p.x.set(nx)
    p.y.set(ny)
  }
  for (let q = 0; q < passes; q++) {
    step(0.5)
    step(-0.53)
  }
}

function build(
  name: string,
  p: Path,
  o: {
    closed: boolean
    standing?: boolean
    origin?: SimTrack['origin']
    wrap?: number
    limit?: number
    reach?: number
  },
): SimTrack {
  const { x, y } = p
  const n = x.length
  const joined = o.closed && o.wrap === undefined
  const limit = o.limit ?? MAX_CURVATURE
  const s = new Float64Array(n)
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1])
  const length = !o.closed
    ? s[n - 1]
    : s[n - 1] + (o.wrap ?? Math.hypot(x[0] - x[n - 1], y[0] - y[n - 1]))
  const k = new Float64Array(n)
  const reach = Math.max(1, Math.min(o.reach ?? 1, Math.floor((n - 1) / 2)))
  for (let i = 0; i < n; i++) {
    const a = joined ? (i - reach + n) % n : i - reach
    const c = joined ? (i + reach) % n : i + reach
    if (a < 0 || c >= n) continue
    const ux = x[i] - x[a]
    const uy = y[i] - y[a]
    const vx = x[c] - x[i]
    const vy = y[c] - y[i]
    const den = Math.hypot(ux, uy) * Math.hypot(vx, vy) * Math.hypot(x[c] - x[a], y[c] - y[a])
    const curve = den > 1e-9 ? (2 * (ux * vy - uy * vx)) / den : 0
    k[i] = Math.max(-limit, Math.min(limit, curve))
  }
  if (!joined && n > 2 * reach)
    for (let i = 0; i < reach; i++) {
      k[i] = k[reach]
      k[n - 1 - i] = k[n - 1 - reach]
    }
  return {
    name,
    s,
    k,
    x,
    y,
    length,
    closed: o.closed,
    standing: o.standing ?? !o.closed,
    origin: o.origin,
  }
}

function box(a: Float64Array, half: number, closed: boolean): Float64Array {
  const n = a.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let sum = 0
    let count = 0
    for (let q = -half; q <= half; q++) {
      const j = closed ? (((i + q) % n) + n) % n : i + q
      if (j < 0 || j >= n) continue
      sum += a[j]
      count++
    }
    out[i] = sum / count
  }
  return out
}

function refine(t: SimTrack, extra: { values: Float64Array; wrapTo?: number }[] = []) {
  const n = t.s.length
  const m = Math.max(n, Math.round(t.length / SIM_STEP) + (t.closed ? 0 : 1))
  const at = new Float64Array(m)
  const s = new Float64Array(m)
  let j = 0
  for (let i = 0; i < m; i++) {
    s[i] = (i * t.length) / (t.closed ? m : m - 1)
    while (j < n - 1 && t.s[j + 1] <= s[i]) j++
    const next = j < n - 1 ? t.s[j + 1] : t.length
    at[i] = j + (next > t.s[j] ? Math.min(1, (s[i] - t.s[j]) / (next - t.s[j])) : 0)
  }
  const pick = (a: Float64Array, wrapTo?: number) =>
    Float64Array.from(at, (f) => {
      const lo = Math.min(n - 1, Math.floor(f))
      const hi = lo < n - 1 ? a[lo + 1] : t.closed ? (wrapTo ?? a[0]) : a[lo]
      return a[lo] + (hi - a[lo]) * (f - lo)
    })
  return {
    track: { ...t, s, k: pick(t.k), x: pick(t.x), y: pick(t.y) } as SimTrack,
    extra: extra.map((e) => pick(e.values, e.wrapTo)),
  }
}

export function trackFromPath(
  name: string,
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  o: PathOptions,
): SimTrack | null {
  const spacing = o.spacing ?? LINE_SPACING
  let pts = clean(x, y, o.closed)
  const count = pts.px.length
  if (count < 3) return null
  let total = 0
  for (let i = 1; i < count; i++)
    total += Math.hypot(pts.px[i] - pts.px[i - 1], pts.py[i] - pts.py[i - 1])
  if (total / (count - 1) > spacing * 1.5) pts = spline(pts.px, pts.py, o.closed, spacing / 3)
  const path = resample(pts.px, pts.py, o.closed, spacing)
  if (!path) return null
  const half = o.smoothM && o.smoothM > 0 ? Math.max(1, Math.round(o.smoothM / spacing / 2)) : 0
  if (!half) {
    relax(path, o.closed, o.smooth ?? 3)
    return refine(build(name, path, o)).track
  }
  const smoothed = {
    x: box(box(path.x, half, o.closed), half, o.closed),
    y: box(box(path.y, half, o.closed), half, o.closed),
  }
  const track = build(name, smoothed, { ...o, reach: Math.max(1, Math.round(2 / spacing)) })
  track.k = box(track.k, half, o.closed)
  return refine(track).track
}

export function fromLatLon(lat: ArrayLike<number>, lon: ArrayLike<number>) {
  const rad = Math.PI / 180
  const origin = { lat: lat[0], lon: lon[0] }
  const kx = Math.cos(origin.lat * rad) * rad * EARTH_R
  const ky = rad * EARTH_R
  return {
    origin,
    x: Array.from(lon, (v) => (v - origin.lon) * kx),
    y: Array.from(lat, (v) => (v - origin.lat) * ky),
  }
}

export interface Line {
  track: SimTrack
  centre: SimTrack
  along: Float64Array
  offset: Float64Array
  weight: number
}

const lengths = (p: Path) => {
  const s = new Float64Array(p.x.length)
  for (let i = 1; i < s.length; i++)
    s[i] = s[i - 1] + Math.hypot(p.x[i] - p.x[i - 1], p.y[i] - p.y[i - 1])
  return s
}

function project(c: Path, cs: Float64Array, joined: boolean, x: number, y: number, hint: number) {
  const n = c.x.length
  const segments = joined ? n : n - 1
  const reach = hint < 0 ? segments : 8
  let best = { index: 0, s: 0, d: 0, fx: c.x[0], fy: c.y[0], gap: Infinity }
  for (let q = -reach; q <= reach; q++) {
    let j = Math.max(0, hint) + q
    if (joined) j = ((j % segments) + segments) % segments
    else if (j < 0 || j >= segments) continue
    const b = (j + 1) % n
    const ex = c.x[b] - c.x[j]
    const ey = c.y[b] - c.y[j]
    const len = Math.hypot(ex, ey) || 1
    const t = Math.max(0, Math.min(1, ((x - c.x[j]) * ex + (y - c.y[j]) * ey) / (len * len)))
    const fx = c.x[j] + ex * t
    const fy = c.y[j] + ey * t
    const gap = Math.hypot(x - fx, y - fy)
    if (gap < best.gap)
      best = {
        index: j,
        s: cs[j] + t * len,
        d: Math.sign(ex * (y - c.y[j]) - ey * (x - c.x[j])) * gap,
        fx,
        fy,
        gap,
      }
  }
  return best
}

interface Bounds {
  lo: Float64Array
  hi: Float64Array
}

function relaxLine(ref: Path, joined: boolean, b: Bounds, eps: number, off: Float64Array): Path {
  const n = ref.x.length
  const nx = new Float64Array(n)
  const ny = new Float64Array(n)
  const near = new Int32Array(4 * n)
  for (let i = 0; i < n; i++) {
    const a = joined ? (i - 1 + n) % n : Math.max(0, i - 1)
    const c = joined ? (i + 1) % n : Math.min(n - 1, i + 1)
    const tx = ref.x[c] - ref.x[a]
    const ty = ref.y[c] - ref.y[a]
    const len = Math.hypot(tx, ty) || 1
    nx[i] = -ty / len
    ny[i] = tx / len
    for (let q = 0; q < 4; q++) {
      const j = i + (q < 2 ? q - 2 : q - 1)
      near[4 * i + q] = joined ? ((j % n) + n) % n : j >= 0 && j < n ? j : -1
    }
  }
  const px = Float64Array.from(ref.x, (v, i) => v + off[i] * nx[i])
  const py = Float64Array.from(ref.y, (v, i) => v + off[i] * ny[i])
  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    let moved = 0
    for (let step = 0; step < n; step++) {
      const i = sweep % 2 === 0 ? step : n - 1 - step
      const a2 = near[4 * i]
      const a1 = near[4 * i + 1]
      const b1 = near[4 * i + 2]
      const b2 = near[4 * i + 3]
      const cx = ref.x[i]
      const cy = ref.y[i]
      const ux = nx[i]
      const uy = ny[i]
      let num = 0
      let den = 0
      if (a2 >= 0) {
        num -= (px[a2] - 2 * px[a1] + cx) * ux + (py[a2] - 2 * py[a1] + cy) * uy
        den += 1
      }
      if (a1 >= 0 && b1 >= 0) {
        num += 2 * ((px[a1] - 2 * cx + px[b1]) * ux + (py[a1] - 2 * cy + py[b1]) * uy)
        den += 4
      }
      if (b2 >= 0) {
        num -= (cx - 2 * px[b1] + px[b2]) * ux + (cy - 2 * py[b1] + py[b2]) * uy
        den += 1
      }
      if (eps > 0) {
        if (a1 >= 0) {
          num -= eps * ((cx - px[a1]) * ux + (cy - py[a1]) * uy)
          den += eps
        }
        if (b1 >= 0) {
          num += eps * ((px[b1] - cx) * ux + (py[b1] - cy) * uy)
          den += eps
        }
      }
      const target = den > 0 ? off[i] + OVER_RELAX * (num / den - off[i]) : 0
      const next = Math.max(b.lo[i], Math.min(b.hi[i], target))
      const change = Math.abs(next - off[i])
      if (change > moved) moved = change
      off[i] = next
      px[i] = cx + next * ux
      py[i] = cy + next * uy
    }
    if (moved < 1e-4) break
  }
  return { x: px, y: py }
}

export function racingLine(track: SimTrack, room: number, weight = 0): Line | null {
  if (!(room > 0)) return null
  const n0 = track.x.length
  const gap = Math.hypot(track.x[0] - track.x[n0 - 1], track.y[0] - track.y[n0 - 1])
  const wrap = track.closed ? Math.max(1e-3, track.length - track.s[n0 - 1]) : 0
  const turn = Math.abs(
    Math.atan2(track.y[1] - track.y[0], track.x[1] - track.x[0]) -
      Math.atan2(track.y[n0 - 1] - track.y[n0 - 2], track.x[n0 - 1] - track.x[n0 - 2]),
  )
  const joined =
    track.closed &&
    gap < Math.max(JOIN_WITHIN_M, 2 * wrap) &&
    Math.min(turn, 2 * Math.PI - turn) < JOIN_WITHIN_RAD
  const pts = clean(track.x, track.y, joined)
  const spacing = Math.max(LINE_SPACING, track.length / MAX_POINTS)
  const centre = resample(pts.px, pts.py, joined, spacing)
  if (!centre) return null
  const cs = lengths(centre)
  const pin = (b: Bounds) => {
    if (joined) return b
    const last = b.lo.length - 1
    b.lo[0] = b.hi[0] = 0
    if (track.closed) b.lo[last] = b.hi[last] = 0
    return b
  }

  let off: Float64Array | null = null
  let line: Path = centre
  for (let level = 2; level >= 0; level--) {
    const h = spacing * 2 ** level
    const c = level === 0 ? centre : resample(pts.px, pts.py, joined, h)
    if (!c || c.x.length < 12) continue
    const n = c.x.length
    const start = new Float64Array(n)
    if (off) {
      const m = off.length
      for (let i = 0; i < n; i++) {
        const f = joined ? (i / n) * m : (i / (n - 1)) * (m - 1)
        const a = Math.min(m - 1, Math.floor(f))
        const b = joined ? (a + 1) % m : Math.min(m - 1, a + 1)
        start[i] = off[a] + (off[b] - off[a]) * (f - a)
      }
    }
    const bounds = pin({ lo: new Float64Array(n).fill(-room), hi: new Float64Array(n).fill(room) })
    line = relaxLine(c, joined, bounds, weight * h * h, start)
    off = start
  }

  const place = (p: Path) => {
    const n = p.x.length
    const s = new Float64Array(n)
    const d = new Float64Array(n)
    let hint = -1
    for (let i = 0; i < n; i++) {
      const at = project(centre, cs, joined, p.x[i], p.y[i], hint)
      hint = at.index
      if (at.gap > room) {
        p.x[i] = at.fx + ((p.x[i] - at.fx) * room) / at.gap
        p.y[i] = at.fy + ((p.y[i] - at.fy) * room) / at.gap
        at.d = Math.sign(at.d) * room
      }
      s[i] = at.s
      d[i] = at.d
    }
    return { s, d }
  }
  for (let pass = 0; pass < REFINE_PASSES; pass++) {
    const ref = resample(Array.from(line.x), Array.from(line.y), joined, spacing)
    if (!ref) break
    const { d } = place(ref)
    const bounds = pin({
      lo: Float64Array.from(d, (v) => Math.min(0, -room - v)),
      hi: Float64Array.from(d, (v) => Math.max(0, room - v)),
    })
    line = relaxLine(
      ref,
      joined,
      bounds,
      weight * spacing * spacing,
      new Float64Array(ref.x.length),
    )
  }

  const at = place(line)
  const o = {
    closed: track.closed,
    standing: track.standing,
    origin: track.origin,
    wrap: track.closed && !joined ? wrap : undefined,
    limit: LINE_MAX_CURVATURE,
  }
  const middle = refine(build(track.name, centre, o)).track
  const fine = refine(build(`${track.name} · ideal line`, line, o), [
    { values: at.s, wrapTo: middle.length },
    { values: at.d },
  ])
  return { track: fine.track, centre: middle, along: fine.extra[0], offset: fine.extra[1], weight }
}

export interface IdealLine extends Line {
  time: number
  tried: { weight: number; time: number; length: number }[]
}

export function idealLine(
  track: SimTrack,
  room: number,
  timeOf: (t: SimTrack) => number,
): IdealLine | null {
  let best: IdealLine | null = null
  const tried: IdealLine['tried'] = []
  for (const weight of LINE_WEIGHTS) {
    const line = racingLine(track, room, weight)
    if (!line) return null
    const time = timeOf(line.track)
    tried.push({ weight, time, length: line.track.length })
    if (!best || time < best.time) best = { ...line, time, tried }
  }
  return best
}
