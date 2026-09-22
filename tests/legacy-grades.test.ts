// Grade and tier helpers whose legacy versions live inline in UI code (so the
// differential test can't load them): threat tier (BeastsRevealScreen) and the
// dominance grade (inside simulateBeatdown), plus the Daily forced-win check.

import { describe, expect, it } from 'vitest';
import { C } from '@data/legacy';
import { dominanceGrade, getDailyChallenge, isTopLineup, simulateBeatdown, threatTier } from '@/engine/legacy';
import type { Roster, RosterEntry } from '@/engine/legacy';

describe('threatTier', () => {
  it('uses the legacy thresholds and colors', () => {
    expect(threatTier(99)).toEqual({ l: 'NIGHTMARE', c: '#ff2a6d' });
    expect(threatTier(90).l).toBe('NIGHTMARE');
    expect(threatTier(89)).toEqual({ l: 'BRUTAL', c: C.gold });
    expect(threatTier(87).l).toBe('BRUTAL');
    expect(threatTier(86)).toEqual({ l: 'STOUT', c: C.sky });
    expect(threatTier(84).l).toBe('STOUT');
    expect(threatTier(83)).toEqual({ l: 'BEATABLE', c: C.emerald });
    expect(threatTier(40).l).toBe('BEATABLE');
  });
});

describe('dominanceGrade', () => {
  it('uses the legacy margin bands', () => {
    const cases: [number, string, string][] = [
      [35, 'A+', 'Total Domination'], [21, 'A+', 'Total Domination'], [20, 'A', 'Statement Win'], [11, 'A', 'Statement Win'],
      [10, 'B', 'Solid Win'], [4, 'B', 'Solid Win'], [3, 'C', 'Nailbiter Win'], [1, 'C', 'Nailbiter Win'],
      [0, 'L', 'Tough Loss'], [-10, 'L', 'Tough Loss'], [-11, 'L-', 'Beatdown'], [-40, 'L-', 'Beatdown'],
    ];
    for (const [m, grade, gradeLabel] of cases) expect(dominanceGrade(m)).toEqual({ grade, gradeLabel });
  });
});

describe('Daily forced win', () => {
  it('a top lineup always wins; a roster with one different player is not a top lineup', () => {
    const daily = getDailyChallenge('2026-09-22');
    const roster = {} as Record<string, RosterEntry>;
    for (const pk of daily.perfect) {
      const p = pk.player!;
      roster[pk.slot] = { n: p.n, t: p.t, d: p.d, p: pk.slot === 'OL' ? 'OL' : p.p, imp: p.imp, slot: pk.slot, s: p.s };
    }
    const names = new Set(daily.perfect.map((pk) => pk.player!.n));
    if (names.size === 9) {
      expect(isTopLineup(roster, daily.topLineups)).toBe(true);
      const sim = simulateBeatdown(roster as Roster, daily.beasts, true, daily.diffAdj);
      expect(sim.won).toBe(true);
      expect(sim.grade).toBe(dominanceGrade(sim.yourScore - sim.beastScore).grade);
    }
    const changed = { ...roster, QB: { ...roster.QB!, n: 'Not A Real QB' } };
    expect(isTopLineup(changed, daily.topLineups)).toBe(false);
    expect(isTopLineup(roster, null)).toBe(false);
  });
});
