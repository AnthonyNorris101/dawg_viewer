export const DEFAULT_PANELS = [
  ['RPM', 'TPS1'],
  ['CLT1', 'OilTemp', 'RadTemp'],
  ['AccelX', 'AccelY'],
]
export interface GraphProfile {
  name: string
  panels: string[][]
  heights?: Array<number | null>
  windowS?: number
}
export const MIN_PANEL_HEIGHT = 192
export const MAX_PANEL_HEIGHT = 2000
const KEY = 'dawg.graph-profiles.v1'
const CACHE = 'dawg.channel-names.v1'

export function validPanels(value: unknown): value is string[][] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 5 &&
    value.every((p) => Array.isArray(p) && p.every((n) => typeof n === 'string' && n.length > 0)) &&
    value.reduce((n, p) => n + p.length, 0) <= 15
  )
}

export function validHeights(value: unknown, panelCount: number): value is Array<number | null> {
  return (
    Array.isArray(value) &&
    value.length === panelCount &&
    value.every(
      (height) =>
        height === null ||
        (Number.isFinite(height) && height >= MIN_PANEL_HEIGHT && height <= MAX_PANEL_HEIGHT),
    )
  )
}

export function loadProfiles(): GraphProfile[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(data)
      ? data.filter(
          (p): p is GraphProfile =>
            p &&
            typeof p.name === 'string' &&
            p.name.trim() &&
            validPanels(p.panels) &&
            (p.heights === undefined || validHeights(p.heights, p.panels.length)) &&
            (p.windowS === undefined || (Number.isFinite(p.windowS) && p.windowS > 0)),
        )
      : []
  } catch {
    return []
  }
}

export function saveProfiles(profiles: GraphProfile[]) {
  localStorage.setItem(KEY, JSON.stringify(profiles))
}

export function cacheNames(names: string[]): string[] {
  let cached: string[] = []
  try {
    const data: unknown = JSON.parse(localStorage.getItem(CACHE) ?? '[]')
    if (Array.isArray(data)) cached = data.filter((n): n is string => typeof n === 'string')
  } catch {
    /* Start a fresh cache when storage is unavailable or malformed. */
  }
  const result = [...new Set([...cached, ...names].filter((n) => n && !n.startsWith('~')))]
  try {
    localStorage.setItem(CACHE, JSON.stringify(result))
  } catch {
    /* Matching still works this session. */
  }
  return result
}
