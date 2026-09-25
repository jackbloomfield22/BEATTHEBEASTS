// The run game's shape: a histogram of carries, yards before first contact
// and after it, and the plays behind the explosive ones.
//   node tools/run-ts.mjs tools/sim/runhist.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { practiceRosters, type SnapshotLike } from '../../src/sim/index.ts';
import { formatRunDist, runDistribution } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const d = runDistribution(practiceRosters(snap), Number(process.argv[2] ?? 10));
console.log(formatRunDist(d));
const edges = [-99, 0, 1, 2, 3, 4, 6, 10, 20, 99];
const ys = d.samples.map((p) => p.yards);
for (let k = 0; k < edges.length - 1; k++) {
  const n = ys.filter((y) => y >= edges[k]! && y < edges[k + 1]!).length;
  console.log(`[${edges[k]},${edges[k + 1]}) ${((100 * n) / ys.length).toFixed(1).padStart(5)}% ${'#'.repeat(Math.round((100 * n) / ys.length))}`);
}
const byPlay = new Map<string, number[]>();
for (const p of d.samples) byPlay.set(p.play, [...(byPlay.get(p.play) ?? []), p.yards]);
for (const [k, v] of byPlay) {
  const s = [...v].sort((a, b) => a - b);
  console.log(`${k.padEnd(24)} ypc ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1).padStart(5)} median ${s[s.length >> 1]!.toFixed(1).padStart(5)} stuff ${Math.round((100 * v.filter((y) => y <= 0).length) / v.length)}% 10+ ${Math.round((100 * v.filter((y) => y >= 10).length) / v.length)}%`);
}
const ac = d.samples.map((p) => p.yards - Math.max(0, p.contact));
console.log(`yards after first contact: ${(ac.reduce((a, b) => a + b, 0) / ac.length).toFixed(2)} (NFL ~2.8–3.0 per carry)`);
const long = d.samples.filter((p) => p.yards >= 10);
console.log(`10+ runs: ${long.length}, with a broken or missed tackle ${long.filter((p) => p.broken > 0).length}, first contact past 5 yd ${long.filter((p) => p.contact > 5).length}`);
