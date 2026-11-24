import { describe, expect, it } from 'vitest'
import { GG_BINS, GG_PERCENTILE, ggEnvelope } from './gg'

// The radii per direction as the envelope used to find them: a full sort of
// each direction's list. ggEnvelope must pick exactly the same values.
function referenceRadii(x: ArrayLike<number>, y: ArrayLike<number>, start: number, end: number) {
  const bins = GG_BINS
  const radii: number[][] = Array.from({ length: bins }, () => [])
  let count = 0
  for (let i = start; i <= end; i++) {
    const a = x[i]
    const b = y[i]
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    const k = Math.min(bins - 1, Math.floor(((Math.atan2(b, a) + Math.PI) / (2 * Math.PI)) * bins))
    radii[k].push(Math.hypot(a, b))
    count++
  }
  const minPerBin = Math.max(3, Math.floor(count / bins / 50))
  return radii.map((list) => {
    if (list.length < minPerBin) return null
    list.sort((p, q) => p - q)
    return list[Math.min(list.length - 1, Math.floor(GG_PERCENTILE * (list.length - 1)))]
  })
}

describe('ggEnvelope', () => {
  it('picks the same percentile radius per direction as a full sort', () => {
    let seed = 11
    const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const n = 20000
    const x = Float64Array.from({ length: n }, () => Math.round((r() * 3 - 1.5) * 100) / 100)
    const y = Float64Array.from({ length: n }, () => Math.round((r() * 3 - 1.5) * 100) / 100)
    x[5] = NaN
    const start = 100
    const end = 18000
    const g = ggEnvelope(x, y, [{ start, end }])!
    const want = referenceRadii(x, y, start, end)
    g.points.forEach(([px, py], k) => {
      if (want[k] != null) expect(Math.hypot(px, py)).toBeCloseTo(want[k]!, 12)
    })
    expect(g.count).toBe(end - start + 1)
  })
})
