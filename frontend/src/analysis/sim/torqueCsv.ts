import { cleanTorque, type TorquePoint } from '../../data/car'

export interface TorqueImport {
  points: TorquePoint[]
  note: string
}

const LBFT = 1.355818
const HP = 0.7457
const MAX_POINTS = 60

function split(line: string, sep: string | null): string[] {
  const cells = sep ? line.split(sep) : line.trim().split(/\s+/)
  return cells.map((c) => c.trim().replace(/^"|"$/g, ''))
}

export function parseTorqueCsv(text: string): TorqueImport | string {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
  if (lines.length < 2) return 'The file needs at least two rows of RPM and torque.'
  const sep = [',', ';', '\t'].find((s) => lines[0].includes(s) || lines[1].includes(s)) ?? null
  const rows = lines.map((l) => split(l, sep))
  const numeric = (r: string[]) =>
    r.length >= 2 && r.slice(0, 2).every((c) => Number.isFinite(Number(c)) && c !== '')
  let head = -1
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (numeric(rows[i])) break
    head = i
  }
  const header = head >= 0 ? rows[head].map((h) => h.toLowerCase()) : []
  const find = (re: RegExp, not?: RegExp) =>
    header.findIndex((h) => re.test(h) && !(not && not.test(h)))
  let rpmCol = find(/rpm|engine speed|rev/)
  let torqueCol = find(/torque|\bnm\b|n·m|n-m|n\.m|lb.?ft|ft.?lb/)
  const powerCol = find(/power|\bhp\b|bhp|\bkw\b|\bps\b/, /torque/)
  if (header.length === 0 || (rpmCol < 0 && torqueCol < 0 && powerCol < 0)) {
    rpmCol = 0
    torqueCol = 1
  }
  if (rpmCol < 0) rpmCol = 0
  if (torqueCol < 0 && powerCol < 0) return 'Could not find a torque or power column.'
  const useTorque = torqueCol >= 0
  const label = header[useTorque ? torqueCol : powerCol] ?? ''
  const imperial = useTorque ? /lb|ft/.test(label) : !/kw/.test(label) && /hp|bhp|ps/.test(label)
  const raw: TorquePoint[] = []
  for (const r of rows.slice(head + 1)) {
    const rpm = Number(r[rpmCol])
    const value = Number(r[useTorque ? torqueCol : powerCol])
    if (!(rpm > 0) || !Number.isFinite(value) || value < 0) continue
    const nm = useTorque
      ? value * (imperial ? LBFT : 1)
      : (value * (imperial ? HP : 1) * 30000) / (Math.PI * rpm)
    raw.push([rpm, nm])
  }
  if (raw.length < 2)
    return 'No usable rows: each needs an RPM above 0 and a torque or power value.'
  let points = cleanTorque(raw)
  if (points.length > MAX_POINTS) {
    const lo = points[0][0]
    const hi = points[points.length - 1][0]
    const width = Math.max(50, Math.ceil((hi - lo) / MAX_POINTS / 50) * 50)
    const bins = new Map<number, number[]>()
    for (const [rpm, nm] of points) {
      const b = Math.round(rpm / width) * width
      const list = bins.get(b) ?? []
      list.push(nm)
      bins.set(b, list)
    }
    points = cleanTorque(
      [...bins.entries()].map(([rpm, list]) => [
        rpm,
        list.reduce((a, b) => a + b, 0) / list.length,
      ]),
    )
  }
  points = points.map(([rpm, nm]) => [Math.round(rpm), Number(nm.toFixed(2))])
  const unit = useTorque ? (imperial ? 'lb·ft' : 'N·m') : imperial ? 'hp' : 'kW'
  return {
    points,
    note: `${points.length} points from ${raw.length} rows, read as ${useTorque ? 'torque' : 'power'} in ${unit}${
      useTorque && !imperial ? '' : ', converted to N·m'
    }.`,
  }
}
