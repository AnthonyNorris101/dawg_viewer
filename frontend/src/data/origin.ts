import { LAT_G, LONG_G, VERT_G } from '../analysis/accel'

export type Origin = 'measured' | 'filtered' | 'calculated' | 'theory'

const FILTERED = new Set([LAT_G, LONG_G, VERT_G])
const FILTER_CALL = /\b(lowpass|highpass|bandpass|notch|smooth|median)\s*\(/i

export const ORIGINS: Record<Origin, { tag: string; title: string; className: string }> = {
  measured: {
    tag: 'measured',
    title: 'Straight from a sensor on the car, as logged',
    className: 'bg-zinc-700/60 text-zinc-300',
  },
  filtered: {
    tag: 'filtered',
    title:
      'Sensor data from the car with noise filtered out, so it is smoothed and not the raw reading',
    className: 'bg-amber-500/20 text-amber-200',
  },
  calculated: {
    tag: 'calculated',
    title: 'Worked out from measured data (GPS, laps, math channels); not a direct sensor reading',
    className: 'bg-sky-500/20 text-sky-200',
  },
  theory: {
    tag: 'theoretical',
    title: 'Simulated from the car on the Car tab. Nothing here was measured',
    className: 'bg-fuchsia-500/25 text-fuchsia-200',
  },
}

export function originOf(c: { id: string; group: string; origin?: Origin }, expr?: string): Origin {
  if (c.origin) return c.origin
  if (c.group === 'Sim') return 'theory'
  if (FILTERED.has(c.id) || (expr !== undefined && FILTER_CALL.test(expr))) return 'filtered'
  if (c.group === 'Math' || c.group === 'Analysis' || c.id === 'GPS Speed') return 'calculated'
  return 'measured'
}

const SUFFIX = / · (filtered|calculated|theoretical)$/

export const withOrigin = (title: string, origin: Origin) =>
  origin === 'measured' || SUFFIX.test(title) ? title : `${title} · ${ORIGINS[origin].tag}`

export function splitOrigin(title: string, fallback: Origin): { title: string; origin: Origin } {
  const m = SUFFIX.exec(title)
  if (!m) return { title, origin: fallback }
  const origin = (Object.keys(ORIGINS) as Origin[]).find((o) => ORIGINS[o].tag === m[1])
  return { title: title.slice(0, m.index), origin: origin ?? fallback }
}
