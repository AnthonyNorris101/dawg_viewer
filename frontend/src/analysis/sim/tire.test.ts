import { describe, expect, it } from 'vitest'
import { DEFAULT_CAR } from '../../data/car'
import { buildLimits, cornering, G, handling } from './grip'
import {
  combinedEnvelope,
  DEG,
  envelopeAt,
  latCurve,
  latPeak,
  lonCurve,
  lonPeak,
  magic,
  MAX_SLIP_ANGLE,
  MAX_SLIP_RATIO,
  parseTir,
  peakSlip,
  slipFor,
  tireOf,
} from './tire'

const tire = tireOf(DEFAULT_CAR)
const quarter = (DEFAULT_CAR.mass * G) / 4

describe('Magic Formula tire', () => {
  it('starts with the cornering stiffness and peaks at D', () => {
    const cv = latCurve(tire, quarter)
    expect(magic(cv, 1e-6) / 1e-6).toBeCloseTo(cv.k, 0)
    expect(cv.b * cv.c * cv.d).toBeCloseTo(cv.k, 6)
    const at = peakSlip(cv, MAX_SLIP_ANGLE)
    expect(magic(cv, at)).toBeCloseTo(cv.d, 3)
    expect(magic(cv, at * 0.8)).toBeLessThan(cv.d)
    expect(magic(cv, at * 1.3)).toBeLessThan(cv.d)
    expect(at / DEG).toBeGreaterThan(5)
    expect(at / DEG).toBeLessThan(14)
    expect(peakSlip(lonCurve(tire, quarter), MAX_SLIP_RATIO)).toBeGreaterThan(0.06)
    expect(peakSlip(lonCurve(tire, quarter), MAX_SLIP_RATIO)).toBeLessThan(0.2)
  })

  it('takes peak grip and load sensitivity from the simple car values', () => {
    expect(latPeak(tire, quarter)).toBeCloseTo(DEFAULT_CAR.tireMu * quarter, 6)
    expect(lonPeak(tire, quarter)).toBeCloseTo(DEFAULT_CAR.tireMu * quarter, 6)
    expect(latPeak(tire, 2 * quarter)).toBeCloseTo(
      DEFAULT_CAR.tireMu * DEFAULT_CAR.tireLoadGrip * 2 * quarter,
      6,
    )
    expect(latPeak(tire, 0)).toBe(0)
  })

  it('lets typed coefficients replace the simple values', () => {
    const car = { ...DEFAULT_CAR, tire: { pdy1: 1.8, pdy2: -0.3, fnomin: 1000, pcy1: 1.3 } }
    const t = tireOf(car)
    expect(latPeak(t, 1000)).toBeCloseTo(1800, 6)
    expect(latPeak(t, 1500)).toBeCloseTo((1.8 - 0.15) * 1500, 6)
    expect(cornering(car, 0).ay).not.toBeCloseTo(cornering(DEFAULT_CAR, 0).ay, 2)
    for (const fz of [400, quarter, 1300]) expect(lonPeak(t, fz)).toBeCloseTo(lonPeak(tire, fz), 6)
    const rated = tireOf({ ...DEFAULT_CAR, tire: { fnomin: 1110 } })
    for (const fz of [400, quarter, 1300])
      expect(latPeak(rated, fz)).toBeCloseTo(latPeak(tire, fz), 6)
    const flat = tireOf({ ...DEFAULT_CAR, tire: { pcy1: 0.9 } })
    expect(latPeak(flat, quarter)).toBeLessThan(latPeak(tire, quarter))
  })

  it('finds the slip angle that gives a force', () => {
    const cv = latCurve(tire, quarter)
    const a = slipFor(cv, 0.5 * cv.d, MAX_SLIP_ANGLE)
    expect(magic(cv, a)).toBeCloseTo(0.5 * cv.d, 3)
    expect(slipFor(cv, 2 * cv.d, MAX_SLIP_ANGLE)).toBeCloseTo(peakSlip(cv, MAX_SLIP_ANGLE), 6)
  })

  it('trades cornering for drive along a combined-slip envelope', () => {
    const env = combinedEnvelope(tire)
    expect(env[0]).toBeCloseTo(1, 2)
    expect(env[env.length - 1]).toBe(0)
    for (let i = 1; i < env.length; i++) expect(env[i]).toBeLessThanOrEqual(env[i - 1] + 1e-12)
    expect(envelopeAt(env, 0.5)).toBeGreaterThan(0.6)
    expect(envelopeAt(env, 0.5)).toBeLessThan(1)
    expect(envelopeAt(env, 0.9)).toBeGreaterThan(0.15)
    expect(envelopeAt(env, 0.9)).toBeLessThan(0.75)
    expect(buildLimits(DEFAULT_CAR).envelope.length).toBe(env.length)
  })

  it('reports slip angles and the understeer gradient', () => {
    const ay = cornering(DEFAULT_CAR, 10).ay
    const h = handling(DEFAULT_CAR, 10, ay)
    expect(h.slipFront).toBeGreaterThan(3)
    expect(h.slipFront).toBeLessThan(MAX_SLIP_ANGLE / DEG)
    expect(h.slipRear).toBeGreaterThan(3)
    const noseHeavy = handling({ ...DEFAULT_CAR, rearWeight: 0.4 }, 10, ay * 0.5)
    const tailHeavy = handling({ ...DEFAULT_CAR, rearWeight: 0.6 }, 10, ay * 0.5)
    expect(noseHeavy.understeer).toBeGreaterThan(tailHeavy.understeer)
    expect(handling(DEFAULT_CAR, 10, ay * 0.3).slipFront).toBeLessThan(h.slipFront)
  })

  it('reads an MF 5.2 .tir file', () => {
    const file = [
      '[UNITS]',
      "FORCE = 'newton'",
      '[VERTICAL]',
      'FNOMIN = 1100 $Nominal wheel load',
      '[SCALING_COEFFICIENTS]',
      'LMUY = 0.66',
      '[LATERAL_COEFFICIENTS]',
      'PCY1 = 1.45 $Shape factor',
      'PDY1 = -2.5',
      'PDY2 = 0.4',
      'PEY1 = 0.3',
      'PKY1 = -55.0',
      'PKY2 = 2.1',
      '[LONGITUDINAL_COEFFICIENTS]',
      'PCX1 = 1.6',
      'PDX1 = 2.6',
      'PDX2 = -0.5',
      'PKX1 = 60',
      'RBX1 = 13',
    ].join('\n')
    const r = parseTir(file)
    if (typeof r === 'string') throw new Error(r)
    expect(r.coeffs.fnomin).toBe(1100)
    expect(r.coeffs.pdy1).toBeCloseTo(2.5 * 0.66, 9)
    expect(r.coeffs.pdy2).toBeCloseTo(-0.4 * 0.66, 9)
    expect(r.coeffs.pky1).toBe(55)
    expect(r.coeffs.pdx1).toBe(2.6)
    expect(r.coeffs.pdx2).toBe(-0.5)
    expect(r.coeffs.rbx1).toBeUndefined()
    expect(r.note).toContain('combined slip keep')
    expect(typeof parseTir('hello = world\nMASS = 3')).toBe('string')
  })
  it('reads a MATLAB tire model and matches its peak force and stiffness', () => {
    const file = [
      'function FY = TireModel(SA,FZ,P,IA)',
      '% Lateral Coefficients',
      'PCY1 = 1.47938;',
      'PDY1 = 2.30264; PDY2 = -0.181517; PDY3 = 12.2537;',
      'PEY1 = 0.258174; PEY2 = 0.134876; PEY3 = 0.964615;',
      'PKY1 = 33.3683; PKY2 = 3.92018; PKY3 = 0.963332;',
      'PKY4 = 5.07208; PKY5 = 49.6379;',
      'FNOMIN = 1110;              ',
      'NOMPRES = 14 * 6894.76;',
      'LFZO=1; LCY=1; LMUY=0.66; LKY=1; LKYC=1;',
      'FZ = max(FZ, 50);',
    ].join('\n')
    const r = parseTir(file)
    if (typeof r === 'string') throw new Error(r)
    expect(r.coeffs.pky4).toBe(5.07208)
    expect(r.coeffs.pdy1).toBeCloseTo(2.30264 * 0.66, 9)
    expect(r.coeffs.pcx1).toBeUndefined()
    const t = tireOf({ ...DEFAULT_CAR, tire: r.coeffs as Record<string, number> })
    for (const fz of [400, 1110, 1400]) {
      const dfz = (fz - 1110) / 1110
      const d = (2.30264 - 0.181517 * dfz) * 0.66 * fz
      const k = 33.3683 * 1110 * Math.sin(5.07208 * Math.atan(fz / 1110 / 3.92018))
      expect(latPeak(t, fz)).toBeCloseTo(d, 6)
      expect(latCurve(t, fz).k).toBeCloseTo(k, 6)
    }
  })

  it('leaves out unfitted drive coefficients and stays inside the tested slip range', () => {
    const file = [
      '[LONG_SLIP_RANGE]',
      'KPUMIN = 0',
      'KPUMAX = 0',
      '[SLIP_ANGLE_RANGE]',
      'ALPMIN = -0.2153',
      'ALPMAX = 0.2156',
      'FNOMIN = 690',
      'LMUY = 0.66',
      'PCX1 = 1.579',
      'PDX1 = 1.0422',
      'PKX1 = 21.687',
      'RBX1 = 13.046',
      'RCX1 = 0.9995',
      'RBY1 = 10.622',
      'RCY1 = 1.0587',
      'PCY1 = 0.88428',
      'PDY1 = 3.01714',
      'PDY2 = -0.01895',
      'PEY1 = -0.1578',
      'PEY3 = -8.64125',
      'PKY1 = -51.94',
      'PKY2 = 2.43303',
      'PKY4 = 2.20743',
      'PVY1 = 0.3974',
    ].join('\n')
    const r = parseTir(file)
    if (typeof r === 'string') throw new Error(r)
    expect(r.coeffs.pdx1).toBeUndefined()
    expect(r.coeffs.rbx1).toBeUndefined()
    expect(r.coeffs.alpmax).toBe(0.2153)
    expect(r.note).toContain('template values')
    expect(r.note).toContain('never peaks')
    expect(r.note).toContain('lopsided')
    const t = tireOf({ ...DEFAULT_CAR, tire: r.coeffs as Record<string, number> })
    const cv = latCurve(t, 690)
    expect(latPeak(t, 690)).toBeCloseTo(magic(cv, 0.2153), 6)
    expect(latPeak(t, 690)).toBeLessThan(cv.d)
  })
})
