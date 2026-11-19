import { stageSpread } from './filters'
import { biquad, shapeFilter, type GainPoint } from './spectrum'

export interface MathDef {
  id: string
  name: string
  expr: string
  unit: string
  precision: number
}

export class MathError extends Error {
  constructor(
    message: string,
    readonly pos = -1,
  ) {
    super(message)
  }
}

type Node =
  | { k: 'num'; v: number }
  | { k: 'id'; name: string; pos: number }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'if'; c: Node; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[]; pos: number }

interface Token {
  t: 'num' | 'id' | 'name' | 'op' | 'end'
  v: string
  pos: number
}

const OPS = [
  '**',
  '<=',
  '>=',
  '==',
  '!=',
  '&&',
  '||',
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '<',
  '>',
  '!',
  '(',
  ')',
  ',',
  '?',
  ':',
]

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    const num = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))
    if (num) {
      out.push({ t: 'num', v: num[0], pos: i })
      i += num[0].length
      continue
    }
    const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i))
    if (id) {
      out.push({ t: 'id', v: id[0], pos: i })
      i += id[0].length
      continue
    }
    if (c === '[' || c === '"') {
      const close = c === '[' ? ']' : '"'
      const end = src.indexOf(close, i + 1)
      if (end < 0) throw new MathError(`Missing ${close}`, i)
      out.push({ t: 'name', v: src.slice(i + 1, end).trim(), pos: i })
      i = end + 1
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new MathError(`Unexpected "${c}"`, i)
    out.push({ t: 'op', v: op, pos: i })
    i += op.length
  }
  out.push({ t: 'end', v: '', pos: src.length })
  return out
}

export function parse(src: string): Node {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const isOp = (...ops: string[]) => peek().t === 'op' && ops.includes(peek().v)
  const expect = (op: string) => {
    if (!isOp(op)) throw new MathError(`Expected "${op}"`, peek().pos)
    p++
  }

  const ternary = (): Node => {
    const c = or()
    if (!isOp('?')) return c
    p++
    const a = ternary()
    expect(':')
    const b = ternary()
    return { k: 'if', c, a, b }
  }
  const left = (next: () => Node, ops: string[]) => (): Node => {
    let a = next()
    while (isOp(...ops)) {
      const op = toks[p++].v
      a = { k: 'bin', op, a, b: next() }
    }
    return a
  }
  const unary = (): Node => {
    if (isOp('-', '+', '!')) {
      const op = toks[p++].v
      const a = unary()
      return op === '+' ? a : { k: 'un', op, a }
    }
    return power()
  }
  const power = (): Node => {
    const a = primary()
    if (isOp('^', '**')) {
      p++
      return { k: 'bin', op: '^', a, b: unary() }
    }
    return a
  }
  const mul = left(unary, ['*', '/', '%'])
  const add = left(mul, ['+', '-'])
  const cmp = left(add, ['<', '>', '<=', '>=', '==', '!='])
  const and = left(cmp, ['&&'])
  const or = left(and, ['||'])

  function primary(): Node {
    const tok = peek()
    if (tok.t === 'num') {
      p++
      return { k: 'num', v: Number(tok.v) }
    }
    if (tok.t === 'name') {
      p++
      return { k: 'id', name: tok.v, pos: tok.pos }
    }
    if (tok.t === 'id') {
      p++
      if (isOp('(')) {
        p++
        const args: Node[] = []
        if (!isOp(')')) {
          for (;;) {
            args.push(ternary())
            if (!isOp(',')) break
            p++
          }
        }
        expect(')')
        const fn = tok.v.toLowerCase()
        if (!(fn in FUNCS)) throw new MathError(`Unknown function ${tok.v}()`, tok.pos)
        const [lo, hi] = FUNCS[fn].arity
        if (args.length < lo || args.length > hi) {
          const want = lo === hi ? `${lo}` : hi === Infinity ? `at least ${lo}` : `${lo}–${hi}`
          throw new MathError(`${tok.v}() takes ${want} argument${hi === 1 ? '' : 's'}`, tok.pos)
        }
        return { k: 'call', fn, args, pos: tok.pos }
      }
      return { k: 'id', name: tok.v, pos: tok.pos }
    }
    if (isOp('(')) {
      p++
      const e = ternary()
      expect(')')
      return e
    }
    throw new MathError(tok.t === 'end' ? 'Unexpected end' : `Unexpected "${tok.v}"`, tok.pos)
  }

  if (peek().t === 'end') throw new MathError('Empty expression', 0)
  const root = ternary()
  if (peek().t !== 'end') throw new MathError(`Unexpected "${peek().v}"`, peek().pos)
  return root
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, g0: 9.80665 }

