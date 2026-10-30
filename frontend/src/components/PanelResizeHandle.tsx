import { useEffect, useRef, type Dispatch, type RefObject } from 'react'
import { MAX_PANEL_HEIGHT, MIN_PANEL_HEIGHT } from '../state/graphProfiles'
import type { LayoutAction } from '../state/layout'

const RESIZE_STEP = 24

export function PanelResizeHandle({
  panelId,
  index,
  edge,
  heightPx,
  panelRef,
  dispatch,
}: {
  panelId: number
  index: number
  edge: 'top' | 'bottom'
  heightPx?: number
  panelRef: RefObject<HTMLElement>
  dispatch: Dispatch<LayoutAction>
}) {
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null)
  const pendingHeight = useRef<number | null>(null)
  const frame = useRef<number | null>(null)

  const scheduleResize = (nextHeight: number) => {
    pendingHeight.current = nextHeight
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      if (pendingHeight.current === null) return
      dispatch({ type: 'resizePanel', panelId, heightPx: pendingHeight.current })
      pendingHeight.current = null
    })
  }

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  const measuredHeight = () => panelRef.current?.getBoundingClientRect().height ?? heightPx ?? 0
  const growsDown = edge === 'bottom'

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={`Resize plot ${index + 1} from ${edge}`}
      aria-orientation="horizontal"
      aria-valuemin={MIN_PANEL_HEIGHT}
      aria-valuemax={MAX_PANEL_HEIGHT}
      aria-valuenow={heightPx ?? MIN_PANEL_HEIGHT}
      aria-valuetext={heightPx ? `${heightPx} pixels` : 'Automatic size'}
      title={`Drag ${growsDown ? 'down' : 'up'} to enlarge. Press Home or double-click to reset.`}
      className={`absolute right-0 ${growsDown ? 'bottom-0' : 'top-0'} z-20 size-6 cursor-ns-resize touch-none text-zinc-600 hover:text-zinc-300 focus-visible:text-zinc-100 focus-visible:outline-none`}
      onPointerDown={(event) => {
        event.currentTarget.focus()
        event.preventDefault()
        drag.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          startHeight: measuredHeight(),
        }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return
        const delta = event.clientY - drag.current.startY
        scheduleResize(drag.current.startHeight + (growsDown ? delta : -delta))
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointerId !== event.pointerId) return
        drag.current = null
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
      onDoubleClick={() => dispatch({ type: 'resetPanelSize', panelId })}
      onKeyDown={(event) => {
        if (event.key === 'Home') {
          event.preventDefault()
          dispatch({ type: 'resetPanelSize', panelId })
          return
        }
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        const step = event.shiftKey ? RESIZE_STEP * 4 : RESIZE_STEP
        const direction = (event.key === 'ArrowDown' ? 1 : -1) * (growsDown ? 1 : -1)
        dispatch({
          type: 'resizePanel',
          panelId,
          heightPx: measuredHeight() + direction * step,
        })
      }}
    >
      <span
        className={`absolute right-1 size-2 border-r border-current ${
          growsDown ? 'bottom-1 border-b' : 'top-1 border-t'
        }`}
      />
    </div>
  )
}
