import type { Decade, Defender, OLUnit, Player } from '@data/legacy/types';
import { HONOR_WEIGHTS, worse } from './signals';
import type { Accolades, ArmEvidence, ArmGrade, ArmInputs, Baseline, Conf, Measurables, RatedPos, RatingInputs, Sourced, StintStats } from './types';

// Input assembly (TECH_PLAN §6–§7): one sourced RatingInputs record per stint
// (player + franchise + decade), built from
//   legacy entries (after data/corrections.json)           conf "legacy"
//   data/augment/nflverse_entries.json (1999+ stats, rosters, combine)   "verified"
//   data/augment/estimated_stats_pre1999.json               "estimated"
//   data/augment/estimated_def_stints_pre1999.json          "estimated"
//   data/augment/accolades.json (Wikipedia infoboxes)       "reference"
//   data/augment/estimated_physical.json (40 times)         "reference"/"estimated"
//   data/augment/arm_strength.json (QB air yards 2006+      "verified",
//                                   cited arm grades        "estimated")
//   data/era_baselines.json                                 per-season league averages
//
// Precedence per field: verified data for the stint wins when it covers the
// stint; otherwise verified and estimated parts are combined by games;
// legacy per-game estimates fill what's left. Every value keeps its source.

// ------------------------------------------------------------ file shapes

export interface SeasonBaseline {
  season: number;
  gamesPerTeam?: number;
  sacksOfficial?: boolean;
  cmpPct: number;
  ypa: number;
  tdPct: number;
  intPct: number;
  sackPct: number;
  passerRating: number;
  ypc: number;
  pointsPerTeamGame: number;
  passCmpPerTeamGame: number;
  passYdsPerTeamGame: number;
  passTdPerTeamGame: number;
  intPerTeamGame: number;
  sacksPerTeamGame: number;
  rushYdsPerTeamGame: number;
  rushTdPerTeamGame: number;
  yardsPerReception: number;
  yardsPerTarget?: number;
  catchRate?: number;
  /** League RB fumbles per touch (data/augment/league_fumbles.json via merge-baselines.ts). */
  rbFumblesPerTouch?: number;
  src: string;
  conf: Conf;
  afl?: Omit<SeasonBaseline, 'season' | 'afl'>;
}

export interface NflverseEntry {
  personId: string;
  seasons?: { list: number[]; games?: Record<string, number>; src: string; conf: Conf };
  physical?: { heightIn?: number; weightLb?: number; birthDate?: string; src: string; conf: Conf };
  combine?: { year?: number; forty?: number; bench?: number; vertical?: number; broad?: number; cone?: number; shuttle?: number; src: string; conf: Conf };
  stats?: {
    seasons: number[];
    complete: boolean;
    games: number;
    targetsSeasons?: number[];
    src: string;
    conf: Conf;
  } & Record<string, unknown>;
}

export interface EstimatedStats {
  name: string;
  seasons: [number, number];
  games: number;
  cmpPct?: number;
  ypa?: number;
  tdPct?: number;
  intPct?: number;
  sackPct?: number;
  attemptsPerGame?: number;
  rushAttPerGame?: number;
  carriesPerGame?: number;
  recPerGame?: number;
  fumblesPerTouch?: number;
  yardsPerRec?: number;
  src: string;
  conf: Conf;
  certainty?: string;
  note?: string;
}

export interface EstimatedDefStint {
  name: string;
  seasons: [number, number];
  sk?: number;
  skUnofficial?: boolean;
  int?: number;
  ff?: number;
  fr?: number;
  td?: number;
  allPro1Seasons?: number[];
  proBowlSeasons?: number[];
  dpoySeasons?: number[];
  verdict?: string;
  src: string;
  conf: Conf;
  /** Data file the record came from (default data/augment/estimated_def_stints_pre1999.json). */
  file?: string;
}

export interface AccoladeRecord {
  name: string;
  entries: string[];
  proBowl?: number[];
  allPro1?: number[];
  allPro2?: number[];
  mvp?: number[];
  opoy?: number[];
  dpoy?: number[];
  src: string;
  conf: Conf | 'missing';
  url?: string;
}

export interface PhysicalRecord {
  name: string;
  entries: string[];
  forty?: number;
  vertical?: number;
  broad?: number;
  shuttle?: number;
  cone?: number;
  bench?: number;
  tenSplit?: number;
  src: string;
  conf: Conf;
  note?: string;
  basis?: string;
  timing?: string;
}

export interface OlRosterLineman {
  personId: string;
  name: string;
  positions: string[];
  count: number;
  seasons: number[];
  heightIn?: number;
  weightLb?: number;
  birthDate?: string;
  inKeyList: number[] | false;
}

/** data/augment/forty_times.json record (tools/augment/forty.ts), keyed by person id. */
export interface FortyRecord {
  name: string;
  forty: number;
  /** 'combine' (nflverse, verified), 'predraft' (Wikipedia table, reference), 'cited' (quoted prose, estimated). */
  kind: 'combine' | 'predraft' | 'cited';
  timing?: string;
  src: string;
  conf: Conf;
}

/** data/augment/arm_strength.json `airYards` record (tools/augment/arm.ts). */
export interface AirYardsRecord {
  name: string;
  seasons: number[];
  stintSeasons: number;
  partial: boolean;
  attempts: number;
  intendedAirYardsPerAtt: number;
  league: { intendedAirYardsPerAtt: number };
  iayRatio: number;
  src: string;
  conf: Conf;
}

/** data/augment/arm_strength.json `bigArm` record. */
export interface BigArmRecord {
  name: string;
  entryIds: string[];
  grade: ArmGrade;
  evidence: ArmEvidence;
  basis: string;
  sources: { url: string }[];
  src: string;
  conf: Conf;
}

