import { useState } from 'react'
import { LiveService } from '../../bindings/dawg_viewer/services'
import { SensorEditor } from '../components/SensorEditor'
import { downforceN, dragN, G, gripLimitG } from '../analysis/aero'
import { suspension } from '../analysis/sim/suspension'
import { TireEditor } from '../components/TireEditor'
import { TorqueEditor } from '../components/TorqueEditor'
import {
  DEFAULT_CAR,
  forProfile,
  speedAt,
  tractionLimitG,
  STOCK_CAR_NOTE,
  stockKeys,
  withDefaults,
  type CarSpecs,
} from '../data/car'
import { info, useInfo } from '../live/connection'
import { pickTextFile } from '../state/storage'
import { toolbarButton, toolbarButtonActive } from '../ui'

type Field = {
  key: Exclude<keyof CarSpecs, 'gears' | 'torque' | 'tire'>
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
      {
        key: 'tireMuLat',
        label: 'Cornering μ',
        unit: '',
        step: 0.05,
        help: 'Sideways grip for the simulator, if it differs from the peak μ above. 0 = the same',
      },
      {
        key: 'tireLoadGrip',
        label: 'Grip kept at double load',
        unit: '%',
        scale: 100,
        step: 1,
        help: 'Tire load sensitivity: how much of its μ a tire keeps when its load doubles. 100 = none; FSAE slicks are about 85–92. This is what makes load transfer (springs, bars, CG height) cost grip in the simulator',
      },
      {
        key: 'rollRes',
        label: 'Rolling resistance',
        unit: '',
        step: 0.005,
        help: 'Rolling drag as a share of the load on the tires, about 0.015–0.03 for slicks',
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
        help: 'Rev limit: the speed-per-gear table and the simulator shift or stop here',
      },
      {
        key: 'driveEff',
        label: 'Drivetrain efficiency',
        unit: '%',
        scale: 100,
        step: 1,
        help: 'Share of crank torque that reaches the tires through the gearbox, chain and diff; about 88–92',
      },
      {
        key: 'shiftTime',
        label: 'Shift time',
        unit: 's',
        step: 0.01,
        help: 'Time with no drive during each upshift in the simulator',
      },
      {
        key: 'launchRpm',
        label: 'Launch RPM',
        unit: 'rpm',
        step: 100,
        help: 'Engine speed held on the clutch off the line in the simulator. 0 = the torque peak',
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
  {
    title: 'Suspension',
    fields: [
      {
        key: 'trackFront',
        label: 'Front track width',
        unit: 'm',
        step: 0.005,
        help: 'Between the front tire centers',
      },
      {
        key: 'trackRear',
        label: 'Rear track width',
        unit: 'm',
        step: 0.005,
        help: 'Between the rear tire centers',
      },
      {
        key: 'springFront',
        label: 'Front spring rate',
        unit: 'N/mm',
        step: 1,
        help: 'Per spring. 1 lb/in = 0.175 N/mm, so 200 lb/in is 35 N/mm',
      },
      {
        key: 'springRear',
        label: 'Rear spring rate',
        unit: 'N/mm',
        step: 1,
        help: 'Per spring. 250 lb/in is 44 N/mm',
      },
      {
        key: 'motionFront',
        label: 'Front motion ratio',
        unit: '',
        step: 0.01,
        help: 'Spring travel ÷ wheel travel. Wheel rate = spring rate × ratio²',
      },
      {
        key: 'motionRear',
        label: 'Rear motion ratio',
        unit: '',
        step: 0.01,
        help: 'Spring travel ÷ wheel travel',
      },
      {
        key: 'arbFront',
        label: 'Front anti-roll bar',
        unit: 'N·m/deg',
        step: 10,
        help: 'Roll stiffness the front bar adds, at the wheels. 0 = no bar',
      },
      {
        key: 'arbRear',
        label: 'Rear anti-roll bar',
        unit: 'N·m/deg',
        step: 10,
        help: 'Roll stiffness the rear bar adds, at the wheels. 0 = no bar',
      },
      {
        key: 'rcFront',
        label: 'Front roll center height',
        unit: 'm',
        step: 0.005,
        help: 'Above the ground; negative is below it',
      },
      {
        key: 'rcRear',
        label: 'Rear roll center height',
        unit: 'm',
        step: 0.005,
        help: 'Above the ground; negative is below it',
      },
      {
        key: 'unsprungFront',
        label: 'Front unsprung mass',
        unit: 'kg',
        step: 0.5,
        help: 'Per corner: wheel, tire, upright, brake and half the links',
      },
      {
        key: 'unsprungRear',
        label: 'Rear unsprung mass',
        unit: 'kg',
        step: 0.5,
        help: 'Per corner',
      },
      {
        key: 'tireRate',
        label: 'Tire vertical rate',
        unit: 'N/mm',
        step: 5,
        help: 'Spring rate of the tire itself, about 90–130 for 10 in FSAE tires',
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
  const saved = withDefaults(live?.car, live?.stockCar)
  return <CarForm key={`${live?.active}:${JSON.stringify(saved)}`} saved={saved} />
}

function CarForm({ saved }: { saved: CarSpecs }) {
  const live = useInfo()
  const [draft, setDraft] = useState<CarSpecs>(saved)
  const [gearText, setGearText] = useState(saved.gears.map(String))
  const [targetText, setTargetText] = useState(saved.targetG > 0 ? String(saved.targetG) : '')
  const [status, setStatus] = useState('')
  const [torqueVersion, setTorqueVersion] = useState(0)

  const gears = gearText.map(Number).filter((g) => Number.isFinite(g) && g > 0)
  const targetG = Number(targetText)
  const car: CarSpecs = {
    ...draft,
    gears: gears.length ? gears : draft.gears,
    targetG: targetText.trim() && targetG > 0 ? targetG : 0,
  }
  const dirty = JSON.stringify(car) !== JSON.stringify(saved)
  const entered = live?.car as Record<string, unknown> | null | undefined
  const base = withDefaults(null, live?.stockCar)
  const fromStock = stockKeys(live?.car, live?.stockCar)
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  const stock = (k: keyof CarSpecs) => fromStock.has(k) && same(car[k], base[k])
  const stockCount = [...fromStock].filter(stock).length
  const typical = (k: Field['key']) =>
    !fromStock.has(k) && DEFAULT_CAR[k] !== 0 && !entered?.[k] && draft[k] === DEFAULT_CAR[k]

  const forSave = () => forProfile(car, base, live?.car ?? {})

  const save = async () => {
    setStatus('')
    try {
      const i = await LiveService.SaveCar(forSave())
      info.set(i)
      setStatus(
        `Saved to ${live?.profiles?.find((p) => p.id === live.active)?.file ?? 'the device profile'}`,
      )
    } catch (e) {
      setStatus(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const importCar = async () => {
    const text = await pickTextFile('.yaml,.yml,.txt')
    if (text === null) return
    try {
      const read = await LiveService.ReadCarFile(text)
      const next = withDefaults(read, live?.stockCar)
      const count = Object.values(read).filter((v) =>
        Array.isArray(v)
          ? v.length > 0
          : v && typeof v === 'object'
            ? Object.keys(v).length > 0
            : typeof v === 'number' && v !== 0,
      ).length
      setDraft(next)
      setGearText(next.gears.map(String))
      setTargetText(next.targetG > 0 ? String(next.targetG) : '')
      setTorqueVersion((v) => v + 1)
      setStatus(
        `Read ${count} car values from that file. Nothing is saved yet: check them, then press Save.`,
      )
    } catch (e) {
      setStatus(`Couldn't use that file: ${e instanceof Error ? e.message : String(e)}`)
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
              calibrations, so the whole team shares them. The Launch and Aero analysis and the
              simulator (Sim tab) all work from these numbers.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className={toolbarButton}
              title="Fills this page from the car: block of a device file (devices\*.yaml in a Dawg Viewer config folder), for example a teammate's. Nothing is saved until you press Save."
              onClick={() => void importCar()}
            >
              Import car values…
            </button>
            <button
              type="button"
              className={toolbarButton}
              onClick={() => {
                setDraft(DEFAULT_CAR)
                setGearText(DEFAULT_CAR.gears.map(String))
                setTargetText('')
                setTorqueVersion((v) => v + 1)
              }}
            >
              Typical FSAE values
            </button>
            {fromStock.size > 0 && (
              <button
                type="button"
                className={toolbarButton}
                title="Puts back the G26 values that come with the app wherever the device profile has none of its own. Nothing is saved until you press Save."
                onClick={() => {
                  setDraft(saved)
                  setGearText(saved.gears.map(String))
                  setTargetText(saved.targetG > 0 ? String(saved.targetG) : '')
                  setTorqueVersion((v) => v + 1)
                }}
              >
                G26 stock values
              </button>
            )}
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
        {stockCount > 0 && (
          <p
            role="note"
            className="rounded border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-sky-100"
          >
            {stockCount} of these are the G26 values that come with the app, tagged{' '}
            <span className="rounded bg-sky-500/25 px-1 text-[9px] tracking-wide uppercase">
              G26 stock
            </span>
            . They come from the team spec sheet, the 8/8/26 dyno run and the team tire model, and a
            few are assumptions (the driver is taken as 68 kg). The app did not measure any of them.
            Change a value and press Save to put your own in the device profile.
          </p>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {SECTIONS.map((sec) => (
            <section key={sec.title} className="space-y-3 rounded-lg border border-zinc-800 p-4">
              <h2 className="text-[11px] tracking-wider text-zinc-500 uppercase">{sec.title}</h2>
              {sec.fields.map((f) => {
                const scale = f.scale ?? 1
                return (
                  <label key={f.key} className="flex items-center gap-3 text-sm" title={f.help}>
                    <span className="w-40 text-zinc-300">
                      {f.label}
                      {stock(f.key) && (
                        <span
                          className="ml-1 rounded bg-sky-500/25 px-1 text-[9px] tracking-wide text-sky-100 uppercase"
                          title={STOCK_CAR_NOTE}
                        >
                          G26 stock
                        </span>
                      )}
                      {typical(f.key) && (
                        <span
                          className="ml-1 rounded bg-amber-500/20 px-1 text-[9px] tracking-wide text-amber-200 uppercase"
                          title="A typical FSAE value the app filled in. It was not entered or measured for your car"
                        >
                          typical
                        </span>
                      )}
                    </span>
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
                  <span
                    className="text-zinc-300"
                    title="The gearbox ratio of each gear on its own. The primary ratio and final drive above are multiplied in on top of these"
                  >
                    Gear ratios (gearbox only)
                  </span>
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
                  <p className="text-xs text-zinc-500 tabular-nums">
                    Engine turns per wheel turn (primary × gear × final drive):{' '}
                    {car.gears
                      .map(
                        (g, i) =>
                          `${ordinal(i + 1)} ${(car.primary * g * car.finalDrive).toFixed(2)}`,
                      )
                      .join(' · ')}
                    . In {ordinal(car.gears.length)} at {Math.round(car.redline).toLocaleString()}{' '}
                    rpm that is{' '}
                    {(
                      (car.redline /
                        60 /
                        (car.primary * car.gears[car.gears.length - 1] * car.finalDrive)) *
                      2 *
                      Math.PI *
                      car.tireRadius *
                      3.6
                    ).toFixed(0)}{' '}
                    km/h.
                  </p>
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

        {(stock('torque') || stock('tire')) && (
          <p className="text-sm text-sky-100" title={STOCK_CAR_NOTE}>
            <span className="mr-1 rounded bg-sky-500/25 px-1 text-[9px] tracking-wide uppercase">
              G26 stock
            </span>
            {stock('torque') && stock('tire')
              ? 'The torque curve and the tire model below'
              : stock('torque')
                ? 'The torque curve below'
                : 'The tire model below'}{' '}
            came with the app
            {stock('torque') ? ': dyno run 19 of 8/8/26, measured at the wheels' : ''}
            {stock('tire') ? `${stock('torque') ? ', and' : ':'} the team tire model` : ''}.
          </p>
        )}
        <TorqueEditor
          key={torqueVersion}
          curve={draft.torque}
          redline={car.redline}
          driveEff={car.driveEff}
          onChange={(torque) => setDraft({ ...draft, torque })}
        />

        <TireEditor
          car={car}
          onChange={(tire, peaks) => setDraft({ ...draft, tire, ...(peaks ?? {}) })}
        />

        <SuspensionSummary car={car} />

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

function SuspensionSummary({ car }: { car: CarSpecs }) {
  const s = suspension(car)
  const rows: [string, string, string][] = [
    ['Wheel rate', `${s.wheelRateF.toFixed(1)} N/mm`, `${s.wheelRateR.toFixed(1)} N/mm`],
    ['Ride frequency', `${s.freqF.toFixed(2)} Hz`, `${s.freqR.toFixed(2)} Hz`],
    ['Roll stiffness', `${s.rollStiffF.toFixed(0)} N·m/deg`, `${s.rollStiffR.toFixed(0)} N·m/deg`],
    [
      'Share of lateral load transfer',
      `${(s.lltd * 100).toFixed(1)}%`,
      `${((1 - s.lltd) * 100).toFixed(1)}%`,
    ],
  ]
  return (
    <section className="space-y-2 rounded-lg border border-zinc-800 p-4 text-sm">
      <h2 className="text-[11px] tracking-wider text-zinc-500 uppercase">Suspension, worked out</h2>
      <table className="w-full max-w-xl tabular-nums">
        <thead className="text-zinc-500">
          <tr className="text-right">
            <th className="text-left font-normal" />
            <th className="font-normal">Front</th>
            <th className="font-normal">Rear</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, front, rear]) => (
            <tr key={name} className="text-right">
              <td className="text-left text-zinc-300">{name}</td>
              <td>{front}</td>
              <td>{rear}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-zinc-400">
        Roll gradient{' '}
        <span className="font-semibold text-zinc-100 tabular-nums">
          {s.rollGradient.toFixed(2)} deg/g
        </span>
        . The Sim tab&apos;s Skidpad &amp; balance page shows what these do to grip and to which end
        of the car runs out first.
      </p>
    </section>
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
