import { isPanelKind } from './panels'
import { isObject } from './storage'
import {
  layoutReducer,
  makeLayout,
  type Layout,
  type LayoutAction,
  type Panel,
  type PanelKind,
} from './layout'

export interface Sheet {
  id: number
  name: string
  layout: Layout
}

export interface Workbook {
  sheets: Sheet[]
  activeId: number
  nextId: number
}

export type WorkbookAction =
  | { type: 'layout'; action: LayoutAction }
  | { type: 'removeChannel'; channelId: string }
  | { type: 'addSheet'; name?: string; layout?: Layout }
  | { type: 'duplicateSheet'; id: number }
  | { type: 'removeSheet'; id: number }
  | { type: 'renameSheet'; id: number; name: string }
  | { type: 'selectSheet'; id: number }
  | { type: 'moveSheet'; id: number; by: number }
  | { type: 'replace'; workbook: Workbook }

export function activeSheet(wb: Workbook): Sheet {
  return wb.sheets.find((s) => s.id === wb.activeId) ?? wb.sheets[0]
}

export function workbookReducer(wb: Workbook, action: WorkbookAction): Workbook {
  switch (action.type) {
    case 'layout': {
      const sheet = activeSheet(wb)
      const layout = layoutReducer(sheet.layout, action.action)
      if (layout === sheet.layout) return wb
      return { ...wb, sheets: wb.sheets.map((s) => (s.id === sheet.id ? { ...s, layout } : s)) }
    }
    case 'removeChannel': {
      let changed = false
      const sheets = wb.sheets.map((sheet) => {
        let changedSheet = false
        const panels = sheet.layout.panels.map((panel) => {
          if (!panel.channelIds.includes(action.channelId)) return panel
          changed = changedSheet = true
          return { ...panel, channelIds: panel.channelIds.filter((id) => id !== action.channelId) }
        })
        return changedSheet ? { ...sheet, layout: { ...sheet.layout, panels } } : sheet
      })
      return changed ? { ...wb, sheets } : wb
    }
    case 'addSheet': {
      const sheet: Sheet = {
        id: wb.nextId,
        name: action.name || `Sheet ${wb.sheets.length + 1}`,
        layout: action.layout ?? makeLayout([[]]),
      }
      return { sheets: [...wb.sheets, sheet], activeId: sheet.id, nextId: wb.nextId + 1 }
    }
    case 'duplicateSheet': {
      const src = wb.sheets.find((s) => s.id === action.id)
      if (!src) return wb
      const copy: Sheet = { ...src, id: wb.nextId, name: `${src.name} copy` }
      const i = wb.sheets.indexOf(src)
      const sheets = [...wb.sheets.slice(0, i + 1), copy, ...wb.sheets.slice(i + 1)]
      return { sheets, activeId: copy.id, nextId: wb.nextId + 1 }
    }
    case 'removeSheet': {
      if (wb.sheets.length === 1) return wb
      const i = wb.sheets.findIndex((s) => s.id === action.id)
      const sheets = wb.sheets.filter((s) => s.id !== action.id)
      const activeId = wb.activeId === action.id ? sheets[Math.max(0, i - 1)].id : wb.activeId
      return { ...wb, sheets, activeId }
    }
    case 'renameSheet':
      return {
        ...wb,
        sheets: wb.sheets.map((s) =>
          s.id === action.id ? { ...s, name: action.name.trim() || s.name } : s,
        ),
      }
    case 'selectSheet':
      return wb.activeId === action.id ? wb : { ...wb, activeId: action.id }
    case 'moveSheet': {
      const i = wb.sheets.findIndex((s) => s.id === action.id)
      const j = i + action.by
      if (i < 0 || j < 0 || j >= wb.sheets.length) return wb
      const sheets = [...wb.sheets]
      ;[sheets[i], sheets[j]] = [sheets[j], sheets[i]]
      return { ...wb, sheets }
    }
    case 'replace':
      return action.workbook
  }
}

const SUSPENSION = /damp|shock|susp|travel|ride.?h|wheel.?pos|pot/i

function validPanel(p: unknown): p is Panel {
  return (
    isObject(p) &&
    typeof p.id === 'number' &&
    isPanelKind(p.kind) &&
    Array.isArray(p.channelIds) &&
    p.channelIds.every((c) => typeof c === 'string') &&
    typeof p.wide === 'boolean'
  )
}

