import type { CarSpecs, TorquePoint } from '../../data/car'
import { G, resistance, tractionForce } from './grip'
import { LIMIT, type LapResult } from './lapsim'
import { ratioOf } from './powertrain'
import { lowerBound } from '../track'

export interface TorqueLogInput {
  time: ArrayLike<number>
  rpm: ArrayLike<number>
  speed: ArrayLike<number>
  accelG?: ArrayLike<number> | null
  throttle?: ArrayLike<number> | null
}

export interface TorqueEstimate {
  points: TorquePoint[]
  samples: number
  gears: number[]
}

const BIN_RPM = 250
const MIN_PER_BIN = 6
const GEAR_TOLERANCE = 0.05
const SLOPE_WINDOW = 0.15

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function torqueFromLog(inp: TorqueLogInput, c: CarSpecs): TorqueEstimate | null {
  const n = inp.time.length
  const bins = new Map<number, number[]>()
  const gears = new Set<number>()
  let throttleMin = Infinity
  let throttleMax = -Infinity
  if (inp.throttle)
    for (let i = 0; i < n; i++) {
      const t = inp.throttle[i]
      if (!Number.isFinite(t)) continue
      if (t < throttleMin) throttleMin = t
      if (t > throttleMax) throttleMax = t
    }
  const wide = throttleMin + 0.9 * (throttleMax - throttleMin)
  const base = c.primary * c.finalDrive
  let samples = 0
  for (let i = 0; i < n; i++) {
    const v = inp.speed[i]
    const rpm = inp.rpm[i]
    if (!(v > 4) || !(rpm > 500)) continue
    if (inp.throttle && throttleMax > throttleMin && !(inp.throttle[i] >= wide)) continue
    let ax: number
    if (inp.accelG) {
      ax = inp.accelG[i] * G
    } else {
      const t = inp.time[i]
      const edge = [-SLOPE_WINDOW, -SLOPE_WINDOW / 3, SLOPE_WINDOW / 3, SLOPE_WINDOW].map((d) =>
        Math.min(n - 1, lowerBound(inp.time, t + d)),
      )
      let least = Infinity
      let most = 0
      for (let q = 0; q < 3; q++) {
        const dt = inp.time[edge[q + 1]] - inp.time[edge[q]]
        const slope = dt > 0 ? (inp.speed[edge[q + 1]] - inp.speed[edge[q]]) / dt : 0
        least = Math.min(least, slope)
        most = Math.max(most, slope)
      }
      const span = inp.time[edge[3]] - inp.time[edge[0]]
      if (!(span > SLOPE_WINDOW) || !(least > 0) || least < 0.6 * most) continue
      ax = (inp.speed[edge[3]] - inp.speed[edge[0]]) / span
    }
    if (!Number.isFinite(ax) || ax < 0.05 * G) continue
    const seen = (rpm * Math.PI * c.tireRadius) / (30 * v) / base
    let gear = 0
    for (let g = 1; g <= c.gears.length; g++)
      if (Math.abs(seen / c.gears[g - 1] - 1) < GEAR_TOLERANCE) gear = g
    if (!gear) continue
    const force = c.mass * ax + resistance(c, v)
    if (force > 0.97 * tractionForce(c, v)) continue
    const nm = (force * c.tireRadius) / (ratioOf(c, gear) * c.driveEff)
    if (!(nm > 0)) continue
    const bin = Math.round(rpm / BIN_RPM) * BIN_RPM
    let list = bins.get(bin)
    if (!list) bins.set(bin, (list = []))
    list.push(nm)
    gears.add(gear)
    samples++
  }
  const points: TorquePoint[] = [...bins.entries()]
    .filter(([, list]) => list.length >= MIN_PER_BIN)
    .map(([rpm, list]): TorquePoint => [rpm, Number(median(list).toFixed(1))])
    .sort((a, b) => a[0] - b[0])
  if (points.length < 4) return null
  return { points, samples, gears: [...gears].sort((a, b) => a - b) }
}

export interface Correlation {
  realTime: number
  simTime: number
  gap: number
  rms: number
  bias: number
  r2: number
  atLimit: number
  loss: number[]
  real: Float64Array
  delta: Float64Array
}

export function correlate(
  realS: ArrayLike<number>,
  realV: ArrayLike<number>,
  realTime: number,
  sim: LapResult,
): Correlation | null {
  const m = realS.length
  const n = sim.s.length
  if (m < 2 || n < 2) return null
  const real = new Float64Array(n)
  let i = 0
  for (let j = 0; j < n; j++) {
    const s = sim.s[j]
    while (i < m - 2 && realS[i + 1] < s) i++
    const a = realS[i]
    const b = realS[i + 1]
    const f = b > a ? Math.min(1, Math.max(0, (s - a) / (b - a))) : 0
    real[j] = realV[i] + (realV[i + 1] - realV[i]) * f
  }
  const delta = new Float64Array(n)
  const loss = [0, 0, 0, 0, 0]
  let sumErr = 0
  let sumSq = 0
  let sumReal = 0
  let near = 0
  let count = 0
  let lost = 0
  for (let j = 0; j < n; j++) {
    delta[j] = lost
    const err = real[j] - sim.v[j]
    if (!Number.isFinite(err)) continue
    sumErr += err
    sumSq += err * err
    sumReal += real[j]
    count++
    if (real[j] >= 0.97 * sim.v[j]) near++
    if (j < n - 1 && real[j] > 0.5 && sim.v[j] > 0.5) {
      const dt = (sim.s[j + 1] - sim.s[j]) * (1 / real[j] - 1 / sim.v[j])
      loss[sim.limit[j]] += dt
      lost += dt
    }
  }
  if (count < 2) return null
  const mean = sumReal / count
  let total = 0
  for (let j = 0; j < n; j++) if (Number.isFinite(real[j])) total += (real[j] - mean) ** 2
  return {
    realTime,
    simTime: sim.time,
    gap: realTime - sim.time,
    rms: Math.sqrt(sumSq / count),
    bias: sumErr / count,
    r2: total > 0 ? 1 - sumSq / total : 0,
    atLimit: near / count,
    loss,
    real,
    delta,
  }
}

export const LOSS_ORDER = [LIMIT.brake, LIMIT.corner, LIMIT.traction, LIMIT.power, LIMIT.shift]

export function percentile(values: ArrayLike<number>, p: number): number {
  const a: number[] = []
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) a.push(values[i])
  if (a.length === 0) return NaN
  a.sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))]
}
