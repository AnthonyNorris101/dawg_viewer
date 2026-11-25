import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { Preset } from '../../bindings/dawg_viewer/services/models'
import { LiveService } from '../../bindings/dawg_viewer/services'
import {
  createSetup,
  openSetup,
  openUnnamed,
  removeSetup,
  startFresh,
  useActiveSetup,
  useSaveState,
  type SetupStart,
} from '../state/session'
import { askOnStart, lastLog } from '../state/setup'
import { toolbarButton, toolbarButtonActive } from '../ui'

const field =
  'rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-red-500'

const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path
const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const fileSafe = (name: string) =>
  [...name.trim()]
    .map((c) => (c < ' ' || '<>:"/\\|?*'.includes(c) ? '_' : c))
    .join('')
    .replace(/[. ]+$/, '')
    .toLowerCase()

export function SetupsDialog({
  startup,
  openLog,
  onOpenLog,
  onClose,
}: {
  startup: boolean
  openLog?: string
  onOpenLog: (path: string) => void
  onClose: () => void
}) {
  const [presets, setPresets] = useState<Preset[] | null>(null)
  const [name, setName] = useState('')
  const [from, setFrom] = useState<SetupStart>('original')
  const [withLog, setWithLog] = useState(!!openLog)
  const [useLog, setUseLog] = useState(true)
  const [confirm, setConfirm] = useState('')
  const [message, setMessage] = useState('')
  const ask = useSyncExternalStore(askOnStart.subscribe, askOnStart.get)
  const last = useSyncExternalStore(lastLog.subscribe, lastLog.get)
  const active = useActiveSetup()
  const saving = useSaveState()

  const refresh = useCallback(async () => {
    try {
      setPresets((await LiveService.Presets()) ?? [])
    } catch (e) {
      setPresets([])
      setMessage(`Couldn't list setups: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])

  useEffect(() => {
    let live = true
    LiveService.Presets()
      .then((p) => live && setPresets(p ?? []))
      .catch(() => live && setPresets([]))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const use = async (p: Preset) => {
    try {
      const setup = await openSetup(p.name)
      onClose()
      if (useLog && setup.log) onOpenLog(setup.log)
    } catch (e) {
      setMessage(`Couldn't load ${p.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const create = async () => {
    try {
      const saved = await createSetup(name, from, withLog ? openLog : undefined)
      setName('')
      setMessage(
        `Created “${saved.name}” from ${from === 'original' ? 'the original view' : "what's open now"}. It is now in use, and what you change is saved into it.`,
      )
      await refresh()
    } catch (e) {
      setMessage(`Couldn't create it: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const remove = async (p: Preset) => {
    if (confirm !== p.name) {
      setConfirm(p.name)
      return
    }
    setConfirm('')
    try {
      await removeSetup(p.name)
      await refresh()
    } catch (e) {
      setMessage(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const taken = !!name.trim() && !!presets?.some((p) => fileSafe(p.name) === fileSafe(name))
  const inUse = active || 'Unnamed view'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label={startup ? 'Choose a setup' : 'Saved setups'}
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-lg flex-col rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-2">
          <h2 className="text-sm font-semibold">
            {startup ? 'Welcome back. How do you want to start?' : 'Saved setups'}
          </h2>
          <button
            type="button"
            aria-label="Close"
            className="ml-auto text-zinc-500 hover:text-zinc-200"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs">
          <p className="text-zinc-500">
            A setup is a view: your worksheets and plots, made channels (math and filters),
            start/finish line, and launch, Sim, damper and split settings. Each setup is one file in
            the config folder's presets folder, so setups survive reinstalls and can be copied to
            teammates. The setup in use is saved as you work, and stays in use when you open another
            log.
          </p>
          <p className={saving.phase === 'error' ? 'text-red-400' : 'text-zinc-300'}>
            In use: {inUse}
            {saving.phase === 'error'
              ? `. Couldn't save it: ${saving.error}`
              : saving.phase === 'pending' || saving.phase === 'saving'
                ? ' · saving…'
                : saving.phase === 'saved'
                  ? ' · saved'
                  : ''}
          </p>

          {startup && (
            <div className="grid gap-2">
              <button
                type="button"
                className="rounded border border-zinc-700 px-3 py-2 text-left hover:border-zinc-500 hover:bg-zinc-900"
                onClick={() => {
                  onClose()
                  if (last) onOpenLog(last)
                }}
              >
                <span className="block text-sm text-zinc-100">Pick up where you left off</span>
                <span className="text-zinc-500">
                  Same view as last time ({inUse}){last ? `, and reopen ${fileName(last)}` : ''}
                </span>
              </button>
              <button
                type="button"
                className="rounded border border-zinc-700 px-3 py-2 text-left hover:border-zinc-500 hover:bg-zinc-900"
                onClick={() => {
                  void startFresh()
                  onClose()
                }}
              >
                <span className="block text-sm text-zinc-100">Start fresh</span>
                <span className="text-zinc-500">
                  Premade sheets and the default math channels in the unnamed view. Saved setups
                  stay saved.
                </span>
              </button>
            </div>
          )}

          {!startup && (
            <section className="space-y-2">
              <h3 className="text-[11px] tracking-wider text-zinc-500 uppercase">New setup</h3>
              <div className="flex items-center gap-2">
                <input
                  aria-label="Setup name"
                  className={`${field} min-w-0 flex-1`}
                  placeholder="e.g. Endurance – suspension"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && name.trim() && !taken && void create()}
                />
                <button
                  type="button"
                  className={toolbarButtonActive}
                  disabled={!name.trim() || taken}
                  onClick={() => void create()}
                >
                  Create
                </button>
              </div>
              {taken && (
                <p className="text-amber-300">
                  A setup with that name exists. Pick another name, or delete that one first.
                </p>
              )}
              <fieldset className="space-y-1 text-zinc-400">
                <legend className="mb-1 text-zinc-500">Start from</legend>
                <label className="flex items-start gap-1.5">
                  <input
                    type="radio"
                    name="setup-start"
                    className="mt-0.5 accent-red-500"
                    checked={from === 'original'}
                    onChange={() => setFrom('original')}
                  />
                  <span>
                    The original view
                    <span className="block text-zinc-500">
                      The view the app comes with: premade sheets, default math channels and
                      settings, the sample log's start/finish line and the stock shock dyno table.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-1.5">
                  <input
                    type="radio"
                    name="setup-start"
                    className="mt-0.5 accent-red-500"
                    checked={from === 'current'}
                    onChange={() => setFrom('current')}
                  />
                  <span>
                    What's open now
                    <span className="block text-zinc-500">A copy of {inUse}, as it is now.</span>
                  </span>
                </label>
              </fieldset>
              {openLog && (
                <label className="flex items-center gap-1.5 text-zinc-400">
                  <input
                    type="checkbox"
                    className="accent-red-500"
                    checked={withLog}
                    onChange={(e) => setWithLog(e.target.checked)}
                  />
                  Remember the open log ({fileName(openLog)}) with it
                </label>
              )}
            </section>
          )}

          <section className="space-y-2">
            <h3 className="text-[11px] tracking-wider text-zinc-500 uppercase">
              {startup ? 'Or use a saved setup' : 'Saved'}
            </h3>
            {presets === null ? (
              <p className="text-zinc-500">Loading…</p>
            ) : presets.length === 0 && !active ? (
              <p className="text-zinc-500">
                None yet. {startup ? 'Create one from "Setups" at the top of the window.' : ''}
              </p>
            ) : (
              <ul className="divide-y divide-zinc-800 rounded border border-zinc-800">
                {active && (
                  <li className="flex items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-zinc-100">Unnamed view</span>
                      <span className="text-zinc-500">
                        The view you had before using a setup. Kept in the config folder.
                      </span>
                    </span>
                    <button
                      type="button"
                      className={toolbarButtonActive}
                      aria-label="Use the unnamed view"
                      onClick={() => {
                        void openUnnamed()
                        onClose()
                      }}
                    >
                      Use
                    </button>
                  </li>
                )}
                {presets.map((p) => (
                  <li key={p.name} className="flex items-center gap-2 px-3 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-zinc-100">{p.name}</span>
                      <span className="text-zinc-500">{when(p.modified)}</span>
                    </span>
                    {p.name === active ? (
                      <span className="rounded border border-emerald-500/50 px-2 py-0.5 text-emerald-300">
                        In use
                      </span>
                    ) : (
                      <button
                        type="button"
                        className={toolbarButtonActive}
                        aria-label={`Use ${p.name}`}
                        onClick={() => void use(p)}
                      >
                        Use
                      </button>
                    )}
                    <button
                      type="button"
                      className={confirm === p.name ? toolbarButtonActive : toolbarButton}
                      aria-label={`Delete ${p.name}`}
                      onClick={() => void remove(p)}
                    >
                      {confirm === p.name ? 'Delete?' : '✕'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {presets && presets.length > 0 && (
              <label className="flex items-center gap-1.5 text-zinc-400">
                <input
                  type="checkbox"
                  className="accent-red-500"
                  checked={useLog}
                  onChange={(e) => setUseLog(e.target.checked)}
                />
                Also open the log a setup remembers
              </label>
            )}
          </section>

          {message && <p className="text-zinc-300">{message}</p>}
        </div>

        <footer className="flex items-center gap-2 border-t border-zinc-800 px-4 py-2">
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              className="accent-red-500"
              checked={ask}
              onChange={(e) => askOnStart.set(e.target.checked)}
            />
            Ask me this when the app opens
          </label>
          <button type="button" className={`${toolbarButton} ml-auto`} onClick={onClose}>
            {startup ? 'Not now' : 'Done'}
          </button>
        </footer>
      </div>
    </div>
  )
}
