import { PHYSICAL_KEYS, SKILL_ATTRS } from './attributes';
import { SIGNALS } from './signals';
import type { RatedPos } from './types';

// Position OVR weights (BRIEF "Overall rating and traits": "a weighted blend
// of the attributes that matter for the position, weights documented in one
// file"). Each row sums to 1. The blend is then standardized within the
// position pool and mapped through the same z→rating curve as every other
// skill, so OVR 90+ means All-Pro level at that position in every decade.
//
// Starting weights reflect what decides plays in the real-time sim: for a QB,
// accuracy and decisions over arm strength; for a corner, man coverage first.
// They are review items, not fitted values.

/** The weights as set (before the WR/TE physicals cap below). */
export const OVR_WEIGHTS_SET: Record<RatedPos, Readonly<Record<string, number>>> = {
  QB: { shortAcc: 0.14, midAcc: 0.14, deepAcc: 0.12, decision: 0.14, throwPower: 0.08, awareness: 0.1, pocketPresence: 0.08, underPressure: 0.08, release: 0.05, throwOnRun: 0.04, scramble: 0.03 },
  RB: { vision: 0.14, breakTackle: 0.12, elusiveness: 0.12, speed: 0.12, acceleration: 0.08, ballSecurity: 0.08, trucking: 0.07, catching: 0.08, stiffArm: 0.04, routeRunning: 0.05, passBlock: 0.04, awareness: 0.06 },
  WR: { shortRoute: 0.14, deepRoute: 0.12, catching: 0.16, speed: 0.12, catchInTraffic: 0.09, beatPress: 0.07, rac: 0.07, spectacular: 0.06, acceleration: 0.06, awareness: 0.05, ballSecurity: 0.03, runBlock: 0.03 },
  TE: { catching: 0.15, shortRoute: 0.12, runBlock: 0.14, passBlock: 0.07, catchInTraffic: 0.1, deepRoute: 0.06, speed: 0.08, impactBlock: 0.06, beatPress: 0.04, rac: 0.06, spectacular: 0.03, awareness: 0.06, ballSecurity: 0.03 },
  OL: { pbPower: 0.18, pbFinesse: 0.18, rbPower: 0.16, rbFinesse: 0.12, anchor: 0.12, pullMove: 0.06, awareness: 0.1, strength: 0.08 },
  DE: { finesseMoves: 0.2, powerMoves: 0.18, blockShed: 0.14, pursuit: 0.1, tackle: 0.1, playRec: 0.08, speed: 0.08, acceleration: 0.06, awareness: 0.06 },
  DT: { powerMoves: 0.2, blockShed: 0.2, finesseMoves: 0.12, tackle: 0.12, playRec: 0.08, strength: 0.1, pursuit: 0.06, awareness: 0.06, acceleration: 0.06 },
  LB: { tackle: 0.16, pursuit: 0.14, playRec: 0.14, blockShed: 0.1, zoneCov: 0.1, hitPower: 0.07, speed: 0.08, manCov: 0.05, finesseMoves: 0.06, awareness: 0.06, powerMoves: 0.04 },
  CB: { manCov: 0.2, zoneCov: 0.16, press: 0.12, ballSkills: 0.12, speed: 0.12, acceleration: 0.06, agility: 0.06, playRec: 0.06, tackle: 0.05, awareness: 0.05 },
  S: { zoneCov: 0.18, ballSkills: 0.12, tackle: 0.12, playRec: 0.12, manCov: 0.1, hitPower: 0.08, pursuit: 0.08, speed: 0.08, awareness: 0.06, press: 0.06 },
};

// ---------------------------------------------------------------------------
// WR/TE physicals cap (ratings follow-up, user-approved).
//
// The review found WR OVR resting about a quarter on raw physical ability:
// Speed 0.12 and Acceleration 0.06 directly, plus Run After Catch, whose
// formula is half agility and speed. A 4.65 hand-timed receiver (Jerry Rice)
// lost 3–4 OVR to 4.3–4.4 receivers for the 40 alone, and at TE the fastest,
// biggest bodies rose over the best receivers and blockers.
//
// "Physical" is a raw physical attribute (PHYSICAL_KEYS: speed, acceleration,
// agility, strength, stamina, jumping). An OVR term carries it in two ways:
//   - the term is a physical attribute (WR: Speed, Acceleration; TE: Speed);
//   - the term is a skill whose formula reads a physical attribute (a
//     `physical`-kind signal: p_speed, p_agility, p_strength, p_jump), in
//     proportion to that signal's weight in the formula (WR/TE Run After
//     Catch 0.5, Spectacular Catch 0.2, Release 0.2; WR Run Block 0.25; TE Run
//     Block 0.15, Pass Block 0.1, Impact Block 0.3).
// Body size (height, weight) is not a physical attribute here: it is listed,
// not tested, and the brief makes it the frame for contact and catch radius.
//
// The cap: that physical exposure is at most PHYSICAL_OVR_CAP of WR and TE
// OVR. Above it, the physical part of every term is scaled down by the same
// factor (a physical attribute entirely, a skill only in its physical share,
// so Run After Catch gives up more weight than Release) and the weight
// removed goes to the pure skill terms (no physical signal), in proportion
// to their weights. The physical attributes themselves don't
// change, only their weight in OVR.

