import { useMemo } from 'react'
import { findLaunches, type Launch } from '../analysis/launch'
import { RUN_LIMIT, type RunResult } from '../analysis/sim/straight'
import { SimChart, type ChartBand, type ChartSeries } from '../components/SimChart'
import { Change, Empty, Stat } from './common'
import {
  BASE_COLOR,
  card,
  heading,
  KMH,
  LIMIT_COLORS,
  num,
  REAL_COLOR,
  WHATIF_COLOR,
  type SimCars,
  type SimLog,
} from './shared'

const RUN_COLORS = [LIMIT_COLORS[2], LIMIT_COLORS[3], LIMIT_COLORS[4]]
const WINDOW_S = 8

function bandsOf(run: RunResult): ChartBand[] {
  const out: ChartBand[] = []
  let from = 0
  for (let i = 1; i <= run.t.length; i++) {
    if (i === run.t.length || run.limit[i] !== run.limit[from]) {
      out.push({
        from: run.t[from],
        to: run.t[Math.min(i, run.t.length - 1)],
        color: RUN_COLORS[run.limit[from]],
      })
      from = i
    }
  }
  return out
}

export function AccelSection({
  cars,
  log,
  run,
  variantRun,
}: {
  cars: SimCars
  log: SimLog | null
  run: RunResult
  variantRun: RunResult | null
}) {
  const inputs = log?.inputs ?? null
  const launches = useMemo<Launch[]>(
    () =>
      inputs
        ? findLaunches({
            time: inputs.time,
            ground: inputs.speed,
            accel: inputs.longG ?? undefined,
            rpm: inputs.rpm ?? undefined,
            throttle: inputs.throttle ?? undefined,
            window: WINDOW_S,
          })
        : [],
    [inputs],
  )
  const best = useMemo(() => {
    const timed = launches.filter((l) => Number.isFinite(l.time75m))
    const pool = timed.length ? timed : launches.filter((l) => Number.isFinite(l.time60))
    const key = (l: Launch) => (timed.length ? l.time75m : l.time60)
    return pool.reduce<Launch | null>((a, b) => (!a || key(b) < key(a) ? b : a), null)
  }, [launches])

  const series: ChartSeries[] = [
    {
      label: 'Simulated · theoretical',
      color: BASE_COLOR,
      x: run.t,
      y: Array.from(run.v, (v) => v * KMH),
      unit: 'km/h',
      width: 2,
    },
  ]
  if (variantRun)
    series.push({
      label: 'What-if',
      color: WHATIF_COLOR,
      dash: '5 4',
      x: variantRun.t,
      y: Array.from(variantRun.v, (v) => v * KMH),
      unit: 'km/h',
    })
  if (best && inputs) {
    const x: number[] = []
    const y: number[] = []
    for (let i = best.start; i <= best.end && inputs.time[i] - best.t0 <= run.time * 1.3; i++) {
      x.push(inputs.time[i] - best.t0)
      y.push(inputs.speed[i] * KMH)
    }
    series.push({ label: 'Best real launch', color: REAL_COLOR, x, y, unit: 'km/h' })
  }

  const rows: { name: string; sim: number; real: number; digits: number; unit: string }[] = best
    ? [
        { name: '75 m', sim: run.time75m, real: best.time75m, digits: 3, unit: 's' },
        { name: '0–60 km/h', sim: run.time60, real: best.time60, digits: 3, unit: 's' },
        { name: 'Peak g', sim: run.peakG, real: best.peakG, digits: 2, unit: 'g' },
      ]
    : []

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="75 m (FSAE acceleration)"
          value={run.time75m}
          unit="s"
          digits={3}
          other={variantRun?.time75m}
          note={`crossing the line at ${num(run.vEnd * KMH, 0)} km/h`}
        />
        <Stat label="0–60 km/h" value={run.time60} unit="s" digits={2} other={variantRun?.time60} />
        <Stat
          label="0–100 km/h"
          value={run.time100}
          unit="s"
          digits={2}
          other={variantRun?.time100}
          note={Number.isFinite(run.time100) ? undefined : 'not reached in 75 m'}
        />
        <Stat
          label="Peak acceleration"
          value={run.peakG}
          unit="g"
          digits={2}
          other={variantRun?.peakG}
          lowerIsBetter={false}
          note={`grip-limited for the first ${num(run.tractionUntil, 2)} s, ${run.shifts.length} shift${run.shifts.length === 1 ? '' : 's'}`}
        />
      </div>

      <section className={card}>
        <h2 className={heading}>Speed through the run</h2>
        <SimChart
          series={series}
          xLabel="Time since launch (s)"
          yLabel="Speed (km/h)"
          zero
          height={280}
          bands={bandsOf(run)}
          bandLegend={[
            { label: 'Grip-limited', color: RUN_COLORS[RUN_LIMIT.traction] },
            { label: 'Power-limited', color: RUN_COLORS[RUN_LIMIT.power] },
            { label: 'Shifting', color: RUN_COLORS[RUN_LIMIT.shift] },
          ]}
          label="Speed against time for the acceleration run"
        />
        <p className="text-zinc-400">
          A perfect launch from {cars.car.launchGear > 1 ? `gear ${cars.car.launchGear}` : 'first'}:
          the clutch holds the engine at its launch RPM, the tires stay at their grip limit until
          the engine can no longer spin them, and each shift costs {num(cars.car.shiftTime, 2)} s
          with no drive.
        </p>
      </section>

      <section className={card}>
        <h2 className={heading}>Simulated against the open log</h2>
        {!log ? (
          <Empty>Open a log in the Viewer to compare its launches with the simulated run.</Empty>
        ) : !best ? (
          <Empty>No standing starts found in {log.name}.</Empty>
        ) : (
          <>
            <table className="w-full max-w-2xl tabular-nums">
              <thead className="text-zinc-500">
                <tr className="text-right">
                  <th className="text-left font-normal" />
                  <th className="font-normal">Simulated</th>
                  <th className="font-normal">Best real launch</th>
                  <th className="font-normal">Real − simulated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="text-right">
                    <td className="text-left text-zinc-300">{r.name}</td>
                    <td>
                      {num(r.sim, r.digits)} {r.unit}
                    </td>
                    <td>
                      {num(r.real, r.digits)} {r.unit}
                    </td>
                    <td>
                      <Change
                        base={r.sim}
                        other={r.real}
                        digits={r.digits}
                        unit={r.unit}
                        lowerIsBetter={r.unit === 's'}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-zinc-400">
              {launches.length} launch{launches.length === 1 ? '' : 'es'} found in {log.name}; the
              best one starts at {num(best.t0, 1)} s. If the real car is quicker than the
              simulation, the car on the Car tab is too pessimistic (grip, torque or mass); if it is
              slower early on, look at the launch; if only later, at power and shifts.
            </p>
          </>
        )}
      </section>
    </div>
  )
}
