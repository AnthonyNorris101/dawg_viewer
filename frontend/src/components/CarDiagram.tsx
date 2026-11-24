import { useMemo, useRef, useState } from 'react'
import { hoverChannel, placeOf, sensorPos, useHoveredChannel, type Pos } from '../data/sensors'

export interface DiagramChannel {
  id: string
  name: string
  label?: string
  color: string
  pos?: number[] | null
}

interface Props {
  channels: DiagramChannel[]
  selectedIds?: string[]
  onPick?: (id: string) => void
  onMove?: (id: string, pos: Pos) => void
  height: number | string
  hint?: string
}

const W = 200
const H = 400
const TOP = -16
const VIEW_H = H - TOP + 4
const BODY = '#3f3f46'
const LINE = '#71717a'
const DARK = '#27272a'

function CarOutline() {
  return (
    <g fill="none" stroke={LINE} strokeWidth="1.5" strokeLinejoin="round">
      <rect x="22" y="8" width="156" height="16" rx="3" fill={DARK} />
      <path d="M88 24 L112 24 L120 96 L80 96 Z" fill={BODY} />
      <rect x="20" y="62" width="30" height="58" rx="6" fill={DARK} />
      <rect x="150" y="62" width="30" height="58" rx="6" fill={DARK} />
      <path d="M50 84 L80 78 M50 98 L80 104 M150 84 L120 78 M150 98 L120 104" />
      <path
        d="M80 96 L74 150 L68 200 L66 300 L74 320 L126 320 L134 300 L132 200 L126 150 L120 96 Z"
        fill={BODY}
      />
      <path d="M68 190 L44 196 L44 250 L68 256 M132 190 L156 196 L156 250 L132 256" fill={BODY} />
      <ellipse cx="100" cy="160" rx="20" ry="34" fill={DARK} />
      <circle cx="100" cy="132" r="8" />
      <path d="M78 204 L122 204" strokeWidth="3" />
      <rect x="80" y="226" width="40" height="66" rx="6" fill={DARK} />
      <path d="M124 250 Q140 262 136 290" strokeWidth="3" />
      <rect x="18" y="276" width="34" height="64" rx="7" fill={DARK} />
      <rect x="148" y="276" width="34" height="64" rx="7" fill={DARK} />
      <path d="M52 296 L74 290 M52 314 L74 318 M148 296 L126 290 M148 314 L126 318" />
      <rect x="34" y="356" width="132" height="22" rx="3" fill={DARK} />
      <path d="M90 320 L90 356 M110 320 L110 356" />
      <text x="100" y="-4" textAnchor="middle" fontSize="11" fill={LINE} stroke="none">
        ▲ FRONT
      </text>
    </g>
  )
}

export function CarDiagram({ channels, selectedIds, onPick, onMove, height, hint }: Props) {
  const hovered = useHoveredChannel()
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<{ id: string; pos: Pos; moved: boolean } | null>(null)
  const selected = useMemo(() => new Set(selectedIds ?? []), [selectedIds])

  const dots = useMemo(() => {
    const placed = channels.flatMap((c) => {
      const p = drag?.id === c.id ? drag.pos : sensorPos(c.name, c.pos)
      return p ? [{ c, p }] : []
    })
    const byPos = new Map<string, typeof placed>()
    for (const d of placed) {
      const key = `${d.p[0].toFixed(3)},${d.p[1].toFixed(3)}`
      const list = byPos.get(key)
      if (list) list.push(d)
      else byPos.set(key, [d])
    }
    return [...byPos.values()].flatMap((group) =>
      group.map((d, i) => {
        if (group.length === 1) return { ...d, x: d.p[0] * W, y: d.p[1] * H }
        const a = (i / group.length) * 2 * Math.PI - Math.PI / 2
        return { ...d, x: d.p[0] * W + Math.cos(a) * 9, y: d.p[1] * H + Math.sin(a) * 9 }
      }),
    )
  }, [channels, drag])

  const toPos = (e: React.PointerEvent): Pos => {
    const svg = svgRef.current!
    const ctm = svg.getScreenCTM()
    if (!ctm) return [0.5, 0.5]
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse())
    const x = Math.min(1, Math.max(0, pt.x / W))
    const y = Math.min(1, Math.max(0, pt.y / H))
    return [Number(x.toFixed(3)), Number(y.toFixed(3))]
  }

  const focus = drag?.id ?? hovered
  const hot = channels.find((c) => c.id === focus)
  const onCar = hot && dots.some((d) => d.c.id === hot.id)

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        ref={svgRef}
        viewBox={`0 ${TOP} ${W} ${VIEW_H}`}
        style={{ height, aspectRatio: `${W} / ${VIEW_H}` }}
        className="block shrink-0 touch-none select-none"
        role="img"
        aria-label="Top view of the car with sensor locations"
        onPointerMove={(e) => drag && setDrag({ id: drag.id, pos: toPos(e), moved: true })}
        onPointerUp={() => {
          if (drag?.moved) onMove?.(drag.id, drag.pos)
          setDrag(null)
        }}
        onPointerLeave={() => {
          if (!drag) hoverChannel.set(null)
        }}
      >
        <CarOutline />
        {dots.map(({ c, x, y }) => {
          const on = selected.has(c.id)
          const isHot = focus === c.id
          return (
            <g
              key={c.id}
              className={onMove ? 'cursor-grab' : onPick ? 'cursor-pointer' : ''}
              onPointerEnter={() => hoverChannel.set(c.id)}
              onPointerDown={(e) => {
                if (!onMove) return
                svgRef.current?.setPointerCapture(e.pointerId)
                setDrag({ id: c.id, pos: sensorPos(c.name, c.pos) ?? toPos(e), moved: false })
              }}
              onClick={() => {
                if (!onMove) onPick?.(c.id)
              }}
            >
              <title>{c.label || c.name}</title>
              <circle cx={x} cy={y} r="10" fill="transparent" />
              {isHot && (
                <>
                  <circle cx={x} cy={y} r="11" fill="none" stroke={c.color} strokeWidth="2" />
                  <circle
                    className="sensor-pulse"
                    cx={x}
                    cy={y}
                    r="11"
                    fill="none"
                    stroke={c.color}
                    strokeWidth="2.5"
                  />
                </>
              )}
              <circle
                cx={x}
                cy={y}
                r={isHot ? 7 : 5}
                fill={on || isHot ? c.color : '#18181b'}
                stroke={c.color}
                strokeWidth="2"
                opacity={on || isHot || !focus ? 1 : 0.45}
              />
            </g>
          )
        })}
      </svg>
      <p className="min-h-8 w-full px-1 text-center text-xs leading-4">
        {hot ? (
          <>
            <span className="font-medium" style={{ color: hot.color }}>
              {hot.label || hot.name}
            </span>
            <br />
            <span className="text-zinc-400">{onCar ? placeOf(hot) : 'not on the car map yet'}</span>
          </>
        ) : (
          <span className="text-zinc-500">{hint}</span>
        )}
      </p>
    </div>
  )
}
