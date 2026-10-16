import { LogService } from '../../bindings/dawg_viewer/services'
import type { ViewerLog } from '../../bindings/dawg_viewer/services/models'
import { CHANNEL_COLORS, type Channel, type Session } from '../data/session'
import { info } from '../live/connection'

async function float64s(base64: string | null): Promise<Float64Array> {
  if (!base64) return new Float64Array(0)
  const res = await fetch(`data:application/octet-stream;base64,${base64}`)
  return new Float64Array(await res.arrayBuffer())
}

async function toSession(log: ViewerLog): Promise<Session> {
  const metas = info.get()?.channels ?? {}
  const time = await float64s(log.time)
  const channels: Channel[] = await Promise.all(
    (log.channels ?? []).map(async (c, i) => ({
      id: c.name,
      name: c.name,
      group: 'Log',
      unit: metas[c.name]?.unit ?? '',
      color: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
      precision: metas[c.name]?.precision ?? 2,
      data: await float64s(c.values),
    })),
  )
  const duration = time.length > 1 ? time[time.length - 1] - time[0] : 0
  return {
    name: log.name,
    path: log.path,
    sampleRate: duration > 0 ? Math.round((time.length - 1) / duration) : 0,
    time,
    channels,
    byId: new Map(channels.map((c) => [c.id, c])),
  }
}

export async function openLog(path: string): Promise<Session> {
  const log = await LogService.Load(path)
  if (!log) throw new Error(`Couldn't read ${path}`)
  return toSession(log)
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
