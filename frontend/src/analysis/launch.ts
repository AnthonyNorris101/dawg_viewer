export const G = 9.80665

export interface Launch {
  start: number
  end: number
  t0: number
  launchRpm: number
  time60: number
  time75m: number
  peakG: number
  meanG1s: number
  peakSlip: number
  manual?: boolean
  mark?: number
}

export interface LaunchInputs {
  time: ArrayLike<number>
  ground: ArrayLike<number>
  still?: ArrayLike<number>
  driven?: ArrayLike<number>
  accel?: ArrayLike<number>
  rpm?: ArrayLike<number>
  throttle?: ArrayLike<number>
  window: number
}

const STOPPED = 0.5
const MOVING = 2
const LAUNCHED = 8

export function slipAt(driven: number, ground: number): number {
  if (!Number.isFinite(driven) || !Number.isFinite(ground) || ground < MOVING) return NaN
  return (driven - ground) / ground
}

export function accelSign(
  accel: ArrayLike<number>,
  starts: { start: number; end: number }[],
): number {
  let sum = 0
  for (const s of starts)
    for (let i = s.start; i <= s.end; i++) if (Number.isFinite(accel[i])) sum += accel[i]
  return sum < 0 ? -1 : 1
}

export function findLaunches(inp: LaunchInputs): Launch[] {
  const { time, ground } = inp
  const still = inp.still ?? ground
  const n = time.length
  const raw: { start: number; end: number }[] = []
  let stopped = -1
  for (let i = 0; i < n; i++) {
    const v = still[i]
    if (!Number.isFinite(v)) continue
    if (v < STOPPED) {
      stopped = i
      continue
    }
    if (stopped < 0 || v < MOVING || time[i] - time[stopped] > 2) continue
    let j = i
    while (j < n && time[j] - time[stopped] <= 4 && !(still[j] >= LAUNCHED)) j++
    if (j >= n || !(still[j] >= LAUNCHED)) {
      stopped = -1
      continue
    }
    if (inp.throttle) {
      let maxT = 0
      for (let k = stopped; k <= j; k++) if (inp.throttle[k] > maxT) maxT = inp.throttle[k]
      if (maxT < 50) {
        stopped = -1
        continue
      }
    }
    let end = stopped
    while (
      end + 1 < n &&
      time[end + 1] - time[stopped] <= inp.window &&
      !(still[end + 1] < STOPPED)
    )
      end++
    raw.push({ start: stopped, end })
    while (i < n && !(still[i] < STOPPED)) i++
    stopped = i < n ? i : -1
  }

  const sign = inp.accel ? accelSign(inp.accel, raw) : 1
  return raw.map(({ start, end }) => measureLaunch(inp, start, end, sign))
}

export function manualLaunch(inp: LaunchInputs, from: number, to: number): Launch | null {
  const { time } = inp
  const n = time.length
  if (!(to > from) || n < 2) return null
  let start = 0
  while (start < n - 1 && time[start] < from) start++
  let end = start
  while (end + 1 < n && time[end + 1] <= to) end++
  if (end <= start) return null
  const sign = inp.accel ? accelSign(inp.accel, [{ start, end }]) : 1
  return { ...measureLaunch(inp, start, end, sign), manual: true }
}

function measureLaunch(inp: LaunchInputs, start: number, end: number, sign: number): Launch {
  const { time, ground } = inp
  const n = time.length
  const t0 = time[start]
  let dist = 0
  let time60 = NaN
  let time75m = NaN
  let peakG = -Infinity
  let sum1 = 0
  let n1 = 0
  let peakSlip = NaN
  for (let i = start; i < n; i++) {
    const dt = i > start ? time[i] - time[i - 1] : 0
    const v = ground[i]
    if (i > start && Number.isFinite(v)) dist += ((v + ground[i - 1]) / 2) * dt
    if (Number.isNaN(time60) && v >= 60 / 3.6) time60 = time[i] - t0
    if (Number.isNaN(time75m) && dist >= 75) time75m = time[i] - t0
    if (i > end && !Number.isNaN(time75m) && !Number.isNaN(time60)) break
    if (i > end && (v < STOPPED || time[i] - t0 > 20)) break
    if (i > end) continue
    const a = inp.accel ? sign * inp.accel[i] : NaN
    if (Number.isFinite(a)) {
      if (a > peakG) peakG = a
      if (time[i] - t0 <= 1) {
        sum1 += a
        n1++
      }
    }
    if (inp.driven) {
      const s = slipAt(inp.driven[i], v)
      if (Number.isFinite(s) && !(s <= peakSlip)) peakSlip = s
    }
  }
  return {
    start,
    end,
    t0,
    launchRpm: inp.rpm ? inp.rpm[start] : NaN,
    time60,
    time75m,
    peakG: Number.isFinite(peakG) ? peakG : NaN,
    meanG1s: n1 ? sum1 / n1 : NaN,
    peakSlip,
  }
}

export function speedFromDistance(
  time: ArrayLike<number>,
  distance: ArrayLike<number>,
  halfWindowS = 0.15,
) {
  const n = time.length
  const out = new Float64Array(n)
  let lo = 0
  let hi = 0
  for (let i = 0; i < n; i++) {
    while (time[i] - time[lo] > halfWindowS) lo++
    while (hi + 1 < n && time[hi + 1] - time[i] <= halfWindowS) hi++
    const dt = time[hi] - time[lo]
    out[i] = dt > 0 ? (distance[hi] - distance[lo]) / dt : 0
  }
  return out
}

export interface Gearing {
  primary: number
  finalDrive: number
  tireRadius: number
  gears: number[]
  launchGear: number
}

export function wheelSpeedFromRpm(
  rpm: ArrayLike<number>,
  gear: ArrayLike<number> | undefined,
  g: Gearing,
): Float64Array {
  const out = new Float64Array(rpm.length)
  for (let i = 0; i < rpm.length; i++) {
    let n = gear ? Math.round(gear[i]) : g.launchGear
    if (!(n >= 1 && n <= g.gears.length)) n = g.launchGear
    const ratio = g.primary * (g.gears[n - 1] ?? g.gears[0] ?? 1) * g.finalDrive
    out[i] = ((rpm[i] / 60) * 2 * Math.PI * g.tireRadius) / ratio
  }
  return out
}
