import { memo, useEffect, useMemo, useRef, type Dispatch } from 'react'
import { channelTitle, type Session } from '../data/session'
import { mountPlot, type MountedPlot, type PlotSeries } from '../plot/mountPlot'
import type { ViewSync } from '../plot/sync'
import type { LayoutAction, Panel } from '../state/layout'
import type { XView } from '../viewer/xview'
import { PanelFrame, PlotTools } from './PanelFrame'

interface Props {
  panel: Panel
  index: number
  active: boolean
  session: Session
  view: XView
  sync: ViewSync
  dispatch: Dispatch<LayoutAction>
  extraChannels?: Session['channels']
}

const NO_VALUE = '–'

export const PlotPanel = memo(function PlotPanel({
  panel,
  index,
  active,
  session,
  view,
  sync,
  dispatch,
  extraChannels,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<MountedPlot | null>(null)
  const valueEls = useRef(new Map<string, HTMLSpanElement>())

  const channels = useMemo(
    () =>
      panel.channelIds.flatMap(
        (id) => session.byId.get(id) ?? extraChannels?.find((c) => c.id === id) ?? [],
      ),
    [panel.channelIds, session, extraChannels],
  )
  const series = useMemo(() => view.series(channels), [view, channels])

  const latest = useRef({ view, series })
  useEffect(() => {
    latest.current = { view, series }
  }, [view, series])
  const seriesKey = JSON.stringify(
    series.map((s) => ({
      key: s.key,
      name: s.label,
      unit: s.channel.unit || channelTitle(s.channel),
      color: s.color,
      dash: s.dash,
    })),
  )
  const structure = useMemo(() => JSON.parse(seriesKey) as PlotSeries[], [seriesKey])

  useEffect(() => {
    const host = hostRef.current
    if (!host || structure.length === 0) return
    const { view, series } = latest.current
    const plot = mountPlot(host, {
      series: structure,
      data: [view.x as number[], ...series.map((s) => s.data as (number | null)[])],
      sync,
      bounds: () => latest.current.view.bounds,
      minSpan: () => latest.current.view.minSpan,
      markers: () => latest.current.view.markers,
      onCursor: (idx) => {
        for (const s of latest.current.series) {
          const el = valueEls.current.get(s.key)
          if (!el) continue
          const v = idx == null ? null : s.data[idx]
          el.textContent = v == null ? NO_VALUE : v.toFixed(s.channel.precision)
        }
      },
    })
    plotRef.current = plot
    return () => {
      plotRef.current = null
      plot.destroy()
    }
  }, [structure, sync])

  useEffect(() => {
    plotRef.current?.update([view.x as number[], ...series.map((s) => s.data as (number | null)[])])
  }, [series, view])

  const spikeFree = !panel.fullY
  useEffect(() => {
    plotRef.current?.setSpikeFree(spikeFree)
  }, [spikeFree, structure, sync])
  useEffect(
    () => plotRef.current?.setYBounds(panel.yBounds ?? {}),
    [panel.yBounds, structure, sync],
  )

  const missing = panel.channelIds.length - channels.length

  return (
    <PanelFrame
      panel={panel}
      active={active}
      dispatch={dispatch}
      title={`Plot ${index + 1}`}
      tools={
        <PlotTools
          plot={plotRef}
          title={`plot ${index + 1}`}
          spikeFree={spikeFree}
          onSpikeFree={(on) =>
            dispatch({ type: 'setPanel', panelId: panel.id, patch: { fullY: !on } })
          }
        />
      }
      legend={
        <ul className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <li key={s.key} className="group flex items-center gap-1.5">
              <svg width="14" height="6" className="shrink-0" aria-hidden>
                <line
                  x1="0"
                  y1="3"
                  x2="14"
                  y2="3"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeDasharray={s.dash?.map((d) => d / 2).join(' ')}
                />
              </svg>
              <span className="text-zinc-300">{s.label}</span>
              <span
                ref={(el) => {
                  if (el) valueEls.current.set(s.key, el)
                  else valueEls.current.delete(s.key)
                }}
                className="min-w-12 text-right text-zinc-100 tabular-nums"
              >
                {NO_VALUE}
              </span>
              <span className="text-zinc-500">{s.channel.unit}</span>
              {s.slot === 0 || view.mode === 'time' ? (
                <button
                  type="button"
                  aria-label={`Remove ${s.channel.name}`}
                  className="text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-200 focus-visible:opacity-100"
                  onClick={() =>
                    dispatch({ type: 'removeChannel', panelId: panel.id, channelId: s.channel.id })
                  }
                >
                  ✕
                </button>
              ) : null}
            </li>
          ))}
          {missing > 0 && (
            <li className="text-zinc-600" title="Saved in this worksheet but not in this log">
              {missing} not in this log
            </li>
          )}
        </ul>
      }
    >
      {series.length === 0 ? (
        <p className="absolute inset-0 grid place-items-center text-sm text-zinc-600">
          {channels.length > 0
            ? 'Time slip needs a lap overlay'
            : 'Pick channels from the list to plot them here'}
        </p>
      ) : (
        <div ref={hostRef} className="absolute inset-0" />
      )}
    </PanelFrame>
  )
})
