// Draft helpers, ported line-for-line from legacy/beat-the-beasts.jsx:
// getInitials 4068–4071, getOpenPositions 4074–4082, getAvailablePicks
// 4087–4106, lastNameOf 4109–4115, getValidPairs 4119–4141,
// targetSlotFor 4144–4149.

import { POSITIONS } from '@data/legacy/constants';
import { PLAYERS } from '@data/legacy/players';
import { OL_UNITS } from '@data/legacy/units';
import type { DraftPosition, OLUnit, Player, Slot } from '@data/legacy/types';
import type { PartialRoster, RosterEntry } from './types';

export const getInitials = (name: string): string => {
  const parts = name.split(' ');
  return (parts[0]![0]! + (parts[parts.length - 1]![0] || '')).toUpperCase();
};

/** Open base positions ('QB','RB','WR','TE','OL') in the current roster. */
export const getOpenPositions = (roster: PartialRoster): DraftPosition[] => {
  const open: DraftPosition[] = [];
  if (!roster.QB) open.push('QB');
  if (!roster.RB || !roster.RB2) open.push('RB');
  if (!roster.WR1 || !roster.WR2 || !roster.WR3) open.push('WR');
  if (!roster.TE || !roster.TE2) open.push('TE');
  if (!roster.OL) open.push('OL');
  return open;
};

export type PlayerPick = Player & { readonly idx: number };
export type UnitPick = OLUnit & { readonly _key: string };

export interface AvailablePicks {
  QB?: PlayerPick[];
  RB?: PlayerPick[];
  WR?: PlayerPick[];
  TE?: PlayerPick[];
  OL?: UnitPick[];
}

const usedNamesOf = (roster: PartialRoster) =>
  new Set(Object.values(roster).filter((p): p is RosterEntry => Boolean(p)).map(p => p.n));

/**
 * Picks for a team+decade, grouped by position: ALL positions (filled ones
 * too), minus used PLAYERS indices and names already on the roster.
 * Players are alphabetized by name (localeCompare).
 */
export const getAvailablePicks = (team: string, decade: string, roster: PartialRoster, usedIds: ReadonlySet<number>): AvailablePicks => {
  const usedNames = usedNamesOf(roster);
  const result: AvailablePicks = {};
  POSITIONS.forEach(pos => {
    if (pos === 'OL') {
      const units = OL_UNITS.filter(u => u.p === pos && u.t === team && u.d === decade);
      if (units.length > 0) result[pos] = units.map((u, i) => ({ ...u, _key: `unit-${pos}-${i}` }));
    } else {
      const list = PLAYERS
        .map((pl, idx) => ({ ...pl, idx }))
        .filter(pl => pl.p === pos && pl.t === team && pl.d === decade && !usedIds.has(pl.idx) && !usedNames.has(pl.n));
      if (list.length > 0) {
        // Alphabetize by first name (with full-name tiebreak)
        list.sort((a, b) => a.n.localeCompare(b.n));
        result[pos] = list;
      }
    }
  });
  return result;
};

/** Last name for field labels (skips Jr./Sr./II/III/IV). */
export const lastNameOf = (name: string): string => {
  const parts = name.split(' ');
  const suffixes = ['Jr.', 'Sr.', 'II', 'III', 'IV'];
  let last = parts[parts.length - 1]!;
  if (suffixes.includes(last) && parts.length >= 2) last = parts[parts.length - 2]!;
  return last;
};

export interface Pair {
  t: string;
  d: string;
}

/**
 * All (team, decade) pairs where at least one OPEN position has an unused
 * pick whose name isn't already on the roster (legacy order).
 */
export const getValidPairs = (roster: PartialRoster, usedIds: ReadonlySet<number>): Pair[] => {
  const open: string[] = getOpenPositions(roster);
  const usedNames = usedNamesOf(roster);
  const seen = new Set<string>();
  const pairs: Pair[] = [];

  const allEntries = [
    ...PLAYERS.map((pl, idx) => ({ p: pl.p as string, t: pl.t, d: pl.d, n: pl.n, isUnit: false, idx })),
    ...OL_UNITS.filter(u => u.p === 'OL').map(u => ({ p: u.p as string, t: u.t, d: u.d, n: u.n, isUnit: true, idx: undefined as number | undefined })),
  ];

  allEntries.forEach(e => {
    if (!open.includes(e.p)) return;
    if (!e.isUnit && usedIds.has(e.idx as number)) return;
    if (!e.isUnit && usedNames.has(e.n)) return;
    const key = `${e.t}|${e.d}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ t: e.t, d: e.d });
  });

  return pairs;
};

/** Which roster slot a picked player/unit goes to. */
export const targetSlotFor = (position: string, roster: PartialRoster): Slot => {
  if (position === 'RB') return roster.RB ? 'RB2' : 'RB';
  if (position === 'WR') return roster.WR1 ? (roster.WR2 ? 'WR3' : 'WR2') : 'WR1';
  if (position === 'TE') return roster.TE ? 'TE2' : 'TE';
  return position as Slot;
};
