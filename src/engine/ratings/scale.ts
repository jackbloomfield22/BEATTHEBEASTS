import { log } from '../math/detmath';
import type { AttributeResult, Conf, Contribution } from './types';

// The 0–99 scale (BRIEF "One scale for everyone"):
//   99 the best the position has ever produced at that skill
//   90+ All-Pro level · 80s Pro Bowl / high-end starter · 70s solid starter
//   60s role player · under 50 a liability
//
// Skill attributes come from a standardized performance score z (0 = the
// average player in the position pool, 1 = one standard deviation better).
// Before the curve, z is rescaled by the pool size so that the best score a
// pool of that size is expected to produce lands at z = 3.3 (see
// poolScale): "the best ever" means the same thing for 54 defensive tackles
// and 1,000 receivers.
//
// The curve's anchors, as shares of the pool (normal quantiles):
//   top 5%  (z 1.64) → 90   All-Pro level
//   top 25% (z 0.67) → 80   Pro Bowl / high-end starter
//   median  (z 0)    → 72   solid starter
//   bottom 20% (z −0.84) → 63, bottom 5% (z −1.64) → 54
//   expected pool best (z 3.3) → 98.3; only true outliers reach 99
// It is monotone and flattens near the top (a soft cap, TECH_PLAN §7), so
// there is no pileup at 99.

const KNOTS: [number, number][] = [
  [-4, 22],
  [-3.3, 30],
  [-2.5, 42],
  [-1.64, 54],
  [-0.84, 63],
  [0, 72],
  [0.67, 80],
  [1.2, 86],
  [1.64, 90],
  [2.2, 94],
  [2.8, 97],
  [3.3, 98.3],
  [4, 99.3],
];

export function zToRating(z: number): number {
  if (z <= KNOTS[0]![0]) return KNOTS[0]![1];
  for (let i = 1; i < KNOTS.length; i++) {
    const [z1, r1] = KNOTS[i]!;
    const [z0, r0] = KNOTS[i - 1]!;
    if (z <= z1) return r0 + ((z - z0) / (z1 - z0)) * (r1 - r0);
  }
  return 99.3;
}

/** Where the expected best of a pool lands on the z axis of the curve. */
export const POOL_BEST_Z = 3.3;
/** The rating the expected best of a pool gets on a position's own skill. */
export const POOL_BEST_RATING = 98.3;

/**
 * Inverse of the standard normal CDF (Acklam's rational approximation,
 * relative error < 1.2e-9). Pure arithmetic plus log/sqrt.
 */
export function normInv(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pl) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Factor that maps the expected best z of a pool of n players to POOL_BEST_Z. */
export function poolScale(n: number): number {
  if (n < 2) return 1;
  return POOL_BEST_Z / normInv(1 - 0.5 / n);
}

/** Shrink a signal toward the prior by sample size (games): n/(n+k). */
export const shrink = (games: number, k: number): number => (k <= 0 ? 1 : games / (games + k));

export const clamp99 = (x: number): number => Math.max(1, Math.min(99, x));

/** How much each provenance level counts toward the attribute's confidence. */
export const CONF_WEIGHT: Record<Conf, number> = {
  verified: 1,
  reference: 0.9,
  legacy: 0.55,
  estimated: 0.4,
  prior: 0,
};

export function confLabel(score: number): AttributeResult['conf'] {
  return score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low';
}

/**
 * Turn a base and a list of raw z-space terms into a rating whose
 * contributions sum exactly to the value. Terms are in z units; the curve is
 * nonlinear, so each term's share of the rating change is proportional to its
 * share of the total z.
 */
export function composeFromZ(
  base: number,
  terms: { label: string; z: number; kind: Contribution['kind']; input?: string; conf?: Conf; src?: string; weight: number }[],
  zScale = 1,
  offsets: Contribution[] = [],
  /** Multiplies the curve's move away from the base (secondary skills: (top − base) / (best − 72)). */
  spread = 1,
): AttributeResult {
  const zTotal = terms.reduce((s, t) => s + t.z, 0) * zScale;
  const curveDelta = (zToRating(zTotal) - 72) * spread;
  const offsetSum = offsets.reduce((s, o) => s + o.delta, 0);
  const raw = base + curveDelta + offsetSum;
  const value = clamp99(raw);
  const clampAdj = value - raw;
  const contributions: Contribution[] = [{ label: 'Position average', delta: base, kind: 'base' }];
  const zAbs = terms.reduce((s, t) => s + Math.abs(t.z), 0);
  for (const t of terms) {
    // Allocate the curve delta in proportion to each signed term.
    const share = Math.abs(zTotal) > 1e-9 ? (t.z * zScale) / zTotal : zAbs > 0 ? 0 : 0;
    contributions.push({ label: t.label, delta: curveDelta * share, kind: t.kind, input: t.input, conf: t.conf, src: t.src });
  }
  if (Math.abs(zTotal) <= 1e-9 && Math.abs(curveDelta) > 1e-9) contributions.push({ label: 'Scale', delta: curveDelta, kind: 'prior' });
  contributions.push(...offsets);
  if (Math.abs(clampAdj) > 1e-9) contributions.push({ label: 'Clamped to the 1–99 scale', delta: clampAdj, kind: 'prior' });
  const wTot = terms.reduce((s, t) => s + t.weight, 0) || 1;
  const confScore = terms.reduce((s, t) => s + t.weight * CONF_WEIGHT[t.conf ?? 'prior'], 0) / wTot;
  return { value, confScore, conf: confLabel(confScore), contributions };
}

/** Build a rating directly from a physical measure (absolute scale) plus adjustments. */
export function composeDirect(parts: Contribution[], confScore: number): AttributeResult {
  const raw = parts.reduce((s, p) => s + p.delta, 0);
  const value = clamp99(raw);
  const contributions = [...parts];
  if (Math.abs(value - raw) > 1e-9) contributions.push({ label: 'Clamped to the 1–99 scale', delta: value - raw, kind: 'prior' });
  return { value, confScore, conf: confLabel(confScore), contributions };
}

export function sumContributions(r: AttributeResult): number {
  return r.contributions.reduce((s, c) => s + c.delta, 0);
}