export function references(node: Node, out = new Set<string>()): Set<string> {
  switch (node.k) {
    case 'id':
      if (!(node.name.toLowerCase() in CONSTANTS) && node.name !== 't') out.add(node.name)
      break
    case 'un':
      references(node.a, out)
      break
    case 'bin':
      references(node.a, out)
      references(node.b, out)
      break
    case 'if':
      references(node.c, out)
      references(node.a, out)
      references(node.b, out)
      break
    case 'call':
      for (const a of node.args) references(a, out)
      break
  }
  return out
}

export interface EvalContext {
  n: number
  time: Float64Array
  get(name: string): Float64Array | undefined
}

type Val = number | Float64Array

const at = (v: Val, i: number) => (typeof v === 'number' ? v : v[i])

function map1(v: Val, n: number, f: (x: number) => number): Val {
  if (typeof v === 'number') return f(v)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = f(v[i])
  return out
}

function mapN(vs: Val[], n: number, f: (xs: number[]) => number): Val {
  if (vs.every((v) => typeof v === 'number')) return f(vs as number[])
  const out = new Float64Array(n)
  const xs = new Array<number>(vs.length)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < vs.length; j++) xs[j] = at(vs[j], i)
    out[i] = f(xs)
  }
  return out
}

function column(v: Val, n: number): Float64Array {
  return typeof v === 'number' ? new Float64Array(n).fill(v) : v
}

const b = (x: boolean) => (x ? 1 : 0)
const truthy = (x: number) => x !== 0 && !Number.isNaN(x)

const BINARY: Record<string, (x: number, y: number) => number> = {
  '+': (x, y) => x + y,
  '-': (x, y) => x - y,
  '*': (x, y) => x * y,
  '/': (x, y) => x / y,
  '%': (x, y) => x % y,
  '^': (x, y) => x ** y,
  '<': (x, y) => b(x < y),
  '>': (x, y) => b(x > y),
  '<=': (x, y) => b(x <= y),
  '>=': (x, y) => b(x >= y),
  '==': (x, y) => b(x === y),
  '!=': (x, y) => b(x !== y),
  '&&': (x, y) => b(truthy(x) && truthy(y)),
  '||': (x, y) => b(truthy(x) || truthy(y)),
}

function seconds(v: Val, what: string): number {
  if (typeof v !== 'number') throw new MathError(`${what} must be a number of seconds`)
  return Math.max(0, v)
}

function samplesFor(s: number, time: Float64Array): number {
  const n = time.length
  if (n < 2) return 0
  const dt = (time[n - 1] - time[0]) / (n - 1)
  return dt > 0 ? Math.round(s / dt) : 0
}

function deriv(x: Float64Array, time: Float64Array): Float64Array {
  const n = x.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1)
    const c = Math.min(n - 1, i + 1)
    const dt = time[c] - time[a]
    out[i] = dt > 0 ? (x[c] - x[a]) / dt : 0
  }
  return out
}

function integ(x: Float64Array, time: Float64Array): Float64Array {
  const n = x.length
  const out = new Float64Array(n)
  for (let i = 1; i < n; i++) {
    const v = ((x[i] + x[i - 1]) / 2) * (time[i] - time[i - 1])
    out[i] = out[i - 1] + (Number.isFinite(v) ? v : 0)
  }
  return out
}

