import { describe, expect, it } from 'vitest';
import { gradeQB } from '@/engine/legacy/grades';
import { scoreToGrade } from '@/engine/legacy/grades';
import { gradePlayer, gradePlayers, ROLE_NORMS, NFL_POSSESSIONS } from '@/game/grades';
import { emptyGameBox, type GameBox, type PassLine, type RecLine, type RushLine } from '@/game/stats';
import type { GameRecord } from '@/game/record';

// Player grades against expectation (Playtest 2: "3 of 6 for 43 yards got
// an A+; a QB with 101 passing, no TDs and 175 rushing got a B").

const pass = (p: Partial<PassLine>): PassLine => ({ name: 'QB', cmp: 0, att: 0, yds: 0, td: 0, int: 0, sacks: 0, sackYds: 0, long: 0, ...p });
const rush = (r: Partial<RushLine>): RushLine => ({ name: 'RB', car: 0, yds: 0, td: 0, long: 0, bt: 0, fum: 0, lost: 0, ...r });
const rec = (r: Partial<RecLine>): RecLine => ({ name: 'WR', tgt: 0, rec: 0, yds: 0, td: 0, long: 0, yac: 0, drops: 0, contested: 0, contestedWon: 0, ...r });

function box(over: Partial<GameBox> = {}): GameBox {
  return { ...emptyGameBox('QB'), ...over };
}

describe('the playtest cases', () => {
  it('the old bug: legacy grades on yards ×2.5 (a 4-round game) put 3 of 6 for 43 at an A+', () => {
    // What the results screen did: gradeQB({ ...p, yds: p.yds * 10 / 4 }).
    expect(scoreToGrade(gradeQB({ cmp: 3, att: 6, yds: 43 * 2.5, td: 0, int: 0 }))).toBe('A+');
    // Unscaled it's a C: the inflation came from the scaled yards per attempt.
    expect(scoreToGrade(gradeQB({ cmp: 3, att: 6, yds: 43, td: 0, int: 0 }))).toBe('C');
  });

  it('3 of 6 for 43 yards in a 4-drive game is a C-range game for a QB, not an A+', () => {
    const g = gradePlayer('QB', 'QB', box({ pass: pass({ cmp: 3, att: 6, yds: 43 }) }), 4);
    expect(g.grade).toMatch(/^[CD]/);
    expect(g.why).toContain('3 of 6, 43 yards');
    expect(g.why).toContain('half of what a starting QB makes in 4 drives');
  });

  it("a QB's rushing counts: 101 passing and 175 rushing is an A in six drives", () => {
    const b = box({ pass: pass({ cmp: 8, att: 14, yds: 101 }), rush: { QB: rush({ name: 'QB', car: 9, yds: 175, long: 48 }) } });
    const g = gradePlayer('QB', 'QB', b, 6);
    expect(g.grade).toMatch(/^A/);
    expect(g.why).toContain('175 yards rushing');
    // Over ten drives the same line is worth less (the game length counts).
    expect(gradePlayer('QB', 'QB', b, 10).score!).toBeLessThan(g.score!);
  });

  it('3 catches on 6 targets for 43 yards is a good day for a No. 1 receiver in four drives, not an A+', () => {
    const g = gradePlayer('WR', 'WR1', box({ rec: { WR: rec({ tgt: 6, rec: 3, yds: 43 }) } }), 4);
    expect(g.grade).toMatch(/^B/);
  });
});

describe('grades against expectation', () => {
  it('a couple of balls his way cannot make an A+ on their own (1 of 3 for 34 as the backup tight end)', () => {
    const g = gradePlayer('TE', 'TE2', box({ rec: { TE: rec({ name: 'TE', tgt: 3, rec: 1, yds: 34 }) } }), 6);
    expect(g.grade).not.toMatch(/^A/);
    const big = gradePlayer('WR', 'WR1', box({ rec: { WR: rec({ tgt: 11, rec: 8, yds: 127, td: 1 }) } }), 6);
    expect(big.grade).toMatch(/^A/);
  });

  it('doing exactly what the role does is a B-', () => {
    const n = 6;
    const exp = (ROLE_NORMS.RB1.perGame / NFL_POSSESSIONS) * n;
    const car = Math.round(exp / 4.3);
    const g = gradePlayer('RB', 'RB1', box({ rush: { RB: rush({ car, yds: car * 4.3 }) } }), n);
    expect(g.grade).toBe('B-');
    expect(g.why).toContain('about what a lead back makes in 6 drives');
  });

  it('the same yards mean more from a backup than a starter', () => {
    const b = box({ rec: { TE: rec({ name: 'TE', tgt: 4, rec: 3, yds: 30 }) } });
    expect(gradePlayer('TE', 'TE2', b, 6).score!).toBeGreaterThan(gradePlayer('TE', 'TE1', b, 6).score!);
  });

  it('turnovers and drops cost', () => {
    const clean = gradePlayer('QB', 'QB', box({ pass: pass({ cmp: 12, att: 20, yds: 150, td: 1 }) }), 6);
    const picks = gradePlayer('QB', 'QB', box({ pass: pass({ cmp: 12, att: 20, yds: 150, td: 1, int: 2 }) }), 6);
    expect(picks.score!).toBeLessThan(clean.score! - 8);
    const drops = gradePlayer('WR', 'WR2', box({ rec: { WR: rec({ tgt: 6, rec: 3, yds: 40, drops: 2 }) } }), 6);
    expect(drops.why).toContain('2 drops');
  });

  it('no touches: no grade, just the snaps', () => {
    const g = gradePlayer('TE', 'TE2', box({ snaps: { TE: 7 } }), 6);
    expect(g.grade).toBeNull();
    expect(g.why).toBe('No touches on 7 snaps');
  });

  it('every reason is one line and every grade traces its points', () => {
    const b = box({ pass: pass({ cmp: 14, att: 22, yds: 188, td: 2, int: 1, sacks: 2, sackYds: 13 }), rush: { RB: rush({ car: 11, yds: 52, td: 1 }), QB: rush({ name: 'QB', car: 3, yds: 21 }) }, rec: { WR: rec({ tgt: 8, rec: 6, yds: 97, td: 1 }), RB: rec({ name: 'RB', tgt: 2, rec: 2, yds: 11 }) } });
    const r = { offense: [{ slot: 'QB', name: 'QB' }, { slot: 'RB', name: 'RB' }, { slot: 'WR1', name: 'WR' }, { slot: 'TE2', name: 'TE' }], box: b, userDrives: new Array(6).fill({}) } as unknown as GameRecord;
    const gs = gradePlayers(r);
    expect(gs.map((g) => g.role)).toEqual(['QB', 'RB1', 'WR1', 'TE2']);
    for (const g of gs) {
      expect(g.why).not.toContain('\n');
      expect(g.why.length).toBeLessThan(110);
      if (g.score !== null) expect(Math.round(80 + g.contributions.reduce((s, c) => s + c.points, 0))).toBeGreaterThan(0);
    }
    // The back's grade reads his carries and his catches together.
    expect(gs[1]!.why).toContain('11 carries for 52');
    expect(gs[1]!.why).toContain('2 of 2 targets for 11');
  });
});
