import { useReducer } from 'react'
import { ChannelList } from './components/ChannelList'
import { PlotPanel } from './components/PlotPanel'
import { StatusBar } from './components/StatusBar'
import { createDemoSession } from './data/demo'
import { setRange } from './plot/sync'
import { initialLayout, layoutReducer } from './state/layout'

// Placeholder until log files are loaded through the Go backend.
const session = createDemoSession()

const NO_CHANNELS: string[] = []
const toolbarButton =
  'rounded border border-zinc-700 px-2.5 py-1 text-xs text-zinc-200 hover:bg-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent'

function App() {
  const [layout, dispatch] = useReducer(layoutReducer, initialLayout)
  const activePanel = layout.panels.find((p) => p.id === layout.activeId)

  const resetZoom = () => {
    const { time } = session
    setRange({ min: time[0], max: time[time.length - 1] })
  }

  return (
    <div className="flex h-full flex-col select-none">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <h1 className="mr-2 text-sm font-semibold tracking-tight">Dawg Viewer</h1>
        <button
          type="button"
          className={toolbarButton}
          disabled
          title="Log loading is not wired up yet"
        >
          Open log…
        </button>
        <button
          type="button"
          className={toolbarButton}
          onClick={() => dispatch({ type: 'addPanel' })}
        >
          Add plot
        </button>
        <button type="button" className={toolbarButton} onClick={resetZoom}>
          Reset zoom
        </button>
        <span className="ml-auto truncate text-xs text-zinc-500">{session.name}</span>
      </header>

      <div className="flex min-h-0 flex-1">
        <ChannelList
          channels={session.channels}
          selectedIds={activePanel?.channelIds ?? NO_CHANNELS}
          dispatch={dispatch}
        />
        <main className="flex min-w-0 flex-1 flex-col gap-px overflow-y-auto bg-zinc-800">
          {layout.panels.map((panel, i) => (
            <PlotPanel
              key={panel.id}
              panel={panel}
              index={i}
              active={panel.id === layout.activeId}
              session={session}
              dispatch={dispatch}
            />
          ))}
        </main>
      </div>

      <StatusBar session={session} />
    </div>
  )
}

export default App
