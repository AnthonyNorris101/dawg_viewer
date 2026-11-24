import { render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { sessionFromColumns } from '../data/columns'
import { mountPlot, type PlotOptions } from '../plot/mountPlot'
import { createViewSync } from '../plot/sync'
import { timeView } from '../viewer/xview'
import { PlotPanel } from './PlotPanel'

const plot = vi.hoisted(() => ({
  update: vi.fn(),
  destroy: vi.fn(),
  setSpikeFree: vi.fn(),
  setYBounds: vi.fn(),
  zoom: vi.fn(),
}))
vi.mock('../plot/mountPlot', () => ({ mountPlot: vi.fn(() => plot) }))

const session = (values: number[]) =>
  sessionFromColumns(new Float64Array(values).buffer, 2, [{ name: 'RPM', unit: 'rpm' }], {
    name: 'run',
    path: 'run',
    source: 'wide',
    note: '',
  })

beforeEach(() => vi.clearAllMocks())

it('updates data, bounds, markers, and cursor values without remounting or resetting y zoom', () => {
  const sync = createViewSync('test')
  sync.setRange({ min: 0.25, max: 0.75 })
  const raw = session([0, 1, 1000, 2000])
  const props = {
    panel: { id: 1, kind: 'time' as const, channelIds: ['RPM'], wide: true },
    index: 0,
    active: true,
    sync,
    dispatch: vi.fn(),
  }
  const { rerender, unmount } = render(
    <PlotPanel {...props} session={raw} view={timeView(raw.time, [])} />,
  )
  const next = session([0, 2, 3000, 4000])
  const view = { ...timeView(next.time, []), markers: [{ x: 1, label: 'L1' }] }
  rerender(<PlotPanel {...props} session={next} view={view} />)
  expect(mountPlot).toHaveBeenCalledTimes(1)
  expect(plot.destroy).not.toHaveBeenCalled()
  expect(plot.setSpikeFree).toHaveBeenCalledTimes(1)
  expect(plot.update.mock.lastCall![0][1]).toBe(next.channels[0].data)
  expect(sync.range()).toEqual({ min: 0.25, max: 0.75 })
  const options = vi.mocked(mountPlot).mock.calls[0][1] as PlotOptions
  expect(options.bounds()).toEqual([0, 2])
  expect(typeof options.markers === 'function' && options.markers()).toEqual(view.markers)
  options.onCursor(1)
  expect(screen.getByText('4000.00')).toBeInTheDocument()
  unmount()
  expect(plot.destroy).toHaveBeenCalledOnce()
})

it('rebuilds when the series scale changes', () => {
  const raw = session([0, 1, 1000, 2000])
  const view = timeView(raw.time, [])
  const props = {
    panel: { id: 1, kind: 'time' as const, channelIds: ['RPM'], wide: true },
    index: 0,
    active: true,
    sync: createViewSync('test'),
    dispatch: vi.fn(),
  }
  const { rerender } = render(<PlotPanel {...props} session={raw} view={view} />)
  const ch = { ...raw.channels[0], unit: 'Hz' }
  rerender(
    <PlotPanel
      {...props}
      session={{ ...raw, channels: [ch], byId: new Map([['RPM', ch]]) }}
      view={view}
    />,
  )
  expect(mountPlot).toHaveBeenCalledTimes(2)
  expect(plot.destroy).toHaveBeenCalledOnce()
})
