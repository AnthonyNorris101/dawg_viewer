import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { sessionFromColumns } from '../data/columns'
import { applySetup } from '../state/setup'
import { useRecalibration } from './useRecalibration'
import { useViewerNavigation } from './useViewerNavigation'
import { useViewerWorkbook } from './useViewerWorkbook'

const raw = sessionFromColumns(
  new Float64Array([0, 1, 2, 3, 10, 20, 30, 40]).buffer,
  4,
  [{ name: 'VSS', unit: 'm/s' }],
  { name: 'run', path: 'run', source: 'wide', note: '' },
)

beforeEach(() => localStorage.clear())

it('preserves worksheets on sample updates and responds to imported workbooks', () => {
  const { result, rerender } = renderHook(({ base }) => useViewerWorkbook(base, false), {
    initialProps: { base: raw },
  })
  act(() => result.current.dispatch({ type: 'addPanel', kind: 'xy' }))
  const workbook = result.current.workbook
  rerender({ base: { ...raw, time: raw.time.slice() } })
  expect(result.current.workbook).toBe(workbook)
  expect(JSON.parse(localStorage.getItem('dawg.workbook.v1')!)).toEqual(workbook)
  act(() => applySetup({ dawgViewerSetup: 1, workbook: null, math: [], beacon: null }))
  expect(result.current.layout.panels.some((p) => p.kind === 'xy')).toBe(false)
})

it('keeps a paused live range through sample updates and resumes at the newest time', () => {
  const live = { ...raw, source: 'live' }
  const { result, rerender } = renderHook(({ base }) => useViewerNavigation(base, [], null, true), {
    initialProps: { base: live },
  })
  const sync = result.current.sync
  act(() => result.current.zoomTo(1, 2))
  expect(result.current.follow).toBe(false)
  rerender({ base: { ...live, time: new Float64Array([0, 1, 2, 4]) } })
  expect(result.current.sync).toBe(sync)
  expect(sync.range()).toEqual({ min: 1, max: 2 })
  act(() => result.current.setFollow(true))
  expect(sync.range()).toEqual({ min: 3, max: 4 })
})

it('recalibrates a wide CSV without changing its input and clears overrides on reload', () => {
  const notice = vi.fn()
  const reload = vi.fn()
  const { result, rerender } = renderHook(({ base }) => useRecalibration(base, notice, reload), {
    initialProps: { base: raw },
  })
  act(() =>
    result.current.recalibrate('VSS', undefined, { type: 'linear', mult: 2, div: 1, add: 0 }),
  )
  expect([...result.current.base.channels[0].data]).toEqual([20, 40, 60, 80])
  expect([...raw.channels[0].data]).toEqual([10, 20, 30, 40])
  rerender({ base: { ...raw } })
  expect(result.current.base.channels[0].data).toBe(raw.channels[0].data)
  rerender({ base: { ...raw, source: 'bin' } })
  act(() => result.current.recalibrate('VSS', undefined, null))
  expect(reload).toHaveBeenCalledOnce()
})
