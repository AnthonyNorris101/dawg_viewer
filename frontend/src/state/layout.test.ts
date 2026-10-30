import { describe, expect, it } from 'vitest'
import { layoutReducer, makeLayout } from './layout'

describe('layoutReducer', () => {
  it('keeps channel selection in the active panel', () => {
    let layout = makeLayout([['RPM'], ['TPS1']])
    layout = layoutReducer(layout, { type: 'setActive', panelId: 2 })
    layout = layoutReducer(layout, { type: 'toggleChannel', channelId: 'RPM' })
    expect(layout.panels.map((panel) => panel.channelIds)).toEqual([['RPM'], ['TPS1', 'RPM']])
    layout = layoutReducer(layout, { type: 'removeChannel', panelId: 2, channelId: 'TPS1' })
    expect(layout.panels[1].channelIds).toEqual(['RPM'])
  })

  it('chooses a remaining panel when the active one is removed', () => {
    let layout = makeLayout([['RPM']])
    layout = layoutReducer(layout, { type: 'addPanel' })
    expect(layout.activeId).toBe(2)
    layout = layoutReducer(layout, { type: 'removePanel', panelId: 2 })
    expect(layout.activeId).toBe(1)
    layout = layoutReducer(layout, { type: 'removePanel', panelId: 1 })
    expect(layout.panels).toEqual([{ id: 1, channelIds: [] }])
  })

  it('preserves surviving panels while plots are added and removed', () => {
    let layout = makeLayout([['RPM'], ['TPS1']])
    const [first, second] = layout.panels

    layout = layoutReducer(layout, { type: 'addPanel' })
    expect(layout.panels.slice(0, 2)).toEqual([first, second])
    expect(layout.panels[0]).toBe(first)
    expect(layout.panels[1]).toBe(second)

    layout = layoutReducer(layout, { type: 'removePanel', panelId: 3 })
    expect(layout.panels[0]).toBe(first)
    expect(layout.panels[1]).toBe(second)
    expect(layout.nextId).toBe(4)
  })

  it('resizes, clamps, resets, and restores panel heights', () => {
    let layout = makeLayout([['RPM'], ['TPS1']], [320, null])
    expect(layout.panels[0].heightPx).toBe(320)
    expect(layout.panels[1].heightPx).toBeUndefined()

    layout = layoutReducer(layout, { type: 'resizePanel', panelId: 2, heightPx: 100 })
    expect(layout.panels[1].heightPx).toBe(192)
    layout = layoutReducer(layout, { type: 'resizePanel', panelId: 1, heightPx: 5000 })
    expect(layout.panels[0].heightPx).toBe(2000)
    layout = layoutReducer(layout, { type: 'resetPanelSize', panelId: 1 })
    expect(layout.panels[0].heightPx).toBeUndefined()
  })
})
