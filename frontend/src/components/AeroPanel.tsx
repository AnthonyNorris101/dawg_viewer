import { memo, useEffect, useMemo, useRef, type Dispatch } from 'react'
import {
  AERO_PERCENTILE,
  fitAero,
  G,
  gripBySpeed,
  gripLimitG,
  type AeroFit,
  type SpeedBin,
} from '../analysis/aero'
import { speedFromDistance } from '../analysis/launch'
import { findSpeed, guessSpeedUnit, TO_MPS } from '../analysis/track'
import { useCar } from '../data/car'
import { channelTitle, type Channel, type Session } from '../data/session'
import { drawAxes, mountCanvas, plotFrame, SLOT_COLORS } from '../plot/canvas'
import type { ViewSync } from '../plot/sync'
import type { LayoutAction, Panel } from '../state/layout'
import type { XView } from '../viewer/xview'
import { addReference, changePct, useReferences, type AeroReference } from '../state/references'
import { CompareControls } from './CompareControls'
import { PanelFrame } from './PanelFrame'

interface Props {
  panel: Panel
  index: number
  active: boolean
  session: Session
  view: XView
  sync: ViewSync
  dispatch: Dispatch<LayoutAction>
  distance: Float64Array | null
  distanceFromGps: boolean
}

const MAX_POINTS = 30_000
const BIN_MPS = 2
const MIN_MPS = 3
const LIMIT = '#34d399'
const TYRES = '#71717a'
const FIT = '#f472b6'
const MEASURED = '#fafafa'

const findAccel = (channels: Channel[], axis: 'x' | 'y') =>
  channels.find((c) => new RegExp(`^acc(el)?[ _]?${axis}$`, 'i').test(c.name))

const inG = (c: Channel) =>
  /m\/s/i.test(c.unit) ? Float64Array.from(c.data, (v) => v / G) : c.data

function Swatch({ color, dash, label }: { color: string; dash?: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-zinc-400">
      <svg width="16" height="6" aria-hidden className="shrink-0">
        <line
          x1="0"
          y1="3"
          x2="16"
          y2="3"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dash ? '4 3' : undefined}
        />
      </svg>
      {label}
    </span>
  )
}

