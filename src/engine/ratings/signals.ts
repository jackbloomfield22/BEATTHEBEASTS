import { log } from '../math/detmath';
import type { ArmEvidence, ArmGrade, Conf, RatingInputs, Sourced } from './types';

// Signals: the era-adjusted inputs the attribute formulas combine. Each one
// is a number where "higher = better at the thing it measures" after `dir`
// is applied, plus provenance and a shrinkage constant k (games): a signal
// from n games counts n/(n+k) of its standardized value, the rest regresses to
// the position average (BRIEF "Small samples are shrunk toward the
// position-and-era average in proportion to games played").
//
// Era adjustment follows the Rate+ idea (BRIEF "Dominance over era"): rates
// are compared to the league average over the seasons of the stint, as a log
// ratio (so +0.1 ≈ 10% better than the league) or a difference in points.

export interface SignalValue {
  x: number;
  conf: Conf;
  src: string;
  /** Display string for the explorer, e.g. "64.8% vs league 58.0%". */
  input: string;
  games: number;
}

export interface SignalDef {
  key: string;
  label: string;
  /** Shrinkage constant in games (0 = no shrinkage: accolades, reputation, body). */
  k: number;
  /** +1: higher raw is better; -1: lower raw is better (INT rate, sack rate, fumbles). */
  dir: 1 | -1;
  kind: 'stat' | 'accolade' | 'scouting' | 'reputation' | 'body' | 'physical' | 'unit';
  /**
   * The value is already a z-like score on the position scale (a documented
   * mapping, e.g. ARM_GRADE_Z), so it is not standardized within the pool.
   * Used where the players who have the signal are a selected group (only
   * QBs with a cited arm description are graded), whose own mean and spread
   * would misplace them against the rest of the position.
   */
  absolute?: boolean;
  get: (inp: RatingInputs, phys: PhysicalSnapshot) => SignalValue | undefined;
}

/** Physical attribute values computed before the skill pass (absolute scale). */
export interface PhysicalSnapshot {
  speed: number;
  acceleration: number;
  agility: number;
  strength: number;
  jumping: number;
  /** Era-translated body (same standing among era peers at the position, on the modern scale). */
  heightIn: number;
  weightLb: number;
  /** Actual listed body, for display. */
  realHeightIn: number;
  realWeightLb: number;
  conf: Conf;
}

const ln = log;

const CONF_ORDER: Conf[] = ['verified', 'reference', 'legacy', 'estimated', 'prior'];
/** The lower of two provenance levels (a derived value is only as good as its weakest input). */
export const worse = (a: Conf, b: Conf): Conf => (CONF_ORDER.indexOf(a) >= CONF_ORDER.indexOf(b) ? a : b);
const f1 = (x: number) => x.toFixed(1);
const f2 = (x: number) => x.toFixed(2);
const pctS = (x: number) => `${x.toFixed(1)}%`;
const lbS = (p: PhysicalSnapshot) => `${Math.round(p.realWeightLb)} lb` + (Math.abs(p.realWeightLb - p.weightLb) >= 1 ? ` (≈${Math.round(p.weightLb)} today)` : '');
const htS = (p: PhysicalSnapshot) => `${Math.floor(p.realHeightIn / 12)}'${Math.round(p.realHeightIn % 12)}"`;

/** Log-ratio of a rate to a league baseline. */
function ratio(s: Sourced | undefined, base: number | undefined, games: number, fmt: (x: number) => string, eps = 0): SignalValue | undefined {
  if (!s || base === undefined || !(base > 0) || !(s.v + eps > 0)) return undefined;
  return { x: ln((s.v + eps) / (base + eps)), conf: s.conf, src: s.src, input: `${fmt(s.v)} vs league ${fmt(base)}`, games: s.games ?? games };
}

function diff(s: Sourced | undefined, base: number | undefined, games: number, fmt: (x: number) => string): SignalValue | undefined {
  if (!s || base === undefined) return undefined;
  return { x: s.v - base, conf: s.conf, src: s.src, input: `${fmt(s.v)} vs league ${fmt(base)}`, games: s.games ?? games };
}

