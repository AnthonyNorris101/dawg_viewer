import { useEffect, useState } from 'react'
import type { Track as FoundTrack } from '../../bindings/dawg_viewer/internal/tracks/models'
import { LiveService, type SavedTrack } from '../../bindings/dawg_viewer/services'
import { fromLatLon } from '../analysis/sim/raceline'
import { validFix } from '../analysis/track'
import { useInfo } from '../live/connection'
import {
  DEFAULT_LINE_ROOM,
  DEFAULT_LINE_WIDTH,
  updateSim,
  type PathTrack,
  type SimSettings,
} from '../state/sim'
import { toolbarButton } from '../ui'
import { NumberInput } from './common'
import { field, num, type SimLog } from './shared'
import { canSaveTrack, openTrackFile, parseTrackFile, trackToSave } from './trackLibrary'
import type { SimLap } from './useSimLap'

const OSM_CREDIT = '© OpenStreetMap contributors'

function pathFromFound(found: FoundTrack): PathTrack | null {
  const lat = found.lat ?? []
  const lon = found.lon ?? []
  if (lat.length < 3 || lat.length !== lon.length) return null
  return {
    name: found.name || 'Unnamed track',
    source: `OpenStreetMap${found.place ? ` · ${found.place}` : ''}`,
    closed: found.closed,
    ...fromLatLon(lat, lon),
  }
}

export function TrackSearch({ log, settings }: { log: SimLog | null; settings: SimSettings }) {
  const allowed = useInfo()?.trackSearch
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [found, setFound] = useState<FoundTrack[]>([])

  const gps = log?.inputs?.gps ?? null
  let here: { lat: number; lon: number } | null = null
  if (gps)
    for (let i = 0; i < gps.lat.length && !here; i++)
      if (validFix(gps.lat[i], gps.lon[i])) here = { lat: gps.lat[i], lon: gps.lon[i] }

  const run = async (ask: () => Promise<FoundTrack[] | null>, nothing: string) => {
    setBusy(true)
    setNote('')
    try {
      const got = (await ask()) ?? []
      setFound(got)
      setNote(
        got.length ? '' : `${nothing} Only tracks drawn in OpenStreetMap as race tracks show up.`,
      )
    } catch (e) {
      setFound([])
      setNote(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(false)
    }
  }

  const path = settings.path
  return (
    <div className="space-y-2">
      <p className="text-zinc-400">
        {path ? (
          <>
            Outline in use: <span className="text-zinc-200">{path.name}</span> ({path.source}).
          </>
        ) : (
          'No outline yet.'
        )}{' '}
        An outline is the middle of the road as a string of points: from a file (x and y in metres,
        latitude and longitude, GPX, KML or GeoJSON) or from OpenStreetMap.
      </p>
      {allowed?.online === false ? (
        <p className="text-zinc-500">
          Online lookups are turned off in settings.yaml (track_search).
        </p>
      ) : (
        <>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (!busy && allowed?.byName && query.trim())
                void run(
                  () => LiveService.FindTracks(query),
                  `No race track found at “${query.trim()}”.`,
                )
            }}
          >
            <input
              aria-label="Track or place to search for"
              className={`${field} w-64`}
              placeholder="Track or place name"
              value={query}
              disabled={!allowed?.byName}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="submit"
              className={toolbarButton}
              disabled={busy || !allowed?.byName || !query.trim()}
            >
              Search by name
            </button>
            <button
              type="button"
              className={toolbarButton}
              disabled={busy || !here}
              title={
                here
                  ? 'Sends the position of the open log to an OpenStreetMap server and lists the race tracks mapped within 3 km'
                  : 'Open a log with GPS in the Viewer first'
              }
              onClick={() =>
                here &&
                void run(
                  () => LiveService.TracksNear(here.lat, here.lon),
                  'No race track is mapped within 3 km of this log.',
                )
              }
            >
              Search around the open log
            </button>
            {busy && <span className="text-zinc-500">Asking OpenStreetMap…</span>}
          </form>
          {!allowed?.byName && (
            <p className="text-zinc-500">
              Searching by name is off until the team sets a geocoder under track_search in
              settings.yaml. The public one (OpenStreetMap’s Nominatim) has a usage policy to read
              and agree to first; the Configuration page of the docs explains it.
            </p>
          )}
          <p className="text-xs text-zinc-500">
            A search runs only when you press a button. It sends what you typed, or the log’s
            position, to public OpenStreetMap servers and keeps the answer in the config folder
            (track-search/).
          </p>
        </>
      )}
      {note && <p className="text-amber-300">{note}</p>}
      {found.length > 0 && (
        <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
          {found.map((f, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 px-2 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="text-zinc-200">{f.name || 'Unnamed track'}</span>{' '}
                <span className="text-zinc-500 tabular-nums">
                  {num(f.length, 0)} m, {f.closed ? 'closed loop' : 'open ended'}
                  {f.place ? ` · ${f.place}` : ''}
                </span>
              </span>
              <button
                type="button"
                className={toolbarButton}
                onClick={() => {
                  const next = pathFromFound(f)
                  if (next) updateSim({ track: 'path', path: next })
                }}
              >
                Use this track
              </button>
            </li>
          ))}
          <li className="px-2 py-1 text-xs text-zinc-500">
            {OSM_CREDIT}. Outlines are traced by hand from aerial photos, so corner radii are
            approximate, and a circuit with several layouts may come back in pieces.
          </li>
        </ul>
      )}
    </div>
  )
}

