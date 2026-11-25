import { describe, expect, it } from 'vitest'
import { DEFAULT_CAR, tractionLimitG, type CarSpecs } from '../../data/car'
import { brakeForce, buildLimits, cornering, G, resistance, sample, tractionForce } from './grip'
import { suspension } from './suspension'
import { paramOf, sweepRange, sweepValues, withOverrides } from './sweep'

const SAME_PEAK = { pky1: 12000, pky2: 1000 }
const rigid: CarSpecs = { ...DEFAULT_CAR, tireLoadGrip: 1, rollRes: 0, tire: SAME_PEAK }

describe('grip limits', () => {
  it('matches the hand formulas when tires have no load sensitivity', () => {
    expect(cornering(rigid, 0).ay / G).toBeCloseTo(1.5, 4)
    expect(tractionForce(rigid, 0) / (rigid.mass * G)).toBeCloseTo(tractionLimitG(rigid), 4)
    expect(brakeForce(rigid, 0) / (rigid.mass * G)).toBeCloseTo(1.5, 4)
    const split = { ...rigid, tireMuLat: 1.7 }
    expect(cornering(split, 0).ay / G).toBeCloseTo(1.7, 4)
    expect(brakeForce(split, 0) / (split.mass * G)).toBeCloseTo(1.5, 4)
  })

  it('loses a little when the two tires on an axle peak at different slip angles', () => {
    const real = cornering({ ...rigid, tire: {} }, 0).ay / G
    expect(real).toBeLessThan(1.5)
    expect(real).toBeGreaterThan(1.46)
  })

  it('adds grip with downforce and loses it with load sensitivity', () => {
    const winged = { ...rigid, clA: 3, cdA: 1.4, aeroFront: 1 - rigid.rearWeight }
    const v = 20
    const down = 0.5 * 1.2 * 3 * v * v
    expect(cornering(winged, v).ay / G).toBeCloseTo(1.5 * (1 + down / (winged.mass * G)), 3)
    expect(resistance(winged, v)).toBeCloseTo(0.5 * 1.2 * 1.4 * v * v)
    expect(cornering(DEFAULT_CAR, 0).ay).toBeLessThan(cornering(rigid, 0).ay)
    expect(tractionForce(DEFAULT_CAR, 0)).toBeLessThan(tractionForce(rigid, 0))
    const noseHeavy = cornering({ ...winged, aeroFront: 0.2 }, 25)
    expect(noseHeavy.frontUse).toBeCloseTo(1, 3)
    expect(noseHeavy.rearUse).toBeLessThan(0.95)
  })

  it('tabulates the limits over speed and finds top speed', () => {
    const car = { ...DEFAULT_CAR, cdA: 1.2 }
    const lim = buildLimits(car)
    expect(sample(lim.lat, lim.dv, 0)).toBeCloseTo(cornering(car, 0).ay)
    expect(sample(lim.resist, lim.dv, 10.1)).toBeCloseTo(resistance(car, 10.1), 0)
    expect(sample(lim.drive, lim.dv, lim.vTop - 0.5)).toBeGreaterThan(
      resistance(car, lim.vTop - 0.5),
    )
    expect(sample(lim.drive, lim.dv, lim.vTop + 0.5)).toBeLessThan(resistance(car, lim.vTop + 0.5))
    expect(buildLimits(DEFAULT_CAR).vTop * 3.6).toBeCloseTo(158.7, 0)
  })
})

describe('suspension', () => {
  it('works out rates, frequencies and roll from the springs', () => {
    const s = suspension(DEFAULT_CAR)
    expect(s.wheelRateF).toBeCloseTo(35 * 0.81)
    expect(s.rideRateF).toBeCloseTo((28.35 * 110) / 138.35)
    expect(s.freqF).toBeCloseTo(Math.sqrt(22540.66 / 56.25) / (2 * Math.PI), 3)
    expect(s.sprungMass).toBe(252)
    expect(s.rollGradient).toBeGreaterThan(1.2)
    expect(s.rollGradient).toBeLessThan(1.45)
    const car = DEFAULT_CAR
    const moment = s.transferF * car.trackFront + s.transferR * car.trackRear
    expect(moment).toBeCloseTo(car.mass * car.cgHeight, 6)
  })

  it('moves load transfer and the limiting axle with an anti-roll bar', () => {
    const base = suspension(DEFAULT_CAR)
    const front = { ...DEFAULT_CAR, arbFront: 400 }
    const rear = { ...DEFAULT_CAR, arbRear: 400 }
    expect(suspension(front).lltd).toBeGreaterThan(base.lltd + 0.08)
    expect(suspension(rear).lltd).toBeLessThan(base.lltd - 0.08)
    expect(suspension(front).rollGradient).toBeLessThan(base.rollGradient * 0.85)
    expect(cornering(front, 10).frontUse).toBeCloseTo(1, 3)
    expect(cornering(rear, 10).rearUse).toBeCloseTo(1, 3)
    expect(cornering(rear, 10).frontUse).toBeLessThan(cornering(DEFAULT_CAR, 10).frontUse)
    const noSens = { ...front, tireLoadGrip: 1, tire: SAME_PEAK }
    expect(cornering(noSens, 10).ay).toBeCloseTo(
      cornering({ ...DEFAULT_CAR, tireLoadGrip: 1, tire: SAME_PEAK }, 10).ay,
      4,
    )
  })
})

describe('what-if values', () => {
  it('applies overrides by parameter and scales the torque curve', () => {
    const car = withOverrides(DEFAULT_CAR, { mass: 250, rearWeight: 50, power: 110, nonsense: 3 })
    expect(car.mass).toBe(250)
    expect(car.rearWeight).toBeCloseTo(0.5)
    expect(car.torque[5][1]).toBeCloseTo(DEFAULT_CAR.torque[5][1] * 1.1)
    expect(DEFAULT_CAR.mass).toBe(290)
    expect(paramOf('rearWeight')?.get(DEFAULT_CAR)).toBeCloseTo(55)
    expect(sweepValues(2, 4, 5)).toEqual([2, 2.5, 3, 3.5, 4])
    expect(sweepRange(paramOf('arbFront')!, DEFAULT_CAR)).toEqual([0, 500])
    const [lo, hi] = sweepRange(paramOf('finalDrive')!, DEFAULT_CAR)
    expect(lo).toBeLessThan(3.08)
    expect(hi).toBeGreaterThan(3.08)
  })
})
