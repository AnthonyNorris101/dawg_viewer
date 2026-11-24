import { validFix, type Beacon } from '../analysis/track'
import { FONT, MUTED, mountCanvas, rampColor, SLOT_COLORS } from './canvas'

const RAD = Math.PI / 180
const EARTH_R = 6371008.8
const BUCKETS = 24
const PAD = 16

export interface TrackData {
  lat: ArrayLike<number>
  lon: ArrayLike<number>
  n: number
}

export interface Highlight {
  start: number
  end: number
  slot: number
}

export interface TrackMapOptions {
  track(): TrackData
  highlights(): Highlight[]
  color?(): { data: ArrayLike<number>; lo: number; hi: number } | null
  cursor(): { i: number; slot: number }[]
  beacon(): Beacon | null
  onPick?(lat: number, lon: number): void
  pickActive?(): boolean
  follow?: boolean
}

export function mountTrackMap(host: HTMLElement, opts: TrackMapOptions) {
  let lat0 = NaN
  let lon0 = NaN
  let kx = 1
  const ky = RAD * EARTH_R
  let cx = 0
  let cy = 0
  let scale = 0
  let userMoved = false
  let size = { w: 0, h: 0 }
  let highlightCount = 0

  const project = (la: number, lo: number): [number, number] => [(lo - lon0) * kx, (la - lat0) * ky]
  const toPx = (x: number, y: number): [number, number] => [
    size.w / 2 + (x - cx) * scale,
    size.h / 2 - (y - cy) * scale,
  ]
  const toLatLon = (px: number, py: number): [number, number] => {
    const x = (px - size.w / 2) / scale + cx
    const y = -(py - size.h / 2) / scale + cy
    return [y / ky + lat0, x / kx + lon0]
  }

  const fit = (t: TrackData) => {
    let minLa = Infinity
    let maxLa = -Infinity
    let minLo = Infinity
    let maxLo = -Infinity
    const step = Math.max(1, Math.floor(t.n / 20000))
    for (let i = 0; i < t.n; i += step) {
      const la = t.lat[i]
      const lo = t.lon[i]
      if (!validFix(la, lo)) continue
      if (la < minLa) minLa = la
      if (la > maxLa) maxLa = la
      if (lo < minLo) minLo = lo
      if (lo > maxLo) maxLo = lo
    }
    if (!Number.isFinite(minLa)) return false
    if (!Number.isFinite(lat0)) {
      lat0 = (minLa + maxLa) / 2
      lon0 = (minLo + maxLo) / 2
      kx = Math.cos(lat0 * RAD) * RAD * EARTH_R
    }
    const [x0, y0] = project(minLa, minLo)
    const [x1, y1] = project(maxLa, maxLo)
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    const w = Math.max(x1 - x0, 20)
    const h = Math.max(y1 - y0, 20)
    scale = Math.min((size.w - 2 * PAD) / w, (size.h - 2 * PAD) / h)
    return true
  }

  const c = mountCanvas(host, (ctx, w, h) => {
    size = { w, h }
    const t = opts.track()
    if (t.n === 0) return
    if (!Number.isFinite(lat0) || scale <= 0 || (opts.follow && !userMoved)) {
      if (!fit(t)) return
    }

    const trace = (start: number, end: number, seg: (i: number) => Path2D) => {
      let lx = NaN
      let ly = NaN
      for (let i = start; i <= end; i++) {
        const la = t.lat[i]
        const lo = t.lon[i]
        if (!validFix(la, lo)) continue
        const [px, py] = toPx(...project(la, lo))
        if (Number.isFinite(lx)) {
          if (Math.abs(px - lx) + Math.abs(py - ly) < 1.2) continue
          const p = seg(i)
          p.moveTo(lx, ly)
          p.lineTo(px, py)
        }
        lx = px
        ly = py
      }
    }

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    {
      const all = new Path2D()
      trace(0, t.n - 1, () => all)
      ctx.strokeStyle = MUTED
      ctx.lineWidth = 2
      ctx.stroke(all)
    }

    const color = opts.color?.() ?? null
    const hl = opts.highlights()
    highlightCount = hl.length
    for (const seg of hl) {
      if (color) {
        const buckets = Array.from({ length: BUCKETS }, () => new Path2D())
        const span = color.hi - color.lo || 1
        trace(seg.start, Math.min(seg.end, t.n - 1), (i) => {
          const b = Math.floor(((color.data[i] - color.lo) / span) * BUCKETS)
          return buckets[Number.isFinite(b) ? Math.min(BUCKETS - 1, Math.max(0, b)) : 0]
        })
        ctx.lineWidth = 3
        buckets.forEach((p, b) => {
          ctx.strokeStyle = rampColor((b + 0.5) / BUCKETS)
          ctx.stroke(p)
        })
      } else {
        const p = new Path2D()
        trace(seg.start, Math.min(seg.end, t.n - 1), () => p)
        ctx.lineWidth = 3
        ctx.strokeStyle = SLOT_COLORS[seg.slot % SLOT_COLORS.length]
        ctx.stroke(p)
      }
    }

    const b = opts.beacon()
    if (b) {
      const [px, py] = toPx(...project(b.lat, b.lon))
      ctx.fillStyle = '#fafafa'
      ctx.strokeStyle = '#09090b'
      ctx.lineWidth = 1
      for (let r = 0; r < 2; r++)
        for (let q = 0; q < 3; q++) {
          ctx.fillStyle = (r + q) % 2 ? '#09090b' : '#fafafa'
          ctx.fillRect(px + q * 4, py - 12 + r * 4, 4, 4)
        }
      ctx.strokeRect(px + 0.5, py - 12.5, 12, 8)
      ctx.beginPath()
      ctx.moveTo(px + 0.5, py - 12)
      ctx.lineTo(px + 0.5, py + 2)
      ctx.strokeStyle = '#fafafa'
      ctx.stroke()
      ctx.font = FONT
      ctx.fillStyle = '#d4d4d8'
      ctx.textBaseline = 'middle'
      ctx.fillText('S/F', px + 15, py - 8)
    }
  })

  const top = mountCanvas(host, (ctx) => {
    const t = opts.track()
    if (t.n === 0 || scale <= 0) return
    for (const { i, slot } of opts.cursor()) {
      if (i < 0 || i >= t.n || !validFix(t.lat[i], t.lon[i])) continue
      const [px, py] = toPx(...project(t.lat[i], t.lon[i]))
      ctx.beginPath()
      ctx.arc(px, py, 5, 0, 2 * Math.PI)
      ctx.fillStyle = highlightCount > 1 ? SLOT_COLORS[slot % SLOT_COLORS.length] : '#fafafa'
      ctx.fill()
      ctx.lineWidth = 2
      ctx.strokeStyle = '#09090b'
      ctx.stroke()
    }

    if (opts.pickActive?.()) {
      ctx.font = FONT
      ctx.fillStyle = '#facc15'
      ctx.textBaseline = 'top'
      ctx.fillText('Click the start/finish line on the track', 8, 8)
    }
  })

  const redraw = () => {
    c.redraw()
    top.redraw()
  }

  const cv = top.canvas
  cv.style.touchAction = 'none'
  let drag: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null
  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    if (scale <= 0) return
    const r = cv.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const before = { x: (mx - size.w / 2) / scale + cx, y: -(my - size.h / 2) / scale + cy }
    scale *= e.deltaY < 0 ? 1.25 : 0.8
    cx = before.x - (mx - size.w / 2) / scale
    cy = before.y + (my - size.h / 2) / scale
    userMoved = true
    redraw()
  }
  const onDown = (e: PointerEvent) => {
    drag = { x: e.clientX, y: e.clientY, cx, cy, moved: false }
    cv.setPointerCapture(e.pointerId)
  }
  const onMove = (e: PointerEvent) => {
    if (!drag || scale <= 0) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
    if (!drag.moved) return
    cx = drag.cx - dx / scale
    cy = drag.cy + dy / scale
    userMoved = true
    redraw()
  }
  const onUp = (e: PointerEvent) => {
    const d = drag
    drag = null
    if (!d || d.moved || !opts.onPick || !opts.pickActive?.() || scale <= 0) return
    const r = cv.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const t = opts.track()
    let best = -1
    let bestD = 30 * 30
    const step = Math.max(1, Math.floor(t.n / 50000))
    for (let i = 0; i < t.n; i += step) {
      if (!validFix(t.lat[i], t.lon[i])) continue
      const [px, py] = toPx(...project(t.lat[i], t.lon[i]))
      const d = (px - mx) ** 2 + (py - my) ** 2
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best >= 0) opts.onPick(t.lat[best], t.lon[best])
    else opts.onPick(...toLatLon(mx, my))
  }
  const onDouble = () => {
    userMoved = false
    scale = 0
    redraw()
  }
  cv.addEventListener('wheel', onWheel, { passive: false })
  cv.addEventListener('pointerdown', onDown)
  cv.addEventListener('pointermove', onMove)
  cv.addEventListener('pointerup', onUp)
  cv.addEventListener('dblclick', onDouble)

  return {
    redraw,
    redrawCursor: top.redraw,
    destroy() {
      cv.removeEventListener('wheel', onWheel)
      cv.removeEventListener('pointerdown', onDown)
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerup', onUp)
      cv.removeEventListener('dblclick', onDouble)
      top.destroy()
      c.destroy()
    },
  }
}
