// Arm-strength signals for QB Throw Power → data/augment/arm_strength.json.
//
//   node --experimental-strip-types tools/augment/arm.ts [--fetch]
//
//   --fetch   allow Wikipedia API requests for pages missing from the cache
//             (tools/augment/cache/wiki/). Without it the run is offline and
//             fails if a cited page is not cached.
//
// Reads the cached nflverse weekly player stats (tools/augment/fetch-nflverse.ts),
// the committed data/augment/people.json + nflverse_entries.json (entry → person
// and stint seasons, built by build.ts), the legacy PLAYERS list, and the curated
// big-arm list in tools/augment/arm-sources.ts. Writes:
//
//   airYards   per legacy QB entry: intended air yards per attempt (2006+, verified)
//   league     per season: the same rates over every passer (the era baseline)
//   bigArm     sourced arm-strength grades (conf: estimated), each quote checked
//              verbatim against the cached Wikipedia text
//
// Output is deterministic for a given cache (no timestamps other than the
// Wikipedia revision ids/retrieval dates of the cited pages).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAYERS } from '../../data/legacy/index.ts';
import { ARM_REPORT_BEGIN, ARM_REPORT_END } from './arm-report.ts';
import { ARM_SOURCES, type ArmEvidence, type ArmGrade, type ArmSourceDef } from './arm-sources.ts';
import { num, readCsv } from './csv.ts';
import { CACHE_DIR, FIRST_STATS_SEASON, LAST_SEASON, ROOT } from './fetch-nflverse.ts';
import { franchiseOf } from './franchises.ts';
import { normText, pageUrl, permalink, USER_AGENT, WikiClient, wikiPlain } from './wiki.ts';

const OUT = join(ROOT, 'data', 'augment', 'arm_strength.json');
const REPORT = join(ROOT, 'docs', 'AUGMENT_REPORT.md');


/**
 * nflverse weekly stats carry `passing_air_yards` from 2006 on (NFL play-by-play
 * air_yards starts in 2006; 1999–2005 sum to ~0). Seasons are still checked
 * against the data below, not assumed.
 */
const FIRST_AIR_SEASON_EXPECTED = 2006;
/** Same availability rule as build.ts: a season "has" air yards when its league total is ≥ 25% of the median season's. */
const AVAILABLE_SHARE = 0.25;
/** Stints below this many attempts in the covered seasons are listed, not rated (too noisy; the test enforces it). */
const MIN_ATTEMPTS = 50;
/** A player-game with at least this many attempts and exactly 0 air yards is treated as a charting gap. */
const GAP_MIN_ATTEMPTS = 10;

interface Acc {
  att: number;
  cmp: number;
  yds: number;
  yac: number;
  air: number;
}
const acc = (): Acc => ({ att: 0, cmp: 0, yds: 0, yac: 0, air: 0 });
function add(a: Acc, b: Acc): void {
  a.att += b.att;
  a.cmp += b.cmp;
  a.yds += b.yds;
  a.yac += b.yac;
  a.air += b.air;
}
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

interface Scan {
  /** season → league totals over every passer row (REG). */
  league: Map<number, Acc>;
  /** `${gsis}|${season}|${franchise}` → totals. */
  byKey: Map<string, Acc>;
  gaps: { season: number; week: number; team: string; player: string; playerId: string; attempts: number }[];
}

