// Beasts assembly and rating, ported line-for-line from
// legacy/beat-the-beasts.jsx: assembleBeastsOnce 4483–4515, rateBeasts
// 4520–4562, assembleBeasts 4567–4576, assembleBeastsSeeded 4616–4648.
// Legacy assembleBeastsOnce/assembleBeasts drew from Math.random; the port
// takes the rng as a parameter (same draws, same order).

import { DEFENSE } from '@data/legacy/defense';
import type { DefensePosition } from '@data/legacy/types';
import type { Rng } from '../rng';
import type { Beast, BeastLike, BeastSlot, BeastsRating, IndexedDefender } from './types';
import { clampN, DEF_ERA } from './util';

type ByPos = Record<DefensePosition, IndexedDefender[]>;

/** `DEFENSE` grouped by position, each entry `{ ...p, idx }` (legacy order). */
export function defenseByPos(): ByPos {
  const byPos: ByPos = { DE: [], DT: [], LB: [], CB: [], S: [] };
  DEFENSE.forEach((p, idx) => { if (byPos[p.p]) byPos[p.p].push({ ...p, idx }); });
  return byPos;
}

/**
 * Legacy weighted pick: probability ∝ max(1, imp − 70)^3 + 1, no duplicate
 * names (the `used` set is shared across picks and updated on success).
 */
export function makePickWeighted(rng: Rng, used: Set<string>): (pool: readonly IndexedDefender[]) => IndexedDefender | null {
  return (pool) => {
    const avail = pool.filter(p => !used.has(p.n));
    if (avail.length === 0) return null;
    const weights = avail.map(p => Math.pow(Math.max(1, p.imp - 70), 3) + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = rng() * total;
    for (let i = 0; i < avail.length; i++) {
      r -= weights[i]!;
      if (r <= 0) { used.add(avail[i]!.n); return avail[i]!; }
    }
    used.add(avail[avail.length - 1]!.n);
    return avail[avail.length - 1]!;
  };
}

/** Legacy `take` fallback: DE↔DT, CB→S, anything else → CB. */
export const fallbackPos = (pos: DefensePosition): DefensePosition =>
  pos === 'DE' ? 'DT' : pos === 'DT' ? 'DE' : pos === 'CB' ? 'S' : 'CB';

/**
 * One 11-man lineup: 2 DE, 2 DT, 3 LB, 2 CB, 2 S in the legacy order
 * DE DT DT DE / LB LB LB / CB S S CB.
 */
export const assembleBeastsOnce = (rng: Rng): Beast[] => {
  const byPos = defenseByPos();
  const used = new Set<string>();
  const pickWeighted = makePickWeighted(rng, used);

  const beasts: Beast[] = [];
  const take = (pos: DefensePosition, slot: BeastSlot) => { const p = pickWeighted(byPos[pos]) || pickWeighted(byPos[fallbackPos(pos)]); if (p) beasts.push({ ...p, slot, role: p.p }); };

  take('DE', 'DL'); take('DT', 'DL'); take('DT', 'DL'); take('DE', 'DL'); // line order: DE DT DT DE
  take('LB', 'LB'); take('LB', 'LB'); take('LB', 'LB');                    // 3 linebackers
  take('CB', 'DB'); take('S', 'DB'); take('S', 'DB'); take('CB', 'DB');    // 2 CB, 2 S

  return beasts;
};

/** Rate the assembled defense into per-game allowed points and a 40–99 rating. */
export const rateBeasts = (beasts: readonly BeastLike[]): BeastsRating => {
  let rushIdx = 0, covIdx = 0, impSum = 0, n = 0;
  let _totSacks = 0, _totINT = 0, _totFF = 0; // accumulated but never read in legacy

  beasts.forEach(p => {
    const b = DEF_ERA[p.d] || DEF_ERA['2010s']!;
    const sk = p.s.sk || 0;
    const intc = p.s.int || 0;
    const ff = p.s.ff || 0;
    const skRate = sk / (b.sk * 8);    // ~8 prime seasons baseline
    const intRate = intc / (b.int * 8);
    rushIdx += (p.slot === 'DL' || p.p === 'LB') ? (0.5 + 0.5 * Math.min(2.5, skRate)) : 0.15;
    covIdx  += (p.slot === 'DB' || p.p === 'LB') ? (0.5 + 0.5 * Math.min(2.5, intRate)) : 0.1;
    impSum += p.imp;
    n++;
    _totSacks += sk; _totINT += intc; _totFF += ff;
  });

  const avgImp = impSum / Math.max(1, n);                 // ~78 avg .. 99 elite
  const rush = rushIdx / Math.max(1, n);                  // pass-rush index
  const cov  = covIdx / Math.max(1, n);                   // coverage index

  const rating = clampN(Math.round(avgImp + (rush - 0.85) * 10 + (cov - 0.75) * 7), 40, 99);

  const basePA = clampN(25 - (rating - 55) * (14 / 40), 9.5, 28);

  return {
    rating,
    basePA,
    rushIndex: rush,
    covIndex: cov,
    avgImp,
    sackPressure: clampN(0.6 + (rush - 0.7) * 1.4, 0.55, 1.85), // multiplier on offense sacks-allowed
    takeawayRate: clampN(0.05 + (cov - 0.6) * 0.12, 0.04, 0.22), // chance to force a turnover-ish drag
  };
};

/**
 * Keep rolling real lineups until one rates 88+, up to 60 attempts; otherwise
 * the best attempt. Legacy used Math.random; pass the rng explicitly.
 */
export const assembleBeasts = (rng: Rng): Beast[] => {
  let best: Beast[] | null = null, bestRating = -1;
  for (let attempt = 0; attempt < 60; attempt++) {
    const beasts = assembleBeastsOnce(rng);
    const rating = rateBeasts(beasts).rating;
    if (rating > bestRating) { bestRating = rating; best = beasts; }
    if (rating >= 88) return beasts;
  }
  return best as Beast[]; // safeguard: return the strongest lineup found
};

/** Seeded Beasts assembly (legacy assembleBeastsSeeded): identical draws to assembleBeasts. */
export function assembleBeastsSeeded(rng: Rng): Beast[] {
  let best: Beast[] | null = null, bestRating = -1;
  for (let attempt = 0; attempt < 60; attempt++) {
    const beasts = assembleBeastsOnce(rng);
    const rating = rateBeasts(beasts).rating;
    if (rating > bestRating) { bestRating = rating; best = beasts; }
    if (rating >= 88) return beasts;
  }
  return best as Beast[];
}
