const PREFIX = 'dawg.'

const watchers = new Set<() => void>()
const reloaders = new Set<() => void>()

export function onStored(fn: () => void) {
  watchers.add(fn)
  return () => {
    watchers.delete(fn)
  }
}

export function noteStored() {
  for (const fn of watchers) fn()
}

export function storedEntries(skip: Iterable<string> = []): Record<string, string> {
  const out: Record<string, string> = {}
  const skipped = new Set([...skip].map((k) => PREFIX + k))
  try {
    const ls = globalThis.localStorage
    for (let i = 0; i < (ls?.length ?? 0); i++) {
      const key = ls.key(i)
      if (!key || !key.startsWith(PREFIX) || skipped.has(key)) continue
      const value = ls.getItem(key)
      if (value != null) out[key] = value
    }
  } catch {
    return {}
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

export function restoreEntries(entries: unknown, skip: Iterable<string> = []) {
  if (!isObject(entries)) return
  const skipped = new Set([...skip].map((k) => PREFIX + k))
  try {
    for (const [key, value] of Object.entries(entries)) {
      if (!key.startsWith(PREFIX) || skipped.has(key) || typeof value !== 'string') continue
      globalThis.localStorage?.setItem(key, value)
    }
  } catch {
    return
  }
  for (const fn of reloaders) fn()
}

export function load<T>(key: string, fallback: T, valid: (v: unknown) => v is T): T {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key)
    if (raw == null) return fallback
    const v: unknown = JSON.parse(raw)
    return valid(v) ? v : fallback
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown): boolean {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value))
    noteStored()
    return true
  } catch {
    return false
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function persisted<T>(key: string, initial: T, valid: (v: unknown) => v is T) {
  let value = load(key, initial, valid)
  const listeners = new Set<() => void>()
  reloaders.add(() => {
    const next = load(key, initial, valid)
    if (JSON.stringify(next) === JSON.stringify(value)) return
    value = next
    for (const fn of listeners) fn()
  })
  return {
    key,
    get: () => value,
    set(next: T) {
      value = next
      save(key, next)
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

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function pickTextFile(accept: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      file.text().then(resolve, () => resolve(null))
    }
    input.click()
  })
}

export function pickFile(accept: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      file.arrayBuffer().then(
        (b) => resolve({ name: file.name, bytes: new Uint8Array(b) }),
        () => resolve(null),
      )
    }
    input.click()
  })
}
