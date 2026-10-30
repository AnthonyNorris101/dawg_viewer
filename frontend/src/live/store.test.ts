import { describe, expect, it, vi } from 'vitest'
import { LiveStore } from './store'

describe('LiveStore', () => {
  it('retains sparse values and backfills newly discovered channels', () => {
    const store = new LiveStore(4096)
    store.append([
      { t: 1, v: { RPM: 4000 } },
      { t: 2, v: { TPS1: 30 } },
      { t: 3, v: { RPM: 4200 } },
    ])

    expect([...store.times()]).toEqual([1, 2, 3])
    expect([...store.column('RPM')!]).toEqual([4000, 4000, 4200])
    expect([...store.column('TPS1')!]).toEqual([30, 30, 30])
    expect(store.latest('RPM')).toBe(4200)
    expect(store.lastUpdate('TPS1')).toBe(2)
    expect(store.column('missing')).toBeNull()
  })

  it('bounds history, notifies subscribers, and resets', () => {
    const store = new LiveStore(4096)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.append(Array.from({ length: 5000 }, (_, t) => ({ t, v: { RPM: t } })))

    expect(store.length).toBeLessThanOrEqual(4096)
    expect(store.bounds()?.[1]).toBe(4999)
    expect(store.latest('RPM')).toBe(4999)
    expect(store.times()[0]).toBeGreaterThan(0)
    expect(listener).toHaveBeenCalledTimes(1)

    store.reset()
    expect(store.length).toBe(0)
    expect(store.bounds()).toBeNull()
    expect(store.lastUpdate('RPM')).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    store.append([{ t: 1, v: { RPM: 1 } }])
    expect(listener).toHaveBeenCalledTimes(2)
  })
})
