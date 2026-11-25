import type { CarSpecs } from '../../data/car'

const G = 9.80665
export const DEG = Math.PI / 180
export const MAX_SLIP_ANGLE = 0.35
export const MAX_SLIP_RATIO = 0.4

export interface Tire {
  fnomin: number
  pcy1: number
  pdy1: number
  pdy2: number
  pey1: number
  pey2: number
  pky1: number
  pky2: number
  pky4: number
  alpmax: number
  ppy1: number
  ppy2: number
  ppy3: number
  ppy4: number
  nompres: number
  inflpres: number
  pcx1: number
  pdx1: number
  pdx2: number
  pex1: number
  pex2: number
  pkx1: number
  pkx2: number
  pkx3: number
  rbx1: number
  rbx2: number
  rcx1: number
  rby1: number
  rby2: number
  rcy1: number
}

export type TireKey = keyof Tire

export interface TireField {
  key: TireKey
  group:
    'Lateral (cornering)' | 'Longitudinal (drive and brake)' | 'Combined slip' | 'Pressure' | 'Load'
  label: string
  help: string
  step: number
}

export const TIRE_FIELDS: TireField[] = [
  {
    key: 'fnomin',
    group: 'Load',
    label: 'Nominal load Fz0',
    help: 'Load in newtons the coefficients are quoted at (FNOMIN in a .tir file). Blank = a quarter of the car’s weight',
    step: 10,
  },
  {
    key: 'pdy1',
    group: 'Lateral (cornering)',
    label: 'D: peak μ at nominal load',
    help: 'pDy1. Blank = Cornering μ (or Peak μ) from the Tires section',
    step: 0.05,
  },
  {
    key: 'pdy2',
    group: 'Lateral (cornering)',
    label: 'D: change in μ with load',
    help: 'pDy2: how much μ changes when the load doubles; negative for real tires. Blank = from "Grip kept at double load"',
    step: 0.01,
  },
  {
    key: 'pcy1',
    group: 'Lateral (cornering)',
    label: 'C: shape factor',
    help: 'pCy1, about 1.3–1.5. Above 1 the force falls after the peak',
    step: 0.05,
  },
  {
    key: 'pey1',
    group: 'Lateral (cornering)',
    label: 'E: curvature',
    help: 'pEy1, at most 1. Lower moves the peak to a smaller slip angle and sharpens it',
    step: 0.1,
  },
  {
    key: 'pey2',
    group: 'Lateral (cornering)',
    label: 'E: change with load',
    help: 'pEy2',
    step: 0.1,
  },
  {
    key: 'pky1',
    group: 'Lateral (cornering)',
    label: 'K: peak cornering stiffness',
    help: 'pKy1: the highest cornering stiffness (N per radian) divided by the nominal load. B is worked out as K ÷ (C·D)',
    step: 1,
  },
  {
    key: 'pky2',
    group: 'Lateral (cornering)',
    label: 'K: load at peak stiffness',
    help: 'pKy2: the load where cornering stiffness is highest, as a multiple of the nominal load',
    step: 0.1,
  },
  {
    key: 'pky4',
    group: 'Lateral (cornering)',
    label: 'K: shape of stiffness with load',
    help: 'pKy4: 2 in the classic formula; MF 6 tire files fit it',
    step: 0.1,
  },
  {
    key: 'alpmax',
    group: 'Lateral (cornering)',
    label: 'Largest slip angle (rad)',
    help: 'ALPMAX: the fit is only trusted up to this slip angle, so the cornering limit is never taken beyond it. 0.35 rad is 20°',
    step: 0.01,
  },
  {
    key: 'ppy1',
    group: 'Pressure',
    label: 'Stiffness change with pressure',
    help: 'pPy1: how much cornering stiffness changes per unit of relative pressure change',
    step: 0.05,
  },
  {
    key: 'ppy2',
    group: 'Pressure',
    label: 'Stiffness load shift with pressure',
    help: 'pPy2: how pressure moves the load where cornering stiffness peaks',
    step: 0.05,
  },
  {
    key: 'ppy3',
    group: 'Pressure',
    label: 'Grip change with pressure',
    help: 'pPy3: linear change in cornering μ with relative pressure change',
    step: 0.05,
  },
  {
    key: 'ppy4',
    group: 'Pressure',
    label: 'Grip change with pressure²',
    help: 'pPy4: quadratic change in cornering μ with relative pressure change',
    step: 0.05,
  },
  {
    key: 'nompres',
    group: 'Pressure',
    label: 'Nominal pressure (Pa)',
    help: 'NOMPRES: the pressure the coefficients are quoted at. 6895 Pa = 1 psi',
    step: 1000,
  },
  {
    key: 'inflpres',
    group: 'Pressure',
    label: 'Running pressure (Pa)',
    help: 'INFLPRES: hot pressure the tires run at. Blank = the nominal pressure. Only cornering changes with it, and only when the pressure coefficients above are set',
    step: 1000,
  },
  {
    key: 'pdx1',
    group: 'Longitudinal (drive and brake)',
    label: 'D: peak μ at nominal load',
    help: 'pDx1. Blank = Peak μ from the Tires section',
    step: 0.05,
  },
  {
    key: 'pdx2',
    group: 'Longitudinal (drive and brake)',
    label: 'D: change in μ with load',
    help: 'pDx2. Blank = from "Grip kept at double load"',
    step: 0.01,
  },
  {
    key: 'pcx1',
    group: 'Longitudinal (drive and brake)',
    label: 'C: shape factor',
    help: 'pCx1, about 1.5–1.7',
    step: 0.05,
  },
  {
    key: 'pex1',
    group: 'Longitudinal (drive and brake)',
    label: 'E: curvature',
    help: 'pEx1, at most 1',
    step: 0.1,
  },
  {
    key: 'pex2',
    group: 'Longitudinal (drive and brake)',
    label: 'E: change with load',
    help: 'pEx2',
    step: 0.1,
  },
  {
    key: 'pkx1',
    group: 'Longitudinal (drive and brake)',
    label: 'K: slip stiffness',
    help: 'pKx1: force per unit slip ratio divided by the load, at nominal load',
    step: 1,
  },
  {
    key: 'pkx2',
    group: 'Longitudinal (drive and brake)',
    label: 'K: change with load',
    help: 'pKx2',
    step: 1,
  },
  {
    key: 'pkx3',
    group: 'Longitudinal (drive and brake)',
    label: 'K: exponent with load',
    help: 'pKx3',
    step: 0.05,
  },
  {
    key: 'rbx1',
    group: 'Combined slip',
    label: 'rBx1',
    help: 'How fast drive and brake force falls as slip angle builds',
    step: 0.5,
  },
  {
    key: 'rbx2',
    group: 'Combined slip',
    label: 'rBx2',
    help: 'How much less that matters once the tire is already slipping',
    step: 0.5,
  },
  { key: 'rcx1', group: 'Combined slip', label: 'rCx1', help: 'Shape of that fall', step: 0.05 },
  {
    key: 'rby1',
    group: 'Combined slip',
    label: 'rBy1',
    help: 'How fast cornering force falls as slip ratio builds',
    step: 0.5,
  },
  {
    key: 'rby2',
    group: 'Combined slip',
    label: 'rBy2',
    help: 'How much less that matters once the tire is already at a slip angle',
    step: 0.5,
  },
  { key: 'rcy1', group: 'Combined slip', label: 'rCy1', help: 'Shape of that fall', step: 0.05 },
]

