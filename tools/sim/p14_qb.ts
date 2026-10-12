// Passing round 14 (docs/passing/PASSING14.md): the QB's feet through the drop, the hitch and the throw, in Node as the
// Practice Field runs each recorded play: when the drop sets, when he hitches, when the windup starts and the ball goes,
// and his ground speed (m/s) across them, so the release on the move can be read against the plant.
//   node tools/run-ts.mjs tools/sim/p14_qb.ts [--ids=p9-slant,...]
import { readFileSync } from 'node:fs';
import { createPlay, defById, defenseFor, offenseFor, playById, practiceRosters, stepPlay, type PlayState, type SnapshotLike } from '../../src/sim/index.ts';
import { PASSING2, PASSING7, PASSING9, PASSING10, withSwap, type Clip } from '../../src/game/clips.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const ids = process.argv.find((a) => a.startsWith('--ids='))?.slice(6).split(',');
const list: Clip[] = [...PASSING2, ...PASSING7, ...PASSING9, ...PASSING10].filter((c) => !ids || ids.includes(c.id));
const YARD = 0.9144;
for (const c of list) {
  const r = c.swap ? withSwap({ team: rosters.team, beasts: rosters.beasts }, c.play, c.swap, snap) : null;
  const s: PlayState = createPlay({ seed: c.seed, offense: r ? offenseFor(playById(c.play), r.team) : rosters.offense, defense: r ? defenseFor(defById(c.def), r.beasts) : rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
  const marks: string[] = [];
  let wind = -1;
  let hitch = -1;
  const sp: [number, number][] = [];
  for (let k = 0; k < 1500 && !s.result; k++) {
    const qb = s.agents[s.qb]!;
    if (s.snapT >= 0) sp.push([s.t - s.snapT, Math.hypot(qb.vel.x, qb.vel.y) * YARD]);
    if (wind < 0 && s.windup) {
      wind = s.t - s.snapT;
      marks.push(`windup ${wind.toFixed(2)} (release at ${(s.windup.at - s.snapT).toFixed(2)})`);
    }
    if (hitch < 0 && qb.mem.hitchX0 !== undefined) {
      hitch = s.t - s.snapT;
      marks.push(`hitch ${hitch.toFixed(2)}`);
    }
    if (s.ball.mode === 'air' && !marks.some((m) => m.startsWith('ball'))) marks.push(`ball ${(s.ball.releaseT - s.snapT).toFixed(2)}`);
    stepPlay(s, c.script(s));
  }
  const set = s.setup.play.drop.set;
  const rel = s.ball.releaseT - s.snapT;
  const at = (t: number) => sp.reduce((b, x) => (Math.abs(x[0] - t) < Math.abs(b[0] - t) ? x : b), [0, 0])[1].toFixed(2);
  const line = [-0.4, -0.3, -0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5].map((d) => `${d.toFixed(2)}:${at(rel + d)}`).join(' ');
  console.log(`${c.id}: set ${set.toFixed(2)} | ${marks.join(' | ')} | speed (m/s) about the release ${line}`);
}
