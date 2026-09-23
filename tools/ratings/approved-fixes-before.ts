// Freezes the ratings the approved fixes of the ratings follow-up change, so
// RATINGS_REPORT.md ("Approved fixes") can show before/after:
//   - WR and TE OVR (WR/TE physicals cap, TE block-grade cap, Munoz exclusion)
//   - TE Run Block, Pass Block and Impact Block (TE block-grade cap)
//   - QB Release, Pocket Presence and Under Pressure (sack-rate split)
//
//   node tools/run-ts.mjs tools/ratings/approved-fixes-before.ts
//
// It rates the working tree, so it was run once at BEFORE_COMMIT (the last
// commit before the fixes) and its output, data/ratings/approved-fixes.before.json,
// is committed. Values keep one decimal (the snapshot rounds to integers).

import { writeFileSync } from 'node:fs';
import { rateAll } from '../../src/engine/ratings/engine.ts';
import { buildInputs } from '../../src/engine/ratings/inputs.ts';
import { loadSources, ROOT } from './sources.ts';

export const BEFORE_COMMIT = '0c02551';

const run = rateAll(buildInputs(loadSources()).inputs);
const r1 = (x: number) => Math.round(x * 10) / 10;
const entries: Record<string, { name: string; pos: string; team: string; decade: string; ovr: number; conf: string; attrs?: Record<string, number> }> = {};
for (const e of run.entries) {
  if (e.pos !== 'WR' && e.pos !== 'TE' && e.pos !== 'QB') continue;
  const keys = e.pos === 'QB' ? ['release', 'pocketPresence', 'underPressure'] : e.pos === 'TE' ? ['runBlock', 'passBlock', 'impactBlock'] : [];
  const attrs = keys.length ? Object.fromEntries(keys.map((k) => [k, r1(e.attrs[k]!.value)])) : undefined;
  entries[e.id] = { name: e.name, pos: e.pos, team: e.team, decade: e.decade, ovr: r1(e.ovr.value), conf: e.ovr.conf, ...(attrs ? { attrs } : {}) };
}
const out = {
  _meta: {
    what: 'WR/TE OVR, TE blocking and QB Release, Pocket Presence and Under Pressure before the approved fixes of the ratings follow-up (physicals cap, TE block-grade cap, Munoz exclusion, sack-rate split).',
    source: `rateAll on the working tree at commit ${BEFORE_COMMIT}, written by tools/ratings/approved-fixes-before.ts`,
  },
  entries,
};
// One entry per line: small diffs, readable in review.
const body = Object.entries(entries).map(([id, v]) => `  ${JSON.stringify(id)}: ${JSON.stringify(v)}`).join(',\n');
writeFileSync(ROOT + 'data/ratings/approved-fixes.before.json', `{"_meta": ${JSON.stringify(out._meta)},\n"entries": {\n${body}\n}}\n`);
console.log(`wrote data/ratings/approved-fixes.before.json (${Object.keys(entries).length} entries)`);
