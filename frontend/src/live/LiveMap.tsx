import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { BentoSize } from '../state/liveBento'
import { formatLapTime, lowerBound, validFix } from '../analysis/track'
import { mountTrackMap } from '../plot/trackMap'
import { track, useTrack } from '../state/analysis'
import { toolbarButton, toolbarButtonActive } from '../ui'
import { onLiveFrame, store } from './connection'

const LAT = ['PosLat', 'Lat', 'Latitude']
const LON = ['PosLong', 'PosLon', 'Lon', 'Longitude']
const TRAIL_S = 120

const col = (names: string[]) => {
  for (const n of names) {
    const c = store.column(n)
    if (c) return c
  }
  return null
}

export function LiveMap({
  onClose,
  bento = false,
  startDrag,
  size,
  onSize,
}: {
  onClose: () => void
  bento?: boolean
  startDrag?: (event: DragEvent<HTMLElement>) => void
  size?: BentoSize
  onSize?: (size: BentoSize) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const curRef = useRef<HTMLSpanElement>(null)
  const lastRef = useRef<HTMLSpanElement>(null)
  const bestRef = useRef<HTMLSpanElement>(null)
  const [picking, setPicking] = useState(false)
  const pickRef = useRef(false)
  const { beacon } = useTrack()
  useEffect(() => {
    pickRef.current = picking
  }, [picking])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let doneT = -Infinity
    let lastCross = NaN
    let lastLap = NaN
    let bestLap = NaN
    let visitBest = Infinity
    let visitT = NaN
    let timedBeacon = track.get().beacon

    const lapTiming = () => {
      const b = track.get().beacon
      if (b !== timedBeacon) {
        timedBeacon = b
        doneT = -Infinity
        lastCross = lastLap = bestLap = NaN
      }
      const times = store.times()
      const lat = col(LAT)
      const lon = col(LON)
      if (!b || !lat || !lon) return
      const { radius, minLap } = track.get()
      const kx = Math.cos((b.lat * Math.PI) / 180) * 111320
      for (let i = lowerBound(times, doneT + 1e-9); i < times.length; i++) {
        doneT = times[i]
        if (!validFix(lat[i], lon[i])) continue
        const dx = (lon[i] - b.lon) * kx
        const dy = (lat[i] - b.lat) * 111320
        const d = Math.hypot(dx, dy)
        if (d <= radius) {
          if (d < visitBest) {
            visitBest = d
            visitT = times[i]
          }
        } else if (Number.isFinite(visitT)) {
          if (!Number.isFinite(lastCross) || visitT - lastCross >= minLap) {
            if (Number.isFinite(lastCross)) {
              lastLap = visitT - lastCross
              if (!Number.isFinite(bestLap) || lastLap < bestLap) bestLap = lastLap
            }
            lastCross = visitT
          }
          visitT = NaN
          visitBest = Infinity
        }
      }
    }

    const map = mountTrackMap(host, {
      follow: true,
      track: () => {
        const lat = col(LAT)
        const lon = col(LON)
        if (!lat || !lon) return { lat: [], lon: [], n: 0 }
        return { lat, lon, n: Math.min(lat.length, lon.length) }
      },
      highlights: () => {
        const times = store.times()
        const n = times.length
        if (n === 0) return []
        return [{ start: lowerBound(times, times[n - 1] - TRAIL_S), end: n - 1, slot: 0 }]
      },
      cursor: () => (store.length > 0 ? [{ i: store.length - 1, slot: 0 }] : []),
      beacon: () => track.get().beacon,
      pickActive: () => pickRef.current,
      onPick: (lat, lon) => {
        track.set({ ...track.get(), beacon: { lat, lon } })
        pickRef.current = false
        setPicking(false)
      },
    })

    const update = () => {
      const times = store.times()
      const now = times.length ? times[times.length - 1] : NaN
      if (curRef.current)
        curRef.current.textContent = Number.isFinite(lastCross)
          ? formatLapTime(now - lastCross)
          : '–'
      if (lastRef.current) lastRef.current.textContent = formatLapTime(lastLap)
      if (bestRef.current) bestRef.current.textContent = formatLapTime(bestLap)
      map.redraw()
    }
    lapTiming()
    update()
    const offTiming = store.subscribe(lapTiming)
    const off = onLiveFrame(update)
    const offTrack = track.subscribe(() => {
      lapTiming()
      update()
    })
    return () => {
      off()
      offTiming()
      offTrack()
      map.destroy()
    }
  }, [])

  return (
    <aside
      className={`flex min-h-0 flex-col border-l border-zinc-800 bg-zinc-950 ${bento ? 'h-full min-w-0 flex-1' : 'w-96 shrink-0'}`}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs">
        <span
          draggable={bento}
          onDragStart={startDrag}
          className={`text-zinc-500 ${bento ? 'cursor-grab' : ''}`}
        >
          Track
        </span>
        {bento && onSize && (
          <>
            <button
              type="button"
              aria-label="Toggle height track-map"
              aria-pressed={size?.height === 'tall'}
              className="rounded px-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() =>
                onSize({
                  width: size?.width ?? 'half',
                  height: size?.height === 'tall' ? 'short' : 'tall',
                })
              }
            >
              T
            </button>
            <button
              type="button"
              aria-label="Toggle width track-map"
              aria-pressed={size?.width === 'full'}
              className="rounded px-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              onClick={() =>
                onSize({
                  height: size?.height ?? 'short',
                  width: size?.width === 'full' ? 'half' : 'full',
                })
              }
            >
              W
            </button>
          </>
        )}
        <button
          type="button"
          className={picking ? toolbarButtonActive : toolbarButton}
          title="Click the track where the start/finish line is"
          onClick={() => setPicking((p) => !p)}
        >
          {picking ? 'Click the track…' : beacon ? 'Move start/finish' : 'Set start/finish'}
        </button>
        <button
          type="button"
          aria-label="Hide track map"
          className="ml-auto text-zinc-600 hover:text-zinc-200"
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="grid grid-cols-3 border-b border-zinc-800 text-center tabular-nums">
        {(
          [
            ['Current', curRef, 'text-zinc-100'],
            ['Last', lastRef, 'text-zinc-200'],
            ['Best', bestRef, 'text-fuchsia-400'],
          ] as const
        ).map(([label, ref, color]) => (
          <div key={label} className="py-1.5">
            <div className="text-[11px] tracking-wider text-zinc-500 uppercase">{label}</div>
            <span ref={ref} className={`text-lg font-semibold ${color}`}>
              –
            </span>
          </div>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="absolute inset-0 cursor-crosshair" />
      </div>
      <p className="border-t border-zinc-800 px-3 py-1 text-[11px] text-zinc-600">
        Last {TRAIL_S / 60} min highlighted. Wheel to zoom, drag to pan, double-click to fit.
      </p>
    </aside>
  )
}
