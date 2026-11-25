import { useMemo } from 'react'
import { buildLimits } from '../analysis/sim/grip'
import { skidpadTime } from '../analysis/sim/lapsim'
import { KW_TO_HP, peaks } from '../analysis/sim/powertrain'
import { SKIDPAD_RADIUS } from '../analysis/sim/simtrack'
import { simulateRun } from '../analysis/sim/straight'
import { withOverrides } from '../analysis/sim/sweep'
import { formatLapTime } from '../analysis/track'
import { carEntered, hasTorqueCurve, STOCK_CAR_NOTE, useCar, useStockKeys } from '../data/car'
import type { Session } from '../data/session'
import { useInfo } from '../live/connection'
import { AccelSection } from '../sim/AccelSection'
import { BalanceSection } from '../sim/BalanceSection'
import { DamperSection } from '../sim/DamperSection'
import { Change, Stat } from '../sim/common'
import { heading, KMH, WHATIF_COLOR, type SimCars, type SimLog } from '../sim/shared'
import { EngineSection } from '../sim/EngineSection'
import { LapSection } from '../sim/LapSection'
import { SweepSection } from '../sim/SweepSection'
import { useSimLap } from '../sim/useSimLap'
import { WhatIf } from '../sim/WhatIf'
import { useTrack } from '../state/analysis'
import { updateSim, useSim, type SimSection } from '../state/sim'
import { logInputs } from '../viewer/simChannels'
import { useAnalysis } from '../viewer/useAnalysis'

const SECTIONS: { id: SimSection; label: string }[] = [
  { id: 'engine', label: 'Engine & gearing' },
  { id: 'accel', label: 'Acceleration' },
  { id: 'lap', label: 'Lap' },
  { id: 'balance', label: 'Skidpad & balance' },
  { id: 'dampers', label: 'Dampers' },
  { id: 'sweep', label: 'Sweeps' },
]

type OnView = (session: Session) => void

export function SimView({ session, onView }: { session: Session | null; onView?: OnView }) {
  return session ? (
    <WithLog session={session} onView={onView} />
  ) : (
    <SimPage log={null} onView={onView} />
  )
}

function WithLog({ session, onView }: { session: Session; onView?: OnView }) {
  const analysis = useAnalysis(session, useInfo()?.channels ?? undefined)
  const loop = (useTrack().lapMode ?? 'loop') === 'loop'
  const inputs = useMemo(
    () => logInputs(analysis.session, analysis.distance, analysis.gps),
    [analysis.session, analysis.distance, analysis.gps],
  )
  const log = useMemo<SimLog>(
    () => ({ name: session.name, inputs, laps: analysis.laps, loop }),
    [session.name, inputs, analysis.laps, loop],
  )
  return <SimPage log={log} onView={onView} />
}

