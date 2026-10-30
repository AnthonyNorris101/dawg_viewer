import { describe, expect, it } from 'vitest'
import { decodeGraphCode, encodeGraphCode, resolvePanels } from './graphCode'

describe('offline graph codes', () => {
  it('shares arbitrary names and preserves missing entries until they arrive', async () => {
    const panels = [['RPM', 'Future 温度'], [], ['OilTemp']]
    const code = await encodeGraphCode(panels, 256)
    const decoded = decodeGraphCode(
      code
        .toLowerCase()
        .match(/.{1,5}/g)!
        .join('-'),
    )
    const partial = await resolvePanels(decoded, ['RPM'])
    expect(partial[0][0]).toBe('RPM')
    expect(partial[0][1]).toMatch(/^~/)
    expect(await resolvePanels(partial, panels.flat())).toEqual(panels)
  })
  it('bounds layouts and detects damaged codes', async () => {
    const panels = Array.from({ length: 5 }, (_, i) =>
      Array.from({ length: 3 }, (_, j) => `channel-${i}-${j}`),
    )
    const code = await encodeGraphCode(panels, 256)
    expect(code).toHaveLength(75)
    expect(await resolvePanels(decodeGraphCode(code), panels.flat())).toEqual(panels)
    expect(() => decodeGraphCode(code.slice(0, -1))).toThrow()
    await expect(encodeGraphCode([Array(16).fill('RPM')], 256)).rejects.toThrow()
    const wide = await encodeGraphCode(panels, 1000)
    expect(wide).toHaveLength(105)
    expect(await resolvePanels(decodeGraphCode(wide), panels.flat())).toEqual(panels)
  })
})
