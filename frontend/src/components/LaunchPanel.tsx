import { memo, useEffect, useMemo, useRef, useState, type Dispatch } from 'react'
import type uPlot from 'uplot'
import {
  wheelSpeedFromRpm,
  findLaunches,
  manualLaunch,
  G,
  slipAt,
  speedFromDistance,
  accelSign,
  type Launch,
} from '../analysis/launch'
import { findSpeed, formatLapTime, guessSpeedUnit, TO_MPS, type Gps } from '../analysis/track'
import { channelTitle, type Channel, type Session } from '../data/session'
import { SLOT_COLORS } from '../plot/canvas'
import { mountPlot, type MountedPlot } from '../plot/mountPlot'
import { createViewSync } from '../plot/sync'
import { launchTargetG, tractionLimitG, useCar, type CarSpecs } from '../data/car'
import { setLaunchMarks, updateLaunch, useLaunch, useLaunchMarks } from '../state/analysis'
import { LiveService } from '../../bindings/dawg_viewer/services'
import { info } from '../live/connection'
import type { LayoutAction, Panel } from '../state/layout'
import { ChannelSelect, PanelFrame, PlotTools } from './PanelFrame'

interface Props {
  panel: Panel
  index: number
  active: boolean
  session: Session
  gps: Gps | null
  distance: Float64Array | null
  distanceFromGps: boolean
  dispatch: Dispatch<LayoutAction>
  onZoom: (t0: number, t1: number) => void
  cursorTime?: () => number | null
  viewRange?: () => { min: number; max: number } | null
}

const MAX_LAUNCHES = 8
const NO_MARKS: [number, number][] = []
const REAR_WHEEL = /wheel.?speed.?(rear|r[lr]?\b)|^ws.?r|^rws/i
const FRONT_WHEEL = /wheel.?speed.?(front|f[lr]?\b)|^ws.?f|^fws/i
const RPM_SOURCE = '__rpm'
const STEP = 0.02
const NO_VALUE = '–'

const toMps = (c: Channel) => {
  const k = TO_MPS[guessSpeedUnit(c.unit)]
  return Float64Array.from(c.data, (v) => v * k)
}

function resample(time: ArrayLike<number>, data: ArrayLike<number>, start: number, grid: number[]) {
  const out: (number | null)[] = []
  const t0 = time[start]
  let i = start
  for (const x of grid) {
    const t = t0 + x
    while (i + 1 < time.length && time[i + 1] <= t) i++
    if (i + 1 >= time.length) {
      out.push(null)
      continue
    }
    const f = (t - time[i]) / (time[i + 1] - time[i] || 1)
    const v = data[i] + (data[i + 1] - data[i]) * f
    out.push(Number.isFinite(v) ? v : null)
  }
  return out
}

function bandPlugin(lo: number, hi: number): uPlot.Plugin {
  return {
    hooks: {
      drawClear(u) {
        const sc = u.scales['%']
        if (!sc || sc.min == null) return
        const { left, width } = u.bbox
        const y1 = u.valToPos(hi * 100, '%', true)
        const y0 = u.valToPos(lo * 100, '%', true)
        u.ctx.save()
        u.ctx.fillStyle = 'rgba(52, 211, 153, 0.10)'
        u.ctx.fillRect(left, Math.min(y0, y1), width, Math.abs(y0 - y1))
        u.ctx.restore()
      },
    },
  }
}

const num = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : NO_VALUE)