function smooth(x: Float64Array, w: number): Float64Array {
  const n = x.length
  if (w < 1) return x.slice()
  const sum = new Float64Array(n + 1)
  const cnt = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    const ok = Number.isFinite(x[i])
    sum[i + 1] = sum[i] + (ok ? x[i] : 0)
    cnt[i + 1] = cnt[i] + (ok ? 1 : 0)
  }
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - w)
    const hi = Math.min(n, i + w + 1)
    const c = cnt[hi] - cnt[lo]
    out[i] = c > 0 ? (sum[hi] - sum[lo]) / c : NaN
  }
  return out
}

function delay(x: Float64Array, k: number): Float64Array {
  const n = x.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = x[Math.max(0, Math.min(n - 1, i - k))]
  return out
}

function stagesOf(v: Val | undefined, name: string): number {
  if (v === undefined) return 1
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 4) {
    throw new MathError(`${name}() steepness must be a whole number from 1 to 4`)
  }
  return v
}

function filter(
  x: Val,
  hz: Val,
  ctx: EvalContext,
  kind: 'low' | 'high',
  stages = 1,
  name = `${kind}pass`,
): Float64Array {
  if (typeof hz !== 'number' || !(hz > 0)) {
    throw new MathError(`${name}() cutoff must be a number of Hz above 0`)
  }
  const n = ctx.time.length
  const rate = n > 1 ? (n - 1) / (ctx.time[n - 1] - ctx.time[0]) : 0
  if (hz >= rate / 2) {
    throw new MathError(`${name}() cutoff must be below ${(rate / 2).toFixed(1)} Hz for this log`)
  }
  const k = stageSpread(stages)
  const each = Math.min(kind === 'low' ? hz / k : hz * k, rate * 0.45)
  let out = column(x, ctx.n)
  for (let s = 0; s < stages; s++) out = biquad(out, rate, each, kind)
  return out
}

function band(x: Val, lo: Val, hi: Val, ctx: EvalContext, stages: number, name: string) {
  if (typeof lo !== 'number' || typeof hi !== 'number' || !(lo < hi)) {
    throw new MathError(`${name}() needs a low cutoff below the high cutoff`)
  }
  return filter(filter(x, lo, ctx, 'high', stages, name), hi, ctx, 'low', stages, name)
}

interface Func {
  arity: [number, number]
  help: string
  run(args: Val[], ctx: EvalContext): Val
}

const elementwise = (f: (x: number) => number, help: string): Func => ({
  arity: [1, 1],
  help,
  run: ([x], ctx) => map1(x, ctx.n, f),
})

