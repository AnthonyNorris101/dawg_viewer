const LAT0 = 33.948
const LON0 = -83.377
const M_LAT = 1 / 111320
const M_LON = 1 / (111320 * Math.cos((LAT0 * Math.PI) / 180))
const G = 9.80665

const N = 2000
const px = new Float64Array(N)
const py = new Float64Array(N)
for (let k = 0; k < N; k++) {
  const a = (2 * Math.PI * k) / N
  const r = 140 + 35 * Math.cos(2 * a) + 18 * Math.sin(5 * a)
  px[k] = r * Math.cos(a) * 1.4
  py[k] = r * Math.sin(a)
}
const seg = new Float64Array(N)
const cum = new Float64Array(N)
let L = 0
for (let k = 0; k < N; k++) {
  const j = (k + 1) % N
  seg[k] = Math.hypot(px[j] - px[k], py[j] - py[k])
  cum[k] = L
  L += seg[k]
}
export const TRACK_LEN = L

function at(d: number) {
  d = ((d % L) + L) % L
  let lo = 0
  let hi = N - 1
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1
    if (cum[m] <= d) lo = m
    else hi = m - 1
  }
  const j = (lo + 1) % N
  const f = (d - cum[lo]) / seg[lo]
  return {
    x: px[lo] + (px[j] - px[lo]) * f,
    y: py[lo] + (py[j] - py[lo]) * f,
    h: Math.atan2(py[j] - py[lo], px[j] - px[lo]),
  }
}

function curvature(d: number) {
  const h0 = at(d - 3).h
  const h1 = at(d + 3).h
  const dh = Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0))
  return dh / 6
}

const MASS = 290
const POWER = 45000
const GRIP = 1.5 * G
const BRAKE = 1.12 * G
const LAUNCH = 1.05 * G
const RHO = 1.2
const CLA = 2.3
const CDA = 1.3
const AERO_Q = (0.5 * RHO * CLA) / (MASS * G)
const accelLimit = (v: number) =>
  Math.min(LAUNCH, (POWER / Math.max(v, 1) - 0.5 * RHO * CDA * v * v) / MASS)
const cornerSpeed = (k: number) => {
  const den = Math.abs(k) - GRIP * AERO_Q
  return den <= 0 ? 33 : Math.min(33, Math.sqrt(GRIP / den))
}

const STEP = 1
const grid = Math.ceil(L / STEP) + 1
const curv = new Float64Array(grid)
const vmax = new Float64Array(grid)
for (let i = 0; i < grid; i++) {
  curv[i] = curvature(i * STEP)
  vmax[i] = cornerSpeed(curv[i])
}
const spare = (v: number, k: number) => {
  const grip = GRIP * (1 + AERO_Q * v * v)
  const lat = v * v * Math.abs(k)
  return Math.sqrt(Math.max(0, grip * grip - lat * lat))
}
for (let pass = 0; pass < 3; pass++) {
  for (let i = 1; i < grid; i++) {
    const a = Math.min(accelLimit(vmax[i - 1]), spare(vmax[i - 1], curv[i - 1]))
    vmax[i] = Math.min(vmax[i], Math.sqrt(vmax[i - 1] ** 2 + 2 * a * STEP))
  }
  for (let i = grid - 2; i >= 0; i--) {
    const b = Math.min(BRAKE, spare(vmax[i + 1], curv[i + 1]))
    vmax[i] = Math.min(vmax[i], Math.sqrt(vmax[i + 1] ** 2 + 2 * b * STEP))
  }
}
const limitAt = (d: number) => vmax[Math.floor((((d % L) + L) % L) / STEP)]

export const START_LINE = { lat: LAT0 + at(0).y * M_LAT, lon: LON0 + at(0).x * M_LON }

const GEARS = [2.583, 2.0, 1.667, 1.444, 1.286, 1.15]
const PRIMARY = 2.073
const FINAL = 3.08
const TIRE_R = 0.229
const wheelRpm = (v: number, gear: number) =>
  (v / (2 * Math.PI * TIRE_R)) * 60 * PRIMARY * GEARS[gear - 1] * FINAL

