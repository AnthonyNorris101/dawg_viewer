import { describe, expect, it } from 'vitest'
import {
  cleanTorque,
  DEFAULT_CAR,
  forProfile,
  hasTorqueCurve,
  PLACEHOLDER_TORQUE,
  stockKeys,
  withDefaults,
} from './car'
import { DEFAULT_SIM, validSim } from '../state/sim'

describe('car specs', () => {
  it('fills what the profile lacks from the stock car, then from typical values', () => {
    const stock = {
      mass: 277,
      redline: 13000,
      torque: [
        [4000, 15],
        [9500, 47.7],
      ],
      tire: { pcy1: 1.47938 },
    } as never
    const car = withDefaults({ mass: 300, gears: [] } as never, stock)
    expect(car.mass).toBe(300)
    expect(car.redline).toBe(13000)
    expect(car.wheelbase).toBe(DEFAULT_CAR.wheelbase)
    expect(car.gears).toEqual(DEFAULT_CAR.gears)
    expect(hasTorqueCurve(car)).toBe(true)
    expect(car.tire).toEqual({ pcy1: 1.47938 })
    expect([...stockKeys({ mass: 300 } as never, stock)].sort()).toEqual([
      'redline',
      'tire',
      'torque',
    ])
    expect(stockKeys({ mass: 300 } as never, null).size).toBe(0)

    const base = withDefaults(null, stock)
    const untouched = forProfile(car, base, { mass: 300 } as never)
    expect(untouched.mass).toBe(300)
    expect(untouched.redline).toBe(0)
    expect(untouched.wheelbase).toBe(0)
    expect(untouched.torque).toEqual([])
    expect(untouched.tire).toEqual({})
    expect(untouched.gears).toEqual([])
    const changed = forProfile({ ...car, redline: 12500 }, base, { mass: 300 } as never)
    expect(changed.redline).toBe(12500)
  })

  it('uses the stand-in torque curve until the profile has a real one', () => {
    const empty = withDefaults({ mass: 300, torque: null } as never)
    expect(empty.mass).toBe(300)
    expect(empty.torque).toBe(PLACEHOLDER_TORQUE)
    expect(hasTorqueCurve(empty)).toBe(false)
    expect(forProfile(empty).torque).toEqual([])
    const real = withDefaults({
      torque: [
        [9000, 55],
        [4000, 40],
        [4000, 41],
      ],
    } as never)
    expect(real.torque).toEqual([
      [4000, 41],
      [9000, 55],
    ])
    expect(hasTorqueCurve(real)).toBe(true)
    expect(forProfile(real).torque).toEqual(real.torque)
    expect(withDefaults({ torque: [[5000, 40]] } as never).torque).toBe(PLACEHOLDER_TORQUE)
  })

  it('drops torque points that cannot be used and keeps typical values for missing specs', () => {
    expect(cleanTorque([[0, 5], [3000, -1], ['x', 2], [6000, 50], null, [5000, 45]])).toEqual([
      [5000, 45],
      [6000, 50],
    ])
    expect(cleanTorque('nope')).toEqual([])
    const car = withDefaults({ springFront: 50, arbFront: 0, tireLoadGrip: 0 } as never)
    expect(car.springFront).toBe(50)
    expect(car.arbFront).toBe(0)
    expect(car.tireLoadGrip).toBe(DEFAULT_CAR.tireLoadGrip)
    expect(car.gears).toEqual(DEFAULT_CAR.gears)
  })

  it('only restores simulator settings that make sense', () => {
    expect(validSim(DEFAULT_SIM)).toBe(true)
    expect(validSim({ ...DEFAULT_SIM, overrides: { mass: 250 } })).toBe(true)
    expect(validSim({ ...DEFAULT_SIM, overrides: { mass: 'heavy' } })).toBe(false)
    expect(validSim({ ...DEFAULT_SIM, section: 'nope' })).toBe(false)
    expect(validSim({ ...DEFAULT_SIM, smooth: -1 })).toBe(false)
    expect(validSim({ ...DEFAULT_SIM, sweepFrom: 'a' })).toBe(false)
    const old: Record<string, unknown> = { ...DEFAULT_SIM }
    delete old.channels
    expect(validSim(old)).toBe(false)
  })
})
