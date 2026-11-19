const PREFIX = 'dawg.'

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
  return {
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
