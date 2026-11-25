import { useSyncExternalStore } from 'react'
import type { DamperSetting } from '../analysis/sim/damper'
import { isObject, persisted } from './storage'

export interface DamperData {
  file: string
  settings: DamperSetting[]
}

const validSetting = (v: unknown): v is DamperSetting =>
  isObject(v) &&
  typeof v.shock === 'string' &&
  typeof v.setting === 'string' &&
  typeof v.gas === 'number' &&
  Array.isArray(v.points) &&
  v.points.length > 0 &&
  v.points.every(
    (p) =>
      isObject(p) &&
      typeof p.v === 'number' &&
      p.v > 0 &&
      typeof p.comp === 'number' &&
      typeof p.reb === 'number',
  )

export const validDampers = (v: unknown): v is DamperData | null =>
  v === null ||
  (isObject(v) &&
    typeof v.file === 'string' &&
    Array.isArray(v.settings) &&
    v.settings.every(validSetting))

export const dampers = persisted<DamperData | null>('dampers.v1', null, validDampers)
export const useDampers = () => useSyncExternalStore(dampers.subscribe, dampers.get)
