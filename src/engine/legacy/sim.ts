// The single-game sim, ported line-for-line from legacy/beat-the-beasts.jsx:
// rateOffense 4831–4902, rateDefenders 4905–4920, buildMatchups 4927–4958,
// simulateBeatdown 4974–5460 (NUM_DRIVES 4960, matchupSeed 4965–4972).
//
// Same operations in the same order, so results are bit-identical to legacy on
// the same JS engine (tests/legacy-diff.test.ts checks this). Legacy
// Math.pow/Math.log/Math.cos are kept on purpose. Where legacy indexes a box
// score map by a name it knows is present, the port uses `!` (legacy would
// throw the same TypeError if it weren't).

import { NUM_DRIVES, TEAM_NAME } from '@data/legacy/constants';
import { gaussNoise, makeRng, matchupSeed } from '../rng';
import { rateBeasts } from './beasts';
import { dominanceGrade } from './grades';
import type {
  AssumedStats,
  BeastLike,
  BeatdownResult,
  CinematicEvent,
  CoverageAssignment,
  DefBox,
  Drive,
  DriveEvent,
  Matchups,
  OffenseRatings,
  PassBox,
  RatedDefender,
  RBRatings,
  RecBox,
  RecRatings,
  Roster,
  RosterEntry,
  RushBox,
} from './types';
import { bestBy, clampN, DEF_ERA, ERA, ratio } from './util';

/** Offensive player ability ratings (0-100), era-adjusted. */
export const rateOffense = (roster: Roster): OffenseRatings => {
  const eb = (d: string) => ERA[d] || ERA['2010s']!;

  // QB: arm (yards), accuracy/decision (rating + low INT), explosiveness (TD)
  const qb = roster.QB;
  const qs = qb.s as AssumedStats;
  const qbB = eb(qb.d);
  const QB = {
    name: qb.n, team: qb.t, dec: qb.d, imp: qb.imp,
    arm: clampN(66 + (ratio(qs.y, qbB.passY) - 1) * 40 + (qb.imp - 72) * 0.8, 35, 97),
    acc: clampN(66 + (qs.r - qbB.rate) * 0.5 + (qb.imp - 72) * 0.8, 35, 97),
    care: clampN(66 + (qbB.int - qs.i) * 20 + (qb.imp - 72) * 0.5, 35, 97), // ball security
    explos: clampN(66 + (ratio(qs.t, qbB.passTD) - 1) * 38 + (qb.imp - 72) * 0.8, 35, 97),
    // Mobility from real rushing yds/game (s.ry): Lamar/Vick ~97, statues ~45.
    legs: clampN(38 + (qs.ry || 6) * 1.0 + (qb.imp - 72) * 0.25, 30, 97),
  };

  // RBs: power/elusiveness (YPC), volume (yards), receiving, scoring
  const mkRB = (rb: RosterEntry | null | undefined): RBRatings | null => {
    if (!rb) return null;
    const s = rb.s as AssumedStats;
    const b = eb(rb.d);
    return {
      name: rb.n, team: rb.t, dec: rb.d, imp: rb.imp,
      power: clampN(66 + ((s.c || 4.0) - 4.0) * 16 + (rb.imp - 72) * 0.7, 35, 97),
      vol: clampN(66 + (ratio(s.y, b.rbY) - 1) * 36 + (rb.imp - 72) * 0.8, 35, 97),
      recv: clampN(56 + (s.r || 0) * 1.3 + (rb.imp - 72) * 0.3, 25, 97),
      score: clampN(66 + (ratio(s.t, b.rbTD) - 1) * 34, 35, 97),
    };
  };
  const RB1 = mkRB(roster.RB);
  const RB2 = mkRB(roster.RB2);

  // Receivers (WR/TE): separation (catch% + yds/target), big-play (yds), hands, scoring
  const mkREC = (r: RosterEntry | null | undefined, isTE?: boolean): RecRatings | null => {
    if (!r) return null;
    const s = r.s as AssumedStats;
    const b = eb(r.d);
    const recYBase = isTE ? b.recY * 0.72 : b.recY;
    return {
      name: r.n, team: r.t, dec: r.d, imp: r.imp, isTE: !!isTE,
      sep: clampN(66 + ((s.c || 58) - 58) * 0.7 + ((s.p || 8) - 8) * 3 + (r.imp - 72) * 0.55, 35, 97),
      big: clampN(66 + (ratio(s.y, recYBase) - 1) * 36 + (r.imp - 72) * 0.8, 35, 97),
      hands: clampN(63 + ((s.c || 58) - 58) * 1.0 + (r.imp - 72) * 0.4, 30, 97),
      score: clampN(66 + (ratio(s.t, b.recTD) - 1) * 32, 35, 97),
      block: isTE ? clampN((s.b || 60), 25, 97) : 45,
    };
  };
  // Re-rank receivers by ability, NOT draft order.
  const recQuality = (r: RecRatings | null) => r ? (r.big * 0.30 + r.sep * 0.26 + r.hands * 0.14 + r.score * 0.12 + r.imp * 0.18) : -1;
  const wrs = [mkREC(roster.WR1), mkREC(roster.WR2), mkREC(roster.WR3)]
    .filter((r): r is RecRatings => Boolean(r))
    .sort((a, b) => recQuality(b) - recQuality(a));
  const tes = [mkREC(roster.TE, true), mkREC(roster.TE2, true)]
    .filter((r): r is RecRatings => Boolean(r))
    .sort((a, b) => recQuality(b) - recQuality(a));
  const WR1 = wrs[0] || null;
  const WR2 = wrs[1] || null;
  const WR3 = wrs[2] || null;
  const TE  = tes[0] || null;
  const TE2 = tes[1] || null;

  // O-line: pass protection and run blocking (0-100).
  const oS = (roster.OL.s || { ry: 130, sa: 2.2, pb: 80, pbl: 2 }) as AssumedStats;
  const OL = {
    name: roster.OL.n, team: roster.OL.t, dec: roster.OL.d, imp: roster.OL.imp,
    pass: clampN(70 + (oS.pb - 80) * 1.1 - (oS.sa - 2.2) * 7 + (oS.pbl || 0) * 2.2 + (roster.OL.imp - 72) * 0.5, 38, 96),
    run:  clampN(68 + ((oS.ry || 120) - 120) * 0.34 + (oS.pbl || 0) * 1.9 + (roster.OL.imp - 72) * 0.8, 38, 96),
  };

  return { QB, RB1, RB2, WR1, WR2, WR3, TE, TE2, OL };
};

