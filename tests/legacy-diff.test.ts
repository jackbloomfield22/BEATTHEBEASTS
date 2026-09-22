// Differential tests: the port in src/engine/legacy against the ORIGINAL
// functions loaded from legacy/beat-the-beasts.jsx (see helpers/loadLegacy.ts).
//
// Normalization: port outputs go through `stripPortIds`, which removes the
// `id` and `legacyIndex` keys from objects that carry both (port data entries
// and objects spread from them). Nothing else is normalized. Comparisons use
// an order-sensitive serialization that keeps undefined/NaN/-0
// (`orderedSerialize`), plus Vitest `toStrictEqual` on a subset.

import { beforeAll, describe, expect, it } from 'vitest';
import { OL_UNITS, PLAYERS, SLOT_ORDER } from '@data/legacy';
import type { OLUnit, Player, Slot } from '@data/legacy';
import * as port from '@/engine/legacy';
import type { Beast, Roster, RosterEntry, PartialRoster } from '@/engine/legacy';
import { gaussNoise, makeRng, matchupSeed, seedFromDate, todayKey } from '@/engine/rng';
import type { Rng } from '@/engine/rng';
import { loadLegacy, orderedSerialize, stripPortIds, withMathRandom } from './helpers/loadLegacy';
import type { LegacyModule } from './helpers/loadLegacy';

let L: LegacyModule;
beforeAll(async () => {
  L = await loadLegacy();
});

/** Asserts port output (normalized) equals legacy output exactly. */
function same(portOut: unknown, legacyOut: unknown, label: string): void {
  const a = orderedSerialize(stripPortIds(portOut));
  const b = orderedSerialize(legacyOut);
  if (a !== b) {
    // Produce a readable structural diff.
    expect(stripPortIds(portOut), label).toStrictEqual(legacyOut);
    expect(a, label).toBe(b);
  }
}

const posOfSlot = (s: string) => (s === 'OL' ? 'OL' : s.startsWith('WR') ? 'WR' : s.startsWith('RB') ? 'RB' : s.startsWith('TE') ? 'TE' : s);

const BY_POS: Record<string, Player[]> = { QB: [], RB: [], WR: [], TE: [] };
for (const p of PLAYERS) BY_POS[p.p]!.push(p);

/** The roster entry legacy builds on pick (GameScreen.handleSelectPick). */
function entryFor(pick: Player | OLUnit, position: string, slot: Slot): RosterEntry {
  return { n: pick.n, t: pick.t, d: pick.d, p: position, imp: pick.imp, slot, s: pick.s, key: (pick as Partial<OLUnit>).key };
}

/** The Auto-draft safety-net filler legacy uses for an empty slot (stats `{}`). */
function fillerFor(slot: Slot): RosterEntry {
  return { n: '—', t: 'FA', d: '2010s', p: posOfSlot(slot), imp: 50, slot, s: {} };
}

/** A valid roster: right position per slot, no duplicate names. */
function randomRoster(rng: Rng, fillerSlot: Slot | null = null): Roster {
  const used = new Set<string>();
  const r: Partial<Record<Slot, RosterEntry>> = {};
  for (const slot of SLOT_ORDER) {
    if (slot === fillerSlot) { r[slot] = fillerFor(slot); continue; }
    const pos = posOfSlot(slot);
    if (pos === 'OL') {
      r[slot] = entryFor(OL_UNITS[Math.floor(rng() * OL_UNITS.length)]!, 'OL', slot);
      continue;
    }
    const pool = BY_POS[pos]!;
    let pick: Player;
    do pick = pool[Math.floor(rng() * pool.length)]!; while (used.has(pick.n));
    used.add(pick.n);
    r[slot] = entryFor(pick, pos, slot);
  }
  return r as Roster;
}

/** 2026-01-01 … 2026-12-31. */
function dates2026(): string[] {
  const len = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const out: string[] = [];
  len.forEach((n, m) => { for (let d = 1; d <= n; d++) out.push(todayKey({ y: 2026, m: m + 1, d })); });
  return out;
}