const KEYS = TIRE_FIELDS.map((f) => f.key)

export function cleanTire(v: unknown): Partial<Tire> {
  const out: Partial<Tire> = {}
  if (!v || typeof v !== 'object') return out
  for (const k of KEYS) {
    const x = (v as Record<string, unknown>)[k]
    if (typeof x === 'number' && Number.isFinite(x)) out[k] = x
  }
  return out
}

export function tireDefaults(c: CarSpecs): Tire {
  const lat = c.tireMuLat > 0 ? c.tireMuLat : c.tireMu
  const drop = -(1 - c.tireLoadGrip)
  return {
    fnomin: (c.mass * G) / 4,
    pcy1: 1.4,
    pdy1: lat,
    pdy2: drop * lat,
    pey1: 0,
    pey2: 0,
    pky1: 30,
    pky2: 2,
    pky4: 2,
    alpmax: MAX_SLIP_ANGLE,
    ppy1: 0,
    ppy2: 0,
    ppy3: 0,
    ppy4: 0,
    nompres: 96527,
    inflpres: 0,
    pcx1: 1.6,
    pdx1: c.tireMu,
    pdx2: drop * c.tireMu,
    pex1: 0,
    pex2: 0,
    pkx1: 30,
    pkx2: 0,
    pkx3: 0,
    rbx1: 12.35,
    rbx2: 10.77,
    rcx1: 1.092,
    rby1: 6.461,
    rby2: 4.196,
    rcy1: 1.081,
  }
}

