import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_SIM, sim } from '../state/sim'
import { SimView } from './SimView'

const live = vi.hoisted(() => ({
  car: { clA: 3, cdA: 1.3 } as Record<string, unknown> | null,
}))

vi.mock('../live/connection', () => ({
  useInfo: () => ({
    car: live.car,
    mapSources: [],
    active: 'logger',
    configDir: { path: 'C:\\Users\\me\\AppData\\Roaming\\DawgViewer', source: 'user' },
  }),
  info: { get: () => null, set: () => {} },
}))

vi.mock('../sim/SimTrackMap', () => ({ SimTrackMap: () => <div>Track map</div> }))

beforeEach(() => {
  sim.set(DEFAULT_SIM)
  live.car = { clA: 3, cdA: 1.3 }
})

describe('Sim tab', () => {
  it('runs the events for the car on the Car tab without a log', async () => {
    const user = userEvent.setup()
    render(<SimView session={null} />)
    expect(screen.getByRole('heading', { name: 'Simulator' })).toBeInTheDocument()
    const warning = screen.getByRole('alert')
    expect(warning).toHaveTextContent('Not your engine')
    expect(warning).toHaveTextContent(
      'The Car tab has no torque curve yet, so this tab is running on the app’s stand-in curve for a restricted 600 cc engine: 58 N·m peak torque, 80 hp peak power.',
    )
    expect(warning).not.toHaveTextContent('AppData')
    expect(screen.getByText('Peak torque · stand-in')).toBeInTheDocument()
    expect(screen.getByText(/stand-in curve, not your engine/)).toBeInTheDocument()
    const pages = screen.getByRole('navigation', { name: 'Simulator pages' })

    await user.click(within(pages).getByRole('button', { name: 'Acceleration' }))
    expect(screen.getByText('75 m (FSAE acceleration)')).toBeInTheDocument()
    expect(screen.getByText(/Open a log in the Viewer to compare/)).toBeInTheDocument()

    await user.click(within(pages).getByRole('button', { name: 'Lap' }))
    expect(screen.getByText(/Open a log in the Viewer to use one of its laps/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Track to simulate'), 'skidpad')
    expect(screen.getByText(/Skidpad \(9\.13 m radius\): 57 m, flying lap/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Track to simulate'), 'custom')
    await user.clear(screen.getByLabelText('Track description'))
    await user.type(screen.getByLabelText('Track description'), 'straight 50{enter}up 3')
    expect(screen.getByText(/Line 2: "up" is not straight, left or right/)).toBeInTheDocument()

    await user.click(within(pages).getByRole('button', { name: 'Skidpad & balance' }))
    expect(screen.getByText('Roll gradient')).toBeInTheDocument()
    expect(
      screen.getAllByText(/the rear runs out first|the front runs out first|Neutral/),
    ).not.toHaveLength(0)
  })

  it('compares a what-if car and sweeps a value', async () => {
    const user = userEvent.setup()
    render(<SimView session={null} />)
    await user.click(screen.getByRole('button', { name: '+ Add a change' }))
    await user.selectOptions(screen.getByLabelText('What to change'), 'mass')
    const mass = screen.getByLabelText('What-if Mass with driver')
    await user.clear(mass)
    await user.type(mass, '250')
    expect(sim.get().overrides).toEqual({ mass: 250 })
    expect(screen.getAllByText(/What-if \d/).length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByText(/^−0\.\d+ s$/).length).toBeGreaterThanOrEqual(1)

    const pages = screen.getByRole('navigation', { name: 'Simulator pages' })
    await user.click(within(pages).getByRole('button', { name: 'Sweeps' }))
    expect(screen.getByLabelText('Value to sweep')).toHaveValue('finalDrive')
    expect(screen.getByText(/Best in this range/)).toBeInTheDocument()
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(10)
    await user.selectOptions(screen.getByLabelText('Result to show'), 'lap')
    expect(screen.getByText('Pick a track on the Lap page first.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(sim.get().overrides).toEqual({})
  })

  it('works out the ideal line on a typed track', async () => {
    const user = userEvent.setup()
    sim.set({ ...DEFAULT_SIM, section: 'lap', track: 'custom' })
    render(<SimView session={null} />)
    expect(screen.queryByText('Middle of the track')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Work out the ideal line'))
    expect(sim.get().line).toBe(true)
    expect(screen.getByText('Middle of the track')).toBeInTheDocument()
    expect(screen.getByText(/The app tried 6 lines/)).toBeInTheDocument()
    expect(screen.getByText(/the car’s centre stays 1\.05 m or less/i)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Track width in metres'))
    await user.type(screen.getByLabelText('Track width in metres'), '1{enter}')
    expect(screen.getByText(/The track is no wider than the car \(1\.40 m\)/)).toBeInTheDocument()
    expect(screen.queryByText('Middle of the track')).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Track to simulate'), 'path')
    expect(screen.getByText(/Import a track outline or search for one\./)).toBeInTheDocument()
    expect(screen.getByText(/No outline yet/)).toBeInTheDocument()
  })

  it('hands a simulated lap to the Viewer, one lap per line', async () => {
    const user = userEvent.setup()
    const onView = vi.fn()
    sim.set({ ...DEFAULT_SIM, section: 'lap', track: 'custom', line: true })
    render(<SimView session={null} onView={onView} />)
    await user.click(screen.getByRole('button', { name: 'View this simulated lap in the Viewer' }))
    const made = onView.mock.calls[0][0]
    expect(made.simulated).toBe(true)
    expect(made.name).toBe('Simulated · Custom track')
    expect(made.fixedLaps).toHaveLength(3)
    expect(made.note).toMatch(/lap 1: the middle of the track; lap 2: the ideal line/)
  })

  it('says so on every page when no car has been entered, and where it is looking', async () => {
    const user = userEvent.setup()
    live.car = { mass: 0, gears: null, torque: [], tire: {} }
    sim.set({ ...DEFAULT_SIM, section: 'lap', track: 'skidpad' })
    render(<SimView session={null} />)
    const warning = screen.getByRole('alert')
    expect(warning).toHaveTextContent(
      'No car values have been entered for logger, so this tab is running on a typical FSAE car',
    )
    expect(warning).toHaveTextContent('58 N·m peak torque, 80 hp peak power')
    expect(warning).toHaveTextContent(
      'The app is reading its settings from C:\\Users\\me\\AppData\\Roaming\\DawgViewer',
    )
    await user.click(screen.getByRole('button', { name: 'Acceleration' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('drops the warning once the car has its own torque curve', () => {
    live.car = {
      mass: 277,
      torque: [
        [4000, 15],
        [9500, 47.7],
        [12500, 16.8],
      ],
    }
    sim.set({ ...DEFAULT_SIM, section: 'engine' })
    render(<SimView session={null} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Peak torque')).toBeInTheDocument()
    expect(screen.getByText('Torque and power at the crank')).toBeInTheDocument()
    expect(screen.getByText(/64 hp at 9500 rpm/)).toBeInTheDocument()
  })
})
