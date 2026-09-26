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
