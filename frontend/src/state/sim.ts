import { useSyncExternalStore } from 'react'
import type { Overrides } from '../analysis/sim/sweep'
import type { CurvatureSource } from '../analysis/sim/simtrack'
import { isObject, persisted } from './storage'

export type SimSection = 'engine' | 'accel' | 'lap' | 'balance' | 'dampers' | 'sweep'
export type SimTrackKind = 'log' | 'skidpad' | 'accel' | 'custom' | 'path'
export type SweepMetric = 'accel' | 'skidpad' | 'lap' | 'top'

export interface PathTrack {
  name: string
  source: string
  closed: boolean
  x: number[]
  y: number[]
  origin?: { lat: number; lon: number }
  smooth?: number
}

export const DEFAULT_LINE_WIDTH = 3.5
export const DEFAULT_LINE_ROOM = 1

export interface SimSettings {
  section: SimSection
  overrides: Overrides
  track: SimTrackKind
  lapKey: string
  curvature: CurvatureSource
  smooth: number
  custom: string
  customClosed: boolean
  sweepParam: string
  sweepFrom: number | null
  sweepTo: number | null
  sweepSteps: number
  sweepMetric: SweepMetric
  channels: boolean
  path?: PathTrack | null
  line?: boolean
  lineWidth?: number
  lineRoom?: number
}

export const DEFAULT_CUSTOM_TRACK = [
  '# One part per line: straight <metres>, or left/right <radius m> <length m or angle deg>',
  'straight 60',
  'left 9 180deg',
  'straight 25',
  'right 15 90deg',
  'left 15 90deg',
  'straight 30',
  'left 9 180deg',
  'straight 40',
].join('\n')

export const DEFAULT_SIM: SimSettings = {
  section: 'engine',
  overrides: {},
  track: 'log',
  lapKey: '',
  curvature: 'auto',
  smooth: 3,
  custom: DEFAULT_CUSTOM_TRACK,
  customClosed: true,
  sweepParam: 'finalDrive',
  sweepFrom: null,
  sweepTo: null,
  sweepSteps: 9,
  sweepMetric: 'accel',
  channels: true,
}

const SECTIONS: SimSection[] = ['engine', 'accel', 'lap', 'balance', 'dampers', 'sweep']
const TRACKS: SimTrackKind[] = ['log', 'skidpad', 'accel', 'custom', 'path']
const METRICS: SweepMetric[] = ['accel', 'skidpad', 'lap', 'top']
const SOURCES: CurvatureSource[] = ['auto', 'gps', 'accel']
const numOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v))
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const points = (v: unknown) => Array.isArray(v) && v.length >= 3 && v.every(finite)

export const validPath = (v: unknown): v is PathTrack =>
  isObject(v) &&
  typeof v.name === 'string' &&
  typeof v.source === 'string' &&
  typeof v.closed === 'boolean' &&
  points(v.x) &&
  points(v.y) &&
  (v.x as number[]).length === (v.y as number[]).length &&
  (v.origin === undefined ||
    (isObject(v.origin) && finite(v.origin.lat) && finite(v.origin.lon))) &&
  (v.smooth === undefined || (finite(v.smooth) && v.smooth >= 0 && v.smooth <= 50))

export const validSim = (v: unknown): v is SimSettings =>
  isObject(v) &&
  SECTIONS.includes(v.section as SimSection) &&
  isObject(v.overrides) &&
  Object.values(v.overrides).every((x) => typeof x === 'number' && Number.isFinite(x)) &&
  TRACKS.includes(v.track as SimTrackKind) &&
  typeof v.lapKey === 'string' &&
  SOURCES.includes(v.curvature as CurvatureSource) &&
  typeof v.smooth === 'number' &&
  v.smooth >= 0 &&
  v.smooth <= 50 &&
  typeof v.custom === 'string' &&
  typeof v.customClosed === 'boolean' &&
  typeof v.sweepParam === 'string' &&
  numOrNull(v.sweepFrom) &&
  numOrNull(v.sweepTo) &&
  typeof v.sweepSteps === 'number' &&
  METRICS.includes(v.sweepMetric as SweepMetric) &&
  typeof v.channels === 'boolean' &&
  (v.path == null || validPath(v.path)) &&
  (v.line === undefined || typeof v.line === 'boolean') &&
  (v.lineWidth === undefined || (finite(v.lineWidth) && v.lineWidth > 0 && v.lineWidth <= 50)) &&
  (v.lineRoom === undefined || (finite(v.lineRoom) && v.lineRoom >= 0 && v.lineRoom <= 25))

export const sim = persisted<SimSettings>('sim.v1', DEFAULT_SIM, validSim)
export const useSim = () => useSyncExternalStore(sim.subscribe, sim.get)
export const updateSim = (patch: Partial<SimSettings>) => sim.set({ ...sim.get(), ...patch })
