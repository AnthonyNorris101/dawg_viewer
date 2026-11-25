import type { LapResult } from '../analysis/sim/lapsim'
import type { SimTrack } from '../analysis/sim/simtrack'
import { withOrigin } from '../data/origin'
import { CHANNEL_COLORS, type Channel, type Session } from '../data/session'
import { KMH } from './shared'

export const SIM_PATH = 'sim://lap'
export const SIM_RATE = 100
export const NOWHERE = { lat: 1, lon: 1 }
const EARTH_R = 6371008.8

export interface SimPart {
  label: string
  track: SimTrack
  result: LapResult
  offset?: Float64Array | null
}

export const isSimSession = (s: Session | null | undefined) => !!s?.simulated

let opened = 0

const COLUMNS = [
  { name: 'Speed', unit: 'km/h', precision: 1, hint: '' },
  { name: 'Long G', unit: 'g', precision: 2, hint: '+accel −brake' },
  { name: 'Lat G', unit: 'g', precision: 2, hint: '+left −right' },
  { name: 'RPM', unit: 'rpm', precision: 0, hint: '' },
  { name: 'Gear', unit: '', precision: 0, hint: '' },
  { name: 'Throttle', unit: '%', precision: 0, hint: '' },
  { name: 'Limit', unit: '', precision: 0, hint: '0 brake 1 corner 2 traction 3 power 4 shift' },
  { name: 'Curvature', unit: '1/m', precision: 4, hint: '+left −right' },
  { name: 'Line Offset', unit: 'm', precision: 2, hint: '+left −right' },
  { name: 'Latitude', unit: 'deg', precision: 7, hint: '' },
  { name: 'Longitude', unit: 'deg', precision: 7, hint: '' },
  { name: 'X', unit: 'm', precision: 1, hint: '' },
  { name: 'Y', unit: 'm', precision: 1, hint: '' },
] as const

type Column = (typeof COLUMNS)[number]['name']

export function simSession(name: string, parts: SimPart[]): Session | null {
  const laps = parts.filter((p) => p.result.time > 0 && p.result.t.length > 1)
  if (laps.length === 0) return null
  const counts = laps.map((p) => Math.max(2, Math.round(p.result.time * SIM_RATE)))
  const rows = counts.reduce((a, b) => a + b, 0) + 3
  const time = new Float64Array(rows)
  const col = Object.fromEntries(COLUMNS.map((c) => [c.name, new Float64Array(rows)])) as Record<
    Column,
    Float64Array
  >
  const origin = laps[0].track.origin ?? NOWHERE
  const rad = Math.PI / 180
  const kx = Math.cos(origin.lat * rad) * rad * EARTH_R
  const ky = rad * EARTH_R

  const write = (row: number, at: number, p: SimPart, j: number, f: number) => {
    const { track, result: r } = p
    const n = r.t.length
    const b = j + 1 < n ? j + 1 : track.closed ? 0 : j
    const mix = (a: ArrayLike<number>) => a[j] + (a[b] - a[j]) * f
    const pick = (a: ArrayLike<number>) => a[f < 0.5 ? j : b]
    const x = mix(track.x)
    const y = mix(track.y)
    time[row] = at
    col.Speed[row] = mix(r.v) * KMH
    col['Long G'][row] = mix(r.ax)
    col['Lat G'][row] = mix(r.ay)
    col.RPM[row] = mix(r.rpm)
    col.Gear[row] = pick(r.gear)
    col.Throttle[row] = mix(r.throttle) * 100
    col.Limit[row] = pick(r.limit)
    col.Curvature[row] = mix(track.k)
    col['Line Offset'][row] = p.offset ? mix(p.offset) : 0
    col.Latitude[row] = origin.lat + y / ky
    col.Longitude[row] = origin.lon + x / kx
    col.X[row] = x
    col.Y[row] = y
  }

  const marks: number[] = []
  let row = 0
  let start = 1 / SIM_RATE
  write(row++, 0, laps[0], 0, 0)
  laps.forEach((p, i) => {
    const r = p.result
    const n = r.t.length
    const dt = r.time / counts[i]
    marks.push(start)
    let j = 0
    for (let q = 0; q < counts[i]; q++) {
      const at = q * dt
      while (j < n - 1 && r.t[j + 1] <= at) j++
      const next = j + 1 < n ? r.t[j + 1] : r.time
      const f = next > r.t[j] ? Math.min(1, (at - r.t[j]) / (next - r.t[j])) : 0
      write(row++, q === 0 ? start : start + at, p, j, f)
    }
    start += r.time
  })
  const last = laps[laps.length - 1]
  const end = last.result.t.length - 1
  marks.push(start)
  write(row++, start, last, end, last.track.closed ? 1 : 0)
  write(row++, start + 1 / SIM_RATE, last, end, last.track.closed ? 1 : 0)

  const offsets = laps.some((p) => p.offset)
  const channels: Channel[] = COLUMNS.filter((c) => offsets || c.name !== 'Line Offset').map(
    (c, i) => ({
      id: c.name,
      name: c.name,
      label: withOrigin(c.hint ? `${c.name} (${c.hint})` : c.name, 'theory'),
      hint: c.hint || undefined,
      origin: 'theory',
      group: 'Sim',
      unit: c.unit,
      precision: c.precision,
      color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
      data: col[c.name],
    }),
  )
  const list = laps.map((p, i) => `lap ${i + 1}: ${p.label}`).join('; ')
  return {
    name,
    path: `${SIM_PATH}/${++opened}`,
    source: 'sim',
    note: `simulated from the Car tab, nothing here was measured · ${list}${
      laps[0].track.origin
        ? ''
        : ' · this track has no real location, so the map position is made up'
    }`,
    sampleRate: SIM_RATE,
    time,
    channels,
    byId: new Map(channels.map((c) => [c.id, c])),
    simulated: true,
    fixedLaps: marks,
  }
}
