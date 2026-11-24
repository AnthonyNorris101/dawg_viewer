import { describe, expect, it } from 'vitest'
import {
  checkFilter,
  filterExpr,
  filterGain,
  filterName,
  parseFilter,
  startingPoints,
} from './filters'

describe('filter builder', () => {
  it('describes the response the filters give', () => {
    expect(filterGain('low', 10, 0, 10)).toBeCloseTo(0.5)
    expect(filterGain('low', 1, 0, 10)).toBeGreaterThan(0.99)
    expect(filterGain('high', 100, 10, 0)).toBeGreaterThan(0.99)
    expect(filterGain('band', 8, 3, 20)).toBeGreaterThan(0.9)
    expect(filterGain('stop', 8, 3, 20)).toBeLessThan(0.1)
    expect(filterGain('low', 40, 0, 20, 4)).toBeLessThan(filterGain('low', 40, 0, 20, 1))
  })

  it('writes the math expression and a name', () => {
    expect(filterExpr('band', 'Damper FL', 2, 20)).toBe('bandpass([Damper FL], 2, 20)')
    expect(filterExpr('low', 'AccelZ', 0, 15.5, 2)).toBe('lowpass([AccelZ], 15.5, 2)')
    expect(filterName('stop', 'AccelZ', 12, 16)).toBe('AccelZ no 12-16Hz')
  })

  it('catches cutoffs that can not work', () => {
    expect(checkFilter('low', 0, 60, 100)).toMatch(/below 50 Hz/)
    expect(checkFilter('band', 20, 10, 100)).toMatch(/below the high/)
    expect(checkFilter('band', 2, 20, 100)).toBe('')
  })
})

describe('editable filters', () => {
  it('reads back the filter a channel was made with', () => {
    expect(parseFilter('bandpass([Damper FL], 2, 20)')).toEqual({
      source: 'Damper FL',
      spec: { kind: 'band', lo: 2, hi: 20, stages: 1, points: [] },
    })
    expect(parseFilter('lowpass([AccelZ], 15.5, 2)')?.spec).toMatchObject({
      kind: 'low',
      hi: 15.5,
      stages: 2,
    })
    expect(parseFilter('highpass([AccelZ], 0.5)')?.spec).toMatchObject({ kind: 'high', lo: 0.5 })
    expect(parseFilter('bandstop([AccelX], 12, 17, 4)')?.spec).toMatchObject({
      kind: 'stop',
      stages: 4,
    })
    const shaped = filterExpr('custom', 'AccelZ', 0, 0, 1, [
      [1, 0],
      [5, 1],
      [30, 0.25],
    ])
    expect(shaped).toBe('shape([AccelZ], 1, 0, 5, 1, 30, 0.25)')
    expect(parseFilter(shaped)?.spec.points).toEqual([
      [1, 0],
      [5, 1],
      [30, 0.25],
    ])
    expect(parseFilter('hypot(AccelX, AccelY)')).toBeNull()
    expect(parseFilter('lowpass([AccelZ], AccelX)')).toBeNull()
  })

  it('starts fine-tuning from the filter you had', () => {
    const pts = startingPoints('band', 2, 20, 1, 0.1, 50)
    expect(pts[0][0]).toBe(0.1)
    expect(pts[pts.length - 1][0]).toBe(50)
    for (const [f, g] of pts) expect(g).toBeCloseTo(filterGain('band', f, 2, 20), 3)
    expect(filterGain('custom', 5, 0, 0, 1, pts)).toBeGreaterThan(0.9)
  })
})