/** Defender ability ratings (0-100), era-adjusted, by role. */
export const rateDefenders = <B extends BeastLike>(beasts: readonly B[]): RatedDefender<B>[] => {
  const eb = (d: string) => DEF_ERA[d] || DEF_ERA['2010s']!;
  return beasts.map(p => {
    const b = eb(p.d);
    const sk = p.s.sk || 0, intc = p.s.int || 0;
    // Pass rush from sacks (era-normalized, career totals → prime-rate proxy)
    const rush = clampN(60 + Math.min(2.2, sk / (b.sk * 8)) * 12 + (p.imp - 80) * 0.55, 45, 92);
    // Coverage from INT + impact (DBs/LBs)
    const cover = clampN(60 + Math.min(2.4, intc / (b.int * 8)) * 11 + (p.imp - 80) * 0.55, 45, 90);
    // Run defense from impact + role (interior DL and LBs are the run stuffers)
    const runD = clampN(62 + (p.imp - 80) * 0.75 + ((p.role === 'DT' || p.role === 'MLB') ? 7 : (p.role === 'LB') ? 5 : 0), 45, 94);
    // Tackling ability (everyone; LBs/S highest)
    const tackle = clampN(58 + (p.imp - 80) * 0.6 + ((p.role === 'LB' || p.role === 'MLB' || p.role === 'S') ? 6 : 0), 40, 90);
    return { ...p, rush, cover, runD, tackle };
  });
};

