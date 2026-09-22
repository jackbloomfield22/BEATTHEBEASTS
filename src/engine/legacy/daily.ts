// Daily Challenge, ported line-for-line from legacy/beat-the-beasts.jsx:
// buildDailySequence 4654–4677, computePerfectTeam 4690–4741,
// computeTopLineups 4747–4799, getDailyChallenge 4802–4820, and the
// forced-win lineup check from GameScreen.handleRunSim 9152–9162.

import { SLOT_ORDER } from '@data/legacy/constants';
import { PLAYERS } from '@data/legacy/players';
import { OL_UNITS } from '@data/legacy/units';
import type { OLUnit, Player, Slot } from '@data/legacy/types';
import { makeRng, seedFromDate } from '../rng';
import type { Rng } from '../rng';
import { assembleBeastsSeeded, rateBeasts } from './beasts';
import type { Beast, PartialRoster, RosterEntry } from './types';

export interface TeamDecade {
  t: string;
  d: string;
}

/** A draftable entry: an offensive player or an OL unit. */
export type DraftEntry = Player | OLUnit;

export interface PerfectPick {
  slot: Slot;
  t: string | null;
  d: string | null;
  player: DraftEntry | null;
  round: number;
}

export type Lineup = Partial<Record<Slot, string>>;

export interface DailyChallenge {
  dateKey: string;
  beasts: Beast[];
  sequence: TeamDecade[];
  perfect: PerfectPick[];
  topLineups: Lineup[];
  diffAdj: number;
}

/** Legacy `posOf` / `_posOfSlot`: roster slot → draft position. */
export const posOfSlot = (s: string): string => s === 'OL' ? 'OL' : s.startsWith('WR') ? 'WR' : s.startsWith('RB') ? 'RB' : s.startsWith('TE') ? 'TE' : s;

/**
 * The universe of team+decade pairs with draftable players, in legacy order
 * (PLAYERS first, then OL units).
 */
export function draftPairUniverse(): TeamDecade[] {
  const pairSet = new Map<string, TeamDecade>();
  const note = (t: string, d: string) => { const k = t + '|' + d; if (!pairSet.has(k)) pairSet.set(k, { t, d }); };
  PLAYERS.forEach(p => { if ((p.p as string) !== 'OL') note(p.t, p.d); });
  OL_UNITS.forEach(u => { if (u.p === 'OL') note(u.t, u.d); });
  return Array.from(pairSet.values());
}

/**
 * The daily's fixed draft sequence: one {t,d} per round, no duplicate
 * team+decade, at most one 1970s pair.
 */
export function buildDailySequence(rng: Rng): TeamDecade[] {
  const allPairs = draftPairUniverse();

  const seq: TeamDecade[] = [];
  const usedPairs = new Set<string>();
  let has70s = false;
  for (let round = 0; round < SLOT_ORDER.length; round++) {
    let pool = allPairs.filter(p => {
      if (usedPairs.has(p.t + '|' + p.d)) return false;
      if (has70s && p.d === '1970s') return false;
      return true;
    });
    if (pool.length === 0) pool = allPairs;
    const pick = pool[Math.floor(rng() * pool.length)]!;
    seq.push({ t: pick.t, d: pick.d });
    usedPairs.add(pick.t + '|' + pick.d);
    if (pick.d === '1970s') has70s = true;
  }
  return seq;
}

function poolFor(pos: string, t: string | null, d: string | null): DraftEntry[] {
  if (pos === 'OL') return OL_UNITS.filter(u => u.p === 'OL' && u.t === t && u.d === d);
  return PLAYERS.filter(p => p.p === pos && p.t === t && p.d === d);
}

/**
 * The best roster achievable across the 9 rounds: an assignment of rounds to
 * slots maximizing total impact (memoized DP over the filled-slot bitmask).
 */
export function computePerfectTeam(sequence: readonly TeamDecade[]): PerfectPick[] {
  const posOf = posOfSlot;
  const N = SLOT_ORDER.length;

  // best[round][slot] = best player (by impact) that round's pool offers for slot.
  const best: (DraftEntry | null)[][] = [];
  for (let r = 0; r < N; r++) {
    const { t, d } = sequence[r]!;
    best[r] = [];
    for (let sIdx = 0; sIdx < N; sIdx++) {
      const pos = posOf(SLOT_ORDER[sIdx]!);
      const pool = poolFor(pos, t, d);
      let top: DraftEntry | null = null;
      for (const p of pool) if (!top || p.imp > top.imp) top = p;
      best[r]![sIdx] = top; // may be null if pool has nobody for that slot's position
    }
  }

  interface Pick { round: number; sIdx: number; player: DraftEntry | null }
  interface Res { score: number; picks: Pick[] }
  const memo = new Map<number, Res>();
  const solve = (round: number, usedMask: number): Res => {
    if (round === N) return { score: 0, picks: [] };
    const key = round * 1024 + usedMask;
    if (memo.has(key)) return memo.get(key)!;
    let bestRes: Res = { score: -Infinity, picks: [] };
    for (let sIdx = 0; sIdx < N; sIdx++) {
      if (usedMask & (1 << sIdx)) continue;
      const player = best[round]![sIdx] as DraftEntry | null;
      const val = player ? player.imp : -1000; // strongly avoid empty assignments
      const sub = solve(round + 1, usedMask | (1 << sIdx));
      const total = val + sub.score;
      if (total > bestRes.score) {
        bestRes = { score: total, picks: [{ round, sIdx, player }, ...sub.picks] };
      }
    }
    memo.set(key, bestRes);
    return bestRes;
  };

  const result = solve(0, 0);
  const bySlot: Partial<Record<Slot, PerfectPick>> = {};
  result.picks.forEach(({ round, sIdx, player }) => {
    const { t, d } = sequence[round]!;
    const slot = SLOT_ORDER[sIdx]!;
    bySlot[slot] = { slot, t, d, player, round };
  });
  return SLOT_ORDER.map(slot => bySlot[slot] || { slot, t: null, d: null, player: null, round: -1 });
}

