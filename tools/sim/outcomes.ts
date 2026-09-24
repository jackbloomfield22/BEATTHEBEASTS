// Passing distribution at Pro against the all-time defense (feedback item 7):
//   node tools/run-ts.mjs tools/sim/outcomes.ts [playsPerCell]
import { readFileSync } from 'node:fs';
import { practiceRosters, type SnapshotLike } from '../../src/sim/index.ts';
import { formatPassDist, formatRunDist, passDistribution, runDistribution } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const d = passDistribution(practiceRosters(snap), process.argv.includes("--runs") ? 0 : Number(process.argv[2] ?? 60));
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
if (process.argv.includes('--runs')) {
  const rd = runDistribution(practiceRosters(snap), Number(process.argv[2] ?? 60));
  console.log('\nRUNS\n' + formatRunDist(rd));
  const by = new Map<string, number[]>();
  for (const p of rd.samples) by.set(`${p.play.padEnd(24)} ${p.def}`, [...(by.get(`${p.play.padEnd(24)} ${p.def}`) ?? []), p.yards]);
  for (const [k, ys] of by) console.log(`${k.padEnd(32)} ypc ${(ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(1).padStart(5)} stuff ${Math.round((100 * ys.filter((y) => y <= 0).length) / ys.length)}% 10+ ${Math.round((100 * ys.filter((y) => y >= 10).length) / ys.length)}%`);
}
