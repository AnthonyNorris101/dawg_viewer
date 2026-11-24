import type { Calibration } from '../../bindings/dawg_viewer/internal/config/models'

export type Point = [number, number]

export const gainOf = (c: Calibration) => (c.mult || 1) / (c.div || 1)

export function evalPoly(coeffs: readonly number[], x: number): number {
  let y = 0
  for (let k = coeffs.length - 1; k >= 0; k--) y = y * x + coeffs[k]
  return y
}

export function sortedPoints(points: readonly Point[]): Point[] {
  return points
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .slice()
    .sort((a, b) => a[0] - b[0])
}

export function tableFn(points: readonly Point[]): ((x: number) => number) | null {
  const pts = sortedPoints(points)
  for (let i = 1; i < pts.length; i++) if (pts[i][0] === pts[i - 1][0]) return null
  if (pts.length < 2) return null
  return (x) => {
    let i = 1
    if (x >= pts[pts.length - 1][0]) i = pts.length - 1
    else if (x > pts[0][0]) {
      let lo = 1
      let hi = pts.length - 1
      while (lo < hi) {
        const m = (lo + hi) >> 1
        if (pts[m][0] < x) lo = m + 1
        else hi = m
      }
      i = lo
    }
    const [x0, y0] = pts[i - 1]
    const [x1, y1] = pts[i]
    return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
}

export function polyFit(points: readonly Point[], degree: number): number[] | null {
  const pts = sortedPoints(points)
  const n = degree + 1
  if (degree < 0 || pts.length < n) return null
  const xs = pts.map((p) => p[0])
  const mid = (xs[0] + xs[xs.length - 1]) / 2
  const half = (xs[xs.length - 1] - xs[0]) / 2 || 1
  const a = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0))
  for (const [x, y] of pts) {
    const t = (x - mid) / half
    const pow = [1]
    for (let k = 1; k < 2 * n; k++) pow.push(pow[k - 1] * t)
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) a[r][c] += pow[r + c]
      a[r][n] += pow[r] * y
    }
  }
  for (let col = 0; col < n; col++) {
    let p = col
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[p][col])) p = r
    if (Math.abs(a[p][col]) < 1e-12) return null
    ;[a[col], a[p]] = [a[p], a[col]]
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = a[r][col] / a[col][col]
      for (let c = col; c <= n; c++) a[r][c] -= f * a[col][c]
    }
  }
  const scaled = a.map((row, r) => row[n] / row[r])
  const out = new Array<number>(n).fill(0)
  const binom = (m: number, k: number) => {
    let b = 1
    for (let i = 1; i <= k; i++) b = (b * (m - k + i)) / i
    return b
  }
  for (let m = 0; m < n; m++) {
    const c = scaled[m] / half ** m
    for (let k = 0; k <= m; k++) out[k] += c * binom(m, k) * (-mid) ** (m - k)
  }
  return out.map((v) => (Math.abs(v) < 1e-300 ? 0 : v))
}

export function calFn(cal: Calibration | null | undefined): ((raw: number) => number) | null {
  if (!cal) return (x) => x
  switch (cal.type) {
    case 'linear': {
      const k = gainOf(cal)
      return (x) => x * k + cal.add
    }
    case 'poly':
      return cal.coeffs?.length ? (x) => evalPoly(cal.coeffs!, x) : null
    case 'table':
      return tableFn((cal.points ?? []) as Point[])
    default:
      return null
  }
}

export function calDomain(cal: Calibration): [number, number] {
  const pts = sortedPoints((cal.points ?? []) as Point[])
  if (pts.length >= 2) {
    const lo = pts[0][0]
    const hi = pts[pts.length - 1][0]
    const pad = (hi - lo) * 0.25 || 1
    return [lo - pad, hi + pad]
  }
  return [0, 4095]
}

export function inverter(
  cal: Calibration | null | undefined,
): ((value: number) => number | undefined) | null {
  if (!cal) return (v) => v
  if (cal.type === 'linear') {
    const k = gainOf(cal)
    return (v) => (v - cal.add) / k
  }
  const fn = calFn(cal)
  if (!fn) return null
  const [lo, hi] = calDomain(cal)
  const N = 2048
  const xs = new Float64Array(N + 1)
  const ys = new Float64Array(N + 1)
  for (let i = 0; i <= N; i++) {
    xs[i] = lo + ((hi - lo) * i) / N
    ys[i] = fn(xs[i])
  }
  return (v) => {
    for (let i = 0; i < N; i++) {
      const a = ys[i] - v
      const b = ys[i + 1] - v
      if (a === 0) return xs[i]
      if (a * b > 0) continue
      let x0 = xs[i]
      let x1 = xs[i + 1]
      for (let it = 0; it < 50; it++) {
        const m = (x0 + x1) / 2
        if ((fn(x0) - v) * (fn(m) - v) <= 0) x1 = m
        else x0 = m
      }
      return (x0 + x1) / 2
    }
    return undefined
  }
}

export function toRaw(value: number, cal: Calibration | undefined): number | undefined {
  return inverter(cal)?.(value)
}

export function applyCal(raw: number, cal: Calibration | null | undefined): number {
  const fn = calFn(cal)
  return fn ? fn(raw) : raw
}

export interface FitQuality {
  r2: number
  maxError: number
}

export function fitQuality(points: readonly Point[], fn: (x: number) => number): FitQuality {
  const pts = sortedPoints(points)
  const mean = pts.reduce((s, p) => s + p[1], 0) / (pts.length || 1)
  let ssRes = 0
  let ssTot = 0
  let maxError = 0
  for (const [x, y] of pts) {
    const e = y - fn(x)
    ssRes += e * e
    ssTot += (y - mean) ** 2
    maxError = Math.max(maxError, Math.abs(e))
  }
  return { r2: ssTot > 0 ? 1 - ssRes / ssTot : 1, maxError }
}
