import { useMemo } from 'react'
import type { ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'
import type { Session } from '../data/session'
import { beaconCrossings, findGps } from '../analysis/track'
import { useLaunchMarks, useMathDefs, useSplits, useTrack } from '../state/analysis'
import {
  derivedChannels,
  mathChannels,
  positionFusion,
  sessionDistance,
  sessionLaps,
  TIMESLIP_ID,
  withMeta,
  withUnits,
  type Analysis,
} from './analysis'

export function useAnalysis(
  raw: Session,
  metas: Record<string, ChannelMeta | undefined> | undefined,
): Analysis {
  const unitKey = JSON.stringify(raw.channels.map((c) => metas?.[c.name]?.unit || c.unit))
  const base = useMemo(() => withUnits(raw, JSON.parse(unitKey) as string[]), [raw, unitKey])
  const track = useTrack()
  const defs = useMathDefs()
  const splitTimes = useSplits()[raw.path]
  const launchMarks = useLaunchMarks()[raw.path]
  const rawGps = useMemo(() => findGps(base.channels), [base])
  const fusionSettings = useMemo(
    () => ({ fuse: track.fuse, speedChannel: track.speedChannel, speedUnit: track.speedUnit }),
    [track.fuse, track.speedChannel, track.speedUnit],
  )
  const fusion = useMemo(
    () => positionFusion(base, rawGps, fusionSettings),
    [base, rawGps, fusionSettings],
  )
  const gps = useMemo(
    () => (rawGps && fusion ? { ...rawGps, lat: fusion.lat, lon: fusion.lon } : rawGps),
    [rawGps, fusion],
  )
  const distanceSettings = useMemo(
    () => ({
      distance: track.distance,
      speedChannel: track.speedChannel,
      speedUnit: track.speedUnit,
    }),
    [track.distance, track.speedChannel, track.speedUnit],
  )
  const dist = useMemo(
    () => sessionDistance(base, gps, distanceSettings),
    [base, gps, distanceSettings],
  )
  const mode = track.lapMode ?? 'loop'
  const crossings = useMemo(
    () =>
      gps && track.beacon && (mode === 'loop' || mode === 'gates')
        ? beaconCrossings(base.time, gps, track.beacon, track.radius, track.minLap)
        : [],
    [base, gps, track.beacon, track.radius, track.minLap, mode],
  )
  const finishes = useMemo(
    () =>
      gps && track.finish && mode === 'gates'
        ? beaconCrossings(base.time, gps, track.finish, track.radius, 1)
        : [],
    [base, gps, track.finish, track.radius, mode],
  )
  const laps = useMemo(
    () =>
      sessionLaps(
        base,
        dist.distance,
        crossings,
        finishes,
        splitTimes,
        mode,
        launchMarks,
        track.runLength,
      ),
    [base, dist.distance, crossings, finishes, splitTimes, mode, launchMarks, track.runLength],
  )
  const extra = useMemo(
    () => derivedChannels(base, dist.distance, laps),
    [base, dist.distance, laps],
  )
  const math = useMemo(() => mathChannels(base, extra, defs), [base, extra, defs])
  const display = useMemo(() => withMeta(base, metas), [base, metas])
  const session = useMemo<Session>(() => {
    if (extra.length === 0 && math.channels.length === 0) return display
    const channels = [...display.channels, ...extra, ...math.channels]
    return { ...display, channels, byId: new Map(channels.map((c) => [c.id, c])) }
  }, [display, extra, math.channels])
  const timeSlip = useMemo(
    () => ({
      id: TIMESLIP_ID,
      name: 'Time slip',
      group: 'Analysis',
      unit: 's',
      precision: 3,
      data: new Float64Array(0),
      color: '#e4e4e7',
    }),
    [],
  )
  return {
    fusion,
    session,
    gps,
    distance: dist.distance,
    distanceLabel: dist.label,
    laps,
    crossings,
    mathErrors: math.errors,
    timeSlip,
  }
}
