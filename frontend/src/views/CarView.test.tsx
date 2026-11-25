import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CarView } from './CarView'

const service = vi.hoisted(() => ({ ReadCarFile: vi.fn(), SaveCar: vi.fn() }))
const picked = vi.hoisted(() => ({ text: null as string | null }))
const live = vi.hoisted(() => ({
  car: { mass: 0, gears: null, torque: [] } as Record<string, unknown>,
  stockCar: undefined as Record<string, unknown> | undefined,
}))

vi.mock('../../bindings/dawg_viewer/services', () => ({ LiveService: service }))
vi.mock('../live/connection', () => ({
  useInfo: () => ({
    active: 'g26-iltm',
    car: live.car,
    stockCar: live.stockCar,
    profiles: [{ id: 'g26-iltm', file: 'g26_iltm.yaml' }],
  }),
  info: { get: () => null, set: () => {} },
}))
vi.mock('../state/storage', async (original) => ({
  ...(await original<typeof import('../state/storage')>()),
  pickTextFile: () => Promise.resolve(picked.text),
}))
vi.mock('../components/SensorEditor', () => ({ SensorEditor: () => null }))

beforeEach(() => {
  service.ReadCarFile.mockReset()
  service.SaveCar.mockReset()
  live.car = { mass: 0, gears: null, torque: [] }
  live.stockCar = undefined
})

describe('Car tab', () => {
  it('fills the page from a device file and waits for Save', async () => {
    const user = userEvent.setup()
    picked.text = 'car:\n  mass: 277\n'
    service.ReadCarFile.mockResolvedValue({
      mass: 277,
      wheelbase: 1.53,
      gears: null,
      finalDrive: 3.27,
      torque: [
        [4000, 15],
        [9500, 47.7],
        [12500, 16.8],
      ],
      tire: { pcy1: 1.47938 },
    })
    render(<CarView />)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Import car values…' }))
    expect(service.ReadCarFile).toHaveBeenCalledWith('car:\n  mass: 277\n')
    const status = await screen.findByText(/Read \d+ car values from that file/)
    expect(status).toHaveTextContent(
      'Read 5 car values from that file. Nothing is saved yet: check them, then press Save.',
    )
    expect(screen.getByDisplayValue('277')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1.53')).toBeInTheDocument()
    expect(service.SaveCar).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

    service.SaveCar.mockResolvedValue({ active: 'g26-iltm', car: {} })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const sent = service.SaveCar.mock.calls[0][0]
    expect(sent).toMatchObject({ mass: 277, wheelbase: 1.53, finalDrive: 3.27 })
    expect(sent.torque).toHaveLength(3)
    expect(sent.tire).toEqual({ pcy1: 1.47938 })
    expect(sent.tireMu).toBe(0)
    expect(sent.cgHeight).toBe(0)
    expect(sent.gears).toEqual([])
  })

  it('says why a file could not be used and changes nothing', async () => {
    const user = userEvent.setup()
    picked.text = 'id: g26\n'
    service.ReadCarFile.mockRejectedValue(new Error('that file has no car: block'))
    render(<CarView />)
    await user.click(screen.getByRole('button', { name: 'Import car values…' }))
    expect(
      await screen.findByText("Couldn't use that file: that file has no car: block"),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    picked.text = null
    await user.click(screen.getByRole('button', { name: 'Import car values…' }))
    expect(service.ReadCarFile).toHaveBeenCalledTimes(1)
  })

  it('uses the stock car where the profile has no value, tags it, and keeps it out of Save', async () => {
    const user = userEvent.setup()
    live.car = { mass: 0, wheelbase: 1.6, gears: null, torque: [] }
    live.stockCar = {
      mass: 277,
      wheelbase: 1.53,
      redline: 13000,
      torque: [
        [4000, 15],
        [9500, 47.7],
      ],
      tire: { pcy1: 1.47938 },
    }
    render(<CarView />)
    expect(screen.getByDisplayValue('277')).toBeInTheDocument()
    expect(screen.getByDisplayValue('1.6')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('1.53')).not.toBeInTheDocument()
    expect(screen.getByRole('note')).toHaveTextContent(
      '4 of these are the G26 values that come with the app',
    )
    expect(
      screen.getByText(/The torque curve and the tire model below came with the app/),
    ).toBeInTheDocument()

    const redline = screen.getByDisplayValue('13000')
    await user.clear(redline)
    await user.type(redline, '12500')
    expect(screen.getByRole('note')).toHaveTextContent('3 of these are the G26 values')
    service.SaveCar.mockResolvedValue({ active: 'g26-iltm', car: {} })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const sent = service.SaveCar.mock.calls[0][0]
    expect(sent.redline).toBe(12500)
    expect(sent.wheelbase).toBe(1.6)
    expect(sent.mass).toBe(0)
    expect(sent.torque).toEqual([])
    expect(sent.tire).toEqual({})
  })
})
