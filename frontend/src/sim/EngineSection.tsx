import { useMemo, useState } from 'react'
import { LiveService } from '../../bindings/dawg_viewer/services'
import { torqueFromLog, type TorqueEstimate } from '../analysis/sim/fromlog'
import { resistance, tractionForce } from '../analysis/sim/grip'
import {
  clutchRpm,
  KW_TO_HP,
  peaks,
  shiftPoints,
  torqueSeries,
  wheelForce,
} from '../analysis/sim/powertrain'
import { SimChart, type ChartSeries } from '../components/SimChart'
import { hasTorqueCurve, speedAt, useStockKeys, type CarSpecs } from '../data/car'
import { info } from '../live/connection'
import { forwardG } from '../viewer/simChannels'
import { SLOT_COLORS } from '../plot/canvas'
import { toolbarButton, toolbarButtonActive } from '../ui'
import { Stat } from './common'
import {
  BASE_COLOR,
  card,
  heading,
  KMH,
  MPH,
  num,
  WHATIF_COLOR,
  type SimCars,
  type SimLog,
} from './shared'

function forceSeries(c: CarSpecs): ChartSeries[] {
  const top = speedAt(c, c.redline, c.gears.length)
  const slip = clutchRpm(c)
  const n = 240
  const speeds = Array.from({ length: n + 1 }, (_, i) => (top * 1.02 * i) / n)
  const x = speeds.map((v) => v * KMH)
  const gears: ChartSeries[] = c.gears.map((_, g) => ({
    label: `Gear ${g + 1}`,
    color: SLOT_COLORS[g % SLOT_COLORS.length],
    x,
    y: speeds.map((v) => {
      const f = wheelForce(c, v, g + 1, g === 0 ? slip : 0)
      return f > 0 ? f : NaN
    }),
    unit: 'N',
  }))
  return [
    ...gears,
    {
      label: 'Tire grip limit',
      color: '#e4e4e7',
      dash: '5 4',
      x,
      y: speeds.map((v) => tractionForce(c, v)),
      unit: 'N',
    },
    {
      label: 'Drag + rolling',
      color: '#71717a',
      x,
      y: speeds.map((v) => resistance(c, v)),
      unit: 'N',
    },
  ]
}

