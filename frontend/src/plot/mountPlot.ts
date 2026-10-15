import uPlot from 'uplot'
import type { Channel } from '../data/session'
import { CURSOR_SYNC_KEY, publishCursor, publishRange, registerPlot } from './sync'

const FONT = '11px Inter, system-ui, sans-serif'
const AXIS_STROKE = '#a1a1aa'
const GRID = { stroke: '#27272a', width: 1 }
const TICKS = { stroke: '#3f3f46', width: 1 }
const ZOOM_STEP = 0.8
const PAN_STEP = 0.1
// Every plot reserves the same gutters so x positions line up across panels.
const Y_AXIS_SIZE = 52
const Y_LABEL_SIZE = 16

// Wheel zooms about the pointer; shift+wheel (or a horizontal wheel) pans.
function wheelZoom(xMin: number, xMax: number, minSpan: number): uPlot.Plugin {
  return {
    hooks: {
      ready(u) {
        u.over.addEventListener(
          'wheel',
          (e) => {
            e.preventDefault()
            const { min, max } = u.scales.x
            if (min == null || max == null) return
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
  if (min + shift < xMin) return xMin - min
  if (max + shift > xMax) return xMax - max
  return shift
}

/**
 * Draws `channels` against `time` inside `host` and keeps the plot sized to it.
 * Returns a dispose function. `onCursor` receives the sample index under the
 * cursor (null when the pointer leaves) for every synced cursor move.
 */
export function mountPlot(
  host: HTMLElement,
  time: Float64Array,
  channels: Channel[],
  onCursor: (idx: number | null) => void,
): () => void {
  // One y scale per unit so channels with unrelated magnitudes stay readable.
  const units = [...new Set(channels.map((ch) => ch.unit))]
  const xMin = time[0]
  const xMax = time[time.length - 1]
  const minSpan = (time[1] - time[0]) * 10

  const opts: uPlot.Options = {
    width: host.clientWidth,
    height: host.clientHeight,
    legend: { show: false },
    padding: [null, units.length > 1 ? 0 : Y_AXIS_SIZE + Y_LABEL_SIZE, null, null],
    scales: { x: { time: false } },
    cursor: {
      sync: { key: CURSOR_SYNC_KEY, scales: ['x', null] },
      drag: { x: true, y: false },
      points: { size: 6 },
    },
    series: [
      {},
      ...channels.map((ch) => ({
        label: ch.name,
        scale: ch.unit,
        stroke: ch.color,
        width: 1.25,
        points: { show: false },
      })),
    ],
    axes: [
      { stroke: AXIS_STROKE, grid: GRID, ticks: TICKS, font: FONT, size: 28 },
      ...units.map((unit, i) => ({
        scale: unit,
        // Only the first two units get an axis; the rest would shift the plot area.
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
    plugins: [wheelZoom(xMin, xMax, minSpan)],
    hooks: {
      setScale: [(u, key) => key === 'x' && publishRange(u)],
      setCursor: [
        (u) => {
          const idx = u.cursor.idx ?? null
          onCursor(idx)
          publishCursor(idx)
        },
      ],
    },
  }

  const u = new uPlot(opts, [time, ...channels.map((ch) => ch.data)], host)
  const unregister = registerPlot(u)

  const resize = new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = host
    if (width > 0 && height > 0) u.setSize({ width, height })
  })
  resize.observe(host)

  return () => {
    resize.disconnect()
    unregister()
    u.destroy()
  }
}
