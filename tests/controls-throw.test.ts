import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, input, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '@/sim';
import { Controls, holdStep, type ThrowHold } from '@/game/controls';
import { Input } from '@/input/InputManager';
import { defaultBindings } from '@/input/actions';

// Playtest 2: "A tap to throw sometimes didn't fire on a controller." A pad
// tap is one to three polled frames long; the sim ignores the receiver
// buttons for the first 0.35 s after the snap and during a windup, so a tap
// inside that window used to vanish. Now the hold is kept until the sim has
// counted it, and timed from the button's events (controls.ts holdStep).

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

describe('holdStep: a receiver tap is held until the sim has seen it', () => {
  it('holds a tap the sim ignored, then lets it go once counted', () => {
    const h: ThrowHold = { icon: 1, fresh: true, downAt: 1000, upAt: 1030, extra: 0 };
    // The fresh tick always goes.
    expect(holdStep(h, false, { icon: 0, ticks: 0 })).toBe(true);
    // Button up, the sim hasn't counted it (inside its 0.35 s): still held.
    expect(holdStep(h, false, { icon: 0, ticks: 0 })).toBe(true);
    expect(holdStep(h, false, { icon: 0, ticks: 0 })).toBe(true);
    // Counted for the button's two ticks (30 ms): released, so the sim throws.
    expect(holdStep(h, false, { icon: 1, ticks: 2 })).toBe(false);
  });

  it("runs on a little to match the button's time when frames dropped ticks, and no further", () => {
    const h: ThrowHold = { icon: 2, fresh: false, downAt: 0, upAt: 400, extra: 0 };
    // Down 400 ms (24 ticks), but a long frame left the sim at 10: at most 6 more.
    let held = 0;
    for (let k = 0; k < 20 && holdStep(h, false, { icon: 2, ticks: 10 + held }); k++) held++;
    expect(held).toBe(6);
  });

  it('lets a counted hold go on the tick the button comes up', () => {
    const h: ThrowHold = { icon: 3, fresh: false, downAt: 0, upAt: 200, extra: 0 };
    expect(holdStep(h, true, { icon: 3, ticks: 11 })).toBe(true);
    expect(holdStep(h, false, { icon: 3, ticks: 12 })).toBe(false);
  });
});

describe('a pad tap early in the drop throws (through the real sim)', () => {
  function run(feedSim: boolean): { thrownAt: number | null } {
    Input.setBindings(defaultBindings('kb'), defaultBindings('pad'));
    const pop = Input.pushContext('pocket');
    const controls = new Controls();
    try {
      const s = createPlay({ seed: 11, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-slants'), def: defById('cover3'), los: 30, toGo: 10, user: true });
      stepPlay(s, input({ snap: true }));
      for (let k = 0; k < 6; k++) stepPlay(s, NEUTRAL);
      // A's press and release land between two ticks (a quick tap on a polled pad); the button isn't held at the next sample.
      const raw = Input as unknown as { fire(code: string, repeat: boolean, device: string, time: number): boolean; upAt: Map<string, number> };
      raw.fire('Pad:A', false, 'gamepad', 100);
      raw.upAt.set('Pad:A', 130);
      let thrownAt: number | null = null;
      for (let k = 0; k < 90 && thrownAt === null; k++) {
        stepPlay(s, controls.sample(feedSim ? s.hold : null));
        if (s.windup || s.phase === 'air') thrownAt = s.t - s.snapT;
      }
      return { thrownAt };
    } finally {
      controls.dispose();
      pop();
    }
  }

  it('was lost when the hold was let go before the sim counted it', () => {
    expect(run(false).thrownAt).toBeNull();
  });

  it('now throws as soon as he can (0.35 s after the snap)', () => {
    const t = run(true).thrownAt;
    expect(t).not.toBeNull();
    expect(t!).toBeLessThan(0.45);
  });
});
