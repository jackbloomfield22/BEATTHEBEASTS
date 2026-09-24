import { readFileSync } from 'node:fs';
import { practiceRosters, type SnapshotLike } from '../../src/sim/index.ts';
import { passDistribution } from '../../src/sim/outcomes.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const d = passDistribution(practiceRosters(snap), 20);
const seps = d.samples.map((p) => p.sep).filter((x) => Number.isFinite(x) && x < 50);
const h = [0, 0, 0, 0, 0, 0, 0];
for (const x of seps) h[Math.min(6, Math.floor(x))]!++;
console.log('targets', seps.length, 'mean sep', (seps.reduce((a, b) => a + b, 0) / seps.length).toFixed(2), 'hist 0-1..6+', h.join(' '));
for (const c of ['cover1', 'cover2', 'cover3']) {
  const xs = d.samples.filter((p) => p.def === c).map((p) => p.sep).filter((x) => Number.isFinite(x) && x < 50);
  const cmp = d.samples.filter((p) => p.def === c);
  console.log(c, 'n', xs.length, 'mean sep', (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2), 'cmp', ((100 * cmp.filter((p) => p.complete).length) / cmp.length).toFixed(0) + '%');
}
const byR = new Map<string, number[]>();
for (const p of d.samples) if (p.def === (process.argv[2] ?? 'cover3') && Number.isFinite(p.sep) && p.sep < 50) byR.set(`${p.play} ${p.route}`, [...(byR.get(`${p.play} ${p.route}`) ?? []), p.sep]);
for (const [k, xs] of [...byR].sort((a, b) => b[1].length - a[1].length).slice(0, 14)) console.log(k.padEnd(34), 'n', xs.length, 'sep', (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1));