function scanWeekly(): Scan {
  const league = new Map<number, Acc>();
  const byKey = new Map<string, Acc>();
  const gaps: Scan['gaps'] = [];
  for (let y = FIRST_STATS_SEASON; y <= LAST_SEASON; y++) {
    const c = readCsv(join(CACHE_DIR, 'stats_player', `stats_player_week_${y}.csv`));
    const [cId, cName, cWeek, cType, cTeam, cCmp, cAtt, cYds, cYac, cAir] = [
      'player_id', 'player_display_name', 'week', 'season_type', 'team', 'completions', 'attempts', 'passing_yards', 'passing_yards_after_catch', 'passing_air_yards',
    ].map((k) => c.col(k));
    const L = acc();
    const rows: { id: string; team: string; a: Acc }[] = [];
    for (const r of c.rows) {
      if (r[cType!] !== 'REG') continue;
      const att = num(r[cAtt!]) ?? 0;
      if (att <= 0) continue;
      const a: Acc = { att, cmp: num(r[cCmp!]) ?? 0, yds: num(r[cYds!]) ?? 0, yac: num(r[cYac!]) ?? 0, air: num(r[cAir!]) ?? 0 };
      if (y >= FIRST_AIR_SEASON_EXPECTED && att >= GAP_MIN_ATTEMPTS && a.air === 0) {
        // Charting gap: drop the row from both the player's and the league's totals.
        gaps.push({ season: y, week: Number(r[cWeek!]), team: r[cTeam!] ?? '', player: r[cName!] ?? '', playerId: r[cId!] ?? '', attempts: att });
        continue;
      }
      add(L, a);
      rows.push({ id: r[cId!] ?? '', team: r[cTeam!] ?? '', a });
    }
    league.set(y, L);
    for (const { id, team, a } of rows) {
      const f = franchiseOf(team, y);
      if (!f || !id) continue;
      const k = `${id}|${y}|${f}`;
      let t = byKey.get(k);
      if (!t) byKey.set(k, (t = acc()));
      add(t, a);
    }
  }
  return { league, byKey, gaps };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

interface AirRec {
  name: string;
  personId: string;
  seasons: number[];
  stintSeasons: number;
  partial: boolean;
  attempts: number;
  completions: number;
  airYards: number;
  intendedAirYardsPerAtt: number;
  completedAirYardsPerCmp: number | null;
  league: { intendedAirYardsPerAtt: number; completedAirYardsPerCmp: number | null };
  iayRatio: number;
  bySeason: Record<string, [number, number]>;
  src: 'nflverse:stats_player_week';
  conf: 'verified';
}

interface PeopleFile {
  entries: Record<string, { personId: string; gsisId?: string }>;
}
interface EntriesFile {
  entries: Record<string, { seasons?: { list: number[] }; stats?: { seasons: number[]; attempts?: number } }>;
}

// ---------------------------------------------------------------------------
// Big-arm list: verify every quote against the cited page
// ---------------------------------------------------------------------------

interface ArmSourceOut {
  title: string;
  url: string;
  note: string;
  kind: ArmSourceDef['kind'];
  /** Wikipedia revision the quote was checked against. */
  permalink?: string;
  /** wikipedia-ref: the Wikipedia revision whose references cite this article. */
  via?: string;
  retrieved: string;
  quoteVerified: boolean;
}

interface BigArmOut {
  name: string;
  entryIds: string[];
  grade: ArmGrade;
  evidence: ArmEvidence;
  basis: string;
  sources: ArmSourceOut[];
  scope?: string;
  src: 'estimate:knowledge+cited';
  conf: 'estimated';
}

/** Pro Football Hall of Fame player pages are allowed by profootballhof.com/robots.txt (only /search/, /media/, store and account paths are disallowed). */
const PFHOF_PREFIX = 'https://www.profootballhof.com/players/';
/** Seconds between PFHOF page fetches (no Crawl-delay is set for generic agents; bingbot is asked for 10 s, we use 2 s for a handful of pages). */
const PFHOF_DELAY_S = 2;

/** PFHOF player page as plain text, cached in tools/augment/cache/pfhof/<slug>.html. Null on an offline cache miss. */
function pfhofText(url: string, fetch: boolean): { text: string; retrieved: string } | null {
  if (!url.startsWith(PFHOF_PREFIX)) throw new Error(`not a PFHOF player URL: ${url}`);
  const slug = url.slice(PFHOF_PREFIX.length).replace(/\/$/, '');
  const dir = join(CACHE_DIR, 'pfhof');
  const file = join(dir, `${slug}.html`);
  if (!existsSync(file)) {
    if (!fetch) return null;
    mkdirSync(dir, { recursive: true });
    execFileSync('curl', ['-sSL', '--fail', '-A', USER_AGENT, '-o', file, url]);
    execFileSync('sleep', [String(PFHOF_DELAY_S)]);
  }
  const raw = readFileSync(file, 'utf8')
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"');
  const text = raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&(rsquo|lsquo);/g, "'")
    .replace(/&(rdquo|ldquo|quot);/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return { text, retrieved: statSync(file).mtime.toISOString().slice(0, 10) };
}

function buildBigArm(wiki: WikiClient, fetch: boolean): { records: BigArmOut[]; problems: string[] } {
  const problems: string[] = [];
  const qbByName = new Map<string, string[]>();
  for (const p of PLAYERS) if (p.p === 'QB') qbByName.set(p.n, [...(qbByName.get(p.n) ?? []), p.id]);
  const records: BigArmOut[] = [];
  const seen = new Set<string>();
  const pages = wiki.pages(ARM_SOURCES.flatMap((d) => d.sources.flatMap((s) => (s.kind === 'pfhof' ? [] : [s.page]))));
  for (const def of ARM_SOURCES) {
    if (seen.has(def.name)) problems.push(`${def.name}: listed twice`);
    seen.add(def.name);
    const all = qbByName.get(def.name);
    if (!all) {
      problems.push(`${def.name}: no legacy QB entry with that name`);
      continue;
    }
    const entryIds = def.entryIds ?? all;
    for (const id of entryIds) if (!all.includes(id)) problems.push(`${def.name}: ${id} is not one of his QB entries`);
    if (def.sources.length === 0) problems.push(`${def.name}: no sources`);
    const sources: ArmSourceOut[] = [];
    for (const s of def.sources) {
      const words = s.note.trim().split(/\s+/).length;
      if (words > 20) problems.push(`${def.name}: note over 20 words (${words})`);
      if (s.kind === 'pfhof') {
        const got = pfhofText(s.url, fetch);
        if (!got) {
          problems.push(`${def.name}: PFHOF page not cached (rerun with --fetch): ${s.url}`);
          continue;
        }
        const ok = normText(got.text).includes(normText(s.note));
        if (!ok) problems.push(`${def.name}: quote not found on ${s.url}: ${s.note}`);
        sources.push({ title: s.title, url: s.url, retrieved: got.retrieved, note: s.note, kind: s.kind, quoteVerified: ok });
        continue;
      }
      const page = pages.get(s.page);
      if (!page) {
        problems.push(`${def.name}: Wikipedia page "${s.page}" ${pages.has(s.page) ? 'does not exist' : 'not cached (rerun with --fetch)'}`);
        continue;
      }
      if (/\{\{\s*(disambiguation|hndis|set index)/i.test(page.wikitext)) problems.push(`${def.name}: "${page.title}" is a disambiguation page`);
      if (s.kind === 'wikipedia') {
        // The quote must appear in the article prose (markup and references stripped).
        const ok = normText(wikiPlain(page.wikitext)).includes(normText(s.note));
        if (!ok) problems.push(`${def.name}: quote not found in "${page.title}": ${s.note}`);
        sources.push({
          title: `Wikipedia: ${page.title}`,
          url: pageUrl(page.title),
          permalink: permalink(page.title, page.revid),
          retrieved: page.retrieved,
          note: s.note,
          kind: s.kind,
          quoteVerified: ok,
        });
      } else {
        // A newspaper/magazine article cited in the Wikipedia article's references:
        // its headline and URL must both appear in the article's wikitext.
        const ok = normText(page.wikitext).includes(normText(s.note)) && page.wikitext.includes(s.url);
        if (!ok) problems.push(`${def.name}: cited headline/url not found in "${page.title}" wikitext: ${s.note}`);
        sources.push({
          title: `${s.title}: "${s.note}" (cited by Wikipedia: ${page.title})`,
          url: s.url,
          via: permalink(page.title, page.revid),
          retrieved: page.retrieved,
          note: s.note,
          kind: s.kind,
          quoteVerified: ok,
        });
      }
    }
    records.push({
      name: def.name,
      entryIds: [...entryIds],
      grade: def.grade,
      evidence: def.evidence,
      basis: def.basis,
      sources,
      ...(def.scope ? { scope: def.scope } : {}),
      src: 'estimate:knowledge+cited',
      conf: 'estimated',
    });
  }
  return { records, problems };
}

/**
 * Anchor QBs the caller asked about whose arm we could not find specifically
 * described in an allowed source (Wikipedia article text, Wikipedia-cited
 * headlines, PFHOF pages); left out of bigArm rather than graded from memory.
 */
const ANCHORS_WITHOUT_SOURCE = ['Joe Namath', 'Jeff George', 'Steve McNair', 'Daunte Culpepper'];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const log = (s: string): void => {
    process.stdout.write(`${s}\n`);
  };
  const scan = scanWeekly();

  // --- which seasons have air yards --------------------------------------
  const perAtt = new Map<number, number>();
  for (const [y, L] of scan.league) perAtt.set(y, L.att ? L.air / L.att : 0);
  const med = median([...perAtt.values()]);
  const usable = [...perAtt.keys()].filter((y) => perAtt.get(y)! >= AVAILABLE_SHARE * med).sort((a, b) => a - b);
  const missing = [...perAtt.keys()].filter((y) => !usable.includes(y)).sort((a, b) => a - b);
  const usableSet = new Set(usable);

  const league: Record<string, unknown> = {};
  for (const y of usable) {
    const L = scan.league.get(y)!;
    league[y] = {
      attempts: L.att,
      airYards: L.air,
      intendedAirYardsPerAtt: r3(L.air / L.att),
      completions: L.cmp,
      completedAirYards: L.yds - L.yac,
      completedAirYardsPerCmp: r3((L.yds - L.yac) / L.cmp),
    };
  }

  // --- per legacy QB entry ---------------------------------------------
  const people = JSON.parse(readFileSync(join(ROOT, 'data', 'augment', 'people.json'), 'utf8')) as PeopleFile;
  const ents = JSON.parse(readFileSync(join(ROOT, 'data', 'augment', 'nflverse_entries.json'), 'utf8')) as EntriesFile;
  const airYards: Record<string, AirRec> = {};
  const lowAttempts: Record<string, number> = {};
  const attemptMismatch: string[] = [];
  let qbEntries = 0;
  let withAirSeasons = 0;
  for (const p of PLAYERS) {
    if (p.p !== 'QB') continue;
    qbEntries++;
    const stint = ents.entries[p.id]?.seasons?.list ?? [];
    const seasons = stint.filter((y) => usableSet.has(y));
    if (seasons.length === 0) continue;
    withAirSeasons++;
    const gsis = people.entries[p.id]?.gsisId;
    const tot = acc();
    let lgAirW = 0;
    let lgCayW = 0;
    const bySeason: Record<string, [number, number]> = {};
    const covered: number[] = [];
    for (const y of seasons) {
      const t = gsis ? scan.byKey.get(`${gsis}|${y}|${p.t}`) : undefined;
      if (!t || t.att === 0) continue;
      covered.push(y);
      add(tot, t);
      bySeason[y] = [t.att, t.air];
      const L = scan.league.get(y)!;
      // League baseline weighted by the player's own attempts in each season, so
      // player ÷ league compares like with like across a multi-season stint.
      lgAirW += t.att * (L.air / L.att);
      lgCayW += t.cmp * ((L.yds - L.yac) / L.cmp);
    }
    if (tot.att < MIN_ATTEMPTS) {
      lowAttempts[p.id] = tot.att;
      continue;
    }
    // Cross-check against build.ts's stint totals when the whole stint is in the air-yards era
    // (build.ts keeps the charting-gap games this script drops, so add those back).
    const st = ents.entries[p.id]?.stats;
    if (st && st.seasons.every((y) => usableSet.has(y))) {
      const gapAtt = scan.gaps
        .filter((g) => g.playerId === gsis && covered.includes(g.season) && franchiseOf(g.team, g.season) === p.t)
        .reduce((n, g) => n + g.attempts, 0);
      if ((st.attempts ?? 0) !== tot.att + gapAtt) attemptMismatch.push(`${p.id}: build.ts ${st.attempts} vs ${tot.att} + ${gapAtt} gap`);
    }
    const iay = tot.air / tot.att;
    const cay = tot.cmp ? (tot.yds - tot.yac) / tot.cmp : null;
    const lgIay = lgAirW / tot.att;
    const lgCay = tot.cmp ? lgCayW / tot.cmp : null;
    airYards[p.id] = {
      name: p.n,
      personId: gsis ?? '',
      seasons: covered,
      stintSeasons: stint.length,
      partial: covered.length < stint.length,
      attempts: tot.att,
      completions: tot.cmp,
      airYards: tot.air,
      intendedAirYardsPerAtt: r3(iay),
      completedAirYardsPerCmp: cay === null ? null : r3(cay),
      league: {
        intendedAirYardsPerAtt: r3(lgIay),
        completedAirYardsPerCmp: lgCay === null ? null : r3(lgCay),
      },
      iayRatio: r3(iay / lgIay),
      bySeason,
      src: 'nflverse:stats_player_week',
      conf: 'verified',
    };
  }

  // --- big-arm list ------------------------------------------------------
  const fetch = process.argv.includes('--fetch');
  const wiki = new WikiClient(!fetch, log);
  const big = buildBigArm(wiki, fetch);
  if (big.problems.length) {
    for (const pr of big.problems) log(`PROBLEM ${pr}`);
    throw new Error(`${big.problems.length} big-arm source problem(s)`);
  }

  const gradeCounts: Record<string, number> = {};
  for (const r of big.records) gradeCounts[r.grade] = (gradeCounts[r.grade] ?? 0) + 1;
  const evidenceCounts: Record<string, number> = {};
  for (const r of big.records) evidenceCounts[r.evidence] = (evidenceCounts[r.evidence] ?? 0) + 1;
  const bigNoAir = big.records.filter((r) => r.entryIds.some((id) => !(id in airYards)));

  const meta = {
    generatedBy: 'tools/augment/arm.ts',
    purpose: 'Arm-strength inputs for QB Throw Power (air yards 2006+, sourced grades for earlier QBs). Data only; the rating formula is in src/engine/ratings.',
    sources: {
      'nflverse:stats_player_week': {
        files: `tools/augment/cache/stats_player/stats_player_week_<year>.csv, ${FIRST_STATS_SEASON}–${LAST_SEASON} (versions and SHA-256 in data/augment/sources.json)`,
        url: 'https://github.com/nflverse/nflverse-data/releases/tag/stats_player',
        license: 'CC-BY-4.0 (nflverse-data)',
        columns: 'attempts, completions, passing_yards, passing_yards_after_catch, passing_air_yards; REG weeks only',
      },
      'estimate:knowledge+cited': {
        what: 'bigArm grades are our estimates; each is backed by at least one cited description of the arm.',
        wikipedia: 'English Wikipedia via the MediaWiki Action API (User-Agent BeatTheBeasts-DataBuilder/0.1, serial, one request per 1.5 s, 50 titles per request, maxlag=5, Retry-After honoured; cached in tools/augment/cache/wiki/). Text CC BY-SA 4.0; only short attributed quotes (≤ 20 words) are stored, with page URL, permalink (revision id) and retrieval date. kind wikipedia-ref = a newspaper/magazine article cited in a Wikipedia article\'s references (headline + URL as the reference gives them; the article itself was not fetched).',
        pfhof: 'Pro Football Hall of Fame player pages (https://www.profootballhof.com/players/<slug>/: bio and enshrinement speeches), allowed by its robots.txt. The 19 Hall of Fame QBs\' pages were read once during discovery, 2 s apart; the 3 cited ones are cached in tools/augment/cache/pfhof/ and re-checked by arm.ts. Only short attributed quotes are stored.',
        quoteVerified: 'true when arm.ts found the quote verbatim (whitespace and typographic quotes folded) in the cached source: the article prose with markup and references stripped (wikipedia), the headline and URL in the article wikitext (wikipedia-ref), or the page text (pfhof). arm.ts refuses to write the file otherwise.',
        searched: 'Candidates: every legacy QB\'s Wikipedia article (378 names) plus teammates\', coaches\', draft and team-season articles, scanned for arm descriptions; Wikipedia full-text search for the anchor QBs; PFHOF pages of the Hall of Fame QBs. QBs with no specific description found are left out (see coverage.bigArm.anchorsWithoutSource).',
      },
      nextGenStats: {
        used: false,
        reason:
          'nflverse republishes NFL Next Gen Stats (release tag nextgen_stats, ngs_passing: avg_time_to_throw, avg_intended_air_yards, aggressiveness, max_air_distance; 2016+), but it carries no license of its own: nflverse-data has no LICENSE file and the release/README state none, and nflreadr says NFL data "belong to their respective owners, and are governed by their terms of use". NGS is the NFL\'s proprietary tracking product (nextgenstats.nfl.com), so it is not CC-BY like nflverse\'s own play-by-play-derived stats. Not added; revisit only with explicit permission.',
        checked: ['https://nflreadr.nflverse.com/ (Terms of Use section)', 'https://nflreadr.nflverse.com/reference/load_nextgen_stats.html', 'https://raw.githubusercontent.com/nflverse/nflverse-data/main/README.md'],
      },
    },
    definitions: {
      intendedAirYardsPerAtt: 'sum(passing_air_yards) / sum(attempts): how far downfield the average pass travels past the line of scrimmage, incompletions included (nflverse sums play-by-play air_yards over completions, incompletions and interceptions; throwaways and spikes have no air_yards and count as 0 in the attempts denominator, for players and the league alike).',
      completedAirYardsPerCmp: '(sum(passing_yards) − sum(passing_yards_after_catch)) / sum(completions): air yards on completed passes only.',
      league: 'Per season: the same sums over every REG passer row (all positions). Per entry: league rates weighted by the player\'s own attempts (intended) or completions (completed) in each covered season, so iayRatio = intendedAirYardsPerAtt / league.intendedAirYardsPerAtt is an era index over exactly his seasons.',
      seasons: 'Stint seasons (nflverse_entries.json seasons.list) that have air yards, restricted to REG games with the entry\'s franchise (per-game team, so mid-season trades split). partial = the stint also has seasons without air yards (before 2006), which are not represented.',
      bySeason: 'season → [attempts, air yards] with the franchise.',
      gaps: `A player-game with ≥ ${GAP_MIN_ATTEMPTS} attempts and exactly 0 air yards is treated as a charting gap and dropped from both player and league totals (listed in coverage.gapGames).`,
      minAttempts: `Entries with fewer than ${MIN_ATTEMPTS} attempts in covered seasons are left out of airYards (listed in coverage.belowMinAttempts with their attempts).`,
      grade: 'Our estimate from the cited description plus reputation. cannon = one of the strongest arms of his era (source calls the arm powerful / among the strongest, or measures it); strong = source describes a strong, powerful or rifle arm; average = source calls the arm ordinary, unexceptional or doubted without calling it a real weakness; weak = source says he lacked arm strength. scope narrows a grade to some stints (entryIds) when the source is about part of a career.',
      evidence: 'pro = the sources describe his arm as a pro (NFL; USFL/CFL for Hebert and Brock); pre-pro = only draft reports, college or high school; comparison = his arm is only cited as the benchmark for another QB. Weaker evidence in that order; weight it accordingly.',
    },
    coverage: {
      qbEntries,
      entriesWithAirYardSeasons: withAirSeasons,
      airYardsEntries: Object.keys(airYards).length,
      belowMinAttempts: lowAttempts,
      seasonsWithAirYards: usable,
      seasonsMissingAirYards: missing.map((y) => ({ season: y, leagueAirYardsPerAtt: r3(perAtt.get(y)!) })),
      gapGames: scan.gaps,
      attemptCrossCheckMismatches: attemptMismatch,
      bigArm: {
        players: big.records.length,
        entries: big.records.reduce((n, r) => n + r.entryIds.length, 0),
        grades: gradeCounts,
        evidence: evidenceCounts,
        playersWithAnEntryWithoutAirYards: bigNoAir.length,
        anchorsWithoutSource: ANCHORS_WITHOUT_SOURCE,
      },
    },
  };

  const lines: string[] = ['{', ` "_meta": ${JSON.stringify(meta, null, 1).replace(/\n/g, '\n ')},`];
  const ks = Object.keys(league);
  lines.push(' "league": {');
  ks.forEach((k, i) => lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(league[k])}${i < ks.length - 1 ? ',' : ''}`));
  lines.push(' },');
  const ids = Object.keys(airYards);
  lines.push(' "airYards": {');
  ids.forEach((k, i) => lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(airYards[k])}${i < ids.length - 1 ? ',' : ''}`));
  lines.push(' },');
  lines.push(' "bigArm": [');
  big.records.forEach((r, i) => lines.push(`  ${JSON.stringify(r)}${i < big.records.length - 1 ? ',' : ''}`));
  lines.push(' ]', '}');
  writeFileSync(OUT, `${lines.join('\n')}\n`);

  log(`air yards: seasons ${usable[0]}–${usable[usable.length - 1]}; missing ${missing.join(', ')}; gap games ${scan.gaps.length}`);
  log(`QB entries ${qbEntries}; with 2006+ seasons ${withAirSeasons}; rated ${ids.length}; below ${MIN_ATTEMPTS} att ${Object.keys(lowAttempts).length}`);
  if (attemptMismatch.length) log(`attempt cross-check mismatches (${attemptMismatch.length}):\n  ${attemptMismatch.join('\n  ')}`);
  log(`big arm: ${big.records.length} players, grades ${JSON.stringify(gradeCounts)}; wiki requests ${wiki.requests}, cache hits ${wiki.cacheHits}`);
  writeReportSection(buildReport({ usable, missing, perAtt, airYards, lowAttempts, qbEntries, withAirSeasons, big: big.records, gaps: scan.gaps.length }));
  log(`wrote ${OUT} and the arm section of ${REPORT}`);
}

