import { useState } from 'react'
import { LiveService } from '../../bindings/dawg_viewer/services'
import { toolbarButton } from '../ui'
import { refresh, store, useInfo, useStatus } from './connection'
import { formatAge } from './format'

const STATE_STYLE: Record<string, { label: string; className: string }> = {
  receiving: {
    label: 'Receiving',
    className: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  },
  stale: { label: 'No new data', className: 'bg-amber-500/15 text-amber-300 border-amber-500/40' },
  listening: {
    label: 'Waiting for data',
    className: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  },
  error: { label: 'Error', className: 'bg-red-500/15 text-red-300 border-red-500/40' },
  stopped: { label: 'Disconnected', className: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40' },
}

const SOURCE_LABEL: Record<string, string> = {
  discovery: 'found by discovery',
  telemetry: 'from telemetry',
  config: 'from profile',
}

export function StatusHeader() {
  const info = useInfo()
  const st = useStatus()
  const [error, setError] = useState('')
  const state =
    st.state === 'listening' && st.filtering
      ? { ...STATE_STYLE.listening, label: 'Looking for device' }
      : (STATE_STYLE[st.state] ?? STATE_STYLE.stopped)
  const ignored = st.ignored ?? []

  const run = (fn: () => Promise<unknown>) => {
    setError('')
    fn()
      .then(refresh)
      .catch((e: unknown) => setError(String(e instanceof Error ? e.message : e)))
  }

  const connected = st.state !== 'stopped' && st.state !== 'error'
  const message = error || st.error

  return (
    <div className="border-b border-zinc-800">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-1.5 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-zinc-500">Device</span>
          <select
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-100 outline-none focus:border-red-500"
            value={info?.active ?? ''}
            onChange={(e) => run(() => LiveService.Connect(e.target.value))}
          >
            {!info?.active && <option value="">Choose…</option>}
            {(info?.profiles ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <span className={`rounded border px-2 py-0.5 font-medium ${state.className}`}>
          {state.label}
        </span>

        <span className="text-zinc-400 tabular-nums">
          {st.packetRate.toFixed(0)} pkt/s · last {formatAge(st.lastPacketMs)}
        </span>

        {st.deviceIp && (
          <span className="text-zinc-400" title={`Firmware ${st.firmware || 'unknown'}`}>
            Device {st.deviceIp}{' '}
            <span className="text-zinc-600">
              ({SOURCE_LABEL[st.deviceSource] ?? st.deviceSource})
            </span>
          </span>
        )}
        {st.listen && <span className="text-zinc-600">listening on {st.listen}</span>}

        <span className="ml-auto flex gap-2">
          {connected ? (
            <button
              type="button"
              className={toolbarButton}
              onClick={() => run(LiveService.Disconnect)}
            >
              Disconnect
            </button>
          ) : (
            <button
              type="button"
              className={toolbarButton}
              disabled={!info?.active}
              onClick={() => info?.active && run(() => LiveService.Connect(info.active))}
            >
              Connect
            </button>
          )}
          <button type="button" className={toolbarButton} onClick={() => store.reset()}>
            Clear data
          </button>
          <button
            type="button"
            className={toolbarButton}
            title="Re-read settings.yaml and the device files"
            onClick={() => run(LiveService.Reload)}
          >
            Reload config
          </button>
          <button
            type="button"
            className={toolbarButton}
            title={info?.configDir.path}
            onClick={() => run(LiveService.OpenConfigFolder)}
          >
            Open config folder
          </button>
        </span>
      </div>

      {(message ||
        ignored.length > 0 ||
        (st.unknownIds?.length ?? 0) > 0 ||
        (info?.profileErrors?.length ?? 0) > 0) && (
        <div className="space-y-0.5 border-t border-zinc-800 bg-zinc-900/60 px-3 py-1 text-xs">
          {message && <p className="text-red-300">{message}</p>}
          {(st.unknownIds?.length ?? 0) > 0 && (
            <p className="text-amber-300">
              Waiting for names of signal ids {st.unknownIds?.join(', ')} (asked the device to
              resend them)
            </p>
          )}
          {ignored.map((g) => (
            <p key={g.addr} className="text-amber-300">
              Ignoring data from {g.addr} ({g.packets.toLocaleString()} packets): it isn't{' '}
              {st.profileName}. Pick the matching device above if that's the one you want.
            </p>
          ))}
          {info?.profileErrors?.map((e) => (
            <p key={e.file} className="text-amber-300">
              Skipped device file {e.file}: {e.error}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
