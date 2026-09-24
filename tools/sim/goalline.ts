// Goal-line audit: plays that end with the ball down at or past the goal line
// without a score (the "caught in the end zone, spotted at the 1" bug).
//   node tools/run-ts.mjs tools/sim/goalline.ts   → bad should only list balls short of the plane
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, NEUTRAL, PLAYS, practiceRosters, runToWhistle, GOAL_X, type SnapshotLike } from '../../src/sim/index.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
let bad = 0, tds = 0, n = 0;
for (const los of [70, 80, 88, 94]) for (const play of PLAYS) for (const def of DEF_CALLS) for (let k = 0; k < 40; k++) {
  const s = createPlay({ seed: 1000 + k * 7919, offense: rosters.offense, defense: rosters.defense, play, def, los, toGo: 10, user: false });
  runToWhistle(s, () => NEUTRAL);
  const r = s.result!; n++;
  if (r.touchdown) tds++;
  if (r.offenseBall && !r.touchdown && r.spot >= GOAL_X - 0.4 && r.reason !== 'incomplete') { bad++; if (bad <= 8) console.log(los, play.id, def.id, 1000 + k * 7919, r.reason, r.spot.toFixed(2), s.events.filter(e => ['catch','tackle','hit'].includes(e.type)).map(e => `${e.type}@${e.at?.x.toFixed(2)}`).join(' ')); }
}
console.log({ n, tds, bad });
