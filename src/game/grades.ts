// Player grades (Playtest 2, M6.6): production against what his role
// produces in a game this long, with the reason in one line.
//
// Why the old grades were broken (legacy gradeQB / gradeRush / gradeRec,
// src/engine/legacy/grades.ts, fed yardage × 10 / rounds so a short game
// read like a ten-drive one):
//   - The scaling multiplied the yards but not the attempts, so every rate
//     inflated with it: in a 4-round game ×2.5, 3 of 6 for 43 yards is 7.2
//     yards an attempt but graded as 17.9 (+23 points on its own) and the
//     QB landed on 99, an A+. A receiver's yards per catch did the same.
//   - A QB's grade read only his passing line. His scrambles were a
//     separate rushing row with its own grade, so 101 passing and 175
//     rushing graded as a 101-yard passer (a B) plus an unrelated rusher.
//   - A player with no touches got a flat 73 (C), whatever his snaps.
//
// Now: one grade per player, from everything he produced.
//   value     = yards from scrimmage (a QB's passing yards net of sacks,
//               plus his rushing) + 20 a touchdown − 45 a turnover (the
//               20 and 45 are Pro Football Reference's adjusted-yards
//               weights, the ones in ANY/A);
//   expected  = what his role produces a possession (ROLE_NORMS: NFL
//               per-game lines for the role, 2018–23, approximate,
//               ÷ 11 possessions a team game) × your possessions this game;
//   volume    = 14 × log2((value + k) / (expected + k)), k damping small
//               samples (a third of the expectation, at least 8 yd), in
//               [−18, +16]: double the expectation ≈ +12, half ≈ −9;
//   efficiency = his per-play rate against the league's (ANY/A for a QB,
//               yards a carry, yards a target), shrunk toward zero when he
//               had few chances (n / (n + a prior)), in [−10, +10];
//   drops     = −3 each.
//   score     = 80 + volume + efficiency + drops, on legacy's letter scale
//               (scoreToGrade: 80 is a B−, 93 an A, 97 an A+).
// Doing exactly what the role does is a B−; twice it, efficiently, is an A.
// A player who never touched the ball has no grade ("—"), only his snaps.

import { scoreToGrade } from '@/engine/legacy/grades';
import type { GameRecord } from './record';
import type { GameBox, PassLine, RecLine, RushLine } from './stats';

/** A team's possessions in an NFL game (2018–23 average ≈ 11; Pro Football Reference drive stats, approximate). */
export const NFL_POSSESSIONS = 11;
/** Adjusted-yards weights (PFR's ANY/A): a touchdown is worth 20 yards, a turnover costs 45. */
export const TD_YARDS = 20;
export const TURNOVER_YARDS = 45;

export type Role = 'QB' | 'RB1' | 'RB2' | 'WR1' | 'WR2' | 'WR3' | 'TE1' | 'TE2';

interface RoleNorm {
  /** Who he is, in a fan's words ("a No. 1 receiver"). */
  who: string;
  /** Value (yards + 20·TD − 45·turnovers) a game for the role. */
  perGame: number;
}

/**
 * What each role produces in an NFL game (2018–23, approximate, from Pro
 * Football Reference's league and positional splits): a starting QB ~240
 * passing yards less ~16 in sacks, ~20 rushing, 1.9 TDs, 0.95 turnovers
 * (≈ 238); a lead back 65 rushing + 22 receiving, 0.55 TDs (≈ 94); a
 * change-of-pace back 30 + 15, 0.25 TDs (≈ 48); receivers by depth 72/52/35
 * yards with 0.45/0.3/0.2 TDs; a starting tight end 42 yards and 0.3 TDs,
 * a backup 10 and 0.1.
 */
export const ROLE_NORMS: Record<Role, RoleNorm> = {
  QB: { who: 'a starting QB', perGame: 238 },
  RB1: { who: 'a lead back', perGame: 94 },
  RB2: { who: 'a change-of-pace back', perGame: 48 },
  WR1: { who: 'a No. 1 receiver', perGame: 81 },
  WR2: { who: 'a No. 2 receiver', perGame: 58 },
  WR3: { who: 'a No. 3 receiver', perGame: 39 },
  TE1: { who: 'a starting tight end', perGame: 48 },
  TE2: { who: 'a backup tight end', perGame: 12 },
};

