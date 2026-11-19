import { describe, expect, it } from 'vitest'
import { layoutReducer, makeLayout } from './layout'
import { defaultWorkbook, validWorkbook, workbookReducer } from './workbook'

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
    expect(layout.panels).toEqual([{ id: 1, kind: 'time', wide: true, channelIds: [] }])
  })

  it('picks X then Y for XY panels and one channel for histograms', () => {
    let layout = makeLayout([[]])
    layout = layoutReducer(layout, { type: 'addPanel', kind: 'xy' })
    layout = layoutReducer(layout, { type: 'toggleChannel', channelId: 'AccelY' })
    layout = layoutReducer(layout, { type: 'toggleChannel', channelId: 'AccelX' })
    expect(layout.panels[1]).toMatchObject({
      kind: 'xy',
      wide: false,
      channelIds: ['AccelY', 'AccelX'],
    })
    layout = layoutReducer(layout, { type: 'addPanel', kind: 'histogram' })
    layout = layoutReducer(layout, { type: 'toggleChannel', channelId: 'RPM' })
    layout = layoutReducer(layout, { type: 'toggleChannel', channelId: 'TPS1' })
    expect(layout.panels[2].channelIds).toEqual(['TPS1'])
  })

  it('moves panels', () => {
    let layout = makeLayout([['A'], ['B'], ['C']])
    layout = layoutReducer(layout, { type: 'movePanel', panelId: 3, by: -1 })
    expect(layout.panels.map((p) => p.channelIds[0])).toEqual(['A', 'C', 'B'])
    expect(layoutReducer(layout, { type: 'movePanel', panelId: 1, by: -1 })).toBe(layout)
  })
})

const last = (wb: { sheets: { name: string; layout: { panels: { channelIds: string[] }[] } }[] }) =>
  wb.sheets[wb.sheets.length - 1]

describe('workbook', () => {
  it('builds premade sheets from the channels a log has', () => {
    const wb = defaultWorkbook(new Set(['RPM', 'TPS1', 'CLT1', 'AccelX', 'AccelY']), true)
    expect(wb.sheets.map((s) => s.name)).toEqual(['Driver', 'Engine', 'Chassis', 'Launch', 'Aero'])
    expect(wb.sheets[4].layout.panels.map((p) => [p.kind, p.wide])).toEqual([
      ['aero', true],
      ['time', true],
    ])
    const vib = defaultWorkbook(new Set(['AccelZ', 'Damper FL', 'Damper FR']), false).sheets
    expect(vib.map((s) => s.name)).toEqual(['Chassis', 'Vibration'])
    expect(vib[1].layout.panels.map((p) => [p.kind, p.channelIds])).toEqual([
      ['time', ['Damper FL', 'Damper FR']],
      ['time', ['AccelZ']],
      ['spectrum', ['Damper FL', 'Damper FR']],
      ['spectrum', ['AccelZ']],
    ])
    const driver = wb.sheets[0].layout.panels
    expect(driver.map((p) => p.kind)).toEqual(['time', 'map', 'xy'])
    expect(validWorkbook(wb)).toBe(true)
  })

  it('falls back to the first channels for unknown logs', () => {
    const wb = defaultWorkbook(new Set(['a', 'b', 'c']), false)
    expect(wb.sheets).toHaveLength(1)
    expect(wb.sheets[0].layout.panels.map((p) => p.channelIds)).toEqual([['a', 'b'], ['c']])
  })

  it('edits the active sheet and manages sheets', () => {
    let wb = defaultWorkbook(new Set(['RPM']), false)
    wb = workbookReducer(wb, { type: 'addSheet', name: 'Brakes' })
    expect(last(wb).name).toBe('Brakes')
    wb = workbookReducer(wb, {
      type: 'layout',
      action: { type: 'toggleChannel', channelId: 'FBPS' },
    })
    expect(last(wb).layout.panels[0].channelIds).toEqual(['FBPS'])
    wb = workbookReducer(wb, { type: 'duplicateSheet', id: wb.activeId })
    expect(last(wb).name).toBe('Brakes copy')
    wb = workbookReducer(wb, { type: 'removeSheet', id: wb.activeId })
    expect(last(wb).name).toBe('Brakes')
    expect(validWorkbook({ sheets: [] })).toBe(false)
  })

  it('removes a deleted channel from every worksheet while retaining unrelated panels', () => {
    let wb = defaultWorkbook(new Set(['RPM', 'VSS']), false)
    wb = workbookReducer(wb, { type: 'addSheet', layout: makeLayout([['RPM'], ['VSS']]) })
    const untouched = last(wb).layout.panels[1]
    const next = workbookReducer(wb, { type: 'removeChannel', channelId: 'RPM' })
    expect(
      next.sheets.every((s) => s.layout.panels.every((p) => !p.channelIds.includes('RPM'))),
    ).toBe(true)
    expect(last(next).layout.panels[1]).toBe(untouched)
    expect(workbookReducer(next, { type: 'removeChannel', channelId: 'missing' })).toBe(next)
  })
})
