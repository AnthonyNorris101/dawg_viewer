import { speedAt, type CarSpecs, type TorquePoint } from '../../data/car'

export function torqueAt(curve: readonly TorquePoint[], rpm: number): number {
  const n = curve.length
  if (n === 0) return 0
  if (rpm <= curve[0][0]) return curve[0][1]
  if (rpm >= curve[n - 1][0]) return curve[n - 1][1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (curve[mid][0] <= rpm) lo = mid
    else hi = mid
  }
  const [r0, t0] = curve[lo]
  const [r1, t1] = curve[hi]
  return t0 + ((t1 - t0) * (rpm - r0)) / (r1 - r0)
}

export const kwOf = (rpm: number, nm: number) => (nm * rpm * Math.PI) / 30000

export const KW_TO_HP = 1.34102

export interface Peaks {
  torque: { rpm: number; nm: number }
  power: { rpm: number; kw: number }
}

type Engine = Pick<CarSpecs, 'torque' | 'redline'>

export function peaks(c: Engine): Peaks {
  const curve = c.torque
  const out: Peaks = { torque: { rpm: 0, nm: 0 }, power: { rpm: 0, kw: 0 } }
  if (curve.length === 0) return out
  const lo = curve[0][0]
  const hi = Math.max(lo, Math.min(curve[curve.length - 1][0], c.redline))
  const steps = Math.max(1, Math.ceil((hi - lo) / 25))
  for (let i = 0; i <= steps; i++) {
    const rpm = lo + ((hi - lo) * i) / steps
    const nm = torqueAt(curve, rpm)
    if (nm > out.torque.nm) out.torque = { rpm, nm }
    const kw = kwOf(rpm, nm)
    if (kw > out.power.kw) out.power = { rpm, kw }
  }
  return out
}

type Driveline = Pick<
  CarSpecs,
  | 'torque'
  | 'redline'
  | 'primary'
  | 'gears'
  | 'finalDrive'
  | 'tireRadius'
  | 'driveEff'
  | 'launchRpm'
>

export const ratioOf = (c: Driveline, gear: number) =>
  c.primary * (c.gears[gear - 1] ?? 1) * c.finalDrive

export const rpmAt = (c: Driveline, v: number, gear: number) =>
  (v * ratioOf(c, gear) * 30) / (Math.PI * c.tireRadius)

export const clutchRpm = (c: Driveline) =>
  c.launchRpm > 0 ? Math.min(c.launchRpm, c.redline) : peaks(c).torque.rpm

export function wheelForce(c: Driveline, v: number, gear: number, slipRpm = 0): number {
  let rpm = rpmAt(c, v, gear)
  if (rpm > c.redline) return 0
  if (rpm < slipRpm) rpm = slipRpm
  return (torqueAt(c.torque, rpm) * ratioOf(c, gear) * c.driveEff) / c.tireRadius
}

export function bestGear(c: Driveline, v: number, slipRpm = clutchRpm(c)) {
  let gear = 1
  let force = -1
  for (let g = 1; g <= c.gears.length; g++) {
    const f = wheelForce(c, v, g, g === 1 ? slipRpm : 0)
    if (f > force + 1e-9) {
      force = f
      gear = g
    }
  }
  return { gear, force: Math.max(0, force) }
}

export interface ShiftPoint {
  from: number
  rpm: number
  speed: number
  rpmAfter: number
  atRedline: boolean
}

export function shiftPoints(c: Driveline): ShiftPoint[] {
  const out: ShiftPoint[] = []
  for (let g = 1; g < c.gears.length; g++) {
    const vRed = speedAt(c as CarSpecs, c.redline, g)
    const steps = 400
    const at = (i: number) => vRed * (0.5 + (0.5 * i) / steps)
    let speed = at(0)
    let atRedline = false
    for (let i = steps; i >= 0; i--) {
      if (wheelForce(c, at(i), g) >= wheelForce(c, at(i), g + 1)) {
        const next = Math.min(steps, i + 1)
        speed = at(next)
        atRedline = next === steps
        break
      }
    }
    out.push({
      from: g,
      rpm: Math.min(c.redline, rpmAt(c, speed, g)),
      speed,
      rpmAfter: rpmAt(c, speed, g + 1),
      atRedline,
    })
  }
  return out
}

export function scaleTorque(curve: readonly TorquePoint[], factor: number): TorquePoint[] {
  return curve.map(([rpm, nm]) => [rpm, nm * factor])
}

export function torqueSeries(curve: readonly TorquePoint[], redline: number) {
  if (curve.length < 2) return { rpm: [], nm: [], kw: [] }
  const lo = curve[0][0]
  const hi = Math.max(lo + 1, Math.min(curve[curve.length - 1][0], redline))
  const rpm = Array.from({ length: 121 }, (_, i) => lo + ((hi - lo) * i) / 120)
  const nm = rpm.map((r) => torqueAt(curve, r))
  return { rpm, nm, kw: rpm.map((r, i) => kwOf(r, nm[i])) }
}
