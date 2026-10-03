import { describe, expect, it } from 'vitest';
import { reveal, REVEAL_SECS, useReveal, type RevealInfo } from '@/game/tunnelReveal';
import { CrowdEnergy } from '@/render/crowd/reactions';

// The tunnel reveal's timeline (M7, src/game/tunnelReveal.ts): it holds in
// the walk-out's light until the game scene is ready, runs its shots in
// order on the scene's step, and hands back to the pre-game card; skippable.

const info = (fast: boolean): RevealInfo => ({
  star: { id: 'x', name: 'Reggie White', pos: 'DE', team: 'Eagles', decade: '1980s', ovr: 97, trait: 'Bull Rusher' },
  qb: 'Joe Montana',
  rating: 94,
  threat: 'NIGHTMARE',
  fast,
});

/** Step the reveal by `secs` in 1/30 s frames, `ready` throughout; the shots seen in order. */
function run(secs: number, ready = true): string[] {
  const seen: string[] = [];
  for (let t = 0; t < secs && reveal.active; t += 1 / 30) {
    reveal.frame(1 / 30, ready);
    const s = reveal.active ? reveal.shot : 'done';
    if (seen[seen.length - 1] !== s) seen.push(s);
  }
  if (!reveal.active && seen[seen.length - 1] !== 'done') seen.push('done');
  return seen;
}

describe('tunnel reveal', () => {
  it('holds in the light until the game scene is ready', () => {
    reveal.arm(info(false));
    expect(useReveal.getState()).toMatchObject({ open: true, shot: 'hold' });
    run(3, false);
    expect(reveal.shot).toBe('hold');
    expect(reveal.t).toBe(0);
    reveal.frame(1 / 30, true);
    expect(reveal.shot).toBe('tunnel');
    reveal.skip();
  });

  it('runs the run-out, the Beasts and the face-off, then hands back', () => {
    reveal.arm(info(false));
    const total = REVEAL_SECS.normal.tunnel + REVEAL_SECS.normal.beasts + REVEAL_SECS.normal.faceoff;
    const seen = run(total + 1);
    expect(seen).toEqual(['tunnel', 'beasts', 'faceoff', 'done']);
    expect(reveal.t).toBeGreaterThan(total - 0.1);
    expect(reveal.t).toBeLessThan(total + 0.1);
    expect(useReveal.getState().open).toBe(false);
    expect(reveal.handback).toBe(true);
    reveal.handback = false;
  });

  it('the fast version is the run-out and the face-off', () => {
    reveal.arm(info(true));
    expect(run(20)).toEqual(['tunnel', 'faceoff', 'done']);
    expect(reveal.t).toBeLessThan(REVEAL_SECS.fast.tunnel + REVEAL_SECS.fast.faceoff + 0.1);
    reveal.handback = false;
  });

  it('the graphics change on their beats', () => {
    reveal.arm(info(false));
    run(REVEAL_SECS.normal.tunnel + 0.6);
    expect(reveal.shot).toBe('beasts');
    expect(useReveal.getState().beat).toBe(1);
    run(2);
    expect(useReveal.getState().beat).toBe(2);
    reveal.skip();
    reveal.handback = false;
  });

  it('skips at any moment, straight to the pre-game', () => {
    reveal.arm(info(false));
    run(2);
    reveal.skip();
    expect(reveal.active).toBe(false);
    expect(useReveal.getState()).toMatchObject({ open: false, shot: null });
    expect(reveal.handback).toBe(true);
    reveal.handback = false;
  });

  it('gives up waiting rather than hold forever', () => {
    reveal.arm(info(false));
    expect(run(25, false)).toEqual(['hold', 'done']);
    reveal.handback = false;
  });

  it('the crowd swells from where it is, never dipping between the two roars', () => {
    const c = new CrowdEnergy(0.3);
    c.trigger('walkout', 0);
    const mid = c.value(5);
    c.trigger('beastsRoar', 5);
    for (let t = 5; t < 6; t += 0.05) expect(c.value(t)).toBeGreaterThanOrEqual(mid - 1e-9);
    expect(c.value(6)).toBeCloseTo(1);
  });
});
