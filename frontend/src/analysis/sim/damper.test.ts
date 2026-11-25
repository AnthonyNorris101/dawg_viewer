import { describe, expect, it } from 'vitest'
import { DEFAULT_CAR } from '../../data/car'
import { axleOf, criticalDamping, dampingRatio, forceAt, parseShockDyno } from './damper'
import { withOverrides, PRESSURE_KEY } from './sweep'
import { latCurve, latPeak, tireOf } from './tire'

const HEAD =
  'Shock,SweptAdjuster,Setting,Lever,LSR,HSR,LSC,HSC,Note,TestSpeed_ips,Velocity_ips,Comp_lb,Rebound_lb,SourceFile'
const row = (shock: string, setting: string, test: number, v: number, comp: number, reb: number) =>
  `${shock},All 0,${setting},Open,4,0,8,0,,${test},${v},${comp},${reb},x.pdf`

const file = [
  'Workbook export',
  HEAD,
  row('G26 RF', 'Open 4-0-8-0', 1, 0, 12, 12),
  row('G26 RF', 'Open 4-0-8-0', 1, 0.5, 20, 0),
  row('G26 RF', 'Open 4-0-8-0', 1, 1, 32, -18),
  'G26 RF,All 0,Open 4-0-8-0,Open,4,0,8,0,,1,1.25,,,x.pdf',
  row('G26 RF', 'Open 4-0-8-0', 4, 0, 12, 12),
  row('G26 RF', 'Open 4-0-8-0', 4, 4, 62, -78),
  row('G26 RR', 'Open 0-0-0-0', 1, 0, 10, 10),
  row('G26 RR', 'Open 0-0-0-0', 1, 1, 15, -20),
].join('\n')

describe('shock dyno data', () => {
  it('reads peak-velocity points with the gas force taken out', () => {
    const data = parseShockDyno(file)
    if (typeof data === 'string') throw new Error(data)
    expect(data.map((d) => d.shock)).toEqual(['G26 RF', 'G26 RR'])
    const rf = data[0]
    expect(rf.clicks).toEqual({ lsr: 4, hsr: 0, lsc: 8, hsc: 0 })
    expect(rf.gas).toBeCloseTo(12 * 4.4482216, 6)
    expect(rf.points).toHaveLength(2)
    expect(rf.points[0].v).toBeCloseTo(0.0254, 9)
    expect(rf.points[0].comp).toBeCloseTo(20 * 4.4482216, 6)
    expect(rf.points[0].reb).toBeCloseTo(30 * 4.4482216, 6)
    expect(forceAt(rf, 0.0127).comp).toBeCloseTo(10 * 4.4482216, 6)
    expect(forceAt(rf, 0.0635).reb).toBeCloseTo(60 * 4.4482216, 6)
    expect(typeof parseShockDyno('a,b\n1,2')).toBe('string')
  })

  it('turns a damper force into a damping ratio at the wheel', () => {
    const data = parseShockDyno(file)
    if (typeof data === 'string') throw new Error(data)
    const car = { ...DEFAULT_CAR, springFront: 57.12, motionFront: 0.5917, mass: 277 }
    const critical = criticalDamping(car, 'front')
    const sprung = (277 * (1 - car.rearWeight)) / 2 - car.unsprungFront
    expect(critical).toBeCloseTo(2 * Math.sqrt(57120 * 0.5917 ** 2 * sprung), 6)
    const z = dampingRatio(car, 'front', data[0], 0.0254)
    const c = (20 * 4.4482216) / 0.0254
    expect(z.comp).toBeCloseTo((c * 0.5917 ** 2) / critical, 9)
    expect(z.reb / z.comp).toBeCloseTo(1.5, 9)
    expect(axleOf('G26 RF')).toBe('front')
    expect(axleOf('G26 RR')).toBe('rear')
    expect(axleOf('G25 LR')).toBe('rear')
  })
})

describe('tire pressure', () => {
  it('changes cornering grip and stiffness only when the tire has pressure terms', () => {
    const plain = withOverrides(DEFAULT_CAR, { [PRESSURE_KEY]: 10 })
    expect(latPeak(tireOf(plain), 700)).toBeCloseTo(latPeak(tireOf(DEFAULT_CAR), 700), 9)
    const fitted = {
      ...DEFAULT_CAR,
      tire: { nompres: 14 * 6894.76, ppy1: 0.29, ppy2: 0.97, ppy3: -0.19, ppy4: 0.19 },
    }
    const base = tireOf(fitted)
    const low = tireOf(withOverrides(fitted, { [PRESSURE_KEY]: 12 }))
    const dpi = (12 - 14) / 14
    expect(latPeak(low, 700) / latPeak(base, 700)).toBeCloseTo(1 - 0.19 * dpi + 0.19 * dpi * dpi, 6)
    expect(latCurve(low, 700).k).not.toBeCloseTo(latCurve(base, 700).k, 0)
  })
})
