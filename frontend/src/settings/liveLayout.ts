export type LiveLayoutMode = 'default' | 'bento'

const KEY = 'dawg.live-layout-mode.v1'

export function loadLiveLayoutMode(): LiveLayoutMode {
  try {
    return localStorage.getItem(KEY) === 'bento' ? 'bento' : 'default'
  } catch {
    return 'default'
  }
}

export function saveLiveLayoutMode(mode: LiveLayoutMode) {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // The choice still works for this session.
  }
}
