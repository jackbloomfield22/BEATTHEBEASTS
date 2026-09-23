import { shrink } from '../scale';
import type { RatedEntry, RatedPos, TraitResult } from '../types';
import { DEFENSE_TRAITS, UNIT_TRAITS } from './catalogDefense';
import { OFFENSE_TRAITS } from './catalogOffense';
import { COMBOS } from './combos';
import { groupOf } from './groups';
import { metricOf, TRAIT_SIGNALS, type MetricSource, type MetricValue } from './metrics';
import type { Cond, TraitDef, UnitTraitDef } from './types';

// Trait derivation (engine.ts step 7, after attributes, OVR and calibration):
//   1. percentile tables of every metric a trait reads, per position pool
//   2. every definition's gates per entry → the earned traits, each with a
//      strength (how far past its gates, 0–1) and a "why he earned it" line
//   3. combinations replace their two parts; the best trait of each facet
//      (groups.ts) is taken first, then the rest by rank, up to four (at most
//      two negatives). Rank = how far past the gates + an elite bonus + a
//      combination bonus + how rare the trait is among the player's peers
//      (players of similar OVR at his position), so a star shows what sets him
//      apart from the other stars, not what every star has.
// OL units get unit traits from the mean of their five linemen.

export const TRAIT_DEFS: readonly TraitDef[] = [...OFFENSE_TRAITS, ...DEFENSE_TRAITS];

/** Most traits a player shows (BRIEF follow-up: "up to 4 per player"). */
export const MAX_TRAITS = 4;
/** Most negative traits a player shows. */
export const MAX_NEGATIVE = 2;
/** Ranking bonuses: an elite trait outranks a standard one earned by the same margin; a combination outranks both its parts. */
const ELITE_BONUS = 0.2;
const COMBO_BONUS = 0.3;
/** Weight of peer rarity in the rank (1 − share of peers who earned it). */
const DISTINCT_W = 0.5;
/** Peers: players within this share of the position pool in OVR rank (either side), at least PEER_MIN ranks. */
const PEER_SHARE = 0.1;
const PEER_MIN = 20;
/** Same clip as engine.ts Z_CLIP (one freak value can't swamp a metric). */
const Z_CLIP = 4.5;

const PLURAL: Record<RatedPos, string> = { QB: 'QBs', RB: 'RBs', WR: 'WRs', TE: 'TEs', OL: 'OL units', DE: 'DEs', DT: 'DTs', LB: 'LBs', CB: 'CBs', S: 'safeties' };

export interface OlUnitTraits {
  unitId: string;
  linemen: string[];
  /** Unit aggregates the unit traits and synergies read (mean of the five linemen). */
  attrs: Record<string, number>;
  traits: TraitResult[];
}

export interface TraitRun {
  /** Shown traits per entry id (combinations applied, at most four). */
  byEntry: Map<string, TraitResult[]>;
  /** Every trait an entry passes the gates for, before combinations and the cap (report and tests). */
  earned: Map<string, TraitResult[]>;
  units: Record<string, OlUnitTraits>;
}

interface Subject {
  id: string;
  metrics: Map<string, MetricValue>;
}

function pctOf(sorted: readonly number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (sorted[m]! < v) lo = m + 1;
    else hi = m;
  }
  let eq = lo;
  while (eq < sorted.length && sorted[eq] === v) eq++;
  return (100 * (lo + 0.5 * (eq - lo))) / sorted.length;
}

function rankPhrase(sorted: readonly number[], v: number, c: Cond, plural: string): string {
  const p = pctOf(sorted, v);
  if (c.side === 'top' && v >= sorted[sorted.length - 1]!) return `best of ${sorted.length} ${plural}`;
  if (c.side === 'bottom' && v <= sorted[0]! && c.gate <= 25) return `lowest of ${sorted.length} ${plural}`;
  return c.side === 'top' ? `top ${Math.max(1, Math.ceil(100 - p))}% of ${plural}` : `bottom ${Math.max(1, Math.ceil(p))}% of ${plural}`;
}

