import { readFileSync } from 'node:fs';
import { createPlay, defById, NEUTRAL, playById, practiceRosters, runToWhistle, type SnapshotLike } from '../../src/sim/index.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const r = practiceRosters(snap);
const [play, def, n = '30'] = process.argv.slice(2);
const out: string[] = [];
for (let k = 0; k < Number(n); k++) {
  const seed = 1000 + k * 7919;
  const s = createPlay({ seed, offense: r.offense, defense: r.defense, play: playById(play!), def: defById(def!), los: 35, toGo: 10, user: false });
  runToWhistle(s, () => NEUTRAL);
  out.push(`${seed}:${s.result!.yards.toFixed(0)}`);
}
console.log(out.join(' '));
