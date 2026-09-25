import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getDailyChallenge } from '@/engine/legacy/daily';
import { makeRng } from '@/engine/rng';
import { assembleRatedBeasts, BEASTS_BAR } from '@/game/beasts';
import { newDaily } from '@/game/daily';
import { makeCatalog } from '@/game/draft';

const cat = makeCatalog(JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')), JSON.parse(readFileSync('data/augment/jerseys.json', 'utf8')).numbers);
const ovr = (id: string) => cat.entry.get(id)?.ovr;

describe('the Beasts on OVR (GDD §5.1) and the Daily (§4)', () => {
  it('eleven in the legacy shape plus a nickel CB and a dime S, no one twice, all rated', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const b = assembleRatedBeasts(makeRng(seed), ovr);
      expect(b.beasts.map((x) => x.p)).toEqual(['DE', 'DT', 'DT', 'DE', 'LB', 'LB', 'LB', 'CB', 'S', 'S', 'CB']);
      expect(b.subs.map((x) => x.p)).toEqual(['CB', 'S']);
      const names = [...b.beasts, ...b.subs].map((x) => x.n);
      expect(new Set(names).size).toBe(13);
      for (const x of [...b.beasts, ...b.subs]) expect(cat.entry.has(x.id)).toBe(true);
    }
  });

  it('they clear the bar nearly always (the strongest of 60 rolls otherwise)', () => {
    let clear = 0;
    for (let seed = 1; seed <= 100; seed++) if (assembleRatedBeasts(makeRng(seed), ovr).rating.rating >= BEASTS_BAR) clear++;
    expect(clear).toBeGreaterThan(95);
  });

  it("a date always gets the same Beasts and the same draft sequence, and the sequence is legacy's", () => {
    for (const key of ['2026-09-25', '2027-01-01', '2026-02-28']) {
      const a = newDaily(key, cat);
      const b = newDaily(key, cat);
      expect(a.beasts.beasts.map((x) => x.id)).toEqual(b.beasts.beasts.map((x) => x.id));
      expect(a.sequence).toEqual(getDailyChallenge(key).sequence);
      expect(a.diffAdj).toBeGreaterThanOrEqual(0);
      expect(a.diffAdj).toBeLessThanOrEqual(20);
      expect(a.perfect.every((p) => p.pick)).toBe(true);
    }
  });
});
