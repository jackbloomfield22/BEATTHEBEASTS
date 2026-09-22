// Derived player profile and the season points model, ported line-for-line
// from legacy/beat-the-beasts.jsx: deriveProfile 4181–4288,
// calculateOffensivePF 4303–4379 (SCORE_K 4300).

import { SCORE_K } from '@data/legacy/tables';
import type { AssumedStats, LooseStats, Roster } from './types';
import { clampN, ERA, eraEquiv, pct, REF, round1 } from './util';

export interface DerivedProfile {
  era: string;
  derived: Record<string, number | string | undefined>;
  archetype: string;
  archetypeNote: string;
}

export function deriveProfile(p: { readonly p: string; readonly d: string; readonly s?: LooseStats | null }): DerivedProfile {
  const s = (p.s || {}) as AssumedStats;
  const era = ERA[p.d] || REF;
  const out: DerivedProfile = { era: p.d, derived: {}, archetype: '', archetypeNote: '' };

  if (p.p === 'QB') {
    // y=passYds/g, t=passTD/g, i=INT/g, r=rating
    const vsEraYds = pct(((s.y / era.passY) - 1) * 100);   // % above/below era avg
    const vsEraRate = round1(s.r - era.rate);
    out.derived = {
      'Pass Yds/G': s.y,
      'Pass TD/G': round1(s.t),
      'INT/G': round1(s.i),
      'Passer Rating': s.r,
      'TD : INT': s.i > 0 ? `${round1(s.t / s.i)} : 1` : 'elite',
      'Yds vs era avg': `${vsEraYds >= 0 ? '+' : ''}${vsEraYds}%`,
      'Rating vs era': `${vsEraRate >= 0 ? '+' : ''}${vsEraRate}`,
    };
    // Archetype from his own profile
    const gunslinger = s.y >= era.passY * 1.18 && s.t >= era.passTD * 1.15;
    const surgeon = s.r >= era.rate + 14 && s.i <= era.int * 0.7;
    const gametime = s.r >= era.rate + 6 && s.t >= era.passTD;
    const caretaker = s.i <= era.int * 0.75 && s.y < era.passY * 1.05;
    const volume = s.y >= era.passY * 1.12 && s.r < era.rate + 8;
    if (surgeon)        { out.archetype = 'Surgeon'; out.archetypeNote = 'Elite efficiency, protects the ball'; }
    else if (gunslinger){ out.archetype = 'Gunslinger'; out.archetypeNote = 'High volume, high TD, lives downfield'; }
    else if (volume)    { out.archetype = 'Volume Passer'; out.archetypeNote = 'Piles up yards, modest efficiency'; }
    else if (gametime)  { out.archetype = 'Field General'; out.archetypeNote = 'Steady, productive, reliable'; }
    else if (caretaker) { out.archetype = 'Game Manager'; out.archetypeNote = 'Low risk, ball-secure'; }
    else                { out.archetype = 'Pocket Passer'; out.archetypeNote = 'Balanced traditional passer'; }
    // (legacy also computed an unused `tdIntRatio` here; it has no side effects)
  }

  else if (p.p === 'RB') {
    // y=rushYds/g, c=YPC, r=recYds/g, t=TD/g
    const scrimmage = round1(s.y + (s.r || 0));
    const recShare = s.r != null && (s.y + s.r) > 0 ? pct((s.r / (s.y + s.r)) * 100) : 0;
    const vsEraYds = pct(((s.y / era.rbY) - 1) * 100);
    out.derived = {
      'Rush Yds/G': s.y,
      'Yds/Carry': s.c,
      'Rec Yds/G': s.r,
      'Scrimmage Yds/G': scrimmage,
      'TD/G': round1(s.t),
      'Receiving share': `${recShare}%`,
      'Rush vs era avg': `${vsEraYds >= 0 ? '+' : ''}${vsEraYds}%`,
    };
    const homerun = s.c >= 4.9 && s.y >= era.rbY * 1.15;
    const bell = s.y >= era.rbY * 1.25;
    const receiving = recShare >= 28;
    const scorer = s.t >= era.rbTD * 1.6;
    const grinder = s.c < 4.3 && s.y >= era.rbY;
    if (bell && receiving) { out.archetype = 'Three-Down Back'; out.archetypeNote = 'Carries the load and catches passes'; }
    else if (homerun)      { out.archetype = 'Home-Run Hitter'; out.archetypeNote = 'Explosive, high yards per carry'; }
    else if (bell)         { out.archetype = 'Workhorse'; out.archetypeNote = 'High-volume bell-cow back'; }
    else if (receiving)    { out.archetype = 'Receiving Back'; out.archetypeNote = 'Pass-catching weapon out of the backfield'; }
    else if (scorer)       { out.archetype = 'Goal-Line Back'; out.archetypeNote = 'Finds the end zone'; }
    else if (grinder)      { out.archetype = 'Grinder'; out.archetypeNote = 'Tough between-the-tackles runner'; }
    else                   { out.archetype = 'Committee Back'; out.archetypeNote = 'Balanced rotational back'; }
  }

  else if (p.p === 'WR') {
    // y=recYds/g, p=yds/target, t=TD/g, c=catch%
    const vsEraYds = pct(((s.y / era.recY) - 1) * 100);
    out.derived = {
      'Rec Yds/G': s.y,
      'Yds/Target': s.p,
      'Catch %': `${s.c}%`,
      'TD/G': round1(s.t),
      'Yds vs era avg': `${vsEraYds >= 0 ? '+' : ''}${vsEraYds}%`,
    };
    const alpha = s.y >= era.recY * 1.55;
    const deep = s.p >= 13 && s.y >= era.recY * 1.05;
    const possession = s.c >= 64 && s.p < 11;
    const redzone = s.t >= era.recTD * 2.0;
    const yac = s.c >= 60 && s.p >= 10.5 && s.p < 13;
    const solid = s.y >= era.recY * 1.0;
    if (alpha)          { out.archetype = 'WR1 / Alpha'; out.archetypeNote = 'True No. 1, commands coverage'; }
    else if (deep)      { out.archetype = 'Deep Threat'; out.archetypeNote = 'Vertical field-stretcher'; }
    else if (possession){ out.archetype = 'Possession WR'; out.archetypeNote = 'Sure-handed chain-mover'; }
    else if (redzone)   { out.archetype = 'Red-Zone Target'; out.archetypeNote = 'Scoring specialist'; }
    else if (yac)       { out.archetype = 'YAC Weapon'; out.archetypeNote = 'Dangerous after the catch'; }
    else if (solid)     { out.archetype = 'Starting WR'; out.archetypeNote = 'Productive every-down receiver'; }
    else                { out.archetype = 'Rotational WR'; out.archetypeNote = 'Complementary receiver'; }
  }

  else if (p.p === 'TE') {
    // y=recYds/g, t=TD/g, b=block grade
    const vsEraYds = pct(((s.y / era.recY) - 1) * 100);
    out.derived = {
      'Rec Yds/G': s.y,
      'TD/G': round1(s.t),
      'Block Grade': s.b,
      'Yds vs era avg': `${vsEraYds >= 0 ? '+' : ''}${vsEraYds}%`,
    };
    const complete = s.y >= era.recY * 0.8 && s.b >= 76;
    const receiving = s.y >= era.recY * 0.95 && s.b < 76;
    const blocker = s.b >= 82;
    const redzone = s.t >= era.recTD * 1.6;
    if (complete)        { out.archetype = 'Complete TE'; out.archetypeNote = 'Receives and blocks at a high level'; }
    else if (receiving)  { out.archetype = 'Receiving TE'; out.archetypeNote = 'Move tight end, mismatch weapon'; }
    else if (blocker)    { out.archetype = 'Blocking TE'; out.archetypeNote = 'In-line, run-game anchor'; }
    else if (redzone)    { out.archetype = 'Red-Zone TE'; out.archetypeNote = 'Scoring threat near the goal line'; }
    else                 { out.archetype = 'Rotational TE'; out.archetypeNote = 'Complementary tight end'; }
  }

  return out;
}

