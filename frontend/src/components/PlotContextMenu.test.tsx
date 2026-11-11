import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
})