export interface InputSources {
  players: readonly Player[];
  defense: readonly Defender[];
  olUnits: readonly OLUnit[];
  excluded: ReadonlySet<string>;
  people: Record<string, { personId: string; method: string; conf: Conf }>;
  nflverse: Record<string, NflverseEntry>;
  olRosters: Record<string, { team: string; decade: string; key: string; linemen: OlRosterLineman[] }>;
  estStats: Record<string, EstimatedStats>;
  estDef: Record<string, EstimatedDefStint>;
  accolades: Record<string, AccoladeRecord>;
  physical: Record<string, PhysicalRecord>;
  baselines: Record<string, SeasonBaseline>;
  /** 40 times by person id for players with no measured time elsewhere (data/augment/forty_times.json). */
  forty?: Record<string, FortyRecord>;
  /** Arm-strength inputs for QB Throw Power (absent: Throw Power uses its other inputs). */
  arm?: { airYards: Record<string, AirYardsRecord>; bigArm: readonly BigArmRecord[] };
}

// ------------------------------------------------------------ helpers

const DECADE_START: Record<Decade, number> = { '1960s': 1960, '1970s': 1970, '1980s': 1980, '1990s': 1990, '2000s': 2000, '2010s': 2010, '2020s': 2020 };
/** Last season in the data (nflverse rosters/stats run through 2025). */
export const LAST_SEASON = 2025;

/** Regular-season games a regular could play. 1982 strike: 9. 1987: 12 (the 3 replacement games are excluded; most regulars stayed out). */
export function gamesPerSeason(y: number): number {
  if (y === 1960) return 12;
  if (y < 1978) return 14;
  if (y === 1982) return 9;
  if (y === 1987) return 12;
  if (y >= 2021) return 17;
  return 16;
}

/** Share of the schedule a rostered player is assumed to appear in when games are unknown. */
const PARTICIPATION = 0.85;

/** Franchises (current codes) that played in the AFL, 1960–1969. */
const AFL = new Set(['NE', 'BUF', 'DEN', 'TEN', 'KC', 'LV', 'LAC', 'NYJ', 'MIA', 'CIN']);

const src = (v: number, s: string, c: Conf): Sourced => ({ v, src: s, conf: c });
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

function decadeSeasons(d: Decade): number[] {
  const a = DECADE_START[d];
  return range(a, Math.min(a + 9, LAST_SEASON));
}

/** Age at the midpoint (Oct 1) of a season. */
function ageAt(season: number, birthDate: string): number {
  const [y, m, d] = birthDate.split('-').map(Number) as [number, number, number];
  return season + 0.75 - (y + ((m - 1) * 30.4 + d) / 365);
}

export function passerRating(cmp: number, att: number, yds: number, td: number, int: number): number {
  const c = (x: number) => Math.max(0, Math.min(2.375, x));
  const a = c((cmp / att - 0.3) * 5);
  const b = c((yds / att - 3) * 0.25);
  const t = c((td / att) * 20);
  const i = c(2.375 - (int / att) * 25);
  return ((a + b + t + i) / 6) * 100;
}

// ------------------------------------------------------------ baselines

const BASE_FIELDS = [
  'cmpPct',
  'ypa',
  'tdPct',
  'intPct',
  'sackPct',
  'passerRating',
  'ypc',
  'pointsPerTeamGame',
  'passYdsPerTeamGame',
  'passTdPerTeamGame',
  'intPerTeamGame',
  'sacksPerTeamGame',
  'rushYdsPerTeamGame',
  'rushTdPerTeamGame',
  'passCmpPerTeamGame',
  'yardsPerReception',
] as const;

/** League averages over the stint's seasons, weighted by the player's games per season where known. */
export function stintBaseline(
  seasons: readonly number[],
  weights: Record<string, number> | undefined,
  team: string,
  table: Record<string, SeasonBaseline>,
  /** Seasons the player's own target stats cover (catch % and yards per target are compared over these). */
  targetSeasons?: readonly number[],
): Baseline {
  const rows: { r: Omit<SeasonBaseline, 'season' | 'afl'>; w: number }[] = [];
  for (const y of seasons) {
    const row = table[String(y)];
    if (!row) continue;
    const r = y < 1970 && AFL.has(team) && row.afl ? row.afl : row;
    rows.push({ r, w: weights?.[String(y)] ?? 1 });
  }
  if (!rows.length) throw new Error(`no baseline rows for seasons ${seasons.join(',')}`);
  const W = rows.reduce((a, x) => a + x.w, 0) || rows.length;
  const avg = (f: keyof Omit<SeasonBaseline, 'season' | 'afl'>) => rows.reduce((a, x) => a + (x.w || 1) * (x.r[f] as number), 0) / W;
  const out = {} as Record<string, number>;
  for (const f of BASE_FIELDS) out[f] = avg(f);
  const tset = new Set(targetSeasons ?? seasons);
  const tgt = seasons
    .filter((y) => tset.has(y))
    .map((y) => ({ r: table[String(y)], w: weights?.[String(y)] ?? 1 }))
    .filter((x): x is { r: SeasonBaseline; w: number } => !!x.r && typeof x.r.catchRate === 'number');
  const conf = rows.every((x) => x.r.conf === 'verified') ? 'verified' : 'estimated';
  const years = `${seasons[0]}–${seasons[seasons.length - 1]}`;
  const base: Baseline = { ...(out as unknown as Omit<Baseline, 'src' | 'conf'>), src: `era_baselines:${years}`, conf };
  // Ball Security baseline: the league RB fumble rate over the same seasons and weights.
  if (rows.every((x) => typeof x.r.rbFumblesPerTouch === 'number')) base.fumblesPerTouch = avg('rbFumblesPerTouch');
  if (tgt.length) {
    const tw = tgt.reduce((a, x) => a + (x.w || 1), 0);
    base.catchRate = tgt.reduce((a, x) => a + (x.w || 1) * x.r.catchRate!, 0) / tw;
    base.yardsPerTarget = tgt.reduce((a, x) => a + (x.w || 1) * x.r.yardsPerTarget!, 0) / tw;
  }
  return base;
}

