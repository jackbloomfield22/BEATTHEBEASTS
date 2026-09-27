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

type Pos = 'DE' | 'DT' | 'LB' | 'CB' | 'S' | 'WR' | 'TE' | 'RB' | 'QB';
/** Defensive season line fields (forced fumbles are left out: the tables print 0 before 1993, when they weren't tracked). */
const DEF_FIELDS = ['games', 'sk', 'int', 'fr', 'td'] as const;
/**
 * Offensive season line fields by the table a position reads (M6.6 added RB
 * and QB stints). td/yds/rec are receiving; rushYds/rushTd/car rushing;
 * cmp/att/passYds/passTd/int/sck passing (sck = times sacked).
 */
const OFF_FIELDS = {
  receiving: ['games', 'rec', 'yds', 'td', 'rushYds', 'rushTd', 'fum'],
  rushing: ['games', 'car', 'rushYds', 'rushTd', 'rec', 'yds', 'td', 'fum'],
  passing: ['games', 'cmp', 'att', 'passYds', 'passTd', 'int', 'sck', 'car', 'rushYds', 'rushTd', 'fum'],
} as const;
type OffKind = keyof typeof OFF_FIELDS;
type Field = (typeof DEF_FIELDS)[number] | (typeof OFF_FIELDS)[OffKind][number];
/** Which offensive table a position's line comes from. */
const offKind = (pos: Pos): OffKind => (pos === 'QB' ? 'passing' : pos === 'RB' ? 'rushing' : 'receiving');

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
  readonly decade: '1960s' | '1970s' | '1980s' | '1990s' | '2000s' | '2010s' | '2020s';
  readonly seasons: readonly number[];
  readonly page: string;
  /** Per-season values stated by the request or the article's prose, checked against the table. */
  readonly expect: Partial<Record<Field, readonly number[]>>;
  /** Sentences of the article's prose that state `expect`, checked verbatim against the cached page. */
  readonly quotes?: readonly string[];
  /**
   * Fields where the article's table disagrees with its own Career row, with
   * both sums as the table has them and where the disagreement is (checked
   * exactly: any other difference still refuses the build).
   */
  readonly tableIssues?: Partial<Record<Field, { rows: number; career: number; note: string }>>;
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
  // M6.6 data audit (docs/PLAYTEST-1.md decision 6: "Check 2020s completeness
  // through the 2025 season (Diggs, AJ Brown, Davante Adams GB 2020s were
  // missing) and skim every other decade for notable missing stints. Add
  // through the sourced added-stints path"; docs/PLAYTEST-2.md: "Derrick Henry
  // is missing from TEN 2010s"). The four the user named, then every stint
  // the audit (tools/augment/stint-audit.ts) found at a draftable position
  // (QB, RB, WR, TE) in the game's offensive decades (1970s on) with a
  // first-team All-Pro season in it. docs/m66/DATA_AUDIT.md lists the rest.
  {
    id: 'players:stefon-diggs:NE:2020s',
    personOf: 'players:stefon-diggs:BUF:2020s',
    impFrom: 'players:stefon-diggs:HOU:2020s',
    impWhy: 'no NE legacy stint; HOU 2020s (2024) is the legacy stint nearest in time',
    name: 'Stefon Diggs',
    pos: 'WR',
    team: 'NE',
    wikiTeam: 'NE',
    decade: '2020s',
    seasons: [2025],
    page: 'Stefon Diggs',
    expect: {},
    why: 'Named by the user (PLAYTEST-1 decision 6). His 2025 Patriots season (85 catches, 1,013 yards, 4 TDs in 17 games) belongs to no stint: the legacy list has MIN 2010s, BUF 2020s and HOU 2020s.',
  },
  {
    id: 'players:a-j-brown:TEN:2020s',
    personOf: 'players:a-j-brown:TEN:2010s',
    impFrom: 'players:a-j-brown:TEN:2010s',
    impWhy: 'same franchise, adjacent decade',
    name: 'A.J. Brown',
    pos: 'WR',
    team: 'TEN',
    wikiTeam: 'TEN',
    decade: '2020s',
    seasons: [2020, 2021],
    page: 'A. J. Brown',
    expect: {},
    why: 'Named by the user (PLAYTEST-1 decision 6). His 2020–21 Titans seasons (133 catches, 1,944 yards, 16 TDs; Pro Bowl 2020) belong to no stint: the legacy list has TEN 2010s (2019) and PHI 2020s.',
  },
  {
    id: 'players:davante-adams:GB:2020s',
    personOf: 'players:davante-adams:GB:2010s',
    impFrom: 'players:davante-adams:GB:2010s',
    impWhy: 'same franchise, adjacent decade',
    name: 'Davante Adams',
    pos: 'WR',
    team: 'GB',
    wikiTeam: 'GB',
    decade: '2020s',
    seasons: [2020, 2021],
    page: 'Davante Adams',
    expect: {},
    why: 'Named by the user (PLAYTEST-1 decision 6). His 2020–21 Packers seasons (238 catches, 2,927 yards, 29 TDs; first-team All-Pro both years) belong to no stint: the legacy list has GB 2010s, LV 2020s and NYJ 2020s.',
  },
  {
    id: 'players:derrick-henry:TEN:2010s',
    personOf: 'players:derrick-henry:TEN:2020s',
    impFrom: 'players:derrick-henry:TEN:2020s',
    impWhy: 'same franchise, adjacent decade',
    name: 'Derrick Henry',
    pos: 'RB',
    team: 'TEN',
    wikiTeam: 'TEN',
    decade: '2010s',
    seasons: [2016, 2017, 2018, 2019],
    page: 'Derrick Henry',
    expect: {},
    why: 'Named by the user (PLAYTEST-2). His 2016–19 Titans seasons (3,833 rushing yards, 38 rushing TDs; the 2019 rushing title, second-team All-Pro and Pro Bowl 2019) belong to no stint: the legacy list has TEN 2020s and BAL 2020s.',
  },
  {
    id: 'players:dan-fouts:LAC:1980s',
    personOf: 'players:dan-fouts:LAC:1970s',
    impFrom: 'players:dan-fouts:LAC:1970s',
    impWhy: 'same franchise, adjacent decade',
    name: 'Dan Fouts',
    pos: 'QB',
    team: 'LAC',
    wikiTeam: 'SD',
    decade: '1980s',
    seasons: [1980, 1981, 1982, 1983, 1984, 1985, 1986, 1987],
    page: 'Dan Fouts',
    expect: {},
    why: 'Audit (first-team All-Pro 1982). His 1980–87 Chargers seasons (NFL passing-yards leader 1980–82, MVP-level 1982; Pro Bowl 1980–83 and 1985) belong to no stint: the legacy list has LAC 1970s only.',
  },
  {
    id: 'players:barry-sanders:DET:1980s',
    personOf: 'players:barry-sanders:DET:1990s',
    impFrom: 'players:barry-sanders:DET:1990s',
    impWhy: 'same franchise, adjacent decade',
    name: 'Barry Sanders',
    pos: 'RB',
    team: 'DET',
    wikiTeam: 'DET',
    decade: '1980s',
    seasons: [1989],
    page: 'Barry Sanders',
    expect: {},
    why: 'Audit (first-team All-Pro 1989). His 1989 rookie season (1,470 rushing yards, 14 TDs; Pro Bowl) belongs to no stint: the legacy list has DET 1990s only.',
  },
  {
    id: 'players:john-jefferson:LAC:1980s',
    personOf: 'players:john-jefferson:LAC:1970s',
    impFrom: 'players:john-jefferson:LAC:1970s',
    impWhy: 'same franchise, adjacent decade',
    name: 'John Jefferson',
    pos: 'WR',
    team: 'LAC',
    wikiTeam: 'SDG',
    decade: '1980s',
    seasons: [1980],
    page: 'John Jefferson (American football)',
    expect: {},
    why: 'Audit (first-team All-Pro 1980). His 1980 Chargers season (82 catches, 1,340 yards, 13 TDs, leading the NFL in receiving yards and TDs) belongs to no stint: the legacy list has LAC 1970s and GB 1980s.',
  },
  {
    id: 'players:joe-montana:SF:1990s',
    personOf: 'players:joe-montana:SF:1980s',
    impFrom: 'players:joe-montana:SF:1980s',
    impWhy: 'same franchise, adjacent decade',
    name: 'Joe Montana',
    pos: 'QB',
    team: 'SF',
    wikiTeam: 'SF',
    decade: '1990s',
    seasons: [1990, 1991, 1992],
    page: 'Joe Montana',
    expect: {},
    // The table's 1984 row has 32 rushes where the article's own Career row
    // (457) implies 39: a typo outside this stint (1990: 40, 1992: 3).
    tableIssues: { car: { rows: 450, career: 457, note: "the article's 1984 row (outside this stint) is 7 rushes short of its own Career total" } },
    why: 'Audit (first-team All-Pro 1990). His 1990–92 49ers seasons (1990: NFL MVP; 1991 lost to an elbow injury; one game in 1992) belong to no stint: the legacy list has SF 1980s and KC 1990s.',
  },
  {
    id: 'players:kurt-warner:LAR:1990s',
    personOf: 'players:kurt-warner:LAR:2000s',
    impFrom: 'players:kurt-warner:LAR:2000s',
    impWhy: 'same franchise, adjacent decade',
    name: 'Kurt Warner',
    pos: 'QB',
    team: 'LAR',
    wikiTeam: 'STL',
    decade: '1990s',
    seasons: [1998, 1999],
    page: 'Kurt Warner',
    expect: {},
    // The table's 2007 row has 441 attempts where the Career row (4,070)
    // implies 451: a typo outside this stint (1998: 11, 1999: 499, the latter
    // equal to nflverse's 455 plus the 44 of the week-1 game nflverse lacks).
    tableIssues: { att: { rows: 4060, career: 4070, note: "the article's 2007 row (outside this stint) is 10 attempts short of its own Career total" } },
    why: 'Audit (first-team All-Pro 1999). His 1998–99 Rams seasons (1999: NFL MVP, 4,353 yards and 41 TDs; one game in 1998) belong to no stint: the legacy list has LAR, NYG and ARI 2000s.',
  },
  {
    id: 'players:tyreek-hill:KC:2020s',
    personOf: 'players:tyreek-hill:KC:2010s',
    impFrom: 'players:tyreek-hill:KC:2010s',
    impWhy: 'same franchise, adjacent decade',
    name: 'Tyreek Hill',
    pos: 'WR',
    team: 'KC',
    wikiTeam: 'KC',
    decade: '2020s',
    seasons: [2020, 2021],
    page: 'Tyreek Hill',
    expect: {},
    why: 'Audit (first-team All-Pro 2020). His 2020–21 Chiefs seasons (198 catches, 2,515 yards, 24 TDs; Pro Bowl both years) belong to no stint: the legacy list has KC 2010s and MIA 2020s.',
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
  // Minus signs appear as U+2212 and, in some tables, as an en dash (Dan Fouts 1984: "–29").
  const v = Number(s.replace(/,/g, '').replace(/[−–]/g, '-'));
  return s !== '' && Number.isFinite(v) ? v : undefined;
};

