export interface BentoSize {
  width: 'half' | 'full'
  height: 'short' | 'tall'
}

export interface BentoPlace extends BentoSize {
  id: string
  row: number
  column: 0 | 1
  columnSpan: 1 | 2
  rowSpan: 1 | 2
}

export const defaultBentoSize: BentoSize = { width: 'half', height: 'short' }

export function visualBentoOrder(places: BentoPlace[]): string[] {
  return [...places].sort((a, b) => a.row - b.row || a.column - b.column).map((p) => p.id)
}

export type BentoSlot = { row: number; column: 0 | 1 }

function overlaps(a: BentoPlace, b: BentoPlace) {
  return (
    a.column < b.column + b.columnSpan &&
    b.column < a.column + a.columnSpan &&
    a.row < b.row + b.rowSpan &&
    b.row < a.row + a.rowSpan
  )
}

function valid(places: BentoPlace[]) {
  return places.every(
    (p, i) =>
      p.row >= 0 &&
      p.column + p.columnSpan <= 2 &&
      places.slice(i + 1).every((other) => !overlaps(p, other)),
  )
}

export function assignBentoSlots(
  ids: string[],
  sizes: Record<string, BentoSize>,
  slots: Record<string, BentoSlot>,
): BentoPlace[] {
  const placed: BentoPlace[] = []
  for (const id of ids) {
    const size = sizes[id] ?? defaultBentoSize
    const base = {
      id,
      ...size,
      columnSpan: size.width === 'full' ? 2 : 1,
      rowSpan: size.height === 'tall' ? 2 : 1,
    } as BentoPlace
    const saved = slots[id]
    if (saved) {
      const candidate = { ...base, row: saved.row, column: saved.column }
      if (valid([...placed, candidate])) {
        placed.push(candidate)
        continue
      }
    }
    let row = 0
    let column: 0 | 1 = 0
    for (;;) {
      const candidate = { ...base, row, column }
      if (valid([...placed, candidate])) {
        placed.push(candidate)
        break
      }
      if (column === 0 && base.columnSpan === 1) column = 1
      else {
        row++
        column = 0
      }
    }
  }
  return placed
}

export function previewBentoPlacement(
  places: BentoPlace[],
  id: string,
  slot: BentoSlot,
): BentoPlace[] | null {
  const source = places.find((p) => p.id === id)
  if (!source) return null
  const other = places.filter((p) => p.id !== id)
  const pointed = other.find(
    (p) =>
      slot.column >= p.column &&
      slot.column < p.column + p.columnSpan &&
      slot.row >= p.row &&
      slot.row < p.row + p.rowSpan,
  )
  let row = slot.row
  if (pointed) {
    let mostDisplaced = -1
    for (
      let candidate = Math.max(0, slot.row - source.rowSpan + 1);
      candidate <= slot.row;
      candidate++
    ) {
      const destination = {
        ...source,
        row: candidate,
        column: source.columnSpan === 2 ? (0 as const) : slot.column,
      }
      const count = other.filter((p) => overlaps(destination, p)).length
      if (count > mostDisplaced) {
        mostDisplaced = count
        row = candidate
      }
    }
  }
  const destination = {
    ...source,
    ...slot,
    row,
    column: source.columnSpan === 2 ? (0 as const) : slot.column,
  }
  const displaced = other.filter((p) => overlaps(destination, p))
  const rowShift = source.row - destination.row
  const columnShift = source.column - destination.column
  const next = places.map((p) =>
    p.id === id
      ? destination
      : displaced.some((d) => d.id === p.id)
        ? { ...p, row: p.row + rowShift, column: (p.column + columnShift) as 0 | 1 }
        : p,
  )
  if (valid(next)) return next
  if (displaced.length === 1) {
    const swapped = places.map((p) =>
      p.id === id
        ? destination
        : p.id === displaced[0].id
          ? { ...p, row: source.row, column: source.column }
          : p,
    )
    if (valid(swapped)) return swapped
  }
  return null
}