/** Share of WR and TE OVR that raw physical attributes may carry (user-approved cap, ratings follow-up). */
export const PHYSICAL_OVR_CAP = 0.08;
export const PHYSICAL_CAPPED_POS: readonly RatedPos[] = ['WR', 'TE'];

const PHYS_ATTR = new Set<string>(PHYSICAL_KEYS);

/** Physical share of an OVR term: 1 for a physical attribute, else the weight share of physical signals in the skill's formula. */
export function physicalShare(pos: RatedPos, key: string): number {
  if (PHYS_ATTR.has(key)) return 1;
  const def = SKILL_ATTRS[pos].find((d) => d.key === key);
  if (!def) return 0;
  const total = def.terms.reduce((a, t) => a + t.w, 0);
  const phys = def.terms.filter((t) => (typeof t.s === 'string' ? [t.s] : t.s).some((s) => SIGNALS[s]?.kind === 'physical')).reduce((a, t) => a + t.w, 0);
  return phys / total;
}

/** Physical exposure of a set of OVR weights: Σ weight × physical share. */
export function physicalExposure(pos: RatedPos, w: Readonly<Record<string, number>>): number {
  return Object.entries(w).reduce((a, [k, wt]) => a + wt * physicalShare(pos, k), 0);
}

function capPhysicals(pos: RatedPos, w: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  if (physicalExposure(pos, w) <= PHYSICAL_OVR_CAP) return w;
  // A term keeps its skill part and `keep` of its physical part:
  // w' = w · (1 − φ · (1 − keep)). A skill term's exposure is w' · φ (its
  // formula doesn't change), so `keep` is found by bisection (exposure is
  // monotone in it); 60 halvings reach double precision.
  const scaled = (keep: number) => Object.fromEntries(Object.entries(w).map(([k, wt]) => [k, wt * (1 - physicalShare(pos, k) * (1 - keep))]));
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (physicalExposure(pos, scaled(mid)) > PHYSICAL_OVR_CAP) hi = mid;
    else lo = mid;
  }
  const out = scaled(lo);
  const removed = 1 - Object.values(out).reduce((a, b) => a + b, 0);
  // The removed weight goes to the pure skill terms, so exposure stays at the cap.
  const pure = Object.keys(w).filter((k) => physicalShare(pos, k) === 0);
  const pureW = pure.reduce((a, k) => a + w[k]!, 0);
  for (const k of pure) out[k] = out[k]! + (removed * w[k]!) / pureW;
  return out;
}

/** OVR weights the engine uses: as set, with the WR/TE physicals cap applied. */
export const OVR_WEIGHTS: Record<RatedPos, Readonly<Record<string, number>>> = Object.fromEntries(
  Object.entries(OVR_WEIGHTS_SET).map(([pos, w]) => [pos, PHYSICAL_CAPPED_POS.includes(pos as RatedPos) ? capPhysicals(pos as RatedPos, w) : w]),
) as Record<RatedPos, Readonly<Record<string, number>>>;

/** The 4–6 attributes the draft card shows per position (BRIEF "Draft screen display"). */
export const CARD_ATTRS: Record<RatedPos, readonly string[]> = {
  QB: ['shortAcc', 'deepAcc', 'throwPower', 'decision', 'pocketPresence', 'scramble'],
  RB: ['speed', 'vision', 'elusiveness', 'trucking', 'catching', 'ballSecurity'],
  WR: ['speed', 'shortRoute', 'deepRoute', 'catching', 'catchInTraffic', 'rac'],
  TE: ['catching', 'shortRoute', 'catchInTraffic', 'runBlock', 'passBlock', 'speed'],
  OL: ['pbPower', 'pbFinesse', 'rbPower', 'anchor', 'awareness'],
  DE: ['finesseMoves', 'powerMoves', 'blockShed', 'speed', 'tackle'],
  DT: ['powerMoves', 'blockShed', 'finesseMoves', 'strength', 'tackle'],
  LB: ['tackle', 'pursuit', 'playRec', 'zoneCov', 'blockShed', 'speed'],
  CB: ['manCov', 'zoneCov', 'press', 'ballSkills', 'speed'],
  S: ['zoneCov', 'ballSkills', 'tackle', 'hitPower', 'speed'],
};
