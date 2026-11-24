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
  const buckets: number[][] = []
  for (const s of sets) {
    for (let i = Math.max(0, s.start); i <= s.end && i < speed.length; i++) {
      const v = speed[i]
      const a = g[i]
      if (!Number.isFinite(v) || !Number.isFinite(a) || v < minSpeed) continue
      const k = Math.floor((v - minSpeed) / binWidth)
      ;(buckets[k] ??= []).push(a)
    }
  }
  const out: SpeedBin[] = []
  buckets.forEach((values, k) => {
    if (!values || values.length < minPoints) return
    values.sort((a, b) => a - b)
    const lo = minSpeed + k * binWidth
    out.push({
      lo,
      hi: lo + binWidth,
      mid: lo + binWidth / 2,
      n: values.length,
      envelope: values[Math.min(values.length - 1, Math.floor(values.length * pct))],
    })
  })
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
