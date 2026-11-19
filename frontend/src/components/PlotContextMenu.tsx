import { useEffect, useRef, useState } from 'react'
import type { Panel } from '../state/layout'

interface Props {
  panel: Panel
  x: number
  y: number
  units: string[]
  onPatch: (patch: Partial<Panel>) => void
  onEdit: (id: string) => void
  onFilter?: (ids: string[]) => void
  onClose: () => void
}

const bins = [10, 20, 40, 80, 160]
const field =
  'min-w-0 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-zinc-100 outline-none focus:border-red-500 focus-visible:ring-1 focus-visible:ring-red-500'
const numberField = `${field} w-full [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`
const section = 'border-t border-zinc-800 pt-3'
const caption = 'mb-2 block text-[11px] font-medium uppercase tracking-wider text-zinc-500'
const action =
  'rounded border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-white focus-visible:outline focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-40'
const primary =
  'rounded border border-red-800 bg-red-950/60 px-3 py-1.5 text-zinc-100 hover:bg-red-900/60 focus-visible:outline focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-40'

export function PlotContextMenu({ panel, x, y, units, onPatch, onEdit, onFilter, onClose }: Props) {
  const [unit, setUnit] = useState(units[0] ?? '')
  const [min, setMin] = useState(String(panel.yBounds?.[unit]?.[0] ?? ''))
  const [max, setMax] = useState(String(panel.yBounds?.[unit]?.[1] ?? ''))
  const [axisOpen, setAxisOpen] = useState(false)
  const axisButton = useRef<HTMLButtonElement>(null)
  const axisOptions = useRef<(HTMLButtonElement | null)[]>([])
  const [xyAxis, setXyAxis] = useState<'x' | 'y'>('x')
  const [xyMin, setXyMin] = useState(String(panel.xyBounds?.x?.[0] ?? ''))
  const [xyMax, setXyMax] = useState(String(panel.xyBounds?.x?.[1] ?? ''))

  useEffect(() => {
    const close = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return
      onClose()
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [onClose])

  const bounds = panel.yBounds ?? {}
  const setBounds = (next: Record<string, [number, number]>) => onPatch({ yBounds: next })
  const chooseUnit = (next: string) => {
    setUnit(next)
    setMin(String(bounds[next]?.[0] ?? ''))
    setMax(String(bounds[next]?.[1] ?? ''))
    setAxisOpen(false)
    axisButton.current?.focus()
  }
  const focusOption = (index: number) => {
    setAxisOpen(true)
    requestAnimationFrame(() => axisOptions.current[index]?.focus())
  }
  return (
    <div
      role="menu"
      aria-label="Plot options"
      onPointerDown={(event) => event.stopPropagation()}
      className="fixed z-50 max-h-[min(80vh,32rem)] w-80 overflow-y-auto rounded-lg border border-zinc-700 bg-[#0b0b0d] p-3 text-xs text-zinc-100 shadow-2xl"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 328)),
        top: Math.max(8, Math.min(y, window.innerHeight - 320)),
      }}
    >
      <h2 className="pb-3 text-sm font-semibold">Plot settings</h2>
      {panel.kind === 'time' && units.length > 0 && (
        <form
          className={section}
          onSubmit={(event) => {
            event.preventDefault()
            if (
              !min ||
              !max ||
              !Number.isFinite(Number(min)) ||
              !Number.isFinite(Number(max)) ||
              Number(min) >= Number(max)
            )
              return
            setBounds({ ...bounds, [unit]: [Number(min), Number(max)] })
            onClose()
          }}
        >
          <span className={caption}>Y axis</span>
          <div
            className="relative"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setAxisOpen(false)
            }}
          >
            <button
              ref={axisButton}
              type="button"
              aria-label="Y axis"
              aria-haspopup="listbox"
              aria-expanded={axisOpen}
              className={`${field} flex w-full items-center justify-between text-left hover:border-zinc-500`}
              onClick={() => setAxisOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  focusOption(Math.max(0, units.indexOf(unit)))
                }
              }}
            >
              <span>{unit}</span>
              <span aria-hidden="true" className="text-zinc-500">
                ⌄
              </span>
            </button>
            {axisOpen && (
              <div
                role="listbox"
                aria-label="Y axis choices"
                className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-zinc-700 bg-[#111114] p-1 shadow-xl"
              >
                {units.map((value, index) => (
                  <button
                    key={value}
                    ref={(node) => {
                      axisOptions.current[index] = node
                    }}
                    type="button"
                    role="option"
                    aria-selected={value === unit}
                    tabIndex={-1}
                    className={`block w-full rounded px-2 py-1.5 text-left outline-none hover:bg-zinc-800 focus:bg-zinc-800 focus:text-white ${value === unit ? 'border border-red-800 bg-red-950/60 text-white' : 'border border-transparent text-zinc-300'}`}
                    onClick={() => chooseUnit(value)}
                    onKeyDown={(event) => {
                      if (
                        event.key === 'ArrowDown' ||
                        event.key === 'ArrowUp' ||
                        event.key === 'Home' ||
                        event.key === 'End'
                      ) {
                        event.preventDefault()
                        const next =
                          event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? units.length - 1
                              : (index + (event.key === 'ArrowDown' ? 1 : -1) + units.length) %
                                units.length
                        axisOptions.current[next]?.focus()
                      } else if (event.key === 'Escape') {
                        event.stopPropagation()
                        setAxisOpen(false)
                        axisButton.current?.focus()
                      }
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input
              aria-label="Y minimum"
              type="number"
              step="any"
              className={numberField}
              placeholder="Min"
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
            <input
              aria-label="Y maximum"
              type="number"
              step="any"
              className={numberField}
              placeholder="Max"
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              className={primary}
              disabled={
                !Number.isFinite(Number(min)) ||
                !Number.isFinite(Number(max)) ||
                !min ||
                !max ||
                Number(min) >= Number(max)
              }
            >
              Apply bounds
            </button>
            <button
              type="button"
              className={action}
              onClick={() => {
                const next = { ...bounds }
                delete next[unit]
                setBounds(next)
                onClose()
              }}
            >
              Auto Y axis
            </button>
          </div>
        </form>
      )}
      {panel.kind === 'histogram' && (
        <label className={section}>
          <span className={caption}>Bins</span>
          <select
            aria-label="Histogram bins"
            className={`${field} w-full`}
            value={panel.bins ?? 40}
            onChange={(e) => {
              onPatch({ bins: Number(e.target.value) })
              onClose()
            }}
          >
            {bins.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      )}
      {panel.kind === 'xy' && (
        <form
          className={section}
          onSubmit={(event) => {
            event.preventDefault()
            if (
              !xyMin ||
              !xyMax ||
              !Number.isFinite(Number(xyMin)) ||
              !Number.isFinite(Number(xyMax)) ||
              Number(xyMin) >= Number(xyMax)
            )
              return
            onPatch({ xyBounds: { ...panel.xyBounds, [xyAxis]: [Number(xyMin), Number(xyMax)] } })
            onClose()
          }}
        >
          <label className={caption} htmlFor="plot-xy-axis">
            Axis
          </label>
          <select
            id="plot-xy-axis"
            aria-label="XY axis"
            className={`${field} w-full`}
            value={xyAxis}
            onChange={(e) => {
              const axis = e.target.value as 'x' | 'y'
              setXyAxis(axis)
              setXyMin(String(panel.xyBounds?.[axis]?.[0] ?? ''))
              setXyMax(String(panel.xyBounds?.[axis]?.[1] ?? ''))
            }}
          >
            <option value="x">X</option>
            <option value="y">Y</option>
          </select>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input
              aria-label="Axis minimum"
              type="number"
              step="any"
              className={numberField}
              value={xyMin}
              onChange={(e) => setXyMin(e.target.value)}
              placeholder="Min"
            />
            <input
              aria-label="Axis maximum"
              type="number"
              step="any"
              className={numberField}
              value={xyMax}
              onChange={(e) => setXyMax(e.target.value)}
              placeholder="Max"
            />
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              className={primary}
              disabled={!xyMin || !xyMax || Number(xyMin) >= Number(xyMax)}
            >
              Apply bounds
            </button>
            <button
              type="button"
              className={action}
              onClick={() => {
                const next = { ...panel.xyBounds }
                delete next[xyAxis]
                onPatch({ xyBounds: next })
                onClose()
              }}
            >
              Auto axis
            </button>
          </div>
        </form>
      )}
      {panel.kind === 'spectrum' && (
        <label className={section}>
          <span className={caption}>FFT window</span>
          <select
            aria-label="FFT window"
            className={`${field} w-full`}
            value={panel.fftSize ?? 1024}
            onChange={(e) => {
              onPatch({ fftSize: Number(e.target.value) })
              onClose()
            }}
          >
            {[256, 512, 1024, 2048, 4096].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className={`${section} mt-3`}>
        <span className={caption}>Data streams</span>
        {panel.channelIds.length === 0 && <p className="py-1 text-zinc-500">No streams selected</p>}
        {panel.channelIds.map((id) => (
          <button
            key={id}
            type="button"
            className={`${action} mb-1 w-full text-left`}
            onClick={() => {
              onEdit(id)
              onClose()
            }}
          >
            Edit {id}…
          </button>
        ))}
        {onFilter && (
          <button
            type="button"
            className={`${action} mt-1 w-full text-left`}
            onClick={() => {
              onFilter(panel.channelIds)
              onClose()
            }}
          >
            Filter channels…
          </button>
        )}
      </div>
    </div>
  )
}
