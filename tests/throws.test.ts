import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, playById, practiceRosters, type SnapshotLike } from '@/sim';
import { planThrow, throwWhy } from '@/sim/passing';
import type { Agent } from '@/sim/types';

// M6.5 #1: the same throw to the same spot lands in the same place, give or
// take the cone for his accuracy, and the cone grows only for a reason.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

/** A throw from a set QB to a receiver standing `d` yd downfield, `n` times (a fresh play each: its own throw stream). */
function throwsAt(d: number, n: number, opts: { pressure?: number; offPlatform?: boolean; moving?: number } = {}) {
  const out: ReturnType<typeof planThrow>[] = [];
  for (let k = 0; k < n; k++) {
    const s = createPlay({ seed: 5000 + k, offense: rosters.offense, defense: rosters.defense, play: playById('trips-stick'), def: defById('cover3'), los: 35, toGo: 10, user: false });
    const qb = s.agents[s.qb]!;
    qb.pos = { x: 30, y: 0 };
    qb.vel = { x: 0, y: opts.moving ?? 0 };
    const rec: Agent = s.agents[s.icons[0]!]!;
    rec.pos = { x: 30 + d, y: 0 };
    rec.vel = { x: 0, y: 0 };
    out.push(planThrow(s, qb, rec, 0, { x: 0, y: 0 }, opts.pressure ?? 0, opts.offPlatform ?? false));
  }
  return out;
}

describe('throws (M6.5 #1): accuracy has reasons', () => {
  it('a 95-accuracy QB in a clean pocket puts a 15-yard throw within a yard almost every time', () => {
    const t = throwsAt(15, 600);
    expect(t[0]!.err.acc).toBeGreaterThanOrEqual(95);
    const within = t.filter((p) => p.err.off < 1).length / t.length;
    expect(within).toBeGreaterThan(0.94);
    // No mechanics misses from a clean pocket at that depth for him.
    expect(t.filter((p) => p.err.miss).length / t.length).toBeLessThan(0.015);
  });
  it('pressure, the run and a bad platform each widen the cone, and the throw says which', () => {
    const clean = throwsAt(15, 300);
    const mean = (xs: ReturnType<typeof planThrow>[]) => xs.reduce((a, p) => a + p.err.off, 0) / xs.length;
    const pressured = throwsAt(15, 300, { pressure: 1 });
    const running = throwsAt(15, 300, { moving: 5 });
    const feet = throwsAt(15, 300, { offPlatform: true });
    for (const g of [pressured, running, feet]) expect(mean(g)).toBeGreaterThan(mean(clean) * 1.2);
    expect(pressured.filter((p) => p.err.off > 1).map((p) => throwWhy(p.err))).toContain('pressure');
    expect(running.filter((p) => p.err.off > 1).map((p) => throwWhy(p.err))).toContain('on the run');
    expect(feet.filter((p) => p.err.off > 1).map((p) => throwWhy(p.err))).toContain('feet not set');
    // A clean throw that lands where he meant it is a clean throw.
    expect(clean.filter((p) => p.err.off < 1).every((p) => throwWhy(p.err) === 'clean')).toBe(true);
  });
});

describe('after the catch (M6.5 #4): at speed with a plan', () => {
  // A receiver who has just caught it in open grass at 8 yd/s (the defense behind him), the player's stick at rest.
  async function afterCatch(caught: boolean): Promise<number> {
    const { stepPlay, NEUTRAL, input } = await import('@/sim');
    const s = createPlay({ seed: 3, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-slants'), def: defById('cover3'), los: 30, toGo: 10, user: true });
    stepPlay(s, input({ snap: true }));
    for (let k = 0; k < 20; k++) stepPlay(s, NEUTRAL);
    const r = s.agents[s.icons[0]!]!;
    r.pos = { x: 45, y: 0 };
    r.vel = { x: 8, y: 0 };
    for (const i of s.def) s.agents[i]!.pos = { x: 25, y: s.agents[i]!.pos.y };
    s.ball.mode = 'held';
    s.ball.holder = r.i;
    s.carrier = r.i;
    s.phase = 'carrier';
    if (caught) r.mem.caughtAt = s.t;
    for (let k = 0; k < 24; k++) stepPlay(s, NEUTRAL);
    return Math.hypot(r.vel.x, r.vel.y);
  }
  it('a receiver the player has not steered yet keeps running his plan instead of coasting to a stop', async () => {
    // With nothing to run from, his plan is upfield at speed; a carrier who wasn't just
    // handed the ball by a catch still coasts when the stick is let go (CARRIER_COAST).
    const [a, b] = [await afterCatch(true), await afterCatch(false)];
    expect(a).toBeGreaterThan(7.5);
    expect(b).toBeLessThan(6);
  });
});
