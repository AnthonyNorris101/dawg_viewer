import { useEffect, useMemo, useState } from 'react'
import { LiveService } from '../../bindings/dawg_viewer/services'
import { hoverChannel, placeOf, sensorPos, useHoveredChannel, type Pos } from '../data/sensors'
import { colorFor, info, useChannels, useInfo } from '../live/connection'
import { toolbarButton } from '../ui'
import { CarDiagram, type DiagramChannel } from './CarDiagram'

const PARKED: Pos = [0.9, 0.5]

export interface EditorChannel {
  name: string
  label?: string
  color?: string
}

export function SensorEditor({
  extra,
  diagramHeight,
}: {
  extra?: EditorChannel[]
  diagramHeight: number | string
}) {
  const live = useInfo()
  const liveChannels = useChannels()
  const hovered = useHoveredChannel()
  const [status, setStatus] = useState('')
  const [pending, setPending] = useState<Record<string, Pos | null>>({})
  const metas = live?.channels

  const channels = useMemo<DiagramChannel[]>(() => {
    const byName = new Map<string, EditorChannel>()
    for (const c of extra ?? []) byName.set(c.name, c)
    for (const c of liveChannels) if (!byName.has(c.name)) byName.set(c.name, { name: c.name })
    for (const name of Object.keys(metas ?? {})) if (!byName.has(name)) byName.set(name, { name })
    return [...byName.values()]
      .map((c) => ({
        id: c.name,
        name: c.name,
        label: metas?.[c.name]?.label || c.label || undefined,
        color: metas?.[c.name]?.color || c.color || colorFor(c.name),
        pos: c.name in pending ? pending[c.name] : metas?.[c.name]?.pos,
      }))
      .sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name))
  }, [extra, liveChannels, metas, pending])

  const move = async (name: string, pos: Pos | null) => {
    setStatus('')
    setPending((p) => ({ ...p, [name]: pos }))
    try {
      const i = await LiveService.SaveChannel({
        name,
        meta: { ...(metas?.[name] ?? { order: 0 }), pos: pos ?? undefined },
        calibration: live?.calibrations?.[name] ?? null,
      })
      info.set(i)
    } catch (e) {
      setStatus(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setPending((p) => {
        const next = { ...p }
        delete next[name]
        return next
      })
    }
  }

  const canSave = !!live?.active

  return (
    <div className="space-y-3 text-sm">
      <p className="text-zinc-400">
        Drag a dot to where that sensor really is on your car. It saves to the device profile right
        away, so the whole team sees the same map. Common sensors start where they usually sit on an
        FSAE car.
      </p>
      {!canSave && <p className="text-amber-400">Pick a device on the Live tab to save spots.</p>}
      {status && <p className="text-red-400">{status}</p>}
      {channels.length === 0 ? (
        <p className="text-zinc-500">
          No channels yet. Connect to the car, open a log or add channels to the profile.
        </p>
      ) : (
        <div className="flex flex-wrap items-start gap-6">
          <CarDiagram
            channels={channels}
            height={diagramHeight}
            onMove={canSave ? (id, pos) => void move(id, pos) : undefined}
            hint={canSave ? 'Drag a dot to move that sensor' : undefined}
          />
          <ul
            className="max-h-[min(560px,70vh)] min-w-64 flex-1 overflow-y-auto"
            onMouseLeave={() => hoverChannel.set(null)}
          >
            {channels.map((c) => {
              const placed = sensorPos(c.name, c.pos) != null
              return (
                <li
                  key={c.id}
                  className={`flex items-center gap-2 rounded px-2 py-1 ${hovered === c.id ? 'bg-zinc-800' : ''}`}
                  onMouseEnter={() => hoverChannel.set(c.id)}
                >
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: c.color }} />
                  <span className="w-32 shrink-0 truncate text-zinc-200" title={c.name}>
                    {c.label || c.name}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate ${placed ? 'text-zinc-500' : 'text-zinc-600 italic'}`}
                  >
                    {placed ? placeOf(c) : 'not on the map'}
                  </span>
                  {canSave && !placed && (
                    <button
                      type="button"
                      className={toolbarButton}
                      onClick={() => void move(c.name, PARKED)}
                    >
                      Put on car
                    </button>
                  )}
                  {canSave && c.pos?.length === 2 && (
                    <button
                      type="button"
                      className={toolbarButton}
                      title="Go back to the usual spot, or off the map if there isn't one"
                      onClick={() => void move(c.name, null)}
                    >
                      Reset
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

export function SensorEditorDialog({
  extra,
  onClose,
}: {
  extra?: EditorChannel[]
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sensor locations"
        className="max-h-full w-[min(60rem,100%)] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-4 shadow-2xl"
      >
        <div className="mb-2 flex items-center gap-3">
          <h2 className="text-base font-semibold">Sensor locations</h2>
          <button type="button" className={`${toolbarButton} ml-auto`} onClick={onClose}>
            Done
          </button>
        </div>
        <SensorEditor extra={extra} diagramHeight="min(520px, 68vh)" />
      </div>
    </div>
  )
}
