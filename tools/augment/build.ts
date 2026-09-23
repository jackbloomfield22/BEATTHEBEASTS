// nflverse augmentation pipeline (Milestone 2, Ratings).
//
// One command, from the repo root:
//
//   node --experimental-strip-types tools/augment/build.ts [--fetch] [--force]
//
//   --fetch   run tools/augment/fetch-nflverse.ts first (downloads only what
//             is missing from tools/augment/cache/; --force re-downloads all)
//
// Without --fetch the cache must already be populated. Reads the legacy data
// (data/legacy, never edited) and the cached nflverse files, and writes:
//
//   data/augment/people.json                  entry id → nflverse person
//   data/augment/nflverse_entries.json        seasons, games, body, combine, stats per entry
//   data/augment/ol_rosters.json              offensive linemen per OL unit
//   data/augment/era_baselines_1999plus.json  league-wide rates per season
//   data/augment/suggested_corrections.json   proposals for data/corrections.json
//   docs/AUGMENT_REPORT.md                    match rates, problems, coverage
//
// Output is deterministic for a given cache (sorted keys, no timestamps other
// than the fetch dates recorded in data/augment/sources.json).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFENSE, OL_UNITS, PLAYERS } from '../../data/legacy/index.ts';
import { NAME_ALIASES, NOT_A_PERSON } from './aliases.ts';
import { markedSections } from './report-sections.ts';
import { FIRST_STATS_SEASON, LAST_SEASON, ROOT, SOURCES_PATH, type Manifest } from './fetch-nflverse.ts';
import { decadeSeasons, type LegacyFranchise } from './franchises.ts';
import { addLine, emptyLine, isRealGsis, loadAll, type NflData, type Person, type RosterRow, type StatLine } from './load.ts';
import { looseKey, normName, slug, squashName } from './names.ts';

const OUT = join(ROOT, 'data', 'augment');
const REPORT = join(ROOT, 'docs', 'AUGMENT_REPORT.md');

// ---------------------------------------------------------------------------
// Constants (each documented)
// ---------------------------------------------------------------------------

/**
 * Roster statuses that do NOT count as a season with the team: preseason or
 * in-season cuts, practice squad, free agents, retired/exempt lists. A season
 * with one of these statuses still counts when the weekly stats show REG games
 * for that franchise (that catches players cut or moved after playing).
 * Checked against the status codes present per decade (ACT, RES, INA, PUP,
 * SUS, NWT, RSN, RSR and the 1960s–1980s trade codes TRC/TRD/TRT all count).
 */
const NON_ROSTER_STATUSES = new Set(['CUT', 'DEV', 'UFA', 'RFA', 'RET', 'E14', 'EXE']);

/** nflverse roster position / depth-chart codes that are offensive line. */
const OL_CODES = new Set(['OL', 'T', 'G', 'C', 'OT', 'OG', 'OC', 'LT', 'RT', 'LG', 'RG']);

/** Roster codes compatible with each legacy position (used to break ties, never to reject a unique match). */
const POS_COMPAT: Readonly<Record<string, ReadonlySet<string>>> = {
  QB: new Set(['QB']),
  RB: new Set(['RB', 'FB', 'HB']),
  WR: new Set(['WR', 'FL', 'SE']),
  TE: new Set(['TE']),
  DE: new Set(['DE', 'DL', 'OLB', 'EDGE', 'LDE', 'RDE']),
  DT: new Set(['DT', 'DL', 'NT']),
  LB: new Set(['LB', 'OLB', 'ILB', 'MLB', 'LOLB', 'ROLB', 'WLB', 'SLB']),
  CB: new Set(['CB', 'DB', 'LCB', 'RCB', 'NB']),
  S: new Set(['S', 'SS', 'FS', 'DB', 'SAF']),
  OL: OL_CODES,
};

/**
 * Per-game consistency check, for stints fully covered by 1999+ stats with at
 * least MIN_GAMES games. The M2 brief's example threshold (35% off) is
 * reported as a count, but legacy yards per game run systematically high
 * (median +15% to +45% by position; they look like peak-season rates, see the
 * report), so a 35% gap is common rather than "gross". Suggestions are made
 * only when legacy is more than YPG_GROSS_FACTOR× verified or less than
 * 1/YPG_GROSS_FACTOR of it.
 */
const YPG_REL_THRESHOLD = 0.35;
const YPG_GROSS_FACTOR = 2;
const MIN_GAMES = 8;
/** Cap on per-game suggestions written (sorted by size of the gap). */
const MAX_YPG_SUGGESTIONS = 40;

/**
 * A name-only match must have a season within this many years of the stint's
 * decade; otherwise the entry stays unmatched (namesake from another era).
 */
const NAME_ONLY_WINDOW = 10;

/**
 * OL rosters keep every key-list lineman plus this many others, by seasons
 * with the franchise in the decade (the ratings engine needs five starters;
 * 2000s+ rosters list 40–60 linemen per decade including reserves).
 */
const OL_MAX_OTHERS = 15;

/**
 * Legacy codes that are easy to confuse because the franchises shared Los
 * Angeles (Rams LAR, Raiders LV 1982–1994, Chargers LAC 1960 / 2017–). A
 * name-only stint whose person was on one of the others in the same decade
 * gets a team-code suggestion instead of an exclude.
 */
const LA_FRANCHISES: ReadonlySet<string> = new Set(['LAR', 'LV', 'LAC']);

const SRC = {
  rosters: 'nflverse:rosters',
  players: 'nflverse:players',
  combine: 'nflverse:combine',
  stats: 'nflverse:stats_player_week',
  schedules: 'nflverse:schedules',
} as const;

type Conf = 'verified' | 'reference' | 'estimated';
type Method = 'name+team+season' | 'alias' | 'name-only' | 'unmatched';

// ---------------------------------------------------------------------------
// Entries to match
// ---------------------------------------------------------------------------

type Kind = 'offense' | 'defense' | 'ol-key';

interface Entry {
  readonly id: string;
  readonly name: string;
  readonly kind: Kind;
  readonly pos: string;
  readonly franchise: LegacyFranchise;
  readonly decade: string;
  /** Legacy per-game stats (offense only), for the consistency check. */
  readonly s?: Readonly<Record<string, number | boolean | undefined>>;
  readonly unitId?: string;
  readonly keyIndex?: number;
}

