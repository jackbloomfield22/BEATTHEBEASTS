import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, input, playById, practiceRosters, stepPlay, type InputFrame, type PlayState, type RouteName, type SnapshotLike } from '@/sim';
import { throwCue } from '@/sim/cue';
import { bucket, planThrow } from '@/sim/passing';
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

describe('the deep ball', () => {
  /** The go (trips four verticals, the outside man) 1.3 s in: the QB set, the man 12 yd down the field with the corner on him. */
  function atGo(qb: string, seed = 3): { s: PlayState; rec: ReturnType<PlayState['agents']['at']> & object } {
    const s = play('trips-four-verts', 'cover1', seed, qb);
    for (let k = 0; k < 600 && !s.result && (s.snapT < 0 || s.t - s.snapT < 1.3); k++) stepPlay(s, s.phase === 'presnap' ? input({ snap: true }) : input({}));
    return { s, rec: s.agents[s.icons[3]!]! };
  }

  it('an accurate deep passer puts it in the bucket (ahead and away from the man on him); a scattershot arm throws it at him', () => {
    const m = atGo('Joe Montana');
    const qbM = m.s.agents[m.s.qb]!;
    const spot = { x: m.rec.pos.x + 18, y: m.rec.pos.y };
    const bM = bucket(m.s, qbM, m.rec, spot, { x: 1, y: 0 }, { x: 0, y: 0 });
    const p = atGo('Chad Pennington');
    const bP = bucket(p.s, p.s.agents[p.s.qb]!, p.rec, spot, { x: 1, y: 0 }, { x: 0, y: 0 });
    expect(Math.hypot(bM.x, bM.y)).toBeGreaterThan(0.5);
    expect(Math.hypot(bP.x, bP.y)).toBeLessThan(0.3 * Math.hypot(bM.x, bM.y));
    // Away from the nearest defender, across his run.
    let near = m.s.agents[m.s.def[0]!]!;
    for (const i of m.s.def) if (Math.hypot(m.s.agents[i]!.pos.x - m.rec.pos.x, m.s.agents[i]!.pos.y - m.rec.pos.y) < Math.hypot(near.pos.x - m.rec.pos.x, near.pos.y - m.rec.pos.y)) near = m.s.agents[i]!;
    if (Math.abs(near.pos.y - m.rec.pos.y) > 0.3) expect(Math.sign(bM.y)).toBe(-Math.sign(near.pos.y - m.rec.pos.y));
    // A placement the player asked for is his own.
    expect(bucket(m.s, qbM, m.rec, spot, { x: 1, y: 0 }, { x: 0.8, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("a weak arm's long ball comes up short of where he meant it; a cannon's doesn't", () => {
    const along = (qb: string) => {
      let sum = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const g = atGo(qb, seed);
        const q = g.s.agents[g.s.qb]!;
        const plan = planThrow(g.s, q, g.rec, 0, { x: 0, y: 0 }, 0, false);
        const ux = plan.meant.x - plan.from.x;
        const uy = plan.meant.y - plan.from.y;
        const k = Math.hypot(ux, uy);
        sum += ((plan.to.x - plan.meant.x) * ux + (plan.to.y - plan.meant.y) * uy) / k;
      }
      return sum / 24;
    };
    expect(along('Chad Pennington')).toBeLessThan(along('Dan Marino') - 0.5);
  });
});
