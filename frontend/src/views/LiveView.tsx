import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import type { ChannelMeta } from '../../bindings/dawg_viewer/internal/config/models'
import { ChannelEditor } from '../components/ChannelEditor'
import { PlotContextMenu } from '../components/PlotContextMenu'
import { ChannelList, type ListChannel } from '../components/ChannelList'
import { RangeBar } from '../components/RangeBar'
import { LiveGraphStack } from '../components/LiveGraphStack'
import { defaultGroup } from '../data/groups'
import { colorFor, onLiveFrame, startLive, store, useChannels, useInfo } from '../live/connection'
import { LiveMap } from '../live/LiveMap'
import { LivePlotPanel } from '../live/LivePlotPanel'
import { PinnedCards } from '../live/PinnedCards'
import { StatusHeader } from '../live/StatusHeader'
import { liveSync, resumeFollow, showWindow, useFollow } from '../live/follow'
import { layoutReducer, makeLayout } from '../state/layout'
import {
  assignBentoSlots,
  visualBentoOrder,
  type BentoSize,
  type BentoSlot,
} from '../state/liveBento'
import type { LiveLayoutMode } from '../settings/liveLayout'
import { toolbarButton, toolbarButtonActive } from '../ui'

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
const liveBounds = () => store.bounds()
const liveSubscribe = (fn: () => void) => onLiveFrame(fn)
const NO_METAS: Record<string, ChannelMeta | undefined> = {}

export function LiveView({ layoutMode = 'default' }: { layoutMode?: LiveLayoutMode }) {
  useEffect(startLive, [])
  const info = useInfo()
  const channels = useChannels()
  const metas = info?.channels ?? NO_METAS
  const [layout, dispatch] = useReducer(layoutReducer, initialLayout)
  const activePanel = layout.panels.find((p) => p.id === layout.activeId)

  const { follow, windowS } = useFollow()
  const [showMap, setShowMap] = useState(false)
  const [sizes, setSizes] = useState<Record<string, BentoSize>>({})
  const [order, setOrder] = useState<string[]>([])
  const [slots, setSlots] = useState<Record<string, BentoSlot>>({})
  const [previousMode, setPreviousMode] = useState(layoutMode)
  const ids = [...layout.panels.map((p) => `plot:${p.id}`), ...(showMap ? ['track-map'] : [])]
  const orderedIds = [
    ...order.filter((id) => ids.includes(id)),
    ...ids.filter((id) => !order.includes(id)),
  ]
  if (previousMode !== layoutMode) {
    setPreviousMode(layoutMode)
    if (layoutMode === 'default') {
      const visual = visualBentoOrder(assignBentoSlots(orderedIds, sizes, slots))
      dispatch({
        type: 'orderPanels',
        ids: visual.filter((id) => id.startsWith('plot:')).map((id) => Number(id.slice(5))),
      })
      setOrder(visual)
    } else setOrder(ids)
  }

  const known = useMemo(() => new Set(channels.map((c) => c.name)), [channels])
  const listChannels = useMemo<ListChannel[]>(
    () =>
      channels.map((c) => ({
        id: c.name,
        name: c.name,
        label: metas[c.name]?.label || undefined,
        group:
          metas[c.name]?.group || defaultGroup(c.name) || (c.id >= 0 ? 'From device' : 'Computed'),
        unit: metas[c.name]?.unit ?? '',
        color: colorFor(c.name),
      })),
    [channels, metas],
  )
  const [editing, setEditing] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const menuPanel = layout.panels.find((p) => p.id === menu?.id)
  const editingChannel = listChannels.find((c) => c.id === editing)
  const groups = useMemo(() => [...new Set(listChannels.map((c) => c.group))], [listChannels])
  const deviceIds = useMemo(
    () => new Set(channels.filter((c) => c.id >= 0).map((c) => c.name)),
    [channels],
  )
  const currentValue = useCallback(() => (editing ? store.latest(editing) : undefined), [editing])

  return (
    <div
      className="flex h-full min-w-0 flex-col overflow-hidden"
      onContextMenu={(event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-panel-id]')
        if (!target) return
        event.preventDefault()
        setMenu({ id: Number(target.dataset.panelId), x: event.clientX, y: event.clientY })
      }}
    >
      {menu && menuPanel && (
        <PlotContextMenu
          key={menu.id}
          panel={menuPanel}
          x={menu.x}
          y={menu.y}
          units={[...new Set(menuPanel.channelIds.map((id) => metas[id]?.unit || id))]}
          onPatch={(patch) => dispatch({ type: 'setPanel', panelId: menu.id, patch })}
          onEdit={setEditing}
          onClose={() => setMenu(null)}
        />
      )}
      <StatusHeader />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <ChannelList
          channels={listChannels}
          selectedIds={activePanel?.channelIds ?? NO_CHANNELS}
          dispatch={dispatch}
          onEdit={setEditing}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <PinnedCards metas={metas} />
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
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
              className={`${showMap ? toolbarButtonActive : toolbarButton} ml-auto`}
              title="Live position on the track and lap times"
              onClick={() => setShowMap((m) => !m)}
            >
              Track map
            </button>
            <button
              type="button"
              className={toolbarButton}
              onClick={() => dispatch({ type: 'addPanel' })}
            >
              Add plot
            </button>
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <LiveGraphStack
              ids={layoutMode === 'bento' ? orderedIds : layout.panels.map((p) => `plot:${p.id}`)}
              sizes={sizes}
              slots={slots}
              mode={layoutMode}
              onSlots={setSlots}
              render={(id, bento, startDrag) =>
                id === 'track-map' ? (
                  <LiveMap
                    onClose={() => setShowMap(false)}
                    bento={bento}
                    startDrag={startDrag}
                    size={sizes[id]}
                    onSize={(size) => setSizes((current) => ({ ...current, [id]: size }))}
                  />
                ) : (
                  (() => {
                    const panel = layout.panels.find((p) => `plot:${p.id}` === id)!
                    return (
                      <LivePlotPanel
                        panel={panel}
                        index={layout.panels.indexOf(panel)}
                        active={panel.id === layout.activeId}
                        known={known}
                        metas={metas}
                        sync={liveSync}
                        dispatch={dispatch}
                        bento={bento}
                        startDrag={startDrag}
                        size={sizes[id]}
                        onSize={(size) => setSizes((current) => ({ ...current, [id]: size }))}
                      />
                    )
                  })()
                )
              }
            />
            {showMap && layoutMode === 'default' && <LiveMap onClose={() => setShowMap(false)} />}
          </div>
          <RangeBar sync={liveSync} bounds={liveBounds} subscribe={liveSubscribe} minSpan={1} />
        </div>
      </div>
      {editingChannel && (
        <ChannelEditor
          name={editingChannel.id}
          color={editingChannel.color}
          unit={editingChannel.unit}
          precision={metas[editingChannel.id]?.precision ?? 2}
          group={editingChannel.group}
          groups={groups}
          canCalibrate={deviceIds.has(editingChannel.id)}
          currentValue={currentValue}
          valueSource="Live value"
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
