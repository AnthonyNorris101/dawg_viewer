import uPlot from 'uplot'
import { observeElementSize } from './observeSize'
import type { ViewSync } from './sync'

const FONT = '11px Inter, system-ui, sans-serif'
const AXIS_STROKE = '#a1a1aa'
const GRID = { stroke: '#27272a', width: 1 }
const TICKS = { stroke: '#3f3f46', width: 1 }
const ZOOM_STEP = 0.8
const PAN_STEP = 0.1
const Y_AXIS_SIZE = 52
const Y_LABEL_SIZE = 16

export interface PlotSeries {
  name: string
  unit: string
  color: string
}

export interface PlotOptions {
  series: PlotSeries[]
  data: uPlot.AlignedData
  sync: ViewSync
  bounds: () => [number, number] | null
  minSpan: number
  onCursor: (idx: number | null) => void
}

export interface MountedPlot {
  u: uPlot
  destroy(): void
}

function wheelZoom(bounds: PlotOptions['bounds'], minSpan: number): uPlot.Plugin {
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
              if (nMax - nMin < minSpan) return
            }
            u.setScale('x', { min: nMin, max: nMax })
          },
          { passive: false },
        )
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
  const units = [...new Set(series.map((s) => s.unit))]
  const initialSize = { width: host.clientWidth, height: host.clientHeight }

  const u = new uPlot(
    {
      ...initialSize,
      legend: { show: false },
      padding: [null, units.length > 1 ? 0 : Y_AXIS_SIZE + Y_LABEL_SIZE, null, null],
      scales: { x: { time: false } },
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
      plugins: [wheelZoom(opts.bounds, opts.minSpan)],
      hooks: {
        setScale: [(u, key) => key === 'x' && sync.publishRange(u)],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx ?? null
            opts.onCursor(idx)
            sync.publishCursor(idx)
          },
        ],
      },
    },
    opts.data,
    host,
  )
  const unregister = sync.register(u)

  const stopResize = observeElementSize(host, (size) => u.setSize(size), initialSize)

  return {
    u,
    destroy() {
      stopResize()
      unregister()
      u.destroy()
    },
  }
}
