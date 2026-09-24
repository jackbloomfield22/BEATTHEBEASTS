import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createPlay,
  DEF_CALLS,
  defById,
  effects,
  hashPlay,
  HOT_ROUTES,
  input,
  NEUTRAL,
  PLAYS,
  playById,
  practiceRosters,
  ROUTES,
  runToWhistle,
  solveSprint,
  speedToForty,
  accelToSplit,
  stepPlay,
  TICK,
  type InputFrame,
  type OffSlot,
  type PlayState,
  type SimPlayer,
  type SnapshotLike,
} from '@/sim';
import { flyFor, solveLaunch } from '@/sim/ball';
import { steer } from '@/sim/movement';
import { bufferedMove, cutWeight, jukeSide, outAt } from '@/sim/play';
import { BACK_X, END_X, FIELD_HALF_W, GOAL_X, OOB_FOOT, STEP_OUT } from '@/sim/types';
import { applyImpulse, startMove, tickMoves } from '@/sim/contact';
import { simPlayer } from '@/sim/roster';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const setup = (seed: number, play = PLAYS[0]!, def = DEF_CALLS[0]!, user = false) =>
  createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play, def, los: 35, toGo: 10, user });

describe('sim: determinism', () => {
  const run = (seed: number, script: (s: PlayState) => InputFrame) => {
    const s = setup(seed, playById('trips-stick'), defById('cover3'), true);
    const hashes: number[] = [];
    while (!s.result && s.tick < 60 * 20) {
      stepPlay(s, script(s));
      hashes.push(hashPlay(s));
    }
    return { hashes, result: s.result };
  };
  const script = (s: PlayState): InputFrame => input({ snap: s.tick === 0, throwHeld: s.tick > 100 && s.tick < 112 ? 1 : 0, move: s.tick > 40 && s.tick < 80 ? { x: 0, y: 0.5 } : { x: 0, y: 0 } });

  it('replays bit-for-bit from the seed and the input frames', () => {
    const a = run(42, script);
    const b = run(42, script);
    expect(a.hashes.length).toBeGreaterThan(60);
    expect(b.hashes).toEqual(a.hashes);
    expect(b.result).toEqual(a.result);
  });

  it('differs with the seed', () => {
    expect(run(43, script).hashes).not.toEqual(run(42, script).hashes);
  });
});

describe('sim: physics from the ratings', () => {
  it('runs the 40 his speed rating was built from', () => {
    for (const speed of [99, 90, 76, 60]) {
      const p: SimPlayer = { id: 't', name: 'T', pos: 'WR', num: 1, attrs: { speed, acceleration: speed, agility: 80 }, heightIn: 73, weightLb: 200 };
      const s = setup(1);
      const a = s.agents[s.slot.X!]!;
      a.fx = effects(p);
      a.pos = { x: 0, y: 0 };
      a.vel = { x: 0, y: 0 };
      a.stamina = 1;
      let t = 0;
      while (a.pos.x < 40 && t < 10) {
        steer(a, { x: 100, y: 0 });
        t += TICK;
      }
      expect(t).toBeCloseTo(speedToForty(speed), 1);
    }
  });

  it('solves sprint parameters that reproduce the 40 and the 10-yard split', () => {
    const { vmax, tau } = solveSprint(speedToForty(95), accelToSplit(92));
    expect(vmax).toBeGreaterThan(9.5);
    expect(vmax).toBeLessThan(12.5);
    expect(tau).toBeGreaterThan(0.4);
    expect(tau).toBeLessThan(1.2);
  });

  it('solves a throw that lands where it was aimed, drag included', () => {
    const from = { x: 28, y: 0, z: 2.1 };
    const to = { x: 60, y: -12, z: 1.25 };
    const v0 = solveLaunch(from, to, 1.4);
    const hit = flyFor(from, v0, 1.4);
    expect(Math.hypot(hit.x - to.x, hit.y - to.y, hit.z - to.z)).toBeLessThan(0.05);
  });
});

