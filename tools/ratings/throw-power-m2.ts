// Freezes the QB Throw Power values of the M2 formula (before the arm inputs
// of the ratings follow-up) so RATINGS_REPORT.md can show before/after.
//
//   node --experimental-strip-types tools/ratings/throw-power-m2.ts
//
// Reads data/ratings/ratings.v1.json as committed at M2_COMMIT (the last
// snapshot rated with the M2 Throw Power formula: q_ypcmp 0.5, q_ypa 0.15,
// q_yds|q_tdg 0.15, imp 0.2) and writes data/ratings/throw-power.m2.json.
// Snapshot values are rounded to integers, so the "before" column is too.

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const M2_COMMIT = 'ff13bff';

interface SnapEntry {
  id: string;
  name: string;
  pos: string;
  team: string;
  decade: string;
  ovr: number;
  attrs: Record<string, number>;
  traits: { id: string; combo?: [string, string] }[];
}

const snap = JSON.parse(execFileSync('git', ['show', `${M2_COMMIT}:data/ratings/ratings.v1.json`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 })) as { entries: SnapEntry[] };
const qbs = snap.entries.filter((e) => e.pos === 'QB');
const traitCounts: Record<string, number> = {};
for (const e of qbs) for (const t of e.traits) traitCounts[t.id] = (traitCounts[t.id] ?? 0) + 1;
const out = {
  _meta: {
    what: 'QB Throw Power, OVR and shown traits under the M2 Throw Power formula, for the before/after table in docs/RATINGS_REPORT.md.',
    source: `data/ratings/ratings.v1.json at commit ${M2_COMMIT} (git show), written by tools/ratings/throw-power-m2.ts`,
    formula: 'q_ypcmp 0.5, q_ypa 0.15, q_yds|q_tdg 0.15, imp 0.2',
  },
  traitCounts,
  entries: Object.fromEntries(qbs.map((e) => [e.id, { throwPower: e.attrs.throwPower, ovr: e.ovr, traits: e.traits.map((t) => t.id) }])),
};
writeFileSync(ROOT + 'data/ratings/throw-power.m2.json', JSON.stringify(out, null, 1) + '\n');
console.log(`wrote data/ratings/throw-power.m2.json (${qbs.length} QBs)`);
