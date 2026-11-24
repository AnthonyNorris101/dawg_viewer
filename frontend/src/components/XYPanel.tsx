import { memo, useEffect, useRef, type Dispatch } from 'react'
import { channelTitle, type Channel, type Session } from '../data/session'
import { GG_BINS, GG_PERCENTILE, ggEnvelope, type GGEnvelope } from '../analysis/gg'
import { drawAxes, mountCanvas, padRange, plotFrame, SLOT_COLORS } from '../plot/canvas'
import type { ViewSync } from '../plot/sync'
import type { LayoutAction, Panel } from '../state/layout'
import type { XView } from '../viewer/xview'
import { addReference, changePct, useReferences } from '../state/references'
import { CompareControls } from './CompareControls'
import { ChannelSelect, PanelFrame } from './PanelFrame'

interface Props {
  panel: Panel
  index: number
  active: boolean
  session: Session
  view: XView
  sync: ViewSync
  dispatch: Dispatch<LayoutAction>
}

const MAX_POINTS = 40_000

const isAccel = (c: Channel) => /^acc(el)?[ _]?[xyz]$/i.test(c.name) || c.unit.toLowerCase() === 'g'

export const XYPanel = memo(function XYPanel({
  panel,
  index,
  active,
  session,
  view,
  sync,
  dispatch,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const ggRef = useRef<HTMLParagraphElement>(null)
  const showEnvelope = panel.envelope ?? true
  const [xId = '', yId = ''] = panel.channelIds
  const xc = session.byId.get(xId)
  const yc = session.byId.get(yId)
  const refs = useReferences()
  const compare = refs.find((r) => r.id === panel.ref && r.kind === 'gg')
  const latest = useRef<GGEnvelope | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host || !xc || !yc) return
    const equal = isAccel(xc) && isAccel(yc)
    let scale = { x0: 0, x1: 1, y0: 0, y1: 1 }
    const envs = new Map<number, { key: string; g: ReturnType<typeof ggEnvelope> }>()
    let movedAt = -Infinity
    let settle = 0
    const envelopeFor = (s: { start: number; end: number; slot: number }) => {
      const key = `${s.start}:${s.end}`
      const prev = envs.get(s.slot)
      if (prev && (prev.key === key || performance.now() - movedAt < 150)) return prev.g
      const g = ggEnvelope(xc.data, yc.data, [s])
      envs.set(s.slot, { key, g })
      return g
    }

    const base = mountCanvas(host, (ctx, w, h) => {
      const sets = view.visible(sync.range())
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      let count = 0
      for (const s of sets) {
        for (let i = s.start; i <= s.end; i++) {
          const x = xc.data[i]
          const y = yc.data[i]
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
          count++
        }
      }
      const f = plotFrame(w, h)
      ;[x0, x1] = padRange(x0, x1)
      ;[y0, y1] = padRange(y0, y1)
      if (equal) {
        let refR = 0
        if (compare?.kind === 'gg' && showEnvelope)
          for (const [a, b] of compare.points) refR = Math.max(refR, Math.abs(a), Math.abs(b))
        const r = Math.max(Math.abs(x0), Math.abs(x1), Math.abs(y0), Math.abs(y1), refR, 0.5)
        const ax = f.width / f.height
        x0 = -r * Math.max(1, ax)
        x1 = r * Math.max(1, ax)
        y0 = -r * Math.max(1, 1 / ax)
        y1 = r * Math.max(1, 1 / ax)
      }
      if (panel.xyBounds?.x) [x0, x1] = panel.xyBounds.x
      if (panel.xyBounds?.y) [y0, y1] = panel.xyBounds.y
      scale = { x0, x1, y0, y1 }
      drawAxes(
        ctx,
        f,
        { lo: x0, hi: x1, label: `${channelTitle(xc)}${xc.unit ? ` (${xc.unit})` : ''}` },
        { lo: y0, hi: y1, label: `${channelTitle(yc)}${yc.unit ? ` (${yc.unit})` : ''}` },
      )
      const px = (x: number) => f.left + ((x - x0) / (x1 - x0)) * f.width
      const py = (y: number) => f.top + f.height - ((y - y0) / (y1 - y0)) * f.height

      ctx.save()
      ctx.beginPath()
      ctx.rect(f.left, f.top, f.width, f.height)
      ctx.clip()
      if (equal) {
        ctx.strokeStyle = '#3f3f46'
        ctx.setLineDash([3, 3])
        for (const g of [0.5, 1, 1.5, 2]) {
          ctx.beginPath()
          ctx.ellipse(
            px(0),
            py(0),
            Math.abs(px(g) - px(0)),
            Math.abs(py(g) - py(0)),
            0,
            0,
            2 * Math.PI,
          )
          ctx.stroke()
        }
        ctx.setLineDash([])
      }
      const stride = Math.max(1, Math.ceil(count / MAX_POINTS))
      const one = sets.length === 1
      sets.forEach((s) => {
        ctx.fillStyle = one ? yc.color : SLOT_COLORS[s.slot % SLOT_COLORS.length]
        ctx.globalAlpha = one ? 0.35 : 0.5
        for (let i = s.start; i <= s.end; i += stride) {
          const x = xc.data[i]
          const y = yc.data[i]
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue
          ctx.fillRect(px(x) - 1, py(y) - 1, 2, 2)
        }
      })
      ctx.globalAlpha = 1

      const summary: string[] = []
      if (equal && showEnvelope && compare?.kind === 'gg') {
        ctx.strokeStyle = '#fbbf24'
        ctx.lineWidth = 2
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        compare.points.forEach(([x, y], k) =>
          k ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y)),
        )
        ctx.closePath()
        ctx.stroke()
        ctx.setLineDash([])
      }
      if (equal && showEnvelope) {
        latest.current = null
        sets.forEach((s) => {
          const g = envelopeFor(s)
          if (!g) return
          latest.current ??= g
          const color = one ? '#fafafa' : SLOT_COLORS[s.slot % SLOT_COLORS.length]
          ctx.strokeStyle = color
          ctx.lineWidth = 1.5
          ctx.beginPath()
          g.points.forEach(([x, y], k) => (k ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))))
          ctx.closePath()
          ctx.stroke()
          ctx.strokeStyle = one ? '#f472b6' : color
          ctx.setLineDash([6, 4])
          ctx.beginPath()
          ctx.ellipse(
            px(0),
            py(0),
            Math.abs(px(g.radius) - px(0)),
            Math.abs(py(g.radius) - py(0)),
            0,
            0,
            2 * Math.PI,
          )
          ctx.stroke()
          ctx.setLineDash([])
          const u = xc.unit || 'g'
          const lap = one ? '' : `${view.slots[s.slot]?.label ?? ''}: `
          const vs =
            compare?.kind === 'gg' && compare.area > 0
              ? ` (${changePct(g.area, compare.area)} area vs ${compare.name})`
              : ''
          summary.push(
            `${lap}envelope ${g.area.toFixed(2)} ${u}²${vs} · G-G circle r ${g.radius.toFixed(2)} ${u}` +
              ` · ${channelTitle(xc)} ${g.xMin.toFixed(2)}/+${g.xMax.toFixed(2)}` +
              ` · ${channelTitle(yc)} ${g.yMin.toFixed(2)}/+${g.yMax.toFixed(2)}`,
          )
        })
      }
      ctx.restore()
      if (ggRef.current) {
        ggRef.current.textContent = summary.join('   ')
        ggRef.current.title = summary.length
          ? `Envelope: the ${Math.round(GG_PERCENTILE * 100)}th-percentile grip in each of ${GG_BINS} directions, so noise spikes don't inflate it. The circle has the same area.`
          : ''
      }
    })

    let cursorIdx: number | null = null
    const cursor = mountCanvas(host, (ctx, w, h) => {
      if (cursorIdx == null) return
      const f = plotFrame(w, h)
      const { x0, x1, y0, y1 } = scale
      view.samplesAt(cursorIdx).forEach((i, slot) => {
        if (i < 0) return
        const x = xc.data[i]
        const y = yc.data[i]
        if (!Number.isFinite(x) || !Number.isFinite(y)) return
        ctx.beginPath()
        ctx.arc(
          f.left + ((x - x0) / (x1 - x0)) * f.width,
          f.top + f.height - ((y - y0) / (y1 - y0)) * f.height,
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
  }, [xc, yc, view, sync, showEnvelope, compare, panel.xyBounds])

  const set = (i: number) => (id: string) => {
    const ids = [xId, yId]
    ids[i] = id
    dispatch({ type: 'setPanel', panelId: panel.id, patch: { channelIds: ids } })
  }
  const swap = () =>
    dispatch({ type: 'setPanel', panelId: panel.id, patch: { channelIds: [yId, xId] } })

  return (
    <PanelFrame
      panel={panel}
      active={active}
      dispatch={dispatch}
      title={`XY ${index + 1}`}
      legend={
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <ChannelSelect label="X" value={xId} channels={session.channels} onChange={set(0)} />
          <button
            type="button"
            className="text-zinc-500 hover:text-zinc-200"
            title="Swap X and Y"
            aria-label="Swap X and Y"
            onClick={swap}
          >
            ⇄
          </button>
          <ChannelSelect label="Y" value={yId} channels={session.channels} onChange={set(1)} />
          {xc && yc && isAccel(xc) && isAccel(yc) && (
            <label
              className="flex items-center gap-1 text-zinc-500"
              title="Grip envelope and the G-G circle with the same area"
            >
              <input
                type="checkbox"
                className="accent-red-500"
                checked={showEnvelope}
                onChange={(e) =>
                  dispatch({
                    type: 'setPanel',
                    panelId: panel.id,
                    patch: { envelope: e.target.checked },
                  })
                }
              />
              G-G circle
            </label>
          )}
          {xc && yc && isAccel(xc) && isAccel(yc) && showEnvelope && (
            <CompareControls
              kind="gg"
              value={panel.ref}
              onChange={(id) =>
                dispatch({ type: 'setPanel', panelId: panel.id, patch: { ref: id } })
              }
              defaultName={`${session.name.replace(/\.[^.]+$/, '')} G-G`}
              onSave={(name) => {
                const g = latest.current
                if (!g) return 'Nothing to save yet'
                addReference({
                  kind: 'gg',
                  name,
                  points: g.points,
                  area: g.area,
                  radius: g.radius,
                })
                return `Saved “${name}”`
              }}
            />
          )}
          {view.slots.length > 1 &&
            view.slots.map((s, i) => (
              <span key={i} className="flex items-center gap-1 text-zinc-400">
                <span
                  className="size-2 rounded-full"
                  style={{ background: SLOT_COLORS[i % SLOT_COLORS.length] }}
                />
                {s.label}
              </span>
            ))}
        </div>
      }
    >
      {xc && yc ? (
        <>
          <div ref={hostRef} className="absolute inset-0" />
          {isAccel(xc) && isAccel(yc) && view.slots.length <= 1 && (
            <span
              className="pointer-events-auto absolute right-2 bottom-9 flex flex-col gap-0.5 rounded bg-zinc-950/85 px-1.5 py-1 text-[10px] leading-tight text-zinc-400"
              title="Each dot is one moment: sideways g across, forward/braking g up and down. The further out the dots go, the more grip was used."
            >
              <span className="flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: yc.color }} />
                samples
              </span>
              {showEnvelope && (
                <>
                  <span className="flex items-center gap-1">
                    <span className="h-0.5 w-3 bg-zinc-100" />
                    envelope
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-0 w-3 border-t-2 border-dashed border-pink-400" />
                    equal-area
                  </span>
                </>
              )}
              <span className="flex items-center gap-1">
                <span className="h-0 w-3 border-t border-dashed border-zinc-500" />
                0.5 g rings
              </span>
            </span>
          )}

          <p
            ref={ggRef}
            className="pointer-events-auto absolute top-2.5 left-14 max-w-[calc(100%-5rem)] text-[11px] leading-tight text-zinc-300 tabular-nums"
          />
        </>
      ) : (
        <p className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-zinc-600">
          Pick an X and a Y channel above, or click two channels in the list
        </p>
      )}
    </PanelFrame>
  )
})
