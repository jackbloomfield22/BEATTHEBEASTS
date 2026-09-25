// Jersey numbers for every rated entry (M6: the draft room's nameplates and
// jerseys, the Beasts' jerseys), from the cached nflverse rosters.
//
//   node --experimental-strip-types tools/augment/jerseys.ts
//
// For each entry in data/ratings/ratings.v1.json (a person at a franchise in
// a decade), the number he wore most often on that franchise's rosters in
// that decade, else in that decade on any team. nflverse has almost no
// numbers before 1990 (old rows are blank or a placeholder 0), so next comes
// the Wikipedia infobox number (data/augment/jerseys_wiki.json, from
// tools/reference/build_jerseys_wiki.py), then his most-worn number in any
// decade. Entries with none get a position-typical number at draft time,
// marked estimated.
//
// Persons are matched on pfr_id, gsis_id or esb_id (people.json and the
// snapshot store whichever id the person had). Output is deterministic.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readCsv } from './csv.ts';
import { franchiseOf, decadeOf } from './franchises.ts';

const ROOT = new URL('../..', import.meta.url).pathname;
const CACHE = join(ROOT, 'tools/augment/cache/rosters');

interface Snap {
  entries: { id: string; personId: string; name: string; team: string; decade: string }[];
}
const snap = JSON.parse(readFileSync(join(ROOT, 'data/ratings/ratings.v1.json'), 'utf8')) as Snap;
const people = (JSON.parse(readFileSync(join(ROOT, 'data/augment/people.json'), 'utf8')) as { entries: Record<string, { personId: string; gsisId?: string; pfrId?: string }> }).entries;

// person key (any id) → canonical key; the snapshot's personId plus people.json's other ids.
const alias = new Map<string, string>();
for (const e of snap.entries) alias.set(e.personId, e.personId);
for (const p of Object.values(people)) {
  for (const k of [p.gsisId, p.pfrId]) if (k && !alias.has(k)) alias.set(k, p.personId);
}

// canonical person → franchise|decade → number → seasons worn.
const worn = new Map<string, Map<string, Map<number, number>>>();
const files = readdirSync(CACHE).filter((f) => /^roster_\d{4}\.csv$/.test(f)).sort();
for (const f of files) {
  const csv = readCsv(join(CACHE, f));
  const col = (name: string) => csv.header.indexOf(name);
  const [cSeason, cTeam, cNum, cG, cE, cP] = ['season', 'team', 'jersey_number', 'gsis_id', 'esb_id', 'pfr_id'].map(col);
  for (const r of csv.rows) {
    const n = Number(r[cNum!]);
    // Old rows hold a placeholder 0 (0 was only allowed from 2023).
    if (!r[cNum!] || !Number.isFinite(n) || n < 0 || n > 99 || (n === 0 && Number(r[cSeason!]) < 2023)) continue;
    const who = [r[cP!], r[cG!], r[cE!]].map((k) => (k ? alias.get(k) : undefined)).find(Boolean);
    if (!who) continue;
    const season = Number(r[cSeason!]);
    const fr = franchiseOf(r[cTeam!]!, season);
    const key = `${fr ?? r[cTeam!]}|${decadeOf(season)}`;
    let byTeam = worn.get(who);
    if (!byTeam) worn.set(who, (byTeam = new Map()));
    let nums = byTeam.get(key);
    if (!nums) byTeam.set(key, (nums = new Map()));
    nums.set(n, (nums.get(n) ?? 0) + 1);
  }
}

/** The most-worn number in a tally (ties: the lower number, for determinism). */
function most(t: Map<number, number>): number | undefined {
  let best: number | undefined;
  let bc = -1;
  for (const [n, c] of [...t].sort((a, b) => a[0] - b[0])) if (c > bc) (best = n), (bc = c);
  return best;
}
function merge(ts: Iterable<Map<number, number>>): Map<number, number> {
  const out = new Map<number, number>();
  for (const t of ts) for (const [n, c] of t) out.set(n, (out.get(n) ?? 0) + c);
  return out;
}

// Wikipedia infobox numbers (tools/reference/build_jerseys_wiki.py) for the
// seasons nflverse has none: page per legacy entry id, and per lineman name.
const wiki = (JSON.parse(readFileSync(join(ROOT, 'data/augment/jerseys_wiki.json'), 'utf8')) as { pages: Record<string, { numbers: number[]; franchises: string[]; byFranchise: Record<string, number> }> }).pages;
const acc = (JSON.parse(readFileSync(join(ROOT, 'data/augment/accolades.json'), 'utf8')) as { people: Record<string, { name: string; page?: string; entries?: string[] }> }).people;
const pageOf = new Map<string, string>();
const olPage = new Map<string, string>();
for (const [key, p] of Object.entries(acc)) {
  if (!p.page) continue;
  for (const id of p.entries ?? []) pageOf.set(id, p.page);
  if (key.split('|')[1] === 'OL') olPage.set(`${p.name}|${key.split('|')[2]}`, p.page);
}
/** A number from the infobox for this stint: per franchise when the list maps one-to-one; one number; else first/last by franchise order. */
function fromWiki(e: Snap['entries'][number]): number | undefined {
  const page = pageOf.get(e.id) ?? (e.id.includes('#') ? olPage.get(`${e.name}|${e.decade}`) : undefined);
  const w = page ? wiki[page] : undefined;
  if (!w || !w.numbers.length) return undefined;
  if (w.byFranchise[e.team] !== undefined) return w.byFranchise[e.team];
  if (w.numbers.length === 1) return w.numbers[0];
  const i = w.franchises.indexOf(e.team);
  return i > 0 && i === w.franchises.length - 1 ? w.numbers[w.numbers.length - 1] : w.numbers[0];
}

const numbers: Record<string, number> = {};
const how = { franchise: 0, decade: 0, wikipedia: 0, career: 0, none: 0 };
for (const e of [...snap.entries].sort((a, b) => a.id.localeCompare(b.id))) {
  const byTeam = worn.get(e.personId);
  let n: number | undefined;
  const here = byTeam?.get(`${e.team}|${e.decade}`);
  const dec = byTeam ? [...byTeam].filter(([k]) => k.endsWith(`|${e.decade}`)).map(([, t]) => t) : [];
  if (here) (n = most(here)), how.franchise++;
  else if (dec.length) (n = most(merge(dec))), how.decade++;
  else if ((n = fromWiki(e)) !== undefined) how.wikipedia++;
  else if (byTeam) (n = most(merge(byTeam.values()))), how.career++;
  else how.none++;
  if (n !== undefined) numbers[e.id] = n;
}

writeFileSync(
  join(ROOT, 'data/augment/jerseys.json'),
  JSON.stringify(
    {
      _meta: {
        generatedBy: 'tools/augment/jerseys.ts',
        license: 'nflverse data, CC-BY-4.0; Wikipedia infobox facts (CC BY-SA 4.0), attributed by page URL in accolades.json',
        doc: 'Rated entry id → the jersey number he wore most often on that franchise in that decade (nflverse rosters; else that decade on any team; else his Wikipedia infobox number, per franchise when it maps; else his most-worn number in any decade). Missing = no number anywhere (the game assigns a position-typical one and marks it estimated).',
        coverage: how,
      },
      numbers,
    },
    null,
    0,
  ) + '\n',
);
console.log(`jerseys: ${Object.keys(numbers).length} of ${snap.entries.length} entries`, how);
