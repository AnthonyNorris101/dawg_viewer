import { useState, type ReactNode, type DragEvent } from 'react'
import type { LiveLayoutMode } from '../settings/liveLayout'
import {
  assignBentoSlots,
  previewBentoPlacement,
  type BentoSize,
  type BentoSlot,
} from '../state/liveBento'

export function LiveGraphStack({
  ids,
  sizes,
  slots,
  mode,
  onSlots,
  render,
}: {
  ids: string[]
  sizes: Record<string, BentoSize>
  slots: Record<string, BentoSlot>
  mode: LiveLayoutMode
  onSlots: (slots: Record<string, BentoSlot>) => void
  render: (
    id: string,
    bento: boolean,
    startDrag: (event: DragEvent<HTMLElement>) => void,
  ) => ReactNode
}) {
  const [source, setSource] = useState<string | null>(null)
  const [hover, setHover] = useState<BentoSlot | null>(null)
  const placed = assignBentoSlots(ids, sizes, slots)
  const preview = source && hover ? previewBentoPlacement(placed, source, hover) : null
  const visible = preview ?? placed
  const rows = Math.max(
    1,
    ...placed.map((p) => p.row + p.rowSpan),
    ...visible.map((p) => p.row + p.rowSpan),
  )
  const clear = () => {
    setSource(null)
    setHover(null)
  }
  const position = (event: DragEvent<HTMLElement>): BentoSlot => {
    const grid = event.currentTarget.getBoundingClientRect()
    const column = (event.clientX - grid.left >= grid.width / 2 ? 1 : 0) as 0 | 1
    return { row: Math.max(0, Math.floor((event.clientY - grid.top) / 273)), column }
  }
  return (
    <main
      className="[container-type:inline-size] min-h-0 min-w-0 flex-1 [scrollbar-gutter:stable] overflow-x-hidden overflow-y-auto bg-zinc-800"
      data-graph-scroll
    >
      <div
        className={
          mode === 'bento'
            ? 'live-bento-grid grid min-w-0 grid-cols-2 gap-px bg-zinc-800'
            : 'flex min-h-full min-w-0 flex-col gap-px'
        }
        style={
          mode === 'bento'
            ? { gridTemplateRows: `repeat(${rows + (source ? 1 : 0)}, 17rem)` }
            : undefined
        }
        onDragOver={(event) => {
          if (!source || mode !== 'bento') return
          event.preventDefault()
          const next = position(event)
          if (next.row !== hover?.row || next.column !== hover.column) setHover(next)
        }}
        onDrop={(event) => {
          if (source && mode === 'bento') {
            event.preventDefault()
            const next = previewBentoPlacement(placed, source, position(event))
            if (next)
              onSlots(Object.fromEntries(next.map((p) => [p.id, { row: p.row, column: p.column }])))
          }
          clear()
        }}
        onDragEnd={clear}
      >
        {ids.map((id) => {
          const place = visible.find((p) => p.id === id)!
          return (
            <div
              key={id}
              data-graph-id={id}
              data-testid={source === id && preview ? 'plot-phantom' : undefined}
              className={
                mode === 'bento'
                  ? `flex min-h-0 min-w-0 flex-col bg-zinc-950 ${source === id && preview ? 'pointer-events-none opacity-60 ring-2 ring-red-400 ring-inset' : ''}`
                  : 'flex min-h-[17rem] min-w-0 flex-1 flex-col'
              }
              style={
                mode === 'bento'
                  ? {
                      gridRow: `${place.row + 1} / span ${place.rowSpan}`,
                      gridColumn: place.columnSpan === 2 ? '1 / -1' : place.column + 1,
                    }
                  : undefined
              }
            >
              {render(id, mode === 'bento', (event) => {
                setSource(id)
                setHover(null)
                event.dataTransfer.effectAllowed = 'move'
              })}
            </div>
          )
        })}
      </div>
    </main>
  )
}
