import { useMemo } from 'react'
import { useCar } from '../data/car'
import { useTrack } from '../state/analysis'
import { useSim } from '../state/sim'
import type { Analysis } from './analysis'
import { simChannels } from './simChannels'

export function useSimChannels(analysis: Analysis): Analysis {
  const car = useCar()
  const { channels: on, curvature, smooth } = useSim()
  const loop = (useTrack().lapMode ?? 'loop') === 'loop'
  const { distance, gps, laps, session } = analysis
  const extra = useMemo(
    () =>
      on && !session.simulated
        ? simChannels(session, distance, gps, laps, car, { source: curvature, smooth }, loop)
        : [],
    [on, session, distance, gps, laps, car, curvature, smooth, loop],
  )
  return useMemo(() => {
    const fresh = extra.filter((c) => !session.byId.has(c.id))
    if (fresh.length === 0) return analysis
    const channels = [...session.channels, ...fresh]
    return {
      ...analysis,
      session: { ...session, channels, byId: new Map(channels.map((c) => [c.id, c])) },
    }
  }, [analysis, session, extra])
}