/**
 * League rates for the efficiency term (NFL 2018–23, approximate): ANY/A
 * ≈ 6.2; 4.3 yards a carry; yards a target 8.0 for receivers, 7.2 for tight
 * ends, 6.0 for backs. `prior` is the sample size at which he's judged half
 * on his rate; `w` the points per unit of rate above or below.
 */
export const RATE_NORMS = {
  anya: { norm: 6.2, prior: 8, w: 2.2 },
  ypc: { norm: 4.3, prior: 8, w: 3 },
  ypt: { WR: 8.0, TE: 7.2, RB: 6.0, prior: 6, w: 1.4 },
} as const;

const SLOT_ROLE: Record<string, Role> = { QB: 'QB', RB: 'RB1', RB2: 'RB2', WR1: 'WR1', WR2: 'WR2', WR3: 'WR3', TE: 'TE1', TE2: 'TE2' };

export interface Contribution {
  label: string;
  points: number;
}

export interface PlayerGrade {
  name: string;
  role: Role;
  /** Snaps he was on the field for (null: an older record that didn't count them). */
  snaps: number | null;
  /** The letter, or null when he never touched the ball. */
  grade: string | null;
  score: number | null;
  value: number;
  expected: number;
  /** The reason, in one line. */
  why: string;
  contributions: Contribution[];
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const r0 = (x: number) => Math.round(x);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** His lines in the box score (a QB's passing, anyone's carries and catches). */
function linesOf(box: GameBox, name: string, role: Role): { pass: PassLine | null; rush: RushLine | null; rec: RecLine | null } {
  return { pass: role === 'QB' && box.pass.name === name ? box.pass : null, rush: box.rush[name] ?? null, rec: box.rec[name] ?? null };
}

/** How the ratio reads: "twice what", "about what", "half of what". */
function ratioWords(ratio: number): string {
  if (ratio >= 2.75) return `${Math.round(ratio)}× what`;
  if (ratio >= 1.8) return 'twice what';
  if (ratio >= 1.3) return 'well above what';
  if (ratio >= 1.1) return 'a bit above what';
  if (ratio >= 0.9) return 'about what';
  if (ratio >= 0.7) return 'a bit under what';
  if (ratio >= 0.4) return 'half of what';
  if (ratio > 0.15) return 'a fraction of what';
  return 'none of what';
}

/** "12 of 18, 164 yards, 2 TD" and friends: his line in fan words. */
function statLine(pass: PassLine | null, rush: RushLine | null, rec: RecLine | null): string {
  const parts: string[] = [];
  if (pass && (pass.att || pass.sacks)) {
    parts.push(`${pass.cmp} of ${pass.att}, ${plural(r0(pass.yds), 'yard')}`);
    if (pass.td) parts.push(plural(pass.td, 'TD'));
    if (pass.int) parts.push(plural(pass.int, 'pick'));
  }
  if (rush && rush.car) parts.push(pass ? `${r0(rush.yds)} rushing` : `${plural(rush.car, 'carry', 'carries')} for ${r0(rush.yds)}`);
  if (rec && rec.tgt) parts.push(`${rec.rec} of ${plural(rec.tgt, 'target')} for ${r0(rec.yds)}`);
  const tds = (rush?.td ?? 0) + (rec?.td ?? 0);
  if (tds && !pass) parts.push(plural(tds, 'TD'));
  else if (pass && rush?.td) parts.push(`${plural(rush.td, 'rushing TD')}`);
  const lost = rush?.lost ?? 0;
  if (lost) parts.push(plural(lost, 'fumble') + ' lost');
  return parts.join(', ');
}

/** Grade one player on his lines, his role and your possessions. */
export function gradePlayer(name: string, role: Role, box: GameBox, possessions: number): PlayerGrade {
  const { pass, rush, rec } = linesOf(box, name, role);
  const snaps = box.snaps ? (box.snaps[name] ?? 0) : null;
  const n = Math.max(1, possessions);
  const norm = ROLE_NORMS[role];
  const expected = (norm.perGame / NFL_POSSESSIONS) * n;
  const touched = (pass?.att ?? 0) + (pass?.sacks ?? 0) + (rush?.car ?? 0) + (rec?.tgt ?? 0);
  // Value: yards from scrimmage, adjusted for touchdowns and turnovers.
  const yards = (pass ? pass.yds - pass.sackYds : 0) + (rush?.yds ?? 0) + (rec?.yds ?? 0);
  const tds = (pass?.td ?? 0) + (rush?.td ?? 0) + (rec?.td ?? 0);
  const turnovers = (pass?.int ?? 0) + (rush?.lost ?? 0);
  const value = yards + TD_YARDS * tds - TURNOVER_YARDS * turnovers;
  const games = `${plural(n, 'drive')}`;
  if (!touched) {
    return { name, role, snaps, grade: null, score: null, value: 0, expected, why: snaps ? `No touches on ${plural(snaps, 'snap')}` : "Didn't get on the field", contributions: [] };
  }
  const contributions: Contribution[] = [];
  const k = Math.max(8, expected / 3);
  const volume = clamp(14 * Math.log2(Math.max(1, value + k) / (expected + k)), -18, 16);
  contributions.push({ label: `production: ${r0(value)} against ${r0(expected)} for ${norm.who} in ${games}`, points: volume });
  // Efficiency: each line's rate against the league's, weighted by its share of his chances.
  let eff = 0;
  if (pass && pass.att + pass.sacks > 0) {
    const drop = pass.att + pass.sacks;
    const anya = (pass.yds - pass.sackYds + TD_YARDS * pass.td - TURNOVER_YARDS * pass.int) / drop;
    const e = RATE_NORMS.anya.w * (anya - RATE_NORMS.anya.norm) * (drop / (drop + RATE_NORMS.anya.prior));
    contributions.push({ label: `${anya.toFixed(1)} adjusted net yards an attempt (league ${RATE_NORMS.anya.norm})`, points: e });
    eff += e * (drop / touched);
  }
  if (rush && rush.car > 0) {
    const ypc = rush.yds / rush.car;
    const e = RATE_NORMS.ypc.w * (ypc - RATE_NORMS.ypc.norm) * (rush.car / (rush.car + RATE_NORMS.ypc.prior));
    contributions.push({ label: `${ypc.toFixed(1)} yards a carry (league ${RATE_NORMS.ypc.norm})`, points: e });
    eff += e * (rush.car / touched);
  }
  if (rec && rec.tgt > 0) {
    const ypt = rec.yds / rec.tgt;
    const lg = role.startsWith('RB') ? RATE_NORMS.ypt.RB : role.startsWith('TE') ? RATE_NORMS.ypt.TE : RATE_NORMS.ypt.WR;
    const e = RATE_NORMS.ypt.w * (ypt - lg) * (rec.tgt / (rec.tgt + RATE_NORMS.ypt.prior));
    contributions.push({ label: `${ypt.toFixed(1)} yards a target (league ${lg})`, points: e });
    eff += e * (rec.tgt / touched);
  }
  eff = clamp(eff, -10, 10);
  const drops = -3 * (rec?.drops ?? 0);
  if (drops) contributions.push({ label: plural(rec!.drops, 'drop'), points: drops });
  const score = clamp(Math.round(80 + volume + eff + drops), 35, 99);
  const ratio = (value + k) / (expected + k);
  const why = `${statLine(pass, rush, rec)}: ${ratioWords(value <= 0 ? 0 : ratio)} ${norm.who} makes in ${games}${rec?.drops ? `, ${plural(rec.drops, 'drop')}` : ''}`;
  return { name, role, snaps, grade: scoreToGrade(score), score, value, expected, why, contributions };
}

/** Every skill player's grade, in depth-chart order (QB, backs, receivers, tight ends). */
export function gradePlayers(rec: GameRecord): PlayerGrade[] {
  const possessions = Math.max(1, rec.userDrives.length);
  return rec.offense.filter((o) => SLOT_ROLE[o.slot]).map((o) => gradePlayer(o.name, SLOT_ROLE[o.slot]!, rec.box, possessions));
}
