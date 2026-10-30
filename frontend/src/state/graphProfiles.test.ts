import { beforeEach, expect, it } from 'vitest'
import { cacheNames, loadProfiles, saveProfiles, validPanels } from './graphProfiles'
beforeEach(() => localStorage.clear())
it('persists profiles and channel names', () => {
  const profiles = [{ name: 'Engine', panels: [['RPM']] }]
  saveProfiles(profiles)
  expect(loadProfiles()).toEqual(profiles)
  cacheNames(['RPM'])
  expect(cacheNames(['RPM', 'TPS1'])).toEqual(['RPM', 'TPS1'])
})
it('ignores malformed storage and rejects excessive layouts', () => {
  localStorage.setItem('dawg.graph-profiles.v1', 'broken')
  expect(loadProfiles()).toEqual([])
  expect(validPanels(Array.from({ length: 6 }, () => []))).toBe(false)
  expect(validPanels([Array(16).fill('RPM')])).toBe(false)
})
