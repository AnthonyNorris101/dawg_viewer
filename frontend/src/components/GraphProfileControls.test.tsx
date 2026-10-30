import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GraphProfileControls } from './GraphProfileControls'
import { makeLayout } from '../state/layout'

beforeEach(() => localStorage.clear())
it('saves a profile and previews an offline code before applying it', async () => {
  const user = userEvent.setup()
  const dispatch = vi.fn()
  render(
    <GraphProfileControls layout={makeLayout([['RPM']])} dispatch={dispatch} names={['RPM']} />,
  )
  await user.click(screen.getByRole('button', { name: 'Manage / share' }))
  await user.type(screen.getByLabelText('Profile name'), 'Engine')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByRole('option', { name: 'Engine' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^Share$/ }))
  await user.click(screen.getByRole('button', { name: 'Preview import' }))
  expect(await screen.findByText('Chart 1: RPM')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Apply' }))
  expect(dispatch).toHaveBeenCalledWith({ type: 'replaceLayout', panels: [['RPM']] })
})
