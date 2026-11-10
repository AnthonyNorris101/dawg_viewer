import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { openLog } from './viewer/openLog'
import App from './App'

vi.mock('./live/connection', () => ({
  useInfo: () => null,
  setLiveShown: () => {},
  useTestMode: () => false,
}))
vi.mock('./testmode/testMode', () => ({
  startTestMode: vi.fn(),
  stopTestMode: vi.fn(),
  testSession: vi.fn(),
  TEST_LOG_PATH: 'test',
}))
vi.mock('./viewer/openLog', () => ({ openLog: vi.fn(), pickAndOpenLog: vi.fn() }))
vi.mock('./views/LiveView', () => ({
  LiveView: ({ layoutMode }: { layoutMode: string }) => <div>Live dashboard: {layoutMode}</div>,
}))
vi.mock('./views/LogsView', () => ({
  LogsView: ({ onOpen, opening }: { onOpen: (path: string) => void; opening: boolean }) => (
    <>
      <button disabled={opening} onClick={() => onOpen('run.csv')}>
        Open downloaded log
      </button>
      <button
        onClick={() => {
          onOpen('first.csv')
          onOpen('second.csv')
        }}
      >
        Open two logs
      </button>
    </>
  ),
}))
vi.mock('./views/ViewerView', () => ({
  ViewerView: ({ session, error }: { session: { name: string } | null; error: string }) => (
    <div>
      {session?.name ?? 'No log open'}
      {error && <p>{error}</p>}
    </div>
  ),
}))

beforeEach(() => {
  vi.mocked(openLog).mockReset()
})

describe('App navigation', () => {
  it('opens the empty Settings page and returns to the mounted Live view', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Plot layout' }))
    expect(screen.getByRole('menuitemradio', { name: 'default' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await user.click(screen.getByRole('menuitemradio', { name: 'bento' }))
    expect(localStorage.getItem('dawg.live-layout-mode.v1')).toBe('bento')

    await user.click(screen.getByRole('button', { name: 'Live' }))
    expect(screen.getByText('Live dashboard: bento')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Plot layout' }))
    await user.click(screen.getByRole('menuitemradio', { name: 'default' }))
    await user.click(screen.getByRole('button', { name: 'Live' }))
    expect(screen.getByText('Live dashboard: default')).toBeVisible()
  })

  it('opens a downloaded log in the viewer', async () => {
    const user = userEvent.setup()
    vi.mocked(openLog).mockResolvedValue({
      name: 'run.csv',
      path: 'run.csv',
      note: '',
      sampleRate: 0,
      time: new Float64Array(),
      channels: [],
      byId: new Map(),
    })
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Logs' }))
    await user.click(screen.getByRole('button', { name: 'Open downloaded log' }))
    expect(await screen.findByText('run.csv')).toBeInTheDocument()
    expect(openLog).toHaveBeenCalledWith('run.csv')
  })

  it('ignores another open request while a log is loading', async () => {
    const user = userEvent.setup()
    const loadedSession = {
      name: 'first.csv',
      path: 'first.csv',
      note: '',
      sampleRate: 0,
      time: new Float64Array(),
      channels: [],
      byId: new Map(),
    }
    let finish!: () => void
    vi.mocked(openLog).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(loadedSession)
        }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Logs' }))
    await user.click(screen.getByRole('button', { name: 'Open two logs' }))
    expect(openLog).toHaveBeenCalledTimes(1)
    expect(openLog).toHaveBeenCalledWith('first.csv')
    expect(screen.getByRole('button', { name: 'Open downloaded log' })).toBeDisabled()

    finish()
    expect(await screen.findByText('first.csv')).toBeInTheDocument()
    expect(openLog).toHaveBeenCalledTimes(1)
  })
})