// ------------------------------------------------------------ stat parts

type Totals = Record<string, number>;

interface Part {
  games: number;
  conf: Conf;
  src: string;
  /** Per-game or percentage values this part knows. */
  vals: Partial<Record<keyof StintStats, number>>;
  /** Games behind a field when fewer than the part's games. */
  sampleGames?: Partial<Record<keyof StintStats, number>>;
}

function verifiedPart(pos: RatedPos, s: NonNullable<NflverseEntry['stats']>, gamesBySeason?: Record<string, number>): Part {
  const t = s as unknown as Totals;
  const targetSeasonGames = (s.targetsSeasons ?? []).reduce((a, y) => a + (gamesBySeason?.[String(y)] ?? 0), 0);
  let targetGames: number | undefined;
  const g = Math.max(1, s.games);
  const n = (k: string) => (typeof t[k] === 'number' ? t[k] : 0);
  const vals: Part['vals'] = {};
  if (pos === 'QB') {
    const att = n('attempts');
    vals.passYdsPerGame = n('passing_yards') / g;
    vals.passTdPerGame = n('passing_tds') / g;
    vals.intPerGame = n('interceptions') / g;
    vals.qbRushYdsPerGame = n('rushing_yards') / g;
    vals.attPerGame = att / g;
    if (att >= 20) {
      vals.cmpPct = (100 * n('completions')) / att;
      vals.ypa = n('passing_yards') / att;
      vals.tdPct = (100 * n('passing_tds')) / att;
      vals.intPct = (100 * n('interceptions')) / att;
      vals.sackPct = (100 * n('sacks')) / (att + n('sacks'));
      vals.passerRating = passerRating(n('completions'), att, n('passing_yards'), n('passing_tds'), n('interceptions'));
    }
  } else if (pos === 'RB' || pos === 'WR' || pos === 'TE') {
    const car = n('carries');
    const rec = n('receptions');
    // nflverse has no targets for 2003–2008: catch % and yards per target
    // use only the seasons with targets (targetsSeasons).
    const tgt = n('targets');
    const tRec = n('targetedReceptions');
    const tYds = n('targetedReceivingYards');
    vals.rushYdsPerGame = n('rushing_yards') / g;
    vals.carriesPerGame = car / g;
    if (car >= 20) vals.ypc = n('rushing_yards') / car;
    vals.recYdsPerGame = n('receiving_yards') / g;
    vals.recPerGame = rec / g;
    if (rec >= 10) vals.yardsPerRec = n('receiving_yards') / rec;
    // Targets only where recorded (see nflverse_entries _meta).
    if (tgt >= 20 && tgt >= tRec && tRec > 0) {
      vals.catchPct = (100 * tRec) / tgt;
      vals.yardsPerTarget = tYds / tgt;
      targetGames = targetSeasonGames;
    }
    vals.tdPerGame = (n('rushing_tds') + n('receiving_tds')) / g;
    vals.rushTdPerGame = n('rushing_tds') / g;
    const touches = car + rec;
    if (touches >= 30) vals.fumblesPerTouch = (n('rushing_fumbles') + n('receiving_fumbles')) / touches;
  } else {
    vals.sacksPerGame = n('sacks') / g;
    vals.defIntPerGame = n('interceptions') / g;
    vals.ffPerGame = n('forced_fumbles') / g;
    vals.frPerGame = n('fumble_recoveries') / g;
    vals.defTdPerGame = n('def_tds') / g;
    vals.pdPerGame = n('pass_defended') / g;
    vals.tacklesPerGame = n('tackles_combined') / g;
  }
  // Per-play rates are only as reliable as the plays behind them: express the
  // sample as "starter games" (SAMPLE_PER_GAME) so backups shrink hard.
  const sample: Part['sampleGames'] = {};
  const att = n('attempts');
  if (pos === 'QB') for (const f of QB_RATE_FIELDS) sample[f] = att / SAMPLE_PER_GAME.attempts;
  if (pos === 'RB' || pos === 'WR' || pos === 'TE') {
    sample.ypc = n('carries') / SAMPLE_PER_GAME.carries;
    sample.yardsPerRec = n('receptions') / SAMPLE_PER_GAME.receptions;
    sample.fumblesPerTouch = (n('carries') + n('receptions')) / SAMPLE_PER_GAME.touches;
    if (targetGames !== undefined) sample.catchPct = sample.yardsPerTarget = Math.min(targetGames, n('targets') / SAMPLE_PER_GAME.targets);
  }
  return { games: s.games, conf: 'verified', src: s.src, vals, sampleGames: sample };
}

const QB_RATE_FIELDS = ['cmpPct', 'ypa', 'tdPct', 'intPct', 'sackPct', 'passerRating'] as const;
/**
 * Plays per game of a full-time starter (league norms): a rate stat's sample
 * in games = plays / these. 30 attempts, 15 carries, 4 receptions, 7 targets,
 * 20 touches.
 */
const SAMPLE_PER_GAME = { attempts: 30, carries: 15, receptions: 4, targets: 7, touches: 20 };

