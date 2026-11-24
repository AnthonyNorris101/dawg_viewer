import { expect, it } from 'vitest'
import { assignBentoSlots, previewBentoPlacement, visualBentoOrder } from './liveBento'

it('fills cells left to right and returns visual order for the default stack', () => {
  const ids = ['plot:1', 'plot:2', 'plot:3', 'plot:4']
  const sizes = { 'plot:1': { width: 'half', height: 'tall' } as const }
  const places = assignBentoSlots(ids, sizes, {})
  expect(places.map((p) => [p.id, p.row, p.column])).toEqual([
    ['plot:1', 0, 0],
    ['plot:2', 0, 1],
    ['plot:3', 1, 1],
    ['plot:4', 2, 0],
  ])
  expect(visualBentoOrder(places)).toEqual(ids)
})

it('previews swaps and exact empty-cell drops', () => {
  const places = assignBentoSlots(['a', 'b', 'c'], {}, {})
  expect(previewBentoPlacement(places, 'a', { row: 0, column: 1 })).toMatchObject([
    { id: 'a', row: 0, column: 1 },
    { id: 'b', row: 0, column: 0 },
    { id: 'c', row: 1, column: 0 },
  ])
  expect(previewBentoPlacement(places, 'a', { row: 1, column: 1 })?.[0]).toMatchObject({
    row: 1,
    column: 1,
  })
})

it('anchors a tall card above the lower short card when replacing two cells', () => {
  const places = assignBentoSlots(
    ['tall', 'top', 'bottom'],
    { tall: { width: 'half', height: 'tall' } },
    {},
  )
  const preview = previewBentoPlacement(places, 'tall', { row: 1, column: 1 })
  expect(preview?.find((p) => p.id === 'tall')).toMatchObject({ row: 0, column: 1 })
  expect(preview?.find((p) => p.id === 'top')).toMatchObject({ row: 0, column: 0 })
  expect(preview?.find((p) => p.id === 'bottom')).toMatchObject({ row: 1, column: 0 })
})
