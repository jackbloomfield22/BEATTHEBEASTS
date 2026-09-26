import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, input, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '@/sim';
import { effects } from '@/sim/effects';

// M6.5 #10: a change of direction off the arrows at speed is a planted cut,
// not a drift (tools/sim/cuts.ts measures the whole table).

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

/** A user carrier at full speed upfield in open grass, then the arrow `deg` off his run (held, or let go after 5 ticks). */
function cut(agility: number, deg: number, tap = false) {
  const s = createPlay({ seed: 3, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-slants'), def: defById('cover3'), los: 30, toGo: 10, user: true });
  stepPlay(s, input({ snap: true }));
  for (let k = 0; k < 20; k++) stepPlay(s, NEUTRAL);
  const c = s.agents[s.icons[0]!]!;
  c.p = { ...c.p, attrs: { ...c.p.attrs, agility } };
  c.fx = effects(c.p);
  c.pos = { x: 50, y: 0 };
  c.vel = { x: c.fx.vmax * 0.98, y: 0 };
  for (const i of s.def) s.agents[i]!.pos = { x: 20, y: s.agents[i]!.pos.y };
  s.ball.mode = 'held';
  s.ball.holder = c.i;
  s.carrier = c.i;
  s.phase = 'carrier';
  c.mem.steered = true;
  for (let k = 0; k < 30; k++) stepPlay(s, input({ move: { x: 1, y: 0 } }));
  const r = (deg * Math.PI) / 180;
  const v0 = Math.hypot(c.vel.x, c.vel.y);
  for (let k = 1; k <= 90; k++) {
    stepPlay(s, input({ move: tap && k > 5 ? { x: 0, y: 0 } : { x: Math.cos(r), y: Math.sin(r) } }));
    if (Math.abs(Math.atan2(c.vel.y, c.vel.x)) >= r * 0.999) return { t: k / 60, kept: Math.hypot(c.vel.x, c.vel.y) / v0, events: s.events };
  }
  return { t: Infinity, kept: 0, events: s.events };
}

describe('the carrier cuts (M6.5 #10)', () => {
  it('a 90-Agility back turns 90° at full speed in under 0.4 s, and it is a plant (speed lost), not a drift', () => {
    const r = cut(90, 90);
    expect(r.t).toBeLessThan(0.4);
    expect(r.kept).toBeGreaterThan(0.45);
    expect(r.kept).toBeLessThan(0.75);
    expect(r.events.some((e) => e.type === 'move' && e.data?.move === 'cut')).toBe(true);
  });
  it('Agility sets the cost: a 60-Agility back is slower through the same cut', () => {
    expect(cut(60, 90).t).toBeGreaterThan(cut(90, 90).t + 0.04);
  });
  it('a quick opposite tap is a hard cut that finishes even with the arrow let go', () => {
    const r = cut(90, 180, true);
    expect(r.t).toBeLessThan(0.45);
  });
});
