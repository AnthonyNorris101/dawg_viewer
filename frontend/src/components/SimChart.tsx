import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTick, niceTicks } from '../analysis/stats'

export interface ChartSeries {
  label: string
  color: string
  x: ArrayLike<number>
  y: ArrayLike<number>
  dash?: string
  width?: number
  right?: boolean
  dots?: boolean
  unit?: string
}

export interface ChartBand {
  from: number
  to: number
  color: string
}

interface Props {
  series: ChartSeries[]
  xLabel: string
  yLabel: string
  rightLabel?: string
  height?: number
  bands?: ChartBand[]
  bandLegend?: { label: string; color: string }[]
  zero?: boolean
  label?: string
}

const DEFAULT_WIDTH = 760
const MIN_WIDTH = 280
const MAX_POINTS = 900

function extent(list: ChartSeries[], pick: 'x' | 'y', zero: boolean): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const s of list) {
    const a = s[pick]
    const other = s[pick === 'x' ? 'y' : 'x']
    for (let i = 0; i < a.length; i++) {
      const v = a[i]
      if (!Number.isFinite(v) || !Number.isFinite(other[i])) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!Number.isFinite(lo)) return [0, 1]
  if (zero && pick === 'y') lo = Math.min(lo, 0)
  if (hi - lo < 1e-9) return [lo - 1, hi + 1]
  if (pick === 'x') return [lo, hi]
  const pad = (hi - lo) * 0.06
  return [zero && lo === 0 ? 0 : lo - pad, hi + pad]
}

