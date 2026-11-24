import { memo, useEffect, useRef, type Dispatch } from 'react'
import { histogram, rangeStats } from '../analysis/stats'
import { channelTitle, type Session } from '../data/session'
import { drawAxes, FONT, mountCanvas, plotFrame, SLOT_COLORS } from '../plot/canvas'
import type { ViewSync } from '../plot/sync'
import type { LayoutAction, Panel } from '../state/layout'
import type { XView } from '../viewer/xview'
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

const BIN_CHOICES = [10, 20, 40, 80, 160]

export const HistogramPanel = memo(function HistogramPanel({
  panel,
  index,
  active,
  session,
  view,
  sync,
  dispatch,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const statsRef = useRef<HTMLSpanElement>(null)
  const id = panel.channelIds[0] ?? ''
  const ch = session.byId.get(id)
  const bins = panel.bins ?? 40

  useEffect(() => {
    const host = hostRef.current
    if (!host || !ch) return
    const c = mountCanvas(host, (ctx, w, h) => {
      const sets = view.visible(sync.range())
      const all = histogram(
        sets.map((s) => ({ data: ch.data, start: s.start, end: s.end })),
        bins,
      )
      if (!all || all.total === 0) return
      const per =
        sets.length > 1
          ? sets.map((s) =>
              histogram([{ data: ch.data, start: s.start, end: s.end }], bins, [all.lo, all.hi])!,
            )
          : [all]
      const pct = per.map((hst) => hst.counts.map((n) => (hst.total ? (n / hst.total) * 100 : 0)))
      const top = Math.max(1, ...pct.flat()) * 1.1

      const f = plotFrame(w, h)
      drawAxes(
        ctx,
        f,
        { lo: all.lo, hi: all.hi, label: `${channelTitle(ch)}${ch.unit ? ` (${ch.unit})` : ''}` },
        { lo: 0, hi: top, label: '% of samples' },
      )
      const bw = f.width / bins
      ctx.save()
      if (per.length === 1) {
        ctx.fillStyle = ch.color
        ctx.globalAlpha = 0.75
        pct[0].forEach((p, b) => {
          const bh = (p / top) * f.height
          ctx.fillRect(f.left + b * bw + 0.5, f.top + f.height - bh, Math.max(1, bw - 1), bh)
        })
      } else {
        per.forEach((_, s) => {
          ctx.strokeStyle = SLOT_COLORS[s % SLOT_COLORS.length]
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.moveTo(f.left, f.top + f.height)
          pct[s].forEach((p, b) => {
            const y = f.top + f.height - (p / top) * f.height
            ctx.lineTo(f.left + b * bw, y)
            ctx.lineTo(f.left + (b + 1) * bw, y)
          })
          ctx.lineTo(f.left + f.width, f.top + f.height)
          ctx.stroke()
        })
      }
      if (all.lo < 0 && all.hi > 0) {
        const x = f.left + ((0 - all.lo) / (all.hi - all.lo)) * f.width
        ctx.strokeStyle = '#a1a1aa'
        ctx.setLineDash([3, 3])
        ctx.beginPath()
        ctx.moveTo(x, f.top)
        ctx.lineTo(x, f.top + f.height)
        ctx.stroke()
        if (per.length === 1) {
          const neg = all.counts
            .slice(0, Math.floor((0 - all.lo) / all.width))
            .reduce((a, n) => a + n, 0)
          ctx.setLineDash([])
          ctx.fillStyle = '#a1a1aa'
          ctx.font = FONT
          ctx.textBaseline = 'top'
          ctx.textAlign = 'right'
          ctx.fillText(`${((neg / all.total) * 100).toFixed(0)}% <0`, x - 4, f.top + 4)
          ctx.textAlign = 'left'
          ctx.fillText(`${(100 - (neg / all.total) * 100).toFixed(0)}% ≥0`, x + 4, f.top + 4)
        }
      }
      ctx.restore()

      if (statsRef.current) {
        const st = rangeStats(ch.data, sets[0].start, sets[0].end)
        const p = ch.precision
        statsRef.current.textContent = `mean ${st.mean.toFixed(p)} · σ ${st.std.toFixed(p)} · min ${st.min.toFixed(p)} · max ${st.max.toFixed(p)}${sets.length > 1 ? ` (${view.slots[0].label})` : ''}`
      }
    })
    const off = sync.onRange(c.redraw)
    return () => {
      off()
      c.destroy()
    }
  }, [ch, bins, view, sync])

  return (
    <PanelFrame
      panel={panel}
      active={active}
      dispatch={dispatch}
      title={`Histogram ${index + 1}`}
      legend={
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <ChannelSelect
            label="Channel"
            value={id}
            channels={session.channels}
            onChange={(v) =>
              dispatch({ type: 'setPanel', panelId: panel.id, patch: { channelIds: v ? [v] : [] } })
            }
          />
          <label className="flex items-center gap-1 text-zinc-500">
            Bins
            <select
              className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200 outline-none focus:border-red-500"
              value={bins}
              onChange={(e) =>
                dispatch({
                  type: 'setPanel',
                  panelId: panel.id,
                  patch: { bins: Number(e.target.value) },
                })
              }
            >
              {BIN_CHOICES.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <span ref={statsRef} className="truncate text-zinc-500 tabular-nums" />
        </div>
      }
    >
      {ch ? (
        <div ref={hostRef} className="absolute inset-0" />
      ) : (
        <p className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-zinc-600">
          Pick a channel above, or click one in the list
        </p>
      )}
    </PanelFrame>
  )
})