function legacyEntries(): Entry[] {
  const out: Entry[] = [];
  for (const p of PLAYERS) out.push({ id: p.id, name: p.n, kind: 'offense', pos: p.p, franchise: p.t as LegacyFranchise, decade: p.d, s: p.s as unknown as Record<string, number> });
  for (const d of DEFENSE) out.push({ id: d.id, name: d.n, kind: 'defense', pos: d.p, franchise: d.t as LegacyFranchise, decade: d.d });
  for (const u of OL_UNITS) {
    u.key.split(' · ').forEach((name, i) => {
      out.push({ id: `ol-key:${u.id}:${i}`, name: name.trim(), kind: 'ol-key', pos: 'OL', franchise: u.t as LegacyFranchise, decade: u.d, unitId: u.id, keyIndex: i });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Franchise + decade index
// ---------------------------------------------------------------------------

interface Stint {
  readonly person: Person;
  readonly rows: RosterRow[];
  /** season → REG stats with this franchise. */
  readonly stats: Map<number, StatLine>;
}

type FdIndex = Map<string, Map<string, Stint>>;
const fdKey = (f: string, d: string): string => `${f}|${d}`;

function buildFdIndex(data: NflData): FdIndex {
  const idx: FdIndex = new Map();
  const stint = (f: string, d: string, person: Person): Stint => {
    const k = fdKey(f, d);
    let m = idx.get(k);
    if (!m) idx.set(k, (m = new Map()));
    let s = m.get(person.id);
    if (!s) m.set(person.id, (s = { person, rows: [], stats: new Map() }));
    return s;
  };
  for (const r of data.rosters) {
    const person = data.persons.get(r.personId);
    if (!person) throw new Error(`roster row without person: ${r.name}`);
    stint(r.franchise, `${Math.floor(r.season / 10) * 10}s`, person).rows.push(r);
  }
  for (const [pid, bySeason] of data.stats) {
    const person = data.persons.get(pid);
    if (!person) continue;
    for (const [season, byFr] of bySeason) {
      for (const [fr, line] of byFr) {
        if (line.games > 0) stint(fr, `${Math.floor(season / 10) * 10}s`, person).stats.set(season, line);
      }
    }
  }
  return idx;
}

/** Seasons that count for a stint: non-cut roster seasons plus any season with REG games for the franchise. */
function stintSeasons(st: Stint): number[] {
  const s = new Set<number>();
  for (const r of st.rows) if (!NON_ROSTER_STATUSES.has(r.status)) s.add(r.season);
  for (const [season, line] of st.stats) if (line.games > 0) s.add(season);
  return [...s].sort((a, b) => a - b);
}

function positionsOf(rows: readonly RosterRow[]): Set<string> {
  const s = new Set<string>();
  for (const r of rows) {
    if (r.position) s.add(r.position);
    if (r.depthPosition) s.add(r.depthPosition);
  }
  return s;
}

function posCompatible(pos: string, person: Person, rows?: readonly RosterRow[]): boolean {
  const compat = POS_COMPAT[pos];
  if (!compat) return true;
  const have = positionsOf(rows && rows.length > 0 ? rows : person.rows);
  if (have.size === 0 && person.players) have.add(person.players.position);
  for (const p of have) if (compat.has(p)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

interface Match {
  readonly entry: Entry;
  readonly person: Person | null;
  readonly personId: string;
  readonly method: Method;
  readonly conf: Conf;
  readonly flags: string[];
  /** Other candidates considered when ambiguous. */
  readonly alternatives: string[];
  readonly nvName?: string;
}

function nameKeys(p: Person): { exact: Set<string>; squash: Set<string>; loose: Set<string> } {
  const exact = new Set<string>();
  const squash = new Set<string>();
  const loose = new Set<string>();
  for (const n of p.names) {
    exact.add(normName(n));
    squash.add(squashName(n));
    loose.add(looseKey(n));
  }
  return { exact, squash, loose };
}

class Matcher {
  private keysCache = new Map<string, ReturnType<typeof nameKeys>>();
  private globalExact = new Map<string, Set<string>>();
  private globalLoose = new Map<string, Set<string>>();
  private readonly data: NflData;
  private readonly fd: FdIndex;
  constructor(data: NflData, fd: FdIndex) {
    this.data = data;
    this.fd = fd;
    for (const p of data.persons.values()) {
      const k = this.keys(p);
      for (const n of k.exact) addTo(this.globalExact, n, p.id);
      for (const n of k.squash) addTo(this.globalExact, n, p.id);
      for (const n of k.loose) addTo(this.globalLoose, n, p.id);
    }
  }

  keys(p: Person): ReturnType<typeof nameKeys> {
    let k = this.keysCache.get(p.id);
    if (!k) this.keysCache.set(p.id, (k = nameKeys(p)));
    return k;
  }

  match(e: Entry): Match {
    if (NOT_A_PERSON.has(e.name)) {
      return { entry: e, person: null, personId: `unmatched:${slug(e.name)}`, method: 'unmatched', conf: 'estimated', flags: ['not-a-person'], alternatives: [] };
    }
    const stints = this.fd.get(fdKey(e.franchise, e.decade)) ?? new Map<string, Stint>();
    const target = normName(e.name);
    const targetSquash = squashName(e.name);
    const targetLoose = looseKey(e.name);
    const aliasNorms = (NAME_ALIASES[e.name] ?? []).map(normName);

    const passes: { method: Method; test: (p: Person) => boolean }[] = [
      { method: 'name+team+season', test: (p) => this.keys(p).exact.has(target) || this.keys(p).squash.has(targetSquash) },
      { method: 'alias', test: (p) => aliasNorms.some((a) => this.keys(p).exact.has(a)) },
      { method: 'alias', test: (p) => this.keys(p).loose.has(targetLoose) },
    ];
    for (const pass of passes) {
      const cands = [...stints.values()].filter((st) => pass.test(st.person));
      if (cands.length === 0) continue;
      const chosen = this.choose(e, cands);
      if (!chosen) continue;
      const flags = [...chosen.flags];
      const person = chosen.stint.person;
      if (!posCompatible(e.pos, person, chosen.stint.rows)) flags.push('position-mismatch');
      if (stintSeasons(chosen.stint).length === 0) flags.push('zero-seasons');
      const nvName = mostCommonName(chosen.stint.rows) ?? [...person.names][0];
      return {
        entry: e,
        person,
        personId: person.id,
        method: pass.method,
        conf: flags.includes('ambiguous') ? 'estimated' : 'verified',
        flags,
        alternatives: chosen.alternatives,
        nvName: nvName !== e.name ? nvName : undefined,
      };
    }

    // name-only: the person exists in nflverse but not on this franchise in this decade.
    const ids = new Set([...(this.globalExact.get(target) ?? []), ...(this.globalExact.get(targetSquash) ?? []), ...aliasNorms.flatMap((a) => [...(this.globalExact.get(a) ?? [])])]);
    if (ids.size === 0) for (const id of this.globalLoose.get(targetLoose) ?? []) ids.add(id);
    const from = Number(e.decade.slice(0, 4));
    const mid = from + 5;
    const career = (p: Person): number[] => {
      const seasons = [...p.rows.map((r) => r.season), ...(this.data.stats.get(p.id)?.keys() ?? [])];
      if (p.players?.rookieSeason) seasons.push(p.players.rookieSeason);
      return seasons;
    };
    // Only namesakes whose career touches the decade ± NAME_ONLY_WINDOW years
    // count; a 2010s Greg McElroy is not a 1990s TE.
    const people = [...ids]
      .map((id) => this.data.persons.get(id))
      .filter((p): p is Person => !!p && career(p).some((s) => s >= from - NAME_ONLY_WINDOW && s <= from + 9 + NAME_ONLY_WINDOW));
    if (people.length > 0) {
      const dist = (p: Person): number => Math.min(...career(p).map((s) => Math.abs(s - mid)));
      const withFranchise = (p: Person): number => (p.rows.some((r) => r.franchise === e.franchise) || [...(this.data.stats.get(p.id)?.values() ?? [])].some((m) => m.has(e.franchise)) ? 1 : 0);
      // Prefer someone who was with this franchise at some point (a decade
      // slip), then the nearest career, then the matching position.
      people.sort((a, b) => withFranchise(b) - withFranchise(a) || dist(a) - dist(b) || Number(posCompatible(e.pos, b)) - Number(posCompatible(e.pos, a)) || a.id.localeCompare(b.id));
      const best = people[0] as Person;
      const flags = ['not-on-franchise-in-decade'];
      if (people.length > 1) {
        // Exactly one namesake was ever with this franchise: that is the one legacy meant.
        const second = people[1] as Person;
        flags.push(withFranchise(best) === 1 && withFranchise(second) === 0 ? 'homonym-resolved-by-franchise' : 'ambiguous');
      }
      if (!posCompatible(e.pos, best)) flags.push('position-mismatch');
      return {
        entry: e,
        person: best,
        personId: best.id,
        method: 'name-only',
        conf: 'estimated',
        flags,
        alternatives: people.slice(1).map((p) => p.id),
        nvName: [...best.names][0] !== e.name ? [...best.names][0] : undefined,
      };
    }
    const namesakes = ids.size > 0 ? ['namesakes-outside-era'] : [];
    return { entry: e, person: null, personId: `unmatched:${slug(e.name)}`, method: 'unmatched', conf: 'estimated', flags: namesakes, alternatives: [...ids].sort() };
  }

  private choose(e: Entry, cands: Stint[]): { stint: Stint; flags: string[]; alternatives: string[] } | null {
    if (cands.length === 1) return { stint: cands[0] as Stint, flags: [], alternatives: [] };
    const bySeasons = (a: Stint, b: Stint): number => stintSeasons(b).length - stintSeasons(a).length || a.person.id.localeCompare(b.person.id);
    const compat = cands.filter((st) => posCompatible(e.pos, st.person, st.rows));
    if (compat.length === 1) {
      return { stint: compat[0] as Stint, flags: ['homonym-resolved-by-position'], alternatives: cands.filter((c) => c !== compat[0]).map((c) => c.person.id) };
    }
    const pool = (compat.length > 0 ? compat : cands).slice().sort(bySeasons);
    const best = pool[0] as Stint;
    return { stint: best, flags: ['ambiguous'], alternatives: cands.filter((c) => c !== best).map((c) => c.person.id) };
  }
}

function addTo(m: Map<string, Set<string>>, k: string, v: string): void {
  let s = m.get(k);
  if (!s) m.set(k, (s = new Set()));
  s.add(v);
}

function mostCommonName(rows: readonly RosterRow[]): string | undefined {
  const c = new Map<string, number>();
  for (const r of rows) c.set(r.name, (c.get(r.name) ?? 0) + 1);
  let best: string | undefined;
  let n = 0;
  for (const [k, v] of c) if (v > n || (v === n && best !== undefined && k < best)) [best, n] = [k, v];
  return best;
}

// ---------------------------------------------------------------------------
// Per-entry augmentation
// ---------------------------------------------------------------------------

function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

function mode<T>(xs: readonly T[]): T | null {
  const c = new Map<T, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  let best: T | null = null;
  let n = 0;
  for (const [k, v] of c) if (v > n) [best, n] = [k, v];
  return best;
}

const r1 = (x: number): number => Math.round(x * 10) / 10;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const r3 = (x: number): number => Math.round(x * 1000) / 1000;

interface Physical {
  heightIn?: number;
  weightLb?: number;
  birthDate?: string;
  basis: 'stint-rosters' | 'players' | 'career-rosters';
  src: string;
  conf: Conf;
}

function physicalFor(person: Person, stintRows: readonly RosterRow[]): Physical | undefined {
  const pick = (rows: readonly RosterRow[]) => ({
    h: median(rows.map((r) => r.heightIn).filter((x): x is number => x !== null)),
    w: median(rows.map((r) => r.weightLb).filter((x): x is number => x !== null)),
    b: mode(rows.map((r) => r.birthDate).filter((x): x is string => x !== null)),
  });
  const stint = pick(stintRows);
  const pl = person.players;
  const career = pick(person.rows);
  // Each value: the stint's roster rows, else players.csv, else the person's other roster seasons.
  type Basis = Physical['basis'];
  const choose = <T>(a: T | null, b: T | null | undefined, c: T | null): [T | null, Basis | null] =>
    a !== null ? [a, 'stint-rosters'] : b !== null && b !== undefined ? [b, 'players'] : c !== null ? [c, 'career-rosters'] : [null, null];
  const [h, hb] = choose(stint.h, pl?.heightIn, career.h);
  const [w, wb] = choose(stint.w, pl?.weightLb, career.w);
  const [b, bb] = choose(stint.b, pl?.birthDate, career.b);
  const bases = [hb, wb, bb].filter((x): x is Basis => x !== null);
  if (bases.length === 0) return undefined;
  const srcs = new Set(bases.map((x) => (x === 'players' ? SRC.players : SRC.rosters)));
  // basis names where the body (height/weight) came from; birth date follows the same order.
  const basis = hb ?? wb ?? bb ?? 'stint-rosters';
  const out: Physical = { basis, src: [...srcs].sort().join('+'), conf: 'verified' };
  if (h !== null) out.heightIn = r1(h);
  if (w !== null) out.weightLb = Math.round(w);
  if (b !== null) out.birthDate = b;
  return out;
}

interface CombineOut {
  year: number;
  pos: string;
  heightIn?: number;
  weightLb?: number;
  forty?: number;
  bench?: number;
  vertical?: number;
  broad?: number;
  cone?: number;
  shuttle?: number;
  matchedBy: 'pfr_id' | 'name+draft_year';
  src: string;
  conf: Conf;
}

class CombineIndex {
  private byPfr = new Map<string, NflData['combine'][number]>();
  private byName = new Map<string, NflData['combine'][number][]>();
  private readonly data: NflData;
  constructor(data: NflData) {
    this.data = data;
    for (const c of data.combine) {
      if (c.pfr) this.byPfr.set(c.pfr, c);
      const l = this.byName.get(c.norm) ?? [];
      l.push(c);
      this.byName.set(c.norm, l);
    }
  }
  find(person: Person): CombineOut | undefined {
    let row: NflData['combine'][number] | undefined;
    let matchedBy: CombineOut['matchedBy'] = 'pfr_id';
    for (const p of person.pfrIds) {
      row = this.byPfr.get(p);
      if (row) break;
    }
    if (!row) {
      // Name + draft year: the combine season must equal the person's rookie
      // season (players.csv) or first roster season, and the row must not
      // carry a pfr_id that belongs to someone else.
      const first = person.players?.rookieSeason ?? Math.min(...person.rows.map((r) => r.season), 9999);
      const cands: NflData['combine'][number][] = [];
      for (const n of person.norms) {
        for (const c of this.byName.get(n) ?? []) {
          if (c.pfr && this.data.byPfr.has(c.pfr) && this.data.byPfr.get(c.pfr) !== person.id) continue;
          if (c.season === first || c.draftYear === first || c.season === person.players?.draftYear) cands.push(c);
        }
      }
      if (cands.length === 1) {
        row = cands[0];
        matchedBy = 'name+draft_year';
      }
    }
    if (!row) return undefined;
    const out: CombineOut = { year: row.season, pos: row.pos, matchedBy, src: SRC.combine, conf: 'verified' };
    if (row.heightIn !== null) out.heightIn = row.heightIn;
    if (row.weightLb !== null) out.weightLb = row.weightLb;
    if (row.forty !== null) out.forty = row.forty;
    if (row.bench !== null) out.bench = row.bench;
    if (row.vertical !== null) out.vertical = row.vertical;
    if (row.broad !== null) out.broad = row.broad;
    if (row.cone !== null) out.cone = row.cone;
    if (row.shuttle !== null) out.shuttle = row.shuttle;
    return out;
  }
}

const OFFENSE_FIELDS = [
  'completions', 'attempts', 'passing_yards', 'passing_tds', 'interceptions', 'sacks', 'sack_yards',
  'carries', 'rushing_yards', 'rushing_tds', 'rushing_fumbles', 'rushing_fumbles_lost',
  'receptions', 'targets', 'receiving_yards', 'receiving_tds', 'receiving_fumbles', 'receiving_fumbles_lost',
] as const;

function statsOut(kind: Kind, line: StatLine, seasons: number[], stintSeasonsList: number[], perSeason: Map<number, StatLine>, avail: Availability): Record<string, unknown> {
  const out: Record<string, unknown> = {
    seasons,
    complete: stintSeasonsList.every((s) => s >= FIRST_STATS_SEASON) && seasons.length > 0,
    games: line.games,
  };
  // Totals of a partially recorded field over only the seasons that have it.
  const partial = (f: PartialField, extra: (l: StatLine) => Record<string, number> = () => ({})) => {
    const ss = seasons.filter((y) => avail[f].has(y));
    let total = 0;
    const extras: Record<string, number> = {};
    for (const y of ss) {
      const l = perSeason.get(y);
      if (!l) continue;
      total += l[f];
      for (const [k, v] of Object.entries(extra(l))) extras[k] = (extras[k] ?? 0) + v;
    }
    return { seasons: ss, total, extras };
  };
  if (kind === 'offense') {
    for (const f of OFFENSE_FIELDS) out[f] = r2(line[f]);
    // Targets exist only for some seasons (none in 2003–2008). targets,
    // targetedReceptions and targetedReceivingYards all cover targetsSeasons
    // only, so catch % and yards per target stay consistent.
    const t = partial('targets', (l) => ({ targetedReceptions: l.receptions, targetedReceivingYards: l.receiving_yards }));
    out.targetsSeasons = t.seasons;
    if (t.seasons.length > 0) {
      out.targets = t.total;
      out.targetedReceptions = t.extras.targetedReceptions ?? 0;
      out.targetedReceivingYards = t.extras.targetedReceivingYards ?? 0;
    } else {
      delete out.targets;
    }
  } else {
    out.tackles_solo = line.tackles_solo;
    // nflverse splits a shared tackle into the primary tackler ("with assist")
    // and the other players on it ("assists"); the box-score convention gives
    // each of them an assisted tackle, so combined = solo + with_assist +
    // assists (e.g. Ray Lewis 2010: 70 + 32 + 37 = 139). The with_assist /
    // assists split drifts by season in the source; use the combined total.
    out.tackles_assist = line.tackles_with_assist + line.tackle_assists;
    out.tackles_combined = line.tackles_solo + line.tackles_with_assist + line.tackle_assists;
    // TFL (missing 2003–2011) and QB hits (missing 2003–2005) cover only the listed seasons.
    const tfl = partial('tfl');
    out.tflSeasons = tfl.seasons;
    out.tfl = r2(tfl.total);
    out.sacks = r2(line.def_sacks);
    const qbh = partial('qb_hits');
    out.qbHitsSeasons = qbh.seasons;
    out.qb_hits = qbh.total;
    out.interceptions = line.def_interceptions;
    out.pass_defended = line.pass_defended;
    out.forced_fumbles = line.forced_fumbles;
    out.fumble_recoveries = line.fumble_recoveries;
    out.def_tds = line.def_tds;
    out.safeties = line.safeties;
  }
  // Zero totals are omitted to keep the file small (absent = 0; documented in _meta).
  for (const k of Object.keys(out)) if (out[k] === 0 && k !== 'games' && !k.startsWith('targeted') && k !== 'targets') delete out[k];
  out.src = SRC.stats;
  out.conf = 'verified';
  return out;
}

// ---------------------------------------------------------------------------
// Era baselines
// ---------------------------------------------------------------------------

function passerRating(cmp: number, att: number, yds: number, td: number, int: number): number {
  // NFL passer rating; each component clamped to [0, 2.375].
  const clamp = (x: number) => Math.max(0, Math.min(2.375, x));
  const a = clamp((cmp / att - 0.3) * 5);
  const b = clamp((yds / att - 3) * 0.25);
  const c = clamp((td / att) * 20);
  const d = clamp(2.375 - (int / att) * 25);
  return ((a + b + c + d) / 6) * 100;
}

/**
 * Fields the nflverse source did not record in some seasons. Found by
 * checking league totals per season (docs/AUGMENT_REPORT.md prints them):
 * targets are ~0 in 2003–2008 (the play-by-play has no intended receiver on
 * incompletions for those years, and the season-level file sets targets =
 * receptions instead), TFL is 0 in 2003–2011 and QB hits 0 in 2003–2005.
 */
const PARTIAL_FIELDS = ['targets', 'tfl', 'qb_hits'] as const;
type PartialField = (typeof PARTIAL_FIELDS)[number];
/** A season "has" a field when its league total is at least this share of the median season's total. */
const AVAILABLE_SHARE = 0.25;

type Availability = Record<PartialField, Set<number>>;

function fieldAvailability(data: NflData): Availability {
  const out = {} as Availability;
  for (const f of PARTIAL_FIELDS) {
    const totals = [...data.league].map(([y, l]) => [y, l[f]] as const);
    const med = median(totals.map(([, v]) => v)) ?? 0;
    out[f] = new Set(totals.filter(([, v]) => v >= AVAILABLE_SHARE * med).map(([y]) => y));
  }
  return out;
}

function missingSeasons(avail: Set<number>): number[] {
  const out: number[] = [];
  for (let y = FIRST_STATS_SEASON; y <= LAST_SEASON; y++) if (!avail.has(y)) out.push(y);
  return out;
}

function eraBaselines(data: NflData, avail: Availability): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (let y = FIRST_STATS_SEASON; y <= LAST_SEASON; y++) {
    const L = data.league.get(y);
    if (!L) throw new Error(`no league totals for ${y}`);
    const reg = data.games.filter((g) => g.season === y && g.gameType === 'REG' && g.homeScore !== null && g.awayScore !== null);
    const teams = new Set(reg.flatMap((g) => [g.home, g.away]));
    const tg = reg.length * 2;
    const points = reg.reduce((s, g) => s + (g.homeScore ?? 0) + (g.awayScore ?? 0), 0);
    const tackles = L.tackles_solo + L.tackles_with_assist + L.tackle_assists;
    out[String(y)] = {
      teams: teams.size,
      teamGames: tg,
      cmpPct: r2((100 * L.completions) / L.attempts),
      ypa: r3(L.passing_yards / L.attempts),
      tdPct: r3((100 * L.passing_tds) / L.attempts),
      intPct: r3((100 * L.interceptions) / L.attempts),
      sackPct: r3((100 * L.sacks) / (L.attempts + L.sacks)),
      passerRating: r2(passerRating(L.completions, L.attempts, L.passing_yards, L.passing_tds, L.interceptions)),
      ypc: r3(L.rushing_yards / L.carries),
      pointsPerTeamGame: r3(points / tg),
      passAttPerTeamGame: r3(L.attempts / tg),
      passCmpPerTeamGame: r3(L.completions / tg),
      passYdsPerTeamGame: r3(L.passing_yards / tg),
      passTdPerTeamGame: r3(L.passing_tds / tg),
      intPerTeamGame: r3(L.interceptions / tg),
      sacksPerTeamGame: r3(L.sacks / tg),
      rushAttPerTeamGame: r3(L.carries / tg),
      rushYdsPerTeamGame: r3(L.rushing_yards / tg),
      rushTdPerTeamGame: r3(L.rushing_tds / tg),
      yardsPerReception: r3(L.receiving_yards / L.receptions),
      yardsPerTarget: r3(L.receiving_yards / L.targets),
      catchRate: r2((100 * L.receptions) / L.targets),
      defIntPerTeamGame: r3(L.def_interceptions / tg),
      defSacksPerTeamGame: r3(L.def_sacks / tg),
      passDefendedPerTeamGame: r3(L.pass_defended / tg),
      tacklesPerTeamGame: r3(tackles / tg),
      src: `${SRC.stats}+${SRC.schedules}`,
      conf: 'verified',
    };
    if (!avail.targets.has(y)) {
      // No targets recorded this season in nflverse: leave the target rates out.
      delete out[String(y)]!.yardsPerTarget;
      delete out[String(y)]!.catchRate;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// JSON writing (one record per line, stable order)
// ---------------------------------------------------------------------------

function writeJson(file: string, meta: unknown, key: string, records: Record<string, unknown> | unknown[]): number {
  const lines: string[] = ['{', ` "_meta": ${JSON.stringify(meta)},`];
  if (Array.isArray(records)) {
    lines.push(` "${key}": [`);
    records.forEach((r, i) => lines.push(`  ${JSON.stringify(r)}${i < records.length - 1 ? ',' : ''}`));
    lines.push(' ]');
  } else {
    const ks = Object.keys(records);
    lines.push(` "${key}": {`);
    ks.forEach((k, i) => lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(records[k])}${i < ks.length - 1 ? ',' : ''}`));
    lines.push(' }');
  }
  lines.push('}');
  const text = `${lines.join('\n')}\n`;
  writeFileSync(join(OUT, file), text);
  return Buffer.byteLength(text);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Suggestion {
  id: string;
  field: string;
  old: unknown;
  new: unknown;
  reason: string;
  source: string;
  conf: Conf;
  kind: 'catch-pct-count' | 'per-game-gap' | 'team-code' | 'exclude-no-stint' | 'exclude-filler-row' | 'exclude-duplicate-person';
}

function main(): void {
  if (process.argv.includes('--fetch')) {
    const args = ['--experimental-strip-types', join(ROOT, 'tools', 'augment', 'fetch-nflverse.ts')];
    if (process.argv.includes('--force')) args.push('--force');
    execFileSync(process.execPath, args, { stdio: 'inherit' });
  }
  const log = (s: string) => process.stdout.write(`${s}\n`);
  const data = loadAll(log);
  const fd = buildFdIndex(data);
  const matcher = new Matcher(data, fd);
  const combineIdx = new CombineIndex(data);
  const entries = legacyEntries();
  const matches = entries.map((e) => matcher.match(e));
  const avail = fieldAvailability(data);

  // Key lists: the same person twice in one unit's list (alias pairs).
  const byUnit = new Map<string, Match[]>();
  for (const m of matches) if (m.entry.unitId) byUnit.set(m.entry.unitId, [...(byUnit.get(m.entry.unitId) ?? []), m]);
  for (const ms of byUnit.values()) {
    const seen = new Map<string, Match>();
    for (const m of ms) {
      if (m.person && seen.has(m.personId)) m.flags.push(`same-person-as-key-${seen.get(m.personId)?.entry.keyIndex}`);
      else seen.set(m.personId, m);
    }
  }

  // --- people.json ---------------------------------------------------------
  const people: Record<string, unknown> = {};
  for (const m of matches) {
    const rec: Record<string, unknown> = { personId: m.personId };
    const gsis = m.person?.gsisIds.find(isRealGsis) ?? m.person?.gsisIds[0];
    if (gsis) rec.gsisId = gsis;
    if (m.person?.pfrIds[0]) rec.pfrId = m.person.pfrIds[0];
    rec.method = m.method;
    rec.conf = m.conf;
    if (m.nvName) rec.nvName = m.nvName;
    if (m.flags.length) rec.flags = m.flags;
    if (m.alternatives.length) rec.alternatives = m.alternatives;
    people[m.entry.id] = rec;
  }

  // --- nflverse_entries.json ----------------------------------------------
  const entryOut: Record<string, unknown> = {};
  const stintOf = (m: Match): Stint | undefined => (m.person ? fd.get(fdKey(m.entry.franchise, m.entry.decade))?.get(m.person.id) : undefined);
  const stintStats = new Map<string, { line: StatLine; seasons: number[]; list: number[]; targets: number; targetedReceptions: number; targetsSeasons: number[] }>();
  for (const m of matches) {
    if (m.entry.kind === 'ol-key') continue;
    const rec: Record<string, unknown> = { personId: m.personId };
    if (!m.person) {
      entryOut[m.entry.id] = rec;
      continue;
    }
    const st = stintOf(m);
    const list = st ? stintSeasons(st) : [];
    const games: Record<string, number> = {};
    const { from, to } = decadeSeasons(m.entry.decade, LAST_SEASON);
    const line = emptyLine();
    const statSeasons: number[] = [];
    const perSeason = new Map<number, StatLine>();
    for (let y = Math.max(from, FIRST_STATS_SEASON); y <= to; y++) {
      const l = st?.stats.get(y);
      if (list.includes(y)) games[String(y)] = l?.games ?? 0;
      if (l && l.games > 0) {
        addLine(line, l);
        perSeason.set(y, l);
        statSeasons.push(y);
      } else if (list.includes(y)) {
        statSeasons.push(y); // on the roster, zero REG games recorded
      }
    }
    const seasonsRec: Record<string, unknown> = { list };
    if (Object.keys(games).length) seasonsRec.games = games;
    seasonsRec.src = Object.keys(games).length ? `${SRC.rosters}+${SRC.stats}` : SRC.rosters;
    seasonsRec.conf = 'verified';
    if (m.method === 'name-only') seasonsRec.note = 'person never on this franchise in this decade';
    rec.seasons = seasonsRec;
    const phys = physicalFor(m.person, st?.rows.filter((r) => list.includes(r.season)) ?? []);
    if (phys) rec.physical = phys;
    const comb = combineIdx.find(m.person);
    if (comb) rec.combine = comb;
    if (statSeasons.length > 0) {
      const so = statsOut(m.entry.kind, line, statSeasons, list, perSeason, avail);
      rec.stats = so;
      stintStats.set(m.entry.id, { line, seasons: statSeasons, list, targets: (so.targets as number | undefined) ?? 0, targetedReceptions: (so.targetedReceptions as number | undefined) ?? 0, targetsSeasons: so.targetsSeasons as number[] | undefined ?? [] });
    }
    entryOut[m.entry.id] = rec;
  }

  // --- ol_rosters.json -------------------------------------------------------
  const olOut: Record<string, unknown> = {};
  let olLinemen = 0;
  for (const u of OL_UNITS) {
    const stints = fd.get(fdKey(u.t, u.d)) ?? new Map<string, Stint>();
    const keyMatches = byUnit.get(u.id) ?? [];
    const keyIdx = new Map<string, number[]>();
    for (const m of keyMatches) if (m.person && m.method !== 'name-only') keyIdx.set(m.personId, [...(keyIdx.get(m.personId) ?? []), m.entry.keyIndex ?? -1]);
    const linemen: Record<string, unknown>[] = [];
    for (const st of stints.values()) {
      const olRows = st.rows.filter((r) => OL_CODES.has(r.position) || OL_CODES.has(r.depthPosition));
      const inKey = keyIdx.get(st.person.id);
      if (olRows.length === 0 && !inKey) continue;
      const seasons = stintSeasons(st);
      const olSeasons = [...new Set(olRows.filter((r) => !NON_ROSTER_STATUSES.has(r.status)).map((r) => r.season))].sort((a, b) => a - b);
      const useSeasons = olRows.length ? olSeasons : seasons;
      if (useSeasons.length === 0 && !inKey) continue;
      const rows = st.rows.filter((r) => useSeasons.includes(r.season));
      const phys = physicalFor(st.person, rows);
      const rec: Record<string, unknown> = {
        personId: st.person.id,
        name: mostCommonName(rows.length ? rows : st.rows),
        positions: [...positionsOf(olRows.length ? olRows : st.rows)].sort(),
        count: useSeasons.length,
        seasons: useSeasons,
      };
      if (phys?.heightIn !== undefined) rec.heightIn = phys.heightIn;
      if (phys?.weightLb !== undefined) rec.weightLb = phys.weightLb;
      if (phys?.birthDate !== undefined) rec.birthDate = phys.birthDate;
      rec.inKeyList = inKey ? inKey : false;
      if (olRows.length === 0) rec.note = 'key-list name never listed at an OL position';
      linemen.push(rec);
    }
    linemen.sort((a, b) => Number(b.inKeyList !== false) - Number(a.inKeyList !== false) || (b.count as number) - (a.count as number) || String(a.name).localeCompare(String(b.name)));
    const keyed = linemen.filter((l) => l.inKeyList !== false);
    const others = linemen.filter((l) => l.inKeyList === false);
    const kept = [...keyed, ...others.slice(0, OL_MAX_OTHERS)];
    olLinemen += kept.length;
    olOut[u.id] = { team: u.t, decade: u.d, key: u.key, linemen: kept, omitted: others.length - Math.min(others.length, OL_MAX_OTHERS), src: SRC.rosters, conf: 'verified' };
  }

  // --- era baselines ---------------------------------------------------------
  const eras = eraBaselines(data, avail);

  // --- suggested corrections ---------------------------------------------------
  const suggestions: Suggestion[] = [];
  const legacyById = new Map(PLAYERS.map((p) => [p.id, p]));
  // 1. WR catch % holding a count.
  for (const p of PLAYERS) {
    if (p.p !== 'WR' || p.s.c === undefined || p.s.c <= 80) continue;
    const ss = stintStats.get(p.id);
    if (!ss || ss.targets === 0) continue;
    const pct = Math.round((100 * ss.targetedReceptions) / ss.targets);
    suggestions.push({
      id: p.id,
      field: 's.c',
      old: p.s.c,
      new: pct,
      reason: `catch % holds a count (${p.s.c}); verified ${ss.targetedReceptions} rec / ${ss.targets} targets with ${p.t} in ${ss.targetsSeasons.join(', ')} (REG) = ${pct}%`,
      source: `${SRC.stats} (REG, ${ss.targetsSeasons.join(',')})`,
      conf: 'verified',
      kind: 'catch-pct-count',
    });
  }
  // 2. Per-game yards far from verified, for stints fully covered by stats.
  const gaps: (Suggestion & { logRatio: number })[] = [];
  const bias = new Map<string, number[]>();
  let over35 = 0;
  let checked = 0;
  for (const p of PLAYERS) {
    const ss = stintStats.get(p.id);
    if (!ss || ss.line.games < MIN_GAMES) continue;
    if (!ss.list.length || !ss.list.every((s) => s >= FIRST_STATS_SEASON)) continue;
    // What legacy y means follows the stat schema the entry carries (a few
    // entries carry another position's schema, DATA_VALIDATION §1).
    const field = p.s.i !== undefined ? 'passing_yards' : p.s.b !== undefined || p.s.p !== undefined ? 'receiving_yards' : p.p === 'RB' ? 'rushing_yards' : 'receiving_yards';
    const verified = ss.line[field] / ss.line.games;
    const legacyY = p.s.y;
    if (verified <= 0 || legacyY <= 0) continue;
    checked++;
    const rel = (legacyY - verified) / verified;
    const band = `${p.p} imp ${p.imp >= 80 ? '≥ 80' : '< 80'}`;
    bias.set(band, [...(bias.get(band) ?? []), rel]);
    if (Math.abs(rel) > YPG_REL_THRESHOLD) over35++;
    const logRatio = Math.log(legacyY / verified);
    if (Math.abs(logRatio) <= Math.log(YPG_GROSS_FACTOR)) continue;
    gaps.push({
      id: p.id,
      field: 's.y',
      old: legacyY,
      new: r1(verified),
      reason: `legacy ${legacyY} ${field.replace('_', ' ')}/g vs verified ${r1(verified)} (${ss.line[field]} yds in ${ss.line.games} REG games with ${p.t}, ${ranges(ss.list)}); ${rel > 0 ? '+' : ''}${Math.round(rel * 100)}%`,
      source: `${SRC.stats} (REG, ${ss.seasons.join(',')})`,
      conf: 'verified',
      kind: 'per-game-gap',
      logRatio,
    });
  }
  gaps.sort((a, b) => Math.abs(b.logRatio) - Math.abs(a.logRatio) || a.id.localeCompare(b.id));
  const gapTotal = gaps.length;
  for (const g of gaps.slice(0, MAX_YPG_SUGGESTIONS)) {
    const { logRatio: _lr, ...rest } = g;
    suggestions.push(rest);
  }
  const gapStats = { checked, over35, gross: gapTotal, bias: [...bias].sort(([a], [b]) => a.localeCompare(b)).map(([band, rels]) => {
    const r = [...rels].sort((a, b) => a - b);
    const q = (f: number) => r[Math.min(r.length - 1, Math.floor(f * r.length))] as number;
    return { band, n: r.length, p10: q(0.1), median: q(0.5), p90: q(0.9) };
  }) };
  // 3. Stints that never happened (person found, never on that franchise in that decade).
  for (const m of matches) {
    if (m.entry.kind === 'ol-key' || m.method !== 'name-only' || !m.person) continue;
    // With several namesakes we can't say which one legacy meant: report only.
    if (m.flags.includes('ambiguous')) continue;
    const counted = (fr: string) =>
      [
        ...new Set([
          ...m.person!.rows.filter((r) => r.franchise === fr && !NON_ROSTER_STATUSES.has(r.status)).map((r) => r.season),
          ...[...(data.stats.get(m.person!.id) ?? new Map<number, Map<LegacyFranchise, StatLine>>())].filter(([, byFr]) => (byFr.get(fr as LegacyFranchise)?.games ?? 0) > 0).map(([s]) => s),
        ]),
      ].sort((a, b) => a - b);
    const withFranchise = counted(m.entry.franchise);
    const { from, to } = decadeSeasons(m.entry.decade, LAST_SEASON);
    const inDecade = new Map<string, number[]>();
    for (const r of m.person.rows) {
      if (r.season < from || r.season > to || NON_ROSTER_STATUSES.has(r.status)) continue;
      inDecade.set(r.franchise, [...new Set([...(inDecade.get(r.franchise) ?? []), r.season])].sort((a, b) => a - b));
    }
    const elsewhere = [...inDecade].map(([f, ss]) => `${f} ${ranges(ss)}`).join('; ') || 'no team';
    const laSwap = [...inDecade.keys()].filter((f) => f !== m.entry.franchise && LA_FRANCHISES.has(f) && LA_FRANCHISES.has(m.entry.franchise));
    if (laSwap.length === 1) {
      suggestions.push({
        id: m.entry.id,
        field: 't',
        old: m.entry.franchise,
        new: laSwap[0],
        reason: `${m.entry.name} (${m.personId}) was never on ${m.entry.franchise} in the ${m.entry.decade}; he was on ${elsewhere} (the Los Angeles ${laSwap[0] === 'LV' ? 'Raiders' : laSwap[0] === 'LAR' ? 'Rams' : 'Chargers'}): legacy used the wrong LA franchise code`,
        source: SRC.rosters,
        conf: 'verified',
        kind: 'team-code',
      });
      continue;
    }
    // Strong evidence: the person's seasons with this franchise are known and
    // all fall outside the decade (a decade slip). Weaker: never with the
    // franchise at all (possible roster gap before ~1990, or a wrong team).
    const strong = withFranchise.length > 0;
    suggestions.push({
      id: m.entry.id,
      field: 'exclude',
      old: false,
      new: true,
      reason: `${m.entry.name} (${m.personId}) is on no ${m.entry.franchise} roster in the ${m.entry.decade}; with ${m.entry.franchise}: ${withFranchise.length ? ranges(withFranchise) : 'never'}; in the ${m.entry.decade}: ${elsewhere}${strong ? '' : ' (review: could be a roster gap or a wrong team code)'}`,
      source: SRC.rosters,
      conf: strong ? 'verified' : 'reference',
      kind: 'exclude-no-stint',
    });
  }
  // 4. Defenders duplicated as offensive filler rows (DATA_VALIDATION §7), confirmed: the person never played the offensive position.
  for (const m of matches) {
    if (m.entry.kind !== 'offense' || !m.flags.includes('position-mismatch') || !m.person) continue;
    const def = DEFENSE.find((d) => d.n === m.entry.name && d.d === m.entry.decade);
    if (!def) continue;
    const st = stintOf(m);
    const pos = [...positionsOf(st?.rows ?? m.person.rows)].sort().join('/');
    suggestions.push({
      id: m.entry.id,
      field: 'exclude',
      old: false,
      new: true,
      reason: `offensive filler row for defender ${def.id}; nflverse lists ${m.entry.name} only at ${pos} with ${m.entry.franchise} in the ${m.entry.decade}`,
      source: SRC.rosters,
      conf: 'verified',
      kind: 'exclude-filler-row',
    });
  }

  // 5. The same person twice in one team+decade under two legacy names
  //    (within PLAYERS or within DEFENSE; cross-dataset filler rows are kind 4).
  const legacyInfo = new Map<string, { imp: number; legacyIndex: number }>();
  for (const p of PLAYERS) legacyInfo.set(p.id, { imp: p.imp, legacyIndex: p.legacyIndex });
  for (const d of DEFENSE) legacyInfo.set(d.id, { imp: d.imp, legacyIndex: d.legacyIndex });
  const sameStint = new Map<string, Match[]>();
  for (const m of matches) {
    if (m.entry.kind === 'ol-key' || !m.person || m.method === 'name-only') continue;
    const k = `${m.entry.kind}|${m.personId}|${m.entry.franchise}|${m.entry.decade}`;
    sameStint.set(k, [...(sameStint.get(k) ?? []), m]);
  }
  for (const group of sameStint.values()) {
    if (group.length < 2) continue;
    // Keep the row whose position fits the person, then the higher imp, then the earlier legacy row.
    const keep = group.slice().sort((a, b) => {
      const pa = Number(!a.flags.includes('position-mismatch'));
      const pb = Number(!b.flags.includes('position-mismatch'));
      const ia = legacyInfo.get(a.entry.id);
      const ib = legacyInfo.get(b.entry.id);
      return pb - pa || (ib?.imp ?? 0) - (ia?.imp ?? 0) || (ia?.legacyIndex ?? 0) - (ib?.legacyIndex ?? 0);
    })[0] as Match;
    for (const m of group) {
      if (m === keep) continue;
      suggestions.push({
        id: m.entry.id,
        field: 'exclude',
        old: false,
        new: true,
        reason: `same person (${m.personId}, ${[...(m.person?.names ?? [])].join(' / ')}) as ${keep.entry.id}: "${m.entry.name}" and "${keep.entry.name}" are one ${m.entry.franchise} ${m.entry.decade} stint entered twice; keep ${keep.entry.id} (${m.flags.includes('position-mismatch') ? 'this row has the wrong position' : 'higher imp or earlier row'})`,
        source: SRC.rosters,
        conf: 'verified',
        kind: 'exclude-duplicate-person',
      });
    }
  }

  // --- write -----------------------------------------------------------------
  const manifest = JSON.parse(readFileSync(SOURCES_PATH, 'utf8')) as Manifest;
  const datasetDates = [...new Set(manifest.files.map((f) => f.fetched))].sort();
  const commonMeta = {
    generatedBy: 'tools/augment/build.ts',
    sources: 'data/augment/sources.json',
    license: 'nflverse data, CC-BY-4.0',
    fetched: datasetDates,
    seasons: `rosters 1960–${LAST_SEASON}, stats ${FIRST_STATS_SEASON}–${LAST_SEASON} (REG)`,
  };
  const sizes: Record<string, number> = {};
  sizes['people.json'] = writeJson('people.json', {
    ...commonMeta,
    doc: 'Legacy entry id (PLAYERS, DEFENSE, and OL key-list names as ol-key:<unitId>:<index>) → nflverse person. personId: real GSIS id (00-XXXXXXX) > PFR id > other nflverse id > nv:<slug>:<birthdate> (roster-only people) > unmatched:<slug>. method name+team+season / alias = found on that franchise\'s roster in that decade; name-only = person exists but never on that franchise in that decade; unmatched = no nflverse person. flags: ambiguous, homonym-resolved-by-position, position-mismatch, zero-seasons, not-on-franchise-in-decade, not-a-person, same-person-as-key-<i>.',
  }, 'entries', people);
  sizes['nflverse_entries.json'] = writeJson('nflverse_entries.json', {
    ...commonMeta,
    doc: 'Per PLAYERS/DEFENSE entry id. seasons.list: seasons in the decade with the franchise (roster status not CUT/DEV/UFA/RFA/RET/E14/EXE, or any REG game with the franchise). seasons.games: REG games with the franchise per season (1999+; a game counts when the player recorded any stat, so it is a lower bound, mostly for OL/DB). physical: median roster height/weight and modal birth date over the stint seasons, gaps filled from players.csv then other seasons (basis says which). combine: matched by pfr_id, else name + draft year. stats: REG totals with the franchise over the stint seasons 1999+ (per-team via weekly rows, so mid-season trades split correctly); complete=false when the stint has pre-1999 seasons. Defense: tackles_assist = with_assist + assists; tackles_combined = solo + tackles_assist. Zero stat totals are omitted (absent = 0). Fields the source lacks in some seasons are summed only over the seasons that have them, listed alongside: targetsSeasons (targets, targetedReceptions, targetedReceivingYards; no targets 2003–2008, so compute catch % = targetedReceptions / targets and yards per target = targetedReceivingYards / targets), tflSeasons (no TFL 2003–2011), qbHitsSeasons (no QB hits 2003–2005). An empty list means the field is unknown for the stint, not zero.',
    missingInSource: Object.fromEntries(PARTIAL_FIELDS.map((f) => [f, missingSeasons(avail[f])])),
  }, 'entries', entryOut);
  sizes['ol_rosters.json'] = writeJson('ol_rosters.json', {
    ...commonMeta,
    doc: `Per OL_UNITS id: every person listed at an OL position (OL/T/G/C/OT/OG) on the franchise roster in that decade with at least one counted season, plus every matched key-list name. Sorted key-list first, then by seasons desc; besides the key-list names only the ${OL_MAX_OTHERS} linemen with the most seasons are kept (omitted = how many were dropped). inKeyList: key-list indexes, or false. heightIn/weightLb/birthDate: median/modal over those seasons (verified, nflverse:rosters).`,
  }, 'units', olOut);
  sizes['era_baselines_1999plus.json'] = writeJson('era_baselines_1999plus.json', {
    ...commonMeta,
    doc: 'League-wide REG-season rates per season from the sum of every player row in nflverse stats_player_week (passing counts all passers, so trick-play passes are included, as in official league totals) and nflverse schedules (points). Percentages are 0–100 (cmpPct, tdPct, intPct, sackPct = sacks/(attempts+sacks), catchRate = receptions/targets). *PerTeamGame = total / teamGames, teamGames = 2 × REG games. tacklesPerTeamGame counts combined tackles (solo + with_assist + assists). passerRating = NFL formula on league totals. ypc = rushing yards / carries (all rushers, incl. QBs). catchRate and yardsPerTarget are omitted for seasons in missingInSource.targets: nflverse has no targets for them (the play-by-play lacks the intended receiver on incompletions in 2003–2008). The combined-tackle total drifts up over the years partly from how the source records assists.',
    missingInSource: Object.fromEntries(PARTIAL_FIELDS.map((f) => [f, missingSeasons(avail[f])])),
  }, 'seasons', eras);
  sizes['suggested_corrections.json'] = writeJson('suggested_corrections.json', {
    ...commonMeta,
    doc: `Proposals for data/corrections.json (not applied). kinds: catch-pct-count (the 2020s WR c field holding a count), per-game-gap (legacy y more than ${YPG_GROSS_FACTOR}× or less than 1/${YPG_GROSS_FACTOR} of verified REG yards per game, for stints fully covered by 1999+ stats with ≥ ${MIN_GAMES} games; the ${MAX_YPG_SUGGESTIONS} largest of ${gapTotal}; new = verified per-game value, but legacy y is a peak-style rate, so review rather than apply blindly), team-code (legacy used the wrong Los Angeles franchise code), exclude-no-stint (person never on that franchise in that decade; conf reference = never with the franchise at all, review), exclude-filler-row (defender duplicated as an offensive filler row), exclude-duplicate-person (one person entered twice for the same team+decade under two spellings).`,
  }, 'corrections', suggestions);

  writeReport({ data, matches, entryOut, olOut, olLinemen, suggestions, gapTotal, gapStats, sizes, manifest, legacyById, avail });
  log(`sizes: ${JSON.stringify(sizes)}`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface ReportInput {
  data: NflData;
  matches: Match[];
  entryOut: Record<string, unknown>;
  olOut: Record<string, unknown>;
  olLinemen: number;
  suggestions: Suggestion[];
  gapTotal: number;
  avail: Availability;
  gapStats: { checked: number; over35: number; gross: number; bias: { band: string; n: number; p10: number; median: number; p90: number }[] };
  sizes: Record<string, number>;
  manifest: Manifest;
  legacyById: Map<string, (typeof PLAYERS)[number]>;
}

function ranges(seasons: Iterable<number>): string {
  const s = [...seasons].sort((a, b) => a - b);
  const out: string[] = [];
  let a = s[0];
  let prev = a;
  for (const x of s.slice(1)) {
    if (x !== (prev as number) + 1) {
      out.push(a === prev ? `${a}` : `${a}–${prev}`);
      a = x;
    }
    prev = x;
  }
  if (a !== undefined) out.push(a === prev ? `${a}` : `${a}–${prev}`);
  return out.join(', ');
}

function pct(n: number, d: number): string {
  return d === 0 ? '–' : `${((100 * n) / d).toFixed(1)}%`;
}

function writeReport(inp: ReportInput): void {
  const { data, matches, entryOut, suggestions } = inp;
  const L: string[] = [];
  const who = (m: Match) => `${m.entry.name} (${m.entry.pos} ${m.entry.franchise} ${m.entry.decade})`;
  L.push('# nflverse augmentation report', '');
  L.push('Generated by `tools/augment/build.ts`. Do not edit by hand. Rerun from the repo root:', '');
  L.push('```sh', 'node --experimental-strip-types tools/augment/build.ts --fetch', '```', '');
  L.push('`--fetch` downloads whatever is missing into `tools/augment/cache/` (gitignored, ~240 MB) and records `data/augment/sources.json`; add `--force` to re-download everything. Without `--fetch` the cache must exist.', '');
  L.push(`Data: nflverse (CC-BY-4.0): rosters 1960–${LAST_SEASON}, weekly player stats ${FIRST_STATS_SEASON}–${LAST_SEASON} (REG), players, combine, schedules. The 2020s decade runs through ${LAST_SEASON} because the legacy data already holds 2025-only stints (Sam Darnold SEA, Cooper Kupp SEA, George Pickens DAL).`, '');

  // Dataset versions
  L.push('## Dataset versions', '');
  const byDs = new Map<string, { n: number; bytes: number; dates: Set<string> }>();
  for (const f of inp.manifest.files) {
    const d = byDs.get(f.dataset) ?? { n: 0, bytes: 0, dates: new Set<string>() };
    d.n++;
    d.bytes += f.bytes;
    d.dates.add(f.fetched);
    byDs.set(f.dataset, d);
  }
  L.push('| Dataset | Files | Size | Fetched |', '|---|---:|---:|---|');
  for (const [k, d] of [...byDs].sort()) L.push(`| ${k} | ${d.n} | ${(d.bytes / 1e6).toFixed(1)} MB | ${[...d.dates].sort().join(', ')} |`);
  L.push('', 'Per-file URLs and SHA-256 hashes are in `data/augment/sources.json`. nflverse releases are rolling (no version tags), so the hashes are the version.', '');

  // Method
  L.push('## Method', '');
  L.push(
    '- **People.** nflverse has no single person key before ~1990 (1960s–1970s roster rows carry no gsis_id or pfr_id). Roster rows, players.csv rows and stats rows are clustered with a union-find over gsis_id, pfr_id and normalized name + birth date; players.csv links id-less old roster rows to their ids. Person id: real GSIS id > PFR id > other nflverse id (ESB-style) > `nv:<slug>:<birthdate>`.',
    '- **Matching.** Each legacy entry is matched only against people on that franchise\'s rosters (or with REG games for it) in that decade: exact normalized name (case, accents, punctuation, Jr./Sr./II/III dropped), then the manual alias table (`tools/augment/aliases.ts`), then nickname-folded first name + last name with middle initials dropped. Several candidates: the one whose roster position fits the legacy position wins, else the one with most seasons (flagged `ambiguous`). No roster match: a namesake anywhere in nflverse within ±' + NAME_ONLY_WINDOW + ' years of the decade (`name-only`, preferring one who was ever with the franchise), else `unmatched`.',
    '- **Seasons.** A season counts when the person has a roster row with the franchise whose status is not a cut, practice-squad, free-agent or retired status (' + [...NON_ROSTER_STATUSES].join(', ') + '), or has any REG game for the franchise in the weekly stats.',
    '- **Games and stats (1999+).** Built from nflverse weekly player stats, where every row carries the team of that game, so mid-season trades split exactly (Randy Moss 2010: MIN 4, NE 4, TEN 5 games). Only REG weeks count. A game counts when the player has a row that week, i.e. recorded any stat; for offensive skill players and defenders this is close to games played, for linemen it undercounts. The season-level stats file only carries `recent_team`, so it is not used.',
    '- **Body.** Median roster height and weight, modal birth date, over the stint\'s counted seasons; gaps filled from players.csv, then the person\'s other roster seasons (`basis` says which).',
    '- **Combine** (2000+): by pfr_id, else unique name + draft year.',
    '- **Era baselines:** league REG totals per season (sum over every player row) and schedules for points; see `_meta.doc` in the file.',
    '',
  );
  // Roster density: how complete are the old rosters?
  const density = new Map<string, { rows: number; teamSeasons: Set<string> }>();
  for (const r of data.rosters) {
    const d = `${Math.floor(r.season / 10) * 10}s`;
    const x = density.get(d) ?? { rows: 0, teamSeasons: new Set<string>() };
    if (!NON_ROSTER_STATUSES.has(r.status)) x.rows++;
    x.teamSeasons.add(`${r.team}|${r.season}`);
    density.set(d, x);
  }
  L.push('Roster density (counted rows per team-season). The 1960s–1980s rosters are thinner than modern ones, so a missing stint before ~1990 can be a data gap rather than a legacy error (hence `conf: reference` on the exclude suggestions for people never seen with the franchise):', '');
  L.push(`| ${[...density.keys()].sort().join(' | ')} |`, `|${[...density.keys()].map(() => '---:').join('|')}|`);
  L.push(`| ${[...density.keys()].sort().map((d) => { const x = density.get(d)!; return (x.rows / x.teamSeasons.size).toFixed(1); }).join(' | ')} |`, '');
  L.push('**Source gaps (1999+ stats).** League totals per season show fields nflverse did not record in some seasons; they are summed only over seasons that have them (`targetsSeasons`, `tflSeasons`, `qbHitsSeasons` in `nflverse_entries.json`) and the dependent league rates are omitted:', '');
  for (const f of PARTIAL_FIELDS) L.push(`- \`${f}\`: missing ${ranges(missingSeasons(inp.avail[f])) || 'none'} (league total under ${AVAILABLE_SHARE * 100}% of the median season).`);
  L.push('- Targets 2003–2008: the weekly file has ~0 targets; the older season-level file has targets = receptions (catch rate ~100%), so neither is usable.', '');

  // Team codes
  L.push('## Team codes seen (checked by `tools/augment/franchises.ts`)', '');
  for (const ds of ['rosters', 'stats', 'games'] as const) {
    const m = data.codesSeen[ds];
    L.push(`- **${ds}:** ${[...m.keys()].sort().map((k) => `${k || '(empty)'} ${ranges(m.get(k) ?? [])}`).join('; ')}`);
  }
  L.push('', `${inp.data.skippedStatRows} weekly stat row(s) with an empty team code were counted in league totals but not attributed to a team.`, '');

  // Match rates
  L.push('## Match rates', '');
  L.push('"On roster" = matched by name (or alias) to a person on that franchise\'s roster in that decade (`name+team+season` or `alias`). "Name only" = the person exists in nflverse but never on that franchise in that decade. Rates are over all entries in the cell.', '');
  const decades = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
  for (const kind of ['offense', 'defense', 'ol-key'] as const) {
    const ms = matches.filter((m) => m.entry.kind === kind);
    const positions = [...new Set(ms.map((m) => m.entry.pos))];
    L.push(`### ${kind === 'offense' ? 'PLAYERS' : kind === 'defense' ? 'DEFENSE' : 'OL key-list names'}`, '');
    L.push(`| Position | ${decades.join(' | ')} | All |`, `|---|${decades.map(() => '---:').join('|')}|---:|`);
    for (const pos of [...positions, 'All']) {
      const cells = [...decades, 'All'].map((d) => {
        const cell = ms.filter((m) => (pos === 'All' || m.entry.pos === pos) && (d === 'All' || m.entry.decade === d));
        if (cell.length === 0) return '–';
        const ok = cell.filter((m) => m.method === 'name+team+season' || m.method === 'alias').length;
        return `${pct(ok, cell.length)} (${ok}/${cell.length})`;
      });
      L.push(`| ${pos} | ${cells.join(' | ')} |`);
    }
    const byMethod = new Map<string, number>();
    for (const m of ms) byMethod.set(m.method, (byMethod.get(m.method) ?? 0) + 1);
    L.push('', `Methods: ${[...byMethod].map(([k, v]) => `${k} ${v}`).join(', ')}.`, '');
  }
  const modern = matches.filter((m) => m.entry.kind === 'offense' && Number(m.entry.decade.slice(0, 4)) >= 2000);
  const modernOk = modern.filter((m) => m.method === 'name+team+season' || m.method === 'alias').length;
  L.push(`**Offensive entries in the 2000s–2020s (fully 1999+): ${pct(modernOk, modern.length)} (${modernOk}/${modern.length}) matched on roster.**`, '');

  // Unmatched
  const unmatched = matches.filter((m) => m.method === 'unmatched');
  L.push('## Unmatched entries', '');
  if (unmatched.length === 0) L.push('None.');
  else {
    L.push('| Entry | Id | Reason |', '|---|---|---|');
    for (const m of unmatched) {
      const reason = m.flags.includes('not-a-person')
        ? 'not a person (unit nickname)'
        : m.flags.includes('namesakes-outside-era')
          ? `only namesakes more than ${NAME_ONLY_WINDOW} years from the decade: ${m.alternatives.map((a) => `\`${a}\``).join(', ')}`
          : 'no nflverse person with this name (or alias)';
      L.push(`| ${who(m)} | \`${m.entry.id}\` | ${reason} |`);
    }
  }
  L.push('');

  // Name-only
  const nameOnly = matches.filter((m) => m.method === 'name-only');
  L.push('## Entries whose person was never on that franchise in that decade (name-only)', '');
  L.push('These are suspect stints. Offensive/defensive ones are proposed as `exclude` in `suggested_corrections.json`; review before applying, especially pre-1990 where rosters can be incomplete.', '');
  if (nameOnly.length === 0) L.push('None.');
  else {
    L.push('| Entry | Person | That person\'s seasons with the franchise | Flags |', '|---|---|---|---|');
    for (const m of nameOnly) {
      const seasons = new Set<number>();
      for (const r of m.person?.rows ?? []) if (r.franchise === m.entry.franchise && !NON_ROSTER_STATUSES.has(r.status)) seasons.add(r.season);
      for (const [s, byFr] of data.stats.get(m.personId) ?? []) if ((byFr.get(m.entry.franchise)?.games ?? 0) > 0) seasons.add(s);
      L.push(`| ${who(m)} | \`${m.personId}\` ${m.nvName ?? ''} | ${ranges(seasons) || 'never'} | ${m.flags.join(', ')} |`);
    }
  }
  L.push('');

  // Ambiguous
  const amb = matches.filter((m) => m.flags.some((f) => f === 'ambiguous' || f.startsWith('homonym-')));
  L.push('## Ambiguous matches', '');
  L.push('More than one person with the name. `homonym-resolved-by-position` = exactly one candidate on the franchise roster played the entry\'s position (conf stays verified); `homonym-resolved-by-franchise` (name-only) = exactly one namesake was ever with the franchise; `ambiguous` = picked the candidate with the most seasons (conf estimated).', '');
  if (amb.length === 0) L.push('None.');
  else {
    L.push('| Entry | Chosen | Others | Flag |', '|---|---|---|---|');
    for (const m of amb) L.push(`| ${who(m)} | \`${m.personId}\` | ${m.alternatives.map((a) => `\`${a}\``).join(', ')} | ${m.flags.filter((f) => f === 'ambiguous' || f.startsWith('homonym-')).join(', ')} |`);
  }
  L.push('');

  // Position mismatch
  const pm = matches.filter((m) => m.flags.includes('position-mismatch'));
  L.push('## Position mismatches', '');
  L.push('Matched person was never listed at a compatible position for the stint (e.g. defenders used as offensive filler rows, or roster position codes that disagree with legacy).', '');
  if (pm.length === 0) L.push('None.');
  else {
    L.push('| Entry | Person | nflverse positions in stint |', '|---|---|---|');
    for (const m of pm) {
      const st = m.person ? [...(m.person.rows.filter((r) => r.franchise === m.entry.franchise && `${Math.floor(r.season / 10) * 10}s` === m.entry.decade))] : [];
      L.push(`| ${who(m)} | \`${m.personId}\` | ${[...positionsOf(st)].sort().join(', ')} |`);
    }
  }
  L.push('');

  // Homonyms
  L.push('## Homonym resolutions', '');
  L.push('Every legacy name (PLAYERS + DEFENSE + OL key lists) whose entries resolve to more than one person, or that nflverse shares between several people.', '');
  const byName = new Map<string, Match[]>();
  for (const m of matches) byName.set(normName(m.entry.name), [...(byName.get(normName(m.entry.name)) ?? []), m]);
  const hom = [...byName.entries()].filter(([, ms]) => new Set(ms.map((m) => m.personId)).size > 1).sort(([a], [b]) => a.localeCompare(b));
  L.push('| Name | Entry → person (birth date, career span in nflverse) |', '|---|---|');
  for (const [, ms] of hom) {
    const parts = ms.map((m) => {
      const p = m.person;
      const seasons = p ? [...p.rows.map((r) => r.season), ...(data.stats.get(p.id)?.keys() ?? [])] : [];
      const span = seasons.length ? `${Math.min(...seasons)}–${Math.max(...seasons)}` : '?';
      return `${m.entry.kind === 'ol-key' ? 'OL key' : m.entry.pos} ${m.entry.franchise} ${m.entry.decade} → \`${m.personId}\` (${p?.birthDate ?? '?'}, ${span})`;
    });
    L.push(`| ${ms[0]?.entry.name} | ${parts.join('<br>')} |`);
  }
  L.push('');

  // Zero seasons
  const zero = matches.filter((m) => m.flags.includes('zero-seasons'));
  L.push('## Stints with zero counted seasons', '');
  L.push('Person found on the franchise roster in the decade, but only with statuses that do not count (cut, practice squad, free agent, retired) and no REG games.', '');
  if (zero.length === 0) L.push('None.');
  else {
    L.push('| Entry | Person | Roster rows |', '|---|---|---|');
    for (const m of zero) {
      const rows = (m.person?.rows ?? []).filter((r) => r.franchise === m.entry.franchise && `${Math.floor(r.season / 10) * 10}s` === m.entry.decade);
      L.push(`| ${who(m)} | \`${m.personId}\` | ${rows.map((r) => `${r.season} ${r.team} ${r.status}`).join('; ')} |`);
    }
  }
  L.push('');

  // Coverage
  L.push('## Coverage of augmented fields (PLAYERS + DEFENSE)', '');
  L.push(`| Decade | Entries | Seasons > 0 | Height | Weight | Birth date | Combine | 40 time | Stats |`, '|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  const recs = matches.filter((m) => m.entry.kind !== 'ol-key');
  for (const d of [...decades, 'All']) {
    const ms = recs.filter((m) => d === 'All' || m.entry.decade === d);
    if (!ms.length) continue;
    const get = (m: Match) => entryOut[m.entry.id] as { seasons?: { list: number[] }; physical?: Physical; combine?: CombineOut; stats?: unknown };
    const c = (f: (r: ReturnType<typeof get>) => boolean) => pct(ms.filter((m) => f(get(m))).length, ms.length);
    L.push(`| ${d} | ${ms.length} | ${c((r) => (r.seasons?.list.length ?? 0) > 0)} | ${c((r) => r.physical?.heightIn !== undefined)} | ${c((r) => r.physical?.weightLb !== undefined)} | ${c((r) => r.physical?.birthDate !== undefined)} | ${c((r) => !!r.combine)} | ${c((r) => r.combine?.forty !== undefined)} | ${c((r) => !!r.stats)} |`);
  }
  L.push('', `OL rosters: ${Object.keys(inp.olOut).length} units, ${inp.olLinemen} linemen rows.`, '');

  // Suggestions
  L.push('## Suggested corrections', '');
  L.push(`Written to \`data/augment/suggested_corrections.json\` (${suggestions.length} records). Not applied; the corrections loader (TECH_PLAN §6.2) needs each one reviewed into \`data/corrections.json\`.`, '');
  const kinds: Suggestion['kind'][] = ['catch-pct-count', 'per-game-gap', 'team-code', 'exclude-no-stint', 'exclude-filler-row', 'exclude-duplicate-person'];
  for (const k of kinds) {
    const ss = suggestions.filter((s) => s.kind === k);
    L.push(`### ${k} (${ss.length}${k === 'per-game-gap' ? ` of ${inp.gapTotal} over the threshold` : ''})`, '');
    if (k === 'per-game-gap') {
      const g = inp.gapStats;
      L.push(`Checked ${g.checked} offensive stints fully covered by 1999+ stats (≥ ${MIN_GAMES} games). ${g.over35} (${pct(g.over35, g.checked)}) differ from verified REG yards per game by more than ${YPG_REL_THRESHOLD * 100}%, but the gap is systematic: legacy \`y\` runs high for almost everyone, like a peak-season rate rather than a stint average. Relative gap (legacy − verified) / verified:`, '');
      L.push('| Band | Stints | p10 | Median | p90 |', '|---|---:|---:|---:|---:|');
      for (const b of g.bias) L.push(`| ${b.band} | ${b.n} | ${Math.round(b.p10 * 100)}% | ${Math.round(b.median * 100)}% | ${Math.round(b.p90 * 100)}% |`);
      L.push('', `So only gross cases are proposed: legacy more than ${YPG_GROSS_FACTOR}× or under 1/${YPG_GROSS_FACTOR} of verified (${g.gross} stints; the ${MAX_YPG_SUGGESTIONS} largest are listed). Most are backups and fullbacks carrying placeholder lines (25, 30, 35 yds/g). The ratings engine should prefer the verified totals in \`nflverse_entries.json\` wherever they exist rather than patching \`y\`.`, '');
    }
    if (!ss.length) {
      L.push('None.', '');
      continue;
    }
    L.push('| Id | Field | Old | New | Reason |', '|---|---|---:|---:|---|');
    for (const s of ss) L.push(`| \`${s.id}\` | ${s.field} | ${JSON.stringify(s.old)} | ${JSON.stringify(s.new)} | ${s.reason} |`);
    L.push('');
  }

  // Sizes
  L.push('## Output files', '');
  L.push('| File | Size |', '|---|---:|');
  for (const [f, b] of Object.entries(inp.sizes)) L.push(`| data/augment/${f} | ${(b / 1024).toFixed(0)} KB |`);
  L.push('');
  // Keep the sections other tools maintain between their markers (arm.ts, fumbles.ts, forty.ts, ...).
  const old = existsSync(REPORT) ? readFileSync(REPORT, 'utf8') : '';
  writeFileSync(REPORT, `${L.join('\n')}\n${markedSections(old).join('')}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
