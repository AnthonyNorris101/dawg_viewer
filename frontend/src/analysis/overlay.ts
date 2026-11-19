import type { Lap } from './track'

export interface Overlay {
  grid: Float64Array
  laps: Lap[]
  step: number
  lo: Int32Array[]
  frac: Float32Array[]
  resample(data: ArrayLike<number>, slot: number): (number | null)[]
  lapTime(slot: number): (number | null)[]
  timeSlip(slot: number): (number | null)[]
  sampleAt(gridIdx: number, slot: number): number
  indexOf(distance: number): number
}

const MAX_POINTS = 5000

export function buildOverlay(
  time: Float64Array,
  distance: Float64Array,
  laps: Lap[],
  normalize = true,
): Overlay | null {
  if (laps.length === 0) return null
  const lens = laps.map((l) => distance[l.end] - distance[l.start])
  const refLen = lens[0]
  if (!(refLen > 1)) return null
  const scales = laps.map((_, i) => (normalize && lens[i] > 1 ? refLen / lens[i] : 1))
  const maxLen = Math.max(...lens.map((len, i) => len * scales[i]))
  const step = Math.max(0.25, maxLen / MAX_POINTS)
  const m = Math.floor(maxLen / step) + 1
  const grid = new Float64Array(m)
  for (let j = 0; j < m; j++) grid[j] = j * step

  const lo: Int32Array[] = []
  const frac: Float32Array[] = []
  laps.forEach((lap, s) => {
    const L = new Int32Array(m).fill(-1)
    const F = new Float32Array(m)
    const d0 = distance[lap.start]
    const k = scales[s]
    let i = lap.start
    for (let j = 0; j < m; j++) {
      const g = grid[j]
      while (i < lap.end && (distance[i + 1] - d0) * k <= g) i++
      if (i >= lap.end) {
        if ((distance[lap.end] - d0) * k >= g - step / 2) {
          L[j] = lap.end - 1
          F[j] = 1
        }
        continue
      }
      const a = (distance[i] - d0) * k
      const b = (distance[i + 1] - d0) * k
      L[j] = i
      F[j] = b > a ? Math.min(1, Math.max(0, (g - a) / (b - a))) : 0
    }
    lo.push(L)
    frac.push(F)
  })

  const resample = (data: ArrayLike<number>, slot: number) => {
    const L = lo[slot]
    const F = frac[slot]
    const out = new Array<number | null>(m)
    for (let j = 0; j < m; j++) {
      const i = L[j]
      if (i < 0) {
        out[j] = null
        continue
      }
      const v = data[i] + (data[i + 1] - data[i]) * F[j]
      out[j] = Number.isFinite(v) ? v : null
    }
    return out
  }

  const lapTime = (slot: number) => {
    const t0 = time[laps[slot].start]
    return resample(time, slot).map((t) => (t == null ? null : t - t0))
  }

  const refTime = lapTime(0)
  const timeSlip = (slot: number) => {
    const t = slot === 0 ? refTime : lapTime(slot)
    return t.map((v, j) => (v == null || refTime[j] == null ? null : v - refTime[j]!))
  }

  return {
    grid,
    laps,
    step,
    lo,
    frac,
    resample,
    lapTime,
    timeSlip,
    sampleAt(j, slot) {
      const L = lo[slot]
      if (!L || j < 0 || j >= m || L[j] < 0) return -1
      return frac[slot][j] < 0.5 ? L[j] : L[j] + 1
    },
    indexOf: (d) => Math.max(0, Math.min(m - 1, Math.round(d / step))),
  }
}
