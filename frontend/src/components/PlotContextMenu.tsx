import { useEffect, useState } from 'react'
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

export function PlotContextMenu({ panel, x, y, units, onPatch, onEdit, onFilter, onClose }: Props) {
  const [unit, setUnit] = useState(units[0] ?? '')
  const [min, setMin] = useState(String(panel.yBounds?.[unit]?.[0] ?? ''))
  const [max, setMax] = useState(String(panel.yBounds?.[unit]?.[1] ?? ''))
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
  }
  const action = 'block w-full rounded px-2 py-1 text-left hover:bg-zinc-700'

  return (
    <div
      role="menu"
      aria-label="Plot options"
      onPointerDown={(event) => event.stopPropagation()}
      className="fixed z-50 min-w-56 rounded border border-zinc-600 bg-zinc-900 p-2 text-xs text-zinc-100 shadow-xl"
      style={{
        left: Math.min(x, window.innerWidth - 245),
        top: Math.min(y, window.innerHeight - 320),
      }}
    >
      {panel.kind === 'time' && units.length > 0 && (
        <div className="border-b border-zinc-700 pb-2">
          <label className="block">
            Y axis
            <select
              aria-label="Y axis"
              className="ml-2 bg-zinc-800"
              value={unit}
              onChange={(e) => chooseUnit(e.target.value)}
            >
              {units.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-2 flex gap-1">
            <input
              aria-label="Y minimum"
              type="number"
              className="w-20 bg-zinc-800 px-1"
              placeholder="Min"
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
            <input
              aria-label="Y maximum"
              type="number"
              className="w-20 bg-zinc-800 px-1"
              placeholder="Max"
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </div>
          <button
            className={action}
            disabled={
              !Number.isFinite(Number(min)) ||
              !Number.isFinite(Number(max)) ||
              !min ||
              !max ||
              Number(min) >= Number(max)
            }
            onClick={() => {
              setBounds({ ...bounds, [unit]: [Number(min), Number(max)] })
              onClose()
            }}
          >
            Apply bounds
          </button>
          <button
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
      )}
      {panel.kind === 'histogram' && (
        <label className="block border-b border-zinc-700 pb-2">
          Bins
          <select
            aria-label="Histogram bins"
            className="ml-2 bg-zinc-800"
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
        <div className="border-b border-zinc-700 pb-2">
          <label>
            Axis{' '}
            <select
              aria-label="XY axis"
              className="bg-zinc-800"
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
          </label>
          <div className="mt-2 flex gap-1">
            <input
              aria-label="Axis minimum"
              type="number"
              className="w-20 bg-zinc-800 px-1"
              value={xyMin}
              onChange={(e) => setXyMin(e.target.value)}
              placeholder="Min"
            />
            <input
              aria-label="Axis maximum"
              type="number"
              className="w-20 bg-zinc-800 px-1"
              value={xyMax}
              onChange={(e) => setXyMax(e.target.value)}
              placeholder="Max"
            />
          </div>
          <button
            className={action}
            disabled={!xyMin || !xyMax || Number(xyMin) >= Number(xyMax)}
            onClick={() => {
              onPatch({ xyBounds: { ...panel.xyBounds, [xyAxis]: [Number(xyMin), Number(xyMax)] } })
              onClose()
            }}
          >
            Apply bounds
          </button>
          <button
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
      )}
      {panel.kind === 'spectrum' && (
        <label className="block border-b border-zinc-700 pb-2">
          FFT window
          <select
            aria-label="FFT window"
            className="ml-2 bg-zinc-800"
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
      {panel.channelIds.map((id) => (
        <button
          key={id}
          className={action}
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
          className={action}
          onClick={() => {
            onFilter(panel.channelIds)
            onClose()
          }}
        >
          Filter channels…
        </button>
      )}
    </div>
  )
}
