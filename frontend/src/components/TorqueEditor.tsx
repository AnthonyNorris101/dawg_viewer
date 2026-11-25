import { useState } from 'react'
import { KW_TO_HP, peaks, torqueSeries } from '../analysis/sim/powertrain'
import { parseTorqueCsv } from '../analysis/sim/torqueCsv'
import { cleanTorque, PLACEHOLDER_TORQUE, type TorquePoint } from '../data/car'
import { pickTextFile } from '../state/storage'
import { toolbarButton } from '../ui'
import { SimChart } from './SimChart'

const cell =
  'w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-sm text-zinc-100 tabular-nums outline-none focus:border-red-500'

const toRows = (curve: TorquePoint[]) => curve.map(([rpm, nm]) => [String(rpm), String(nm)])

export function TorqueEditor({
  curve,
  redline,
  driveEff,
  onChange,
}: {
  curve: TorquePoint[]
  redline: number
  driveEff: number
  onChange: (curve: TorquePoint[]) => void
}) {
  const [rows, setRows] = useState(() => toRows(curve))
  const [note, setNote] = useState('')
  const [atWheels, setAtWheels] = useState(false)
  const placeholder = curve === PLACEHOLDER_TORQUE

  const edit = (next: string[][]) => {
    setRows(next)
    const parsed = cleanTorque(
      next.map(([rpm, nm]) => [Number(rpm), nm.trim() === '' ? NaN : Number(nm)]),
    )
    if (parsed.length >= 2) onChange(parsed)
  }
  const replace = (next: TorquePoint[], message: string) => {
    setRows(toRows(next))
    setNote(message)
    onChange(next)
  }
  const importFile = async () => {
    const text = await pickTextFile('.csv,.txt,.tsv,.dat')
    if (text == null) return
    const result = parseTorqueCsv(text)
    if (typeof result === 'string') return setNote(result)
    replace(result.points, result.note)
  }

  const s = torqueSeries(curve, redline)
  const p = peaks({ torque: curve, redline })

  return (
    <section className="space-y-3 rounded-lg border border-zinc-800 p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[11px] tracking-wider text-zinc-500 uppercase">Engine torque curve</h2>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <button type="button" className={toolbarButton} onClick={() => void importFile()}>
            Import dyno file…
          </button>
          <button
            type="button"
            className={toolbarButton}
            disabled={placeholder}
            title="Go back to the built-in stand-in curve"
            onClick={() => replace(PLACEHOLDER_TORQUE, '')}
          >
            Typical restricted 600 cc
          </button>
        </span>
      </div>
      {placeholder && (
        <p className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-200">
          This is a stand-in curve for a restricted 600 cc engine, not your engine. Import a dyno
          file (RPM with torque or power), type your own points, or build one from a full-throttle
          pull on the Sim tab.
        </p>
      )}
      {note && <p className="text-zinc-400">{note}</p>}
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <div className="space-y-2">
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            <div className="flex gap-2 text-xs text-zinc-500">
              <span className="w-24">RPM</span>
              <span className="w-24">Torque (N·m)</span>
            </div>
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                {[0, 1].map((k) => (
                  <input
                    key={k}
                    type="number"
                    aria-label={`${k === 0 ? 'RPM' : 'Torque'} of point ${i + 1}`}
                    step={k === 0 ? 250 : 0.5}
                    className={cell}
                    value={r[k]}
                    onChange={(e) =>
                      edit(
                        rows.map((x, j) =>
                          j === i ? (k === 0 ? [e.target.value, x[1]] : [x[0], e.target.value]) : x,
                        ),
                      )
                    }
                  />
                ))}
                <button
                  type="button"
                  aria-label={`Remove point ${i + 1}`}
                  className="text-zinc-600 hover:text-red-300 disabled:opacity-30"
                  disabled={rows.length <= 2}
                  onClick={() => edit(rows.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={toolbarButton}
              onClick={() => {
                const last = rows[rows.length - 1] ?? ['3000', '40']
                edit([...rows, [String((Number(last[0]) || 0) + 500), last[1]]])
              }}
            >
              Add point
            </button>
            <label
              className="flex items-center gap-1.5 text-xs text-zinc-400"
              title="A chassis dyno reads what reaches the wheels. Tick this once to raise the curve by the drivetrain loss, so the simulator does not take the loss off twice."
            >
              <input
                type="checkbox"
                checked={atWheels}
                onChange={(e) => {
                  const on = e.target.checked
                  setAtWheels(on)
                  replace(
                    curve.map(([rpm, nm]) => [
                      rpm,
                      Number((on ? nm / driveEff : nm * driveEff).toFixed(2)),
                    ]),
                    on
                      ? `Raised by 1 ÷ ${driveEff.toFixed(2)} (the drivetrain efficiency) to turn wheel torque into crank torque.`
                      : 'Back to the values as measured.',
                  )
                }}
              />
              Measured at the wheels
            </label>
          </div>
        </div>
        <div className="min-w-0 space-y-1">
          <SimChart
            series={[
              { label: 'Torque', color: '#f87171', x: s.rpm, y: s.nm, unit: 'N·m' },
              { label: 'Power', color: '#60a5fa', x: s.rpm, y: s.kw, right: true, unit: 'kW' },
              {
                label: 'Your points',
                color: '#fafafa',
                x: curve.map((c) => c[0]),
                y: curve.map((c) => c[1]),
                dots: true,
              },
            ]}
            xLabel="Engine speed (rpm)"
            yLabel="Torque (N·m)"
            rightLabel="Power (kW)"
            height={230}
            zero
            label="Engine torque and power curve"
          />
          <p className="text-zinc-400 tabular-nums">
            Peak {p.torque.nm.toFixed(1)} N·m at {Math.round(p.torque.rpm)} rpm ·{' '}
            {p.power.kw.toFixed(1)} kW ({(p.power.kw * KW_TO_HP).toFixed(0)} hp) at{' '}
            {Math.round(p.power.rpm)} rpm. Torque is at the crank, at full throttle.
          </p>
        </div>
      </div>
    </section>
  )
}
