import { readFileSync } from 'node:fs';
import { practiceRosters, playById, defById, type SnapshotLike } from '../../src/sim/index.ts';
import { passDistribution } from '../../src/sim/outcomes.ts';
const snap = JSON.parse(readFileSync('data/ratings/ratings.v1.json', 'utf8')) as SnapshotLike;
const d = passDistribution(practiceRosters(snap), 20, [playById(process.argv[2]!)], [defById(process.argv[3]!)]);
const m = new Map<string, number>();
for (const p of d.samples) { const k = `${p.route} ${p.complete ? 'C' : '-'} air ${Math.round(p.air)} yac ${Math.round(p.yac)}`; m.set(k, (m.get(k) ?? 0) + 1); }
console.log([...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}x ${k}`).join('\n'));
