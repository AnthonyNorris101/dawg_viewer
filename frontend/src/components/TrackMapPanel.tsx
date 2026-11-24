import { memo, useEffect, useRef, useState, type Dispatch } from 'react'
import { rangeStats } from '../analysis/stats'
import type { Gps } from '../analysis/track'
import type { Session } from '../data/session'
import { RAMP_CSS } from '../plot/canvas'
import type { ViewSync } from '../plot/sync'
import { mountTrackMap } from '../plot/trackMap'
import { updateTrack, useTrack } from '../state/analysis'
import type { LayoutAction, Panel } from '../state/layout'
import { toolbarButton, toolbarButtonActive } from '../ui'
import type { XView } from '../viewer/xview'
import { ChannelSelect, PanelFrame } from './PanelFrame'

interface Props {
  panel: Panel
  index: number
  active: boolean
  session: Session
  gps: Gps | null
  view: XView
  sync: ViewSync
  dispatch: Dispatch<LayoutAction>
}

export const TrackMapPanel = memo(function TrackMapPanel({
  panel,
  index,
  active,
  session,
  gps,
  view,
  sync,
  dispatch,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const loRef = useRef<HTMLSpanElement>(null)
  const hiRef = useRef<HTMLSpanElement>(null)
  const { beacon } = useTrack()
  const [picking, setPicking] = useState(false)
  const pickRef = useRef(picking)
  const beaconRef = useRef(beacon)

  const colorId = panel.channelIds[0] ?? ''
  const colorCh = session.byId.get(colorId)
  const redrawRef = useRef<() => void>(() => {})

  useEffect(() => {
    const host = hostRef.current
    if (!host || !gps) return
    let cursorIdx: number | null = null
    let colorRange = { lo: 0, hi: 1 }
    const map = mountTrackMap(host, {
      track: () => ({ lat: gps.lat, lon: gps.lon, n: gps.lat.length }),
      highlights: () => {
        const sets = view.visible(sync.range())
        if (colorCh) {
          let lo = Infinity
          let hi = -Infinity
          for (const s of sets) {
            const st = rangeStats(colorCh.data, s.start, s.end)
            if (st.count === 0) continue
            lo = Math.min(lo, st.min)
            hi = Math.max(hi, st.max)
          }
          colorRange = Number.isFinite(lo) ? { lo, hi } : { lo: 0, hi: 1 }
          const p = colorCh.precision
          if (loRef.current) loRef.current.textContent = colorRange.lo.toFixed(p)
          if (hiRef.current) hiRef.current.textContent = colorRange.hi.toFixed(p)
        }
        return sets
      },
      color: () =>
        colorCh && view.slots.length === 1 ? { data: colorCh.data, ...colorRange } : null,
      cursor: () =>
        cursorIdx == null ? [] : view.samplesAt(cursorIdx).map((i, slot) => ({ i, slot })),
      beacon: () => beaconRef.current,
      pickActive: () => pickRef.current,
      onPick: (lat, lon) => {
        updateTrack({ beacon: { lat, lon } })
        setPicking(false)
      },
    })
    redrawRef.current = map.redraw
    const offRange = sync.onRange(map.redraw)
    const offCursor = sync.onCursor((idx) => {
      cursorIdx = idx
      map.redrawCursor()
    })
    return () => {
      offRange()
      offCursor()
      map.destroy()
      redrawRef.current = () => {}
    }
  }, [gps, colorCh, view, sync])

  useEffect(() => {
    pickRef.current = picking
    beaconRef.current = beacon
    redrawRef.current()
  }, [beacon, picking])

  return (
    <PanelFrame
      panel={panel}
      active={active}
      dispatch={dispatch}
      title={`Track ${index + 1}`}
      legend={
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <ChannelSelect
            label="Colour"
            value={colorId}
            channels={session.channels}
            allowNone={view.slots.length > 1 ? 'By lap' : 'None'}
            onChange={(v) =>
              dispatch({ type: 'setPanel', panelId: panel.id, patch: { channelIds: v ? [v] : [] } })
            }
          />
          {colorCh && view.slots.length === 1 && (
            <span className="flex items-center gap-1 text-zinc-500 tabular-nums">
              <span ref={loRef} />
              <span className="h-2 w-16 rounded-sm" style={{ background: RAMP_CSS }} />
              <span ref={hiRef} />
            </span>
          )}
          {gps && (
            <button
              type="button"
              className={picking ? toolbarButtonActive : toolbarButton}
              title="Click the track where the start/finish line is; laps are timed from there"
              onClick={() => setPicking((p) => !p)}
            >
              {picking ? 'Click the track…' : beacon ? 'Move start/finish' : 'Set start/finish'}
            </button>
          )}
        </div>
      }
    >
      {gps ? (
        <div ref={hostRef} className="absolute inset-0 cursor-crosshair" />
      ) : (
        <p className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-zinc-600">
          This log has no GPS position (PosLat / PosLong)
        </p>
      )}
    </PanelFrame>
  )
})
