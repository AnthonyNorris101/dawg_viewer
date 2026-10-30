import { useState } from 'react'
import type { Session } from './data/session'
import { useInfo } from './live/connection'
import { openLog, pickAndOpenLog } from './viewer/openLog'
import { LiveView } from './views/LiveView'
import { LogsView } from './views/LogsView'
import { ViewerView } from './views/ViewerView'

type Tab = 'live' | 'logs' | 'viewer'

const TABS: { id: Tab; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'logs', label: 'Logs' },
  { id: 'viewer', label: 'Viewer' },
]

function App() {
  const [tab, setTab] = useState<Tab>('live')
  const [profileTarget, setProfileTarget] = useState<HTMLDivElement | null>(null)
  const version = useInfo()?.version
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = async (open: () => Promise<Session | null>) => {
    setLoading(true)
    setError('')
    try {
      const s = await open()
      if (s) {
        setSession(s)
        setTab('viewer')
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
      setTab('viewer')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden select-none">
      <nav className="flex items-center gap-1 border-b border-zinc-800 px-3">
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
        <div className="ml-auto flex items-center gap-2">
          <div ref={setProfileTarget} />
          {version && <span className="text-xs text-zinc-600">v{version}</span>}
        </div>
      </nav>
      <div className={`min-h-0 flex-1 ${tab === 'live' ? '' : 'hidden'}`}>
        <LiveView profileTarget={tab === 'live' ? profileTarget : null} />
      </div>
      {tab === 'logs' && (
        <div className="min-h-0 flex-1">
          <LogsView onOpen={(path) => load(() => openLog(path))} />
        </div>
      )}
      <div className={`min-h-0 flex-1 ${tab === 'viewer' ? '' : 'hidden'}`}>
        <ViewerView
          session={session}
          loading={loading}
          error={error}
          onOpenFile={() => load(pickAndOpenLog)}
          profileTarget={tab === 'viewer' ? profileTarget : null}
        />
      </div>
    </div>
  )
}

export default App