export const LaunchPanel = memo(function LaunchPanel({
  panel,
  index,
  active,
  session,
  gps,
  distance,
  distanceFromGps,
  dispatch,
  onZoom,
  cursorTime,
  viewRange,
}: Props) {
  const s = useLaunch()
  const hostRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<MountedPlot | null>(null)
  const cursorEl = useRef<HTMLSpanElement>(null)
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const car = useCar()

  const ch = (name: string) => session.byId.get(name)
  const rearWheel = session.channels.find((c) => REAR_WHEEL.test(c.name))
  const frontWheel = session.channels.find((c) => FRONT_WHEEL.test(c.name))
  const fromRpm = s.driven === RPM_SOURCE || (!s.driven && !rearWheel && !!session.byId.get('RPM'))
  const drivenCh = fromRpm
    ? undefined
    : (s.driven ? session.byId.get(s.driven) : rearWheel) || undefined
  const gearCh = ch('GearRaw') ?? ch('Gear')
  const groundCh = s.ground ? session.byId.get(s.ground) : frontWheel
  const accelCh = ch('AccelX')
  const rpmCh = ch('RPM')
  const tpsCh = ch('TPS1')

  const inputs = useMemo(() => {
    const { time } = session
    let ground: Float64Array | null = null
    let groundLabel = ''
    if (groundCh) {
      ground = toMps(groundCh)
      groundLabel = channelTitle(groundCh)
    } else if (gps && distance && distanceFromGps) {
      ground = speedFromDistance(time, distance)
      groundLabel = 'GPS'
    } else {
      const sp = findSpeed(session.channels)
      if (sp) {
        ground = toMps(sp)
        groundLabel = channelTitle(sp)
      }
    }
    const driven =
      fromRpm && rpmCh
        ? wheelSpeedFromRpm(rpmCh.data, gearCh?.data, {
            primary: car.primary,
            finalDrive: car.finalDrive,
            tireRadius: car.tireRadius,
            gears: car.gears,
            launchGear: car.launchGear,
          })
        : drivenCh && drivenCh !== groundCh && groundLabel !== channelTitle(drivenCh)
          ? toMps(drivenCh)
          : undefined
    const drivenLabel = fromRpm
      ? `RPM and gearing${gearCh ? ` (${channelTitle(gearCh)})` : ` (gear ${car.launchGear})`}`
      : drivenCh
        ? channelTitle(drivenCh)
        : ''
    const accel = accelCh?.data
    const sp = findSpeed(session.channels)
    const still = sp ? toMps(sp) : (ground ?? undefined)
    return { time, ground, groundLabel, driven, drivenLabel, accel, still }
  }, [
    session,
    groundCh,
    drivenCh,
    accelCh,
    gps,
    distance,
    distanceFromGps,
    fromRpm,
    rpmCh,
    gearCh,
    car.primary,
    car.finalDrive,
    car.tireRadius,
    car.gears,
    car.launchGear,
  ])

  const marks = useLaunchMarks()[session.path] ?? NO_MARKS
  const launches = useMemo<Launch[]>(() => {
    if (!inputs.ground) return []
    const inp = {
      time: inputs.time,
      ground: inputs.ground,
      still: inputs.still,
      driven: inputs.driven,
      accel: inputs.accel,
      rpm: rpmCh?.data,
      throttle: tpsCh?.data,
      window: s.window,
    }
    const mine = marks.flatMap(([a, b], mark) => {
      const l = manualLaunch(inp, a, b)
      return l ? [{ ...l, mark }] : []
    })
    return [...mine, ...findLaunches(inp).slice(0, 24)]
  }, [inputs, rpmCh, tpsCh, s.window, marks])
  const [fromText, setFromText] = useState('')
  const [toText, setToText] = useState('')
  const addMark = () => {
    const a = Number(fromText)
    const b = Number(toText)
    if (!(b > a)) return
    setLaunchMarks(session.path, [...marks, [a, b]])
    setFromText('')
    setToText('')
  }
  const fillCursor = (set: (v: string) => void) => () => {
    const t = cursorTime?.()
    if (t != null && Number.isFinite(t)) set(t.toFixed(2))
  }
  const mineCount = launches.filter((l) => l.manual).length
  const target = launchTargetG(car)
  const shown = useMemo(
    () =>
      launches
        .slice(0, MAX_LAUNCHES)
        .map((l, k) => ({ l, k }))
        .filter(({ k }) => !hidden.has(k)),
    [launches, hidden],
  )

  useEffect(() => {
    const host = hostRef.current
    if (!host || !inputs.ground || shown.length === 0) return
    const { time, ground, driven, accel } = inputs
    const grid: number[] = []
    for (let x = 0; x <= s.window + 1e-9; x += STEP) grid.push(Number(x.toFixed(4)))
    const sign = accel
      ? accelSign(
          accel,
          shown.map(({ l }) => l),
        )
      : 1
    const series: {
      name: string
      unit: string
      color: string
      dash?: number[]
      data: (number | null)[]
    }[] = []
    for (const { l, k } of shown) {
      const color = SLOT_COLORS[k % SLOT_COLORS.length]
      const a = accel
        ? resample(time, accel, l.start, grid).map((v) => (v == null ? null : sign * v))
        : (() => {
            const v = resample(time, ground, l.start, grid)
            return v.map((x, i) =>
              i === 0 || x == null || v[i - 1] == null ? null : (x - v[i - 1]!) / STEP / G,
            )
          })()
      series.push({ name: `Launch ${k + 1} g`, unit: 'g', color, data: a })
      if (driven) {
        const d = resample(time, driven, l.start, grid)
        const g = resample(time, ground, l.start, grid)
        series.push({
          name: `Launch ${k + 1} slip`,
          unit: '%',
          color,
          dash: [5, 4],
          data: d.map((v, i) => {
            const sl = v == null || g[i] == null ? NaN : slipAt(v, g[i]!)
            return Number.isFinite(sl) ? sl * 100 : null
          }),
        })
      }
    }
    series.push({
      name: 'Target g',
      unit: 'g',
      color: '#fafafa',
      dash: [2, 3],
      data: grid.map(() => target),
    })

    const fsync = createViewSync(`launch-${panel.id}`)
    const plot = mountPlot(host, {
      series,
      data: [grid, ...series.map((x) => x.data)] as uPlot.AlignedData,
      sync: fsync,
      pinCursor: false,
      bounds: () => [0, s.window],
      minSpan: 0.2,
      plugins: driven ? [bandPlugin(car.slipLow, car.slipHigh)] : [],
      ranges: { '%': [-10, Math.max(50, car.slipHigh * 300)] },
      onCursor: (idx) => {
        if (!cursorEl.current) return
        if (idx == null) {
          cursorEl.current.textContent = ''
          return
        }
        const parts = series
          .filter((x) => x.name !== 'Target g')
          .map((x) => {
            const v = x.data[idx]
            return v == null
              ? null
              : `${x.name.replace('Launch ', 'L')} ${v.toFixed(x.unit === '%' ? 0 : 2)}${x.unit === '%' ? '%' : ''}`
          })
          .filter(Boolean)
        cursorEl.current.textContent = `t ${grid[idx].toFixed(2)} s · ${parts.join(' · ')}`
      },
    })
    plotRef.current = plot
    return () => {
      plotRef.current = null
      plot.destroy()
    }
  }, [inputs, shown, s.window, car.slipLow, car.slipHigh, target, panel.id])

  const bestTime = Math.min(...launches.map((l) => l.time75m).filter(Number.isFinite))
  return (
    <PanelFrame
      panel={panel}
      active={active}
      dispatch={dispatch}
      title={`Launch ${index + 1}`}
      tall
      tools={<PlotTools plot={plotRef} title={`launch ${index + 1}`} />}
      legend={
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <ChannelSelect
            label="Driven wheel"
            value={s.driven}
            channels={[{ id: RPM_SOURCE, name: 'From RPM and gearing' }, ...session.channels]}
            allowNone={
              rearWheel
                ? `${channelTitle(rearWheel)} (default)`
                : rpmCh
                  ? 'From RPM and gearing (default)'
                  : 'None'
            }
            onChange={(v) => updateLaunch({ driven: v })}
          />
          <ChannelSelect
            label="Ground speed"
            value={s.ground}
            channels={session.channels}
            allowNone={
              frontWheel
                ? `${channelTitle(frontWheel)} (default)`
                : gps && distanceFromGps
                  ? 'GPS'
                  : 'Speed channel'
            }
            onChange={(v) => updateLaunch({ ground: v })}
          />
          <TargetInput key={`${car.targetG}:${target}`} car={car} target={target} />
          <span ref={cursorEl} className="truncate text-zinc-400 tabular-nums" />
        </div>
      }
    >
      <div className="absolute inset-0 flex flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-3 py-1 text-[11px] text-zinc-500">
          <span>
            Car: μ {car.tireMu} · {(car.rearWeight * 100).toFixed(0)}% rear · CG {car.cgHeight} m ·
            wheelbase {car.wheelbase} m · target slip {(car.slipLow * 100).toFixed(0)}–
            {(car.slipHigh * 100).toFixed(0)}% (change these in the Car tab)
          </span>
          <label className="ml-auto flex items-center gap-1">
            Show
            <input
              type="number"
              step={0.5}
              min={1}
              className="w-14 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200 outline-none focus:border-red-500"
              value={s.window}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (v >= 1) updateLaunch({ window: v })
              }}
            />
            s
          </label>
        </div>
        <div className="relative min-h-0 flex-1">
          {!inputs.ground ? (
            <p className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-zinc-600">
              Needs GPS or a speed channel to find launches
            </p>
          ) : launches.length === 0 ? (
            <p className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-zinc-600">
              No launches found: a launch is a standing start reaching 29 km/h within 4 s
              {tpsCh ? ' with throttle above 50%' : ''}
            </p>
          ) : (
            <div ref={hostRef} className="absolute inset-0" />
          )}
        </div>
        {inputs.ground && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-zinc-800 px-3 py-1 text-xs text-zinc-500">
            <span title="The log starts whenever the car is switched on, so mark a launch yourself if it isn't found or you want a different start">
              Add your own launch: from
            </span>
            <input
              aria-label="Launch start time"
              className="w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200 tabular-nums outline-none focus:border-red-500"
              placeholder="s"
              value={fromText}
              onChange={(e) => setFromText(e.target.value)}
            />
            <button
              type="button"
              className="text-zinc-400 hover:text-zinc-100"
              title="Use the time at the cursor (hover a time plot first)"
              aria-label="Start at the cursor"
              onClick={fillCursor(setFromText)}
            >
              ⌖
            </button>
            to
            <input
              aria-label="Launch end time"
              className="w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200 tabular-nums outline-none focus:border-red-500"
              placeholder="s"
              value={toText}
              onChange={(e) => setToText(e.target.value)}
            />
            <button
              type="button"
              className="text-zinc-400 hover:text-zinc-100"
              title="Use the time at the cursor (hover a time plot first)"
              aria-label="End at the cursor"
              onClick={fillCursor(setToText)}
            >
              ⌖
            </button>
            s
            <button
              type="button"
              className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300 hover:text-zinc-100"
              title="Use the range the time plots are zoomed to"
              onClick={() => {
                const r = viewRange?.()
                if (!r) return
                setFromText(r.min.toFixed(2))
                setToText(r.max.toFixed(2))
              }}
            >
              Zoomed range
            </button>
            <button
              type="button"
              className="rounded border border-red-500/60 px-1.5 py-0.5 text-zinc-100 disabled:opacity-40"
              disabled={!(Number(toText) > Number(fromText)) || !fromText.trim()}
              onClick={addMark}
            >
              Add
            </button>
          </div>
        )}
        {launches.length > 0 && (
          <div className="max-h-32 shrink-0 overflow-y-auto border-t border-zinc-800 px-3 py-1 text-xs">
            <table className="w-full tabular-nums">
              <thead className="text-zinc-500">
                <tr className="text-right">
                  <th className="w-6 text-left font-normal" />
                  <th className="text-left font-normal">Launch</th>
                  <th className="font-normal">At</th>
                  <th className="font-normal">RPM</th>
                  <th className="font-normal">0–60 km/h</th>
                  <th className="font-normal">75 m</th>
                  <th className="font-normal">Peak g</th>
                  <th className="font-normal">Avg g 0–1 s</th>
                  <th className="font-normal">Peak slip</th>
                </tr>
              </thead>
              <tbody>
                {launches.map((l, k) => {
                  const plotted = k < MAX_LAUNCHES
                  return (
                    <tr key={l.start} className="text-right hover:bg-zinc-800/60">
                      <td className="text-left">
                        {plotted && (
                          <input
                            type="checkbox"
                            aria-label={`Show launch ${k + 1}`}
                            className="accent-red-500"
                            checked={!hidden.has(k)}
                            onChange={() =>
                              setHidden((h) => {
                                const n = new Set(h)
                                if (n.has(k)) n.delete(k)
                                else n.add(k)
                                return n
                              })
                            }
                          />
                        )}
                      </td>
                      <td className="text-left whitespace-nowrap">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1.5 text-zinc-300 hover:underline"
                          title="Zoom the time plots to this launch"
                          onClick={() => onZoom(l.t0 - 1, l.t0 + s.window)}
                        >
                          {plotted && (
                            <span
                              className="size-2 rounded-full"
                              style={{ background: SLOT_COLORS[k % SLOT_COLORS.length] }}
                            />
                          )}
                          {l.manual ? `Yours ${k + 1}` : k + 1 - mineCount}
                        </button>
                        {l.manual && (
                          <button
                            type="button"
                            aria-label={`Remove launch ${k + 1}`}
                            title="Remove this launch"
                            className="ml-1.5 text-zinc-600 hover:text-red-300"
                            onClick={() =>
                              setLaunchMarks(
                                session.path,
                                marks.filter((_, j) => j !== l.mark),
                              )
                            }
                          >
                            ✕
                          </button>
                        )}
                      </td>
                      <td className="text-zinc-500">{formatLapTime(l.t0)}</td>
                      <td>{num(l.launchRpm, 0)}</td>
                      <td>{num(l.time60)}</td>
                      <td className={l.time75m === bestTime ? 'text-fuchsia-400' : ''}>
                        {num(l.time75m, 3)}
                      </td>
                      <td>{num(l.peakG)}</td>
                      <td className={l.meanG1s >= target * 0.9 ? 'text-emerald-300' : ''}>
                        {num(l.meanG1s)}
                      </td>
                      <td
                        className={
                          !Number.isFinite(l.peakSlip)
                            ? ''
                            : l.peakSlip > car.slipHigh * 1.5
                              ? 'text-red-300'
                              : l.peakSlip < car.slipLow
                                ? 'text-amber-300'
                                : 'text-emerald-300'
                        }
                      >
                        {Number.isFinite(l.peakSlip)
                          ? `${(l.peakSlip * 100).toFixed(0)}%`
                          : NO_VALUE}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p
              className="truncate pt-1 text-zinc-600"
              title="Shaded band = target slip. Above it is wheelspin, below it the tires aren't working hard enough (bogging, clutch slipping or too little throttle)."
            >
              Slip: {inputs.driven ? inputs.drivenLabel : 'no driven wheel speed'} vs{' '}
              {inputs.groundLabel} ground speed
              {fromRpm ? ' (engine side, so it includes clutch slip)' : ''}. Shaded band = target
              slip; hover for more.
            </p>
          </div>
        )}
      </div>
    </PanelFrame>
  )
})

function TargetInput({ car, target }: { car: CarSpecs; target: number }) {
  const [text, setText] = useState(car.targetG > 0 ? String(car.targetG) : '')
  const [error, setError] = useState('')
  const commit = async () => {
    const v = Number(text)
    const next = text.trim() && v > 0 ? v : 0
    if (next === car.targetG) return
    try {
      const current = info.get()?.car
      if (!current) throw new Error('no device selected')
      info.set(await LiveService.SaveCar({ ...current, targetG: next }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  return (
    <label
      className="flex items-center gap-1 text-zinc-500"
      title={
        error ||
        'Target acceleration. Leave blank to calculate it from grip and weight transfer (Car tab).'
      }
    >
      Target
      <input
        id="launch-target-g"
        type="number"
        step={0.01}
        min={0}
        className="w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200 tabular-nums outline-none focus:border-red-500"
        placeholder={tractionLimitG(car).toFixed(2)}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      g
      <span className={error ? 'text-red-300' : 'text-zinc-600'}>
        {error ? ' not saved' : car.targetG > 0 ? '' : ` (from grip: ${target.toFixed(2)})`}
      </span>
    </label>
  )
}
