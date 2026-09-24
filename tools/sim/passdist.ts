// Passing distribution at Pro against the all-time defense (feedback item 7):
//   node tools/run-ts.mjs tools/sim/passdist.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { practiceRosters, type SnapshotLike } from '../../src/sim/index.ts';
import { formatPassDist, passDistribution } from '../../src/sim/passdist.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const d = passDistribution(practiceRosters(snap), Number(process.argv[2] ?? 60));
console.log(formatPassDist(d));
if (process.argv.includes('--routes')) {
  const by = new Map<string, { n: number; c: number; y: number; yac: number; sep: number }>();
  for (const p of d.samples) {
    const k = `${p.route}`;
    const e = by.get(k) ?? { n: 0, c: 0, y: 0, yac: 0, sep: 0 };
    e.n++;
    e.sep += Math.min(p.sep, 10);
    if (p.complete) { e.c++; e.y += p.yards; e.yac += p.yac; }
    by.set(k, e);
  }
  for (const [k, e] of [...by].sort((a, b) => b[1].n - a[1].n)) console.log(`${k.padEnd(10)} n ${String(e.n).padStart(4)} cmp ${((100 * e.c) / e.n).toFixed(0).padStart(3)}% ypc ${(e.y / Math.max(1, e.c)).toFixed(1).padStart(5)} yac ${(e.yac / Math.max(1, e.c)).toFixed(1).padStart(5)} sep ${(e.sep / e.n).toFixed(1)}`);
}
if (process.argv.includes('--cells')) {
  const by = new Map<string, { n: number; c: number; y: number; deep: number; dc: number }>();
  for (const p of d.samples) {
    const k = `${p.play.padEnd(18)} ${p.def}`;
    const e = by.get(k) ?? { n: 0, c: 0, y: 0, deep: 0, dc: 0 };
    e.n++;
    if (p.complete) { e.c++; e.y += p.yards; }
    by.set(k, e);
  }
  for (const [k, e] of by) console.log(`${k.padEnd(28)} n ${e.n} cmp ${((100 * e.c) / e.n).toFixed(0).padStart(3)}% ypa ${(e.y / e.n).toFixed(1)}`);
}
