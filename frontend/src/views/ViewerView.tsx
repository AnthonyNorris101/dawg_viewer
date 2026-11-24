import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChannelEditor } from '../components/ChannelEditor'
import { PlotContextMenu } from '../components/PlotContextMenu'
import { ChannelList } from '../components/ChannelList'
import { FilterDialog, type FilterStart } from '../components/FilterDialog'
import { parseFilter } from '../analysis/filters'
import { HistogramPanel } from '../components/HistogramPanel'
import { AeroPanel } from '../components/AeroPanel'
import { LaunchPanel } from '../components/LaunchPanel'
import { MathEditor } from '../components/MathEditor'
import { PlotPanel } from '../components/PlotPanel'
import { Sidebar } from '../components/Sidebar'
import { SpectrumPanel } from '../components/SpectrumPanel'
import { RangeBar } from '../components/RangeBar'
import { StatusBar } from '../components/StatusBar'
import { TrackMapPanel } from '../components/TrackMapPanel'
import { WorksheetTabs } from '../components/WorksheetTabs'
import { XYPanel } from '../components/XYPanel'
import type { Channel, Session } from '../data/session'
import { mathDefs, useTrack } from '../state/analysis'
import { applySetup, currentSetup } from '../state/setup'
import { download, pickTextFile } from '../state/storage'
import { defaultWorkbook } from '../state/workbook'
import { toolbarButton, toolbarButtonActive } from '../ui'
import { useAnalysis } from '../viewer/useAnalysis'
import { useViewerWorkbook } from '../viewer/useViewerWorkbook'
import { useViewerNavigation } from '../viewer/useViewerNavigation'
import { useRecalibration } from '../viewer/useRecalibration'
import { useInfo } from '../live/connection'
import { PANEL_TYPES } from '../state/panels'

const NO_CHANNELS: string[] = []

interface LiveProps {
  watching?: boolean
  waitingLive?: boolean
  onWatchLive?: () => void
  onStopLive?: () => void
}

interface Props extends LiveProps {
  session: Session | null
  loading: boolean
  error: string
  onOpenFile: () => void
  onReload?: () => void
}

export function ViewerView({
  session,
  loading,
  error,
  onOpenFile,
  onReload,
  watching,
  waitingLive,
  onWatchLive,
  onStopLive,
}: Props) {
  return (
    <div className="flex h-full flex-col">
      {session ? (
        <LoadedLog
          key={session.path}
          session={session}
          onOpenFile={onOpenFile}
          onReload={onReload}
          loading={loading}
          watching={watching}
          onWatchLive={onWatchLive}
          onStopLive={onStopLive}
        />
      ) : (
        <div className="grid flex-1 place-items-center">
          <div className="space-y-3 text-center">
            <p className="text-sm text-zinc-400">
              Open a CSV or .bin log, or pick one in the Logs tab.
            </p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                className={toolbarButton}
                disabled={loading}
                onClick={onOpenFile}
              >
                {loading ? 'Opening…' : 'Open log…'}
              </button>
              <button type="button" className={toolbarButton} onClick={onWatchLive}>
                ● Watch live data
              </button>
            </div>
            {waitingLive && (
              <p className="text-xs text-zinc-500">
                Waiting for live data. Connect to the car on the Live tab, or turn on Test mode.
              </p>
            )}
          </div>
        </div>
      )}
      {error && <p className="border-t border-zinc-800 px-3 py-1 text-xs text-red-300">{error}</p>}
    </div>
  )
}

