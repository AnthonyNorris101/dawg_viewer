import { useMemo } from 'react'
import { cornering, G, handling } from '../analysis/sim/grip'
import { skidpadTime } from '../analysis/sim/lapsim'
import { SKIDPAD_RADIUS } from '../analysis/sim/simtrack'
import { suspension, type Suspension } from '../analysis/sim/suspension'
import { SimChart, type ChartSeries } from '../components/SimChart'
import type { CarSpecs } from '../data/car'
import { Stat } from './common'
import { BASE_COLOR, card, heading, KMH, num, WHATIF_COLOR, type SimCars } from './shared'

function verdict(front: number, rear: number): string {
  const spare = Math.abs(front - rear) * 100
  if (spare < 0.5) return 'Neutral: both ends run out of grip together'
  return front > rear
    ? `Understeer: the front runs out first, the rear has ${spare.toFixed(1)}% in hand`
    : `Oversteer: the rear runs out first, the front has ${spare.toFixed(1)}% in hand`
}

function rowsOf(s: Suspension): [string, string, string][] {
  return [
    ['Wheel rate', `${num(s.wheelRateF, 1)} N/mm`, `${num(s.wheelRateR, 1)} N/mm`],
    ['Ride rate (with the tire)', `${num(s.rideRateF, 1)} N/mm`, `${num(s.rideRateR, 1)} N/mm`],
    ['Ride frequency', `${num(s.freqF, 2)} Hz`, `${num(s.freqR, 2)} Hz`],
    ['Roll stiffness', `${num(s.rollStiffF, 0)} N·m/deg`, `${num(s.rollStiffR, 0)} N·m/deg`],
    [
      'Share of lateral load transfer',
      `${num(s.lltd * 100, 1)}%`,
      `${num((1 - s.lltd) * 100, 1)}%`,
    ],
  ]
}