describe('rng', () => {
  it('makeRng streams are bit-identical', () => {
    for (const seed of [0, 1, 42, 0x9e3779b9, 0xffffffff, -1, 2 ** 40 + 7, 123456789]) {
      const a = makeRng(seed), b = L.makeRng(seed);
      for (let i = 0; i < 2000; i++) expect(a()).toBe(b());
    }
  });
  it('gaussNoise, seedFromDate, todayKey match', () => {
    const a = makeRng(7), b = L.makeRng(7);
    for (let i = 0; i < 5000; i++) expect(gaussNoise(a)).toBe(L.gaussNoise(b));
    for (const d of dates2026()) expect(seedFromDate(d)).toBe(L.seedFromDate(d));
    for (const [y, m, d] of [[2026, 1, 1], [1999, 12, 31], [2030, 7, 4], [987, 2, 9]] as const) {
      const fake = { getFullYear: () => y, getMonth: () => m - 1, getDate: () => d };
      expect(todayKey({ y, m, d })).toBe(L.todayKey(fake));
    }
  });
});

describe('helpers and profiles', () => {
  it('deriveProfile matches for every PLAYERS entry', () => {
    PLAYERS.forEach((p, i) => same(port.deriveProfile(p), L.deriveProfile(L.PLAYERS[i]!), `deriveProfile ${p.id}`));
    // also a stat-less entry and an OL-shaped entry
    same(port.deriveProfile({ p: 'QB', d: '1990s' }), L.deriveProfile({ p: 'QB', d: '1990s' }), 'deriveProfile no s');
    same(port.deriveProfile({ p: 'WR', d: '1960s', s: {} }), L.deriveProfile({ p: 'WR', d: '1960s', s: {} }), 'deriveProfile 1960s');
  });

  it('small numeric helpers match', () => {
    const rng = makeRng(99);
    for (let i = 0; i < 3000; i++) {
      const x = (rng() - 0.3) * 400, a = rng() * 50, b = a + rng() * 100;
      expect(port.clampN(x, a, b)).toBe(L.clampN(x, a, b));
      expect(port.round1(x)).toBe(L.round1(x));
      expect(port.pct(x)).toBe(L.pct(x));
      expect(port.ratio(x, a - 10)).toBe(L.ratio(x, a - 10));
      const c = 0.5 + rng() * 0.5;
      expect(port.eraEquiv(x, a, b, c)).toBe(L.eraEquiv(x, a, b, c));
      expect(port.eraEquiv(x, a, b)).toBe(L.eraEquiv(x, a, b));
    }
    expect(port.eraEquiv(null, 5, 3)).toBe(L.eraEquiv(null, 5, 3));
    expect(port.eraEquiv(4, 0, 3)).toBe(L.eraEquiv(4, 0, 3));
  });

  it('names: getInitials / lastNameOf', () => {
    for (const p of PLAYERS) {
      expect(port.getInitials(p.n)).toBe(L.getInitials(p.n));
      expect(port.lastNameOf(p.n)).toBe(L.lastNameOf(p.n));
    }
  });

  it('draft helpers match on partial rosters', () => {
    const rng = makeRng(2024);
    for (let i = 0; i < 60; i++) {
      const full = randomRoster(rng);
      const roster: PartialRoster = {};
      const usedIds = new Set<number>();
      for (const slot of SLOT_ORDER) {
        if (rng() < 0.5) {
          (roster as Record<string, RosterEntry | null>)[slot] = full[slot];
          const idx = PLAYERS.findIndex((p) => p.n === full[slot].n && p.t === full[slot].t && p.d === full[slot].d);
          if (idx >= 0) usedIds.add(idx);
        } else if (rng() < 0.3) {
          (roster as Record<string, RosterEntry | null>)[slot] = null;
        }
      }
      same(port.getOpenPositions(roster), L.getOpenPositions(roster), 'getOpenPositions');
      same(port.getValidPairs(roster, usedIds), L.getValidPairs(roster, usedIds), 'getValidPairs');
      for (const pos of ['QB', 'RB', 'WR', 'TE', 'OL']) expect(port.targetSlotFor(pos, roster)).toBe(L.targetSlotFor(pos, roster));
      for (let k = 0; k < 5; k++) {
        const src = PLAYERS[Math.floor(rng() * PLAYERS.length)]!;
        same(port.getAvailablePicks(src.t, src.d, roster, usedIds), L.getAvailablePicks(src.t, src.d, roster, usedIds), 'getAvailablePicks');
      }
    }
  });
});

