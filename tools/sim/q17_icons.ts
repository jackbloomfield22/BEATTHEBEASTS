// Animation round 17 (docs/passing/PASSING17.md): where each receiver icon is from the quarterback at a moment of a
// clip (bearing off his run and off downfield, deg; distance, yd), to choose the throw on the run's target.
//   node tools/run-ts.mjs tools/sim/q17_icons.ts <clip id> <seconds after the snap>
import { readFileSync } from 'node:fs';
import { createPlay, defById, offenseFor, defenseFor, playById, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { PASSING17 } from '../../src/game/clips.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const c = PASSING17.find((x) => x.id === process.argv[2])!;
const at = Number(process.argv[3]);
void offenseFor;
void defenseFor;
const s = createPlay({ seed: c.seed, offense: rosters.offense, defense: rosters.defense, play: playById(c.play), def: defById(c.def), los: c.los, toGo: 10, user: c.user ?? true });
for (let k = 0; k < 1500 && !s.result; k++) {
  stepPlay(s, c.script(s));
  if (s.snapT >= 0 && s.t - s.snapT >= at) break;
}
const q = s.agents[s.qb]!;
const run = Math.atan2(q.vel.y, q.vel.x);
s.icons.forEach((i, j) => {
  const a = s.agents[i]!;
  const b = Math.atan2(a.pos.y - q.pos.y, a.pos.x - q.pos.x);
  const off = (x: number) => Math.round((Math.atan2(Math.sin(x), Math.cos(x)) * 180) / Math.PI);
  console.log(`icon ${j + 1} ${a.slot}: off his run ${off(b - run)}, off downfield ${off(b)}, ${Math.hypot(a.pos.y - q.pos.y, a.pos.x - q.pos.x).toFixed(1)} yd`);
});
