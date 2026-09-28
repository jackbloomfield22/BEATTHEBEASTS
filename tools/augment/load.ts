// Load the cached nflverse files into in-memory structures for build.ts.
//
// People: nflverse has no single person key before ~1990 (the 1960s–1970s
// rosters carry no gsis_id or pfr_id at all). Rows are clustered with a
// union-find over three kinds of key: gsis_id, pfr_id, and normalized name +
// birth date. players.csv links the id-less roster rows of older players to
// their ids through name + birth date. Each cluster is one person.

import { join } from 'node:path';
import { num, readCsv, str } from './csv.ts';
import { CACHE_DIR, FIRST_ROSTER_SEASON, FIRST_STATS_SEASON, LAST_SEASON } from './fetch-nflverse.ts';
import { franchiseOf, franchiseOfStrict, type LegacyFranchise } from './franchises.ts';
import { normName, slug } from './names.ts';

export interface RosterRow {
  readonly season: number;
  readonly team: string;
  readonly franchise: LegacyFranchise;
  readonly position: string;
  readonly depthPosition: string;
  readonly status: string;
  readonly name: string;
  readonly norm: string;
  readonly birthDate: string | null;
  readonly heightIn: number | null;
  readonly weightLb: number | null;
  readonly gsis: string | null;
  readonly pfr: string | null;
  personId: string;
}

export interface PlayersRow {
  readonly gsis: string;
  readonly pfr: string | null;
  readonly name: string;
  readonly norm: string;
  readonly birthDate: string | null;
  readonly heightIn: number | null;
  readonly weightLb: number | null;
  readonly position: string;
  readonly rookieSeason: number | null;
  readonly draftYear: number | null;
}

export interface CombineRow {
  readonly season: number;
  readonly draftYear: number | null;
  readonly pfr: string | null;
  readonly name: string;
  readonly norm: string;
  readonly pos: string;
  readonly heightIn: number | null;
  readonly weightLb: number | null;
  readonly forty: number | null;
  readonly bench: number | null;
  readonly vertical: number | null;
  readonly broad: number | null;
  readonly cone: number | null;
  readonly shuttle: number | null;
}

/** Offensive + defensive REG-season sums for one person, season and franchise. */
export interface StatLine {
  games: number;
  completions: number;
  attempts: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  sacks: number;
  sack_yards: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  rushing_fumbles: number;
  rushing_fumbles_lost: number;
  receptions: number;
  targets: number;
  receiving_yards: number;
  receiving_tds: number;
  receiving_fumbles: number;
  receiving_fumbles_lost: number;
  tackles_solo: number;
  tackles_with_assist: number;
  tackle_assists: number;
  tfl: number;
  def_sacks: number;
  qb_hits: number;
  def_interceptions: number;
  pass_defended: number;
  forced_fumbles: number;
  fumble_recoveries: number;
  def_tds: number;
  safeties: number;
}

export type StatKey = Exclude<keyof StatLine, 'games'>;

/** stats_player_week column → StatLine field. */
const WEEK_COLUMNS: Readonly<Record<StatKey, string>> = {
  completions: 'completions',
  attempts: 'attempts',
  passing_yards: 'passing_yards',
  passing_tds: 'passing_tds',
  interceptions: 'passing_interceptions',
  sacks: 'sacks_suffered',
  sack_yards: 'sack_yards_lost',
  carries: 'carries',
  rushing_yards: 'rushing_yards',
  rushing_tds: 'rushing_tds',
  rushing_fumbles: 'rushing_fumbles',
  rushing_fumbles_lost: 'rushing_fumbles_lost',
  receptions: 'receptions',
  targets: 'targets',
  receiving_yards: 'receiving_yards',
  receiving_tds: 'receiving_tds',
  receiving_fumbles: 'receiving_fumbles',
  receiving_fumbles_lost: 'receiving_fumbles_lost',
  tackles_solo: 'def_tackles_solo',
  tackles_with_assist: 'def_tackles_with_assist',
  tackle_assists: 'def_tackle_assists',
  tfl: 'def_tackles_for_loss',
  def_sacks: 'def_sacks',
  qb_hits: 'def_qb_hits',
  def_interceptions: 'def_interceptions',
  pass_defended: 'def_pass_defended',
  forced_fumbles: 'def_fumbles_forced',
  fumble_recoveries: 'fumble_recovery_opp',
  def_tds: 'def_tds',
  safeties: 'def_safeties',
};
export const STAT_KEYS = Object.keys(WEEK_COLUMNS) as StatKey[];

