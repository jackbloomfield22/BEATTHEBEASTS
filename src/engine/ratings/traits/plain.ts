import type { RatedPos } from '../types';
import { UNIT_TRAITS } from './catalogDefense';
import { COMBOS } from './combos';
import { TRAIT_DEFS } from './derive';
import type { Cond, TraitDef, UnitTraitDef } from './types';

// Plain-language "why he earned it" lines, for the draft (it tests football
// knowledge, so it shows no numbers). The numeric line (derive.ts, e.g.
// "Run Block 89 (top 7% of TEs)") stays the record: the Ratings Explorer, the
// results screen and the Scouting panel outside the draft show it. This file
// turns the same data into words: each condition of the trait's definition
// names its metric, and the rank the numeric line gives it (top N% / bottom
// N% / best of / lowest of the position pool) picks a level word:
//
//   top side     the best … of any era · elite · among the best · very good ·
//                strong · above-average
//   bottom side  the weakest … of any era · very poor · poor · below-average ·
//                modest
//
// Body and volume metrics read as adjectives instead ("exceptionally tall
// for a tight end", "among the fastest receivers", "a fairly light workload").
// Nothing here may produce a digit: tests/draft-plain.test.ts runs every
// trait of every player in the shipped snapshot through it.

/** A condition's rank, as the numeric line states it (derive.ts rankPhrase). */
export interface Rank {
  side: 'top' | 'bottom';
  /** The N of "top N%" / "bottom N%"; 0 for "best of" / "lowest of". */
  n: number;
}

/**
 * The ranks in a numeric why line, in condition order. derive.ts writes each
 * condition as "<metric text> (<rank>)" and a combination as
 * "A (<A's line>) + B (<B's line>)", so reading the rank phrases left to
 * right gives one per condition (the metric text never starts a parenthesis
 * with top/bottom/best/lowest).
 */
export function parseRanks(why: string): Rank[] {
  const out: Rank[] = [];
  for (const m of why.matchAll(/\((?:(top|bottom) (\d+)% of [^()]+|(best|lowest) of \d+ [^()]+)\)/g)) {
    if (m[1]) out.push({ side: m[1] as Rank['side'], n: Number(m[2]) });
    else out.push({ side: m[3] === 'best' ? 'top' : 'bottom', n: 0 });
  }
  return out;
}

const SINGULAR: Record<RatedPos, string> = {
  QB: 'quarterback',
  RB: 'running back',
  WR: 'receiver',
  TE: 'tight end',
  OL: 'offensive lineman',
  DE: 'defensive end',
  DT: 'defensive tackle',
  LB: 'linebacker',
  CB: 'cornerback',
  S: 'safety',
};
const PLURAL: Record<RatedPos, string> = {
  QB: 'quarterbacks',
  RB: 'running backs',
  WR: 'receivers',
  TE: 'tight ends',
  OL: 'offensive linemen',
  DE: 'defensive ends',
  DT: 'defensive tackles',
  LB: 'linebackers',
  CB: 'cornerbacks',
  S: 'safeties',
};

interface Who {
  one: string;
  many: string;
}

const article = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);

/**
 * How a metric reads in words.
 *   q      the quality as a noun ("run blocking"): "elite run blocking"
 *   sup    top-side superlative adjective: "among the fastest receivers"
 *   lo     bottom-side adjective when "poor <q>" misreads ("sack-prone")
 *   adj    [high, low] adjectives, read as "very tall" / "fairly light"
 *   sups   [high, low] superlatives for the adjective form
 *   noun   the adjective form's noun ("a very heavy workload")
 */
type Spec = { q: string; sup?: string; lo?: string } | { adj: [string, string]; sups: [string, string]; noun?: string };

