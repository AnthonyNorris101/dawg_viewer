import { useEffect, useRef } from 'react'
import type { Range, ViewSync } from '../plot/sync'

interface Props {
  sync: ViewSync
  bounds: () => [number, number] | null
  subscribe?: (fn: () => void) => () => void
  markers?: number[]
  minSpan?: number
}

const EDGE_PX = 7

export function RangeBar({ sync, bounds, subscribe, markers, minSpan = 0 }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!track || !thumb) return

    const current = (): Range | null => {
      const b = bounds()
      if (!b) return null
      const r = sync.range()
      return r
        ? { min: Math.max(b[0], r.min), max: Math.min(b[1], r.max) }
        : { min: b[0], max: b[1] }
    }
    const paint = () => {
      const b = bounds()
      const r = current()
      if (!b || !r || b[1] <= b[0]) {
        thumb.style.display = 'none'
        return
      }
      const span = b[1] - b[0]
      thumb.style.display = ''
      thumb.style.left = `${((r.min - b[0]) / span) * 100}%`
      thumb.style.width = `${Math.max(0.5, ((r.max - r.min) / span) * 100)}%`
    }
    paint()
    const offRange = sync.onRange(paint)
    const offData = subscribe?.(paint)

    const toValue = (clientX: number) => {
      const b = bounds()!
      const rect = track.getBoundingClientRect()
      return b[0] + ((clientX - rect.left) / rect.width) * (b[1] - b[0])
    }
    const clampRange = (min: number, max: number): Range => {
      const b = bounds()!
      const span = max - min
      if (min < b[0]) return { min: b[0], max: b[0] + span }
      if (max > b[1]) return { min: b[1] - span, max: b[1] }
      return { min, max }
    }

    let drag: { mode: 'move' | 'min' | 'max'; at: number; start: Range } | null = null
    const onDown = (e: PointerEvent) => {
      const b = bounds()
      const r = current()
      if (!b || !r) return
      e.preventDefault()
      track.setPointerCapture(e.pointerId)
      const rect = thumb.getBoundingClientRect()
      const x = e.clientX
      let mode: 'move' | 'min' | 'max' = 'move'
      if (Math.abs(x - rect.left) <= EDGE_PX) mode = 'min'
      else if (Math.abs(x - rect.right) <= EDGE_PX) mode = 'max'
      else if (x < rect.left || x > rect.right) {
        const span = r.max - r.min
        const mid = toValue(x)
        const next = clampRange(mid - span / 2, mid + span / 2)
        sync.setRange(next)
        drag = { mode: 'move', at: x, start: next }
        return
      }
      drag = { mode, at: x, start: r }
    }
    const onMove = (e: PointerEvent) => {
      if (!drag) {
        const rect = thumb.getBoundingClientRect()
        const nearEdge =
          Math.abs(e.clientX - rect.left) <= EDGE_PX || Math.abs(e.clientX - rect.right) <= EDGE_PX
        track.style.cursor = nearEdge ? 'ew-resize' : 'grab'
        return
      }
      const b = bounds()
      if (!b) return
      const dv = ((e.clientX - drag.at) / track.getBoundingClientRect().width) * (b[1] - b[0])
      const { min, max } = drag.start
      if (drag.mode === 'move') sync.setRange(clampRange(min + dv, max + dv))
      else if (drag.mode === 'min') {
        sync.setRange({ min: Math.max(b[0], Math.min(min + dv, max - minSpan)), max })
      } else sync.setRange({ min, max: Math.min(b[1], Math.max(max + dv, min + minSpan)) })
    }
    const onUp = () => {
      drag = null
    }
    const onWheel = (e: WheelEvent) => {
      const r = current()
      if (!r) return
      e.preventDefault()
      const span = r.max - r.min
      const d = Math.sign(e.deltaY || e.deltaX) * span * 0.1
      sync.setRange(clampRange(r.min + d, r.max + d))
    }
    const onKey = (e: KeyboardEvent) => {
      const r = current()
      if (!r || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
      e.preventDefault()
      const span = r.max - r.min
      const d = (e.key === 'ArrowLeft' ? -1 : 1) * span * (e.shiftKey ? 0.5 : 0.05)
      sync.setRange(clampRange(r.min + d, r.max + d))
    }
    track.addEventListener('pointerdown', onDown)
    track.addEventListener('pointermove', onMove)
    track.addEventListener('pointerup', onUp)
    track.addEventListener('pointercancel', onUp)
    track.addEventListener('wheel', onWheel, { passive: false })
    track.addEventListener('keydown', onKey)
    return () => {
      offRange()
      offData?.()
      track.removeEventListener('pointerdown', onDown)
      track.removeEventListener('pointermove', onMove)
      track.removeEventListener('pointerup', onUp)
      track.removeEventListener('pointercancel', onUp)
      track.removeEventListener('wheel', onWheel)
      track.removeEventListener('keydown', onKey)
    }
  }, [sync, bounds, subscribe, minSpan])

  const b = bounds()
  return (
    <div className="shrink-0 border-t border-zinc-800 bg-zinc-950 py-1 pr-[70px] pl-[70px]">
      <div
        ref={trackRef}
        role="scrollbar"
        aria-label="Slide the plots left or right"
        aria-orientation="horizontal"
        aria-valuenow={0}
        tabIndex={0}
        title="Drag to slide, drag an end to zoom, arrow keys to nudge"
        className="relative h-3.5 rounded-sm bg-zinc-900 outline-none focus-visible:ring-1 focus-visible:ring-red-500"
      >
        {b &&
          b[1] > b[0] &&
          markers?.map((m, i) => (
            <span
              key={i}
              className="absolute top-0 h-full w-px bg-yellow-400/40"
              style={{ left: `${((m - b[0]) / (b[1] - b[0])) * 100}%` }}
            />
          ))}
        <div
          ref={thumbRef}
          className="absolute top-0 h-full rounded-sm border border-zinc-500 bg-zinc-600/50 hover:bg-zinc-500/60"
        >
          <span className="absolute inset-y-0.5 left-0.5 w-0.5 rounded bg-zinc-300/70" />
          <span className="absolute inset-y-0.5 right-0.5 w-0.5 rounded bg-zinc-300/70" />
        </div>
      </div>
    </div>
  )
}
