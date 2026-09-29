import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, type SnapshotLike } from '@/sim';

// Playtest 1 #2: hold-to-sprint for the carrier the player controls. Unheld
// he runs a strong run (never a jog) and gets his wind back; held he finds
// the last gear and pays stamina for it; spent, there's no sprint left.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

/** A carrier upfield in open grass (the defense 30 yd behind him), run for `ticks` with sprint held or not. */
function run(sprint: boolean, ticks: number, stamina = 1, user = true) {
  const s = createPlay({ seed: 3, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-slants'), def: defById('cover3'), los: 30, toGo: 10, user });
  stepPlay(s, input({ snap: true }));
  for (let k = 0; k < 20; k++) stepPlay(s, input({}));
  const c = s.agents[s.icons[0]!]!;
  c.pos = { x: 45, y: 0 };
  c.vel = { x: c.fx.vmax * 0.8, y: 0 };
  c.stamina = stamina;
  for (const i of s.def) s.agents[i]!.pos = { x: 15, y: s.agents[i]!.pos.y };
  s.ball.mode = 'held';
  s.ball.holder = c.i;
  s.carrier = c.i;
  s.phase = 'carrier';
  c.mem.steered = true;
  let top = 0;
  for (let k = 0; k < ticks && s.phase === 'carrier'; k++) {
    stepPlay(s, input({ move: { x: 1, y: 0 }, sprint }));
    top = Math.max(top, Math.hypot(c.vel.x, c.vel.y) / c.fx.vmax);
  }
  return { top, stamina: c.stamina };
}

describe('hold to sprint (Playtest 1 #2)', () => {
  it('unheld he runs ~90% of his top speed in space and his stamina holds', () => {
    const r = run(false, 90, 0.8);
    expect(r.top).toBeGreaterThan(0.84);
    expect(r.top).toBeLessThan(0.92);
    expect(r.stamina).toBeGreaterThanOrEqual(0.8);
  });

  it('held he finds the last gear and pays stamina for it', () => {
    const held = run(true, 90);
    const unheld = run(false, 90);
    expect(held.top).toBeGreaterThan(0.97);
    expect(held.top - unheld.top).toBeGreaterThan(0.06);
    expect(held.stamina).toBeLessThan(0.98);
  });

  it('spent, there is no sprint left in him', () => {
    const r = run(true, 60, 0.1);
    expect(r.top).toBeLessThan(0.92);
  });

  it('an AI carrier keeps the context pace (flat out in space) without a key', () => {
    expect(run(false, 90, 1, false).top).toBeGreaterThan(0.97);
  });
});
