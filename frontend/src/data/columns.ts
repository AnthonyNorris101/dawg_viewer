import type { ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'
import { accelAxes, headingFromPosition, type Heading } from '../analysis/accel'
import { findGps, findSpeed, guessSpeedUnit, TO_MPS } from '../analysis/track'
import { CHANNEL_COLORS, type Channel, type Session } from './session'

// Float64Array.from(data, fn) goes through the iterator protocol and is
// ~40x slower than this loop on long columns.
export function mapColumn(data: ArrayLike<number>, fn: (v: number) => number): Float64Array {
  const n = data.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = fn(data[i])
  return out
}

export const GPS_SPEED = 'GPS Speed'
const MPS_TO_MPH = 1 / TO_MPS.mph

function headingOf(channels: Channel[], rate: number): Heading | null {
  const named = (n: string) => channels.find((c) => c.name.toLowerCase() === n)
  const north = named('velnorth')
  const east = named('veleast')
  if (north && east) return { north: north.data, east: east.data }
  const gps = findGps(channels)
  return gps && rate > 0 ? headingFromPosition(gps.lat, gps.lon, rate) : null
}

function gpsSpeed(channels: Channel[]): Channel | null {
  if (findSpeed(channels)) return null
  const named = (n: string) => channels.find((c) => c.name.toLowerCase() === n)
  const north = named('velnorth')
  const east = named('veleast')
  if (!north || !east) return null
  const scale = (north.unit ? TO_MPS[guessSpeedUnit(north.unit)] : 1) * MPS_TO_MPH
  const data = new Float64Array(north.data.length)
  for (let i = 0; i < data.length; i++) data[i] = Math.hypot(north.data[i], east.data[i]) * scale
  return {
    id: GPS_SPEED,
    name: GPS_SPEED,
    group: 'Log',
    unit: 'mph',
    color: CHANNEL_COLORS[channels.length % CHANNEL_COLORS.length],
    precision: 1,
    data,
  }
}

export function sessionFromColumns(
  buf: ArrayBuffer,
  rows: number,
  channelsIn: { name: string; unit: string }[],
  log: { name: string; path: string; source: string; note: string },
  metas: Record<string, ChannelMeta | undefined> = {},
): Session {
  const time = new Float64Array(buf, 0, rows)
  const channels: Channel[] = channelsIn.map((c, i) => ({
    id: c.name,
    name: c.name,
    group: 'Log',
    unit: c.unit || metas[c.name]?.unit || '',
    color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
    precision: metas[c.name]?.precision ?? 2,
    data: new Float64Array(buf, (i + 1) * rows * 8, rows),
  }))
  const speed = gpsSpeed(channels)
  if (speed) channels.push(speed)
  const duration = rows > 1 ? time[rows - 1] - time[0] : 0
  const sampleRate = duration > 0 ? Math.round((rows - 1) / duration) : 0
  const axes = accelAxes(
    channels,
    sampleRate,
    findSpeed(channels)?.data,
    headingOf(channels, sampleRate),
  )
  for (const r of axes.raw) {
    const i = channels.findIndex((c) => c.name === r.name)
    if (i >= 0) channels[i] = { ...channels[i], hint: r.hint }
  }
  for (const g of axes.clean)
    channels.push({
      id: g.name,
      name: g.name,
      hint: g.hint,
      group: 'Log',
      unit: 'g',
      color: CHANNEL_COLORS[channels.length % CHANNEL_COLORS.length],
      precision: 2,
      data: g.data,
    })
  return {
    name: log.name,
    path: log.path,
    source: log.source,
    note: log.note,
    sampleRate,
    time,
    channels,
    byId: new Map(channels.map((c) => [c.id, c])),
  }
}
