import { memo, useEffect, useRef } from 'react'
import type { Session } from '../data/session'
import type { ViewSync } from '../plot/sync'

const seconds = (v: number) => `${v.toFixed(3)} s`

export const StatusBar = memo(function StatusBar({
  session,
  sync,
}: {
  session: Session
  sync: ViewSync
}) {
  const cursorEl = useRef<HTMLSpanElement>(null)
  const rangeEl = useRef<HTMLSpanElement>(null)
  const { time } = session

  useEffect(() => {
    const offCursor = sync.onCursor((idx) => {
      if (cursorEl.current) cursorEl.current.textContent = idx == null ? '–' : seconds(time[idx])
    })
    const offRange = sync.onRange(({ min, max }) => {
      if (rangeEl.current) rangeEl.current.textContent = `${seconds(min)} → ${seconds(max)}`
    })
    return () => {
      offCursor()
      offRange()
    }
  }, [time, sync])

  return (
    <footer className="flex items-center gap-6 border-t border-zinc-800 px-3 py-1 text-xs text-zinc-500 tabular-nums">
      <span>
        {session.channels.length} channels · {time.length.toLocaleString()} samples ·{' '}
        {session.sampleRate} Hz
      </span>
      <span className="ml-auto">
        View{' '}
        <span ref={rangeEl} className="text-zinc-300">
          {seconds(time[0])} → {seconds(time[time.length - 1])}
        </span>
      </span>
      <span>
        Cursor{' '}
        <span ref={cursorEl} className="inline-block min-w-20 text-right text-zinc-300">
          –
        </span>
      </span>
    </footer>
  )
})
