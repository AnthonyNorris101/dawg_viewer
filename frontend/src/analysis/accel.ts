import { biquad } from './spectrum'

export const G0 = 9.80665
export const ACCEL_SMOOTH_HZ = 2
export const LAT_G = 'Lat G'
export const LONG_G = 'Long G'
export const VERT_G = 'Vert G'

interface Signal {
  name: string
  unit: string
  data: Float64Array
}

const NAMES = {
  x: ['accelx', 'accx', 'longacc', 'longitudinalg', 'glong'],
  y: ['accely', 'accy', 'latacc', 'lateralg', 'glat'],
  z: ['accelz', 'accz', 'vertacc', 'verticalg', 'gvert'],
}

export function findAccel<T extends Signal>(channels: T[], axis: 'x' | 'y' | 'z'): T | undefined {
  for (const n of NAMES[axis]) {
    const c = channels.find((ch) => ch.name.toLowerCase().replace(/[\s_]/g, '') === n)
    if (c) return c
  }
  return undefined
}

function beyondAnyCar(data: Float64Array): boolean {
  const step = Math.max(1, Math.floor(data.length / 5000))
  let big = 0
  let all = 0
  for (let i = 0; i < data.length; i += step) {
    if (!Number.isFinite(data[i])) continue
    all++
    if (Math.abs(data[i]) > 4) big++
  }
  return all > 0 && big / all > 0.02
}

export function accelInG(c: Pick<Signal, 'unit' | 'data'>): Float64Array {
  const metric = /m\/s/i.test(c.unit) || (c.unit.trim() === '' && beyondAnyCar(c.data))
  if (!metric) return c.data
  const out = new Float64Array(c.data.length)
  for (let i = 0; i < out.length; i++) out[i] = c.data[i] / G0
  return out
}

export function smoothG(data: Float64Array, rate: number, hz = ACCEL_SMOOTH_HZ): Float64Array {
  const filled = new Float64Array(data.length)
  let last = 0
  for (let i = 0; i < data.length; i++) {
    if (Number.isFinite(data[i])) last = data[i]
    filled[i] = last
  }
  return biquad(filled, rate, hz, 'low')
}

export interface Heading {
  north: ArrayLike<number>
  east: ArrayLike<number>
}

export function headingFromPosition(
  lat: ArrayLike<number>,
  lon: ArrayLike<number>,
  rate: number,
): Heading {
  const n = lat.length
  const k = Math.max(1, Math.round(rate / 2))
  const north = new Float64Array(n)
  const east = new Float64Array(n)
  for (let i = 0; i + k < n; i++) {
    const dLat = lat[i + k] - lat[i]
    const dLon = lon[i + k] - lon[i]
    if (!Number.isFinite(dLat) || !Number.isFinite(dLon)) continue
    north[i] = dLat * 111320 * (rate / k)
    east[i] = dLon * 111320 * Math.cos((lat[i] * Math.PI) / 180) * (rate / k)
  }
  return { north, east }
}

function turnSign(lat: Float64Array, rate: number, h: Heading | null | undefined): number {
  if (!h) return 0
  const k = Math.max(1, Math.round(rate / 5))
  let sxy = 0
  let sxx = 0
  let syy = 0
  let used = 0
  for (let i = 0; i + k < lat.length; i += k) {
    const n0 = h.north[i]
    const e0 = h.east[i]
    const n1 = h.north[i + k]
    const e1 = h.east[i + k]
    const v2 = n0 * n0 + e0 * e0
    if (!(v2 > 9) || !Number.isFinite(n1) || !Number.isFinite(e1)) continue
    const right = (n0 * e1 - e0 * n1) / v2
    sxy += lat[i] * right
    sxx += lat[i] * lat[i]
    syy += right * right
    used++
  }
  if (used < 50 || !(sxx > 0) || !(syy > 0)) return 0
  const corr = sxy / Math.sqrt(sxx * syy)
  return Math.abs(corr) < 0.2 ? 0 : Math.sign(corr)
}

function speedSign(long: Float64Array, speed: ArrayLike<number> | null | undefined): number {
  if (!speed) return 0
  let agree = 0
  for (let i = 1; i < long.length; i++) agree += long[i] * (speed[i] - speed[i - 1] || 0)
  return Math.sign(agree)
}

export const HINTS = {
  long: '+accel −brake',
  longReversed: '+brake −accel',
  left: '+left −right',
  right: '+right −left',
  vert: '1 at rest, >1 pushed up',
  zDown: '−1 g at rest, axis down',
  zUp: '+1 g at rest, axis up',
}

export interface CleanAccel {
  name: string
  data: Float64Array
  hint?: string
}

export function accelAxes(
  channels: Signal[],
  rate: number,
  speed?: ArrayLike<number> | null,
  heading?: Heading | null,
): { clean: CleanAccel[]; raw: { name: string; hint: string }[] } {
  const clean: CleanAccel[] = []
  const raw: { name: string; hint: string }[] = []
  if (!(rate > 2 * ACCEL_SMOOTH_HZ)) return { clean, raw }
  const taken = new Set(channels.map((c) => c.name))
  const add = (name: string, data: Float64Array, flip: boolean, hint?: string) => {
    if (taken.has(name)) return
    clean.push({ name, data: flip ? data.map((v) => -v) : data, hint })
  }
  const y = findAccel(channels, 'y')
  if (y) {
    const g = smoothG(accelInG(y), rate)
    const right = turnSign(g, rate, heading)
    if (right !== 0) raw.push({ name: y.name, hint: right > 0 ? HINTS.right : HINTS.left })
    add(LAT_G, g, false, right > 0 ? HINTS.right : right < 0 ? HINTS.left : undefined)
  }
  const x = findAccel(channels, 'x')
  if (x) {
    const g = smoothG(accelInG(x), rate)
    const forward = speedSign(g, speed)
    if (forward !== 0)
      raw.push({ name: x.name, hint: forward > 0 ? HINTS.long : HINTS.longReversed })
    add(LONG_G, g, forward < 0, forward !== 0 ? HINTS.long : undefined)
  }
  const z = findAccel(channels, 'z')
  if (z) {
    const g = smoothG(accelInG(z), rate)
    let sum = 0
    for (let i = 0; i < g.length; i++) sum += g[i]
    raw.push({ name: z.name, hint: sum < 0 ? HINTS.zDown : HINTS.zUp })
    add(VERT_G, g, sum < 0, HINTS.vert)
  }
  const named = (n: string) =>
    channels.find((c) => c.name.toLowerCase().replace(/[\s_]/g, '') === n)
  const roll = named('gyrox')
  if (roll) raw.push({ name: roll.name, hint: 'roll rate' })
  const pitch = named('gyroy')
  if (pitch) raw.push({ name: pitch.name, hint: 'pitch rate' })
  const yaw = named('gyroz')
  if (yaw) {
    const right = turnSign(smoothG(yaw.data, rate), rate, heading)
    raw.push({
      name: yaw.name,
      hint: `yaw rate${right > 0 ? `, ${HINTS.right}` : right < 0 ? `, ${HINTS.left}` : ''}`,
    })
  }
  return { clean, raw }
}

export function cleanAccel(
  channels: Signal[],
  rate: number,
  speed?: ArrayLike<number> | null,
  heading?: Heading | null,
): CleanAccel[] {
  return accelAxes(channels, rate, speed, heading).clean
}
