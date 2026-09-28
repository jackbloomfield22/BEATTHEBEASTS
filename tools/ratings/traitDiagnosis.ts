// Trait diagnosis (M6.6, docs/m66/DATA_AUDIT.md): for the named stints,
// every input the trait gates read, where it ranks in the position pool and
// whether each gate passes. Reads a full rating run; changes nothing.
//
//   node tools/run-ts.mjs tools/ratings/traitDiagnosis.ts [--brief] [id ...]

import { buildInputs } from '../../src/engine/ratings/inputs.ts';
import { rateAll } from '../../src/engine/ratings/engine.ts';
import { loadSources } from './sources.ts';

const DEFAULT = ['players:garrett-wilson:NYJ:2020s', 'players:davante-adams:NYJ:2020s', 'players:aaron-rodgers:NYJ:2020s', 'players:allen-lazard:NYJ:2020s'];
const ids = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const brief = process.argv.includes('--brief');
const want = ids.length ? ids : DEFAULT;

const run = rateAll(buildInputs(loadSources()).inputs);
const pool = (pos: string) => run.entries.filter((x) => x.pos === pos);
const pct = (xs: number[], v: number) => (100 * (xs.filter((x) => x < v).length + 0.5 * xs.filter((x) => x === v).length)) / xs.length;

for (const id of want) {
  const e = run.entries.find((x) => x.id === id);
  if (!e) {
    console.log(`\n${id}: not rated`);
    continue;
  }
  const P = pool(e.pos);
  const inp = e.inputs;
  console.log(`\n=== ${e.name} ${e.pos} ${e.team} ${e.decade}  OVR ${e.ovr.value.toFixed(1)} (pool ${P.length} ${e.pos}s)`);
  console.log(`seasons ${inp.seasons.v.join(',')}  games ${inp.games.v} [${inp.games.src}]`);
  for (const [k, s] of Object.entries(inp.stats)) if (s && typeof s === 'object') console.log(`  stat ${k.padEnd(18)} ${String(Math.round(s.v * 1000) / 1000).padStart(8)}  sample games ${s.games ?? inp.games.v}  ${s.conf}`);
  console.log(`  shown: ${e.traits.map((t) => t.id).join(', ') || '(none)'};  earned: ${(run.traitsEarned[e.id] ?? []).map((t) => t.id).join(', ') || '(none)'}`);
  if (!brief)
    for (const [k, a] of Object.entries(e.attrs)) {
      console.log(`  ${k.padEnd(15)} ${a.value.toFixed(1).padStart(5)} p${pct(P.map((x) => x.attrs[k]!.value), a.value).toFixed(0).padStart(2)}  ${a.contributions.map((c) => `${c.label}${c.input ? ` [${c.input}]` : ''} ${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(1)}`).join(' | ')}`);
    }
  const byTrait = new Map<string, ReturnType<typeof run.traitGates>>();
  for (const g of run.traitGates(e.id)) (byTrait.get(g.trait) ?? byTrait.set(g.trait, []).get(g.trait)!).push(g);
  for (const [t, gs] of byTrait) {
    const ok = gs.every((g) => g.pass);
    console.log(`    ${ok ? 'EARNED' : '      '} ${t.padEnd(22)} ${gs.map((g) => `${g.metric} ${g.value === undefined ? 'n/a' : g.value.toFixed(2)} p${g.pct === undefined ? '-' : g.pct.toFixed(0)} (${g.side} ${g.gate}%: ${g.pass ? 'pass' : 'miss'})`).join(' ; ')}`);
  }
}
