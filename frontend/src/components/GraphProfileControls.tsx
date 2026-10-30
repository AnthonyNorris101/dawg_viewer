import { useEffect, useState, type Dispatch } from 'react'
import { cacheNames, DEFAULT_PANELS, loadProfiles, saveProfiles } from '../state/graphProfiles'
import { decodeGraphCode, encodeGraphCode, resolvePanels } from '../state/graphCode'
import type { Layout, LayoutAction } from '../state/layout'
import { toolbarButton } from '../ui'

export function GraphProfileControls({
  layout,
  dispatch,
  names,
  windowS,
  onWindow,
}: {
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
  const namesKey = JSON.stringify(names)
  useEffect(() => {
    let canceled = false
    const panels = layout.panels.map((p) => p.channelIds)
    const cached = cacheNames(JSON.parse(namesKey))
    if (panels.flat().some((n) => n.startsWith('~'))) {
      void resolvePanels(panels, cached)
        .then((next) => {
          if (!canceled && JSON.stringify(next) !== JSON.stringify(panels))
            dispatch({ type: 'replaceLayout', panels: next })
        })
        .catch(() => {})
    }
    return () => {
      canceled = true
    }
  }, [namesKey, layout.panels, dispatch])

  const run = async (fn: () => void | Promise<void>) => {
    setMessage('')
    try {
      await fn()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <div className="shrink-0 border-b border-zinc-800 px-3 py-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label>
          Graph profile{' '}
          <select
            aria-label="Graph profile"
            className="bg-zinc-900"
            value={selected}
            onChange={(e) => {
              const value = e.target.value
              setSelected(value)
              const profile =
                value === 'Default'
                  ? { panels: DEFAULT_PANELS, windowS: 30 }
                  : profiles.find((p) => p.name === value)
              if (profile) {
                dispatch({ type: 'replaceLayout', panels: profile.panels })
                if (profile.windowS) onWindow?.(profile.windowS)
              }
            }}
          >
            <option value="">Custom</option>
            <option>Default</option>
            {profiles.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </select>
        </label>
        <button className={toolbarButton} onClick={() => setOpen(!open)}>
          Manage / share
        </button>
        <span className="text-zinc-500">
          {layout.panels.length}/5 charts ·{' '}
          {layout.panels.reduce((n, p) => n + p.channelIds.length, 0)}/15 channels
        </span>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            aria-label="Profile name"
            placeholder="Profile name"
            className="min-w-0 bg-zinc-900 p-1"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className={toolbarButton}
            onClick={() =>
              void run(() => {
                const trimmed = name.trim()
                if (!trimmed || trimmed === 'Default')
                  throw new Error('Enter a name other than Default.')
                if (
                  profiles.some((p) => p.name === trimmed) &&
                  !window.confirm(`Replace ${trimmed}?`)
                )
                  return
                const next = [
                  ...profiles.filter((p) => p.name !== trimmed),
                  {
                    name: trimmed,
                    panels: layout.panels.map((p) => p.channelIds),
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
            className={toolbarButton}
            disabled={!profiles.some((p) => p.name === selected)}
            onClick={() =>
              void run(() => {
                const next = profiles.filter((p) => p.name !== selected)
                saveProfiles(next)
                setProfiles(next)
                setSelected('')
              })
            }
          >
            Delete
          </button>
          <button
            className={toolbarButton}
            onClick={() =>
              void run(async () => {
                setCode(
                  await encodeGraphCode(
                    layout.panels.map((p) => p.channelIds),
                    cacheNames(names).length,
                  ),
                )
                setPreview(null)
              })
            }
          >
            Share
          </button>
          <input
            aria-label="Graph code"
            placeholder="Paste offline graph code"
            className="min-w-0 flex-1 bg-zinc-900 p-1 select-text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              setPreview(null)
            }}
          />
          <button
            className={toolbarButton}
            onClick={() =>
              void run(async () => {
                await navigator.clipboard.writeText(code)
                setMessage('Copied.')
              })
            }
          >
            Copy
          </button>
          <button
            className={toolbarButton}
            onClick={() =>
              void run(async () => {
                setPreview(await resolvePanels(decodeGraphCode(code), cacheNames(names)))
              })
            }
          >
            Preview import
          </button>
          {preview && (
            <div className="w-full space-y-1">
              {preview.map((p, i) => (
                <p key={i}>
                  Chart {i + 1}:{' '}
                  {p.map((n) => (n.startsWith('~') ? 'Unavailable channel' : n)).join(', ') ||
                    'Empty'}
                </p>
              ))}
              <button
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
        </div>
      )}
      {message && (
        <p role="status" className="mt-1 text-amber-300">
          {message}
        </p>
      )}
    </div>
  )
}