const SPEC: Record<string, Spec> = {
  // Body and physical
  height: { adj: ['tall', 'short'], sups: ['tallest', 'shortest'] },
  weight: { adj: ['big', 'light'], sups: ['biggest', 'lightest'] },
  speed: { adj: ['fast', 'slow'], sups: ['fastest', 'slowest'] },
  acceleration: { q: 'acceleration', sup: 'quickest' },
  agility: { q: 'agility', sup: 'most agile' },
  strength: { q: 'strength', sup: 'strongest' },
  stamina: { q: 'stamina' },
  jumping: { q: 'leaping ability' },
  // Passing
  throwPower: { q: 'arm strength' },
  deepAcc: { q: 'deep accuracy' },
  midAcc: { q: 'mid-range accuracy' },
  shortAcc: { q: 'short accuracy' },
  release: { q: 'quickness of release' },
  pocketPresence: { q: 'pocket presence' },
  scramble: { q: 'scrambling' },
  throwOnRun: { q: 'throwing on the run' },
  awareness: { q: 'awareness' },
  decision: { q: 'decision making' },
  underPressure: { q: 'poise under pressure' },
  // Running
  trucking: { q: 'power running' },
  stiffArm: { q: 'stiff-arming' },
  breakTackle: { q: 'tackle breaking' },
  elusiveness: { q: 'elusiveness', sup: 'most elusive' },
  vision: { q: 'vision' },
  ballSecurity: { q: 'ball security' },
  // Receiving
  catching: { q: 'hands', sup: 'surest-handed' },
  routeRunning: { q: 'route running' },
  shortRoute: { q: 'short route running' },
  deepRoute: { q: 'deep route running' },
  spectacular: { q: 'spectacular catching' },
  catchInTraffic: { q: 'catching in traffic' },
  rac: { q: 'running after the catch' },
  beatPress: { q: 'release off the line' },
  // Blocking
  runBlock: { q: 'run blocking' },
  passBlock: { q: 'pass blocking' },
  impactBlock: { q: 'lead blocking' },
  pullMove: { q: 'pulling' },
  // Defense
  manCov: { q: 'man coverage' },
  zoneCov: { q: 'zone coverage' },
  press: { q: 'press coverage' },
  ballSkills: { q: 'ball skills' },
  tackle: { q: 'tackling' },
  hitPower: { q: 'hitting power', sup: 'hardest-hitting' },
  pursuit: { q: 'pursuit' },
  blockShed: { q: 'block shedding' },
  playRec: { q: 'play recognition' },
  powerMoves: { q: 'power rushing' },
  finesseMoves: { q: 'finesse rushing' },
  // Production (era-relative stat signals)
  'z:q_cmp': { q: 'completion rate' },
  'z:q_ypa': { q: 'yards per attempt' },
  'z:q_td': { q: 'touchdown rate' },
  'z:q_int': { q: 'interception avoidance', lo: 'interception-prone' },
  'z:q_sack': { q: 'sack avoidance', lo: 'sack-prone' },
  'z:q_rate': { q: 'passer rating' },
  'z:q_yds': { q: 'passing yardage' },
  'z:q_ypcmp': { adj: ['long', 'short'], sups: ['longest', 'shortest'], noun: 'average completion' },
  'z:q_rush': { q: 'rushing production' },
  't:t_att': { adj: ['heavy', 'light'], sups: ['heaviest', 'lightest'], noun: 'passing workload' },
  'z:r_ypc': { q: 'yards per carry' },
  'z:r_car': { adj: ['heavy', 'light'], sups: ['heaviest', 'lightest'], noun: 'workload' },
  'z:r_recn': { q: 'receiving volume' },
  't:t_tdtouch': { q: 'touchdown rate per touch' },
  'z:w_recn': { q: "share of the team's catches" },
  'z:w_yds': { q: 'receiving yardage' },
  'z:w_ypr': { adj: ['long', 'short'], sups: ['longest', 'shortest'], noun: 'average catch' },
  'z:w_catch': { q: 'catch rate' },
  'z:w_tdrate': { q: 'touchdown rate per catch' },
  'z:d_sack': { q: 'sack production' },
  'z:d_int': { q: 'interception production' },
  'z:d_ff': { q: 'forced fumbles' },
  'z:d_pd': { q: 'passes defensed' },
  'z:d_tkl': { q: 'tackle production' },
  'z:d_td': { q: 'defensive scoring' },
  'z:u_run': { q: 'rushing production' },
  'z:u_sack': { q: 'sack avoidance', lo: 'sack-prone' },
};

/** Any metric without a spec: its key in words (never digits). */
function fallback(key: string): Spec {
  const k = key.replace(/^[zt]:[a-z]_?/, '').replace(/[^A-Za-z]+/g, ' ');
  return { q: k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim() || 'play' };
}

/** One condition in words. `alone` parts carry their own position; the rest take "for a <pos>". */
interface Part {
  text: string;
  alone: boolean;
}

// Level bands on "top N%" (and "bottom N%"). The gates are top 10% (elite
// traits), top 25% (standard) and looser secondary gates up to 50%
// (traits/types.ts), so the bands split those ranges into words a fan uses.
const ELITE_N = 5;
const AMONG_N = 10;
const VERY_N = 20;
const STRONG_N = 35;
const POOR_VERY_N = 5;
const POOR_N = 15;
const BELOW_N = 30;

function adjMod(n: number): string {
  if (n <= ELITE_N) return 'exceptionally ';
  if (n <= VERY_N) return 'very ';
  if (n <= STRONG_N) return '';
  return 'fairly ';
}

