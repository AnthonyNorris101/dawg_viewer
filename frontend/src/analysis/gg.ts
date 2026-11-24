import { selectKth } from './stats'

export interface GGEnvelope {
  points: [number, number][]
  area: number
  radius: number
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  count: number
}

export const GG_BINS = 36
export const GG_PERCENTILE = 0.98

export function ggEnvelope(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  sets: { start: number; end: number }[],
  bins = GG_BINS,
  pct = GG_PERCENTILE,
): GGEnvelope | null {
  let room = 0
  for (const s of sets)
    room += Math.max(0, Math.min(s.end, x.length - 1) - Math.max(0, s.start) + 1)
  const radius = new Float64Array(room)
  const dir = new Int32Array(room)
  const perBin = new Int32Array(bins)
  let count = 0
  for (const s of sets) {
    for (let i = Math.max(0, s.start); i <= s.end && i < x.length; i++) {
      const a = x[i]
      const b = y[i]
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      const angle = Math.atan2(b, a)
      const k = Math.min(bins - 1, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * bins))
      radius[count] = Math.hypot(a, b)
      dir[count] = k
      perBin[k]++
      count++
    }
  }
  // Group the radii by direction in one buffer, then pick each direction's
  // percentile in place instead of sorting it.
  const offset = new Int32Array(bins + 1)
  for (let k = 0; k < bins; k++) offset[k + 1] = offset[k] + perBin[k]
  const grouped = new Float64Array(count)
  const fill = offset.slice(0, bins)
  for (let m = 0; m < count; m++) grouped[fill[dir[m]]++] = radius[m]

  const minPerBin = Math.max(3, Math.floor(count / bins / 50))
  const r: (number | null)[] = Array.from({ length: bins }, (_, k) => {
    const len = perBin[k]
    if (len < minPerBin) return null
    const lo = offset[k]
    return selectKth(grouped, lo + Math.min(len - 1, Math.floor(pct * (len - 1))), lo, lo + len - 1)
  })
  const known = r.filter((v) => v != null).length
  if (known < bins / 2) return null

  for (let k = 0; k < bins; k++) {
    if (r[k] != null) continue
    let lo = 1
    while (r[(k - lo + bins) % bins] == null) lo++
    let hi = 1
    while (r[(k + hi) % bins] == null) hi++
    const a = r[(k - lo + bins) % bins]!
    const b = r[(k + hi) % bins]!
    r[k] = a + ((b - a) * lo) / (lo + hi)
  }

  const points = r.map((radius, k): [number, number] => {
    const angle = -Math.PI + ((k + 0.5) / bins) * 2 * Math.PI
    return [radius! * Math.cos(angle), radius! * Math.sin(angle)]
  })
  let twice = 0
  for (let k = 0; k < bins; k++) {
    const [x1, y1] = points[k]
    const [x2, y2] = points[(k + 1) % bins]
    twice += x1 * y2 - x2 * y1
  }
  const area = Math.abs(twice) / 2
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  return {
    points,
    area,
    radius: Math.sqrt(area / Math.PI),
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
    count,
  }
}
