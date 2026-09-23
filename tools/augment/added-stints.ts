// Missing stints → data/augment/added_stints.json (user-approved, PR #3 round 2).
//
//   node --experimental-strip-types tools/augment/added-stints.ts [--fetch]
//
// A SHORT, curated list of stints the legacy data never had, limited to
// notable players whose absence changes a top-25 list. Legacy data is not
// touched (CLAUDE.md rule 1): this is an augmentation layer. Each stint's
// season lines are read from the "NFL career statistics" table of the player's
// Wikipedia article (cached in tools/augment/cache/wiki/, revision pinned in
// the output) and checked here: every listed season must appear with the
// stated team, and the stated expected totals (what the request cited, e.g.
// "14, 15 and 14 sacks") must match the table. A mismatch or a missing page
// refuses the build. The loader (src/engine/data/addedStints.ts) validates the
// file again when the ratings load it.
//
// Scope rule (the user's): add only when the gap changes a top-25 list; any
// other gap noticed along the way is listed in the report for the user to
// decide, not added.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './fetch-nflverse.ts';
import { writeMarkedSection } from './report-sections.ts';
import { pageUrl, permalink, WikiClient } from './wiki.ts';

const OUT = join(ROOT, 'data', 'augment', 'added_stints.json');
const REPORT = join(ROOT, 'docs', 'AUGMENT_REPORT.md');
const TOOL = 'tools/augment/added-stints.ts';

interface AddedStintDef {
  /** New stint id, same scheme as data/legacy/ids.json. */
  readonly id: string;
  /** Existing legacy entry of the same person (person id, body, honors come from it). */
  readonly personOf: string;
  /**
   * Legacy reputation (`imp`) for the new stint: taken from this legacy entry
   * of the same player (the adjacent stint), because a new stint has no legacy
   * score and inventing one is not allowed. imp stays capped at 20% as always.
   */
  readonly impFrom: string;
  readonly name: string;
  readonly pos: 'DE' | 'DT' | 'LB' | 'CB' | 'S';
  readonly team: string;
  /** Team abbreviation as the Wikipedia table prints it. */
  readonly wikiTeam: string;
  readonly decade: '1960s' | '1970s' | '1980s' | '1990s';
  readonly seasons: readonly number[];
  readonly page: string;
  /** What the request or a second source states, checked against the table. */
  readonly expect: { readonly sk?: readonly number[] };
  /** Why the gap matters (which top-25 list it changes). */
  readonly why: string;
}

export const ADDED_STINTS: readonly AddedStintDef[] = [
  {
    id: 'defense:reggie-white:PHI:1990s',
    personOf: 'defense:reggie-white:PHI:1980s',
    impFrom: 'defense:reggie-white:PHI:1980s',
    name: 'Reggie White',
    pos: 'DE',
    team: 'PHI',
    wikiTeam: 'PHI',
    decade: '1990s',
    seasons: [1990, 1991, 1992],
    page: 'Reggie White',
    expect: { sk: [14, 15, 14] },
    why: 'His 1990–92 Eagles seasons (43 sacks; first-team All-Pro 1990 and 1991, second-team 1992) belong to no stint: the legacy list has PHI 1980s and GB 1990s only. A stint at that level is a DE top-25 stint.',
  },
];

/** One season row of a Wikipedia "NFL career statistics" table. */
interface SeasonLine {
  season: number;
  team: string;
  games: number;
  sk?: number;
  int?: number;
  fr?: number;
  ff?: number;
  td: number;
}

