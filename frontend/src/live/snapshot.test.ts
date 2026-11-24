import { expect, it } from 'vitest'
import { LiveStore } from './store'
import { createLiveSessionReader } from './snapshot'

const channels = [{ name: 'RPM', id: 11, meta: { order: 0 } }]
const metas = {}

it('reuses unchanged snapshots and keeps published data immutable as rows arrive', () => {
  const store = new LiveStore(4096)
  const read = createLiveSessionReader(store, () => '#fff')
  expect(read(channels, metas, 'car')).toBeNull()
  store.append([
    { t: 0, v: { RPM: 1000 } },
    { t: 1, v: { RPM: 2000 } },
  ])
  const first = read(channels, metas, 'car')!
  expect(read(channels, metas, 'car')).toBe(first)
  store.append([{ t: 2, v: { RPM: 3000 } }])
  const next = read(channels, metas, 'car')!
  expect(next).not.toBe(first)
  expect([...first.channels[0].data]).toEqual([1000, 2000])
  expect([...next.channels[0].data]).toEqual([1000, 2000, 3000])

  const edited = read(channels, { RPM: { order: 0, precision: 0 } }, 'car')!
  expect(edited.time).toBe(next.time)
  expect(edited.channels[0].data).toBe(next.channels[0].data)
  expect(edited.channels[0].precision).toBe(0)
})

it('invalidates snapshots when the store resets even if the row count is unchanged', () => {
  const store = new LiveStore(4096)
  const read = createLiveSessionReader(store, () => '#fff')
  store.append([
    { t: 0, v: { RPM: 1 } },
    { t: 1, v: { RPM: 2 } },
  ])
  const first = read(channels, metas, 'car')!
  store.reset()
  store.append([
    { t: 0, v: { RPM: 3 } },
    { t: 1, v: { RPM: 4 } },
  ])
  const next = read(channels, metas, 'car')!
  expect([...next.channels[0].data]).toEqual([3, 4])
  expect([...first.channels[0].data]).toEqual([1, 2])
})
