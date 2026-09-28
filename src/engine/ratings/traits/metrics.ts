import { log } from '../../math/detmath';
import { attrLabel } from '../attributes';
import type { PhysicalResult } from '../physical';
import { worse, type SignalDef, type SignalValue } from '../signals';
import type { RatedEntry, RatedPos, RatingInputs } from '../types';

// Metrics the trait conditions read (see types.ts MetricKey) and the plain
// words the "why he earned it" line uses for each.

/** What a condition needs from the engine for one entry. */
export interface MetricSource {
  /** Sample-shrunk pool z of a ../signals.ts signal (engine.ts zFrom, what the attributes read): the percentile tables are built on it. */
  z: (e: RatedEntry, key: string) => number | undefined;
  /** The same z shrunk by the gate's sample instead (`gateSample`): what a stint is placed in the table with. */
  zGate: (e: RatedEntry, key: string) => number | undefined;
  /** The raw signal value, for its display string. */
  sig: (e: RatedEntry, key: string) => SignalValue | undefined;
  /** Physical pass result (absolute physicals, era-translated body). */
  phys: (e: RatedEntry) => PhysicalResult;
}

export interface MetricValue {
  /** The number the percentile is taken on (higher = more of the thing). */
  v: number;
  /** The value this stint adds to the pool's percentile table, when it differs from `v` (production gates, `gateSample`). */
  ref?: number;
  /** Plain words for the why line, e.g. "Speed 97" or "17.9 yards per catch (league 13.1)". */
  text: string;
}

const g = (inp: RatingInputs) => inp.games.v;
const f1 = (x: number) => x.toFixed(1);

/**
 * The sample a production gate ("z:" and "t:" metrics) shrinks a stint's
 * signal by when it places the stint in the percentile table (M6.6,
 * docs/m66/DATA_AUDIT.md).
 *
 * The tables are the pool as the attributes measure it: each signal shrunk
 * toward the position average by n/(n+k) games (../signals.ts). Placing a
 * stint by that same shrunk value made every production gate prefer long
 * stints, though traits describe a stint and never a career (types.ts: no
 * gate reads seasons): the top 10% of the WR catches-per-game table is held
 * by stints with a median of 77 games (the pool's median stint: 48), so a
 * short stint landed in the middle whatever it produced (Davante Adams's 11
 * Jets games: receptions per game at the 95th percentile on his numbers, the
 * 84th after shrinkage), while body and measurable gates, never shrunk, still
 * passed (Allen Lazard). So a stint with at least k games of sample (the
 * signal's own constant: from there on its numbers outweigh the position
 * average) is placed as if it had at least the position's median sample for
 * the signal (`median`, taken from the pool itself): a short stint is judged
 * like a typical one. Stints of the median sample or longer, and stints under
 * k, are placed exactly as before, and the tables themselves don't change,
 * so no other stint moves.
 *
 * Not for the per-play TD rates whose sample is counted in games rather than
 * plays (`GAME_SAMPLED_RATES`): a backup's 12 catches over 17 games would
 * "qualify" as 17 games of evidence. They keep their placement. And only at
 * the draft's positions (`GATE_FLOOR_POSITIONS`): the defensive pools are the
 * curated Beasts, 55–105 stints each, whose trait tables were set against the
 * rule that at least 40% of every position has no trait (tests), and the
 * floor would take safeties to 36%; they keep their placement too.
 */
export function gateSample(key: string, pos: RatedPos, games: number, k: number, median: number): number {
  return k > 0 && games >= k && GATE_FLOOR_POSITIONS.has(pos) && !GAME_SAMPLED_RATES.has(key) ? Math.max(games, median) : games;
}

/** Positions whose production gates use the median floor (the draftable skill positions). */
export const GATE_FLOOR_POSITIONS: ReadonlySet<RatedPos> = new Set<RatedPos>(['QB', 'RB', 'WR', 'TE']);

/** Per-play rates whose SignalValue.games is the player's games, not his plays (see gateSample). */
export const GAME_SAMPLED_RATES: ReadonlySet<string> = new Set(['w_tdrate', 't_tdtouch']);

