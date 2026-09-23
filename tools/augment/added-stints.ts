// Missing stints → data/augment/added_stints.json (user-approved: PR #3 round 2
// and M4.5).
//
//   node --experimental-strip-types tools/augment/added-stints.ts [--fetch]
//
// A SHORT, curated list of stints the legacy data never had, limited to
// notable players the user named. Legacy data is not touched (CLAUDE.md
// rule 1): this is an augmentation layer. Each stint's season lines are read
// from the "NFL career statistics" table of the player's Wikipedia article
// (cached in tools/augment/cache/wiki/, revision pinned in the output) and
// checked here, and any mismatch or missing page refuses the build:
//   - every listed season appears in the table with the stated team;
//   - the parsed table agrees with its own "Career" row on every column read
//     (a parse check);
//   - the stated expected values (what the request cited, or what the
//     article's prose states, quoted verbatim) match the table;
//   - nflverse rosters list the person on the franchise in exactly these
//     seasons of the decade (the whole stint, not a slice);
//   - for 1999+ seasons, the table's per-season lines agree with nflverse
//     (receptions, yards and TDs, or interceptions and sacks). Those seasons'
//     stats are then taken from nflverse, computed exactly as
//     tools/augment/build.ts computes a legacy stint's (verified).
// The loader (src/engine/data/addedStints.ts) validates the file again when
// the ratings load it.
//
// Scope rule (the user's): add only the stints the user named; any other gap
// is listed in the ratings report for the user to decide, not added.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFdIndex, fdKey, fieldAvailability, statsOut, stintSeasons, type Kind } from './build.ts';
import { FIRST_STATS_SEASON, LAST_SEASON, ROOT } from './fetch-nflverse.ts';
import { decadeSeasons } from './franchises.ts';
import { addLine, emptyLine, loadAll, type StatLine } from './load.ts';
import { writeMarkedSection } from './report-sections.ts';
import { normText, pageUrl, permalink, wikiPlain, WikiClient } from './wiki.ts';

const OUT = join(ROOT, 'data', 'augment', 'added_stints.json');
const REPORT = join(ROOT, 'docs', 'AUGMENT_REPORT.md');
const TOOL = 'tools/augment/added-stints.ts';

type Pos = 'DE' | 'DT' | 'LB' | 'CB' | 'S' | 'WR';
/** Defensive season line fields (forced fumbles are left out: the tables print 0 before 1993, when they weren't tracked). */
const DEF_FIELDS = ['games', 'sk', 'int', 'fr', 'td'] as const;
/** Receiving season line fields (td = receiving TDs). */
const OFF_FIELDS = ['games', 'rec', 'yds', 'td', 'rushYds', 'rushTd', 'fum'] as const;
type Field = (typeof DEF_FIELDS)[number] | (typeof OFF_FIELDS)[number];

interface AddedStintDef {
  /** New stint id, same scheme as data/legacy/ids.json. */
  readonly id: string;
  /** Existing legacy entry of the same person (person id, body, honors, measurables come from it). */
  readonly personOf: string;
  /**
   * Legacy reputation (`imp`) for the new stint: taken from this legacy entry
   * of the same player, because a new stint has no legacy score and inventing
   * one is not allowed. Rule: the same franchise's legacy stint in the
   * adjacent decade when there is one (White PHI 1980s → PHI 1990s), else the
   * legacy stint nearest in time. imp stays capped at 20% as always.
   */
  readonly impFrom: string;
  /** Why this impFrom (which case of the rule). */
  readonly impWhy: string;
  readonly name: string;
  readonly pos: Pos;
  readonly team: string;
  /** Team abbreviation as the Wikipedia table prints it. */
  readonly wikiTeam: string;
  readonly decade: '1960s' | '1970s' | '1980s' | '1990s' | '2000s' | '2010s';
  readonly seasons: readonly number[];
  readonly page: string;
  /** Per-season values stated by the request or the article's prose, checked against the table. */
  readonly expect: Partial<Record<Field, readonly number[]>>;
  /** Sentences of the article's prose that state `expect`, checked verbatim against the cached page. */
  readonly quotes?: readonly string[];
  /** Why the gap matters. */
  readonly why: string;
}

