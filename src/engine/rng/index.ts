// Seeded randomness. `makeRng`, `seedFromDate`, `gaussNoise` and
// `matchupSeed` are bit-identical ports of legacy/beat-the-beasts.jsx
// (makeRng 4585–4593, seedFromDate 4596–4603, todayKey 4606–4612,
// gaussNoise 4397–4402, matchupSeed 4965–4972). `deriveSeed`/`deriveStream`
// are new: named sub-streams for the real-time sim (TECH_PLAN §4.3).

import { SLOT_ORDER } from '@data/legacy/constants';

/** A stream of uniform doubles in [0, 1). */
export type Rng = () => number;

/** Mulberry32: same seed → same stream, identical to legacy. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit FNV-1a over UTF-16 code units (the legacy string hash). */
export function fnv1a(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Stable integer seed from a YYYY-MM-DD string (legacy seedFromDate). */
export function seedFromDate(dateStr: string): number {
  return fnv1a(dateStr);
}

export interface DateParts {
  /** Full year, e.g. 2026. */
  y: number;
  /** Month 1–12. */
  m: number;
  /** Day of month 1–31. */
  d: number;
}

/**
 * Calendar date as YYYY-MM-DD. Legacy `todayKey(d)` read the local date from a
 * Date; the engine has no wall clock, so the caller passes the parts in (the
 * app reads the player's local date, which is when the Daily flips).
 */
export function todayKey(parts: DateParts): string {
  const m = String(parts.m).padStart(2, '0');
  const day = String(parts.d).padStart(2, '0');
  return `${parts.y}-${m}-${day}`;
}

/** Approx-normal noise (Box–Muller), identical to legacy gaussNoise. */
export function gaussNoise(rand: Rng): number {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface Keyed {
  readonly n: string;
  readonly t: string;
  readonly d: string;
}

/**
 * Deterministic matchup seed: the same drafted lineup against the same Beasts
 * always plays out the same game (legacy matchupSeed).
 */
export function matchupSeed(
  roster: Readonly<Partial<Record<string, Keyed | null | undefined>>>,
  beasts: readonly Keyed[] | null | undefined,
): number {
  const rosterKey = SLOT_ORDER.map(s => { const p = roster[s]; return p ? p.n + '|' + p.t + '|' + p.d : '-'; }).join('~');
  const beastKey = (beasts || []).map(b => b.n + '|' + b.t + '|' + b.d).join('~');
  const str = rosterKey + '##' + beastKey;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * Seed of a named sub-stream: `(rootSeed ^ fnv1a(name)) >>> 0`. Adding a new
 * consumer of randomness never shifts the other streams.
 */
export function deriveSeed(rootSeed: number, name: string): number {
  return ((rootSeed >>> 0) ^ fnv1a(name)) >>> 0;
}

/** A mulberry32 stream for the named sub-stream of `rootSeed`. */
export function deriveStream(rootSeed: number, name: string): Rng {
  return makeRng(deriveSeed(rootSeed, name));
}
