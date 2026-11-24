import { describe, expect, it } from 'vitest'
import { addReference, changePct, references, removeReference, validReferences } from './references'

describe('saved results for comparing', () => {
  it('saves, replaces by name and removes', () => {
    references.set([])
    const a = addReference({
      kind: 'gg',
      name: 'Run 1',
      points: [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ],
      area: 2,
      radius: 0.8,
    })
    addReference({
      kind: 'aero',
      name: 'Run 1',
      bins: [
        [10, 1.4],
        [20, 1.7],
      ],
      mu: 1.3,
      clA: 2.1,
    })
    expect(references.get()).toHaveLength(2)
    addReference({
      kind: 'gg',
      name: 'Run 1',
      points: [
        [1, 0],
        [0, 1],
        [-1, 0],
      ],
      area: 1,
      radius: 0.6,
    })
    expect(references.get().filter((r) => r.kind === 'gg')).toHaveLength(1)
    expect(validReferences(references.get())).toBe(true)
    removeReference(a.id)
    expect(references.get()).toHaveLength(2)
    expect(validReferences([{ kind: 'gg', id: 'x', name: 'bad', created: 1, points: [[1]] }])).toBe(
      false,
    )
  })

  it('says how much better or worse', () => {
    expect(changePct(2.12, 2)).toBe('+6.0%')
    expect(changePct(1.9, 2)).toBe('−5.0%')
  })
})
