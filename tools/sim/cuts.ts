// M6.5 #10: how fast does the ball carrier change direction off the arrows?
// A user carrier in open grass at full speed straight upfield (the defense
// 30 yd behind him) is asked, on one tick, for a new direction 45°, 90° or
// 180° off his run, and holds it (or taps it for TAP ticks). For backs of
// Agility 60–99 (the same player with his Agility changed): the time from
// the press until his run has turned 90° (the brief's measure: under 0.4 s
// for a 90-Agility back), until it has turned 80% of the asked angle, his
// speed then, and how far he carried on the old line meanwhile.
//   node tools/run-ts.mjs tools/sim/cuts.ts
import { readFileSync } from 'node:fs';
import { createPlay, defById, input, NEUTRAL, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { effects } from '../../src/sim/effects.ts';
import type { Agent } from '../../src/sim/types.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const TAP = 5;

/** Run the cut: returns [time to 90° (s), time to 80% of the angle, speed then, yards carried along the old line]. */
export function cut(agility: number, deg: number, opts: { tap?: boolean; near?: boolean } = {}) {
  const s = createPlay({ seed: 3, offense: rosters.offense, defense: rosters.defense, play: playById('doubles-slants'), def: defById('cover3'), los: 30, toGo: 10, user: true });
  stepPlay(s, input({ snap: true }));
  for (let k = 0; k < 20; k++) stepPlay(s, NEUTRAL);
  const c: Agent = s.agents[s.icons[0]!]!;
  c.p = { ...c.p, attrs: { ...c.p.attrs, agility } };
  c.fx = effects(c.p);
  c.pos = { x: 50, y: 0 };
  c.vel = { x: c.fx.vmax * 0.98, y: 0 };
  c.stamina = 1;
  for (const i of s.def) s.agents[i]!.pos = { x: 20, y: s.agents[i]!.pos.y };
  if (opts.near) {
    // One tackler 2 yd off his hip, level: the controlled pace is on.
    const d = s.agents[s.def[0]!]!;
    d.pos = { x: 51.5, y: -2 };
    d.vel = { x: 0, y: 0 };
  }
  s.ball.mode = 'held';
  s.ball.holder = c.i;
  s.carrier = c.i;
  s.phase = 'carrier';
  c.mem.steered = true;
  for (let k = 0; k < 30; k++) stepPlay(s, input({ move: { x: 1, y: 0 } }));
  if (opts.near) {
    const d = s.agents[s.def[0]!]!;
    d.pos = { x: c.pos.x + 1.2, y: c.pos.y - 1.6 };
    d.vel = { x: c.vel.x, y: 0 };
  }
  const rad = (deg * Math.PI) / 180;
  const dir = { x: Math.cos(rad), y: Math.sin(rad) };
  const x0 = c.pos.x;
  const v0 = Math.hypot(c.vel.x, c.vel.y);
  let t90 = NaN;
  let t80 = NaN;
  let v80 = NaN;
  let carried = 0;
  for (let k = 1; k <= 120 && !s.result; k++) {
    stepPlay(s, input({ move: opts.tap && k > TAP ? { x: 0, y: 0 } : dir }));
    const turned = Math.abs(Math.atan2(c.vel.y, c.vel.x)) * (180 / Math.PI);
    if (Number.isNaN(t90) && turned >= Math.min(90, deg * 0.999)) t90 = k / 60;
    if (Number.isNaN(t80) && turned >= deg * 0.8) {
      t80 = k / 60;
      v80 = Math.hypot(c.vel.x, c.vel.y) / v0;
    }
    if (c.vel.x > 0) carried = c.pos.x - x0;
  }
  return { t90, t80, v80, carried };
}

const f = (x: number) => (Number.isNaN(x) ? '  —  ' : x.toFixed(2).padStart(5));
if (process.argv[1]?.endsWith('cuts.ts')) {
  console.log('agility  angle     to 90°   to 80%   speed then   carried on (yd)   [near a tackler: to 90°]   [a tap: to 80%]');
  for (const ag of [60, 75, 90, 99]) {
    for (const deg of [45, 90, 180]) {
      const r = cut(ag, deg);
      const n = cut(ag, deg, { near: true });
      const t = cut(ag, deg, { tap: true });
      console.log(`${String(ag).padStart(5)}  ${String(deg).padStart(5)}°   ${f(r.t90)} s  ${f(r.t80)} s    ${(r.v80 * 100).toFixed(0).padStart(4)}%         ${r.carried.toFixed(2).padStart(5)}               ${f(n.t90)} s                ${f(t.t80)} s`);
    }
  }
}
