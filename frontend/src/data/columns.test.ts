import { describe, expect, it } from 'vitest'
import { findSpeed } from '../analysis/track'
import { GPS_SPEED, mapColumn, sessionFromColumns } from './columns'

const log = { name: 'run.csv', path: 'run.csv', source: 'long', note: '' }

function build(names: string[], columns: number[][]) {
  const rows = columns[0].length
  const buf = new Float64Array((names.length + 1) * rows)
  for (let i = 0; i < rows; i++) buf[i] = i / 50
  columns.forEach((col, c) => buf.set(col, (c + 1) * rows))
  return sessionFromColumns(
    buf.buffer,
    rows,
    names.map((name) => ({ name, unit: '' })),
    log,
  )
}

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

describe('sessionFromColumns', () => {
  it('adds a GPS speed channel from north and east velocity when the log has no speed', () => {
    const s = build(
      ['RPM', 'VelNorth', 'VelEast'],
      [
        [9000, 9100],
        [3, 6],
        [4, 8],
      ],
    )
    const speed = s.byId.get(GPS_SPEED)
    expect(speed?.unit).toBe('mph')
    expect(speed?.data[0]).toBeCloseTo(5 * 2.236936, 4)
    expect(speed?.data[1]).toBeCloseTo(10 * 2.236936, 4)
    expect(findSpeed(s.channels)?.id).toBe(GPS_SPEED)
  })

  it('leaves a log that already has a speed channel alone', () => {
    const s = build(
      ['VSS', 'VelNorth', 'VelEast'],
      [
        [30, 31],
        [3, 6],
        [4, 8],
      ],
    )
    expect(s.byId.has(GPS_SPEED)).toBe(false)
    expect(s.channels).toHaveLength(3)
    expect(build(['RPM', 'VelNorth'], [[1], [2]]).byId.has(GPS_SPEED)).toBe(false)
  })
})
