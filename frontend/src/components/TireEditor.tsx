import { useMemo, useState } from 'react'
import {
  combinedEnvelope,
  DEG,
  envelopeAt,
  latCurve,
  lonCurve,
  magic,
  parseTir,
  TIRE_FIELDS,
  tireOf,
  tireSummary,
  type TireField,
  type TireKey,
} from '../analysis/sim/tire'
import type { CarSpecs, TireCoeffs } from '../data/car'
import { pickTextFile } from '../state/storage'
import { toolbarButton } from '../ui'
import { SimChart } from './SimChart'

const cell =
  'w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-sm text-zinc-100 tabular-nums outline-none placeholder:text-zinc-500 focus:border-red-500'

const GROUPS: TireField['group'][] = [
  'Lateral (cornering)',
  'Longitudinal (drive and brake)',
  'Combined slip',
  'Pressure',
  'Load',
]
const LOADS = [
  { share: 0.5, color: '#60a5fa' },
  { share: 1, color: '#f87171' },
  { share: 1.5, color: '#fbbf24' },
]
const POINTS = 61
const MAX_ANGLE = 15
const MAX_RATIO = 0.3

const short = (v: number) => String(Number(v.toPrecision(4)))

const toText = (tire: TireCoeffs) =>
  Object.fromEntries(
    TIRE_FIELDS.map((f) => [f.key, tire[f.key] === undefined ? '' : String(tire[f.key])]),
  ) as Record<TireKey, string>

