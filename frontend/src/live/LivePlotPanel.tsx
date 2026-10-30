import { memo, useEffect, useMemo, useRef, type Dispatch } from 'react'
import type uPlot from 'uplot'
import type { ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'
import { mountPlot } from '../plot/mountPlot'
import type { ViewSync } from '../plot/sync'
import type { LayoutAction, Panel } from '../state/layout'
import { PanelResizeHandle } from '../components/PanelResizeHandle'
import { colorFor, store } from './connection'
import { formatValue } from './format'

interface Props {
  panel: Panel
  index: number
  active: boolean
  known: ReadonlySet<string>
  metas: Record<string, ChannelMeta | undefined>
  sync: ViewSync
  dispatch: Dispatch<LayoutAction>
}

function plotData(names: string[]): uPlot.AlignedData {
  return [store.times(), ...names.map((n) => store.column(n) ?? new Float64Array(store.length))]
}

export const LivePlotPanel = memo(function LivePlotPanel({
  panel,
  index,
  active,
  known,
  metas,
  sync,
  dispatch,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const valueEls = useRef(new Map<string, HTMLSpanElement>())

  const namesKey = panel.channelIds.filter((n) => known.has(n)).join('\n')
  const names = useMemo(() => (namesKey ? namesKey.split('\n') : []), [namesKey])
  const waiting = panel.channelIds.filter((n) => !known.has(n))

  useEffect(() => {
    const host = hostRef.current
    if (!host || names.length === 0) return

    let cursorIdx: number | null = null
    const showValues = () => {
      const i = cursorIdx ?? store.length - 1
      for (const n of names) {
        const el = valueEls.current.get(n)
        if (el) el.textContent = formatValue(i >= 0 ? store.column(n)?.[i] : undefined, metas[n])
      }
    }

    const plot = mountPlot(host, {
      series: names.map((n) => ({
        name: metas[n]?.label || n,
        unit: metas[n]?.unit || n,
        color: colorFor(n),
      })),
      data: plotData(names),
      sync,
      bounds: () => store.bounds(),
      minSpan: 0.05,
      onCursor: (idx) => {
        cursorIdx = idx
        showValues()
      },
    })
    showValues()
    const off = store.subscribe(() => {
      plot.u.setData(plotData(names), false)
      showValues()
    })
    return () => {
      off()
      plot.destroy()
    }
  }, [names, metas, sync])

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
          {panel.channelIds.map((n) => (
            <li key={n} className="group flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: colorFor(n) }} />
              <span className={known.has(n) ? 'text-zinc-300' : 'text-zinc-600'}>
                {metas[n]?.label || n}
              </span>
              <span
                ref={(el) => {
                  if (el) valueEls.current.set(n, el)
                  else valueEls.current.delete(n)
                }}
                className="min-w-12 text-right text-zinc-100 tabular-nums"
              >
                --
              </span>
              {metas[n]?.unit && <span className="text-zinc-500">{metas[n]?.unit}</span>}
              <button
                type="button"
                aria-label={`Remove ${n}`}
                className="text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-200 focus-visible:opacity-100"
                onClick={() => dispatch({ type: 'removeChannel', panelId: panel.id, channelId: n })}
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
        {names.length === 0 ? (
          <p className="absolute inset-0 grid place-items-center text-sm text-zinc-600">
            {waiting.length > 0
              ? `Waiting for ${waiting.join(', ')} from the device`
              : 'Pick channels from the list to plot them here'}
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
