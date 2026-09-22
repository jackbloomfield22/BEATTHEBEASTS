// Legacy data validation report.
//
//   node --experimental-strip-types tools/reports/validate-data.ts [--check]
//
// Reads legacy/beat-the-beasts.jsx through the same parser as the extractor
// and writes docs/DATA_VALIDATION.md. This is a REPORT ONLY: nothing is
// corrected here (corrections land in milestone 2 through the corrections
// layer). tests/data-validation.test.ts pins the findings that must not
// drift (for example, the exact set of schema mismatches).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseLegacyFile } from '../extract/parseLegacy.ts';
import type { Literal } from '../extract/parseLegacy.ts';

type Stats = Record<string, number | boolean>;

interface Entry {
  n: string;
  p: string;
  t: string;
  d: string;
  s: Stats;
  imp: number;
  ea?: number;
  key?: string;
}

interface Located extends Entry {
  dataset: 'PLAYERS' | 'DEFENSE' | 'UNITS';
  index: number;
}

export interface SchemaMismatch {
  dataset: 'PLAYERS';
  index: number;
  n: string;
  p: string;
  t: string;
  d: string;
  /** Keys the entry carries (legacy order). */
  keys: string[];
  /** The position's majority schema. */
  expected: string[];
  /** Positions whose majority schema this entry's keys match exactly. */
  carries: string[];
  missing: string[];
  extra: string[];
}

export interface Flag {
  what: string;
  entries: { dataset: string; index: number; n: string; p: string; t: string; d: string; detail: string }[];
}

export interface ValidationResult {
  sha256: string;
  counts: Record<string, number>;
  majoritySchemas: Record<string, string[]>;
  schemaMismatches: SchemaMismatch[];
  defenseColumnVariants: Record<string, { keys: string; count: number }[]>;
  impossible: Flag[];
  missingFields: Flag;
  duplicateNaturalKeys: Flag[];
  keyListDuplicates: Flag;
  keyListAliases: Flag;
  keyListNonNames: Flag;
  homonymsAcrossPositions: { n: string; entries: string[] }[];
  namesInPlayersAndDefense: { n: string; players: string[]; defense: string[] }[];
  keyListNamesElsewhere: { n: string; units: string[]; elsewhere: string[] }[];
  sameNameManyEntries: { n: string; entries: string[] }[];
  defenderFillerRows: { n: string; offense: string; defense: string; statLine: string; sharedWith: number }[];
  eaOffsets: Record<string, Record<string, Record<string, number>>>;
  impStats: {
    dataset: string;
    n: number;
    even: number;
    min: number;
    max: number;
    buckets: { label: string; n: number; even: number }[];
    top: { imp: number; count: number }[];
  }[];
  yearDefenses: { years: number; rows: number; topRepeats: { value: string; count: number }[]; unknownTeams: string[] };
}

const OFFENSE_POS = ['QB', 'RB', 'WR', 'TE'];
const DECADES = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
const sortedKeys = (s: Stats) => Object.keys(s).sort();
const label = (e: { n: string; p: string; t: string; d: string }) => `${e.n} (${e.p} ${e.t} ${e.d})`;

function asEntries(v: Literal | undefined, dataset: Located['dataset']): Located[] {
  if (!Array.isArray(v)) throw new Error(`${dataset} is not an array`);
  return v.map((x, index) => ({ ...(x as unknown as Entry), dataset, index }));
}

function tally<T>(xs: readonly T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    const list = m.get(k);
    if (list) list.push(x);
    else m.set(k, [x]);
  }
  return m;
}

function majority(entries: readonly Located[]): string[] {
  const counts = tally(entries, (e) => sortedKeys(e.s).join(','));
  let best = '', bestN = -1;
  for (const [k, list] of counts) if (list.length > bestN) { best = k; bestN = list.length; }
  return best ? best.split(',') : [];
}

const flagEntry = (e: Located, detail: string) => ({ dataset: e.dataset, index: e.index, n: e.n, p: e.p, t: e.t, d: e.d, detail });

