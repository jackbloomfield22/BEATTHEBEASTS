// Sacks and pressure by play (docs/passing/PASSING2.md): which drops get the
// QB sacked, and when the first pressure comes, against the whole call sheet.
//   node tools/run-ts.mjs tools/sim/sackplays.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { createPlay, practiceRosters, stepPlay, NEUTRAL, PASS_PLAYS, DEF_CALLS, type SnapshotLike } from '../../src/sim/index.ts';
import { sidesFor, cellSeed } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const n = Number(process.argv[2] ?? 20);
const HASHES = [3.08, 0, -3.08];
let all = 0;
let allSacks = 0;
for (const play of PASS_PLAYS.filter((p) => !p.situ && !p.unlock)) {
  let sacks = 0;
  let pressured = 0;
  let firstP = 0;
  let ttt = 0;
  let thrown = 0;
  for (const def of DEF_CALLS) {
    for (let k = 0; k < n; k++) {
      const sd = sidesFor(r, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
      for (let t = 0; t < 60 * 40 && !s.result; t++) stepPlay(s, NEUTRAL);
      if (s.result!.sack) sacks++;
      if (s.pressureT >= 0) {
        pressured++;
        firstP += s.pressureT - s.snapT;
      }
      if (s.result!.pass?.attempted) {
        thrown++;
        ttt += s.ball.releaseT - s.snapT;
      }
    }
  }
  const m = n * DEF_CALLS.length;
  all += m;
  allSacks += sacks;
  console.log(`${play.id.padEnd(22)} ${play.drop.kind} depth ${play.drop.depth} set ${play.drop.set}  sacks ${((100 * sacks) / m).toFixed(1).padStart(5)}%  pressured ${((100 * pressured) / m).toFixed(0).padStart(3)}% first ${(firstP / Math.max(1, pressured)).toFixed(2)} s  ttt ${(ttt / Math.max(1, thrown)).toFixed(2)} s`);
}
console.log(`all: sacks ${((100 * allSacks) / all).toFixed(1)}%`);
