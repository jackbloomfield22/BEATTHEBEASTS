// Ratings → physical and skill parameters (GDD §9, TECH_PLAN §10). Every map
// is monotonic in its rating. Where a number comes from the rating scale
// itself (engine/ratings/physical.ts), the inverse is used so the sim runs
// the same 40 the rating was built from.

import { exp } from '@/engine/math/detmath';
import type { SimPlayer } from './types';

const LB_TO_KG = 0.45359237;

/** 40-yard time for a speed rating (inverse of physical.ts fortyToSpeed: 4.30 s = 99, +0.1 s = −4.5). */
export const speedToForty = (speed: number): number => 4.3 + (99 - speed) / 45;
/** 10-yard split for an acceleration rating (inverse of splitToAccel: 1.45 s = 99, +0.1 s = −9). */
export const accelToSplit = (acc: number): number => 1.45 + (99 - acc) / 90;

/**
 * Distance covered from a standing start after t seconds for a runner whose
 * speed approaches vmax exponentially with time constant tau
 * (dv/dt = (vmax − v)/tau, the standard sprint model: Furusawa, Hill & Parkinson 1927).
 */
export function sprintDistance(vmax: number, tau: number, t: number): number {
  return vmax * (t - tau * (1 - exp(-t / tau)));
}

/** Time to cover d yards in that model (bisection; deterministic). */
export function sprintTime(vmax: number, tau: number, d: number): number {
  let lo = 0;
  let hi = 20;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (sprintDistance(vmax, tau, m) < d) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
}

/**
 * Top speed (yd/s) and time constant (s) that reproduce a 40 time and a
 * 10-yard split. Alternating solve: tau from the split at the current vmax,
 * vmax from the 40 at that tau; converges in a few rounds.
 */
export function solveSprint(forty: number, split: number): { vmax: number; tau: number } {
  let vmax = 40 / (forty - 0.8);
  let tau = 0.8;
  for (let k = 0; k < 8; k++) {
    // tau: 10 yd in `split` at vmax.
    let lo = 0.2;
    let hi = 2.5;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (sprintDistance(vmax, m, split) > 10) lo = m;
      else hi = m;
    }
    tau = (lo + hi) / 2;
    // vmax: 40 yd in `forty` at tau.
    vmax = 40 / (forty - tau * (1 - exp(-forty / tau)));
  }
  return { vmax, tau };
}

export interface Effects {
  /** Top speed, yd/s. */
  vmax: number;
  /** Sprint time constant, s: acceleration along the run is (vmax − v)/tau. */
  tau: number;
  /** Braking and cutting acceleration, yd/s² (Agility; cuts cost speed, less with Agility). */
  cutAccel: number;
  /** Heading turn rate when planted, rad/s. */
  turnRate: number;
  /** Body mass for contact, kg (era-equivalent weight). */
  mass: number;
  /** Collision radius, yd. */
  radius: number;
  /** Height, yd (catch window and the ball's release height). */
  height: number;
  /** 0–1 normalized attribute, or 0.5 when the position doesn't carry it. */
  a: (key: string) => number;
  /** Raw attribute (0–99), or `fallback`. */
  r: (key: string, fallback?: number) => number;
}

export function effects(p: SimPlayer): Effects {
  const r = (k: string, fallback = 50) => p.attrs[k] ?? fallback;
  const { vmax, tau } = solveSprint(speedToForty(r('speed')), accelToSplit(r('acceleration')));
  const agility = r('agility');
  const weight = p.weightEq ?? p.weightLb;
  return {
    vmax,
    tau,
    // A planted cut: ~9 yd/s² at 60 Agility to ~15 at 99 (elite change of
    // direction decelerates at ~12–14 m/s²: Harper et al. 2019 on
    // deceleration in field sports).
    cutAccel: 9 + (agility - 60) * (6 / 39),
    turnRate: 5 + (agility - 60) * (4 / 39),
    mass: weight * LB_TO_KG,
    // Shoulder half-width ~0.23 m for 200 lb to ~0.3 m at 330 lb, plus pads.
    radius: 0.36 + (weight - 200) * 0.0008,
    height: p.heightIn / 36,
    a: (k: string) => (p.attrs[k] ?? 50) / 99,
    r,
  };
}

// ---- Passing (GDD §9.1) --------------------------------------------------

/** Release time, s: 0.45 s at 70 Release → 0.30 s at 99. */
export const releaseTime = (release: number): number => Math.max(0.26, 0.45 - (release - 70) * (0.15 / 29));

/** Maximum launch speed, yd/s: Throw Power 70 → 52 mph, 99 → 62 mph. */
export const maxThrowSpeed = (power: number): number => (52 + (power - 70) * (10 / 29)) * 0.48889;

/** Maximum range, yd: 55 at 70 Throw Power → 75 at 99. */
export const maxRange = (power: number): number => 55 + (power - 70) * (20 / 29);

/**
 * Placement error (1 σ, yd) at 20 yards for an accuracy rating: about 1 yard
 * at 70, a third of that at 99 (GDD §9.1); it scales with distance.
 */
export const errorAt20 = (acc: number): number => Math.max(0.22, 1 - (acc - 70) * ((2 / 3) / 29));
