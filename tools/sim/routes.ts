// Route by coverage: attempts, completion, yards per attempt and separation at the catch point.
//   node tools/run-ts.mjs tools/sim/routes.ts [playsPerCell] [route,route,...]
import { readFileSync } from 'node:fs';
import { DEF_CALLS, practiceRosters, type SnapshotLike } from '../../src/sim/index.ts';
import { passDistribution } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const d = passDistribution(practiceRosters(snap), Number(process.argv[2] ?? 12));
const want = process.argv[3]?.split(',');
const routes = [...new Set(d.samples.map((p) => String(p.route)))].filter((r) => !want || want.includes(r));
console.log('route      ' + DEF_CALLS.map((c) => c.id.slice(0, 11).padStart(17)).join(''));
for (const r of routes) {
  const cells = DEF_CALLS.map((c) => {
    const xs = d.samples.filter((p) => String(p.route) === r && p.def === c.id);
    if (!xs.length) return '-'.padStart(17);
    const cmp = xs.filter((p) => p.complete).length / xs.length;
    const ypa = xs.reduce((a, p) => a + (p.complete ? p.yards : 0), 0) / xs.length;
    const sep = xs.reduce((a, p) => a + Math.min(10, Number.isNaN(p.sep) ? 0 : p.sep), 0) / xs.length;
    return `${String(xs.length).padStart(3)} ${(100 * cmp).toFixed(0).padStart(3)}% ${ypa.toFixed(1).padStart(4)} ${sep.toFixed(1).padStart(3)}`.padStart(17);
  });
  console.log(r.padEnd(11) + cells.join(''));
}