export function tireOf(c: CarSpecs): Tire {
  const set = cleanTire(c.tire)
  const base = tireDefaults(c)
  const drop = -(1 - c.tireLoadGrip)
  const t = { ...base, ...set }
  if (!(t.fnomin > 0)) t.fnomin = base.fnomin
  const moved = (t.fnomin - base.fnomin) / base.fnomin
  const scale = t.fnomin / base.fnomin
  if (set.pdy1 === undefined) {
    t.pdy1 = base.pdy1 * (1 + drop * moved)
    if (set.pdy2 === undefined) t.pdy2 = base.pdy1 * drop * scale
  } else if (set.pdy2 === undefined) t.pdy2 = drop * t.pdy1
  if (set.pdx1 === undefined) {
    t.pdx1 = base.pdx1 * (1 + drop * moved)
    if (set.pdx2 === undefined) t.pdx2 = base.pdx1 * drop * scale
  } else if (set.pdx2 === undefined) t.pdx2 = drop * t.pdx1
  if (!(t.pky2 > 0)) t.pky2 = base.pky2
  if (!(t.pky4 > 0)) t.pky4 = base.pky4
  if (!(t.nompres > 0)) t.nompres = base.nompres
  if (!(t.inflpres > 0)) t.inflpres = t.nompres
  t.alpmax = Math.min(0.6, Math.max(0.05, Math.abs(t.alpmax) || base.alpmax))
  t.pdy1 = Math.abs(t.pdy1)
  t.pdx1 = Math.abs(t.pdx1)
  t.pky1 = Math.abs(t.pky1)
  t.pkx1 = Math.abs(t.pkx1)
  return t
}

export interface Curve {
  b: number
  c: number
  d: number
  e: number
  k: number
}

export function magic(cv: Curve, slip: number): number {
  const x = cv.b * slip
  return cv.d * Math.sin(cv.c * Math.atan(x - cv.e * (x - Math.atan(x))))
}

const peakMu = (d1: number, d2: number, dfz: number) =>
  d1 > 0 ? d1 * Math.min(1.5, Math.max(0.5, 1 + (d2 / d1) * dfz)) : 0

const shape = (c: number) => Math.min(3, Math.max(0.5, c))

const finish = (c: number, d: number, e: number, k: number): Curve => ({
  b: d > 0 ? Math.max(0, k) / (c * d) : 0,
  c,
  d,
  e: Math.min(0.999, e),
  k: Math.max(0, k),
})

export function latCurve(t: Tire, fz: number): Curve {
  if (!(fz > 0)) return { b: 0, c: shape(t.pcy1), d: 0, e: 0, k: 0 }
  const dfz = (fz - t.fnomin) / t.fnomin
  const dpi = (t.inflpres - t.nompres) / t.nompres
  const k =
    t.pky1 *
    t.fnomin *
    (1 + t.ppy1 * dpi) *
    Math.sin(t.pky4 * Math.atan(fz / (t.pky2 * (1 + t.ppy2 * dpi) * t.fnomin)))
  const grip = Math.max(0, 1 + t.ppy3 * dpi + t.ppy4 * dpi * dpi)
  return finish(shape(t.pcy1), peakMu(t.pdy1, t.pdy2, dfz) * grip * fz, t.pey1 + t.pey2 * dfz, k)
}

export function lonCurve(t: Tire, fz: number): Curve {
  if (!(fz > 0)) return { b: 0, c: shape(t.pcx1), d: 0, e: 0, k: 0 }
  const dfz = (fz - t.fnomin) / t.fnomin
  const k = fz * (t.pkx1 + t.pkx2 * dfz) * Math.exp(t.pkx3 * dfz)
  return finish(shape(t.pcx1), peakMu(t.pdx1, t.pdx2, dfz) * fz, t.pex1 + t.pex2 * dfz, k)
}

const inner = (cv: Curve, x: number) => x - cv.e * (x - Math.atan(x))

