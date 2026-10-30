import { useRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { LayoutAction } from '../state/layout'
import { PanelResizeHandle } from './PanelResizeHandle'

afterEach(() => vi.unstubAllGlobals())

it('resizes a panel with the keyboard and resets it', async () => {
  const user = userEvent.setup()
  const dispatch = vi.fn<(action: LayoutAction) => void>()

  function Fixture() {
    const panelRef = useRef<HTMLElement>(null)
    return (
      <section ref={panelRef}>
        <PanelResizeHandle
          panelId={2}
          index={1}
          edge="top"
          heightPx={320}
          panelRef={panelRef}
          dispatch={dispatch}
        />
        <PanelResizeHandle
          panelId={2}
          index={1}
          edge="bottom"
          heightPx={320}
          panelRef={panelRef}
          dispatch={dispatch}
        />
      </section>
    )
  }

  render(<Fixture />)
  const handle = screen.getByRole('separator', { name: 'Resize plot 2 from bottom' })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 320,
    top: 0,
    right: 800,
    bottom: 320,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })

  await user.click(handle)
  await user.keyboard('{ArrowDown}')
  expect(dispatch).toHaveBeenLastCalledWith({ type: 'resizePanel', panelId: 2, heightPx: 344 })

  const topHandle = screen.getByRole('separator', { name: 'Resize plot 2 from top' })
  await user.click(topHandle)
  await user.keyboard('{ArrowUp}')
  expect(dispatch).toHaveBeenLastCalledWith({ type: 'resizePanel', panelId: 2, heightPx: 344 })

  fireEvent.doubleClick(handle)
  expect(dispatch).toHaveBeenLastCalledWith({ type: 'resetPanelSize', panelId: 2 })
})

it('coalesces pointer movement while dragging', () => {
  const dispatch = vi.fn<(action: LayoutAction) => void>()
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback)
      return 1
    }),
  )

  function Fixture() {
    const panelRef = useRef<HTMLElement>(null)
    return (
      <section ref={panelRef}>
        <PanelResizeHandle
          panelId={1}
          index={0}
          edge="bottom"
          panelRef={panelRef}
          dispatch={dispatch}
        />
      </section>
    )
  }

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 800,
    height: 300,
    top: 0,
    right: 800,
    bottom: 300,
    left: 0,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  })
  render(<Fixture />)
  const handle = screen.getByRole('separator', { name: 'Resize plot 1 from bottom' })

  fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 })
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 140 })
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 180 })
  expect(frames).toHaveLength(1)
  frames.shift()?.(0)
  expect(dispatch).toHaveBeenCalledOnce()
  expect(dispatch).toHaveBeenCalledWith({ type: 'resizePanel', panelId: 1, heightPx: 380 })
})
