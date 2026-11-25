import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { buildLimits } from '../analysis/sim/grip'
import { simulateLap } from '../analysis/sim/lapsim'
import { racingLine } from '../analysis/sim/raceline'
import { parseSegments, segmentsTrack, straightTrack } from '../analysis/sim/simtrack'
import { findGps, findSpeed } from '../analysis/track'
import { DEFAULT_CAR } from '../data/car'
import { originOf } from '../data/origin'
import { defaultWorkbook, SIM_SHEET, withSimSheet } from '../state/workbook'
import { useAnalysis } from '../viewer/useAnalysis'
import { useSimChannels } from '../viewer/useSimChannels'
import { isSimSession, NOWHERE, simSession } from './simSession'

const lim = buildLimits(DEFAULT_CAR)
const oval = segmentsTrack(
  parseSegments('straight 60\nleft 12 180deg\nstraight 60\nleft 12 180deg').segments,
  { closed: true },
)!
const middle = simulateLap(DEFAULT_CAR, oval, lim)
const line = racingLine(oval, 1.5)!
const ideal = simulateLap(DEFAULT_CAR, line.track, lim)

describe('a simulated lap as a log for the Viewer', () => {
  it('lays the laps end to end with their exact times', () => {
    const s = simSession('Simulated · oval', [
      { label: 'the middle of the track', track: oval, result: middle },
      { label: 'the ideal line', track: line.track, result: ideal, offset: line.offset },
    ])!
    expect(isSimSession(s)).toBe(true)
    expect(s.path).toMatch(/^sim:\/\/lap\//)
    expect(s.note).toMatch(
      /nothing here was measured · lap 1: the middle of the track; lap 2: the ideal line/,
    )
    expect(s.note).toMatch(/map position is made up/)
    expect(s.fixedLaps).toHaveLength(3)
    for (let i = 1; i < s.time.length; i++) expect(s.time[i]).toBeGreaterThan(s.time[i - 1])

    const metas = { Gear: { label: 'Gear (ECU)', unit: 'n' }, Speed: { unit: 'mph' } }
    const { result } = renderHook(() => useSimChannels(useAnalysis(s, metas as never)))
    const a = result.current
    const laps = a.laps.filter((l) => l.kind === 'lap')
    expect(a.laps).toHaveLength(2)
    expect(laps[0].time).toBeCloseTo(middle.time, 9)
    expect(laps[1].time).toBeCloseTo(ideal.time, 9)
    expect(laps[0].distance).toBeGreaterThan(oval.length * 0.97)
    expect(laps[0].distance).toBeLessThan(oval.length * 1.01)
    expect(laps[1].distance).toBeLessThan(laps[0].distance)

    const names = a.session.channels.map((c) => c.name)
    expect(names).toEqual(
      expect.arrayContaining(['Speed', 'Lat G', 'RPM', 'Line Offset', 'Distance']),
    )
    expect(names.some((n) => n.startsWith('Sim '))).toBe(false)
    for (const c of a.session.channels) {
      expect(originOf(c)).toBe('theory')
      expect(c.label).toMatch(/ · theoretical$/)
    }
    expect(a.session.byId.get('Lat G')?.label).toBe('Lat G (+left −right) · theoretical')
    expect(a.session.byId.get('Gear')?.label).toBe('Gear · theoretical')
    expect(a.session.byId.get('Speed')?.unit).toBe('km/h')
    expect(findSpeed(s.channels)?.unit).toBe('km/h')
    const gps = findGps(s.channels)!
    expect(gps.lat[5]).toBeCloseTo(NOWHERE.lat, 2)

    const speed = s.byId.get('Speed')!.data
    const first = a.laps[0]
    expect(speed[first.start]).toBeCloseTo(middle.v[0] * 3.6, 6)
    expect(Math.max(...speed.subarray(first.start, first.end))).toBeCloseTo(middle.vMax * 3.6, 0)
    const offset = s.byId.get('Line Offset')!.data
    expect(Math.max(...Array.from(offset.subarray(first.start, first.end), Math.abs))).toBe(0)
    expect(
      Math.max(...Array.from(offset.subarray(laps[1].start, laps[1].end), Math.abs)),
    ).toBeCloseTo(1.5, 2)
  })

  it('keeps a real position and handles a standing start', () => {
    const strip = { ...straightTrack(75), origin: { lat: 33.95, lon: -83.37 } }
    const run = simulateLap(DEFAULT_CAR, strip, lim)
    const s = simSession('Simulated · 75 m', [
      { label: 'acceleration', track: strip, result: run },
    ])!
    expect(s.note).not.toMatch(/made up/)
    expect(s.byId.has('Line Offset')).toBe(false)
    expect(s.byId.get('Latitude')!.data[0]).toBeCloseTo(33.95, 9)
    expect(s.byId.get('Speed')!.data[1]).toBeLessThan(1)
    const last = s.time.length - 2
    expect(s.time[last] - s.time[1]).toBeCloseTo(run.time, 9)
    expect(s.byId.get('X')!.data[last]).toBeCloseTo(75, 3)
    expect(simSession('nothing', [])).toBeNull()
  })

  it('gets its own sheet in the Viewer, made once', () => {
    const s = simSession('Simulated · oval', [
      { label: 'the middle of the track', track: oval, result: middle },
      { label: 'the ideal line', track: line.track, result: ideal, offset: line.offset },
    ])!
    const names = new Set(s.channels.map((c) => c.id))
    const mine = defaultWorkbook(new Set(['RPM', 'GPS Speed']), true)
    const wb = withSimSheet(mine, names)
    expect(wb.sheets).toHaveLength(mine.sheets.length + 1)
    const sheet = wb.sheets.find((x) => x.id === wb.activeId)!
    expect(sheet.name).toBe(SIM_SHEET)
    expect(sheet.layout.panels.map((p) => [p.kind, ...p.channelIds])).toEqual([
      ['time', 'Speed'],
      ['time', 'Long G', 'Lat G'],
      ['time', 'RPM', 'Gear'],
      ['time', 'Throttle', 'Limit'],
      ['time', 'Line Offset'],
      ['map', 'Speed'],
      ['xy', 'Lat G', 'Long G'],
    ])
    for (const p of sheet.layout.panels)
      for (const id of p.channelIds) expect(names.has(id)).toBe(true)
    const elsewhere = { ...wb, activeId: mine.activeId }
    const again = withSimSheet(elsewhere, names)
    expect(again.sheets).toHaveLength(wb.sheets.length)
    expect(again.activeId).toBe(sheet.id)
  })
})
