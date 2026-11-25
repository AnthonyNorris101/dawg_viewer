import { describe, expect, it } from 'vitest'
import { buildLimits } from '../analysis/sim/grip'
import { simulateLap } from '../analysis/sim/lapsim'
import { parseSegments, segmentsTrack, type SimTrack } from '../analysis/sim/simtrack'
import type { Lap } from '../analysis/track'
import { DEFAULT_CAR } from '../data/car'
import type { Channel, Session } from '../data/session'
import { forwardG, lapTrack, logInputs, simChannels } from './simChannels'

const car = DEFAULT_CAR
const MPH = 2.23694

function outing(pace: number) {
  const half = 'straight 60\nL 48 5\nL 24 5\nL 16 5\nL 12 22.699\nL 16 5\nL 24 5\nL 48 5\n'
  const track = segmentsTrack(parseSegments(half + half).segments, { closed: true }) as SimTrack
  const ideal = simulateLap(car, track, buildLimits(car))
  const dt = 0.01
  const time: number[] = []
  const speed: number[] = []
  const lat: number[] = []
  const long: number[] = []
  const dist: number[] = []
  const starts = [0]
  let s = 0
  let lapS = 0
  let j = 0
  let before = ideal.v[0] * pace
  for (let i = 0; starts.length <= 2; i++) {
    while (j < ideal.s.length - 2 && ideal.s[j + 1] <= lapS) j++
    const f = Math.min(1, (lapS - ideal.s[j]) / (ideal.s[j + 1] - ideal.s[j]))
    const v = (ideal.v[j] + (ideal.v[j + 1] - ideal.v[j]) * f) * pace
    time.push(i * dt)
    speed.push(v * MPH)
    lat.push((v * v * track.k[j]) / 9.80665)
    long.push(-(v - before) / dt / 9.80665)
    dist.push(s)
    before = v
    s += v * dt
    lapS += v * dt
    if (lapS >= track.length) {
      lapS -= track.length
      j = 0
      starts.push(i + 1)
    }
  }
  const n = time.length
  const ch = (name: string, unit: string, data: number[]): Channel => ({
    id: name,
    name,
    group: 'Vehicle',
    unit,
    color: '#fff',
    precision: 2,
    data: Float64Array.from(data),
  })
  const channels = [ch('VSS', 'mph', speed), ch('AccelY', 'g', lat), ch('AccelX', 'g', long)]
  const session: Session = {
    name: 'outing',
    path: 'outing',
    note: '',
    sampleRate: 100,
    time: Float64Array.from(time),
    channels,
    byId: new Map(channels.map((c) => [c.id, c])),
  }
  const lapOf = (number: number, start: number, end: number): Lap => ({
    key: `lap-${number}`,
    label: String(number),
    kind: 'lap',
    number,
    start,
    end,
    t0: time[start],
    t1: time[end],
    time: time[end] - time[start],
    distance: dist[end] - dist[start],
  })
  const laps = [lapOf(1, starts[0], starts[1]), lapOf(2, starts[1], Math.min(n - 1, starts[2]))]
  return { session, distance: Float64Array.from(dist), laps, ideal, track }
}

