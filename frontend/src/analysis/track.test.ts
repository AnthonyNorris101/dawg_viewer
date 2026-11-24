import { describe, expect, it } from 'vitest'
import type { Channel } from '../data/session'
import { fusePosition } from './fusion'
import { buildOverlay } from './overlay'
import {
  beaconCrossings,
  buildLaps,
  buildRuns,
  cumulativeDistance,
  findGps,
  formatLapTime,
  haversine,
  pairGates,
  runEnd,
} from './track'

const chan = (name: string, data: number[], unit = ''): Channel => ({
  id: name,
  name,
  group: 'Log',
  unit,
  color: '#fff',
  precision: 2,
  data: new Float64Array(data),
})

function circuit(laps: number, lapSeconds: number[]) {
  const lat0 = 33.948
  const lon0 = -83.377
  const r = 50
  const time: number[] = []
  const lat: number[] = []
  const lon: number[] = []
  let t = 0
  const k = 1 / 111320
  for (let l = 0; l < laps; l++) {
    const steps = lapSeconds[l] * 10
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * 2 * Math.PI
      time.push(t)
      lat.push(lat0 + r * Math.sin(a) * k)
      lon.push(lon0 + (r * (1 - Math.cos(a)) * k) / Math.cos((lat0 * Math.PI) / 180))
      t += 0.1
    }
  }
  return { time: new Float64Array(time), lat, lon, start: { lat: lat0, lon: lon0 } }
}

describe('track analysis', () => {
  it('measures distance on the Earth', () => {
    expect(haversine(0, 0, 0, 1)).toBeCloseTo(111195, -1)
  })

  it('finds GPS channels and ignores empty fixes', () => {
    expect(
      findGps([chan('PosLat', new Array(100).fill(0)), chan('PosLong', new Array(100).fill(0))]),
    ).toBeNull()
    const c = circuit(1, [10])
    expect(findGps([chan('PosLat', c.lat), chan('PosLong', c.lon)])?.latId).toBe('PosLat')
  })

  it('times laps from a start/finish beacon', () => {
    const c = circuit(4, [20, 18, 19, 20])
    const channels = [chan('PosLat', c.lat), chan('PosLong', c.lon)]
    const gps = findGps(channels)!
    const crossings = beaconCrossings(c.time, gps, c.start, 5, 5)
    expect(crossings.length).toBe(5)
    const distance = cumulativeDistance(c.time, channels, { kind: 'gps' }, gps)!
    expect(distance[distance.length - 1]).toBeGreaterThan(4 * 2 * Math.PI * 50 * 0.97)
    const laps = buildLaps(c.time, distance, crossings)
    expect(laps.map((l) => l.label)).toEqual(['Out', '1', '2', 'In'])
    expect(laps[1].time).toBeCloseTo(18, 0)
    expect(laps[1].distance).toBeCloseTo(2 * Math.PI * 50, -1)
  })

  it('integrates a speed channel for distance', () => {
    const time = new Float64Array([0, 1, 2, 3])
    const d = cumulativeDistance(
      time,
      [chan('VSS', [36, 36, 36, 36], 'km/h')],
      {
        kind: 'speed',
        channelId: 'VSS',
        unit: 'km/h',
      },
      null,
    )!
    expect([...d]).toEqual([0, 10, 20, 30])
  })

  it('formats lap times', () => {
    expect(formatLapTime(65.4321)).toBe('1:05.432')
    expect(formatLapTime(9.5)).toBe('9.500')
  })
})

describe('lap overlay', () => {
  it('lines laps up by distance and measures time slip', () => {
    const c = circuit(3, [20, 20, 25])
    const channels = [chan('PosLat', c.lat), chan('PosLong', c.lon)]
    const gps = findGps(channels)!
    const distance = cumulativeDistance(c.time, channels, { kind: 'gps' }, gps)!
    const laps = buildLaps(c.time, distance, [200, 400]).filter((l) => l.kind !== 'out')
    const ov = buildOverlay(c.time, distance, laps)!
    const slip = ov.timeSlip(1)
    const last = slip.filter((v) => v != null).pop()!
    expect(last).toBeGreaterThan(4)
    expect(last).toBeLessThan(6)
    expect(ov.sampleAt(0, 1)).toBe(laps[1].start)
  })
})

