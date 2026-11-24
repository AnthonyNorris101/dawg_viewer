import { useState } from 'react'
import type { Car } from '../../bindings/dawg_viewer/internal/config/models'
import { LiveService } from '../../bindings/dawg_viewer/services'
import { SensorEditor } from '../components/SensorEditor'
import { downforceN, dragN, G, gripLimitG } from '../analysis/aero'
import { DEFAULT_CAR, speedAt, tractionLimitG, withDefaults, type CarSpecs } from '../data/car'
import { info, useInfo } from '../live/connection'
import { toolbarButton, toolbarButtonActive } from '../ui'

type Field = {
  key: Exclude<keyof CarSpecs, 'gears'>
  label: string
  unit: string
  scale?: number
  step: number
  help: string
}

const SECTIONS: { title: string; fields: Field[] }[] = [
  {
    title: 'Chassis',
    fields: [
      {
        key: 'mass',
        label: 'Mass with driver',
        unit: 'kg',
        step: 1,
        help: 'Used for power-limited acceleration',
      },
      { key: 'wheelbase', label: 'Wheelbase', unit: 'm', step: 0.005, help: 'Front to rear axle' },
      {
        key: 'cgHeight',
        label: 'CG height',
        unit: 'm',
        step: 0.005,
        help: 'Sets how much load moves to the rear under acceleration',
      },
      {
        key: 'rearWeight',
        label: 'Static rear weight',
        unit: '%',
        scale: 100,
        step: 0.5,
        help: 'Share of the weight on the rear axle at rest',
      },
    ],
  },
  {
    title: 'Tires',
    fields: [
      {
        key: 'tireRadius',
        label: 'Driven tire radius',
        unit: 'm',
        step: 0.001,
        help: 'Loaded rolling radius; 18" tire ≈ 0.229 m, 16" ≈ 0.203 m',
      },
      {
        key: 'tireMu',
        label: 'Peak friction μ',
        unit: '',
        step: 0.05,
        help: 'Grip coefficient, ~1.4–1.7 for FSAE slicks. Also the no-aero grip line on the Aero panel',
      },
    ],
  },
  {
    title: 'Drivetrain',
    fields: [
      {
        key: 'primary',
        label: 'Primary ratio',
        unit: ':1',
        step: 0.001,
        help: 'Crank to clutch; R6 is 85/41 = 2.073',
      },
      {
        key: 'finalDrive',
        label: 'Final drive',
        unit: ':1',
        step: 0.01,
        help: 'Rear sprocket ÷ front sprocket',
      },
      {
        key: 'redline',
        label: 'Redline',
        unit: 'rpm',
        step: 100,
        help: 'For the speed-per-gear table',
      },
    ],
  },
  {
    title: 'Launch',
    fields: [
      {
        key: 'launchGear',
        label: 'Launch gear',
        unit: '',
        step: 1,
        help: 'Used when the log has no gear channel',
      },
      {
        key: 'slipLow',
        label: 'Target slip from',
        unit: '%',
        scale: 100,
        step: 1,
        help: 'Bottom of the slip band on the Launch panel',
      },
      {
        key: 'slipHigh',
        label: 'Target slip to',
        unit: '%',
        scale: 100,
        step: 1,
        help: 'Top of the slip band',
      },
    ],
  },
  {
    title: 'Aero',
    fields: [
      {
        key: 'clA',
        label: 'Downforce ClA',
        unit: 'm²',
        step: 0.05,
        help: 'Lift coefficient × reference area (from CFD or a coast-down/load test). Typical FSAE wing packages 2.5–4. 0 = no aero',
      },
      {
        key: 'cdA',
        label: 'Drag CdA',
        unit: 'm²',
        step: 0.05,
        help: 'Drag coefficient × frontal area. ~0.8 without wings, 1.2–1.6 with',
      },
      {
        key: 'aeroFront',
        label: 'Aero balance (front)',
        unit: '%',
        scale: 100,
        step: 1,
        help: 'Share of the downforce on the front axle',
      },
      {
        key: 'airDensity',
        label: 'Air density',
        unit: 'kg/m³',
        step: 0.01,
        help: '1.2 at sea level and 15 °C; about 1.1 at 1000 m or on a hot day',
      },
    ],
  },
]

const gearInput =
  'w-full min-w-0 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 tabular-nums outline-none focus:border-red-500'

const input =
  'w-28 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-sm text-zinc-100 tabular-nums outline-none focus:border-red-500'

export function CarView() {
  const live = useInfo()
  const saved = withDefaults(live?.car)
  return <CarForm key={`${live?.active}:${JSON.stringify(saved)}`} saved={saved} />
}

