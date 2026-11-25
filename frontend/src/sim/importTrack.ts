import { readTrackFile } from '../analysis/sim/trackfile'
import { updateSim, type SimSettings } from '../state/sim'
import { pickFile } from '../state/storage'

export const RECORDED_SMOOTH_M = 3
const FILES = '.oltra,.csv,.tsv,.txt,.gpx,.kml,.json,.geojson'

export async function importTrack(settings: SimSettings): Promise<string> {
  const file = await pickFile(FILES)
  if (!file) return ''
  const read = readTrackFile(file.name, file.bytes)
  if (read.kind === 'error') return read.error
  if (read.kind === 'segments') {
    updateSim({
      track: 'custom',
      custom: [`# ${read.name} (imported from ${file.name})`, ...read.lines].join('\n'),
      customClosed: read.closed ?? settings.customClosed,
    })
    return read.closed === null
      ? `${read.note} Tick “Closed loop” if the end joins the start.`
      : read.note
  }
  updateSim({
    track: 'path',
    path: {
      name: read.name,
      source: `file ${file.name}`,
      closed: read.closed,
      x: read.x,
      y: read.y,
      origin: read.origin,
      ...(read.recorded ? { smooth: RECORDED_SMOOTH_M } : {}),
    },
    ...(read.width ? { lineWidth: Math.round(read.width * 10) / 10 } : {}),
  })
  return read.recorded
    ? `${read.note} A GPX file is a recorded drive, so the path is smoothed over ${RECORDED_SMOOTH_M} m; change “Smooth over” if that is wrong.`
    : read.note
}
