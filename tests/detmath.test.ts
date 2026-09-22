// Deterministic math (src/engine/math/detmath.ts): accuracy against the host
// Math.* (V8 here) and exact reproducibility against checked-in known-answer
// vectors (bit patterns), so any change to the implementation is caught.

import { describe, expect, it } from 'vitest';
import * as dm from '@/engine/math/detmath';
import { makeRng } from '@/engine/rng';

const view = new DataView(new ArrayBuffer(8));
const bits = (x: number): bigint => { view.setFloat64(0, x); return view.getBigUint64(0); };
const hex = (x: number): string => bits(x).toString(16).padStart(16, '0');

/** Distance in units in the last place (monotone mapping of doubles to integers). */
function ulps(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b) ? 0 : Infinity;
  if (Object.is(a, b)) return 0;
  const key = (x: number): bigint => { const u = bits(x); return u >> 63n ? -(u & 0x7fffffffffffffffn) : u; };
  const d = key(a) - key(b);
  return Number(d < 0n ? -d : d);
}

const rng = makeRng(0x5eed);
const uniform = (lo: number, hi: number): number => lo + (hi - lo) * rng();
/** Random double with a random exponent in [2^e0, 2^e1), random sign if `signed`. */
function logUniform(e0: number, e1: number, signed = false): number {
  const x = Math.pow(2, uniform(e0, e1));
  return signed && rng() < 0.5 ? -x : x;
}

interface Stats { n: number; exact: number; max: number; worst: number[] }
function check(name: string, f: (...a: number[]) => number, g: (...a: number[]) => number, inputs: number[][], maxUlp: number): Stats {
  const st: Stats = { n: 0, exact: 0, max: 0, worst: [] };
  for (const args of inputs) {
    const a = f(...args), b = g(...args);
    const u = ulps(a, b);
    st.n++;
    if (u === 0) st.exact++;
    if (u > st.max) { st.max = u; st.worst = args; }
  }
  expect(st.max, `${name}: max ulp error ${st.max} at (${st.worst.join(', ')})`).toBeLessThanOrEqual(maxUlp);
  return st;
}

const N = 40000;
const MAX_ULP = 1;

