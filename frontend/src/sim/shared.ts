import type { Limits } from '../analysis/sim/grip'
import type { Lap } from '../analysis/track'
import type { CarSpecs } from '../data/car'
import type { LogInputs } from '../viewer/simChannels'

export const BASE_COLOR = '#f87171'
export const WHATIF_COLOR = '#fbbf24'
export const REAL_COLOR = '#e4e4e7'
export const LIMIT_COLORS = ['#f87171', '#60a5fa', '#fbbf24', '#34d399', '#71717a']
export const KMH = 3.6
export const MPH = 2.23694

export interface SimCars {
  car: CarSpecs
  limits: Limits
  variant: CarSpecs | null
  variantLimits: Limits | null
}

export interface SimLog {
  name: string
  inputs: LogInputs | null
  laps: Lap[]
  loop: boolean
}

export const card = 'space-y-3 rounded-lg border border-zinc-800 p-4 text-sm'
export const heading = 'text-[11px] tracking-wider text-zinc-500 uppercase'
export const field =
  'rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 tabular-nums outline-none focus:border-red-500'

export const num = (v: number, digits: number) => (Number.isFinite(v) ? v.toFixed(digits) : '–')
