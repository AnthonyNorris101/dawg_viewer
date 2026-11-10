import { useMemo, useState } from 'react'
import type { Calibration } from '../../bindings/dawg_viewer/internal/config/models'
import type { Session } from '../data/session'
import { applyCal, inverter } from '../data/calibration'

export function useRecalibration(
  loaded: Session,
  setNotice: (message: string) => void,
  onReload?: () => void,
) {
  const [recal, setRecal] = useState<{ session: Session; data: Map<string, Float64Array> } | null>(
    null,
  )
  const base = useMemo(() => {
    if (!recal || recal.session !== loaded) return loaded
    const channels = loaded.channels.map((c) => {
      const data = recal.data.get(c.id)
      return data ? { ...c, data } : c
    })
    return { ...loaded, channels, byId: new Map(channels.map((c) => [c.id, c])) }
  }, [loaded, recal])
  const recalibrate = (
    id: string | null,
    before: Calibration | undefined,
    after: Calibration | null,
  ) => {
    const ch = id ? base.byId.get(id) : undefined
    if (!id || !ch) return
    if (base.source !== 'wide') {
      onReload?.()
      return
    }
    const inv = inverter(before)
    if (!inv) {
      setNotice(`Saved. Reopen the original .bin log to see ${id} with the new calibration.`)
      return
    }
    const data = ch.data.map((v) => applyCal(inv(v) ?? NaN, after))
    setRecal((r) => ({
      session: loaded,
      data: new Map([...(r && r.session === loaded ? r.data : []), [id, data]]),
    }))
    setNotice(`Recalibrated ${id} in this log`)
  }

  return { base, recalibrate }
}