describe('detmath accuracy vs Math.*', () => {
  it('sin / cos', () => {
    const xs: number[][] = [];
    for (let i = 0; i < N; i++) xs.push([uniform(-10, 10)]);
    for (let i = 0; i < N; i++) xs.push([uniform(-1e6, 1e6)]);
    for (let i = 0; i < N; i++) xs.push([logUniform(-40, 1023, true)]);
    for (let k = -2000; k <= 2000; k++) { xs.push([k * Math.PI / 2]); xs.push([k * Math.PI / 4]); }
    for (let k = 1; k < 2000; k++) xs.push([k * 1234567.891 * Math.PI]);
    for (const x of [0, -0, 1e-320, 5e-324, 1e-9, Math.PI, 1e22, 1e300, Number.MAX_VALUE, -Number.MAX_VALUE, 823549.6, 823550, 823551]) xs.push([x]);
    check('sin', dm.sin, Math.sin, xs, MAX_ULP);
    check('cos', dm.cos, Math.cos, xs, MAX_ULP);
  });

  it('exp', () => {
    const xs: number[][] = [];
    for (let i = 0; i < N; i++) xs.push([uniform(-745.2, 709.8)]);
    for (let i = 0; i < N; i++) xs.push([uniform(-2, 2)]);
    for (let i = 0; i < N; i++) xs.push([logUniform(-60, 9, true)]);
    for (const x of [0, -0, 1e-300, -1e-300, 709.78, 709.79, -745.13, -745.14, 1000, -1000, -708.5, -740]) xs.push([x]);
    check('exp', dm.exp, Math.exp, xs, MAX_ULP);
  });

  it('log', () => {
    const xs: number[][] = [];
    for (let i = 0; i < N; i++) xs.push([logUniform(-1074, 1024)]);
    for (let i = 0; i < N; i++) xs.push([uniform(0.5, 2)]);
    for (let i = 0; i < N; i++) xs.push([1 + uniform(-1e-6, 1e-6)]);
    for (const x of [1, 2, Math.E, 5e-324, 1e-310, Number.MAX_VALUE, 0.9999999999999999, 1.0000000000000002]) xs.push([x]);
    check('log', dm.log, Math.log, xs, MAX_ULP);
  });

  it('atan2', () => {
    const xs: number[][] = [];
    for (let i = 0; i < N; i++) xs.push([uniform(-10, 10), uniform(-10, 10)]);
    for (let i = 0; i < N; i++) xs.push([logUniform(-200, 200, true), logUniform(-200, 200, true)]);
    for (let i = 0; i < N; i++) { const x = uniform(-5, 5); xs.push([x * uniform(0.9, 1.1), x]); }
    check('atan2', dm.atan2, Math.atan2, xs, MAX_ULP);
  });

  it('pow', () => {
    const xs: number[][] = [];
    for (let i = 0; i < N; i++) xs.push([uniform(0, 100), uniform(-20, 20)]);
    for (let i = 0; i < N; i++) xs.push([logUniform(-100, 100), uniform(-8, 8)]);
    for (let i = 0; i < N; i++) xs.push([uniform(-50, 50), Math.round(uniform(-30, 30))]);
    for (let i = 0; i < N; i++) xs.push([uniform(0.2, 3), uniform(0.5, 3.5)]);
    for (let i = 0; i < 5000; i++) xs.push([1 + uniform(-1e-7, 1e-7), uniform(-3e9, 3e9)]);
    check('pow', dm.pow, Math.pow, xs, MAX_ULP);
  });

  it('special values match the ECMAScript results exactly', () => {
    const special = [0, -0, Infinity, -Infinity, NaN];
    for (const x of special) {
      expect(Object.is(dm.sin(x), Math.sin(x)), `sin(${x})`).toBe(true);
      expect(Object.is(dm.cos(x), Math.cos(x)), `cos(${x})`).toBe(true);
      expect(Object.is(dm.exp(x), Math.exp(x)), `exp(${x})`).toBe(true);
      expect(Object.is(dm.log(x), Math.log(x)), `log(${x})`).toBe(true);
      expect(Object.is(dm.sqrt(x), Math.sqrt(x)), `sqrt(${x})`).toBe(true);
    }
    for (const x of [-1, -5e-324, -Number.MAX_VALUE]) expect(dm.log(x)).toBeNaN();
    for (const x of [5e-324, -5e-324, 1e-320]) {
      expect(dm.sin(x)).toBe(x);
      expect(dm.cos(x)).toBe(1);
      expect(dm.exp(x)).toBe(1);
    }
    // Two-argument grids: exact wherever an operand or the result is special,
    // within 1 ulp otherwise.
    const grid = [0, -0, 1, -1, 0.5, -0.5, 2, -2, 3, -3, Infinity, -Infinity, NaN, 5e-324, -5e-324, Number.MAX_VALUE, 1e-320, 1e308];
    const isSpecial = (v: number) => v === 0 || !Number.isFinite(v);
    for (const x of grid) for (const y of grid) {
      const pairs: [string, number, number][] = [['atan2', dm.atan2(y, x), Math.atan2(y, x)], ['pow', dm.pow(x, y), Math.pow(x, y)]];
      for (const [name, got, want] of pairs) {
        if (isSpecial(x) || isSpecial(y) || isSpecial(want)) expect(Object.is(got, want), `${name}(${x}, ${y})`).toBe(true);
        else expect(ulps(got, want), `${name}(${x}, ${y})`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('scalbn scales exactly', () => {
    for (let i = 0; i < 5000; i++) {
      const x = logUniform(-60, 60, true), n = Math.round(uniform(-1100, 1100));
      const h = Math.trunc(n / 2);
      const want = x * Math.pow(2, h) * Math.pow(2, n - h); // exact unless it over/underflows
      if (Number.isFinite(want) && Math.abs(want) > 1e-300) expect(dm.scalbn(x, n)).toBe(want);
    }
  });
});

/** [fn, x, expected bits (hex), y?]. Generated once from this implementation and frozen. */
const KNOWN: [string, number, string, number?][] = [
  ['sin', 0.5, '3fdeaee8744b05f0'],
  ['sin', 1, '3feaed548f090cee'],
  ['sin', 2, '3fed18f6ead1b446'],
  ['sin', 3, '3fc210386db6d55b'],
  ['sin', -0.75, 'bfe5cffc16bf8f0d'],
  ['sin', 0.00001, '3ee4f8b588e1e8a2'],
  ['sin', 10, 'bfe1689ef5f34f52'],
  ['sin', 100, 'bfe03425b78c4db8'],
  ['sin', 1000000, 'bfd6664b2568d867'],
  ['sin', 12345.678, 'bfe687d5890974a5'],
  ['sin', 1e+22, 'bfeb453ab76bf397'],
  ['sin', -3.9, '3fe6022e2d1fb3cb'],
  ['sin', 0.1, '3fb98eaecb8bcb2c'],
  ['sin', 7.5, '3fee041886fcae30'],
  ['sin', 709.999999999, '3f0f9badd43f70bb'],
  ['sin', 1e+300, 'bfea2c16b010e385'],
  ['cos', 0.5, '3fec1528065b7d50'],
  ['cos', 1, '3fe14a280fb5068c'],
  ['cos', 2, 'bfdaa22657537205'],
  ['cos', 3, 'bfefae04be85e5d2'],
  ['cos', -0.75, '3fe769fec655211f'],
  ['cos', 0.00001, '3feffffffff920c8'],
  ['cos', 10, 'bfead9ac890c6b1f'],
  ['cos', 100, '3feb981dbf665fdf'],
  ['cos', 1000000, '3fedf9df9906d32c'],
  ['cos', 12345.678, '3fe6b94c3bbe24b8'],
  ['cos', 1e+22, '3fe0be2cef01c8f4'],
  ['cos', -3.9, 'bfe73ad66234c8ea'],
  ['cos', 0.1, '3fefd712f9a817c0'],
  ['cos', 7.5, '3fd62f45e66f5c2f'],
  ['cos', 709.999999999, '3fefffffff063b4f'],
  ['cos', 1e+300, 'bfe2699022adc4c1'],
  ['exp', -700, '00d14f2b0fb9307f'],
  ['exp', -20.5, '3e157a3afeed00ab'],
  ['exp', -1, '3fd78b56362cef38'],
  ['exp', -1e-10, '3feffffffff24190'],
  ['exp', 0.3, '3ff599058c8c1a96'],
  ['exp', 1, '4005bf0a8b14576a'],
  ['exp', 2.5, '40285d6fd931e0bb'],
  ['exp', 50, '44719103e4080b45'],
  ['exp', 700, '7f0d945df4f8ec8e'],
  ['log', 1e-310, 'c0864e69394d9508'],
  ['log', 0.00001, 'c027069e2aa2aa5b'],
  ['log', 0.3, 'bff34378fcbda721'],
  ['log', 0.999999, 'beb0c6f82d74d230'],
  ['log', 1.5, '3fd9f323ecbf984c'],
  ['log', 2, '3fe62e42fefa39ef'],
  ['log', 10, '40026bb1bbb55516'],
  ['log', 12345.678, '4022d79559791e31'],
  ['log', 1e+300, '4085963447f87fb5'],
  ['pow', 2, '3ff6a09e667f3bcd', 0.5],
  ['pow', 2.5, '403491876092afc1', 3.3],
  ['pow', 10, '3f60585e4c78b079', -2.7],
  ['pow', 0.9, '366fee7413dac341', 1000],
  ['pow', 1.0001, '48f330ab10a37aa5', 1000000],
  ['pow', -2, 'c020000000000000', 3],
  ['pow', -2.5, '4043880000000000', 4],
  ['pow', 3, '3ff7137449123ef6', 0.3333333333333333],
  ['pow', 7.1, '40152a61941f7af7', 0.85],
  ['pow', 0.00001, '3f009456549be1bc', 0.9],
  ['pow', 123.4, '3f91166f896127d3', -0.85],
  ['atan2', 1, '3fe921fb54442d18', 1],
  ['atan2', 1, '4002d97c7f3321d2', -1],
  ['atan2', -1, 'c002d97c7f3321d2', -1],
  ['atan2', -1, 'bfe921fb54442d18', 1],
  ['atan2', 0.5, '3fcf5b75f92c80dd', 2],
  ['atan2', 3, '3ffa76873ac2bc7d', -0.25],
  ['atan2', -1e-8, 'be212e0be826d695', 5],
  ['atan2', 200000, '3ff921fb52ec942a', 0.001],
  ['atan2', 0.7, '3fe921fb54442d18', 0.7],
];

describe('detmath known-answer vectors', () => {
  it('reproduces the frozen bit patterns', () => {
    for (const [fn, x, want, y] of KNOWN) {
      let got: number;
      switch (fn) {
        case 'sin': got = dm.sin(x); break;
        case 'cos': got = dm.cos(x); break;
        case 'exp': got = dm.exp(x); break;
        case 'log': got = dm.log(x); break;
        case 'pow': got = dm.pow(x, y as number); break;
        case 'atan2': got = dm.atan2(x, y as number); break;
        default: throw new Error(fn);
      }
      expect(hex(got), `${fn}(${x}${y === undefined ? '' : ', ' + y})`).toBe(want);
    }
    expect(KNOWN.length).toBe(70);
  });

  it('frozen vectors are themselves within 1 ulp of Math.*', () => {
    for (const [fn, x, want, y] of KNOWN) {
      view.setBigUint64(0, BigInt('0x' + want));
      const v = view.getFloat64(0);
      const ref = fn === 'pow' ? Math.pow(x, y as number) : fn === 'atan2' ? Math.atan2(x, y as number)
        : (Math as unknown as Record<string, (a: number) => number>)[fn]!(x);
      expect(ulps(v, ref), `${fn}(${x})`).toBeLessThanOrEqual(1);
    }
  });
});
