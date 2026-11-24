import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LiveGraphStack } from './LiveGraphStack'

function dragAt(grid: Element, type: 'dragover' | 'drop', x: number, y: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y } })
  fireEvent(grid, event)
}

it('previews a slot swap with a phantom and commits on drop', () => {
  const onSlots = vi.fn()
  const view = render(
    <LiveGraphStack
      ids={['plot:1', 'plot:2']}
      sizes={{}}
      slots={{}}
      mode="bento"
      onSlots={onSlots}
      render={(id, _, startDrag) => (
        <span draggable onDragStart={startDrag} aria-label={`Drag ${id}`}>
          {id}
        </span>
      )}
    />,
  )
  const grid = screen.getByRole('main').firstElementChild!
  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 600,
  } as DOMRect)
  fireEvent.dragStart(screen.getByLabelText('Drag plot:1'), { dataTransfer: { effectAllowed: '' } })
  dragAt(grid, 'dragover', 750, 50)
  expect(screen.getByTestId('plot-phantom')).toHaveStyle({ gridColumn: '2' })
  expect(view.container.querySelector('[data-graph-id="plot:2"]')).toHaveStyle({ gridColumn: '1' })
  dragAt(grid, 'drop', 750, 50)
  expect(onSlots).toHaveBeenCalledWith({
    'plot:1': { row: 0, column: 1 },
    'plot:2': { row: 0, column: 0 },
  })
  expect(screen.queryByTestId('plot-phantom')).not.toBeInTheDocument()
})

it('can drop into an empty grid cell', () => {
  const onSlots = vi.fn()
  render(
    <LiveGraphStack
      ids={['plot:1', 'plot:2', 'plot:3']}
      sizes={{}}
      slots={{}}
      mode="bento"
      onSlots={onSlots}
      render={(id, _, startDrag) => (
        <span draggable onDragStart={startDrag} aria-label={`Drag ${id}`}>
          {id}
        </span>
      )}
    />,
  )
  const grid = screen.getByRole('main').firstElementChild!
  vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 1000,
    height: 600,
  } as DOMRect)
  fireEvent.dragStart(screen.getByLabelText('Drag plot:1'), { dataTransfer: { effectAllowed: '' } })
  dragAt(grid, 'dragover', 750, 350)
  expect(screen.getByTestId('plot-phantom')).toHaveStyle({ gridRow: '2 / span 1', gridColumn: '2' })
  dragAt(grid, 'drop', 750, 350)
  expect(onSlots.mock.calls[0][0]['plot:1']).toEqual({ row: 1, column: 1 })
})
