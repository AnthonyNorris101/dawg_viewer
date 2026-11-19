import { useSyncExternalStore } from 'react'
import type { MathDef } from '../analysis/math'
import type { Beacon } from '../analysis/track'
import type { LapMode, TrackSettings } from '../analysis/settings'
import { isObject, persisted } from './storage'

export const validMath = (v: unknown): v is MathDef[] =>
  Array.isArray(v) &&
  v.every(
    (d) =>
      isObject(d) &&
      typeof d.id === 'string' &&
      typeof d.name === 'string' &&
      typeof d.expr === 'string' &&
      typeof d.unit === 'string' &&
      typeof d.precision === 'number',
  )

export const DEFAULT_MATH: MathDef[] = [
  {
    id: 'm-combined-g',
    name: 'Combined G',
    expr: 'hypot(AccelX, AccelY)',
    unit: 'g',
    precision: 2,
  },
  {
    id: 'm-brake-bias',
    name: 'Brake Bias',
    expr: 'if(FBPS + RBPS > 50, FBPS / (FBPS + RBPS) * 100, 0)',
    unit: '%',
    precision: 1,
  },
  {
    id: 'm-steer-rate',
    name: 'Steer Rate',
    expr: 'deriv(smooth(StrAngle, 0.05))',
    unit: '°/s',
    precision: 0,
  },
]

export const mathDefs = persisted<MathDef[]>('math.v1', DEFAULT_MATH, validMath)
export const useMathDefs = () => useSyncExternalStore(mathDefs.subscribe, mathDefs.get)

export type { LapMode, TrackSettings } from '../analysis/settings'
export const LAP_MODES: LapMode[] = ['loop', 'gates', 'launch', 'manual']

export const DEFAULT_TRACK: TrackSettings = {
  beacon: null,
  radius: 15,
  minLap: 10,
  distance: 'auto',
  speedChannel: '',
  speedUnit: 'auto',
  normalize: true,
  fuse: true,
}

export const validBeacon = (v: unknown): v is Beacon =>
  isObject(v) && typeof v.lat === 'number' && typeof v.lon === 'number'

export const validTrack = (v: unknown): v is TrackSettings =>
  isObject(v) &&
  (v.beacon === null || validBeacon(v.beacon)) &&
  typeof v.radius === 'number' &&
  typeof v.minLap === 'number' &&
  typeof v.distance === 'string' &&
  typeof v.speedChannel === 'string' &&
  typeof v.speedUnit === 'string' &&
  typeof v.normalize === 'boolean' &&
  typeof v.fuse === 'boolean' &&
  (v.lapMode === undefined || LAP_MODES.includes(v.lapMode as LapMode)) &&
  (v.finish === undefined || v.finish === null || validBeacon(v.finish)) &&
  (v.runLength === undefined || (typeof v.runLength === 'number' && v.runLength >= 0))

export const track = persisted<TrackSettings>('track.v2', DEFAULT_TRACK, validTrack)
export const useTrack = () => useSyncExternalStore(track.subscribe, track.get)
export const updateTrack = (patch: Partial<TrackSettings>) =>
  track.set({ ...track.get(), ...patch })

const validSplits = (v: unknown): v is Record<string, number[]> =>
  isObject(v) &&
  Object.values(v).every((a) => Array.isArray(a) && a.every((x) => typeof x === 'number'))

export const splits = persisted<Record<string, number[]>>('splits.v1', {}, validSplits)
export const useSplits = () => useSyncExternalStore(splits.subscribe, splits.get)

export function setSplits(path: string, times: number[]) {
  const all = { ...splits.get() }
  if (times.length > 0) all[path] = [...new Set(times)].sort((a, b) => a - b)
  else delete all[path]
  splits.set(all)
}

const validMarks = (v: unknown): v is Record<string, [number, number][]> =>
  isObject(v) &&
  Object.values(v).every(
    (a) =>
      Array.isArray(a) &&
      a.every(
        (w) =>
          Array.isArray(w) &&
          w.length === 2 &&
          typeof w[0] === 'number' &&
          typeof w[1] === 'number',
      ),
  )

export const launchMarks = persisted<Record<string, [number, number][]>>(
  'launchMarks.v1',
  {},
  validMarks,
)
export const useLaunchMarks = () => useSyncExternalStore(launchMarks.subscribe, launchMarks.get)

export function setLaunchMarks(path: string, marks: [number, number][]) {
  const all = { ...launchMarks.get() }
  if (marks.length > 0) all[path] = marks
  else delete all[path]
  launchMarks.set(all)
}

let nextMathId = Date.now()
export const newMathId = () => `m-${(nextMathId++).toString(36)}`

export interface LaunchSettings {
  window: number
  driven: string
  ground: string
}

export const DEFAULT_LAUNCH: LaunchSettings = { window: 4, driven: '', ground: '' }

export const validLaunch = (v: unknown): v is LaunchSettings =>
  isObject(v) &&
  typeof v.window === 'number' &&
  typeof v.driven === 'string' &&
  typeof v.ground === 'string'

export const launch = persisted<LaunchSettings>('launch.v3', DEFAULT_LAUNCH, validLaunch)
export const useLaunch = () => useSyncExternalStore(launch.subscribe, launch.get)
export const updateLaunch = (patch: Partial<LaunchSettings>) =>
  launch.set({ ...launch.get(), ...patch })
