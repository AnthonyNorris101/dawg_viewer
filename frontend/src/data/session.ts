export interface Channel {
  id: string
  name: string
  label?: string
  group: string
  unit: string
  color: string
  precision: number
  data: Float64Array
}

export interface Session {
  name: string
  path: string
  source?: string
  note: string
  sampleRate: number
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

export const channelTitle = (c: Pick<Channel, 'name' | 'label'>) => c.label || c.name
