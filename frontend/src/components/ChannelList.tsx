import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
} from 'react'
import { groupRank } from '../data/groups'
import { hoverChannel, useHoveredChannel } from '../data/sensors'
import type { Channel } from '../data/session'
import { useInfo } from '../live/connection'
import type { LayoutAction } from '../state/layout'
import { persisted } from '../state/storage'
import { CarDiagram, type DiagramChannel } from './CarDiagram'
import { SensorEditorDialog } from './SensorEditor'

const carOpen = persisted('dawg.carmap.v1', true, (v): v is boolean => typeof v === 'boolean')

export type ListChannel = Pick<Channel, 'id' | 'name' | 'group' | 'unit' | 'color'> & {
  label?: string
}

interface Props {
  channels: ListChannel[]
  selectedIds: string[]
  dispatch: Dispatch<LayoutAction>
  onEdit?: (id: string) => void
  editable?: (id: string) => boolean
  onFilter?: (id: string) => void
  deletable?: (id: string) => boolean
  onDelete?: (id: string) => void
}

export const ChannelList = memo(function ChannelList({
  channels,
  selectedIds,
  dispatch,
  onEdit,
  editable,
  onFilter,
  deletable,
  onDelete,
}: Props) {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const out = new Map<string, ListChannel[]>()
    for (const ch of channels) {
      const text = `${ch.name} ${ch.label ?? ''} ${ch.group}`.toLowerCase()
      if (q && !text.includes(q)) continue
      const list = out.get(ch.group)
      if (list) list.push(ch)
      else out.set(ch.group, [ch])
    }
    return [...out].sort(([a], [b]) => groupRank(a) - groupRank(b) || a.localeCompare(b))
  }, [channels, query])

  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const hovered = useHoveredChannel()
  const showCar = useSyncExternalStore(carOpen.subscribe, carOpen.get)
  const metas = useInfo()?.channels
  const diagram = useMemo<DiagramChannel[]>(
    () => channels.map((c) => ({ ...c, pos: metas?.[c.name]?.pos })),
    [channels, metas],
  )
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const list = listRef.current
    if (!hovered || !list || list.matches(':hover')) return
    const row = list.querySelector(`[data-channel="${CSS.escape(hovered)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [hovered])

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-900/40">
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

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
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
              const title = ch.label || ch.name
              return (
                <div
                  key={ch.id}
                  data-channel={ch.id}
                  className={`group flex items-center hover:bg-zinc-800 ${
                    hovered === ch.id ? 'bg-zinc-800' : ''
                  }`}
                  onMouseEnter={() => hoverChannel.set(ch.id)}
                  onMouseLeave={() => hoverChannel.set(null)}
                >
                  <button
                    type="button"
                    aria-pressed={on}
                    title={ch.label && ch.label !== ch.name ? ch.name : undefined}
                    className={`flex min-w-0 flex-1 items-center gap-2 py-1 pl-3 text-left text-sm ${
                      on ? 'text-zinc-100' : 'text-zinc-400'
                    } ${onEdit ? 'pr-1' : 'pr-3'}`}
                    onClick={() => dispatch({ type: 'toggleChannel', channelId: ch.id })}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-sm border"
                      style={{ borderColor: ch.color, background: on ? ch.color : 'transparent' }}
                    />
                    <span className="min-w-0 flex-1 truncate">{title}</span>
                    <span className="shrink-0 text-xs text-zinc-600">{ch.unit}</span>
                  </button>
                  {onDelete && deletable?.(ch.id) && (
                    <button
                      type="button"
                      aria-label={
                        confirmDelete === ch.id ? `Confirm delete ${title}` : `Delete ${title}`
                      }
                      title={
                        confirmDelete === ch.id
                          ? 'Click again to delete'
                          : 'Delete this made channel'
                      }
                      className={`shrink-0 px-1 text-xs ${
                        confirmDelete === ch.id
                          ? 'text-red-400'
                          : 'text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-red-300 focus-visible:opacity-100'
                      }`}
                      onClick={() => {
                        if (confirmDelete === ch.id) {
                          setConfirmDelete('')
                          onDelete(ch.id)
                        } else setConfirmDelete(ch.id)
                      }}
                      onBlur={() => setConfirmDelete('')}
                    >
                      {confirmDelete === ch.id ? 'Delete?' : '🗑'}
                    </button>
                  )}
                  {onFilter && (
                    <button
                      type="button"
                      aria-label={`Filter ${title}`}
                      title={
                        ch.group === 'Math'
                          ? 'Change the filter (or make a filtered copy of a math channel)'
                          : 'Make a filtered copy (low-pass, high-pass, band-pass…)'
                      }
                      className="shrink-0 px-1 text-xs text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-200 focus-visible:opacity-100"
                      onClick={() => onFilter(ch.id)}
                    >
                      ∿
                    </button>
                  )}
                  {onEdit && (editable?.(ch.id) ?? true) && (
                    <button
                      type="button"
                      aria-label={`Edit ${title}`}
                      title="Title, colour, group, unit and calibration"
                      className="shrink-0 px-2 text-xs text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-200 focus-visible:opacity-100"
                      onClick={() => onEdit(ch.id)}
                    >
                      ✎
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>

      <div className="border-t border-zinc-800">
        <div className="flex items-center">
          <button
            type="button"
            aria-expanded={showCar}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-3 text-left text-[11px] tracking-wider text-zinc-500 uppercase hover:text-zinc-300"
            onClick={() => carOpen.set(!showCar)}
          >
            <span className="w-3">{showCar ? '▾' : '▸'}</span>
            Sensor map
          </button>
          <button
            type="button"
            className="shrink-0 px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-200"
            aria-label="Edit sensor map"
            title="Move the sensors to where they are on your car"
            onClick={() => setEditing(true)}
          >
            ✎ Edit
          </button>
        </div>
        {editing && (
          <SensorEditorDialog
            extra={editable ? channels.filter((c) => editable(c.id)) : channels}
            onClose={() => setEditing(false)}
          />
        )}
        {showCar && (
          <div className="pb-2">
            <CarDiagram
              channels={diagram}
              selectedIds={selectedIds}
              height="clamp(9rem, 30vh, 15rem)"
              onPick={(id) => dispatch({ type: 'toggleChannel', channelId: id })}
              hint="Point at a channel to see where it is on the car. Click a dot to plot it."
            />
          </div>
        )}
      </div>
    </aside>
  )
})
