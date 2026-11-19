import uPlot from 'uplot'
import type { ViewSync } from './sync'

const FONT = '11px Inter, system-ui, sans-serif'
const AXIS_STROKE = '#a1a1aa'
const GRID = { stroke: '#27272a', width: 1 }
const TICKS = { stroke: '#3f3f46', width: 1 }
const ZOOM_STEP = 0.8
const PAN_STEP = 0.1
const Y_AXIS_SIZE = 52
const Y_LABEL_SIZE = 16
const Y_PAD: uPlot.Range.Config = {
  min: { pad: 0.1, soft: 0, mode: 3 },
  max: { pad: 0.1, soft: 0, mode: 3 },
}
const SPIKE_SHARE = 0.001
const SPIKE_SAMPLES = 4000

export interface PlotSeries {
  name: string
  unit: string
  color: string
  dash?: number[]
}

export interface PlotMarker {
  x: number
  label: string
}

export interface PlotOptions {
  series: PlotSeries[]
  data: uPlot.AlignedData
  sync: ViewSync
  bounds: () => [number, number] | null
  minSpan: number | (() => number)
  onCursor: (idx: number | null) => void
  markers?: PlotMarker[] | (() => PlotMarker[])
  plugins?: uPlot.Plugin[]
  ranges?: Record<string, [number, number]>
  pinCursor?: boolean
}

function spikeFreeExtent(u: uPlot, key: string): [number, number] | null {
  const values: number[] = []
  for (let i = 1; i < u.series.length; i++) {
    const s = u.series[i]
    if (s.scale !== key || s.show === false) continue
    const d = u.data[i] as ArrayLike<number | null | undefined>
    const i0 = s.idxs?.[0] ?? 0
    const i1 = s.idxs?.[1] ?? d.length - 1
    const step = Math.max(1, Math.floor((i1 - i0 + 1) / SPIKE_SAMPLES))
    for (let j = i0; j <= i1; j += step) {
      const v = d[j]
      if (v != null && Number.isFinite(v)) values.push(v)
    }
  }
  if (values.length < 50) return null
  values.sort((a, b) => a - b)
  const k = Math.floor(values.length * SPIKE_SHARE)
  return [values[k], values[values.length - 1 - k]]
}

export interface MountedPlot {
  u: uPlot
  update(data: uPlot.AlignedData): void
  zoom(factor: number): void
  setSpikeFree(on: boolean): void
  setYBounds(bounds: Record<string, [number, number]>): void
  destroy(): void
}

function wheelZoom(bounds: PlotOptions['bounds'], minSpan: () => number): uPlot.Plugin {
  return {
    hooks: {
      ready(u) {
        u.over.addEventListener(
          'wheel',
          (e) => {
            e.preventDefault()
            const { min, max } = u.scales.x
            const b = bounds()
            if (min == null || max == null || !b) return
            const [xMin, xMax] = b
            const span = max - min
            let nMin: number
            let nMax: number

            if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
              const dir = Math.sign(e.deltaX || e.deltaY)
              const shift = clampShift(dir * span * PAN_STEP, min, max, xMin, xMax)
              nMin = min + shift
              nMax = max + shift
            } else {
              const at = u.posToVal(e.clientX - u.over.getBoundingClientRect().left, 'x')
              const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
              nMin = Math.max(xMin, at - (at - min) * factor)
              nMax = Math.min(xMax, at + (max - at) * factor)
              if (nMax - nMin < minSpan()) return
            }
            u.setScale('x', { min: nMin, max: nMax })
          },
          { passive: false },
        )
      },
    },
  }
}

const MARKER_STROKE = 'rgba(250, 204, 21, 0.55)'
const MARKER_TEXT = '#facc15'

function markerLines(markers: () => PlotMarker[]): uPlot.Plugin {
  return {
    hooks: {
      draw(u) {
        const { ctx } = u
        const { left, top, width, height } = u.bbox
        const { min, max } = u.scales.x
        if (min == null || max == null) return
        ctx.save()
        ctx.beginPath()
        ctx.rect(left, top, width, height)
        ctx.clip()
        ctx.strokeStyle = MARKER_STROKE
        ctx.fillStyle = MARKER_TEXT
        ctx.lineWidth = devicePixelRatio
        ctx.setLineDash([4 * devicePixelRatio, 3 * devicePixelRatio])
        ctx.font = `${10 * devicePixelRatio}px Inter, system-ui, sans-serif`
        ctx.textBaseline = 'top'
        for (const m of markers()) {
          if (m.x < min || m.x > max) continue
          const x = Math.round(u.valToPos(m.x, 'x', true)) + 0.5
          ctx.beginPath()
          ctx.moveTo(x, top)
          ctx.lineTo(x, top + height)
          ctx.stroke()
          if (m.label) ctx.fillText(m.label, x + 3 * devicePixelRatio, top + 2 * devicePixelRatio)
        }
        ctx.restore()
      },
    },
  }
}

function pinnedCursor(sync: ViewSync): uPlot.Plugin {
  return {
    hooks: {
      ready(u) {
        let down: [number, number] | null = null
        u.over.addEventListener('pointerdown', (event) => {
          if (event.button === 0) down = [event.clientX, event.clientY]
        })
        u.over.addEventListener('pointerup', (event) => {
          if (!down || event.button !== 0) return
          const [startX, startY] = down
          down = null
          if (Math.hypot(event.clientX - startX, event.clientY - startY) > 4) return
          const rect = u.over.getBoundingClientRect()
          const idx = u.valToIdx(u.posToVal(event.clientX - rect.left, 'x'))
          const x = (u.data[0] as ArrayLike<number>)[idx]
          if (Number.isFinite(x)) sync.pin(x)
        })
        u.over.addEventListener('pointercancel', () => {
          down = null
        })
      },
      draw(u) {
        const x = sync.pinnedX()
        if (x == null || x < (u.scales.x.min ?? Infinity) || x > (u.scales.x.max ?? -Infinity))
          return
        const { ctx, bbox } = u
        const px = Math.round(u.valToPos(x, 'x', true)) + 0.5
        ctx.save()
        ctx.strokeStyle = '#facc15'
        ctx.lineWidth = devicePixelRatio
        ctx.beginPath()
        ctx.moveTo(px, bbox.top)
        ctx.lineTo(px, bbox.top + bbox.height)
        ctx.stroke()
        ctx.restore()
      },
    },
  }
}