export const FUNCS: Record<string, Func> = {
  abs: elementwise(Math.abs, 'abs(x) absolute value'),
  sqrt: elementwise(Math.sqrt, 'sqrt(x)'),
  exp: elementwise(Math.exp, 'exp(x)'),
  ln: elementwise(Math.log, 'ln(x) natural log'),
  log: elementwise(Math.log, 'log(x) natural log'),
  log10: elementwise(Math.log10, 'log10(x)'),
  sin: elementwise(Math.sin, 'sin(x) radians'),
  cos: elementwise(Math.cos, 'cos(x) radians'),
  tan: elementwise(Math.tan, 'tan(x) radians'),
  asin: elementwise(Math.asin, 'asin(x)'),
  acos: elementwise(Math.acos, 'acos(x)'),
  atan: elementwise(Math.atan, 'atan(x)'),
  floor: elementwise(Math.floor, 'floor(x)'),
  ceil: elementwise(Math.ceil, 'ceil(x)'),
  round: elementwise(Math.round, 'round(x)'),
  sign: elementwise(Math.sign, 'sign(x) −1, 0 or 1'),
  rad: elementwise((x) => (x * Math.PI) / 180, 'rad(x) degrees to radians'),
  deg: elementwise((x) => (x * 180) / Math.PI, 'deg(x) radians to degrees'),
  atan2: {
    arity: [2, 2],
    help: 'atan2(y, x)',
    run: (args, ctx) => mapN(args, ctx.n, ([y, x]) => Math.atan2(y, x)),
  },
  pow: {
    arity: [2, 2],
    help: 'pow(x, y)',
    run: (args, ctx) => mapN(args, ctx.n, ([x, y]) => x ** y),
  },
  min: {
    arity: [2, Infinity],
    help: 'min(a, b, …)',
    run: (args, ctx) => mapN(args, ctx.n, (xs) => Math.min(...xs)),
  },
  max: {
    arity: [2, Infinity],
    help: 'max(a, b, …)',
    run: (args, ctx) => mapN(args, ctx.n, (xs) => Math.max(...xs)),
  },
  hypot: {
    arity: [2, Infinity],
    help: 'hypot(a, b, …) √(a²+b²+…)',
    run: (args, ctx) => mapN(args, ctx.n, (xs) => Math.hypot(...xs)),
  },
  clamp: {
    arity: [3, 3],
    help: 'clamp(x, lo, hi)',
    run: (args, ctx) => mapN(args, ctx.n, ([x, lo, hi]) => Math.min(hi, Math.max(lo, x))),
  },
  if: {
    arity: [3, 3],
    help: 'if(cond, a, b)',
    run: (args, ctx) => mapN(args, ctx.n, ([c, x, y]) => (truthy(c) ? x : y)),
  },
  deriv: {
    arity: [1, 1],
    help: 'deriv(x) rate of change per second',
    run: ([x], ctx) => deriv(column(x, ctx.n), ctx.time),
  },
  integ: {
    arity: [1, 1],
    help: 'integ(x) running integral over time',
    run: ([x], ctx) => integ(column(x, ctx.n), ctx.time),
  },
  smooth: {
    arity: [1, 2],
    help: 'smooth(x, s) moving average over s seconds (default 0.1)',
    run: ([x, s], ctx) => {
      const w = samplesFor(s === undefined ? 0.1 : seconds(s, 'smooth() width'), ctx.time)
      return smooth(column(x, ctx.n), Math.floor(w / 2))
    },
  },
  delay: {
    arity: [2, 2],
    help: 'delay(x, s) shift later by s seconds (negative = earlier)',
    run: ([x, s], ctx) => {
      if (typeof s !== 'number') throw new MathError('delay() time must be a number of seconds')
      const k = Math.sign(s) * samplesFor(Math.abs(s), ctx.time)
      return delay(column(x, ctx.n), k)
    },
  },
  lowpass: {
    arity: [2, 3],
    help: 'lowpass(x, hz, steep?) removes noise above hz (zero-phase Butterworth; steep 1-4 stacks it)',
    run: ([x, hz, st], ctx) => filter(x, hz, ctx, 'low', stagesOf(st, 'lowpass')),
  },
  highpass: {
    arity: [2, 3],
    help: 'highpass(x, hz, steep?) removes slow changes below hz',
    run: ([x, hz, st], ctx) => filter(x, hz, ctx, 'high', stagesOf(st, 'highpass')),
  },
  bandpass: {
    arity: [3, 4],
    help: 'bandpass(x, lo, hi, steep?) keeps only lo-hi Hz',
    run: ([x, lo, hi, st], ctx) => band(x, lo, hi, ctx, stagesOf(st, 'bandpass'), 'bandpass'),
  },
  shape: {
    arity: [3, 41],
    help: 'shape(x, hz1, keep1, hz2, keep2, …) keeps each frequency by the fraction given, straight lines between (log Hz)',
    run: ([x, ...rest], ctx) => {
      if (rest.length % 2 !== 0) {
        throw new MathError('shape() takes pairs of frequency and keep fraction after the channel')
      }
      const points: GainPoint[] = []
      for (let i = 0; i < rest.length; i += 2) {
        const f = rest[i]
        const g = rest[i + 1]
        if (typeof f !== 'number' || typeof g !== 'number' || !(f > 0) || !(g >= 0)) {
          throw new MathError('shape() frequencies must be above 0 Hz and keep fractions 0 or more')
        }
        if (points.length && f <= points[points.length - 1][0]) {
          throw new MathError('shape() frequencies must go up from left to right')
        }
        points.push([f, g])
      }
      const n = ctx.time.length
      const rate = n > 1 ? (n - 1) / (ctx.time[n - 1] - ctx.time[0]) : 0
      return shapeFilter(column(x, ctx.n), rate, points)
    },
  },
  bandstop: {
    arity: [3, 4],
    help: 'bandstop(x, lo, hi, steep?) removes lo-hi Hz (e.g. one vibration)',
    run: ([x, lo, hi, st], ctx) => {
      const keep = band(x, lo, hi, ctx, stagesOf(st, 'bandstop'), 'bandstop')
      const src = column(x, ctx.n)
      return src.map((v, i) => v - keep[i])
    },
  },
  mean: {
    arity: [1, 1],
    help: 'mean(x) average over the whole log',
    run: ([x]) => {
      if (typeof x === 'number') return x
      let s = 0
      let c = 0
      for (const v of x)
        if (Number.isFinite(v)) {
          s += v
          c++
        }
      return c ? s / c : NaN
    },
  },
}

