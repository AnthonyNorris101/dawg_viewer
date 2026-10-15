import { CHANNEL_COLORS, type Channel, type Session } from './session'

// Synthetic session so the UI has something to draw until real log loading is
// wired up. None of these values come from a car.

const TAU = Math.PI * 2
const SAMPLE_RATE = 500
const DURATION_S = 300

type Gen = (t: number, noise: () => number) => number

interface ChannelDef {
  id: string
  name: string
  group: string
  unit: string
  precision: number
  gen: Gen
}

// Small deterministic PRNG so the demo data is identical on every launch.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296 - 0.5
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

const pedal = (t: number) => Math.sin((TAU * t) / 23 + 0.9)
const speed = (t: number) => 38 + 18 * Math.sin((TAU * t) / 23) + 7 * Math.sin((TAU * t) / 6.1 + 1)
const steer = (t: number) => 70 * Math.sin((TAU * t) / 11) + 20 * Math.sin((TAU * t) / 3.7)

const wheelSpeed =
  (bias: number): Gen =>
  (t, n) =>
    speed(t) * (1 + (bias * steer(t)) / 900) + n() * 0.6

const damper =
  (phase: number): Gen =>
  (t, n) =>
    25 + 9 * Math.sin((TAU * t) / 1.3 + phase) + 4 * Math.sin((TAU * t) / 0.21 + phase) + n() * 1.5

const DEFS: ChannelDef[] = [
  {
    id: 'rpm',
    name: 'Engine RPM',
    group: 'Engine',
    unit: 'rpm',
    precision: 0,
    gen: (t, n) => 4000 + speed(t) * 110 + n() * 120,
  },
  {
    id: 'tps',
    name: 'Throttle Position',
    group: 'Engine',
    unit: '%',
    precision: 1,
    gen: (t, n) => clamp(50 + 60 * pedal(t) + n(), 0, 100),
  },
  {
    id: 'lambda',
    name: 'Lambda',
    group: 'Engine',
    unit: 'λ',
    precision: 3,
    gen: (t, n) => 0.92 + 0.06 * Math.sin((TAU * t) / 4.3) + n() * 0.02,
  },
  {
    id: 'ect',
    name: 'Coolant Temp',
    group: 'Engine',
    unit: '°C',
    precision: 1,
    gen: (t, n) => 95 - 30 * Math.exp(-t / 60) + n() * 0.3,
  },
  {
    id: 'oilp',
    name: 'Oil Pressure',
    group: 'Engine',
    unit: 'psi',
    precision: 1,
    gen: (t, n) => 42 + speed(t) * 0.35 + n() * 1.2,
  },
  {
    id: 'vbat',
    name: 'Battery Voltage',
    group: 'Engine',
    unit: 'V',
    precision: 2,
    gen: (t, n) => 13.6 + 0.2 * Math.sin((TAU * t) / 40) + n() * 0.05,
  },
  {
    id: 'brk_f',
    name: 'Brake Pressure F',
    group: 'Driver',
    unit: 'psi',
    precision: 0,
    gen: (t, n) => Math.max(0, (-60 * pedal(t) - 20) * 14 + n() * 6),
  },
  {
    id: 'brk_r',
    name: 'Brake Pressure R',
    group: 'Driver',
    unit: 'psi',
    precision: 0,
    gen: (t, n) => Math.max(0, (-60 * pedal(t) - 20) * 8 + n() * 6),
  },
  {
    id: 'steer',
    name: 'Steering Angle',
    group: 'Driver',
    unit: 'deg',
    precision: 1,
    gen: (t, n) => steer(t) + n() * 0.8,
  },
  {
    id: 'ws_fl',
    name: 'Wheel Speed FL',
    group: 'Wheel Speeds',
    unit: 'mph',
    precision: 1,
    gen: wheelSpeed(1),
  },
  {
    id: 'ws_fr',
    name: 'Wheel Speed FR',
    group: 'Wheel Speeds',
    unit: 'mph',
    precision: 1,
    gen: wheelSpeed(-1),
  },
  {
    id: 'ws_rl',
    name: 'Wheel Speed RL',
    group: 'Wheel Speeds',
    unit: 'mph',
    precision: 1,
    gen: wheelSpeed(0.6),
  },
  {
    id: 'ws_rr',
    name: 'Wheel Speed RR',
    group: 'Wheel Speeds',
    unit: 'mph',
    precision: 1,
    gen: wheelSpeed(-0.6),
  },
  {
    id: 'acc_x',
    name: 'Accel Longitudinal',
    group: 'IMU',
    unit: 'g',
    precision: 2,
    gen: (t, n) => 0.9 * Math.cos((TAU * t) / 23) + n() * 0.08,
  },
  {
    id: 'acc_y',
    name: 'Accel Lateral',
    group: 'IMU',
    unit: 'g',
    precision: 2,
    gen: (t, n) => (steer(t) / 70) * 1.4 + n() * 0.08,
  },
  {
    id: 'acc_z',
    name: 'Accel Vertical',
    group: 'IMU',
    unit: 'g',
    precision: 2,
    gen: (t, n) => 1 + 0.15 * Math.sin((TAU * t) / 0.21) + n() * 0.1,
  },
  {
    id: 'dmp_fl',
    name: 'Damper Pos FL',
    group: 'Suspension',
    unit: 'mm',
    precision: 1,
    gen: damper(0),
  },
  {
    id: 'dmp_fr',
    name: 'Damper Pos FR',
    group: 'Suspension',
    unit: 'mm',
    precision: 1,
    gen: damper(1.1),
  },
  {
    id: 'dmp_rl',
    name: 'Damper Pos RL',
    group: 'Suspension',
    unit: 'mm',
    precision: 1,
    gen: damper(2.3),
  },
  {
    id: 'dmp_rr',
    name: 'Damper Pos RR',
    group: 'Suspension',
    unit: 'mm',
    precision: 1,
    gen: damper(3.2),
  },
]

export function createDemoSession(): Session {
  const n = SAMPLE_RATE * DURATION_S
  const time = new Float64Array(n)
  for (let i = 0; i < n; i++) time[i] = i / SAMPLE_RATE

  const channels: Channel[] = DEFS.map((def, c) => {
    const noise = mulberry32(c + 1)
    const data = new Float32Array(n)
    for (let i = 0; i < n; i++) data[i] = def.gen(time[i], noise)
    return {
      id: def.id,
      name: def.name,
      group: def.group,
      unit: def.unit,
      precision: def.precision,
      color: CHANNEL_COLORS[c % CHANNEL_COLORS.length],
      data,
    }
  })

  return {
    name: 'Demo session (synthetic data)',
    sampleRate: SAMPLE_RATE,
    time,
    channels,
    byId: new Map(channels.map((ch) => [ch.id, ch])),
  }
}
