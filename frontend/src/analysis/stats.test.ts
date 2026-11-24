import { describe, expect, it } from 'vitest'
import { histogram, niceTicks, rangeStats } from './stats'

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
