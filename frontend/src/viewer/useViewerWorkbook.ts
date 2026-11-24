import { useCallback, useEffect, useReducer } from 'react'
import type { Session } from '../data/session'
import { onWorkbook, WORKBOOK_KEY } from '../state/setup'
import { load, save } from '../state/storage'
import {
  activeSheet,
  defaultWorkbook,
  validWorkbook,
  workbookReducer,
  type Workbook,
} from '../state/workbook'
import type { LayoutAction } from '../state/layout'

export function useViewerWorkbook(base: Session, hasGps: boolean) {
  const [workbook, dispatchWb] = useReducer(
    workbookReducer,
    null,
    () =>
      load<Workbook | null>(WORKBOOK_KEY, null, (v): v is Workbook => validWorkbook(v)) ??
      defaultWorkbook(new Set(base.channels.map((c) => c.id)), hasGps),
  )
  useEffect(() => {
    save(WORKBOOK_KEY, workbook)
  }, [workbook])
  const fresh = useCallback(
    () => defaultWorkbook(new Set(base.channels.map((c) => c.id)), hasGps),
    [base, hasGps],
  )
  useEffect(
    () =>
      onWorkbook((wb) => {
        dispatchWb({ type: 'replace', workbook: wb ?? fresh() })
      }),
    [fresh],
  )
  const sheet = activeSheet(workbook)
  const layout = sheet.layout
  const activePanel = layout.panels.find((p) => p.id === layout.activeId)
  const dispatch = useCallback((action: LayoutAction) => dispatchWb({ type: 'layout', action }), [])

  return { workbook, dispatchWb, sheet, layout, activePanel, dispatch }
}
