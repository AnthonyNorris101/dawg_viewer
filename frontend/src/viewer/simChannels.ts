import { withOrigin } from '../data/origin'
import { accelInG } from '../analysis/accel'
import { speedFromDistance } from '../analysis/launch'
import { buildLimits, type Limits } from '../analysis/sim/grip'
import { simulateLap, type LapResult } from '../analysis/sim/lapsim'
import {
  trackFromLog,
  type CurvatureSource,
  type LogTrackInput,
  type SimTrack,
} from '../analysis/sim/simtrack'
import {
  findSpeed,
  guessSpeedUnit,
  haversine,
  TO_MPS,
  validFix,
  type Gps,
  type Lap,
} from '../analysis/track'
import type { CarSpecs } from '../data/car'
import { mapColumn } from '../data/columns'
import { CHANNEL_COLORS, type Channel, type Session } from '../data/session'

export const SIM_GROUP = 'Sim'
const MAX_LAPS = 60
const CLOSED_WITHIN_M = 25
const STANDING_MPS = 1.5

export interface TrackOptions {
  source: CurvatureSource
  smooth: number
}

export interface LogInputs extends LogTrackInput {
  speed: Float64Array
  speedUnit: string
  toUnit: number
  longG: Float64Array | null
  rpm: Float64Array | null
  throttle: Float64Array | null
}

const byName = (session: Session, ...names: string[]) =>
  names
    .map((n) => session.channels.find((c) => c.name.toLowerCase().replace(/[\s_]/g, '') === n))
    .find(Boolean)

const inG = (c: Channel | undefined): Float64Array | null => (c ? accelInG(c) : null)

export function logInputs(
  session: Session,
  distance: Float64Array | null,
  gps: Gps | null,
): LogInputs | null {
  if (!distance) return null
  const ch = findSpeed(session.channels)
  const unit = ch ? guessSpeedUnit(ch.unit) : 'km/h'
  const speed = ch
    ? mapColumn(ch.data, (v) => v * TO_MPS[unit])
    : speedFromDistance(session.time, distance)
  return {
    time: session.time,
    distance,
    speed,
    speedUnit: unit,
    toUnit: 1 / TO_MPS[unit],
    latG: inG(byName(session, 'accely', 'accy', 'latacc', 'lateralg', 'glat')),
    longG: inG(byName(session, 'accelx', 'accx', 'longacc', 'longitudinalg', 'glong')),
    rpm: byName(session, 'rpm', 'enginespeed', 'enginerpm')?.data ?? null,
    throttle: byName(session, 'tps1', 'tps', 'throttle', 'throttleposition')?.data ?? null,
    gps,
  }
}

export function forwardG(inp: LogInputs): Float64Array | null {
  const a = inp.longG
  if (!a) return null
  let sum = 0
  for (let i = 1; i < a.length; i++)
    if (Number.isFinite(a[i])) sum += a[i] * (inp.speed[i] - inp.speed[i - 1])
  return sum < 0 ? mapColumn(a, (v) => -v) : a
}

export function lapTrack(
  inp: LogInputs,
  lap: Lap,
  o: TrackOptions,
  loop: boolean,
): SimTrack | null {
  let closed = loop && lap.kind === 'lap'
  if (closed && inp.gps) {
    const { lat, lon } = inp.gps
    if (validFix(lat[lap.start], lon[lap.start]) && validFix(lat[lap.end], lon[lap.end]))
      closed =
        haversine(lat[lap.start], lon[lap.start], lat[lap.end], lon[lap.end]) < CLOSED_WITHIN_M
  }
  return trackFromLog(inp, lap.start, lap.end, {
    name: `Lap ${lap.label}`,
    source: o.source,
    smooth: o.smooth,
    closed,
    standing: !closed && inp.speed[lap.start] < STANDING_MPS,
  })
}

export function simulateLogLap(
  inp: LogInputs,
  lap: Lap,
  car: CarSpecs,
  limits: Limits,
  o: TrackOptions,
  loop: boolean,
): { track: SimTrack; result: LapResult } | null {
  const track = lapTrack(inp, lap, o, loop)
  if (!track) return null
  const entrySpeed = track.closed || track.standing ? undefined : inp.speed[lap.start]
  return { track, result: simulateLap(car, track, limits, { entrySpeed }) }
}

export function simChannels(
  session: Session,
  distance: Float64Array | null,
  gps: Gps | null,
  laps: Lap[],
  car: CarSpecs,
  o: TrackOptions,
  loop: boolean,
): Channel[] {
  const inp = logInputs(session, distance, gps)
  const timed = laps.filter((l) => l.kind === 'lap').slice(0, MAX_LAPS)
  if (!inp || timed.length === 0) return []
  const n = session.time.length
  const make = () => new Float64Array(n).fill(NaN)
  const speed = make()
  const longG = make()
  const latG = make()
  const gear = make()
  const rpm = make()
  const gap = make()
  const limits = buildLimits(car)
  let any = false
  for (const lap of timed) {
    const sim = simulateLogLap(inp, lap, car, limits, o, loop)
    if (!sim) continue
    any = true
    const r = sim.result
    const last = r.s.length - 1
    let j = 0
    for (let i = lap.start; i <= lap.end; i++) {
      const d = inp.distance[i] - inp.distance[lap.start]
      while (j < last - 1 && r.s[j + 1] < d) j++
      const span = r.s[j + 1] - r.s[j]
      const f = span > 0 ? Math.min(1, Math.max(0, (d - r.s[j]) / span)) : 0
      const at = (a: ArrayLike<number>) => a[j] + (a[j + 1] - a[j]) * f
      speed[i] = at(r.v) * inp.toUnit
      longG[i] = at(r.ax)
      latG[i] = at(r.ay)
      gear[i] = r.gear[f < 0.5 ? j : j + 1]
      rpm[i] = at(r.rpm)
      gap[i] = session.time[i] - session.time[lap.start] - at(r.t)
    }
  }
  if (!any) return []
  let color = session.channels.length + 8
  const channel = (id: string, unit: string, precision: number, data: Float64Array): Channel => ({
    id,
    name: id,
    label: withOrigin(id, 'theory'),
    group: SIM_GROUP,
    unit,
    precision,
    data,
    color: CHANNEL_COLORS[color++ % CHANNEL_COLORS.length],
  })
  return [
    channel('Sim Speed', inp.speedUnit, 1, speed),
    channel('Sim Long G', 'g', 2, longG),
    channel('Sim Lat G', 'g', 2, latG),
    channel('Sim Gear', '', 0, gear),
    channel('Sim RPM', 'rpm', 0, rpm),
    channel('Sim Time Gap', 's', 2, gap),
  ].filter((c) => !session.byId.has(c.id))
}
