export interface Stats {
  min: number
  max: number
  mean: number
  std: number
  count: number
}

export function rangeStats(data: ArrayLike<number>, start: number, end: number): Stats {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let sq = 0
  let count = 0
  const hi = Math.min(end, data.length - 1)
  for (let i = Math.max(0, start); i <= hi; i++) {
    const v = data[i]
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
    sum += v
    sq += v * v
    count++
  }
  if (count === 0) return { min: NaN, max: NaN, mean: NaN, std: NaN, count }
  const mean = sum / count
  return { min, max, mean, std: Math.sqrt(Math.max(0, sq / count - mean * mean)), count }
}

export interface Histogram {
  lo: number
  hi: number
  width: number
  counts: number[]
  total: number
}

export function histogram(
  sets: { data: ArrayLike<number>; start: number; end: number }[],
  bins: number,
  range?: [number, number],
): Histogram | null {
  let lo = range?.[0] ?? Infinity
  let hi = range?.[1] ?? -Infinity
  if (!range) {
    for (const s of sets) {
      const st = rangeStats(s.data, s.start, s.end)
      if (st.count === 0) continue
      lo = Math.min(lo, st.min)
      hi = Math.max(hi, st.max)
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  if (hi <= lo) {
    hi = lo + 1
    lo = lo - 1
  }
  const width = (hi - lo) / bins
  const counts = new Array<number>(bins).fill(0)
  let total = 0
  for (const s of sets) {
    const end = Math.min(s.end, s.data.length - 1)
    for (let i = Math.max(0, s.start); i <= end; i++) {
      const v = s.data[i]
      if (!Number.isFinite(v)) continue
      const b = Math.min(bins - 1, Math.max(0, Math.floor((v - lo) / width)))
      counts[b]++
      total++
    }
  }
  return { lo, hi, width, counts, total }
}

export function niceTicks(lo: number, hi: number, target = 6): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return []
  const raw = (hi - lo) / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const norm = raw / mag
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag
  const out: number[] = []
  const last = Math.floor(hi / step + 1e-9)
  for (let k = Math.ceil(lo / step - 1e-9); k <= last; k++) {
    out.push(k === 0 ? 0 : Number((k * step).toPrecision(12)))
  }
  return out
}

export function formatTick(v: number, span: number): string {
  const digits = span >= 50 ? 0 : span >= 5 ? 1 : span >= 0.5 ? 2 : 3
  return v.toFixed(digits)
}
