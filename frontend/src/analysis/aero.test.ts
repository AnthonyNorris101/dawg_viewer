import { describe, expect, it } from 'vitest'
import { downforceN, dragN, fitAero, G, gripBySpeed, gripLimitG, gripUsed } from './aero'

const car = { mass: 290, tireMu: 1.5, clA: 3, cdA: 1.3, aeroFront: 0.45, airDensity: 1.2 }

describe('aero', () => {
  it('scales downforce and drag with speed squared', () => {
    expect(downforceN(car, 20)).toBeCloseTo(0.5 * 1.2 * 3 * 400)
    expect(dragN(car, 20)).toBeCloseTo(0.5 * 1.2 * 1.3 * 400)
    expect(gripLimitG(car, 0)).toBe(1.5)
    expect(gripLimitG(car, 20)).toBeCloseTo(1.5 * (1 + 720 / (290 * G)))
    expect(gripLimitG(car, 20, 0)).toBe(1.5)
  })

  it('finds the grip envelope per speed band and recovers the aero from it', () => {
    const real = { ...car, tireMu: 1.35, clA: 2.2 }
    const speed: number[] = []
    const g: number[] = []
    let seed = 3
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
    for (let i = 0; i < 40000; i++) {
      const v = 4 + rnd() * 26
      speed.push(v)
      g.push(gripLimitG(real, v) * Math.sqrt(rnd()) * 1.0)
    }
    const bins = gripBySpeed(speed, g, [{ start: 0, end: speed.length - 1 }], 2)
    expect(bins.length).toBeGreaterThan(10)
    for (const b of bins) expect(b.envelope).toBeLessThanOrEqual(gripLimitG(real, b.hi) + 1e-9)
    const fit = fitAero(bins, car)!
    expect(fit.mu).toBeGreaterThan(1.2)
    expect(fit.mu).toBeLessThan(1.4)
    expect(fit.clA).toBeGreaterThan(1.6)
    expect(fit.clA).toBeLessThan(2.8)
    const used = gripUsed(bins, car)
    for (const u of used) expect(u).toBeLessThan(1)
  })

  it('reports no downforce when grip does not grow with speed', () => {
    const bins = [5, 10, 15, 20].map((mid) => ({
      lo: mid - 1,
      hi: mid + 1,
      mid,
      n: 100,
      envelope: 1.4,
    }))
    const fit = fitAero(bins, car)!
    expect(fit.mu).toBeCloseTo(1.4)
    expect(fit.clA).toBe(0)
    expect(fitAero(bins.slice(0, 2), car)).toBeNull()
    expect(
      fitAero(
        bins.map((b) => ({ ...b, mid: 20 + b.mid / 10 })),
        car,
      ),
    ).toBeNull()
  })

  it('finds each speed band envelope exactly as a full sort would', () => {
    let seed = 5
    const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    const n = 30000
    const speed = Float64Array.from({ length: n }, () => r() * 40)
    const g = Float64Array.from({ length: n }, () => Math.round(r() * 200) / 100)
    speed[7] = NaN
    const sets = [
      { start: 0, end: 9999 },
      { start: 15000, end: n - 1 },
    ]
    const buckets: number[][] = []
    for (const s of sets) {
      for (let i = s.start; i <= s.end; i++) {
        const v = speed[i]
        if (!Number.isFinite(v) || v < 3) continue
        ;(buckets[Math.floor((v - 3) / 2)] ??= []).push(g[i])
      }
    }
    const want = buckets.flatMap((values, k) => {
      if (!values || values.length < 30) return []
      values.sort((a, b) => a - b)
      return [
        {
          k,
          n: values.length,
          envelope: values[Math.min(values.length - 1, Math.floor(values.length * 0.98))],
        },
      ]
    })
    const bins = gripBySpeed(speed, g, sets, 2)
    expect(
      bins.map((b) => ({ k: Math.round((b.lo - 3) / 2), n: b.n, envelope: b.envelope })),
    ).toEqual(want)
  })
})
