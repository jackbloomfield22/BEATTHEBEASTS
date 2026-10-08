// The identity harness in the unit tests (Playtest 2, "every player is
// himself"): the pairs with the widest gaps, at four reps, so a change that
// flattens a rating's effect fails `npm run check` instead of waiting for the
// milestone run (tools/sim/identity.ts, all twenty at four to six reps).
import { describe, expect, it } from 'vitest';
import { PAIRS, runPair, setReps } from '../tools/sim/identity';

// (Four since passing round 2: at two, Hill's YAC gap over Welker swung to 0.4 yd on the sample's few long catches once the
// deep defenders take their angle on the throw; it's 1.3 at four and 1.4 at the harness's six.)
setReps(4);
const pair = (a: string) => PAIRS.find((p) => p.a[0] === a)!;

describe('identity: the same plays, different men', () => {
  for (const name of ['Tyreek Hill', 'Barry Sanders', 'Joe Montana']) {
    it(`${name}: ${pair(name).why}`, () => {
      const r = runPair(pair(name));
      const failed = r.checks.filter((c) => !c.ok).map((c) => `${c.m} ${c.diff.toFixed(2)}`);
      expect(failed).toEqual([]);
    }, 480_000);
  }
});

describe('identity videos: each side-by-side pair still shows its contrast', () => {
  it('the same snap with each man, as the browser sets it up', async () => {
    const { IDENTITY } = await import('@/game/clips');
    const { SPECS, playClip } = await import('../tools/sim/findidentity');
    for (const spec of SPECS) {
      const clip = (id: string) => IDENTITY.find((c) => c.id === id)!;
      const [a, b] = [clip(`${spec.id}-a`), clip(`${spec.id}-b`)];
      const run = (c: (typeof IDENTITY)[number]) => playClip(c.play, c.def, c.seed, c.user ?? true, c.swap!, c.script);
      expect(spec.score(run(a), run(b)), spec.id).not.toBeNull();
    }
  }, 120_000);
});

describe('the result card credits the sack to the man who got it', () => {
  it("Reggie White's strip sack in the rush pair is his, not the man who tackled the recovery", async () => {
    const { IDENTITY } = await import('@/game/clips');
    const { playClip } = await import('../tools/sim/findidentity');
    const { describe: card } = await import('@/game/describe');
    const c = IDENTITY.find((x) => x.id === 'rush-a')!;
    const s = playClip(c.play, c.def, c.seed, c.user ?? true, c.swap!, c.script);
    const d = card(s);
    expect(d.headline).toMatch(/^Sacked/);
    expect(d.detail).toMatch(/^White strips him/);
  }, 60_000);
});
