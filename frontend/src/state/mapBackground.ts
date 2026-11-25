import { useSyncExternalStore } from 'react'
import type { Source } from '../../bindings/dawg_viewer/internal/maptiles/models'
import { info, useInfo } from '../live/connection'
import { persisted } from './storage'

export const mapBackground = persisted<string>(
  'mapBackground.v1',
  '',
  (v): v is string => typeof v === 'string',
)

const pick = (sources: Source[] | null | undefined, id: string) =>
  (id && sources?.find((s) => s.id === id)) || null

export const currentMapSource = () => pick(info.get()?.mapSources, mapBackground.get())

export function useMapSource() {
  const id = useSyncExternalStore(mapBackground.subscribe, mapBackground.get)
  return pick(useInfo()?.mapSources, id)
}

export function useMapBackgroundId() {
  return useSyncExternalStore(mapBackground.subscribe, mapBackground.get)
}
