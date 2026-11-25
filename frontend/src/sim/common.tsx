import { useState, type ReactNode } from 'react'
import { heading, num, WHATIF_COLOR } from './shared'

export function Change({
  base,
  other,
  digits,
  unit,
  lowerIsBetter = true,
}: {
  base: number
  other: number
  digits: number
  unit: string
  lowerIsBetter?: boolean
}) {
  const d = other - base
  if (!Number.isFinite(d)) return null
  const flat = Math.abs(d) < 0.5 * 10 ** -digits
  const good = lowerIsBetter ? d < 0 : d > 0
  return (
    <span className={flat ? 'text-zinc-500' : good ? 'text-emerald-400' : 'text-red-400'}>
      {flat ? 'no change' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(digits)} ${unit}`}
    </span>
  )
}

export function Stat({
  label,
  value,
  unit,
  digits,
  other,
  lowerIsBetter,
  note,
}: {
  label: string
  value: number
  unit: string
  digits: number
  other?: number | null
  lowerIsBetter?: boolean
  note?: ReactNode
}) {
  return (
    <div className="min-w-0 rounded-lg border border-zinc-800 px-3 py-2">
      <div className={heading}>{label}</div>
      <div className="text-xl font-semibold tabular-nums">
        {num(value, digits)} <span className="text-sm font-normal text-zinc-500">{unit}</span>
      </div>
      {other != null && Number.isFinite(other) && (
        <div className="text-xs tabular-nums">
          <span style={{ color: WHATIF_COLOR }}>What-if {num(other, digits)}</span>{' '}
          <Change
            base={value}
            other={other}
            digits={digits}
            unit={unit}
            lowerIsBetter={lowerIsBetter}
          />
        </div>
      )}
      {note && <div className="text-xs text-zinc-500">{note}</div>}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded border border-zinc-800 px-3 py-6 text-center text-zinc-500">{children}</p>
  )
}

export function NumberInput({
  value,
  onCommit,
  label,
  className,
  step,
  min,
  max,
  accent,
}: {
  value: number
  onCommit: (v: number) => void
  label: string
  className?: string
  step?: number
  min?: number
  max?: number
  accent?: string
}) {
  const [text, setText] = useState<string | null>(null)
  return (
    <input
      type="number"
      aria-label={label}
      step={step}
      min={min}
      max={max}
      className={className}
      style={accent ? { borderColor: accent } : undefined}
      value={text ?? String(value)}
      onFocus={() => setText(String(value))}
      onBlur={() => setText(null)}
      onChange={(e) => {
        setText(e.target.value)
        const v = Number(e.target.value)
        if (e.target.value.trim() === '' || !Number.isFinite(v)) return
        if ((min != null && v < min) || (max != null && v > max)) return
        onCommit(v)
      }}
    />
  )
}