function clampShift(shift: number, min: number, max: number, xMin: number, xMax: number) {
  if (min + shift < xMin) return Math.min(0, xMin - min)
  if (max + shift > xMax) return Math.max(0, xMax - max)
  return shift
}

export function mountPlot(host: HTMLElement, opts: PlotOptions): MountedPlot {
  const { series, sync } = opts
  const minSpan = () => (typeof opts.minSpan === 'function' ? opts.minSpan() : opts.minSpan)
  const units = [...new Set(series.map((s) => s.unit))]
  let manualY = opts.ranges ?? {}
  let spikeFree = false
  const yRange: uPlot.Range.Function = (self, min, max, key) => {
    const set = manualY[key]
    if (set) return set
    const robust = spikeFree ? spikeFreeExtent(self, key) : null
    const lo = robust ? robust[0] : min
    const hi = robust ? robust[1] : max
    if (lo == null || hi == null) return [null, null] as unknown as uPlot.Range.MinMax
    return uPlot.rangeNum(lo, hi, Y_PAD)
  }
  const refitY = () => {
    const { min, max } = u.scales.x
    if (min != null && max != null) u.setScale('x', { min, max })
  }

  const u = new uPlot(
    {
      width: host.clientWidth,
      height: host.clientHeight,
      legend: { show: false },
      padding: [null, units.length > 1 ? 0 : Y_AXIS_SIZE + Y_LABEL_SIZE, null, null],
      scales: {
        x: { time: false },
        ...Object.fromEntries(
          units.map((k) => [k, { range: opts.ranges?.[k] ?? yRange }] as const),
        ),
      },
      cursor: {
        sync: { key: sync.cursorKey, scales: ['x', null] },
        drag: { x: true, y: false },
        points: { size: 6 },
      },
      series: [
        {},
        ...series.map((s) => ({
          label: s.name,
          scale: s.unit,
          stroke: s.color,
          width: 1.25,
          dash: s.dash,
          points: { show: false },
        })),
      ],
      axes: [
        { stroke: AXIS_STROKE, grid: GRID, ticks: TICKS, font: FONT, size: 28 },
        ...units.map((unit, i) => ({
          scale: unit,
          show: i < 2,
          side: i === 0 ? 3 : 1,
          label: unit,
          labelSize: Y_LABEL_SIZE,
          labelFont: FONT,
          stroke: AXIS_STROKE,
          grid: i === 0 ? GRID : { show: false },
          ticks: TICKS,
          font: FONT,
          size: Y_AXIS_SIZE,
        })),
      ],
      plugins: [
        wheelZoom(opts.bounds, minSpan),
        ...(opts.pinCursor === false ? [] : [pinnedCursor(sync)]),
        markerLines(() =>
          typeof opts.markers === 'function' ? opts.markers() : (opts.markers ?? []),
        ),
        ...(opts.plugins ?? []),
      ],
      hooks: {
        setScale: [(u, key) => key === 'x' && sync.publishRange(u)],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx ?? null
            if (sync.pinnedX() == null) opts.onCursor(idx)
            sync.publishCursor(idx)
          },
        ],
      },
    },
    opts.data,
    host,
  )
  let unregister: (() => void) | null = sync.register(u)
  let pending: uPlot.AlignedData | null = null
  const offPin = sync.onPin(() => {
    const x = sync.pinnedX()
    opts.onCursor(x == null ? null : u.valToIdx(x))
    u.redraw()
  })
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') sync.clearPin()
  }
  document.addEventListener('keydown', onKeyDown)

  const resize = new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = host
    if (width > 0 && height > 0) u.setSize({ width, height })
  })
  resize.observe(host)

  const seen = new IntersectionObserver(
    ([e]) => {
      if (!e.isIntersecting) {
        unregister?.()
        unregister = null
        return
      }
      if (pending) {
        u.setData(pending, false)
        pending = null
      }
      unregister ??= sync.register(u)
    },
    { rootMargin: '200px' },
  )
  seen.observe(host)

  return {
    u,
    update(data: uPlot.AlignedData) {
      if (unregister) u.setData(data, false)
      else pending = data
      sync.refreshPin()
    },
    zoom(factor) {
      const { min, max } = u.scales.x
      const b = opts.bounds()
      if (min == null || max == null || !b) return
      const half = Math.max(((max - min) / 2) * factor, minSpan() / 2)
      const mid = (min + max) / 2
      let lo = mid - half
      let hi = mid + half
      if (lo < b[0]) [lo, hi] = [b[0], hi + (b[0] - lo)]
      if (hi > b[1]) [lo, hi] = [lo - (hi - b[1]), b[1]]
      u.setScale('x', { min: Math.max(lo, b[0]), max: Math.min(hi, b[1]) })
    },
    setSpikeFree(on) {
      spikeFree = on
      refitY()
    },
    setYBounds(bounds) {
      manualY = bounds
      refitY()
    },
    destroy() {
      offPin()
      document.removeEventListener('keydown', onKeyDown)
      seen.disconnect()
      resize.disconnect()
      unregister?.()
      u.destroy()
    },
  }
}
