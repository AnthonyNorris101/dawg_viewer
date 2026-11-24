import { channels, colorFor, info, status, store } from './connection'
import { createLiveSessionReader } from './snapshot'

export { LIVE_PATH } from './snapshot'

let read: ReturnType<typeof createLiveSessionReader> | undefined
const NO_METAS = {}

export function liveSession() {
  read ??= createLiveSessionReader(store, colorFor)
  return read(channels.get(), info.get()?.channels ?? NO_METAS, status.get().profileName)
}
