import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it } from 'vitest'
import type { ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'
import { sessionFromColumns } from '../data/columns'
import { DEFAULT_TRACK, launchMarks, mathDefs, splits, track } from '../state/analysis'
import { useAnalysis } from './useAnalysis'

const raw = sessionFromColumns(
  new Float64Array([0, 1, 2, 10, 10, 10]).buffer,
  3,
  [{ name: 'VSS', unit: 'm/s' }],
  { name: 'run.csv', path: 'run.csv', source: 'wide', note: '' },
)

beforeEach(() => {
  track.set({ ...DEFAULT_TRACK, fuse: false, distance: 'speed' })
  splits.set({})
  launchMarks.set({})
  mathDefs.set([{ id: 'double', name: 'Double', expr: 'VSS * 2', unit: 'm/s', precision: 2 }])
})

it('preserves numerical results across cosmetic edits, including after a unit override', () => {
  const { result, rerender } = renderHook(
    ({ meta }: { meta: ChannelMeta }) => useAnalysis(raw, { VSS: meta }),
    { initialProps: { meta: { order: 0, unit: 'km/h' } as ChannelMeta } },
  )
  const distance = result.current.distance
  const laps = result.current.laps
  const math = result.current.session.byId.get('Double')!.data
  expect(distance![2]).toBeCloseTo(20 / 3.6)

  rerender({ meta: { order: 0, unit: 'km/h', label: 'Vehicle speed', color: '#123456' } })
  expect(result.current.distance).toBe(distance)
  expect(result.current.laps).toBe(laps)
  expect(result.current.session.byId.get('Double')!.data).toBe(math)
  expect(result.current.session.byId.get('VSS')).toMatchObject({
    label: 'Vehicle speed',
    color: '#123456',
  })
  expect(result.current.session.byId.get('VSS')!.data).toBe(raw.channels[0].data)

  rerender({ meta: { order: 0, unit: 'm/s' } })
  expect(result.current.distance).not.toBe(distance)
  expect(result.current.distance![2]).toBe(20)
})

it('recomputes dependent math when definitions change without rebuilding distance', () => {
  const { result } = renderHook(() => useAnalysis(raw, undefined))
  const distance = result.current.distance
  expect([...result.current.session.byId.get('Double')!.data]).toEqual([20, 20, 20])
  act(() =>
    mathDefs.set([{ id: 'double', name: 'Double', expr: 'VSS * 3', unit: 'm/s', precision: 2 }]),
  )
  expect(result.current.distance).toBe(distance)
  expect([...result.current.session.byId.get('Double')!.data]).toEqual([30, 30, 30])
})
