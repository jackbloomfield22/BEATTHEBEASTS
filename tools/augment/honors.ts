// First-team All-Pro counts per rated entry (M6: the "All-Pro" sticker on a
// drafted player's locker), from the cited accolades.
//
//   node --experimental-strip-types tools/augment/honors.ts
//
// data/augment/accolades.json (Wikipedia infoboxes, tools/reference/
// build_accolades.py) is keyed by person and lists the legacy entries it
// covers; linemen are matched by name and decade. The count is the person's
// career first-team All-Pro seasons (AP or consensus as Wikipedia lists
// them) plus first-team All-AFL, the AFL's equivalent. Only nonzero counts are
// written. A person with no matched page has no count (unknown, not zero).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
interface Person {
  name: string;
  entries?: string[];
  allPro1?: number[];
  allAFL1?: number[];
  url?: string;
}
const acc = (JSON.parse(readFileSync(join(ROOT, 'data/augment/accolades.json'), 'utf8')) as { people: Record<string, Person> }).people;
const snap = JSON.parse(readFileSync(join(ROOT, 'data/ratings/ratings.v1.json'), 'utf8')) as { entries: { id: string; name: string; decade: string }[] };

const byEntry = new Map<string, Person>();
const byOl = new Map<string, Person>();
for (const [key, p] of Object.entries(acc)) {
  for (const id of p.entries ?? []) byEntry.set(id, p);
  if (key.split('|')[1] === 'OL') byOl.set(`${p.name}|${key.split('|')[2]}`, p);
}

const allPro: Record<string, number> = {};
for (const e of [...snap.entries].sort((a, b) => a.id.localeCompare(b.id))) {
  const p = byEntry.get(e.id) ?? (e.id.includes('#') ? byOl.get(`${e.name}|${e.decade}`) : undefined);
  const n = new Set([...(p?.allPro1 ?? []), ...(p?.allAFL1 ?? [])]).size;
  if (n > 0) allPro[e.id] = n;
}

writeFileSync(
  join(ROOT, 'data/augment/honors.json'),
  JSON.stringify(
    {
      _meta: {
        generatedBy: 'tools/augment/honors.ts',
        license: 'facts from Wikipedia (CC BY-SA 4.0), attributed by page URL in accolades.json',
        doc: 'Rated entry id → career first-team All-Pro seasons (plus first-team All-AFL), from data/augment/accolades.json. Missing = none or unknown.',
      },
      allPro,
    },
    null,
    0,
  ) + '\n',
);
console.log(`honors: ${Object.keys(allPro).length} entries with a first-team All-Pro`);
