import { useMemo, useState } from 'react'
import {
  axleOf,
  criticalDamping,
  dampingRatio,
  parseShockDyno,
  type Axle,
  type DamperSetting,
} from '../analysis/sim/damper'
import { SimChart, type ChartSeries } from '../components/SimChart'
import type { CarSpecs } from '../data/car'
import { dampers, useDampers } from '../state/dampers'
import { pickTextFile } from '../state/storage'
import { toolbarButton } from '../ui'
import { Empty } from './common'
import { card, field, heading, num } from './shared'

const LOW = 0.025
const HIGH = 0.125
const COLORS = ['#f87171', '#60a5fa', '#34d399', '#fbbf24', '#c084fc', '#22d3ee']
const IMPORTED = 'shock dyno file'
const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : '–')

export function DamperSection({ car }: { car: CarSpecs }) {
  const data = useDampers()
  const [note, setNote] = useState('')
  const [shock, setShock] = useState('')
  const [axleChoice, setAxleChoice] = useState<Axle | ''>('')
  const [picked, setPicked] = useState<string[]>([])

  const shocks = useMemo(() => [...new Set((data?.settings ?? []).map((s) => s.shock))], [data])
  const current = shocks.includes(shock) ? shock : (shocks[0] ?? '')
  const axle: Axle = axleChoice || axleOf(current)
  const rows = useMemo(
    () => (data?.settings ?? []).filter((s) => s.shock === current),
    [data, current],
  )
  const id = (s: DamperSetting) => `${s.setting}|${s.lever}`
  const shown = rows.filter((s) => picked.includes(id(s)))
  const plotted = shown.length > 0 ? shown : rows.slice(0, 1)

  const importFile = async () => {
    const text = await pickTextFile('.csv,.tsv,.txt')
    if (text == null) return
    const parsed = parseShockDyno(text)
    if (typeof parsed === 'string') return setNote(parsed)
    dampers.set({ file: IMPORTED, settings: parsed })
    setPicked([])
    setNote(
      `Read ${parsed.length} settings for ${new Set(parsed.map((p) => p.shock)).size} shocks.`,
    )
  }

  const series: ChartSeries[] = plotted.flatMap((s, i) => {
    const color = COLORS[i % COLORS.length]
    const x = s.points.map((p) => p.v * 1000)
    return [
      { label: `${s.setting} compression`, color, x, y: s.points.map((p) => p.comp), unit: 'N' },
      {
        label: `${s.setting} rebound`,
        color,
        dash: '5 4',
        x,
        y: s.points.map((p) => -p.reb),
        unit: 'N',
      },
    ]
  })

  return (
    <div className="space-y-4">
      <section className={card}>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={heading}>Shock dyno data</h2>
          <span className="rounded bg-zinc-700/60 px-1 text-[9px] tracking-wide text-zinc-300 uppercase">
            measured on the shock dyno
          </span>
          {data && data.file !== IMPORTED && (
            <span
              className="rounded bg-sky-500/25 px-1 text-[9px] tracking-wide text-sky-100 uppercase"
              title="Where this shock dyno table came from. Import your own file to replace it."
            >
              {data.file}
            </span>
          )}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {shocks.length > 0 && (
              <>
                <label className="flex items-center gap-1.5 text-zinc-400">
                  Shock
                  <select
                    aria-label="Shock"
                    className={field}
                    value={current}
                    onChange={(e) => {
                      setShock(e.target.value)
                      setAxleChoice('')
                      setPicked([])
                    }}
                  >
                    {shocks.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label
                  className="flex items-center gap-1.5 text-zinc-400"
                  title="Which end of the car the shock is on. This picks the wheel rate, motion ratio and corner mass used for the damping ratio"
                >
                  On the
                  <select
                    aria-label="Axle the shock is on"
                    className={field}
                    value={axle}
                    onChange={(e) => setAxleChoice(e.target.value as Axle)}
                  >
                    <option value="front">front</option>
                    <option value="rear">rear</option>
                  </select>
                </label>
              </>
            )}
            <button type="button" className={toolbarButton} onClick={() => void importFile()}>
              Import shock dyno file…
            </button>
          </span>
        </div>
        {note && <p className="text-zinc-300">{note}</p>}
        {rows.length === 0 ? (
          <Empty>
            Import the shock dyno table (the AvgCurves sheet saved as CSV, with Shock, Setting,
            TestSpeed_ips, Velocity_ips, Comp_lb and Rebound_lb columns) to see the force curves and
            the damping ratio each click setting gives on this car.
          </Empty>
        ) : (
          <>
            <SimChart
              series={series}
              xLabel="Shaft speed (mm/s)"
              yLabel="Damping force (N)"
              height={260}
              label="Damper force against shaft speed"
            />
            <p className="text-zinc-400">
              Force at the peak speed of each dyno run, with the gas force taken out. Solid is
              compression, dashed is rebound. Tick rows below to compare settings.
            </p>
          </>
        )}
      </section>

      {rows.length > 0 && (
        <section className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className={heading}>Damping ratio on this car, {axle} axle</h2>
            <span className="rounded bg-sky-500/20 px-1 text-[9px] tracking-wide text-sky-200 uppercase">
              calculated
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full tabular-nums">
              <thead className="text-left text-xs text-zinc-500">
                <tr>
                  <th className="font-normal" />
                  <th className="pr-3 font-normal">Setting</th>
                  <th className="pr-3 font-normal">LSC / HSC / LSR / HSR</th>
                  <th className="pr-3 text-right font-normal">Compression at 25 mm/s</th>
                  <th className="pr-3 text-right font-normal">Rebound at 25 mm/s</th>
                  <th className="pr-3 text-right font-normal">Compression at 125 mm/s</th>
                  <th className="pr-3 text-right font-normal">Rebound at 125 mm/s</th>
                  <th className="text-right font-normal">Gas force</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const low = dampingRatio(car, axle, s, LOW)
                  const high = dampingRatio(car, axle, s, HIGH)
                  const on = picked.includes(id(s))
                  return (
                    <tr key={id(s)} className="border-t border-zinc-800/60">
                      <td className="pr-2">
                        <input
                          type="checkbox"
                          aria-label={`Plot ${s.setting}`}
                          checked={on}
                          onChange={() =>
                            setPicked(on ? picked.filter((p) => p !== id(s)) : [...picked, id(s)])
                          }
                        />
                      </td>
                      <td className="pr-3 text-zinc-200">
                        {s.setting}
                        {s.lever && !s.setting.includes(s.lever) ? ` (${s.lever})` : ''}
                      </td>
                      <td className="pr-3 text-zinc-400">
                        {s.clicks
                          ? `${s.clicks.lsc} / ${s.clicks.hsc} / ${s.clicks.lsr} / ${s.clicks.hsr}`
                          : '–'}
                      </td>
                      <td className="pr-3 text-right">{pct(low.comp)}</td>
                      <td className="pr-3 text-right">{pct(low.reb)}</td>
                      <td className="pr-3 text-right">{pct(high.comp)}</td>
                      <td className="pr-3 text-right">{pct(high.reb)}</td>
                      <td className="text-right text-zinc-400">{num(s.gas, 0)} N</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-zinc-400">
            Percent of critical damping: the damper’s force ÷ speed, brought to the wheel with the
            motion ratio squared, over 2·√(wheel rate × sprung corner mass) from the Car tab (
            {num(criticalDamping(car, axle), 0)} N·s/m here). The forces are measured; the wheel
            rate, motion ratio and masses are whatever the Car tab holds, so this is only as good as
            those. 100% is critical; most race cars run about 60–80% at low shaft speed.
          </p>
        </section>
      )}
    </div>
  )
}
