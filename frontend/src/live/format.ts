import type { ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'

export const NO_VALUE = '--'

export function formatValue(v: number | undefined, meta: ChannelMeta | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return NO_VALUE
  return v.toFixed(meta?.precision ?? 2)
}

export type Level = 'ok' | 'warn' | 'crit'

export function level(v: number | undefined, m: ChannelMeta | undefined): Level {
  if (v === undefined || !m) return 'ok'
  if ((m.critMin != null && v < m.critMin) || (m.critMax != null && v > m.critMax)) return 'crit'
  if ((m.warnMin != null && v < m.warnMin) || (m.warnMax != null && v > m.warnMax)) return 'warn'
  return 'ok'
}

/**
 * Border colour for a value of the given age in seconds: green when fresh,
 * easing to red at 10 s, then dimming. Same curve as the old InfoBox widget.
 */
export function ageColor(age: number | undefined): string {
  if (age === undefined) return '#3f3f46'
  const a = Math.max(0, age)
  let t = Math.min(a / 10, 1)
  t = t * t * (3 - 2 * t)
  const hue = 120 * (1 - t)
  const light = a > 10 ? Math.max(25, 50 - (a - 10) * 2.5) : 50
  return `hsl(${hue} 90% ${light}%)`
}

export function formatAge(ms: number): string {
  if (ms < 0) return 'never'
  if (ms < 1000) return `${ms} ms ago`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s ago`
  return `${Math.floor(ms / 60_000)} min ago`
}
