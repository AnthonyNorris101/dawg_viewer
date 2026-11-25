import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_SIM, sim, validSim } from '../state/sim'
import { importTrack } from './importTrack'
import type { SimLog } from './shared'
import { SavedTracks, TrackSearch } from './TrackTools'
import type { SimLap } from './useSimLap'

const allowed = { online: true, byName: false }
const found = {
  name: 'Kart Track',
  place: 'Test Raceway, Georgia',
  lat: [33.95, 33.95, 33.9504, 33.9504],
  lon: [-83.37, -83.3694, -83.3694, -83.37],
  closed: true,
  length: 199.6,
}

const service = vi.hoisted(() => ({
  FindTracks: vi.fn(),
  TracksNear: vi.fn(),
  SavedTracks: vi.fn(),
  SaveTrack: vi.fn(),
  LoadTrack: vi.fn(),
  DeleteTrack: vi.fn(),
}))
const picked = vi.hoisted(() => ({ file: null as { name: string; bytes: Uint8Array } | null }))

vi.mock('../../bindings/dawg_viewer/services', () => ({ LiveService: service }))
vi.mock('../live/connection', () => ({ useInfo: () => ({ trackSearch: allowed }) }))
vi.mock('../state/storage', async (original) => ({
  ...(await original<typeof import('../state/storage')>()),
  pickFile: () => Promise.resolve(picked.file),
}))

const settings = { ...DEFAULT_SIM, track: 'path' as const }
const log = {
  name: 'Run-1',
  laps: [],
  loop: true,
  inputs: { gps: { lat: Float64Array.of(NaN, 33.9512), lon: Float64Array.of(NaN, -83.3761) } },
} as unknown as SimLog

beforeEach(() => {
  sim.set(DEFAULT_SIM)
  allowed.byName = false
  service.FindTracks.mockReset()
  service.TracksNear.mockReset()
})

describe('finding a track online', () => {
  it('keeps name search off until a geocoder is set, and can still look around the log', async () => {
    const user = userEvent.setup()
    service.TracksNear.mockResolvedValue([])
    render(<TrackSearch log={log} settings={settings} />)
    expect(screen.getByText(/Searching by name is off/)).toBeInTheDocument()
    expect(screen.getByLabelText('Track or place to search for')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Search by name' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Search around the open log' }))
    expect(service.TracksNear).toHaveBeenCalledWith(33.9512, -83.3761)
    expect(await screen.findByText(/No race track is mapped within 3 km/)).toBeInTheDocument()
    expect(service.FindTracks).not.toHaveBeenCalled()
  })

  it('lists what a name search finds and uses the one picked', async () => {
    const user = userEvent.setup()
    allowed.byName = true
    service.FindTracks.mockResolvedValue([found])
    render(<TrackSearch log={null} settings={settings} />)
    expect(screen.getByRole('button', { name: 'Search around the open log' })).toBeDisabled()
    await user.type(screen.getByLabelText('Track or place to search for'), 'test raceway{enter}')
    expect(service.FindTracks).toHaveBeenCalledWith('test raceway')
    expect(await screen.findByText('Kart Track')).toBeInTheDocument()
    expect(screen.getByText(/200 m, closed loop · Test Raceway, Georgia/)).toBeInTheDocument()
    expect(screen.getByText(/© OpenStreetMap contributors/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Use this track' }))
    const path = sim.get().path
    expect(path?.name).toBe('Kart Track')
    expect(path?.source).toBe('OpenStreetMap · Test Raceway, Georgia')
    expect(path?.origin).toEqual({ lat: 33.95, lon: -83.37 })
    expect(path?.x[1]).toBeCloseTo(55.3, 0)
    expect(path?.y[2]).toBeCloseTo(44.5, 0)
    expect(validSim(sim.get())).toBe(true)
  })

  it('shows what went wrong', async () => {
    const user = userEvent.setup()
    allowed.byName = true
    service.FindTracks.mockRejectedValue(
      new Error('overpass-api.de could not be reached (offline?)'),
    )
    render(<TrackSearch log={null} settings={settings} />)
    await user.type(screen.getByLabelText('Track or place to search for'), 'x{enter}')
    expect(await screen.findByText(/could not be reached/)).toBeInTheDocument()
  })
})

