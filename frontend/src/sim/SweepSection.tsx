import { useMemo } from 'react'
import { buildLimits } from '../analysis/sim/grip'
import { simulateLap, skidpadTime } from '../analysis/sim/lapsim'
import { SKIDPAD_RADIUS, type SimTrack } from '../analysis/sim/simtrack'
import { simulateRun } from '../analysis/sim/straight'
import { paramOf, SIM_PARAMS, sweepRange, sweepValues } from '../analysis/sim/sweep'
import { SimChart } from '../components/SimChart'
import type { CarSpecs } from '../data/car'
import { updateSim, type SimSettings, type SweepMetric } from '../state/sim'
import { Change, NumberInput } from './common'
import { BASE_COLOR, card, field, heading, KMH, num, type SimCars } from './shared'

const METRICS: { id: SweepMetric; label: string; unit: string; digits: number; lower: boolean }[] =
  [
    { id: 'accel', label: '75 m acceleration time', unit: 's', digits: 3, lower: true },
    { id: 'skidpad', label: 'Skidpad lap time', unit: 's', digits: 3, lower: true },
    { id: 'lap', label: 'Lap time on the Lap page’s track', unit: 's', digits: 3, lower: true },
    { id: 'top', label: 'Top speed', unit: 'km/h', digits: 1, lower: false },
  ]

function measure(c: CarSpecs, metric: SweepMetric, track: SimTrack | null): number {
  if (metric === 'accel') return simulateRun(c, { dt: 0.002, every: 100 }).time75m
  const limits = buildLimits(c)
  if (metric === 'skidpad') return skidpadTime(limits, SKIDPAD_RADIUS).time
  if (metric === 'top') return limits.vTop * KMH
  return track ? simulateLap(c, track, limits).time : NaN
}

function planSweep(car: CarSpecs, settings: SimSettings, track: SimTrack | null) {
  const p = paramOf(settings.sweepParam) ?? SIM_PARAMS[0]
  const m = METRICS.find((x) => x.id === settings.sweepMetric) ?? METRICS[0]
  const [d0, d1] = sweepRange(p, car)
  const from = settings.sweepFrom ?? d0
  const to = settings.sweepTo ?? d1
  const rows =
    to > from
      ? sweepValues(from, to, settings.sweepSteps).map((value) => ({
          value,
          result: measure(p.set(car, value), m.id, track),
        }))
      : []
  return { p, m, from, to, rows, now: p.get(car), current: measure(car, m.id, track) }
}

export function SweepSection({
  cars,
  settings,
  track,
}: {
  cars: SimCars
  settings: SimSettings
  track: SimTrack | null
}) {
  const plan = useMemo(() => planSweep(cars.car, settings, track), [cars.car, settings, track])
  const { p, m, from, to, rows, now, current } = plan
  const usable = rows.filter((r) => Number.isFinite(r.result))
  const best = usable.reduce<(typeof rows)[number] | null>(
    (a, b) => (!a || (m.lower ? b.result < a.result : b.result > a.result) ? b : a),
    null,
  )
  const perStep =
    usable.length >= 2
      ? ((usable[usable.length - 1].result - usable[0].result) /
          (usable[usable.length - 1].value - usable[0].value)) *
        p.step
      : NaN
  const digits = p.step >= 10 ? 0 : p.step >= 1 ? 1 : p.step >= 0.1 ? 2 : 3

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className={heading}>Sweep one value and watch a result</h2>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-zinc-400">
            Change
            <select
              aria-label="Value to sweep"
              className={field}
              value={p.key}
              onChange={(e) =>
                updateSim({ sweepParam: e.target.value, sweepFrom: null, sweepTo: null })
              }
            >
              {SIM_PARAMS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-zinc-400">
            from
            <NumberInput
              label="Sweep from"
              step={p.step}
              className={`${field} w-24`}
              value={from}
              onCommit={(v) => updateSim({ sweepFrom: v })}
            />
          </label>
          <label className="flex items-center gap-1.5 text-zinc-400">
            to
            <NumberInput
              label="Sweep to"
              step={p.step}
              className={`${field} w-24`}
              value={to}
              onCommit={(v) => updateSim({ sweepTo: v })}
            />
            {p.unit}
          </label>
          <label className="flex items-center gap-1.5 text-zinc-400">
            in
            <NumberInput
              label="Number of steps"
              min={2}
              max={41}
              step={1}
              className={`${field} w-16`}
              value={settings.sweepSteps}
              onCommit={(v) => updateSim({ sweepSteps: Math.round(v) })}
            />
            steps
          </label>
          <label className="flex items-center gap-1.5 text-zinc-400">
            and show
            <select
              aria-label="Result to show"
              className={field}
              value={m.id}
              onChange={(e) => updateSim({ sweepMetric: e.target.value as SweepMetric })}
            >
              {METRICS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!(to > from) && <p className="text-amber-300">“To” has to be larger than “from”.</p>}
        {m.id === 'lap' && !track && (
          <p className="text-amber-300">Pick a track on the Lap page first.</p>
        )}
      </section>

      {usable.length >= 2 && best && (
        <>
          <section className={card}>
            <h2 className={heading}>
              {m.label} against {p.label.toLowerCase()}
              {m.id === 'lap' && track ? ` (${track.name})` : ''}
            </h2>
            <SimChart
              series={[
                {
                  label: m.label,
                  color: BASE_COLOR,
                  x: usable.map((r) => r.value),
                  y: usable.map((r) => r.result),
                  unit: m.unit,
                  width: 2,
                },
                { label: 'The car now', color: '#fafafa', x: [now], y: [current], dots: true },
              ]}
              xLabel={`${p.label} (${p.unit || 'ratio'})`}
              yLabel={`${m.label} (${m.unit})`}
              height={260}
              label={`${m.label} against ${p.label}`}
            />
            <p className="text-zinc-400 tabular-nums">
              Best in this range: {num(best.value, digits)} {p.unit} gives{' '}
              {num(best.result, m.digits)} {m.unit}
              {Number.isFinite(current) && (
                <>
                  {' '}
                  (
                  <Change
                    base={current}
                    other={best.result}
                    digits={m.digits}
                    unit={m.unit}
                    lowerIsBetter={m.lower}
                  />{' '}
                  against the car now at {num(now, digits)} {p.unit})
                </>
              )}
              . Across the range, each {p.step} {p.unit} is worth about{' '}
              {num(Math.abs(perStep), m.digits)} {m.unit}.
            </p>
          </section>

          <section className={card}>
            <h2 className={heading}>Every step</h2>
            <table className="w-full max-w-xl tabular-nums">
              <thead className="text-zinc-500">
                <tr className="text-right">
                  <th className="text-left font-normal">
                    {p.label} ({p.unit || 'ratio'})
                  </th>
                  <th className="font-normal">{m.label}</th>
                  <th className="font-normal">Against the car now</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.value}
                    className={`text-right ${r === best ? 'text-fuchsia-300' : ''}`}
                  >
                    <td className="text-left">{num(r.value, digits)}</td>
                    <td>
                      {num(r.result, m.digits)} {m.unit}
                    </td>
                    <td>
                      <Change
                        base={current}
                        other={r.result}
                        digits={m.digits}
                        unit={m.unit}
                        lowerIsBetter={m.lower}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
