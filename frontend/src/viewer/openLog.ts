import { LogService } from '../../bindings/dawg_viewer/services'
import type { Session } from '../data/session'
import { sessionFromColumns } from '../data/columns'
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

  return sessionFromColumns(buf, rows, channelsIn, log, info.get()?.channels ?? {})
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
