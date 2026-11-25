import type { CarSpecs } from '../../data/car'

const IN = 0.0254
const LB = 4.4482216

export interface DamperPoint {
  v: number
  comp: number
  reb: number
}

export interface DamperSetting {
  shock: string
  setting: string
  lever: string
  clicks: { lsr: number; hsr: number; lsc: number; hsc: number } | null
  gas: number
  points: DamperPoint[]
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length === 0 ? 0 : s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function parseShockDyno(text: string): DamperSetting[] | string {
  const lines = text.split(/\r?\n/)
  const key = (s: string) => s.trim().toLowerCase().replace(/[\s_]/g, '')
  let head = -1
  let sep = '\t'
  for (let i = 0; i < lines.length && head < 0; i++) {
    for (const d of ['\t', ',', ';']) {
      const cols = lines[i].split(d).map(key)
      if (cols.includes('shock') && cols.includes('velocityips') && cols.includes('complb')) {
        head = i
        sep = d
        break
      }
    }
  }
  if (head < 0)
    return 'This is not a shock dyno table. It needs a header row with Shock, Setting, TestSpeed_ips, Velocity_ips, Comp_lb and Rebound_lb (the AvgCurves sheet saved as CSV).'
  const cols = lines[head].split(sep).map(key)
  const at = (name: string) => cols.indexOf(name)
  const need = ['shock', 'setting', 'testspeedips', 'velocityips', 'complb', 'reboundlb'].map(at)
  if (need.some((i) => i < 0))
    return 'The shock dyno table is missing one of Setting, TestSpeed_ips, Velocity_ips, Comp_lb or Rebound_lb.'
  const [iShock, iSetting, iTest, iVel, iComp, iReb] = need
  const iLever = at('lever')
  const click = ['lsr', 'hsr', 'lsc', 'hsc'].map(at)
  type Row = { test: number; v: number; comp: number; reb: number }
  const groups = new Map<string, { first: string[]; rows: Row[] }>()
  const cell = (c: string[], i: number) => (c[i]?.trim() ? Number(c[i]) : NaN)
  for (const line of lines.slice(head + 1)) {
    const c = line.split(sep)
    if (c.length <= Math.max(iShock, iSetting, iTest, iVel)) continue
    const row = { test: cell(c, iTest), v: cell(c, iVel), comp: cell(c, iComp), reb: cell(c, iReb) }
    if (!c[iShock]?.trim() || !Number.isFinite(row.test) || !Number.isFinite(row.v)) continue
    if (!Number.isFinite(row.comp) || !Number.isFinite(row.reb)) continue
    const id = `${c[iShock].trim()}\u0000${c[iSetting].trim()}\u0000${iLever >= 0 ? c[iLever].trim() : ''}`
    let g = groups.get(id)
    if (!g) groups.set(id, (g = { first: c, rows: [] }))
    g.rows.push(row)
  }
  const out: DamperSetting[] = []
  for (const [id, g] of groups) {
    const [shock, setting, lever] = id.split('\u0000')
    const tests = new Map<number, { still: number | null; peak: Row | null }>()
    for (const r of g.rows) {
      let t = tests.get(r.test)
      if (!t) tests.set(r.test, (t = { still: null, peak: null }))
      if (r.v === 0) t.still = (r.comp + r.reb) / 2
      else if (!t.peak || r.v > t.peak.v) t.peak = r
    }
    const points: DamperPoint[] = []
    const stills: number[] = []
    for (const t of tests.values()) {
      if (!t.peak) continue
      const still = t.still ?? 0
      if (t.still !== null) stills.push(t.still)
      points.push({
        v: t.peak.v * IN,
        comp: (t.peak.comp - still) * LB,
        reb: (still - t.peak.reb) * LB,
      })
    }
    points.sort((a, b) => a.v - b.v)
    if (points.length === 0) continue
    const n = click.map((i) => (i >= 0 ? Number(g.first[i]) : NaN))
    out.push({
      shock,
      setting,
      lever,
      clicks: n.every(Number.isFinite) ? { lsr: n[0], hsr: n[1], lsc: n[2], hsc: n[3] } : null,
      gas: median(stills) * LB,
      points,
    })
  }
  return out.length > 0 ? out : 'The shock dyno table has no usable rows.'
}

export function forceAt(s: DamperSetting, v: number): { comp: number; reb: number } {
  const p = s.points
  if (v <= p[0].v) return { comp: (p[0].comp * v) / p[0].v, reb: (p[0].reb * v) / p[0].v }
  for (let i = 1; i < p.length; i++) {
    if (v <= p[i].v) {
      const f = (v - p[i - 1].v) / (p[i].v - p[i - 1].v)
      return {
        comp: p[i - 1].comp + (p[i].comp - p[i - 1].comp) * f,
        reb: p[i - 1].reb + (p[i].reb - p[i - 1].reb) * f,
      }
    }
  }
  const last = p[p.length - 1]
  return { comp: last.comp, reb: last.reb }
}

export type Axle = 'front' | 'rear'

export const axleOf = (shock: string): Axle =>
  /(^|[\s_-])[lr]?r$/i.test(shock.trim()) ? 'rear' : 'front'

export function criticalDamping(c: CarSpecs, axle: Axle): number {
  const front = axle === 'front'
  const ratio = front ? c.motionFront : c.motionRear
  const wheelRate = (front ? c.springFront : c.springRear) * 1000 * ratio * ratio
  const share = front ? 1 - c.rearWeight : c.rearWeight
  const sprung = (c.mass * share) / 2 - (front ? c.unsprungFront : c.unsprungRear)
  return 2 * Math.sqrt(Math.max(0, wheelRate) * Math.max(0, sprung))
}

export function dampingRatio(c: CarSpecs, axle: Axle, s: DamperSetting, shaftSpeed: number) {
  const ratio = axle === 'front' ? c.motionFront : c.motionRear
  const critical = criticalDamping(c, axle)
  const f = forceAt(s, shaftSpeed)
  const atWheel = (force: number) => (force / shaftSpeed) * ratio * ratio
  return {
    comp: critical > 0 ? atWheel(f.comp) / critical : NaN,
    reb: critical > 0 ? atWheel(f.reb) / critical : NaN,
  }
}
