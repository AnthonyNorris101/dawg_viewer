import { describe, expect, it } from 'vitest'
import { ggEnvelope } from './gg'
import { biquad, peak, uniform, welch } from './spectrum'

const sine = (n: number, rate: number, hz: number, amp = 1) =>
  Float64Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate))

const rms = (a: Float64Array, from = 0) => {
  let s = 0
  for (let i = from; i < a.length; i++) s += a[i] * a[i]
  return Math.sqrt(s / (a.length - from))
}

describe('spectrum', () => {
  it('finds the frequency of a vibration', () => {
    const x = sine(8192, 100, 12.5)
    const s = welch(x, 100, 1024)!
    expect(s.size).toBe(1024)
    expect(s.segments).toBe(15)
    expect(peak(s)!.hz).toBeCloseTo(12.5, 0)
  })

  it('keeps total power (Parseval)', () => {
    const x = sine(8192, 100, 10, 2)
    const s = welch(x, 100, 512)!
    const df = s.freq[1] - s.freq[0]
    const power = s.psd.reduce((a, p) => a + p * df, 0)
    expect(power).toBeCloseTo(2, 1)
  })

  it('resamples uneven time onto an even grid', () => {
    const time = [0, 0.1, 0.25, 0.3, 0.4]
    const u = uniform(time, [0, 1, 2.5, 3, 4], 0, 4)
    expect(u).toBeNull()
    const t2 = Array.from({ length: 11 }, (_, i) => (i === 5 ? 0.52 : i / 10))
    const v = uniform(
      t2,
      t2.map((t) => t * 10),
      0,
      10,
    )!
    expect(v.rate).toBeCloseTo(10)
    expect([...v.values].map((a) => Number(a.toFixed(6)))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ])
  })
})

describe('filters', () => {
  it('low-pass keeps slow motion and removes noise', () => {
    const rate = 100
    const slow = sine(2000, rate, 1)
    const noise = sine(2000, rate, 30, 0.5)
    const mixed = slow.map((v, i) => v + noise[i])
    const out = biquad(mixed, rate, 5, 'low')
    const err = out.map((v, i) => v - slow[i])
    expect(rms(err, 100)).toBeLessThan(0.02)
  })

  it('high-pass removes the slow part', () => {
    const rate = 100
    const out = biquad(
      sine(2000, rate, 0.5).map((v, i) => v + 3 + sine(2000, rate, 20, 0.2)[i]),
      rate,
      5,
      'high',
    )
    expect(rms(out, 200)).toBeCloseTo(0.2 / Math.SQRT2, 1)
  })
})

describe('G-G envelope', () => {
  it('measures the grip circle of data filling a disc', () => {
    const n = 20000
    const x = new Float64Array(n)
    const y = new Float64Array(n)
    let seed = 7
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let i = 0; i < n; i++) {
      const a = rand() * 2 * Math.PI
      const r = 1.5 * Math.sqrt(rand())
      x[i] = r * Math.cos(a)
      y[i] = r * Math.sin(a)
    }
    const g = ggEnvelope(x, y, [{ start: 0, end: n - 1 }])!
    expect(g.radius).toBeGreaterThan(1.4)
    expect(g.radius).toBeLessThan(1.5)
    expect(g.area).toBeCloseTo(Math.PI * g.radius * g.radius)
    expect(g.xMax).toBeGreaterThan(1.4)
    expect(g.yMin).toBeLessThan(-1.4)
  })

  it('needs data in most directions', () => {
    const x = Float64Array.from({ length: 100 }, (_, i) => i / 100)
    expect(ggEnvelope(x, new Float64Array(100), [{ start: 0, end: 99 }])).toBeNull()
  })
})
