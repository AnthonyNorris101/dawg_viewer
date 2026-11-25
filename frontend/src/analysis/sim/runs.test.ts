import { describe, expect, it } from 'vitest'
import { DEFAULT_CAR, type CarSpecs } from '../../data/car'
import { correlate, torqueFromLog } from './fromlog'
import { buildLimits, G, resistance, tractionForce } from './grip'
import { LIMIT, simulateLap, skidpadTime } from './lapsim'
import { shiftPoints, torqueAt } from './powertrain'
import {
  parseSegments,
  segmentsTrack,
  skidpadTrack,
  SKIDPAD_RADIUS,
  straightTrack,
  trackFromLog,
  type SimTrack,
} from './simtrack'
import { RUN_LIMIT, simulateRun } from './straight'

const car = DEFAULT_CAR

describe('straight-line run', () => {
  it('launches at the traction limit, then follows the engine through the gears', () => {
    const run = simulateRun(car)
    expect(run.finished).toBe(true)
    expect(run.distance).toBe(75)
    expect(run.time).toBeCloseTo(run.time75m, 6)
    expect(run.time75m).toBeGreaterThan(3.7)
    expect(run.time75m).toBeLessThan(4.6)
    expect(run.time60).toBeGreaterThan(1.2)
    expect(run.time60).toBeLessThan(run.time75m)
    expect(run.limit[0]).toBe(RUN_LIMIT.traction)
    expect(run.peakG).toBeCloseTo((tractionForce(car, 0) - resistance(car, 0)) / (car.mass * G), 2)
    expect(run.limit[run.limit.length - 1]).toBe(RUN_LIMIT.power)
    expect(run.shifts.length).toBeGreaterThanOrEqual(2)
    expect([...run.gear].every((g, i, a) => i === 0 || g >= a[i - 1])).toBe(true)
    for (let i = 1; i < run.v.length; i++) expect(run.s[i]).toBeGreaterThan(run.s[i - 1])
  })

  it('obeys constant force and gets slower with weight, drag and long shifts', () => {
    const flat: CarSpecs = {
      ...car,
      torque: [
        [1000, 50],
        [14000, 50],
      ],
      gears: [2],
      launchGear: 1,
      tireMu: 5,
      rollRes: 0,
      tireLoadGrip: 1,
    }
    const force = (50 * flat.primary * 2 * flat.finalDrive * flat.driveEff) / flat.tireRadius
    const run = simulateRun(flat, { distance: 20 })
    expect(run.time).toBeCloseTo(Math.sqrt((2 * 20 * flat.mass) / force), 3)
    const base = simulateRun(car).time75m
    expect(simulateRun({ ...car, mass: 320 }).time75m).toBeGreaterThan(base)
    expect(simulateRun({ ...car, cdA: 1.5 }).time75m).toBeGreaterThan(base)
    expect(simulateRun({ ...car, shiftTime: 0.3 }).time75m).toBeGreaterThan(base + 0.1)
    expect(simulateRun({ ...car, tireMu: 1.2 }).time60).toBeGreaterThan(simulateRun(car).time60)
    expect(simulateRun(car, { distance: 20 }).time75m).toBeNaN()
  })
})

