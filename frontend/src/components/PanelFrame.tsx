import type {
  Dispatch,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from 'react'
import type { MountedPlot } from '../plot/mountPlot'
import {
  MAX_PANEL_ROWS,
  MIN_PANEL_ROWS,
  panelRows,
  type LayoutAction,
  type Panel,
} from '../state/layout'

const iconButton = 'shrink-0 px-1 text-zinc-600 hover:text-zinc-200'

export function PanelFrame({
  panel,
  active,
  dispatch,
  title,
  legend,
  tall,
  tools,
  children,
}: {
  panel: Panel
  active: boolean
  dispatch: Dispatch<LayoutAction>
  title: string
  legend: ReactNode
  tall?: boolean
  tools?: ReactNode
  children: ReactNode
}) {
  const rows = panelRows(panel, tall)
  const setRows = (next: number | undefined) =>
    dispatch({ type: 'setPanel', panelId: panel.id, patch: { rows: next } })
  const clamp = (n: number) => Math.min(MAX_PANEL_ROWS, Math.max(MIN_PANEL_ROWS, n))

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const frame = event.currentTarget.parentElement
    if (!frame) return
    event.preventDefault()
    const move = (e: PointerEvent) => {
      const box = frame.getBoundingClientRect()
      const now = Number(frame.dataset.rows) || rows
      const unit = box.height / now
      if (!(unit > 0)) return
      const wanted = e.clientY - box.top
      const next = clamp(Math.round(wanted / unit))
      if (next !== now && Math.abs(wanted - box.height) > unit / 2) setRows(next)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  const resizeByKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    setRows(clamp(rows + (event.key === 'ArrowDown' ? 1 : -1)))
  }

  return (
    <section
      className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden border-l-2 bg-zinc-950 ${
        active ? 'border-red-500' : 'border-transparent'
      } ${panel.wide ? 'col-span-2' : ''}`}
      style={{ gridRow: `span ${rows}` }}
      onPointerDown={() => dispatch({ type: 'setActive', panelId: panel.id })}
      data-panel-id={panel.id}
      data-rows={rows}
    >
      <header className="flex items-center gap-3 border-b border-zinc-800 px-3 py-1 text-xs">
        <span className="shrink-0 text-zinc-500">{title}</span>
        <div className="flex max-h-12 min-w-0 flex-1 [scrollbar-width:thin] overflow-y-auto whitespace-nowrap">
          {legend}
        </div>
        <div className="ml-auto flex shrink-0 items-center">
          {tools}
          <button
            type="button"
            aria-label={`Move ${title} up`}
            title="Move up"
            className={iconButton}
            onClick={() => dispatch({ type: 'movePanel', panelId: panel.id, by: -1 })}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move ${title} down`}
            title="Move down"
            className={iconButton}
            onClick={() => dispatch({ type: 'movePanel', panelId: panel.id, by: 1 })}
          >
            ↓
          </button>
          <button
            type="button"
            aria-label={panel.wide ? `Make ${title} half width` : `Make ${title} full width`}
            title={panel.wide ? 'Half width' : 'Full width'}
            className={iconButton}
            onClick={() =>
              dispatch({ type: 'setPanel', panelId: panel.id, patch: { wide: !panel.wide } })
            }
          >
            {panel.wide ? '⇥⇤' : '⇤⇥'}
          </button>
          <button
            type="button"
            aria-label={`Close ${title}`}
            className={iconButton}
            onClick={() => dispatch({ type: 'removePanel', panelId: panel.id })}
          >
            ✕
          </button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={`Resize ${title}`}
        aria-valuenow={rows}
        aria-valuemin={MIN_PANEL_ROWS}
        aria-valuemax={MAX_PANEL_ROWS}
        tabIndex={0}
        title="Drag to make this taller or shorter. Double-click to go back to the usual height."
        className="absolute inset-x-0 bottom-0 z-10 h-1.5 cursor-ns-resize touch-none outline-none hover:bg-red-500/50 focus-visible:bg-red-500/50"
        onPointerDown={startResize}
        onDoubleClick={() => setRows(undefined)}
        onKeyDown={resizeByKey}
      />
    </section>
  )
}

export function ChannelSelect({
  label,
  value,
  channels,
  onChange,
  allowNone,
}: {
  label: string
  value: string
  channels: { id: string; name: string; label?: string }[]
  onChange: (id: string) => void
  allowNone?: string
}) {
  return (
    <label className="flex min-w-0 items-center gap-1 text-zinc-500">
      {label}
      <select
        className="max-w-40 min-w-0 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200 outline-none focus:border-red-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {(allowNone !== undefined || !value) && <option value="">{allowNone ?? '–'}</option>}
        {value && !channels.some((c) => c.id === value) && <option value={value}>{value}</option>}
        {channels.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label || c.name}
          </option>
        ))}
      </select>
    </label>
  )
}

const toolButton = 'shrink-0 px-1.5 text-sm leading-none text-zinc-500 hover:text-zinc-100'

export function PlotTools({
  plot,
  title,
  spikeFree,
  onSpikeFree,
}: {
  plot: RefObject<MountedPlot | null>
  title: string
  spikeFree?: boolean
  onSpikeFree?: (on: boolean) => void
}) {
  return (
    <div className="mr-1 flex items-center border-r border-zinc-800 pr-1">
      <button
        type="button"
        aria-label={`Zoom out ${title}`}
        title="Zoom out (all synced plots follow)"
        className={toolButton}
        onClick={() => plot.current?.zoom(2)}
      >
        −
      </button>
      <button
        type="button"
        aria-label={`Zoom in ${title}`}
        title="Zoom in (all synced plots follow)"
        className={toolButton}
        onClick={() => plot.current?.zoom(0.5)}
      >
        +
      </button>
      {onSpikeFree && (
        <button
          type="button"
          aria-pressed={spikeFree}
          aria-label={`Ignore spikes when scaling ${title}`}
          title={
            spikeFree
              ? 'Y axis ignores the most extreme 0.1% of points. Click to fit every point.'
              : 'Y axis fits every point. Click to ignore spikes.'
          }
          className={`${toolButton} ${spikeFree ? 'text-zinc-200' : 'text-zinc-600'}`}
          onClick={() => onSpikeFree(!spikeFree)}
        >
          ↕
        </button>
      )}
    </div>
  )
}
