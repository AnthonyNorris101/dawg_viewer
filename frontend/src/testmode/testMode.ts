import type { Row } from '../../bindings/dawg_viewer/internal/live/models'
import { calFn } from '../data/calibration'
import type { Session } from '../data/session'
import { channels, emptyStatus, info, refresh, status, store, testMode } from '../live/connection'
import { sessionFromColumns } from '../data/columns'
import { CHANNELS, liveCar, sampleLog } from './sim'

export const TEST_LOG_PATH = 'test-mode://sample-outing'
const RATE = 50
const RAW = new Set(CHANNELS.filter((c) => c.raw).map((c) => c.name))

let timer = 0
let statusTimer = 0

function converters() {
  const cals = info.get()?.calibrations ?? {}
  const out = new Map<string, (raw: number) => number>()
  for (const name of RAW) {
    const fn = calFn(cals[name])
    if (fn) out.set(name, fn)
  }
  return out
}

export function startTestMode() {
  if (testMode.get()) return
  testMode.set(true)
  store.reset()
  const car = liveCar()
  const started = Date.now()
  let simT = 0
  let packets = 0
  const metas = info.get()?.channels ?? {}
  channels.set([
    ...CHANNELS.map((c) => ({ name: c.name, id: c.id, meta: metas[c.name] ?? { order: 0 } })),
    { name: 'Time_tx', id: 0, meta: { order: 0 } },
  ])
  const pushStatus = () =>
    status.set({
      ...emptyStatus(),
      profile: 'test-mode',
      profileName: 'Test mode',
      state: 'receiving',
      deviceSource: 'test',
      packets,
      packetRate: RATE,
      lastPacketMs: 20,
      filtering: true,
      startedAt: started,
      timing: 'device',
    })
  pushStatus()

  timer = window.setInterval(() => {
    const now = (Date.now() - started) / 1000
    const conv = converters()
    const rows: Row[] = []
    while (simT + 1 / RATE <= now) {
      let sample: Record<string, number> = {}
      for (let k = 0; k < 2; k++) sample = car.step(1 / (RATE * 2))
      const v: Record<string, number> = {}
      for (const [name, raw] of Object.entries(sample)) v[name] = conv.get(name)?.(raw) ?? raw
      simT += 1 / RATE
      v.Time_tx = simT * 1000
      rows.push({ t: simT, v })
      packets++
    }
    if (rows.length) store.append(rows)
  }, 50)
  statusTimer = window.setInterval(pushStatus, 500)
}

export function stopTestMode() {
  if (!testMode.get()) return
  window.clearInterval(timer)
  window.clearInterval(statusTimer)
  testMode.set(false)
  store.reset()
  status.set(emptyStatus())
  channels.set([])
  void refresh()
}

let sample: ReturnType<typeof sampleLog> | null = null

export function testSession(): Session {
  sample ??= sampleLog()
  const conv = converters()
  const data = new Float64Array(sample.buffer.slice(0))
  const n = sample.rows
  sample.channels.forEach((c, i) => {
    const fn = conv.get(c.name)
    if (!fn) return
    const col = data.subarray((i + 1) * n, (i + 2) * n)
    for (let k = 0; k < n; k++) col[k] = fn(col[k])
  })
  return sessionFromColumns(
    data.buffer,
    n,
    sample.channels,
    {
      name: 'Test outing (simulated car)',
      path: TEST_LOG_PATH,
      source: 'wide',
      note: 'made-up data from test mode',
    },
    info.get()?.channels ?? {},
  )
}