/** Coverage 1-on-1s (WR1 vs top CB, …), pass-rush and run-front strength. */
export const buildMatchups = <B extends BeastLike>(off: OffenseRatings, defenders: RatedDefender<B>[]): Matchups<B> => {
  const CBs = bestBy(defenders.filter(d => d.role === 'CB'), 'cover');
  const Ss  = bestBy(defenders.filter(d => d.role === 'S'), 'cover');
  const LBs = bestBy(defenders.filter(d => d.role === 'LB' || d.role === 'MLB'), 'cover');
  const DL  = defenders.filter(d => d.role === 'DE' || d.role === 'DT');

  const cov: CoverageAssignment<B>[] = [];
  const assignCov = (rec: RecRatings | null, defender: RatedDefender<B> | undefined, slot: string) => { if (rec && defender) cov.push({ rec, defender, slot }); };
  // Outside WRs vs corners
  assignCov(off.WR1, CBs[0], 'WR1');
  assignCov(off.WR2, CBs[1] || CBs[0], 'WR2');
  // Slot WR vs a safety (nickel) or best LB
  assignCov(off.WR3, Ss[0] || LBs[0], 'WR3');
  // TEs vs safety / linebacker
  assignCov(off.TE, Ss[1] || LBs[0], 'TE');
  assignCov(off.TE2, LBs[1] || LBs[0], 'TE2');

  // Pass rush vs pass pro: average DL rush + best edge, vs OL pass
  const rushAvg = DL.reduce((s, d) => s + d.rush, 0) / Math.max(1, DL.length);
  const topRush = Math.max(...DL.map(d => d.rush), 0);
  const passRush = 0.72 * rushAvg + 0.28 * topRush;

  // Run front vs run blocking: anchored by the interior + best run stuffer.
  const front = [...DL, ...LBs];
  const runAvg = front.reduce((s, d) => s + d.runD, 0) / Math.max(1, front.length);
  const topRunD = Math.max(...front.map(d => d.runD), 0);
  const runFront = 0.62 * runAvg + 0.38 * topRunD;

  return { cov, passRush, runFront, defenders, CBs, Ss, LBs, DL };
};

export { matchupSeed };

/** A pass target: a receiver or the RB1 on a checkdown (which has no sep/big). */
interface PassTarget {
  name: string;
  team: string;
  dec: string;
  imp: number;
  sep?: number;
  big?: number;
}

interface PlayResult<B extends BeastLike> {
  yards: number;
  td?: boolean;
  rb?: RBRatings;
  turnover?: boolean;
  fumble?: boolean;
  forcedBy?: RatedDefender<B>;
  scramble?: boolean;
  sack?: boolean;
  int?: boolean;
  pick?: RatedDefender<B>;
  incomplete?: boolean;
  rec?: PassTarget;
  complete?: boolean;
}

interface Receiver<B extends BeastLike> {
  p: RecRatings;
  m: CoverageAssignment<B> | undefined;
  slotBase: number;
  talent: number;
  _talentW: number;
  base: number;
}

interface DriveOut {
  pts: number;
  end?: string;
  yard?: number;
  event?: DriveEvent;
}

/**
 * Deterministic single game: 10 offensive drives against the Beasts, a
 * Beasts score model, the cinematic timeline and box score. `forceWin` is the
 * Daily top-lineup guarantee; `diffAdj` (Daily) weakens the Beasts' effective
 * rating by 0–20.
 */