describe('sim: a play snap to whistle', () => {
  it('every play and coverage reaches a whistle with a result (AI on both sides)', () => {
    for (const play of PLAYS) {
      for (const def of DEF_CALLS) {
        for (let k = 0; k < 6; k++) {
          const s = runToWhistle(setup(100 + k * 31, play, def), () => NEUTRAL);
          expect(s.result, `${play.id} vs ${def.id}`).not.toBeNull();
          expect(s.result!.reason).not.toBe('timeout');
          expect(s.t).toBeLessThan(15);
          expect(s.events.some((e) => e.type === 'snap')).toBe(true);
          expect(s.events.some((e) => e.type === 'whistle')).toBe(true);
        }
      }
    }
  });

  it('a user throw goes where the icon says: snap, throw, catch or incomplete', () => {
    const s = setup(7, playById('trips-stick'), defById('cover3'), true);
    let threw = false;
    runToWhistle(s, (st) => {
      if (st.phase === 'pocket' && !threw && st.t > 1.3) {
        threw = st.hold.ticks > 3;
        return input({ throwHeld: threw ? 0 : 1 });
      }
      return input({ snap: st.tick === 0 });
    });
    const throwEv = s.events.find((e) => e.type === 'throw');
    expect(throwEv).toBeDefined();
    expect(throwEv!.who![1]).toBe(s.icons[0]);
    expect(['tackle', 'incomplete', 'touchdown', 'outOfBounds']).toContain(s.result!.reason);
  });

  it('the pocket holds about as long as a real one when the QB never throws', () => {
    const times: number[] = [];
    for (let k = 0; k < 40; k++) {
      const s = setup(900 + k, PLAYS[k % PLAYS.length]!, DEF_CALLS[k % DEF_CALLS.length]!, true);
      runToWhistle(s, (st) => input({ snap: st.tick === 0 }));
      times.push(s.t);
    }
    times.sort((a, b) => a - b);
    const median = times[20]!;
    // Tuned for play (M5.5): a QB who never throws goes down at a median of
    // ~4.5 s at Pro against the four-man rush.
    expect(median).toBeGreaterThan(4.1);
    expect(median).toBeLessThan(4.9);
  });
});

describe('sim: pass protection follows the linemen', () => {
  it('the best pass-blocking unit holds clearly longer than the worst', () => {
    const OL = ['LT', 'LG', 'C', 'RG', 'RT'] as const;
    const grade = (ids: string[]) => ids.reduce((a, id) => {
      const p = simPlayer(snap.entries.find((e) => e.id === id)!, 70);
      return a + p.attrs.pbPower! + p.attrs.pbFinesse! + p.attrs.anchor!;
    }, 0);
    const units = snap.units.filter((u) => u.linemen.length >= 5).sort((a, b) => grade(a.linemen) - grade(b.linemen));
    const median = (ids: string[]) => {
      const offense = { ...rosters.offense };
      OL.forEach((k, j) => (offense[k] = simPlayer(snap.entries.find((e) => e.id === ids[j])!, 70 + j)));
      const ts: number[] = [];
      for (let k = 0; k < 60; k++) {
        const s = createPlay({ seed: 9000 + k * 7919, offense, defense: rosters.defense, play: PLAYS[k % PLAYS.length]!, def: DEF_CALLS[k % DEF_CALLS.length]!, los: 35, toGo: 10, user: true });
        runToWhistle(s, (st) => input({ snap: st.tick === 0 }));
        ts.push(s.t);
      }
      return ts.sort((a, b) => a - b)[30]!;
    };
    const best = median(units[units.length - 1]!.linemen);
    const worst = median(units[0]!.linemen);
    expect(best - worst).toBeGreaterThan(0.5);
  });
});

describe('sim: outcomes stay in football ranges (AI vs AI, the all-time Beasts defense)', () => {
  const stats = (() => {
    let att = 0;
    let comp = 0;
    let int = 0;
    let sacks = 0;
    let plays = 0;
    for (const play of PLAYS) {
      for (const def of DEF_CALLS) {
        for (let k = 0; k < 16; k++) {
          const s = runToWhistle(setup(5000 + k * 7919, play, def), () => NEUTRAL);
          const r = s.result!;
          plays++;
          if (r.sack) sacks++;
          if (r.pass?.attempted) {
            att++;
            if (r.pass.complete) comp++;
            if (r.pass.intercepted) int++;
          }
        }
      }
    }
    return { comp: comp / att, int: int / att, sack: sacks / plays };
  })();
  it('completion, interception and sack rates', () => {
    expect(stats.comp).toBeGreaterThan(0.45);
    expect(stats.comp).toBeLessThan(0.75);
    expect(stats.int).toBeLessThan(0.08);
    expect(stats.sack).toBeLessThan(0.12);
  });
});

