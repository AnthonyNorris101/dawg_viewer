import { beforeEach, describe, expect, it } from 'vitest'
import { parseSegments, segmentsTrack } from '../analysis/sim/simtrack'
import { DEFAULT_SIM, sim, validSim, type SimSettings } from '../state/sim'
import { canSaveTrack, openTrackFile, parseTrackFile, trackToSave } from './trackLibrary'

const typed = segmentsTrack(parseSegments(DEFAULT_SIM.custom).segments, { closed: true })!
const ring = Array.from({ length: 24 }, (_, i) => (2 * Math.PI * i) / 24)
const path = {
  name: 'Ring',
  source: 'OpenStreetMap · Test Raceway',
  closed: true,
  x: ring.map((a) => 30 * Math.cos(a)),
  y: ring.map((a) => 30 * Math.sin(a)),
  origin: { lat: 33.95, lon: -83.37 },
}

beforeEach(() => sim.set(DEFAULT_SIM))

describe('saved tracks', () => {
  it('saves a typed track with its width and opens it again', () => {
    const settings: SimSettings = {
      ...DEFAULT_SIM,
      track: 'custom',
      customClosed: true,
      lineWidth: 4,
    }
    const file = trackToSave('  Autocross  ', settings, typed)!
    expect(file).toMatchObject({
      dawgViewerTrack: 1,
      name: 'Autocross',
      kind: 'segments',
      width: 4,
    })
    const back = parseTrackFile(JSON.stringify(file))!
    expect(back).toEqual(file)
    openTrackFile(back)
    expect(sim.get()).toMatchObject({
      track: 'custom',
      custom: DEFAULT_SIM.custom,
      customClosed: true,
      lineWidth: 4,
    })
  })

  it('saves an outline to the millimetre and opens it again', () => {
    const settings: SimSettings = { ...DEFAULT_SIM, track: 'path', path }
    const file = trackToSave('Ring', settings, null)!
    expect(file.kind).toBe('path')
    expect(file.x![1]).toBe(Math.round(path.x[1] * 1000) / 1000)
    openTrackFile(parseTrackFile(JSON.stringify(file))!)
    const s = sim.get()
    expect(s.track).toBe('path')
    expect(s.path?.source).toBe('OpenStreetMap · Test Raceway')
    expect(s.path?.origin).toEqual(path.origin)
    expect(s.path?.x).toHaveLength(24)
    expect(validSim(s)).toBe(true)
  })

  it('saves the driven line of a logged lap as an outline, only with GPS', () => {
    const settings: SimSettings = { ...DEFAULT_SIM, track: 'log' }
    const driven = { ...typed, name: 'Lap 6', origin: { lat: 33.95, lon: -83.37 } }
    expect(canSaveTrack(settings, typed)).toBe(false)
    expect(trackToSave('x', settings, typed)).toBeNull()
    const file = trackToSave('Test day', settings, driven, 'Run-1.csv')!
    expect(file.kind).toBe('path')
    expect(file.source).toBe('Lap 6 of Run-1.csv, the line as driven (GPS)')
    expect(file.x).toHaveLength(driven.x.length)
    expect(file.origin).toEqual(driven.origin)
    expect(file.smooth).toBe(3)
    openTrackFile(parseTrackFile(JSON.stringify(file))!)
    expect(sim.get().path?.smooth).toBe(3)
    expect(validSim(sim.get())).toBe(true)
  })

  it('has nothing to save for the skidpad and refuses other files', () => {
    expect(canSaveTrack({ ...DEFAULT_SIM, track: 'skidpad' }, typed)).toBe(false)
    expect(canSaveTrack({ ...DEFAULT_SIM, track: 'path', path: null }, null)).toBe(false)
    expect(parseTrackFile('{')).toBeNull()
    expect(parseTrackFile('{"dawgViewerSetup":1}')).toBeNull()
    expect(
      parseTrackFile(
        '{"dawgViewerTrack":1,"name":"x","closed":true,"kind":"path","x":[1],"y":[1]}',
      ),
    ).toBeNull()
    expect(
      parseTrackFile(
        '{"dawgViewerTrack":1,"name":"x","closed":false,"kind":"segments","sections":"straight 10","width":-3}',
      )?.width,
    ).toBe(3.5)
  })
})
