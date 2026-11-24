import { describe, expect, it } from 'vitest'
import { defaultSpot, placeOf, sensorPos } from './sensors'

describe('sensor spots', () => {
  it('knows where the usual channels sit', () => {
    expect(defaultSpot('Damper FL')?.place).toBe('front-left damper')
    expect(defaultSpot('Damper RR raw')?.place).toBe('rear-right damper')
    expect(defaultSpot('AccelY')?.place).toMatch(/IMU/)
    expect(defaultSpot('PosLat_H')?.place).toMatch(/GPS/)
    expect(defaultSpot('OilTemp')?.place).toMatch(/temperature/)
    expect(defaultSpot('OilPres')?.place).toMatch(/pressure/)
    expect(defaultSpot('RX_INT')?.place).toMatch(/logger/)
    expect(defaultSpot('mystery_7')).toBeNull()
  })

  it('keeps every spot on the drawing', () => {
    for (const name of [
      'FBPS',
      'RBPS',
      'StrAngle',
      'TPS1',
      'RPM',
      'Gear',
      'CLT1',
      'RadTemp',
      'AFR',
      'BatV',
      'VSS',
    ]) {
      const p = sensorPos(name)
      expect(p, name).not.toBeNull()
      for (const v of p!) expect(v >= 0 && v <= 1, name).toBe(true)
    }
  })

  it('prefers the spot the team saved', () => {
    expect(sensorPos('AccelX', [0.1, 0.9])).toEqual([0.1, 0.9])
    expect(sensorPos('mystery_7', [0.2, 0.3])).toEqual([0.2, 0.3])
    expect(placeOf({ name: 'AccelX', pos: [0.1, 0.9] })).toBe('placed by the team')
    expect(placeOf({ name: 'mystery_7' })).toMatch(/not on the car map/)
  })
})
