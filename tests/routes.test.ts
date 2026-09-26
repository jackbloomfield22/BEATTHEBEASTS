import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { practiceRosters, type SnapshotLike } from '@/sim';
import { routeFidelity } from '@/sim/outcomes';

// M6.5 #2: a receiver runs the called route at full speed until the ball's
// in the air to him or the QB has left the pocket, on every play against
// every call (tools/sim/routefid.ts has the full report).

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;

describe('routes (M6.5 #2): the path matches the route art until the throw', () => {
  const runs = routeFidelity(practiceRosters(snap), 1);
  it('covers every pass play and call', () => {
    expect(runs.length).toBeGreaterThan(1000);
  });
  it('strays: nobody more than 4 yd off his route, under one in ten more than 2 (rounding a hard break)', () => {
    expect(runs.filter((r) => r.maxDev > 4).map((r) => `${r.play}/${r.def} ${r.slot} ${r.route} ${r.maxDev.toFixed(1)}`)).toEqual([]);
    expect(runs.filter((r) => r.maxDev > 2).length / runs.length).toBeLessThan(0.1);
  });
  it('stops: nobody stands mid-route for no reason (M6: a missed break point sent him back to touch it)', () => {
    const idle = runs.filter((r) => (r.why['no reason'] ?? 0) > 0.3);
    expect(idle.length / runs.length).toBeLessThan(0.02);
  });
});
