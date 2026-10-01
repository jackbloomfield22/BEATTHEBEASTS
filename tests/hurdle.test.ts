import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, playById, practiceRosters, type SnapshotLike } from '@/sim';
import { findStint, simPlayer } from '@/sim/roster';
import { autoMove, carrierOptions, moveOdds } from '@/sim/moves';
import { tackleOdds } from '@/sim/contact';
import { effects } from '@/sim/effects';

// The hurdle (the owner's one-button moves; the Hurdler trait's catalog line:
// "unlocks the hurdle move against low tackles; success scales with
// Jumping"). Saquon Barkley goes over a defensive back squared up in front;
// a back without the trait never tries it; caught in the air, he's down.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

/** `name` with the ball at 40 running upfield, one defensive back squared up `dx` yd in front. */
function picture(name: string, dx = 2.2, seed = 11) {
  const s = createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-slants'), def: defById('cover3'), los: 30, toGo: 10, user: true });
  const c = s.agents[s.icons[0]!]!;
  const e = findStint(snap, name, 'RB')!;
  c.p = simPlayer(e, c.p.num);
  c.fx = effects(c.p);
  c.pos = { x: 40, y: 0 };
  c.vel = { x: 7, y: 0 };
  s.ball.mode = 'held';
  s.ball.holder = c.i;
  s.carrier = c.i;
  s.phase = 'carrier';
  for (const i of s.def) s.agents[i]!.pos = { x: 10, y: s.agents[i]!.pos.y };
  const d = s.def.map((i) => s.agents[i]!).find((a) => a.p.pos === 'S' || a.p.pos === 'CB')!;
  d.pos = { x: 40 + dx, y: 0.2 };
  d.vel = { x: -4, y: 0 };
  return { s, c, d };
}

describe('the hurdle', () => {
  it('a Hurdler is offered it against some defensive backs squared up in front (the ones who go low), and the one button can pick it', () => {
    let offered = 0;
    let picked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { s, c, d } = picture('Saquon Barkley', 2.2, seed);
      if (!carrierOptions(s, c).includes('hurdle')) continue;
      offered++;
      const odds = moveOdds(s, c, d, 'hurdle');
      expect(odds).toBeGreaterThan(0.25);
      expect(odds).toBeLessThan(0.8);
      if (autoMove(s, c) === 'hurdle') picked++;
    }
    // About a third of them go low (moves.ts LOW_SHARE).
    expect(offered).toBeGreaterThan(10);
    expect(offered).toBeLessThan(35);
    expect(picked).toBeGreaterThan(0);
  });
  it('a back without the trait never hurdles', () => {
    const { s, c } = picture('Jerome Bettis');
    expect(carrierOptions(s, c)).not.toContain('hurdle');
    expect(autoMove(s, c)).not.toBe('hurdle');
  });
  it('caught in the air he is down: a failed hurdle is a near-certain tackle', () => {
    const { s, c, d } = picture('Saquon Barkley');
    expect(tackleOdds(s, d, c, 'hurdle').tackle).toBeGreaterThan(0.95);
    // From the side it's no hurdle at all.
    d.pos = { x: 40.5, y: 2.5 };
    d.vel = { x: 0, y: -4 };
    expect(tackleOdds(s, d, c, 'hurdle').evade).toBeLessThan(0.15);
  });
});
