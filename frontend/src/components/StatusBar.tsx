import { memo, useEffect, useRef } from 'react'
import type { Session } from '../data/session'
import type { ViewSync } from '../plot/sync'
import { slotSummary, type XView } from '../viewer/xview'

export const StatusBar = memo(function StatusBar({
  session,
  sync,
  view,
}: {
  session: Session
  sync: ViewSync
  view: XView
}) {
  const cursorEl = useRef<HTMLSpanElement>(null)
  const rangeEl = useRef<HTMLSpanElement>(null)
  const { time } = session

  useEffect(() => {
    const offCursor = sync.onCursor((idx) => {
      if (cursorEl.current)
        cursorEl.current.textContent = idx == null ? '–' : view.formatX(view.x[idx])
    })
    const offRange = sync.onRange(({ min, max }) => {
      if (rangeEl.current)
        rangeEl.current.textContent = `${view.formatX(min)} → ${view.formatX(max)}`
    })
    return () => {
      offCursor()
      offRange()
    }
  }, [view, sync])

  const summary = slotSummary(view)

  return (
    <footer className="flex items-center gap-6 border-t border-zinc-800 px-3 py-1 text-xs text-zinc-500 tabular-nums">
      <span className="truncate">
        {summary ? (
          <>Overlay {summary}</>
        ) : (
          <>
            {session.channels.length} channels · {time.length.toLocaleString()} samples ·{' '}
            {session.sampleRate} Hz
          </>
        )}
      </span>
      <span className="ml-auto shrink-0">
        View{' '}
        <span ref={rangeEl} className="text-zinc-300">
          {view.formatX(view.bounds[0])} → {view.formatX(view.bounds[1])}
        </span>
      </span>
      <span className="shrink-0">
        Cursor{' '}
        <span ref={cursorEl} className="inline-block min-w-20 text-right text-zinc-300">
          –
        </span>
      </span>
    </footer>
  )
})