/** Column picks: [header name, occurrence] per field (defensive tables). */
const PICKS: Record<'defense', Partial<Record<Field, [string, number][]>>> = {
  // td = interception-return TD + fumble-return TD (the first two TD columns).
  defense: { games: [['GP', 0]], sk: [['Sck', 0]], int: [['Int', 0]], fr: [['FR', 0]], td: [['TD', 0], ['TD', 1]] },
};

/** The "career statistics" section of an article (to the next level-2 heading). */
function careerSection(wikitext: string): string {
  const i = wikitext.search(/\n==\s*(NFL )?career statistics\s*==/i);
  if (i < 0) throw new Error('no career statistics section');
  const next = wikitext.slice(i + 5).search(/\n==[^=]/);
  return wikitext.slice(i, next > 0 ? i + 5 + next : undefined);
}

/**
 * Parse the regular-season defensive career table: the first table in the
 * "career statistics" section whose "GP !! …" header row has Int and no Rec.
 * Returns the season rows and the table's own Career row. (Offensive tables
 * go through parseOffenseTable.)
 */
export function parseCareerTable(wikitext: string, kind: 'defense'): { rows: Row[]; career: Partial<Record<Field, number>> } {
  const sec = careerSection(wikitext);
  const tables = sec.split(/\n\{\|/).slice(1).map((t) => t.split(/\n\|\}/)[0]!);
  for (const t of tables) {
    const hdr = /^!\s*GP\s*!!(.*)$/m.exec(t);
    if (!hdr) continue;
    const cols = ['GP', ...hdr[1]!.split('!!').map((c) => cell(c))];
    if (cols.includes('Rec') || !cols.includes('Int')) continue;
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

/**
 * Offensive column picks: [group, label] per field, where group is the
 * spanning header above the column ("Receiving", "Rushing", "Passing",
 * "Sacked") and label the column's own header ("Yds"). Tables differ in which
 * groups they have and in what order (a back's table starts with rushing, a
 * receiver's with receiving), so columns are found by group, not position.
 * Fields missing from `REQUIRED_OFF` may be absent (a receiver with no
 * rushing columns, no fumble column before 1977 in some tables).
 */
const OFF_PICKS: Record<string, [RegExp, string]> = {
  games: [/game/i, 'GP'],
  rec: [/receiv/i, 'Rec'],
  yds: [/receiv/i, 'Yds'],
  td: [/receiv/i, 'TD'],
  car: [/rush/i, 'Att'],
  rushYds: [/rush/i, 'Yds'],
  rushTd: [/rush/i, 'TD'],
  cmp: [/pass/i, 'Cmp'],
  att: [/pass/i, 'Att'],
  passYds: [/pass/i, 'Yds'],
  passTd: [/pass/i, 'TD'],
  int: [/pass/i, 'Int'],
  sck: [/sack/i, 'Sck'],
  fum: [/.*/, 'Fum'],
};
const REQUIRED_OFF: Record<OffKind, readonly Field[]> = {
  receiving: ['games', 'rec', 'yds', 'td'],
  rushing: ['games', 'car', 'rushYds', 'rushTd', 'rec', 'yds', 'td'],
  passing: ['games', 'cmp', 'att', 'passYds', 'passTd', 'int'],
};

interface GridCell {
  text: string;
  colspan: number;
  rowspan: number;
}

/** Split a table cell into its attributes (before the first `|` outside links and templates) and its text. */
function gridCell(raw: string): GridCell {
  let depth = 0;
  let cut = -1;
  for (let k = 0; k < raw.length; k++) {
    const two = raw.slice(k, k + 2);
    if (two === '[[' || two === '{{') {
      depth++;
      k++;
    } else if (two === ']]' || two === '}}') {
      depth = Math.max(0, depth - 1);
      k++;
    } else if (raw[k] === '|' && depth === 0) {
      cut = k;
      break;
    }
  }
  const attrs = cut >= 0 && /=/.test(raw.slice(0, cut)) ? raw.slice(0, cut) : '';
  const body = attrs ? raw.slice(cut + 1) : raw;
  const span = (name: string) => Number(new RegExp(`${name}\\s*=\\s*"?(\\d+)`).exec(attrs)?.[1] ?? 1);
  const text = body
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{abbr\|([^|}]*)\|[^}]*\}\}/gi, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/'''?/g, '')
    .replace(/\[https?:\S+\s+([^\]]*)\]/g, '$1')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/<[^>]*>/g, '')
    .trim();
  return { text, colspan: span('colspan'), rowspan: span('rowspan') };
}

/** A wikitable as a grid of cell texts, colspans and rowspans expanded (the same cell object fills every slot it spans). */
function tableGrid(t: string): GridCell[][] {
  const rows: GridCell[][] = [];
  for (const chunk of t.split(/\n\|-[^\n]*/)) {
    const cells: GridCell[] = [];
    for (const raw of chunk.split('\n')) {
      const l = raw.trim();
      if (!l || l.startsWith('{|') || l.startsWith('|}') || l.startsWith('|+') || (l[0] !== '!' && l[0] !== '|')) continue;
      for (const p of l.slice(1).split(l[0] === '!' ? /!!|\|\|/ : /\|\|/)) cells.push(gridCell(p));
    }
    if (cells.length) rows.push(cells);
  }
  const grid: GridCell[][] = rows.map(() => []);
  rows.forEach((cells, r) => {
    let c = 0;
    for (const cellv of cells) {
      while (grid[r]![c]) c++;
      for (let dr = 0; dr < cellv.rowspan && r + dr < grid.length; dr++) for (let dc = 0; dc < cellv.colspan; dc++) grid[r + dr]![c + dc] = cellv;
      c += cellv.colspan;
    }
  });
  return grid;
}

/**
 * Parse the regular-season NFL career table for an offensive line (M6.6): the
 * first table in the "career statistics" section, outside college, playoff
 * and other-league subsections, whose header has GP and the columns the kind
 * needs. Reads the table as a grid (spans expanded) and finds each field by
 * its group and label (OFF_PICKS). The Career row is the one whose first cell
 * spans the Year and Team columns.
 */
export function parseOffenseTable(wikitext: string, kind: OffKind): { rows: Row[]; career: Partial<Record<Field, number>> } {
  const sec = careerSection(wikitext);
  const parts = sec.split(/\n\{\|/);
  let headings = '';
  for (let p = 0; p < parts.length; p++) {
    if (p > 0) {
      const t = parts[p]!.split(/\n\|\}/)[0]!;
      const last = [...headings.matchAll(/\n=+\s*([^=\n]+?)\s*=+/g)].pop()?.[1] ?? '';
      const skip = /college|playoff|postseason|europe|arena|\bafl\b|cfl|usfl|xfl|ufl/i.test(last);
      const grid = skip ? [] : tableGrid(t);
      const hr = grid.findIndex((row) => row.some((c) => c.text === 'GP'));
      if (hr >= 0) {
        const hdr = grid.slice(0, hr + 1);
        const width = Math.max(...grid.map((r) => r.length));
        const col = (group: RegExp, label: string): number => {
          for (let c = 0; c < width; c++) {
            const bottom = hdr[hr]![c];
            if (bottom?.text !== label) continue;
            const top = hdr[0]![c];
            if (group.test(top === bottom ? label : (top?.text ?? ''))) return c;
          }
          return -1;
        };
        const idx = Object.fromEntries(OFF_FIELDS[kind].map((f) => [f, col(...OFF_PICKS[f]!)])) as Record<Field, number>;
        if (REQUIRED_OFF[kind].every((f) => idx[f] >= 0)) {
          const pick = (row: GridCell[]): Partial<Record<Field, number>> => {
            const out: Partial<Record<Field, number>> = {};
            for (const f of OFF_FIELDS[kind]) {
              const v = idx[f] >= 0 ? num(row[idx[f]]?.text) : undefined;
              if (v !== undefined) out[f] = v;
            }
            return out;
          };
          const rows: Row[] = [];
          let career: Partial<Record<Field, number>> | undefined;
          for (const row of grid.slice(hr + 1)) {
            if (row[0] && row[0] === row[1]) {
              career = pick(row);
              continue;
            }
            const year = /^(\d{4})$/.exec(row[0]?.text ?? '')?.[1];
            if (!year) continue;
            rows.push({ season: Number(year), team: row[1]?.text ?? '', vals: pick(row) });
          }
          if (rows.length) {
            if (!career) throw new Error('no Career row');
            return { rows, career };
          }
        }
      }
    }
    headings += parts[p]!.includes('\n|}') ? parts[p]!.slice(parts[p]!.lastIndexOf('\n|}')) : parts[p]!;
  }
  throw new Error(`no ${kind} career table`);
}

/** Per-season table fields checked against nflverse for 1999+ seasons (table field, nflverse StatLine field, words). */
const NFLVERSE_PAIRS: Record<OffKind | 'defense', readonly [Field, keyof StatLine, string][]> = {
  receiving: [['rec', 'receptions', 'receptions'], ['yds', 'receiving_yards', 'receiving yards'], ['td', 'receiving_tds', 'receiving TDs']],
  rushing: [['car', 'carries', 'carries'], ['rushYds', 'rushing_yards', 'rushing yards'], ['rushTd', 'rushing_tds', 'rushing TDs'], ['rec', 'receptions', 'receptions'], ['yds', 'receiving_yards', 'receiving yards'], ['td', 'receiving_tds', 'receiving TDs']],
  passing: [['cmp', 'completions', 'completions'], ['att', 'attempts', 'attempts'], ['passYds', 'passing_yards', 'passing yards'], ['passTd', 'passing_tds', 'passing TDs'], ['int', 'interceptions', 'interceptions']],
  defense: [['int', 'def_interceptions', 'interceptions'], ['sk', 'def_sacks', 'sacks']],
};

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
    const ok: OffKind | undefined = kind === 'offense' ? offKind(d.pos) : undefined;
    const fields: readonly Field[] = ok ? OFF_FIELDS[ok] : DEF_FIELDS;
    const bad = (m: string) => problems.push(`${d.id}: ${m}`);
    const page = pages.get(d.page);
    if (!page) {
      bad(`Wikipedia page "${d.page}" not cached (rerun with --fetch)`);
      continue;
    }
    const checks: string[] = [];
    // 1. The table, and its agreement with its own Career row.
    const { rows, career } = ok ? parseOffenseTable(page.wikitext, ok) : parseCareerTable(page.wikitext, 'defense');
    for (const f of fields) {
      if (career[f] === undefined) continue;
      const s = sum(rows.map((r) => r.vals[f]));
      const known = d.tableIssues?.[f];
      if (known && known.rows === s && known.career === career[f]) checks.push(`table ${f}: season rows sum to ${s}, its Career row says ${career[f]}: ${known.note}`);
      else if (s !== career[f]) bad(`table ${f}: season rows sum to ${s}, Career row says ${career[f]} (parse problem)`);
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
        const pairs: [string, number, number][] = NFLVERSE_PAIRS[ok ?? 'defense'].map(([f, nv]) => [f, w[f] ?? 0, n[nv]]);
        const off = pairs.filter(([, a, b]) => Math.abs(a - b) > 1e-9);
        const gp = w.games ?? 0;
        // nflverse's play-by-play misses a few 1999 games (e.g. the Rams' week-1
        // game, 1999_01_BAL_STL). Where nflverse has fewer games than the table's
        // GP and every compared total is lower, the season is short in the
        // source, not misparsed: noted, and the ratings read nflverse as they
        // do for every legacy stint with that season.
        if (off.length && n.games < gp && off.every(([, a, b]) => b < a)) checks.push(`${y}: nflverse has ${n.games} of ${gp} games (${off.map(([f, a, b]) => `${f} ${b} of ${a}`).join(', ')}): a source gap; the ratings read nflverse, as for legacy stints`);
        else if (off.length) bad(`${y}: table vs nflverse differ: ${off.map(([f, a, b]) => `${f} ${a} vs ${b}`).join(', ')}`);
        cmp.push(`${y} ${pairs.map(([f, a]) => `${f} ${a}`).join(' ')}${gp !== n.games ? ` (GP ${gp}; nflverse games with a stat ${n.games})` : ''}`);
      }
      checks.push(`table = nflverse per season on ${NFLVERSE_PAIRS[ok ?? 'defense'].map(([, , words]) => words).join(', ')}: ${cmp.join('; ')}`);
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
      rule: "Stints the user named (PR #3 round 2: Reggie White; M4.5: Deion Sanders ATL/SF 1990–94, Randy Moss MIN 2000–04, Terrell Owens SF 2000–03, Charles Woodson LV; M6.6: Stefon Diggs, A.J. Brown and Davante Adams GB in the 2020s, Derrick Henry TEN 2010s), and (M6.6, PLAYTEST-1 decision 6) every stint the audit found at QB, RB, WR or TE, 1970s on, with a first-team All-Pro season in it (docs/m66/DATA_AUDIT.md). Season lines from the cited table, checked against the stated values, the table's Career row, nflverse rosters and (1999+) nflverse stats; 1999+ stats are nflverse's (verified); imp from the same player's legacy stint (impFrom: same franchise in the adjacent decade, else the nearest in time).",
      fields: 'bySeason/totals, defense: games, sk, int, fr, td (interception + fumble return TDs; forced fumbles left out, not tracked before 1993). Offense, by position: WR/TE games, rec, yds, td (receiving), rushYds, rushTd, fum; RB games, car, rushYds, rushTd, rec, yds, td, fum; QB games, cmp, att, passYds, passTd, int, sck (times sacked), car, rushYds, rushTd, fum. nflverse (1999+ seasons): games per season and stats in the nflverse_entries.json shape.',
    },
    stints,
  };
  writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`wrote ${OUT} (${stints.length} stint${stints.length === 1 ? '' : 's'})`);

  const L: string[] = [];
  L.push('## Added stints (`data/augment/added_stints.json`)', '');
  L.push(
    `Generated by \`${TOOL}\` (user-approved: PR #3 round 2, M4.5, and M6.6: PLAYTEST-1 decision 6 and PLAYTEST-2). A short list of stints the legacy data never had: the ones the user named, and from the M6.6 audit every QB/RB/WR/TE stint (1970s on) with a first-team All-Pro season (\`docs/m66/DATA_AUDIT.md\`). Legacy data is untouched; the loader (\`src/engine/data/addedStints.ts\`) validates the file (new id, same person and name as an existing stint, seasons inside the decade, totals equal to the season lines, 1999+ seasons carried by nflverse stats, a cited source) and adds the stint to the rating pools. Season lines come from the cited Wikipedia table; the build refuses if a season, the team, a stated value, the table's own Career row, the nflverse roster seasons or (1999+) the nflverse per-season stats don't match. For 1999+ seasons the ratings read the nflverse stats (verified), computed as for every legacy stint; before 1999 the cited lines (reference). Person, body, honors and measurables come from the player's existing stint (\`personOf\`), \`imp\` from \`impFrom\`.`,
    '',
  );
  L.push('| Stint | Seasons | Games | Line (per season) | imp from | Source |', '|---|---|---:|---|---|---|');
  for (const s of stints) {
    const per = (f: string) => s.seasons.map((y) => (s.bySeason[String(y)] as Record<string, number>)[f]).join(', ');
    const t = s.totals as Record<string, number>;
    const line =
      s.entry.p === 'QB'
        ? `${t.cmp}/${t.att}, ${t.passYds} yds (${per('passYds')}), ${t.passTd} TD (${per('passTd')}), ${t.int} INT`
        : s.entry.p === 'RB'
          ? `${t.car} car, ${t.rushYds} yds (${per('rushYds')}), ${t.rushTd} TD (${per('rushTd')}); ${t.rec} rec, ${t.yds} yds`
          : s.id.startsWith('players:')
            ? `${t.rec} rec (${per('rec')}), ${t.yds} yds (${per('yds')}), ${t.td} TD (${per('td')})`
            : `${t.sk} sk (${per('sk')}), ${t.int} INT (${per('int')}), ${t.fr} FR, ${t.td} TD`;
    L.push(`| ${s.entry.n} (${s.entry.t} ${s.entry.d}) | ${ranges(s.seasons)} | ${t.games} | ${line} | \`${s.impFrom}\` (${s.impWhy}) | [${s.source.title}](${s.source.permalink}) |`);
  }
  L.push('', ...stints.map((s) => `- **${s.entry.n} (${s.entry.t} ${s.entry.d})**: ${s.why} Checks: ${s.checks.join('; ')}.`), '');
  writeMarkedSection(REPORT, TOOL, L);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
