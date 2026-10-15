import type uPlot from 'uplot'

export interface Range {
  min: number
  max: number
}

export interface ViewSync {
  cursorKey: string
  register(u: uPlot): () => void
  publishRange(source: uPlot): void
  setRange(next: Range): void
  range(): Range | null
  publishCursor(idx: number | null): void
  onRange(fn: (range: Range) => void): () => void
  onCursor(fn: (idx: number | null) => void): () => void
}

export function createViewSync(cursorKey: string): ViewSync {
  const plots = new Set<uPlot>()
  const rangeListeners = new Set<(range: Range) => void>()
  const cursorListeners = new Set<(idx: number | null) => void>()
  let current: Range | null = null

  const apply = (next: Range, source?: uPlot) => {
    current = next
    for (const u of plots) if (u !== source) u.setScale('x', next)
    for (const fn of rangeListeners) fn(next)
  }

  return {
    cursorKey,
    register(u) {
      plots.add(u)
      if (current) u.setScale('x', current)
      return () => {
        plots.delete(u)
      }
    },
    publishRange(source) {
      const { min, max } = source.scales.x
      if (min == null || max == null) return
      if (current && current.min === min && current.max === max) return
      apply({ min, max }, source)
    },
    setRange(next) {
      apply(next)
    },
    range: () => current,
    publishCursor(idx) {
      for (const fn of cursorListeners) fn(idx)
    },
    onRange(fn) {
      rangeListeners.add(fn)
      return () => {
        rangeListeners.delete(fn)
      }
    },
    onCursor(fn) {
      cursorListeners.add(fn)
      return () => {
        cursorListeners.delete(fn)
      }
    },
  }
}