function plain(s: Sourced | undefined, games: number, fmt: (x: number) => string, transform: (x: number) => number = (x) => x): SignalValue | undefined {
  if (!s) return undefined;
  return { x: transform(s.v), conf: s.conf, src: s.src, input: fmt(s.v), games: s.games ?? games };
}

/** Honors weights per season: AP 1st-team 1.0, 2nd-team 0.5, Pro Bowl 0.35, MVP 1.2, OPOY/DPOY 0.8. */
export const HONOR_WEIGHTS = { allPro1: 1.0, allPro2: 0.5, proBowl: 0.35, mvp: 1.2, poy: 0.8 } as const;

/**
 * Honors signal: half the stint's average per season, half the average of
 * its best three seasons. A stint is remembered for its peak; pure averages
 * punish stints that include a rookie year or an injury season.
 */
export function accoladeScore(inp: RatingInputs): SignalValue | undefined {
  const a = inp.accolades;
  if (!a || a.seasons <= 0) return undefined;
  const W = HONOR_WEIGHTS;
  const avg = (a.allPro1 * W.allPro1 + a.allPro2 * W.allPro2 + a.proBowl * W.proBowl + a.mvp * W.mvp + a.poy * W.poy) / a.seasons;
  const score = 0.5 * avg + 0.5 * (a.peak3 ?? avg);
  const parts = [a.allPro1 && `${a.allPro1}× All-Pro`, a.allPro2 && `${a.allPro2}× 2nd-team`, a.proBowl && `${a.proBowl}× Pro Bowl`, a.mvp && `${a.mvp}× MVP`, a.poy && `${a.poy}× POY`].filter(Boolean);
  return { x: score, conf: a.conf, src: a.src, input: `${parts.join(', ') || 'no honors'} in ${a.seasons} season${a.seasons === 1 ? '' : 's'}`, games: inp.games.v };
}

const g = (inp: RatingInputs) => inp.games.v;

/**
 * QB arm grade → z-like score (data/augment/arm_strength.json `_meta.definitions.grade`).
 * The grades are ours, from cited descriptions, so each maps to the normal
 * quantile its definition describes within the QB position:
 *   cannon  "one of the strongest arms of his era"           ≈ top 2–3%  → +2.0
 *   strong  "a strong, powerful or rifle arm"                 ≈ top 16%   → +1.0
 *   average "ordinary, unexceptional or doubted" (the doubt
 *           puts it a little below the typical QB)            ≈ 31st pct  → −0.5
 *   weak    "lacked arm strength"                             ≈ 7th pct   → −1.5
 */
export const ARM_GRADE_Z: Record<ArmGrade, number> = { cannon: 2.0, strong: 1.0, average: -0.5, weak: -1.5 };

/**
 * How much of the grade's z counts, by the strength of its evidence
 * (`_meta.definitions.evidence`): a description of his arm as a pro counts in
 * full; being cited as the benchmark in another QB's description is indirect
 * but still about the pro arm (¾); draft, college and high-school reports
 * describe the arm before the NFL and count half.
 */
export const ARM_EVIDENCE_WEIGHT: Record<ArmEvidence, number> = { pro: 1, comparison: 0.75, 'pre-pro': 0.5 };

