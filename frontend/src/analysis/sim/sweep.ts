import { tireOf } from './tire'
import type { CarSpecs } from '../../data/car'
import { scaleTorque } from './powertrain'

export interface SimParam {
  key: string
  label: string
  unit: string
  scale: number
  step: number
  get(c: CarSpecs): number
  set(c: CarSpecs, v: number): CarSpecs
}

type NumericKey = {
  [K in keyof CarSpecs]: CarSpecs[K] extends number ? K : never
}[keyof CarSpecs]

const field = (
  key: NumericKey,
  label: string,
  unit: string,
  step: number,
  scale = 1,
): SimParam => ({
  key,
  label,
  unit,
  scale,
  step,
  get: (c) => c[key] * scale,
  set: (c, v) => ({ ...c, [key]: v / scale }),
})

export const POWER_KEY = 'power'
export const PRESSURE_KEY = 'tirePressure'
const PSI = 6894.76

export const SIM_PARAMS: SimParam[] = [
  field('mass', 'Mass with driver', 'kg', 5),
  {
    key: POWER_KEY,
    label: 'Engine torque',
    unit: '% of curve',
    scale: 1,
    step: 5,
    get: () => 100,
    set: (c, v) => ({ ...c, torque: scaleTorque(c.torque, v / 100) }),
  },
  field('finalDrive', 'Final drive', ':1', 0.1),
  {
    key: PRESSURE_KEY,
    label: 'Tire pressure (hot)',
    unit: 'psi',
    scale: 1,
    step: 0.5,
    get: (c) => Number((tireOf(c).inflpres / PSI).toFixed(2)),
    set: (c, v) => ({ ...c, tire: { ...c.tire, inflpres: v * PSI } }),
  },
  field('tireMu', 'Tire grip μ', '', 0.05),
  field('tireLoadGrip', 'Grip kept at double load', '%', 1, 100),
  field('clA', 'Downforce ClA', 'm²', 0.25),
  field('cdA', 'Drag CdA', 'm²', 0.1),
  field('aeroFront', 'Aero balance (front)', '%', 1, 100),
  field('cgHeight', 'CG height', 'm', 0.01),
  field('rearWeight', 'Static rear weight', '%', 1, 100),
  field('wheelbase', 'Wheelbase', 'm', 0.01),
  field('driveEff', 'Drivetrain efficiency', '%', 1, 100),
  field('shiftTime', 'Shift time', 's', 0.02),
  field('springFront', 'Front spring rate', 'N/mm', 5),
  field('springRear', 'Rear spring rate', 'N/mm', 5),
  field('arbFront', 'Front anti-roll bar', 'N·m/deg', 50),
  field('arbRear', 'Rear anti-roll bar', 'N·m/deg', 50),
  field('rcFront', 'Front roll center height', 'm', 0.01),
  field('rcRear', 'Rear roll center height', 'm', 0.01),
  field('trackFront', 'Front track width', 'm', 0.02),
  field('trackRear', 'Rear track width', 'm', 0.02),
]

export const paramOf = (key: string) => SIM_PARAMS.find((p) => p.key === key)

export type Overrides = Record<string, number>

export function withOverrides(c: CarSpecs, o: Overrides): CarSpecs {
  let out = c
  for (const [key, value] of Object.entries(o)) {
    const p = paramOf(key)
    if (p && Number.isFinite(value)) out = p.set(out, value)
  }
  return out
}

export function sweepValues(from: number, to: number, steps: number): number[] {
  const n = Math.min(41, Math.max(2, Math.round(steps)))
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1))
}

export function sweepRange(p: SimParam, c: CarSpecs): [number, number] {
  const v = p.get(c)
  if (p.key === POWER_KEY) return [80, 120]
  if (p.key === PRESSURE_KEY) return [Math.max(4, v - 4), v + 0.5]
  if (v === 0) return [0, p.step * 10]
  const span = Math.max(p.step * 4, Math.abs(v) * 0.2)
  const round = (x: number) => Number((Math.round(x / p.step) * p.step).toPrecision(6))
  return [round(v - span), round(v + span)]
}
