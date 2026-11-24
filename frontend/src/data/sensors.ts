import { useSyncExternalStore } from 'react'

export type Pos = [number, number]

const SPOTS: [RegExp, Pos, string][] = [
  [/damp.*fl|fl.*damp|shock.*fl|travel.*fl/i, [0.27, 0.26], 'front-left damper'],
  [/damp.*fr|fr.*damp|shock.*fr|travel.*fr/i, [0.73, 0.26], 'front-right damper'],
  [/damp.*rl|rl.*damp|shock.*rl|travel.*rl/i, [0.27, 0.75], 'rear-left damper'],
  [/damp.*rr|rr.*damp|shock.*rr|travel.*rr/i, [0.73, 0.75], 'rear-right damper'],
  [
    /^(acc(el)?[ _]?[xyz]|yaw|pitch|roll|gyro|imu)/i,
    [0.5, 0.47],
    'IMU (VectorNav, behind the seat)',
  ],
  [
    /^(pos(lat|long?|alt)|lat|lon|gps|heading|vel[nedxyz])/i,
    [0.5, 0.53],
    'GPS antenna (main hoop)',
  ],
  [/^fbps|brake.*f/i, [0.455, 0.2], 'front brake line (pedal box)'],
  [/^rbps|brake.*r/i, [0.545, 0.2], 'rear brake line (pedal box)'],
  [/^(str|steer)/i, [0.5, 0.32], 'steering column'],
  [/^tps|throttle/i, [0.5, 0.585], 'throttle body'],
  [/^rpm|crank|cam/i, [0.5, 0.645], 'engine (crank sensor)'],
  [/^gear/i, [0.5, 0.715], 'gearbox'],
  [/^oil.?t/i, [0.43, 0.68], 'engine oil (temperature)'],
  [/^oil/i, [0.57, 0.68], 'engine oil (pressure)'],
  [/^clt|coolant|ect/i, [0.44, 0.585], 'coolant outlet'],
  [/^rad/i, [0.25, 0.53], 'radiator (side pod)'],
  [/^(afr|lambda|o2|egt)/i, [0.67, 0.665], 'exhaust'],
  [/^(bat|volt)/i, [0.36, 0.6], 'battery'],
  [/^(map|iat|mat|baro|fuel|inj|ign|knock)/i, [0.56, 0.6], 'engine (ECU sensors)'],
  [/wheel.?speed.*f|^ws.?f|^fws/i, [0.17, 0.235], 'front wheel speed sensor'],
  [/wheel.?speed.*r|^ws.?r|^rws/i, [0.83, 0.78], 'rear wheel speed sensor'],
  [/^(vss|speed|wheel.?speed|ws_)/i, [0.83, 0.74], 'vehicle speed (rear wheel)'],
  [/^(time_|rx_|tx_)/i, [0.6, 0.44], 'data logger (ILTM)'],
]

export function defaultSpot(name: string): { pos: Pos; place: string } | null {
  for (const [re, pos, place] of SPOTS) if (re.test(name)) return { pos, place }
  return null
}

export function sensorPos(name: string, saved?: number[] | null): Pos | null {
  if (saved && saved.length === 2) return [saved[0], saved[1]]
  return defaultSpot(name)?.pos ?? null
}

export function placeOf(c: { name: string; pos?: number[] | null }): string {
  if (c.pos?.length === 2) return 'placed by the team'
  return defaultSpot(c.name)?.place ?? 'not on the car map yet'
}

let hovered: string | null = null
const listeners = new Set<() => void>()

export const hoverChannel = {
  get: () => hovered,
  set(id: string | null) {
    if (id === hovered) return
    hovered = id
    for (const fn of listeners) fn()
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  },
}

export const useHoveredChannel = () =>
  useSyncExternalStore(hoverChannel.subscribe, hoverChannel.get)