describe('sim: a 10-point attribute gap is measurable (GDD §18 sensitivity)', () => {
  const clone = (p: SimPlayer, patch: Record<string, number>): SimPlayer => ({ ...p, attrs: { ...p.attrs, ...patch } });

  it('Speed: a faster receiver gets deeper on the corner covering him (a go route against press man)', () => {
    // Winning a go route is getting even with or past the corner (he plays a
    // step over the top), so measure the receiver's depth relative to him.
    const past = (speed: number) => {
      let sum = 0;
      for (let k = 0; k < 12; k++) {
        const off = { ...rosters.offense, Z: clone(rosters.offense.Z, { speed, acceleration: speed }) };
        const s = createPlay({ seed: 300 + k, offense: off, defense: rosters.defense, play: playById('trips-four-verts'), def: defById('cover1'), los: 35, toGo: 10, user: true });
        while (s.t < 2.5) stepPlay(s, input({ snap: s.tick === 0 }));
        sum += s.agents[s.slot.Z!]!.pos.x - s.agents[s.slot.RCB!]!.pos.x;
      }
      return sum / 12;
    };
    expect(past(95) - past(85)).toBeGreaterThan(0.3);
  });

  it('Pass rush: better Power/Finesse Moves win their blocks sooner', () => {
    const shedFor = (moves: number) => {
      let sum = 0;
      let n = 0;
      for (let k = 0; k < 30; k++) {
        const def = { ...rosters.defense };
        for (const slot of ['LE', 'RE', 'LDT', 'RDT'] as const) def[slot] = clone(def[slot], { powerMoves: moves, finesseMoves: moves, blockShed: moves });
        const s = createPlay({ seed: 700 + k, offense: rosters.offense, defense: def, play: PLAYS[k % PLAYS.length]!, def: defById('cover3'), los: 35, toGo: 10, user: true });
        while (!s.result && s.t < 8) {
          stepPlay(s, input({ snap: s.tick === 0 }));
          const shed = s.events.find((e) => e.type === 'shed');
          if (shed) {
            sum += shed.t;
            n++;
            break;
          }
        }
      }
      return sum / Math.max(1, n);
    };
    expect(shedFor(70) - shedFor(80)).toBeGreaterThan(0.08);
  });
});

describe('sim: one-button juke', () => {
  const carrierOf = () => {
    const s = setup(3, playById('trips-stick'), defById('cover3'), true);
    const c = s.agents[s.icons[0]!]!;
    c.vel = { x: 6, y: 0 };
    return { s, c };
  };
  it('goes to the side he steers, relative to his heading', () => {
    const { s, c } = carrierOf();
    expect(jukeSide(s, c, { x: 0.3, y: 1 }, 1)).toBe('jukeL');
    expect(jukeSide(s, c, { x: 0.3, y: -1 }, 1)).toBe('jukeR');
    // Running back toward his own goal, "left on the field" is his right.
    c.vel = { x: -6, y: 0 };
    expect(jukeSide(s, c, { x: 0, y: 1 }, 1)).toBe('jukeR');
  });
  it('without a steer, away from the nearest free defender in front of him', () => {
    const { s, c } = carrierOf();
    for (const i of s.def) s.agents[i]!.down = true;
    const d = s.agents[s.def[0]!]!;
    d.down = false;
    d.pos = { x: c.pos.x + 3, y: c.pos.y + 1 }; // ahead, to his left
    expect(jukeSide(s, c, { x: 1, y: 0 }, 1)).toBe('jukeR');
    d.pos = { x: c.pos.x + 3, y: c.pos.y - 1 }; // ahead, to his right
    expect(jukeSide(s, c, { x: 1, y: 0 }, 1)).toBe('jukeL');
  });
});

describe('sim: carrier feel (M5.5)', () => {
  const carrier = () => {
    const s = setup(3, playById('trips-stick'), defById('cover3'), true);
    const c = s.agents[s.icons[0]!]!;
    c.vel = { x: c.fx.vmax, y: 0 };
    return { s, c };
  };
  it('a juke builds its sidestep over the plant instead of in one tick', () => {
    const { s, c } = carrier();
    expect(startMove(s, c, 'jukeL')).toBe(true);
    expect(c.vel.y).toBe(0);
    applyImpulse(c);
    const one = c.vel.y;
    expect(one).toBeGreaterThan(0);
    for (let k = 0; k < 10; k++) applyImpulse(c);
    expect(c.impulse).toBeNull();
    expect(c.vel.y).toBeGreaterThan(one * 4);
  });
  it('a move pressed during the last one fires when he can start it (the buffer)', () => {
    const { s, c } = carrier();
    const tick = () => {
      tickMoves(c);
      bufferedMove(s, c, null);
    };
    expect(startMove(s, c, 'jukeL')).toBe(true);
    // Spin pressed 5 ticks before the juke's cooldown ends: buffered, then fires.
    while (c.moveCooldown > 5) tickMoves(c);
    bufferedMove(s, c, 'spin');
    expect(c.moveBuf?.mv).toBe('spin');
    for (let k = 0; k < 6; k++) tick();
    expect(c.move).toBe('spin');
    expect(c.moveBuf).toBeNull();
    // Pressed too early (more than the buffer before he can): dropped.
    while (c.moveCooldown > 20) tickMoves(c);
    bufferedMove(s, c, 'jukeR');
    for (let k = 0; k < 12; k++) tick();
    expect(c.moveBuf).toBeNull();
    expect(c.move === 'jukeR').toBe(false);
  });
  it('a sharp cut at speed slows him into the plant; a gentle bend does not', () => {
    const { c } = carrier();
    const v = c.fx.vmax;
    const bend = cutWeight(c, { x: v, y: v * 0.2 });
    expect(Math.hypot(bend.x, bend.y)).toBeCloseTo(Math.hypot(v, v * 0.2), 5);
    const cut = cutWeight(c, { x: 0, y: v });
    expect(Math.hypot(cut.x, cut.y) / v).toBeCloseTo(0.77, 1);
    const back = cutWeight(c, { x: -v, y: 0 });
    expect(Math.hypot(back.x, back.y) / v).toBeCloseTo(0.6, 2);
  });
});