export const AeroPanel = memo(function AeroPanel({
  panel,
  index,
  active,
  session,
  view,
  sync,
  dispatch,
  distance,
  distanceFromGps,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const infoRef = useRef<HTMLParagraphElement>(null)
  const car = useCar()
  const lateral = panel.gMode === 'lateral'
  const refs = useReferences()
  const compare = refs.find((r): r is AeroReference => r.id === panel.ref && r.kind === 'aero')
  const latest = useRef<{ bins: SpeedBin[]; fit: AeroFit | null } | null>(null)

  const inputs = useMemo(() => {
    const ax = findAccel(session.channels, 'x')
    const ay = findAccel(session.channels, 'y')
    const sp = findSpeed(session.channels)
    let speed: Float64Array | null = null
    let speedLabel = ''
    let unit: 'mph' | 'km/h' = 'km/h'
    if (sp) {
      const u = guessSpeedUnit(sp.unit)
      speed = Float64Array.from(sp.data, (v) => v * TO_MPS[u])
      speedLabel = channelTitle(sp)
      if (u === 'mph') unit = 'mph'
    } else if (distance && distanceFromGps) {
      speed = speedFromDistance(session.time, distance)
      speedLabel = 'GPS'
    }
    if (!speed || !ay || (!lateral && !ax)) return null
    const y = inG(ay)
    const x = ax ? inG(ax) : null
    const g = new Float64Array(speed.length)
    for (let i = 0; i < g.length; i++) {
      g[i] = lateral || !x ? Math.abs(y[i]) : Math.hypot(x[i], y[i])
    }
    return { speed, g, speedLabel, unit, k: unit === 'mph' ? 2.23694 : 3.6 }
  }, [session, distance, distanceFromGps, lateral])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !inputs) return
    const { speed, g, unit, k } = inputs
    let cached: { key: string; bins: SpeedBin[]; fit: AeroFit | null } | null = null
    let movedAt = -Infinity
    let settle = 0
    let scale = { x1: 1, y1: 1 }

    const analyse = (sets: { start: number; end: number }[]) => {
      const key = sets.map((s) => `${s.start}:${s.end}`).join(',')
      if (cached && (cached.key === key || performance.now() - movedAt < 150)) return cached
      const bins = gripBySpeed(speed, g, sets, BIN_MPS, MIN_MPS)
      cached = { key, bins, fit: fitAero(bins, car) }
      return cached
    }

    const base = mountCanvas(host, (ctx, w, h) => {
      const sets = view.visible(sync.range())
      const { bins, fit } = analyse(sets)
      latest.current = { bins, fit }
      let vmax = 0
      let count = 0
      for (const s of sets) {
        for (let i = s.start; i <= s.end; i++) {
          if (speed[i] > vmax) vmax = speed[i]
          count++
        }
      }
      vmax = Math.max(vmax, 10)
      const limitTop = gripLimitG(car, vmax)
      const gTop =
        Math.max(
          limitTop,
          car.tireMu,
          ...bins.map((b) => b.envelope),
          ...(compare?.bins.map((b) => b[1]) ?? []),
          0.5,
        ) * 1.15
      const f = plotFrame(w, h)
      const x1 = vmax * k * 1.04
      scale = { x1, y1: gTop }
      drawAxes(
        ctx,
        f,
        { lo: 0, hi: x1, label: `Speed (${unit})` },
        { lo: 0, hi: gTop, label: lateral ? 'Lateral g' : 'Combined g' },
      )
      const px = (v: number) => f.left + ((v * k) / x1) * f.width
      const py = (a: number) => f.top + f.height - (a / gTop) * f.height

      ctx.save()
      ctx.beginPath()
      ctx.rect(f.left, f.top, f.width, f.height)
      ctx.clip()
      const stride = Math.max(1, Math.ceil(count / MAX_POINTS))
      const one = sets.length === 1
      sets.forEach((s) => {
        ctx.fillStyle = one ? '#60a5fa' : SLOT_COLORS[s.slot % SLOT_COLORS.length]
        ctx.globalAlpha = 0.25
        for (let i = s.start; i <= s.end; i += stride) {
          const v = speed[i]
          const a = g[i]
          if (!Number.isFinite(v) || !Number.isFinite(a)) continue
          ctx.fillRect(px(v) - 1, py(a) - 1, 2, 2)
        }
      })
      ctx.globalAlpha = 1

      const curve = (color: string, dash: number[], fn: (v: number) => number) => {
        ctx.strokeStyle = color
        ctx.lineWidth = 1.75
        ctx.setLineDash(dash)
        ctx.beginPath()
        for (let s = 0; s <= 60; s++) {
          const v = (vmax * 1.04 * s) / 60
          if (s) ctx.lineTo(px(v), py(fn(v)))
          else ctx.moveTo(px(v), py(fn(v)))
        }
        ctx.stroke()
        ctx.setLineDash([])
      }
      curve(TYRES, [5, 4], () => car.tireMu)
      if (car.clA > 0) curve(LIMIT, [7, 4], (v) => gripLimitG(car, v))
      if (fit) curve(FIT, [2, 3], (v) => gripLimitG(car, v, fit.clA, fit.mu))

      if (compare && compare.bins.length > 1) {
        ctx.strokeStyle = '#fbbf24'
        ctx.lineWidth = 2
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        compare.bins.forEach(([v, a], i) =>
          i ? ctx.lineTo(px(v), py(a)) : ctx.moveTo(px(v), py(a)),
        )
        ctx.stroke()
        ctx.setLineDash([])
      }

      if (bins.length) {
        ctx.strokeStyle = MEASURED
        ctx.fillStyle = MEASURED
        ctx.lineWidth = 2
        ctx.beginPath()
        bins.forEach((b, i) =>
          i ? ctx.lineTo(px(b.mid), py(b.envelope)) : ctx.moveTo(px(b.mid), py(b.envelope)),
        )
        ctx.stroke()
        for (const b of bins) {
          ctx.beginPath()
          ctx.arc(px(b.mid), py(b.envelope), 2.5, 0, 2 * Math.PI)
          ctx.fill()
        }
      }
      ctx.restore()

      const el = infoRef.current
      if (!el) return
      if (bins.length < 3) {
        el.textContent = 'Not enough driving at different speeds in view to judge the aero.'
        return
      }
      const mid = (bins[0].lo + bins[bins.length - 1].hi) / 2
      const used = (part: SpeedBin[]) => {
        let n = 0
        let sum = 0
        for (const b of part) {
          sum += (b.envelope / gripLimitG(car, b.mid)) * b.n
          n += b.n
        }
        return n ? `${Math.round((sum / n) * 100)}%` : '–'
      }
      const low = used(bins.filter((b) => b.mid < mid))
      const high = used(bins.filter((b) => b.mid >= mid))
      const split = `${Math.round(mid * k)} ${unit}`
      const lines = [
        `Grip used ${low} below ${split}, ${high} above (of the ${car.clA > 0 ? 'aero' : 'tyre'} limit).`,
      ]
      if (fit) {
        lines.push(
          `Data looks like μ ${fit.mu.toFixed(2)} and ClA ${fit.clA.toFixed(1)} m²` +
            (car.clA > 0 ? ` (entered ${car.tireMu.toFixed(2)} and ${car.clA.toFixed(1)}).` : '.'),
        )
        if (car.clA > 0 && fit.clA < car.clA * 0.7) {
          lines.push(
            'The car gains less grip with speed than the aero should give: check wing angles, ride height and rake, or whether fast corners are being driven flat out.',
          )
        }
      }
      if (compare) {
        let now = 0
        let then = 0
        for (const b of bins) {
          const near = compare.bins.find(([v]) => Math.abs(v - b.mid) < BIN_MPS / 2)
          if (!near) continue
          now += b.envelope
          then += near[1]
        }
        lines.push(
          then > 0
            ? `${changePct(now, then)} grip vs ${compare.name} at the same speeds` +
                (fit && compare.clA != null
                  ? ` (ClA ${fit.clA.toFixed(1)} vs ${compare.clA.toFixed(1)}).`
                  : '.')
            : `No speeds in common with ${compare.name} in view.`,
        )
      }
      if (!fit) lines.push('Not enough spread of speeds in view yet to fit the aero.')
      if (car.clA <= 0) lines.push('Enter ClA in the Car tab to draw the aero limit.')
      el.textContent = lines.join(' ')
    })

    let cursorIdx: number | null = null
    const cursor = mountCanvas(host, (ctx, w, h) => {
      if (cursorIdx == null) return
      const f = plotFrame(w, h)
      view.samplesAt(cursorIdx).forEach((i, slot) => {
        if (i < 0 || !Number.isFinite(speed[i]) || !Number.isFinite(g[i])) return
        ctx.beginPath()
        ctx.arc(
          f.left + ((speed[i] * k) / scale.x1) * f.width,
          f.top + f.height - (g[i] / scale.y1) * f.height,
          4,
          0,
          2 * Math.PI,
        )
        ctx.fillStyle = view.slots.length > 1 ? SLOT_COLORS[slot % SLOT_COLORS.length] : '#fafafa'
        ctx.fill()
        ctx.strokeStyle = '#09090b'
        ctx.stroke()
      })
    })

    const offRange = sync.onRange(() => {
      movedAt = performance.now()
      window.clearTimeout(settle)
      settle = window.setTimeout(base.redraw, 160)
      base.redraw()
      cursor.redraw()
    })
    const offCursor = sync.onCursor((idx) => {
      cursorIdx = idx
      cursor.redraw()
    })
    return () => {
      window.clearTimeout(settle)
      offRange()
      offCursor()
      cursor.destroy()
      base.destroy()
    }
  }, [inputs, view, sync, car, lateral, compare])

  return (
    <PanelFrame
      panel={panel}
      active={active}
      dispatch={dispatch}
      title={`Aero ${index + 1}`}
      tall
      legend={
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <label className="flex items-center gap-1 text-zinc-500">
            Grip
            <select
              className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200 outline-none focus:border-red-500"
              value={lateral ? 'lateral' : 'combined'}
              onChange={(e) =>
                dispatch({
                  type: 'setPanel',
                  panelId: panel.id,
                  patch: { gMode: e.target.value === 'lateral' ? 'lateral' : 'combined' },
                })
              }
            >
              <option value="combined">Combined (√(x² + y²))</option>
              <option value="lateral">Lateral only</option>
            </select>
          </label>
          <Swatch
            color={MEASURED}
            label={`Measured (${Math.round(AERO_PERCENTILE * 100)}th pct per speed)`}
          />
          {car.clA > 0 && <Swatch color={LIMIT} dash label={`Limit, ClA ${car.clA}`} />}
          <Swatch color={TYRES} dash label={`Tyres only, μ ${car.tireMu}`} />
          <Swatch color={FIT} dash label="Fit to data" />
          {compare && <Swatch color="#fbbf24" dash label={compare.name} />}
          <CompareControls
            kind="aero"
            value={panel.ref}
            onChange={(id) => dispatch({ type: 'setPanel', panelId: panel.id, patch: { ref: id } })}
            defaultName={`${session.name.replace(/\.[^.]+$/, '')} grip`}
            onSave={(name) => {
              const now = latest.current
              if (!now || now.bins.length < 2) return 'Not enough data in view to save'
              addReference({
                kind: 'aero',
                name,
                bins: now.bins.map((b) => [b.mid, b.envelope]),
                mu: now.fit?.mu ?? null,
                clA: now.fit?.clA ?? null,
              })
              return `Saved “${name}”`
            }}
          />
        </div>
      }
    >
      {inputs ? (
        <div className="absolute inset-0 flex flex-col">
          <div ref={hostRef} className="relative min-h-0 flex-1" />
          <p
            ref={infoRef}
            className="shrink-0 border-t border-zinc-800 px-3 py-1.5 text-xs text-zinc-300"
            title={`Each white dot is the ${Math.round(AERO_PERCENTILE * 100)}th-percentile grip in a ${BIN_MPS} m/s speed band, so single spikes don't count. The fit is grip = μ × (1 + ½ρ·ClA·v² ÷ weight) through those dots.`}
          />
        </div>
      ) : (
        <p className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-zinc-600">
          Needs a speed channel (or GPS) and accelerometer channels (AccelX/AccelY)
        </p>
      )}
    </PanelFrame>
  )
})
