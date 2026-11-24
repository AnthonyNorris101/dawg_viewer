import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(cleanup)

// Tests never run inside the Wails app, so every file gets this stand-in for
// its runtime. The real module starts a 5 s polling timer on import that uses
// `window`; when a quick test file finishes first, jsdom is gone, the timer
// throws "window is not defined" and Vitest fails the run as an unhandled
// error even though every test passed. A test file can still vi.mock it.
vi.mock('@wailsio/runtime', () => ({
  Events: { On: () => () => {} },
  Call: { ByID: () => Promise.reject(new Error('No Wails app in tests')) },
  Create: { Events: {} },
}))