const joinParts = (xs: string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

interface Earned extends TraitResult {
  strength: number;
  def: TraitDef | UnitTraitDef;
}

/** Evaluate definitions over a pool of subjects that share percentile tables. */
function evaluate(defs: readonly (TraitDef | UnitTraitDef)[], subjects: readonly Subject[], plural: string): Map<string, Earned[]> {
  const sorted = new Map<string, number[]>();
  for (const d of defs)
    for (const c of d.conds)
      if (!sorted.has(c.m)) {
        const xs = subjects.map((s) => s.metrics.get(c.m)?.v).filter((v): v is number => v !== undefined && Number.isFinite(v));
        sorted.set(c.m, xs.sort((a, b) => a - b));
      }
  const out = new Map<string, Earned[]>();
  for (const s of subjects) {
    const list: Earned[] = [];
    for (const d of defs) {
      const parts: string[] = [];
      const reasons: string[] = [];
      let margin = 0;
      let ok = true;
      for (const c of d.conds) {
        const mv = s.metrics.get(c.m);
        const xs = sorted.get(c.m)!;
        // A gate needs a real pool to mean anything.
        if (!mv || xs.length < 20) {
          ok = false;
          break;
        }
        const p = pctOf(xs, mv.v);
        const pass = c.side === 'top' ? p >= 100 - c.gate : p <= c.gate;
        if (!pass) {
          ok = false;
          break;
        }
        margin += Math.min(1, (c.side === 'top' ? p - (100 - c.gate) : c.gate - p) / c.gate);
        const rank = rankPhrase(xs, mv.v, c, plural);
        parts.push(`${mv.text} (${rank})`);
        reasons.push(`${mv.text}: ${rank} (gate: ${c.side} ${c.gate}%)`);
      }
      if (!ok) continue;
      list.push({ id: d.id, why: joinParts(parts), reasons, strength: margin / d.conds.length, def: d });
    }
    out.set(s.id, list);
  }
  return out;
}

/** Share of an entry's peers who earned a trait (or both parts of a combination). */
type PeerShare = (ids: readonly string[]) => number;

const rankKey = (strength: number, elite: boolean, combo: boolean, peerShare: number) => strength + (elite ? ELITE_BONUS : 0) + (combo ? COMBO_BONUS : 0) + DISTINCT_W * (1 - peerShare);

/** Combinations first, then one trait per facet, then the rest by rank: at most four, at most two negatives. */
function select(earned: readonly Earned[], pos: RatedPos, peers: PeerShare): TraitResult[] {
  const have = new Map(earned.map((x) => [x.id, x]));
  const used = new Set<string>();
  const ranked: { r: TraitResult; key: number; negative: boolean; group: string }[] = [];
  for (const c of COMBOS) {
    if (!c.pos.includes(pos)) continue;
    const a = have.get(c.parts[0]);
    const b = have.get(c.parts[1]);
    if (!a || !b || used.has(a.id) || used.has(b.id)) continue;
    used.add(a.id);
    used.add(b.id);
    const strength = Math.max(a.strength, b.strength);
    const elite = a.def.tier === 'elite' || b.def.tier === 'elite';
    ranked.push({
      r: { id: c.id, why: `${a.def.label} (${a.why}) + ${b.def.label} (${b.why})`, reasons: [...a.reasons, ...b.reasons], combo: [a.id, b.id], strength },
      key: rankKey(strength, elite, true, peers(c.parts)),
      negative: a.def.polarity === 'negative' && b.def.polarity === 'negative',
      group: groupOf(pos, c.id) ?? c.id,
    });
  }
  for (const x of earned) {
    if (used.has(x.id)) continue;
    ranked.push({ r: { id: x.id, why: x.why, reasons: x.reasons, strength: x.strength }, key: rankKey(x.strength, x.def.tier === 'elite', false, peers([x.id])), negative: x.def.polarity === 'negative', group: groupOf(pos, x.id) ?? x.id });
  }
  ranked.sort((a, b) => b.key - a.key || (a.r.id < b.r.id ? -1 : 1));
  const picked = new Set<(typeof ranked)[number]>();
  let neg = 0;
  const take = (x: (typeof ranked)[number]) => {
    if (picked.size >= MAX_TRAITS || picked.has(x) || (x.negative && neg >= MAX_NEGATIVE)) return;
    if (x.negative) neg++;
    picked.add(x);
  };
  const groups = new Set<string>();
  for (const x of ranked) {
    if (groups.has(x.group)) continue;
    const before = picked.size;
    take(x);
    if (picked.size > before) groups.add(x.group);
  }
  for (const x of ranked) take(x);
  return ranked.filter((x) => picked.has(x)).map((x) => x.r);
}

const strip = ({ id, why, reasons, strength }: Earned): TraitResult => ({ id, why, reasons, strength });

export function deriveAllTraits(entries: readonly RatedEntry[], src: MetricSource): TraitRun {
  const byPos = new Map<RatedPos, RatedEntry[]>();
  for (const e of entries) (byPos.get(e.pos) ?? byPos.set(e.pos, []).get(e.pos)!).push(e);

  // Trait-only stat signals: standardized within the position pool, shrunk by games.
  const traitZ = new Map<string, number>();
  for (const [, list] of byPos) {
    for (const [key, def] of Object.entries(TRAIT_SIGNALS)) {
      const vals = list.map((e) => [e, def.get(e.inputs, undefined as never)] as const).filter(([, v]) => v && Number.isFinite(v.x));
      if (vals.length < 3) continue;
      const xs = vals.map(([, v]) => v!.x);
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1)) || 1;
      for (const [e, v] of vals) traitZ.set(`${e.id}|${key}`, Math.max(-Z_CLIP, Math.min(Z_CLIP, (def.dir * (v!.x - mean)) / sd)) * shrink(v!.games, def.k));
    }
  }
  const tz = (e: RatedEntry, key: string) => traitZ.get(`${e.id}|${key}`);

  const byEntry = new Map<string, TraitResult[]>();
  const earnedOut = new Map<string, TraitResult[]>();
  for (const [pos, list] of byPos) {
    const defs = TRAIT_DEFS.filter((d) => d.pos.includes(pos));
    const keys = new Set(defs.flatMap((d) => d.conds.map((c) => c.m)));
    const subjects: Subject[] = list.map((e) => {
      const metrics = new Map<string, MetricValue>();
      for (const k of keys) {
        const mv = metricOf(src, e, k, tz);
        if (mv && Number.isFinite(mv.v)) metrics.set(k, mv);
      }
      return { id: e.id, metrics };
    });
    const earned = evaluate(defs, subjects, PLURAL[pos]);
    // Peer rarity: prefix counts of each trait along the OVR ranking.
    const order = [...list].sort((a, b) => b.ovr.value - a.ovr.value || (a.id < b.id ? -1 : 1));
    const rankOf = new Map(order.map((e, i) => [e.id, i]));
    const sets = order.map((e) => new Set((earned.get(e.id) ?? []).map((t) => t.id)));
    const prefix = new Map<string, number[]>();
    const prefixOf = (ids: readonly string[]): number[] => {
      const k = ids.join('+');
      let p = prefix.get(k);
      if (!p) {
        p = [0];
        for (const s of sets) p.push(p[p.length - 1]! + (ids.every((id) => s.has(id)) ? 1 : 0));
        prefix.set(k, p);
      }
      return p;
    };
    const half = Math.max(PEER_MIN, Math.round(PEER_SHARE * list.length));
    for (const e of list) {
      const got = earned.get(e.id) ?? [];
      const r = rankOf.get(e.id)!;
      const lo = Math.max(0, r - half);
      const hi = Math.min(order.length, r + half + 1);
      const peers: PeerShare = (ids) => {
        const p = prefixOf(ids);
        return (p[hi]! - p[lo]!) / (hi - lo);
      };
      earnedOut.set(e.id, got.map(strip));
      byEntry.set(e.id, select(got, pos, peers));
    }
  }

  // OL units: aggregate the five linemen, then unit traits over the pool of units.
  const units: Record<string, OlUnitTraits> = {};
  const unitLinemen = new Map<string, RatedEntry[]>();
  for (const e of byPos.get('OL') ?? []) {
    const u = e.inputs.olUnit;
    if (u) (unitLinemen.get(u.unitId) ?? unitLinemen.set(u.unitId, []).get(u.unitId)!).push(e);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const av = (e: RatedEntry, k: string) => e.attrs[k]?.value ?? 0;
  const unitSubjects: Subject[] = [];
  for (const [unitId, ls] of unitLinemen) {
    const attrs = {
      passBlock: mean(ls.map((e) => (av(e, 'pbPower') + av(e, 'pbFinesse') + av(e, 'anchor')) / 3)),
      runBlock: mean(ls.map((e) => (av(e, 'rbPower') + av(e, 'rbFinesse')) / 2)),
      pullMove: mean(ls.map((e) => av(e, 'pullMove'))),
      awareness: mean(ls.map((e) => av(e, 'awareness'))),
    };
    units[unitId] = { unitId, linemen: ls.map((e) => e.id), attrs, traits: [] };
    const metrics = new Map<string, MetricValue>([
      ['passBlock', { v: attrs.passBlock, text: `Pass block ${Math.round(attrs.passBlock)} (mean of the five)` }],
      ['runBlock', { v: attrs.runBlock, text: `Run block ${Math.round(attrs.runBlock)} (mean of the five)` }],
      ['pullMove', { v: attrs.pullMove, text: `Pull and Move ${Math.round(attrs.pullMove)} (mean of the five)` }],
      ['awareness', { v: attrs.awareness, text: `Awareness ${Math.round(attrs.awareness)} (mean of the five)` }],
    ]);
    for (const k of ['z:u_run', 'z:u_sack']) {
      const mv = metricOf(src, ls[0]!, k, tz);
      if (mv) metrics.set(k, mv);
    }
    unitSubjects.push({ id: unitId, metrics });
  }
  const unitEarned = evaluate(UNIT_TRAITS, unitSubjects, PLURAL.OL);
  for (const [id, got] of unitEarned) units[id]!.traits = select(got, 'OL', () => 0);

  return { byEntry, earned: earnedOut, units };
}