describe('importing a track file', () => {
  const bytes = (s: string) => new TextEncoder().encode(s)

  it('turns a table of sections into a typed track', async () => {
    picked.file = {
      name: 'autocross.csv',
      bytes: bytes('Type,Section Length,Corner Radius\nStraight,60,0\nLeft,28.3,9'),
    }
    const note = await importTrack(DEFAULT_SIM)
    expect(note).toMatch(/Read 2 sections, 88\.3 m.*Closed loop/)
    expect(sim.get().track).toBe('custom')
    expect(sim.get().custom).toBe(
      '# autocross (imported from autocross.csv)\nstraight 60\nleft 9 28.3',
    )
  })

  it('keeps an outline as points and takes its width', async () => {
    const ring = Array.from({ length: 30 }, (_, i) => {
      const a = (2 * Math.PI * i) / 30
      return `${50 * Math.cos(a)},${50 * Math.sin(a)},4,5`
    })
    picked.file = {
      name: 'ring.csv',
      bytes: bytes('# x_m,y_m,w_tr_right_m,w_tr_left_m\n' + ring.join('\n')),
    }
    expect(await importTrack(DEFAULT_SIM)).toMatch(/Read 30 x\/y points/)
    const s = sim.get()
    expect(s.track).toBe('path')
    expect(s.path?.closed).toBe(true)
    expect(s.path?.source).toBe('file ring.csv')
    expect(s.lineWidth).toBe(9)
    expect(validSim(s)).toBe(true)
  })

  it('smooths a recorded GPX drive but not a drawn outline', async () => {
    const pts = Array.from({ length: 40 }, (_, i) => {
      const a = (2 * Math.PI * i) / 40
      return `<trkpt lat="${33.95 + (60 * Math.sin(a)) / 111195}" lon="${-83.37 + (60 * Math.cos(a)) / 92000}"/>`
    })
    picked.file = {
      name: 'drive.gpx',
      bytes: bytes(`<gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`),
    }
    expect(await importTrack(DEFAULT_SIM)).toMatch(/smoothed over 3 m/)
    expect(sim.get().path?.smooth).toBe(3)
    expect(validSim(sim.get())).toBe(true)
  })

  it('reports a file it cannot read and changes nothing', async () => {
    picked.file = { name: 'notes.txt', bytes: bytes('hello') }
    expect(await importTrack(DEFAULT_SIM)).toMatch(/No track found in this file/)
    expect(sim.get()).toEqual(DEFAULT_SIM)
    picked.file = null
    expect(await importTrack(DEFAULT_SIM)).toBe('')
  })
})

describe('the saved track library', () => {
  const files = new Map<string, string>()
  const lap = { track: { name: 'Custom track' } } as unknown as SimLap

  beforeEach(() => {
    files.clear()
    service.SavedTracks.mockImplementation(async () =>
      [...files.keys()].map((name) => ({ name, modified: 1 })),
    )
    service.SaveTrack.mockImplementation(async (name: string, data: string) => {
      files.set(name.trim(), data)
      return { name: name.trim(), modified: 1 }
    })
    service.LoadTrack.mockImplementation(async (name: string) => files.get(name) ?? '')
    service.DeleteTrack.mockImplementation(async (name: string) => void files.delete(name))
  })

  it('saves the track on screen, opens it later and deletes it on a second click', async () => {
    const user = userEvent.setup()
    const custom = { ...DEFAULT_SIM, track: 'custom' as const, custom: 'straight 80', lineWidth: 5 }
    const { rerender } = render(<SavedTracks log={null} settings={custom} data={lap} />)
    expect(await screen.findByRole('option', { name: 'None saved yet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save track' })).toBeDisabled()
    await user.type(screen.getByLabelText('Name to save this track as'), 'Drag strip{enter}')
    expect(await screen.findByText('Saved “Drag strip” to the tracks folder.')).toBeInTheDocument()
    expect(JSON.parse(files.get('Drag strip')!)).toMatchObject({
      dawgViewerTrack: 1,
      kind: 'segments',
      sections: 'straight 80',
      width: 5,
    })

    sim.set(DEFAULT_SIM)
    rerender(<SavedTracks log={null} settings={DEFAULT_SIM} data={lap} />)
    await user.selectOptions(screen.getByLabelText('Saved tracks'), '')
    await user.selectOptions(screen.getByLabelText('Saved tracks'), 'Drag strip')
    expect(await screen.findByText(/Opened “Drag strip”/)).toBeInTheDocument()
    expect(sim.get()).toMatchObject({ track: 'custom', custom: 'straight 80', lineWidth: 5 })

    rerender(<SavedTracks log={null} settings={sim.get()} data={lap} />)
    await user.type(screen.getByLabelText('Name to save this track as'), 'drag strip')
    expect(screen.getByRole('button', { name: 'Replace saved track' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Delete saved track Drag strip' }))
    expect(files.has('Drag strip')).toBe(true)
    expect(screen.getByRole('button', { name: 'Delete saved track Drag strip' })).toHaveTextContent(
      'Really delete?',
    )
    await user.click(screen.getByRole('button', { name: 'Delete saved track Drag strip' }))
    expect(await screen.findByText('Deleted “Drag strip”.')).toBeInTheDocument()
    expect(files.size).toBe(0)
  })

  it('has nothing to save on the skidpad and says so when a file is not a track', async () => {
    const user = userEvent.setup()
    files.set('Old', '{"dawgViewerSetup":1}')
    render(<SavedTracks log={null} settings={{ ...DEFAULT_SIM, track: 'skidpad' }} data={lap} />)
    expect(screen.getByLabelText('Name to save this track as')).toBeDisabled()
    await user.selectOptions(await screen.findByLabelText('Saved tracks'), 'Old')
    expect(
      await screen.findByText('“Old” is not a track saved by Dawg Viewer.'),
    ).toBeInTheDocument()
    expect(sim.get()).toEqual(DEFAULT_SIM)
  })
})
