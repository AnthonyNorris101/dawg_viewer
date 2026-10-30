import { MAX_PANEL_HEIGHT, MIN_PANEL_HEIGHT, validHeights, validPanels } from './graphProfiles'

export interface Panel {
  id: number
  channelIds: string[]
  heightPx?: number
}

export interface Layout {
  panels: Panel[]
  activeId: number
  nextId: number
}

export type LayoutAction =
  | { type: 'replaceLayout'; panels: string[][]; heights?: Array<number | null> }
  | { type: 'toggleChannel'; channelId: string }
  | { type: 'removeChannel'; panelId: number; channelId: string }
  | { type: 'addPanel' }
  | { type: 'removePanel'; panelId: number }
  | { type: 'setActive'; panelId: number }
  | { type: 'resizePanel'; panelId: number; heightPx: number }
  | { type: 'resetPanelSize'; panelId: number }

export function makeLayout(panels: string[][], heights?: Array<number | null>): Layout {
  return {
    panels: panels.map((channelIds, i) => ({
      id: i + 1,
      channelIds,
      ...(heights?.[i] ? { heightPx: heights[i] ?? undefined } : {}),
    })),
    activeId: 1,
    nextId: panels.length + 1,
  }
}

function updatePanel(layout: Layout, panelId: number, fn: (ids: string[]) => string[]): Layout {
  return {
    ...layout,
    panels: layout.panels.map((p) =>
      p.id === panelId ? { ...p, channelIds: fn(p.channelIds) } : p,
    ),
  }
}

export function layoutReducer(layout: Layout, action: LayoutAction): Layout {
  switch (action.type) {
    case 'replaceLayout':
      return validPanels(action.panels) &&
        (action.heights === undefined || validHeights(action.heights, action.panels.length))
        ? makeLayout(action.panels, action.heights)
        : layout
    case 'toggleChannel':
      if (
        !layout.panels
          .find((p) => p.id === layout.activeId)
          ?.channelIds.includes(action.channelId) &&
        layout.panels.reduce((n, p) => n + p.channelIds.length, 0) >= 15
      )
        return layout
      return updatePanel(layout, layout.activeId, (ids) =>
        ids.includes(action.channelId)
          ? ids.filter((id) => id !== action.channelId)
          : [...ids, action.channelId],
      )
    case 'removeChannel':
      return updatePanel(layout, action.panelId, (ids) =>
        ids.filter((id) => id !== action.channelId),
      )
    case 'addPanel':
      if (layout.panels.length >= 5) return layout
      return {
        panels: [...layout.panels, { id: layout.nextId, channelIds: [] }],
        activeId: layout.nextId,
        nextId: layout.nextId + 1,
      }
    case 'removePanel': {
      if (layout.panels.length === 1) return updatePanel(layout, action.panelId, () => [])
      const panels = layout.panels.filter((p) => p.id !== action.panelId)
      const activeId = layout.activeId === action.panelId ? panels[0].id : layout.activeId
      return { ...layout, panels, activeId }
    }
    case 'setActive':
      return layout.activeId === action.panelId ? layout : { ...layout, activeId: action.panelId }
    case 'resizePanel':
      return {
        ...layout,
        panels: layout.panels.map((panel) =>
          panel.id === action.panelId
            ? {
                ...panel,
                heightPx: Math.min(
                  MAX_PANEL_HEIGHT,
                  Math.max(MIN_PANEL_HEIGHT, Math.round(action.heightPx)),
                ),
              }
            : panel,
        ),
      }
    case 'resetPanelSize':
      return {
        ...layout,
        panels: layout.panels.map((panel) => {
          if (panel.id !== action.panelId || panel.heightPx === undefined) return panel
          const next = { ...panel }
          delete next.heightPx
          return next
        }),
      }
  }
}