export function validateLegacyData(constants: Record<string, Literal>, sha256 = ''): ValidationResult {
  const players = asEntries(constants.PLAYERS, 'PLAYERS');
  const defense = asEntries(constants.DEFENSE, 'DEFENSE');
  const units = asEntries(constants.UNITS, 'UNITS');
  const ol = units.filter((u) => u.p === 'OL');
  const defUnits = units.filter((u) => u.p === 'DEF');
  const teamColors = constants.TEAM_COLORS as Record<string, Literal>;

  const counts: Record<string, number> = { PLAYERS: players.length, DEFENSE: defense.length, OL_UNITS: ol.length, DEF_UNITS: defUnits.length };
  for (const pos of OFFENSE_POS) counts[`PLAYERS.${pos}`] = players.filter((p) => p.p === pos).length;
  for (const pos of ['DE', 'DT', 'LB', 'CB', 'S']) counts[`DEFENSE.${pos}`] = defense.filter((p) => p.p === pos).length;

  // ---- schema mismatches (PLAYERS vs each position's majority schema) ----
  const majoritySchemas: Record<string, string[]> = {};
  for (const pos of OFFENSE_POS) majoritySchemas[pos] = majority(players.filter((p) => p.p === pos));
  const schemaMismatches: SchemaMismatch[] = [];
  for (const e of players) {
    const expected = majoritySchemas[e.p] ?? [];
    const keys = sortedKeys(e.s);
    if (keys.join(',') === expected.join(',')) continue;
    schemaMismatches.push({
      dataset: 'PLAYERS', index: e.index, n: e.n, p: e.p, t: e.t, d: e.d,
      keys: Object.keys(e.s), expected,
      carries: OFFENSE_POS.filter((pos) => (majoritySchemas[pos] ?? []).join(',') === keys.join(',')),
      missing: expected.filter((k) => !keys.includes(k)),
      extra: keys.filter((k) => !expected.includes(k)),
    });
  }

  // ---- defense column variants (informational: columns vary by era/role) ----
  const defenseColumnVariants: ValidationResult['defenseColumnVariants'] = {};
  for (const pos of ['DE', 'DT', 'LB', 'CB', 'S']) {
    const m = tally(defense.filter((p) => p.p === pos), (e) => sortedKeys(e.s).join(','));
    defenseColumnVariants[pos] = [...m].map(([keys, list]) => ({ keys, count: list.length })).sort((a, b) => b.count - a.count);
  }

  // ---- impossible / implausible values ----
  const num = (e: Located, k: string) => (typeof e.s[k] === 'number' ? (e.s[k] as number) : undefined);
  const impossible: Flag[] = [];
  const wr = players.filter((p) => p.p === 'WR');
  impossible.push({ what: 'WR catch % (`s.c`) > 100', entries: wr.filter((e) => (num(e, 'c') ?? 0) > 100).map((e) => flagEntry(e, `c = ${num(e, 'c')}`)) });
  impossible.push({ what: 'WR catch % (`s.c`) > 80 (every other WR is ≤ 75)', entries: wr.filter((e) => (num(e, 'c') ?? 0) > 80).map((e) => flagEntry(e, `c = ${num(e, 'c')}`)) });
  impossible.push({ what: 'RB yds/carry (`s.c`, what the legacy engine reads as YPC) > 10', entries: players.filter((e) => e.p === 'RB' && (num(e, 'c') ?? 0) > 10).map((e) => flagEntry(e, `c = ${num(e, 'c')}${schemaMismatches.some((m) => m.index === e.index) ? ' (entry carries another position\'s schema; c is catch %)' : ''}`)) });
  impossible.push({ what: 'QB passer rating (`s.r`) outside 0–158.3', entries: players.filter((e) => e.p === 'QB' && ((num(e, 'r') ?? 0) < 0 || (num(e, 'r') ?? 0) > 158.3)).map((e) => flagEntry(e, `r = ${num(e, 'r')}`)) });
  impossible.push({ what: 'TE block grade (`s.b`) outside 0–100', entries: players.filter((e) => e.p === 'TE' && e.s.b !== undefined && ((num(e, 'b') ?? 0) < 0 || (num(e, 'b') ?? 0) > 100)).map((e) => flagEntry(e, `b = ${num(e, 'b')}`)) });
  impossible.push({ what: 'Negative stat value (any dataset)', entries: [...players, ...defense, ...units].flatMap((e) => Object.entries(e.s).filter(([, v]) => typeof v === 'number' && v < 0).map(([k, v]) => flagEntry(e, `${k} = ${String(v)}`))) });
  impossible.push({ what: '`imp` outside 40–99, or `ea` outside 40–99', entries: [...players, ...defense, ...units].filter((e) => e.imp < 40 || e.imp > 99 || (e.ea !== undefined && (e.ea < 40 || e.ea > 99))).map((e) => flagEntry(e, `imp ${e.imp}, ea ${e.ea}`)) });
  impossible.push({ what: 'Decade not in DECADES', entries: [...players, ...defense, ...units].filter((e) => !DECADES.includes(e.d)).map((e) => flagEntry(e, e.d)) });

  // ---- missing fields ----
  const missingFields: Flag = { what: 'Entries missing a field of their position\'s majority schema, or with a null / non-numeric stat', entries: [] };
  for (const m of schemaMismatches) if (m.missing.length) missingFields.entries.push({ dataset: m.dataset, index: m.index, n: m.n, p: m.p, t: m.t, d: m.d, detail: `missing ${m.missing.join(', ')}` });
  for (const e of [...players, ...defense, ...units]) {
    for (const [k, v] of Object.entries(e.s)) if (v === null || (typeof v !== 'number' && typeof v !== 'boolean')) missingFields.entries.push(flagEntry(e, `${k} = ${String(v)}`));
    if (!e.n || !e.t || !e.d) missingFields.entries.push(flagEntry(e, 'empty n/t/d'));
  }
  const olMajority = majority(ol);
  for (const e of ol) { const ks = sortedKeys(e.s); if (ks.join(',') !== olMajority.join(',')) missingFields.entries.push(flagEntry(e, `OL stats ${ks.join(',')}`)); }
  const defUnitMajority = majority(defUnits);
  for (const e of defUnits) { const ks = sortedKeys(e.s); if (ks.join(',') !== defUnitMajority.join(',')) missingFields.entries.push(flagEntry(e, `DEF unit stats ${ks.join(',')}`)); }

  // ---- duplicate natural keys ----
  const dupFlag = (what: string, list: Located[], key: (e: Located) => string): Flag => ({
    what,
    entries: [...tally(list, key)].filter(([, l]) => l.length > 1).flatMap(([k, l]) => l.map((e) => flagEntry(e, `key ${k} ×${l.length}: "${e.n}"`))),
  });
  const duplicateNaturalKeys = [
    dupFlag('PLAYERS name+team+decade', players, (e) => `${e.n}|${e.t}|${e.d}`),
    dupFlag('DEFENSE name+team+decade', defense, (e) => `${e.n}|${e.t}|${e.d}`),
    dupFlag('OL units team+decade', ol, (e) => `${e.t}|${e.d}`),
    dupFlag('DEF units team+decade', defUnits, (e) => `${e.t}|${e.d}`),
  ];

  // ---- key lists ----
  const keyListDuplicates: Flag = { what: 'Same name twice in one unit key list', entries: [] };
  const keyListAliases: Flag = { what: 'Two names sharing a surname in one key list (alias or relatives: review)', entries: [] };
  const keyListNonNames: Flag = { what: 'Key-list tokens that are not a person\'s name (single word or "The …")', entries: [] };
  const surname = (n: string) => n.split(' ').filter((w) => !['Jr.', 'Sr.', 'II', 'III', 'IV'].includes(w)).pop() ?? n;
  for (const u of units) {
    const toks = (u.key ?? '').split(' · ').map((x) => x.trim()).filter(Boolean);
    for (const [tok, list] of tally(toks, (x) => x)) if (list.length > 1) keyListDuplicates.entries.push(flagEntry(u, `"${tok}" ×${list.length} in "${u.key}"`));
    const people = toks.filter((x) => x.includes(' ') && !x.startsWith('The '));
    for (const [sn, list] of tally(people, surname)) if (new Set(list).size > 1) keyListAliases.entries.push(flagEntry(u, `${[...new Set(list)].join(' · ')} (surname ${sn})`));
    for (const x of toks) if (!x.includes(' ') || x.startsWith('The ')) keyListNonNames.entries.push(flagEntry(u, `"${x}"`));
  }

  // ---- homonyms ----
  const byName = tally(players, (e) => e.n);
  const homonymsAcrossPositions = [...byName]
    .filter(([, l]) => new Set(l.map((e) => e.p)).size > 1)
    .map(([n, l]) => ({ n, entries: l.map((e) => `${e.p} ${e.t} ${e.d}`) }))
    .sort((a, b) => a.n.localeCompare(b.n));
  const defByName = tally(defense, (e) => e.n);
  const namesInPlayersAndDefense = [...byName]
    .filter(([n]) => defByName.has(n))
    .map(([n, l]) => ({ n, players: l.map((e) => `${e.p} ${e.t} ${e.d}`), defense: (defByName.get(n) ?? []).map((e) => `${e.p} ${e.t} ${e.d}`) }))
    .sort((a, b) => a.n.localeCompare(b.n));
  const unitNames = new Map<string, string[]>();
  for (const u of ol) for (const tok of (u.key ?? '').split(' · ').map((x) => x.trim())) {
    if (!tok.includes(' ') || tok.startsWith('The ')) continue;
    const l = unitNames.get(tok) ?? [];
    l.push(`${u.p} ${u.t} ${u.d}`);
    unitNames.set(tok, l);
  }
  const keyListNamesElsewhere = [...unitNames]
    .filter(([n]) => byName.has(n) || defByName.has(n))
    .map(([n, l]) => ({ n, units: l, elsewhere: [...(byName.get(n) ?? []), ...(defByName.get(n) ?? [])].map((e) => `${e.dataset === 'PLAYERS' ? '' : 'DEFENSE '}${e.p} ${e.t} ${e.d}`) }))
    .sort((a, b) => a.n.localeCompare(b.n));
  const sameNameManyEntries = [...byName]
    .filter(([, l]) => l.length >= 4)
    .map(([n, l]) => ({ n, entries: l.map((e) => `${e.p} ${e.t} ${e.d}`) }))
    .sort((a, b) => b.entries.length - a.entries.length || a.n.localeCompare(b.n));

  // ---- defenders appearing as offensive rows ----
  const statKey = (s: Stats) => JSON.stringify(Object.entries(s));
  const statLines = tally(players, (e) => `${e.p}|${statKey(e.s)}`);
  // A defender's name on an offensive row in the same decade, rated at least
  // 10 below the defender: a filler row, not a real two-way player or a
  // homonym (Josh Allen QB/DE is a homonym and is not flagged).
  const defenderFillerRows = namesInPlayersAndDefense
    .flatMap(({ n }) => (byName.get(n) ?? []).flatMap((e) => {
      const def = (defByName.get(n) ?? []).find((x) => x.d === e.d && x.imp - e.imp >= 10);
      if (!def) return [];
      return [{
        n,
        offense: `${e.p} ${e.t} ${e.d} (imp ${e.imp})`,
        defense: `${def.p} ${def.t} ${def.d} (imp ${def.imp})`,
        statLine: Object.entries(e.s).map(([k, v]) => `${k}:${String(v)}`).join(' '),
        sharedWith: (statLines.get(`${e.p}|${statKey(e.s)}`) ?? []).length - 1,
      }];
    }));

  // ---- ea − imp offsets ----
  const eaOffsets: ValidationResult['eaOffsets'] = {};
  for (const e of players) {
    const byDec = (eaOffsets[e.p] ??= {});
    const cell = (byDec[e.d] ??= {});
    const off = (e.ea as number) - e.imp;
    const k = off > 0 ? `+${off}` : String(off);
    cell[k] = (cell[k] ?? 0) + 1;
  }

  // ---- imp evenness ----
  const impStats: ValidationResult['impStats'] = [];
  for (const [dataset, list] of [['PLAYERS', players], ['DEFENSE', defense], ['OL units', ol]] as const) {
    const imps = list.map((e) => e.imp);
    const even = (xs: number[]) => xs.filter((x) => x % 2 === 0).length;
    const top = [...tally(imps, String)].map(([k, l]) => ({ imp: Number(k), count: l.length })).sort((a, b) => b.count - a.count || b.imp - a.imp).slice(0, 10);
    const bucket = (lbl: string, f: (x: number) => boolean) => { const xs = imps.filter(f); return { label: lbl, n: xs.length, even: even(xs) }; };
    impStats.push({
      dataset, n: imps.length, even: even(imps), min: Math.min(...imps), max: Math.max(...imps),
      buckets: [bucket('< 70', (x) => x < 70), bucket('70–76', (x) => x >= 70 && x <= 76), bucket('> 76', (x) => x > 76), bucket('≥ 85', (x) => x >= 85)],
      top,
    });
  }

  // ---- YEAR_DEFENSES ----
  const yd = constants.YEAR_DEFENSES as Record<string, [string, number, number][]>;
  const rows = Object.values(yd).flat();
  const valueCounts = tally(rows.flatMap((r) => [r[1], r[2]]), String);
  const yearDefenses = {
    years: Object.keys(yd).length,
    rows: rows.length,
    topRepeats: [...valueCounts].map(([value, l]) => ({ value, count: l.length })).sort((a, b) => b.count - a.count).slice(0, 8),
    unknownTeams: [...new Set(rows.map((r) => r[0]))].filter((t) => !(t in teamColors)).sort(),
  };

  return {
    sha256, counts, majoritySchemas, schemaMismatches, defenseColumnVariants, impossible, missingFields,
    duplicateNaturalKeys, keyListDuplicates, keyListAliases, keyListNonNames, homonymsAcrossPositions,
    namesInPlayersAndDefense, keyListNamesElsewhere, sameNameManyEntries, defenderFillerRows, eaOffsets, impStats, yearDefenses,
  };
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

const pctStr = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '–');
const esc = (s: string) => s.replace(/\|/g, '\\|');

