import { useSyncExternalStore } from 'react'
import { Events } from '@wailsio/runtime'
import type { Channel, Status } from '../../bindings/dawg_viewer/internal/live/models'
import type { Info } from '../../bindings/dawg_viewer/services/models'
import { LiveService } from '../../bindings/dawg_viewer/services'
import { CHANNEL_COLORS } from '../data/session'
import { LiveStore } from './store'

// Assumed upper bound on the device's packet rate, used to size history.
const MAX_RATE_HZ = 60

/** Live rows from the backend, shared by every live component. */
export const store = new LiveStore(30 * 60 * MAX_RATE_HZ)

/** A tiny observable value for useSyncExternalStore. */
export function observable<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: T) {
      value = next
      for (const fn of listeners) fn()
    },
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

const EMPTY_STATUS: Status = {
  profile: '',
  profileName: '',
  state: 'stopped',
  listen: '',
  deviceIp: '',
  deviceSource: '',
  firmware: '',
  packets: 0,
  packetRate: 0,
  lastPacketMs: -1,
  badPackets: 0,
  unknownIds: [],
  error: '',
  startedAt: 0,
}

export const status = observable<Status>(EMPTY_STATUS)
export const channels = observable<Channel[]>([])
export const info = observable<Info | null>(null)

const colors = new Map<string, string>()

/** A stable colour per channel name, in order of first appearance. */
export function colorFor(name: string): string {
  let c = colors.get(name)
  if (!c) {
    c = CHANNEL_COLORS[colors.size % CHANNEL_COLORS.length]
    colors.set(name, c)
  }
  return c
}

function applyStatus(next: Status) {
  // A new session numbers its rows from its own start time.
  if (next.startedAt !== status.get().startedAt && next.startedAt !== 0) store.reset()
  status.set(next)
}

let started = false

/** Subscribes to backend events and loads the current state. Safe to call twice. */
export function startLive() {
  if (started) return
  started = true
  Events.On('live:frame', (e) => store.append(e.data.rows ?? []))
  Events.On('live:status', (e) => applyStatus(e.data))
  Events.On('live:channels', (e) => channels.set(e.data ?? []))
  void refresh()
}

/** Re-reads config info, status and channels from the backend. */
export async function refresh() {
  const [i, s, c] = await Promise.all([
    LiveService.Info(),
    LiveService.Status(),
    LiveService.Channels(),
  ])
  info.set(i)
  store.setMaxRows(i.settings.historyMinutes * 60 * MAX_RATE_HZ)
  applyStatus(s)
  channels.set(c ?? [])
}

export const useStatus = () => useSyncExternalStore(status.subscribe, status.get)
export const useChannels = () => useSyncExternalStore(channels.subscribe, channels.get)
export const useInfo = () => useSyncExternalStore(info.subscribe, info.get)
