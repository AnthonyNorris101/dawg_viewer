import { memo, useEffect, useMemo, useRef, type Dispatch, type DragEvent } from 'react'
import type uPlot from 'uplot'
import type { ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'
import { mountPlot, type MountedPlot } from '../plot/mountPlot'
import type { ViewSync } from '../plot/sync'
import type { LayoutAction, Panel } from '../state/layout'
import type { BentoSize } from '../state/liveBento'
import { colorFor, onLiveFrame, store } from './connection'
import { formatValue } from './format'

type ResizeEdge = 'left' | 'right' | 'bottom' | 'corner'

interface Props {
  panel: Panel
  panels?: Panel[]
  slotted?: boolean
  layoutMode: PlotLayoutMode
  index: number
  active: boolean
  known: ReadonlySet<string>
  metas: Record<string, ChannelMeta | undefined>
  sync: ViewSync
  dispatch: Dispatch<LayoutAction>
  bento?: boolean
  startDrag?: (event: DragEvent<HTMLElement>) => void
  size?: BentoSize
  onSize?: (size: BentoSize) => void
}

function plotData(names: string[]): uPlot.AlignedData {
  return [store.times(), ...names.map((n) => store.column(n) ?? new Float64Array(store.length))]
}

const histogramSources = new Map<
  string,
  { data: () => { time: Float64Array; values: Float64Array }; subscribe: typeof store.subscribe }
>()
function liveHistogramSource(name: string) {
  let source = histogramSources.get(name)
  if (!source) {
    source = {
      data: () => ({ time: store.times(), values: store.column(name) ?? new Float64Array(0) }),
      subscribe: (fn) => store.subscribe(fn),
    }
    histogramSources.set(name, source)
  }
  return source
}

export const LivePlotPanel = memo(function LivePlotPanel({
  panel,
  panels,
  slotted = false,
  layoutMode,
  index,
  active,
  known,
  metas,
  sync,
  dispatch,
  bento = false,
  startDrag,
  size,
  onSize,
}: Props) {
  useStreamColors()
  const sectionRef = useRef<HTMLElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<MountedPlot | null>(null)
  const valueEls = useRef(new Map<string, HTMLSpanElement>())
  const [activeEdge, setActiveEdge] = useState<ResizeEdge | null>(null)

  const totalPanels = panels?.length ?? 2
  const colSpan = panelColSpan(panel, totalPanels)
  const widthPct = panelWidthPct(panel, totalPanels)
  const rowSpan = panelRowSpan(panel)
  const heightPx = panelHeightPx(panel) ?? rowSpan * DEFAULT_ROW_HEIGHT
  const prevId = panels && index > 0 ? panels[index - 1]?.id : undefined
  const nextId = panels && index < panels.length - 1 ? panels[index + 1]?.id : undefined

  const namesKey = panel.channelIds.filter((n) => known.has(n)).join('\n')
  const names = useMemo(() => (namesKey ? namesKey.split('\n') : []), [namesKey])
  const waiting = panel.channelIds.filter((n) => !known.has(n))

  const colorsKey = names.map(colorFor).join(',')
  useEffect(() => {
    const host = hostRef.current
    if (!host || names.length === 0 || panel.graph?.type === 'histogram') return

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
    const off = onLiveFrame(() => {
      plot.update(plotData(names))
      showValues()
    })
    plotRef.current = plot
    return () => {
      plotRef.current = null
      off()
      plot.destroy()
    }
  }, [names, metas, sync])

  const spikeFree = !panel.fullY
  useEffect(() => {
    plotRef.current?.setSpikeFree(spikeFree)
  }, [spikeFree, names, metas, sync])
  useEffect(
    () => plotRef.current?.setYBounds(panel.yBounds ?? {}),
    [panel.yBounds, names, metas, sync],
  )

  return (
    <section
      className={`flex min-w-0 flex-1 flex-col overflow-hidden border-l-2 bg-zinc-950 ${bento ? 'h-full min-h-0' : 'min-h-[17rem]'} ${
        active ? 'border-red-500' : 'border-transparent'
      }`}
      onPointerDown={() => dispatch({ type: 'setActive', panelId: panel.id })}
      data-panel-id={panel.id}
    >
      <header className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1 text-xs">
        <span
          draggable={bento}
          onDragStart={startDrag}
          className={`shrink-0 text-zinc-500 ${bento ? 'cursor-grab' : ''}`}
        >
          Plot {index + 1}
        </span>
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
        {bento && onSize && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label={`Toggle height plot ${index + 1}`}
              aria-pressed={size?.height === 'tall'}
              className="rounded px-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() =>
                onSize({
                  width: size?.width ?? 'half',
                  height: size?.height === 'tall' ? 'short' : 'tall',
                })
              }
            >
              T
            </button>
            <button
              type="button"
              aria-label={`Toggle width plot ${index + 1}`}
              aria-pressed={size?.width === 'full'}
              className="rounded px-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() =>
                onSize({
                  height: size?.height ?? 'short',
                  width: size?.width === 'full' ? 'half' : 'full',
                })
              }
            >
              W
            </button>
          </div>
        )}
        <button
          type="button"
          aria-pressed={spikeFree}
          aria-label={`Ignore spikes when scaling plot ${index + 1}`}
          title={
            spikeFree
              ? 'Y axis ignores the most extreme 0.1% of points. Click to fit every point.'
              : 'Y axis fits every point. Click to ignore spikes.'
          }
          className={`shrink-0 ${spikeFree ? 'text-zinc-200' : 'text-zinc-600'} hover:text-zinc-100`}
          onClick={() =>
            dispatch({ type: 'setPanel', panelId: panel.id, patch: { fullY: spikeFree } })
          }
        >
          ↕
        </button>
        <button
          type="button"
          aria-label={`Close plot ${index + 1}`}
          className="shrink-0 text-zinc-600 hover:text-zinc-200"
          onClick={() => dispatch({ type: 'removePanel', panelId: panel.id })}
        >
          ✕
        </button>
      </header>

      <GraphBody panel={panel} dispatch={dispatch}>
        <div
          draggable
          onDragStart={blockDrag}
          className="relative h-full min-h-0 min-w-0 overflow-hidden"
        >
          {names.length === 0 ? (
            <p className="absolute inset-0 grid place-items-center text-sm text-zinc-600">
              {waiting.length > 0
                ? `Waiting for ${waiting.join(', ')} from the device`
                : 'Pick channels from the list to plot them here'}
            </p>
          ) : panel.graph?.type === 'histogram' ? (
            <Histogram
              key={names[0]}
              source={liveHistogramSource(names[0])}
              sync={sync}
              bins={panel.graph.bins}
              name={metas[names[0]]?.label || names[0]}
              unit={metas[names[0]]?.unit || ''}
              color={colorFor(names[0])}
              valueRange={panel.graph.valueRange}
              orientation={panel.graph.orientation}
              frequency={panel.graph.frequency}
              frequencyMax={panel.graph.frequencyMax}
            />
          ) : (
            <div ref={hostRef} className="absolute inset-0" />
          )}
        </div>
      </GraphBody>

      {layoutMode === 'bento' && (
        <>
          {/* Left edge drag handle */}
          <div
            role="separator"
            aria-label={`Drag left edge of plot ${index + 1}`}
            data-edge="left"
            title="Drag edge to dynamically resize width"
            draggable
            onDragStart={blockDrag}
            onPointerDown={startEdgeResize('left')}
            onDoubleClick={() => dispatch({ type: 'togglePanelWidth', panelId: panel.id })}
            className={`absolute top-0 bottom-2 left-0 z-10 w-2 cursor-ew-resize transition-colors hover:bg-red-500/40 ${
              activeEdge === 'left' ? 'bg-red-500/60' : ''
            }`}
          />

          {/* Right edge drag handle */}
          <div
            role="separator"
            aria-label={`Drag right edge of plot ${index + 1}`}
            data-edge="right"
            title="Drag edge to dynamically resize width"
            draggable
            onDragStart={blockDrag}
            onPointerDown={startEdgeResize('right')}
            onDoubleClick={() => dispatch({ type: 'togglePanelWidth', panelId: panel.id })}
            className={`absolute top-0 right-0 bottom-2 z-10 w-2 cursor-ew-resize transition-colors hover:bg-red-500/40 ${
              activeEdge === 'right' ? 'bg-red-500/60' : ''
            }`}
          />

          {/* Bottom edge drag handle */}
          <div
            role="separator"
            aria-label={`Drag bottom edge of plot ${index + 1}`}
            data-edge="bottom"
            title="Drag edge to dynamically resize height"
            draggable
            onDragStart={blockDrag}
            onPointerDown={startEdgeResize('bottom')}
            onDoubleClick={() => dispatch({ type: 'togglePanelHeight', panelId: panel.id })}
            className={`absolute right-2 bottom-0 left-0 z-10 h-2 cursor-ns-resize transition-colors hover:bg-red-500/40 ${
              activeEdge === 'bottom' ? 'bg-red-500/60' : ''
            }`}
          />

          {/* Bottom-right corner drag handle */}
          <div
            role="separator"
            aria-label={`Resize plot ${index + 1}`}
            data-edge="corner"
            title="Drag corner to dynamically resize plot"
            draggable
            onDragStart={blockDrag}
            onPointerDown={startEdgeResize('corner')}
            onDoubleClick={() => dispatch({ type: 'togglePanelWidth', panelId: panel.id })}
            className={`absolute right-0 bottom-0 z-20 size-3.5 cursor-nwse-resize border-r-2 border-b-2 transition-colors hover:border-red-500 ${
              activeEdge === 'corner' ? 'border-red-500 bg-red-500/30' : 'border-zinc-600'
            }`}
          />
        </>
      )}
    </section>
  )
})