/**
 * The top-N lineups for the day (best-first single-slot downgrades from the
 * perfect team). Each lineup maps slot → player name.
 */
export function computeTopLineups(sequence: readonly TeamDecade[], topN: number): Lineup[] {
  const perfect = computePerfectTeam(sequence);

  const posOf = posOfSlot;
  const slotInfo = perfect.map(pick => {
    if (!pick.player) return { slot: pick.slot, cands: [] as DraftEntry[] };
    const pos = posOf(pick.slot);
    const pool = poolFor(pos, pick.t, pick.d).sort((a, b) => b.imp - a.imp);
    return { slot: pick.slot, cands: pool };
  });

  const baseNames: Lineup = {};
  perfect.forEach(pick => { if (pick.player) baseNames[pick.slot] = pick.player.n; });

  const start = slotInfo.map(() => 0);
  const keyOf = (idx: number[]) => idx.join(',');
  const sumOf = (idx: number[]) => idx.reduce((acc, ci, si) => acc + (slotInfo[si]!.cands[ci] ? slotInfo[si]!.cands[ci]!.imp : 0), 0);
  const visited = new Set([keyOf(start)]);
  const frontier: { idx: number[]; sum: number }[] = [{ idx: start, sum: sumOf(start) }];
  const results: Lineup[] = [];

  while (results.length < topN && frontier.length) {
    frontier.sort((a, b) => b.sum - a.sum);
    const cur = frontier.shift()!;
    const lineup: Lineup = {};
    let ok = true;
    cur.idx.forEach((ci, si) => {
      const c = slotInfo[si]!.cands[ci];
      if (!c) ok = false; else lineup[slotInfo[si]!.slot] = c.n;
    });
    if (ok) results.push(lineup);
    cur.idx.forEach((ci, si) => {
      if (ci + 1 < slotInfo[si]!.cands.length) {
        const nidx = cur.idx.slice();
        nidx[si] = ci + 1;
        const k = keyOf(nidx);
        if (!visited.has(k)) { visited.add(k); frontier.push({ idx: nidx, sum: sumOf(nidx) }); }
      }
    });
  }
  return results;
}

/** The full daily challenge for a YYYY-MM-DD date key. */
export function getDailyChallenge(dateKey: string): DailyChallenge {
  const seed = seedFromDate(dateKey);
  // Two independent streams so defense and sequence don't correlate.
  const beasts = assembleBeastsSeeded(makeRng(seed ^ 0x9e3779b9));
  const sequence = buildDailySequence(makeRng(seed ^ 0x85ebca6b));
  const perfect = computePerfectTeam(sequence);
  const topLineups = computeTopLineups(sequence, 10);
  // diffAdj is a handicap subtracted from the Beasts' effective rating in
  // simulateBeatdown (higher => easier), matched to the day's pool.
  const imps = perfect.map(pk => (pk && pk.player && pk.player.imp) || 75);
  const avgImp = imps.reduce((a, b) => a + b, 0) / imps.length;
  const beastRating = rateBeasts(beasts).rating;
  const diffAdj = Math.max(0, Math.min(20, beastRating - (0.68 * avgImp + 16.3)));
  return { dateKey, beasts, sequence, perfect, topLineups, diffAdj };
}

/**
 * Daily forced win: true when the drafted roster's player names, as a set,
 * equal one of the day's top lineups (legacy GameScreen.handleRunSim).
 */
export function isTopLineup(roster: PartialRoster, topLineups: readonly Lineup[] | null | undefined): boolean {
  let forceWin = false;
  if (topLineups) {
    const yourSet = new Set(Object.values(roster).filter((p): p is RosterEntry => Boolean(p)).map(p => p.n));
    forceWin = topLineups.some(lineup => {
      const want = Object.values(lineup).filter((n): n is string => Boolean(n));
      return want.length === yourSet.size && want.every(n => yourSet.has(n));
    });
  }
  return forceWin;
}
