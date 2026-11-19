import { useSyncExternalStore } from 'react'
import { isObject, persisted } from './storage'

export interface GGReference {
  kind: 'gg'
  id: string
  name: string
  created: number
  points: [number, number][]
  area: number
  radius: number
}

export interface AeroReference {
  kind: 'aero'
  id: string
  name: string
  created: number
  bins: [number, number][]
  mu: number | null
  clA: number | null
}

export type Reference = GGReference | AeroReference

const pairs = (v: unknown): v is [number, number][] =>
  Array.isArray(v) &&
  v.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number'))

const validRef = (r: unknown): r is Reference =>
  isObject(r) &&
  typeof r.id === 'string' &&
  typeof r.name === 'string' &&
  typeof r.created === 'number' &&
  ((r.kind === 'gg' &&
    pairs(r.points) &&
    typeof r.area === 'number' &&
    typeof r.radius === 'number') ||
    (r.kind === 'aero' && pairs(r.bins)))

export const validReferences = (v: unknown): v is Reference[] =>
  Array.isArray(v) && v.every(validRef)

export const references = persisted<Reference[]>('references.v1', [], validReferences)

export const useReferences = () => useSyncExternalStore(references.subscribe, references.get)

let next = Date.now() % 100000

export function addReference(
  ref: Omit<GGReference, 'id' | 'created'> | Omit<AeroReference, 'id' | 'created'>,
) {
  const made = { ...ref, id: `r-${(next++).toString(36)}`, created: Date.now() } as Reference
  references.set([
    ...references.get().filter((r) => r.name !== ref.name || r.kind !== ref.kind),
    made,
  ])
  return made
}

export function removeReference(id: string) {
  references.set(references.get().filter((r) => r.id !== id))
}

export function changePct(now: number, ref: number): string {
  const p = (now / ref - 1) * 100
  return `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1)}%`
}
