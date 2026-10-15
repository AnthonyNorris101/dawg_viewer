import { useReducer } from 'react'
import { ChannelList } from '../components/ChannelList'
import { PlotPanel } from '../components/PlotPanel'
import { StatusBar } from '../components/StatusBar'
import { createDemoSession } from '../data/demo'
import { createViewSync } from '../plot/sync'
import { layoutReducer, makeLayout } from '../state/layout'
import { toolbarButton } from '../ui'

// Placeholder until CSV logs are loaded through the Go backend.
const session = createDemoSession()
const sync = createViewSync('viewer')
const initialLayout = makeLayout([
  ['rpm', 'tps'],
  ['ws_fl', 'ws_fr', 'ws_rl', 'ws_rr'],
  ['acc_x', 'acc_y'],
])

const NO_CHANNELS: string[] = []

export function ViewerView() {
  const [layout, dispatch] = useReducer(layoutReducer, initialLayout)
  const activePanel = layout.panels.find((p) => p.id === layout.activeId)

  const resetZoom = () => {
    const { time } = session
    sync.setRange({ min: time[0], max: time[time.length - 1] })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <button
          type="button"
          className={toolbarButton}
          disabled
          title="Opening CSV logs is the next step"
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
      </div>

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
              sync={sync}
              dispatch={dispatch}
            />
          ))}
        </main>
      </div>

      <StatusBar session={session} sync={sync} />
    </div>
  )
}
