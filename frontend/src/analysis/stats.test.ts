import { describe, expect, it } from 'vitest'
import { histogram, niceTicks, rangeStats, selectKth } from './stats'

describe('stats', () => {
  it('summarises a range and skips NaN', () => {
    const s = rangeStats([1, 2, NaN, 3, 100], 0, 3)
    expect(s).toMatchObject({ min: 1, max: 3, mean: 2, count: 3 })
    expect(s.std).toBeCloseTo(Math.sqrt(2 / 3))
  })

  it('bins values with outliers in the end bins', () => {
    const h = histogram([{ data: [0, 1, 2, 3, 4, 10], start: 0, end: 5 }], 2, [0, 4])!
    expect(h.counts).toEqual([2, 4])
    expect(h.total).toBe(6)
  })

  it('picks round tick values', () => {
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    expect(niceTicks(-3, 7, 5)).toEqual([-2, 0, 2, 4, 6])
  })
})

describe('selectKth', () => {
  const rand = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646

  it('puts the value a sorted copy would have at every index', () => {
    const r = rand(3)
    for (const n of [1, 2, 3, 10, 101]) {
      // Few distinct values, like held telemetry readings.
      const data = Float64Array.from({ length: n }, () => Math.round(r() * 8) - 4)
      const sorted = [...data].sort((a, b) => a - b)
      for (let k = 0; k < n; k++) expect(selectKth(data.slice(), k)).toBe(sorted[k])
    }
  })

  it('partitions around k so a second select can work on the upper part', () => {
    const r = rand(9)
    const data = Float64Array.from({ length: 500 }, () => r() * 100)
    const sorted = [...data].sort((a, b) => a - b)
    const a = data.slice()
    expect(selectKth(a, 4)).toBe(sorted[4])
    for (let i = 0; i < 4; i++) expect(a[i]).toBeLessThanOrEqual(a[4])
    for (let i = 5; i < 500; i++) expect(a[i]).toBeGreaterThanOrEqual(a[4])
    expect(selectKth(a, 495, 4)).toBe(sorted[495])
  })

  it('works inside a sub-range and leaves the rest alone', () => {
    const a = new Float64Array([9, 9, 5, 1, 4, 2, 3, 9, 9])
    expect(selectKth(a, 3, 2, 6)).toBe(2)
    expect([a[0], a[1], a[7], a[8]]).toEqual([9, 9, 9, 9])
    expect([...a.subarray(2, 7)].sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('handles sorted and reversed input', () => {
    const up = Float64Array.from({ length: 1000 }, (_, i) => i)
    expect(selectKth(up.slice(), 980)).toBe(980)
    expect(selectKth(up.slice().reverse(), 980)).toBe(980)
  })
})
