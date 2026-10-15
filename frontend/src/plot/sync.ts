import type uPlot from 'uplot'

// Shared view state for every plot on screen. It lives outside React on
// purpose: cursor moves and zooms happen at pointer rate, and routing them
// through component state would re-render the whole tree on every event.

export interface Range {
  min: number
  max: number
}

export const CURSOR_SYNC_KEY = 'dawg'

const plots = new Set<uPlot>()
const rangeListeners = new Set<(range: Range) => void>()
const cursorListeners = new Set<(idx: number | null) => void>()
let range: Range | null = null

function apply(next: Range, source?: uPlot) {
  range = next
  for (const u of plots) if (u !== source) u.setScale('x', next)
  for (const fn of rangeListeners) fn(next)
}

export function registerPlot(u: uPlot) {
  plots.add(u)
  if (range) u.setScale('x', range)
  return () => {
    plots.delete(u)
  }
}

/** Called from a plot's setScale hook; mirrors its x range onto the others. */
export function publishRange(source: uPlot) {
  const { min, max } = source.scales.x
  if (min == null || max == null) return
  // The plots we update fire their own setScale hooks; this stops the echo.
  if (range && range.min === min && range.max === max) return
  apply({ min, max }, source)
}

export function setRange(next: Range) {
  apply(next)
}

export function publishCursor(idx: number | null) {
  for (const fn of cursorListeners) fn(idx)
}

export function onRange(fn: (range: Range) => void) {
  rangeListeners.add(fn)
  return () => {
    rangeListeners.delete(fn)
  }
}

export function onCursor(fn: (idx: number | null) => void) {
  cursorListeners.add(fn)
  return () => {
    cursorListeners.delete(fn)
  }
}
