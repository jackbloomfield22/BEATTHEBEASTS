// The draft (GDD §6), as a pure state machine the locker room drives.
//
// The rules are the legacy ones, ported line for line in src/engine/legacy
// (getOpenPositions, getAvailablePicks, getValidPairs, targetSlotFor, the
// GameScreen spin/skip/auto-draft handlers at legacy 9053–9240, and the
// Daily's buildDailySequence/computePerfectTeam), with the GDD's changes:
//   - no duplicate PEOPLE (person ids), not names (§15 D9);
//   - the pool follows data/corrections.json (entries it excludes as
//     duplicates or wrong-team rows have no rating and aren't draftable);
//   - rolls come from a seeded stream, so a draft replays from its seed;
//   - Auto-Draft keeps the picks already made (§6.2), and isn't offered in
//     the Daily (§15 D8);
//   - a Daily round with no legal pick advances to a backup pair derived
//     from the date seed (§6.1 rule 8).
// Values are the new ratings: OVR decides the auto-draft's "best".

import { SLOT_ORDER } from '@data/legacy/constants';
import { PLAYERS } from '@data/legacy/players';
import { OL_UNITS } from '@data/legacy/units';
import idsFile from '@data/legacy/ids.json';
import type { DraftPosition, Slot } from '@data/legacy/types';
import { getOpenPositions, targetSlotFor } from '@/engine/legacy/draft';
import { getDailyChallenge, posOfSlot, type DailyChallenge } from '@/engine/legacy/daily';
import { makeRng, seedFromDate, type Rng } from '@/engine/rng';
import type { SnapshotEntry, SnapshotTrait } from '@/engine/ratings/snapshot';
import { simPlayer, type SimPlayer } from '@/sim';

export type DraftMode = 'classic' | 'film' | 'daily' | 'quick';

export interface UnitSnap {
  id: string;
  ovr: number;
  linemen: string[];
  passBlock: number;
  runBlock: number;
  traits: SnapshotTrait[];
}

/** The ratings and numbers the draft reads (built once from the shipped snapshot). */
export interface Catalog {
  entry: Map<string, SnapshotEntry>;
  unit: Map<string, UnitSnap>;
  numbers: Readonly<Record<string, number>>;
}

export function makeCatalog(snap: { entries: SnapshotEntry[]; units: UnitSnap[] }, numbers: Readonly<Record<string, number>>): Catalog {
  return { entry: new Map(snap.entries.map((e) => [e.id, e])), unit: new Map(snap.units.map((u) => [u.id, u])), numbers };
}

const IDS = idsFile as { players: string[]; defense: string[]; olUnits: string[] };

export interface Pair {
  t: string;
  d: string;
}

/** One lineman of a drafted OL unit. */
export interface Lineman {
  id: string;
  name: string;
  spot: 'LT' | 'LG' | 'C' | 'RG' | 'RT';
  num: number;
  numEstimated: boolean;
  ovr: number;
}

/** Someone the current pair offers (a player, or an OL unit). */
export interface Candidate {
  kind: 'player' | 'unit';
  /** PLAYERS or OL_UNITS index. */
  idx: number;
  /** Ratings id: a snapshot entry id (players) or unit id. */
  id: string;
  name: string;
  team: string;
  decade: string;
  pos: DraftPosition;
  ovr: number;
  /** Legacy impact (the Daily's perfect team is still judged on it). */
  imp: number;
  conf: 'h' | 'm' | 'l';
  traits: SnapshotTrait[];
  attrs: Record<string, number>;
  personIds: string[];
  /** The slot he'd fill now, or null when his position is full. */
  slot: Slot | null;
}

export interface DraftPick extends Omit<Candidate, 'slot'> {
  slot: Slot;
  round: number;
  num: number;
  numEstimated: boolean;
  linemen?: Lineman[];
}

export type Roster = Partial<Record<Slot, DraftPick>>;

export interface DraftState {
  mode: DraftMode;
  seed: number;
  rng: Rng;
  roster: Roster;
  /** The pair on the reels this round (null before the first spin). */
  pair: Pair | null;
  /** The pair each round ended on, in round order. */
  sequence: Pair[];
  teamSkipUsed: boolean;
  eraSkipUsed: boolean;
  daily: DailyChallenge | null;
}

export const ROUNDS = SLOT_ORDER.length;

