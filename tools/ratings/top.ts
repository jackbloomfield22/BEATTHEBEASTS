// node tools/run-ts.mjs tools/ratings/top.ts POS attr [n]
import { buildInputs } from '../../src/engine/ratings/inputs.ts';
import { rateAll } from '../../src/engine/ratings/engine.ts';
import { loadSources } from './sources.ts';
const [pos, attr, n] = process.argv.slice(2);
const run = rateAll(buildInputs(loadSources()).inputs);
const list = run.entries.filter((e) => e.pos === pos && (attr === 'ovr' || e.attrs[attr!]));
const v = (e: (typeof list)[number]) => (attr === 'ovr' ? e.ovr.value : e.attrs[attr!]!.value);
list.sort((a, b) => v(b) - v(a));
console.log(list.slice(0, Number(n ?? 12)).map((e, i) => `${i + 1}. ${e.name} ${e.team} ${e.decade} ${v(e).toFixed(1)}`).join('\n'));
