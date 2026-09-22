// engine/rng: legacy-identical mulberry32 + helpers, and the new named
// sub-streams. (Bit-identity with the legacy source itself is checked in
// legacy-diff.test.ts; these are standalone known answers and properties.)

import { describe, expect, it } from 'vitest';
import { deriveSeed, deriveStream, fnv1a, gaussNoise, makeRng, seedFromDate, todayKey } from '@/engine/rng';

describe('makeRng (mulberry32)', () => {
  it('is deterministic, in [0,1), and matches frozen outputs', () => {
    const a = makeRng(42), b = makeRng(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    const r = makeRng(0);
    const first = [r(), r(), r()].map((x) => Math.round(x * 4294967296));
    expect(first).toEqual(FROZEN_SEED0);
  });
  it('treats seeds modulo 2^32', () => {
    const a = makeRng(-1), b = makeRng(0xffffffff), c = makeRng(2 ** 32 + 5), d = makeRng(5);
    for (let i = 0; i < 50; i++) { expect(a()).toBe(b()); expect(c()).toBe(d()); }
  });
});

// Mulberry32 seed 0, first three outputs × 2^32 (frozen; the first is the
// widely published mulberry32(0) value 0.26642920868471265).
const FROZEN_SEED0 = [1144304738, 1416247, 958946056];

describe('hashes and keys', () => {
  it('fnv1a / seedFromDate', () => {
    expect(fnv1a('')).toBe(2166136261);
    expect(fnv1a('a')).toBe(0xe40c292c);
    expect(fnv1a('foobar')).toBe(0xbf9cf968);
    expect(seedFromDate('2026-01-01')).toBe(fnv1a('2026-01-01'));
    expect(seedFromDate('2026-01-01')).not.toBe(seedFromDate('2026-01-02'));
  });
  it('todayKey pads without a wall clock', () => {
    expect(todayKey({ y: 2026, m: 1, d: 5 })).toBe('2026-01-05');
    expect(todayKey({ y: 2026, m: 12, d: 31 })).toBe('2026-12-31');
  });
});

describe('gaussNoise', () => {
  it('is approximately standard normal', () => {
    const r = makeRng(123);
    let s = 0, s2 = 0;
    const n = 50000;
    for (let i = 0; i < n; i++) { const g = gaussNoise(r); s += g; s2 += g * g; }
    const mean = s / n, sd = Math.sqrt(s2 / n - mean * mean);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(sd - 1)).toBeLessThan(0.02);
  });
});

describe('deriveStream', () => {
  it('is (root ^ fnv1a(name)) >>> 0, deterministic and name-separated', () => {
    expect(deriveSeed(12345, 'ai')).toBe((12345 ^ fnv1a('ai')) >>> 0);
    const a = deriveStream(99, 'beasts-possessions'), b = deriveStream(99, 'beasts-possessions');
    const c = deriveStream(99, 'ai'), d = deriveStream(100, 'beasts-possessions');
    const xa = Array.from({ length: 20 }, () => a());
    expect(xa).toEqual(Array.from({ length: 20 }, () => b()));
    expect(xa).not.toEqual(Array.from({ length: 20 }, () => c()));
    expect(xa).not.toEqual(Array.from({ length: 20 }, () => d()));
    // play:n streams are all distinct
    const seeds = new Set(Array.from({ length: 1000 }, (_, n) => deriveSeed(7, 'play:' + n)));
    expect(seeds.size).toBe(1000);
  });
  it('adding a consumer does not shift another stream', () => {
    const before = deriveStream(5, 'contact');
    const xs = Array.from({ length: 10 }, () => before());
    const other = deriveStream(5, 'new-consumer');
    other(); other();
    const after = deriveStream(5, 'contact');
    expect(Array.from({ length: 10 }, () => after())).toEqual(xs);
  });
});
