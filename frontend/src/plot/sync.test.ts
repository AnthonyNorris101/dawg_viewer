import { describe, expect, it, vi } from 'vitest'
import type uPlot from 'uplot'
import { createViewSync } from './sync'

describe('pinned plot cursor', () => {
  it('replaces the pin and keeps hover from changing linked readouts', () => {
    const sync = createViewSync('test')
    const cursor = vi.fn()
    const redraw = vi.fn()
    sync.onCursor(cursor)
    sync.onPin(redraw)
    const data = [0, 1, 2]
    const plot = { data: [data], valToIdx: (x: number) => data.indexOf(x) } as unknown as uPlot
    sync.register(plot)

    sync.pin(1)
    expect(sync.pinnedX()).toBe(1)
    expect(cursor).toHaveBeenLastCalledWith(1)
    sync.publishCursor(2)
    expect(cursor).toHaveBeenCalledTimes(1)

    sync.pin(2)
    expect(sync.pinnedX()).toBe(2)
    expect(cursor).toHaveBeenLastCalledWith(2)
    expect(redraw).toHaveBeenCalledTimes(2)
    sync.clearPin()
    expect(sync.pinnedX()).toBeNull()
    expect(cursor).toHaveBeenLastCalledWith(null)
  })

  it('clears a pin when live samples roll past it', () => {
    const sync = createViewSync('live')
    const cursor = vi.fn()
    const data = [0, 1, 2]
    sync.register({ data: [data], valToIdx: (x: number) => data.indexOf(x) } as unknown as uPlot)
    sync.onCursor(cursor)
    sync.pin(1)
    data.splice(0, data.length, 2, 3, 4)
    sync.refreshPin()
    expect(sync.pinnedX()).toBeNull()
    expect(cursor).toHaveBeenLastCalledWith(null)
  })
})