describe('Beasts assembly', () => {
  it('assembleBeastsSeeded / assembleBeastsOnce / rateBeasts match for 300 seeds', () => {
    for (let seed = 0; seed < 300; seed++) {
      const s = (seed * 2654435761) >>> 0;
      const pb = port.assembleBeastsSeeded(makeRng(s));
      const lb = L.assembleBeastsSeeded(L.makeRng(s));
      same(pb, lb, `assembleBeastsSeeded ${s}`);
      same(port.rateBeasts(pb), L.rateBeasts(lb), 'rateBeasts');
      same(port.assembleBeastsOnce(makeRng(s + 1)), withMathRandom(L.makeRng(s + 1), () => L.assembleBeastsOnce()), 'assembleBeastsOnce');
    }
  });

  it('assembleBeasts (legacy Math.random) matches the port with the same rng injected', () => {
    for (let seed = 0; seed < 100; seed++) {
      const portOut = port.assembleBeasts(makeRng(seed));
      const rand = makeRng(seed);
      let calls = 0;
      const legacyOut = withMathRandom(() => { calls++; return rand(); }, () => L.assembleBeasts());
      expect(calls).toBeGreaterThan(0);
      same(portOut, legacyOut, `assembleBeasts ${seed}`);
    }
  });
});

describe('Daily Challenge', () => {
  it('getDailyChallenge matches for all 365 dates of 2026', () => {
    for (const date of dates2026()) {
      same(port.getDailyChallenge(date), L.getDailyChallenge(date), `daily ${date}`);
    }
  });

  it('sequence / perfect team / top lineups match for extra seeds', () => {
    for (let s = 0; s < 150; s++) {
      const seq = port.buildDailySequence(makeRng(s * 31 + 5));
      same(seq, L.buildDailySequence(L.makeRng(s * 31 + 5)), 'buildDailySequence');
      same(port.computePerfectTeam(seq), L.computePerfectTeam(seq), 'computePerfectTeam');
      same(port.computeTopLineups(seq, 25), L.computeTopLineups(seq, 25), 'computeTopLineups');
    }
  });

  it('the daily perfect team simulates identically (forced win and diffAdj)', () => {
    let dupDays = 0;
    for (const date of dates2026()) {
      const pd = port.getDailyChallenge(date);
      const ld = L.getDailyChallenge(date);
      const roster = {} as Record<Slot, RosterEntry>;
      for (const pk of pd.perfect) {
        const pl = pk.player;
        roster[pk.slot] = pl
          ? { n: pl.n, t: pl.t || (pk.t as string), d: pl.d || (pk.d as string), p: posOfSlot(pk.slot), imp: pl.imp, slot: pk.slot, s: pl.s, key: (pl as Partial<OLUnit>).key }
          : fillerFor(pk.slot);
      }
      // Legacy quirk: the "perfect team" can name the same player twice (e.g.
      // Steve Largent SEA 1970s + SEA 1980s). Such a roster is undraftable and
      // its name set has < 9 names, so the forced win never matches it.
      const distinct = new Set(pd.perfect.map((pk) => pk.player?.n)).size === 9;
      const forceWin = port.isTopLineup(roster, pd.topLineups);
      expect(forceWin).toBe(distinct);
      if (!distinct) dupDays++;
      const ps = port.simulateBeatdown(roster as Roster, pd.beasts, forceWin, pd.diffAdj || 0);
      const ls = L.simulateBeatdown(roster as Roster, ld.beasts, forceWin, ld.diffAdj || 0);
      same(ps, ls, `daily sim ${date}`);
      if (forceWin) expect(ps.won).toBe(true);
    }
    expect(dupDays).toBe(9);
  });
});

