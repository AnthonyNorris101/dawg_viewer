import type { Channel as LiveChannel } from '../../bindings/dawg_viewer/internal/live/models'
import type { ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'
import type { Channel, Session } from '../data/session'
import type { LiveStore } from './store'

export const LIVE_PATH = 'live://session'

export function createLiveSessionReader(store: LiveStore, colorFor: (name: string) => string) {
  let revision = -1
  let time = new Float64Array(0)
  let columns = new Map<string, Float64Array>()
  let previous: {
    channels: LiveChannel[]
    metas: Record<string, ChannelMeta | undefined>
    name: string
    session: Session
  } | null = null

  return (
    channels: LiveChannel[],
    metas: Record<string, ChannelMeta | undefined>,
    name: string,
  ): Session | null => {
    if (store.length < 2) {
      previous = null
      columns.clear()
      time = new Float64Array(0)
      revision = -1
      return null
    }
    const changed = revision !== store.revision
    if (
      !changed &&
      previous?.channels === channels &&
      previous.metas === metas &&
      previous.name === name
    )
      return previous.session
    if (changed) {
      time = store.times().slice()
      columns = new Map()
      revision = store.revision
    }
    const out: Channel[] = []
    for (const c of channels) {
      let data = columns.get(c.name)
      if (!data) {
        const column = store.column(c.name)
        if (!column) continue
        data = column.slice()
        columns.set(c.name, data)
      }
      const meta = metas[c.name] ?? c.meta
      out.push({
        id: c.name,
        name: c.name,
        group: 'Log',
        unit: meta?.unit ?? '',
        color: colorFor(c.name),
        precision: meta?.precision ?? 2,
        data,
      })
    }
    const n = time.length
    const duration = time[n - 1] - time[0]
    const session: Session = {
      name: `Live data · ${name || 'logger'}`,
      path: LIVE_PATH,
      source: 'live',
      note: 'updates every second',
      sampleRate: duration > 0 ? Math.round((n - 1) / duration) : 0,
      time,
      channels: out,
      byId: new Map(out.map((c) => [c.id, c])),
    }
    previous = { channels, metas, name, session }
    return session
  }
}
