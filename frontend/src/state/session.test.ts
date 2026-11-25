import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const files = vi.hoisted(() => new Map<string, string>())
const stock = vi.hoisted(() => ({ setup: '', sampleLog: '' }))

vi.mock('../../bindings/dawg_viewer/services', () => ({
  LiveService: {
    Stock: vi.fn(async () => ({ ...stock })),
    LoadSession: vi.fn(async () => files.get('session.json') ?? ''),
    SaveSession: vi.fn(async (data: string) => {
      files.set('session.json', data)
    }),
    SavePreset: vi.fn(async (name: string, data: string) => {
      files.set(`presets/${name.trim()}.json`, data)
      return { name: name.trim(), modified: 1 }
    }),
    LoadPreset: vi.fn(async (name: string) => {
      const found = files.get(`presets/${name}.json`)
      if (found == null) throw new Error('no such setup')
      return found
    }),
    DeletePreset: vi.fn(async (name: string) => {
      files.delete(`presets/${name}.json`)
    }),
  },
}))

import { LiveService } from '../../bindings/dawg_viewer/services'
import { mathDefs, track, updateTrack } from './analysis'
import { dampers } from './dampers'
import { mapBackground } from './mapBackground'
import {
  activeSetup,
  createSetup,
  firstBootLog,
  flush,
  importSetup,
  openSetup,
  openUnnamed,
  removeSetup,
  SAVE_DELAY_MS,
  SAVE_RETRY_MS,
  saveState,
  startSession,
  stopSession,
} from './session'
import { applySetup, askOnStart, lastLog, originalSetup, type Setup } from './setup'
import { sim } from './sim'

const file = (name: string) => JSON.parse(files.get(name) ?? 'null')
const withRadius = (radius: number): Setup => ({
  ...originalSetup(),
  track: { ...originalSetup().track!, radius },
})
const put = (name: string, setup: Setup) =>
  files.set(`presets/${name}.json`, JSON.stringify(setup, null, 2))

beforeEach(() => {
  vi.useFakeTimers()
  files.clear()
  stock.setup = ''
  stock.sampleLog = ''
  localStorage.clear()
  applySetup(originalSetup())
  lastLog.set('')
  askOnStart.set(true)
  mapBackground.set('')
})

