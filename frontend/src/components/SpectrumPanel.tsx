import { memo, useEffect, useMemo, useRef, type Dispatch } from 'react'
import type uPlot from 'uplot'
import { peak, toDb, uniform, welch, type Spectrum } from '../analysis/spectrum'
import { channelTitle, type Session } from '../data/session'
import { SLOT_COLORS } from '../plot/canvas'
import { mountPlot, type MountedPlot } from '../plot/mountPlot'
import { createViewSync, type ViewSync } from '../plot/sync'
import type { LayoutAction, Panel } from '../state/layout'
import type { XView } from '../viewer/xview'
import type { FilterStart } from './FilterDialog'
import { PanelFrame, PlotTools } from './PanelFrame'

interface Props {
  panel: Panel
  index: number
  active: boolean
  session: Session
  view: XView
  sync: ViewSync
  dispatch: Dispatch<LayoutAction>
  onFilter?: (start: FilterStart) => void
}

const SIZES = [256, 512, 1024, 2048, 4096]
const NO_VALUE = '–'

interface Line {
  key: string
  label: string
  color: string
  dash?: number[]
  channel: number
  slot: number
}

export const SpectrumPanel = memo(function SpectrumPanel({
  panel,
  index,
  active,
  session,
  view,
  sync,
  dispatch,
  onFilter,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const freqEl = useRef<HTMLSpanElement>(null)
  const infoEl = useRef<HTMLSpanElement>(null)
  const valueEls = useRef(new Map<string, HTMLSpanElement>())
  const peakEls = useRef(new Map<string, HTMLSpanElement>())
  const size = panel.fftSize ?? 1024

  const channels = useMemo(
    () => panel.channelIds.flatMap((id) => session.byId.get(id) ?? []),
    [panel.channelIds, session],
  )
  const lines = useMemo<Line[]>(
    () =>
      channels.flatMap((c, ci) =>
        view.slots.map((s, slot) => ({
          key: `${c.id}@${slot}`,
          label: view.slots.length > 1 ? `${channelTitle(c)} ${s.label}` : channelTitle(c),
          color:
            view.slots.length > 1 && channels.length === 1
              ? SLOT_COLORS[slot % SLOT_COLORS.length]
              : c.color,
          dash: channels.length > 1 ? s.dash : undefined,
          channel: ci,
          slot,
        })),
      ),
    [channels, view],
  )

  const plotRef = useRef<MountedPlot | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host || lines.length === 0) return
    const { time } = session

    const compute = () => {
      const sets = view.visible(sync.range())
      const spectra: (Spectrum | null)[] = lines.map((l) => {
        const s = sets[l.slot]
        if (!s) return null
        const u = uniform(time, channels[l.channel].data, s.start, s.end)
        return u ? welch(u.values, u.rate, size) : null
      })
      const ref = spectra.find((s) => s) ?? null
      return { spectra, ref }
    }

    const toData = (spectra: (Spectrum | null)[], ref: Spectrum | null) => {
      const freq = ref ? [...ref.freq] : [0]
      const ys = spectra.map((s) =>
        freq.map((_, k) =>
          s && k < s.psd.length && s.freq[k] === freq[k] ? toDb(s.psd[k]) : null,
        ),
      )
      return { aligned: [freq, ...ys] as uPlot.AlignedData, ys }
    }

    const describe = (spectra: (Spectrum | null)[], ref: Spectrum | null) => {
      lines.forEach((l, i) => {
        const el = peakEls.current.get(l.key)
        const p = spectra[i] ? peak(spectra[i]!) : null
        if (el) el.textContent = p ? `peak ${p.hz.toFixed(1)} Hz` : ''
      })
      if (infoEl.current) {
        infoEl.current.textContent = ref
          ? `${ref.rate.toFixed(0)} Hz sampling · ${ref.segments} × ${ref.size} pts · ${(ref.rate / ref.size).toFixed(2)} Hz bins`
          : 'Zoom out: not enough samples in view'
      }
    }

    const fsync = createViewSync(`spectrum-${panel.id}`)
    let current = compute()
    let freq = current.ref ? current.ref.freq : new Float64Array([0])
    let data = toData(current.spectra, current.ref)
    describe(current.spectra, current.ref)

    const plot = mountPlot(host, {
      series: lines.map((l) => ({
        name: l.label,
        unit: 'dB',
        color: l.color,
        dash: l.dash,
      })),
      data: data.aligned,
      sync: fsync,
      pinCursor: false,
      bounds: () => [0, freq[freq.length - 1] || 1],
      minSpan: 0.5,
      onCursor: (idx) => {
        if (freqEl.current) {
          freqEl.current.textContent = idx == null ? NO_VALUE : `${freq[idx]?.toFixed(2)} Hz`
        }
        lines.forEach((l, i) => {
          const el = valueEls.current.get(l.key)
          const v = idx == null ? null : data.ys[i][idx]
          if (el) el.textContent = v == null ? NO_VALUE : `${v.toFixed(1)} dB`
        })
      },
    })

    let queued = 0
    let lastSize = freq.length
    const refresh = () => {
      queued = 0
      current = compute()
      const nextFreq = current.ref ? current.ref.freq : new Float64Array([0])
      const sameAxis =
        nextFreq.length === lastSize && nextFreq[nextFreq.length - 1] === freq[freq.length - 1]
      freq = nextFreq
      lastSize = freq.length
      data = toData(current.spectra, current.ref)
      plot.u.setData(data.aligned, !sameAxis)
      describe(current.spectra, current.ref)
    }
    const off = sync.onRange(() => {
      if (queued) clearTimeout(queued)
      queued = window.setTimeout(refresh, 120)
    })
    plotRef.current = plot
    return () => {
      plotRef.current = null
      off()
      if (queued) clearTimeout(queued)
      plot.destroy()
    }
  }, [lines, channels, session, view, sync, size, panel.id])

  return (
    <PanelFrame
      panel={panel}
      active={active}
      dispatch={dispatch}
      title={`Spectrum ${index + 1}`}
      tools={<PlotTools plot={plotRef} title={`spectrum ${index + 1}`} />}
      legend={
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
          {lines.map((l) => (
            <span key={l.key} className="group flex items-center gap-1.5">
              <svg width="14" height="6" className="shrink-0" aria-hidden>
                <line
                  x1="0"
                  y1="3"
                  x2="14"
                  y2="3"
                  stroke={l.color}
                  strokeWidth="2"
                  strokeDasharray={l.dash?.map((d) => d / 2).join(' ')}
                />
              </svg>
              <span className="text-zinc-300">{l.label}</span>
              <span
                ref={(el) => {
                  if (el) valueEls.current.set(l.key, el)
                  else valueEls.current.delete(l.key)
                }}
                className="min-w-14 text-right text-zinc-100 tabular-nums"
              >
                {NO_VALUE}
              </span>
              <span
                ref={(el) => {
                  if (el) peakEls.current.set(l.key, el)
                  else peakEls.current.delete(l.key)
                }}
                className="text-zinc-500 tabular-nums"
              />
              {l.slot === 0 && (
                <button
                  type="button"
                  aria-label={`Remove ${channels[l.channel].name}`}
                  className="text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-zinc-200 focus-visible:opacity-100"
                  onClick={() =>
                    dispatch({
                      type: 'removeChannel',
                      panelId: panel.id,
                      channelId: channels[l.channel].id,
                    })
                  }
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          <select
            aria-label="Add a channel to this spectrum"
            title="Any channel works: dampers, accelerometers, RPM, steering…"
            className="max-w-36 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-300 outline-none focus:border-red-500"
            value=""
            onChange={(e) =>
              e.target.value &&
              dispatch({
                type: 'setPanel',
                panelId: panel.id,
                patch: { channelIds: [...panel.channelIds, e.target.value] },
              })
            }
          >
            <option value="">+ Add channel</option>
            {session.channels
              .filter((c) => !panel.channelIds.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {channelTitle(c)}
                </option>
              ))}
          </select>
          {onFilter && panel.channelIds.length > 0 && (
            <button
              type="button"
              className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300 hover:text-zinc-100"
              title="Make a filtered copy of a channel. Zoom this spectrum to a frequency range first to start from that band."
              onClick={() => {
                const sc = plotRef.current?.u.scales.x
                const xs = plotRef.current?.u.data[0]
                const top = xs && xs.length ? xs[xs.length - 1] : 0
                const zoomed =
                  sc?.min != null && sc.max != null && (sc.min > top * 0.01 || sc.max < top * 0.99)
                onFilter({
                  channelIds: panel.channelIds,
                  band: zoomed ? [Math.max(sc.min!, 0.1), sc.max!] : undefined,
                  panelId: panel.id,
                })
              }}
            >
              ∿ Filter…
            </button>
          )}
          <span className="text-zinc-500">
            at{' '}
            <span ref={freqEl} className="text-zinc-300 tabular-nums">
              {NO_VALUE}
            </span>
          </span>
          <label
            className="flex items-center gap-1 text-zinc-500"
            title="Longer windows give finer frequency bins but a noisier estimate"
          >
            Window
            <select
              className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200 outline-none focus:border-red-500"
              value={size}
              onChange={(e) =>
                dispatch({
                  type: 'setPanel',
                  panelId: panel.id,
                  patch: { fftSize: Number(e.target.value) },
                })
              }
            >
              {SIZES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span ref={infoEl} className="truncate text-zinc-600 tabular-nums" />
        </div>
      }
    >
      {lines.length === 0 ? (
        <p className="absolute inset-0 grid place-items-center px-4 text-center text-sm text-zinc-600">
          Use “+ Add channel” above, or click channels in the list, to see the frequency content of
          any sensor
        </p>
      ) : (
        <div ref={hostRef} className="absolute inset-0" />
      )}
    </PanelFrame>
  )
})