function estimatedPart(pos: RatedPos, e: EstimatedStats): Part {
  const g = Math.max(1, e.games);
  const vals: Part['vals'] = {};
  if (pos === 'QB' && e.attemptsPerGame !== undefined) {
    const att = e.attemptsPerGame;
    if (e.cmpPct !== undefined) vals.cmpPct = e.cmpPct;
    if (e.ypa !== undefined) {
      vals.ypa = e.ypa;
      vals.passYdsPerGame = e.ypa * att;
    }
    if (e.tdPct !== undefined) {
      vals.tdPct = e.tdPct;
      vals.passTdPerGame = (e.tdPct / 100) * att;
    }
    if (e.intPct !== undefined) {
      vals.intPct = e.intPct;
      vals.intPerGame = (e.intPct / 100) * att;
    }
    if (e.sackPct !== undefined) vals.sackPct = e.sackPct;
    vals.attPerGame = att;
    if (e.cmpPct !== undefined && e.ypa !== undefined && e.tdPct !== undefined && e.intPct !== undefined) {
      vals.passerRating = passerRating(e.cmpPct, 100, e.ypa * 100, e.tdPct, e.intPct);
    }
  }
  if (e.carriesPerGame !== undefined) vals.carriesPerGame = e.carriesPerGame;
  if (e.recPerGame !== undefined) vals.recPerGame = e.recPerGame;
  if (e.fumblesPerTouch !== undefined) vals.fumblesPerTouch = e.fumblesPerTouch;
  if (e.yardsPerRec !== undefined) {
    vals.yardsPerRec = e.yardsPerRec;
    if (e.recPerGame !== undefined) vals.recYdsPerGame = e.yardsPerRec * e.recPerGame;
  }
  const sample: Part['sampleGames'] = {};
  if (pos === 'QB' && e.attemptsPerGame !== undefined) for (const f of QB_RATE_FIELDS) sample[f] = (e.attemptsPerGame * g) / SAMPLE_PER_GAME.attempts;
  if (e.recPerGame !== undefined) sample.yardsPerRec = (e.recPerGame * g) / SAMPLE_PER_GAME.receptions;
  return { games: g, conf: 'estimated', src: `${e.src} (data/augment/estimated_stats_pre1999.json)`, vals, sampleGames: sample };
}

function estimatedDefPart(d: EstimatedDefStint, games: number): Part {
  const g = Math.max(1, games);
  const vals: Part['vals'] = {};
  if (d.sk !== undefined) vals.sacksPerGame = d.sk / g;
  if (d.int !== undefined) vals.defIntPerGame = d.int / g;
  if (d.ff !== undefined) vals.ffPerGame = d.ff / g;
  if (d.fr !== undefined) vals.frPerGame = d.fr / g;
  if (d.td !== undefined) vals.defTdPerGame = d.td / g;
  return { games: g, conf: d.conf ?? 'estimated', src: `${d.src} (${d.file ?? 'data/augment/estimated_def_stints_pre1999.json'})`, vals };
}

/** Legacy per-game values (whole stint), with sample sizes estimated from the legacy volume. */
function legacyVals(pos: RatedPos, e: Player | Defender, games: number): { vals: Part['vals']; sample: Part['sampleGames'] } {
  const vals: Part['vals'] = {};
  const sample: Part['sampleGames'] = {};
  if ('ea' in e) {
    const s = e.s;
    if (pos === 'QB') {
      vals.passYdsPerGame = s.y;
      vals.passTdPerGame = s.t;
      if (s.i !== undefined) vals.intPerGame = s.i;
      if (s.r !== undefined) vals.passerRating = s.r;
      // ~7 yards per attempt: a backup's 60 yds/g is about 9 attempts a game.
      sample.passerRating = games * Math.min(1, s.y / 7 / SAMPLE_PER_GAME.attempts);
      if (s.ry !== undefined) vals.qbRushYdsPerGame = s.ry;
    } else if (pos === 'RB') {
      vals.rushYdsPerGame = s.y;
      if (s.c !== undefined) {
        vals.ypc = s.c;
        sample.ypc = games * Math.min(1, s.y / Math.max(2, s.c) / SAMPLE_PER_GAME.carries);
      }
      if (s.r !== undefined) vals.recYdsPerGame = s.r;
      vals.tdPerGame = s.t;
    } else {
      vals.recYdsPerGame = s.y;
      vals.tdPerGame = s.t;
      // Targets weren't tracked before 1992 (BRIEF audit item 4): legacy yards
      // per target and catch % are unsourced before the 1990s, so they're dropped.
      const hasTargets = DECADE_START[e.d] >= 1990;
      if (hasTargets && s.p !== undefined) vals.yardsPerTarget = s.p;
      if (hasTargets && s.c !== undefined && s.c <= 100) vals.catchPct = s.c;
      // ~12 yards per catch and 60% of targets caught.
      sample.catchPct = sample.yardsPerTarget = games * Math.min(1, s.y / 12 / 0.6 / SAMPLE_PER_GAME.targets);
      if (s.b !== undefined) vals.blockGrade = s.b;
    }
  } else {
    const s = e.s;
    const g = Math.max(1, games);
    if (s.sk !== undefined) vals.sacksPerGame = s.sk / g;
    vals.defIntPerGame = s.int / g;
    if (s.ff !== undefined) vals.ffPerGame = s.ff / g;
    vals.frPerGame = s.fr / g;
    if (s.td !== undefined) vals.defTdPerGame = s.td / g;
  }
  return { vals, sample };
}

/**
 * Merge parts field by field. Verified + estimated parts combine by games.
 * When the only data for a field is a small verified slice of a longer stint
 * and legacy has a whole-stint value, legacy is used instead.
 */
