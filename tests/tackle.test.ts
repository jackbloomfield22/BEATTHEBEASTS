import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPlay, defById, playById, practiceRosters, type SnapshotLike } from '@/sim';
import { findStint, simPlayer } from '@/sim/roster';
import { effects } from '@/sim/effects';
import { bodyOf, layDown } from '@/sim/bodies';
import { feetStep, grab, pileStep, type HoldKind } from '@/sim/tackle';
import type { Agent, SimPlayer } from '@/sim/types';
import type { PlayState } from '@/sim/state';

// The tackle as a resolution over several frames (docs/physics/TACKLING.md):
// the bodies (bodies.ts), the hit and the hold and the fall (tackle.ts).
// Each picture is two or three men and the physics alone: a big back falls
// forward, a small receiver met square goes back (and keeps his forward
// progress), a second man finishes it sooner, an arm on a man at speed
// gives, a body on the ground gets hurdled or tripped over.

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const who = (name: string, pos: string): SimPlayer => simPlayer(findStint(snap, name, pos)!, 1);

function dress(a: Agent, p: SimPlayer): void {
  a.p = p;
  a.fx = effects(p);
}

/** `carrier` with the ball at x 40 running +x at `v`; defenders placed by the caller. */
function picture(carrier: SimPlayer, v: number, seed = 3) {
  const s = createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-slants'), def: defById('cover3'), los: 30, toGo: 10, user: false });
  const c = s.agents[s.icons[0]!]!;
  dress(c, carrier);
  c.pos = { x: 40, y: 0 };
  c.vel = { x: v, y: 0 };
  c.face = 0;
  s.ball.mode = 'held';
  s.ball.holder = c.i;
  s.carrier = c.i;
  s.phase = 'carrier';
  s.snapT = 0;
  s.t = 2;
  for (const i of s.def) s.agents[i]!.pos = { x: 10, y: s.agents[i]!.pos.y };
  const ds = s.def.map((i) => s.agents[i]!);
  return { s, c, ds };
}

function place(d: Agent, p: SimPlayer, x: number, y: number, vx: number, vy: number): Agent {
  dress(d, p);
  d.pos = { x, y };
  d.vel = { x: vx, y: vy };
  d.face = Math.atan2(-y, 40 - x);
  return d;
}

/** Run the pile out: the spot, how long it took, where his body ended. */
function resolve(s: PlayState, c: Agent, join?: { at: number; d: Agent; kind: HoldKind }) {
  const t0 = s.t;
  for (let k = 0; k < 300; k++) {
    s.t += 1 / 60;
    if (join && Math.abs(s.t - t0 - join.at) < 1e-6 + 1 / 120 && s.pile) grab(s, c, join.d, join.kind);
    if (!s.pile) return { state: 'free' as const, spot: NaN, t: s.t - t0, x: c.pos.x };
    const r = pileStep(s, c, 0, 0);
    if (r.state === 'down' || r.state === 'stood') return { state: r.state, spot: r.spot, t: s.t - t0, x: c.pos.x };
  }
  return { state: 'held' as const, spot: NaN, t: s.t - t0, x: c.pos.x };
}

describe('bodies', () => {
  it('fit the drawn model: pads across, the chest front to back (docs/m65/BODIES.md)', () => {
    const yd = 0.9144;
    // Roster medians: WR 6'0" 195 → pad half-width 0.281 m; LB 6'2" 235 → 0.357 m; OL 6'4" 300 → 0.406 m.
    expect(Math.abs(bodyOf({ ...who('Wes Welker', 'WR'), heightIn: 72, weightLb: 195 }).radius * yd - 0.281)).toBeLessThan(0.008);
    expect(Math.abs(bodyOf({ ...who('Ray Lewis', 'LB'), heightIn: 74, weightLb: 235 }).radius * yd - 0.357)).toBeLessThan(0.008);
    // A back is broader than he is deep; a lineman and the QB work with their hands out (round).
    const rb = bodyOf(who('Barry Sanders', 'RB'));
    expect(rb.depth).toBeLessThan(rb.radius * 0.7);
    const qb = bodyOf(who('Joe Montana', 'QB'));
    expect(qb.depth).toBe(qb.radius);
  });
});

