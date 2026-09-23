// Freezes the ratings before the second round of approved fixes (ratings
// follow-up, PR #3 round 2: TE block-grade per-player cap dropped, fumbles
// era-adjusted, cited 40 times for legends, added stints), so
// RATINGS_REPORT.md ("Approved fixes, round 2") can show before/after.
//
//   node tools/run-ts.mjs tools/ratings/round2-before.ts
//
// It rates the working tree, so it was run once at BEFORE_COMMIT (the branch
// head before round 2) and its output, data/ratings/round2.before.json, is
// committed. One line per rated stint: OVR (one decimal), confidence, Speed
// and the attributes round 2 touches (TE blocking, Ball Security).

import { writeFileSync } from 'node:fs';
import { rateAll } from '../../src/engine/ratings/engine.ts';
import { buildInputs } from '../../src/engine/ratings/inputs.ts';
import { loadSources, ROOT } from './sources.ts';

export const BEFORE_COMMIT = 'fbb9c31';

const run = rateAll(buildInputs(loadSources()).inputs);
const r1 = (x: number) => Math.round(x * 10) / 10;
const KEYS = ['speed', 'acceleration', 'ballSecurity', 'runBlock', 'passBlock', 'impactBlock', 'release'];
const lines: string[] = [];
for (const e of run.entries) {
  const attrs: Record<string, number> = {};
  for (const k of KEYS) if (e.attrs[k]) attrs[k] = r1(e.attrs[k]!.value);
  lines.push(`  ${JSON.stringify(e.id)}: ${JSON.stringify({ name: e.name, pos: e.pos, ovr: r1(e.ovr.value), conf: e.ovr.conf[0], attrs })}`);
}
const meta = {
  what: 'Every rated stint before round 2 of the approved fixes (ratings follow-up): OVR, confidence (h/m/l), Speed, Acceleration and the attributes round 2 changes.',
  source: `rateAll on the working tree at commit ${BEFORE_COMMIT}, written by tools/ratings/round2-before.ts`,
};
writeFileSync(ROOT + 'data/ratings/round2.before.json', `{"_meta": ${JSON.stringify(meta)},\n"entries": {\n${lines.join(',\n')}\n}}\n`);
console.log(`wrote data/ratings/round2.before.json (${lines.length} entries)`);