function mergeStats(parts: Part[], legacyIn: { vals: Part['vals']; sample: Part['sampleGames'] }, totalGames: number, legacySrc: string): StintStats {
  const legacy = legacyIn.vals;
  const out: StintStats = {};
  const fields = new Set<keyof StintStats>([...parts.flatMap((p) => Object.keys(p.vals) as (keyof StintStats)[]), ...(Object.keys(legacy) as (keyof StintStats)[])]);
  for (const f of fields) {
    if (f === 'sacksOfficial') continue;
    const have = parts.filter((p) => p.vals[f] !== undefined && Number.isFinite(p.vals[f]!));
    const g = have.reduce((a, p) => a + p.games, 0);
    const lv = legacy[f];
    // A slice covering under 40% of the stint (e.g. only the 1999 season of a
    // 1990s stint) doesn't speak for the whole stint, so it's dropped (the
    // field counts as missing). Legacy whole-stint values win below 50%.
    const enough = g >= 0.4 * totalGames;
    if (have.length && (lv === undefined ? enough : g >= 0.5 * totalGames)) {
      const pg = (p: Part) => p.sampleGames?.[f] ?? p.games;
      const g2 = have.reduce((a, p) => a + pg(p), 0);
      const v = have.reduce((a, p) => a + pg(p) * p.vals[f]!, 0) / Math.max(1, g2);
      const vg = have.filter((p) => p.conf === 'verified').reduce((a, p) => a + pg(p), 0);
      const conf: Conf = vg >= 0.75 * g2 ? 'verified' : have.reduce<Conf>((c, p) => worse(c, p.conf), 'verified');
      const sv = src(v, have.map((p) => p.src).join(' + '), conf);
      if (have.some((p) => p.sampleGames?.[f] !== undefined)) sv.games = g2;
      (out as Record<string, Sourced>)[f] = sv;
    } else if (lv !== undefined) {
      const sv = src(lv, legacySrc, 'legacy');
      const sg = legacyIn.sample?.[f];
      if (sg !== undefined) sv.games = sg;
      (out as Record<string, Sourced>)[f] = sv;
    }
  }
  return out;
}

// ------------------------------------------------------------ accolades

interface AccoladeIndex {
  byEntry: Map<string, AccoladeRecord>;
  byName: Map<string, AccoladeRecord[]>;
}

function indexAccolades(acc: Record<string, AccoladeRecord>): AccoladeIndex {
  const byEntry = new Map<string, AccoladeRecord>();
  const byName = new Map<string, AccoladeRecord[]>();
  for (const r of Object.values(acc)) {
    if (!r || typeof r !== 'object' || !Array.isArray(r.entries)) continue;
    for (const e of r.entries) byEntry.set(e, r);
    (byName.get(r.name) ?? byName.set(r.name, []).get(r.name)!).push(r);
  }
  return { byEntry, byName };
}

function countIn(list: number[] | undefined, seasons: ReadonlySet<number>): number {
  return (list ?? []).filter((y) => seasons.has(y)).length;
}

/** Mean honors score of the best three seasons (signals.ts HONOR_WEIGHTS). */
export function peak3(seasons: readonly number[], lists: { allPro1?: number[]; allPro2?: number[]; proBowl?: number[]; mvp?: number[]; poy?: number[] }): number {
  const W = HONOR_WEIGHTS;
  const per = seasons.map(
    (y) =>
      (lists.allPro1?.includes(y) ? W.allPro1 : 0) +
      (lists.allPro2?.includes(y) && !lists.allPro1?.includes(y) ? W.allPro2 : 0) +
      (lists.proBowl?.includes(y) ? W.proBowl : 0) +
      (lists.mvp?.includes(y) ? W.mvp : 0) +
      (lists.poy?.filter((x) => x === y).length ?? 0) * W.poy,
  );
  const top = per.sort((a, b) => b - a).slice(0, Math.min(3, per.length));
  return top.length ? top.reduce((a, b) => a + b, 0) / top.length : 0;
}

function accoladesFor(rec: AccoladeRecord | undefined, seasons: readonly number[], fallback: () => Accolades | undefined, assumeNone: string | null): Accolades | undefined {
  const set = new Set(seasons);
  if (rec && rec.conf !== 'missing') {
    return {
      seasons: seasons.length,
      allPro1: countIn(rec.allPro1, set),
      // A season listed as both first- and second-team counts once, as first-team.
      allPro2: countIn(rec.allPro2?.filter((y) => !rec.allPro1?.includes(y)), set),
      proBowl: countIn(rec.proBowl, set),
      mvp: countIn(rec.mvp, set),
      poy: countIn(rec.opoy, set) + countIn(rec.dpoy, set),
      peak3: peak3(seasons, { allPro1: rec.allPro1, allPro2: rec.allPro2, proBowl: rec.proBowl, mvp: rec.mvp, poy: [...(rec.opoy ?? []), ...(rec.dpoy ?? [])] }),
      src: rec.src,
      conf: rec.conf,
    };
  }
  const fb = fallback();
  if (fb) return fb;
  if (assumeNone !== null && seasons.length) {
    return { seasons: seasons.length, allPro1: 0, allPro2: 0, proBowl: 0, mvp: 0, poy: 0, src: assumeNone, conf: 'estimated' };
  }
  return undefined;
}

// ------------------------------------------------------------ main

