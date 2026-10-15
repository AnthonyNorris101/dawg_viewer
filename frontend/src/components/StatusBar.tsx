import { memo, useEffect, useRef } from 'react'
import type { Session } from '../data/session'
import { onCursor, onRange } from '../plot/sync'

const seconds = (v: number) => `${v.toFixed(3)} s`

export const StatusBar = memo(function StatusBar({ session }: { session: Session }) {
  const cursorEl = useRef<HTMLSpanElement>(null)
  const rangeEl = useRef<HTMLSpanElement>(null)
  const { time } = session

  // Updated by direct DOM writes: these change on every pointer move.
  useEffect(() => {
    const offCursor = onCursor((idx) => {
      if (cursorEl.current) cursorEl.current.textContent = idx == null ? '–' : seconds(time[idx])
    })
    const offRange = onRange(({ min, max }) => {
      if (rangeEl.current) rangeEl.current.textContent = `${seconds(min)} → ${seconds(max)}`
    })
    return () => {
      offCursor()
      offRange()
    }
  }, [time])

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
