import { describe, expect, it } from 'vitest'
import { originOf, splitOrigin, withOrigin } from './origin'

describe('where a channel comes from', () => {
  it('tells measured, filtered, calculated and simulated channels apart', () => {
    expect(originOf({ id: 'AccelY', group: 'Accelerometer' })).toBe('measured')
    expect(originOf({ id: 'Lat G', group: 'Accelerometer' })).toBe('filtered')
    expect(originOf({ id: 'GPS Speed', group: 'GPS' })).toBe('calculated')
    expect(originOf({ id: 'Lap Time', group: 'Analysis' })).toBe('calculated')
    expect(originOf({ id: 'Total G', group: 'Math' }, 'hypot(AccelX, AccelY)')).toBe('calculated')
    expect(originOf({ id: 'Clean Z', group: 'Math' }, 'lowpass(AccelZ, 15)')).toBe('filtered')
    expect(originOf({ id: 'Sim Speed', group: 'Sim' })).toBe('theory')
  })

  it('writes the origin into the title once and reads it back', () => {
    expect(withOrigin('RPM', 'measured')).toBe('RPM')
    expect(withOrigin('Sim Speed', 'theory')).toBe('Sim Speed · theoretical')
    expect(withOrigin('Sim Speed · theoretical', 'theory')).toBe('Sim Speed · theoretical')
    expect(splitOrigin('Lat G · filtered', 'measured')).toEqual({
      title: 'Lat G',
      origin: 'filtered',
    })
    expect(splitOrigin('RPM', 'measured')).toEqual({ title: 'RPM', origin: 'measured' })
  })
})