describe('the tackle', () => {
  it('a big back wrapped by a corner falls forward for the extra yard', () => {
    const { s, c, ds } = picture(who('Jerome Bettis', 'RB'), 6);
    const d = place(ds.find((a) => a.p.pos === 'CB')!, who('Ty Law', 'CB'), 41, 0.3, -1, 0);
    grab(s, c, d, 'wrap');
    const r = resolve(s, c);
    expect(r.state).toBe('down');
    // Contact at 40 (the ball's nose at 40.4): a yard and more after it, half a second or so to get him down.
    expect(r.spot - 40.4).toBeGreaterThan(0.8);
    expect(r.t).toBeGreaterThan(0.35);
    expect(r.t).toBeLessThan(1.2);
    const fall = s.events.find((e) => e.type === 'tackle');
    expect(fall?.data?.fall).toBe('forward');
  });

  it('a small receiver met square by a safety coming downhill goes back, and keeps his forward progress', () => {
    const { s, c, ds } = picture(who('Tyreek Hill', 'WR'), 5);
    const d = place(ds.find((a) => a.p.pos === 'S')!, who('Kam Chancellor', 'S'), 41, 0, -7, 0);
    grab(s, c, d, 'hit');
    const r = resolve(s, c);
    expect(r.state === 'down' || r.state === 'stood').toBe(true);
    // Driven back: his body ends behind where he was hit...
    expect(r.x).toBeLessThan(40);
    // ...and the ball goes where his forward progress stopped (the nose at the hit), not where he landed.
    expect(r.spot).toBeCloseTo(40.4, 1);
  });

  it('the same back gains more on a corner than on a linebacker, and a big back more than a small receiver', () => {
    const run = (carrier: SimPlayer, tackler: SimPlayer, pos: string) => {
      const { s, c, ds } = picture(carrier, 6);
      const d = place(ds.find((a) => a.p.pos === pos)!, tackler, 41, 0.3, -1, 0);
      grab(s, c, d, 'wrap');
      return resolve(s, c).spot - 40.4;
    };
    const bettisCB = run(who('Jerome Bettis', 'RB'), who('Ty Law', 'CB'), 'CB');
    const bettisLB = run(who('Jerome Bettis', 'RB'), who('Ray Lewis', 'LB'), 'LB');
    const welkerCB = run(who('Wes Welker', 'WR'), who('Ty Law', 'CB'), 'CB');
    expect(bettisCB).toBeGreaterThan(bettisLB);
    expect(bettisCB).toBeGreaterThan(welkerCB);
  });

  it('a second tackler finishes it sooner and the pile moves with him', () => {
    const one = (() => {
      const { s, c, ds } = picture(who('Jerome Bettis', 'RB'), 6);
      const d = place(ds.find((a) => a.p.pos === 'CB')!, who('Ty Law', 'CB'), 41, 0.3, -1, 0);
      grab(s, c, d, 'wrap');
      return resolve(s, c);
    })();
    const { s, c, ds } = picture(who('Jerome Bettis', 'RB'), 6);
    const d = place(ds.find((a) => a.p.pos === 'CB')!, who('Ty Law', 'CB'), 41, 0.3, -1, 0);
    const d2 = place(ds.find((a) => a.p.pos === 'LB')!, who('Ray Lewis', 'LB'), 41.2, -0.6, -5, 1);
    grab(s, c, d, 'wrap');
    const two = resolve(s, c, { at: 0.1, d: d2, kind: 'hit' });
    expect(two.t).toBeLessThan(one.t);
    expect(two.spot).toBeLessThan(one.spot);
    const fall = s.events.find((e) => e.type === 'tackle');
    expect(Number(fall?.data?.gang)).toBe(2);
  });

  it('an arm on a back at full speed from the side gives: a broken tackle, and it costs him a little', () => {
    const { s, c, ds } = picture(who('Barry Sanders', 'RB'), 8);
    const d = place(ds.find((a) => a.p.pos === 'CB')!, who('Ty Law', 'CB'), 40, 1, 0, -3);
    const held = grab(s, c, d, 'arm');
    expect(held).toBe(false);
    expect(s.pile).toBeNull();
    expect(s.events.some((e) => e.type === 'brokenTackle' && e.who?.[0] === c.i)).toBe(true);
    expect(c.vel.x).toBeLessThan(8);
    expect(c.vel.x).toBeGreaterThan(6);
  });

  it('a big hit takes his feet at once; the hit is in the event for the render', () => {
    const { s, c, ds } = picture(who('Barry Sanders', 'RB'), 6);
    const d = place(ds.find((a) => a.p.pos === 'S')!, who('Kam Chancellor', 'S'), 41, 0, -7, 0);
    grab(s, c, d, 'big');
    const hit = s.events.find((e) => e.type === 'hit');
    expect(hit?.data?.kind).toBe('big');
    expect(Number(hit?.data?.imp)).toBeGreaterThan(500);
    const r = resolve(s, c);
    expect(r.t).toBeLessThan(0.45);
  });
});

describe('the tackling videos (docs/physics): each clip still shows its moment', () => {
  it('the same snap as the browser sets it up', async () => {
    const { PHYSICS } = await import('@/game/clips');
    const { SPECS } = await import('../tools/sim/findtackles');
    const { playClip } = await import('../tools/sim/findidentity');
    for (const c of PHYSICS) {
      const spec = SPECS.find((x) => x.id === c.id)!;
      const s = playClip(c.play, c.def, c.seed, c.user ?? true, c.swap!, c.script);
      expect(spec.score(s), `${c.id}: ${spec.note(s)}`).not.toBeNull();
    }
  }, 120_000);
});

describe('bodies on the ground', () => {
  it('an AI carrier with the spring hurdles a man lying across his run; without it he stumbles through', () => {
    for (const [name, pos, over] of [['Saquon Barkley', 'RB', true], ['Jerome Bettis', 'RB', false]] as const) {
      const { s, c, ds } = picture(who(name, pos), 7);
      const g = ds.find((a) => a.p.pos === 'CB')!;
      g.pos = { x: 41.8, y: 0.5 };
      g.down = true;
      g.lie = layDown(g, 0, -1);
      let hurdled = false;
      feetStep(s, c, true, () => {
        hurdled = true;
        return true;
      });
      expect(hurdled).toBe(over);
      if (!over) {
        c.pos = { x: 41.8, y: 0 };
        feetStep(s, c, true, () => true);
        expect(s.events.some((e) => e.type === 'move' && e.data?.move === 'stumble')).toBe(true);
      }
    }
  });
});
