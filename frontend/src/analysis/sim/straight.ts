import type { CarSpecs } from '../../data/car'
import { G, resistance, tractionForce } from './grip'
import { clutchRpm, rpmAt, shiftPoints, wheelForce } from './powertrain'

export const RUN_LIMIT = { traction: 0, power: 1, shift: 2 } as const

export interface RunResult {
  t: Float64Array
  s: Float64Array
  v: Float64Array
  ax: Float64Array
  gear: Uint8Array
  rpm: Float64Array
  limit: Uint8Array
  time: number
  distance: number
  finished: boolean
  vEnd: number
  time60: number
  time100: number
  time75m: number
  peakG: number
  tractionUntil: number
  shifts: { t: number; v: number; from: number }[]
}

export interface RunOptions {
  distance?: number
  maxTime?: number
  dt?: number
  every?: number
}

const KMH60 = 60 / 3.6
const KMH100 = 100 / 3.6

export function simulateRun(c: CarSpecs, o: RunOptions = {}): RunResult {
  const distance = o.distance ?? 75
  const maxTime = o.maxTime ?? 30
  const dt = o.dt ?? 0.001
  const every = o.every ?? 5
  const slip = clutchRpm(c)
  const points = shiftPoints(c)
  const first = Math.min(c.gears.length, Math.max(1, Math.round(c.launchGear) || 1))

  const cols: number[][] = [[], [], [], [], [], [], []]
  const shifts: RunResult['shifts'] = []
  let t = 0
  let s = 0
  let v = 0
  let gear = first
  let shiftLeft = 0
  let time60 = NaN
  let time100 = NaN
  let time75m = NaN
  let peakG = 0
  let tractionUntil = 0
  let finished = false
  const record = (ax: number, limit: number) => {
    cols[0].push(t)
    cols[1].push(s)
    cols[2].push(v)
    cols[3].push(ax / G)
    cols[4].push(gear)
    cols[5].push(Math.max(gear === first ? Math.min(slip, c.redline) : 0, rpmAt(c, v, gear)))
    cols[6].push(limit)
  }
  const steps = Math.ceil(maxTime / dt)
  for (let i = 0; i <= steps; i++) {
    let force = 0
    let limit: number = RUN_LIMIT.shift
    if (shiftLeft > 0) {
      shiftLeft -= dt
    } else {
      const engine = wheelForce(c, v, gear, gear === first ? slip : 0)
      const grip = tractionForce(c, v)
      force = Math.min(engine, grip)
      limit = engine <= grip ? RUN_LIMIT.power : RUN_LIMIT.traction
      if (limit === RUN_LIMIT.traction) tractionUntil = t
    }
    const ax = (force - resistance(c, v)) / c.mass
    if (ax / G > peakG) peakG = ax / G
    if (i % every === 0) record(ax, limit)
    const v1 = Math.max(0, v + ax * dt)
    const s1 = s + ((v + v1) / 2) * dt
    const cross = (from: number, to: number, at: number) =>
      from < at && to >= at ? t + (dt * (at - from)) / (to - from) : NaN
    if (Number.isNaN(time60)) time60 = cross(v, v1, KMH60)
    if (Number.isNaN(time100)) time100 = cross(v, v1, KMH100)
    if (Number.isNaN(time75m)) time75m = cross(s, s1, 75)
    if (s1 >= distance) {
      const f = s1 > s ? (distance - s) / (s1 - s) : 1
      t += dt * f
      v += (v1 - v) * f
      s = distance
      finished = true
      record(ax, limit)
      break
    }
    t += dt
    v = v1
    s = s1
    const next = points[gear - 1]
    if (shiftLeft <= 0 && next && v >= next.speed) {
      shifts.push({ t, v, from: gear })
      gear += 1
      shiftLeft = c.shiftTime
    }
  }
  return {
    t: Float64Array.from(cols[0]),
    s: Float64Array.from(cols[1]),
    v: Float64Array.from(cols[2]),
    ax: Float64Array.from(cols[3]),
    gear: Uint8Array.from(cols[4]),
    rpm: Float64Array.from(cols[5]),
    limit: Uint8Array.from(cols[6]),
    time: t,
    distance: s,
    finished,
    vEnd: v,
    time60,
    time100,
    time75m,
    peakG,
    tractionUntil,
    shifts,
  }
}