export function TireEditor({
  car,
  onChange,
}: {
  car: CarSpecs
  onChange: (tire: TireCoeffs, peaks?: { tireMu: number; tireMuLat: number }) => void
}) {
  const [text, setText] = useState(() => toText(car.tire))
  const [note, setNote] = useState('')
  const tire = useMemo(() => tireOf(car), [car])
  const sum = useMemo(() => tireSummary(tire), [tire])
  const custom = Object.keys(car.tire).length > 0

  const charts = useMemo(() => {
    const angle = Float64Array.from({ length: POINTS }, (_, i) => (i / (POINTS - 1)) * MAX_ANGLE)
    const ratio = Float64Array.from({ length: POINTS }, (_, i) => (i / (POINTS - 1)) * MAX_RATIO)
    return {
      lat: LOADS.map((l) => {
        const fz = l.share * tire.fnomin
        const cv = latCurve(tire, fz)
        return {
          label: `${Math.round(fz)} N load`,
          color: l.color,
          x: angle,
          y: Float64Array.from(angle, (a) => magic(cv, a * DEG)),
          unit: 'N',
        }
      }),
      lon: LOADS.map((l) => {
        const fz = l.share * tire.fnomin
        const cv = lonCurve(tire, fz)
        return {
          label: `${Math.round(fz)} N load`,
          color: l.color,
          x: Float64Array.from(ratio, (k) => k * 100),
          y: Float64Array.from(ratio, (k) => magic(cv, k)),
          unit: 'N',
        }
      }),
      left: envelopeAt(combinedEnvelope(tire), 0.9),
    }
  }, [tire])

  const edit = (key: TireKey, value: string) => {
    setText({ ...text, [key]: value })
    const next = { ...car.tire }
    const v = Number(value)
    if (value.trim() === '' || !Number.isFinite(v)) delete next[key]
    else next[key] = v
    onChange(next)
  }
  const importFile = async () => {
    const file = await pickTextFile('.tir,.m,.txt')
    if (file == null) return
    const result = parseTir(file)
    if (typeof result === 'string') return setNote(result)
    const next = { ...car.tire, ...result.coeffs } as TireCoeffs
    setText(toText(next))
    setNote(result.note)
    const read = tireOf({ ...car, tire: next })
    onChange(next, { tireMu: read.pdx1, tireMuLat: read.pdy1 })
  }
  const clear = () => {
    setText(toText({}))
    setNote('')
    onChange({})
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[11px] tracking-wider text-zinc-500 uppercase">
          Tire model (Magic Formula)
        </h2>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={toolbarButton}
            title="A Magic Formula .tir file (MF 5.2 or MF 6), or a MATLAB .m tire model that sets the same coefficient names"
            onClick={() => void importFile()}
          >
            Import tire file…
          </button>
          <button
            type="button"
            className={toolbarButton}
            disabled={!custom}
            title="Clear every coefficient typed or imported here"
            onClick={clear}
          >
            Back to typical values
          </button>
        </span>
      </div>
      <p className="text-zinc-400">
        Tire force = D·sin(C·atan(B·s − E·(B·s − atan(B·s)))), where s is the slip angle or slip
        ratio. The simulator takes its cornering, traction and braking limits from the peaks of
        these curves at each tire’s load.{' '}
        {custom
          ? 'Blank boxes use the grey value.'
          : 'These are typical values for a 10 in FSAE slick built around the μ numbers in the Tires section, not a fit of your tire. Type coefficients over them or import a tire file fitted to tire test data.'}
      </p>
      {note && <p className="text-zinc-300">{note}</p>}
      <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
        <div className="space-y-3">
          {GROUPS.map((g) => (
            <div key={g} className="space-y-1">
              <div className="text-xs text-zinc-500">{g}</div>
              {TIRE_FIELDS.filter((f) => f.group === g).map((f) => (
                <label key={f.key} className="flex items-center gap-2" title={f.help}>
                  <span className="w-52 text-zinc-300">{f.label}</span>
                  <input
                    type="number"
                    step={f.step}
                    aria-label={`${g} ${f.label}`}
                    className={cell}
                    value={text[f.key]}
                    placeholder={short(tire[f.key])}
                    onChange={(e) => edit(f.key, e.target.value)}
                  />
                  <span className="text-xs text-zinc-600">{f.key}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
        <div className="min-w-0 space-y-3">
          <SimChart
            series={charts.lat}
            xLabel="Slip angle (deg)"
            yLabel="Cornering force (N)"
            height={200}
            zero
            label="Cornering force against slip angle at three loads"
          />
          <SimChart
            series={charts.lon}
            xLabel="Slip ratio (%)"
            yLabel="Drive or brake force (N)"
            height={200}
            zero
            label="Drive and brake force against slip ratio at three loads"
          />
          <table className="whitespace-nowrap text-zinc-300 tabular-nums">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="pr-4 font-normal">At {Math.round(sum.fz)} N</th>
                <th className="pr-4 text-right font-normal">B</th>
                <th className="pr-4 text-right font-normal">C</th>
                <th className="pr-4 text-right font-normal">D</th>
                <th className="pr-4 text-right font-normal">E</th>
                <th className="pr-4 text-right font-normal">Peak at</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="pr-4">Cornering</td>
                <td className="pr-4 text-right">{sum.lat.b.toFixed(2)} /rad</td>
                <td className="pr-4 text-right">{sum.lat.c.toFixed(2)}</td>
                <td className="pr-4 text-right">{Math.round(sum.lat.d)} N</td>
                <td className="pr-4 text-right">{sum.lat.e.toFixed(2)}</td>
                <td className="pr-4 text-right">{sum.peakAngle.toFixed(1)}° slip angle</td>
              </tr>
              <tr>
                <td className="pr-4">Drive and brake</td>
                <td className="pr-4 text-right">{sum.lon.b.toFixed(2)}</td>
                <td className="pr-4 text-right">{sum.lon.c.toFixed(2)}</td>
                <td className="pr-4 text-right">{Math.round(sum.lon.d)} N</td>
                <td className="pr-4 text-right">{sum.lon.e.toFixed(2)}</td>
                <td className="pr-4 text-right">{(sum.peakRatio * 100).toFixed(1)}% slip</td>
              </tr>
            </tbody>
          </table>
          <p className="text-zinc-400 tabular-nums">
            Cornering stiffness {Math.round(sum.corneringStiffness)} N/deg per tire. With 90% of the
            cornering grip in use, {(charts.left * 100).toFixed(0)}% of the drive or brake force is
            left (a plain friction ellipse would leave 44%). The launch slip window on this tab
            should bracket {(sum.peakRatio * 100).toFixed(0)}%.
          </p>
        </div>
      </div>
    </section>
  )
}
