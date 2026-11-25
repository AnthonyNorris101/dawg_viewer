import { useMemo } from 'react'
import { correlate, type Correlation } from '../analysis/sim/fromlog'
import { simulateLap, type LapResult } from '../analysis/sim/lapsim'
import { idealLine, trackFromPath } from '../analysis/sim/raceline'
import {
  parseSegments,
  segmentsTrack,
  skidpadTrack,
  straightTrack,
  type SimTrack,
} from '../analysis/sim/simtrack'
import { bestLap, type Lap } from '../analysis/track'
import { DEFAULT_LINE_ROOM, DEFAULT_LINE_WIDTH, type SimSettings } from '../state/sim'
import { lapTrack } from '../viewer/simChannels'
import type { SimCars, SimLog } from './shared'

export const TIRE_WIDTH = 0.2

export interface SimLine {
  base: SimTrack
  baseResult: LapResult
  track: SimTrack
  result: LapResult
  along: Float64Array
  offset: Float64Array
  room: number
  driven: boolean
  tried: number
}

export interface SimPace {
  lap: string
  real: number
  sim: number
  ratio: number
}

export interface SimLap {
  track: SimTrack | null
  problem: string
  errors: string[]
  lap: Lap | null
  timed: Lap[]
  result: LapResult | null
  variantResult: LapResult | null
  correlation: Correlation | null
  entrySpeed: number | undefined
  pace: SimPace | null
  line: SimLine | null
  lineNote: string
  carWidth: number
}

export function useSimLap(cars: SimCars, log: SimLog | null, s: SimSettings): SimLap {
  const timed = useMemo(() => (log ? log.laps.filter((l) => l.kind === 'lap') : []), [log])
  const lap = useMemo(
    () => timed.find((l) => l.key === s.lapKey) ?? bestLap(timed) ?? timed[0] ?? null,
    [timed, s.lapKey],
  )
  const built = useMemo(() => {
    const none = { track: null as SimTrack | null, problem: '', errors: [] as string[] }
    if (s.track === 'skidpad') return { ...none, track: skidpadTrack() }
    if (s.track === 'accel') return { ...none, track: straightTrack() }
    if (s.track === 'custom') {
      const { segments, errors } = parseSegments(s.custom)
      const track = segmentsTrack(segments, { closed: s.customClosed })
      return {
        track,
        errors,
        problem: track ? '' : 'Add at least one straight or corner to the track.',
      }
    }
    if (s.track === 'path') {
      const p = s.path
      if (!p) return { ...none, problem: 'Import a track outline or search for one.' }
      const track = trackFromPath(p.name, p.x, p.y, {
        closed: p.closed,
        origin: p.origin,
        smoothM: p.smooth,
      })
      return {
        ...none,
        track,
        problem: track ? '' : 'This outline is too short to make a track from.',
      }
    }
    if (!log) return { ...none, problem: 'Open a log in the Viewer to use one of its laps.' }
    if (!log.inputs)
      return { ...none, problem: 'This log has no distance (it needs GPS or a speed channel).' }
    if (!lap)
      return {
        ...none,
        problem: 'This log has no timed laps yet. Set them up in the Viewer’s Laps tab.',
      }
    const track = lapTrack(log.inputs, lap, { source: s.curvature, smooth: s.smooth }, log.loop)
    return {
      ...none,
      track,
      problem: track
        ? ''
        : 'Could not build a track from this lap. It needs lateral g with speed, or GPS.',
    }
  }, [s.track, s.custom, s.customClosed, s.curvature, s.smooth, s.path, log, lap])

  const { track } = built
  const fromLog = s.track === 'log' && !!log?.inputs && !!lap && !!track
  const entrySpeed =
    fromLog && log?.inputs && lap && track && !track.closed && !track.standing
      ? log.inputs.speed[lap.start]
      : undefined
  const result = useMemo(
    () => (track ? simulateLap(cars.car, track, cars.limits, { entrySpeed }) : null),
    [track, cars.car, cars.limits, entrySpeed],
  )
  const variantResult = useMemo(
    () =>
      track && cars.variant && cars.variantLimits
        ? simulateLap(cars.variant, track, cars.variantLimits, { entrySpeed })
        : null,
    [track, cars.variant, cars.variantLimits, entrySpeed],
  )
  const pace = useMemo<SimPace | null>(() => {
    const best = bestLap(timed)
    if (!log?.inputs || !best) return null
    const t = lapTrack(log.inputs, best, { source: s.curvature, smooth: s.smooth }, log.loop)
    if (!t) return null
    const entry = !t.closed && !t.standing ? log.inputs.speed[best.start] : undefined
    const time = simulateLap(cars.car, t, cars.limits, { entrySpeed: entry }).time
    const ratio = best.time / time
    return ratio > 0.8 && ratio < 2 ? { lap: best.label, real: best.time, sim: time, ratio } : null
  }, [log, timed, s.curvature, s.smooth, cars.car, cars.limits])

  const carWidth = Math.max(cars.car.trackFront, cars.car.trackRear) + TIRE_WIDTH
  const lineOn = !!s.line && (s.track === 'custom' || s.track === 'path' || s.track === 'log')
  const driven = s.track === 'log'
  const room = driven
    ? (s.lineRoom ?? DEFAULT_LINE_ROOM)
    : Math.max(0, ((s.lineWidth ?? DEFAULT_LINE_WIDTH) - carWidth) / 2)
  const lineBase = useMemo(() => {
    if (!lineOn || !track) return null
    if (!driven) return track
    if (!track.origin) return null
    return trackFromPath(`${track.name} · driven line`, track.x, track.y, {
      closed: track.closed,
      standing: track.standing,
      origin: track.origin,
      smoothM: Math.max(1.5, s.smooth),
    })
  }, [lineOn, driven, track, s.smooth])
  const line = useMemo<SimLine | null>(() => {
    if (!lineBase || !(room > 0)) return null
    const run = (t: SimTrack) => simulateLap(cars.car, t, cars.limits, { entrySpeed })
    const best = idealLine(lineBase, room, (t) => run(t).time)
    if (!best) return null
    return {
      base: lineBase,
      baseResult: run(lineBase),
      track: best.track,
      result: run(best.track),
      along: best.along,
      offset: best.offset,
      room,
      driven,
      tried: best.tried.length,
    }
  }, [lineBase, room, driven, cars.car, cars.limits, entrySpeed])
  const lineNote = !lineOn
    ? ''
    : !track
      ? ''
      : driven && !track.origin
        ? 'This lap has no GPS path, so there is no driven line to improve on.'
        : !(room > 0)
          ? driven
            ? 'Give the car some room either side of the driven line.'
            : `The track is no wider than the car (${carWidth.toFixed(2)} m), so there is no room to pick a line.`
          : line
            ? ''
            : 'Could not work out a line for this track.'

  const correlation = useMemo(() => {
    if (!fromLog || !result || !log?.inputs || !lap) return null
    const inp = log.inputs
    const count = lap.end - lap.start + 1
    const d0 = inp.distance[lap.start]
    const realS = Float64Array.from({ length: count }, (_, i) => inp.distance[lap.start + i] - d0)
    return correlate(realS, inp.speed.subarray(lap.start, lap.end + 1), lap.time, result)
  }, [fromLog, result, log, lap])

  return {
    ...built,
    lap: s.track === 'log' ? lap : null,
    timed,
    result,
    variantResult,
    correlation,
    entrySpeed,
    pace,
    line,
    lineNote,
    carWidth,
  }
}
