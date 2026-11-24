import type { Overlay } from '../analysis/overlay'
import { formatLapTime, lowerBound, type Lap } from '../analysis/track'
import { channelTitle, type Channel } from '../data/session'
import type { Range } from '../plot/sync'
import { TIMESLIP_ID } from './analysis'

export interface SeriesModel {
  key: string
  channel: Channel
  slot: number
  label: string
  color: string
  dash?: number[]
  data: ArrayLike<number | null>
}

export interface Slot {
  label: string
  lap: Lap | null
  dash?: number[]
}

export interface SampleRange {
  slot: number
  start: number
  end: number
}

export interface XView {
  mode: 'time' | 'distance'
  x: ArrayLike<number>
  bounds: [number, number]
  minSpan: number
  unit: string
  formatX(v: number): string
  slots: Slot[]
  series(channels: Channel[]): SeriesModel[]
  samplesAt(idx: number): number[]
  visible(range: Range | null): SampleRange[]
  markers: { x: number; label: string }[]
}

export const SLOT_DASHES: (number[] | undefined)[] = [
  undefined,
  [7, 4],
  [2, 3],
  [12, 3, 2, 3],
  [1, 5],
  [5, 2, 5, 6],
]

const fmtTime = (v: number) => `${v.toFixed(3)} s`
const fmtDist = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(3)} km` : `${v.toFixed(1)} m`

export function timeView(time: Float64Array, laps: Lap[]): XView {
  const n = time.length
  const markers: { x: number; label: string }[] = []
  laps.forEach((l, i) => {
    markers.push({ x: l.t0, label: l.label === 'Out' ? 'Out' : `L${l.label}` })
    if (i === laps.length - 1 || laps[i + 1].start !== l.end) markers.push({ x: l.t1, label: '' })
  })
  return {
    mode: 'time',
    x: time,
    bounds: n > 0 ? [time[0], time[n - 1]] : [0, 1],
    minSpan: n > 1 ? (time[1] - time[0]) * 10 : 1,
    unit: 's',
    formatX: fmtTime,
    slots: [{ label: '', lap: null }],
    series: (channels) =>
      channels
        .filter((c) => c.id !== TIMESLIP_ID)
        .map((c) => ({
          key: c.id,
          channel: c,
          slot: 0,
          label: channelTitle(c),
          color: c.color,
          data: c.data,
        })),
    samplesAt: (idx) => [idx],
    visible(range) {
      if (!range || n === 0) return [{ slot: 0, start: 0, end: n - 1 }]
      return [
        {
          slot: 0,
          start: lowerBound(time, range.min),
          end: Math.max(0, lowerBound(time, range.max + 1e-9) - 1),
        },
      ]
    },
    markers,
  }
}

export function distanceView(overlay: Overlay): XView {
  const { grid, laps } = overlay
  const m = grid.length
  const slots: Slot[] = laps.map((lap, i) => ({
    label: lap.kind === 'lap' ? `L${lap.label}` : lap.label,
    lap,
    dash: SLOT_DASHES[i % SLOT_DASHES.length],
  }))
  const cache = new WeakMap<Channel, (number | null)[][]>()
  const resampled = (c: Channel, slot: number) => {
    let per = cache.get(c)
    if (!per) cache.set(c, (per = []))
    return (per[slot] ??=
      c.id === TIMESLIP_ID ? overlay.timeSlip(slot) : overlay.resample(c.data, slot))
  }
  return {
    mode: 'distance',
    x: grid,
    bounds: [0, grid[m - 1]],
    minSpan: overlay.step * 20,
    unit: 'm',
    formatX: fmtDist,
    slots,
    series(channels) {
      const out: SeriesModel[] = []
      for (const c of channels) {
        slots.forEach((s, slot) => {
          if (c.id === TIMESLIP_ID && slot === 0 && slots.length > 1) return
          out.push({
            key: `${c.id}@${slot}`,
            channel: c,
            slot,
            label:
              c.id === TIMESLIP_ID
                ? `${s.label} vs ${slots[0].label}`
                : `${channelTitle(c)} ${s.label}`,
            color: c.color,
            dash: s.dash,
            data: resampled(c, slot),
          })
        })
      }
      return out
    },
    samplesAt: (idx) => slots.map((_, s) => overlay.sampleAt(idx, s)),
    visible(range) {
      const a = range ? overlay.indexOf(range.min) : 0
      const b = range ? overlay.indexOf(range.max) : m - 1
      return slots.map((s, slot) => {
        const lap = s.lap!
        const start = overlay.sampleAt(a, slot)
        let end = overlay.sampleAt(b, slot)
        if (end < 0) end = lap.end
        return { slot, start: start < 0 ? lap.start : start, end }
      })
    },
    markers: [],
  }
}

export function slotSummary(view: XView): string {
  if (view.mode === 'time') return ''
  return view.slots
    .map((s, i) => `${s.label} ${formatLapTime(s.lap?.time ?? NaN)}${i === 0 ? ' (ref)' : ''}`)
    .join(' · ')
}
