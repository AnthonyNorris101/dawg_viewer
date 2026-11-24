import { describe, expect, it } from 'vitest'
import { applyCal, calFn, evalPoly, fitQuality, inverter, polyFit, tableFn } from './calibration'

describe('calibration', () => {
  it('fits polynomials through known points', () => {
    const want = [-3.5, 0.02, 4e-6]
    const pts: [number, number][] = []
    for (let x = 300; x <= 3800; x += 350) pts.push([x, evalPoly(want, x)])
    const got = polyFit(pts, 2)!
    got.forEach((c, k) => expect(c).toBeCloseTo(want[k], 9))
    const line = polyFit(
      [
        [0, 1],
        [1, 3],
        [2, 5],
        [3, 7.2],
      ],
      1,
    )!
    expect(line[1]).toBeCloseTo(2.06, 9)
    expect(polyFit(pts.slice(0, 2), 2)).toBeNull()
    const q = fitQuality(pts, (x) => evalPoly(got, x))
    expect(q.r2).toBeCloseTo(1, 9)
    expect(q.maxError).toBeLessThan(1e-6)
  })

  it('draws straight lines between table points and carries the end lines on', () => {
    const f = tableFn([
      [1000, 10],
      [0, 0],
      [2000, 40],
    ])!
    expect(f(500)).toBe(5)
    expect(f(1500)).toBe(25)
    expect(f(3000)).toBe(70)
    expect(f(-1000)).toBe(-10)
    expect(
      tableFn([
        [1, 1],
        [1, 2],
      ]),
    ).toBeNull()
  })

  it('applies and reverses every kind it knows', () => {
    const base = { mult: 0, div: 0, add: 0 }
    const cals = [
      { ...base, type: 'linear', mult: 0.5, add: -3 },
      { ...base, type: 'poly', coeffs: [-10, 0.03, 2e-6] },
      {
        ...base,
        type: 'table',
        points: [
          [0, 0],
          [1000, 15],
          [4000, 90],
        ] as [number, number][],
      },
    ]
    for (const cal of cals) {
      const v = applyCal(1234, cal)
      expect(v).not.toBe(1234)
      expect(inverter(cal)!(v)).toBeCloseTo(1234, 6)
    }
    expect(calFn({ ...base, type: 'gear' })).toBeNull()
    expect(inverter({ ...base, type: 'steinhart_f' })).toBeNull()
    expect(applyCal(7, null)).toBe(7)
  })
})
