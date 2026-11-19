import { formatTick, niceTicks } from '../analysis/stats'
import type { Point } from '../data/calibration'

const W = 520
const H = 200
const M = { left: 52, right: 12, top: 10, bottom: 30 }

export function CalGraph({
  fn,
  points,
  range,
  current,
  unit,
}: {
  fn: ((raw: number) => number) | null
  points: Point[]
  range: [number, number]
  current?: number
  unit: string
}) {
  const [x0, x1] = range
  const curve: Point[] = []
  if (fn && x1 > x0) {
    for (let i = 0; i <= 160; i++) {
      const x = x0 + ((x1 - x0) * i) / 160
      const y = fn(x)
      if (Number.isFinite(y)) curve.push([x, y])
    }
  }
  const ys = [...curve.map((p) => p[1]), ...points.map((p) => p[1])]
  let y0 = Math.min(...ys)
  let y1 = Math.max(...ys)
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) {
    y0 = 0
    y1 = 1
  }
  if (y1 - y0 < 1e-9) {
    y0 -= 1
    y1 += 1
  }
  const pad = (y1 - y0) * 0.08
  y0 -= pad
  y1 += pad
  const pw = W - M.left - M.right
  const ph = H - M.top - M.bottom
  const px = (x: number) => M.left + ((x - x0) / (x1 - x0 || 1)) * pw
  const py = (y: number) => M.top + ph - ((y - y0) / (y1 - y0)) * ph
  const xt = niceTicks(x0, x1, 6)
  const yt = niceTicks(y0, y1, 5)
  const path = curve.map(([x, y], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)},${py(y).toFixed(1)}`)

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full rounded border border-zinc-800 bg-zinc-950"
      role="img"
      aria-label="Calibration curve"
    >
      <g stroke="#27272a">
        {xt.map((t) => (
          <line key={`x${t}`} x1={px(t)} x2={px(t)} y1={M.top} y2={M.top + ph} />
        ))}
        {yt.map((t) => (
          <line key={`y${t}`} x1={M.left} x2={M.left + pw} y1={py(t)} y2={py(t)} />
        ))}
      </g>
      <g fill="#a1a1aa" fontSize="10">
        {xt.map((t) => (
          <text key={`xl${t}`} x={px(t)} y={H - 16} textAnchor="middle">
            {formatTick(t, x1 - x0)}
          </text>
        ))}
        {yt.map((t) => (
          <text key={`yl${t}`} x={M.left - 6} y={py(t) + 3} textAnchor="end">
            {formatTick(t, y1 - y0)}
          </text>
        ))}
        <text x={M.left + pw / 2} y={H - 3} textAnchor="middle">
          raw reading
        </text>
        <text
          x={12}
          y={M.top + ph / 2}
          textAnchor="middle"
          transform={`rotate(-90 12 ${M.top + ph / 2})`}
        >
          {unit || 'value'}
        </text>
      </g>
      <svg x={M.left} y={M.top} width={pw} height={ph} overflow="hidden">
        <g transform={`translate(${-M.left} ${-M.top})`}>
          {current !== undefined && Number.isFinite(current) && current >= x0 && current <= x1 && (
            <line
              x1={px(current)}
              x2={px(current)}
              y1={M.top}
              y2={M.top + ph}
              stroke="#facc15"
              strokeDasharray="4 3"
            />
          )}
          <path d={path.join('')} fill="none" stroke="#f87171" strokeWidth="2" />
          {points.map(([x, y], i) => (
            <circle key={i} cx={px(x)} cy={py(y)} r="4" fill="#fafafa" stroke="#09090b" />
          ))}
        </g>
      </svg>
    </svg>
  )
}