function LoadedLog({
  session: loaded,
  loading,
  onOpenFile,
  onReload,
  watching,
  onWatchLive,
  onStopLive,
}: {
  session: Session
  loading: boolean
  onOpenFile: () => void
  onReload?: () => void
} & LiveProps) {
  const [notice, setNotice] = useState('')
  const { base, recalibrate } = useRecalibration(loaded, setNotice, onReload)
  const analysis = useAnalysis(base, useInfo()?.channels ?? undefined)
  const { session, laps, gps, distance } = analysis
  const track = useTrack()

  const { workbook, dispatchWb, sheet, layout, activePanel, dispatch } = useViewerWorkbook(
    base,
    gps != null,
  )
  const {
    selection,
    setSelection,
    overlayOn,
    setOverlayOn,
    dView,
    view,
    sync,
    follow,
    setFollow,
    resetZoom,
    zoomTo,
    zoomLap,
  } = useViewerNavigation(base, laps, distance, track.normalize)

  const listChannels = useMemo(
    () => (dView ? [...session.channels, analysis.timeSlip] : session.channels),
    [dView, session.channels, analysis.timeSlip],
  )
  const extra = useMemo(() => [analysis.timeSlip], [analysis.timeSlip])

  const plotted = useMemo(() => {
    const ids = new Set(layout.panels.filter((p) => p.kind === 'time').flatMap((p) => p.channelIds))
    return [...ids].flatMap((id): Channel[] => {
      const ch = session.byId.get(id)
      return ch ? [ch] : []
    })
  }, [layout.panels, session])

  const [editing, setEditing] = useState<string | null>(null)
  const [filtering, setFiltering] = useState<FilterStart | null>(null)
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)
  const menuPanel = layout.panels.find((p) => p.id === menu?.id)
  const editingChannel = editing ? session.byId.get(editing) : undefined
  const isLogChannel = useCallback((id: string) => base.byId.has(id), [base])
  const isMathChannel = useCallback(
    (id: string) => session.byId.get(id)?.group === 'Math',
    [session],
  )
  const groups = useMemo(() => [...new Set(session.channels.map((c) => c.group))], [session])
  const lastSample = useRef(-1)
  useEffect(() => {
    lastSample.current = -1
    return sync.onCursor((idx) => {
      if (idx != null) lastSample.current = view.samplesAt(idx)[0] ?? -1
    })
  }, [sync, view])
  const launchCursor = useCallback(() => {
    const i = lastSample.current
    return view.mode === 'time' && i >= 0 && i < base.time.length ? base.time[i] : null
  }, [view, base])
  const launchRange = useCallback(() => (view.mode === 'time' ? sync.range() : null), [view, sync])

  const cursorValue = useCallback(() => {
    const ch = editing ? session.byId.get(editing) : undefined
    const i = lastSample.current
    return ch && i >= 0 && i < ch.data.length ? ch.data[i] : undefined
  }, [editing, session])
  const viewBounds = useCallback((): [number, number] => view.bounds, [view])
  const markerXs = useMemo(() => view.markers.map((m) => m.x), [view])
  const [showSide, setShowSide] = useState(true)
  const [showMath, setShowMath] = useState(false)
  const exportSetup = () => {
    download('dawg-viewer-setup.json', JSON.stringify({ ...currentSetup(), workbook }, null, 2))
  }
  const importSetup = async () => {
    const text = await pickTextFile('.json,application/json')
    if (!text) return
    try {
      applySetup(JSON.parse(text))
      setNotice('Setup imported')
    } catch (e) {
      setNotice(`Couldn't import: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const deleteChannel = (id: string) => {
    mathDefs.set(mathDefs.get().filter((d) => d.name !== id))
    dispatchWb({ type: 'removeChannel', channelId: id })
    setNotice(`Deleted ${id}`)
  }
  const resetSheets = () =>
    dispatchWb({
      type: 'replace',
      workbook: defaultWorkbook(new Set(session.channels.map((c) => c.id)), gps != null),
    })

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1.5">
        <button type="button" className={toolbarButton} disabled={loading} onClick={onOpenFile}>
          {loading ? 'Opening…' : 'Open log…'}
        </button>
        {watching ? (
          <>
            <button
              type="button"
              className={toolbarButtonActive}
              title="Stop updating and close the live data"
              onClick={onStopLive}
            >
              ● Live · stop
            </button>
            {!follow && (
              <button
                type="button"
                className={toolbarButton}
                title="Jump back to the newest data and keep up with it"
                onClick={() => setFollow(true)}
              >
                Follow live
              </button>
            )}
          </>
        ) : (
          onWatchLive && (
            <button
              type="button"
              className={toolbarButton}
              title="Show the live stream here, with these sheets and panels, updating every second"
              onClick={onWatchLive}
            >
              ● Watch live data
            </button>
          )
        )}
        <span className="ml-2 text-xs text-zinc-500">Add</span>
        {PANEL_TYPES.map(([kind, label, title]) => (
          <button
            key={kind}
            type="button"
            className={toolbarButton}
            title={title}
            onClick={() => dispatch({ type: 'addPanel', kind })}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-zinc-800" />
        <button type="button" className={toolbarButton} onClick={resetZoom}>
          Reset zoom
        </button>
        <button
          type="button"
          className={toolbarButton}
          title="Make new channels from formulas"
          onClick={() => setShowMath(true)}
        >
          Math channels…
        </button>
        <button
          type="button"
          className={toolbarButton}
          title="Make filtered copies of one, several or every channel"
          onClick={() =>
            setFiltering({
              channelIds: (activePanel?.channelIds ?? []).filter((id) => session.byId.has(id)),
            })
          }
        >
          ∿ Filter…
        </button>
        {overlayOn && dView && (
          <button type="button" className={toolbarButtonActive} onClick={() => setOverlayOn(false)}>
            Overlay on · back to time
          </button>
        )}
        <span className="ml-auto truncate text-xs text-zinc-500" title={session.path}>
          {session.name}
          {session.note && <span className="text-zinc-600"> · {session.note}</span>}
        </span>
        <button
          type="button"
          className={showSide ? toolbarButtonActive : toolbarButton}
          title="Laps, statistics and values at the cursor"
          onClick={() => setShowSide((s) => !s)}
        >
          Laps & stats
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <ChannelList
          channels={listChannels}
          selectedIds={activePanel?.channelIds ?? NO_CHANNELS}
          dispatch={dispatch}
          onEdit={setEditing}
          editable={isLogChannel}
          onFilter={(id) => {
            const def = mathDefs.get().find((d) => d.name === id)
            const made = def ? parseFilter(def.expr) : null
            setFiltering(
              def && made && session.byId.has(made.source)
                ? {
                    channelIds: [made.source],
                    edit: { id: def.id, name: def.name, spec: made.spec },
                  }
                : { channelIds: [id] },
            )
          }}
          deletable={isMathChannel}
          onDelete={deleteChannel}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <main
            className="grid min-h-0 min-w-0 flex-1 auto-rows-[minmax(17rem,1fr)] grid-cols-2 gap-px overflow-y-auto bg-zinc-800"
            onContextMenu={(event) => {
              const target = (event.target as HTMLElement).closest<HTMLElement>('[data-panel-id]')
              if (!target) return
              event.preventDefault()
              setMenu({ id: Number(target.dataset.panelId), x: event.clientX, y: event.clientY })
            }}
          >
            {layout.panels.map((panel, i) => {
              const key = `${sheet.id}-${panel.id}`
              const common = {
                panel,
                index: i,
                active: panel.id === layout.activeId,
                session,
                view,
                sync,
                dispatch,
              }
              switch (panel.kind) {
                case 'xy':
                  return <XYPanel key={key} {...common} />
                case 'histogram':
                  return <HistogramPanel key={key} {...common} />
                case 'map':
                  return <TrackMapPanel key={key} {...common} gps={gps} />
                case 'spectrum':
                  return <SpectrumPanel key={key} {...common} onFilter={setFiltering} />
                case 'launch':
                  return (
                    <LaunchPanel
                      key={key}
                      panel={panel}
                      index={i}
                      active={panel.id === layout.activeId}
                      session={session}
                      gps={gps}
                      distance={distance}
                      distanceFromGps={analysis.distanceLabel === 'GPS'}
                      dispatch={dispatch}
                      onZoom={zoomTo}
                      cursorTime={launchCursor}
                      viewRange={launchRange}
                    />
                  )
                case 'aero':
                  return (
                    <AeroPanel
                      key={key}
                      {...common}
                      distance={distance}
                      distanceFromGps={analysis.distanceLabel === 'GPS'}
                    />
                  )
                default:
                  return <PlotPanel key={key} {...common} extraChannels={extra} />
              }
            })}
          </main>
          {menu && menuPanel && (
            <PlotContextMenu
              key={menu.id}
              panel={menuPanel}
              x={menu.x}
              y={menu.y}
              units={[
                ...new Set(menuPanel.channelIds.map((id) => session.byId.get(id)?.unit || id)),
              ]}
              onPatch={(patch) => dispatch({ type: 'setPanel', panelId: menu.id, patch })}
              onEdit={setEditing}
              onFilter={(ids) =>
                setFiltering({ channelIds: ids.filter((id) => session.byId.has(id)) })
              }
              onClose={() => setMenu(null)}
            />
          )}
          <RangeBar sync={sync} bounds={viewBounds} markers={markerXs} minSpan={view.minSpan} />
        </div>
        {showSide && (
          <Sidebar
            analysis={analysis}
            view={view}
            sync={sync}
            plotted={plotted}
            selection={selection}
            onSelection={setSelection}
            onZoomLap={zoomLap}
            overlay={overlayOn && dView != null}
            onOverlay={setOverlayOn}
            onClose={() => setShowSide(false)}
          />
        )}
      </div>

      <WorksheetTabs
        workbook={workbook}
        dispatch={dispatchWb}
        right={
          <>
            {notice && <span className="text-xs text-zinc-400">{notice}</span>}
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-zinc-200"
              title="Save worksheets, math channels and start/finish to a file for the team"
              onClick={exportSetup}
            >
              Export setup
            </button>
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-zinc-200"
              onClick={() => void importSetup()}
            >
              Import setup
            </button>
            <button
              type="button"
              className="text-xs text-zinc-500 hover:text-zinc-200"
              title="Replace the worksheets with the premade Driver / Engine / Chassis sheets"
              onClick={resetSheets}
            >
              Premade sheets
            </button>
          </>
        }
      />
      <StatusBar session={session} sync={sync} view={view} />
      {editingChannel && (
        <ChannelEditor
          name={editingChannel.id}
          color={editingChannel.color}
          unit={editingChannel.unit}
          precision={editingChannel.precision}
          group={editingChannel.group}
          groups={groups}
          canCalibrate
          currentValue={cursorValue}
          valueSource="Value at the cursor"
          onClose={() => setEditing(null)}
          onSaved={(before, after) => recalibrate(editing, before, after)}
        />
      )}
      {filtering && (
        <FilterDialog
          session={session}
          start={filtering}
          onClose={() => setFiltering(null)}
          onCreated={(names, panelId) => {
            const edited = filtering.edit
            setFiltering(null)
            if (edited) {
              setNotice(`Updated ${edited.name}`)
              return
            }
            const target = layout.panels.find((p) => p.id === panelId)
            if (target) {
              dispatch({
                type: 'setPanel',
                panelId: target.id,
                patch: {
                  channelIds: [...target.channelIds.filter((c) => !names.includes(c)), ...names],
                },
              })
            } else if (names.length === 1 && !activePanel?.channelIds.includes(names[0])) {
              dispatch({ type: 'toggleChannel', channelId: names[0] })
            }
            setNotice(
              names.length === 1
                ? `Made ${names[0]}. It's under Math in the channel list.`
                : `Made ${names.length} filtered channels. They're under Math in the channel list.`,
            )
          }}
        />
      )}
      {showMath && (
        <MathEditor
          channels={session.channels}
          errors={analysis.mathErrors}
          onClose={() => setShowMath(false)}
        />
      )}
    </>
  )
}
