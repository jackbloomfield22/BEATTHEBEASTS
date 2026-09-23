// Quick console view of anchors and top players (dev aid).
//   node tools/run-ts.mjs tools/ratings/peek.ts [name-substring]
import { buildInputs } from '../../src/engine/ratings/inputs.ts';
import { rateAll } from '../../src/engine/ratings/engine.ts';
import { evaluateAnchors } from './validate.ts';
import { loadSources } from './sources.ts';

const run = rateAll(buildInputs(loadSources()).inputs);
const q = process.argv[2];
if (q) {
  for (const e of run.entries.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()))) {
    console.log(`\n${e.name} ${e.pos} ${e.team} ${e.decade}  OVR ${e.ovr.value.toFixed(1)} (${e.ovr.conf})  traits: ${e.traits.map((t) => t.id).join(', ')}`);
    for (const [k, a] of Object.entries(e.attrs)) {
      console.log(`  ${k.padEnd(15)} ${a.value.toFixed(1).padStart(5)} ${a.conf.padEnd(6)} ${a.contributions.map((c) => `${c.label}${c.input ? ` [${c.input}]` : ''} ${c.delta >= 0 ? '+' : ''}${c.delta.toFixed(1)}`).join(' | ')}`);
    }
  }
} else {
  for (const r of evaluateAnchors(run)) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.label}`);
    for (const c of r.results) console.log(`   ${c.pass ? 'ok ' : 'XX '} ${c.text}`);
  }
  const byPos = new Map<string, typeof run.entries>();
  for (const e of run.entries) (byPos.get(e.pos) ?? byPos.set(e.pos, []).get(e.pos)!).push(e);
  for (const [pos, list] of byPos) {
    const top = [...list].sort((a, b) => b.ovr.value - a.ovr.value).slice(0, 12);
    console.log(`\n${pos} top: ${top.map((e) => `${e.name} ${e.team} ${e.decade.slice(2)} ${e.ovr.value.toFixed(0)}`).join(' · ')}`);
  }
}