export function emptyLine(): StatLine {
  const l = { games: 0 } as StatLine;
  for (const k of STAT_KEYS) l[k] = 0;
  return l;
}

export function addLine(into: StatLine, from: StatLine): void {
  into.games += from.games;
  for (const k of STAT_KEYS) into[k] += from[k];
}

export interface GameRow {
  readonly season: number;
  readonly gameType: string;
  readonly home: string;
  readonly away: string;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
}

export interface Person {
  readonly id: string;
  readonly gsisIds: string[];
  readonly pfrIds: string[];
  readonly names: Set<string>;
  readonly norms: Set<string>;
  birthDate: string | null;
  readonly rows: RosterRow[];
  players: PlayersRow | null;
}

export interface NflData {
  readonly rosters: RosterRow[];
  readonly players: PlayersRow[];
  readonly combine: CombineRow[];
  readonly games: GameRow[];
  readonly persons: Map<string, Person>;
  /** gsis id → person id. */
  readonly byGsis: Map<string, string>;
  readonly byPfr: Map<string, string>;
  /** person id → season → franchise → REG stat line. */
  readonly stats: Map<string, Map<number, Map<LegacyFranchise, StatLine>>>;
  /** season → league REG totals (all rows). */
  readonly league: Map<number, StatLine>;
  /** Team codes seen per dataset, with the seasons they occur in (for the report). */
  readonly codesSeen: Record<'rosters' | 'stats' | 'games', Map<string, Set<number>>>;
  /** Weekly stat rows with an empty team code (skipped). */
  readonly skippedStatRows: number;
  /** Weekly rows whose team code the source swapped with the visitor's, re-assigned (SWAPPED_HOME_ROWS). */
  readonly swapFixed: readonly SwapFix[];
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    // Path compression.
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur) as string;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** A real GSIS id looks like 00-0011493; older players sometimes carry an ESB-style id instead. */
export const isRealGsis = (id: string): boolean => /^00-\d{7}$/.test(id);

/**
 * A source defect in nflverse stats_player_week, found by the M6.6 stint
 * audit (docs/m66/DATA_AUDIT.md): in 2001 and 2002 every Jacksonville player's
 * row from a Jacksonville home game carries the visitor's code as `team`
 * (and JAX as `opponent_team`): e.g. Jimmy Smith, 2001 week 1, game
 * 2001_01_PIT_JAX, team PIT. That credited about 215 player-games a season to
 * the visitors and cut the Jaguars' 2001–02 stints roughly in half. No other
 * team or season shows the pattern (checked: rows credited to a team that
 * is the player's opponent that week, against his main team that season, are
 * 1–8 a season elsewhere, all real mid-season trades). A row is re-assigned
 * to the home team only when the game is a home game of that team, the row
 * names it as the opponent, and the player is on the home team's roster that
 * season and not on the visitor's (a player traded between the two is left
 * alone).
 */
export const SWAPPED_HOME_ROWS: readonly { readonly home: string; readonly seasons: readonly number[] }[] = [{ home: 'JAX', seasons: [2001, 2002] }];

export interface SwapFix {
  readonly season: number;
  readonly gsis: string;
  readonly name: string;
  readonly game: string;
  readonly was: string;
  readonly now: string;
}

function note(map: Map<string, Set<number>>, code: string, season: number): void {
  let s = map.get(code);
  if (!s) map.set(code, (s = new Set()));
  s.add(season);
}

function cache(file: string): string {
  return join(CACHE_DIR, file);
}

