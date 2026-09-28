// The depth chart (Playtest 2, M6.6): the best player at each position
// starts, whatever order he was drafted in. The draft fills slots in pick
// order (the first back you take goes into the RB stall, the second into
// RB2), and the locker room keeps that order: it's where each man signed.
// The game plays the depth chart: within each position the slots are
// re-assigned by OVR, so RB is the better back, WR1 the best receiver, TE
// the better tight end. Ties keep draft order. Pure.

import type { Slot } from '@data/legacy/types';
import type { DraftPick, Roster } from './draft';

/** Slots that share a position, in depth order (starter first). QB and OL are one slot each. */
export const DEPTH_GROUPS: readonly (readonly Slot[])[] = [['RB', 'RB2'], ['WR1', 'WR2', 'WR3'], ['TE', 'TE2']];

/** What each depth slot means to a fan (the depth chart's labels). */
export const DEPTH_LABEL: Record<Slot, string> = { QB: 'QB', RB: 'RB1', RB2: 'RB2', WR1: 'WR1', WR2: 'WR2', WR3: 'WR3', TE: 'TE1', TE2: 'TE2', OL: 'OL' };

/**
 * The roster as the depth chart plays it: each position group sorted by OVR
 * (best first, ties in draft order) into its slots, the pick's `slot` field
 * rewritten to the slot he now holds. Empty slots stay at the end of their
 * group. Slots outside a group (QB, OL) are unchanged.
 */
export function depthChart(r: Roster): Roster {
  const out: Roster = { ...r };
  for (const group of DEPTH_GROUPS) {
    const men = group
      .map((k, i) => ({ p: r[k], i }))
      .filter((x): x is { p: DraftPick; i: number } => !!x.p)
      .sort((a, b) => b.p.ovr - a.p.ovr || a.i - b.i);
    group.forEach((k, j) => {
      const m = men[j];
      if (m) out[k] = { ...m.p, slot: k };
      else delete out[k];
    });
  }
  return out;
}

/** Whether the depth chart moved anyone off the slot he was drafted into. */
export function depthDiffers(r: Roster): boolean {
  const d = depthChart(r);
  return DEPTH_GROUPS.some((g) => g.some((k) => r[k]?.id !== d[k]?.id));
}
