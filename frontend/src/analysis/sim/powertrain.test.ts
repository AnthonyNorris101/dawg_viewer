import { describe, expect, it } from 'vitest'
import { DEFAULT_CAR, speedAt, type CarSpecs } from '../../data/car'
import {
  bestGear,
  clutchRpm,
  kwOf,
  peaks,
  ratioOf,
  rpmAt,
  shiftPoints,
  torqueAt,
  wheelForce,
} from './powertrain'
import { parseTorqueCsv } from './torqueCsv'

const car: CarSpecs = {
  ...DEFAULT_CAR,
  torque: [
    [4000, 40],
    [8000, 60],
    [12000, 40],
  ],
  redline: 12000,
}

describe('powertrain', () => {
  it('reads the torque curve between and beyond its points', () => {
    expect(torqueAt(car.torque, 6000)).toBeCloseTo(50)
    expect(torqueAt(car.torque, 1000)).toBe(40)
    expect(torqueAt(car.torque, 20000)).toBe(40)
    expect(torqueAt([], 5000)).toBe(0)
    expect(kwOf(9549.3, 100)).toBeCloseTo(100, 2)
    const p = peaks(car)
    expect(p.torque).toEqual({ rpm: 8000, nm: 60 })
    expect(p.power.rpm).toBeGreaterThan(8000)
    expect(p.power.kw).toBeCloseTo(kwOf(p.power.rpm, torqueAt(car.torque, p.power.rpm)))
  })

  it('turns engine torque into force at the tire through the gearing', () => {
    const v = speedAt(car, 8000, 2)
    expect(rpmAt(car, v, 2)).toBeCloseTo(8000)
    expect(wheelForce(car, v, 2)).toBeCloseTo((60 * ratioOf(car, 2) * 0.9) / car.tireRadius)
    expect(wheelForce(car, speedAt(car, 12001, 2), 2)).toBe(0)
    expect(clutchRpm(car)).toBe(8000)
    expect(clutchRpm({ ...car, launchRpm: 9500 })).toBe(9500)
    expect(wheelForce(car, 0, 1, 8000)).toBeCloseTo((60 * ratioOf(car, 1) * 0.9) / car.tireRadius)
    expect(bestGear(car, speedAt(car, 11000, 1)).gear).toBe(1)
    expect(bestGear(car, speedAt(car, 12500, 1)).gear).toBe(2)
  })

  it('shifts where the next gear pulls harder, or at the redline', () => {
    const points = shiftPoints(car)
    expect(points).toHaveLength(5)
    for (const p of points) {
      expect(p.rpm).toBeLessThanOrEqual(12000)
      expect(p.rpmAfter).toBeLessThan(p.rpm)
      if (!p.atRedline) {
        const before = wheelForce(car, p.speed * 0.995, p.from)
        expect(before).toBeGreaterThanOrEqual(wheelForce(car, p.speed * 0.995, p.from + 1))
        expect(wheelForce(car, p.speed, p.from + 1)).toBeGreaterThan(
          wheelForce(car, p.speed, p.from),
        )
      }
    }
    const flat: CarSpecs = {
      ...car,
      torque: [
        [4000, 50],
        [12000, 50],
      ],
    }
    expect(shiftPoints(flat).every((p) => p.atRedline && Math.abs(p.rpm - 12000) < 1)).toBe(true)
  })

  it('imports dyno files in torque or power, metric or imperial', () => {
    const metric = parseTorqueCsv('RPM,Torque (Nm)\n4000,40\n8000,60\n12000,40\n')
    expect(metric).toMatchObject({
      points: [
        [4000, 40],
        [8000, 60],
        [12000, 40],
      ],
    })
    const imperial = parseTorqueCsv('Engine Speed;Torque lb-ft\n6000;40\n9000;42.5')
    expect(typeof imperial).toBe('object')
    if (typeof imperial === 'object') expect(imperial.points[1][1]).toBeCloseTo(57.62, 1)
    const power = parseTorqueCsv('rpm\tpower hp\n9549.3\t100\n5000\t50')
    if (typeof power !== 'object') throw new Error(power)
    expect(power.points[1]).toEqual([9549, 74.57])
    expect(power.note).toContain('power in hp')
    const bare = parseTorqueCsv('5000 45\n7000 55\n9000 58')
    if (typeof bare !== 'object') throw new Error(bare)
    expect(bare.points).toHaveLength(3)
    const dense = Array.from({ length: 900 }, (_, i) => `${3000 + i * 10},${50 + i / 100}`).join(
      '\n',
    )
    const thinned = parseTorqueCsv(`rpm,nm\n${dense}`)
    if (typeof thinned !== 'object') throw new Error(thinned)
    expect(thinned.points.length).toBeLessThanOrEqual(61)
    expect(thinned.points.length).toBeGreaterThan(30)
    expect(parseTorqueCsv('rpm,torque\nabc,def')).toMatch(/No usable rows/)
    expect(parseTorqueCsv('just one line')).toMatch(/at least two rows/)
    expect(parseTorqueCsv('time,temp\n1,2\n3,4')).toMatchObject({
      points: [
        [1, 2],
        [3, 4],
      ],
    })
  })
  it('does not shift early because of a dip in the torque curve', () => {
    const dyno: [number, number][] = [
      [3500, 12.7],
      [4000, 15.0],
      [4500, 13.0],
      [5000, 18.0],
      [5500, 23.2],
      [6000, 30.1],
      [6500, 25.0],
      [7000, 27.2],
      [7500, 31.8],
      [8000, 35.0],
      [8500, 42.5],
      [9000, 45.4],
      [9500, 47.7],
      [10000, 42.5],
      [10500, 36.6],
      [11000, 34.5],
      [11500, 28.8],
      [12000, 22.6],
      [12500, 16.8],
    ]
    const car = { ...DEFAULT_CAR, torque: dyno, redline: 13000, finalDrive: 3.27, driveEff: 1 }
    const shifts = shiftPoints(car)
    expect(shifts).toHaveLength(5)
    for (const p of shifts) {
      expect(p.rpm).toBeGreaterThan(9500)
      expect(p.rpmAfter).toBeGreaterThan(7500)
      expect(wheelForce(car, p.speed * 0.98, p.from)).toBeGreaterThanOrEqual(
        wheelForce(car, p.speed * 0.98, p.from + 1),
      )
    }
    for (let i = 1; i < shifts.length; i++)
      expect(shifts[i].speed).toBeGreaterThan(shifts[i - 1].speed)
  })
})
