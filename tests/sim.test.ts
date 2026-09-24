import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createPlay,
  DEF_CALLS,
  defById,
  effects,
  hashPlay,
  input,
  NEUTRAL,
  PLAYS,
  playById,
  practiceRosters,
  runToWhistle,
  solveSprint,
  speedToForty,
  accelToSplit,
  stepPlay,
  TICK,
  type InputFrame,
  type PlayState,
  type SimPlayer,
  type SnapshotLike,
} from '@/sim';
import { flyFor, solveLaunch } from '@/sim/ball';
import { steer } from '@/sim/movement';

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
    // NFL: pressure in ~2.5 s, a QB holding the ball is down in ~3.5–4.5 s.
    expect(median).toBeGreaterThan(2.8);
    expect(median).toBeLessThan(5);
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
