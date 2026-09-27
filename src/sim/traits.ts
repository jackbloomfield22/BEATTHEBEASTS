// Traits in play (Playtest 2, "every player is himself"). Each trait in the
// catalog (src/engine/ratings/traits/catalog*.ts) carries an `effect` line, a
// promise of what it does on the field; the numbers below are those lines,
// cited where they're used. A combination trait (Jump Ball King, Bomb Squad)
// is both its parts plus its own line (combos.ts), so `has` answers for the
// parts too.

import { COMBOS } from '@/engine/ratings/traits/combos';
import type { SimPlayer } from './types';

const PARTS: ReadonlyMap<string, readonly string[]> = new Map(COMBOS.map((c) => [c.id, c.parts]));

// A player's held traits with combinations expanded (built once per player).
const HELD = new WeakMap<SimPlayer, ReadonlySet<string>>();

function held(p: SimPlayer): ReadonlySet<string> {
  let h = HELD.get(p);
  if (!h) {
    const s = new Set<string>();
    for (const t of p.traits ?? []) {
      s.add(t);
      for (const q of PARTS.get(t) ?? []) s.add(q);
    }
    h = s;
    HELD.set(p, h);
  }
  return h;
}

/** Does he hold this trait (directly or as part of a combination)? */
export function has(a: { p: SimPlayer }, id: string): boolean {
  return held(a.p).has(id);
}

/** 1 + `by` when he holds the trait, else 1: the catalog's "x% more often" as a factor. */
export function more(a: { p: SimPlayer }, id: string, by: number): number {
  return has(a, id) ? 1 + by : 1;
}
