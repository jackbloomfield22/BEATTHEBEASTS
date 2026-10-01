// The slant exploit (Playtest 2: "backing up and throwing is always open"),
// at a small sample: the player throws the slant on time, or backs the QB
// away from the rush for two or two and a half seconds and throws it late,
// against every call on the sheet, the called Slants concept and slants
// hot-routed onto three other plays (~240 throws a script). The seeds are
// fixed, so the figures are too; the bands sit between where the game was
// before the squeeze and where it is now. tools/sim/slants.ts runs it at
// scale (200+ a cell) and docs/m66/SLANTS.md has the figures.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEF_CALLS, practiceRosters, type SnapshotLike } from '@/sim';
import { CALLED, HOT, LATE, ON_TIME, isMan, runCell, summarize, withLinebackers, type SlantSample, type SlantScript } from '../tools/sim/slants';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const N = 6;
const LATE_2 = LATE.filter((s) => s.id === 'late-2.0' || s.id === 'late-2.5');

function pool(r: ReturnType<typeof practiceRosters>, scripts: SlantScript[], man: boolean | null): SlantSample[] {
  const xs: SlantSample[] = [];
  for (const sc of scripts) for (const def of DEF_CALLS.filter((d) => man === null || isMan(d) === man)) xs.push(...runCell(r, [CALLED, ...HOT], def, sc, N));
  return xs;
}

describe('slants: the window closes when the ball is late', () => {
  const onTime = summarize(pool(rosters, [ON_TIME], null));
  const late = summarize(pool(rosters, LATE_2, null));
  const lateZone = summarize(pool(rosters, LATE_2, false));
  it('on time it is the better throw; late it is contested and picked', () => {
    // This sample: on time ~58% (~61% before); late ~45% complete, ~34%
    // intercepted or broken up, ~10.5 yd an attempt (before: ~55%, ~22%, ~14).
    expect(onTime.cmp).toBeGreaterThan(0.5);
    expect(late.cmp).toBeLessThan(onTime.cmp - 0.08);
    expect(late.cmp).toBeLessThan(0.5);
    expect(late.intPbu).toBeGreaterThan(0.28);
    expect(late.ypa).toBeLessThan(12.5);
  });
  it('against zone, a QB who held it or bailed backward finds his man plastered', () => {
    // The nearest defender to the target as the ball leaves: 3+ yd away on
    // ~24% of late throws against zone (~39% before the plaster rule).
    expect(lateZone.openRel).toBeLessThan(0.3);
  });
}, 180_000);

describe('slants: the linebackers are themselves', () => {
  it('coverage linebackers squeeze the quick game harder than run-first ones', () => {
    // Ray Lewis, Kuechly, Brooks (Zone Coverage 88–92) against Carl Banks,
    // Bart Scott, Matt Millen (29–33), the same plays and seeds, zone calls,
    // on time and late: ~50% completed against ~56%.
    const good = withLinebackers(rosters, snap, ['Ray Lewis', 'Luke Kuechly', 'Derrick Brooks']);
    const poor = withLinebackers(rosters, snap, ['Carl Banks', 'Bart Scott', 'Matt Millen']);
    const cmp = (r: typeof rosters) => summarize(pool(r, [ON_TIME, LATE.find((s) => s.id === 'late-2.0')!], false)).cmp;
    expect(cmp(good)).toBeLessThan(cmp(poor) - 0.03);
  });
}, 180_000);
