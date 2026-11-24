import { selectKth } from './stats'

export const G = 9.80665
export const AERO_PERCENTILE = 0.98

export interface AeroCar {
  mass: number
  tireMu: number
  clA: number
  cdA: number
  aeroFront: number
  airDensity: number
}

export const downforceN = (c: AeroCar, v: number) => 0.5 * c.airDensity * c.clA * v * v

export const dragN = (c: AeroCar, v: number) => 0.5 * c.airDensity * c.cdA * v * v

export function gripLimitG(c: AeroCar, v: number, clA = c.clA, mu = c.tireMu): number {
  return mu * (1 + (0.5 * c.airDensity * clA * v * v) / (c.mass * G))
}

export interface SpeedBin {
  lo: number
  hi: number
  mid: number
  n: number
  envelope: number
}

export function gripBySpeed(
  speed: ArrayLike<number>,
  g: ArrayLike<number>,
  sets: { start: number; end: number }[],
  binWidth: number,
  minSpeed = 3,
  minPoints = 30,
  pct = AERO_PERCENTILE,
): SpeedBin[] {
  let room = 0
  for (const s of sets)
    room += Math.max(0, Math.min(s.end, speed.length - 1) - Math.max(0, s.start) + 1)
  const value = new Float64Array(room)
  const band = new Int32Array(room)
  let count = 0
  let bands = 0
  for (const s of sets) {
    for (let i = Math.max(0, s.start); i <= s.end && i < speed.length; i++) {
      const v = speed[i]
      const a = g[i]
      if (!Number.isFinite(v) || !Number.isFinite(a) || v < minSpeed) continue
      const k = Math.floor((v - minSpeed) / binWidth)
      value[count] = a
      band[count] = k
      if (k >= bands) bands = k + 1
      count++
    }
  }
  // Group the values by speed band in one buffer, then pick each band's
  // percentile in place instead of sorting it.
  const perBand = new Int32Array(bands)
  for (let m = 0; m < count; m++) perBand[band[m]]++
  const offset = new Int32Array(bands + 1)
  for (let k = 0; k < bands; k++) offset[k + 1] = offset[k] + perBand[k]
  const grouped = new Float64Array(count)
  const fill = offset.slice(0, bands)
  for (let m = 0; m < count; m++) grouped[fill[band[m]]++] = value[m]

  const out: SpeedBin[] = []
  for (let k = 0; k < bands; k++) {
    const len = perBand[k]
    if (len === 0 || len < minPoints) continue
    const lo = minSpeed + k * binWidth
    const first = offset[k]
    out.push({
      lo,
      hi: lo + binWidth,
      mid: lo + binWidth / 2,
      n: len,
      envelope: selectKth(
        grouped,
        first + Math.min(len - 1, Math.floor(len * pct)),
        first,
        first + len - 1,
      ),
    })
  }
  return out
}

export interface AeroFit {
  mu: number
  clA: number
}

export const MIN_FIT_SPREAD = 8

export function fitAero(bins: SpeedBin[], c: AeroCar): AeroFit | null {
  if (bins.length < 4 || bins[bins.length - 1].mid - bins[0].mid < MIN_FIT_SPREAD) return null
  let sw = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (const b of bins) {
    const w = Math.sqrt(b.n)
    const x = b.mid * b.mid
    sw += w
    sx += w * x
    sy += w * b.envelope
    sxx += w * x * x
    sxy += w * x * b.envelope
  }
  const den = sw * sxx - sx * sx
  if (!(den > 0)) return null
  const slope = (sw * sxy - sx * sy) / den
  const mu = (sy - slope * sx) / sw
  if (!(mu > 0)) return null
  const clA = slope > 0 ? (2 * slope * c.mass * G) / (c.airDensity * mu) : 0
  return { mu, clA }
}

export function gripUsed(bins: SpeedBin[], c: AeroCar): number[] {
  return bins.map((b) => b.envelope / gripLimitG(c, b.mid))
}