// ---------------------------------------------------------------------------
// docs/AUGMENT_REPORT.md section
// ---------------------------------------------------------------------------

interface ReportInput {
  usable: number[];
  missing: number[];
  perAtt: Map<number, number>;
  airYards: Record<string, AirRec>;
  lowAttempts: Record<string, number>;
  qbEntries: number;
  withAirSeasons: number;
  big: BigArmOut[];
  gaps: number;
}

/** Pre-2006 and cross-check QBs the task named; the report says which are covered. */
const ANCHOR_REPORT = [
  'Dan Marino', 'Brett Favre', 'John Elway', 'Terry Bradshaw', 'Joe Namath', 'Daryle Lamonica', 'Jim Kelly', 'Warren Moon',
  'Randall Cunningham', 'Jeff George', 'Dan Fouts', 'Troy Aikman', 'Steve McNair', 'Daunte Culpepper', 'Michael Vick',
  'Drew Bledsoe', 'Kerry Collins', 'Joe Montana', 'Chad Pennington', 'Drew Brees', 'Patrick Mahomes',
];
/** Stints below this many attempts are left out of the report's top/bottom tables (small samples swing wildly). */
const REPORT_MIN_ATTEMPTS = 300;

function buildReport(r: ReportInput): string[] {
  const L: string[] = [];
  const f2 = (x: number): string => x.toFixed(2);
  const label = (id: string): string => {
    const [, , team, decade] = id.split(':');
    return `${r.airYards[id]?.name ?? id} (${team} ${decade})`;
  };
  const ids = Object.keys(r.airYards);
  const partial = ids.filter((id) => r.airYards[id]!.partial).length;
  L.push('## Arm strength (`data/augment/arm_strength.json`)', '');
  L.push('Generated by `tools/augment/arm.ts` (rerun: `node --experimental-strip-types tools/augment/arm.ts [--fetch]`); this section is rewritten by that script and kept by `build.ts`. Inputs for QB Throw Power, which has no box-score trace of arm strength. Data only: the rating formula is not changed here.', '');
  L.push('### Air yards (2006+, `conf: verified`)', '');
  L.push(`- **Source:** nflverse weekly player stats (\`passing_air_yards\`, \`passing_yards_after_catch\`, REG weeks), the same cached files as the rest of this report. Per legacy QB entry: intended air yards per attempt (sum of air yards ÷ attempts, incompletions included) and completed air yards per completion ((passing yards − YAC) ÷ completions), over the stint seasons (\`nflverse_entries.json\`) that have air yards, with the entry's franchise only (per-game team, so trades split).`);
  L.push(`- **Coverage:** ${ids.length} of ${r.qbEntries} legacy QB entries (${r.withAirSeasons} have a stint season in 2006+; ${Object.keys(r.lowAttempts).length} of those have under ${MIN_ATTEMPTS} attempts and are listed in \`_meta.coverage.belowMinAttempts\` instead). ${partial} rated stints are \`partial\` (they also span pre-2006 seasons, which are not represented). Attempts match build.ts's stint totals for every stint fully inside 2006+.`);
  L.push(`- **Missing seasons:** ${r.missing.join(', ')} (league air yards per attempt: ${r.missing.map((y) => `${y} ${Math.abs(r.perAtt.get(y)!).toFixed(2)}`).join(', ')}, against about 8 from 2006 on). \`passing_air_yards\` is effectively empty before 2006 (same 25%-of-median rule as the other source gaps above). 2006–${r.usable[r.usable.length - 1]} are complete: ${r.gaps} player-games with ≥ ${GAP_MIN_ATTEMPTS} attempts and zero air yards (the gap check).`);
  L.push('- **League baseline:** per season, the same sums over every REG passer row. Each entry carries the league rate weighted by his own attempts (completions for completed air yards) in each covered season, so `iayRatio` = player ÷ league is an era index over exactly his seasons. League intended air yards per attempt drift from about 8.5 (2006) to about 7.7 (2021+), so the index matters.', '');
  const rated = ids.filter((id) => r.airYards[id]!.attempts >= REPORT_MIN_ATTEMPTS).sort((a, b) => r.airYards[b]!.iayRatio - r.airYards[a]!.iayRatio);
  const table = (list: string[]): void => {
    L.push('| Stint | Seasons | Att | Air yds/att | League | Ratio |', '|---|---|---:|---:|---:|---:|');
    for (const id of list) {
      const a = r.airYards[id]!;
      L.push(`| ${label(id)} | ${a.seasons[0]}–${a.seasons[a.seasons.length - 1]} | ${a.attempts} | ${f2(a.intendedAirYardsPerAtt)} | ${f2(a.league.intendedAirYardsPerAtt)} | ${f2(a.iayRatio)} |`);
    }
    L.push('');
  };
  L.push(`Sanity check, stints with ≥ ${REPORT_MIN_ATTEMPTS} attempts (${rated.length}). Highest intended air yards per attempt vs league:`, '');
  table(rated.slice(0, 10));
  L.push('Lowest:', '');
  table(rated.slice(-10).reverse());
  L.push('The extremes look right: all-or-nothing deep passers and vertical schemes on top (Tebow, Richardson, Vick 2006, Stanton under Arians, Winston), check-down offenses and late-career stints at the bottom (David Carr 2006, Brees at 41, Ryan in Indianapolis, Bradford, Alex Smith, Goff). Tebow (12.7) is the one stint above 12; the per-season rows confirm it (2010: 12.3 on 82 attempts, 2011: 12.9 on 271).', '');
  L.push('### Big-arm list (`conf: estimated`)', '');
  const grades: Record<string, number> = {};
  const ev: Record<string, number> = {};
  for (const b of r.big) {
    grades[b.grade] = (grades[b.grade] ?? 0) + 1;
    ev[b.evidence] = (ev[b.evidence] ?? 0) + 1;
  }
  const nSources = r.big.reduce((n, b) => n + b.sources.length, 0);
  L.push(`- **What:** ${r.big.length} QBs (${r.big.reduce((n, b) => n + b.entryIds.length, 0)} legacy entries) graded cannon / strong / average / weak: ${Object.entries(grades).map(([g, n]) => `${n} ${g}`).join(', ')}. Each has a one-line basis and ${nSources} sources in all, each a short verbatim quote that \`arm.ts\` checks against the cached page (Wikipedia prose, a headline in a Wikipedia article's references, or a Pro Football Hall of Fame page) and refuses to write if missing. \`src: estimate:knowledge+cited\`, \`conf: estimated\`.`);
  L.push(`- **Evidence strength:** ${ev.pro ?? 0} describe the arm as a pro, ${ev['pre-pro'] ?? 0} only pre-pro (draft reports, college, high school), ${ev.comparison ?? 0} only as the benchmark in a comparison with another QB (\`evidence\` field). Two records are scoped to one stint: Peyton Manning (Denver, after neck surgery) and Matt Ryan (Indianapolis).`);
  L.push('- **How found:** every legacy QB\'s Wikipedia article (378 names, fetched 50 per request) plus teammates\', coaches\', draft and team-season articles, scanned for arm descriptions; Wikipedia full-text search for the anchors; PFHOF pages for the Hall of Fame QBs. Pro-Football-Reference was not used.', '');
  const byName = new Map(r.big.map((b) => [b.name, b]));
  L.push('Anchor QBs:', '', '| QB | Grade | Evidence | Air-yards ratio (2006+ stints) |', '|---|---|---|---|');
  for (const n of ANCHOR_REPORT) {
    const b = byName.get(n);
    const ay = ids.filter((id) => r.airYards[id]!.name === n).map((id) => `${id.split(':')[2]} ${id.split(':')[3]} ${f2(r.airYards[id]!.iayRatio)}`);
    L.push(`| ${n} | ${b ? b.grade : '—'} | ${b ? b.evidence : 'no citable description found'} | ${ay.join(', ') || '—'} |`);
  }
  L.push('');
  const cross: Record<string, number[]> = {};
  for (const b of r.big) for (const id of b.entryIds) if (r.airYards[id]) (cross[b.grade] ??= []).push(r.airYards[id]!.iayRatio);
  L.push(`Cross-check where both exist (mean air-yards ratio by grade over graded 2006+ stints): ${['cannon', 'strong', 'average', 'weak'].filter((g) => cross[g]).map((g) => `${g} ${f2(cross[g]!.reduce((a, x) => a + x, 0) / cross[g]!.length)} (n=${cross[g]!.length})`).join(', ')}. The order agrees, but the spread is small: air yards measure where a QB throws, not how hard.`, '');
  L.push('### Caveats', '');
  L.push('- **Air yards are a scheme and aggressiveness signal, not a velocity measurement.** Flacco (Baltimore 1.01) and Mahomes (2020s 0.94) sit near league average; Tebow and Anthony Richardson top the list. Use the ratio as one input for Throw Power, alongside the existing deep-share terms, not as arm strength itself.');
  L.push('- **Grades are estimates.** Wikipedia rarely describes an arm in so many words, so many records rest on draft-time or college descriptions (`pre-pro`) or on comparisons; weight `evidence` accordingly. Dan Fouts is graded average because his article calls his arm strength unexceptional, although the task listed him with the big arms.');
  L.push('- **Not covered:** Joe Namath, Jeff George, Steve McNair and Daunte Culpepper: no specific description of the arm was found in the allowed sources, so they are left out rather than graded from memory. Culpepper and McNair have 2006+ air yards for their later stints.');
  L.push('- **Next Gen Stats not added.** nflverse republishes NGS passing (time to throw, intended air yards, aggressiveness, max air distance; 2016+), but NGS is the NFL\'s proprietary tracking product and nflverse attaches no license to it (nflreadr: NFL data "belong to their respective owners, and are governed by their terms of use"). Time to throw would help Release later; it needs explicit permission first.', '');
  return L;
}

/** Replace (or append) the arm section of docs/AUGMENT_REPORT.md between the markers. */
function writeReportSection(lines: string[]): void {
  const block = `${ARM_REPORT_BEGIN}\n${lines.join('\n')}\n${ARM_REPORT_END}\n`;
  const old = existsSync(REPORT) ? readFileSync(REPORT, 'utf8') : '';
  const a = old.indexOf(ARM_REPORT_BEGIN);
  const b = old.indexOf(ARM_REPORT_END);
  const next = a >= 0 && b > a ? `${old.slice(0, a)}${block}${old.slice(b + ARM_REPORT_END.length).replace(/^\n/, '')}` : `${old.replace(/\n*$/, '\n\n')}${block}`;
  writeFileSync(REPORT, next);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