export function SimChart({
  series,
  xLabel,
  yLabel,
  rightLabel,
  height = 240,
  bands,
  bandLegend,
  zero = false,
  label,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [W, setW] = useState(DEFAULT_WIDTH)
  useEffect(() => {
    const box = boxRef.current
    if (!box || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const width = Math.round(entries[0].contentRect.width)
      if (width > 0) setW(Math.max(MIN_WIDTH, width))
    })
    ro.observe(box)
    return () => ro.disconnect()
  }, [])
  const M = { left: 54, right: rightLabel ? 54 : 14, top: 10, bottom: bands ? 44 : 34 }
  const pw = W - M.left - M.right
  const ph = height - M.top - M.bottom

  const geo = useMemo(() => {
    const left = series.filter((s) => !s.right)
    const right = series.filter((s) => s.right)
    const [x0, x1] = extent(series, 'x', false)
    const [y0, y1] = extent(left.length ? left : series, 'y', zero)
    const [r0, r1] = right.length ? extent(right, 'y', zero) : [0, 1]
    return { x0, x1, y0, y1, r0, r1 }
  }, [series, zero])
  const { x0, x1, y0, y1, r0, r1 } = geo
  const px = (x: number) => M.left + ((x - x0) / (x1 - x0 || 1)) * pw
  const py = (y: number, right?: boolean) =>
    M.top + ph - ((y - (right ? r0 : y0)) / ((right ? r1 - r0 : y1 - y0) || 1)) * ph

  const paths = series.map((s) => {
    const n = Math.min(s.x.length, s.y.length)
    const stride = Math.max(1, Math.ceil(n / MAX_POINTS))
    let d = ''
    let pen = false
    for (let i = 0; i < n; i += stride) {
      const x = s.x[i]
      const y = s.y[i]
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        pen = false
        continue
      }
      d += `${pen ? 'L' : 'M'}${px(x).toFixed(1)},${py(y, s.right).toFixed(1)}`
      pen = true
    }
    return d
  })

  const xt = niceTicks(x0, x1, W < 480 ? 5 : 8)
  const yt = niceTicks(y0, y1, 5)
  const rt = rightLabel ? niceTicks(r0, r1, 5) : []

  const valueAt = (s: ChartSeries, x: number): number => {
    const n = Math.min(s.x.length, s.y.length)
    if (n === 0 || x < s.x[0] || x > s.x[n - 1]) return NaN
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (s.x[mid] <= x) lo = mid
      else hi = mid
    }
    const span = s.x[hi] - s.x[lo]
    const f = span > 0 ? (x - s.x[lo]) / span : 0
    return s.y[lo] + (s.y[hi] - s.y[lo]) * f
  }
  const monotonic = (s: ChartSeries) => !s.dots

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    const x = x0 + ((((e.clientX - r.left) / r.width) * W - M.left) / pw) * (x1 - x0)
    setHover(x >= x0 && x <= x1 ? x : null)
  }

  return (
    <div ref={boxRef} className="min-w-0 space-y-1">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${height}`}
        className="w-full rounded border border-zinc-800 bg-zinc-950"
        role="img"
        aria-label={label ?? `${yLabel} against ${xLabel}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <g stroke="#27272a">
          {xt.map((t) => (
            <line key={`x${t}`} x1={px(t)} x2={px(t)} y1={M.top} y2={M.top + ph} />
          ))}
          {yt.map((t) => (
            <line key={`y${t}`} x1={M.left} x2={M.left + pw} y1={py(t)} y2={py(t)} />
          ))}
        </g>
        <g fill="#a1a1aa" fontSize="11">
          {xt.map((t) => (
            <text key={`xt${t}`} x={px(t)} y={M.top + ph + 14} textAnchor="middle">
              {formatTick(t, x1 - x0)}
            </text>
          ))}
          {yt.map((t) => (
            <text key={`yt${t}`} x={M.left - 6} y={py(t) + 4} textAnchor="end">
              {formatTick(t, y1 - y0)}
            </text>
          ))}
          {rt.map((t) => (
            <text key={`rt${t}`} x={M.left + pw + 6} y={py(t, true) + 4}>
              {formatTick(t, r1 - r0)}
            </text>
          ))}
          <text x={M.left + pw / 2} y={height - 4} textAnchor="middle" fill="#71717a">
            {xLabel}
          </text>
          <text
            transform={`translate(12 ${M.top + ph / 2}) rotate(-90)`}
            textAnchor="middle"
            fill="#71717a"
          >
            {yLabel}
          </text>
          {rightLabel && (
            <text
              transform={`translate(${W - 6} ${M.top + ph / 2}) rotate(90)`}
              textAnchor="middle"
              fill="#71717a"
            >
              {rightLabel}
            </text>
          )}
        </g>
        {bands?.map((b, i) => (
          <rect
            key={i}
            x={px(b.from)}
            y={M.top + ph + 18}
            width={Math.max(0.5, px(b.to) - px(b.from))}
            height={6}
            fill={b.color}
          />
        ))}
        {series.map((s, i) =>
          s.dots ? (
            <g key={i} fill={s.color}>
              {Array.from({ length: Math.min(s.x.length, s.y.length, 400) }, (_, k) =>
                Number.isFinite(s.x[k]) && Number.isFinite(s.y[k]) ? (
                  <circle key={k} cx={px(s.x[k])} cy={py(s.y[k], s.right)} r={3} />
                ) : null,
              )}
            </g>
          ) : (
            <path
              key={i}
              d={paths[i]}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width ?? 1.6}
              strokeDasharray={s.dash}
              strokeLinejoin="round"
            />
          ),
        )}
        {hover != null && (
          <line x1={px(hover)} x2={px(hover)} y1={M.top} y2={M.top + ph} stroke="#71717a" />
        )}
      </svg>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-400">
        {series.map((s, i) => {
          const v = hover != null && monotonic(s) ? valueAt(s, hover) : NaN
          return (
            <span key={i} className="flex items-center gap-1">
              <span
                className="inline-block h-0.5 w-4"
                style={{
                  background: s.dash
                    ? `repeating-linear-gradient(to right, ${s.color} 0 4px, transparent 4px 7px)`
                    : s.color,
                }}
              />
              {s.label}
              {Number.isFinite(v) && (
                <span className="text-zinc-200 tabular-nums">
                  {formatTick(v, s.right ? r1 - r0 : y1 - y0)}
                  {s.unit ? ` ${s.unit}` : ''}
                </span>
              )}
            </span>
          )
        })}
        {hover != null && (
          <span className="text-zinc-500 tabular-nums">
            at {formatTick(hover, x1 - x0)} {xLabel.replace(/^.*\(|\)$/g, '')}
          </span>
        )}
        {bandLegend && (
          <span className="ml-auto flex flex-wrap items-center gap-2 text-zinc-500">
            {bandLegend.map((b) => (
              <span key={b.label} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: b.color }} />
                {b.label}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}
