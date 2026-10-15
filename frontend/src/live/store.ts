import type { Row } from '../../bindings/dawg_viewer/internal/live/models'

const INITIAL_CAPACITY = 4096

/**
 * Column store for live rows. Every channel has one value per row: a row that
 * doesn't carry a channel repeats its previous value (the device only sends
 * what changed recently), and a channel's first value is copied back over the
 * rows before it so plots never see gaps. History is capped at `maxRows`; the
 * oldest quarter is dropped when it fills.
 */
export class LiveStore {
  private cap = INITIAL_CAPACITY
  private time = new Float64Array(this.cap)
  private cols = new Map<string, Float64Array>()
  private updatedAt = new Map<string, number>()
  private listeners = new Set<() => void>()
  length = 0

  constructor(private maxRows: number) {}

  setMaxRows(n: number) {
    this.maxRows = Math.max(INITIAL_CAPACITY, n)
  }

  append(rows: readonly Row[]) {
    if (rows.length === 0) return
    for (const row of rows) {
      if (this.length === this.cap) this.makeRoom()
      const i = this.length
      this.time[i] = row.t
      if (i > 0) for (const col of this.cols.values()) col[i] = col[i - 1]
      const values = row.v ?? {}
      for (const name in values) {
        const v = values[name]
        if (v === undefined) continue
        let col = this.cols.get(name)
        if (!col) {
          col = new Float64Array(this.cap)
          col.fill(v, 0, i)
          this.cols.set(name, col)
        }
        col[i] = v
        this.updatedAt.set(name, row.t)
      }
      this.length++
    }
    for (const fn of this.listeners) fn()
  }

  reset() {
    this.cap = INITIAL_CAPACITY
    this.time = new Float64Array(this.cap)
    this.cols.clear()
    this.updatedAt.clear()
    this.length = 0
    for (const fn of this.listeners) fn()
  }

  private makeRoom() {
    if (this.cap < this.maxRows) {
      const cap = Math.min(this.cap * 2, this.maxRows)
      this.time = grow(this.time, cap)
      for (const [name, col] of this.cols) this.cols.set(name, grow(col, cap))
      this.cap = cap
      return
    }
    const drop = this.cap >> 2
    this.time.copyWithin(0, drop, this.length)
    for (const col of this.cols.values()) col.copyWithin(0, drop, this.length)
    this.length -= drop
  }

  /** Session time of every row, oldest first. The view is only valid until the next append. */
  times(): Float64Array {
    return this.time.subarray(0, this.length)
  }

  /** One value per row for `name`, or null if the channel hasn't been seen. */
  column(name: string): Float64Array | null {
    return this.cols.get(name)?.subarray(0, this.length) ?? null
  }

  latest(name: string): number | undefined {
    const col = this.cols.get(name)
    return col && this.length > 0 ? col[this.length - 1] : undefined
  }

  /** Session time of the newest row that actually carried `name`. */
  lastUpdate(name: string): number | undefined {
    return this.updatedAt.get(name)
  }

  bounds(): [number, number] | null {
    return this.length > 0 ? [this.time[0], this.time[this.length - 1]] : null
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }
}

function grow(a: Float64Array, cap: number) {
  const b = new Float64Array(cap)
  b.set(a)
  return b
}
