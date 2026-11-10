import type { Beacon, SpeedUnit } from './track'

export type LapMode = 'loop' | 'gates' | 'launch' | 'manual'
export interface TrackSettings {
  lapMode?: LapMode
  finish?: Beacon | null
  runLength?: number
  beacon: Beacon | null
  radius: number
  minLap: number
  distance: 'auto' | 'gps' | 'speed'
  speedChannel: string
  speedUnit: SpeedUnit | 'auto'
  normalize: boolean
  fuse: boolean
}
