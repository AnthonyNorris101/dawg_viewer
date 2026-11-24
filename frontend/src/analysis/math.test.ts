import { describe, expect, it } from 'vitest'
import { computeAll, evaluate, parse, references, type EvalContext, type MathDef } from './math'

function ctx(cols: Record<string, number[]>, time?: number[]): EvalContext {
  const n = Object.values(cols)[0]?.length ?? time?.length ?? 0
  const t = new Float64Array(time ?? Array.from({ length: n }, (_, i) => i * 0.1))
  const m = new Map(Object.entries(cols).map(([k, v]) => [k, new Float64Array(v)]))
  return { n, time: t, get: (name) => m.get(name) }
}

const vals = (a: Float64Array, digits = 6) => [...a].map((v) => Number(v.toFixed(digits)))

describe('math expressions', () => {
  it('follows operator precedence', () => {
    const c = ctx({ A: [1, 2] })
    expect(vals(evaluate('1 + 2 * 3 ^ 2', c))).toEqual([19, 19])
    expect(vals(evaluate('-2 ^ 2', c))).toEqual([-4, -4])
    expect(vals(evaluate('2 ^ -1', c))).toEqual([0.5, 0.5])
    expect(vals(evaluate('(A + 1) * 2', c))).toEqual([4, 6])
    expect(vals(evaluate('A > 1 ? 10 : 20', c))).toEqual([20, 10])
    expect(vals(evaluate('A >= 1 && !(A == 2)', c))).toEqual([1, 0])
  })

  it('reads channel names in brackets and quotes', () => {
    const c = ctx({ 'Oil Pres': [40, 50], 'Damper.FL': [1, 2] })
    expect(vals(evaluate('[Oil Pres] / 10 + "Damper.FL"', c))).toEqual([5, 7])
    expect(vals(evaluate('Damper.FL * 2', c))).toEqual([2, 4])
  })

  it('has element-wise and time-series functions', () => {
    const c = ctx({ X: [3, 0, 4], Y: [4, 1, 3] }, [0, 1, 2])
    expect(vals(evaluate('hypot(X, Y)', c))).toEqual([5, 1, 5])
    expect(vals(evaluate('max(X, Y, 3.5)', c))).toEqual([4, 3.5, 4])
    expect(vals(evaluate('clamp(X, 1, 3)', c))).toEqual([3, 1, 3])
    expect(vals(evaluate('deriv(X)', c))).toEqual([-3, 0.5, 4])
    expect(vals(evaluate('integ(Y)', c))).toEqual([0, 2.5, 4.5])
    expect(vals(evaluate('if(X > Y, 1, 0)', c))).toEqual([0, 0, 1])
    expect(vals(evaluate('t * 2', c))).toEqual([0, 2, 4])
  })

  it('smooths over a time window', () => {
    const c = ctx({ X: [0, 0, 9, 0, 0] }, [0, 0.1, 0.2, 0.3, 0.4])
    expect(vals(evaluate('smooth(X, 0.2)', c))).toEqual([0, 3, 3, 3, 0])
  })

  it('reports helpful errors', () => {
    expect(() => parse('1 +')).toThrow('Unexpected end')
    expect(() => parse('foo(1)')).toThrow('Unknown function foo()')
    expect(() => parse('atan2(1)')).toThrow('atan2() takes 2 arguments')
    expect(() => parse('[Oil')).toThrow('Missing ]')
    expect(() => evaluate('Nope + 1', ctx({ A: [1] }))).toThrow('Unknown channel Nope')
  })

  it('lists the channels an expression uses', () => {
    expect([...references(parse('sqrt(AccelX^2 + [Accel Y]^2) * pi + t'))]).toEqual([
      'AccelX',
      'Accel Y',
    ])
  })
})

describe('computeAll', () => {
  const def = (id: string, name: string, expr: string): MathDef => ({
    id,
    name,
    expr,
    unit: '',
    precision: 2,
  })

  it('lets math channels use each other in any order', () => {
    const { results, errors } = computeAll(
      [def('b', 'Double', 'Half * 4'), def('a', 'Half', 'RPM / 2')],
      ctx({ RPM: [100, 200] }),
      new Set(['RPM']),
    )
    expect(errors.size).toBe(0)
    expect(vals(results.get('b')!.data)).toEqual([200, 400])
  })

  it('keeps working channels when others fail', () => {
    const { results, errors } = computeAll(
      [
        def('1', 'Good', 'RPM + 1'),
        def('2', 'Missing', 'Nope * 2'),
        def('3', 'RPM', '1'),
        def('4', 'Loop A', '[Loop B] + 1'),
        def('5', 'Loop B', '[Loop A] + 1'),
      ],
      ctx({ RPM: [1] }),
      new Set(['RPM']),
    )
    expect(vals(results.get('1')!.data)).toEqual([2])
    expect(errors.get('2')).toContain('Unknown channel Nope')
    expect(errors.get('3')).toContain('already a channel')
    expect(errors.get('4')).toContain('itself')
  })
})

describe('filter channels', () => {
  const rate = 200
  const time = Array.from({ length: 4000 }, (_, i) => i / rate)
  const tone = (hz: number) => time.map((t) => Math.sin(2 * Math.PI * hz * t))
  const slow = tone(0.5)
  const mid = tone(8)
  const fast = tone(60)
  const mix = time.map((_, i) => slow[i] + mid[i] + fast[i])
  const c = ctx({ 'Accel Z': mix }, time)
  const rms = (a: ArrayLike<number>, b: number[]) => {
    let s = 0
    for (let i = 1000; i < 3000; i++) s += (a[i] - b[i]) ** 2
    return Math.sqrt(s / 2000)
  }
  const run = (expr: string) => evaluate(parse(expr), c) as Float64Array

  it('keeps only the band asked for', () => {
    expect(rms(run('bandpass([Accel Z], 3, 20)'), mid)).toBeLessThan(0.05)
    expect(rms(run('bandpass([Accel Z], 3, 20, 3)'), mid)).toBeLessThan(0.05)
  })

  it('removes a band and leaves the rest', () => {
    const want = time.map((_, i) => slow[i] + fast[i])
    expect(rms(run('bandstop([Accel Z], 3, 20)'), want)).toBeLessThan(0.08)
  })

  it('shapes the spectrum point by point and can add a band back', () => {
    expect(rms(run('shape([Accel Z], 2, 0, 4, 1, 20, 1, 30, 0)'), mid)).toBeLessThan(0.03)
    const back = run('shape([Accel Z], 0.1, 1, 0.6, 1, 2, 0, 4, 1, 20, 1, 30, 0)')
    expect(
      rms(
        back,
        time.map((_, i) => slow[i] + mid[i]),
      ),
    ).toBeLessThan(0.05)
    expect(() => run('shape([Accel Z], 5, 1, 2, 0)')).toThrow(/go up/)
    expect(() => run('shape([Accel Z], 5, 1, 2)')).toThrow(/pairs/)
  })

  it('stacks stages for a steeper cut', () => {
    const one = rms(
      run('lowpass([Accel Z], 20)'),
      time.map((_, i) => slow[i] + mid[i]),
    )
    const four = rms(
      run('lowpass([Accel Z], 20, 4)'),
      time.map((_, i) => slow[i] + mid[i]),
    )
    expect(four).toBeLessThan(one)
    expect(() => run('lowpass([Accel Z], 20, 9)')).toThrow(/1 to 4/)
    expect(() => run('bandpass([Accel Z], 20, 3)')).toThrow(/below the high/)
  })
})
