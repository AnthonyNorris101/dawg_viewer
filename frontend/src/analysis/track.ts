import type { Channel } from '../data/session'

const EARTH_R = 6371008.8
const RAD = Math.PI / 180

export interface Gps {
  lat: Float64Array
  lon: Float64Array
  latId: string
  lonId: string
}

export interface Beacon {
  lat: number
  lon: number
}

export type SpeedUnit = 'km/h' | 'mph' | 'm/s'

export type DistanceSource = { kind: 'gps' } | { kind: 'speed'; channelId: string; unit: SpeedUnit }

const LAT_NAMES = ['poslat', 'lat', 'latitude', 'gps_lat', 'gpslat', 'gps latitude']
const LON_NAMES = [
  'poslong',
  'poslon',
  'lon',
  'long',
  'longitude',
  'gps_lon',
  'gpslon',
  'gpslong',
  'gps longitude',
]
const SPEED_NAMES = [
  'vss',
  'speed',
  'vehicle speed',
  'gps_speed',
  'gpsspeed',
  'groundspeed',
  'vcar',
  'wheelspeed',
]

function byName(channels: Channel[], names: string[]): Channel | undefined {
  for (const n of names) {
    const ch = channels.find((c) => c.name.toLowerCase() === n)
    if (ch) return ch
  }
  return undefined
}

export const validFix = (lat: number, lon: number) =>
  Number.isFinite(lat) &&
  Number.isFinite(lon) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lon) <= 180 &&
  (Math.abs(lat) > 1e-4 || Math.abs(lon) > 1e-4)

export function findGps(channels: Channel[]): Gps | null {
  const lat = byName(channels, LAT_NAMES)
  const lon = byName(channels, LON_NAMES)
  if (!lat || !lon) return null
  let valid = 0
  const n = lat.data.length
  const step = Math.max(1, Math.floor(n / 2000))
  for (let i = 0; i < n; i += step) if (validFix(lat.data[i], lon.data[i])) valid++
  if (valid < 10) return null
  return { lat: lat.data, lon: lon.data, latId: lat.id, lonId: lon.id }
}

export function findSpeed(channels: Channel[]): Channel | undefined {
  return byName(channels, SPEED_NAMES)
}

export function guessSpeedUnit(unit: string): SpeedUnit {
  const u = unit.toLowerCase().replace(/\s/g, '')
  if (u.includes('m/s') || u === 'mps') return 'm/s'
  if (u.includes('km') || u.includes('kph')) return 'km/h'
  return 'mph'
}

export const TO_MPS: Record<SpeedUnit, number> = { 'km/h': 1 / 3.6, mph: 0.44704, 'm/s': 1 }

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD
  const dLon = (lon2 - lon1) * RAD
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)))
}

const GPS_SMOOTH_S = 0.25

export function smoothFixes(time: Float64Array, gps: Gps, halfWindowS: number) {
  const n = time.length
  const dt = n > 1 ? (time[n - 1] - time[0]) / (n - 1) : 0
  const w = dt > 0 ? Math.round(halfWindowS / dt) : 0
  const lat = new Float64Array(n).fill(NaN)
  const lon = new Float64Array(n).fill(NaN)
  const sLat = new Float64Array(n + 1)
  const sLon = new Float64Array(n + 1)
  const cnt = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    const ok = validFix(gps.lat[i], gps.lon[i])
    sLat[i + 1] = sLat[i] + (ok ? gps.lat[i] : 0)
    sLon[i + 1] = sLon[i] + (ok ? gps.lon[i] : 0)
    cnt[i + 1] = cnt[i] + (ok ? 1 : 0)
  }
  for (let i = 0; i < n; i++) {
    if (!validFix(gps.lat[i], gps.lon[i])) continue
    const a = Math.max(0, i - w)
    const b = Math.min(n, i + w + 1)
    const c = cnt[b] - cnt[a]
    lat[i] = (sLat[b] - sLat[a]) / c
    lon[i] = (sLon[b] - sLon[a]) / c
  }
  return { lat, lon }
}

export function cumulativeDistance(
  time: Float64Array,
  channels: Channel[],
  source: DistanceSource,
  gps: Gps | null,
): Float64Array | null {
  const n = time.length
  const out = new Float64Array(n)
  if (source.kind === 'gps') {
    if (!gps) return null
    const { lat, lon } = smoothFixes(time, gps, GPS_SMOOTH_S)
    let pl = NaN
    let po = NaN
    let pt = 0
    for (let i = 0; i < n; i++) {
      out[i] = i > 0 ? out[i - 1] : 0
      if (!validFix(lat[i], lon[i])) continue
      if (Number.isFinite(pl)) {
        if (lat[i] === pl && lon[i] === po) continue
        const d = haversine(pl, po, lat[i], lon[i])
        if (d < 120 * Math.max(time[i] - pt, 0.2)) out[i] += d
      }
      pl = lat[i]
      po = lon[i]
      pt = time[i]
    }
    return out
  }
  const ch = channels.find((c) => c.id === source.channelId)
  if (!ch) return null
  const k = TO_MPS[source.unit]
  for (let i = 1; i < n; i++) {
    const v = ((ch.data[i] + ch.data[i - 1]) / 2) * k
    const d = v * (time[i] - time[i - 1])
    out[i] = out[i - 1] + (Number.isFinite(d) && d > 0 ? d : 0)
  }
  return out
}

