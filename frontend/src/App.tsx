import { useEffect, useRef, useState } from 'react'
import { LiveService } from '../bindings/dawg_viewer/services'
import { SetupsDialog } from './components/SetupsDialog'
import type { Session } from './data/session'
import { firstBootLog, sampleLog, useActiveSetup, useSaveState } from './state/session'
import { askOnStart, lastLog, savedWorkbook, showSimSheet } from './state/setup'
import { setLiveShown, useInfo, useTestMode } from './live/connection'
import { LIVE_PATH, liveSession } from './live/liveSession'
import { startTestMode, stopTestMode, TEST_LOG_PATH, testSession } from './testmode/testMode'
import { openLog, pickAndOpenLog } from './viewer/openLog'
import { CarView } from './views/CarView'
import { LiveView } from './views/LiveView'
import { LogsView } from './views/LogsView'
import { SettingsView } from './views/SettingsView'
import { SimView } from './views/SimView'
import { loadLiveLayoutMode, saveLiveLayoutMode, type LiveLayoutMode } from './settings/liveLayout'
import { ViewerView } from './views/ViewerView'

type Tab = 'live' | 'logs' | 'viewer' | 'sim' | 'car' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'logs', label: 'Logs' },
  { id: 'viewer', label: 'Viewer' },
  { id: 'sim', label: 'Sim' },
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
  const info = useInfo()
  const version = info?.version
  const activeSetup = useActiveSetup()
  const saving = useSaveState()
  const testing = useTestMode()
  const [session, setSession] = useState<Session | null>(null)
  const [simOf, setSimOf] = useState<Session | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [setups, setSetups] = useState<'start' | 'manage' | null>(null)
  const [watching, setWatching] = useState(false)
  const [waitingLive, setWaitingLive] = useState(false)
  const openingLog = useRef(false)
  const booted = useRef(false)

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

  useEffect(() => {
    const first = firstBootLog()
    if (first) {
      if (!booted.current) {
        booted.current = true
        void load(() => openLog(first))
      }
      return
    }
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
          <span
            role="status"
            className={`max-w-56 truncate text-xs ${saving.phase === 'error' ? 'text-red-400' : 'text-zinc-500'}`}
            title={
              saving.phase === 'error'
                ? `Couldn't save to the config folder: ${saving.error}. The app keeps trying.`
                : activeSetup
                  ? `What you change is saved into presets/${activeSetup}.json in the config folder${info?.configDir?.path ? ` (${info.configDir.path})` : ''}`
                  : `This view has no name. It is kept in session.json in the config folder${info?.configDir?.path ? ` (${info.configDir.path})` : ''}. Name it in Setups to give it a file of its own.`
            }
          >
            {activeSetup || 'Unnamed view'}
            {saving.phase === 'error'
              ? " · couldn't save"
              : saving.phase === 'pending' || saving.phase === 'saving'
                ? ' · saving…'
                : saving.phase === 'saved'
                  ? ' · saved'
                  : ''}
          </span>
          <button
            type="button"
            className="rounded border border-zinc-700 px-2 py-0.5 text-xs text-zinc-400 hover:text-zinc-100"
            title="Make a new setup or switch to a saved one. The setup in use is saved as you work."
            onClick={() => setSetups('manage')}
          >
            Setups
          </button>
          {session && sampleLog() && session.path === sampleLog() && (
            <span
              className="rounded border border-sky-500/50 bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-200"
              title="This log comes with the app so there is something to look at. It is real data measured on the G26 (Run-1), not a session from your car. Open your own from the Logs tab."
            >
              SAMPLE LOG · measured on the G26, comes with the app
            </span>
          )}
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
                  : session.simulated
                    ? session
                    : openLog(session.path),
            )
          }
        />
      </div>
      {tab === 'sim' && (
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <SimView
            session={session?.simulated ? simOf : session}
            onView={(made) => {
              if (!session?.simulated) setSimOf(session)
              setWatching(false)
              setError('')
              showSimSheet(new Set(made.channels.map((c) => c.id)))
              setSession(made)
              setTab('viewer')
            }}
          />
        </div>
      )}
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
            session &&
            !session.simulated &&
            session.path !== TEST_LOG_PATH &&
            session.path !== LIVE_PATH
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
