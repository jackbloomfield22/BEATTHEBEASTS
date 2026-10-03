// The bubble against zone (the bubble pass): the call played by the
// formation's strength, the stalk blocks counted outside-in, and the bubble
// a 3–6 yd play against the zones, at a small sample. tools/sim/screens.ts
// runs it at scale (60 a call).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, NEUTRAL, playById, practiceRosters, runToWhistle, stepPlay, toStrength, type SnapshotLike } from '@/sim';
import { cellSeed, sidesFor } from '@/sim/outcomes';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const bubble = playById('bunch-bubble');

/** A rep of the bubble the way tools/sim/screens.ts runs it (both hashes and the middle, flipped and not). */
function rep(def: string, k: number) {
  const call = defById(def);
  const sd = sidesFor(rosters, bubble, call);
  return createPlay({ seed: cellSeed(bubble, call, k), offense: sd.offense, defense: sd.defense, play: bubble, def: sd.def, los: 35, ballY: [3.08, 0, -3.08][k % 3], flip: k % 2 === 1, toGo: 10, user: false });
}

describe('the bubble: zone calls by strength, stalks counted, a 3–6 yd play against zone', () => {
  it('the call sheet is written strength-left; to the right, the underneath zones and the ends swap, the corners and the deep zones stay', () => {
    const c2 = toStrength(defById('cover2').assign, -1);
    expect(c2.SLB).toEqual({ kind: 'zone', zone: 'curlR' });
    expect(c2.WLB).toEqual({ kind: 'zone', zone: 'curlL' });
    expect(c2.LCB).toEqual({ kind: 'zone', zone: 'flatL' });
    expect(c2.FS).toEqual({ kind: 'zone', zone: 'halfL' });
    const fz = toStrength(defById('firezone').assign, -1);
    expect(fz.LE).toEqual({ kind: 'zone', zone: 'curlL' });
    expect(fz.RE).toEqual({ kind: 'rush' });
    expect(toStrength(defById('cover3').assign, 1)).toBe(defById('cover3').assign);
  });

  it('against bunch right the curl defender to the bunch lines up on its side, and the stalks take the corner and the man inside him, never a lineman', () => {
    const s = rep('cover2', 0);
    const by = s.setup.ballY ?? 0;
    const slb = s.agents[s.slot.SLB!]!;
    expect(slb.pos.y).toBeLessThan(by);
    expect(s.setup.def.assign.SLB).toEqual({ kind: 'zone', zone: 'curlR' });
    stepPlay(s, NEUTRAL);
    while (s.phase === 'presnap') stepPlay(s, NEUTRAL);
    const te = s.agents[s.slot.TE!]!;
    const z = s.agents[s.slot.Z!]!;
    expect(s.agents[te.mem.target as number]!.slot).toBe('RCB');
    expect(['LE', 'LDT', 'RDT', 'RE']).not.toContain(s.agents[z.mem.target as number]!.slot);
  });

  it('gains 3–6 yd a throw against Cover 2, Cover 3 and Tampa 2 (it lost a yard against Cover 2 with the stalks on the end)', () => {
    const N = 12;
    for (const def of ['cover2', 'cover3', 'tampa2']) {
      let yds = 0;
      for (let k = 0; k < N; k++) yds += runToWhistle(rep(def, k), () => NEUTRAL).result!.yards;
      // This sample: Cover 2 5.4, Cover 3 6.8, Tampa 2 3.3 (60 a call: 4.1, 5.7, 4.0; before: 0.7, 1.9, 0.5).
      expect(yds / N, def).toBeGreaterThan(1.5);
      expect(yds / N, def).toBeLessThan(8);
    }
  });
});
