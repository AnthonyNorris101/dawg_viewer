import { useEffect, useMemo, useReducer } from 'react'
import type { ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'
import { ChannelList, type ListChannel } from '../components/ChannelList'
import { colorFor, startLive, useChannels, useInfo } from '../live/connection'
import { LivePlotPanel } from '../live/LivePlotPanel'
import { PinnedCards } from '../live/PinnedCards'
import { StatusHeader } from '../live/StatusHeader'
import { liveSync, resumeFollow, showWindow, useFollow } from '../live/follow'
import { layoutReducer, makeLayout } from '../state/layout'
import { plotStack, toolbarButton, toolbarButtonActive } from '../ui'
import { GraphProfileControls } from '../components/GraphProfileControls'

const initialLayout = makeLayout([
  ['RPM', 'TPS1'],
  ['CLT1', 'OilTemp', 'RadTemp'],
  ['AccelX', 'AccelY'],
])

const WINDOWS: [number, string][] = [
  [10, '10 s'],
  [30, '30 s'],
  [60, '1 min'],
  [300, '5 min'],
  [Infinity, 'All'],
]

const NO_CHANNELS: string[] = []
const NO_METAS: Record<string, ChannelMeta | undefined> = {}

export function LiveView({ profileTarget }: { profileTarget: HTMLElement | null }) {
  useEffect(startLive, [])
  const info = useInfo()
  const channels = useChannels()
  const metas = info?.channels ?? NO_METAS
  const [layout, dispatch] = useReducer(layoutReducer, initialLayout)
  const activePanel = layout.panels.find((p) => p.id === layout.activeId)

  const { follow, windowS } = useFollow()

  const known = useMemo(() => new Set(channels.map((c) => c.name)), [channels])
  const listChannels = useMemo<ListChannel[]>(
    () =>
      channels.map((c) => ({
        id: c.name,
        name: metas[c.name]?.label ? `${metas[c.name]?.label} (${c.name})` : c.name,
        group: c.id >= 0 ? 'From device' : 'Computed',
        unit: metas[c.name]?.unit ?? '',
        color: colorFor(c.name),
      })),
    [channels, metas],
  )

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden">
      <StatusHeader />
      {profileTarget && (
        <GraphProfileControls
          target={profileTarget}
          layout={layout}
          dispatch={dispatch}
          names={channels.map((c) => c.name)}
          windowS={windowS}
          onWindow={showWindow}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <ChannelList
          channels={listChannels}
          selectedIds={activePanel?.channelIds ?? NO_CHANNELS}
          dispatch={dispatch}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <PinnedCards metas={metas} />
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
            {WINDOWS.map(([s, label]) => (
              <button
                key={label}
                type="button"
                className={windowS === s ? toolbarButtonActive : toolbarButton}
                onClick={() => showWindow(s)}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={follow ? toolbarButtonActive : toolbarButton}
              title="Keep the plots on the newest data"
              onClick={resumeFollow}
            >
              {follow ? '● Live' : 'Resume live'}
            </button>
            <button
              type="button"
              className={`${toolbarButton} ml-auto`}
              onClick={() => dispatch({ type: 'addPanel' })}
            >
              Add plot
            </button>
          </div>
          <main className={plotStack}>
            {layout.panels.map((panel, i) => (
              <LivePlotPanel
                key={panel.id}
                panel={panel}
                index={i}
                active={panel.id === layout.activeId}
                known={known}
                metas={metas}
                sync={liveSync}
                dispatch={dispatch}
              />
            ))}
          </main>
        </div>
      </div>
    </div>
  )
}
