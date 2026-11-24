import { describe, expect, it } from 'vitest'
import { findLaunches, manualLaunch } from './launch'

function run() {
  const time: number[] = []
  const ground: number[] = []
  const accel: number[] = []
  let v = 0
  for (let i = 0; i < 3000; i++) {
    const t = i / 100
    const a = t >= 10 && t < 16 ? 9 : 0
    v += a / 100
    if (t >= 16) v = Math.max(0, v - 0.2)
    time.push(t)
    ground.push(v)
    accel.push(a / 9.80665)
  }
  return { time, ground, accel, window: 4 }
}

describe('launches', () => {
  it('finds a standing start on its own', () => {
    const found = findLaunches(run())
    expect(found).toHaveLength(1)
    expect(found[0].t0).toBeCloseTo(9.99, 1)
    expect(found[0].peakG).toBeCloseTo(0.92, 2)
  })

  it('measures a launch between times you give', () => {
    const l = manualLaunch(run(), 10, 14)!
    expect(l.manual).toBe(true)
    expect(l.t0).toBeCloseTo(10, 5)
    expect(l.time60).toBeCloseTo(60 / 3.6 / 9, 1)
    expect(l.meanG1s).toBeCloseTo(0.92, 2)
    expect(manualLaunch(run(), 14, 10)).toBeNull()
  })
})
