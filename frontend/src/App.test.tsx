import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createPortal } from 'react-dom'
import { openLog } from './viewer/openLog'
import App from './App'

vi.mock('./live/connection', () => ({ useInfo: () => null }))
vi.mock('./viewer/openLog', () => ({ openLog: vi.fn(), pickAndOpenLog: vi.fn() }))
vi.mock('./views/LiveView', () => ({
  LiveView: ({ profileTarget }: { profileTarget: HTMLElement | null }) => (
    <>
      <div>Live dashboard</div>
      {profileTarget && createPortal(<button>Profiles</button>, profileTarget)}
    </>
  ),
}))
vi.mock('./views/LogsView', () => ({
  LogsView: ({ onOpen }: { onOpen: (path: string) => void }) => (
    <button onClick={() => onOpen('run.csv')}>Open downloaded log</button>
  ),
}))
vi.mock('./views/ViewerView', () => ({
  ViewerView: ({
    session,
    error,
    profileTarget,
  }: {
    session: { name: string } | null
    error: string
    profileTarget: HTMLElement | null
  }) => (
    <>
      <div>
        {session?.name ?? 'No log open'}
        {error && <p>{error}</p>}
      </div>
      {session && profileTarget && createPortal(<button>Profiles</button>, profileTarget)}
    </>
  ),
}))

beforeEach(() => vi.mocked(openLog).mockReset())

describe('App navigation', () => {
  it('hosts the profile button in the top navigation', () => {
    render(<App />)
    expect(screen.getByRole('navigation')).toContainElement(
      screen.getByRole('button', { name: 'Profiles' }),
    )
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
    expect(screen.queryByRole('button', { name: 'Profiles' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open downloaded log' }))
    expect(await screen.findByText('run.csv')).toBeInTheDocument()
    expect(screen.getByRole('navigation')).toContainElement(
      screen.getByRole('button', { name: 'Profiles' }),
    )
    expect(openLog).toHaveBeenCalledWith('run.csv')
  })
})
