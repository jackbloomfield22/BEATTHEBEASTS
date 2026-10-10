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
import { DEF_CALLS, defById, practiceRosters, type SnapshotLike } from '@/sim';
import { CALLED, HOT, LATE, ON_TIME, isMan, runCell, summarize, withLinebackers, type SlantSample, type SlantScript } from '../tools/sim/slants';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const N = 6;
const LATE_2 = LATE.filter((s) => s.id === 'late-2.0' || s.id === 'late-2.5');

function pool(r: ReturnType<typeof practiceRosters>, scripts: SlantScript[], man: boolean | null, n = N): SlantSample[] {
  const xs: SlantSample[] = [];
  for (const sc of scripts) for (const def of DEF_CALLS.filter((d) => man === null || isMan(d) === man)) xs.push(...runCell(r, [CALLED, ...HOT], def, sc, n));
  return xs;
}

describe('slants: the window closes when the ball is late', () => {
  const onTime = summarize(pool(rosters, [ON_TIME], null));
  const late = summarize(pool(rosters, LATE_2, null));
  const lateZone = summarize(pool(rosters, LATE_2, false));
  it('on time it is the high-percentage throw; late it is contested and picked', () => {
    // This sample, after the second pass (the lead on the path he really
    // runs, no loft that can't clear, timing): on time ~69% for ~7.6 yd an
    // attempt, ~18% picked or broken up (the first pass: ~58%); late ~32%
    // complete, ~33% picked or broken up, ~6.5 yd an attempt (first pass:
    // ~45%, ~34%, ~10.5; before the squeeze: ~55%, ~22%, ~14). The bands
    // hold the gap: on time a completion the NFL way, late a throw that dies.
    expect(onTime.cmp).toBeGreaterThan(0.6);
    expect(onTime.ypa).toBeGreaterThan(6);
    expect(onTime.ypa).toBeLessThan(9);
    expect(late.cmp).toBeLessThan(onTime.cmp - 0.2);
    expect(late.cmp).toBeLessThan(0.45);
    expect(late.intPbu).toBeGreaterThan(0.28);
    expect(late.intPbu).toBeGreaterThan(onTime.intPbu + 0.08);
    expect(late.ypa).toBeLessThan(9);
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
    // on time and late: ~47% completed against ~54% (on time alone ~62%
    // against ~74%).
    const good = withLinebackers(rosters, snap, ['Ray Lewis', 'Luke Kuechly', 'Derrick Brooks']);
    const poor = withLinebackers(rosters, snap, ['Carl Banks', 'Bart Scott', 'Matt Millen']);
    // (Twelve reps a cell since passing round 6: at six the pair read 52% against 55%, at scale, tools/sim/slants.ts --lbs at 40,
    // 47% against 59%. The six-rep window had shrunk to sample noise once the catch moved to the receiver's hands.)
    const cmp = (r: typeof rosters) => summarize(pool(r, [ON_TIME, LATE.find((s) => s.id === 'late-2.0')!], false, 12)).cmp;
    expect(cmp(good)).toBeLessThan(cmp(poor) - 0.03);
  });
}, 180_000);

describe('slants: Cover 2 man is the quick game\'s problem', () => {
  it('trail technique under two halves takes the on-time slant away more than Cover 1 does', () => {
    // The corners and the underneath men in trail (inside, a step behind
    // in the hip pocket, under the break), the halves over the top
    // (docs/m66/SLANTS.md, the third pass). At scale, the called Slants on
    // time: Cover 2 man ~53%, Cover 1 ~66% (they were 63% and 65%).
    // (24 reps since passing round 6: at 12 the pair read 46% against 50%; at scale, tools/sim/slants.ts, 60% against 67%.)
    const at = (id: string) => summarize(runCell(rosters, [CALLED, ...HOT], defById(id), ON_TIME, 24));
    const two = at('cover2man');
    const one = at('cover1');
    expect(two.cmp).toBeLessThan(one.cmp - 0.06);
    expect(two.cmp).toBeGreaterThan(0.35);
    expect(two.intPbu).toBeGreaterThan(one.intPbu);
  });
}, 180_000);