export function createDraft(mode: DraftMode, seed: number, dailyKey?: string): DraftState {
  return {
    mode,
    seed,
    rng: makeRng(seed ^ 0x4d6f),
    roster: {},
    pair: null,
    sequence: [],
    teamSkipUsed: false,
    eraSkipUsed: false,
    daily: mode === 'daily' ? getDailyChallenge(dailyKey!) : null,
  };
}

export const roundOf = (s: DraftState): number => Object.keys(s.roster).length;
export const isComplete = (s: DraftState): boolean => SLOT_ORDER.every((k) => s.roster[k]);
/** Skips exist outside the Daily (§6.1 rule 4). */
export const skipsAllowed = (s: DraftState): boolean => s.mode !== 'daily';
/** Auto-Draft: Classic, Film Room and Quick Play only (§15 D8). */
export const autoAllowed = (s: DraftState): boolean => s.mode !== 'daily';

/** Legacy roster shape (the ported helpers read `n`, `d`, `p`). */
function legacyRoster(r: Roster): Partial<Record<Slot, { n: string; t: string; d: string; p: string; imp: number; s: object }>> {
  const out: Partial<Record<Slot, { n: string; t: string; d: string; p: string; imp: number; s: object }>> = {};
  for (const k of SLOT_ORDER) {
    const p = r[k];
    if (p) out[k] = { n: p.name, t: p.team, d: p.decade, p: p.pos, imp: p.imp, s: {} };
  }
  return out;
}

const usedPeople = (r: Roster): Set<string> => new Set(Object.values(r).flatMap((p) => p?.personIds ?? []));
const usedIdx = (r: Roster): Set<number> => new Set(Object.values(r).filter((p) => p?.kind === 'player').map((p) => p!.idx));

function playerCandidate(cat: Catalog, idx: number): Omit<Candidate, 'slot'> | null {
  const pl = PLAYERS[idx]!;
  const e = cat.entry.get(IDS.players[idx]!);
  if (!e) return null; // excluded by data/corrections.json
  return { kind: 'player', idx, id: e.id, name: pl.n, team: pl.t, decade: pl.d, pos: pl.p as DraftPosition, ovr: e.ovr, imp: pl.imp, conf: e.conf, traits: e.traits, attrs: e.attrs, personIds: [e.personId] };
}

function unitCandidate(cat: Catalog, idx: number): Omit<Candidate, 'slot'> | null {
  const u = OL_UNITS[idx]!;
  const snap = cat.unit.get(IDS.olUnits[idx]!);
  if (!snap) return null;
  const linemen = snap.linemen.map((id) => cat.entry.get(id)).filter((x): x is SnapshotEntry => !!x);
  const attrs: Record<string, number> = { passBlock: snap.passBlock, runBlock: snap.runBlock };
  return { kind: 'unit', idx, id: snap.id, name: u.n, team: u.t, decade: u.d, pos: 'OL', ovr: snap.ovr, imp: u.imp, conf: 'm', traits: snap.traits, attrs, personIds: linemen.map((l) => l.personId) };
}

/**
 * Everything a pair offers, grouped by position (filled positions too, as
 * legacy shows them dimmed), minus people already on the roster.
 */
