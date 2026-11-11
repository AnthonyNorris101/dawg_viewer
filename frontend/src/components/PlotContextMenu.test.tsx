import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { PlotContextMenu } from './PlotContextMenu'

describe('PlotContextMenu', () => {
  it('validates and applies bounds to the selected axis', () => {
    const onPatch = vi.fn()
    render(
      <PlotContextMenu
        panel={{ id: 2, kind: 'time', channelIds: ['RPM'], wide: true }}
        x={10}
        y={10}
        units={['rpm']}
        onPatch={onPatch}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Y minimum' }), {
      target: { value: '8000' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Y maximum' }), {
      target: { value: '1000' },
    })
    expect(screen.getByRole('button', { name: 'Apply bounds' })).toBeDisabled()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Y maximum' }), {
      target: { value: '9000' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply bounds' }))
    expect(onPatch).toHaveBeenCalledWith({ yBounds: { rpm: [8000, 9000] } })
  })

  it('offers the histogram setting and viewer shortcuts', () => {
    const onPatch = vi.fn()
    const onEdit = vi.fn()
    const onFilter = vi.fn()
    render(
      <PlotContextMenu
        panel={{ id: 3, kind: 'histogram', channelIds: ['AccelY'], wide: false }}
        x={10}
        y={10}
        units={[]}
        onPatch={onPatch}
        onEdit={onEdit}
        onFilter={onFilter}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('combobox', { name: 'Histogram bins' }), {
      target: { value: '80' },
    })
    expect(onPatch).toHaveBeenCalledWith({ bins: 80 })
    fireEvent.click(screen.getByRole('button', { name: 'Edit AccelY…' }))
    expect(onEdit).toHaveBeenCalledWith('AccelY')
    fireEvent.click(screen.getByRole('button', { name: 'Filter channels…' }))
    expect(onFilter).toHaveBeenCalledWith(['AccelY'])
  })

  it('sets XY bounds on the selected axis', () => {
    const onPatch = vi.fn()
    render(
      <PlotContextMenu
        panel={{ id: 4, kind: 'xy', channelIds: ['AccelX', 'AccelY'], wide: false }}
        x={10}
        y={10}
        units={[]}
        onPatch={onPatch}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Axis minimum' }), {
      target: { value: '-2' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Axis maximum' }), {
      target: { value: '2' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply bounds' }))
    expect(onPatch).toHaveBeenCalledWith({ xyBounds: { x: [-2, 2] } })
  })

  it('keeps numeric fields in tab order and applies Y bounds with Enter', async () => {
    const user = userEvent.setup()
    const onPatch = vi.fn()
    render(
      <PlotContextMenu
        panel={{ id: 2, kind: 'time', channelIds: [], wide: true }}
        x={10}
        y={10}
        units={['rpm']}
        onPatch={onPatch}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const axis = screen.getByRole('button', { name: 'Y axis' })
    const minimum = screen.getByRole('spinbutton', { name: 'Y minimum' })
    const maximum = screen.getByRole('spinbutton', { name: 'Y maximum' })
    expect(minimum).toHaveAttribute('step', 'any')
    axis.focus()
    await user.tab()
    expect(minimum).toHaveFocus()
    await user.type(minimum, '-1.5')
    await user.tab()
    expect(maximum).toHaveFocus()
    await user.type(maximum, '2.5{Enter}')
    expect(onPatch).toHaveBeenCalledWith({ yBounds: { rpm: [-1.5, 2.5] } })
  })

  it('renders and navigates the Y axis choices inside the styled menu', async () => {
    const user = userEvent.setup()
    render(
      <PlotContextMenu
        panel={{ id: 2, kind: 'time', channelIds: [], wide: true }}
        x={10}
        y={10}
        units={['rpm', 'mph']}
        onPatch={vi.fn()}
        onEdit={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const axis = screen.getByRole('button', { name: 'Y axis' })
    await user.click(axis)
    expect(screen.getByRole('listbox', { name: 'Y axis choices' })).toBeInTheDocument()
    const mph = screen.getByRole('option', { name: 'mph' })
    mph.focus()
    await user.keyboard('{Enter}')
    expect(axis).toHaveTextContent('mph')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('spinbutton', { name: 'Y minimum' })).toHaveFocus()
  })
})
