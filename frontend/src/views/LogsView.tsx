import { useCallback, useEffect, useState } from 'react'
import { Events } from '@wailsio/runtime'
import { LogService } from '../../bindings/dawg_viewer/services'
import type { LocalLog, LogProgress, RemoteLog } from '../../bindings/dawg_viewer/services/models'
import { toolbarButton } from '../ui'

interface Props {
  onOpen: (path: string) => void
}

const errorText = (e: unknown) => String(e instanceof Error ? e.message : e)

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const KIND_LABEL: Record<string, string> = {
  normalized: '100 Hz CSV',
  csv: 'CSV',
  bin: 'Raw .bin',
}

export function LogsView({ onOpen }: Props) {
  const [folder, setFolder] = useState('')
  const [remote, setRemote] = useState<RemoteLog[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [local, setLocal] = useState<LocalLog[]>([])
  const [busy, setBusy] = useState('')
  const [progress, setProgress] = useState<LogProgress | null>(null)
  const [error, setError] = useState('')

  const refreshLocal = useCallback(async () => {
    try {
      setFolder(await LogService.LogsFolder())
      setLocal((await LogService.LocalLogs()) ?? [])
    } catch (e) {
      setError(errorText(e))
    }
  }, [])

  useEffect(() => {
    LogService.LogsFolder().then(setFolder, (e: unknown) => setError(errorText(e)))
    LogService.LocalLogs().then(
      (l) => setLocal(l ?? []),
      (e: unknown) => setError(errorText(e)),
    )
    const off = Events.On('logs:progress', (e) => setProgress(e.data))
    return () => {
      off()
      LogService.FinishRemote().catch(() => {})
    }
  }, [])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }

  const listRemote = () =>
    run('Connecting to the logger…', async () => {
      setRemote((await LogService.RemoteLogs()) ?? [])
      setSelected(new Set())
    })

  const download = (names: string[]) =>
    run('Downloading…', async () => {
      setProgress(null)
      try {
        await LogService.Download(names)
      } finally {
        setRemote((await LogService.RemoteLogs()) ?? [])
        await refreshLocal()
      }
    })

  const finish = () =>
    run('Turning the file server off…', async () => {
      await LogService.FinishRemote()
      setRemote(null)
      setSelected(new Set())
    })

  const convert = (path: string) =>
    run('Converting…', async () => {
      await LogService.ConvertLocal(path)
      await refreshLocal()
    })

  const toggle = (name: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const progressText =
    progress &&
    busy &&
    `${progress.stage === 'converting' ? 'Converting' : 'Downloading'} ${progress.file} (${progress.index} of ${progress.count})${
      progress.stage === 'downloading' && progress.total > 0
        ? ` ${Math.round((100 * progress.done) / progress.total)}%`
        : ''
    }`

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5 text-xs">
        <span className="text-zinc-500">Logs folder</span>
        <span className="truncate text-zinc-300" title={folder}>
          {folder}
        </span>
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            className={toolbarButton}
            onClick={() => run('', LogService.OpenLogsFolder)}
          >
            Open folder
          </button>
          <button
            type="button"
            className={toolbarButton}
            onClick={() =>
              run('', async () => {
                const path = await LogService.PickFile()
                if (path) onOpen(path)
              })
            }
          >
            Open file…
          </button>
        </span>
      </div>

      {(busy || error) && (
        <div className="border-b border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs">
          {busy && <p className="text-sky-300">{progressText || busy}</p>}
          {error && <p className="text-red-300">{error}</p>}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-2 gap-px bg-zinc-800">
        <section className="flex min-h-0 flex-col bg-zinc-950">
          <header className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <h2 className="mr-auto text-sm font-medium">On the logger</h2>
            <button type="button" className={toolbarButton} disabled={!!busy} onClick={listRemote}>
              {remote ? 'Refresh' : 'Connect'}
            </button>
            <button
              type="button"
              className={toolbarButton}
              disabled={!!busy || selected.size === 0}
              onClick={() => download([...selected])}
            >
              Download selected
            </button>
            <button
              type="button"
              className={toolbarButton}
              disabled={!!busy || !remote?.length}
              onClick={() => remote?.[0] && download([remote[0].name])}
            >
              Download latest
            </button>
            <button
              type="button"
              className={toolbarButton}
              disabled={!!busy || !remote}
              onClick={finish}
            >
              Done
            </button>
          </header>
          {remote ? (
            <p className="border-b border-zinc-800 px-3 py-1 text-xs text-amber-300">
              The logger isn't recording while its file server is on. Press Done (or leave this tab)
              to turn it off.
            </p>
          ) : (
            <p className="px-3 py-2 text-xs text-zinc-500">
              Connect turns on the logger's file server and lists its logs. The device chosen in the
              Live tab is used.
            </p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <tbody>
                {remote?.map((l) => (
                  <tr
                    key={l.name}
                    className="cursor-pointer border-b border-zinc-900 hover:bg-zinc-900"
                    onClick={() => toggle(l.name)}
                  >
                    <td className="w-8 px-3 py-1.5">
                      <input type="checkbox" readOnly checked={selected.has(l.name)} />
                    </td>
                    <td className="w-12 text-zinc-400 tabular-nums">
                      {l.number >= 0 ? `#${l.number}` : ''}
                    </td>
                    <td className="text-zinc-300" title={l.name}>
                      {l.date ? `${l.date}${l.name.endsWith('.csv') ? ' (CSV)' : ''}` : l.name}
                    </td>
                    <td className="pr-3 text-right text-zinc-500">
                      {l.downloaded ? 'downloaded' : ''}
                    </td>
                  </tr>
                ))}
                {remote?.length === 0 && (
                  <tr>
                    <td className="px-3 py-2 text-zinc-500">No logs on the logger</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="flex min-h-0 flex-col bg-zinc-950">
          <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <h2 className="mr-auto text-sm font-medium">On this computer</h2>
            <button
              type="button"
              className={toolbarButton}
              disabled={!!busy}
              onClick={refreshLocal}
            >
              Refresh
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full text-left text-xs">
              <tbody>
                {local.map((l) => (
                  <tr key={l.path} className="border-b border-zinc-900 hover:bg-zinc-900">
                    <td className="truncate px-3 py-1.5 text-zinc-300" title={l.path}>
                      {l.name}
                    </td>
                    <td className="text-zinc-500">{KIND_LABEL[l.kind] ?? l.kind}</td>
                    <td className="text-right text-zinc-500 tabular-nums">{formatSize(l.size)}</td>
                    <td className="space-x-2 px-3 text-right whitespace-nowrap">
                      {l.kind === 'bin' && (
                        <button
                          type="button"
                          className="text-zinc-400 hover:text-zinc-100"
                          disabled={!!busy}
                          onClick={() => convert(l.path)}
                        >
                          Convert
                        </button>
                      )}
                      <button
                        type="button"
                        className="text-sky-300 hover:text-sky-100"
                        onClick={() => onOpen(l.path)}
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
                {local.length === 0 && (
                  <tr>
                    <td className="px-3 py-2 text-zinc-500">No logs downloaded yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  )
}