function part(key: string, r: Rank, who: Who): Part {
  const s = SPEC[key] ?? fallback(key);
  if ('adj' in s) {
    const hi = r.side === 'top';
    const adj = hi ? s.adj[0] : s.adj[1];
    const sup = hi ? s.sups[0] : s.sups[1];
    if (s.noun) {
      if (r.n === 0) return { text: `the ${sup} ${s.noun} of any ${who.one}`, alone: true };
      return { text: article(`${adjMod(r.n)}${adj} ${s.noun}`), alone: false };
    }
    if (r.n === 0) return { text: `the ${sup} ${who.one} of any era`, alone: true };
    if (r.n <= AMONG_N && r.n > ELITE_N) return { text: `among the ${sup} ${who.many}`, alone: true };
    return { text: `${adjMod(r.n)}${adj}`, alone: false };
  }
  if (r.side === 'top') {
    if (r.n === 0) return { text: `the best ${s.q} of any ${who.one}`, alone: true };
    if (r.n <= ELITE_N) return { text: `elite ${s.q}`, alone: false };
    if (r.n <= AMONG_N) return { text: s.sup ? `among the ${s.sup} ${who.many}` : `among the best ${who.many} in ${s.q}`, alone: true };
    if (r.n <= VERY_N) return { text: `very good ${s.q}`, alone: false };
    if (r.n <= STRONG_N) return { text: `strong ${s.q}`, alone: false };
    return { text: `above-average ${s.q}`, alone: false };
  }
  if (s.lo) {
    if (r.n === 0) return { text: `the most ${s.lo} ${who.one} of any era`, alone: true };
    return { text: `${adjMod(r.n)}${s.lo}`, alone: false };
  }
  if (r.n === 0) return { text: `the weakest ${s.q} of any ${who.one}`, alone: true };
  if (r.n <= POOR_VERY_N) return { text: `very poor ${s.q}`, alone: false };
  if (r.n <= POOR_N) return { text: `poor ${s.q}`, alone: false };
  if (r.n <= BELOW_N) return { text: `below-average ${s.q}`, alone: false };
  return { text: `modest ${s.q}`, alone: false };
}

const joinAnd = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Conditions in words, in order: a run of plain parts takes one "for a <pos>". */
function sentence(conds: readonly Cond[], ranks: readonly Rank[], who: Who): string {
  const parts = conds.map((c, i) => part(c.m, ranks[i]!, who));
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length) out.push(`${joinAnd(run)} for ${article(who.one)}`);
    run = [];
  };
  for (const p of parts) {
    if (p.alone) {
      flush();
      out.push(p.text);
    } else run.push(p.text);
  }
  flush();
  return joinAnd(out);
}

function defOf(id: string, pos: RatedPos): TraitDef | UnitTraitDef | undefined {
  return TRAIT_DEFS.find((d) => d.id === id && d.pos.includes(pos)) ?? TRAIT_DEFS.find((d) => d.id === id) ?? UNIT_TRAITS.find((d) => d.id === id);
}

const whoFor = (pos: RatedPos, def: TraitDef | UnitTraitDef): Who =>
  UNIT_TRAITS.includes(def as UnitTraitDef) ? { one: 'offensive line', many: 'offensive lines' } : { one: SINGULAR[pos], many: PLURAL[pos] };

/**
 * A trait's why line in plain words, from its numeric line: e.g. "Run Block
 * 89 (top 4% of TEs)" → "elite run blocking for a tight end". A combination
 * reads "Cannon: …; Deep Ball Artist: …". Returns '' when the numeric line
 * doesn't match the definition (never shows a half-parsed line).
 */
export function plainWhy(pos: RatedPos, t: { id: string; why: string }): string {
  const ranks = parseRanks(t.why);
  const combo = COMBOS.find((c) => c.id === t.id && c.pos.includes(pos)) ?? COMBOS.find((c) => c.id === t.id);
  if (combo) {
    const defs = combo.parts.map((p) => defOf(p, pos));
    if (defs.some((d) => !d)) return '';
    const [a, b] = defs as (TraitDef | UnitTraitDef)[];
    if (ranks.length !== a!.conds.length + b!.conds.length) return '';
    return `${a!.label}: ${sentence(a!.conds, ranks.slice(0, a!.conds.length), whoFor(pos, a!))}; ${b!.label}: ${sentence(b!.conds, ranks.slice(a!.conds.length), whoFor(pos, b!))}`;
  }
  const def = defOf(t.id, pos);
  if (!def || ranks.length !== def.conds.length) return '';
  return sentence(def.conds, ranks, whoFor(pos, def));
}
