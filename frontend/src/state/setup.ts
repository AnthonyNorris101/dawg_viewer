import type { MathDef } from '../analysis/math'
import {
  DEFAULT_MATH,
  launch,
  mathDefs,
  track,
  validBeacon,
  validLaunch,
  validMath,
  validTrack,
  type LaunchSettings,
  type TrackSettings,
} from './analysis'
import { references, validReferences, type Reference } from './references'
import { isObject, load, persisted, save } from './storage'
import { validWorkbook, type Workbook } from './workbook'
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
    ...(log ? { log } : {}),
  }
}

function setWorkbook(wb: Workbook | null) {
  save(WORKBOOK_KEY, wb)
  for (const fn of listeners) fn(wb)
}

export function applySetup(raw: unknown): Setup {
  if (!isObject(raw) || raw.dawgViewerSetup !== 1) throw new Error('not a Dawg Viewer setup')
  if (raw.workbook != null && !validWorkbook(raw.workbook)) {
    throw new Error('the worksheets in this setup are damaged')
  }
  if (validMath(raw.math)) mathDefs.set(raw.math)
  if (validTrack(raw.track)) track.set(raw.track)
  else if (raw.beacon === null || validBeacon(raw.beacon))
    track.set({ ...track.get(), beacon: raw.beacon })
  if (validLaunch(raw.launch)) launch.set(raw.launch)
  if (validReferences(raw.references)) references.set(raw.references)
  setWorkbook((raw.workbook as Workbook | null) ?? null)
  return raw as unknown as Setup
}

export function freshSetup() {
  mathDefs.set(DEFAULT_MATH)
  setWorkbook(null)
}
