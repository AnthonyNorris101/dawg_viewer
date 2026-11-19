import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'
import { isLiveShown, onLiveFrame, status, store } from './connection'
import { ageColor, formatValue, level } from './format'
import { moveCard, previewCardMove, type CardDropPosition, type CardItem } from './cardLayout'

const LEVEL_BG = {
  ok: 'rgb(24 24 27)',
  warn: 'rgb(120 83 9)',
  crit: 'rgb(127 29 29)',
}

interface CardEls {
  root: HTMLDivElement
  value: HTMLSpanElement
  dot: HTMLSpanElement | null
}

interface CardDropPreview {
  source: string
  target: string
  position: CardDropPosition
}

export const PinnedCards = memo(function PinnedCards({
  metas,
  channels,
  cards,
  editing,
  onEdit,
  onCards,
  cardRef,
}: {
  metas: Record<string, ChannelMeta | undefined>
  channels?: string[]
  cards: CardItem[]
  editing: boolean
  onEdit: () => void
  onCards: (cards: CardItem[]) => void
  cardRef: React.Ref<HTMLDivElement>
}) {
  const els = useRef(new Map<string, CardEls>())
  const dragged = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const [dropPreview, setDropPreview] = useState<CardDropPreview | null>(null)
  const [query, setQuery] = useState('')

  const clearDrag = () => {
    dragged.current = null
    setDragging(null)
    setDropPreview(null)
  }

  const previewCards = useMemo(
    () =>
      dropPreview
        ? previewCardMove(cards, dropPreview.source, dropPreview.target, dropPreview.position)
        : cards,
    [cards, dropPreview],
  )

  const pinned = useMemo(() => new Set(cards.map((c) => c.name)), [cards])

  const allCandidates = useMemo(() => {
    const names = new Set<string>([...(channels ?? []), ...Object.keys(metas)])
    return [...names].sort(
      (a, b) => (metas[a]?.order ?? 999) - (metas[b]?.order ?? 999) || a.localeCompare(b),
    )
  }, [channels, metas])

  const matches = useMemo(() => {
    const trimmed = query.trim()
    if (!trimmed) return []
    const q = trimmed.toLowerCase()
    const filtered = allCandidates.filter((name) => {
      if (pinned.has(name)) return false
      const meta = metas[name]
      return (
        name.toLowerCase().includes(q) ||
        (meta?.label ?? '').toLowerCase().includes(q) ||
        (meta?.unit ?? '').toLowerCase().includes(q)
      )
    })
    if (
      !pinned.has(trimmed) &&
      !filtered.some((name) => name.toLowerCase() === q) &&
      !Array.from(pinned).some((name) => name.toLowerCase() === q)
    ) {
      filtered.push(trimmed)
    }
    return filtered
  }, [allCandidates, metas, pinned, query])

  const addCard = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed || pinned.has(trimmed)) return
    onCards([...cards, { name: trimmed, wide: false }])
    setQuery('')
  }

  useEffect(() => {
    const update = () => {
      const st = status.get()
      const startedAt = st.startedAt
      const disconnected = st.state === 'stopped' || st.state === 'error'
      const now = startedAt ? (Date.now() - startedAt) / 1000 : undefined
      for (const { name } of cards) {
        const meta = metas[name]
        const el = els.current.get(name)
        if (!el) continue
        const v = store.latest(name)
        const at = store.lastUpdate(name)
        const age =
          at !== undefined ? (disconnected || now === undefined ? 15 : now - at) : undefined
        const color = ageColor(age)
        el.value.textContent = formatValue(v, meta)
        el.root.style.background = LEVEL_BG[level(v, meta)]
        el.root.style.borderColor = color
        if (el.dot) el.dot.style.background = color
      }
    }
    update()
    const off = onLiveFrame(update)
    const timer = setInterval(() => isLiveShown() && update(), 500)
    return () => {
      offStore()
      offStatus?.()
      clearInterval(timer)
    }
  }, [cards, metas])

  return (
    <div
      ref={cardRef}
      aria-label="Live value cards"
      onDoubleClick={onEdit}
      className={`shrink-0 border-b border-zinc-800 bg-zinc-950/80 px-3 py-2 transition-colors ${
        editing ? 'ring-1 ring-red-500/80 ring-inset' : ''
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="relative flex items-center gap-2">
          <div className="relative flex items-center">
            <input
              type="search"
              aria-label="Search data points"
              placeholder="+ Pin data point…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && matches.length > 0) {
                  event.preventDefault()
                  event.stopPropagation()
                  addCard(matches[0])
                } else if (event.key === 'Escape' && query) {
                  event.stopPropagation()
                  setQuery('')
                }
              }}
              className="w-48 rounded-md border border-zinc-800 bg-zinc-900/90 px-2.5 py-1 text-xs text-zinc-100 transition-colors outline-none placeholder:text-zinc-500 focus:w-60 focus:border-red-500"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {query.trim() !== '' && (
            <div
              role="listbox"
              aria-label="Matching data points"
              className="absolute top-full left-0 z-30 mt-1 flex max-h-52 w-64 flex-col gap-0.5 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
            >
              {matches.length > 0 ? (
                matches.map((name) => {
                  const meta = metas[name]
                  return (
                    <button
                      key={name}
                      type="button"
                      aria-label={`Add ${name} card`}
                      onClick={() => addCard(name)}
                      className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs text-zinc-200 hover:bg-zinc-800"
                    >
                      <span className="truncate font-medium">
                        {meta?.label ? `${meta.label} (${name})` : name}
                      </span>
                      {meta?.unit ? (
                        <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                          {meta.unit}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] text-zinc-500">+ Pin</span>
                      )}
                    </button>
                  )
                })
              ) : (
                <span className="px-2 py-1 text-xs text-zinc-500">Already pinned</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-zinc-500">
          {editing ? (
            <span className="rounded bg-red-500/10 px-2 py-0.5 text-red-300">
              Click outside to save · Double click a card to resize
            </span>
          ) : (
            <button
              type="button"
              onClick={onEdit}
              className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
            >
              Double click to edit
            </button>
          )}
        </div>
      </div>

      <div
        className="grid grid-flow-row-dense grid-cols-[repeat(auto-fill,minmax(9.25rem,1fr))] gap-2"
        onDragLeave={(event) => {
          const next = event.relatedTarget
          if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
            setDropPreview(null)
          }
        }}
      >
        {previewCards.map(({ name, wide }, index) => {
          const meta = metas[name]
          const phantom = dropPreview?.source === name
          const initialColor = ageColor(undefined)
          if (phantom) {
            return (
              <div
                key={name}
                data-testid="card-drop-phantom"
                data-card-name={name}
                aria-hidden="true"
                onDragOver={(event) => event.preventDefault()}
                onDragEnd={clearDrag}
                onDrop={(event) => {
                  event.preventDefault()
                  onCards(previewCards)
                  clearDrag()
                }}
                className={`flex h-[4.25rem] min-w-0 items-center justify-center rounded-lg border-2 border-dashed border-red-400 bg-red-500/10 text-xs font-medium text-red-200 shadow-[inset_0_0_0_1px_rgb(239_68_68_/_0.15)] ${
                  wide ? 'col-span-2' : 'col-span-1'
                }`}
              >
                Drop {meta?.label || name} here
              </div>
            )
          }
          return (
            <div
              key={name}
              data-card-name={name}
              draggable={editing}
              onDragStart={(event) => {
                dragged.current = name
                setDragging(name)
                setDropPreview(null)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(event) => {
                if (editing && dragged.current && dragged.current !== name) {
                  event.preventDefault()
                  const bounds = event.currentTarget.getBoundingClientRect()
                  const position: CardDropPosition =
                    event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after'
                  setDropPreview((current) => {
                    const next = { source: dragged.current!, target: name, position }
                    return current?.source === next.source &&
                      current.target === next.target &&
                      current.position === next.position
                      ? current
                      : next
                  })
                }
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dropPreview?.source === dragged.current) onCards(previewCards)
                clearDrag()
              }}
              onDragEnd={clearDrag}
              onDoubleClick={(event) => {
                if (!editing) return
                event.stopPropagation()
                onCards(
                  cards.map((card) => (card.name === name ? { ...card, wide: !card.wide } : card)),
                )
              }}
              ref={(root) => {
                const value = root?.querySelector<HTMLSpanElement>('[data-value]')
                const dot = root?.querySelector<HTMLSpanElement>('[data-dot]') ?? null
                if (root && value) els.current.set(name, { root, value, dot })
                else els.current.delete(name)
              }}
              className={`group relative flex h-[4.25rem] min-w-0 flex-col justify-between rounded-lg border-2 px-3 py-1.5 shadow-sm transition-colors ${
                wide ? 'col-span-2' : 'col-span-1'
              } ${editing ? 'cursor-grab active:cursor-grabbing' : ''} ${
                editing && dragging === name ? 'opacity-40' : ''
              }`}
              style={{ borderColor: initialColor, background: LEVEL_BG.ok }}
              title={name}
            >
              <div className="flex items-center justify-between gap-1.5 text-[11px] font-medium text-zinc-400">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    data-dot
                    className="size-1.5 shrink-0 rounded-full transition-colors"
                    style={{ background: initialColor }}
                  />
                  <span className="truncate">{meta?.label || name}</span>
                </span>
                {editing ? (
                  <button
                    type="button"
                    aria-label={`Remove ${name} card`}
                    className="rounded px-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-300"
                    onClick={() => onCards(cards.filter((card) => card.name !== name))}
                  >
                    ×
                  </button>
                ) : (
                  meta?.unit && (
                    <span className="shrink-0 text-[10px] font-normal text-zinc-500">
                      {meta.unit}
                    </span>
                  )
                )}
              </div>

              <div className="flex items-baseline justify-between gap-1">
                <span className="flex min-w-0 items-baseline gap-1">
                  <span
                    data-value
                    className={`truncate leading-none font-semibold text-zinc-50 tabular-nums ${
                      wide ? 'text-3xl' : 'text-xl'
                    }`}
                  >
                    --
                  </span>
                  {editing && meta?.unit && (
                    <span className="text-xs text-zinc-500">{meta.unit}</span>
                  )}
                </span>

                {editing && (
                  <div className="flex shrink-0 items-center gap-1 rounded border border-zinc-700/80 bg-zinc-950/90 px-1.5 py-0.5 text-[11px] text-zinc-300">
                    <button
                      type="button"
                      aria-label={`Move ${name} left`}
                      disabled={index === 0}
                      className="px-0.5 hover:text-white disabled:opacity-30"
                      onClick={() => onCards(moveCard(cards, name, cards[index - 1].name))}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${name} right`}
                      disabled={index === cards.length - 1}
                      className="px-0.5 hover:text-white disabled:opacity-30"
                      onClick={() => onCards(moveCard(cards, name, cards[index + 1].name))}
                    >
                      →
                    </button>
                    <button
                      type="button"
                      aria-label={`Toggle ${name} width`}
                      className={`rounded px-1 ${
                        wide ? 'bg-red-500/20 text-red-300' : 'hover:text-white'
                      }`}
                      onClick={() =>
                        onCards(
                          cards.map((card) =>
                            card.name === name ? { ...card, wide: !card.wide } : card,
                          ),
                        )
                      }
                    >
                      Width
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
})