function validLayout(l: unknown): l is Layout {
  return (
    isObject(l) &&
    Array.isArray(l.panels) &&
    l.panels.length > 0 &&
    l.panels.every(validPanel) &&
    typeof l.activeId === 'number' &&
    typeof l.nextId === 'number'
  )
}

export function validWorkbook(v: unknown): v is Workbook {
  return (
    isObject(v) &&
    Array.isArray(v.sheets) &&
    v.sheets.length > 0 &&
    v.sheets.every(
      (s) =>
        isObject(s) &&
        typeof s.id === 'number' &&
        typeof s.name === 'string' &&
        validLayout(s.layout),
    ) &&
    typeof v.activeId === 'number' &&
    typeof v.nextId === 'number'
  )
}

export function defaultWorkbook(channelNames: Set<string>, hasGps: boolean): Workbook {
  const has = (n: string) => channelNames.has(n)
  const pick = (...names: string[]) => names.filter(has)
  const time = (...names: string[]): Omit<Panel, 'id'> => ({
    kind: 'time',
    wide: true,
    channelIds: pick(...names),
  })
  const other = (kind: PanelKind, ids: string[]): Omit<Panel, 'id'> => ({
    kind,
    wide: kind === 'launch' || kind === 'aero',
    channelIds: ids,
  })
  const nonEmpty = (panels: Omit<Panel, 'id'>[]) =>
    panels.filter(
      (p) =>
        p.kind === 'map' || p.kind === 'launch' || p.kind === 'aero' || p.channelIds.length > 0,
    )

  const vibration = () => {
    const susp = [...channelNames].filter((n) => SUSPENSION.test(n)).slice(0, 4)
    const accels = pick('AccelX', 'AccelY', 'AccelZ')
    const spectra = [
      ...(susp.length ? [other('spectrum', susp)] : []),
      ...(accels.length ? [other('spectrum', accels)] : []),
    ]
    if (spectra.length === 1) spectra[0].wide = true
    return nonEmpty([...(susp.length ? [time(...susp)] : []), time('AccelZ'), ...spectra])
  }

  const sheets: { name: string; panels: Omit<Panel, 'id'>[] }[] = [
    {
      name: 'Driver',
      panels: nonEmpty([
        time('VSS', 'Speed', 'GearRaw'),
        time('TPS1', 'FBPS', 'RBPS'),
        time('StrAngle'),
        ...(hasGps ? [other('map', pick('VSS', 'Speed').slice(0, 1))] : []),
        ...(has('AccelX') && has('AccelY') ? [other('xy', ['AccelY', 'AccelX'])] : []),
      ]),
    },
    {
      name: 'Engine',
      panels: nonEmpty([
        time('RPM', 'TPS1'),
        time('CLT1', 'OilTemp', 'RadTemp'),
        time('OilPres', 'AFR'),
        time('BatV'),
      ]),
    },
    {
      name: 'Chassis',
      panels: nonEmpty([
        time('AccelX', 'AccelY'),
        time('AccelZ'),
        time('Yaw'),
        ...(has('AccelY') ? [other('histogram', ['AccelY'])] : []),
        ...(has('StrAngle') ? [other('histogram', ['StrAngle'])] : []),
      ]),
    },
    {
      name: 'Vibration',
      panels: vibration(),
    },
    {
      name: 'Launch',
      panels:
        hasGps || pick('VSS', 'Speed').length
          ? nonEmpty([other('launch', []), time('RPM', 'TPS1'), time('VSS', 'Speed', 'GearRaw')])
          : [],
    },
    {
      name: 'Aero',
      panels:
        has('AccelY') && (hasGps || pick('VSS', 'Speed').length)
          ? nonEmpty([
              other('aero', []),
              time('VSS', 'Speed', 'AccelY'),
              time(...[...channelNames].filter((n) => SUSPENSION.test(n)).slice(0, 4)),
            ])
          : [],
    },
  ]

  const built = sheets.filter((s) => s.panels.some((p) => p.kind === 'time'))
  if (built.length === 0) {
    const first = [...channelNames].slice(0, 4)
    built.push({
      name: 'Overview',
      panels: [time(...first.slice(0, 2)), time(...first.slice(2, 4))].filter(
        (p) => p.channelIds.length > 0,
      ),
    })
    if (built[0].panels.length === 0) built[0].panels.push(time())
  }
  return {
    sheets: built.map((s, i) => ({ id: i + 1, name: s.name, layout: makeLayout(s.panels) })),
    activeId: 1,
    nextId: built.length + 1,
  }
}
