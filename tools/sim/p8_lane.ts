// Passing round 8: how often, and how far, the QB moves his release off a lineman (throwingLane), in the AI book.
import { readFileSync } from 'node:fs';
import { createPlay, NEUTRAL, practiceRosters, stepPlay, type SnapshotLike } from '../../src/sim/index.ts';
import { cellSeed, sidesFor } from '../../src/sim/outcomes.ts';
import { DEF_CALLS, PASS_PLAYS } from '../../src/sim/plays.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const rosters = practiceRosters(snap);
const n = Number(process.argv[2] ?? 4);
const HASHES = [3.08, 0, -3.08];
const lanes: number[] = [];
for (const play of PASS_PLAYS.filter((p) => !p.situ && !p.unlock))
  for (const def of DEF_CALLS)
    for (let k = 0; k < n; k++) {
      const sd = sidesFor(rosters, play, def);
      const s = createPlay({ seed: cellSeed(play, def, k), offense: sd.offense, defense: sd.defense, play, def: sd.def, los: 35, ballY: HASHES[k % 3], flip: k % 2 === 1, toGo: 10, user: false });
      for (let t = 0; t < 60 * 40 && !s.result && !s.events.some((e) => e.type === 'throw'); t++) stepPlay(s, NEUTRAL);
      const th = s.events.find((e) => e.type === 'throw');
      if (th) lanes.push(Number(th.data?.lane ?? 0));
    }
const abs = lanes.map(Math.abs);
const share = (lo: number) => ((100 * abs.filter((v) => v > lo).length) / abs.length).toFixed(0);
console.log(`${lanes.length} throws: moved ${share(0.01)}%, >0.1 yd ${share(0.1)}%, >0.2 ${share(0.2)}%, >0.3 ${share(0.3)}%; left (over the top) ${((100 * lanes.filter((v) => v > 0.01).length) / lanes.length).toFixed(0)}%, right (side-arm) ${((100 * lanes.filter((v) => v < -0.01).length) / lanes.length).toFixed(0)}%`);
