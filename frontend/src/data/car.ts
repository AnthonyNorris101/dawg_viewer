import type { Car } from '../../bindings/dawg_viewer/internal/config/models'
import { useMemo } from 'react'
import { useInfo } from '../live/connection'

export type TorquePoint = [number, number]

export type TireCoeffs = Record<string, number>

export type CarSpecs = Omit<Required<Car>, 'gears' | 'torque' | 'tire'> & {
  gears: number[]
  torque: TorquePoint[]
  tire: TireCoeffs
}

const NO_TIRE: TireCoeffs = {}

export function cleanCoeffs(v: unknown): TireCoeffs {
  if (!v || typeof v !== 'object') return NO_TIRE
  const out: TireCoeffs = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>))
    if (typeof x === 'number' && Number.isFinite(x)) out[k] = x
  return Object.keys(out).length > 0 ? out : NO_TIRE
}

export const PLACEHOLDER_TORQUE: TorquePoint[] = [
  [3000, 35],
  [4000, 40],
  [5000, 44],
  [6000, 49],
  [7000, 54],
  [8000, 57],
  [9000, 58],
  [10000, 56],
  [11000, 52],
  [12000, 47],
  [13000, 41],
  [13500, 38],
]

export function cleanTorque(points: unknown): TorquePoint[] {
  if (!Array.isArray(points)) return []
  const byRpm = new Map<number, number>()
  for (const p of points) {
    if (!Array.isArray(p)) continue
    const rpm = Number(p[0])
    const nm = Number(p[1])
    if (Number.isFinite(rpm) && Number.isFinite(nm) && rpm > 0 && nm >= 0) byRpm.set(rpm, nm)
  }
  return [...byRpm.entries()].sort((a, b) => a[0] - b[0])
}

export const hasTorqueCurve = (c: Pick<CarSpecs, 'torque'>) => c.torque !== PLACEHOLDER_TORQUE

export function carEntered(raw: object | null | undefined): boolean {
  if (!raw) return false
  return Object.values(raw).some((v) =>
    Array.isArray(v)
      ? v.length > 0
      : typeof v === 'object' && v !== null
        ? Object.keys(v).length > 0
        : typeof v === 'number' && v !== 0,
  )
}

export const DEFAULT_CAR: CarSpecs = {
  mass: 290,
  wheelbase: 1.55,
  cgHeight: 0.3,
  rearWeight: 0.55,
  tireRadius: 0.229,
  tireMu: 1.5,
  primary: 2.073,
  gears: [2.583, 2.0, 1.667, 1.444, 1.286, 1.15],
  finalDrive: 3.08,
  redline: 13500,
  launchGear: 1,
  slipLow: 0.08,
  slipHigh: 0.15,
  targetG: 0,
  clA: 0,
  cdA: 0,
  aeroFront: 0.45,
  airDensity: 1.2,
  torque: PLACEHOLDER_TORQUE,
  driveEff: 0.9,
  shiftTime: 0.12,
  launchRpm: 0,
  tireMuLat: 0,
  tireLoadGrip: 0.9,
  rollRes: 0.02,
  trackFront: 1.2,
  trackRear: 1.15,
  springFront: 35,
  springRear: 44,
  motionFront: 0.9,
  motionRear: 0.9,
  arbFront: 0,
  arbRear: 0,
  rcFront: 0,
  rcRear: 0,
  unsprungFront: 9,
  unsprungRear: 10,
  tireRate: 110,
  tire: NO_TIRE,
}

type Given = Partial<Car> | null | undefined

const CAR_KEYS = Object.keys(DEFAULT_CAR) as (keyof CarSpecs)[]

function gives(from: Given, k: keyof CarSpecs): boolean {
  const v = from?.[k]
  if (k === 'gears') return Array.isArray(v) && v.length > 0
  if (k === 'torque') return cleanTorque(v).length >= 2
  if (k === 'tire') return Object.keys(cleanCoeffs(v)).length > 0
  return typeof v === 'number' && v !== 0
}

export function withDefaults(car: Given, stock?: Given): CarSpecs {
  const out = { ...DEFAULT_CAR }
  for (const from of [stock, car]) {
    for (const k of CAR_KEYS) {
      if (!gives(from, k)) continue
      const v = from?.[k]
      if (k === 'gears') out.gears = v as number[]
      else if (k === 'torque') out.torque = cleanTorque(v)
      else if (k === 'tire') out.tire = cleanCoeffs(v)
      else (out[k] as number) = v as number
    }
  }
  return out
}

export function stockKeys(car: Given, stock: Given): Set<keyof CarSpecs> {
  return new Set(CAR_KEYS.filter((k) => !gives(car, k) && gives(stock, k)))
}

export function useCar(): CarSpecs {
  const info = useInfo()
  const key = JSON.stringify([info?.car ?? null, info?.stockCar ?? null])
  return useMemo(() => {
    const [car, stock] = JSON.parse(key) as [Given, Given]
    return withDefaults(car, stock)
  }, [key])
}

export function useStockKeys(): Set<keyof CarSpecs> {
  const info = useInfo()
  const key = JSON.stringify([info?.car ?? null, info?.stockCar ?? null])
  return useMemo(() => {
    const [car, stock] = JSON.parse(key) as [Given, Given]
    return stockKeys(car, stock)
  }, [key])
}

export const STOCK_CAR_NOTE =
  'A G26 value that comes with the app: from the team spec sheet, the 8/8/26 dyno run or the team tire model, and in a few cases an assumption. The app did not measure it. Check it against your car.'

export function forProfile(c: CarSpecs, base: CarSpecs = DEFAULT_CAR, entered?: Given): Car {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const out: Car = { ...c, torque: hasTorqueCurve(c) ? c.torque : [] }
  if (!entered) return out
  for (const k of CAR_KEYS) {
    if (gives(entered, k) || !same(c[k], base[k])) continue
    if (k === 'gears') out.gears = []
    else if (k === 'torque') out.torque = []
    else if (k === 'tire') out.tire = {}
    else if (base[k] !== 0) (out as unknown as Record<string, number>)[k] = 0
  }
  return out
}

export function tractionLimitG(c: CarSpecs): number {
  const den = 1 - (c.tireMu * c.cgHeight) / c.wheelbase
  return (c.tireMu * c.rearWeight) / Math.max(0.1, den)
}

export const launchTargetG = (c: CarSpecs) => (c.targetG > 0 ? c.targetG : tractionLimitG(c))

export function speedAt(c: CarSpecs, rpm: number, gear: number): number {
  const ratio = c.primary * (c.gears[gear - 1] ?? 1) * c.finalDrive
  return ((rpm / 60) * 2 * Math.PI * c.tireRadius) / ratio
}
