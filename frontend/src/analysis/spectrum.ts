export function fft(re: Float64Array, im: Float64Array) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang)
    const wi = Math.sin(ang)
    const half = len >> 1
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < half; k++) {
        const a = i + k
        const b = a + half
        const xr = re[b] * cr - im[b] * ci
        const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr
        im[b] = im[a] - xi
        re[a] += xr
        im[a] += xi
        const t = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = t
      }
    }
  }
}

export function uniform(
  time: ArrayLike<number>,
  data: ArrayLike<number>,
  start: number,
  end: number,
): { values: Float64Array; rate: number } | null {
  const n = end - start + 1
  if (n < 8) return null
  const span = time[end] - time[start]
  if (!(span > 0)) return null
  const rate = (n - 1) / span
  const out = new Float64Array(n)
  let i = start
  let last = NaN
  for (let k = 0; k < n; k++) {
    const t = time[start] + k / rate
    while (i < end && time[i + 1] <= t) i++
    const a = data[i]
    const b = i < end ? data[i + 1] : a
    const dt = i < end ? time[i + 1] - time[i] : 0
    const f = dt > 0 ? (t - time[i]) / dt : 0
    let v = a + (b - a) * f
    if (!Number.isFinite(v)) v = Number.isFinite(a) ? a : last
    out[k] = v
    if (Number.isFinite(v)) last = v
  }
  const first = out.findIndex((v) => Number.isFinite(v))
  if (first < 0) return null
  for (let k = 0; k < first; k++) out[k] = out[first]
  return { values: out, rate }
}

export interface Spectrum {
  freq: Float64Array
  psd: Float64Array
  rate: number
  segments: number
  size: number
}

export function welch(values: Float64Array, rate: number, size: number): Spectrum | null {
  let n = 1
  while (n * 2 <= Math.min(size, values.length)) n *= 2
  if (n < 16) return null
  const win = new Float64Array(n)
  let wsum = 0
  for (let i = 0; i < n; i++) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
    wsum += win[i] * win[i]
  }
  const bins = n / 2 + 1
  const psd = new Float64Array(bins)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const step = n / 2
  let segments = 0
  for (let s = 0; s + n <= values.length; s += step) {
    let mean = 0
    for (let i = 0; i < n; i++) mean += values[s + i]
    mean /= n
    for (let i = 0; i < n; i++) {
      re[i] = (values[s + i] - mean) * win[i]
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < bins; k++) psd[k] += re[k] * re[k] + im[k] * im[k]
    segments++
  }
  const scale = 1 / (rate * wsum * segments)
  for (let k = 0; k < bins; k++) psd[k] *= k === 0 || k === bins - 1 ? scale : 2 * scale
  const freq = new Float64Array(bins)
  for (let k = 0; k < bins; k++) freq[k] = (k * rate) / n
  return { freq, psd, rate, segments, size: n }
}

export function peak(s: Spectrum, minHz = 0.5): { hz: number; psd: number } | null {
  let best = -1
  for (let k = 1; k < s.freq.length; k++) {
    if (s.freq[k] < minHz) continue
    if (best < 0 || s.psd[k] > s.psd[best]) best = k
  }
  return best < 0 ? null : { hz: s.freq[best], psd: s.psd[best] }
}

export const toDb = (p: number) => (p > 0 ? 10 * Math.log10(p) : null)

export function biquad(
  x: Float64Array,
  rate: number,
  hz: number,
  kind: 'low' | 'high',
): Float64Array {
  const n = x.length
  if (!(hz > 0) || !(rate > 0) || hz >= rate / 2) return x.slice()
  const w = Math.tan((Math.PI * hz) / rate)
  const q = Math.SQRT1_2
  const norm = 1 / (1 + w / q + w * w)
  const b0 = kind === 'low' ? w * w * norm : norm
  const b1 = kind === 'low' ? 2 * b0 : -2 * b0
  const b2 = b0
  const a1 = 2 * (w * w - 1) * norm
  const a2 = (1 - w / q + w * w) * norm

  const pass = (src: Float64Array, reverse: boolean) => {
    const out = new Float64Array(n)
    const at = (i: number) => (reverse ? n - 1 - i : i)
    const first = src[at(0)]
    const settle = kind === 'low' ? first : 0
    let x1 = first
    let x2 = first
    let y1 = settle
    let y2 = settle
    for (let i = 0; i < n; i++) {
      const xi = Number.isFinite(src[at(i)]) ? src[at(i)] : x1
      const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
      out[at(i)] = y
      x2 = x1
      x1 = xi
      y2 = y1
      y1 = y
    }
    return out
  }
  return pass(pass(x, false), true)
}

export type GainPoint = [number, number]

export function shapeGain(points: readonly GainPoint[], f: number): number {
  const n = points.length
  if (n === 0) return 1
  if (!(f > points[0][0])) return points[0][1]
  if (f >= points[n - 1][0]) return points[n - 1][1]
  let i = 1
  while (points[i][0] < f) i++
  const [f0, g0] = points[i - 1]
  const [f1, g1] = points[i]
  const t = (Math.log(f) - Math.log(f0)) / (Math.log(f1) - Math.log(f0))
  return g0 + (g1 - g0) * t
}

export function shapeFilter(
  x: Float64Array,
  rate: number,
  points: readonly GainPoint[],
): Float64Array {
  const n = x.length
  if (n < 4 || !(rate > 0) || points.length === 0) return x.slice()
  const src = new Float64Array(n)
  let last = NaN
  for (let i = 0; i < n && !Number.isFinite(last); i++) last = x[i]
  if (!Number.isFinite(last)) return x.slice()
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(x[i])) last = x[i]
    src[i] = last
  }
  const pad = Math.min(n - 1, Math.max(64, Math.round(rate * 2)))
  const len = n + 2 * pad
  let size = 1
  while (size < len) size <<= 1
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < pad; i++) re[i] = src[pad - i]
  re.set(src, pad)
  for (let i = 0; i < pad; i++) re[pad + n + i] = src[n - 2 - i]
  const tail = re[len - 1]
  for (let i = len; i < size; i++) re[i] = tail
  fft(re, im)
  for (let k = 0; k < size; k++) {
    const f = ((k <= size / 2 ? k : size - k) * rate) / size
    const g = shapeGain(points, f)
    re[k] *= g
    im[k] = -im[k] * g
  }
  fft(re, im)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = re[pad + i] / size
  return out
}