export function beaconCrossings(
  time: Float64Array,
  gps: Gps,
  beacon: Beacon,
  radius: number,
  minLap: number,
): number[] {
  const { lat, lon } = gps
  const kx = Math.cos(beacon.lat * RAD) * RAD * EARTH_R
  const ky = RAD * EARTH_R
  const r2 = radius * radius
  const out: number[] = []
  let best = -1
  let bestD = Infinity
  const close = () => {
    if (best >= 0 && (out.length === 0 || time[best] - time[out[out.length - 1]] >= minLap)) {
      out.push(best)
    }
    best = -1
    bestD = Infinity
  }
  for (let i = 0; i < time.length; i++) {
    if (!validFix(lat[i], lon[i])) continue
    const dx = (lon[i] - beacon.lon) * kx
    const dy = (lat[i] - beacon.lat) * ky
    const d2 = dx * dx + dy * dy
    if (d2 <= r2) {
      if (d2 < bestD) {
        bestD = d2
        best = i
      }
    } else if (best >= 0) close()
  }
  close()
  return out
}

export interface Lap {
  key: string
  label: string
  kind: 'out' | 'lap' | 'in'
  number: number
  start: number
  end: number
  t0: number
  t1: number
  time: number
  distance: number
}

export function lowerBound(a: ArrayLike<number>, v: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (a[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function buildLaps(
  time: Float64Array,
  distance: Float64Array | null,
  boundaries: number[],
): Lap[] {
  const n = time.length
  const marks = [...new Set(boundaries.filter((b) => b > 0 && b < n - 1))].sort((a, b) => a - b)
  if (marks.length === 0 || n < 2) return []
  const cuts = [0, ...marks, n - 1]
  const laps: Lap[] = []
  let number = 0
  for (let i = 0; i + 1 < cuts.length; i++) {
    const start = cuts[i]
    const end = cuts[i + 1]
    const kind = i === 0 ? 'out' : i === cuts.length - 2 ? 'in' : 'lap'
    const t = time[end] - time[start]
    if (kind !== 'lap' && t < 1) continue
    if (kind === 'lap') number++
    laps.push({
      key: kind === 'lap' ? String(number) : kind,
      label: kind === 'out' ? 'Out' : kind === 'in' ? 'In' : String(number),
      kind,
      number: kind === 'lap' ? number : 0,
      start,
      end,
      t0: time[start],
      t1: time[end],
      time: t,
      distance: distance ? distance[end] - distance[start] : NaN,
    })
  }
  return laps
}

export function buildRuns(
  time: Float64Array,
  distance: Float64Array | null,
  pairs: [number, number][],
): Lap[] {
  const n = time.length
  const sorted = pairs.filter(([a, b]) => a >= 0 && b > a && b < n).sort((x, y) => x[0] - y[0])
  const runs: Lap[] = []
  let lastEnd = -1
  for (const [start, end] of sorted) {
    if (start < lastEnd) continue
    lastEnd = end
    const number = runs.length + 1
    runs.push({
      key: String(number),
      label: String(number),
      kind: 'lap',
      number,
      start,
      end,
      t0: time[start],
      t1: time[end],
      time: time[end] - time[start],
      distance: distance ? distance[end] - distance[start] : NaN,
    })
  }
  return runs
}

export function pairGates(starts: number[], finishes: number[]): [number, number][] {
  const out: [number, number][] = []
  const fin = [...finishes].sort((a, b) => a - b)
  let j = 0
  for (const s of [...starts].sort((a, b) => a - b)) {
    if (out.length && s < out[out.length - 1][1]) continue
    while (j < fin.length && fin[j] <= s) j++
    if (j >= fin.length) break
    out.push([s, fin[j]])
  }
  return out
}

export function runEnd(
  time: ArrayLike<number>,
  distance: ArrayLike<number> | null,
  start: number,
  end: number,
  length: number,
): number {
  if (!distance || !(length > 0)) return end
  const d0 = distance[start]
  for (let i = start; i < time.length; i++) if (distance[i] - d0 >= length) return i
  return end
}

export function bestLap(laps: Lap[]): Lap | undefined {
  let best: Lap | undefined
  for (const l of laps) if (l.kind === 'lap' && (!best || l.time < best.time)) best = l
  return best
}

export function formatLapTime(s: number): string {
  if (!Number.isFinite(s)) return '–'
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return m > 0 ? `${m}:${rest.toFixed(3).padStart(6, '0')}` : rest.toFixed(3)
}

export function lapColumns(time: Float64Array, distance: Float64Array | null, laps: Lap[]) {
  const n = time.length
  const lapNo = new Float64Array(n)
  const lapTime = new Float64Array(n)
  const lapDist = distance ? new Float64Array(n) : null
  for (const l of laps) {
    for (let i = l.start; i <= l.end && i < n; i++) {
      lapNo[i] = l.number
      lapTime[i] = time[i] - l.t0
      if (lapDist && distance) lapDist[i] = distance[i] - distance[l.start]
    }
  }
  return { lapNo, lapTime, lapDist }
}