function measurablesFor(nv: NflverseEntry | undefined, phys: PhysicalRecord | undefined, ft?: FortyRecord): Measurables {
  const m: Measurables = {};
  const c = nv?.combine;
  if (c) {
    for (const k of ['forty', 'bench', 'vertical', 'broad', 'cone', 'shuttle'] as const) {
      if (typeof c[k] === 'number') m[k] = src(c[k]!, `${c.src}${c.year ? ` ${c.year}` : ''}`, c.conf);
    }
  }
  // Wikipedia pre-draft tables (and commonly cited 40s) fill what the
  // nflverse combine file lacks: pre-2000 players, pro-day-only players.
  if (phys) {
    const s = `${phys.src}${phys.note ? ` (${phys.note})` : ''}`;
    for (const k of ['forty', 'bench', 'vertical', 'broad', 'cone', 'shuttle', 'tenSplit'] as const) {
      const v = phys[k];
      if (!m[k] && typeof v === 'number') m[k] = src(v, s, phys.conf);
    }
  }
  // data/augment/forty_times.json (PR #3 round 2): a measured time (combine,
  // Wikipedia table) or a quoted, cited time fills a missing 40 and replaces
  // an uncited estimate from estimated_physical.json; it never replaces a
  // measured one.
  if (ft && (!m.forty || m.forty.conf === 'estimated' || m.forty.conf === 'prior')) m.forty = src(ft.forty, `${ft.src}${ft.timing ? ` [${ft.kind}, ${ft.timing}]` : ` [${ft.kind}]`}`, ft.conf);
  return m;
}

interface Stint {
  seasons: number[];
  seasonsSrc: Sourced<number[]>;
  games: Sourced;
  gamesBySeason?: Record<string, number>;
  age?: Sourced;
}

function stintOf(decade: Decade, nv: NflverseEntry | undefined, est: { seasons: [number, number]; games: number; src?: string; conf?: Conf } | undefined): Stint {
  const all = decadeSeasons(decade);
  let seasons: number[];
  let seasonsSrc: Sourced<number[]>;
  if (nv?.seasons?.list.length) {
    seasons = nv.seasons.list.filter((y) => all.includes(y));
    seasonsSrc = { v: seasons, src: nv.seasons.src, conf: nv.seasons.conf };
  } else if (est) {
    seasons = range(est.seasons[0], est.seasons[1]).filter((y) => all.includes(y));
    seasonsSrc = { v: seasons, src: 'estimate:knowledge', conf: 'estimated' };
  } else {
    // Unknown: assume the middle half of the decade (a typical stint).
    seasons = all.slice(Math.floor(all.length / 4), Math.max(Math.floor(all.length / 4) + 1, Math.ceil((all.length * 3) / 4)));
    seasonsSrc = { v: seasons, src: 'prior: middle of the decade', conf: 'prior' };
  }
  if (!seasons.length) seasons = all;

  // Games: verified 1999+ games, plus estimated games for the pre-1999 part.
  const gb = nv?.seasons?.games;
  const post = seasons.filter((y) => y >= 1999);
  const pre = seasons.filter((y) => y < 1999);
  let games = 0;
  let conf: Conf = 'verified';
  const srcs: string[] = [];
  if (post.length) {
    if (gb) {
      games += post.reduce((a, y) => a + (gb[String(y)] ?? 0), 0);
      srcs.push('nflverse games');
    } else {
      games += post.reduce((a, y) => a + gamesPerSeason(y) * PARTICIPATION, 0);
      conf = 'estimated';
    }
  }
  if (pre.length) {
    if (est) {
      games += est.games;
      // Added stints (data/augment/added_stints.json) carry cited games at their source's confidence.
      const cited = est.conf !== undefined && est.conf !== 'estimated';
      conf = worse(conf, cited ? est.conf! : 'estimated');
      srcs.push(cited ? `games: ${est.src}` : 'estimated games');
    } else {
      games += pre.reduce((a, y) => a + gamesPerSeason(y) * PARTICIPATION, 0);
      conf = worse(conf, seasonsSrc.conf === 'prior' ? 'prior' : 'estimated');
      srcs.push(`${pre.length} seasons × ${Math.round(PARTICIPATION * 100)}% of the schedule`);
    }
  }
  const bd = nv?.physical?.birthDate;
  const age = bd ? src(seasons.reduce((a, y) => a + ageAt(y, bd), 0) / seasons.length, `${nv!.physical!.src} birth date`, nv!.physical!.conf) : undefined;
  return { seasons, seasonsSrc, games: src(Math.max(1, Math.round(games)), srcs.join(' + ') || 'estimate', conf), gamesBySeason: gb, age };
}

