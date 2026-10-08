import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, TICK, type InputFrame, type PlayState, type RouteName, type SnapshotLike } from '@/sim';
import { comesBack, timingQb } from '@/sim/passing';
import { userThrow } from '@/game/clips';

// Passing round 3 (docs/passing/PASSING3.md): the player's own throws. The
// key starts the arm, a hold chooses the touch, a key on the drop throws on
// the plant; the other receivers run their routes through the throw; the
// curl and comeback come back to the ball; the QB's accuracy is in his deep
// ball's timing.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);

function play(id: string, def: string, seed: number): PlayState {
  return createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play: playById(id), def: defById(def), los: 30, toGo: 10, user: true });
}
/** Run until the throw (or n ticks), returning the tick it left. */
function toThrow(s: PlayState, f: (s: PlayState) => InputFrame, n = 600): number {
  for (let k = 0; k < n && !s.result; k++) {
    stepPlay(s, f(s));
    if (s.events.some((e) => e.type === 'throw')) return s.tick;
  }
  return -1;
}
const since = (s: PlayState) => (s.snapT < 0 ? -1 : Math.round((s.t - s.snapT) / TICK));

describe('the key starts the throw', () => {
  it('a tap goes with his arm (his release time from the press), a hold past it waits for the key, a full touch goes by itself', () => {
    const at = 90;
    const tap = play('doubles-curls', 'cover3', 1);
    const tapT = toThrow(tap, userThrow({ icon: 1, at, hold: 4 }));
    const qb = tap.agents[tap.qb]!;
    const rel = Math.round(0.3 / TICK);
    // From the press: his release time (a tap's length no longer added on).
    expect((tapT - Math.round(tap.snapT / TICK) - at) * TICK).toBeGreaterThan(rel * TICK - 0.05);
    expect(tap.events.find((e) => e.type === 'throw')!.data!.kind).toBe('driven');
    void qb;
    // Held past his release: the ball goes when the key comes up, with touch.
    const hold = play('doubles-curls', 'cover3', 1);
    const holdT = toThrow(hold, userThrow({ icon: 1, at, hold: 33 }));
    expect(holdT - Math.round(hold.snapT / TICK) - at).toBeGreaterThanOrEqual(33);
    expect(holdT - Math.round(hold.snapT / TICK) - at).toBeLessThan(33 + 4);
    expect(hold.events.find((e) => e.type === 'throw')!.data!.kind).toBe('touch');
    // Held and never let go: the touch fills and it goes (it used to sit in his hand for good).
    const full = play('doubles-curls', 'cover3', 1);
    const fullT = toThrow(full, (s) => (s.phase === 'presnap' ? input({ snap: true }) : input({ throwHeld: since(s) >= at ? 1 : 0 })));
    expect(fullT).toBeGreaterThan(0);
  });

  it('a key pressed on the drop throws on the plant, and his shoulders open to the man on the way', () => {
    const s = play('singleback-drive', 'cover3', 2);
    const set = s.setup.play.drop.set;
    const press = 30;
    const t = toThrow(s, userThrow({ icon: 2, at: press }));
    expect((t - Math.round(s.snapT / TICK)) * TICK).toBeGreaterThanOrEqual(set - TICK);
    // Feet set: no "feet not set" on the ball.
    expect(s.events.find((e) => e.type === 'throw')!.data!.fPlatform).toBe(1);
  });
});

describe('the routes run through the throw', () => {
  it('on four verticals, the other three keep going up the field with the ball in the air', () => {
    for (const seed of [1, 2, 3]) {
      const s = play('trips-four-verts', 'cover3', seed);
      const f = userThrow({ icon: 4, at: 75, hold: 16 });
      while (!s.result && s.phase !== 'air') stepPlay(s, f(s));
      for (let k = 0; k < 40 && s.phase === 'air'; k++) stepPlay(s, f(s));
      if (s.phase !== 'air') continue;
      const tgt = s.ball.target;
      for (const i of s.icons) {
        const a = s.agents[i]!;
        if (i === tgt || a.slot === 'RB') continue;
        // Still up the field: heading within ~25° of straight downfield, at speed.
        expect(a.vel.x / Math.hypot(a.vel.x, a.vel.y)).toBeGreaterThan(0.9);
        expect(Math.hypot(a.vel.x, a.vel.y)).toBeGreaterThan(7);
      }
    }
  });
});

describe('coming back to the ball', () => {
  it('the curl and the comeback turn back to the line; a flat and a spot do not', () => {
    const r = (pts: [number, number][], sit: boolean[]) => ({ pts: pts.map(([x, y]) => ({ x, y })), sit });
    expect(comesBack(r([[42, 14], [40, 12.5]], [false, true]))).toBe(true);
    expect(comesBack(r([[34, 14], [33, 14]], [false, true]))).toBe(true);
    expect(comesBack(r([[31.5, 2], [34, 10], [34.5, 12]], [false, false, true]))).toBe(false);
  });

  it('a curl or comeback receiver takes it coming back to it, not standing', () => {
    for (const [route, at] of [['curl', 96], ['comeback', 116]] as [RouteName, number][]) {
      let moving = 0;
      let n = 0;
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const s = play('doubles-curls', 'cover3', seed);
        const f = userThrow({ icon: 1, at, hot: route === 'comeback' ? 'comeback' : undefined });
        let speed = -1;
        let back = 0;
        for (let k = 0; k < 600 && !s.result; k++) {
          stepPlay(s, f(s));
          const c = s.events.find((e) => e.type === 'catch');
          if (c && speed < 0) {
            const a = s.agents[c.who![0]!]!;
            speed = Math.hypot(a.vel.x, a.vel.y);
            back = -a.vel.x;
          }
        }
        if (speed < 0) continue;
        n++;
        // Coming back down the field to it (toward the line), on the move.
        if (speed > 2 && back > 1) moving++;
      }
      expect(n).toBeGreaterThan(3);
      expect(moving / n, route).toBeGreaterThan(0.6);
    }
  });
});

describe("the QB's deep ball timing", () => {
  it('an accurate passer leads his man better down the field; short throws are the route', () => {
    expect(timingQb(99, 30)).toBeCloseTo(0.7, 5);
    expect(timingQb(85, 30)).toBeCloseTo(1, 5);
    expect(timingQb(70, 30)).toBeGreaterThan(1.15);
    expect(timingQb(99, 6)).toBe(1);
    expect(timingQb(70, 6)).toBe(1);
    expect(timingQb(99, 14)).toBeGreaterThan(timingQb(99, 30));
  });
});
