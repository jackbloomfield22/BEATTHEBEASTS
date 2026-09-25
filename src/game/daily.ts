// The Daily Challenge on the new ratings (GDD §4, §6.1 rule 8, §15 D8).
//
// Same date, same challenge: the draft sequence is legacy buildDailySequence
// on legacy's stream (identical to legacy for every date; it doesn't read
// ratings) and the Beasts come from legacy's defense stream through the
// OVR assembly (src/game/beasts.ts). The perfect team is the legacy DP over
// the day's nine pairs, valued by OVR on the corrected pool. There is no
// forced win (legacy issue L1).
//
// diffAdj, the Daily's handicap on the Beasts' scoring, keeps legacy's role,
// shape and units (rating points off the Beasts in their scoring model):
// legacy took clamp(beastRating − (0.68·avgImp + 16.3), 0, 20) on its scale.
// Here both inputs are first put on legacy's scale: the Beasts' OVR-fed
// rating by matching the mean and spread of legacy's over the same dates
// (legacy ≈ 1.518·new − 53.01), and the perfect team's mean OVR by
// regression onto its legacy impact (avgImp ≈ 0.663·avgOVR + 26.69), which
// gives clamp(1.518·B − 87.46 − 0.451·A, 0, 20). Over 400 dates the mean
// handicap is 14.00 (legacy 14.00), sd 1.11 (legacy 1.32)
// (tools/sim/calibrate-beasts.ts).

import { SLOT_ORDER } from '@data/legacy/constants';
import type { Slot } from '@data/legacy/types';
import { buildDailySequence, posOfSlot } from '@/engine/legacy/daily';
import { makeRng, seedFromDate } from '@/engine/rng';
import { assembleRatedBeasts, type RatedBeasts } from './beasts';
import { bestFor, type Candidate, type Catalog, type Pair } from './draft';

export interface NewDaily {
  dateKey: string;
  sequence: Pair[];
  beasts: RatedBeasts;
  perfect: { slot: Slot; pair: Pair; pick: Omit<Candidate, 'slot'> | null; round: number }[];
  diffAdj: number;
}

/** diffAdj on the new scale (see the header; tools/sim/calibrate-beasts.ts). */
export const DIFF_ADJ = { beast: 1.518, avg: -0.451, c: -87.46 };

/** The best assignment of the day's pairs to the nine slots, by OVR (legacy computePerfectTeam's DP). */
export function perfectTeam(cat: Catalog, seq: readonly Pair[]): NewDaily['perfect'] {
  const N = SLOT_ORDER.length;
  const best = seq.map((pair) => SLOT_ORDER.map((slot) => bestFor(cat, pair, slot, new Set())));
  const memo = new Map<number, { score: number; picks: number[] }>();
  const solve = (round: number, mask: number): { score: number; picks: number[] } => {
    if (round === N) return { score: 0, picks: [] };
    const key = round * 1024 + mask;
    const hit = memo.get(key);
    if (hit) return hit;
    let res = { score: -Infinity, picks: [] as number[] };
    for (let j = 0; j < N; j++) {
      if (mask & (1 << j)) continue;
      const c = best[round]![j];
      const sub = solve(round + 1, mask | (1 << j));
      const total = (c ? c.ovr : -1000) + sub.score;
      if (total > res.score) res = { score: total, picks: [j, ...sub.picks] };
    }
    memo.set(key, res);
    return res;
  };
  const picks = solve(0, 0).picks;
  const out = picks.map((j, round) => ({ slot: SLOT_ORDER[j]!, pair: seq[round]!, pick: best[round]![j] ?? null, round }));
  return SLOT_ORDER.map((slot) => out.find((o) => o.slot === slot)!);
}

export function newDaily(dateKey: string, cat: Catalog): NewDaily {
  const seed = seedFromDate(dateKey);
  const sequence = buildDailySequence(makeRng(seed ^ 0x85ebca6b));
  const beasts = assembleRatedBeasts(makeRng(seed ^ 0x9e3779b9), (id) => cat.entry.get(id)?.ovr);
  const perfect = perfectTeam(cat, sequence);
  const avg = perfect.reduce((a, p) => a + (p.pick?.ovr ?? 75), 0) / perfect.length;
  const raw = DIFF_ADJ.beast * beasts.rating.rating + DIFF_ADJ.avg * avg + DIFF_ADJ.c;
  return { dateKey, sequence, beasts, perfect, diffAdj: Math.max(0, Math.min(20, raw)) };
}

/** Positions for a slot (re-exported for the results comparison). */
export const slotPos = posOfSlot;
