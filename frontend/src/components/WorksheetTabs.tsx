import { useState, type Dispatch, type ReactNode } from 'react'
import type { Workbook, WorkbookAction } from '../state/workbook'

const tabBase = 'flex items-center gap-1 border-t-2 px-3 py-1 text-xs'

export function WorksheetTabs({
  workbook,
  dispatch,
  right,
}: {
  workbook: Workbook
  dispatch: Dispatch<WorkbookAction>
  right?: ReactNode
}) {
  const [editing, setEditing] = useState<number | null>(null)
  const [name, setName] = useState('')

  const finish = () => {
    if (editing != null) dispatch({ type: 'renameSheet', id: editing, name })
    setEditing(null)
  }

  return (
    <div className="flex items-stretch gap-px border-t border-zinc-800 bg-zinc-900/60 pl-2">
      {workbook.sheets.map((s) => {
        const active = s.id === workbook.activeId
        return editing === s.id ? (
          <input
            key={s.id}
            aria-label="Worksheet name"
            className="w-32 border-t-2 border-red-500 bg-zinc-950 px-2 text-xs outline-none"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={finish}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finish()
              if (e.key === 'Escape') setEditing(null)
            }}
          />
        ) : (
          <div
            key={s.id}
            className={`${tabBase} ${
              active
                ? 'border-red-500 bg-zinc-950 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <button
              type="button"
              title="Double-click to rename"
              onClick={() => dispatch({ type: 'selectSheet', id: s.id })}
              onDoubleClick={() => {
                setName(s.name)
                setEditing(s.id)
              }}
            >
              {s.name}
            </button>
            {active && (
              <>
                <button
                  type="button"
                  aria-label={`Move ${s.name} left`}
                  title="Move left"
                  className="text-zinc-600 hover:text-zinc-200"
                  onClick={() => dispatch({ type: 'moveSheet', id: s.id, by: -1 })}
                >
                  ‹
                </button>
                <button
                  type="button"
                  aria-label={`Move ${s.name} right`}
                  title="Move right"
                  className="text-zinc-600 hover:text-zinc-200"
                  onClick={() => dispatch({ type: 'moveSheet', id: s.id, by: 1 })}
                >
                  ›
                </button>
                <button
                  type="button"
                  aria-label={`Duplicate ${s.name}`}
                  title="Duplicate"
                  className="text-zinc-600 hover:text-zinc-200"
                  onClick={() => dispatch({ type: 'duplicateSheet', id: s.id })}
                >
                  ⧉
                </button>
                {workbook.sheets.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Delete ${s.name}`}
                    title="Delete worksheet"
                    className="text-zinc-600 hover:text-red-300"
                    onClick={() => dispatch({ type: 'removeSheet', id: s.id })}
                  >
                    ✕
                  </button>
                )}
              </>
            )}
          </div>
        )
      })}
      <button
        type="button"
        aria-label="Add worksheet"
        title="Add worksheet"
        className="px-3 text-sm text-zinc-500 hover:text-zinc-200"
        onClick={() => dispatch({ type: 'addSheet' })}
      >
        +
      </button>
      <div className="ml-auto flex items-center gap-2 px-3">{right}</div>
    </div>
  )
}
