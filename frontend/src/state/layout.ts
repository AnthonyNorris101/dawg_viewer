import type { PanelKind } from './panels'
export type { PanelKind } from './panels'

export interface Panel {
  id: number
  kind: PanelKind
  channelIds: string[]
  wide: boolean
  bins?: number
  fftSize?: number
  envelope?: boolean
  fullY?: boolean
  yBounds?: Record<string, [number, number]>
  xyBounds?: { x?: [number, number]; y?: [number, number] }
  gMode?: 'combined' | 'lateral'
  ref?: string
}

export interface Layout {
  panels: Panel[]
  activeId: number
  nextId: number
}

export type LayoutAction =
  | { type: 'toggleChannel'; channelId: string }
  | { type: 'removeChannel'; panelId: number; channelId: string }
  | { type: 'addPanel'; kind?: PanelKind; channelIds?: string[] }
  | { type: 'removePanel'; panelId: number }
  | { type: 'setActive'; panelId: number }
  | { type: 'setPanel'; panelId: number; patch: Partial<Omit<Panel, 'id'>> }
  | { type: 'movePanel'; panelId: number; by: number }
  | { type: 'orderPanels'; ids: number[] }

export const panelDefaults = (kind: PanelKind): Omit<Panel, 'id' | 'channelIds'> =>
  kind === 'time' || kind === 'launch' || kind === 'aero'
    ? { kind, wide: true }
    : { kind, wide: false }

export function makeLayout(panels: (string[] | Omit<Panel, 'id'>)[]): Layout {
  return {
    panels: panels.map((p, i) =>
      Array.isArray(p)
        ? { id: i + 1, ...panelDefaults('time'), channelIds: p }
        : { ...p, id: i + 1 },
    ),
    activeId: 1,
    nextId: panels.length + 1,
  }
}

function updatePanel(layout: Layout, panelId: number, fn: (p: Panel) => Panel): Layout {
  return { ...layout, panels: layout.panels.map((p) => (p.id === panelId ? fn(p) : p)) }
}

const withIds = (fn: (ids: string[]) => string[]) => (p: Panel) => ({
  ...p,
  channelIds: fn(p.channelIds),
})

function pickChannel(p: Panel, id: string): string[] {
  const ids = p.channelIds
  switch (p.kind) {
    case 'time':
    case 'spectrum':
      return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    case 'xy':
      if (ids[1] === id) return ids
      return ids.length === 0 ? [id] : [ids[ids.length - 1], id]
    case 'histogram':
    case 'map':
      return ids[0] === id ? [] : [id]
    case 'launch':
    case 'aero':
      return ids
  }
}

export function layoutReducer(layout: Layout, action: LayoutAction): Layout {
  switch (action.type) {
    case 'toggleChannel':
      return updatePanel(layout, layout.activeId, (p) => ({
        ...p,
        channelIds: pickChannel(p, action.channelId),
      }))
    case 'removeChannel':
      return updatePanel(
        layout,
        action.panelId,
        withIds((ids) => ids.filter((id) => id !== action.channelId)),
      )
    case 'addPanel': {
      const kind = action.kind ?? 'time'
      return {
        panels: [
          ...layout.panels,
          { id: layout.nextId, ...panelDefaults(kind), channelIds: action.channelIds ?? [] },
        ],
        activeId: layout.nextId,
        nextId: layout.nextId + 1,
      }
    }
    case 'removePanel': {
      if (layout.panels.length === 1) {
        return updatePanel(layout, action.panelId, (p) => ({
          id: p.id,
          ...panelDefaults('time'),
          channelIds: [],
        }))
      }
      const panels = layout.panels.filter((p) => p.id !== action.panelId)
      const activeId = layout.activeId === action.panelId ? panels[0].id : layout.activeId
      return { ...layout, panels, activeId }
    }
    case 'setActive':
      return layout.activeId === action.panelId ? layout : { ...layout, activeId: action.panelId }
    case 'setPanel':
      return updatePanel(layout, action.panelId, (p) => ({ ...p, ...action.patch }))
    case 'movePanel': {
      const i = layout.panels.findIndex((p) => p.id === action.panelId)
      const j = i + action.by
      if (i < 0 || j < 0 || j >= layout.panels.length) return layout
      const panels = [...layout.panels]
      ;[panels[i], panels[j]] = [panels[j], panels[i]]
      return { ...layout, panels }
    }
    case 'orderPanels': {
      const byId = new Map(layout.panels.map((p) => [p.id, p]))
      if (
        action.ids.length !== layout.panels.length ||
        new Set(action.ids).size !== byId.size ||
        action.ids.some((id) => !byId.has(id))
      )
        return layout
      return { ...layout, panels: action.ids.map((id) => byId.get(id)!) }
    }
  }
}
