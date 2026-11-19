import { beforeEach, expect, it, vi } from 'vitest'
import { loadLiveLayoutMode, saveLiveLayoutMode } from './liveLayout'

beforeEach(() => localStorage.clear())

it('defaults safely and restores a bento choice', () => {
  expect(loadLiveLayoutMode()).toBe('default')
  localStorage.setItem('dawg.live-layout-mode.v1', 'invalid')
  expect(loadLiveLayoutMode()).toBe('default')
  saveLiveLayoutMode('bento')
  expect(loadLiveLayoutMode()).toBe('bento')
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  expect(loadLiveLayoutMode()).toBe('default')
  get.mockRestore()
})
