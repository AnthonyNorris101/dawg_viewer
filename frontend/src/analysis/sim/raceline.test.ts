import { describe, expect, it } from 'vitest'
import { DEFAULT_CAR } from '../../data/car'
import { buildLimits } from './grip'
import { simulateLap } from './lapsim'
import { fromLatLon, idealLine, racingLine, trackFromPath } from './raceline'
import { parseSegments, segmentsTrack } from './simtrack'

const oval = (closed = true) => {
  const { segments } = parseSegments('straight 60\nleft 12 180deg\nstraight 60\nleft 12 180deg')
  return segmentsTrack(segments, { closed })!
}

describe('racing line', () => {
  it('rebuilds a track from a drawn path with the right length and curvature', () => {
    const n = 200
    const x = Array.from({ length: n }, (_, i) => 30 * Math.cos((2 * Math.PI * i) / n))
    const y = Array.from({ length: n }, (_, i) => 30 * Math.sin((2 * Math.PI * i) / n))
    const t = trackFromPath('circle', x, y, { closed: true })!
    expect(t.length / (2 * Math.PI * 30)).toBeCloseTo(1, 2)
    expect(t.k[10]).toBeCloseTo(1 / 30, 3)
    expect(t.k[t.k.length >> 1]).toBeCloseTo(1 / 30, 3)
    const right = trackFromPath(
      'cw',
      x,
      y.map((v) => -v),
      { closed: true },
    )!
    expect(right.k[10]).toBeCloseTo(-1 / 30, 3)
  })

  it('smooths a path recorded by GPS before reading corner radii off it', () => {
    const n = 250
    let seed = 7
    const noise = () => {
      seed = (seed * 16807) % 2147483647
      return (seed / 2147483647 - 0.5) * 0.06
    }
    const x = Array.from({ length: n }, (_, i) => 40 * Math.cos((2 * Math.PI * i) / n) + noise())
    const y = Array.from({ length: n }, (_, i) => 40 * Math.sin((2 * Math.PI * i) / n) + noise())
    const spread = (k: Float64Array) => {
      const mean = k.reduce((a, v) => a + v, 0) / k.length
      return Math.sqrt(k.reduce((a, v) => a + (v - mean) ** 2, 0) / k.length)
    }
    const raw = trackFromPath('raw', x, y, { closed: true, smooth: 0 })!
    const clean = trackFromPath('clean', x, y, { closed: true, smoothM: 3 })!
    expect(spread(raw.k)).toBeGreaterThan(0.004)
    expect(spread(clean.k)).toBeLessThan(spread(raw.k) / 5)
    expect(clean.k.reduce((a, v) => a + v, 0) / clean.k.length).toBeCloseTo(1 / 40, 3)
    expect(clean.length / (2 * Math.PI * 40)).toBeCloseTo(1, 2)
  })

  it('rounds a coarse outline into smooth corners', () => {
    const n = 24
    const lat = Array.from(
      { length: n },
      (_, i) => 33 + (80 * Math.sin((2 * Math.PI * i) / n)) / 111195,
    )
    const lon = Array.from(
      { length: n },
      (_, i) =>
        -84 + (80 * Math.cos((2 * Math.PI * i) / n)) / (111195 * Math.cos((33 * Math.PI) / 180)),
    )
    const g = fromLatLon(lat, lon)
    expect(g.origin).toEqual({ lat: lat[0], lon: lon[0] })
    const t = trackFromPath('geo', g.x, g.y, { closed: true, origin: g.origin })!
    expect(t.length / (2 * Math.PI * 80)).toBeCloseTo(1, 1)
    const k = Array.from(t.k)
    expect(Math.max(...k)).toBeLessThan(1.25 / 80)
    expect(Math.min(...k)).toBeGreaterThan(0.75 / 80)
    expect(t.origin).toEqual(g.origin)
  })

  it('spreads the cornering out within the room it is given and is faster', () => {
    const track = oval()
    const lim = buildLimits(DEFAULT_CAR)
    const line = racingLine(track, 1.8)!
    const effort = (t: typeof track) => (t.k.reduce((a, v) => a + v * v, 0) * t.length) / t.k.length
    expect(effort(line.track)).toBeLessThan(effort(track) * 0.85)
    expect(Math.max(...Array.from(line.offset, Math.abs))).toBeCloseTo(1.8, 3)
    expect(line.along.length).toBe(line.track.s.length)
    expect(line.along[line.along.length - 1]).toBeGreaterThan(track.length - 2)
    expect(line.track.length).toBeLessThan(track.length)
    const base = simulateLap(DEFAULT_CAR, track, lim).time
    const same = simulateLap(DEFAULT_CAR, line.centre, lim).time
    expect(Math.abs(same / base - 1)).toBeLessThan(0.02)
    const t = simulateLap(DEFAULT_CAR, line.track, lim).time
    expect(t).toBeLessThan(base * 0.97)
    expect(t).toBeGreaterThan(base * 0.8)
    expect(racingLine(track, 0)).toBeNull()
  })

  it('picks the fastest of the candidate lines', () => {
    const track = oval()
    const lim = buildLimits(DEFAULT_CAR)
    const timeOf = (t: typeof track) => simulateLap(DEFAULT_CAR, t, lim).time
    const best = idealLine(track, 1.8, timeOf)!
    expect(best.tried.length).toBeGreaterThan(2)
    expect(best.time).toBe(Math.min(...best.tried.map((c) => c.time)))
    expect(best.time).toBeLessThanOrEqual(timeOf(racingLine(track, 1.8)!.track))
    const short = best.tried[best.tried.length - 1]
    expect(short.length).toBeLessThan(best.tried[0].length)
  })

  it('keeps the start on the centreline of an open track', () => {
    const track = oval(false)
    const line = racingLine(track, 1.5)!
    expect(line.offset[0]).toBe(0)
    expect(line.track.closed).toBe(false)
    expect(line.track.standing).toBe(true)
    expect(Math.max(...Array.from(line.offset, Math.abs))).toBeGreaterThan(1)
  })

  it('handles a lap whose typed parts do not meet up', () => {
    const { segments } = parseSegments('straight 50\nleft 10 90deg\nstraight 50')
    const track = segmentsTrack(segments, { closed: true })!
    const line = racingLine(track, 1.5)!
    expect(line.track.closed).toBe(true)
    expect(line.track.length).toBeLessThan(track.length + 1)
    expect(line.track.length).toBeGreaterThan(track.length - 8)
    expect(Math.max(...Array.from(line.track.k, Math.abs))).toBeLessThan(0.12)
    expect(line.offset[0]).toBe(0)
    expect(line.offset[line.offset.length - 1]).toBeCloseTo(0, 6)
  })
})
