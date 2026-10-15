export interface Channel {
  id: string
  name: string
  group: string
  unit: string
  color: string
  /** Decimal places shown in cursor readouts. */
  precision: number
  /** One sample per entry of Session.time. */
  data: Float32Array
}

export interface Session {
  name: string
  sampleRate: number
  /** Seconds since the start of the log, shared by every channel. */
  time: Float64Array
  channels: Channel[]
  byId: Map<string, Channel>
}

export const CHANNEL_COLORS = [
  '#f87171',
  '#60a5fa',
  '#34d399',
  '#fbbf24',
  '#c084fc',
  '#22d3ee',
  '#fb923c',
  '#a3e635',
  '#f472b6',
  '#94a3b8',
]