export const simulateBeatdown = <B extends BeastLike>(roster: Roster, beasts: readonly B[], forceWin = false, diffAdj = 0): BeatdownResult<B> => {
  const rng = makeRng(matchupSeed(roster, beasts));
  const off = rateOffense(roster);
  const defenders = rateDefenders(beasts);
  const M = buildMatchups(off, defenders);
  const era = ERA[off.QB.dec] || ERA['2010s']!;
  const defR = rateBeasts(beasts);
  // Defense tax: how much an elite unit suppresses yards on every play.
  const effRating = defR.rating - clampN(diffAdj, 0, 20);
  const defTax = clampN((effRating - 71) * 0.15, 0, 4.2);

  // ---- box score accumulators ----
  const box = {
    pass: { name: off.QB.name, team: off.QB.team, dec: off.QB.dec, cmp: 0, att: 0, yds: 0, td: 0, int: 0 } as PassBox,
    qbRush: { att: 0, yds: 0 },
    rush: {} as Record<string, RushBox>, // by player name
    rec: {} as Record<string, RecBox>,  // by player name
    def: {} as Record<string, DefBox>,  // by player name: { tk, sk, int }
  };
  const initRush = (p: RBRatings | null) => { if (p && !box.rush[p.name]) box.rush[p.name] = { name: p.name, team: p.team, dec: p.dec, car: 0, yds: 0, td: 0, long: 0 }; };
  const initRec = (p: RecRatings | null) => { if (p && !box.rec[p.name]) box.rec[p.name] = { name: p.name, team: p.team, dec: p.dec, tgt: 0, rec: 0, yds: 0, td: 0, long: 0 }; };
  initRush(off.RB1); initRush(off.RB2);
  [off.WR1, off.WR2, off.WR3, off.TE, off.TE2].forEach(initRec);
  defenders.forEach(d => { box.def[d.n] = { name: d.n, role: d.role, team: d.t, dec: d.d, tk: 0, sk: 0, int: 0 }; });

  // Receiver target shares: slot baseline blended with talent.
  const rawReceivers = ([
    { p: off.WR1, m: M.cov.find(c => c.slot === 'WR1'), slotBase: 0.24 },
    { p: off.WR2, m: M.cov.find(c => c.slot === 'WR2'), slotBase: 0.19 },
    { p: off.WR3, m: M.cov.find(c => c.slot === 'WR3'), slotBase: 0.13 },
    { p: off.TE,  m: M.cov.find(c => c.slot === 'TE'),  slotBase: 0.16 },
    { p: off.TE2, m: M.cov.find(c => c.slot === 'TE2'), slotBase: 0.07 },
  ].filter(r => r.p) as unknown) as Receiver<B>[];
  // Talent score per receiver (their ceiling as a pass-catcher).
  rawReceivers.forEach(r => { r.talent = (r.p.big * 0.55 + r.p.sep * 0.45); });
  const avgTalent = rawReceivers.reduce((s, r) => s + r.talent, 0) / rawReceivers.length;
  rawReceivers.forEach(r => {
    const talentW = Math.pow(Math.max(0.2, r.talent - (avgTalent - 18)), 1.7);
    r._talentW = talentW;
  });
  const totalTalentW = rawReceivers.reduce((s, r) => s + r._talentW, 0);
  rawReceivers.forEach(r => {
    const talentShare = r._talentW / totalTalentW;
    r.base = 0.40 * r.slotBase + 0.60 * talentShare * 0.78; // 0.78 leaves room for RB checkdowns
  });
  const receivers = rawReceivers;
  // RBs also catch passes
  const rbRecvShare = 0.10;

  // ---- helpers for a single play ----
  const tackler = (): RatedDefender<B> => {
    // Weighted by tackle rating — front-seven & safeties make most tackles.
    const pool = defenders;
    const weights = pool.map(d => d.tackle + (d.role === 'LB' || d.role === 'MLB' ? 25 : d.role === 'S' ? 12 : d.role === 'DT' ? 8 : 5));
    const tot = weights.reduce((a, b) => a + b, 0);
    let r = rng() * tot;
    for (let i = 0; i < pool.length; i++) { r -= weights[i]!; if (r <= 0) return pool[i]!; }
    return pool[pool.length - 1]!;
  };

  const runPlay = (): PlayResult<B> => {
    // Pick ball carrier: RB1 mostly, RB2 change of pace
    const useRB2 = off.RB2 && rng() < 0.32;
    const rb = useRB2 ? off.RB2 : (off.RB1 || off.RB2);
    if (!rb) return { yards: 2, td: false };
    initRush(rb);
    // Run blocking battle: OL run + RB power vs run front
    const edge = (off.OL.run * 0.55 + rb.power * 0.45) - M.runFront;
    let yds;
    // Stuff chance: elite run fronts blow up runs for little/no gain (TFLs).
    const stuffP = clampN(0.16 - edge * 0.006 + defTax * 0.03, 0.06, 0.34);
    if (rng() < stuffP) {
      yds = Math.round(-1 + gaussNoise(rng) * 1.4); // stopped at or behind the line
    } else {
      yds = 3.9 + edge * 0.06 - defTax * 0.42 + gaussNoise(rng) * 2.3;
      if (rng() < 0.012 + Math.max(0, rb.power - 72) * 0.0016) yds += 9 + rng() * 19; // breakaway (rating-driven)
    }
    yds = Math.max(-6, Math.round(yds));
    const t = tackler();
    box.def[t.n]!.tk += 1;
    box.rush[rb.name]!.car += 1;
    box.rush[rb.name]!.yds += yds;
    box.rush[rb.name]!.long = Math.max(box.rush[rb.name]!.long, yds);
    // Fumble chance — the defender who made the tackle gets credit.
    const fumbleP = clampN(0.012 + defTax * 0.004, 0.008, 0.03);
    if (rng() < fumbleP) {
      box.def[t.n]!.ff = (box.def[t.n]!.ff || 0) + 1;
      return { yards: yds, rb, turnover: true, fumble: true, forcedBy: t };
    }
    return { yards: yds, rb };
  };

  const passPlay = (toGo = 10): PlayResult<B> => {
    // QB scramble — frequency and yardage scale with the legs rating.
    if (rng() < 0.035 + Math.max(0, off.QB.legs - 55) * 0.0022) {
      let yds = 3.5 + (off.QB.legs - 50) * 0.10 + gaussNoise(rng) * 2.2;
      if (rng() < 0.008 + Math.max(0, off.QB.legs - 75) * 0.0015) yds += 8 + rng() * 14; // breaks contain
      yds = Math.max(-2, Math.round(yds));
      box.qbRush.att += 1; box.qbRush.yds += yds;
      const t = tackler(); if (t) box.def[t.n]!.tk += 1;
      return { yards: yds, scramble: true };
    }
    box.pass.att += 1;
    // Protection battle: OL pass vs pass rush.
    const protect = off.OL.pass - M.passRush + gaussNoise(rng) * 10;
    const sacked = protect < -28 || (rng() < clampN(0.05 - protect * 0.004, 0.015, 0.22));
    if (sacked) {
      // Credit a sack to a pass rusher (weighted by rush rating)
      const rushers = M.DL.length ? M.DL : defenders;
      const w = rushers.map(d => Math.pow(d.rush, 2));
      const tot = w.reduce((a, b) => a + b, 0);
      let r = rng() * tot, who = rushers[0]!;
      for (let i = 0; i < rushers.length; i++) { r -= w[i]!; if (r <= 0) { who = rushers[i]!; break; } }
      box.def[who.n]!.sk += 1;
      box.def[who.n]!.tk += 1;
      return { yards: -7, sack: true };
    }
    // Pressure (no sack) still degrades the throw
    const pressured = protect < -16;

    // Choose target by share, modulated by how each receiver beats his man
    const weighted = receivers.map(r => {
      const sep = r.p.sep;
      const cov = r.m ? r.m.defender.cover : 55;
      const winEdge = (sep - cov);
      return { ...r, w: Math.max(0.02, r.base * (1 + winEdge * 0.012)) };
    });
    // Occasionally RB checkdown
    const rbCheck = off.RB1 && rng() < rbRecvShare;
    let target: { p: PassTarget; m: CoverageAssignment<B> | null | undefined };
    if (rbCheck) {
      target = { p: off.RB1!, m: null };
    } else {
      const tot = weighted.reduce((a, b) => a + b.w, 0);
      let r = rng() * tot; target = weighted[0]!;
      for (const wj of weighted) { r -= wj.w; if (r <= 0) { target = wj; break; } }
    }

    const rec = target.p;
    if (!box.rec[rec.name]) box.rec[rec.name] = { name: rec.name, team: rec.team, dec: rec.dec, tgt: 0, rec: 0, yds: 0, td: 0, long: 0 };
    box.rec[rec.name]!.tgt += 1;

    const cover = target.m ? target.m.defender : null;
    const covRating = cover ? cover.cover : 52;
    // Completion probability — anchored near the ~64% league average.
    const sepEdge = (rec.sep || 55) - covRating;
    let compP = 0.73 + (off.QB.acc - 65) * 0.0045 + sepEdge * 0.0030 - defTax * 0.009;
    if (pressured) compP -= 0.15;
    if (toGo >= 8) compP -= 0.05;   // 3rd-and-long is harder through the air
    compP = clampN(compP, 0.42, 0.82);

    // Interception chance: QB care + coverage winning its matchup + pressure.
    let intP = 0.017 + Math.max(0, covRating - (rec.sep || 55)) * 0.0007 + (72 - off.QB.care) * 0.0010;
    if (pressured) intP += 0.012;
    intP = clampN(intP, 0.004, 0.060);

    const roll = rng();
    if (roll < intP) {
      box.pass.int += 1;
      let pick: RatedDefender<B> | null | undefined = cover;
      if (!pick) { const dbs = bestBy(defenders.filter(d => d.role === 'CB' || d.role === 'S'), 'cover'); pick = dbs[0]; }
      if (pick) { box.def[pick.n]!.int += 1; }
      return { yards: 0, turnover: true, int: true, pick: pick as RatedDefender<B> };
    }
    if (roll < intP + (1 - compP)) {
      return { yards: 0, incomplete: true };
    }

    // Completion — yards from receiver big-play vs coverage + QB arm.
    box.pass.cmp += 1;
    box.rec[rec.name]!.rec += 1;
    let yds = 6.55 + ((rec.big || 55) - covRating) * 0.13 + (off.QB.arm - 65) * 0.042 - defTax * 0.56 + gaussNoise(rng) * 3.2;
    if (rng() < 0.020 + Math.max(0, (rec.big || 55) - 76) * 0.0034) yds += 11 + rng() * 23; // explosive (rating-driven)
    yds = Math.max(0, Math.round(yds));
    box.pass.yds += yds;
    box.rec[rec.name]!.yds += yds;
    box.rec[rec.name]!.long = Math.max(box.rec[rec.name]!.long, yds);
    const t = tackler();
    box.def[t.n]!.tk += 1;
    return { yards: yds, rec, complete: true };
  };

  // ---- simulate one drive, returns points + how it ended ----
  const simDrive = (isOffense: boolean): DriveOut => {
    if (!isOffense) return { pts: 0 };
    let yard = 25;          // own 25
    let down = 1, toGo = 10;
    let plays = 0;
    while (plays < 20) {
      plays++;
      // Play call: realistic run/pass balance. Era nudges the baseline.
      let passRate = 0.45 + (era.passY - 200) * 0.0008;
      if (down >= 3 && toGo >= 6) passRate += 0.30;       // obvious passing down
      else if (down >= 3 && toGo <= 2) passRate -= 0.18;  // short yardage: run
      else if (toGo >= 8) passRate += 0.05;
      else if (toGo <= 3) passRate -= 0.08;
      passRate = clampN(passRate, 0.30, 0.84);
      const isPass = rng() < passRate;
      const res = isPass ? passPlay(toGo) : runPlay();

      if (res.turnover) return { pts: 0, end: res.int ? 'INT' : 'FUM', yard,
        event: res.int
          ? { type: 'INT', by: (res.pick && res.pick.n) || null, off: off.QB && off.QB.name, team: off.QB && off.QB.team, yard }
          : { type: 'FUM', by: (res.forcedBy && res.forcedBy.n) || null, off: res.rb && res.rb.name, team: res.rb && res.rb.team, yard } };

      // Red-zone resistance: great defenses stiffen near the goal line.
      let gain = res.yards;
      if (yard + gain >= 100) {
        const scoreChance = clampN(0.70 - defTax * 0.075, 0.34, 0.76);
        if (rng() < scoreChance) {
          const tdYard = Math.round(100 - yard); // length of the scoring play
          if (res.rec) { box.rec[res.rec.name]!.td += 1; box.pass.td += 1;
            return { pts: 7, end: 'TD', yard: 100, event: { type: 'PASS_TD', passer: off.QB && off.QB.name, by: res.rec.name, team: res.rec.team, yard: tdYard } }; }
          else if (res.rb) { box.rush[res.rb.name]!.td += 1;
            return { pts: 7, end: 'TD', yard: 100, event: { type: 'RUSH_TD', by: res.rb.name, team: res.rb.team, yard: tdYard } }; }
          else if (isPass && res.complete) { box.pass.td += 1;
            return { pts: 7, end: 'TD', yard: 100, event: { type: 'PASS_TD', passer: off.QB && off.QB.name, by: (res.rec && (res.rec as PassTarget).name) || null, team: res.rec && (res.rec as PassTarget).team, yard: tdYard } }; }
          return { pts: 7, end: 'TD', yard: 100, event: { type: 'RUSH_TD', by: (off.RB1 && off.RB1.name) || null, team: off.RB1 && off.RB1.team, yard: tdYard } };
        } else {
          gain = (98 - yard); // stuffed at the 2; settle for a likely FG
        }
      }
      yard += gain;

      // Update downs
      if (gain >= toGo) { down = 1; toGo = 10; }
      else { down++; toGo -= gain; }

      // 4th down decision
      if (down > 4) {
        // FG range (~the opponent 38 or closer)
        if (yard >= 63) {
          const fgDist = Math.round((100 - yard) + 17);
          const made = rng() < clampN(1.02 - (fgDist - 20) * 0.017, 0.40, 0.97);
          return made ? { pts: 3, end: 'FG', yard } : { pts: 0, end: 'MISS', yard };
        }
        // Go for it only on short yardage in plus territory; otherwise punt.
        if (toGo <= 2 && yard >= 50 && rng() < 0.45) {
          // Legacy sets `down = 4; toGo = toGo;` here and then returns below:
          // a no-op, but the rng() draw in the condition above is real.
        }
        return { pts: 0, end: yard >= 50 ? 'DOWNS' : 'PUNT', yard };
      }
    }
    return { pts: 0, end: 'PUNT', yard };
  };

  // ---- run the game ----
  const drives: Drive[] = [];
  let yourScore = 0;
  for (let i = 0; i < NUM_DRIVES; i++) {
    const d = simDrive(true);
    yourScore += d.pts;
    drives.push({ n: i + 1, ...d });
  }

  // ---- build the cinematic play timeline ----
  const cinematicEvents: CinematicEvent[] = [];
  let runScore = 0;
  drives.forEach((d, i) => {
    const elapsedFrac = (i + 0.5) / NUM_DRIVES;      // mid-point of this drive
    const totalSecs = 60 * 60;                       // four 15-min quarters
    const gameSecs = Math.round(elapsedFrac * totalSecs);
    const q = clampN(Math.floor(gameSecs / (15 * 60)) + 1, 1, 4);
    const remInQtr = (15 * 60) - (gameSecs % (15 * 60)); // time left in this quarter
    const clock = `${String(Math.floor(remInQtr / 60)).padStart(2, '0')}:${String(remInQtr % 60).padStart(2, '0')}`;
    if (d.pts === 7) runScore += 7;
    else if (d.pts === 3) runScore += 3;
    if (d.event) {
      cinematicEvents.push({
        ...d.event, drive: d.n, q, clock,
        yourScore: runScore, // running score after this play
        pts: d.pts,
      });
    } else if (d.end === 'FG') {
      cinematicEvents.push({ type: 'FG', by: TEAM_NAME, yard: Math.round((100 - d.yard!) + 17), drive: d.n, q, clock, yourScore: runScore, pts: 3 });
    } else if (d.end === 'MISS') {
      cinematicEvents.push({ type: 'FG_MISS', by: TEAM_NAME, yard: Math.round((100 - d.yard!) + 17), drive: d.n, q, clock, yourScore: runScore, pts: 0 });
    } else if (d.end === 'DOWNS') {
      cinematicEvents.push({ type: 'DOWNS', by: TEAM_NAME, drive: d.n, q, clock, yourScore: runScore, pts: 0 });
    }
  });

  // Beasts scoring: team offense scaled to rating, answer-back in shootouts,
  // plus defensive/ST points off your turnovers.
  const totINT = Object.values(box.def).reduce((s, d) => s + d.int, 0);
  const totSk = Object.values(box.def).reduce((s, d) => s + d.sk, 0);
  let beastScore = clampN(19.5 + (effRating - 80) * 0.53 + gaussNoise(rng) * 3.5, 6, 37);
  beastScore += clampN((yourScore - 23) * 1.05, 0, 28); // answer-back targets high-scoring (superteam) games only
  beastScore = Math.round(beastScore / 7) * 7 - (rng() < 0.4 ? 4 : 0); // look like real scores
  beastScore = Math.max(3, beastScore);
  // Defensive/ST points off your turnovers
  for (let i = 0; i < totINT; i++) if (rng() < 0.16) beastScore += 7;
  beastScore += (totSk >= 4 && rng() < 0.3) ? 3 : 0;
  beastScore = clampN(beastScore, 3, 49);

  // Avoid impossible ties going unbroken; nudge.
  if (yourScore === beastScore) { if (off.QB.imp >= 88) yourScore += 3; else beastScore += 3; }

  // Daily perfect team: guarantee the win.
  if (forceWin && yourScore <= beastScore) {
    yourScore = beastScore + 3 + Math.round(rng() * 4);
  }

  const won = yourScore > beastScore;

  // ---- distribute the Beasts' score across the timeline (presentational) ----
  if (cinematicEvents.length > 0) {
    // Break beastScore into 7s and 3s (a plausible set of scoring plays).
    let remaining = beastScore;
    const chunks: number[] = [];
    while (remaining >= 7 && (remaining % 7 === 0 || remaining > 9)) { chunks.push(7); remaining -= 7; }
    while (remaining >= 3) { chunks.push(3); remaining -= 3; }
    if (remaining > 0) chunks.push(remaining);
    const n = cinematicEvents.length;
    const chunksAt: number[][] = new Array(n).fill(null).map(() => []);
    chunks.forEach(c => { chunksAt[Math.floor(rng() * n)]!.push(c); });
    let beastRun = 0;
    let prevYour = 0;
    // Track the leader so scenes can call out lead changes as they happen.
    const leaderOf = (y: number, b: number) => (y > b ? 'C' : b > y ? 'B' : 'T');
    let leader = 'T';
    const merged: CinematicEvent[] = [];
    for (let i = 0; i < n; i++) {
      const ev = cinematicEvents[i]!;
      for (const delta of chunksAt[i]!) {
        const nl = leaderOf(prevYour, beastRun + delta);
        const lc = nl !== leader && nl !== 'T' && !(prevYour === 0 && beastRun === 0);
        leader = nl === 'T' ? leader : nl;
        merged.push({
          leadChange: lc,
          type: delta >= 6 ? 'BEAST_TD' : delta === 2 ? 'BEAST_SAFETY' : 'BEAST_FG',
          by: 'THE BEASTS',
          pts: delta,
          // opening = nobody has scored yet, so captions can't say "answer"
          opening: prevYour === 0 && beastRun === 0,
          drive: ev.drive,
          q: ev.q,
          clock: ev.clock,
          yourScore: prevYour,
          beastScore: beastRun + delta,
        });
        beastRun += delta;
      }
      ev.beastScore = beastRun;
      {
        const newY = ev.yourScore;
        const nl = leaderOf(newY, beastRun);
        // pre-event totals: the game's opening score is not a "lead change"
        ev.leadChange = nl !== leader && nl !== 'T' && (prevYour + beastRun) > 0 && (ev.pts || 0) > 0;
        leader = nl === 'T' ? leader : nl;
      }
      prevYour = ev.yourScore;
      merged.push(ev);
    }
    cinematicEvents.length = 0;
    merged.forEach(e => cinematicEvents.push(e));
    // Make the last event reflect the true final after tie-break/force-win.
    cinematicEvents[cinematicEvents.length - 1]!.yourScore = yourScore;
    cinematicEvents[cinematicEvents.length - 1]!.beastScore = beastScore;
  }

  // ---- assemble box score arrays (filter zero-touch players) ----
  const rushArr = Object.values(box.rush).filter(r => r.car > 0).sort((a, b) => b.yds - a.yds);
  const recArr = Object.values(box.rec).filter(r => r.tgt > 0).sort((a, b) => b.yds - a.yds);
  const defArr = Object.values(box.def).sort((a, b) => (b.sk * 10 + b.int * 12 + b.tk) - (a.sk * 10 + a.int * 12 + a.tk));

  // ---- key matchup callouts ----
  const matchupNotes = M.cov.map(c => {
    const sep = c.rec.sep, cov = c.defender.cover;
    const recStat = box.rec[c.rec.name] || { rec: 0, yds: 0, td: 0, tgt: 0 };
    const ratingMargin = sep - cov;
    // Production score: yards + TD bonus, scaled. A strong game = WR won.
    const prod = recStat.yds + recStat.td * 20;
    let won: 'offense' | 'defense' | 'even';
    if (recStat.tgt === 0) {
      // Never targeted — decide by rating but call it "even" unless lopsided.
      won = ratingMargin > 12 ? 'offense' : ratingMargin < -12 ? 'defense' : 'even';
    } else if (prod >= 65 || recStat.td > 0) {
      won = 'offense';                       // clearly productive game
    } else if (prod <= 25) {
      won = 'defense';                       // shut down
    } else {
      // Middling production — let the rating edge break it.
      won = ratingMargin > 5 ? 'offense' : ratingMargin < -5 ? 'defense' : 'even';
    }
    return {
      slot: c.slot,
      off: c.rec.name, offImp: c.rec.imp,
      def: c.defender.n, defImp: c.defender.imp, defRole: c.defender.role,
      recYds: recStat.yds, recCatches: recStat.rec, recTD: recStat.td,
      winner: won, margin: ratingMargin,
    };
  });
  // Trenches matchup
  const trench = {
    olPass: Math.round(off.OL.pass), olRun: Math.round(off.OL.run),
    passRush: Math.round(M.passRush), runFront: Math.round(M.runFront),
    sacks: totSk,
    passWin: off.OL.pass - M.passRush, runWin: off.OL.run - M.runFront,
  };

  // ---- dominance grade ----
  const margin = yourScore - beastScore;
  const { grade, gradeLabel } = dominanceGrade(margin);

  // Offensive power rating for display continuity
  const totalYds = box.pass.yds + Object.values(box.rush).reduce((s, r) => s + r.yds, 0);
  const opr = clampN(Math.round(40 + (yourScore - 21) * 2.4 + (off.QB.imp - 80) * 0.5), 1, 99);

  return {
    won, yourScore, beastScore, grade, gradeLabel,
    defRating: defR.rating, defPA: defR.basePA.toFixed(1),
    box: { pass: box.pass, qbRush: box.qbRush, rush: rushArr, rec: recArr, def: defArr },
    matchups: matchupNotes,
    trench,
    drives,
    cinematicEvents,
    totalYds,
    opr,
    beasts,
    offense: {
      opr,
      passYpg: box.pass.yds,
      rushYpg: Object.values(box.rush).reduce((s, r) => s + r.yds, 0),
      totalYpg: totalYds,
      qbRating: (roster.QB.s.r as number).toFixed(1),
    },
  };
};
