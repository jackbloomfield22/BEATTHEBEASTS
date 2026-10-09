// Trait audit (Playtest 2, "every attribute and every trait must have a
// visible, feelable effect in play"): every trait in the catalog, and whether
// the sim reads it (its id appears in src/sim or the game layer that feeds
// the sim), a combination counting when both its parts are read.
//   node tools/run-ts.mjs tools/sim/traitaudit.ts

import { readdirSync, readFileSync } from 'node:fs';
import { COMBOS, DEFENSE_TRAITS, OFFENSE_TRAITS, UNIT_TRAITS } from '../../src/engine/ratings/traits/index.ts';

const src = ['src/sim', 'src/game']
  .flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(`${d}/${f}`, 'utf8')))
  .join('\n');
const read = (id: string) => src.includes(`'${id}'`);
const singles = [...OFFENSE_TRAITS, ...DEFENSE_TRAITS, ...UNIT_TRAITS];
const missing = singles.filter((t) => !read(t.id));
const combos = COMBOS.filter((c) => !read(c.id) && !c.parts.every(read));
console.log(`${singles.length - missing.length} of ${singles.length} traits read by the sim; ${COMBOS.length - combos.length} of ${COMBOS.length} combinations covered`);
for (const t of missing) console.log(`  not yet: ${t.id} (${t.pos.join('/')}): ${t.effect}`);
for (const c of combos) console.log(`  combination not yet: ${c.id} = ${c.parts.join(' + ')}`);