export interface OffensivePF {
  pf: number;
  rushY: number;
  opr: number;
  passYpg: string;
  rushYpg: string;
  totalYpg: string;
  passTDsSeason: number;
  rushTDsSeason: number;
  intsSeason: number;
  sacksAllowedSeason: number;
  qbRating: string;
}

/** Build the team's offensive profile from the 9 starters, era-normalized. */
export const calculateOffensivePF = (roster: Roster): OffensivePF => {
  const { QB: qb, RB: rb, RB2: rb2, WR1: wr1, WR2: wr2, WR3: wr3, TE: te, TE2: te2, OL: ol } = roster;
  const qs = qb.s as AssumedStats;

  const qb_b = ERA[qb.d] || REF;
  const qbPassY  = eraEquiv(qs.y, qb_b.passY, REF.passY);
  const qbPassTD = eraEquiv(qs.t, qb_b.passTD, REF.passTD);
  const qbRate   = eraEquiv(qs.r, qb_b.rate, REF.rate, 0.9);
  const qbINT    = eraEquiv(qs.i, qb_b.int, REF.int, 0.9);

  // Receiving corps — production index weighted by realistic target share, blended with impact
  const corps = [
    { p: wr1, w: 0.30 }, { p: wr2, w: 0.22 }, { p: te, w: 0.18 },
    { p: wr3, w: 0.16 }, { p: te2, w: 0.08 },
  ];
  let recYIdx = 0, recTDIdx = 0, impW = 0, wSum = 0;
  corps.forEach(({ p, w }) => {
    if (!p) return;
    const b = ERA[p.d] || REF;
    const yBase = p.p === 'TE' ? b.recY * 0.7 : b.recY;
    recYIdx += w * ((p.s.y || 0) / yBase);
    recTDIdx += w * ((p.s.t || 0) / b.recTD);
    impW += w * (p.imp || 75);
    wSum += w;
  });
  if (wSum > 0) { recYIdx /= wSum; recTDIdx /= wSum; impW /= wSum; }
  const recMult = 0.62 + 0.26 * recYIdx + 0.12 * (impW / 86);

  // Offensive line: pass protection & run blocking factors
  const oS = (ol.s || { ry: 130, sa: 2.0, pb: 86, pbl: 2 }) as AssumedStats;
  const olPass = clampN(0.80 + 0.20 * (oS.pb / 88) - 0.03 * (oS.sa - 2.0) + 0.015 * ((oS.pbl || 0) - 2), 0.82, 1.20);
  const olRun  = clampN(0.78 + 0.32 * (oS.ry / 135), 0.82, 1.28);

  // Backfield (RB1 primary, RB2 change-of-pace)
  const rbY   = eraEquiv(rb.s.y, (ERA[rb.d] || REF).rbY, REF.rbY);
  const rbTD  = eraEquiv(rb.s.t, (ERA[rb.d] || REF).rbTD, REF.rbTD);
  const rb2Y  = eraEquiv(rb2.s.y, (ERA[rb2.d] || REF).rbY, REF.rbY);
  const rb2TD = eraEquiv(rb2.s.t, (ERA[rb2.d] || REF).rbTD, REF.rbTD);
  const rbRecY = (rb.s.r || 0) + 0.5 * (rb2.s.r || 0);

  // Effective per-game production
  const passY  = clampN(qbPassY * (0.88 + 0.12 * olPass) * (0.90 + 0.10 * recMult) + rbRecY * 0.55, 120, 350);
  const rushY  = clampN((rbY + 0.42 * rb2Y) * olRun, 30, 215);
  const passTD = clampN(qbPassTD * (0.85 + 0.15 * olPass) * (0.80 + 0.20 * recMult) * (0.90 + 0.10 * recTDIdx), 0.3, 3.4);
  const rushTD = clampN((rbTD + 0.42 * rb2TD) * (0.85 + 0.15 * olRun), 0.2, 2.6);
  const intG   = clampN(qbINT / (0.85 + 0.15 * olPass), 0.2, 2.2);
  const sacksG = oS.sa;
  const totalY = passY + rushY;
  const tdG = passTD + rushTD;

  // Points model
  let pf = SCORE_K.base;
  pf += tdG * SCORE_K.TD;
  pf += clampN(SCORE_K.fgC + totalY * SCORE_K.fgY - tdG * SCORE_K.fgTD, 2.5, 10);
  pf += (qbRate - REF.rate) * SCORE_K.rate;
  pf -= intG * SCORE_K.int;
  pf -= clampN(sacksG - 2.0, -1, 4) * SCORE_K.sack;
  // Stretch around the league-average pivot so dream teams separate from the pack
  pf = pf >= SCORE_K.pivot ? SCORE_K.pivot + (pf - SCORE_K.pivot) * SCORE_K.up
                           : SCORE_K.pivot + (pf - SCORE_K.pivot) * SCORE_K.down;
  pf = clampN(pf, 11, 44);

  const opr = clampN(Math.round(50 + (pf - 21) * 3.0), 1, 99);

  return {
    pf,
    rushY,
    opr,
    passYpg: passY.toFixed(0),
    rushYpg: rushY.toFixed(0),
    totalYpg: totalY.toFixed(0),
    passTDsSeason: Math.round(passTD * 17),
    rushTDsSeason: Math.round(rushTD * 17),
    intsSeason: Math.round(intG * 17),
    sacksAllowedSeason: Math.round(sacksG * 17),
    qbRating: qs.r.toFixed(1),
  };
};
