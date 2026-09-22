// Beasts assembly with a sub package (GDD §5.1, §15 D7).
//
// The base 11 is exactly legacy assembleBeastsSeeded(rng). Then, from the SAME
// rng, a sub package of +1 CB and +1 S is drawn with the legacy weighting
// (max(1, imp − 70)^3 + 1), excluding every name already in the base 11, and
// with the legacy position fallback (CB → S, S → CB) if a pool runs dry.
// Because the subs are drawn only after the base 11 is final, the base 11 is
// identical to legacy for any seed.

import { assembleBeastsSeeded, defenseByPos, fallbackPos, makePickWeighted } from './legacy/beasts';
import type { Beast } from './legacy/types';
import type { DefensePosition } from '@data/legacy/types';
import type { Rng } from './rng';

export interface BeastsWithSubs {
  /** The legacy 11: DE DT DT DE / LB LB LB / CB S S CB. */
  beasts: Beast[];
  /** Nickel/dime package: [CB, S] (slot 'DB'). */
  subs: Beast[];
}

export function assembleBeastsWithSubs(rng: Rng): BeastsWithSubs {
  const beasts = assembleBeastsSeeded(rng);
  const byPos = defenseByPos();
  const used = new Set(beasts.map(b => b.n));
  const pickWeighted = makePickWeighted(rng, used);
  const subs: Beast[] = [];
  const take = (pos: DefensePosition) => {
    const p = pickWeighted(byPos[pos]) || pickWeighted(byPos[fallbackPos(pos)]);
    if (p) subs.push({ ...p, slot: 'DB', role: p.p });
  };
  take('CB');
  take('S');
  return { beasts, subs };
}
