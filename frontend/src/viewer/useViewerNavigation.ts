import { useEffect, useMemo, useRef, useState } from 'react'
import { buildOverlay } from '../analysis/overlay'
import type { Lap } from '../analysis/track'
import type { Session } from '../data/session'
import { createViewSync } from '../plot/sync'
import { distanceView, timeView } from './xview'

export interface LapSelection {
  keys: string[]
  refKey: string
}

export function useViewerNavigation(
  base: Session,
  laps: Lap[],
  distance: Float64Array | null,
  normalize: boolean,
) {
  const [selection, setSelection] = useState<LapSelection>({ keys: [], refKey: '' })
  const [overlayOn, setOverlayOn] = useState(false)
  const shown = useMemo(() => {
    const picked = laps.filter((l) => selection.keys.includes(l.key))
    const ref = picked.find((l) => l.key === selection.refKey) ?? picked[0]
    return ref ? [ref, ...picked.filter((l) => l !== ref)] : []
  }, [laps, selection])
  const overlay = useMemo(
    () =>
      overlayOn && distance && shown.length > 0
        ? buildOverlay(base.time, distance, shown, normalize)
        : null,
    [overlayOn, distance, shown, base.time, normalize],
  )

  const tView = useMemo(() => timeView(base.time, laps), [base.time, laps])
  const dView = useMemo(() => (overlay ? distanceView(overlay) : null), [overlay])
  const view = dView ?? tView
  const sync = useMemo(() => createViewSync(dView ? 'viewer-distance' : 'viewer-time'), [dView])

  const pendingZoom = useRef<Lap | null>(null)
  const pendingRange = useRef<{ min: number; max: number } | null>(null)
  useEffect(() => {
    const lap = pendingZoom.current
    const range = pendingRange.current
    pendingZoom.current = null
    pendingRange.current = null
    if (lap && view.mode === 'time') sync.setRange({ min: lap.t0, max: lap.t1 })
    else if (range && view.mode === 'time') sync.setRange(range)
    else sync.setRange({ min: view.bounds[0], max: view.bounds[1] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sync])

  const isLive = base.source === 'live'
  const [follow, setFollow] = useState(true)
  const ownRange = useRef(false)
  const liveEnd = useRef(0)
  const lastStart = useRef(0)
  useEffect(() => {
    if (!isLive || view.mode !== 'time') return
    const [b0, b1] = view.bounds
    liveEnd.current = b1
    const cur = sync.range()
    const fromStart = !cur || cur.min <= lastStart.current + 1e-6
    lastStart.current = b0
    if (!follow) return
    const span = cur ? Math.min(cur.max - cur.min, b1 - b0) : b1 - b0
    ownRange.current = true
    sync.setRange(fromStart ? { min: b0, max: b1 } : { min: Math.max(b0, b1 - span), max: b1 })
    ownRange.current = false
  }, [isLive, follow, view, sync])
  useEffect(() => {
    if (!isLive) return
    return sync.onRange((r) => {
      if (!ownRange.current && r.max < liveEnd.current - 0.25) setFollow(false)
    })
  }, [isLive, sync])

  const resetZoom = () => sync.setRange({ min: view.bounds[0], max: view.bounds[1] })
  const zoomTo = (min: number, max: number) => {
    if (view.mode === 'time') sync.setRange({ min, max })
    else {
      pendingRange.current = { min, max }
      setOverlayOn(false)
    }
  }
  const zoomLap = (lap: Lap) => {
    if (view.mode === 'time') sync.setRange({ min: lap.t0, max: lap.t1 })
    else {
      pendingZoom.current = lap
      setOverlayOn(false)
    }
  }

  return {
    selection,
    setSelection,
    overlayOn,
    setOverlayOn,
    dView,
    view,
    sync,
    follow,
    setFollow,
    resetZoom,
    zoomTo,
    zoomLap,
  }
}