function flagTable(f: Flag): string {
  if (!f.entries.length) return `**${f.what}:** none.\n`;
  let out = `**${f.what}:** ${f.entries.length}\n\n| Dataset | Index | Entry | Detail |\n|---|---:|---|---|\n`;
  for (const e of f.entries) out += `| ${e.dataset} | ${e.index} | ${esc(label(e))} | ${esc(e.detail)} |\n`;
  return out;
}

export function renderMarkdown(r: ValidationResult): string {
  const L: string[] = [];
  L.push('# Legacy data validation report');
  L.push('');
  L.push('Generated by `tools/reports/validate-data.ts` from `legacy/beat-the-beasts.jsx`. Do not edit by hand; re-run `node --experimental-strip-types tools/reports/validate-data.ts`.');
  L.push('');
  L.push(`Legacy SHA-256: \`${r.sha256}\``);
  L.push('');
  L.push('**This is a report only.** Nothing here is corrected in the data. Fixes go through the corrections layer in milestone 2 (TECH_PLAN §6.2), each with its old value, new value, reason and source. `tests/data-validation.test.ts` pins these findings, so new drift fails CI.');
  L.push('');
  L.push('## Counts');
  L.push('');
  L.push('| Dataset | Entries |');
  L.push('|---|---:|');
  for (const [k, v] of Object.entries(r.counts)) L.push(`| ${k} | ${v} |`);
  L.push('');
  L.push('## 1. Schema mismatches (PLAYERS vs each position\'s majority schema)');
  L.push('');
  L.push('| Position | Majority stat keys |');
  L.push('|---|---|');
  for (const [pos, keys] of Object.entries(r.majoritySchemas)) L.push(`| ${pos} | \`${keys.join(', ')}\` |`);
  L.push('');
  L.push(`${r.schemaMismatches.length} entries carry another schema:`);
  L.push('');
  L.push('| Index | Entry | Keys it carries | Matches the schema of | Missing | Extra |');
  L.push('|---:|---|---|---|---|---|');
  for (const m of r.schemaMismatches) L.push(`| ${m.index} | ${esc(label(m))} | \`${m.keys.join(', ')}\` | ${m.carries.join(', ') || '–'} | ${m.missing.join(', ') || '–'} | ${m.extra.join(', ') || '–'} |`);
  L.push('');
  L.push('Effect in the legacy engine: fields read with a fallback (`s.c || 58`, `s.r || 0` …) silently use the fallback or a value with another meaning (Carl Garrett\'s catch % is read as yards per carry).');
  L.push('');
  L.push('### DEFENSE stat columns (informational)');
  L.push('');
  L.push('Defensive columns legitimately vary (`ff` from 1982 on; `u` marks unofficial pre-1982 sacks; `dpoy` only for winners; DBs carry `td` instead of `sk`). Variants per position:');
  L.push('');
  L.push('| Position | Keys | Entries |');
  L.push('|---|---|---:|');
  for (const [pos, list] of Object.entries(r.defenseColumnVariants)) for (const v of list) L.push(`| ${pos} | \`${v.keys}\` | ${v.count} |`);
  L.push('');
  L.push('## 2. Impossible or implausible values');
  L.push('');
  for (const f of r.impossible) { L.push(flagTable(f)); }
  L.push('## 3. Missing fields');
  L.push('');
  L.push(flagTable(r.missingFields));
  L.push('## 4. Duplicate natural keys');
  L.push('');
  for (const f of r.duplicateNaturalKeys) L.push(flagTable(f));
  L.push('Ids: the duplicated TEN 1990s OL unit gets the `~2` suffix (`ol-units:tennessee-oilers-titans:TEN:1990s~2`). Both units have identical stats and different key linemen.');
  L.push('');
  L.push('## 5. Unit key lists');
  L.push('');
  L.push(flagTable(r.keyListDuplicates));
  L.push(flagTable(r.keyListAliases));
  L.push(flagTable(r.keyListNonNames));
  L.push('## 6. Name homonyms (input to `data/people.json` in M2)');
  L.push('');
  L.push('Names alone do not identify people. The draft\'s "no duplicate names" rule and cross-stint aging both need person ids.');
  L.push('');
  L.push(`### Same name at more than one offensive position (${r.homonymsAcrossPositions.length})`);
  L.push('');
  L.push('| Name | Entries |');
  L.push('|---|---|');
  for (const h of r.homonymsAcrossPositions) L.push(`| ${esc(h.n)} | ${h.entries.join('; ')} |`);
  L.push('');
  L.push(`### Same name in PLAYERS and DEFENSE (${r.namesInPlayersAndDefense.length})`);
  L.push('');
  L.push('| Name | PLAYERS | DEFENSE |');
  L.push('|---|---|---|');
  for (const h of r.namesInPlayersAndDefense) L.push(`| ${esc(h.n)} | ${h.players.join('; ')} | ${h.defense.join('; ')} |`);
  L.push('');
  L.push(`### OL key-list names that also have PLAYERS/DEFENSE entries (${r.keyListNamesElsewhere.length})`);
  L.push('');
  L.push('(DEF unit key lists name the unit\'s defenders, so those overlaps are expected and not listed.)');
  L.push('');
  L.push('| Name | In OL key lists | Entries |');
  L.push('|---|---|---|');
  for (const h of r.keyListNamesElsewhere) L.push(`| ${esc(h.n)} | ${h.units.join('; ')} | ${h.elsewhere.join('; ')} |`);
  L.push('');
  L.push(`### Names with 4 or more PLAYERS entries (${r.sameNameManyEntries.length}; review for homonyms, e.g. "Mike Williams")`);
  L.push('');
  L.push('| Name | Entries |');
  L.push('|---|---|');
  for (const h of r.sameNameManyEntries) L.push(`| ${esc(h.n)} | ${h.entries.join('; ')} |`);
  L.push('');
  L.push('## 7. Defenders duplicated as offensive filler rows');
  L.push('');
  L.push('PLAYERS rows carrying a DEFENSE defender\'s name in the same decade, rated at least 10 `imp` below the defender. "Shared" is how many other PLAYERS rows at the same position carry the identical stat line (a placeholder signature). Same-name pairs that are different people (e.g. Josh Allen QB/DE) are in §6.');
  L.push('');
  L.push('| Name | Offensive row | Defender | Stat line | Shared |');
  L.push('|---|---|---|---|---:|');
  for (const f of r.defenderFillerRows) L.push(`| ${esc(f.n)} | ${f.offense} | ${f.defense} | \`${f.statLine}\` | ${f.sharedWith} |`);
  L.push('');
  L.push('## 8. `ea − imp` offsets (PLAYERS)');
  L.push('');
  L.push('Each cell lists the distinct `ea − imp` values with their counts. A single value per cell means `ea` is a fixed per-position, per-decade offset of `imp` (and legacy code never reads `ea`).');
  L.push('');
  const decs = DECADES.filter((d) => OFFENSE_POS.some((p) => r.eaOffsets[p]?.[d]));
  L.push(`| Position | ${decs.join(' | ')} |`);
  L.push(`|---|${decs.map(() => '---').join('|')}|`);
  for (const pos of OFFENSE_POS) {
    const cells = decs.map((d) => {
      const c = r.eaOffsets[pos]?.[d];
      if (!c) return '–';
      return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(', ');
    });
    L.push(`| ${pos} | ${cells.join(' | ')} |`);
  }
  L.push('');
  L.push('## 9. `imp` evenness');
  L.push('');
  L.push('| Dataset | Entries | Even | Min | Max | < 70 even | 70–76 even | > 76 even | ≥ 85 even |');
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const s of r.impStats) {
    const b = (i: number) => { const x = s.buckets[i]!; return `${x.even}/${x.n} (${pctStr(x.even, x.n)})`; };
    L.push(`| ${s.dataset} | ${s.n} | ${s.even} (${pctStr(s.even, s.n)}) | ${s.min} | ${s.max} | ${b(0)} | ${b(1)} | ${b(2)} | ${b(3)} |`);
  }
  L.push('');
  L.push('Most common `imp` values:');
  L.push('');
  for (const s of r.impStats) L.push(`- ${s.dataset}: ${s.top.map((t) => `${t.imp} (${t.count})`).join(', ')}`);
  L.push('');
  L.push('## 10. YEAR_DEFENSES (not used by the new game)');
  L.push('');
  L.push(`${r.yearDefenses.years} years, ${r.yearDefenses.rows} team rows. Most repeated PA/PF values: ${r.yearDefenses.topRepeats.map((t) => `${t.value} (×${t.count})`).join(', ')}.`);
  L.push('');
  L.push(`Team codes not in TEAM_COLORS (historical codes): ${r.yearDefenses.unknownTeams.join(', ') || 'none'}.`);
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const REPORT_PATH = fileURLToPath(new URL('../../docs/DATA_VALIDATION.md', import.meta.url));

export function buildReport(): { result: ValidationResult; markdown: string } {
  const parsed = parseLegacyFile();
  const result = validateLegacyData(parsed.constants, parsed.sha256);
  return { result, markdown: renderMarkdown(result) };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { markdown, result } = buildReport();
  if (process.argv.includes('--check')) {
    const prev = existsSync(REPORT_PATH) ? readFileSync(REPORT_PATH, 'utf8') : '';
    if (prev !== markdown) {
      console.error('docs/DATA_VALIDATION.md is out of date. Run: node --experimental-strip-types tools/reports/validate-data.ts');
      process.exit(1);
    }
    console.log('docs/DATA_VALIDATION.md is up to date');
  } else {
    writeFileSync(REPORT_PATH, markdown);
    console.log(`wrote docs/DATA_VALIDATION.md (${result.schemaMismatches.length} schema mismatches)`);
  }
}
