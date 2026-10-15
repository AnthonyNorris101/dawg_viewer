import { useState } from 'react'
import { LiveView } from './views/LiveView'
import { ViewerView } from './views/ViewerView'

type Tab = 'live' | 'logs' | 'viewer'

const TABS: { id: Tab; label: string; disabled?: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'logs', label: 'Logs', disabled: 'The log browser is the next step' },
  { id: 'viewer', label: 'Viewer' },
]

function App() {
  const [tab, setTab] = useState<Tab>('live')

  return (
    <div className="flex h-full flex-col select-none">
      <nav className="flex items-center gap-1 border-b border-zinc-800 px-3">
        <h1 className="mr-4 text-sm font-semibold tracking-tight">Dawg Viewer</h1>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!!t.disabled}
            title={t.disabled}
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-3 py-2 text-sm ${
              tab === t.id
                ? 'border-red-500 text-zinc-100'
                : 'border-transparent text-zinc-400 hover:text-zinc-200 disabled:text-zinc-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {/* Views stay mounted so live data and plot layouts survive tab switches. */}
      <div className={`min-h-0 flex-1 ${tab === 'live' ? '' : 'hidden'}`}>
        <LiveView />
      </div>
      <div className={`min-h-0 flex-1 ${tab === 'viewer' ? '' : 'hidden'}`}>
        <ViewerView />
      </div>
    </div>
  )
}

export default App
