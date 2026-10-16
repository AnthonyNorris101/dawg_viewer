import { LogService } from '../../bindings/dawg_viewer/services'
import { CHANNEL_COLORS, type Channel, type Session } from '../data/session'
import { info } from '../live/connection'

export async function openLog(path: string): Promise<Session> {
  const log = await LogService.Load(path)
  if (!log) throw new Error(`Couldn't read ${path}`)

  const res = await fetch(log.dataUrl)
  if (!res.ok) throw new Error(`Couldn't read the data for ${log.name} (${res.status})`)
  const buf = await res.arrayBuffer()
  const rows = log.rows
  const channelsIn = log.channels ?? []
  if (buf.byteLength !== (channelsIn.length + 1) * rows * 8) {
    throw new Error(`The data for ${log.name} arrived incomplete`)
  }

  const metas = info.get()?.channels ?? {}
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
    note: log.note,
    sampleRate: duration > 0 ? Math.round((rows - 1) / duration) : 0,
    time,
    channels,
    byId: new Map(channels.map((c) => [c.id, c])),
  }
}

export async function pickAndOpenLog(): Promise<Session | null> {
  const path = await LogService.PickFile()
  return path ? openLog(path) : null
}

const PREFERRED = [
  ['RPM', 'TPS1'],
  ['CLT1', 'OilTemp', 'RadTemp'],
  ['AccelX', 'AccelY'],
]

export function startingPanels(session: Session): string[][] {
  const panels = PREFERRED.map((p) => p.filter((n) => session.byId.has(n))).filter(
    (p) => p.length > 0,
  )
  if (panels.length > 0) return panels
  const ids = session.channels.map((c) => c.id)
  return [ids.slice(0, 2), ids.slice(2, 4)].filter((p) => p.length > 0)
}