export const SIGNALS: Record<string, SignalDef> = {
  // ---------------------------------------------------------------- shared
  acc: { key: 'acc', label: 'Honors per season', k: 0, dir: 1, kind: 'accolade', get: (inp) => accoladeScore(inp) },
  imp: {
    key: 'imp',
    label: 'Legacy reputation (imp)',
    k: 0,
    dir: 1,
    kind: 'reputation',
    get: (inp) => ({ x: inp.imp, conf: 'legacy', src: 'legacy:imp', input: String(inp.imp), games: g(inp) }),
  },
  exp: {
    key: 'exp',
    label: 'Experience',
    k: 0,
    dir: 1,
    kind: 'body',
    get: (inp) => (inp.experience ? { x: ln(1 + inp.experience.v), conf: inp.experience.conf, src: inp.experience.src, input: `${f1(inp.experience.v)} yrs in league`, games: g(inp) } : undefined),
  },
  p_speed: { key: 'p_speed', label: 'Speed', k: 0, dir: 1, kind: 'physical', get: (inp, p) => ({ x: p.speed, conf: p.conf, src: 'ratings:speed', input: f1(p.speed), games: g(inp) }) },
  p_agility: { key: 'p_agility', label: 'Agility', k: 0, dir: 1, kind: 'physical', get: (inp, p) => ({ x: p.agility, conf: p.conf, src: 'ratings:agility', input: f1(p.agility), games: g(inp) }) },
  p_strength: { key: 'p_strength', label: 'Strength', k: 0, dir: 1, kind: 'physical', get: (inp, p) => ({ x: p.strength, conf: p.conf, src: 'ratings:strength', input: f1(p.strength), games: g(inp) }) },
  p_jump: { key: 'p_jump', label: 'Jumping', k: 0, dir: 1, kind: 'physical', get: (inp, p) => ({ x: p.jumping, conf: p.conf, src: 'ratings:jumping', input: f1(p.jumping), games: g(inp) }) },
  p_weight: {
    key: 'p_weight',
    label: 'Weight',
    k: 0,
    dir: 1,
    kind: 'body',
    get: (inp, p) => ({ x: p.weightLb, conf: inp.weightLb?.conf ?? 'prior', src: inp.weightLb?.src ?? 'prior', input: lbS(p), games: g(inp) }),
  },
  p_light: {
    key: 'p_light',
    label: 'Light frame',
    k: 0,
    dir: -1,
    kind: 'body',
    get: (inp, p) => ({ x: p.weightLb, conf: inp.weightLb?.conf ?? 'prior', src: inp.weightLb?.src ?? 'prior', input: lbS(p), games: g(inp) }),
  },
  p_height: {
    key: 'p_height',
    label: 'Height',
    k: 0,
    dir: 1,
    kind: 'body',
    get: (inp, p) => ({ x: p.heightIn, conf: inp.heightIn?.conf ?? 'prior', src: inp.heightIn?.src ?? 'prior', input: htS(p), games: g(inp) }),
  },

  // ---------------------------------------------------------------- QB
  q_cmp: { key: 'q_cmp', label: 'Completion % vs league', k: 10, dir: 1, kind: 'stat', get: (inp) => diff(inp.stats.cmpPct, inp.baseline.cmpPct, g(inp), pctS) },
  q_ypa: { key: 'q_ypa', label: 'Yards per attempt vs league', k: 10, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.ypa, inp.baseline.ypa, g(inp), f2) },
  q_td: { key: 'q_td', label: 'TD % vs league', k: 16, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.tdPct, inp.baseline.tdPct, g(inp), pctS) },
  q_int: { key: 'q_int', label: 'INT % vs league', k: 20, dir: -1, kind: 'stat', get: (inp) => ratio(inp.stats.intPct, inp.baseline.intPct, g(inp), pctS) },
  q_sack: { key: 'q_sack', label: 'Sack rate vs league', k: 16, dir: -1, kind: 'stat', get: (inp) => ratio(inp.stats.sackPct, inp.baseline.sackPct, g(inp), pctS) },
  q_rate: { key: 'q_rate', label: 'Passer rating vs league', k: 12, dir: 1, kind: 'stat', get: (inp) => diff(inp.stats.passerRating, inp.baseline.passerRating, g(inp), f1) },
  q_yds: { key: 'q_yds', label: 'Passing yards/game vs league team', k: 6, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.passYdsPerGame, inp.baseline.passYdsPerTeamGame, g(inp), (x) => x.toFixed(0)) },
  q_tdg: { key: 'q_tdg', label: 'Passing TD/game vs league team', k: 10, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.passTdPerGame, inp.baseline.passTdPerTeamGame, g(inp), f2) },
  q_intg: { key: 'q_intg', label: 'INT/game vs league team', k: 16, dir: -1, kind: 'stat', get: (inp) => ratio(inp.stats.intPerGame, inp.baseline.intPerTeamGame, g(inp), f2) },
  q_ypcmp: {
    key: 'q_ypcmp',
    label: 'Yards per completion vs league (deep share)',
    k: 12,
    dir: 1,
    kind: 'stat',
    get: (inp) => {
      const { ypa, cmpPct } = inp.stats;
      const b = inp.baseline;
      if (!ypa || !cmpPct || !(cmpPct.v > 0) || !(b.cmpPct > 0)) return undefined;
      const mine = ypa.v / (cmpPct.v / 100);
      const lg = b.ypa / (b.cmpPct / 100);
      return { x: ln(mine / lg), conf: worse(ypa.conf, cmpPct.conf), src: `${ypa.src}+${cmpPct.src}`, input: `${f1(mine)} vs league ${f1(lg)}`, games: g(inp) };
    },
  },
  q_air: {
    key: 'q_air',
    label: 'Intended air yards/att vs league (2006+)',
    // Same shrinkage as the other deep-share rate (q_ypcmp); games = attempts / 30.
    k: 12,
    dir: 1,
    kind: 'stat',
    get: (inp) => {
      const a = inp.arm?.air;
      if (!a || !(a.ratio > 0)) return undefined;
      const part = a.covered.length < a.stintSeasons ? `, ${a.covered[0]}–${a.covered[a.covered.length - 1]} only (${a.covered.length} of ${a.stintSeasons} seasons)` : '';
      return { x: ln(a.ratio), conf: a.conf, src: a.src, input: `${f2(a.perAtt)} vs league ${f2(a.league)} on ${a.attempts} att${part}`, games: a.games };
    },
  },
  q_arm: {
    key: 'q_arm',
    label: 'Arm grade (cited descriptions, estimated)',
    k: 0,
    dir: 1,
    kind: 'scouting',
    absolute: true,
    get: (inp) => {
      const a = inp.arm?.grade;
      if (!a) return undefined;
      const w = ARM_EVIDENCE_WEIGHT[a.evidence];
      const z = ARM_GRADE_Z[a.grade] * w;
      return { x: z, conf: a.conf, src: `${a.src}: ${a.urls.join(' ')}`, input: `${a.grade}, ${a.evidence} evidence (×${w}): z ${z >= 0 ? '+' : ''}${f2(z)}`, games: g(inp) };
    },
  },
  q_tdint: {
    key: 'q_tdint',
    label: 'TD:INT ratio vs league',
    k: 16,
    dir: 1,
    kind: 'stat',
    get: (inp) => {
      const td = inp.stats.tdPct ?? inp.stats.passTdPerGame;
      const it = inp.stats.tdPct ? inp.stats.intPct : inp.stats.intPerGame;
      if (!td || !it) return undefined;
      const b = inp.baseline;
      const lg = inp.stats.tdPct ? b.tdPct / b.intPct : b.passTdPerTeamGame / b.intPerTeamGame;
      const mine = (td.v + 0.05) / (it.v + 0.05);
      return { x: ln(mine / lg), conf: worse(td.conf, it.conf), src: `${td.src}+${it.src}`, input: `${f2(td.v / Math.max(0.01, it.v))} vs league ${f2(lg)}`, games: g(inp) };
    },
  },
  q_rush: { key: 'q_rush', label: 'QB rushing yards/game', k: 6, dir: 1, kind: 'stat', get: (inp) => plain(inp.stats.qbRushYdsPerGame, g(inp), (x) => `${x.toFixed(0)} yds/g`, (x) => ln(1 + Math.max(0, x))) },

  // ---------------------------------------------------------------- RB
  r_ypc: { key: 'r_ypc', label: 'Yards per carry vs league', k: 8, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.ypc, inp.baseline.ypc, g(inp), f2) },
  r_yds: { key: 'r_yds', label: 'Rushing yards/game vs league team', k: 6, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.rushYdsPerGame, inp.baseline.rushYdsPerTeamGame, g(inp), (x) => x.toFixed(0)) },
  r_car: { key: 'r_car', label: 'Carries per game', k: 6, dir: 1, kind: 'stat', get: (inp) => plain(inp.stats.carriesPerGame, g(inp), f1, (x) => ln(Math.max(0.5, x))) },
  r_rec: { key: 'r_rec', label: 'Receiving yards/game vs league team passing', k: 6, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.recYdsPerGame, inp.baseline.passYdsPerTeamGame, g(inp), (x) => x.toFixed(0), 2) },
  r_recn: { key: 'r_recn', label: 'Receptions per game', k: 8, dir: 1, kind: 'stat', get: (inp) => plain(inp.stats.recPerGame, g(inp), f1, (x) => ln(0.3 + Math.max(0, x))) },
  r_td: {
    key: 'r_td',
    label: 'TDs/game vs league team',
    k: 10,
    dir: 1,
    kind: 'stat',
    get: (inp) => ratio(inp.stats.tdPerGame, inp.baseline.rushTdPerTeamGame + inp.baseline.passTdPerTeamGame, g(inp), f2),
  },
  r_fum: { key: 'r_fum', label: 'Fumbles per touch', k: 20, dir: -1, kind: 'stat', get: (inp) => plain(inp.stats.fumblesPerTouch, g(inp), (x) => `${(x * 100).toFixed(2)}%`, (x) => ln(0.002 + Math.max(0, x))) },

  // ---------------------------------------------------------------- receivers
  w_yds: { key: 'w_yds', label: 'Receiving yards/game vs league team passing', k: 6, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.recYdsPerGame, inp.baseline.passYdsPerTeamGame, g(inp), (x) => x.toFixed(0)) },
  w_ypr: { key: 'w_ypr', label: 'Yards per reception vs league', k: 10, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.yardsPerRec, inp.baseline.yardsPerReception, g(inp), f1) },
  w_ypt: { key: 'w_ypt', label: 'Yards per target vs league', k: 10, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.yardsPerTarget, inp.baseline.yardsPerTarget, g(inp), f1) },
  w_catch: { key: 'w_catch', label: 'Catch % vs league', k: 12, dir: 1, kind: 'stat', get: (inp) => diff(inp.stats.catchPct, inp.baseline.catchRate, g(inp), pctS) },
  w_recn: { key: 'w_recn', label: 'Receptions/game vs league team completions', k: 6, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.recPerGame, inp.baseline.passCmpPerTeamGame, g(inp), f1) },
  w_td: { key: 'w_td', label: 'Receiving TD/game vs league team', k: 10, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.tdPerGame, inp.baseline.passTdPerTeamGame, g(inp), f2) },
  w_tdrate: {
    key: 'w_tdrate',
    label: 'TDs per catch (red-zone role)',
    k: 12,
    dir: 1,
    kind: 'stat',
    get: (inp) => {
      const td = inp.stats.tdPerGame;
      const rec = inp.stats.recPerGame;
      if (!td || !rec || rec.v <= 0) return undefined;
      const conf = td.conf === 'verified' && rec.conf === 'verified' ? 'verified' : rec.conf === 'estimated' || td.conf === 'estimated' ? 'estimated' : 'legacy';
      return { x: ln((td.v + 0.01) / rec.v), conf, src: `${td.src}+${rec.src}`, input: `${((td.v / rec.v) * 100).toFixed(1)}% of catches`, games: g(inp) };
    },
  },
  w_block: {
    key: 'w_block',
    label: 'Legacy block grade (hand-set)',
    k: 0,
    dir: 1,
    kind: 'reputation',
    get: (inp) => (inp.stats.blockGrade ? { x: inp.stats.blockGrade.v, conf: 'legacy', src: inp.stats.blockGrade.src, input: String(inp.stats.blockGrade.v), games: g(inp) } : undefined),
  },

  // ---------------------------------------------------------------- defense
  d_sack: {
    key: 'd_sack',
    label: 'Sacks/game vs league team',
    k: 10,
    dir: 1,
    kind: 'stat',
    get: (inp) => {
      const s = ratio(inp.stats.sacksPerGame, inp.baseline.sacksPerTeamGame, g(inp), f2, 0.02);
      if (s && inp.stats.sacksOfficial === false) return { ...s, conf: 'estimated', input: `${s.input} (unofficial, pre-1982)` };
      return s;
    },
  },
  d_int: { key: 'd_int', label: 'Interceptions/game vs league team', k: 16, dir: 1, kind: 'stat', get: (inp) => ratio(inp.stats.defIntPerGame, inp.baseline.intPerTeamGame, g(inp), f2, 0.01) },
  d_ff: { key: 'd_ff', label: 'Forced fumbles per game', k: 16, dir: 1, kind: 'stat', get: (inp) => plain(inp.stats.ffPerGame, g(inp), f2, (x) => ln(0.01 + x)) },
  d_pd: { key: 'd_pd', label: 'Passes defensed per game', k: 12, dir: 1, kind: 'stat', get: (inp) => plain(inp.stats.pdPerGame, g(inp), f2, (x) => ln(0.02 + x)) },
  d_tkl: { key: 'd_tkl', label: 'Tackles per game', k: 8, dir: 1, kind: 'stat', get: (inp) => plain(inp.stats.tacklesPerGame, g(inp), f1, (x) => ln(0.3 + x)) },
  d_td: { key: 'd_td', label: 'Defensive TDs per game', k: 30, dir: 1, kind: 'stat', get: (inp) => plain(inp.stats.defTdPerGame, g(inp), (x) => x.toFixed(3), (x) => ln(0.005 + x)) },

  // ---------------------------------------------------------------- OL unit
  u_run: {
    key: 'u_run',
    label: 'Unit rushing yards/game vs league',
    k: 0,
    dir: 1,
    kind: 'unit',
    get: (inp) => (inp.olUnit ? { x: ln(inp.olUnit.rushYdsPerGame / inp.baseline.rushYdsPerTeamGame), conf: 'legacy', src: 'legacy:UNITS.ry', input: `${inp.olUnit.rushYdsPerGame} vs league ${inp.baseline.rushYdsPerTeamGame.toFixed(0)}`, games: g(inp) } : undefined),
  },
  u_sack: {
    key: 'u_sack',
    label: 'Unit sacks allowed/game vs league',
    k: 0,
    dir: -1,
    kind: 'unit',
    get: (inp) => (inp.olUnit ? { x: ln(inp.olUnit.sacksAllowedPerGame / inp.baseline.sacksPerTeamGame), conf: 'legacy', src: 'legacy:UNITS.sa', input: `${inp.olUnit.sacksAllowedPerGame} vs league ${inp.baseline.sacksPerTeamGame.toFixed(2)}`, games: g(inp) } : undefined),
  },
  u_grade: {
    key: 'u_grade',
    label: 'Unit pass-block grade (hand-set)',
    k: 0,
    dir: 1,
    kind: 'reputation',
    get: (inp) => (inp.olUnit ? { x: inp.olUnit.passBlockGrade, conf: 'legacy', src: 'legacy:UNITS.pb', input: String(inp.olUnit.passBlockGrade), games: g(inp) } : undefined),
  },
  u_pbl: {
    key: 'u_pbl',
    label: 'Unit Pro Bowl linemen',
    k: 0,
    dir: 1,
    kind: 'unit',
    get: (inp) => (inp.olUnit ? { x: inp.olUnit.proBowlLinemen, conf: 'legacy', src: 'legacy:UNITS.pbl', input: String(inp.olUnit.proBowlLinemen), games: g(inp) } : undefined),
  },
};