function evalNode(node: Node, ctx: EvalContext): Val {
  switch (node.k) {
    case 'num':
      return node.v
    case 'id': {
      const col = ctx.get(node.name)
      if (col) return col
      if (node.name === 't') return ctx.time
      const c = CONSTANTS[node.name.toLowerCase()]
      if (c !== undefined) return c
      throw new MathError(`Unknown channel ${node.name}`, node.pos)
    }
    case 'un': {
      const a = evalNode(node.a, ctx)
      return map1(a, ctx.n, node.op === '-' ? (x) => -x : (x) => b(!truthy(x)))
    }
    case 'bin': {
      const f = BINARY[node.op]
      const x = evalNode(node.a, ctx)
      const y = evalNode(node.b, ctx)
      return mapN([x, y], ctx.n, ([p, q]) => f(p, q))
    }
    case 'if':
      return FUNCS.if.run(
        [evalNode(node.c, ctx), evalNode(node.a, ctx), evalNode(node.b, ctx)],
        ctx,
      )
    case 'call':
      return FUNCS[node.fn].run(
        node.args.map((a) => evalNode(a, ctx)),
        ctx,
      )
  }
}

export function evaluate(src: string | Node, ctx: EvalContext): Float64Array {
  const node = typeof src === 'string' ? parse(src) : src
  return column(evalNode(node, ctx), ctx.n)
}

export interface MathResult {
  name: string
  data: Float64Array
}

export function computeAll(
  defs: MathDef[],
  base: EvalContext,
  baseNames: Set<string>,
): { results: Map<string, MathResult>; errors: Map<string, string> } {
  const results = new Map<string, MathResult>()
  const errors = new Map<string, string>()
  const computed = new Map<string, Float64Array>()
  const parsed = new Map<string, { node: Node; refs: Set<string> }>()

  const names = new Set<string>()
  for (const d of defs) {
    const name = d.name.trim()
    if (!name) {
      errors.set(d.id, 'Give the channel a name')
      continue
    }
    if (baseNames.has(name)) {
      errors.set(d.id, `"${name}" is already a channel in this log`)
      continue
    }
    if (names.has(name)) {
      errors.set(d.id, `Another math channel is called "${name}"`)
      continue
    }
    names.add(name)
    try {
      const node = parse(d.expr)
      parsed.set(d.id, { node, refs: references(node) })
    } catch (e) {
      errors.set(d.id, e instanceof Error ? e.message : String(e))
    }
  }

  const ctx: EvalContext = {
    n: base.n,
    time: base.time,
    get: (name) => computed.get(name) ?? base.get(name),
  }
  const pending = defs.filter((d) => parsed.has(d.id))
  let progress = true
  while (pending.length > 0 && progress) {
    progress = false
    for (let i = 0; i < pending.length; i++) {
      const d = pending[i]
      const { node, refs } = parsed.get(d.id)!
      const waiting = [...refs].some((r) => !ctx.get(r) && names.has(r) && !computed.has(r))
      if (waiting) continue
      pending.splice(i--, 1)
      progress = true
      try {
        const data = evaluate(node, ctx)
        computed.set(d.name.trim(), data)
        results.set(d.id, { name: d.name.trim(), data })
      } catch (e) {
        errors.set(d.id, e instanceof Error ? e.message : String(e))
      }
    }
  }
  for (const d of pending) errors.set(d.id, 'Uses itself through another math channel')
  return { results, errors }
}

export const FUNCTION_HELP = Object.values(FUNCS).map((f) => f.help)
