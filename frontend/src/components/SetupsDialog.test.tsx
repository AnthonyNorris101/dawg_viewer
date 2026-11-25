import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const files = vi.hoisted(() => new Map<string, string>())

vi.mock('../../bindings/dawg_viewer/services', () => ({
  LiveService: {
    LoadSession: vi.fn(async () => files.get('session.json') ?? ''),
    SaveSession: vi.fn(async (data: string) => {
      files.set('session.json', data)
    }),
    Presets: vi.fn(async () =>
      [...files.keys()]
        .filter((k) => k.startsWith('presets/'))
        .map((k) => ({ name: k.slice(8, -5), modified: 1 })),
    ),
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

import { track, updateTrack } from '../state/analysis'
import { activeSetup, flush, startSession, stopSession } from '../state/session'
import { applySetup, originalSetup } from '../state/setup'
import { SetupsDialog } from './SetupsDialog'

const file = (name: string) => JSON.parse(files.get(name) ?? 'null')
const show = () => render(<SetupsDialog startup={false} onOpenLog={() => {}} onClose={() => {}} />)

beforeEach(async () => {
  files.clear()
  localStorage.clear()
  applySetup(originalSetup())
  await startSession()
  await flush()
})

afterEach(() => {
  stopSession()
  vi.clearAllMocks()
})

describe('Setups dialog', () => {
  it('starts a new setup from the original view unless told otherwise', async () => {
    const user = userEvent.setup()
    updateTrack({ radius: 40 })
    show()
    expect(screen.getByText(/In use: Unnamed view/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /The original view/ })).toBeChecked()
    await user.type(screen.getByLabelText('Setup name'), 'Skidpad')
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText(/Created “Skidpad” from the original view/)).toBeInTheDocument()
    expect(activeSetup.get()).toBe('Skidpad')
    expect(track.get().radius).toBe(originalSetup().track!.radius)
    expect(file('presets/Skidpad.json').track.radius).toBe(originalSetup().track!.radius)
    expect(await screen.findByText('In use')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use the unnamed view' })).toBeInTheDocument()
  })

  it("copies what's open now when that is picked", async () => {
    const user = userEvent.setup()
    updateTrack({ radius: 40 })
    show()
    await user.type(screen.getByLabelText('Setup name'), 'Endurance')
    await user.click(screen.getByRole('radio', { name: /What's open now/ }))
    await user.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText(/Created “Endurance” from what's open now/)).toBeInTheDocument()
    expect(track.get().radius).toBe(40)
    expect(file('presets/Endurance.json').track.radius).toBe(40)
  })

  it('will not write over a setup that already has that name', async () => {
    const user = userEvent.setup()
    files.set('presets/Endurance_ wet.json', JSON.stringify(originalSetup()))
    show()
    await user.type(screen.getByLabelText('Setup name'), 'endurance: wet')
    expect(screen.getByText(/A setup with that name exists/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('switches to a saved setup', async () => {
    const user = userEvent.setup()
    files.set(
      'presets/Autocross.json',
      JSON.stringify({ ...originalSetup(), track: { ...originalSetup().track!, radius: 9 } }),
    )
    show()
    await user.click(await screen.findByRole('button', { name: 'Use Autocross' }))
    await vi.waitFor(() => expect(activeSetup.get()).toBe('Autocross'))
    expect(track.get().radius).toBe(9)
    expect(file('session.json').setup).toBe('Autocross')
  })
})