export function EngineSection({ cars, log }: { cars: SimCars; log: SimLog | null }) {
  const { car, variant, limits, variantLimits } = cars
  const [estimate, setEstimate] = useState<TorqueEstimate | null>(null)
  const [message, setMessage] = useState('')
  const fromStock = useStockKeys()
  const p = peaks(car)
  const pv = variant ? peaks(variant) : null
  const curve = torqueSeries(car.torque, car.redline)
  const other = variant ? torqueSeries(variant.torque, variant.redline) : null
  const shifts = useMemo(() => shiftPoints(car), [car])
  const force = useMemo(() => forceSeries(car), [car])
  const topGear = speedAt(car, car.redline, car.gears.length)
  const byRedline = limits.vTop >= topGear - 0.3
  const inputs = log?.inputs ?? null

  const runEstimate = () => {
    setMessage('')
    if (!inputs?.rpm) return setMessage('The open log has no RPM channel.')
    const est = torqueFromLog(
      {
        time: inputs.time,
        rpm: inputs.rpm,
        speed: inputs.speed,
        accelG: forwardG(inputs),
        throttle: inputs.throttle,
      },
      car,
    )
    setEstimate(est)
    if (!est)
      setMessage(
        'Not enough clean full-throttle running in this log. It needs pulls above 4 m/s, in gear with no wheelspin, covering at least four 250 rpm steps.',
      )
  }

  const saveEstimate = async () => {
    if (!estimate) return
    try {
      const current = info.get()?.car
      if (!current || !info.get()?.active) throw new Error('pick a device on the Live tab first')
      info.set(await LiveService.SaveCar({ ...current, torque: estimate.points }))
      setEstimate(null)
      setMessage('Saved as the car’s torque curve. Edit it any time on the Car tab.')
    } catch (e) {
      setMessage(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const torqueLines: ChartSeries[] = [
    { label: 'Torque', color: BASE_COLOR, x: curve.rpm, y: curve.nm, unit: 'N·m' },
    { label: 'Power', color: '#60a5fa', x: curve.rpm, y: curve.kw, right: true, unit: 'kW' },
  ]
  if (other && variant && variant.torque !== car.torque)
    torqueLines.push(
      { label: 'What-if torque', color: WHATIF_COLOR, dash: '5 4', x: other.rpm, y: other.nm },
      {
        label: 'What-if power',
        color: WHATIF_COLOR,
        dash: '2 3',
        x: other.rpm,
        y: other.kw,
        right: true,
      },
    )
  if (estimate)
    torqueLines.push({
      label: 'From the log',
      color: '#fafafa',
      x: estimate.points.map((q) => q[0]),
      y: estimate.points.map((q) => q[1]),
      dots: true,
    })

  const forceLines = [...force]
  if (
    variant &&
    variantLimits &&
    variantLimits.drive.some((f, i) => Math.abs(f - limits.drive[i]) > 1)
  ) {
    const redline = speedAt(variant, variant.redline, variant.gears.length)
    forceLines.push({
      label: 'What-if, best gear',
      color: WHATIF_COLOR,
      dash: '5 4',
      width: 2,
      x: Array.from(variantLimits.drive, (_, i) => i * variantLimits.dv * KMH),
      y: Array.from(variantLimits.drive, (f, i) =>
        f > 0 && i * variantLimits.dv <= redline ? f : NaN,
      ),
    })
  }

  const standIn = !hasTorqueCurve(car)
  const stockCurve = !standIn && fromStock.has('torque')
  const curveTag = standIn ? ' · stand-in' : stockCurve ? ' · G26 stock' : ''
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label={`Peak torque${curveTag}`}
          value={p.torque.nm}
          unit="N·m"
          digits={1}
          other={pv?.torque.nm}
          lowerIsBetter={false}
          note={`at ${Math.round(p.torque.rpm)} rpm`}
        />
        <Stat
          label={`Peak power${curveTag}`}
          value={p.power.kw}
          unit="kW"
          digits={1}
          other={pv?.power.kw}
          lowerIsBetter={false}
          note={`${(p.power.kw * KW_TO_HP).toFixed(0)} hp at ${Math.round(p.power.rpm)} rpm`}
        />
        <Stat
          label="Top speed"
          value={limits.vTop * KMH}
          unit="km/h"
          digits={0}
          other={variantLimits ? variantLimits.vTop * KMH : null}
          lowerIsBetter={false}
          note={`${(limits.vTop * MPH).toFixed(0)} mph, limited by ${byRedline ? 'the redline in top gear' : 'power against drag'}`}
        />
        <Stat
          label="Launch RPM"
          value={clutchRpm(car)}
          unit="rpm"
          digits={0}
          note={car.launchRpm > 0 ? 'set on the Car tab' : 'at the torque peak'}
        />
      </div>

      <section className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={heading}>
            Torque and power at the crank
            {standIn
              ? ' · stand-in curve, not your engine'
              : stockCurve
                ? ' · G26 stock curve (8/8/26 dyno run 19, measured at the wheels)'
                : ''}
          </h2>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={toolbarButton}
              disabled={!inputs}
              title={
                inputs
                  ? 'Work the torque curve out from full-throttle pulls in the open log: force = mass × acceleration + drag, taken back through the gearing'
                  : 'Open a log in the Viewer first'
              }
              onClick={runEstimate}
            >
              Estimate from the open log
            </button>
            {estimate && (
              <button
                type="button"
                className={toolbarButtonActive}
                onClick={() => void saveEstimate()}
              >
                Use this as the car’s curve
              </button>
            )}
          </span>
        </div>
        <SimChart
          series={torqueLines}
          xLabel="Engine speed (rpm)"
          yLabel="Torque (N·m)"
          rightLabel="Power (kW)"
          zero
          label="Torque and power against engine speed"
        />
        {estimate && (
          <p className="text-zinc-400">
            White dots: {estimate.points.length} points from {estimate.samples} full-throttle
            samples in gear{estimate.gears.length > 1 ? 's' : ''} {estimate.gears.join(', ')} of{' '}
            {log?.name}. They use the mass, gearing, drag and drivetrain efficiency from the Car
            tab, and leave out the engine and wheel inertia, so low gears read a few percent low.
          </p>
        )}
        {message && <p className="text-zinc-400">{message}</p>}
      </section>

      <section className={card}>
        <h2 className={heading}>Force at the tires in each gear</h2>
        <SimChart
          series={forceLines}
          xLabel="Speed (km/h)"
          yLabel="Force (N)"
          zero
          height={280}
          label="Drive force against speed for each gear"
        />
        <p className="text-zinc-400">
          Where a gear&apos;s line is above the dashed grip limit, the tires spin before the engine
          runs out. The car stops accelerating where the lines meet drag + rolling. The best shift
          point is where the next gear&apos;s line crosses above the current one.
        </p>
      </section>

      <section className={card}>
        <h2 className={heading}>Best shift points</h2>
        <table className="w-full max-w-2xl tabular-nums">
          <thead className="text-zinc-500">
            <tr className="text-right">
              <th className="text-left font-normal">Shift</th>
              <th className="font-normal">At</th>
              <th className="font-normal">Speed</th>
              <th className="font-normal">Drops to</th>
              <th className="text-left font-normal" />
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.from} className="text-right">
                <td className="text-left text-zinc-300">
                  {s.from} → {s.from + 1}
                </td>
                <td>{Math.round(s.rpm / 50) * 50} rpm</td>
                <td>
                  {num(s.speed * KMH, 0)} km/h{' '}
                  <span className="text-zinc-500">· {num(s.speed * MPH, 0)} mph</span>
                </td>
                <td>{Math.round(s.rpmAfter / 50) * 50} rpm</td>
                <td className="pl-3 text-left text-zinc-500">
                  {s.atRedline ? 'at the redline' : 'next gear pulls harder from here'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