describe('sim: the field has edges (M5.5)', () => {
  // Every player within a step of the field while the play is live, and no
  // live ball carrier past an end line: AI plays everywhere on the field,
  // and a user who runs for the sideline and the back of the end zone.
  const bounds = (s: PlayState) => {
    for (const a of s.agents) {
      expect(Math.abs(a.pos.y)).toBeLessThanOrEqual(FIELD_HALF_W + STEP_OUT + 1e-6);
      expect(a.pos.x).toBeLessThanOrEqual(END_X + STEP_OUT + 1e-6);
      expect(a.pos.x).toBeGreaterThanOrEqual(BACK_X - STEP_OUT - 1e-6);
    }
    if (s.carrier >= 0) {
      const c = s.agents[s.carrier]!;
      expect(c.pos.x).toBeLessThanOrEqual(END_X);
      expect(c.pos.x).toBeGreaterThanOrEqual(BACK_X);
    }
  };
  const live = (s: PlayState, inputAt: (s: PlayState) => InputFrame) => {
    for (let k = 0; k < 60 * 30 && !s.result; k++) {
      stepPlay(s, inputAt(s));
      if (!s.result) bounds(s);
    }
    expect(s.result).toBeDefined();
    return s;
  };
  const at = (seed: number, los: number, play = PLAYS[seed % PLAYS.length]!, def = DEF_CALLS[seed % DEF_CALLS.length]!, user = false) =>
    createPlay({ seed, offense: rosters.offense, defense: rosters.defense, play, def, los, ballY: ((seed % 3) - 1) * 6, toGo: 10, user });

  it('AI plays from their own goal line to the opponent 5 stay on the field', () => {
    for (let k = 0; k < 60; k++) live(at(700 + k, [5, 35, 60, 85, 95][k % 5]!), () => NEUTRAL);
  });

  it('a user carrier who runs for the sideline or the end line is dead there, never past it', () => {
    for (let k = 0; k < 30; k++) {
      const side = k % 2 ? 1 : -1;
      const s = live(at(900 + k, [30, 70, 92][k % 3]!, PLAYS[k % PLAYS.length], DEF_CALLS[k % DEF_CALLS.length], true), (st) =>
        input({ snap: st.tick === 0, throwHeld: st.tick >= 70 && st.tick < 74 ? 1 : 0, move: st.phase === 'carrier' ? { x: k % 3 === 2 ? 1 : 0.3, y: k % 3 === 2 ? 0 : side } : { x: 0, y: 0 }, sprint: true }),
      );
      const r = s.result!;
      if (r.reason === 'outOfBounds') {
        const ev = s.events.find((e) => e.type === 'outOfBounds')!;
        // Spotted where he went out: on the line, within a foot.
        expect(Math.abs(Math.abs(ev.at!.y) - FIELD_HALF_W) < OOB_FOOT + 0.05 || Math.abs(ev.at!.x - END_X) < OOB_FOOT + 0.05).toBe(true);
        expect(r.spot).toBeLessThanOrEqual(ev.at!.x + 1e-6);
      }
    }
  });

  /** A play with the user's receiver already carrying the ball at a spot, running a velocity. */
  const carrying = (pos: { x: number; y: number }, vel: { x: number; y: number }) => {
    const s = at(4, 80, PLAYS[0], DEF_CALLS[0], true);
    stepPlay(s, input({ snap: true }));
    const c = s.agents[s.icons[0]!]!;
    for (const i of s.def) s.agents[i]!.down = true; // nobody to tackle him
    c.pos = { ...pos };
    c.vel = { ...vel };
    c.hist.push({ pos: { ...pos }, vel: { ...vel } });
    s.ball.mode = 'held';
    s.ball.holder = c.i;
    s.carrier = c.i;
    s.phase = 'carrier';
    const n = Math.hypot(vel.x, vel.y);
    for (let k = 0; k < 120 && !s.result; k++) stepPlay(s, input({ move: { x: vel.x / n, y: vel.y / n }, sprint: true }));
    return s;
  };

  it('a carrier who steps out before the pylon does not score', () => {
    // Two yards out, a foot from the sideline, angling out: he's out before the goal line.
    const s = carrying({ x: 98, y: FIELD_HALF_W - 0.5 }, { x: 6, y: 2.5 });
    expect(s.result!.touchdown).toBe(false);
    expect(s.result!.reason).toBe('outOfBounds');
    expect(s.result!.spot).toBeLessThan(GOAL_X);
  });

  it('a carrier who crosses the goal line in bounds, then goes out, scores', () => {
    const s = carrying({ x: 99.6, y: FIELD_HALF_W - 0.8 }, { x: 7, y: 1 });
    expect(s.result!.touchdown).toBe(true);
    expect(s.events.find((e) => e.type === 'touchdown')!.at!.x).toBeCloseTo(GOAL_X, 1);
  });

  it('a carrier already out the back of the end zone does not score', () => {
    expect(outAt({ x: 109.7, y: 0 }, { x: 110.1, y: 0 })).not.toBeNull();
    // Holding the ball past the end line (out of bounds) is never a touchdown, even though he's past the goal line.
    const s = carrying({ x: END_X + 0.3, y: 0 }, { x: 2, y: 0 });
    expect(s.result!.touchdown).toBe(false);
    // Nor is one who's already out over the sideline when he reaches the goal line.
    const t = carrying({ x: 99.9, y: FIELD_HALF_W + 0.1 }, { x: 5, y: 0 });
    expect(t.result!.touchdown).toBe(false);
  });

  it('a catch behind the end line is incomplete, never a touchdown', () => {
    let deep = 0;
    for (let k = 0; k < 80; k++) {
      const s = at(3000 + k, 97, playById('trips-four-verts'), DEF_CALLS[k % DEF_CALLS.length], true);
      live(s, (st) => input({ snap: st.tick === 0, throwHeld: st.tick >= 80 && st.tick < 104 ? 1 + (k % 4) : 0, aim: { x: 1, y: 0.5 } }));
      const td = s.events.find((e) => e.type === 'touchdown');
      if (td) expect(td.at!.x).toBeLessThanOrEqual(END_X);
      const out = s.events.find((e) => e.type === 'catchOutOfBounds');
      if (out && out.at!.x > END_X - OOB_FOOT) {
        deep++;
        expect(s.result!.reason).toBe('incomplete');
        expect(s.result!.touchdown).toBe(false);
      }
    }
    expect(deep).toBeGreaterThan(0);
  });
});

