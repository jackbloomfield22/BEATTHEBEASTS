import { readFileSync } from 'node:fs';
import { practiceRosters, type SnapshotLike } from '../../src/sim/index.ts';
import { passDistribution } from '../../src/sim/outcomes.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const d = passDistribution(practiceRosters(snap), 20);
const m = new Map<string, { n: number; air: number; yac: number; sep: number }>();
for (const p of d.samples) if (p.complete && p.yards >= 40) { const k = `${p.play} ${p.def} ${p.route}`; const e = m.get(k) ?? { n: 0, air: 0, yac: 0, sep: 0 }; e.n++; e.air += p.air; e.yac += p.yac; e.sep += Math.min(p.sep, 12); m.set(k, e); }
console.log([...m].sort((a, b) => b[1].n - a[1].n).slice(0, 20).map(([k, e]) => `${String(e.n).padStart(3)} ${k.padEnd(44)} air ${(e.air / e.n).toFixed(0)} yac ${(e.yac / e.n).toFixed(0)} sep ${(e.sep / e.n).toFixed(1)}`).join('\n'));
