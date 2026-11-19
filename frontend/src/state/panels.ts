export const PANEL_TYPES = [
  ['time', 'Plot', 'Channels against time (or lap distance when overlaying)'],
  ['xy', 'XY', 'One channel against another, e.g. a G-G diagram'],
  ['histogram', 'Histogram', 'How much of the time a channel spends at each value'],
  ['map', 'Track map', 'GPS track coloured by a channel'],
  ['spectrum', 'Spectrum', 'Frequency content (FFT) of channels, e.g. dampers or accelerometers'],
  ['launch', 'Launch', 'Launches: acceleration against the traction-limit target, and wheel slip'],
  ['aero', 'Aero', 'Grip against speed, compared with what the tyres and the aero should give'],
] as const
export type PanelKind = (typeof PANEL_TYPES)[number][0]
export const isPanelKind = (value: unknown): value is PanelKind =>
  PANEL_TYPES.some(([kind]) => kind === value)
