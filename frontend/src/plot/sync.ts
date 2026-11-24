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
  pinnedX(): number | null
  pin(x: number): void
  refreshPin(): void
  clearPin(): void
  onPin(fn: () => void): () => void
}

export function createViewSync(cursorKey: string): ViewSync {
  const plots = new Set<uPlot>()
  const rangeListeners = new Set<(range: Range) => void>()
  const cursorListeners = new Set<(idx: number | null) => void>()
  let current: Range | null = null
  let pinned: number | null = null
  const pinListeners = new Set<() => void>()
  const publishPinned = () => {
    const plot = plots.values().next().value as uPlot | undefined
    if (!plot || pinned == null) return
    const x = plot.data[0] as ArrayLike<number>
    if (!x.length || pinned < x[0] || pinned > x[x.length - 1]) {
      pinned = null
      for (const fn of pinListeners) fn()
      for (const fn of cursorListeners) fn(null)
      return
    }
    const idx = plot.valToIdx(pinned)
    for (const fn of cursorListeners) fn(idx)
  }

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
      if (pinned != null) return
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
    pinnedX: () => pinned,
    pin(x) {
      pinned = x
      for (const fn of pinListeners) fn()
      publishPinned()
    },
    refreshPin: publishPinned,
    clearPin() {
      if (pinned == null) return
      pinned = null
      for (const fn of pinListeners) fn()
      for (const fn of cursorListeners) fn(null)
    },
    onPin(fn) {
      pinListeners.add(fn)
      return () => {
        pinListeners.delete(fn)
      }
    },
  }
}

// Follows a ViewSync's range for work of two costs: `frame` runs at most once
// per animation frame while the range moves, `settled` once the range has
// held still for `settleMs`. Both run once at the start. Returns a stop
// function that cancels anything pending.
export function watchRange(
  sync: ViewSync,
  { frame, settled }: { frame: () => void; settled: () => void },
  settleMs: number,
): () => void {
  let queued = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  queued = requestAnimationFrame(() => {
    queued = 0
    frame()
    settled()
  })
  const off = sync.onRange(() => {
    if (!queued)
      queued = requestAnimationFrame(() => {
        queued = 0
        frame()
      })
    clearTimeout(timer)
    timer = setTimeout(settled, settleMs)
  })
  return () => {
    off()
    if (queued) cancelAnimationFrame(queued)
    clearTimeout(timer)
  }
}
