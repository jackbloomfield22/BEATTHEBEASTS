// Short yardage: how often the QB sneak (and the other goal-line runs) get
// the yard against every call, from both hashes and the middle, 3rd & 1.
//   node tools/run-ts.mjs tools/sim/sneak.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { createPlay, DEF_CALLS, NEUTRAL, playById, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
import { sidesFor } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const n = Number(process.argv[2] ?? 6);
for (const id of ['heavy-sneak', 'heavy-dive', 'heavy-power', 'iform-iso']) {
  const play = playById(id);
  const ys: number[] = [];
  for (const def of DEF_CALLS) {
    for (let k = 0; k < n; k++) {
      const sd = sidesFor(r, play, def);
      const s = createPlay({ seed: 4000 + k * 7919, offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: [3.08, 0, -3.08][k % 3]!, flip: k % 2 === 1, toGo: 1, user: false });
      runToWhistle(s, () => NEUTRAL);
      ys.push(s.result!.yards);
    }
  }
  ys.sort((a, b) => a - b);
  const conv = ys.filter((y) => y >= 1).length / ys.length;
  const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
  console.log(`${id.padEnd(14)} n ${ys.length}  1+ yd ${(conv * 100).toFixed(0)}%  avg ${avg.toFixed(1)}  median ${ys[ys.length >> 1]!.toFixed(1)}`);
}
