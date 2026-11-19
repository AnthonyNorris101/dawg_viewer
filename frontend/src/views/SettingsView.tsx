import { useState } from 'react'
import type { LiveLayoutMode } from '../settings/liveLayout'

export function SettingsView({
  layoutMode,
  onLayoutMode,
}: {
  layoutMode: LiveLayoutMode
  onLayoutMode: (mode: LiveLayoutMode) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <main className="h-full min-w-0 overflow-y-auto bg-zinc-950 px-4 py-8 sm:px-8">
      <div className="mx-auto w-full max-w-2xl">
        <h2 className="text-xl font-semibold text-zinc-100">Settings</h2>
        <section className="mt-8 border-t border-zinc-800 py-6">
          <h3 className="text-sm font-semibold text-zinc-200">Live view</h3>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 py-4">
            <div>
              <span className="text-sm text-zinc-200">Plot layout</span>
              <p className="mt-1 text-xs text-zinc-500">
                Choose how graphs are arranged in the Live tab.
              </p>
            </div>
            <div
              className="relative w-36 shrink-0"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setOpen(false)
              }}
            >
              <button
                type="button"
                aria-label="Plot layout"
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="flex w-full items-center justify-between rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-sm text-zinc-100 capitalize shadow-sm outline-none hover:border-zinc-500 focus-visible:ring-2 focus-visible:ring-red-500"
              >
                {layoutMode}
                <span aria-hidden="true" className="ml-2 text-zinc-400">
                  ⌄
                </span>
              </button>
              {open && (
                <div
                  role="menu"
                  aria-label="Plot layout options"
                  className="absolute right-0 z-20 mt-1 w-full overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
                >
                  {(['default', 'bento'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="menuitemradio"
                      aria-checked={layoutMode === mode}
                      onClick={() => {
                        onLayoutMode(mode)
                        setOpen(false)
                      }}
                      className={`block w-full rounded px-2 py-1.5 text-left text-sm capitalize outline-none hover:bg-zinc-800 focus-visible:bg-zinc-800 ${layoutMode === mode ? 'bg-red-500/15 text-red-200' : 'text-zinc-200'}`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