/**
 * Trait-only production signals: stat signatures no attribute reads, built
 * like ../signals.ts (era-relative where a baseline exists, standardized in
 * the position pool) and gated like every production gate (`gateSample`).
 */
export const TRAIT_SIGNALS: Record<string, SignalDef> = {
  // League attempts per team-game ≈ league passing yards per team-game ÷
  // league yards per attempt (the baseline file has no attempts column).
  t_att: {
    key: 't_att',
    label: 'Attempts per game vs league team',
    k: 6,
    dir: 1,
    kind: 'stat',
    get: (inp) => {
      const a = inp.stats.attPerGame;
      const b = inp.baseline;
      if (!a || !(a.v > 0) || !(b.ypa > 0) || !(b.passYdsPerTeamGame > 0)) return undefined;
      const lg = b.passYdsPerTeamGame / b.ypa;
      return { x: log(a.v / lg), conf: a.conf, src: a.src, input: `${f1(a.v)} vs league ${f1(lg)}`, games: a.games ?? g(inp) };
    },
  },
  // TDs per touch, normalized by the league's TDs per team-game (the scoring
  // environment of the stint's seasons).
  t_tdtouch: {
    key: 't_tdtouch',
    label: 'TDs per touch vs league scoring',
    k: 10,
    dir: 1,
    kind: 'stat',
    get: (inp) => {
      const td = inp.stats.tdPerGame;
      const car = inp.stats.carriesPerGame;
      if (!td || !car) return undefined;
      const touches = car.v + (inp.stats.recPerGame?.v ?? 0);
      const lg = inp.baseline.rushTdPerTeamGame + inp.baseline.passTdPerTeamGame;
      if (!(touches > 0) || !(lg > 0)) return undefined;
      const rate = td.v / touches;
      return { x: log((rate + 0.001) / lg), conf: worse(td.conf, car.conf), src: `${td.src}+${car.src}`, input: `${(rate * 100).toFixed(1)}%`, games: g(inp) };
    },
  },
};

/** Noun phrase per stat signal, for "A <noun> (league B)". */
const NOUN: Record<string, string> = {
  q_cmp: 'completion rate',
  q_ypa: 'yards per attempt',
  q_td: 'TD rate',
  q_int: 'INT rate',
  q_sack: 'sack rate',
  q_rate: 'passer rating',
  q_yds: 'passing yards per game',
  q_ypcmp: 'yards per completion',
  q_rush: 'QB rushing yards per game',
  r_ypc: 'yards per carry',
  r_car: 'carries per game',
  r_rec: 'receiving yards per game',
  r_recn: 'catches per game',
  r_td: 'TDs per game',
  r_fum: 'fumbles per touch',
  w_yds: 'receiving yards per game',
  w_ypr: 'yards per catch',
  w_ypt: 'yards per target',
  w_catch: 'catch rate',
  w_td: 'receiving TDs per game',
  d_sack: 'sacks per game',
  d_int: 'INTs per game',
  d_ff: 'forced fumbles per game',
  d_pd: 'passes defensed per game',
  d_tkl: 'tackles per game',
  d_td: 'defensive TDs per game',
  u_run: 'unit rushing yards per game',
  u_sack: 'unit sacks allowed per game',
  t_att: 'attempts per game',
  t_tdtouch: 'of touches scored',
  w_recn: 'catches per game',
};

/** Signals whose "league" figure is a team total: said as a share, or not at all. */
const TEAM_SHARE: Record<string, string> = {
  w_recn: "of a league team's completions",
  w_yds: "of a league team's passing yards",
  r_rec: "of a league team's passing yards",
  q_yds: "of a league team's passing yards",
};

