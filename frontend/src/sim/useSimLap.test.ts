import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { buildLimits } from '../analysis/sim/grip'
import type { Lap } from '../analysis/track'
import { DEFAULT_CAR } from '../data/car'
import { DEFAULT_SIM, type SimSettings } from '../state/sim'
import type { LogInputs } from '../viewer/simChannels'
import type { SimCars, SimLog } from './shared'
import { useSimLap } from './useSimLap'

const cars: SimCars = {
  car: DEFAULT_CAR,
  limits: buildLimits(DEFAULT_CAR),
  variant: null,
  variantLimits: null,
}

function ovalLog(): SimLog {
  const rate = 20
  const v = 12
  const straight = 60
  const r = 20
  const lapLength = 2 * straight + 2 * Math.PI * r
  const n = Math.round(((2 * lapLength) / v) * rate) + 1
  const time = new Float64Array(n)
  const distance = new Float64Array(n)
  const speed = new Float64Array(n).fill(v)
  const latG = new Float64Array(n)
  const lat = new Float64Array(n)
  const lon = new Float64Array(n)
  const ky = (Math.PI / 180) * 6371008.8
  const kx = ky * Math.cos((33.95 * Math.PI) / 180)
  for (let i = 0; i < n; i++) {
    time[i] = i / rate
    distance[i] = (v * i) / rate
    const d = distance[i] % lapLength
    let x: number
    let y: number
    let turning = true
    if (d < straight) {
      x = d
      y = 0
      turning = false
    } else if (d < straight + Math.PI * r) {
      const a = (d - straight) / r
      x = straight + r * Math.sin(a)
      y = r - r * Math.cos(a)
    } else if (d < 2 * straight + Math.PI * r) {
      x = straight - (d - straight - Math.PI * r)
      y = 2 * r
      turning = false
    } else {
      const a = (d - 2 * straight - Math.PI * r) / r
      x = -r * Math.sin(a)
      y = r + r * Math.cos(a)
    }
    latG[i] = turning ? (v * v) / r / 9.80665 : 0
    lat[i] = 33.95 + y / ky
    lon[i] = -83.37 + x / kx
  }
  const per = Math.round((lapLength / v) * rate)
  const laps: Lap[] = [0, 1].map((q) => ({
    key: `lap-${q + 1}`,
    label: String(q + 1),
    kind: 'lap',
    number: q + 1,
    start: q * per,
    end: (q + 1) * per,
    t0: time[q * per],
    t1: time[(q + 1) * per],
    time: time[(q + 1) * per] - time[q * per] + (q === 0 ? 1 : 0),
    distance: lapLength,
  }))
  const inputs = {
    time,
    distance,
    speed,
    latG,
    longG: null,
    rpm: null,
    throttle: null,
    speedUnit: 'm/s',
    toUnit: 1,
    gps: { lat, lon, latId: 'lat', lonId: 'lon' },
  } as unknown as LogInputs
  return { name: 'oval.csv', inputs, laps, loop: true }
}

const run = (log: SimLog | null, patch: Partial<SimSettings>) =>
  renderHook(() => useSimLap(cars, log, { ...DEFAULT_SIM, ...patch })).result.current

describe('lap simulation inputs', () => {
  it('measures the driver’s pace from the best logged lap', () => {
    const log = ovalLog()
    const lap = run(log, { track: 'custom' })
    expect(lap.pace?.lap).toBe('2')
    expect(lap.pace?.real).toBeCloseTo(log.laps[1].time, 6)
    expect(lap.pace?.ratio).toBeCloseTo(lap.pace!.real / lap.pace!.sim, 9)
    expect(lap.pace?.ratio).toBeGreaterThan(1)
    expect(run(null, { track: 'custom' }).pace).toBeNull()
    expect(lap.line).toBeNull()
  })

  it('finds a quicker line beside the one a logged lap was driven on', () => {
    const lap = run(ovalLog(), { track: 'log', line: true, lineRoom: 1.5 })
    expect(lap.lineNote).toBe('')
    const line = lap.line!
    expect(line.driven).toBe(true)
    expect(line.room).toBe(1.5)
    expect(line.base.origin).toBeDefined()
    expect(line.base.length).toBeGreaterThan(240)
    expect(line.result.time).toBeLessThan(line.baseResult.time * 0.98)
    expect(Math.max(...Array.from(line.offset, Math.abs))).toBeLessThanOrEqual(1.5 + 1e-6)
    expect(run(ovalLog(), { track: 'log', line: true, lineRoom: 0 }).lineNote).toMatch(/room/)
  })

  it('uses an imported outline and the track width', () => {
    const ring = Array.from({ length: 60 }, (_, i) => (2 * Math.PI * i) / 60)
    const path = {
      name: 'Ring',
      source: 'file ring.csv',
      closed: true,
      x: ring.map((a) => 40 * Math.cos(a) * (1 + 0.3 * Math.cos(2 * a))),
      y: ring.map((a) => 40 * Math.sin(a) * (1 + 0.3 * Math.cos(2 * a))),
    }
    const lap = run(null, { track: 'path', path, line: true, lineWidth: 6 })
    expect(lap.track?.name).toBe('Ring')
    expect(lap.problem).toBe('')
    expect(lap.line?.driven).toBe(false)
    expect(lap.line?.room).toBeCloseTo((6 - lap.carWidth) / 2, 9)
    expect(lap.line!.result.time).toBeLessThan(lap.result!.time)
    expect(run(null, { track: 'path' }).problem).toMatch(/Import a track outline/)
    expect(run(null, { track: 'path', path, line: true, lineWidth: 1 }).lineNote).toMatch(
      /no wider than the car/,
    )
  })
})
