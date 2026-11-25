export type TrackFile =
  | { kind: 'segments'; name: string; lines: string[]; closed: boolean | null; note: string }
  | {
      kind: 'path'
      name: string
      x: number[]
      y: number[]
      closed: boolean
      width: number | null
      origin?: { lat: number; lon: number }
      recorded: boolean
      note: string
    }
  | { kind: 'error'; error: string }

const EARTH_R = 6371008.8
const fmt = (v: number) => String(Math.round(v * 1000) / 1000)
const baseName = (file: string) => file.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') || 'Track'

function sectionLines(rows: { length: number; radius: number; turn: number }[]) {
  const lines: string[] = []
  let total = 0
  for (const r of rows) {
    if (!(r.length > 0) || !Number.isFinite(r.length)) continue
    if (r.turn === 0 || !(r.radius > 0)) lines.push(`straight ${fmt(r.length)}`)
    else lines.push(`${r.turn > 0 ? 'left' : 'right'} ${fmt(r.radius)} ${fmt(r.length)}`)
    total += r.length
  }
  return { lines, total }
}

function netString(b: Uint8Array, pos: number): { text: string; next: number } | null {
  let n = 0
  let shift = 0
  for (;;) {
    if (pos >= b.length || shift > 28) return null
    const v = b[pos++]
    n |= (v & 0x7f) << shift
    shift += 7
    if (v < 0x80) break
  }
  if (pos + n > b.length) return null
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(pos, pos + n))
    return { text, next: pos + n }
  } catch {
    return null
  }
}

export function parseOltra(b: Uint8Array, file = 'track.OLTra'): TrackFile {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const header: string[] = []
  let pos = 1
  while (header.length < 8) {
    const s = netString(b, pos)
    if (!s) break
    header.push(s.text)
    pos = s.next
  }
  const bad: TrackFile = {
    kind: 'error',
    error: 'This does not look like an OptimumLap track (.OLTra) file.',
  }
  if (header.length < 5 || !/^\d+(\.\d+)+$/.test(header[0])) return bad
  const doubles = (at: number, n: number) =>
    Array.from({ length: n }, (_, i) => view.getFloat64(at + 8 * i, true))
  for (let o = pos; o + 12 <= b.length; o++) {
    const n = view.getInt32(o, true)
    if (n < 1 || n > 100000) continue
    const second = o + 4 + 8 * n
    const third = second + 4 + 8 * n
    if (third + 4 + 8 * n > b.length) continue
    if (view.getInt32(second, true) !== n || view.getInt32(third, true) !== n) continue
    const length = doubles(o + 4, n)
    const radius = doubles(second + 4, n)
    const turn = doubles(third + 4, n)
    if (!turn.every((v) => v === -1 || v === 0 || v === 1)) continue
    if (!length.every((v) => v > 0 && v < 1e6) || !radius.every((v) => v >= 0 && v < 1e7)) continue
    if (turn.some((v, i) => v !== 0 && !(radius[i] > 0)))
      return { kind: 'error', error: 'This OptimumLap track has a corner with no radius.' }
    const { lines, total } = sectionLines(
      length.map((l, i) => ({ length: l, radius: radius[i], turn: turn[i] })),
    )
    const kind = header.slice(5).find((h) => /circuit/i.test(h)) ?? ''
    const name = header[4].trim() || baseName(file)
    return {
      kind: 'segments',
      name,
      lines,
      closed: /open/i.test(kind) ? false : /closed/i.test(kind) ? true : null,
      note: `Read OptimumLap track “${name}”: ${lines.length} sections, ${total.toFixed(1)} m${kind ? `, ${kind.toLowerCase()}` : ''}.`,
    }
  }
  return bad
}

const cells = (line: string) =>
  line
    .split(line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',')
    .map((c) => c.trim().replace(/^"|"$/g, ''))

function rowsOf(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^#\s*/, ''))
    .filter(Boolean)
    .map(cells)
}

export function parseTrackTable(text: string, file = 'track.csv'): TrackFile {
  const rows = rowsOf(text)
  let type = 0
  let length = 1
  let radius = 2
  let start = 0
  const head = rows.findIndex(
    (r) => r.some((c) => /type|sector|section/i.test(c)) && r.some((c) => /len|dist/i.test(c)),
  )
  if (head >= 0) {
    const h = rows[head].map((c) => c.toLowerCase())
    type = h.findIndex((c) => /type/.test(c))
    if (type < 0) type = h.findIndex((c) => /sector|section/.test(c) && !/len|dist|rad/.test(c))
    length = h.findIndex((c) => /len|dist/.test(c))
    radius = h.findIndex((c) => /rad/.test(c))
    start = head + 1
  }
  const { lines, total } = sectionLines(
    rows.slice(start).flatMap((r) => {
      const kind = (r[type] ?? '').toLowerCase()
      const turn = kind.startsWith('s')
        ? 0
        : kind.startsWith('l')
          ? 1
          : kind.startsWith('r')
            ? -1
            : NaN
      const rad = radius >= 0 ? Math.abs(Number(r[radius])) : NaN
      if (Number.isNaN(turn) || (turn !== 0 && !(rad > 0))) return []
      return [{ length: Number(r[length]), radius: rad, turn }]
    }),
  )
  if (lines.length === 0)
    return {
      kind: 'error',
      error:
        'No track found in this file. It can be an OptimumLap .OLTra track, a table with one row per section (Straight, Left or Right, its length in metres and the corner radius in metres), a table of x and y or latitude and longitude points, or a GPX, KML or GeoJSON outline.',
    }
  return {
    kind: 'segments',
    name: baseName(file),
    lines,
    closed: null,
    note: `Read ${lines.length} sections, ${total.toFixed(1)} m.`,
  }
}

