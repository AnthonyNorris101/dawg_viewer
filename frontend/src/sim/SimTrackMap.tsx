import { useEffect, useRef } from 'react'
import { toolbarButton } from '../ui'
import type { LapResult } from '../analysis/sim/lapsim'
import type { SimTrack } from '../analysis/sim/simtrack'
import { mountCanvas, rampColor } from '../plot/canvas'
import { drawAttribution, drawTiles } from '../plot/tiles'
import { useMapSource } from '../state/mapBackground'
import { LIMIT_COLORS } from './shared'

const RAD = Math.PI / 180
const EARTH_R = 6371008.8
const PAD = 18

export interface MapLine {
  track: SimTrack
  result: LapResult
  band: number
}

export function SimTrackMap({
  track: base,
  result: baseResult,
  colorBy,
  line,
}: {
  track: SimTrack
  result: LapResult
  colorBy: 'limit' | 'speed'
  line?: MapLine | null
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const background = useMapSource()
  const view = useRef({ zoom: 1, dx: 0, dy: 0, scale: 1, of: base, redraw: () => {} })
  const zoomBy = (factor: number) => {
    const v = view.current
    v.zoom = Math.max(1, Math.min(40, v.zoom * factor))
    if (v.zoom === 1) v.dx = v.dy = 0
    v.redraw()
  }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const track = line?.track ?? base
    const result = line?.result ?? baseResult
    const margin = line ? line.band / 2 : 0
    const n = track.x.length
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (let i = 0; i < base.x.length; i++) {
      x0 = Math.min(x0, base.x[i] - margin)
      x1 = Math.max(x1, base.x[i] + margin)
      y0 = Math.min(y0, base.y[i] - margin)
      y1 = Math.max(y1, base.y[i] + margin)
    }
    const v = view.current
    if (v.of !== base) Object.assign(v, { zoom: 1, dx: 0, dy: 0, of: base })
    let redraw = () => {}
    const c = mountCanvas(host, (ctx, w, h) => {
      if (n < 2) return
      const scale =
        v.zoom *
        Math.min((w - 2 * PAD) / Math.max(10, x1 - x0), (h - 2 * PAD) / Math.max(10, y1 - y0))
      v.scale = scale
      const cx = (x0 + x1) / 2 + v.dx
      const cy = (y0 + y1) / 2 + v.dy
      const px = (x: number) => w / 2 + (x - cx) * scale
      const py = (y: number) => h / 2 - (y - cy) * scale
      const o = track.origin
      if (background && o && scale > 0) {
        const kx = Math.cos(o.lat * RAD) * RAD * EARTH_R
        const ky = RAD * EARTH_R
        drawTiles(
          ctx,
          {
            w,
            h,
            metersPerPixel: 1 / scale,
            toLatLon: (a, b) => [
              o.lat + (-(b - h / 2) / scale + cy) / ky,
              o.lon + ((a - w / 2) / scale + cx) / kx,
            ],
            toPx: (lat, lon) => [px((lon - o.lon) * kx), py((lat - o.lat) * ky)],
          },
          background,
          () => redraw(),
        )
        ctx.fillStyle = 'rgba(9, 9, 11, 0.3)'
        ctx.fillRect(0, 0, w, h)
      }
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (line) {
        const middle = new Path2D()
        middle.moveTo(px(base.x[0]), py(base.y[0]))
        for (let i = 1; i < base.x.length; i++) middle.lineTo(px(base.x[i]), py(base.y[i]))
        ctx.strokeStyle = 'rgba(228, 228, 231, 0.16)'
        ctx.lineWidth = Math.max(3, line.band * scale)
        ctx.stroke(middle)
        ctx.setLineDash([4, 5])
        ctx.strokeStyle = 'rgba(228, 228, 231, 0.55)'
        ctx.lineWidth = 1
        ctx.stroke(middle)
        ctx.setLineDash([])
      }
      const outline = new Path2D()
      outline.moveTo(px(track.x[0]), py(track.y[0]))
      for (let i = 1; i < n; i++) outline.lineTo(px(track.x[i]), py(track.y[i]))
      ctx.strokeStyle = 'rgba(9, 9, 11, 0.7)'
      ctx.lineWidth = line ? 4.5 : 7
      ctx.stroke(outline)
      const span = result.vMax - result.vMin || 1
      const buckets = new Map<string, Path2D>()
      for (let i = 0; i < n - 1; i++) {
        const color =
          colorBy === 'limit'
            ? LIMIT_COLORS[result.limit[i]]
            : rampColor(Math.round(((result.v[i] - result.vMin) / span) * 24) / 24)
        let p = buckets.get(color)
        if (!p) buckets.set(color, (p = new Path2D()))
        p.moveTo(px(track.x[i]), py(track.y[i]))
        p.lineTo(px(track.x[i + 1]), py(track.y[i + 1]))
      }
      ctx.lineWidth = line ? 2.5 : 3.5
      for (const [color, p] of buckets) {
        ctx.strokeStyle = color
        ctx.stroke(p)
      }
      ctx.beginPath()
      ctx.arc(px(track.x[0]), py(track.y[0]), 5, 0, 2 * Math.PI)
      ctx.fillStyle = '#fafafa'
      ctx.fill()
      ctx.strokeStyle = '#09090b'
      ctx.lineWidth = 2
      ctx.stroke()
      if (background && o) drawAttribution(ctx, w, h, background.attribution)
    })
    redraw = c.redraw
    v.redraw = c.redraw
    let grab: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      if (v.zoom <= 1 || (e.target as HTMLElement).closest('button')) return
      grab = { x: e.clientX, y: e.clientY }
      host.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!grab) return
      v.dx -= (e.clientX - grab.x) / v.scale
      v.dy += (e.clientY - grab.y) / v.scale
      grab = { x: e.clientX, y: e.clientY }
      c.redraw()
    }
    const up = () => (grab = null)
    host.addEventListener('pointerdown', down)
    host.addEventListener('pointermove', move)
    host.addEventListener('pointerup', up)
    host.addEventListener('pointercancel', up)
    return () => {
      host.removeEventListener('pointerdown', down)
      host.removeEventListener('pointermove', move)
      host.removeEventListener('pointerup', up)
      host.removeEventListener('pointercancel', up)
      v.redraw = () => {}
      c.destroy()
    }
  }, [base, baseResult, line, colorBy, background])

  return (
    <div
      ref={hostRef}
      className={`relative touch-none overflow-hidden rounded border border-zinc-800 ${line ? 'h-[30rem]' : 'h-72'}`}
    >
      <div className="absolute top-2 left-2 z-10 flex gap-1 text-xs">
        <button
          type="button"
          className={toolbarButton}
          aria-label="Zoom in"
          onClick={() => zoomBy(1.6)}
        >
          +
        </button>
        <button
          type="button"
          className={toolbarButton}
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.6)}
        >
          −
        </button>
        <button
          type="button"
          className={toolbarButton}
          title="Show the whole track again. When zoomed in, drag the map to move around."
          onClick={() => zoomBy(0)}
        >
          Whole track
        </button>
      </div>
    </div>
  )
}