function SimPage({ log, onView }: { log: SimLog | null; onView?: OnView }) {
  const car = useCar()
  const info = useInfo()
  const entered = carEntered(info?.car)
  const fromStock = useStockKeys()
  const standIn = peaks(car)
  const settings = useSim()
  const changed = Object.keys(settings.overrides).length > 0
  const variant = useMemo(
    () => (changed ? withOverrides(car, settings.overrides) : null),
    [car, changed, settings.overrides],
  )
  const limits = useMemo(() => buildLimits(car), [car])
  const variantLimits = useMemo(() => (variant ? buildLimits(variant) : null), [variant])
  const cars = useMemo<SimCars>(
    () => ({ car, limits, variant, variantLimits }),
    [car, limits, variant, variantLimits],
  )
  const run = useMemo(() => simulateRun(car), [car])
  const variantRun = useMemo(() => (variant ? simulateRun(variant) : null), [variant])
  const lap = useSimLap(cars, log, settings)
  const pad = skidpadTime(limits, SKIDPAD_RADIUS)
  const padV = variantLimits ? skidpadTime(variantLimits, SKIDPAD_RADIUS) : null

  return (
    <div className="h-full overflow-y-auto select-text">
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <header className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold">Simulator</h1>
            <p className="text-sm text-zinc-400">
              What the car on the Car tab should be able to do: its torque curve, gearing, tires,
              aero and suspension run through an acceleration run, a skidpad and a lap, and set
              against {log ? log.name : 'a log when one is open in the Viewer'}.
            </p>
          </div>
          <label
            className="flex items-center gap-1.5 text-xs text-zinc-400"
            title="Adds Sim Speed, Sim Long G, Sim Lat G, Sim Gear, Sim RPM and Sim Time Gap to the Viewer's channel list for every timed lap, so any plot can lay the simulated car over the real one"
          >
            <input
              type="checkbox"
              checked={settings.channels}
              onChange={(e) => updateSim({ channels: e.target.checked })}
            />
            Simulated channels in the Viewer
          </label>
        </header>

        {!hasTorqueCurve(car) && (
          <div
            role="alert"
            className="space-y-1 rounded border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
          >
            <p>
              <span className="mr-1.5 rounded bg-amber-500/30 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                Not your engine
              </span>
              {entered
                ? 'The Car tab has no torque curve yet, so this tab is running on the app’s stand-in'
                : `No car values have been entered for ${info?.active || 'this device'}, so this tab is running on a typical FSAE car with the app’s stand-in`}{' '}
              curve for a restricted 600 cc engine: {standIn.torque.nm.toFixed(0)} N·m peak torque,{' '}
              {(standIn.power.kw * KW_TO_HP).toFixed(0)} hp peak power. Those are placeholders, not
              numbers from your dyno, and every time below depends on them.
            </p>
            <p>
              Put your curve in on the Car tab with “Import dyno file…”.
              {!entered && info?.configDir.path
                ? ` The app is reading its settings from ${info.configDir.path}; if you expected car values to be there already, it is looking in a different folder from the one they were saved in.`
                : ''}
            </p>
          </div>
        )}

        {fromStock.size > 0 && (
          <p
            role="note"
            title={STOCK_CAR_NOTE}
            className="rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-100"
          >
            <span className="mr-1.5 rounded bg-sky-500/25 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
              G26 stock
            </span>
            {fromStock.has('torque') ? 'The engine curve and ' : ''}
            {fromStock.size - (fromStock.has('torque') ? 1 : 0)} car values here are the G26 values
            that come with the app (team spec sheet, 8/8/26 dyno run, team tire model, a few
            assumed), because {info?.active || 'this device'} has none of its own for them. Every
            time below depends on them. Check them on the Car tab.
          </p>
        )}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="75 m acceleration"
            value={run.time75m}
            unit="s"
            digits={3}
            other={variantRun?.time75m}
          />
          <Stat label="Skidpad lap" value={pad.time} unit="s" digits={3} other={padV?.time} />
          <div className="min-w-0 rounded-lg border border-zinc-800 px-3 py-2">
            <div className={heading}>Lap{lap.track ? ` · ${lap.track.name}` : ''}</div>
            <div className="text-xl font-semibold tabular-nums">
              {lap.result ? formatLapTime(lap.result.time) : '–'}
            </div>
            <div className="text-xs tabular-nums">
              {lap.result && lap.variantResult ? (
                <>
                  <span style={{ color: WHATIF_COLOR }}>
                    What-if {formatLapTime(lap.variantResult.time)}
                  </span>{' '}
                  <Change
                    base={lap.result.time}
                    other={lap.variantResult.time}
                    digits={3}
                    unit="s"
                  />
                </>
              ) : lap.correlation ? (
                <span className="text-zinc-500">
                  real lap {formatLapTime(lap.correlation.realTime)}
                </span>
              ) : (
                <span className="text-zinc-500">
                  {lap.result ? '' : 'pick a track on the Lap page'}
                </span>
              )}
            </div>
          </div>
          <Stat
            label="Top speed"
            value={limits.vTop * KMH}
            unit="km/h"
            digits={0}
            other={variantLimits ? variantLimits.vTop * KMH : null}
            lowerIsBetter={false}
          />
        </div>

        <WhatIf car={car} />

        <nav className="flex flex-wrap gap-1 border-b border-zinc-800" aria-label="Simulator pages">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={settings.section === s.id}
              onClick={() => updateSim({ section: s.id })}
              className={`border-b-2 px-3 py-1.5 text-sm ${
                settings.section === s.id
                  ? 'border-red-500 text-zinc-100'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        {settings.section === 'engine' && <EngineSection cars={cars} log={log} />}
        {settings.section === 'accel' && (
          <AccelSection cars={cars} log={log} run={run} variantRun={variantRun} />
        )}
        {settings.section === 'lap' && (
          <LapSection log={log} settings={settings} data={lap} onView={onView} />
        )}
        {settings.section === 'balance' && <BalanceSection cars={cars} />}
        {settings.section === 'dampers' && <DamperSection car={car} />}
        {settings.section === 'sweep' && (
          <SweepSection cars={cars} settings={settings} track={lap.track} />
        )}
      </div>
    </div>
  )
}
