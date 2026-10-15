export interface Panel {
  id: number
  channelIds: string[]
}

export interface Layout {
  panels: Panel[]
  activeId: number
  nextId: number
}

export type LayoutAction =
  | { type: 'toggleChannel'; channelId: string }
  | { type: 'removeChannel'; panelId: number; channelId: string }
  | { type: 'addPanel' }
  | { type: 'removePanel'; panelId: number }
  | { type: 'setActive'; panelId: number }

export const initialLayout: Layout = {
  panels: [
    { id: 1, channelIds: ['rpm', 'tps'] },
    { id: 2, channelIds: ['ws_fl', 'ws_fr', 'ws_rl', 'ws_rr'] },
    { id: 3, channelIds: ['acc_x', 'acc_y'] },
  ],
  activeId: 1,
  nextId: 4,
}

// Untouched panels keep their object identity so memoized plots don't rebuild.
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
    case 'toggleChannel':
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
      return {
        panels: [...layout.panels, { id: layout.nextId, channelIds: [] }],
        activeId: layout.nextId,
        nextId: layout.nextId + 1,
      }
    case 'removePanel': {
      // Always keep one panel around; removing the last one just empties it.
      if (layout.panels.length === 1) return updatePanel(layout, action.panelId, () => [])
      const panels = layout.panels.filter((p) => p.id !== action.panelId)
      const activeId = layout.activeId === action.panelId ? panels[0].id : layout.activeId
      return { ...layout, panels, activeId }
    }
    case 'setActive':
      return layout.activeId === action.panelId ? layout : { ...layout, activeId: action.panelId }
  }
}
