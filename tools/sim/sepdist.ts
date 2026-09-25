// Separation at the catch point (the harness's targets): share of targets and completion by bucket.
//   node tools/run-ts.mjs tools/sim/sepdist.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { practiceRosters, type SnapshotLike } from '../../src/sim/index.ts';
import { passDistribution } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const d = passDistribution(practiceRosters(snap), Number(process.argv[2] ?? 10));
const t = d.samples.filter((p) => !Number.isNaN(p.sep));
const edges = [0, 1, 2, 3, 5, 99];
for (let k = 0; k < edges.length - 1; k++) {
  const xs = t.filter((p) => p.sep >= edges[k]! && p.sep < edges[k + 1]!);
  const c = xs.filter((p) => p.complete).length;
  console.log(`sep [${edges[k]},${edges[k + 1]}) ${((100 * xs.length) / t.length).toFixed(1).padStart(5)}% of targets, caught ${((100 * c) / Math.max(1, xs.length)).toFixed(0).padStart(3)}%, aDOT ${(xs.reduce((a, p) => a + p.adot, 0) / Math.max(1, xs.length)).toFixed(1)}`);
}
const avg = t.reduce((a, p) => a + Math.min(10, p.sep), 0) / t.length;
console.log(`average separation ${avg.toFixed(2)} yd (NFL NGS ~2.8–3.0 at the catch)`);
