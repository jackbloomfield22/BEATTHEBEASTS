// What the draft shows about a candidate (M6 follow-up). The draft tests
// football knowledge, so the numbers come out: no OVR, no attribute values,
// no confidence. The pick list runs by position (QB, RB, WR, TE, OL), then
// last name; the Scouting card names a man's three best attributes (for his
// position's card attributes) and his traits with plain-language reasons.
// Film Room shows name, position, team and decade only (DraftScreen).

import { attrLabel } from '@/engine/ratings/attributes';
import { CARD_ATTRS } from '@/engine/ratings/ovrWeights';
import { plainWhy } from '@/engine/ratings/traits';
import type { RatedPos } from '@/engine/ratings/types';
import type { SnapshotTrait } from '@/engine/ratings/snapshot';
import type { Candidate } from './draft';

/** The pick list's position order (the legacy roster order, offense out from the ball). */
export const LIST_POS_ORDER = ['QB', 'RB', 'WR', 'TE', 'OL'] as const;

const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;

/** Last name for sorting: the last word, skipping a Jr./Sr./II–V suffix. */
export function lastName(name: string): string {
  const w = name.trim().split(/\s+/);
  while (w.length > 1 && SUFFIX.test(w[w.length - 1]!)) w.pop();
  return w[w.length - 1] ?? name;
}

const posRank = (p: string) => {
  const i = (LIST_POS_ORDER as readonly string[]).indexOf(p);
  return i < 0 ? LIST_POS_ORDER.length : i;
};

const cmp = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

/** Pick-list order: position (QB, RB, WR, TE, OL), then last name, then full name, then id. */
export function compareForList(a: Pick<Candidate, 'pos' | 'name' | 'id'>, b: Pick<Candidate, 'pos' | 'name' | 'id'>): number {
  return posRank(a.pos) - posRank(b.pos) || cmp(lastName(a.name), lastName(b.name)) || cmp(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** An OL unit's card attributes (the unit aggregates the snapshot carries). */
const UNIT_ATTRS: readonly { key: string; label: string }[] = [
  { key: 'passBlock', label: 'Pass Block' },
  { key: 'runBlock', label: 'Run Block' },
];

/**
 * His best attributes by name only: the `n` highest of his position's card
 * attributes (the set the Scouting card showed with bars), ties broken by the
 * card's own order. An OL unit has two (pass and run block), best first.
 */
export function highlights(c: Pick<Candidate, 'kind' | 'pos' | 'attrs'>, n = 3): string[] {
  const pos = c.pos as RatedPos;
  const keys = c.kind === 'unit' ? UNIT_ATTRS : (CARD_ATTRS[pos] ?? []).map((key) => ({ key, label: attrLabel(pos, key) }));
  return keys
    .map((k, i) => ({ ...k, i, v: c.attrs[k.key] }))
    .filter((k): k is typeof k & { v: number } => typeof k.v === 'number')
    .sort((a, b) => b.v - a.v || a.i - b.i)
    .slice(0, n)
    .map((k) => k.label);
}

/** His traits with the plain-language why line (no numbers). */
export function plainTraits(c: Pick<Candidate, 'pos' | 'traits'>): SnapshotTrait[] {
  return c.traits.map((t) => ({ ...t, why: plainWhy(c.pos as RatedPos, t) }));
}