function rand(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

export const CHANNELS: { name: string; unit: string; id: number; raw?: boolean }[] = [
  { name: 'RPM', unit: '', id: 11 },
  { name: 'VSS', unit: 'mph', id: 20 },
  { name: 'Wheel Speed Front', unit: 'mph', id: 21 },
  { name: 'Wheel Speed Rear', unit: 'mph', id: 22 },
  { name: 'GearRaw', unit: '', id: 38 },
  { name: 'TPS1', unit: '%', id: 52 },
  { name: 'FBPS', unit: 'psi', id: 28 },
  { name: 'RBPS', unit: 'psi', id: 29 },
  { name: 'StrAngle', unit: '°', id: 40 },
  { name: 'AccelX', unit: 'g', id: 101 },
  { name: 'AccelY', unit: 'g', id: 102 },
  { name: 'AccelZ', unit: 'g', id: 103 },
  { name: 'Yaw', unit: '°', id: 104 },
  { name: 'PosLat', unit: '°', id: -1 },
  { name: 'PosLong', unit: '°', id: -1 },
  { name: 'CLT1', unit: '', id: 12 },
  { name: 'OilTemp', unit: '', id: 13 },
  { name: 'OilPres', unit: '', id: 16 },
  { name: 'RadTemp', unit: '°F', id: 36 },
  { name: 'AFR', unit: '', id: 17 },
  { name: 'BatV', unit: 'V', id: 18 },
  { name: 'Damper FL', unit: 'mm', id: 60 },
  { name: 'Damper FR', unit: 'mm', id: 61 },
  { name: 'Damper RL', unit: 'mm', id: 62 },
  { name: 'Damper RR raw', unit: '', id: 63, raw: true },
]

export interface CarOptions {
  seed: number
  startD: number
  holdS: number
  pace: (lap: number, r: () => number) => number
  laps: number
  dropout?: [number, number]
}

export class Car {
  t = 0
  d: number
  v = 0
  lap = 0
  gear = 1
  launchedAt = -1
  pace: number
  done = false
  private r: () => number
  private gps = { lat: NaN, lon: NaN }
  private gpsAt = -1
  private stopAt = -1

  constructor(private o: CarOptions) {
    this.d = o.startD
    this.r = rand(o.seed)
    this.pace = o.pace(0, this.r)
  }

  step(dt: number): Record<string, number> {
    const { o, r } = this
    const t = this.t
    const holding = t < o.holdS
    const finishing = this.lap >= o.laps
    let target = holding ? 0 : limitAt(this.d) * this.pace
    if (finishing) {
      if (this.stopAt < 0) this.stopAt = this.d
      target = Math.max(0, Math.min(target, 14 - (this.d - this.stopAt) / 6))
      if (target < 0.5) target = 0
    }
    const prevV = this.v
    const up =
      accelLimit(this.v) * (this.launchedAt >= 0 && t - this.launchedAt < 2.5 ? 0.97 : 0.92)
    const a = Math.max(-BRAKE, Math.min(up, (target - this.v) / 0.2))
    this.v = Math.max(0, this.v + a * dt)
    if (target === 0 && this.v < 0.05 && !holding) this.v = 0
    if (!holding && this.launchedAt < 0 && this.v > 0) this.launchedAt = t
    if (finishing && this.v === 0 && target === 0) this.done = true
    this.d += this.v * dt
    if (this.d >= TRACK_LEN * (this.lap + 1)) {
      this.lap++
      this.pace = o.pace(this.lap, r)
    }
    const p = at(this.d)
    const k = curvature(this.d)
    const ax = (this.v - prevV) / dt / G
    const ay = (this.v * this.v * k) / G
    const sinceLaunch = this.launchedAt >= 0 ? t - this.launchedAt : Infinity

    const tireSlip =
      ax > 0.05 ? (sinceLaunch < 3 ? 0.11 * Math.exp(-sinceLaunch / 1.8) + 0.035 : 0.025) : 0
    const driven = this.v * (1 + tireSlip)
    let best = 1
    for (let g = 1; g <= GEARS.length; g++) if (wheelRpm(driven, g) >= 6800) best = g
    if (
      Math.abs(best - this.gear) >= 1 &&
      (wheelRpm(driven, this.gear) > 12300 || wheelRpm(driven, this.gear) < 6200)
    )
      this.gear = best
    if (sinceLaunch < 0.4 || holding) this.gear = 1
    let rpm = Math.max(2100, wheelRpm(driven, this.gear))
    const launchRpm = 9300
    if (holding) rpm = t > o.holdS - 0.6 ? launchRpm + r() * 120 : 2200 + r() * 60
    else if (sinceLaunch < 0.9) rpm = Math.max(rpm, launchRpm * (1 - 0.22 * (sinceLaunch / 0.9)))

    let tps = 0
    if (holding) tps = t > o.holdS - 0.6 ? 100 : 0
    else if (target > this.v + 0.3)
      tps = Math.min(100, 70 + 30 * Math.min(1, (target - this.v) / 2))
    else if (ax > -0.15) tps = 18 + r() * 6
    const brake = Math.max(0, -ax - 0.12) * 950 + r() * 6

    if (this.gpsAt < 0 || t - this.gpsAt >= 0.05 - 1e-9) {
      const inDropout = o.dropout && t >= o.dropout[0] && t < o.dropout[1]
      if (!inDropout) {
        this.gps = {
          lat: LAT0 + (p.y + (r() - 0.5) * 0.6) * M_LAT,
          lon: LON0 + (p.x + (r() - 0.5) * 0.6) * M_LON,
        }
      }
      this.gpsAt = t
    }

    const hop = Math.sin(2 * Math.PI * 14.5 * t) * (this.v / 30)
    const body = Math.sin(2 * Math.PI * 2.4 * t + 0.4) * (this.v / 30)
    const noise = () => (r() - 0.5) * 2
    const damper = (side: number, axle: number) =>
      25 +
      side * ay * 7.5 -
      axle * ax * 5.5 +
      1.4 * hop * (axle > 0 ? 1 : 0.8) +
      0.9 * body +
      noise() * 0.35
    const yawDeg = ((((90 - (p.h * 180) / Math.PI + 180) % 360) + 360) % 360) - 180
    const warm = 1 - Math.exp(-t / 150)
    this.t += dt
    return {
      RPM: Math.round(rpm),
      VSS: this.v * 2.23694,
      'Wheel Speed Front': Math.max(
        0,
        this.v * (1 - Math.min(0.06, Math.max(0, -ax - 0.9) * 0.2)) * 2.23694 + noise() * 0.05,
      ),
      'Wheel Speed Rear': Math.max(0, driven * 2.23694 + noise() * 0.05),
      GearRaw: holding || this.v < 0.3 ? 0 : this.gear,
      TPS1: tps,
      FBPS: brake,
      RBPS: brake * 0.62,
      StrAngle: k * 1600 + noise() * 0.6,
      AccelX: ax + noise() * 0.03,
      AccelY: ay + noise() * 0.03,
      AccelZ: 1 + 0.07 * hop + 0.03 * body + noise() * 0.035,
      Yaw: yawDeg + noise() * 0.3,
      PosLat: this.gps.lat,
      PosLong: this.gps.lon,
      CLT1: 78 + 16 * warm + noise() * 0.2,
      OilTemp: 88 + 14 * warm + noise() * 0.2,
      OilPres: 38 + rpm / 400 + noise(),
      RadTemp: 150 + 35 * warm + noise() * 0.4,
      AFR: tps > 80 ? 12.6 + noise() * 0.15 : 13.6 + noise() * 0.25,
      BatV: 13.7 - tps * 0.003 + noise() * 0.04,
      'Damper FL': damper(-1, 1),
      'Damper FR': damper(1, 1),
      'Damper RL': damper(-1, -1),
      'Damper RR raw': Math.round(800 + damper(1, -1) * 80),
    }
  }
}

export interface SampleLog {
  buffer: ArrayBuffer
  rows: number
  channels: { name: string; unit: string }[]
}

export function sampleLog(): SampleLog {
  const paces = [0.8, 0.93, 0.97, 0.955, 0.985, 0.94]
  const car = new Car({
    seed: 7,
    startD: -40,
    holdS: 2,
    laps: 6,
    pace: (lap) => paces[Math.min(lap, paces.length - 1)],
    dropout: [150, 153],
  })
  const dt = 0.01
  const cols = CHANNELS.map(() => [] as number[])
  const time: number[] = []
  let stoppedFor = 0
  while (stoppedFor < 3 && time.length < 60000) {
    time.push(Math.round(car.t * 1000) / 1000)
    const v = car.step(dt)
    CHANNELS.forEach((c, i) => cols[i].push(v[c.name]))
    if (car.done) stoppedFor += dt
  }
  const rows = time.length
  const out = new Float64Array((CHANNELS.length + 1) * rows)
  out.set(time, 0)
  cols.forEach((c, i) => out.set(c, (i + 1) * rows))
  return {
    buffer: out.buffer,
    rows,
    channels: CHANNELS.map((c) => ({ name: c.name, unit: c.unit })),
  }
}

export function liveCar() {
  return new Car({
    seed: Date.now() % 100000,
    startD: -40,
    holdS: 3,
    laps: Infinity,
    pace: (_lap, r) => 0.9 + r() * 0.08,
  })
}
