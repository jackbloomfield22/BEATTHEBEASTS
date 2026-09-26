import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, playById, practiceRosters, type SnapshotLike } from '@/sim';
import { carrierOptions, moveOdds, threatOf } from '@/sim/moves';

// M6.5 #9: three of the six moves at a time, chosen by the picture, the likeliest to work in slot 1.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

/** A receiver with the ball at 40, running upfield at 7 yd/s, and one defender at (dx, dy) from him (the rest far behind). */
function picture(dx: number, dy: number) {
  const s = createPlay({ seed: 11, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-slants'), def: defById('cover3'), los: 30, toGo: 10, user: true });
  const c = s.agents[s.icons[0]!]!;
  c.pos = { x: 40, y: 0 };
  c.vel = { x: 7, y: 0 };
  s.ball.mode = 'held';
  s.ball.holder = c.i;
  s.carrier = c.i;
  s.phase = 'carrier';
  for (const i of s.def) s.agents[i]!.pos = { x: 10, y: s.agents[i]!.pos.y };
  const d = s.agents[s.def[0]!]!;
  d.pos = { x: 40 + dx, y: dy };
  d.vel = { x: -dx, y: -dy };
  return { s, c, d };
}

describe('carrier move options (M6.5 #9)', () => {
  it('a tackler square in front offers truck, spin and juke', () => {
    const { s, c, d } = picture(3, 0.4);
    expect(threatOf(s, c)).toBe(d);
    expect([...carrierOptions(s, c)].sort()).toEqual(['juke', 'spin', 'truck']);
  });
  it('a tackler from the side offers juke, stiff arm and spin', () => {
    const { s, c } = picture(1, 3);
    expect([...carrierOptions(s, c)].sort()).toEqual(['juke', 'spin', 'stiffArm']);
  });
  it('in the open field: the best move for his angle, then dive and protect', () => {
    const { s, c } = picture(12, 1);
    const o = carrierOptions(s, c);
    expect(o.slice(1)).toEqual(['dive', 'protect']);
    expect(['truck', 'spin', 'juke']).toContain(o[0]);
  });
  it('slot 1 is always the move most likely to work', () => {
    for (const [dx, dy] of [[3, 0.4], [1, 3], [2, -2.5], [4, 1]] as const) {
      const { s, c, d } = picture(dx, dy);
      const o = carrierOptions(s, c);
      for (const m of o) expect(moveOdds(s, c, d, o[0])).toBeGreaterThanOrEqual(moveOdds(s, c, d, m));
    }
  });
});