function signalText(key: string, s: SignalValue): string {
  const noun = NOUN[key] ?? key;
  if (key === 'w_tdrate') return `TDs on ${s.input}`;
  if (key === 't_tdtouch') return `${s.input} of touches scored`;
  if (key === 'q_rush') return `${s.input.replace(' yds/g', '')} rushing yards per game`;
  const unofficial = s.input.includes('unofficial') ? ', unofficial' : '';
  const [a, rest] = s.input.split(' vs league ');
  if (rest === undefined) return `${a} ${noun}`;
  const b = rest.replace(/ \(.*\)$/, '');
  if (TEAM_SHARE[key]) {
    const share = Number(a) / Number(b);
    return Number.isFinite(share) && share > 0 ? `${a} ${noun} (${Math.round(share * 100)}% ${TEAM_SHARE[key]})` : `${a} ${noun}`;
  }
  // Team-total baselines (sacks, INTs, TDs per team-game): the player's rate alone reads better.
  if (['d_sack', 'd_int', 'r_td', 'w_td', 'q_tdg', 'q_intg'].includes(key)) return `${a} ${noun}${unofficial ? ' (unofficial, pre-1982)' : ''}`;
  if (key === 't_att') return `${a} ${noun} (league team ${b})`;
  return `${a} ${noun} (league ${b})`;
}

const PHYS_KEYS = new Set(['speed', 'acceleration', 'agility', 'strength', 'stamina', 'jumping']);

/** Resolve a metric for an entry; undefined when the data doesn't exist. */
export function metricOf(src: MetricSource, e: RatedEntry, key: string, traitZ: (e: RatedEntry, key: string) => { z: number; zGate: number } | undefined): MetricValue | undefined {
  if (key.startsWith('z:')) {
    const k = key.slice(2);
    const z = src.z(e, k);
    const zg = src.zGate(e, k);
    const s = src.sig(e, k);
    return z === undefined || zg === undefined || !s ? undefined : { v: zg, ...(zg !== z ? { ref: z } : {}), text: signalText(k, s) };
  }
  if (key.startsWith('t:')) {
    const k = key.slice(2);
    const t = traitZ(e, k);
    const s = TRAIT_SIGNALS[k]!.get(e.inputs, undefined as never);
    return t === undefined || !s ? undefined : { v: t.zGate, ...(t.zGate !== t.z ? { ref: t.z } : {}), text: signalText(k, s) };
  }
  if (key === 'height') {
    const p = src.phys(e);
    return { v: p.heightEq, text: `${Math.floor(p.heightIn / 12)}'${Math.round(p.heightIn % 12)}"` };
  }
  if (key === 'weight') {
    const p = src.phys(e);
    return { v: p.weightEq, text: `${Math.round(p.weightLb)} lb` };
  }
  const a = e.attrs[key] ?? (PHYS_KEYS.has(key) ? src.phys(e).attrs[key as keyof PhysicalResult['attrs']] : undefined);
  return a ? { v: a.value, text: `${attrLabel(e.pos, key)} ${Math.round(a.value)}` } : undefined;
}

/** Plain label of a metric (docs and the report). */
export function metricLabel(pos: RatedPos, key: string): string {
  if (key.startsWith('z:') || key.startsWith('t:')) {
    const k = key.slice(2);
    if (k === 'w_tdrate') return 'TDs per catch';
    // Lower-is-better signals are gated on the better end.
    const AVOID: Record<string, string> = { q_sack: 'Sack avoidance (sack rate vs league)', q_int: 'INT avoidance (INT rate vs league)', r_fum: 'Ball security (fumbles per touch)', u_sack: 'Unit sack avoidance (sacks allowed vs league)' };
    if (AVOID[k]) return AVOID[k]!;
    if (k === 'w_recn') return "Share of the team's catches (receptions per game vs league team completions)";
    return (NOUN[k] ?? k).replace(/^./, (c) => c.toUpperCase()).replace(/^Of touches scored$/, 'TDs per touch');
  }
  if (key === 'height') return 'Height';
  if (key === 'weight') return 'Weight';
  if (pos === 'OL' && key === 'passBlock') return 'Pass block (unit mean)';
  if (pos === 'OL' && key === 'runBlock') return 'Run block (unit mean)';
  if (pos === 'OL' && (key === 'pullMove' || key === 'awareness')) return `${attrLabel(pos, key)} (unit mean)`;
  return attrLabel(pos, key);
}

/** Metric keys that would make a trait read a career arc (tests forbid them). */
export const CAREER_ARC_KEYS = ['z:exp', 'exp', 'age', 'experience', 'seasons', 'games'];
