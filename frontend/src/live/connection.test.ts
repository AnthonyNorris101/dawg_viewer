import { describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { LiveService } from '../../bindings/dawg_viewer/services'
import type { Info } from '../../bindings/dawg_viewer/services/models'
import { channels, info, observable, startLive, status, store } from './connection'

vi.mock('@wailsio/runtime', () => ({ Events: { On: vi.fn(() => vi.fn()) } }))
vi.mock('../../bindings/dawg_viewer/services', () => ({
  LiveService: { Info: vi.fn(), Status: vi.fn(), Channels: vi.fn() },
}))

const sampleInfo: Info = {
  version: '0.2.0',
  configDir: { path: 'C:/config', source: 'default' },
  settings: {
    device: 'logger',
    frameRate: 20,
    historyMinutes: 1,
    staleAfterS: 2,
    logsDir: 'C:/logs',
    csvRateHz: 100,
  },
  profiles: [],
  profileErrors: [],
  active: 'logger',
  channels: {},
  settingsError: '',
}

describe('live connection', () => {
  it('notifies observers and refreshes state from the Wails services', async () => {
    const value = observable(1)
    const listener = vi.fn()
    const unsubscribe = value.subscribe(listener)
    value.set(2)
    expect(value.get()).toBe(2)
    expect(listener).toHaveBeenCalledOnce()
    unsubscribe()
    value.set(3)
    expect(listener).toHaveBeenCalledOnce()

    const nextStatus = { ...status.get(), startedAt: 123, state: 'receiving' }
    vi.mocked(LiveService.Info).mockResolvedValue(sampleInfo)
    vi.mocked(LiveService.Status).mockResolvedValue(nextStatus)
    vi.mocked(LiveService.Channels).mockResolvedValue([{ name: 'RPM', id: 11, meta: { order: 0 } }])
    store.append([{ t: 1, v: { RPM: 4000 } }])
    startLive()
    await vi.waitFor(() => expect(info.get()).toEqual(sampleInfo))

    expect(status.get()).toEqual(nextStatus)
    expect(channels.get().map((channel) => channel.name)).toEqual(['RPM'])
    expect(store.length).toBe(0)
    expect(Events.On).toHaveBeenCalledTimes(3)
  })
})