export function buildInputs(S: InputSources): { inputs: RatingInputs[]; notes: string[] } {
  const notes: string[] = [];
  const acc = indexAccolades(S.accolades);
  const physByEntry = new Map<string, PhysicalRecord>();
  for (const r of Object.values(S.physical)) if (r && Array.isArray(r.entries)) for (const e of r.entries) physByEntry.set(e, r);
  const inputs: RatingInputs[] = [];
  const armGrades = new Map<string, BigArmRecord>();
  for (const r of S.arm?.bigArm ?? []) for (const id of r.entryIds) armGrades.set(id, r);

  const common = (e: Player | Defender, pos: RatedPos) => {
    const nv = S.nflverse[e.id];
    const pm = S.people[e.id];
    const personId = pm && !pm.personId.startsWith('unmatched:') ? pm.personId : `legacy:${e.n}|${pos}`;
    const est = S.estStats[e.id];
    const stint = stintOf(e.d, nv, est);
    // Catch % / yards per target are compared over the seasons they cover:
    // verified target seasons, or 1992+ for legacy and estimated values.
    const ts = nv?.stats?.targetsSeasons;
    const targetSeasons = ts && ts.length && nv?.stats?.complete ? ts : stint.seasons.filter((y) => y >= 1992 && (y < 2003 || y > 2008 || (ts ?? []).includes(y)));
    const baseline = stintBaseline(stint.seasons, stint.gamesBySeason, e.t, S.baselines, targetSeasons);
    const p = nv?.physical;
    return { nv, personId, est, stint, baseline, p };
  };

  for (const e of S.players) {
    if (S.excluded.has(e.id)) continue;
    const pos = e.p as RatedPos;
    const { nv, personId, est, stint, baseline, p } = common(e, pos);
    const parts: Part[] = [];
    if (est && stint.seasons.some((y) => y < 1999)) parts.push(estimatedPart(pos, est));
    if (nv?.stats && nv.stats.games > 0) parts.push(verifiedPart(pos, nv.stats, nv.seasons?.games));
    const complete = nv?.stats?.complete === true && nv.stats.games > 0;
    const stats = complete
      ? mergeStats([verifiedPart(pos, nv.stats!, nv.seasons?.games)], { vals: {}, sample: {} }, stint.games.v, '')
      : mergeStats(parts, legacyVals(pos, e, stint.games.v), stint.games.v, `legacy:${e.id}`);
    // Legacy hand-set TE block grade is kept even when verified stats exist.
    if (complete && e.s.b !== undefined && (pos === 'TE' || pos === 'WR')) stats.blockGrade = src(e.s.b, `legacy:${e.id}`, 'legacy');
    const accolades = accoladesFor(acc.byEntry.get(e.id), stint.seasons, () => undefined, e.imp < 76 ? 'assumed none: not looked up (legacy imp < 76)' : null);
    inputs.push({
      id: e.id,
      personId,
      name: e.n,
      pos,
      team: e.t,
      decade: e.d,
      imp: e.imp,
      seasons: stint.seasonsSrc,
      games: stint.games,
      age: stint.age,
      heightIn: p?.heightIn ? src(p.heightIn, p.src, p.conf) : undefined,
      weightLb: p?.weightLb ? src(p.weightLb, p.src, p.conf) : undefined,
      measurables: measurablesFor(nv, physByEntry.get(e.id), S.forty?.[personId]),
      stats,
      accolades,
      baseline,
      experience: stint.age ? src(Math.max(0, stint.age.v - 22), 'age − 22 (proxy)', 'estimated') : undefined,
      ...(pos === 'QB' ? armFor(e.id, stint.seasons, S.arm, armGrades) : {}),
    });
  }

  for (const e of S.defense) {
    if (S.excluded.has(e.id)) continue;
    const pos = e.p as RatedPos;
    const { nv, personId, est, stint, baseline, p } = common(e, pos);
    const ed = S.estDef[e.id];
    const parts: Part[] = [];
    const preGames = est?.games ?? stint.games.v - (nv?.stats?.games ?? 0);
    if (ed && stint.seasons.some((y) => y < 1999)) parts.push(estimatedDefPart(ed, preGames));
    if (nv?.stats && nv.stats.games > 0) parts.push(verifiedPart(pos, nv.stats, nv.seasons?.games));
    const complete = nv?.stats?.complete === true && nv.stats.games > 0;
    const stats = complete ? mergeStats([verifiedPart(pos, nv.stats!, nv.seasons?.games)], { vals: {}, sample: {} }, stint.games.v, '') : mergeStats(parts, legacyVals(pos, e, stint.games.v), stint.games.v, `legacy:${e.id}`);
    stats.sacksOfficial = stint.seasons.every((y) => y >= 1982);
    const legacyAcc = (): Accolades | undefined => {
      if (ed && (ed.allPro1Seasons || ed.proBowlSeasons)) {
        const set = new Set(stint.seasons);
        return {
          seasons: stint.seasons.length,
          allPro1: countIn(ed.allPro1Seasons, set),
          allPro2: 0,
          proBowl: countIn(ed.proBowlSeasons, set),
          mvp: 0,
          poy: countIn(ed.dpoySeasons, set),
          peak3: peak3(stint.seasons, { allPro1: ed.allPro1Seasons, proBowl: ed.proBowlSeasons, poy: ed.dpoySeasons }),
          src: ed.src,
          conf: 'estimated',
        };
      }
      return { seasons: stint.seasons.length, allPro1: e.s.ap, allPro2: 0, proBowl: e.s.pb, mvp: 0, poy: e.s.dpoy ?? 0, src: `legacy:${e.id} (ap/pb/dpoy)`, conf: 'legacy' };
    };
    inputs.push({
      id: e.id,
      personId,
      name: e.n,
      pos,
      team: e.t,
      decade: e.d,
      imp: e.imp,
      seasons: stint.seasonsSrc,
      games: stint.games,
      age: stint.age,
      heightIn: p?.heightIn ? src(p.heightIn, p.src, p.conf) : undefined,
      weightLb: p?.weightLb ? src(p.weightLb, p.src, p.conf) : undefined,
      measurables: measurablesFor(nv, physByEntry.get(e.id), S.forty?.[personId]),
      stats,
      accolades: accoladesFor(acc.byEntry.get(e.id), stint.seasons, legacyAcc, null),
      baseline,
      experience: stint.age ? src(Math.max(0, stint.age.v - 22), 'age − 22 (proxy)', 'estimated') : undefined,
    });
  }

  for (const u of S.olUnits) {
    const r = S.olRosters[u.id];
    const lineup = pickFive(r?.linemen ?? []);
    const found = lineup.filter(Boolean).length;
    if (found < 5) notes.push(`${u.id}: only ${found} linemen on rosters; ${5 - found} generated`);
    const keyNames = u.key.split(' · ');
    for (let i = 0; i < 5; i++) {
      const slot = SLOTS[i]!;
      const l = lineup[i];
      const seasons = l?.seasons.filter((y) => decadeSeasons(u.d).includes(y)) ?? [];
      const stint = seasons.length ? seasons : decadeSeasons(u.d).slice(3, 7);
      const baseline = stintBaseline(stint, undefined, u.t, S.baselines);
      const keyIdx = l && Array.isArray(l.inKeyList) ? l.inKeyList[0] : undefined;
      // accolades.json lists OL key-list people under the unit ids they appear in.
      const accRec =
        (keyIdx !== undefined ? acc.byEntry.get(`ol-key:${u.id}:${keyIdx}`) : undefined) ??
        (l ? acc.byName.get(l.name)?.find((a) => a.entries.includes(u.id)) : undefined) ??
        (l && keyIdx !== undefined ? acc.byName.get(keyNames[keyIdx] ?? '')?.find((a) => a.entries.includes(u.id)) : undefined);
      const games = stint.reduce((a, y) => a + gamesPerSeason(y) * PARTICIPATION, 0);
      const age = l?.birthDate ? src(stint.reduce((a, y) => a + ageAt(y, l.birthDate!), 0) / stint.length, 'nflverse:rosters birth date', 'verified') : undefined;
      inputs.push({
        id: `${u.id}#${slot}`,
        personId: l?.personId ?? `generated:${u.id}#${slot}`,
        name: l?.name ?? `${keyNames[i] && !l ? keyNames[i] : 'Generated'} (${slot})`,
        pos: 'OL',
        team: u.t,
        decade: u.d,
        imp: u.imp,
        seasons: { v: stint, src: l ? 'nflverse:rosters' : 'prior', conf: l ? 'verified' : 'prior' },
        games: src(Math.round(games), `${stint.length} seasons × ${Math.round(PARTICIPATION * 100)}% of the schedule`, 'estimated'),
        age,
        heightIn: l?.heightIn ? src(l.heightIn, 'nflverse:rosters', 'verified') : undefined,
        weightLb: l?.weightLb ? src(l.weightLb, 'nflverse:rosters', 'verified') : undefined,
        measurables: l ? measurablesFor(undefined, undefined, S.forty?.[l.personId]) : {},
        stats: {},
        accolades: accoladesFor(accRec, stint, () => undefined, l ? `assumed none: not in the unit's key list (${u.key})` : null),
        baseline,
        olUnit: {
          unitId: u.id,
          rushYdsPerGame: u.s.ry,
          sacksAllowedPerGame: u.s.sa,
          passBlockGrade: u.s.pb,
          proBowlLinemen: u.s.pbl,
          unitImp: u.imp,
          slot,
          fromKeyList: keyIdx !== undefined,
          generated: !l,
        },
        experience: age ? src(Math.max(0, age.v - 22), 'age − 22 (proxy)', 'estimated') : undefined,
      });
    }
  }
  return { inputs, notes };
}