describe('sim: hot routes (M5.5)', () => {
  it('a hot route at the line replaces the play route from the snap, and replays exactly', () => {
    for (const route of HOT_ROUTES) {
      const make = () => setup(41, playById('trips-stick'), defById('cover3'), true);
      const script = (st: PlayState) => input({ hotRoute: st.tick === 0 ? { icon: 1, route } : null, snap: st.tick === 2, throwHeld: st.tick >= 90 && st.tick < 94 ? 1 : 0 });
      const s = make();
      stepPlay(s, script(s));
      stepPlay(s, script(s));
      stepPlay(s, script(s));
      const r = s.agents[s.icons[0]!]!;
      expect(s.hot[r.slot as OffSlot]).toBe(route);
      expect(r.route!.pts.length).toBe(ROUTES[route].length);
      expect(s.events.some((e) => e.type === 'hotRoute')).toBe(true);
      runToWhistle(s, script);
      const again = runToWhistle(make(), script);
      expect(hashPlay(again)).toBe(hashPlay(s));
      // Every hot route stays on the field.
      for (const q of r.route!.pts) expect(Math.abs(q.y)).toBeLessThan(FIELD_HALF_W);
    }
  });
  it('ignores a hot route that is not on the list or for an icon that does not exist', () => {
    const s = setup(41, playById('trips-stick'), defById('cover3'), true);
    stepPlay(s, input({ hotRoute: { icon: 9, route: 'go' } }));
    stepPlay(s, input({ hotRoute: { icon: 1, route: 'wheel' } }));
    expect(Object.keys(s.hot)).toEqual([]);
  });
});
