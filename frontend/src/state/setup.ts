import type { MathDef } from '../analysis/math'
import {
  DEFAULT_LAUNCH,
  DEFAULT_MATH,
  DEFAULT_TRACK,
  launch,
  launchMarks,
  mathDefs,
  splits,
  track,
  validBeacon,
  validLaunch,
  validMarks,
  validMath,
  validSplits,
  validTrack,
  type LaunchSettings,
  type TrackSettings,
} from './analysis'
import { dampers, validDampers, type DamperData } from './dampers'
import { references, validReferences, type Reference } from './references'
import { DEFAULT_SIM, sim, validSim, type SimSettings } from './sim'
import { isObject, load, persisted, save } from './storage'
import { defaultWorkbook, validWorkbook, withSimSheet, type Workbook } from './workbook'
import type { Beacon } from '../analysis/track'

export const WORKBOOK_KEY = 'workbook.v1'

export interface Setup {
  dawgViewerSetup: 1
  workbook: Workbook | null
  math: MathDef[]
  beacon: Beacon | null
  track?: TrackSettings
  launch?: LaunchSettings
  references?: Reference[]
  sim?: SimSettings
  dampers?: DamperData | null
  splits?: Record<string, number[]>
  launchMarks?: Record<string, [number, number][]>
  log?: string
}

const listeners = new Set<(wb: Workbook | null) => void>()

export function onWorkbook(fn: (wb: Workbook | null) => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export const savedWorkbook = () =>
  load<Workbook | null>(WORKBOOK_KEY, null, (v): v is Workbook => validWorkbook(v))

export const lastLog = persisted<string>(
  'lastLog.v1',
  '',
  (v): v is string => typeof v === 'string',
)

export const askOnStart = persisted<boolean>(
  'askSetup.v1',
  true,
  (v): v is boolean => typeof v === 'boolean',
)

export function currentSetup(log?: string): Setup {
  return {
    dawgViewerSetup: 1,
    workbook: savedWorkbook(),
    math: mathDefs.get(),
    beacon: track.get().beacon,
    track: track.get(),
    launch: launch.get(),
    references: references.get(),
    sim: sim.get(),
    dampers: dampers.get(),
    splits: splits.get(),
    launchMarks: launchMarks.get(),
    ...(log ? { log } : {}),
  }
}

let stock: Partial<Setup> = {}

export function setStockSetup(raw: unknown) {
  stock = {}
  if (!isObject(raw) || raw.dawgViewerSetup !== 1) return
  if (raw.workbook != null && validWorkbook(raw.workbook)) stock.workbook = raw.workbook
  if (validMath(raw.math)) stock.math = raw.math
  if (validTrack(raw.track)) {
    stock.track = raw.track
    stock.beacon = raw.track.beacon
  }
  if (validLaunch(raw.launch)) stock.launch = raw.launch
  if (validReferences(raw.references)) stock.references = raw.references
  if (validSim(raw.sim)) stock.sim = raw.sim
  if ('dampers' in raw && validDampers(raw.dampers)) stock.dampers = raw.dampers
}

export function originalSetup(log?: string): Setup {
  return {
    dawgViewerSetup: 1,
    workbook: null,
    math: DEFAULT_MATH,
    beacon: DEFAULT_TRACK.beacon,
    track: DEFAULT_TRACK,
    launch: DEFAULT_LAUNCH,
    references: [],
    sim: DEFAULT_SIM,
    dampers: null,
    splits: {},
    launchMarks: {},
    ...stock,
    ...(log ? { log } : {}),
  }
}

export const SETUP_KEYS = [
  WORKBOOK_KEY,
  mathDefs.key,
  track.key,
  launch.key,
  references.key,
  sim.key,
  dampers.key,
  splits.key,
  launchMarks.key,
]

function setWorkbook(wb: Workbook | null) {
  save(WORKBOOK_KEY, wb)
  for (const fn of listeners) fn(wb)
}

export function showSimSheet(channelNames: Set<string>) {
  setWorkbook(withSimSheet(savedWorkbook() ?? defaultWorkbook(channelNames, true), channelNames))
}

export function checkSetup(raw: unknown): asserts raw is Record<string, unknown> {
  if (!isObject(raw) || raw.dawgViewerSetup !== 1) throw new Error('not a Dawg Viewer setup')
  if (raw.workbook != null && !validWorkbook(raw.workbook)) {
    throw new Error('the worksheets in this setup are damaged')
  }
}

export function applySetup(raw: unknown): Setup {
  checkSetup(raw)
  if (validMath(raw.math)) mathDefs.set(raw.math)
  if (validTrack(raw.track)) track.set(raw.track)
  else if (raw.beacon === null || validBeacon(raw.beacon))
    track.set({ ...track.get(), beacon: raw.beacon })
  if (validLaunch(raw.launch)) launch.set(raw.launch)
  if (validReferences(raw.references)) references.set(raw.references)
  if (validSim(raw.sim)) sim.set(raw.sim)
  if ('dampers' in raw && validDampers(raw.dampers)) dampers.set(raw.dampers)
  if (validSplits(raw.splits)) splits.set(raw.splits)
  if (validMarks(raw.launchMarks)) launchMarks.set(raw.launchMarks)
  setWorkbook((raw.workbook as Workbook | null) ?? null)
  return raw as unknown as Setup
}

export function freshSetup() {
  mathDefs.set(DEFAULT_MATH)
  setWorkbook(null)
}
