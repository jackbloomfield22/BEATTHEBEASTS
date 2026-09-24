// Seeded randomness for the sim: named sub-streams of the play seed
// (engine/rng deriveStream, TECH_PLAN §4.3) and a Gaussian built on
// detmath so it is bit-identical in every browser (engine/rng gaussNoise
// keeps legacy's Math.log/cos for the legacy port only).

import { deriveStream, type Rng } from '@/engine/rng';
import { cos, log } from '@/engine/math/detmath';

export type { Rng };

export interface Streams {
  /** Throw placement error. */
  throw: Rng;
  /** Catch, drop, deflection and interception rolls. */
  catch: Rng;
  /** Block engagements (move choice, leverage noise). */
  block: Rng;
  /** Tackles, broken tackles, fumbles. */
  contact: Rng;
  /** AI decisions (reads, reaction jitter). */
  ai: Rng;
  /** Loose-ball bounces. */
  bounce: Rng;
}

export function streams(seed: number): Streams {
  return {
    throw: deriveStream(seed, 'throw'),
    catch: deriveStream(seed, 'catch'),
    block: deriveStream(seed, 'block'),
    contact: deriveStream(seed, 'contact'),
    ai: deriveStream(seed, 'ai'),
    bounce: deriveStream(seed, 'bounce'),
  };
}

/** Standard normal (Box–Muller) from a seeded stream, deterministic math. */
export function gauss(r: Rng): number {
  let u = 0;
  while (u === 0) u = r();
  const v = r();
  return Math.sqrt(-2 * log(u)) * cos(6.283185307179586 * v);
}

/** Bernoulli trial. */
export const chance = (r: Rng, p: number): boolean => r() < p;