export function BalanceSection({ cars }: { cars: SimCars }) {
  const { car, variant, limits, variantLimits } = cars
  const s = useMemo(() => suspension(car), [car])
  const sv = useMemo(() => (variant ? suspension(variant) : null), [variant])
  const pad = skidpadTime(limits, SKIDPAD_RADIUS)
  const padV = variantLimits ? skidpadTime(variantLimits, SKIDPAD_RADIUS) : null
  const at = (c: CarSpecs, sus: Suspension, v: number) => cornering(c, v, sus)
  const slow = at(car, s, pad.v)
  const fast = at(car, s, 25)
  const slowV = variant && sv && padV ? at(variant, sv, padV.v) : null
  const fastV = variant && sv ? at(variant, sv, 25) : null
  const feel = handling(car, pad.v, slow.ay, s)
  const feelV = variant && sv && padV && slowV ? handling(variant, padV.v, slowV.ay, sv) : null

  const top = Math.min(limits.vTop, 45)
  const speeds = Array.from({ length: 61 }, (_, i) => (top * i) / 60)
  const x = speeds.map((v) => v * KMH)
  const pick = (a: Float64Array, dv: number, scale: number) =>
    speeds.map((v) => a[Math.min(a.length - 1, Math.round(v / dv))] * scale)
  const grip: ChartSeries[] = [
    {
      label: 'Cornering limit',
      color: BASE_COLOR,
      x,
      y: pick(limits.lat, limits.dv, 1 / G),
      unit: 'g',
      width: 2,
    },
  ]
  const use: ChartSeries[] = [
    {
      label: 'Front tires used',
      color: '#60a5fa',
      x,
      y: pick(limits.frontUse, limits.dv, 100),
      unit: '%',
    },
    {
      label: 'Rear tires used',
      color: '#34d399',
      x,
      y: pick(limits.rearUse, limits.dv, 100),
      unit: '%',
    },
  ]
  if (variantLimits) {
    grip.push({
      label: 'What-if',
      color: WHATIF_COLOR,
      dash: '5 4',
      x,
      y: pick(variantLimits.lat, variantLimits.dv, 1 / G),
      unit: 'g',
    })
    use.push(
      {
        label: 'What-if front',
        color: '#60a5fa',
        dash: '5 4',
        x,
        y: pick(variantLimits.frontUse, variantLimits.dv, 100),
        unit: '%',
      },
      {
        label: 'What-if rear',
        color: '#34d399',
        dash: '5 4',
        x,
        y: pick(variantLimits.rearUse, variantLimits.dv, 100),
        unit: '%',
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Skidpad lap"
          value={pad.time}
          unit="s"
          digits={3}
          other={padV?.time}
          note={`${num(pad.v * KMH, 1)} km/h on a ${SKIDPAD_RADIUS} m radius`}
        />
        <Stat
          label="Skidpad grip"
          value={pad.g}
          unit="g"
          digits={2}
          other={padV?.g}
          lowerIsBetter={false}
        />
        <Stat
          label="Roll gradient"
          value={s.rollGradient}
          unit="deg/g"
          digits={2}
          other={sv?.rollGradient}
          note={`${num(s.rollGradient * pad.g, 1)}° of roll on the skidpad`}
        />
        <Stat
          label="Front share of load transfer"
          value={s.lltd * 100}
          unit="%"
          digits={1}
          other={sv ? sv.lltd * 100 : null}
          lowerIsBetter={false}
          note={`static front weight ${num((1 - car.rearWeight) * 100, 0)}%`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat
          label="Understeer gradient"
          value={feel.understeer}
          unit="deg/g"
          digits={2}
          other={feelV?.understeer}
          lowerIsBetter={false}
          note="below the limit; positive is understeer"
        />
        <Stat
          label="Front slip angle on the skidpad"
          value={feel.slipFront}
          unit="°"
          digits={1}
          other={feelV?.slipFront}
        />
        <Stat
          label="Rear slip angle on the skidpad"
          value={feel.slipRear}
          unit="°"
          digits={1}
          other={feelV?.slipRear}
        />
        <Stat
          label="Cornering stiffness, front / rear"
          value={feel.stiffFront}
          unit={`/ ${num(feel.stiffRear, 0)} N/deg`}
          digits={0}
          other={null}
          note="per axle, from the Magic Formula on the Car tab"
        />
      </div>

      <section className={card}>
        <h2 className={heading}>Balance at the limit</h2>
        <table className="w-full tabular-nums">
          <thead className="text-zinc-500">
            <tr>
              <th className="text-left font-normal" />
              <th className="text-left font-normal">Car tab</th>
              {variant && <th className="text-left font-normal">What-if</th>}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="pr-3 text-zinc-300">Skidpad speed</td>
              <td>{verdict(slow.frontUse, slow.rearUse)}</td>
              {slowV && <td>{verdict(slowV.frontUse, slowV.rearUse)}</td>}
            </tr>
            <tr>
              <td className="pr-3 text-zinc-300">90 km/h corner</td>
              <td>{verdict(fast.frontUse, fast.rearUse)}</td>
              {fastV && <td>{verdict(fastV.frontUse, fastV.rearUse)}</td>}
            </tr>
          </tbody>
        </table>
        <p className="text-zinc-400">
          In a steady corner each axle has to supply its share of the sideways force (the same split
          as the static weight). The outside tire gains load and the inside one loses it, and
          because a tire&apos;s μ falls as its load rises ({num(car.tireLoadGrip * 100, 0)}% kept at
          double load), the pair grips less the more load is moved across. Stiffening one end
          (spring, anti-roll bar, higher roll center) moves more of the transfer to that end and
          takes grip away from it. The Magic Formula adds a second, smaller loss: once their loads
          differ, the two tires on an axle peak at different slip angles, so they cannot both be at
          their best.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className={heading}>Cornering limit against speed</h2>
          <SimChart
            series={grip}
            xLabel="Speed (km/h)"
            yLabel="Lateral g"
            height={230}
            label="Cornering limit against speed"
          />
          <p className="text-zinc-400">
            Flat without downforce; it rises with speed once ClA is set on the Car tab.
          </p>
        </section>
        <section className={card}>
          <h2 className={heading}>How hard each end works at the limit</h2>
          <SimChart
            series={use}
            xLabel="Speed (km/h)"
            yLabel="Grip used (%)"
            height={230}
            label="Front and rear grip used at the cornering limit"
          />
          <p className="text-zinc-400">
            The end at 100% is the one that slides first. If the lines cross, the balance changes
            with speed, which is the aero balance at work.
          </p>
        </section>
      </div>

      <section className={card}>
        <h2 className={heading}>Suspension, worked out</h2>
        <div className={`grid gap-6 ${sv ? 'md:grid-cols-2' : ''}`}>
          {[
            { name: 'Car tab', rows: rowsOf(s), color: BASE_COLOR },
            ...(sv ? [{ name: 'What-if', rows: rowsOf(sv), color: WHATIF_COLOR }] : []),
          ].map((t) => (
            <table key={t.name} className="w-full tabular-nums">
              <thead className="text-zinc-500">
                <tr className="text-right">
                  <th className="text-left font-normal" style={{ color: t.color }}>
                    {t.name}
                  </th>
                  <th className="font-normal">Front</th>
                  <th className="font-normal">Rear</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.map(([name, front, rear]) => (
                  <tr key={name} className="text-right">
                    <td className="text-left text-zinc-300">{name}</td>
                    <td>{front}</td>
                    <td>{rear}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </section>
    </div>
  )
}