export function peakForce(cv: Curve, maxSlip: number): number {
  if (!(cv.d > 0) || !(cv.b > 0)) return 0
  if (cv.c >= 1 && inner(cv, cv.b * maxSlip) >= Math.tan(Math.PI / (2 * cv.c))) return cv.d
  return magic(cv, maxSlip)
}

const solved = { c: Number.NaN, e: Number.NaN, x: 0 }

function peakArg(cv: Curve): number {
  if (solved.c === cv.c && solved.e === cv.e) return solved.x
  const target = Math.tan(Math.PI / (2 * cv.c))
  let lo = 0
  let hi = 1
  while (inner(cv, hi) < target && hi < 1e6) hi *= 2
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (inner(cv, mid) < target) lo = mid
    else hi = mid
  }
  solved.c = cv.c
  solved.e = cv.e
  solved.x = hi
  return hi
}

export function peakSlip(cv: Curve, maxSlip: number): number {
  if (!(cv.d > 0) || !(cv.b > 0)) return 0
  if (cv.c < 1) return maxSlip
  return Math.min(maxSlip, peakArg(cv) / cv.b)
}

export function axlePeak(t: Tire, inside: number, outside: number) {
  const a = latCurve(t, inside)
  const b = latCurve(t, outside)
  const sa = peakSlip(a, t.alpmax)
  const sb = peakSlip(b, t.alpmax)
  if (!(a.d > 0)) return { force: magic(b, sb), slip: sb }
  if (!(b.d > 0)) return { force: magic(a, sa), slip: sa }
  const both = (s: number) => magic(a, s) + magic(b, s)
  const lo = Math.min(sa, sb)
  const hi = Math.max(sa, sb)
  if (hi - lo < 1e-9) return { force: both(lo), slip: lo }
  const mid = (lo + hi) / 2
  const f0 = both(lo)
  const f1 = both(mid)
  const f2 = both(hi)
  let slip = f0 >= f1 && f0 >= f2 ? lo : f2 >= f1 ? hi : mid
  let force = Math.max(f0, f1, f2)
  const bend = f0 - 2 * f1 + f2
  if (bend < 0) {
    const top = Math.min(hi, Math.max(lo, mid - ((f2 - f0) * (hi - lo)) / (4 * bend)))
    const ft = both(top)
    if (ft > force) {
      force = ft
      slip = top
    }
  }
  return { force, slip }
}

export function slipFor(cv: Curve, force: number, maxSlip: number): number {
  const top = peakSlip(cv, maxSlip)
  if (!(force > 0)) return 0
  if (force >= magic(cv, top)) return top
  let lo = 0
  let hi = top
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (magic(cv, mid) < force) lo = mid
    else hi = mid
  }
  return hi
}

export const latPeak = (t: Tire, fz: number) => peakForce(latCurve(t, fz), t.alpmax)

export const lonPeak = (t: Tire, fz: number) => peakForce(lonCurve(t, fz), MAX_SLIP_RATIO)

export function combinedEnvelope(t: Tire, n = 41, grid = 61): Float64Array {
  const lat = latCurve(t, t.fnomin)
  const lon = lonCurve(t, t.fnomin)
  const out = new Float64Array(n)
  const fyPeak = peakForce(lat, t.alpmax)
  const fxPeak = peakForce(lon, MAX_SLIP_RATIO)
  if (!(fyPeak > 0) || !(fxPeak > 0)) {
    for (let j = 0; j < n; j++) out[j] = Math.sqrt(1 - (j / (n - 1)) ** 2)
    return out
  }
  const aMax = Math.min(t.alpmax, 2 * peakSlip(lat, t.alpmax))
  const kMax = Math.min(MAX_SLIP_RATIO, 2 * peakSlip(lon, MAX_SLIP_RATIO))
  for (let i = 0; i < grid; i++) {
    const a = (i / (grid - 1)) * aMax
    const fy0 = magic(lat, a) / fyPeak
    for (let q = 0; q < grid; q++) {
      const k = (q / (grid - 1)) * kMax
      const gx = Math.cos(t.rcx1 * Math.atan(t.rbx1 * Math.cos(Math.atan(t.rbx2 * k)) * a))
      const gy = Math.cos(t.rcy1 * Math.atan(t.rby1 * Math.cos(Math.atan(t.rby2 * a)) * k))
      const fx = (magic(lon, k) / fxPeak) * Math.max(0, gx)
      const fy = fy0 * Math.max(0, gy)
      const j = Math.floor(Math.min(1, Math.max(0, fy)) * (n - 1) + 1e-9)
      if (fx > out[j]) out[j] = fx
    }
  }
  for (let j = n - 2; j >= 0; j--) if (out[j + 1] > out[j]) out[j] = out[j + 1]
  for (let j = 0; j < n; j++) out[j] = Math.min(1, out[j])
  out[n - 1] = 0
  return out
}

