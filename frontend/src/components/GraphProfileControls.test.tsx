import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphProfileControls } from './GraphProfileControls'
import { makeLayout } from '../state/layout'

beforeEach(() => localStorage.clear())
it('saves a profile and previews an offline code before applying it', async () => {
  const user = userEvent.setup()
  const dispatch = vi.fn()
  const target = document.createElement('div')
  document.body.append(target)
  render(
    <GraphProfileControls
      target={target}
      layout={makeLayout([['RPM']], [320])}
      dispatch={dispatch}
      names={['RPM']}
    />,
  )
  const profileButton = screen.getByRole('button', { name: 'Profiles' })
  expect(profileButton).toHaveTextContent('Profiles')
  await user.click(profileButton)
  await user.type(screen.getByLabelText('Profile name'), 'Engine')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByRole('option', { name: 'Engine' })).toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem('dawg.graph-profiles.v1') ?? '[]')[0].heights).toEqual([
    320,
  ])
  await user.click(screen.getByRole('button', { name: 'Generate code' }))
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  expect(await screen.findByText('Chart 1: RPM')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  expect(dispatch).toHaveBeenCalledWith({ type: 'replaceLayout', panels: [['RPM']] })

  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog', { name: 'Graph profiles' })).not.toBeInTheDocument()
  target.remove()
})