describe('lap simulation', () => {
  const lim = buildLimits(car)

  it('holds the cornering limit around the skidpad', () => {
    const lap = simulateLap(car, skidpadTrack(), lim)
    const pad = skidpadTime(lim, SKIDPAD_RADIUS)
    expect(lap.time).toBeCloseTo(pad.time, 2)
    expect(lap.vMax).toBeCloseTo(lap.vMin, 1)
    expect(Math.abs(lap.ay[10])).toBeCloseTo(pad.g, 2)
    expect(lap.share[LIMIT.corner]).toBeCloseTo(1, 6)
    expect(pad.time).toBeGreaterThan(4.6)
    expect(pad.time).toBeLessThan(5.6)
  })

  it('agrees with the time-stepped run on a straight', () => {
    const lap = simulateLap(car, straightTrack(), lim)
    const run = simulateRun(car)
    expect(lap.time).toBeGreaterThan(run.time75m * 0.98)
    expect(lap.time).toBeLessThan(run.time75m * 1.02)
    expect(lap.v[0]).toBe(0)
    expect(lap.limit[2]).toBe(LIMIT.traction)
  })

  const oval = () => {
    const { segments, errors } = parseSegments(
      'straight 80\nleft 12 180deg   # hairpin\nS 80\nL 12 37.699',
    )
    expect(errors).toEqual([])
    return segmentsTrack(segments, { closed: true }) as SimTrack
  }

  it('brakes for corners, never exceeds the limits and repeats lap after lap', () => {
    const track = oval()
    expect(track.length).toBeCloseTo(160 + 2 * Math.PI * 12, 3)
    const lap = simulateLap(car, track, lim)
    const n = lap.s.length
    for (let i = 0; i < n; i++) {
      const latMax = lim.lat[Math.round(lap.v[i] / lim.dv)] / G
      expect(Math.abs(lap.ay[i])).toBeLessThanOrEqual(latMax * 1.02)
      expect(lap.ax[i]).toBeLessThan(1.3)
      expect(lap.ax[i]).toBeGreaterThan(-2)
    }
    expect(lap.share.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6)
    expect(lap.share[LIMIT.brake]).toBeGreaterThan(0.05)
    expect(lap.share[LIMIT.corner]).toBeGreaterThan(0.2)
    expect(lap.share[LIMIT.power] + lap.share[LIMIT.traction]).toBeGreaterThan(0.15)
    expect(Math.abs(lap.v[0] - lap.v[n - 1])).toBeLessThan(1)
    expect(lap.vMin).toBeCloseTo(Math.sqrt(lim.lat[Math.round(lap.vMin / lim.dv)] * 12), 0)
    const faster = simulateLap({ ...car, tireMu: 1.7 }, track)
    expect(faster.time).toBeLessThan(lap.time)
    const open = simulateLap(car, { ...track, closed: false, standing: true }, lim)
    expect(open.v[0]).toBe(0)
    expect(open.time).toBeGreaterThan(lap.time)
  })

  it('settles in a gear when a long corner holds the car near a shift point', () => {
    const shift = shiftPoints(car)[2].speed
    for (const factor of [0.97, 1.0, 1.03]) {
      const v = shift * factor
      const radius = (v * v) / lim.lat[Math.round(v / lim.dv)]
      const lap = simulateLap(car, skidpadTrack(radius, 1), lim)
      expect(lap.share[LIMIT.shift]).toBeLessThan(0.02)
      expect(lap.vMin).toBeGreaterThan(v * 0.97)
    }
  })

  it('reports what is wrong with a hand-written track', () => {
    const { segments, errors } = parseSegments('straight\nup 10\nleft 10\nright 15 20m')
    expect(segments).toEqual([{ length: 20, radius: -15 }])
    expect(errors).toHaveLength(3)
    expect(errors[1]).toContain('"up"')
    expect(segmentsTrack([])).toBeNull()
  })

  const eased = () => {
    const half = 'straight 60\nL 48 5\nL 24 5\nL 16 5\nL 12 22.699\nL 16 5\nL 24 5\nL 48 5\n'
    return segmentsTrack(parseSegments(half + half).segments, { closed: true }) as SimTrack
  }

  function logOf(track: SimTrack, pace: number, gpsNoise = 0) {
    const lap = simulateLap(car, track, lim)
    const dt = 0.01
    const time: number[] = []
    const distance: number[] = []
    const speed: number[] = []
    const latG: number[] = []
    const lat: number[] = []
    const lon: number[] = []
    let s = 0
    let j = 0
    let seed = 7
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 2
    for (let i = 0; s < track.length - 0.5; i++) {
      while (j < lap.s.length - 2 && lap.s[j + 1] <= s) j++
      const f = Math.min(1, (s - lap.s[j]) / (lap.s[j + 1] - lap.s[j]))
      const v = (lap.v[j] + (lap.v[j + 1] - lap.v[j]) * f) * pace
      const k = track.k[j] + (track.k[j + 1] - track.k[j]) * f
      const x = track.x[j] + (track.x[j + 1] - track.x[j]) * f
      const y = track.y[j] + (track.y[j + 1] - track.y[j]) * f
      time.push(i * dt)
      distance.push(s)
      speed.push(v)
      latG.push((v * v * k) / G)
      lat.push(33.9 + (y + rnd() * gpsNoise) / 111194.9)
      lon.push(-83.4 + (x + rnd() * gpsNoise) / (111194.9 * Math.cos((33.9 * Math.PI) / 180)))
      s += v * dt
    }
    return {
      lap,
      realTime: time.length * dt,
      inp: {
        time: Float64Array.from(time),
        distance: Float64Array.from(distance),
        speed: Float64Array.from(speed),
        latG: Float64Array.from(latG),
        gps: { lat, lon },
      },
    }
  }

  it('rebuilds a track from logged lateral g and speed, and from GPS', () => {
    const track = eased()
    const { lap, inp } = logOf(track, 1)
    const end = inp.time.length - 1
    const fromAccel = trackFromLog(inp, 0, end, { closed: true }) as SimTrack
    expect(Math.abs(fromAccel.length - track.length)).toBeLessThan(1.5)
    expect(fromAccel.origin?.lat).toBeCloseTo(33.9, 3)
    const again = simulateLap(car, fromAccel, lim)
    expect(Math.abs(again.time - lap.time) / lap.time).toBeLessThan(0.02)
    const fromGps = trackFromLog({ ...inp, latG: null }, 0, end, {
      closed: true,
      source: 'gps',
    }) as SimTrack
    const viaGps = simulateLap(car, fromGps, lim)
    expect(Math.abs(viaGps.time - lap.time) / lap.time).toBeLessThan(0.03)
    const flipped = { ...inp, latG: Float64Array.from(inp.latG, (v) => -v) }
    const mirrored = trackFromLog(flipped, 0, end, { closed: true, source: 'gps' }) as SimTrack
    expect(Math.sign(mirrored.k[100])).toBe(-Math.sign(fromGps.k[100]))
    expect(trackFromLog({ ...inp, latG: null, gps: null }, 0, end)).toBeNull()
    expect(trackFromLog(inp, 0, 10)).toBeNull()
  })

  it('measures how far a slower real lap is from the simulated one, and where', () => {
    const track = eased()
    const { inp, realTime } = logOf(track, 0.95)
    const end = inp.time.length - 1
    const rebuilt = trackFromLog(inp, 0, end, { closed: true }) as SimTrack
    const sim = simulateLap(car, rebuilt, lim)
    const c = correlate(inp.distance, inp.speed, realTime, sim)!
    expect(c.gap).toBeGreaterThan(0)
    expect(c.gap / realTime).toBeGreaterThan(0.02)
    expect(c.gap / realTime).toBeLessThan(0.12)
    expect(c.bias).toBeLessThan(0)
    expect(c.r2).toBeGreaterThan(0.8)
    expect(c.loss.reduce((a, b) => a + b, 0)).toBeCloseTo(c.delta[c.delta.length - 1], 1)
    expect(c.atLimit).toBeLessThan(0.6)
    const same = correlate(sim.s, sim.v, sim.time, sim)!
    expect(same.rms).toBeCloseTo(0, 6)
    expect(same.atLimit).toBe(1)
  })

  it('recovers the torque curve from a full-throttle run', () => {
    const run = simulateRun(car, { distance: 400, maxTime: 40 })
    const est = torqueFromLog({ time: run.t, rpm: run.rpm, speed: run.v, accelG: run.ax }, car)!
    expect(est.points.length).toBeGreaterThan(8)
    expect(est.gears.length).toBeGreaterThanOrEqual(3)
    for (const [rpm, nm] of est.points) expect(nm / torqueAt(car.torque, rpm)).toBeCloseTo(1, 1)
    const noAccel = torqueFromLog({ time: run.t, rpm: run.rpm, speed: run.v }, car)!
    expect(noAccel.points.length).toBeGreaterThan(8)
    for (const [rpm, nm] of noAccel.points) expect(nm / torqueAt(car.torque, rpm)).toBeCloseTo(1, 1)
    const idle = { time: run.t, rpm: run.rpm.map(() => 3000), speed: run.v.map(() => 0) }
    expect(torqueFromLog(idle, car)).toBeNull()
  })
})