describe('simulated channels', () => {
  it('lays the simulated lap over every timed lap in the log’s own units', () => {
    const { session, distance, laps, ideal } = outing(0.94)
    const out = simChannels(session, distance, null, laps, car, { source: 'auto', smooth: 3 }, true)
    expect(out.map((c) => c.id)).toEqual([
      'Sim Speed',
      'Sim Long G',
      'Sim Lat G',
      'Sim Gear',
      'Sim RPM',
      'Sim Time Gap',
    ])
    expect(out.every((c) => c.group === 'Sim' && c.data.length === session.time.length)).toBe(true)
    const [speed, , latG, gear, , gap] = out
    expect(speed.unit).toBe('mph')
    const real = session.byId.get('VSS')!.data
    const mid = laps[0].start + 300
    expect(speed.data[mid]).toBeGreaterThan(real[mid])
    expect(speed.data[mid] / real[mid]).toBeLessThan(1.25)
    const side = session.byId.get('AccelY')!.data
    let corner = laps[0].start
    for (let i = laps[0].start; i < laps[0].end; i++)
      if (Math.abs(side[i]) > Math.abs(side[corner])) corner = i
    expect(Math.sign(latG.data[corner])).toBe(Math.sign(side[corner]))
    expect(Math.abs(latG.data[corner])).toBeGreaterThan(Math.abs(side[corner]) * 0.9)
    expect(gear.data[mid]).toBeGreaterThanOrEqual(1)
    const end = laps[0].end - 1
    expect(gap.data[end]).toBeGreaterThan(0.3)
    expect(gap.data[end]).toBeCloseTo(laps[0].time - ideal.time, 0)
    expect(gap.data[laps[0].start]).toBeCloseTo(0, 6)
  })

  it('adds nothing without distance or timed laps, and never shadows a logged channel', () => {
    const { session, distance, laps } = outing(1)
    const o = { source: 'auto' as const, smooth: 3 }
    expect(simChannels(session, null, null, laps, car, o, true)).toEqual([])
    expect(simChannels(session, distance, null, [], car, o, true)).toEqual([])
    const out = [{ ...laps[0], kind: 'out' as const }]
    expect(simChannels(session, distance, null, out, car, o, true)).toEqual([])
    const taken = { ...session.channels[0], id: 'Sim Speed', name: 'Sim Speed' }
    const channels = [...session.channels, taken]
    const clash = { ...session, channels, byId: new Map(channels.map((c) => [c.id, c])) }
    const ids = simChannels(clash, distance, null, laps, car, o, true).map((c) => c.id)
    expect(ids).not.toContain('Sim Speed')
    expect(ids).toContain('Sim Lat G')
  })

  it('reads speed in m/s, flips a backwards accelerometer and treats a loop lap as closed', () => {
    const { session, distance, laps } = outing(1)
    const inp = logInputs(session, distance, null)!
    expect(inp.speedUnit).toBe('mph')
    expect(inp.speed[500] * MPH).toBeCloseTo(session.byId.get('VSS')!.data[500], 3)
    const forward = forwardG(inp)!
    expect(forward[laps[0].start + 50]).toBeCloseTo(-inp.longG![laps[0].start + 50], 9)
    const loop = lapTrack(inp, laps[0], { source: 'auto', smooth: 3 }, true)!
    expect(loop.closed).toBe(true)
    const run = lapTrack(inp, laps[0], { source: 'auto', smooth: 3 }, false)!
    expect(run.closed).toBe(false)
    expect(run.standing).toBe(false)
    expect(lapTrack(inp, laps[0], { source: 'gps', smooth: 3 }, true)).toBeNull()
  })
  it('reads accelerometers logged in m/s² without a unit as m/s²', () => {
    const n = 400
    const time = Float64Array.from({ length: n }, (_, i) => i / 50)
    const ch = (name: string, unit: string, data: number[]): Channel => ({
      id: name,
      name,
      group: 'Log',
      unit,
      color: '#fff',
      precision: 2,
      data: Float64Array.from(data),
    })
    const wave = (amp: number) => Array.from({ length: n }, (_, i) => amp * Math.sin(i / 20))
    const make = (unit: string, amp: number) => {
      const channels = [ch('VSS', 'mph', wave(40)), ch('AccelY', unit, wave(amp))]
      const session = {
        name: 'x',
        path: 'x',
        source: 'wide',
        note: '',
        sampleRate: 50,
        time,
        channels,
        byId: new Map(channels.map((c) => [c.id, c])),
      } as Session
      return logInputs(
        session,
        Float64Array.from(time, (t) => t * 15),
        null,
      )
    }
    const peak = (a: Float64Array | null | undefined) => Math.max(...(a ?? []))
    expect(peak(make('', 14.7)?.latG)).toBeCloseTo(1.5, 1)
    expect(peak(make('m/s²', 14.7)?.latG)).toBeCloseTo(1.5, 1)
    expect(peak(make('g', 1.5)?.latG)).toBeCloseTo(1.5, 2)
    expect(peak(make('', 1.5)?.latG)).toBeCloseTo(1.5, 2)
  })
})
