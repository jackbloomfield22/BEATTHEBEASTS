// M6.5 #2: do receivers run the called route, at speed, until the ball is in
// the air to them or the QB has left the pocket? For every receiver on every
// pass play against every call, from the snap to the throw (or the QB
// leaving the pocket, or the whistle): how far he strays from the route art
// (the route as built at the snap, its last leg carried on), how long he is
// slow (under 35% of his top speed) where the route doesn't sit, and what he
// was doing then: jammed at the line, a defender on his body, near the
// sideline, or none of those.
//   node tools/run-ts.mjs tools/sim/routefid.ts [playsPerCell] [--show=N] [--route=name] [--byslow]
// (The measure itself is routeFidelity in src/sim/outcomes.ts; tests/routes.test.ts holds it to a line.)
import { readFileSync } from 'node:fs';
import { practiceRosters, type SnapshotLike } from '../../src/sim/index.ts';
import { routeFidelity, type RouteRun } from '../../src/sim/outcomes.ts';

const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const N = Number(process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 6);
const SHOW = Number(process.argv.find((a) => a.startsWith('--show='))?.slice(7) ?? 0);
const ONLY = process.argv.find((a) => a.startsWith('--route='))?.slice(8);
type Rec = RouteRun;
const recs: Rec[] = routeFidelity(practiceRosters(snap), N);

const pct = (n: number, d: number) => `${((100 * n) / Math.max(1, d)).toFixed(1)}%`;
const q = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor(p * (xs.length - 1))] ?? NaN;
console.log(`receiver routes ${recs.length}`);
console.log(`stray from the route art: median ${q(recs.map((r) => r.maxDev), 0.5).toFixed(2)} yd, p90 ${q(recs.map((r) => r.maxDev), 0.9).toFixed(2)}, more than 2 yd ${pct(recs.filter((r) => r.maxDev > 2).length, recs.length)}, more than 4 yd ${pct(recs.filter((r) => r.maxDev > 4).length, recs.length)}`);
console.log(`route replaced before the throw: ${pct(recs.filter((r) => r.switched).length, recs.length)} (${[...new Set(recs.filter((r) => r.switched).map((r) => `${r.play} ${r.slot} ${r.route}`))].slice(0, 6).join('; ')})`);
console.log(`slow (under 35% of top speed, not settled at a sit point) for 0.25 s+: ${pct(recs.filter((r) => r.slow > 0.25).length, recs.length)}`);
const tot: Record<string, number> = {};
for (const r of recs) for (const [k, v] of Object.entries(r.why)) tot[k] = (tot[k] ?? 0) + v;
const all = Object.values(tot).reduce((a, b) => a + b, 0);
console.log(`slow time by what he was doing: ${Object.entries(tot).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v, all)}`).join(', ')}`);
const byRoute = new Map<string, Rec[]>();
for (const r of recs) byRoute.set(r.route, [...(byRoute.get(r.route) ?? []), r]);
console.log('\nroute          n    stray>2yd  slow>0.25s  median stray');
for (const [k, g] of [...byRoute].sort((a, b) => b[1].length - a[1].length)) console.log(`${k.padEnd(12)} ${String(g.length).padStart(4)}  ${pct(g.filter((r) => r.maxDev > 2).length, g.length).padStart(8)}  ${pct(g.filter((r) => r.slow > 0.25).length, g.length).padStart(9)}  ${q(g.map((r) => r.maxDev), 0.5).toFixed(2)}`);
if (SHOW) {
  console.log('\nworst strays:');
  for (const r of [...recs].filter((x) => !ONLY || x.route === ONLY).sort((a, b) => (process.argv.includes('--byslow') ? b.slow - a.slow : b.maxDev - a.maxDev)).slice(0, SHOW)) console.log(`  ${r.play} vs ${r.def} k${r.k} ${r.slot} ${r.route}: ${r.maxDev.toFixed(1)} yd at ${r.devAt.toFixed(2)} s; slow ${r.slow.toFixed(2)} s ${JSON.stringify(Object.fromEntries(Object.entries(r.why).map(([a, b]) => [a, Math.round(b * 100) / 100])))}`);
}
