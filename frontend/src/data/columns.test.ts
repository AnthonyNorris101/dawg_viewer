import { describe, expect, it } from 'vitest'
import { mapColumn } from './columns'

describe('mapColumn', () => {
  it('matches Float64Array.from with a mapping function, NaN included', () => {
    const data = new Float64Array([0, 1.5, -2, NaN, Infinity, 1e-300])
    const fn = (v: number) => v / 9.80665
    expect(mapColumn(data, fn)).toEqual(Float64Array.from(data, fn))
  })

  it('returns a new array and leaves the input untouched', () => {
    const data = new Float64Array([1, 2, 3])
    const out = mapColumn(data, (v) => v * 2)
    expect(out).not.toBe(data)
    expect(Array.from(out)).toEqual([2, 4, 6])
    expect(Array.from(data)).toEqual([1, 2, 3])
  })

  it('handles an empty column', () => {
    expect(mapColumn(new Float64Array(0), (v) => v).length).toBe(0)
  })
})