afterEach(() => {
  stopSession()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('session in the config folder', () => {
  it('moves what the app had into the folder the first time', async () => {
    updateTrack({ radius: 33 })
    lastLog.set('C:/logs/Run-1.csv')
    await startSession()
    await flush()
    const session = file('session.json')
    expect(session.dawgViewerSession).toBe(1)
    expect(session.setup).toBe('')
    expect(session.lastLog).toBe('C:/logs/Run-1.csv')
    expect(session.unnamed.track.radius).toBe(33)
    expect(Object.keys(session.other)).not.toContain('dawg.track.v2')
    expect(saveState.get().phase).toBe('saved')
  })

  it('opens the setup in use, the last log and the other choices from the folder', async () => {
    put('Endurance', withRadius(22))
    files.set(
      'session.json',
      JSON.stringify({
        dawgViewerSession: 1,
        setup: 'Endurance',
        lastLog: 'a.csv',
        askOnStart: false,
        unnamed: withRadius(40),
        other: { 'dawg.mapBackground.v1': '"satellite"' },
      }),
    )
    await startSession()
    expect(activeSetup.get()).toBe('Endurance')
    expect(track.get().radius).toBe(22)
    expect(lastLog.get()).toBe('a.csv')
    expect(askOnStart.get()).toBe(false)
    expect(mapBackground.get()).toBe('satellite')
    await flush()
    expect(file('session.json').unnamed.track.radius).toBe(40)
  })

  it('falls back to the unnamed view when the setup file is gone', async () => {
    files.set(
      'session.json',
      JSON.stringify({ dawgViewerSession: 1, setup: 'Gone', unnamed: withRadius(40) }),
    )
    await startSession()
    expect(activeSetup.get()).toBe('')
    expect(track.get().radius).toBe(40)
  })

  it('saves a change into the setup in use without being asked', async () => {
    put('Endurance', withRadius(22))
    files.set('session.json', JSON.stringify({ dawgViewerSession: 1, setup: 'Endurance' }))
    await startSession()
    await flush()
    vi.mocked(LiveService.SavePreset).mockClear()
    updateTrack({ radius: 30 })
    sim.set({ ...sim.get(), smooth: 7 })
    expect(saveState.get().phase).toBe('pending')
    expect(LiveService.SavePreset).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    await flush()
    expect(LiveService.SavePreset).toHaveBeenCalledTimes(1)
    expect(file('presets/Endurance.json').track.radius).toBe(30)
    expect(file('presets/Endurance.json').sim.smooth).toBe(7)
    expect(saveState.get().phase).toBe('saved')
  })

  it('starts a new setup from the original view and keeps the unnamed view', async () => {
    await startSession()
    updateTrack({ radius: 40 })
    mathDefs.set([])
    const made = await createSetup('Skidpad', 'original')
    expect(made.name).toBe('Skidpad')
    expect(activeSetup.get()).toBe('Skidpad')
    expect(track.get().radius).toBe(originalSetup().track!.radius)
    expect(mathDefs.get()).toEqual(originalSetup().math)
    expect(file('presets/Skidpad.json').track.radius).toBe(originalSetup().track!.radius)
    expect(file('session.json').setup).toBe('Skidpad')
    expect(file('session.json').unnamed.track.radius).toBe(40)
    await openUnnamed()
    expect(activeSetup.get()).toBe('')
    expect(track.get().radius).toBe(40)
    expect(mathDefs.get()).toEqual([])
  })

  it("starts a new setup from what's open now when asked", async () => {
    await startSession()
    updateTrack({ radius: 40 })
    await createSetup('Copy', 'current', 'run.csv')
    expect(activeSetup.get()).toBe('Copy')
    expect(track.get().radius).toBe(40)
    expect(file('presets/Copy.json').track.radius).toBe(40)
    expect(file('presets/Copy.json').log).toBe('run.csv')
    updateTrack({ radius: 41 })
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    await flush()
    expect(file('presets/Copy.json').track.radius).toBe(41)
    expect(file('presets/Copy.json').log).toBe('run.csv')
  })

  it('writes a waiting change into the old setup before switching', async () => {
    put('A', withRadius(15))
    put('B', withRadius(25))
    files.set('session.json', JSON.stringify({ dawgViewerSession: 1, setup: 'A' }))
    await startSession()
    updateTrack({ radius: 50 })
    await openSetup('B')
    expect(file('presets/A.json').track.radius).toBe(50)
    expect(file('presets/B.json').track.radius).toBe(25)
    expect(track.get().radius).toBe(25)
    expect(file('session.json').setup).toBe('B')
  })

  it('goes back to the unnamed view when the setup in use is deleted', async () => {
    await startSession()
    updateTrack({ radius: 40 })
    await createSetup('Temp', 'original')
    await removeSetup('Temp')
    expect(files.has('presets/Temp.json')).toBe(false)
    expect(activeSetup.get()).toBe('')
    expect(track.get().radius).toBe(40)
    expect(file('session.json').setup).toBe('')
  })

  it('imports a setup file into the unnamed view, not into the setup in use', async () => {
    put('A', withRadius(15))
    files.set('session.json', JSON.stringify({ dawgViewerSession: 1, setup: 'A' }))
    await startSession()
    await importSetup(withRadius(60))
    expect(activeSetup.get()).toBe('')
    expect(track.get().radius).toBe(60)
    expect(file('presets/A.json').track.radius).toBe(15)
    expect(file('session.json').unnamed.track.radius).toBe(60)
    await expect(importSetup({ nope: true })).rejects.toThrow('not a Dawg Viewer setup')
  })

  it('opens the stock view and the sample log the very first time', async () => {
    stock.setup = JSON.stringify(withRadius(21))
    stock.sampleLog = 'C:/config/logs/Run-1 sample.csv'
    await startSession()
    expect(firstBootLog()).toBe('C:/config/logs/Run-1 sample.csv')
    expect(track.get().radius).toBe(21)
    expect(originalSetup().track!.radius).toBe(21)
    await flush()
    expect(file('session.json').unnamed.track.radius).toBe(21)
    updateTrack({ radius: 30 })
    await createSetup('Skidpad', 'original')
    expect(track.get().radius).toBe(21)
  })

  it('still opens the sample once when an earlier version left an empty session', async () => {
    stock.setup = JSON.stringify(withRadius(21))
    stock.sampleLog = 'C:/config/logs/Run-1 sample.csv'
    files.set(
      'session.json',
      JSON.stringify({ dawgViewerSession: 1, setup: '', lastLog: '', unnamed: originalSetup() }),
    )
    await startSession()
    expect(firstBootLog()).toBe('C:/config/logs/Run-1 sample.csv')
    expect(track.get().radius).toBe(15)
    await flush()
    expect(file('session.json').sampleShown).toBe(true)
    stopSession()
    await startSession()
    expect(firstBootLog()).toBe('')
  })

  it('gives the sample its start/finish line without resetting a view that has none', async () => {
    const line = { lat: 33.0, lon: -84.1 }
    stock.setup = JSON.stringify({
      ...originalSetup(),
      track: { ...originalSetup().track!, beacon: line },
    })
    stock.sampleLog = 'C:/config/logs/Run-1 sample.csv'
    files.set(
      'session.json',
      JSON.stringify({ dawgViewerSession: 1, setup: '', lastLog: '', unnamed: withRadius(40) }),
    )
    await startSession()
    expect(firstBootLog()).toBe('C:/config/logs/Run-1 sample.csv')
    expect(track.get().radius).toBe(40)
    expect(track.get().beacon).toEqual(line)
  })

  it('offers the stock damper table once, to a view that has none', async () => {
    const table = {
      file: 'stock table',
      settings: [
        { shock: 'RF', setting: 'Open', gas: 50, points: [{ v: 0.1, comp: 80, reb: 180 }] },
      ],
    }
    stock.setup = JSON.stringify({ ...originalSetup(), dampers: table })
    files.set(
      'session.json',
      JSON.stringify({ dawgViewerSession: 1, setup: '', lastLog: 'mine.csv', sampleShown: true }),
    )
    await startSession()
    expect(dampers.get()).toEqual(table)
    await flush()
    expect(file('session.json').dampersOffered).toBe(true)
    expect(file('session.json').unnamed.dampers).toEqual(table)
    dampers.set(null)
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    await flush()
    stopSession()
    await startSession()
    expect(dampers.get()).toBeNull()
  })

  it('leaves a view that is already there alone and opens no sample', async () => {
    stock.setup = JSON.stringify(withRadius(21))
    stock.sampleLog = 'C:/config/logs/Run-1 sample.csv'
    updateTrack({ radius: 33 })
    lastLog.set('C:/logs/mine.csv')
    await startSession()
    expect(firstBootLog()).toBe('')
    expect(track.get().radius).toBe(33)
  })

  it('says when it could not save and tries again', async () => {
    await startSession()
    await flush()
    vi.mocked(LiveService.SaveSession).mockRejectedValueOnce(new Error('disk is full'))
    updateTrack({ radius: 44 })
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS)
    expect(saveState.get()).toEqual({ phase: 'error', error: 'disk is full' })
    await vi.advanceTimersByTimeAsync(SAVE_RETRY_MS)
    expect(saveState.get().phase).toBe('saved')
    expect(file('session.json').unnamed.track.radius).toBe(44)
  })
})
