import { useEffect, useRef, useState, type Dispatch } from 'react'
import { createPortal } from 'react-dom'
import { decodeGraphCode, encodeGraphCode, resolvePanels } from '../state/graphCode'
import { cacheNames, DEFAULT_PANELS, loadProfiles, saveProfiles } from '../state/graphProfiles'
import type { Layout, LayoutAction } from '../state/layout'
import { toolbarButton } from '../ui'

const fieldClass = 'w-full min-w-0 rounded border border-zinc-700 bg-zinc-900 p-1 select-text'

export function GraphProfileControls({
  target,
  layout,
  dispatch,
  names,
  windowS,
  onWindow,
}: {
  target: HTMLElement
  layout: Layout
  dispatch: Dispatch<LayoutAction>
  names: string[]
  windowS?: number
  onWindow?: (seconds: number) => void
}) {
  const [profiles, setProfiles] = useState(loadProfiles)
  const [selected, setSelected] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<string[][] | null>(null)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const namesKey = JSON.stringify(names)

  useEffect(() => {
    let canceled = false
    const panels = layout.panels.map((panel) => panel.channelIds)
    const heights = layout.panels.map((panel) => panel.heightPx ?? null)
    const cached = cacheNames(JSON.parse(namesKey))
    if (panels.flat().some((channel) => channel.startsWith('~'))) {
      void resolvePanels(panels, cached)
        .then((next) => {
          if (!canceled && JSON.stringify(next) !== JSON.stringify(panels))
            dispatch({ type: 'replaceLayout', panels: next, heights })
        })
        .catch(() => {})
    }
    return () => {
      canceled = true
    }
  }, [namesKey, layout.panels, dispatch])

  useEffect(() => {
    if (!open) return
    const closeOnPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const run = async (fn: () => void | Promise<void>) => {
    setMessage('')
    try {
      await fn()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }

  return createPortal(
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={toolbarButton}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        Profiles
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Graph profiles"
          className="absolute top-full right-0 z-50 mt-1 max-h-[calc(100vh-3rem)] w-[min(32rem,calc(100vw-1rem))] space-y-4 overflow-y-auto rounded border border-zinc-700 bg-zinc-950 p-3 text-xs shadow-xl"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium text-zinc-100">Graph profiles</h2>
            <span className="text-zinc-500">
              {layout.panels.length}/5 charts ·{' '}
              {layout.panels.reduce((count, panel) => count + panel.channelIds.length, 0)}/15
              channels
            </span>
          </div>

          <label className="block space-y-1">
            <span className="text-zinc-400">Load profile</span>
            <select
              aria-label="Graph profile"
              className={fieldClass}
              value={selected}
              onChange={(event) => {
                const value = event.target.value
                setSelected(value)
                const profile =
                  value === 'Default'
                    ? { panels: DEFAULT_PANELS, windowS: 30 }
                    : profiles.find((candidate) => candidate.name === value)
                if (profile) {
                  dispatch({
                    type: 'replaceLayout',
                    panels: profile.panels,
                    heights: 'heights' in profile ? profile.heights : undefined,
                  })
                  if (profile.windowS) onWindow?.(profile.windowS)
                }
              }}
            >
              <option value="">Custom</option>
              <option>Default</option>
              {profiles.map((profile) => (
                <option key={profile.name}>{profile.name}</option>
              ))}
            </select>
          </label>

          <section className="space-y-2 border-t border-zinc-800 pt-3">
            <h3 className="text-zinc-400">Save locally</h3>
            <div className="flex gap-2">
              <input
                aria-label="Profile name"
                placeholder="Profile name"
                className={fieldClass}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                type="button"
                className={toolbarButton}
                onClick={() =>
                  void run(() => {
                    const trimmed = name.trim()
                    if (!trimmed || trimmed === 'Default')
                      throw new Error('Enter a name other than Default.')
                    if (
                      profiles.some((profile) => profile.name === trimmed) &&
                      !window.confirm(`Replace ${trimmed}?`)
                    )
                      return
                    const heights = layout.panels.map((panel) => panel.heightPx ?? null)
                    const next = [
                      ...profiles.filter((profile) => profile.name !== trimmed),
                      {
                        name: trimmed,
                        panels: layout.panels.map((panel) => panel.channelIds),
                        heights: heights.some((height) => height !== null) ? heights : undefined,
                        windowS: Number.isFinite(windowS) ? windowS : undefined,
                      },
                    ]
                    saveProfiles(next)
                    setProfiles(next)
                    setSelected(trimmed)
                  })
                }
              >
                Save
              </button>
              <button
                type="button"
                className={toolbarButton}
                disabled={!profiles.some((profile) => profile.name === selected)}
                onClick={() =>
                  void run(() => {
                    const next = profiles.filter((profile) => profile.name !== selected)
                    saveProfiles(next)
                    setProfiles(next)
                    setSelected('')
                  })
                }
              >
                Delete
              </button>
            </div>
          </section>

          <section className="space-y-2 border-t border-zinc-800 pt-3">
            <h3 className="text-zinc-400">Share offline</h3>
            <div className="flex gap-2">
              <button
                type="button"
                className={toolbarButton}
                onClick={() =>
                  void run(async () => {
                    setCode(
                      await encodeGraphCode(
                        layout.panels.map((panel) => panel.channelIds),
                        cacheNames(names).length,
                      ),
                    )
                    setPreview(null)
                  })
                }
              >
                Generate code
              </button>
              <button
                type="button"
                className={toolbarButton}
                disabled={!code}
                onClick={() =>
                  void run(async () => {
                    await navigator.clipboard.writeText(code)
                    setMessage('Copied.')
                  })
                }
              >
                Copy
              </button>
            </div>
            <textarea
              aria-label="Graph code"
              placeholder="Generate or paste an offline graph code"
              rows={3}
              className={fieldClass}
              value={code}
              onChange={(event) => {
                setCode(event.target.value)
                setPreview(null)
              }}
            />
            <button
              type="button"
              className={toolbarButton}
              disabled={!code.trim()}
              onClick={() =>
                void run(async () => {
                  setPreview(await resolvePanels(decodeGraphCode(code), cacheNames(names)))
                })
              }
            >
              Preview import
            </button>
            {preview && (
              <div className="space-y-1 rounded border border-zinc-800 p-2">
                {preview.map((panel, index) => (
                  <p key={index}>
                    Chart {index + 1}:{' '}
                    {panel
                      .map((channel) => (channel.startsWith('~') ? 'Unavailable channel' : channel))
                      .join(', ') || 'Empty'}
                  </p>
                ))}
                <button
                  type="button"
                  className={toolbarButton}
                  onClick={() => {
                    dispatch({ type: 'replaceLayout', panels: preview })
                    setSelected('')
                    setPreview(null)
                  }}
                >
                  Apply
                </button>
              </div>
            )}
          </section>

          {message && (
            <p role="status" className="text-amber-300">
              {message}
            </p>
          )}
        </div>
      )}
    </div>,
    target,
  )
}
