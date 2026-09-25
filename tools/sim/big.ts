// List the harness's explosive completions (40+ by default): play, coverage,
// route, air yards and yards after the catch, and the seed to trace.
//   node tools/run-ts.mjs tools/sim/big.ts [playsPerCell] [minYards]
import { readFileSync } from 'node:fs';
import { practiceRosters, type SnapshotLike } from '../../src/sim/index.ts';
import { passDistribution } from '../../src/sim/outcomes.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const n = Number(process.argv[2] ?? 12);
const min = Number(process.argv[3] ?? 40);
const d = passDistribution(practiceRosters(snap), n);
const big = d.samples.filter((p) => p.complete && p.yards >= min);
const air = big.map((p) => p.air).sort((a, b) => a - b);
const yac = big.map((p) => p.yac).sort((a, b) => a - b);
console.log(`${big.length} of ${d.comp} completions gain ${min}+; median air ${air[air.length >> 1]?.toFixed(1)} median yac ${yac[yac.length >> 1]?.toFixed(1)}`);
for (const p of big.slice(0, Number(process.argv[4] ?? 40))) console.log(`${p.play.padEnd(20)} ${p.def.padEnd(12)} ${String(p.route).padEnd(9)} air ${p.air.toFixed(1).padStart(5)} yac ${p.yac.toFixed(1).padStart(5)} yds ${p.yards.toFixed(1)} sep ${p.sep.toFixed(1)}`);