describe('simulateBeatdown', () => {
  it('matches legacy across 5,000 seeded rosters vs seeded Beasts', () => {
    const rng = makeRng(0xbeef);
    const DIFF = [0, 0, 0, 3.7, 12.25, 20, 27, -5];
    const beastSets: { port: Beast[]; legacy: Beast[] }[] = [];
    for (let k = 0; k < 100; k++) {
      const s = (0x1234 + k * 7919) >>> 0;
      beastSets.push({ port: port.assembleBeastsSeeded(makeRng(s)), legacy: L.assembleBeastsSeeded(L.makeRng(s)) });
    }
    let strict = 0, wins = 0, nanScores = 0;
    for (let i = 0; i < 5000; i++) {
      // ~1% of rosters carry the legacy Auto-draft filler (stats `{}`) in a non-QB slot.
      const filler = i % 97 === 3 ? (SLOT_ORDER[1 + (i % 8)] as Slot) : null;
      const roster = randomRoster(rng, filler);
      const bs = beastSets[i % beastSets.length]!;
      const forceWin = i % 3 === 0;
      const diffAdj = DIFF[i % DIFF.length]!;
      const ps = port.simulateBeatdown(roster, bs.port, forceWin, diffAdj);
      const ls = L.simulateBeatdown(roster, bs.legacy, forceWin, diffAdj);
      same(ps, ls, `sim #${i}`);
      if (i < 150) { expect(stripPortIds(ps)).toStrictEqual(ls); strict++; }
      if (ps.won) wins++;
      if (Number.isNaN(ps.yourScore)) nanScores++;

      // Everything derived from a sim result.
      if (i % 5 === 0) {
        same(port.generateBeatdownAnalysis(ps, roster, bs.port), L.generateBeatdownAnalysis(ls, roster, bs.legacy), 'analysis');
        for (let e = 0; e < ps.cinematicEvents.length; e++) {
          const pe = ps.cinematicEvents[e]!, le = ls.cinematicEvents[e]!;
          expect(port.captionFor(pe)).toBe(L.captionFor(le));
          same(port.bannerFor(pe), L.bannerFor(le), 'banner');
          same(port.situFor(pe), L.situFor(le), 'situ');
        }
        expect(port.gradeQB(ps.box.pass)).toBe(L.gradeQB(ls.box.pass));
        for (let r = 0; r < ps.box.rush.length; r++) expect(port.gradeRush(ps.box.rush[r])).toBe(L.gradeRush(ls.box.rush[r]));
        for (let r = 0; r < ps.box.rec.length; r++) expect(port.gradeRec(ps.box.rec[r])).toBe(L.gradeRec(ls.box.rec[r]));
      }
    }
    expect(strict).toBe(150);
    // sanity: the sample is not degenerate
    expect(wins).toBeGreaterThan(500);
    expect(wins).toBeLessThan(4900);
    expect(nanScores).toBeLessThan(5000);
  });

  it('rating building blocks match on samples', () => {
    const rng = makeRng(77);
    for (let i = 0; i < 400; i++) {
      const roster = randomRoster(rng, i % 50 === 7 ? 'WR2' : null);
      const bs = port.assembleBeastsSeeded(makeRng(i));
      const lbs = L.assembleBeastsSeeded(L.makeRng(i));
      const po = port.rateOffense(roster);
      const lo = L.rateOffense(roster);
      same(po, lo, 'rateOffense');
      const pd = port.rateDefenders(bs);
      const ld = L.rateDefenders(lbs);
      same(pd, ld, 'rateDefenders');
      same(port.buildMatchups(po, pd), L.buildMatchups(lo, ld), 'buildMatchups');
      same(port.calculateOffensivePF(roster), L.calculateOffensivePF(roster), 'calculateOffensivePF');
      expect(matchupSeed(roster, bs)).toBe(L.matchupSeed(roster, lbs));
    }
  });

  it('grades and pure text helpers match over their input ranges', () => {
    for (let s = -5; s <= 105; s += 0.5) {
      expect(port.scoreToGrade(s)).toBe(L.scoreToGrade(s));
      expect(port.gradeColor(port.scoreToGrade(s))).toBe(L.gradeColor(L.scoreToGrade(s)));
    }
    const types = ['RUSH_TD', 'PASS_TD', 'FG', 'FG_MISS', 'INT', 'FUM', 'DOWNS', 'BEAST_TD', 'BEAST_FG', 'BEAST_SAFETY', 'PUNT', 'WEIRD', ''];
    for (const type of types) for (let drive = 0; drive <= 11; drive++) for (const q of [undefined, 1, 2, 3, 4]) {
      const e = { type, drive, q, by: drive % 2 ? 'X Y' : null, passer: 'P Q', yard: drive === 3 ? undefined : drive * 9.4, pts: drive === 5 ? 8 : 7, opening: drive % 3 === 0 };
      expect(port.captionFor(e)).toBe(L.captionFor(e));
      same(port.bannerFor(e), L.bannerFor(e), 'bannerFor');
      same(port.situFor(e), L.situFor(e), 'situFor');
    }
  });
});
