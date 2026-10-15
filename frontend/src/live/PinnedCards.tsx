import { memo, useEffect, useMemo, useRef } from 'react'
import type { ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'
import { status, store } from './connection'
import { ageColor, formatValue, level } from './format'

const LEVEL_BG = {
  ok: 'rgb(24 24 27)',
  warn: 'rgb(120 83 9)',
  crit: 'rgb(127 29 29)',
}

interface CardEls {
  root: HTMLDivElement
  value: HTMLSpanElement
}

export const PinnedCards = memo(function PinnedCards({
  metas,
}: {
  metas: Record<string, ChannelMeta | undefined>
}) {
  const pinned = useMemo(
    () =>
      Object.entries(metas)
        .filter((e): e is [string, ChannelMeta] => !!e[1]?.pinned)
        .sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0])),
    [metas],
  )
  const els = useRef(new Map<string, CardEls>())

  useEffect(() => {
    const update = () => {
      const startedAt = status.get().startedAt
      const now = startedAt ? (Date.now() - startedAt) / 1000 : undefined
      for (const [name, meta] of pinned) {
        const el = els.current.get(name)
        if (!el) continue
        const v = store.latest(name)
        const at = store.lastUpdate(name)
        el.value.textContent = formatValue(v, meta)
        el.root.style.background = LEVEL_BG[level(v, meta)]
        el.root.style.borderColor = ageColor(
          now !== undefined && at !== undefined ? now - at : undefined,
        )
      }
    }
    update()
    const off = store.subscribe(update)
    const timer = setInterval(update, 500)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [pinned])

  if (pinned.length === 0) return null
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2 border-b border-zinc-800 p-2">
      {pinned.map(([name, meta]) => (
        <div
          key={name}
          ref={(root) => {
            const value = root?.querySelector<HTMLSpanElement>('[data-value]')
            if (root && value) els.current.set(name, { root, value })
            else els.current.delete(name)
          }}
          className={`flex flex-col rounded-lg border-2 px-3 py-1.5 transition-colors ${
            meta.large ? 'col-span-2' : ''
          }`}
          style={{ borderColor: ageColor(undefined), background: LEVEL_BG.ok }}
          title={name}
        >
          <span className="truncate text-xs text-zinc-400">{meta.label || name}</span>
          <span className="flex items-baseline gap-1">
            <span
              data-value
              className={`font-semibold text-zinc-50 tabular-nums ${meta.large ? 'text-4xl' : 'text-2xl'}`}
            >
              --
            </span>
            {meta.unit && <span className="text-sm text-zinc-500">{meta.unit}</span>}
          </span>
        </div>
      ))}
    </div>
  )
})
