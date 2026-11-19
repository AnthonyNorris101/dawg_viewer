import { useState } from 'react'
import { removeReference, useReferences, type Reference } from '../state/references'

const control =
  'rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-zinc-200 outline-none focus:border-red-500'

export function CompareControls({
  kind,
  value,
  onChange,
  onSave,
  defaultName,
}: {
  kind: Reference['kind']
  value?: string
  onChange: (id: string | undefined) => void
  onSave: (name: string) => string | null
  defaultName: string
}) {
  const refs = useReferences().filter((r) => r.kind === kind)
  const [naming, setNaming] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [confirm, setConfirm] = useState(false)
  const selected = refs.find((r) => r.id === value)

  return (
    <span className="flex items-center gap-1.5 text-zinc-500">
      <label
        className="flex items-center gap-1"
        title="Draw a saved result from another run on this plot"
      >
        Compare to
        <select
          aria-label="Compare to"
          className={`${control} max-w-36`}
          value={selected ? selected.id : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">nothing</option>
          {refs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <button
          type="button"
          aria-label={`Delete ${selected.name}`}
          title={confirm ? 'Click again to delete this saved result' : 'Delete this saved result'}
          className={confirm ? 'text-red-400' : 'text-zinc-600 hover:text-red-300'}
          onClick={() => {
            if (!confirm) return setConfirm(true)
            setConfirm(false)
            removeReference(selected.id)
            onChange(undefined)
          }}
          onBlur={() => setConfirm(false)}
        >
          {confirm ? 'Delete?' : '✕'}
        </button>
      )}
      {naming === null ? (
        <button
          type="button"
          className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300 hover:text-zinc-100"
          title="Save what this plot shows now so other plots and runs can compare against it"
          onClick={() => {
            setNote('')
            setNaming(defaultName)
          }}
        >
          Save for comparing
        </button>
      ) : (
        <span className="flex items-center gap-1">
          <input
            aria-label="Name for this result"
            className={`${control} w-44`}
            value={naming}
            autoFocus
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setNaming(null)
              if (e.key === 'Enter' && naming.trim()) {
                setNote(onSave(naming.trim()) ?? '')
                setNaming(null)
              }
            }}
          />
          <button
            type="button"
            className="rounded border border-red-500/60 px-1.5 py-0.5 text-zinc-100"
            disabled={!naming.trim()}
            onClick={() => {
              setNote(onSave(naming.trim()) ?? '')
              setNaming(null)
            }}
          >
            Save
          </button>
          <button
            type="button"
            aria-label="Cancel"
            className="text-zinc-500 hover:text-zinc-200"
            onClick={() => setNaming(null)}
          >
            ✕
          </button>
        </span>
      )}
      {note && <span className="text-zinc-400">{note}</span>}
    </span>
  )
}
