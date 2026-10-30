import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LogService } from '../../bindings/dawg_viewer/services'
import type { ViewerLog } from '../../bindings/dawg_viewer/services/models'
import { info } from '../live/connection'
import { openLog, pickAndOpenLog, startingPanels } from './openLog'

vi.mock('../../bindings/dawg_viewer/services', () => ({
  LogService: { Load: vi.fn(), PickFile: vi.fn() },
}))

const log: ViewerLog = {
  name: 'session.csv',
  path: 'session.csv',
  note: '',
  rows: 3,
  dataUrl: '/logdata/1',
  channels: [
    { name: 'RPM', unit: 'rpm' },
    { name: 'TPS1', unit: '%' },
  ],
}

beforeEach(() => {
  vi.mocked(LogService.Load).mockReset()
  vi.mocked(LogService.PickFile).mockReset()
  info.set(null)
})

describe('openLog', () => {
  it('reads columnar data and chooses preferred channels', async () => {
    vi.mocked(LogService.Load).mockResolvedValue(log)
    const values = new Float64Array([0, 0.5, 1, 4000, 4100, 4200, 20, 25, 30])
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => values.buffer,
      }),
    )

    const session = await openLog('session.csv')
    expect([...session.time]).toEqual([0, 0.5, 1])
    expect([...session.byId.get('RPM')!.data]).toEqual([4000, 4100, 4200])
    expect(session.sampleRate).toBe(2)
    expect(startingPanels(session)).toEqual([['RPM', 'TPS1']])
  })

  it('rejects incomplete data', async () => {
    vi.mocked(LogService.Load).mockResolvedValue(log)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new Float64Array([0]).buffer,
      }),
    )
    await expect(openLog('session.csv')).rejects.toThrow('arrived incomplete')
  })

  it('does nothing when file selection is canceled', async () => {
    vi.mocked(LogService.PickFile).mockResolvedValue('')
    await expect(pickAndOpenLog()).resolves.toBeNull()
    expect(LogService.Load).not.toHaveBeenCalled()
  })
})