export function candidates(cat: Catalog, s: DraftState, pair: Pair | null = s.pair): Partial<Record<DraftPosition, Candidate[]>> {
  if (!pair) return {};
  const people = usedPeople(s.roster);
  const used = usedIdx(s.roster);
  const legacy = legacyRoster(s.roster);
  const open = getOpenPositions(legacy);
  const out: Partial<Record<DraftPosition, Candidate[]>> = {};
  const add = (c: Omit<Candidate, 'slot'> | null) => {
    if (!c || c.personIds.some((p) => people.has(p))) return;
    const slot = open.includes(c.pos) ? targetSlotFor(c.pos, legacy) : null;
    (out[c.pos] ??= []).push({ ...c, slot });
  };
  PLAYERS.forEach((pl, idx) => {
    if (pl.t === pair.t && pl.d === pair.d && !used.has(idx)) add(playerCandidate(cat, idx));
  });
  OL_UNITS.forEach((u, idx) => {
    if (u.p === 'OL' && u.t === pair.t && u.d === pair.d) add(unitCandidate(cat, idx));
  });
  for (const k of Object.keys(out) as DraftPosition[]) out[k]!.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Whether a pair offers anyone for an open position. */
function pairIsLive(cat: Catalog, s: DraftState, pair: Pair): boolean {
  return Object.values(candidates(cat, s, pair)).some((list) => list!.some((c) => c.slot));
}

/**
 * Pairs with at least one draftable person at an open position (legacy
 * getValidPairs, with person ids and the corrected pool). Legacy order:
 * PLAYERS first, then OL units.
 */
export function validPairs(cat: Catalog, s: DraftState): Pair[] {
  const open = getOpenPositions(legacyRoster(s.roster)) as string[];
  const people = usedPeople(s.roster);
  const used = usedIdx(s.roster);
  const seen = new Set<string>();
  const pairs: Pair[] = [];
  const note = (t: string, d: string) => {
    const k = `${t}|${d}`;
    if (seen.has(k)) return;
    seen.add(k);
    pairs.push({ t, d });
  };
  PLAYERS.forEach((pl, idx) => {
    if (!open.includes(pl.p) || used.has(idx)) return;
    const c = playerCandidate(cat, idx);
    if (c && !people.has(c.personIds[0]!)) note(pl.t, pl.d);
  });
  if (open.includes('OL')) {
    OL_UNITS.forEach((u, idx) => {
      if (u.p === 'OL' && unitCandidate(cat, idx)) note(u.t, u.d);
    });
  }
  return pairs;
}

const has70s = (r: Roster) => Object.values(r).some((p) => p?.decade === '1970s');

/**
 * Spin the reels (legacy spinSlot): a full spin, or a skip that keeps the
 * team ({fixTeam}) or the decade ({fixDecade}). The Daily shows its fixed
 * pair for the round (or, if that pair offers no legal pick, a backup pair
 * from the date seed).
 */
export function spin(cat: Catalog, s: DraftState, fix: { fixTeam?: string; fixDecade?: string } = {}): Pair | null {
  const round = roundOf(s);
  if (round >= ROUNDS) return (s.pair = null);
  if (s.daily) {
    let pair = s.daily.sequence[round] ?? s.daily.sequence[s.daily.sequence.length - 1]!;
    if (!pairIsLive(cat, s, pair)) {
      const all = validPairs(cat, s).filter((p) => !(has70s(s.roster) && p.d === '1970s'));
      const r = makeRng(seedFromDate(s.daily.dateKey) ^ (0x51ed + round));
      pair = all[Math.floor(r() * all.length)] ?? pair;
    }
    return (s.pair = pair);
  }
  const allPairs = validPairs(cat, s);
  // Once a '70s player is on the roster, no more '70s rolls (legacy 9076–9078).
  const eligible = has70s(s.roster) ? allPairs.filter((p) => p.d !== '1970s') : allPairs;
  let pool = eligible;
  const cur = s.pair;
  if (fix.fixTeam) {
    pool = eligible.filter((p) => p.t === fix.fixTeam && p.d !== cur?.d);
    if (pool.length === 0) pool = eligible.filter((p) => p.t === fix.fixTeam);
  } else if (fix.fixDecade) {
    pool = eligible.filter((p) => p.d === fix.fixDecade && p.t !== cur?.t);
    if (pool.length === 0) pool = eligible.filter((p) => p.d === fix.fixDecade);
  }
  if (pool.length === 0) pool = eligible;
  if (pool.length === 0) pool = allPairs;
  return (s.pair = pool[Math.floor(s.rng() * pool.length)] ?? null);
}

/** Team Skip: keep the decade, re-roll the team (once per game). */
export function skipTeam(cat: Catalog, s: DraftState): boolean {
  if (!skipsAllowed(s) || s.teamSkipUsed || !s.pair) return false;
  s.teamSkipUsed = true;
  spin(cat, s, { fixDecade: s.pair.d });
  return true;
}

/** Era Skip: keep the team, re-roll the decade (once per game). */
export function skipEra(cat: Catalog, s: DraftState): boolean {
  if (!skipsAllowed(s) || s.eraSkipUsed || !s.pair) return false;
  s.eraSkipUsed = true;
  spin(cat, s, { fixTeam: s.pair.t });
  return true;
}

// ---- Jersey numbers ----------------------------------------------------------------

/** Where a position's numbers live when his real one is unknown or taken (NFL numbering, pre-2021 ranges). */
const RANGES: Record<string, [number, number][]> = {
  QB: [[1, 19]],
  RB: [[20, 49]],
  WR: [[80, 89], [10, 19]],
  TE: [[80, 89], [40, 49]],
  OL: [[60, 79], [50, 59]],
};

function hashOf(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * His real number when it's known and free on this roster; otherwise a free
 * number in his position's range (chosen from his id, so it's stable) and
 * marked estimated.
 */
export function assignNumber(taken: Set<number>, real: number | undefined, pos: string, id: string): { num: number; numEstimated: boolean } {
  if (real !== undefined && !taken.has(real)) return { num: real, numEstimated: false };
  const pool: number[] = [];
  for (const [a, b] of RANGES[pos] ?? [[1, 99]]) for (let n = a; n <= b; n++) if (!taken.has(n)) pool.push(n);
  const num = pool.length ? pool[hashOf(id) % pool.length]! : 99;
  return { num, numEstimated: true };
}

const takenNumbers = (r: Roster): Set<number> => new Set(Object.values(r).flatMap((p) => (p ? [p.num, ...(p.linemen ?? []).map((l) => l.num)] : [])));

const SPOTS = ['LT', 'LG', 'C', 'RG', 'RT'] as const;

/** Draft a candidate into his slot. Returns the pick, or null if his position is full. */
export function draftPick(cat: Catalog, s: DraftState, c: Candidate): DraftPick | null {
  if (!c.slot || s.roster[c.slot] || !s.pair) return null;
  const taken = takenNumbers(s.roster);
  let pick: DraftPick;
  if (c.kind === 'unit') {
    const snap = cat.unit.get(c.id)!;
    const linemen: Lineman[] = snap.linemen.map((id, i) => {
      const e = cat.entry.get(id)!;
      const n = assignNumber(taken, cat.numbers[id], 'OL', id);
      taken.add(n.num);
      return { id, name: e.name, spot: SPOTS[i]!, ovr: e.ovr, ...n };
    });
    const center = linemen[2]!;
    pick = { ...c, slot: c.slot, round: roundOf(s), num: center.num, numEstimated: center.numEstimated, linemen };
  } else {
    pick = { ...c, slot: c.slot, round: roundOf(s), ...assignNumber(taken, cat.numbers[c.id], c.pos, c.id) };
  }
  s.roster = { ...s.roster, [c.slot]: pick };
  s.sequence[pick.round] = s.pair;
  s.pair = null;
  return pick;
}

// ---- Auto-Draft ----------------------------------------------------------------------

/** The best candidate a pair offers for a slot (by OVR), skipping people already used. */
function bestFor(cat: Catalog, pair: Pair, slot: Slot, people: Set<string>): Omit<Candidate, 'slot'> | null {
  const pos = posOfSlot(slot);
  let best: Omit<Candidate, 'slot'> | null = null;
  if (pos === 'OL') {
    OL_UNITS.forEach((u, idx) => {
      if (u.p !== 'OL' || u.t !== pair.t || u.d !== pair.d) return;
      const c = unitCandidate(cat, idx);
      if (c && !c.personIds.some((p) => people.has(p)) && (!best || c.ovr > best.ovr)) best = c;
    });
  } else {
    PLAYERS.forEach((pl, idx) => {
      if (pl.p !== pos || pl.t !== pair.t || pl.d !== pair.d) return;
      const c = playerCandidate(cat, idx);
      if (c && !people.has(c.personIds[0]!) && (!best || c.ovr > best.ovr)) best = c;
    });
  }
  return best;
}

/**
 * Auto-Draft (legacy handleAutoDraft 9197–9234): roll a pair for each round
 * still to play the legacy way (a random valid pair, one '70s at most, each
 * roll tentatively filling an open slot so the next roll sees the right open
 * positions), then fill the OPEN slots with the best assignment of those
 * rounds (the legacy perfect-team DP over slots, by OVR). Picks already made
 * stay. Not in the Daily.
 */
export function autoDraft(cat: Catalog, s: DraftState): DraftPick[] {
  if (!autoAllowed(s)) return [];
  const open = SLOT_ORDER.filter((k) => !s.roster[k]);
  if (!open.length) return [];
  // The current round's pair counts as the first roll.
  const seq: Pair[] = [];
  const work: DraftState = { ...s, roster: { ...s.roster } };
  for (let i = 0; i < open.length; i++) {
    let pair = i === 0 && s.pair ? s.pair : null;
    if (!pair) {
      const pairs = validPairs(cat, work);
      const had70 = has70s(work.roster) || seq.some((p) => p.d === '1970s');
      const elig = had70 ? pairs.filter((p) => p.d !== '1970s') : pairs;
      const from = elig.length ? elig : pairs;
      if (!from.length) break;
      pair = from[Math.floor(s.rng() * from.length)]!;
    }
    seq.push(pair);
    const openPos = getOpenPositions(legacyRoster(work.roster)) as string[];
    const slotName = SLOT_ORDER.find((k) => !work.roster[k] && openPos.includes(posOfSlot(k)));
    if (slotName) work.roster[slotName] = { kind: 'player', idx: -1, id: '_', name: '_', team: pair.t, decade: pair.d, pos: posOfSlot(slotName) as DraftPosition, ovr: 0, imp: 0, conf: 'l', traits: [], attrs: {}, personIds: [], slot: slotName, round: -1, num: 0, numEstimated: true };
  }
  // DP over (round, set of open slots filled), maximizing total OVR.
  const people = usedPeople(s.roster);
  const N = seq.length;
  const M = open.length;
  const best = seq.map((pair) => open.map((slot) => bestFor(cat, pair, slot, people)));
  const memo = new Map<number, { score: number; picks: number[] }>();
  const solve = (round: number, mask: number): { score: number; picks: number[] } => {
    if (round === N) return { score: 0, picks: [] };
    const key = round * 1024 + mask;
    const hit = memo.get(key);
    if (hit) return hit;
    let res = { score: -Infinity, picks: [] as number[] };
    for (let j = 0; j < M; j++) {
      if (mask & (1 << j)) continue;
      const c = best[round]![j];
      const sub = solve(round + 1, mask | (1 << j));
      const total = (c ? c.ovr : -1000) + sub.score;
      if (total > res.score) res = { score: total, picks: [j, ...sub.picks] };
    }
    memo.set(key, res);
    return res;
  };
  const plan = solve(0, 0).picks;
  const made: DraftPick[] = [];
  plan.forEach((j, round) => {
    const slot = open[j]!;
    s.pair = seq[round]!;
    // Re-read the pool at pick time so a person can't land twice.
    const pool = candidates(cat, s)[posOfSlot(slot) as DraftPosition] ?? [];
    const pick = pool.filter((c) => c.slot).sort((a, b) => b.ovr - a.ovr)[0];
    if (pick) {
      const p = draftPick(cat, s, { ...pick, slot });
      if (p) made.push(p);
    }
  });
  s.pair = null;
  // Anything the rolls couldn't fill (vanishingly rare): the best remaining person anywhere at that position.
  for (const slot of SLOT_ORDER) {
    if (s.roster[slot]) continue;
    for (const pair of validPairs(cat, s)) {
      s.pair = pair;
      const pick = (candidates(cat, s)[posOfSlot(slot) as DraftPosition] ?? []).filter((c) => c.slot === slot).sort((a, b) => b.ovr - a.ovr)[0];
      if (pick && draftPick(cat, s, pick)) break;
    }
    s.pair = null;
  }
  return made;
}

// ---- Into the game -------------------------------------------------------------------

/** The drafted team for the sim (the ContendersRoster shape: 8 skill players and the five linemen). */
export interface DraftedTeam {
  QB: SimPlayer;
  RB: SimPlayer;
  RB2: SimPlayer;
  WR1: SimPlayer;
  WR2: SimPlayer;
  WR3: SimPlayer;
  TE: SimPlayer;
  TE2: SimPlayer;
  OL: [SimPlayer, SimPlayer, SimPlayer, SimPlayer, SimPlayer];
}

export function draftedTeam(cat: Catalog, r: Roster): DraftedTeam {
  const one = (k: Exclude<Slot, 'OL'>) => {
    const p = r[k]!;
    return simPlayer(cat.entry.get(p.id)!, p.num);
  };
  const ol = r.OL!;
  return {
    QB: one('QB'),
    RB: one('RB'),
    RB2: one('RB2'),
    WR1: one('WR1'),
    WR2: one('WR2'),
    WR3: one('WR3'),
    TE: one('TE'),
    TE2: one('TE2'),
    OL: ol.linemen!.map((l) => simPlayer(cat.entry.get(l.id)!, l.num)) as DraftedTeam['OL'],
  };
}
