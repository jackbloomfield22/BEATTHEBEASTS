// Rosters for the sim from the ratings snapshot (data/ratings/ratings.v1.json).
// Pure: the caller loads the snapshot and passes it in.

import type { SnapshotEntry } from '@/engine/ratings/snapshot';
import type { DefSlot, OffSlot, SimPlayer } from './types';

export interface SnapshotLike {
  entries: SnapshotEntry[];
  units: { id: string; linemen: string[] }[];
}

export function simPlayer(e: SnapshotEntry, num: number): SimPlayer {
  return {
    id: e.id,
    name: e.name,
    pos: e.pos,
    num,
    attrs: e.attrs,
    heightIn: e.heightIn,
    weightLb: e.weightLb,
    weightEq: e.weightEq,
    traits: e.traits.map((t) => t.id),
  };
}

/** The highest-rated stint of a player at a position (by name), or undefined. */
export function findStint(snap: SnapshotLike, name: string, pos?: string): SnapshotEntry | undefined {
  return snap.entries.filter((e) => e.name === name && (!pos || e.pos === pos)).sort((a, b) => b.ovr - a.ovr)[0];
}

const OL_SLOTS = ['LT', 'LG', 'C', 'RG', 'RT'] as const;

/**
 * The Practice Field's default matchup: a classic 1980s offense against a
 * Beasts-style all-time defense (the same players as the lineup check).
 */
export function practiceRosters(snap: SnapshotLike): { offense: Record<OffSlot, SimPlayer>; defense: Record<DefSlot, SimPlayer> } {
  const need = (name: string, pos: string, num: number): SimPlayer => {
    const e = findStint(snap, name, pos);
    if (!e) throw new Error(`practice roster: ${name} (${pos}) not in the snapshot`);
    return simPlayer(e, num);
  };
  const unit = snap.units.find((u) => u.id.includes(':SF:1980s')) ?? snap.units[0]!;
  const ol = unit.linemen.map((id) => snap.entries.find((e) => e.id === id)!);
  const nums = [71, 68, 56, 51, 77];
  const offense = {
    QB: need('Joe Montana', 'QB', 16),
    RB: need('Roger Craig', 'RB', 33),
    X: need('Jerry Rice', 'WR', 80),
    Z: need('Dwight Clark', 'WR', 87),
    SLOT: need('John Taylor', 'WR', 82),
    TE: need('Brent Jones', 'TE', 84),
  } as Record<OffSlot, SimPlayer>;
  OL_SLOTS.forEach((k, j) => (offense[k] = simPlayer(ol[j]!, nums[j]!)));
  const defense: Record<DefSlot, SimPlayer> = {
    LE: need('Reggie White', 'DE', 92),
    RE: need('Bruce Smith', 'DE', 78),
    LDT: need('Joe Greene', 'DT', 75),
    RDT: need('Aaron Donald', 'DT', 99),
    WLB: need('Lawrence Taylor', 'LB', 56),
    MLB: need('Mike Singletary', 'LB', 50),
    SLB: need('Ray Lewis', 'LB', 52),
    LCB: need('Deion Sanders', 'CB', 21),
    RCB: need('Darrelle Revis', 'CB', 24),
    FS: need('Ed Reed', 'S', 20),
    SS: need('Ronnie Lott', 'S', 42),
  };
  return { offense, defense };
}