const cell = (s: string): string =>
  s
    .replace(/style="[^"]*"\s*\|/g, '')
    .replace(/'''?/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<[^>]*>/g, '')
    .trim();

/** Parse the defensive career table: header "GP !! GS !! ... !! Sck !! FF !! FR !! TD !! Int !! Yds !! TD !! PD". */
export function parseDefTable(wikitext: string): SeasonLine[] {
  const i = wikitext.search(/==\s*(NFL )?career statistics\s*==/i);
  if (i < 0) throw new Error('no career statistics section');
  const sec = wikitext.slice(i, wikitext.indexOf('\n==', i + 20) > 0 ? wikitext.indexOf('\n==', i + 20) : undefined);
  const hdr = /^!\s*GP\s*!!(.*)$/m.exec(sec);
  if (!hdr) throw new Error('no GP header row');
  const cols = ['GP', ...hdr[1]!.split('!!').map((c) => c.trim())];
  const out: SeasonLine[] = [];
  const rows = sec.split(/\n\|-\s*\n/);
  for (const r of rows) {
    const lines = r.split('\n').filter((l) => l.trim());
    const head = lines.find((l) => l.startsWith('!'));
    const data = lines.find((l) => l.startsWith('|') && !l.startsWith('|}') && !l.startsWith('|-'));
    if (!head || !data) continue;
    const hc = head.slice(1).split('!!').map(cell);
    const season = Number(/(\d{4})/.exec(hc[0] ?? '')?.[1]);
    if (!season) continue;
    const vals = data.slice(1).split('||').map(cell);
    if (vals.length !== cols.length) continue;
    const at = (name: string, nth = 0): number | undefined => {
      let k = -1;
      for (let j = 0, seen = 0; j < cols.length; j++) if (cols[j] === name && seen++ === nth) k = j;
      if (k < 0) return undefined;
      const v = Number(vals[k]!.replace(/,/g, ''));
      return Number.isFinite(v) ? v : undefined;
    };
    out.push({ season, team: hc[1] ?? '', games: at('GP')!, sk: at('Sck'), int: at('Int'), fr: at('FR'), ff: at('FF'), td: (at('TD', 0) ?? 0) + (at('TD', 1) ?? 0) });
  }
  return out;
}

function main(): void {
  const fetch = process.argv.includes('--fetch');
  const wiki = new WikiClient(!fetch, (s) => console.error(s));
  const pages = wiki.pages(ADDED_STINTS.map((d) => d.page));
  const problems: string[] = [];
  const stints = [];
  for (const d of ADDED_STINTS) {
    const page = pages.get(d.page);
    if (!page) {
      problems.push(`${d.id}: Wikipedia page "${d.page}" not cached (rerun with --fetch)`);
      continue;
    }
    const table = parseDefTable(page.wikitext);
    const lines = d.seasons.map((y) => table.find((l) => l.season === y));
    lines.forEach((l, k) => {
      if (!l) problems.push(`${d.id}: ${d.seasons[k]} not in the table of "${page.title}"`);
      else if (l.team !== d.wikiTeam) problems.push(`${d.id}: ${l.season} team is ${l.team}, expected ${d.wikiTeam}`);
    });
    const got = lines.filter((l): l is SeasonLine => !!l);
    if (d.expect.sk) {
      const sk = got.map((l) => l.sk);
      if (JSON.stringify(sk) !== JSON.stringify(d.expect.sk)) problems.push(`${d.id}: sacks ${JSON.stringify(sk)} in the table, expected ${JSON.stringify(d.expect.sk)}`);
    }
    const sum = (f: 'games' | 'sk' | 'int' | 'fr' | 'td') => got.reduce((a, l) => a + (l[f] ?? 0), 0);
    stints.push({
      id: d.id,
      personOf: d.personOf,
      impFrom: d.impFrom,
      entry: { n: d.name, p: d.pos, t: d.team, d: d.decade },
      seasons: [...d.seasons],
      bySeason: Object.fromEntries(got.map((l) => [String(l.season), { games: l.games, sk: l.sk, int: l.int, fr: l.fr, td: l.td }])),
      totals: { games: sum('games'), sk: sum('sk'), int: sum('int'), fr: sum('fr'), td: sum('td') },
      // Forced fumbles: the table prints 0 before 1993 (not tracked then), so they are left out.
      source: { title: `Wikipedia: ${page.title}, "NFL career statistics"`, url: pageUrl(page.title), permalink: permalink(page.title, page.revid), retrieved: page.retrieved },
      conf: 'reference',
      why: d.why,
    });
  }
  if (problems.length) {
    for (const p of problems) console.error(`  - ${p}`);
    throw new Error(`${problems.length} added-stint problem(s)`);
  }
  const out = {
    _meta: {
      what: 'Stints the legacy data never had, added as an augmentation layer (legacy data untouched). Loaded and validated by src/engine/data/addedStints.ts.',
      generatedBy: TOOL,
      rule: 'Only notable players whose missing stint changes a top-25 list (user decision, PR #3 round 2). Season lines from the cited table, checked against the stated totals; imp from the same player\'s adjacent legacy stint (impFrom).',
    },
    stints,
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`wrote ${OUT} (${stints.length} stint${stints.length === 1 ? '' : 's'})`);

  const L: string[] = [];
  L.push('## Added stints (`data/augment/added_stints.json`)', '');
  L.push(`Generated by \`${TOOL}\` (user-approved, PR #3 round 2). A short list of stints the legacy data never had, limited to notable players whose absence changes a top-25 list. Legacy data is untouched; the loader (\`src/engine/data/addedStints.ts\`) validates the file (new id, same person and name as an existing stint, seasons inside the decade, totals equal to the season lines, a cited source) and adds the stint to the rating pools. Season lines come from the cited table and the build refuses if a season, the team or a stated total doesn't match.`, '');
  L.push('| Stint | Seasons | Games | Sacks | INT | FR | TD | imp from | Source |', '|---|---|---:|---:|---:|---:|---:|---|---|');
  for (const s of stints) L.push(`| ${s.entry.n} (${s.entry.t} ${s.entry.d}) | ${s.seasons.join(', ')} | ${s.totals.games} | ${s.totals.sk} (${s.seasons.map((y) => s.bySeason[String(y)]?.sk).join(', ')}) | ${s.totals.int} | ${s.totals.fr} | ${s.totals.td} | \`${s.impFrom}\` | [${s.source.title}](${s.source.permalink}) |`);
  L.push('', ...stints.map((s) => `- **${s.entry.n} (${s.entry.t} ${s.entry.d})**: ${s.why} Forced fumbles are left out (the table prints 0 before 1993, when they weren't tracked).`), '');
  writeMarkedSection(REPORT, TOOL, L);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
