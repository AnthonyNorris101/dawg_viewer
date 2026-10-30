import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Events } from '@wailsio/runtime'
import { LogService } from '../../bindings/dawg_viewer/services'
import type { LocalLog, RemoteLog } from '../../bindings/dawg_viewer/services/models'
import { LogsView } from './LogsView'

vi.mock('@wailsio/runtime', () => ({ Events: { On: vi.fn(() => vi.fn()) } }))
vi.mock('../../bindings/dawg_viewer/services', () => ({
  LogService: {
    LogsFolder: vi.fn(),
    LocalLogs: vi.fn(),
    RemoteLogs: vi.fn(),
    Download: vi.fn(),
    FinishRemote: vi.fn(),
    ConvertLocal: vi.fn(),
  },
}))

const local: LocalLog = {
  name: 'run.bin',
  path: 'C:/logs/run.bin',
  kind: 'bin',
  size: 2048,
  modified: 0,
}
const remote: RemoteLog = {
  name: 'run.bin',
  number: 1,
  date: '2026-10-28',
  downloaded: false,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(LogService.LogsFolder).mockResolvedValue('C:/logs')
  vi.mocked(LogService.LocalLogs).mockResolvedValue([local])
  vi.mocked(LogService.RemoteLogs).mockResolvedValue([remote])
  vi.mocked(LogService.Download).mockResolvedValue([])
  vi.mocked(LogService.FinishRemote).mockResolvedValue(undefined)
  vi.mocked(LogService.ConvertLocal).mockResolvedValue(local)
})

describe('LogsView', () => {
  it('loads local logs and opens the selected file', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(<LogsView onOpen={onOpen} />)

    expect(await screen.findByText('run.bin')).toBeInTheDocument()
    expect(screen.getByText('2 KB')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Open$/ }))
    expect(onOpen).toHaveBeenCalledWith(local.path)
  })

  it('connects, selects, and downloads a remote log', async () => {
    const user = userEvent.setup()
    render(<LogsView onOpen={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /^Connect$/ }))
    expect(
      await screen.findByText(/isn't recording while its file server is on/),
    ).toBeInTheDocument()
    const selected = screen.getByRole('button', { name: 'Download selected' })
    expect(selected).toBeDisabled()
    await user.click(screen.getByRole('checkbox'))
    expect(selected).toBeEnabled()
    await user.click(selected)
    await waitFor(() => expect(LogService.Download).toHaveBeenCalledWith(['run.bin']))
    expect(LogService.RemoteLogs).toHaveBeenCalledTimes(2)
    expect(LogService.LocalLogs).toHaveBeenCalledTimes(2)
  })

  it('shows service failures and closes the remote server on unmount', async () => {
    vi.mocked(LogService.RemoteLogs).mockRejectedValue(new Error('Logger unavailable'))
    const user = userEvent.setup()
    const view = render(<LogsView onOpen={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /^Connect$/ }))
    expect(await screen.findByText('Logger unavailable')).toBeInTheDocument()
    view.unmount()
    expect(Events.On).toHaveBeenCalledWith('logs:progress', expect.any(Function))
    expect(LogService.FinishRemote).toHaveBeenCalled()
  })
})