export function envelopeAt(env: ArrayLike<number>, used: number): number {
  const x = Math.min(1, Math.max(0, used)) * (env.length - 1)
  const i = Math.min(env.length - 2, Math.floor(x))
  return env[i] + (env[i + 1] - env[i]) * (x - i)
}

export interface TireSummary {
  fz: number
  lat: Curve
  lon: Curve
  peakAngle: number
  peakRatio: number
  corneringStiffness: number
}

export function tireSummary(t: Tire, fz = t.fnomin): TireSummary {
  const lat = latCurve(t, fz)
  const lon = lonCurve(t, fz)
  return {
    fz,
    lat,
    lon,
    peakAngle: peakSlip(lat, t.alpmax) / DEG,
    peakRatio: peakSlip(lon, MAX_SLIP_RATIO),
    corneringStiffness: lat.k * DEG,
  }
}

const FORCE_UNITS: Record<string, number> = {
  newton: 1,
  n: 1,
  kn: 1000,
  knewton: 1000,
  kilo_newton: 1000,
  pound_force: 4.4482216,
  lbf: 4.4482216,
}

export interface TirImport {
  coeffs: Partial<Tire>
  note: string
  radius?: number
  stiffness?: number
}

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`
const NUMBER = new RegExp(
  String.raw`^\s*([A-Za-z][A-Za-z0-9_]*)\s*=\s*(${NUM})(?:\s*\*\s*(${NUM}))?\s*$`,
)

export function parseTir(text: string): TirImport | string {
  const raw = new Map<string, number>()
  let force = 1
  for (const line of text.split(/\r?\n/)) {
    const body = line.split(/[$%!]/)[0]
    const unit = /^\s*FORCE\s*=\s*'([^']+)'/i.exec(body)
    if (unit) force = FORCE_UNITS[unit[1].trim().toLowerCase()] ?? 1
    for (const part of body.split(';')) {
      const m = NUMBER.exec(part)
      if (m) raw.set(m[1].toUpperCase(), Number(m[2]) * (m[3] === undefined ? 1 : Number(m[3])))
    }
  }
  const get = (k: string) => raw.get(k)
  const scale = (k: string) => {
    const v = raw.get(k)
    return v !== undefined && v > 0 ? v : 1
  }
  const coeffs: Partial<Tire> = {}
  const put = (key: TireKey, v: number | undefined) => {
    if (v !== undefined && Number.isFinite(v)) coeffs[key] = v
  }
  const sign = (v: number | undefined) => (v !== undefined && v < 0 ? -1 : 1)
  const abs = (v: number | undefined) => (v === undefined ? undefined : Math.abs(v))
  const times = (v: number | undefined, f: number) => (v === undefined ? undefined : v * f)

  const fnomin = get('FNOMIN')
  put('fnomin', fnomin === undefined ? undefined : Math.abs(fnomin) * force * scale('LFZO'))

  const hasLat = ['PCY1', 'PDY1', 'PKY1'].every((k) => raw.has(k))
  if (hasLat) {
    const muScale = scale('LMUY')
    put('pcy1', times(get('PCY1'), scale('LCY')))
    put('pdy1', times(abs(get('PDY1')), muScale))
    put('pdy2', times(get('PDY2'), sign(get('PDY1')) * muScale))
    put('pey1', times(get('PEY1'), scale('LEY')))
    put('pey2', times(get('PEY2'), scale('LEY')))
    put('pky1', times(abs(get('PKY1')), scale('LKY')))
    put('pky2', abs(get('PKY2')))
    put('pky4', get('PKY4'))
    for (const k of ['ppy1', 'ppy2', 'ppy3', 'ppy4'] as const) put(k, get(k.toUpperCase()))
    put('nompres', get('NOMPRES'))
    put('inflpres', get('INFLPRES'))
    const range = [get('ALPMIN'), get('ALPMAX')].filter((v) => v !== undefined && v !== 0)
    if (range.length) put('alpmax', Math.min(...range.map((v) => Math.abs(v as number))))
  }
  const kMin = get('KPUMIN')
  const kMax = get('KPUMAX')
  const unfitted = kMin !== undefined && kMax !== undefined && !(kMax > kMin)
  const hasLon = !unfitted && ['PCX1', 'PDX1', 'PKX1'].every((k) => raw.has(k))
  if (hasLon) {
    const muScale = scale('LMUX')
    put('pcx1', times(get('PCX1'), scale('LCX')))
    put('pdx1', times(abs(get('PDX1')), muScale))
    put('pdx2', times(get('PDX2'), sign(get('PDX1')) * muScale))
    put('pex1', times(get('PEX1'), scale('LEX')))
    put('pex2', times(get('PEX2'), scale('LEX')))
    put('pkx1', times(abs(get('PKX1')), scale('LKX')))
    put('pkx2', times(get('PKX2'), sign(get('PKX1')) * scale('LKX')))
    put('pkx3', get('PKX3'))
  }
  const hasCombined = !unfitted && ['RBX1', 'RCX1', 'RBY1', 'RCY1'].every((k) => raw.has(k))
  if (hasCombined) {
    put('rbx1', abs(get('RBX1')))
    put('rbx2', abs(get('RBX2')))
    put('rcx1', get('RCX1'))
    put('rby1', abs(get('RBY1')))
    put('rby2', abs(get('RBY2')))
    put('rcy1', get('RCY1'))
  }
  if (!hasLat && !hasLon)
    return 'No Magic Formula coefficients found. The file needs PCY1, PDY1 and PKY1 (cornering) or PCX1, PDX1 and PKX1 (drive and brake), as in an MF 5.2 or MF 6 .tir file.'
  const parts = [
    hasLat ? 'cornering' : '',
    hasLon ? 'drive and brake' : '',
    hasCombined ? 'combined slip' : '',
  ].filter(Boolean)
  const missing = [
    hasLat ? '' : 'cornering',
    hasLon ? '' : 'drive and brake',
    hasCombined ? '' : 'combined slip',
  ].filter(Boolean)
  const warn: string[] = []
  if (unfitted)
    warn.push(
      'The file’s slip-ratio range is empty, so its drive, brake and combined-slip numbers are template values and not a fit; they were left out.',
    )
  if (hasLat) {
    const c = coeffs.pcy1 ?? 1
    const e1 = get('PEY1') ?? 0
    const e3 = get('PEY3') ?? 0
    const offset = Math.abs((get('PVY1') ?? 0) * scale('LVY') * scale('LMUY'))
    if (c < 1)
      warn.push(
        `Its cornering shape factor is ${c.toFixed(2)}, below 1, so the curve never peaks; the limit is taken at the largest slip angle.`,
      )
    if (Math.abs(e1 * e3) > 0.75 || offset > 0.05)
      warn.push(
        `The cornering fit is lopsided left to right (${offset > 0.05 ? `a side force of ${(offset * 100).toFixed(0)}% of the load at zero slip, ` : ''}curvature ${(e1 * (1 - e3)).toFixed(2)} one way and ${(e1 * (1 + e3)).toFixed(2)} the other). Only the symmetric part is used here, so check the fit before trusting it.`,
      )
  }
  const radius = get('UNLOADED_RADIUS')
  const stiffness = get('VERTICAL_STIFFNESS')
  const extra = [
    radius ? `an unloaded radius of ${radius.toFixed(3)} m` : '',
    stiffness ? `a vertical stiffness of ${Math.round(stiffness / 1000)} N/mm` : '',
  ].filter(Boolean)
  return {
    coeffs,
    radius,
    stiffness: stiffness === undefined ? undefined : stiffness / 1000,
    note:
      `Read the ${parts.join(', ')} coefficients` +
      (coeffs.fnomin ? ` at a nominal load of ${Math.round(coeffs.fnomin)} N` : '') +
      (missing.length ? `; ${missing.join(' and ')} keep the values that were here` : '') +
      '. Camber, pressure, offsets and aligning moment are not used, so this is the tire upright at its nominal pressure. ' +
      warn.join(' ') +
      (warn.length ? ' ' : '') +
      (extra.length
        ? `The file also lists ${extra.join(' and ')}; Tire radius and Tire vertical rate on this tab are not changed. `
        : '') +
      'Peak μ and Cornering μ were set from the file with its own scaling factors.',
  }
}
