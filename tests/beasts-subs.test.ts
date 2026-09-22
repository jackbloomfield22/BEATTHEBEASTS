// GDD §5.1 / §15 D7: the sub package (+1 CB, +1 S) is drawn after the legacy
// base 11 from the same stream, so the base 11 stays identical to legacy.

import { beforeAll, describe, expect, it } from 'vitest';
import { assembleBeastsWithSubs } from '@/engine/beasts';
import { assembleBeastsSeeded, getDailyChallenge } from '@/engine/legacy';
import { makeRng, seedFromDate } from '@/engine/rng';
import { loadLegacy, orderedSerialize, stripPortIds } from './helpers/loadLegacy';
import type { LegacyModule } from './helpers/loadLegacy';

let L: LegacyModule;
beforeAll(async () => { L = await loadLegacy(); });

describe('assembleBeastsWithSubs', () => {
  it('base 11 is identical to legacy assembleBeastsSeeded for 500 seeds', () => {
    for (let i = 0; i < 500; i++) {
      const seed = (i * 0x9e3779b1) >>> 0;
      const { beasts } = assembleBeastsWithSubs(makeRng(seed));
      expect(beasts).toEqual(assembleBeastsSeeded(makeRng(seed)));
      expect(orderedSerialize(stripPortIds(beasts))).toBe(orderedSerialize(L.assembleBeastsSeeded(L.makeRng(seed))));
    }
  });

  it('base 11 matches the Daily Beasts (same stream)', () => {
    for (const date of ['2026-01-01', '2026-06-15', '2026-09-22']) {
      const { beasts } = assembleBeastsWithSubs(makeRng(seedFromDate(date) ^ 0x9e3779b9));
      expect(beasts).toEqual(getDailyChallenge(date).beasts);
    }
  });

  it('subs are one CB and one S, not already in the base 11, deterministic', () => {
    for (let i = 0; i < 300; i++) {
      const a = assembleBeastsWithSubs(makeRng(i));
      const b = assembleBeastsWithSubs(makeRng(i));
      expect(a).toEqual(b);
      expect(a.subs.map((s) => s.p)).toEqual(['CB', 'S']);
      expect(a.subs.map((s) => s.role)).toEqual(['CB', 'S']);
      expect(a.subs.every((s) => s.slot === 'DB')).toBe(true);
      const names = new Set(a.beasts.map((x) => x.n));
      for (const s of a.subs) expect(names.has(s.n)).toBe(false);
      expect(a.subs[0]!.n).not.toBe(a.subs[1]!.n);
    }
  });

  it('subs follow the legacy weighting (higher imp drawn more often)', () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 3000; i++) {
      for (const s of assembleBeastsWithSubs(makeRng(1_000_000 + i)).subs) counts.set(s.imp, (counts.get(s.imp) ?? 0) + 1);
    }
    const hi = [...counts].filter(([imp]) => imp >= 90).reduce((a, [, c]) => a + c, 0);
    const lo = [...counts].filter(([imp]) => imp < 80).reduce((a, [, c]) => a + c, 0);
    expect(hi).toBeGreaterThan(lo);
  });
});
