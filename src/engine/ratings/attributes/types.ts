// Declarative attribute definitions. Each skill attribute is one formula:
//
//   rating = base + curve( Σ wᵢ · zᵢ / sd )
//
// where zᵢ is the standardized, era-adjusted, sample-shrunk signal i (see
// ../signals.ts), wᵢ its weight (weights sum to 1), sd the pool spread of the
// weighted sum (so every attribute uses the whole 0–99 scale the same way) and
// `curve` the monotone z→rating curve in ../scale.ts. `base` is the position
// average for that skill: 72 for a position's own skills, lower for skills the
// position only uses occasionally (an RB's catching is compared on the same
// gameplay scale as a WR's, so the average RB starts below the average WR).
//
// A term may list alternative signals: the first one the player has is used
// (e.g. catch % where targets exist, else receptions per game). Missing
// signals contribute 0, which regresses the player toward the position average
// and lowers the attribute's confidence.
//
// The legacy reputation score `imp` is capped at 20% of any attribute's weight
// (BRIEF "Stats first, reputation second"); tests/ratings-engine.test.ts
// enforces it for every definition.

import type { RatedPos } from '../types';

export interface TermDef {
  /** Signal key, or alternatives in order of preference. */
  s: string | readonly string[];
  w: number;
}

export interface SkillAttrDef {
  key: string;
  label: string;
  /** Position average on the shared scale. */
  base: number;
  /**
   * Where the best player the position has produced lands, for skills the
   * position only uses occasionally (e.g. the best pass-rushing linebacker
   * rates with elite ends while the average linebacker sits at 60). Omitted
   * for a position's own skills (base 72, best ≈ 98).
   */
  top?: number;
  terms: readonly TermDef[];
  /** One line on what drives it and what it does in play (explorer tooltip). */
  note: string;
}

export type PositionAttrs = Partial<Record<RatedPos, readonly SkillAttrDef[]>>;

export const IMP_MAX_SHARE = 0.2;

/**
 * Hand-set legacy grades that may amplify the evidence but never make an
 * attribute: each is at most this share of any attribute, as a weight in the
 * definition (tests/ratings-engine.test.ts) and per player (engine.ts caps
 * the term at a quarter of the same-direction evidence from the other,
 * uncapped terms, so ≤ 20% of the total).
 *   imp      legacy reputation score (BRIEF "Stats first, reputation second":
 *            "worth no more than 20%").
 *   w_block  legacy TE block grade `b` (ratings follow-up, user-approved:
 *            "cap it at 20% of each TE blocking attribute, same rule as imp").
 *            It was 40% of TE Run Block, 35% of Pass Block and 25% of Impact
 *            Block, uncapped.
 */
export const CAPPED_SIGNALS: Readonly<Record<string, number>> = { imp: IMP_MAX_SHARE, w_block: 0.2 };

/**
 * Caps the weight of one term at `share` of the formula and moves the excess
 * to the other terms in proportion to their weights, except the capped
 * signals (reputation never gains weight). Keeps the formula summing to 1.
 */
export function capTermWeight(terms: readonly TermDef[], key: string, share: number): TermDef[] {
  const keys = (t: TermDef) => (typeof t.s === 'string' ? [t.s] : t.s);
  const total = terms.reduce((a, t) => a + t.w, 0);
  const cur = terms.filter((t) => keys(t).includes(key)).reduce((a, t) => a + t.w, 0);
  const excess = cur - share * total;
  if (excess <= 0) return [...terms];
  const gains = (t: TermDef) => !keys(t).some((k) => k in CAPPED_SIGNALS);
  const pool = terms.filter(gains).reduce((a, t) => a + t.w, 0);
  return terms.map((t) => (keys(t).includes(key) ? { s: t.s, w: (t.w * share * total) / cur } : gains(t) ? { s: t.s, w: t.w + (excess * t.w) / pool } : t));
}

/**
 * Missing inputs: a term with no data contributes 0 (the position average),
 * and part of its weight moves to the player's other evidence (stats, honors,
 * sourced scouting grades, unit results; never body, physical or reputation
 * terms).
 * Present weights are scaled by (total / present)^MISSING_REWEIGHT, so a
 * player with half the inputs keeps most of what those inputs say instead of
 * being dragged to the average (which would favor data-rich modern eras),
 * while still regressing somewhat. imp is never scaled up.
 */
export const MISSING_REWEIGHT = 0.6;

/** Physical attributes every player has (absolute scale, see ../physical.ts). */
export const PHYSICAL_KEYS = ['speed', 'acceleration', 'agility', 'strength', 'stamina', 'jumping'] as const;
export type PhysicalKey = (typeof PHYSICAL_KEYS)[number];

export const ATTR_LABELS: Record<string, string> = {
  speed: 'Speed',
  acceleration: 'Acceleration',
  agility: 'Agility',
  strength: 'Strength',
  stamina: 'Stamina',
  jumping: 'Jumping',
};
