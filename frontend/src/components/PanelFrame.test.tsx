import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'
import type { Panel } from '../state/layout'
import { PanelFrame } from './PanelFrame'

const panel = (patch: Partial<Panel> = {}): Panel => ({
  id: 7,
  kind: 'time',
  channelIds: [],
  wide: true,
  ...patch,
})

function show(p: Panel, tall = false) {
  const dispatch = vi.fn()
  const view = render(
    <PanelFrame
      panel={p}
      active={false}
      dispatch={dispatch}
      title="Plot 1"
      legend={null}
      tall={tall}
    >
      <div />
    </PanelFrame>,
  )
  const frame = view.container.querySelector<HTMLElement>('[data-panel-id="7"]')!
  return {
    dispatch,
    frame,
    handle: within(view.container).getByRole('separator', { name: 'Resize Plot 1' }),
  }
}

describe('PanelFrame height', () => {
  it('takes the usual number of rows until one is set', () => {
    expect(show(panel()).frame.style.gridRow).toBe('span 4')
  })

  it('is twice as tall for the tall panels and follows a set height', () => {
    expect(show(panel(), true).frame.style.gridRow).toBe('span 8')
    expect(show(panel({ rows: 6 }), true).frame.style.gridRow).toBe('span 6')
    expect(show(panel({ rows: 99 })).frame.style.gridRow).toBe('span 24')
    expect(show(panel({ rows: Number.NaN })).frame.style.gridRow).toBe('span 4')
  })

  it('grows and shrinks when its bottom edge is dragged', () => {
    const { dispatch, frame, handle } = show(panel())
    frame.getBoundingClientRect = () =>
      ({ top: 100, height: 400, bottom: 500, left: 0, right: 800, width: 800 }) as DOMRect
    fireEvent.pointerDown(handle, { button: 0, clientY: 500 })
    fireEvent.pointerMove(window, { clientY: 520 })
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'setPanel' }))
    fireEvent.pointerMove(window, { clientY: 700 })
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'setPanel', panelId: 7, patch: { rows: 6 } })
    fireEvent.pointerMove(window, { clientY: 290 })
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'setPanel', panelId: 7, patch: { rows: 2 } })
    fireEvent.pointerUp(window)
    dispatch.mockClear()
    fireEvent.pointerMove(window, { clientY: 900 })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('goes back to the usual height on a double-click and steps with the arrow keys', () => {
    const { dispatch, handle } = show(panel({ rows: 6 }))
    fireEvent.keyDown(handle, { key: 'ArrowDown' })
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'setPanel', panelId: 7, patch: { rows: 7 } })
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'setPanel', panelId: 7, patch: { rows: 5 } })
    fireEvent.doubleClick(handle)
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'setPanel',
      panelId: 7,
      patch: { rows: undefined },
    })
  })
})
