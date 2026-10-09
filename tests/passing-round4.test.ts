import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, type InputFrame, type PlayState, type RouteName, type SnapshotLike } from '@/sim';
import { throwCue } from '@/sim/cue';
import { findStint, simPlayer } from '@/sim/roster';
import { cueAt } from '@/render/game/cueRing';
import { PASSING3 } from '@/game/clips';
import { FIELD_HALF_W } from '@/sim/types';

// Passing round 4 (docs/passing/PASSING4.md).

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

function play(id: string, def: string, seed: number, qb?: string): PlayState {
  const offense = qb ? { ...rosters.offense, QB: simPlayer(findStint(snap, qb, 'QB')!, 16) } : rosters.offense;
  return createPlay({ seed, offense, defense: rosters.defense, play: playById(id), def: defById(def), los: 30, toGo: 10, user: true });
}

/** Press on the cue (the first tick it says "now") and return the press, the ball out and his break (s after the snap). */
function onCue(id: string, icon: number, brkAt: number, seed: number, qb?: string, hot?: RouteName): { press: number; out: number; brk: number } {
  const s = play(id, 'cover3', seed, qb);
  let press = -1;
  let brk = -1;
  let out = -1;
  for (let k = 0; k < 600 && !s.result && (brk < 0 || out < 0); k++) {
    let f: InputFrame;
    if (s.phase === 'presnap') f = input({ snap: true, hotRoute: hot ? { icon, route: hot } : null });
    else {
      const q = throwCue(s, s.agents[s.icons[icon - 1]!]!);
      if (press < 0 && q && s.t >= q.ballOut - q.release - 1e-9) press = s.t - s.snapT;
      f = input({ throwHeld: press >= 0 && s.t - s.snapT < press + 4 / 60 ? icon : 0 });
    }
    stepPlay(s, f);
    if (out < 0 && s.phase === 'air') out = s.ball.releaseT - s.snapT;
    if (brk < 0 && s.snapT >= 0 && (s.agents[s.icons[icon - 1]!]!.route?.idx ?? 0) > brkAt) brk = s.t - s.snapT;
  }
  return { press, out, brk };
}

describe('the throw-timing cue', () => {
  it('a key pressed on the cue puts the ball out as the man comes out of his break', () => {
    for (const [id, icon, hot] of [['singleback-drive', 2], ['doubles-curls', 1, 'out'], ['doubles-curls', 1]] as [string, number, RouteName?][]) {
      const r = onCue(id, icon, 0, 1, undefined, hot);
      expect(r.press, id).toBeGreaterThan(0);
      expect(Math.abs(r.out - r.brk), id).toBeLessThan(0.06);
    }
  });

  it('moves with the QB: a quick release presses later than a long one, for the same ball', () => {
    const marino = onCue('singleback-drive', 2, 0, 1, 'Dan Marino');
    const winston = onCue('singleback-drive', 2, 0, 1, 'Jameis Winston');
    expect(marino.press - winston.press).toBeGreaterThan(0.12);
    expect(Math.abs(marino.out - winston.out)).toBeLessThan(0.05);
  });

  it('fills to his release, lights for the press, drains when it is late', () => {
    expect(cueAt(10, 0.3, 9).state).toBe('fill');
    expect(cueAt(10, 0.3, 9.8).state).toBe('now');
    expect(cueAt(10, 0.3, 10.2).state).toBe('late');
    expect(cueAt(10, 0.3, 11).state).toBe('none');
    // The fill reaches the release segment's start (1 − release/window) on the press.
    expect(cueAt(10, 0.3, 9.7).fill).toBeCloseTo(1 - 0.3 / 1.2, 2);
  });

  it('gives no cue to a screen or before the snap', () => {
    const s = play('doubles-slants', 'cover3', 1);
    expect(throwCue(s, s.agents[s.icons[0]!]!)).toBeNull();
  });
});

describe('the late out', () => {
  it('comes back to the ball inside the sideline instead of drifting to it under the ball', () => {
    const c = PASSING3.find((x) => x.id === 'p3-out-late')!;
    const s = play(c.play, c.def, c.seed);
    let at: { y: number; vy: number } | null = null;
    let last: { y: number; vy: number } | null = null;
    for (let k = 0; k < 600 && !s.result && !at; k++) {
      // (His run into the catch: the tick before it, before any hit on him.)
      if (s.phase === 'air' && s.pass) last = { y: s.agents[s.pass.target]!.pos.y, vy: s.agents[s.pass.target]!.vel.y };
      stepPlay(s, c.script(s));
      if (s.events.some((x) => x.type === 'catch' || x.type === 'drop' || x.type === 'deflection' || x.type === 'interception')) at = last;
    }
    expect(at).not.toBeNull();
    // Inside the sideline with room (not at its edge), and not running toward it.
    expect(FIELD_HALF_W - Math.abs(at!.y)).toBeGreaterThan(2.5);
    expect(at!.vy * Math.sign(at!.y)).toBeLessThan(0.5);
  });
});
