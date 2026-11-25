import { describe, expect, it } from 'vitest'
import { parseSegments } from './simtrack'
import { parseOltra, readTrackFile } from './trackfile'

const text = (s: string) => new TextEncoder().encode(s)

function oltra(kind: string, rows: [number, number, number][]) {
  const out: number[] = [1]
  const str = (s: string) => {
    const b = text(s)
    out.push(b.length, ...b)
  }
  const array = (values: number[]) => {
    const buf = new DataView(new ArrayBuffer(4 + 8 * values.length))
    buf.setInt32(0, values.length, true)
    values.forEach((v, i) => buf.setFloat64(4 + 8 * i, v, true))
    out.push(...new Uint8Array(buf.buffer))
  }
  for (const s of [
    '1.0.5',
    '2026-01-02',
    '2026-01-03',
    'guid-1234',
    'Test Circuit',
    kind,
    'Clockwise',
    'Permanent',
  ])
    str(s)
  out.push(0, 0, 0, 0, 0, 0, 0, 0)
  str('')
  str('USA')
  str('Athens')
  out.push(0, 0, 0, 0)
  for (const c of [0, 1, 2]) array(rows.map((r) => r[c]))
  out.push(9, 9, 9)
  return new Uint8Array(out)
}

describe('track files', () => {
  it('reads an OptimumLap track', () => {
    const r = readTrackFile(
      'Test.OLTra',
      oltra('Closed Circuit', [
        [60, 0, 0],
        [37.699, 12, 1],
        [20, 15.5, -1],
      ]),
    )
    expect(r.kind).toBe('segments')
    if (r.kind !== 'segments') return
    expect(r.name).toBe('Test Circuit')
    expect(r.closed).toBe(true)
    expect(r.lines).toEqual(['straight 60', 'left 12 37.699', 'right 15.5 20'])
    expect(parseSegments(r.lines.join('\n')).errors).toEqual([])
    expect(r.note).toContain('117.7 m')
    const open = parseOltra(oltra('Open Circuit', [[75, 0, 0]]))
    expect(open.kind === 'segments' && open.closed).toBe(false)
    expect(parseOltra(text('not a track at all')).kind).toBe('error')
    expect(parseOltra(oltra('Closed Circuit', [[10, 0, 1]])).kind).toBe('error')
  })

  it('reads a table of sections', () => {
    const r = readTrackFile(
      'course.csv',
      text(
        'Type,Section Length,Corner Radius\nStraight,60,0\nLeft,37.7,12\nStraight,60,\nRight,20,-15\nBogus,1,1',
      ),
    )
    expect(r.kind === 'segments' && r.lines).toEqual([
      'straight 60',
      'left 12 37.7',
      'straight 60',
      'right 15 20',
    ])
    const bare = readTrackFile('course.txt', text('Straight\t60\nLeft\t10\t9'))
    expect(bare.kind === 'segments' && bare.lines).toEqual(['straight 60', 'left 9 10'])
    expect(readTrackFile('x.csv', text('hello')).kind).toBe('error')
  })

  it('reads outlines given as points', () => {
    const ring = Array.from({ length: 40 }, (_, i) => {
      const a = (2 * Math.PI * i) / 40
      return [100 * Math.cos(a), 100 * Math.sin(a)]
    })
    const xy = readTrackFile(
      'ring.csv',
      text(
        '# x_m,y_m,w_tr_right_m,w_tr_left_m\n' + ring.map((p) => `${p[0]},${p[1]},5,6`).join('\n'),
      ),
    )
    expect(xy.kind).toBe('path')
    if (xy.kind !== 'path') return
    expect(xy.closed).toBe(true)
    expect(xy.width).toBeCloseTo(11, 6)
    expect(xy.x.length).toBe(40)
    expect(xy.origin).toBeUndefined()

    const geo = ring.map((p) => [33.95 + p[1] / 111195, -83.37 + p[0] / 92000])
    const gpx = readTrackFile(
      'ring.gpx',
      text(
        `<gpx><trk><trkseg>${geo
          .slice(0, 30)
          .map((p) => `<trkpt lat="${p[0]}" lon="${p[1]}"/>`)
          .join('')}</trkseg></trk></gpx>`,
      ),
    )
    expect(gpx.kind === 'path' && gpx.closed).toBe(false)
    expect(gpx.kind === 'path' && gpx.origin).toEqual({ lat: geo[0][0], lon: geo[0][1] })
    const kml = readTrackFile(
      'ring.kml',
      text(
        `<kml><Placemark><LineString><coordinates>${geo.map((p) => `${p[1]},${p[0]},0`).join(' ')}</coordinates></LineString></Placemark></kml>`,
      ),
    )
    expect(kml.kind === 'path' && kml.x.length).toBe(40)
    const json = readTrackFile(
      'ring.geojson',
      text(
        JSON.stringify({
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: geo.map((p) => [p[1], p[0]]) },
        }),
      ),
    )
    expect(json.kind === 'path' && Math.hypot(json.x[10], json.y[10])).toBeGreaterThan(50)
    const table = readTrackFile(
      'ring.csv',
      text('Latitude,Longitude\n' + geo.map((p) => p.join(',')).join('\n')),
    )
    expect(table.kind === 'path' && table.origin?.lat).toBeCloseTo(33.95, 6)
  })
})
