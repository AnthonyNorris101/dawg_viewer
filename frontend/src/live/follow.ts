import { useSyncExternalStore } from 'react'
import { createViewSync, type Range } from '../plot/sync'
import { observable, store } from './connection'

export const liveSync = createViewSync('live')

interface FollowState {
  follow: boolean
  windowS: number
}

const state = observable<FollowState>({ follow: true, windowS: 30 })
let expected: Range | null = null

function apply() {
  const { follow, windowS } = state.get()
  const b = store.bounds()
  if (!follow || !b) return
  expected = Number.isFinite(windowS)
    ? { min: b[1] - windowS, max: b[1] }
    : { min: b[0], max: Math.max(b[1], b[0] + 1) }
  liveSync.setRange(expected)
}

store.subscribe(apply)

liveSync.onRange((r) => {
  const s = state.get()
  if (s.follow && expected && (r.min !== expected.min || r.max !== expected.max)) {
    state.set({ ...s, follow: false })
  }
})

export function showWindow(windowS: number) {
  state.set({ follow: true, windowS })
  apply()
}

export function resumeFollow() {
  state.set({ ...state.get(), follow: true })
  apply()
}

export const useFollow = () => useSyncExternalStore(state.subscribe, state.get)