function outline(
  file: string,
  a: number[],
  b: number[],
  geo: boolean,
  width: number | null,
  what: string,
  recorded = false,
): TrackFile {
  let x = a
  let y = b
  let origin: { lat: number; lon: number } | undefined
  if (geo) {
    const rad = Math.PI / 180
    origin = { lat: a[0], lon: b[0] }
    x = b.map((v) => (v - b[0]) * rad * EARTH_R * Math.cos(a[0] * rad))
    y = a.map((v) => (v - a[0]) * rad * EARTH_R)
  }
  const n = x.length
  let total = 0
  for (let i = 1; i < n; i++) total += Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1])
  const gap = Math.hypot(x[0] - x[n - 1], y[0] - y[n - 1])
  const closed = gap < Math.max(15, (4 * total) / (n - 1))
  return {
    kind: 'path',
    name: baseName(file),
    x,
    y,
    closed,
    width,
    origin,
    recorded,
    note: `Read ${n} ${what} points, ${(total + (closed ? gap : 0)).toFixed(0)} m, ${closed ? 'a closed loop' : 'open ended'}${width ? `, ${width.toFixed(1)} m wide on average` : ''}.`,
  }
}

export function parsePathTable(text: string, file = 'track.csv'): TrackFile | null {
  const rows = rowsOf(text)
  const head = rows.findIndex((r) => r.some((c) => /^(x|x_m|lat|latitude)$/i.test(c)))
  if (head < 0) return null
  const h = rows[head].map((c) => c.toLowerCase())
  const col = (re: RegExp) => h.findIndex((c) => re.test(c))
  const lat = col(/^lat(itude)?$/)
  const lon = col(/^(lon|lng|long|longitude)$/)
  const geo = lat >= 0 && lon >= 0
  const a = geo ? lat : col(/^x(_m)?$/)
  const b = geo ? lon : col(/^y(_m)?$/)
  if (a < 0 || b < 0) return null
  const right = col(/^w_tr_right(_m)?$/)
  const left = col(/^w_tr_left(_m)?$/)
  const whole = col(/^(width|width_m|track_width)$/)
  const pa: number[] = []
  const pb: number[] = []
  let wide = 0
  let wideCount = 0
  for (const r of rows.slice(head + 1)) {
    const va = Number(r[a])
    const vb = Number(r[b])
    if (r[a] === '' || r[b] === '' || !Number.isFinite(va) || !Number.isFinite(vb)) continue
    pa.push(va)
    pb.push(vb)
    const w =
      whole >= 0
        ? Number(r[whole])
        : right >= 0 && left >= 0
          ? Number(r[right]) + Number(r[left])
          : NaN
    if (w > 0) {
      wide += w
      wideCount++
    }
  }
  if (pa.length < 4) return null
  return outline(file, pa, pb, geo, wideCount ? wide / wideCount : null, geo ? 'GPS' : 'x/y')
}

function parseMarkup(text: string, file: string): TrackFile | null {
  const lat: number[] = []
  const lon: number[] = []
  const gpx = /<gpx[\s>]/i.test(text)
  if (gpx) {
    for (const m of text.matchAll(/<(?:trkpt|rtept)\b([^>]*)>/gi)) {
      const la = /\blat\s*=\s*["']([-+0-9.eE]+)["']/.exec(m[1])
      const lo = /\blon\s*=\s*["']([-+0-9.eE]+)["']/.exec(m[1])
      if (la && lo) {
        lat.push(Number(la[1]))
        lon.push(Number(lo[1]))
      }
    }
  } else if (/<kml[\s>]/i.test(text)) {
    let best = ''
    for (const m of text.matchAll(/<coordinates>([^<]*)<\/coordinates>/gi))
      if (m[1].length > best.length) best = m[1]
    for (const p of best.trim().split(/\s+/)) {
      const [lo, la] = p.split(',').map(Number)
      if (Number.isFinite(lo) && Number.isFinite(la)) {
        lat.push(la)
        lon.push(lo)
      }
    }
  } else if (/^\s*\{/.test(text)) {
    let longest: number[][] = []
    const walk = (v: unknown) => {
      if (Array.isArray(v)) {
        if (
          v.length > longest.length &&
          v.every((p) => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number')
        )
          longest = v as number[][]
        else v.forEach(walk)
      } else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    try {
      walk(JSON.parse(text))
    } catch {
      return null
    }
    for (const p of longest) {
      lon.push(p[0])
      lat.push(p[1])
    }
  } else return null
  const ok = lat.length >= 4 && lat.every((v, i) => Math.abs(v) <= 90 && Math.abs(lon[i]) <= 180)
  return ok ? outline(file, lat, lon, true, null, 'GPS', gpx) : null
}

export function readTrackFile(file: string, bytes: Uint8Array): TrackFile {
  const binary = bytes.subarray(0, 64).some((v) => v === 0)
  if (/\.oltra$/i.test(file) || binary) return parseOltra(bytes, file)
  const raw = new TextDecoder().decode(bytes)
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw
  return parseMarkup(text, file) ?? parsePathTable(text, file) ?? parseTrackTable(text, file)
}
