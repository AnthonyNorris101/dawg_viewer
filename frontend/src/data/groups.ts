const RULES: [RegExp, string][] = [
  [/^(acc(el)?[ _]?[xyz]|yaw|pitch|roll|gyro|imu)/i, 'Accelerometer'],
  [/^(pos(lat|long?|alt)|lat(itude)?|lon(g|gitude)?|gps|alt(itude)?|heading)/i, 'GPS'],
  [/(damp|shock|susp|travel|ride.?h|wheel.?pos)/i, 'Suspension'],
  [/^(fbps|rbps|brake|bps)/i, 'Brakes'],
  [/^(str|steer)/i, 'Driver'],
  [/^(vss|speed|wheel.?speed|ws_)/i, 'Vehicle'],
  [
    /^(rpm|tps|clt|oil|rad|afr|lambda|map|iat|mat|ect|fuel|inj|ign|gear|bat|volt|baro|knock|cam|crank|egt)/i,
    'Engine',
  ],
  [/^(time_|rx_|tx_)/i, 'Logger'],
]

export function defaultGroup(name: string): string | undefined {
  for (const [re, group] of RULES) if (re.test(name)) return group
  return undefined
}

export const GROUP_ORDER = [
  'Engine',
  'Vehicle',
  'Driver',
  'Brakes',
  'Accelerometer',
  'Suspension',
  'GPS',
  'Logger',
]

export function groupRank(group: string): number {
  const i = GROUP_ORDER.indexOf(group)
  if (i >= 0) return i
  if (group === 'Analysis') return 100
  if (group === 'Math') return 101
  return 50
}
