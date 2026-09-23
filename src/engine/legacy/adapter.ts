// Adapter from the new ratings to the legacy sim (TECH_PLAN §6.4). The legacy
// sim reads its own 0–100 ability fields ({arm, acc, care, explos, legs} for
// the QB, and so on). Each field is a linear blend of new attributes whose
// coefficients are fitted by least squares against legacy's own values over
// the whole pool (tools/ratings/fit-adapter.ts → data/ratings/adapter.v1.json),
// so the sim's score distributions start where legacy's were. Tuning to the
// calibration targets (~21 / ~36 / ~14 points per game) waits for the ratings
// sign-off (BRIEF milestone 2).

import type { BeastLike, OffenseRatings, OLRatings, QBRatings, RatedDefender, RBRatings, RecRatings, Roster, RosterEntry } from './types';
import { clampN } from './util';

export interface FieldFit {
  /** Intercept plus weights on new attribute keys. */
  b0: number;
  w: Record<string, number>;
  /** Legacy clamp range for the field. */
  lo: number;
  hi: number;
  /** Fit quality over the pool (for the report). */
  r2?: number;
}

export interface AdapterFile {
  version: 1;
  QB: Record<'arm' | 'acc' | 'care' | 'explos' | 'legs', FieldFit>;
  RB: Record<'power' | 'vol' | 'recv' | 'score', FieldFit>;
  WR: Record<'sep' | 'big' | 'hands' | 'score', FieldFit>;
  TE: Record<'sep' | 'big' | 'hands' | 'score' | 'block', FieldFit>;
  OL: Record<'pass' | 'run', FieldFit>;
  DEF: Record<'rush' | 'cover' | 'runD' | 'tackle', FieldFit>;
}

/** Which new attributes feed which legacy field (the fit chooses the weights). */
export const ADAPTER_INPUTS = {
  QB: { arm: ['throwPower', 'deepAcc'], acc: ['shortAcc', 'midAcc', 'decision'], care: ['decision'], explos: ['deepAcc', 'throwPower'], legs: ['scramble', 'speed'] },
  RB: { power: ['trucking', 'breakTackle', 'vision'], vol: ['vision', 'breakTackle', 'stamina'], recv: ['catching', 'routeRunning'], score: ['trucking', 'vision'] },
  WR: { sep: ['shortRoute', 'deepRoute', 'speed'], big: ['deepRoute', 'speed', 'rac'], hands: ['catching', 'catchInTraffic'], score: ['catchInTraffic', 'spectacular'] },
  TE: { sep: ['shortRoute', 'deepRoute', 'speed'], big: ['deepRoute', 'speed', 'rac'], hands: ['catching', 'catchInTraffic'], score: ['catchInTraffic', 'spectacular'], block: ['runBlock', 'passBlock'] },
  OL: { pass: ['pbPower', 'pbFinesse', 'anchor'], run: ['rbPower', 'rbFinesse', 'pullMove'] },
  DEF: { rush: ['powerMoves', 'finesseMoves'], cover: ['manCov', 'zoneCov', 'ballSkills'], runD: ['tackle', 'blockShed', 'playRec'], tackle: ['tackle', 'pursuit'] },
} as const;

/**
 * New attributes for a roster entry or Beast (callers resolve their ids; for
 * the OL unit, return the mean of its five linemen, see unitAttrs).
 */
export type AttrLookup = (e: { readonly n: string; readonly p: string; readonly t: string; readonly d: string }) => Record<string, number> | undefined;

export function applyFit(f: FieldFit, attrs: Record<string, number>): number {
  let v = f.b0;
  for (const [k, w] of Object.entries(f.w)) v += w * (attrs[k] ?? 0);
  return clampN(v, f.lo, f.hi);
}

function fields<K extends string>(fits: Record<K, FieldFit>, attrs: Record<string, number>): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const k of Object.keys(fits) as K[]) out[k] = applyFit(fits[k], attrs);
  return out;
}

const ident = (e: RosterEntry) => ({ name: e.n, team: e.t, dec: e.d, imp: e.imp });

/** OL unit attributes: the mean of its five linemen (ids `${unitId}#LT` …). */
export function unitAttrs(unitId: string, byId: (id: string) => Record<string, number> | undefined): Record<string, number> | undefined {
  const five = ['LT', 'LG', 'C', 'RG', 'RT'].map((s) => byId(`${unitId}#${s}`)).filter((x): x is Record<string, number> => !!x);
  if (!five.length) return undefined;
  const out: Record<string, number> = {};
  for (const k of Object.keys(five[0]!)) out[k] = five.reduce((a, x) => a + (x[k] ?? 0), 0) / five.length;
  return out;
}

/** Legacy OffenseRatings for a roster, from new attributes. */
export function adaptOffense(roster: Roster, attrsOf: AttrLookup, fit: AdapterFile): OffenseRatings {
  const need = (e: RosterEntry, a: Record<string, number> | undefined) => {
    if (!a) throw new Error(`adapter: no ratings for ${e.n} (${e.p} ${e.t} ${e.d})`);
    return a;
  };
  const qb = roster.QB;
  const QB: QBRatings = { ...ident(qb), ...fields(fit.QB, need(qb, attrsOf(qb))) };
  const mkRB = (e: RosterEntry | null | undefined): RBRatings | null => (e ? { ...ident(e), ...fields(fit.RB, need(e, attrsOf(e))) } : null);
  const mkRec = (e: RosterEntry | null | undefined, isTE: boolean): RecRatings | null => {
    if (!e) return null;
    const a = need(e, attrsOf(e));
    if (isTE) return { ...ident(e), isTE, ...fields(fit.TE, a) };
    return { ...ident(e), isTE, ...fields(fit.WR, a), block: 45 };
  };
  // Legacy re-ranks receivers by ability (same weights as legacy recQuality).
  const recQuality = (r: RecRatings | null) => (r ? r.big * 0.3 + r.sep * 0.26 + r.hands * 0.14 + r.score * 0.12 + r.imp * 0.18 : -1);
  const wrs = [mkRec(roster.WR1, false), mkRec(roster.WR2, false), mkRec(roster.WR3, false)].filter((r): r is RecRatings => !!r).sort((a, b) => recQuality(b) - recQuality(a));
  const tes = [mkRec(roster.TE, true), mkRec(roster.TE2, true)].filter((r): r is RecRatings => !!r).sort((a, b) => recQuality(b) - recQuality(a));
  const ol = roster.OL;
  const OL: OLRatings = { ...ident(ol), ...fields(fit.OL, need(ol, attrsOf(ol))) };
  return { QB, RB1: mkRB(roster.RB), RB2: mkRB(roster.RB2), WR1: wrs[0] ?? null, WR2: wrs[1] ?? null, WR3: wrs[2] ?? null, TE: tes[0] ?? null, TE2: tes[1] ?? null, OL };
}

/** Legacy defender ratings for the Beasts, from new attributes. */
export function adaptDefenders<B extends BeastLike>(beasts: readonly B[], attrsOf: AttrLookup, fit: AdapterFile): RatedDefender<B>[] {
  return beasts.map((b) => {
    const a = attrsOf(b);
    if (!a) throw new Error(`adapter: no ratings for ${b.n} (${b.p} ${b.t} ${b.d})`);
    return { ...b, ...fields(fit.DEF, a) };
  });
}