function CarForm({ saved }: { saved: CarSpecs }) {
  const live = useInfo()
  const [draft, setDraft] = useState<CarSpecs>(saved)
  const [gearText, setGearText] = useState(saved.gears.map(String))
  const [targetText, setTargetText] = useState(saved.targetG > 0 ? String(saved.targetG) : '')
  const [status, setStatus] = useState('')

  const gears = gearText.map(Number).filter((g) => Number.isFinite(g) && g > 0)
  const targetG = Number(targetText)
  const car: CarSpecs = {
    ...draft,
    gears: gears.length ? gears : draft.gears,
    targetG: targetText.trim() && targetG > 0 ? targetG : 0,
  }
  const dirty = JSON.stringify(car) !== JSON.stringify(saved)

  const save = async () => {
    setStatus('')
    try {
      const i = await LiveService.SaveCar(car as Car)
      info.set(i)
      setStatus(
        `Saved to ${live?.profiles?.find((p) => p.id === live.active)?.file ?? 'the device profile'}`,
      )
    } catch (e) {
      setStatus(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const tl = tractionLimitG(car)
  const rearLoad = car.rearWeight + (tl * car.cgHeight) / car.wheelbase

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <header className="flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-lg font-semibold">Car specs</h1>
            <p className="text-sm text-zinc-400">
              Saved in the device profile ({live?.active || 'no device selected'}) with the
              calibrations, so the whole team shares them. The Launch analysis uses them for its
              target acceleration and to work out wheel speed from RPM.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className={toolbarButton}
              onClick={() => {
                setDraft(DEFAULT_CAR)
                setGearText(DEFAULT_CAR.gears.map(String))
                setTargetText('')
              }}
            >
              Typical FSAE values
            </button>
            <button
              type="button"
              className={dirty ? toolbarButtonActive : toolbarButton}
              disabled={!dirty || !live?.active}
              onClick={() => void save()}
            >
              Save
            </button>
          </div>
        </header>
        {status && <p className="text-sm text-zinc-400">{status}</p>}

        <div className="grid gap-6 md:grid-cols-2">
          {SECTIONS.map((sec) => (
            <section key={sec.title} className="space-y-3 rounded-lg border border-zinc-800 p-4">
              <h2 className="text-[11px] tracking-wider text-zinc-500 uppercase">{sec.title}</h2>
              {sec.fields.map((f) => {
                const scale = f.scale ?? 1
                return (
                  <label key={f.key} className="flex items-center gap-3 text-sm" title={f.help}>
                    <span className="w-40 text-zinc-300">{f.label}</span>
                    <input
                      type="number"
                      step={f.step}
                      className={input}
                      value={Number((draft[f.key] * scale).toFixed(4))}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        if (Number.isFinite(v)) setDraft({ ...draft, [f.key]: v / scale })
                      }}
                    />
                    <span className="text-zinc-500">{f.unit}</span>
                  </label>
                )
              })}
              {sec.title === 'Drivetrain' && (
                <div className="space-y-2 text-sm">
                  <span className="text-zinc-300">Gear ratios</span>
                  <div className="grid grid-cols-3 gap-2">
                    {gearText.map((g, i) => (
                      <label key={i} className="flex min-w-0 items-center gap-1.5">
                        <span className="w-7 shrink-0 text-zinc-500">{ordinal(i + 1)}</span>
                        <input
                          id={`gear-${i + 1}`}
                          type="number"
                          step={0.001}
                          className={gearInput}
                          value={g}
                          onChange={(e) =>
                            setGearText(gearText.map((x, j) => (j === i ? e.target.value : x)))
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={toolbarButton}
                      disabled={gearText.length >= 8}
                      onClick={() =>
                        setGearText([...gearText, gearText[gearText.length - 1] ?? '1'])
                      }
                    >
                      Add gear
                    </button>
                    <button
                      type="button"
                      className={toolbarButton}
                      disabled={gearText.length <= 1}
                      onClick={() => setGearText(gearText.slice(0, -1))}
                    >
                      Remove last gear
                    </button>
                  </div>
                </div>
              )}
              {sec.title === 'Launch' && (
                <label
                  className="flex items-center gap-3 text-sm"
                  title="Leave blank to calculate it from grip, weight and load transfer"
                >
                  <span className="w-40 text-zinc-300">Target g</span>
                  <input
                    id="target-g"
                    type="number"
                    step={0.01}
                    min={0}
                    className={input}
                    placeholder={tractionLimitG(car).toFixed(2)}
                    value={targetText}
                    onChange={(e) => setTargetText(e.target.value)}
                  />
                  <span className="text-zinc-500">
                    {car.targetG > 0 ? 'set by hand' : 'from grip'}
                  </span>
                </label>
              )}
            </section>
          ))}
        </div>

        <section className="grid gap-6 md:grid-cols-2">
          <div className="space-y-2 rounded-lg border border-zinc-800 p-4 text-sm">
            <h2 className="text-[11px] tracking-wider text-zinc-500 uppercase">
              Traction limit
              {car.targetG > 0 ? ` (launch target set to ${car.targetG.toFixed(2)} g)` : ''}
            </h2>
            <p className="text-2xl font-semibold tabular-nums">{tl.toFixed(2)} g</p>
            <p className="text-zinc-400">
              Most a rear-drive car with these specs can accelerate before wheelspin: μ × rear load,
              where the rear carries {(rearLoad * 100).toFixed(0)}% of the weight at that
              acceleration ({(car.rearWeight * 100).toFixed(0)}% static plus load transfer). The
              Launch panel draws this as the target line unless you set a target g by hand.
            </p>
          </div>
          <div className="space-y-2 rounded-lg border border-zinc-800 p-4 text-sm">
            <h2 className="text-[11px] tracking-wider text-zinc-500 uppercase">Speed per gear</h2>
            <table className="w-full tabular-nums">
              <thead className="text-zinc-500">
                <tr className="text-right">
                  <th className="text-left font-normal">Gear</th>
                  <th className="font-normal">Overall ratio</th>
                  <th className="font-normal">km/h per 1000 rpm</th>
                  <th className="font-normal">At redline</th>
                </tr>
              </thead>
              <tbody>
                {car.gears.map((g, i) => (
                  <tr key={i} className="text-right">
                    <td className="text-left text-zinc-300">{i + 1}</td>
                    <td>{(car.primary * g * car.finalDrive).toFixed(2)}</td>
                    <td>{(speedAt(car, 1000, i + 1) * 3.6).toFixed(1)}</td>
                    <td>
                      {(speedAt(car, car.redline, i + 1) * 3.6).toFixed(0)} km/h ·{' '}
                      {(speedAt(car, car.redline, i + 1) * 2.23694).toFixed(0)} mph
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <AeroTable car={car} />

        <section className="space-y-2 rounded-lg border border-zinc-800 p-4">
          <h2 className="text-[11px] tracking-wider text-zinc-500 uppercase">Sensor locations</h2>
          <SensorEditor diagramHeight={520} />
        </section>
      </div>
    </div>
  )
}

function ordinal(n: number) {
  return `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
}

const AERO_SPEEDS_MPH = [20, 30, 40, 50, 60, 70]

function AeroTable({ car }: { car: CarSpecs }) {
  const weight = car.mass * G
  return (
    <section className="space-y-2 rounded-lg border border-zinc-800 p-4 text-sm">
      <h2 className="text-[11px] tracking-wider text-zinc-500 uppercase">Aero at speed</h2>
      {car.clA <= 0 && car.cdA <= 0 ? (
        <p className="text-zinc-500">
          Enter ClA and CdA above to see downforce, drag and the grip limit at each speed. The Aero
          panel in the Viewer compares your data against that limit.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full tabular-nums [&_td]:px-2 [&_td]:whitespace-nowrap [&_th]:px-2">
              <thead className="text-zinc-500">
                <tr className="text-right">
                  <th className="text-left font-normal">Speed</th>
                  <th className="font-normal">Downforce</th>
                  <th className="font-normal">Front / rear</th>
                  <th className="font-normal">Drag</th>
                  <th className="font-normal">Power to push air</th>
                  <th className="font-normal">Grip limit</th>
                </tr>
              </thead>
              <tbody>
                {AERO_SPEEDS_MPH.map((mph) => {
                  const v = mph / 2.23694
                  const df = downforceN(car, v)
                  const drag = dragN(car, v)
                  return (
                    <tr key={mph} className="text-right">
                      <td className="text-left text-zinc-300">
                        {mph} mph{' '}
                        <span className="text-zinc-500">· {(v * 3.6).toFixed(0)} km/h</span>
                      </td>
                      <td>
                        {df.toFixed(0)} N{' '}
                        <span className="text-zinc-500">
                          ({((df / weight) * 100).toFixed(0)}% of weight)
                        </span>
                      </td>
                      <td>
                        {(df * car.aeroFront).toFixed(0)} / {(df * (1 - car.aeroFront)).toFixed(0)}{' '}
                        N
                      </td>
                      <td>{drag.toFixed(0)} N</td>
                      <td>{((drag * v) / 1000).toFixed(1)} kW</td>
                      <td>
                        {gripLimitG(car, v).toFixed(2)} g{' '}
                        <span className="text-zinc-500">(vs {car.tireMu.toFixed(2)} without)</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-zinc-500">
            Grip limit = μ × (weight + downforce) ÷ weight. It is the best the tyres can do with
            this aero; the Aero panel shows how close the car gets to it at each speed.
          </p>
        </>
      )}
    </section>
  )
}
