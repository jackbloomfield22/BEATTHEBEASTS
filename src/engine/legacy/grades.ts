// Grades and tiers, ported from legacy/beat-the-beasts.jsx: scoreToGrade
// 6551–6565, gradeColor 6566–6572, gradeQB 6576–6586, gradeRush 6587–6596,
// gradeRec 6597–6609, the dominance grade inside simulateBeatdown 5429–5436,
// and the Beasts threat tier from BeastsRevealScreen 6454–6457.

import { C } from '@data/legacy/palette';
import type { DominanceGrade, PassBox, RecBox, RushBox } from './types';
import { clampN } from './util';

/** Convert a 0-100 performance score into a letter grade. */
export const scoreToGrade = (s: number): string => {
  if (s >= 97) return 'A+';
  if (s >= 93) return 'A';
  if (s >= 90) return 'A-';
  if (s >= 87) return 'B+';
  if (s >= 83) return 'B';
  if (s >= 80) return 'B-';
  if (s >= 77) return 'C+';
  if (s >= 73) return 'C';
  if (s >= 70) return 'C-';
  if (s >= 67) return 'D+';
  if (s >= 63) return 'D';
  if (s >= 60) return 'D-';
  return 'F';
};

export const gradeColor = (g: string): string => {
  if (g.startsWith('A')) return '#aaff00';
  if (g.startsWith('B')) return '#a3e635';
  if (g.startsWith('C')) return '#fbbf24';
  if (g.startsWith('D')) return '#fb923c';
  return '#ff2a6d';
};

/** Grade a QB's game by his actual stat line (0-100). */
export const gradeQB = (p: Pick<PassBox, 'cmp' | 'att' | 'yds' | 'td' | 'int'> | null | undefined): number => {
  if (!p || p.att === 0) return 73;
  const compPct = p.cmp / Math.max(1, p.att);
  let s = 82;
  s += (compPct - 0.56) * 38;          // completion %
  s += (p.yds - 180) * 0.045;          // yardage
  s += p.td * 4.5;                      // TDs
  s -= p.int * 5.5;                     // INTs
  s += (p.yds / Math.max(1, p.att) - 6.5) * 2.0; // yards per attempt
  return clampN(Math.round(s), 35, 99);
};

export const gradeRush = (r: Pick<RushBox, 'car' | 'yds' | 'td' | 'long'> | null | undefined): number => {
  if (!r || r.car === 0) return 73;
  const ypc = r.yds / Math.max(1, r.car);
  let s = 76;
  s += (ypc - 3.8) * 6.5;               // efficiency
  s += (r.yds - 55) * 0.12;            // volume production
  s += r.td * 6.5;                      // TDs
  s += (r.long >= 20 ? 4 : 0);          // explosive run
  return clampN(Math.round(s), 35, 99);
};

export const gradeRec = (r: Pick<RecBox, 'tgt' | 'rec' | 'yds' | 'td' | 'long'> | null | undefined): number => {
  if (!r || r.tgt === 0) return 73;
  const catchPct = r.rec / Math.max(1, r.tgt);
  const ypr = r.yds / Math.max(1, r.rec);
  // Role-aware: low-target players judged more on efficiency than raw volume.
  let s = 80;
  s += (r.yds - 35) * 0.16;            // yardage (lower bar)
  s += r.td * 6.5;                      // TDs
  s += (catchPct - 0.58) * 14;          // catch rate
  s += (ypr - 10) * 0.7;                // yards per catch
  s += (r.long >= 25 ? 4 : 0);          // explosive catch
  return clampN(Math.round(s), 35, 99);
};

/** Dominance grade by final margin (yourScore − beastScore). */
export const dominanceGrade = (margin: number): { grade: DominanceGrade; gradeLabel: string } => {
  let grade: DominanceGrade, gradeLabel: string;
  if (margin >= 21) { grade = 'A+'; gradeLabel = 'Total Domination'; }
  else if (margin >= 11) { grade = 'A'; gradeLabel = 'Statement Win'; }
  else if (margin >= 4) { grade = 'B'; gradeLabel = 'Solid Win'; }
  else if (margin >= 1) { grade = 'C'; gradeLabel = 'Nailbiter Win'; }
  else if (margin >= -10) { grade = 'L'; gradeLabel = 'Tough Loss'; }
  else { grade = 'L-'; gradeLabel = 'Beatdown'; }
  return { grade, gradeLabel };
};

export type ThreatLabel = 'NIGHTMARE' | 'BRUTAL' | 'STOUT' | 'BEATABLE';

/** Beasts threat tier from the Defense Rating (legacy `{ l, c }`). */
export const threatTier = (rating: number): { l: ThreatLabel; c: string } =>
  rating >= 90 ? { l: 'NIGHTMARE', c: '#ff2a6d' }
  : rating >= 87 ? { l: 'BRUTAL', c: C.gold }
  : rating >= 84 ? { l: 'STOUT', c: C.sky }
  : { l: 'BEATABLE', c: C.emerald };
