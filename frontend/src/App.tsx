import { useEffect, useRef, useState } from 'react'
import { LiveService } from '../bindings/dawg_viewer/services'
import { SetupsDialog } from './components/SetupsDialog'
import type { Session } from './data/session'
import { askOnStart, lastLog, savedWorkbook } from './state/setup'
import { setLiveShown, useInfo, useTestMode } from './live/connection'
import { LIVE_PATH, liveSession } from './live/liveSession'
import { startTestMode, stopTestMode, TEST_LOG_PATH, testSession } from './testmode/testMode'
import { openLog, pickAndOpenLog } from './viewer/openLog'
import { CarView } from './views/CarView'
import { LiveView } from './views/LiveView'
import { LogsView } from './views/LogsView'
import { SettingsView } from './views/SettingsView'
import { loadLiveLayoutMode, saveLiveLayoutMode, type LiveLayoutMode } from './settings/liveLayout'
import { ViewerView } from './views/ViewerView'

type Tab = 'live' | 'logs' | 'viewer' | 'car' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'logs', label: 'Logs' },
  { id: 'viewer', label: 'Viewer' },
  { id: 'car', label: 'Car' },
  { id: 'settings', label: 'Settings' },
]

function App() {
  const [tab, setTab] = useState<Tab>('live')
  const [liveLayoutMode, setLiveLayoutMode] = useState<LiveLayoutMode>(loadLiveLayoutMode)
  const changeLiveLayoutMode = (mode: LiveLayoutMode) => {
    setLiveLayoutMode(mode)
    saveLiveLayoutMode(mode)
  }
  useEffect(() => setLiveShown(tab === 'live'), [tab])
  const version = useInfo()?.version
  const testing = useTestMode()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [setups, setSetups] = useState<'start' | 'manage' | null>(null)
  const [watching, setWatching] = useState(false)
  const [waitingLive, setWaitingLive] = useState(false)
  const openingLog = useRef(false)

  useEffect(() => {
    if (!watching || tab !== 'viewer') return
    const tick = () => {
      if (document.hidden) return
      const s = liveSession()
      setWaitingLive(!s)
      if (s) setSession(s)
    }
    tick()
    const t = window.setInterval(tick, 1000)
    return () => window.clearInterval(t)
  }, [watching, tab])

  useEffect(() => {
    if (!askOnStart.get()) return
    let live = true
    LiveService.Presets()
      .then((p) => {
        if (live && ((p?.length ?? 0) > 0 || lastLog.get() || savedWorkbook())) setSetups('start')
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  const load = async (open: () => Promise<Session | null>) => {
    if (openingLog.current) return
    openingLog.current = true
    setWatching(false)
    setLoading(true)
    setError('')
    try {
      const s = await open()
      if (s) {
        setSession(s)
        setTab('viewer')
        if (s.path !== TEST_LOG_PATH) lastLog.set(s.path)
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
      setTab('viewer')
    } finally {
      openingLog.current = false
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full max-w-full min-w-0 flex-col overflow-hidden select-none">
      <nav className="flex min-w-0 flex-wrap items-center gap-1 border-b border-zinc-800 px-3">
        <img
          src="/bulldog.png"
          alt="Georgia Bulldogs"
          className="mr-2 h-6 w-auto select-none"
          draggable={false}
        />
        <img
          src="/ugams-logo.png"
          alt="UGA Motorsports"
          title="UGA Motorsports"
          className="mr-2 h-5 w-auto select-none"
          draggable={false}
        />
        <h1 className="mr-4 text-sm font-semibold tracking-tight">Dawg Viewer</h1>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm ${
              tab === t.id
                ? 'border-red-500 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t.label}
          </button>
        ))}
        <span className="ml-auto flex min-w-0 flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-100"
            title="Save the sheets, plots and made channels you have now, or switch to a saved setup"
            onClick={() => setSetups('manage')}
          >
            Setups
          </button>
          {testing && (
            <span className="rounded border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">
              TEST MODE · simulated car, not real data
            </span>
          )}
          <button
            type="button"
            aria-pressed={testing}
            title={
              testing
                ? 'Stop the simulated car and go back to the logger'
                : 'Drive a simulated car through the Live tab and open a sample outing in the Viewer, to try the app without the car'
            }
            className={`rounded border px-2 py-0.5 text-xs ${
              testing
                ? 'border-amber-500/60 text-amber-200 hover:bg-amber-500/10'
                : 'border-zinc-700 text-zinc-400 hover:text-zinc-100'
            }`}
            onClick={() => {
              if (testing) {
                stopTestMode()
                return
              }
              startTestMode()
              setSession(testSession())
              setError('')
              setTab('live')
            }}
          >
            {testing ? 'Exit test mode' : 'Test mode'}
          </button>
          {version && <span className="text-xs text-zinc-600">v{version}</span>}
        </span>
      </nav>
      <div className={`min-h-0 min-w-0 flex-1 overflow-hidden ${tab === 'live' ? '' : 'hidden'}`}>
        <LiveView layoutMode={liveLayoutMode} />
      </div>
      {tab === 'logs' && (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <LogsView opening={loading} onOpen={(path) => load(() => openLog(path))} />
        </div>
      )}
      <div className={`min-h-0 min-w-0 flex-1 overflow-hidden ${tab === 'viewer' ? '' : 'hidden'}`}>
        <ViewerView
          session={session}
          loading={loading}
          error={error}
          onOpenFile={() => load(pickAndOpenLog)}
          watching={watching}
          waitingLive={watching && waitingLive}
          onWatchLive={() => {
            setError('')
            setWatching(true)
          }}
          onStopLive={() => {
            setWatching(false)
            setSession((s) => (s?.path === LIVE_PATH ? null : s))
          }}
          onReload={() =>
            session &&
            load(async () =>
              session.path === TEST_LOG_PATH
                ? testSession()
                : session.path === LIVE_PATH
                  ? liveSession()
                  : openLog(session.path),
            )
          }
        />
      </div>
      {tab === 'car' && (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <CarView />
        </div>
      )}
      {tab === 'settings' && (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <SettingsView layoutMode={liveLayoutMode} onLayoutMode={changeLiveLayoutMode} />
        </div>
      )}
      {setups && (
        <SetupsDialog
          startup={setups === 'start'}
          openLog={
            session && session.path !== TEST_LOG_PATH && session.path !== LIVE_PATH
              ? session.path
              : undefined
          }
          onOpenLog={(path) => void load(() => openLog(path))}
          onClose={() => setSetups(null)}
        />
      )}
    </div>
  )
}

export default App
