import { memo, useEffect, useMemo, useRef, type Dispatch } from 'react'
import type { Session } from '../data/session'
import { mountPlot } from '../plot/mountPlot'
import type { ViewSync } from '../plot/sync'
import type { LayoutAction, Panel } from '../state/layout'
import { PanelResizeHandle } from './PanelResizeHandle'

interface Props {
  panel: Panel
  index: number
  active: boolean
  session: Session
  sync: ViewSync
  dispatch: Dispatch<LayoutAction>
}

const NO_VALUE = '–'

export const PlotPanel = memo(function PlotPanel({
  panel,
  index,
  active,
  session,
  sync,
  dispatch,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const valueEls = useRef(new Map<string, HTMLSpanElement>())

  const channels = useMemo(
    () => panel.channelIds.flatMap((id) => session.byId.get(id) ?? []),
    [panel.channelIds, session],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host || channels.length === 0) return
    const { time } = session
    const plot = mountPlot(host, {
      series: channels,
      data: [time, ...channels.map((ch) => ch.data)],
      sync,
      bounds: () => [time[0], time[time.length - 1]],
      minSpan: (time[1] - time[0]) * 10,
      onCursor: (idx) => {
        for (const ch of channels) {
          const el = valueEls.current.get(ch.id)
          if (el) el.textContent = idx == null ? NO_VALUE : ch.data[idx].toFixed(ch.precision)
        }
      },
    })
    return plot.destroy
  }, [channels, session, sync])

  return (
    <section
      ref={panelRef}
      style={panel.heightPx ? { flex: `0 0 ${panel.heightPx}px` } : undefined}
      className={`relative flex min-h-48 w-full min-w-0 flex-1 flex-col overflow-hidden border-l-2 bg-zinc-950 ${
        active ? 'border-red-500' : 'border-transparent'
      }`}
      onPointerDown={() => dispatch({ type: 'setActive', panelId: panel.id })}
    >
      <header className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1 text-xs">
        <span className="shrink-0 text-zinc-500">Plot {index + 1}</span>
        <ul className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
          {channels.map((ch) => (
            <li key={ch.id} className="group flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: ch.color }} />
              <span className="text-zinc-300">{ch.name}</span>
              <span
                ref={(el) => {
                  if (el) valueEls.current.set(ch.id, el)
                  else valueEls.current.delete(ch.id)
                }}
                className="min-w-12 text-right text-zinc-100 tabular-nums"
              >
                {NO_VALUE}
              </span>
              <span className="text-zinc-500">{ch.unit}</span>
              <button
                type="button"
                aria-label={`Remove ${ch.name}`}
                className="text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-200 focus-visible:opacity-100"
                onClick={() =>
                  dispatch({ type: 'removeChannel', panelId: panel.id, channelId: ch.id })
                }
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          aria-label={`Close plot ${index + 1}`}
          className="shrink-0 text-zinc-600 hover:text-zinc-200"
          onClick={() => dispatch({ type: 'removePanel', panelId: panel.id })}
        >
          ✕
        </button>
      </header>

      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {channels.length === 0 ? (
          <p className="absolute inset-0 grid place-items-center text-sm text-zinc-600">
            Pick channels from the list to plot them here
          </p>
        ) : (
          <div ref={hostRef} className="absolute inset-0" />
        )}
      </div>
      <PanelResizeHandle
        panelId={panel.id}
        index={index}
        edge="top"
        heightPx={panel.heightPx}
        panelRef={panelRef}
        dispatch={dispatch}
      />
      <PanelResizeHandle
        panelId={panel.id}
        index={index}
        edge="bottom"
        heightPx={panel.heightPx}
        panelRef={panelRef}
        dispatch={dispatch}
      />
    </section>
  )
})
