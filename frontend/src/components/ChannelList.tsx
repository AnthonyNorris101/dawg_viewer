import { memo, useMemo, useState, type Dispatch } from 'react'
import type { Channel } from '../data/session'

export type ListChannel = Pick<Channel, 'id' | 'name' | 'group' | 'unit' | 'color'>
import type { LayoutAction } from '../state/layout'

interface Props {
  channels: ListChannel[]
  selectedIds: string[]
  dispatch: Dispatch<LayoutAction>
}

export const ChannelList = memo(function ChannelList({ channels, selectedIds, dispatch }: Props) {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = new Map<string, ListChannel[]>()
    for (const ch of channels) {
      if (q && !ch.name.toLowerCase().includes(q) && !ch.group.toLowerCase().includes(q)) continue
      const list = out.get(ch.group)
      if (list) list.push(ch)
      else out.set(ch.group, [ch])
    }
    return [...out]
  }, [channels, query])

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])

  return (
    <aside className="flex w-60 max-w-[30%] shrink-0 flex-col overflow-hidden border-r border-zinc-800 bg-zinc-900/40">
      <div className="border-b border-zinc-800 p-2">
        <input
          aria-label="Filter channels"
          className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm outline-none placeholder:text-zinc-500 focus:border-red-500"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter channels"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {groups.length === 0 && (
          <p className="px-3 py-2 text-sm text-zinc-600">No channels match</p>
        )}
        {groups.map(([group, list]) => (
          <div key={group}>
            <h2 className="px-3 pt-2 pb-1 text-[11px] tracking-wider text-zinc-500 uppercase">
              {group}
            </h2>
            {list.map((ch) => {
              const on = selected.has(ch.id)
              return (
                <button
                  key={ch.id}
                  type="button"
                  aria-pressed={on}
                  className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm hover:bg-zinc-800 ${
                    on ? 'text-zinc-100' : 'text-zinc-400'
                  }`}
                  onClick={() => dispatch({ type: 'toggleChannel', channelId: ch.id })}
                >
                  <span
                    className="size-2.5 shrink-0 rounded-sm border"
                    style={{ borderColor: ch.color, background: on ? ch.color : 'transparent' }}
                  />
                  <span className="min-w-0 flex-1 truncate">{ch.name}</span>
                  <span className="shrink-0 text-xs text-zinc-600">{ch.unit}</span>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </aside>
  )
})
