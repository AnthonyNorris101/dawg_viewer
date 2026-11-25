import { speedAt, type CarSpecs } from '../../data/car'
import { bestGear, clutchRpm } from './powertrain'
import { suspension, type Suspension } from './suspension'
import {
  axlePeak,
  combinedEnvelope,
  DEG,
  latCurve,
  lonPeak,
  magic,
  tireOf,
  type Tire,
} from './tire'

export const G = 9.80665

export const muLat = (c: CarSpecs) => (c.tireMuLat > 0 ? c.tireMuLat : c.tireMu)

export const downforce = (c: CarSpecs, v: number) => 0.5 * c.airDensity * c.clA * v * v

export const drag = (c: CarSpecs, v: number) => 0.5 * c.airDensity * c.cdA * v * v

export const resistance = (c: CarSpecs, v: number) =>
  drag(c, v) + c.rollRes * (c.mass * G + downforce(c, v))

export function axleLoads(c: CarSpecs, v: number) {
  const df = downforce(c, v)
  return {
    front: c.mass * G * (1 - c.rearWeight) + df * c.aeroFront,
    rear: c.mass * G * c.rearWeight + df * (1 - c.aeroFront),
  }
}

function axleLateral(t: Tire, load: number, transfer: number, ay: number) {
  const moved = Math.min(load / 2, transfer * ay)
  return axlePeak(t, load / 2 - moved, load / 2 + moved).force
}

export interface Cornering {
  ay: number
  frontUse: number
  rearUse: number
}

export function cornering(
  c: CarSpecs,
  v: number,
  s: Suspension = suspension(c),
  t: Tire = tireOf(c),
): Cornering {
  const { front, rear } = axleLoads(c, v)
  const needF = c.mass * (1 - c.rearWeight)
  const needR = c.mass * c.rearWeight
  const usage = (ay: number) => ({
    f: (needF * ay) / Math.max(1e-9, axleLateral(t, front, s.transferF, ay)),
    r: (needR * ay) / Math.max(1e-9, axleLateral(t, rear, s.transferR, ay)),
  })
  let lo = 0
  let hi = 8 * G
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    const u = usage(mid)
    if (u.f <= 1 && u.r <= 1) lo = mid
    else hi = mid
  }
  const u = usage(lo)
  return { ay: lo, frontUse: Math.min(1, u.f), rearUse: Math.min(1, u.r) }
}

function axleSlip(t: Tire, load: number, transfer: number, ay: number, need: number) {
  const moved = Math.min(load / 2, transfer * ay)
  const inner = latCurve(t, load / 2 - moved)
  const outer = latCurve(t, load / 2 + moved)
  const top = axlePeak(t, load / 2 - moved, load / 2 + moved)
  let lo = 0
  let hi = top.slip
  if (top.force <= need) return hi / DEG
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (magic(inner, mid) + magic(outer, mid) < need) lo = mid
    else hi = mid
  }
  return hi / DEG
}

export interface Handling {
  understeer: number
  slipFront: number
  slipRear: number
  stiffFront: number
  stiffRear: number
}

export function handling(
  c: CarSpecs,
  v: number,
  ay: number,
  s: Suspension = suspension(c),
  t: Tire = tireOf(c),
): Handling {
  const { front, rear } = axleLoads(c, v)
  const stiffFront = 2 * latCurve(t, front / 2).k
  const stiffRear = 2 * latCurve(t, rear / 2).k
  const wf = c.mass * G * (1 - c.rearWeight)
  const wr = c.mass * G * c.rearWeight
  return {
    understeer:
      stiffFront > 0 && stiffRear > 0 ? (wf / stiffFront - wr / stiffRear) / DEG : Number.NaN,
    slipFront: axleSlip(t, front, s.transferF, ay, c.mass * (1 - c.rearWeight) * ay),
    slipRear: axleSlip(t, rear, s.transferR, ay, c.mass * c.rearWeight * ay),
    stiffFront: stiffFront * DEG,
    stiffRear: stiffRear * DEG,
  }
}

export function tractionForce(c: CarSpecs, v: number, t: Tire = tireOf(c)): number {
  const { rear } = axleLoads(c, v)
  const res = resistance(c, v)
  const k = c.cgHeight / c.wheelbase
  let force = lonPeak(t, rear / 2) * 2
  for (let i = 0; i < 8; i++) {
    const load = Math.max(0, rear + (force - res) * k)
    force = lonPeak(t, load / 2) * 2
  }
  return force
}

export function brakeForce(c: CarSpecs, v: number, t: Tire = tireOf(c)): number {
  const { front, rear } = axleLoads(c, v)
  const res = resistance(c, v)
  const k = c.cgHeight / c.wheelbase
  let force = lonPeak(t, front / 2) * 2 + lonPeak(t, rear / 2) * 2
  for (let i = 0; i < 8; i++) {
    const moved = Math.min(rear, (force + res) * k)
    force = lonPeak(t, (front + moved) / 2) * 2 + lonPeak(t, (rear - moved) / 2) * 2
  }
  return force
}

export interface Limits {
  dv: number
  n: number
  vTop: number
  lat: Float64Array
  accel: Float64Array
  brake: Float64Array
  drive: Float64Array
  resist: Float64Array
  gear: Uint8Array
  frontUse: Float64Array
  rearUse: Float64Array
  envelope: Float64Array
}

export function sample(a: ArrayLike<number>, dv: number, v: number): number {
  const x = v / dv
  if (!(x > 0)) return a[0]
  const i = Math.floor(x)
  if (i >= a.length - 1) return a[a.length - 1]
  return a[i] + (a[i + 1] - a[i]) * (x - i)
}

export function buildLimits(c: CarSpecs, vMax = 80, dv = 0.25): Limits {
  const n = Math.floor(vMax / dv) + 1
  const s = suspension(c)
  const t = tireOf(c)
  const slip = clutchRpm(c)
  const out: Limits = {
    dv,
    n,
    vTop: 0,
    lat: new Float64Array(n),
    accel: new Float64Array(n),
    brake: new Float64Array(n),
    drive: new Float64Array(n),
    resist: new Float64Array(n),
    gear: new Uint8Array(n),
    frontUse: new Float64Array(n),
    rearUse: new Float64Array(n),
    envelope: combinedEnvelope(t),
  }
  for (let i = 0; i < n; i++) {
    const v = i * dv
    const corner = cornering(c, v, s, t)
    out.lat[i] = corner.ay
    out.frontUse[i] = corner.frontUse
    out.rearUse[i] = corner.rearUse
    out.accel[i] = tractionForce(c, v, t) / c.mass
    out.brake[i] = brakeForce(c, v, t) / c.mass
    out.resist[i] = resistance(c, v)
    const b = bestGear(c, v, slip)
    out.drive[i] = b.force
    out.gear[i] = b.gear
  }
  let top = (n - 1) * dv
  for (let i = 2; i < n; i++) {
    if (out.drive[i] < out.resist[i]) {
      const a = out.drive[i - 1] - out.resist[i - 1]
      const b = out.drive[i] - out.resist[i]
      top = (i - 1 + (a > 0 && a !== b ? a / (a - b) : 0)) * dv
      break
    }
  }
  const redline = speedAt(c, c.redline, c.gears.length)
  out.vTop = Math.min(top, redline)
  return out
}
