import type { CarSpecs } from '../../data/car'
import { buildLimits, G, sample, type Limits } from './grip'
import { clutchRpm, rpmAt, shiftPoints, wheelForce } from './powertrain'
import type { SimTrack } from './simtrack'
import { envelopeAt } from './tire'

export const LIMIT = { brake: 0, corner: 1, traction: 2, power: 3, shift: 4 } as const

export const LIMIT_LABELS = ['Braking', 'Cornering', 'Traction', 'Power', 'Shifting']

export interface LapResult {
  s: Float64Array
  v: Float64Array
  t: Float64Array
  ax: Float64Array
  ay: Float64Array
  gear: Uint8Array
  rpm: Float64Array
  throttle: Float64Array
  limit: Uint8Array
  time: number
  length: number
  vMax: number
  vMin: number
  share: number[]
}

export interface LapOptions {
  entrySpeed?: number
}

const DOWNSHIFT = 0.9

function cornerSpeed(lim: Limits, k: number): number {
  const cap = Math.min(lim.vTop, (lim.n - 1) * lim.dv)
  if (!(k > 1e-6)) return cap
  let prev = lim.lat[0]
  for (let j = 1; j < lim.n; j++) {
    const v = j * lim.dv
    const f = lim.lat[j] - v * v * k
    if (f < 0) return Math.min(cap, (j - 1 + (prev > 0 ? prev / (prev - f) : 0)) * lim.dv)
    prev = f
  }
  return cap
}

export function simulateLap(
  c: CarSpecs,
  track: SimTrack,
  lim: Limits = buildLimits(c),
  o: LapOptions = {},
): LapResult {
  const n = track.s.length
  const laps = track.closed ? 3 : 1
  const total = track.closed ? n * laps : n
  const ds = new Float64Array(total)
  const kAbs = new Float64Array(total)
  const wrap = track.closed ? Math.max(1e-3, track.length - track.s[n - 1]) : 0
  for (let i = 0; i < total; i++) {
    const j = i % n
    kAbs[i] = Math.abs(track.k[j])
    ds[i] = j < n - 1 ? track.s[j + 1] - track.s[j] : wrap
  }
  const vLat = new Float64Array(total)
  for (let j = 0; j < n; j++) vLat[j] = cornerSpeed(lim, kAbs[j])
  for (let i = n; i < total; i++) vLat[i] = vLat[i % n]

  const left = (v: number, k: number) =>
    envelopeAt(lim.envelope, (v * v * k) / Math.max(1e-6, sample(lim.lat, lim.dv, v)))

  const up = shiftPoints(c).map((p) => p.speed)
  const slip = clutchRpm(c)
  const gearFor = (v: number) => {
    let g = 1
    while (g <= up.length && v >= up[g - 1]) g++
    return g
  }
  const first = Math.min(c.gears.length, Math.max(1, Math.round(c.launchGear) || 1))
  const driveIn = (v: number, g: number) => wheelForce(c, v, g, g === 1 || g === first ? slip : 0)

  const vf = new Float64Array(total)
  const how = new Uint8Array(total)
  const gears = new Uint8Array(total)
  vf[0] = track.standing ? 0 : Math.min(vLat[0], o.entrySpeed ?? vLat[0])
  let gear = track.standing ? first : gearFor(vf[0])
  let shiftLeft = 0
  let launching = track.standing
  for (let i = 0; i < total - 1; i++) {
    const v = vf[i]
    while (!launching && gear > 1 && v < DOWNSHIFT * up[gear - 2]) gear--
    gears[i] = gear
    let force = 0
    if (shiftLeft > 0) {
      shiftLeft -= ds[i]
      how[i] = LIMIT.shift
    } else {
      const drive = driveIn(v, gear)
      const grip = sample(lim.accel, lim.dv, v) * c.mass * left(v, kAbs[i])
      force = Math.min(drive, grip)
      how[i] = drive <= grip ? LIMIT.power : LIMIT.traction
    }
    const a = (force - sample(lim.resist, lim.dv, v)) / c.mass
    const next = Math.min(Math.sqrt(Math.max(0, v * v + 2 * a * ds[i])), vLat[i + 1])
    vf[i + 1] = next
    if (shiftLeft <= 0 && gear <= up.length && next >= up[gear - 1]) {
      gear++
      launching = false
      shiftLeft = next * c.shiftTime
    }
  }
  how[total - 1] = how[Math.max(0, total - 2)]
  gears[total - 1] = gear

  const vAll = new Float64Array(total)
  vAll[total - 1] = vf[total - 1]
  for (let i = total - 2; i >= 0; i--) {
    const v = vAll[i + 1]
    const a =
      sample(lim.brake, lim.dv, v) * left(v, kAbs[i + 1]) + sample(lim.resist, lim.dv, v) / c.mass
    vAll[i] = Math.min(vf[i], Math.sqrt(v * v + 2 * a * ds[i]))
  }

  const from = track.closed ? n : 0
  const out: LapResult = {
    s: track.s,
    v: new Float64Array(n),
    t: new Float64Array(n),
    ax: new Float64Array(n),
    ay: new Float64Array(n),
    gear: new Uint8Array(n),
    rpm: new Float64Array(n),
    throttle: new Float64Array(n),
    limit: new Uint8Array(n),
    time: 0,
    length: track.length,
    vMax: 0,
    vMin: Infinity,
    share: [0, 0, 0, 0, 0],
  }
  let t = 0
  for (let j = 0; j < n; j++) {
    const i = from + j
    const v = vAll[i]
    const last = i === total - 1
    const v1 = last ? v : vAll[i + 1]
    const step = last ? 0 : ds[i]
    const a = step > 0 ? (v1 * v1 - v * v) / (2 * step) : 0
    const res = sample(lim.resist, lim.dv, v)
    let code: number = how[i]
    if (v < vf[i] - 1e-6 || (a < 0 && c.mass * a + res < -1)) code = LIMIT.brake
    else if (v >= vLat[i] * 0.995 && kAbs[i] > 1e-6) code = LIMIT.corner
    const g = code === LIMIT.brake ? gearFor(v) : gears[i]
    const drive = driveIn(v, g)
    out.v[j] = v
    out.t[j] = t
    out.ax[j] = a / G
    out.ay[j] = (v * v * track.k[j]) / G
    out.gear[j] = g
    out.rpm[j] = rpmAt(c, v, g)
    out.throttle[j] =
      code === LIMIT.brake || code === LIMIT.shift
        ? 0
        : Math.min(1, Math.max(0, (c.mass * a + res) / Math.max(1, drive)))
    out.limit[j] = code
    if (v > out.vMax) out.vMax = v
    if (v < out.vMin) out.vMin = v
    const dt = step > 0 ? (2 * step) / Math.max(1e-6, v + v1) : 0
    if (j < n - 1 || track.closed) {
      out.share[code] += dt
      t += dt
    }
  }
  out.time = t
  if (t > 0) out.share = out.share.map((x) => x / t)
  return out
}

export function skidpadTime(lim: Limits, radius: number) {
  const v = cornerSpeed(lim, 1 / radius)
  return { v, time: (2 * Math.PI * radius) / v, g: (v * v) / radius / G }
}
