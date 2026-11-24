import type { ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'
import { CHANNEL_COLORS, type Channel, type Session } from './session'

// Float64Array.from(data, fn) goes through the iterator protocol and is
// ~40x slower than this loop on long columns.
export function mapColumn(data: ArrayLike<number>, fn: (v: number) => number): Float64Array {
  const n = data.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = fn(data[i])
  return out
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
  const duration = rows > 1 ? time[rows - 1] - time[0] : 0
  return {
    name: log.name,
    path: log.path,
    source: log.source,
    note: log.note,
    sampleRate: duration > 0 ? Math.round((rows - 1) / duration) : 0,
    time,
    channels,
    byId: new Map(channels.map((c) => [c.id, c])),
  }
}