/**
 * QB arm inputs. Air yards exist from 2006; a stint that also spans earlier
 * seasons keeps its 2006+ figure only when those seasons are at least 40% of
 * the stint (the same slice rule as mergeStats: a small slice doesn't speak
 * for the whole stint). The grade applies to every entry its record lists.
 */
function armFor(id: string, seasons: readonly number[], arm: InputSources['arm'], grades: ReadonlyMap<string, BigArmRecord>): { arm?: ArmInputs } {
  const out: ArmInputs = {};
  const a = arm?.airYards[id];
  if (a && a.attempts > 0 && a.league.intendedAirYardsPerAtt > 0) {
    const covered = a.seasons.filter((y) => seasons.includes(y));
    if (covered.length >= 0.4 * Math.max(1, seasons.length)) {
      out.air = { ratio: a.iayRatio, perAtt: a.intendedAirYardsPerAtt, league: a.league.intendedAirYardsPerAtt, attempts: a.attempts, games: a.attempts / SAMPLE_PER_GAME.attempts, covered, stintSeasons: seasons.length, src: `${a.src} (data/augment/arm_strength.json)`, conf: a.conf };
    }
  }
  const g = grades.get(id);
  if (g) out.grade = { grade: g.grade, evidence: g.evidence, basis: g.basis, urls: g.sources.map((x) => x.url), src: `${g.src} (data/augment/arm_strength.json)`, conf: g.conf };
  return out.air || out.grade ? { arm: out } : {};
}

const SLOTS = ['LT', 'LG', 'C', 'RG', 'RT'] as const;

/**
 * Five starters: key-list names first (the unit's notable linemen), then the
 * linemen with the most seasons on the franchise in the decade. Slots follow
 * listed positions where possible (tackles outside, guards inside, a center).
 */
export function pickFive(linemen: readonly OlRosterLineman[]): (OlRosterLineman | undefined)[] {
  const ordered = [...linemen].sort((a, b) => {
    const ka = a.inKeyList ? Math.min(...a.inKeyList) : 99;
    const kb = b.inKeyList ? Math.min(...b.inKeyList) : 99;
    return ka - kb || b.count - a.count || a.name.localeCompare(b.name);
  });
  const kind = (l: OlRosterLineman): 'T' | 'G' | 'C' | '?' =>
    l.positions.some((p) => p === 'C') ? 'C' : l.positions.some((p) => p === 'T' || p === 'OT' || p === 'LT' || p === 'RT') ? 'T' : l.positions.some((p) => p === 'G' || p === 'OG' || p === 'LG' || p === 'RG') ? 'G' : '?';
  const need: Record<(typeof SLOTS)[number], 'T' | 'G' | 'C'> = { LT: 'T', LG: 'G', C: 'C', RG: 'G', RT: 'T' };
  const chosen = ordered.slice(0, Math.min(5, ordered.length));
  // Fill more candidates if a slot type is missing entirely.
  const out: (OlRosterLineman | undefined)[] = [undefined, undefined, undefined, undefined, undefined];
  const pool = [...chosen];
  for (let pass = 0; pass < 2; pass++) {
    SLOTS.forEach((slot, i) => {
      if (out[i]) return;
      const idx = pool.findIndex((l) => pass === 1 || kind(l) === need[slot]);
      if (idx >= 0) out[i] = pool.splice(idx, 1)[0];
    });
  }
  return out;
}
