import { useMemo, useRef, useState } from 'react'
import { FUNCTION_HELP, parse, type MathDef } from '../analysis/math'
import type { Channel } from '../data/session'
import { DEFAULT_MATH, mathDefs, newMathId, useMathDefs } from '../state/analysis'
import { toolbarButton, toolbarButtonActive } from '../ui'

interface Props {
  channels: Channel[]
  errors: Map<string, string>
  onClose: () => void
}

const field =
  'rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-red-500'

const quote = (name: string) => (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) ? name : `[${name}]`)

export function MathEditor({ channels, errors, onClose }: Props) {
  const [draft, setDraft] = useState<MathDef[]>(() => mathDefs.get().map((d) => ({ ...d })))
  const [focus, setFocus] = useState(draft[0]?.id ?? '')
  const exprRefs = useRef(new Map<string, HTMLTextAreaElement>())
  const [filter, setFilter] = useState('')

  const parseErrors = useMemo(() => {
    const out = new Map<string, string>()
    for (const d of draft) {
      try {
        parse(d.expr)
      } catch (e) {
        out.set(d.id, e instanceof Error ? e.message : String(e))
      }
    }
    return out
  }, [draft])

  const applied = useMathDefs()
  const isApplied = (d: MathDef) => applied.some((a) => JSON.stringify(a) === JSON.stringify(d))

  const update = (id: string, patch: Partial<MathDef>) =>
    setDraft((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)))

  const add = () => {
    const d: MathDef = {
      id: newMathId(),
      name: `Math ${draft.length + 1}`,
      expr: '',
      unit: '',
      precision: 2,
    }
    setDraft((ds) => [...ds, d])
    setFocus(d.id)
    setTimeout(() => exprRefs.current.get(d.id)?.focus(), 0)
  }

  const insert = (text: string) => {
    const el = exprRefs.current.get(focus)
    const d = draft.find((x) => x.id === focus)
    if (!el || !d) return
    const a = el.selectionStart ?? d.expr.length
    const b = el.selectionEnd ?? d.expr.length
    update(d.id, { expr: d.expr.slice(0, a) + text + d.expr.slice(b) })
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(a + text.length, a + text.length)
    }, 0)
  }

  const apply = () => {
    mathDefs.set(draft.map((d) => ({ ...d, name: d.name.trim() })))
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(applied)
  const shownChannels = channels.filter(
    (c) => c.group !== 'Math' && c.name.toLowerCase().includes(filter.trim().toLowerCase()),
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label="Math channels"
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-5xl flex-col rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
          <h2 className="text-sm font-semibold">Math channels</h2>
          <p className="text-xs text-zinc-500">
            Computed for every log you open; they appear in the channel list under Math.
          </p>
          <button
            type="button"
            aria-label="Close"
            className="ml-auto text-zinc-500 hover:text-zinc-200"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 space-y-3 overflow-y-auto p-4">
            {draft.length === 0 && (
              <p className="text-sm text-zinc-500">No math channels yet. Add one to get started.</p>
            )}
            {draft.map((d) => {
              const err = parseErrors.get(d.id) ?? (isApplied(d) ? errors.get(d.id) : undefined)
              return (
                <div
                  key={d.id}
                  className={`space-y-2 rounded border p-3 ${
                    focus === d.id ? 'border-zinc-600 bg-zinc-900/60' : 'border-zinc-800'
                  }`}
                  onFocus={() => setFocus(d.id)}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      aria-label="Name"
                      className={`${field} w-48 font-medium`}
                      value={d.name}
                      onChange={(e) => update(d.id, { name: e.target.value })}
                      spellCheck={false}
                    />
                    <label className="flex items-center gap-1 text-xs text-zinc-500">
                      Unit
                      <input
                        aria-label="Unit"
                        className={`${field} w-16`}
                        value={d.unit}
                        onChange={(e) => update(d.id, { unit: e.target.value })}
                      />
                    </label>
                    <label className="flex items-center gap-1 text-xs text-zinc-500">
                      Decimals
                      <input
                        aria-label="Decimals"
                        type="number"
                        min={0}
                        max={6}
                        className={`${field} w-14`}
                        value={d.precision}
                        onChange={(e) =>
                          update(d.id, {
                            precision: Math.max(0, Math.min(6, Number(e.target.value) || 0)),
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="ml-auto text-xs text-zinc-500 hover:text-red-300"
                      onClick={() => setDraft((ds) => ds.filter((x) => x.id !== d.id))}
                    >
                      Delete
                    </button>
                  </div>
                  <textarea
                    ref={(el) => {
                      if (el) exprRefs.current.set(d.id, el)
                      else exprRefs.current.delete(d.id)
                    }}
                    aria-label="Expression"
                    rows={2}
                    className={`${field} w-full resize-y font-mono`}
                    placeholder="e.g. sqrt(AccelX^2 + AccelY^2)"
                    value={d.expr}
                    onChange={(e) => update(d.id, { expr: e.target.value })}
                    spellCheck={false}
                  />
                  {err ? (
                    <p className="text-xs text-red-300">{err}</p>
                  ) : !isApplied(d) ? (
                    <p className="text-xs text-zinc-500">Not applied yet</p>
                  ) : null}
                </div>
              )
            })}
          </div>

          <aside className="flex w-64 shrink-0 flex-col border-l border-zinc-800 text-xs">
            <div className="space-y-1 border-b border-zinc-800 p-3">
              <h3 className="text-[11px] tracking-wider text-zinc-500 uppercase">Channels</h3>
              <input
                aria-label="Filter channels to insert"
                className={`${field} w-full`}
                placeholder="Click to insert"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="max-h-56 min-h-24 overflow-y-auto py-1">
              {shownChannels.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="block w-full truncate px-3 py-0.5 text-left text-zinc-300 hover:bg-zinc-800"
                  onClick={() => insert(quote(c.name))}
                >
                  {c.name}
                  {c.unit && <span className="text-zinc-600"> {c.unit}</span>}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto border-t border-zinc-800 p-3">
              <h3 className="text-[11px] tracking-wider text-zinc-500 uppercase">Functions</h3>
              {FUNCTION_HELP.map((h) => (
                <button
                  key={h}
                  type="button"
                  className="block w-full text-left font-mono text-zinc-400 hover:text-zinc-100"
                  onClick={() => insert(h.slice(0, h.indexOf('(') + 1))}
                >
                  {h}
                </button>
              ))}
              <p className="pt-2 text-zinc-500">
                Operators + − × ÷ % ^, comparisons {'< > <= >= == !='}, {'&& || !'} and{' '}
                <span className="font-mono">c ? a : b</span>. Constants pi, e, g0, and t (time in
                seconds). Names with spaces go in [brackets].
              </p>
            </div>
          </aside>
        </div>

        <footer className="flex items-center gap-2 border-t border-zinc-800 px-4 py-2">
          <button type="button" className={toolbarButton} onClick={add}>
            Add math channel
          </button>
          <button
            type="button"
            className={toolbarButton}
            title="Add the built-in examples (Combined G, Brake Bias, Steer Rate) back"
            onClick={() =>
              setDraft((ds) => [
                ...ds,
                ...DEFAULT_MATH.filter((m) => !ds.some((d) => d.name === m.name)).map((m) => ({
                  ...m,
                  id: newMathId(),
                })),
              ])
            }
          >
            Add examples
          </button>
          <span className="ml-auto text-xs text-zinc-500">
            {dirty ? 'Unapplied changes' : 'Up to date'}
          </span>
          <button
            type="button"
            className={dirty ? toolbarButtonActive : toolbarButton}
            disabled={!dirty}
            onClick={apply}
          >
            Apply
          </button>
          <button
            type="button"
            className={toolbarButton}
            onClick={() => {
              if (dirty) apply()
              onClose()
            }}
          >
            {dirty ? 'Apply and close' : 'Close'}
          </button>
        </footer>
      </div>
    </div>
  )
}