describe('GPS gap filling', () => {
  const lat0 = 33.948
  const lon0 = -83.377
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111195
  const ky = 111195

  function drive(holdFrom: number, holdTo: number) {
    const n = 3000
    const r = 40
    const v = 12
    const time = new Float64Array(n)
    const lat = new Float64Array(n)
    const lon = new Float64Array(n)
    const trueE = new Float64Array(n)
    const trueN = new Float64Array(n)
    const yaw = new Float64Array(n)
    const speed = new Float64Array(n).fill(v)
    let held = [0, 0]
    for (let i = 0; i < n; i++) {
      const t = i / 100
      const a = (v / r) * t
      time[i] = t
      trueE[i] = r * Math.sin(a)
      trueN[i] = r - r * Math.cos(a)
      yaw[i] = -((a * 180) / Math.PI) + 30
      if (i % 5 === 0 && !(t >= holdFrom && t < holdTo)) {
        held = [lat0 + trueN[i] / ky, lon0 + trueE[i] / kx]
      }
      lat[i] = held[0]
      lon[i] = held[1]
    }
    return { time, lat, lon, trueE, trueN, yaw, speed }
  }

  const worst = (
    d: ReturnType<typeof drive>,
    f: { lat: Float64Array; lon: Float64Array },
    from: number,
    to: number,
  ) => {
    let w = 0
    for (let i = from; i < to; i++) {
      const de = (f.lon[i] - lon0) * kx - d.trueE[i]
      const dn = (f.lat[i] - lat0) * ky - d.trueN[i]
      w = Math.max(w, Math.hypot(de, dn))
    }
    return w
  }

  it('rebuilds a dropout from speed and heading', () => {
    const d = drive(10, 13)
    const fused = fusePosition({ time: d.time, lat: d.lat, lon: d.lon, speed: d.speed, yaw: d.yaw })
    expect(fused.heading).toBe('yaw')
    expect(fused.gaps).toBe(1)
    expect(worst(d, fused, 1000, 1300)).toBeLessThan(1)
    const straight = fusePosition({ time: d.time, lat: d.lat, lon: d.lon })
    expect(straight.heading).toBe('none')
    expect(worst(d, straight, 1000, 1300)).toBeGreaterThan(3)
  })

  it('uses lateral acceleration when there is no heading channel', () => {
    const d = drive(10, 13)
    const latAccel = new Float64Array(d.time.length).fill(-(12 * 12) / 40 / 9.80665)
    const fused = fusePosition({ time: d.time, lat: d.lat, lon: d.lon, speed: d.speed, latAccel })
    expect(fused.heading).toBe('accel')
    expect(worst(d, fused, 1000, 1300)).toBeLessThan(1.5)
  })
})

describe('runs', () => {
  const time = Float64Array.from({ length: 101 }, (_, i) => i * 0.1)
  const distance = Float64Array.from(time, (t) => t * t * 5)

  it('pairs each start line crossing with the next finish crossing', () => {
    expect(pairGates([10, 50, 60, 90], [40, 55, 80])).toEqual([
      [10, 40],
      [50, 55],
      [60, 80],
    ])
    expect(pairGates([20, 30], [25])).toEqual([[20, 25]])
    expect(pairGates([], [5])).toEqual([])
  })

  it('ends a run after a set distance, or at its own end without one', () => {
    const i = runEnd(time, distance, 0, 100, 20)
    expect(distance[i]).toBeGreaterThanOrEqual(20)
    expect(distance[i - 1]).toBeLessThan(20)
    expect(runEnd(time, distance, 0, 70, 0)).toBe(70)
    expect(runEnd(time, null, 0, 70, 20)).toBe(70)
    expect(runEnd(time, distance, 50, 70, 1e6)).toBe(70)
  })

  it('numbers runs in order and drops overlaps', () => {
    const runs = buildRuns(time, distance, [
      [60, 80],
      [10, 30],
      [20, 40],
      [90, 90],
    ])
    expect(runs.map((r) => [r.label, r.start, r.end])).toEqual([
      ['1', 10, 30],
      ['2', 60, 80],
    ])
    expect(runs[0].time).toBeCloseTo(2)
    expect(runs[1].distance).toBeCloseTo(distance[80] - distance[60])
    expect(runs.every((r) => r.kind === 'lap')).toBe(true)
  })
})