function parseHeight(h: string | null): number | null {
  if (h === null) return null;
  const m = /^(\d+)-(\d+)$/.exec(h);
  if (m) return Number(m[1]) * 12 + Number(m[2]);
  const v = Number(h);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function loadAll(log: (s: string) => void = () => {}): NflData {
  const codesSeen = { rosters: new Map<string, Set<number>>(), stats: new Map<string, Set<number>>(), games: new Map<string, Set<number>>() };

  // --- rosters -----------------------------------------------------------
  const rosters: RosterRow[] = [];
  for (let y = FIRST_ROSTER_SEASON; y <= LAST_SEASON; y++) {
    const c = readCsv(cache(`rosters/roster_${y}.csv`));
    const [cSeason, cTeam, cPos, cDepth, cStatus, cName, cBd, cHt, cWt, cGsis, cPfr] = [
      'season', 'team', 'position', 'depth_chart_position', 'status', 'full_name', 'birth_date', 'height', 'weight', 'gsis_id', 'pfr_id',
    ].map((k) => c.col(k));
    for (const r of c.rows) {
      const season = Number(r[cSeason!]);
      const team = r[cTeam!] ?? '';
      const name = (r[cName!] ?? '').trim();
      if (name === '') continue;
      note(codesSeen.rosters, team, season);
      rosters.push({
        season,
        team,
        franchise: franchiseOfStrict(team, season),
        position: r[cPos!] ?? '',
        depthPosition: r[cDepth!] ?? '',
        status: r[cStatus!] ?? '',
        name,
        norm: normName(name),
        birthDate: str(r[cBd!]),
        heightIn: parseHeight(str(r[cHt!])),
        weightLb: num(r[cWt!]),
        gsis: str(r[cGsis!]),
        pfr: str(r[cPfr!]),
        personId: '',
      });
    }
  }
  log(`rosters: ${rosters.length} rows`);

  // --- players.csv ---------------------------------------------------------
  const players: PlayersRow[] = [];
  {
    const c = readCsv(cache('players.csv'));
    const [cG, cP, cN, cBd, cH, cW, cPos, cRook, cDraft] = [
      'gsis_id', 'pfr_id', 'display_name', 'birth_date', 'height', 'weight', 'position', 'rookie_season', 'draft_year',
    ].map((k) => c.col(k));
    for (const r of c.rows) {
      const gsis = str(r[cG!]);
      const name = (r[cN!] ?? '').trim();
      if (gsis === null || name === '') continue;
      players.push({
        gsis,
        pfr: str(r[cP!]),
        name,
        norm: normName(name),
        birthDate: str(r[cBd!]),
        heightIn: parseHeight(str(r[cH!])),
        weightLb: num(r[cW!]),
        position: r[cPos!] ?? '',
        rookieSeason: num(r[cRook!]),
        draftYear: num(r[cDraft!]),
      });
    }
  }
  log(`players: ${players.length} rows`);

  // --- person clusters -----------------------------------------------------
  const uf = new UnionFind();
  const nbKey = (norm: string, bd: string | null, fallback: string): string => (bd ? `nb:${norm}|${bd}` : `nx:${norm}|${fallback}`);
  const rowKey = (r: RosterRow): string => {
    // Every row's anchor node: an id when it has one, else name + birth date,
    // else (rare: 2016–2019 rows without ids never lack a gsis) name + franchise.
    if (r.gsis) return `g:${r.gsis}`;
    if (r.pfr) return `p:${r.pfr}`;
    return nbKey(r.norm, r.birthDate, r.franchise);
  };
  for (const r of rosters) {
    const a = rowKey(r);
    uf.find(a);
    if (r.gsis) uf.union(a, `g:${r.gsis}`);
    if (r.pfr) uf.union(a, `p:${r.pfr}`);
    if (r.birthDate) uf.union(a, nbKey(r.norm, r.birthDate, ''));
  }
  for (const p of players) {
    const a = `g:${p.gsis}`;
    uf.find(a);
    if (p.pfr) uf.union(a, `p:${p.pfr}`);
    if (p.birthDate) uf.union(a, nbKey(p.norm, p.birthDate, ''));
  }

  // Collect the members of each cluster, then name each person.
  interface Members { gsis: Set<string>; pfr: Set<string>; rows: RosterRow[]; players: PlayersRow[] }
  const clusters = new Map<string, Members>();
  const members = (root: string): Members => {
    let m = clusters.get(root);
    if (!m) clusters.set(root, (m = { gsis: new Set(), pfr: new Set(), rows: [], players: [] }));
    return m;
  };
  for (const r of rosters) {
    const m = members(uf.find(rowKey(r)));
    m.rows.push(r);
    if (r.gsis) m.gsis.add(r.gsis);
    if (r.pfr) m.pfr.add(r.pfr);
  }
  for (const p of players) {
    const m = members(uf.find(`g:${p.gsis}`));
    m.players.push(p);
    m.gsis.add(p.gsis);
    if (p.pfr) m.pfr.add(p.pfr);
  }

  const persons = new Map<string, Person>();
  const byGsis = new Map<string, string>();
  const byPfr = new Map<string, string>();
  const rootToPerson = new Map<string, string>();
  for (const [root, m] of clusters) {
    const gsis = [...m.gsis].sort();
    const pfr = [...m.pfr].sort();
    const real = gsis.filter(isRealGsis);
    const firstRow = m.rows[0];
    const firstPlayer = m.players[0];
    const name = firstRow?.name ?? firstPlayer?.name ?? 'unknown';
    const bd = firstRow?.birthDate ?? firstPlayer?.birthDate ?? null;
    // Person id precedence: real GSIS id > PFR id > other (ESB-style) GSIS id > synthetic.
    let id = real[0] ?? pfr[0] ?? gsis[0] ?? `nv:${slug(name)}:${bd ?? `${firstRow?.franchise ?? 'x'}-${firstRow?.season ?? 0}`}`;
    if (persons.has(id)) id = `${id}~${root}`;
    const person: Person = {
      id,
      gsisIds: gsis,
      pfrIds: pfr,
      names: new Set([...m.rows.map((r) => r.name), ...m.players.map((p) => p.name)]),
      norms: new Set([...m.rows.map((r) => r.norm), ...m.players.map((p) => p.norm)]),
      birthDate: bd,
      rows: m.rows,
      players: m.players.find((p) => isRealGsis(p.gsis)) ?? firstPlayer ?? null,
    };
    for (const r of m.rows) r.personId = id;
    persons.set(id, person);
    rootToPerson.set(root, id);
    for (const g of gsis) byGsis.set(g, id);
    for (const p of pfr) byPfr.set(p, id);
  }
  log(`persons: ${persons.size}`);

  // --- weekly stats (REG only) → per person/season/franchise ---------------
  const stats = new Map<string, Map<number, Map<LegacyFranchise, StatLine>>>();
  const league = new Map<number, StatLine>();
  let skippedStatRows = 0;
  // Roster team codes per GSIS id and season (for the source fix below).
  const rosterTeams = new Map<string, Map<number, Set<string>>>();
  for (const r of rosters) {
    if (!r.gsis) continue;
    let bySeason = rosterTeams.get(r.gsis);
    if (!bySeason) rosterTeams.set(r.gsis, (bySeason = new Map()));
    let s = bySeason.get(r.season);
    if (!s) bySeason.set(r.season, (s = new Set()));
    s.add(r.team);
  }
  const swapFixed: SwapFix[] = [];
  for (let y = FIRST_STATS_SEASON; y <= LAST_SEASON; y++) {
    const c = readCsv(cache(`stats_player/stats_player_week_${y}.csv`));
    const cId = c.col('player_id');
    const cName = c.col('player_display_name');
    const cSeason = c.col('season');
    const cType = c.col('season_type');
    const cTeam = c.col('team');
    const cOpp = c.col('opponent_team');
    const cGame = c.col('game_id');
    const cols = STAT_KEYS.map((k) => [k, c.col(WEEK_COLUMNS[k])] as const);
    const lg = emptyLine();
    const gamesSeen = new Map<string, Set<string>>();
    for (const r of c.rows) {
      if (r[cType] !== 'REG') continue;
      const season = Number(r[cSeason]);
      let team = r[cTeam] ?? '';
      const swap = SWAPPED_HOME_ROWS.find((s) => s.seasons.includes(season));
      if (swap && team !== swap.home && r[cOpp] === swap.home && (r[cGame] ?? '').endsWith(`_${swap.home}`)) {
        const on = rosterTeams.get(r[cId] ?? '')?.get(season);
        if (on?.has(swap.home) && !on.has(team)) {
          swapFixed.push({ season, gsis: r[cId] ?? '', name: r[cName] ?? '', game: r[cGame] ?? '', was: team, now: swap.home });
          team = swap.home;
        }
      }
      const line = emptyLine();
      for (const [k, i] of cols) line[k] = num(r[i]) ?? 0;
      // sack_yards_lost is stored negative in nflverse; keep yards lost as a positive number.
      line.sack_yards = Math.abs(line.sack_yards);
      for (const k of STAT_KEYS) lg[k] += line[k];
      if (team === '') {
        skippedStatRows++;
        continue;
      }
      note(codesSeen.stats, team, season);
      const franchise = franchiseOfStrict(team, season);
      const gsis = r[cId] ?? '';
      let pid = byGsis.get(gsis);
      if (pid === undefined) {
        // A stats-only person (no roster or players.csv row): give them their own person.
        const name = r[cName] ?? gsis;
        pid = gsis;
        persons.set(pid, { id: pid, gsisIds: [gsis], pfrIds: [], names: new Set([name]), norms: new Set([normName(name)]), birthDate: null, rows: [], players: null });
        byGsis.set(gsis, pid);
      }
      // One row per player-game; count distinct games per person/season/franchise.
      const gk = `${pid}|${franchise}`;
      let gs = gamesSeen.get(gk);
      if (!gs) gamesSeen.set(gk, (gs = new Set()));
      const gameId = r[cGame] ?? `${season}-${r[c.col('week')]}`;
      const newGame = !gs.has(gameId);
      gs.add(gameId);
      let bySeason = stats.get(pid);
      if (!bySeason) stats.set(pid, (bySeason = new Map()));
      let byFr = bySeason.get(season);
      if (!byFr) bySeason.set(season, (byFr = new Map()));
      let acc = byFr.get(franchise);
      if (!acc) byFr.set(franchise, (acc = emptyLine()));
      if (newGame) acc.games++;
      for (const k of STAT_KEYS) acc[k] += line[k];
    }
    league.set(y, lg);
  }
  log(`stats: ${stats.size} persons with REG stats`);

  // --- combine ---------------------------------------------------------------
  const combine: CombineRow[] = [];
  {
    const c = readCsv(cache('combine.csv'));
    const col = (k: string) => c.col(k);
    const [cS, cD, cP, cN, cPos, cHt, cWt, c40, cB, cV, cBr, cC, cSh] = [
      'season', 'draft_year', 'pfr_id', 'player_name', 'pos', 'ht', 'wt', 'forty', 'bench', 'vertical', 'broad_jump', 'cone', 'shuttle',
    ].map(col);
    for (const r of c.rows) {
      const name = (r[cN!] ?? '').trim();
      combine.push({
        season: Number(r[cS!]),
        draftYear: num(r[cD!]),
        pfr: str(r[cP!]),
        name,
        norm: normName(name),
        pos: r[cPos!] ?? '',
        heightIn: parseHeight(str(r[cHt!])),
        weightLb: num(r[cWt!]),
        forty: num(r[c40!]),
        bench: num(r[cB!]),
        vertical: num(r[cV!]),
        broad: num(r[cBr!]),
        cone: num(r[cC!]),
        shuttle: num(r[cSh!]),
      });
    }
  }
  log(`combine: ${combine.length} rows`);

  // --- games -----------------------------------------------------------------
  const games: GameRow[] = [];
  {
    const c = readCsv(cache('games.csv'));
    const [cS, cT, cH, cA, cHs, cAs] = ['season', 'game_type', 'home_team', 'away_team', 'home_score', 'away_score'].map((k) => c.col(k));
    for (const r of c.rows) {
      const season = Number(r[cS!]);
      if (season > LAST_SEASON) continue;
      const home = r[cH!] ?? '';
      const away = r[cA!] ?? '';
      note(codesSeen.games, home, season);
      note(codesSeen.games, away, season);
      if (franchiseOf(home, season) === null || franchiseOf(away, season) === null) {
        throw new Error(`games.csv: unknown team code ${home}/${away} in ${season}`);
      }
      games.push({ season, gameType: r[cT!] ?? '', home, away, homeScore: num(r[cHs!]), awayScore: num(r[cAs!]) });
    }
  }
  log(`games: ${games.length} rows`);

  if (swapFixed.length) log(`source fix: ${swapFixed.length} weekly rows re-assigned to their home team (SWAPPED_HOME_ROWS)`);
  return { rosters, players, combine, games, persons, byGsis, byPfr, stats, league, codesSeen, skippedStatRows, swapFixed };
}
