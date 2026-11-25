import { useSyncExternalStore } from 'react'
import { LiveService } from '../../bindings/dawg_viewer/services'
import type { Preset } from '../../bindings/dawg_viewer/services/models'
import {
  applySetup,
  askOnStart,
  checkSetup,
  currentSetup,
  freshSetup,
  lastLog,
  originalSetup,
  savedWorkbook,
  SETUP_KEYS,
  setStockSetup,
  type Setup,
} from './setup'
import { track, updateTrack } from './analysis'
import { dampers } from './dampers'
import { isObject, onStored, restoreEntries, storedEntries } from './storage'

export type SetupStart = 'original' | 'current'

export interface SaveState {
  phase: 'idle' | 'pending' | 'saving' | 'saved' | 'error'
  error: string
}

export const SAVE_DELAY_MS = 600
export const SAVE_RETRY_MS = 5000

function value<T>(initial: T) {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set(next: T) {
      current = next
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

export const activeSetup = value('')
export const saveState = value<SaveState>({ phase: 'idle', error: '' })
export const useActiveSetup = () => useSyncExternalStore(activeSetup.subscribe, activeSetup.get)
export const useSaveState = () => useSyncExternalStore(saveState.subscribe, saveState.get)

const SESSION_KEYS = [...SETUP_KEYS, lastLog.key, askOnStart.key]

let ready = false
let unwatch: (() => void) | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let chain: Promise<void> = Promise.resolve()
let activeLog: string | undefined
let unnamed: Setup | null = null
let sample = ''
let firstBoot = ''
let sampleShown = false
let dampersOffered = false

export const sampleLog = () => sample
export const firstBootLog = () => firstBoot
const written = { name: '', setup: '', session: '' }

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

function touch() {
  if (!ready) return
  if (timer) clearTimeout(timer)
  saveState.set({ phase: 'pending', error: '' })
  timer = setTimeout(() => void flush(), SAVE_DELAY_MS)
}

async function write() {
  const name = activeSetup.get()
  const setup = currentSetup(name ? activeLog : undefined)
  const setupText = JSON.stringify(setup, null, 2)
  const sessionText = JSON.stringify(
    {
      dawgViewerSession: 1,
      setup: name,
      lastLog: lastLog.get(),
      askOnStart: askOnStart.get(),
      ...(name ? (unnamed ? { unnamed } : {}) : { unnamed: setup }),
      ...(sampleShown ? { sampleShown: true } : {}),
      ...(dampersOffered ? { dampersOffered: true } : {}),
      other: storedEntries(SESSION_KEYS),
    },
    null,
    2,
  )
  try {
    if (name && (written.name !== name || written.setup !== setupText)) {
      saveState.set({ phase: 'saving', error: '' })
      await LiveService.SavePreset(name, setupText)
      written.name = name
      written.setup = setupText
    }
    if (written.session !== sessionText) {
      saveState.set({ phase: 'saving', error: '' })
      await LiveService.SaveSession(sessionText)
      written.session = sessionText
    }
    if (!timer) saveState.set({ phase: 'saved', error: '' })
  } catch (e) {
    saveState.set({ phase: 'error', error: message(e) })
    if (!timer) timer = setTimeout(() => void flush(), SAVE_RETRY_MS)
  }
}

export function flush(): Promise<void> {
  if (!ready) return Promise.resolve()
  if (timer) clearTimeout(timer)
  timer = undefined
  chain = chain.then(write)
  return chain
}

async function settle() {
  await flush()
  while (timer && saveState.get().phase !== 'error') await flush()
}

function keepUnnamed() {
  if (!activeSetup.get()) unnamed = currentSetup()
}

function attach(name: string, text: string, log: string | undefined) {
  activeLog = log
  written.name = name
  written.setup = text
  activeSetup.set(name)
}

function detach() {
  activeLog = undefined
  written.name = ''
  written.setup = ''
  activeSetup.set('')
}

function backToUnnamed() {
  if (!activeSetup.get()) return
  const kept = unnamed
  detach()
  unnamed = null
  if (kept) applySetup(kept)
}

const asSetup = (v: unknown): Setup | null => {
  try {
    checkSetup(v)
    return v as unknown as Setup
  } catch {
    return null
  }
}

export async function startSession() {
  if (ready) return
  try {
    const stock = await LiveService.Stock()
    setStockSetup(stock.setup ? JSON.parse(stock.setup) : null)
    sample = stock.sampleLog ?? ''
  } catch {
    setStockSetup(null)
    sample = ''
  }
  let hadSession = false
  try {
    const text = await LiveService.LoadSession()
    hadSession = text !== ''
    const found: unknown = text ? JSON.parse(text) : null
    if (isObject(found) && found.dawgViewerSession === 1) {
      written.session = text
      sampleShown = found.sampleShown === true
      dampersOffered = found.dampersOffered === true
      restoreEntries(found.other, SESSION_KEYS)
      if (typeof found.lastLog === 'string') lastLog.set(found.lastLog)
      if (typeof found.askOnStart === 'boolean') askOnStart.set(found.askOnStart)
      const name = typeof found.setup === 'string' ? found.setup : ''
      const kept = asSetup(found.unnamed)
      let opened = false
      if (name) {
        try {
          const saved = await LiveService.LoadPreset(name)
          const setup = applySetup(JSON.parse(saved))
          attach(name, saved, setup.log)
          unnamed = kept
          opened = true
        } catch {
          opened = false
        }
      }
      if (!opened && kept) applySetup(kept)
    }
  } catch {
    detach()
  }
  if (!hadSession && !savedWorkbook() && !lastLog.get()) applySetup(originalSetup())
  const table = originalSetup().dampers
  if (!dampersOffered && table) {
    if (!dampers.get()) dampers.set(table)
    dampersOffered = true
  }
  if (!sampleShown && sample && !lastLog.get()) {
    const line = originalSetup().track?.beacon
    if (line && !track.get().beacon) updateTrack({ beacon: line })
    firstBoot = sample
    sampleShown = true
  }
  ready = true
  const stored = onStored(touch)
  const leaving = () => {
    if (timer) void flush()
  }
  globalThis.addEventListener?.('pagehide', leaving)
  unwatch = () => {
    stored()
    globalThis.removeEventListener?.('pagehide', leaving)
  }
  void flush()
}

export function stopSession() {
  if (timer) clearTimeout(timer)
  timer = undefined
  unwatch?.()
  unwatch = undefined
  ready = false
  chain = Promise.resolve()
  written.session = ''
  detach()
  unnamed = null
  sample = ''
  firstBoot = ''
  sampleShown = false
  dampersOffered = false
  setStockSetup(null)
  saveState.set({ phase: 'idle', error: '' })
}

export async function openUnnamed() {
  await settle()
  backToUnnamed()
  await flush()
}

export async function openSetup(name: string): Promise<Setup> {
  await settle()
  const text = await LiveService.LoadPreset(name)
  const parsed: unknown = JSON.parse(text)
  await settle()
  checkSetup(parsed)
  keepUnnamed()
  const setup = applySetup(parsed)
  attach(name, text, setup.log)
  await flush()
  return setup
}

export async function createSetup(name: string, from: SetupStart, log?: string): Promise<Preset> {
  await settle()
  const setup = from === 'original' ? originalSetup(log) : currentSetup(log)
  const text = JSON.stringify(setup, null, 2)
  const saved = await LiveService.SavePreset(name, text)
  await settle()
  keepUnnamed()
  if (from === 'original') applySetup(setup)
  attach(saved.name, text, log)
  await flush()
  return saved
}

export async function removeSetup(name: string) {
  await settle()
  await LiveService.DeletePreset(name)
  if (activeSetup.get() !== name) return
  backToUnnamed()
  await flush()
}

export async function startFresh() {
  await settle()
  backToUnnamed()
  freshSetup()
  await flush()
}

export async function importSetup(raw: unknown): Promise<Setup> {
  await settle()
  checkSetup(raw)
  backToUnnamed()
  const setup = applySetup(raw)
  await flush()
  return setup
}
