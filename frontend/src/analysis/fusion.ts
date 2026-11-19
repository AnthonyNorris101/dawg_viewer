import { validFix } from './track'

const RAD = Math.PI / 180
const EARTH_R = 6371008.8
const G = 9.80665

export interface FusionInput {
  time: Float64Array
  lat: Float64Array
  lon: Float64Array
  speed?: Float64Array
  yaw?: Float64Array
  latAccel?: Float64Array
}

export interface Fusion {
  lat: Float64Array
  lon: Float64Array
  gaps: number
  gapSeconds: number
  heading: 'yaw' | 'accel' | 'none'
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

function median(a: number[]): number {
  if (a.length === 0) return NaN
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

export function fusePosition(inp: FusionInput): Fusion {
  const { time, lat, lon } = inp
  const n = time.length
  const outLat = Float64Array.from(lat)
  const outLon = Float64Array.from(lon)
  const none: Fusion = { lat: outLat, lon: outLon, gaps: 0, gapSeconds: 0, heading: 'none' }

  const fixes: number[] = []
  for (let i = 0; i < n; i++) {
    if (!validFix(lat[i], lon[i])) continue
    const p = fixes[fixes.length - 1]
    if (p === undefined || lat[i] !== lat[p] || lon[i] !== lon[p]) fixes.push(i)
  }
  if (fixes.length < 3) return none

  const lat0 = lat[fixes[0]]
  const lon0 = lon[fixes[0]]
  const kx = Math.cos(lat0 * RAD) * RAD * EARTH_R
  const ky = RAD * EARTH_R
  const E = (i: number) => (lon[i] - lon0) * kx
  const N = (i: number) => (lat[i] - lat0) * ky

  const course: number[] = []
  const courseAt: number[] = []
  const intervals: number[] = []
  for (let k = 0; k + 1 < fixes.length; k++) {
    const a = fixes[k]
    const b = fixes[k + 1]
    const dt = time[b] - time[a]
    intervals.push(dt)
    const de = E(b) - E(a)
    const dn = N(b) - N(a)
    course.push(Math.hypot(de, dn) > 0.3 && dt > 0 && dt < 1 ? Math.atan2(de, dn) : NaN)
    courseAt.push((a + b) >> 1)
  }
  const typical = median(intervals)

  let heading: Fusion['heading'] = 'none'
  let yawSign = 1
  let yawOffset = 0
  if (inp.yaw) {
    let best = 0
    for (const s of [1, -1]) {
      let c = 0
      let si = 0
      let m = 0
      course.forEach((cr, k) => {
        const y = inp.yaw![courseAt[k]]
        if (!Number.isFinite(cr) || !Number.isFinite(y)) return
        const d = cr - s * y * RAD
        c += Math.cos(d)
        si += Math.sin(d)
        m++
      })
      const r = m > 20 ? Math.hypot(c, si) / m : 0
      if (r > best) {
        best = r
        yawSign = s
        yawOffset = Math.atan2(si, c)
      }
    }
    if (best > 0.8) heading = 'yaw'
  }
  let accelSign = 1
  if (heading === 'none' && inp.latAccel) {
    let corr = 0
    let m = 0
    for (let k = 1; k < course.length; k++) {
      if (!Number.isFinite(course[k]) || !Number.isFinite(course[k - 1])) continue
      const dt = time[courseAt[k]] - time[courseAt[k - 1]]
      const v = inp.speed?.[courseAt[k]] ?? NaN
      const a = inp.latAccel[courseAt[k]]
      if (!(dt > 0) || !(v > 3) || !Number.isFinite(a)) continue
      corr += (wrap(course[k] - course[k - 1]) / dt) * ((a * G) / v)
      m++
    }
    if (m > 20 && corr !== 0) {
      accelSign = Math.sign(corr)
      heading = 'accel'
    }
  }

  const e = new Float64Array(n)
  const nn = new Float64Array(n)
  let gaps = 0
  let gapSeconds = 0
  for (let k = 0; k + 1 < fixes.length; k++) {
    const a = fixes[k]
    const b = fixes[k + 1]
    const ta = time[a]
    const tb = time[b]
    const span = tb - ta
    const ea = E(a)
    const na = N(a)
    const eb = E(b)
    const nb = N(b)
    e[a] = ea
    nn[a] = na
    if (b - a < 2 || !(span > 0)) continue
    if (span > Math.max(0.5, 2.5 * typical)) {
      gaps++
      gapSeconds += span
    }
    const constV = Math.hypot(eb - ea, nb - na) / span
    let h = Number.isFinite(course[k - 1]) ? course[k - 1] : course[k]
    if (heading !== 'none' && Number.isFinite(h)) {
      let pe = ea
      let pn = na
      for (let i = a + 1; i <= b; i++) {
        const dt = time[i] - time[i - 1]
        const v = inp.speed && Number.isFinite(inp.speed[i]) ? inp.speed[i] : constV
        if (heading === 'yaw' && Number.isFinite(inp.yaw![i])) {
          h = yawSign * inp.yaw![i] * RAD + yawOffset
        } else if (heading === 'accel' && Number.isFinite(inp.latAccel![i]) && v > 1) {
          h += ((accelSign * inp.latAccel![i] * G) / Math.max(v, 3)) * dt
        }
        pe += v * dt * Math.sin(h)
        pn += v * dt * Math.cos(h)
        e[i] = pe
        nn[i] = pn
      }
      const errE = eb - e[b]
      const errN = nb - nn[b]
      for (let i = a + 1; i <= b; i++) {
        const f = (time[i] - ta) / span
        e[i] += errE * f
        nn[i] += errN * f
      }
    } else {
      for (let i = a + 1; i <= b; i++) {
        const f = (time[i] - ta) / span
        e[i] = ea + (eb - ea) * f
        nn[i] = na + (nb - na) * f
      }
    }
    for (let i = a + 1; i < b; i++) {
      outLat[i] = nn[i] / ky + lat0
      outLon[i] = e[i] / kx + lon0
    }
  }
  return { lat: outLat, lon: outLon, gaps, gapSeconds, heading }
}
