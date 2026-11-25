import type { SimTrack } from '../analysis/sim/simtrack'
import {
  DEFAULT_LINE_WIDTH,
  updateSim,
  validPath,
  type PathTrack,
  type SimSettings,
} from '../state/sim'
import { isObject } from '../state/storage'

export interface TrackFile {
  dawgViewerTrack: 1
  name: string
  kind: 'segments' | 'path'
  source: string
  closed: boolean
  width: number
  sections?: string
  x?: number[]
  y?: number[]
  origin?: { lat: number; lon: number }
  smooth?: number
}

const mm = (v: ArrayLike<number>) => Array.from(v, (n) => Math.round(n * 1000) / 1000)

export function canSaveTrack(settings: SimSettings, track: SimTrack | null): boolean {
  if (settings.track === 'custom') return !!track
  if (settings.track === 'path') return !!settings.path
  return settings.track === 'log' && !!track?.origin
}

export function trackToSave(
  name: string,
  settings: SimSettings,
  track: SimTrack | null,
  logName = '',
): TrackFile | null {
  if (!canSaveTrack(settings, track)) return null
  const width = settings.lineWidth ?? DEFAULT_LINE_WIDTH
  const base = { dawgViewerTrack: 1 as const, name: name.trim(), width }
  if (settings.track === 'custom')
    return {
      ...base,
      kind: 'segments',
      source: 'typed or imported sections',
      closed: settings.customClosed,
      sections: settings.custom,
    }
  if (settings.track === 'path' && settings.path) {
    const p = settings.path
    return {
      ...base,
      kind: 'path',
      source: p.source,
      closed: p.closed,
      x: mm(p.x),
      y: mm(p.y),
      origin: p.origin,
      smooth: p.smooth,
    }
  }
  if (!track) return null
  return {
    ...base,
    kind: 'path',
    source: `${track.name}${logName ? ` of ${logName}` : ''}, the line as driven (GPS)`,
    closed: track.closed,
    x: mm(track.x),
    y: mm(track.y),
    origin: track.origin,
    smooth: Math.max(1.5, settings.smooth),
  }
}

export function parseTrackFile(text: string): TrackFile | null {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return null
  }
  if (!isObject(v) || v.dawgViewerTrack !== 1) return null
  if (typeof v.name !== 'string' || typeof v.closed !== 'boolean') return null
  const width =
    typeof v.width === 'number' && v.width > 0 && v.width <= 50 ? v.width : DEFAULT_LINE_WIDTH
  const source = typeof v.source === 'string' ? v.source : ''
  if (v.kind === 'segments' && typeof v.sections === 'string')
    return {
      dawgViewerTrack: 1,
      name: v.name,
      kind: 'segments',
      source,
      closed: v.closed,
      width,
      sections: v.sections,
    }
  const path = {
    name: v.name,
    source,
    closed: v.closed,
    x: v.x,
    y: v.y,
    origin: v.origin,
    smooth: v.smooth,
  }
  if (v.origin === undefined) delete path.origin
  if (v.smooth === undefined) delete path.smooth
  if (v.kind !== 'path' || !validPath(path)) return null
  return { dawgViewerTrack: 1, kind: 'path', width, ...path }
}

export function openTrackFile(file: TrackFile) {
  if (file.kind === 'segments') {
    updateSim({
      track: 'custom',
      custom: file.sections ?? '',
      customClosed: file.closed,
      lineWidth: file.width,
    })
    return
  }
  const path: PathTrack = {
    name: file.name,
    source: file.source,
    closed: file.closed,
    x: file.x ?? [],
    y: file.y ?? [],
    origin: file.origin,
    smooth: file.smooth,
  }
  updateSim({ track: 'path', path, lineWidth: file.width })
}