export const ADDED_STINTS: readonly AddedStintDef[] = [
  {
    id: 'defense:reggie-white:PHI:1990s',
    personOf: 'defense:reggie-white:PHI:1980s',
    impFrom: 'defense:reggie-white:PHI:1980s',
    impWhy: 'same franchise, adjacent decade',
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
  // M4.5 (user: "from the 47 missing stints add only these: Deion Sanders
  // ATL/SF 1990–94, Randy Moss MIN 2000–04, Terrell Owens SF 2000–03,
  // Charles Woodson LV. Sourced like White's.")
  {
    // "ATL/SF 1990–94" is two stints in this data model: a stint is one
    // franchise in one decade (id players|defense:<slug>:<team>:<decade>).
    id: 'defense:deion-sanders:ATL:1990s',
    personOf: 'defense:deion-sanders:ATL:1980s',
    impFrom: 'defense:deion-sanders:ATL:1980s',
    impWhy: 'same franchise, adjacent decade',
    name: 'Deion Sanders',
    pos: 'CB',
    team: 'ATL',
    wikiTeam: 'ATL',
    decade: '1990s',
    seasons: [1990, 1991, 1992, 1993],
    page: 'Deion Sanders',
    // Prose: 24 interceptions in Atlanta 1989–93 (5 in 1989, the ATL 1980s stint), a career-high seven in 1993, three returned for TDs.
    expect: { int: [3, 6, 3, 7] },
    quotes: ['During his time in Atlanta, he intercepted 24 passes (including a career-high seven in 1993), three of which he returned for touchdowns.'],
    why: 'His 1990–93 Falcons seasons (19 interceptions; first-team All-Pro 1992 and 1993, second-team 1991, three Pro Bowls) belong to no stint: the legacy list has ATL 1980s (1989 only) and DAL 1990s only.',
  },
  {
    id: 'defense:deion-sanders:SF:1990s',
    personOf: 'defense:deion-sanders:DAL:1990s',
    impFrom: 'defense:deion-sanders:DAL:1990s',
    impWhy: 'no SF legacy stint; DAL 1990s (1995–99) is the legacy stint nearest in time and in the same decade',
    name: 'Deion Sanders',
    pos: 'CB',
    team: 'SF',
    wikiTeam: 'SF',
    decade: '1990s',
    seasons: [1994],
    page: 'Deion Sanders',
    expect: { int: [6] },
    quotes: ['recording six interceptions and returning them for an NFL-best 303 yards and three touchdowns'],
    why: 'His 1994 49ers season (6 interceptions, 3 returned for TDs; Defensive Player of the Year, first-team All-Pro) belongs to no stint.',
  },
  {
    id: 'players:randy-moss:MIN:2000s',
    personOf: 'players:randy-moss:MIN:1990s',
    impFrom: 'players:randy-moss:MIN:1990s',
    impWhy: 'same franchise, adjacent decade',
    name: 'Randy Moss',
    pos: 'WR',
    team: 'MIN',
    wikiTeam: 'MIN',
    decade: '2000s',
    seasons: [2000, 2001, 2002, 2003, 2004],
    page: 'Randy Moss',
    // Checked against nflverse per season below; no separate figures stated in the request.
    expect: {},
    why: 'His 2000–04 Vikings seasons (425 catches, 6,416 yards, 62 TDs; first-team All-Pro 2000 and 2003) belong to no stint: the legacy list has MIN 1990s (1998–99) and LV/NE 2000s.',
  },
  {
    id: 'players:terrell-owens:SF:2000s',
    personOf: 'players:terrell-owens:SF:1990s',
    impFrom: 'players:terrell-owens:SF:1990s',
    impWhy: 'same franchise, adjacent decade',
    name: 'Terrell Owens',
    pos: 'WR',
    team: 'SF',
    wikiTeam: 'SF',
    decade: '2000s',
    seasons: [2000, 2001, 2002, 2003],
    page: 'Terrell Owens',
    expect: {},
    why: 'His 2000–03 49ers seasons (370 catches, 5,265 yards, 51 TDs; first-team All-Pro 2000–02) belong to no stint: the legacy list has SF 1990s (1996–99) and PHI/DAL/BUF 2000s.',
  },
  // "Charles Woodson LV": his first Raiders run, 1998–2005 (the honors in the
  // gap: Pro Bowl 1998–2001, first-team All-Pro 1999 and 2001, second-team
  // 2000). The decade model splits it into LV 1990s (1998–99) and LV 2000s
  // (2000–05). His 2013–15 return (safety, ages 37–39) is not added: the
  // user named the Raiders stint, and that would be a third, S stint.
  {
    id: 'defense:charles-woodson:LV:1990s',
    personOf: 'defense:charles-woodson:GB:2000s',
    impFrom: 'defense:charles-woodson:GB:2000s',
    impWhy: 'his only legacy stint',
    name: 'Charles Woodson',
    pos: 'CB',
    team: 'LV',
    wikiTeam: 'OAK',
    decade: '1990s',
    seasons: [1998, 1999],
    page: 'Charles Woodson',
    expect: {},
    why: 'His 1998–99 Raiders seasons (Defensive Rookie of the Year 1998; Pro Bowl both years, first-team All-Pro 1999) belong to no stint: the legacy list has GB 2000s only.',
  },
  {
    id: 'defense:charles-woodson:LV:2000s',
    personOf: 'defense:charles-woodson:GB:2000s',
    impFrom: 'defense:charles-woodson:GB:2000s',
    impWhy: 'his only legacy stint',
    name: 'Charles Woodson',
    pos: 'CB',
    team: 'LV',
    wikiTeam: 'OAK',
    decade: '2000s',
    seasons: [2000, 2001, 2002, 2003, 2004, 2005],
    page: 'Charles Woodson',
    expect: {},
    why: 'His 2000–05 Raiders seasons (first-team All-Pro 2001, second-team 2000, Pro Bowl 2000 and 2001) belong to no stint: the legacy list has GB 2000s only.',
  },
];

/** One season row of a Wikipedia career table (a traded season's second team row inherits the year). */
interface Row {
  season: number;
  team: string;
  vals: Partial<Record<Field, number>>;
}

const cell = (s: string): string =>
  s
    // Style attributes, including the unterminated `style="…;|` some tables carry.
    .replace(/(?:style|rowspan|colspan)="[^"|]*"?\s*\|/g, '')
    .replace(/'''?/g, '')
    .replace(/\[https?:\S+\s+([^\]]*)\]/g, '$1')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<[^>]*>/g, '')
    .trim();

const num = (s: string | undefined): number | undefined => {
  if (s === undefined) return undefined;
  const v = Number(s.replace(/,/g, '').replace(/−/g, '-'));
  return s !== '' && Number.isFinite(v) ? v : undefined;
};

/** Column picks: [header name, occurrence] per field. */
const PICKS: Record<'defense' | 'offense', Partial<Record<Field, [string, number][]>>> = {
  // td = interception-return TD + fumble-return TD (the first two TD columns).
  defense: { games: [['GP', 0]], sk: [['Sck', 0]], int: [['Int', 0]], fr: [['FR', 0]], td: [['TD', 0], ['TD', 1]] },
  // Receiving comes first in these tables, then rushing.
  offense: { games: [['GP', 0]], rec: [['Rec', 0]], yds: [['Yds', 0]], td: [['TD', 0]], rushYds: [['Yds', 1]], rushTd: [['TD', 1]], fum: [['Fum', 0]] },
};

/**
 * Parse the regular-season career table of the kind asked for: the first
 * table in the "career statistics" section whose "GP !! …" header row has
 * Rec (offense) or Int and no Rec (defense). Returns the season rows and the
 * table's own Career row.
 */
export function parseCareerTable(wikitext: string, kind: 'defense' | 'offense'): { rows: Row[]; career: Partial<Record<Field, number>> } {
  const i = wikitext.search(/\n==\s*(NFL )?career statistics\s*==/i);
  if (i < 0) throw new Error('no career statistics section');
  const next = wikitext.slice(i + 5).search(/\n==[^=]/);
  const sec = wikitext.slice(i, next > 0 ? i + 5 + next : undefined);
  const tables = sec.split(/\n\{\|/).slice(1).map((t) => t.split(/\n\|\}/)[0]!);
  for (const t of tables) {
    const hdr = /^!\s*GP\s*!!(.*)$/m.exec(t);
    if (!hdr) continue;
    const cols = ['GP', ...hdr[1]!.split('!!').map((c) => cell(c))];
    const isOff = cols.includes('Rec');
    if ((kind === 'offense') !== isOff || (!isOff && !cols.includes('Int'))) continue;
    const idx = (name: string, nth: number): number => {
      for (let j = 0, seen = 0; j < cols.length; j++) if (cols[j] === name && seen++ === nth) return j;
      return -1;
    };
    const pick = (vals: string[]): Partial<Record<Field, number>> => {
      const out: Partial<Record<Field, number>> = {};
      for (const [f, spec] of Object.entries(PICKS[kind]) as [Field, [string, number][]][]) {
        let v: number | undefined;
        for (const [name, nth] of spec) {
          const k = idx(name, nth);
          if (k < 0) throw new Error(`no ${name} column #${nth + 1}`);
          const x = num(vals[k]);
          if (x !== undefined) v = (v ?? 0) + x;
        }
        if (v !== undefined) out[f] = Math.round(v * 10) / 10;
      }
      return out;
    };
    const rows: Row[] = [];
    let career: Partial<Record<Field, number>> | undefined;
    let lastSeason = 0;
    for (const r of t.split(/\n\|-[^\n]*\n/)) {
      const lines = r.split('\n').filter((l) => l.trim());
      const head = lines.find((l) => l.startsWith('!'));
      if (!head) continue;
      const hc = head.slice(1).split(/!!|\|\|/).map(cell);
      if (hc.some((c) => /Career/.test(c)) && !/^\d{4}$/.test(hc[0] ?? '')) {
        career = pick(hc.slice(1));
        continue;
      }
      const data = lines.find((l) => l.startsWith('|') && !l.startsWith('|}') && !l.startsWith('|-') && !l.startsWith('|+'));
      if (!data) continue;
      const vals = data.slice(1).split('||').map(cell);
      if (vals.length !== cols.length) continue;
      const year = /^(\d{4})$/.exec(hc[0] ?? '')?.[1];
      const season = year ? Number(year) : lastSeason;
      if (!season) continue;
      lastSeason = season;
      rows.push({ season, team: year ? (hc[1] ?? '') : (hc[0] ?? ''), vals: pick(vals) });
    }
    if (!rows.length) continue;
    if (!career) throw new Error('no Career row');
    return { rows, career };
  }
  throw new Error(`no ${kind} career table`);
}

const sum = (xs: readonly (number | undefined)[]) => Math.round(xs.reduce<number>((a, x) => a + (x ?? 0), 0) * 10) / 10;
const ranges = (ys: readonly number[]) => (ys.length > 1 ? `${ys[0]}–${ys[ys.length - 1]}` : `${ys[0]}`);

function main(): void {
  const fetch = process.argv.includes('--fetch');
  const wiki = new WikiClient(!fetch, (s) => console.error(s));
  const pages = wiki.pages(ADDED_STINTS.map((d) => d.page));
  const people = (JSON.parse(readFileSync(join(ROOT, 'data', 'augment', 'people.json'), 'utf8')) as { entries: Record<string, { personId: string }> }).entries;
  console.log('loading nflverse cache (rosters, weekly stats)…');
  const data = loadAll();
  const fd = buildFdIndex(data);
  const avail = fieldAvailability(data);
  const problems: string[] = [];
  const stints = [];
  for (const d of ADDED_STINTS) {
    const kind: Kind = d.id.startsWith('players:') ? 'offense' : 'defense';
    const fields: readonly Field[] = kind === 'offense' ? OFF_FIELDS : DEF_FIELDS;
    const bad = (m: string) => problems.push(`${d.id}: ${m}`);
    const page = pages.get(d.page);
    if (!page) {
      bad(`Wikipedia page "${d.page}" not cached (rerun with --fetch)`);
      continue;
    }
    const checks: string[] = [];
    // 1. The table, and its agreement with its own Career row.
    const { rows, career } = parseCareerTable(page.wikitext, kind);
    for (const f of fields) {
      if (career[f] === undefined) continue;
      const s = sum(rows.map((r) => r.vals[f]));
      if (s !== career[f]) bad(`table ${f}: season rows sum to ${s}, Career row says ${career[f]} (parse problem)`);
    }
    checks.push(`Wikipedia table parsed; season rows sum to its Career row on ${fields.filter((f) => career[f] !== undefined).join(', ')}`);
    const lines = d.seasons.map((y) => rows.filter((r) => r.season === y));
    lines.forEach((ls, k) => {
      if (ls.length !== 1) bad(`${d.seasons[k]}: ${ls.length} rows in the table of "${page.title}" (want one)`);
      else if (ls[0]!.team !== d.wikiTeam) bad(`${ls[0]!.season} team is ${ls[0]!.team}, expected ${d.wikiTeam}`);
    });
    const got = lines.map((ls) => ls[0]).filter((l): l is Row => !!l);
    // 2. Stated values.
    for (const [f, want] of Object.entries(d.expect) as [Field, number[]][]) {
      const have = got.map((l) => l.vals[f] ?? 0);
      if (JSON.stringify(have) !== JSON.stringify(want)) bad(`${f} ${JSON.stringify(have)} in the table, expected ${JSON.stringify(want)}`);
      else checks.push(`${f} per season ${want.join(', ')} as stated`);
    }
    const plain = normText(wikiPlain(page.wikitext));
    for (const q of d.quotes ?? []) {
      if (!plain.includes(normText(q))) bad(`quote not found in "${page.title}": ${q}`);
      else checks.push(`prose: "${q}"`);
    }
    // 3. nflverse rosters: the person is on the franchise in exactly these seasons of the decade.
    const personId = people[d.personOf]?.personId;
    if (!personId) {
      bad(`no person for ${d.personOf}`);
      continue;
    }
    const st = fd.get(fdKey(d.team, d.decade))?.get(personId);
    const list = st ? stintSeasons(st) : [];
    if (JSON.stringify(list) !== JSON.stringify(d.seasons)) bad(`nflverse rosters list ${d.team} ${d.decade} seasons ${JSON.stringify(list)}, stated ${JSON.stringify(d.seasons)}`);
    else checks.push(`nflverse rosters: ${d.team} ${ranges(list)}, the whole ${d.decade} stint`);
    // 4. 1999+ seasons: nflverse stats, checked against the table.
    let nflverse: Record<string, unknown> | undefined;
    const post = d.seasons.filter((y) => y >= FIRST_STATS_SEASON);
    if (post.length && st) {
      const { from, to } = decadeSeasons(d.decade, LAST_SEASON);
      const line = emptyLine();
      const statSeasons: number[] = [];
      const perSeason = new Map<number, StatLine>();
      const games: Record<string, number> = {};
      // Same aggregation as tools/augment/build.ts for a legacy stint.
      for (let y = Math.max(from, FIRST_STATS_SEASON); y <= to; y++) {
        const l = st.stats.get(y);
        if (list.includes(y)) games[String(y)] = l?.games ?? 0;
        if (l && l.games > 0) {
          addLine(line, l);
          perSeason.set(y, l);
          statSeasons.push(y);
        } else if (list.includes(y)) statSeasons.push(y);
      }
      const cmp: string[] = [];
      for (const y of post) {
        const w = got.find((l) => l.season === y)?.vals;
        const n = perSeason.get(y);
        if (!w || !n) {
          bad(`${y}: no ${!w ? 'table' : 'nflverse'} line`);
          continue;
        }
        const pairs: [string, number, number][] =
          kind === 'offense'
            ? [['rec', w.rec ?? 0, n.receptions], ['yds', w.yds ?? 0, n.receiving_yards], ['td', w.td ?? 0, n.receiving_tds]]
            : [['int', w.int ?? 0, n.def_interceptions], ['sk', w.sk ?? 0, n.def_sacks]];
        const off = pairs.filter(([, a, b]) => Math.abs(a - b) > 1e-9);
        if (off.length) bad(`${y}: table vs nflverse differ: ${off.map(([f, a, b]) => `${f} ${a} vs ${b}`).join(', ')}`);
        const gp = w.games ?? 0;
        cmp.push(`${y} ${pairs.map(([f, a]) => `${f} ${a}`).join(' ')}${gp !== n.games ? ` (GP ${gp}; nflverse games with a stat ${n.games})` : ''}`);
      }
      checks.push(`table = nflverse per season on ${kind === 'offense' ? 'receptions, receiving yards, receiving TDs' : 'interceptions, sacks'}: ${cmp.join('; ')}`);
      nflverse = { games, stats: statsOut(kind, line, statSeasons, list, perSeason, avail) };
    }
    const bySeason = Object.fromEntries(got.map((l) => [String(l.season), Object.fromEntries(fields.map((f) => [f, l.vals[f] ?? 0]))]));
    stints.push({
      id: d.id,
      personOf: d.personOf,
      impFrom: d.impFrom,
      impWhy: d.impWhy,
      entry: { n: d.name, p: d.pos, t: d.team, d: d.decade },
      seasons: [...d.seasons],
      bySeason,
      totals: Object.fromEntries(fields.map((f) => [f, sum(got.map((l) => l.vals[f]))])),
      ...(nflverse ? { nflverse } : {}),
      source: { title: `Wikipedia: ${page.title}, "${/==\s*NFL career statistics\s*==/i.test(page.wikitext) ? 'NFL career statistics' : 'Career statistics'}"`, url: pageUrl(page.title), permalink: permalink(page.title, page.revid), retrieved: page.retrieved },
      conf: 'reference',
      checks,
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
      rule: "Only stints the user named (PR #3 round 2: Reggie White; M4.5: Deion Sanders ATL/SF 1990–94, Randy Moss MIN 2000–04, Terrell Owens SF 2000–03, Charles Woodson LV). Season lines from the cited table, checked against the stated values, the table's Career row, nflverse rosters and (1999+) nflverse stats; 1999+ stats are nflverse's (verified); imp from the same player's legacy stint (impFrom: same franchise in the adjacent decade, else the nearest in time).",
      fields: 'bySeason/totals, defense: games, sk, int, fr, td (interception + fumble return TDs; forced fumbles left out, not tracked before 1993). Offense: games, rec, yds, td (receiving), rushYds, rushTd, fum. nflverse (1999+ seasons): games per season and stats in the nflverse_entries.json shape.',
    },
    stints,
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`wrote ${OUT} (${stints.length} stint${stints.length === 1 ? '' : 's'})`);

  const L: string[] = [];
  L.push('## Added stints (`data/augment/added_stints.json`)', '');
  L.push(
    `Generated by \`${TOOL}\` (user-approved: PR #3 round 2, and M4.5). A short list of stints the legacy data never had, only the ones the user named. Legacy data is untouched; the loader (\`src/engine/data/addedStints.ts\`) validates the file (new id, same person and name as an existing stint, seasons inside the decade, totals equal to the season lines, 1999+ seasons carried by nflverse stats, a cited source) and adds the stint to the rating pools. Season lines come from the cited Wikipedia table; the build refuses if a season, the team, a stated value, the table's own Career row, the nflverse roster seasons or (1999+) the nflverse per-season stats don't match. For 1999+ seasons the ratings read the nflverse stats (verified), computed as for every legacy stint; before 1999 the cited lines (reference). Person, body, honors and measurables come from the player's existing stint (\`personOf\`), \`imp\` from \`impFrom\`.`,
    '',
  );
  L.push('| Stint | Seasons | Games | Line (per season) | imp from | Source |', '|---|---|---:|---|---|---|');
  for (const s of stints) {
    const per = (f: string) => s.seasons.map((y) => (s.bySeason[String(y)] as Record<string, number>)[f]).join(', ');
    const t = s.totals as Record<string, number>;
    const line = s.id.startsWith('players:') ? `${t.rec} rec (${per('rec')}), ${t.yds} yds (${per('yds')}), ${t.td} TD (${per('td')})` : `${t.sk} sk (${per('sk')}), ${t.int} INT (${per('int')}), ${t.fr} FR, ${t.td} TD`;
    L.push(`| ${s.entry.n} (${s.entry.t} ${s.entry.d}) | ${ranges(s.seasons)} | ${t.games} | ${line} | \`${s.impFrom}\` (${s.impWhy}) | [${s.source.title}](${s.source.permalink}) |`);
  }
  L.push('', ...stints.map((s) => `- **${s.entry.n} (${s.entry.t} ${s.entry.d})**: ${s.why} Checks: ${s.checks.join('; ')}.`), '');
  writeMarkedSection(REPORT, TOOL, L);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
