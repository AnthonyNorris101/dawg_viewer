import { formatTick, niceTicks } from '../analysis/stats'

export const FONT = '11px Inter, system-ui, sans-serif'
export const AXIS = '#a1a1aa'
export const GRID = '#27272a'
export const MUTED = '#52525b'

export interface Frame {
  left: number
  top: number
  width: number
  height: number
}

export function mountCanvas(
  host: HTMLElement,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
) {
  const canvas = document.createElement('canvas')
  canvas.style.position = 'absolute'
  canvas.style.inset = '0'
  host.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  let w = 0
  let h = 0
  let queued = 0
  let shown = true
  let dirty = false

  const paint = () => {
    queued = 0
    if (!ctx || w === 0 || h === 0) return
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    draw(ctx, w, h)
  }
  const redraw = () => {
    if (!shown) dirty = true
    else if (!queued) queued = requestAnimationFrame(paint)
  }
  const resize = () => {
    const dpr = window.devicePixelRatio || 1
    w = host.clientWidth
    h = host.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    paint()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(host)
  resize()
  const io = new IntersectionObserver(
    ([e]) => {
      shown = e.isIntersecting
      if (shown && dirty) {
        dirty = false
        redraw()
      }
    },
    { rootMargin: '200px' },
  )
  io.observe(host)

  return {
    canvas,
    redraw,
    destroy() {
      ro.disconnect()
      io.disconnect()
      if (queued) cancelAnimationFrame(queued)
      canvas.remove()
    },
  }
}

export interface AxisSpec {
  lo: number
  hi: number
  label: string
}

export const PLOT_MARGIN = { left: 52, right: 12, top: 10, bottom: 34 }

export function plotFrame(w: number, h: number): Frame {
  const m = PLOT_MARGIN
  return {
    left: m.left,
    top: m.top,
    width: Math.max(1, w - m.left - m.right),
    height: Math.max(1, h - m.top - m.bottom),
  }
}

export function drawAxes(ctx: CanvasRenderingContext2D, f: Frame, x: AxisSpec, y: AxisSpec) {
  ctx.save()
  ctx.font = FONT
  ctx.fillStyle = AXIS
  ctx.strokeStyle = GRID
  ctx.lineWidth = 1

  const xs = niceTicks(x.lo, x.hi, Math.max(2, Math.floor(f.width / 80)))
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const v of xs) {
    const px = Math.round(f.left + ((v - x.lo) / (x.hi - x.lo)) * f.width) + 0.5
    ctx.beginPath()
    ctx.moveTo(px, f.top)
    ctx.lineTo(px, f.top + f.height)
    ctx.stroke()
    ctx.fillText(formatTick(v, x.hi - x.lo), px, f.top + f.height + 4)
  }
  const ys = niceTicks(y.lo, y.hi, Math.max(2, Math.floor(f.height / 40)))
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const v of ys) {
    const py = Math.round(f.top + f.height - ((v - y.lo) / (y.hi - y.lo)) * f.height) + 0.5
    ctx.beginPath()
    ctx.moveTo(f.left, py)
    ctx.lineTo(f.left + f.width, py)
    ctx.stroke()
    ctx.fillText(formatTick(v, y.hi - y.lo), f.left - 6, py)
  }

  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText(x.label, f.left + f.width / 2, f.top + f.height + 32)
  ctx.save()
  ctx.translate(12, f.top + f.height / 2)
  ctx.rotate(-Math.PI / 2)
  ctx.textBaseline = 'middle'
  ctx.fillText(y.label, 0, 0)
  ctx.restore()

  ctx.strokeStyle = '#3f3f46'
  ctx.strokeRect(f.left + 0.5, f.top + 0.5, f.width, f.height)
  ctx.restore()
}

export function padRange(lo: number, hi: number, frac = 0.05): [number, number] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
  if (hi === lo) return [lo - 1, hi + 1]
  const p = (hi - lo) * frac
  return [lo - p, hi + p]
}

const RAMP: [number, number, number][] = [
  [59, 130, 246],
  [34, 211, 238],
  [52, 211, 153],
  [250, 204, 21],
  [239, 68, 68],
]

export function rampColor(t: number): string {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(x))
  const f = x - i
  const a = RAMP[i]
  const b = RAMP[i + 1]
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`
}

export const RAMP_CSS = `linear-gradient(to right, ${RAMP.map((c) => `rgb(${c.join(',')})`).join(', ')})`

export const SLOT_COLORS = ['#f87171', '#60a5fa', '#34d399', '#fbbf24', '#c084fc', '#22d3ee']