export function LineControls({ settings, data }: { settings: SimSettings; data: SimLap }) {
  const driven = settings.track === 'log'
  return (
    <div className="space-y-1 border-t border-zinc-800 pt-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-zinc-300">
          <input
            type="checkbox"
            checked={!!settings.line}
            onChange={(e) => updateSim({ line: e.target.checked })}
          />
          Work out the ideal line
        </label>
        {settings.line &&
          (driven ? (
            <label
              className="flex items-center gap-1.5 text-zinc-400"
              title="How far the car's centre may move to either side of the line the driver took on this lap"
            >
              Room either side of the driven line
              <NumberInput
                label="Room either side of the driven line in metres"
                min={0}
                max={25}
                step={0.25}
                className={`${field} w-20`}
                value={settings.lineRoom ?? DEFAULT_LINE_ROOM}
                onCommit={(v) => updateSim({ lineRoom: v })}
              />
              m
            </label>
          ) : (
            <label
              className="flex items-center gap-1.5 text-zinc-400"
              title="Usable width of the track, cone to cone or kerb to kerb. You set this; it is not read from the track."
            >
              Track width
              <NumberInput
                label="Track width in metres"
                min={0.5}
                max={50}
                step={0.5}
                className={`${field} w-20`}
                value={settings.lineWidth ?? DEFAULT_LINE_WIDTH}
                onCommit={(v) => updateSim({ lineWidth: v })}
              />
              m
              <span className="text-zinc-500">
                (car {num(data.carWidth, 2)} m wide, so its centre can move ±
                {num(
                  Math.max(0, ((settings.lineWidth ?? DEFAULT_LINE_WIDTH) - data.carWidth) / 2),
                  2,
                )}{' '}
                m)
              </span>
            </label>
          ))}
      </div>
      {settings.line && data.lineNote && <p className="text-amber-300">{data.lineNote}</p>}
    </div>
  )
}

const said = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function SavedTracks({
  log,
  settings,
  data,
}: {
  log: SimLog | null
  settings: SimSettings
  data: SimLap
}) {
  const [list, setList] = useState<SavedTrack[]>([])
  const [name, setName] = useState('')
  const [confirm, setConfirm] = useState('')
  const [picked, setPicked] = useState('')
  const [note, setNote] = useState('')

  const refresh = async () => {
    try {
      setList((await LiveService.SavedTracks()) ?? [])
    } catch (e) {
      setNote(`Couldn’t list the saved tracks: ${said(e)}`)
    }
  }

  useEffect(() => {
    let live = true
    LiveService.SavedTracks()
      .then((l) => live && setList(l ?? []))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const open = async (which: string) => {
    setPicked(which)
    setConfirm('')
    if (!which) return
    try {
      const file = parseTrackFile(await LiveService.LoadTrack(which))
      if (!file) {
        setNote(`“${which}” is not a track saved by Dawg Viewer.`)
        return
      }
      openTrackFile(file)
      setNote(`Opened “${which}”${file.source ? ` (${file.source})` : ''}.`)
    } catch (e) {
      setNote(`Couldn’t open “${which}”: ${said(e)}`)
    }
  }

  const canSave = canSaveTrack(settings, data.track)
  const taken = list.some((t) => t.name.toLowerCase() === name.trim().toLowerCase())
  const save = async () => {
    const file = trackToSave(name, settings, data.track, log?.name)
    if (!file) return
    try {
      const saved = await LiveService.SaveTrack(name, JSON.stringify(file))
      setName('')
      setPicked(saved.name)
      setNote(`Saved “${saved.name}” to the tracks folder.`)
      await refresh()
    } catch (e) {
      setNote(`Couldn’t save: ${said(e)}`)
    }
  }

  const remove = async () => {
    if (!picked) return
    if (confirm !== picked) {
      setConfirm(picked)
      return
    }
    setConfirm('')
    try {
      await LiveService.DeleteTrack(picked)
      setNote(`Deleted “${picked}”.`)
      setPicked('')
      await refresh()
    } catch (e) {
      setNote(`Couldn’t delete: ${said(e)}`)
    }
  }

  return (
    <div className="space-y-1 border-t border-zinc-800 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-zinc-400">
          Saved tracks
          <select
            aria-label="Saved tracks"
            className={field}
            value={picked}
            onChange={(e) => void open(e.target.value)}
          >
            <option value="">{list.length ? 'Open a saved track…' : 'None saved yet'}</option>
            {list.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {picked && (
          <button
            type="button"
            className={toolbarButton}
            aria-label={`Delete saved track ${picked}`}
            onClick={() => void remove()}
          >
            {confirm === picked ? 'Really delete?' : 'Delete'}
          </button>
        )}
        <form
          className="ml-auto flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSave && name.trim()) void save()
          }}
        >
          <input
            aria-label="Name to save this track as"
            className={`${field} w-56`}
            placeholder={canSave ? 'Name for this track' : 'Nothing to save on this track'}
            value={name}
            maxLength={80}
            disabled={!canSave}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            type="submit"
            className={toolbarButton}
            disabled={!canSave || !name.trim()}
            title={
              settings.track === 'log'
                ? 'Saves the path the GPS recorded on this lap as a track outline, so it can be simulated later without the log. It is the line that was driven, not the middle of the track.'
                : 'Saves this track, with its width, as a file in the tracks folder of the config folder'
            }
          >
            {taken ? 'Replace saved track' : 'Save track'}
          </button>
        </form>
      </div>
      {note && <p className="text-zinc-400">{note}</p>}
    </div>
  )
}
