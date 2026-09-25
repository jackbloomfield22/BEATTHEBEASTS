// The Beasts on the new ratings (GDD §5.1; TECH_PLAN §17 R2/R3).
//
// Structure and randomness are legacy assembleBeasts, unchanged: the base 11
// drawn DE DT DT DE / LB LB LB / CB S S CB with probability ∝
// max(1, rating − 70)^3 + 1 and no one twice, re-rolled up to 60 times until
// the unit clears the strength bar (else the strongest roll), then the
// nickel CB and dime S from the same stream (src/engine/beasts.ts). What
// changes is the rating: OVR replaces legacy `imp` in the weights and in the
// unit rating (legacy rateBeasts, whose rush and coverage terms still read
// the real sack and interception totals), and defenders that
// data/corrections.json excludes (no rating) aren't drawn.
//
// The bar: legacy accepts 32.9% of first rolls (88+ on its scale); on OVR,
// 93+ accepts 27.6% and 92+ 55.0% (tools/sim/calibrate-beasts.ts, 20,000
// rolls), so the bar is 93: the Beasts stay as rare and as strong as legacy's.
//
// Same seed, same Beasts: the Daily keeps legacy's stream (seed ^ 0x9e3779b9)
// so a date always gets the same defense.

import { DEFENSE } from '@data/legacy/defense';
import idsFile from '@data/legacy/ids.json';
import type { DefensePosition } from '@data/legacy/types';
import { fallbackPos, makePickWeighted, rateBeasts } from '@/engine/legacy/beasts';
import type { Beast, BeastSlot, IndexedDefender } from '@/engine/legacy/types';
import type { Rng } from '@/engine/rng';

const IDS = idsFile as { defense: string[] };

/** Strength bar on the OVR-fed legacy scale (calibrated: see the header). */
export const BEASTS_BAR = 93;

export interface RatedBeast extends Beast {
  /** Ratings id (snapshot entry). */
  id: string;
  /** Legacy impact, kept for the legacy text and grades; `imp` holds OVR here. */
  legacyImp: number;
}

export interface RatedBeasts {
  beasts: RatedBeast[];
  subs: RatedBeast[];
  rating: ReturnType<typeof rateBeasts>;
}

type ByPos = Record<DefensePosition, (IndexedDefender & { id: string; legacyImp: number })[]>;

function byPos(ovrOf: (id: string) => number | undefined): ByPos {
  const out: ByPos = { DE: [], DT: [], LB: [], CB: [], S: [] };
  DEFENSE.forEach((p, idx) => {
    const id = IDS.defense[idx]!;
    const ovr = ovrOf(id);
    if (ovr === undefined) return; // excluded by data/corrections.json
    out[p.p].push({ ...p, idx, id, legacyImp: p.imp, imp: ovr });
  });
  return out;
}

function once(rng: Rng, pools: ByPos): RatedBeast[] {
  const used = new Set<string>();
  const pick = makePickWeighted(rng, used);
  const out: RatedBeast[] = [];
  const take = (pos: DefensePosition, slot: BeastSlot) => {
    const p = (pick(pools[pos]) ?? pick(pools[fallbackPos(pos)])) as (IndexedDefender & { id: string; legacyImp: number }) | null;
    if (p) out.push({ ...p, slot, role: p.p });
  };
  take('DE', 'DL'); take('DT', 'DL'); take('DT', 'DL'); take('DE', 'DL');
  take('LB', 'LB'); take('LB', 'LB'); take('LB', 'LB');
  take('CB', 'DB'); take('S', 'DB'); take('S', 'DB'); take('CB', 'DB');
  return out;
}

/** Assemble the Beasts from a seeded stream on the OVR ratings. */
export function assembleRatedBeasts(rng: Rng, ovrOf: (id: string) => number | undefined, bar = BEASTS_BAR): RatedBeasts {
  const pools = byPos(ovrOf);
  let best: RatedBeast[] | null = null;
  let bestRating = -1;
  let beasts: RatedBeast[] | null = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    const b = once(rng, pools);
    const rating = rateBeasts(b).rating;
    if (rating > bestRating) {
      bestRating = rating;
      best = b;
    }
    if (rating >= bar) {
      beasts = b;
      break;
    }
  }
  beasts ??= best!;
  // The sub package, drawn after the base 11 from the same stream (§15 D7).
  const used = new Set(beasts.map((b) => b.n));
  const pick = makePickWeighted(rng, used);
  const subs: RatedBeast[] = [];
  for (const pos of ['CB', 'S'] as DefensePosition[]) {
    const p = (pick(pools[pos]) ?? pick(pools[fallbackPos(pos)])) as (IndexedDefender & { id: string; legacyImp: number }) | null;
    if (p) subs.push({ ...p, slot: 'DB', role: p.p });
  }
  return { beasts, subs, rating: rateBeasts(beasts) };
}
