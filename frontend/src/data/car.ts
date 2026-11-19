import type { Car } from '../../bindings/dawg_viewer/internal/config/models'
import { useInfo } from '../live/connection'

export type CarSpecs = Omit<Required<Car>, 'gears'> & { gears: number[] }

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
}

export function withDefaults(car: Partial<Car> | null | undefined): CarSpecs {
  const out = { ...DEFAULT_CAR }
  if (!car) return out
  for (const k of Object.keys(DEFAULT_CAR) as (keyof CarSpecs)[]) {
    const v = car[k]
    if (k === 'gears') {
      if (Array.isArray(v) && v.length > 0) out.gears = v as number[]
    } else if (typeof v === 'number' && v !== 0) {
      ;(out[k] as number) = v
    }
  }
  return out
}

export const useCar = () => withDefaults(useInfo()?.car)

export function tractionLimitG(c: CarSpecs): number {
  const den = 1 - (c.tireMu * c.cgHeight) / c.wheelbase
  return (c.tireMu * c.rearWeight) / Math.max(0.1, den)
}

export const launchTargetG = (c: CarSpecs) => (c.targetG > 0 ? c.targetG : tractionLimitG(c))

export function speedAt(c: CarSpecs, rpm: number, gear: number): number {
  const ratio = c.primary * (c.gears[gear - 1] ?? 1) * c.finalDrive
  return ((rpm / 60) * 2 * Math.PI * c.tireRadius) / ratio
}
