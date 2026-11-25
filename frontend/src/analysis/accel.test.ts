import { describe, expect, it } from 'vitest'
import {
  accelAxes,
  accelInG,
  cleanAccel,
  G0,
  headingFromPosition,
  HINTS,
  LAT_G,
  LONG_G,
  smoothG,
  VERT_G,
} from './accel'

const RATE = 50
const N = 3000

function noisy(real: (t: number) => number, noise: number): Float64Array {
  let seed = 7
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648 - 0.5
  }
  return Float64Array.from({ length: N }, (_, i) => real(i / RATE) * G0 + noise * 2 * rand() * G0)
}

const peak = (a: ArrayLike<number>) => {
  let m = 0
  for (let i = 100; i < a.length - 100; i++) m = Math.max(m, Math.abs(a[i]))
  return m
}

describe('clean accelerometer channels', () => {
  const corner = (t: number) => 1.5 * Math.sin(2 * Math.PI * 0.2 * t)
  const speed = Float64Array.from({ length: N }, (_, i) => 20 + 5 * Math.sin(i / RATE))
  const drive = (t: number) => -0.5 * Math.cos(t)
  const channels = [
    { name: 'AccelX', unit: '', data: noisy(drive, 0.5) },
    { name: 'AccelY', unit: '', data: noisy(corner, 0.5) },
    { name: 'AccelZ', unit: '', data: noisy(() => -1, 0.5) },
  ]

  it('recovers the real g from vibration-laden m/s² signals', () => {
    expect(peak(accelInG(channels[1]))).toBeGreaterThan(1.85)
    const out = cleanAccel(channels, RATE, speed)
    expect(out.map((c) => c.name)).toEqual([LAT_G, LONG_G, VERT_G])
    const lat = out[0].data
    expect(peak(lat)).toBeGreaterThan(1.4)
    expect(peak(lat)).toBeLessThan(1.8)
    let err = 0
    for (let i = 100; i < N - 100; i++) err = Math.max(err, Math.abs(lat[i] - corner(i / RATE)))
    expect(err).toBeLessThan(0.3)
  })

  it('makes forward acceleration and gravity positive', () => {
    const out = cleanAccel(channels, RATE, speed)
    const long = out[1].data
    let agree = 0
    for (let i = 1; i < N; i++) agree += long[i] * (speed[i] - speed[i - 1])
    expect(agree).toBeGreaterThan(0)
    const vert = out[2].data
    expect(vert[N >> 1]).toBeGreaterThan(0.8)
    expect(vert[N >> 1]).toBeLessThan(1.2)
  })

  it('keeps signals already in g, bridges gaps and leaves existing channels alone', () => {
    const inG = { name: 'AccelY', unit: 'g', data: Float64Array.from({ length: N }, () => 1.2) }
    expect(accelInG(inG)).toBe(inG.data)
    const gap = Float64Array.from({ length: 200 }, (_, i) => (i % 7 === 0 ? NaN : 1))
    expect(smoothG(gap, RATE).every(Number.isFinite)).toBe(true)
    const have = [...channels, { name: LAT_G, unit: 'g', data: new Float64Array(N) }]
    expect(cleanAccel(have, RATE, speed).map((c) => c.name)).toEqual([LONG_G, VERT_G])
    expect(cleanAccel(channels, 3, speed)).toEqual([])
  })
  it('works out which way each axis points from speed and heading', () => {
    const v = 15
    const omega = (t: number) => 0.6 * Math.sin(2 * Math.PI * 0.1 * t)
    let h = 0
    const north = new Float64Array(N)
    const east = new Float64Array(N)
    const lat = new Float64Array(N)
    const lon = new Float64Array(N)
    let x = 0
    let y = 0
    for (let i = 0; i < N; i++) {
      north[i] = v * Math.cos(h)
      east[i] = v * Math.sin(h)
      lat[i] = 33 + y / 111320
      lon[i] = -84 + x / (111320 * Math.cos((33 * Math.PI) / 180))
      y += north[i] / RATE
      x += east[i] / RATE
      h += omega(i / RATE) / RATE
    }
    const speedUp = Float64Array.from({ length: N }, (_, i) => 20 + 5 * Math.sin(i / RATE))
    const sensor = [
      { name: 'AccelX', unit: 'm/s²', data: noisy((t) => -0.5 * Math.cos(t), 0.3) },
      { name: 'AccelY', unit: 'm/s²', data: noisy((t) => (v * omega(t)) / G0, 0.3) },
      { name: 'AccelZ', unit: 'm/s²', data: noisy(() => -1, 0.3) },
    ]
    for (const heading of [{ north, east }, headingFromPosition(lat, lon, RATE)]) {
      const axes = accelAxes(sensor, RATE, speedUp, heading)
      expect(axes.raw).toEqual([
        { name: 'AccelY', hint: HINTS.right },
        { name: 'AccelX', hint: HINTS.longReversed },
        { name: 'AccelZ', hint: HINTS.zDown },
      ])
      const latG = axes.clean.find((c) => c.name === LAT_G)
      expect(latG?.hint).toBe(HINTS.right)
      const turningRight = Math.round(2.5 * RATE)
      expect(omega(turningRight / RATE)).toBeGreaterThan(0)
      expect(latG?.data[turningRight]).toBeGreaterThan(0.5)
      expect(axes.clean.find((c) => c.name === LONG_G)?.hint).toBe(HINTS.long)
    }
    const unknown = accelAxes(sensor, RATE, null, null)
    expect(unknown.raw).toEqual([{ name: 'AccelZ', hint: HINTS.zDown }])
    expect(unknown.clean.find((c) => c.name === LAT_G)?.hint).toBeUndefined()
  })
})
