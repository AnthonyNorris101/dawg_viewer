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
  const radii: number[][] = Array.from({ length: bins }, () => [])
  let count = 0
  for (const s of sets) {
    for (let i = Math.max(0, s.start); i <= s.end && i < x.length; i++) {
      const a = x[i]
      const b = y[i]
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue
      const angle = Math.atan2(b, a)
      const k = Math.min(bins - 1, Math.floor(((angle + Math.PI) / (2 * Math.PI)) * bins))
      radii[k].push(Math.hypot(a, b))
      count++
    }
  }
  const minPerBin = Math.max(3, Math.floor(count / bins / 50))
  const r: (number | null)[] = radii.map((list) => {
    if (list.length < minPerBin) return null
    list.sort((p, q) => p - q)
    return list[Math.min(list.length - 1, Math.floor(pct * (list.length - 1)))]
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
