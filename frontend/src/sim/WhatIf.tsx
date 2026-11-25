import { paramOf, SIM_PARAMS } from '../analysis/sim/sweep'
import type { CarSpecs } from '../data/car'
import { updateSim, useSim } from '../state/sim'
import { toolbarButton } from '../ui'
import { NumberInput } from './common'
import { card, field, heading, num, WHATIF_COLOR } from './shared'

export function WhatIf({ car }: { car: CarSpecs }) {
  const { overrides } = useSim()
  const keys = Object.keys(overrides).filter((k) => paramOf(k))
  const unused = SIM_PARAMS.filter((p) => !(p.key in overrides))
  const set = (next: Record<string, number>) => updateSim({ overrides: next })
  const digits = (step: number) => (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3)

  return (
    <section className={card}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={heading}>What-if car</h2>
        <span className="text-xs text-zinc-500">
          Change anything here to compare it with the car from the Car tab. Nothing is saved to the
          car.
        </span>
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            className={toolbarButton}
            disabled={unused.length === 0}
            onClick={() => {
              const p = unused[0]
              set({ ...overrides, [p.key]: Number(p.get(car).toFixed(4)) })
            }}
          >
            + Add a change
          </button>
          {keys.length > 0 && (
            <button type="button" className={toolbarButton} onClick={() => set({})}>
              Clear
            </button>
          )}
        </span>
      </div>
      {keys.length === 0 ? (
        <p className="text-zinc-500">
          No changes yet. Add one (a different final drive, an anti-roll bar, 10 kg less…) and every
          result on this tab shows both cars.
        </p>
      ) : (
        <div className="space-y-1.5">
          {keys.map((key) => {
            const p = paramOf(key)!
            const base = p.get(car)
            return (
              <div key={key} className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="What to change"
                  className={`${field} w-56`}
                  value={key}
                  onChange={(e) => {
                    const next = paramOf(e.target.value)
                    if (!next) return
                    const rest = Object.fromEntries(
                      Object.entries(overrides).filter(([k]) => k !== key),
                    )
                    set({ ...rest, [next.key]: Number(next.get(car).toFixed(4)) })
                  }}
                >
                  {[p, ...unused].map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <NumberInput
                  label={`What-if ${p.label}`}
                  step={p.step}
                  className={`${field} w-28`}
                  accent={`${WHATIF_COLOR}80`}
                  value={overrides[key]}
                  onCommit={(v) => set({ ...overrides, [key]: v })}
                />
                <span className="text-zinc-500">{p.unit}</span>
                <span className="text-xs text-zinc-500 tabular-nums">
                  car: {num(base, digits(p.step))} {p.unit}
                </span>
                <button
                  type="button"
                  aria-label={`Remove the ${p.label} change`}
                  className="text-zinc-600 hover:text-red-300"
                  onClick={() =>
                    set(Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== key)))
                  }
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
