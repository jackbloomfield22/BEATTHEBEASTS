import React, { useState, useEffect, useMemo } from 'react';
import { RotateCcw, RefreshCw, Search, Trophy, X, Info, ChevronRight, Sparkles, Brain } from 'lucide-react';

// ============================================================
// CONSTANTS
// ============================================================
const DECADES = ['1960s', '1970s', '1980s', '1990s', '2000s', '2010s', '2020s'];
// The player's all-time roster competes as "The Contenders" (vs. the Beasts).
const TEAM_NAME = 'The Contenders';

// ============================================================
// ODDS LAB — play-credits-only simulation of a pay-to-play model.
// NOT real money. Models a video-poker-style game: a fixed stake, payout scaled
// by margin of victory, tuned so OPTIMAL play returns ~97% (the house keeps a
// small edge even vs perfect play; weaker play returns less). This is a sandbox
// to FEEL the math and watch realized RTP converge — it never takes or pays
// actual currency.
//
// Paytable solved against the real sim (see design work): every win pays >=1.5x,
// a gentle ramp through common bands, and a rare heavy tail (Annihilation /
// Perfect Beatdown jackpot) that is genuinely reachable on a blowout.
const LAB_BANDS = [
  { name: 'Loss',             lo: -999, hi: 0,    mult: 0     },
  { name: 'Win',              lo: 1,    hi: 6,    mult: 1.5   },
  { name: 'Solid Win',        lo: 7,    hi: 14,   mult: 1.77  },
  { name: 'Big Win',          lo: 15,   hi: 24,   mult: 2.42  },
  { name: 'Blowout',          lo: 25,   hi: 36,   mult: 3.73  },
  { name: 'Beatdown',         lo: 37,   hi: 50,   mult: 7.46  },
  { name: 'Annihilation',     lo: 51,   hi: 68,   mult: 18.65 },
  { name: 'Perfect Beatdown', lo: 69,   hi: 9999, mult: 69.92 },
];
const LAB_STAKE = 5;          // fixed play-credit stake per entry
const LAB_START_CREDITS = 500; // starting play-credit balance
const SHOW_ODDS_LAB = false;   // hide the lab from the home screen (code stays; set true to re-enable)

// The "supernova" tail: on a strong win, a small random chance the margin
// explodes into blowout/annihilation/jackpot territory. This is what makes the
// top bands reachable (a lucky variance spike on top of a real strong game),
// exactly like a slot's big-win moment. Skill gates entry (you must already be
// winning big), so weak rosters essentially never trigger it.
//
// Design note: the lab applies a margin BOOST so optimal play wins ~52% (a
// retainable rate) rather than the free game's punishing ~28%. With the boost,
// a regular win pays a flat 1.5x, the ladder is monotonic, optimal RTP sits at
// ~95.5%, and a skilled player who makes occasional small misses wins at nearly
// the optimal rate (the strong/optimal RTP gap is single digits). labMargin is
// the single source of truth for the displayed margin (live play and batch).
const LAB_BOOST = 4.5;
const LAB_GAIN = 0.5;
function labMargin(rawMargin) {
  let d = rawMargin + LAB_BOOST;
  if (d > 0) d = d * (1 + LAB_GAIN * (d / 40));
  return d > 0 ? Math.round(labSupernova(d)) : Math.round(d);
}
function labSupernova(margin) {
  if (margin <= 10) return margin;
  const r = Math.random();
  if (r < 0.004) return 70 + (margin - 10) * 1.5 + Math.random() * 40;      // jackpot class
  if (r < 0.014) return 52 + (margin - 10) * 0.8 + Math.random() * 14;      // annihilation
  if (r < 0.039) return 38 + (margin - 10) * 0.6 + Math.random() * 10;      // beatdown
  return margin;
}
function labBandFor(margin) {
  for (const b of LAB_BANDS) if (margin >= b.lo && margin <= b.hi) return b;
  return LAB_BANDS[0];
}

// Fast-forward: auto-play N lab entries with a chosen drafting strategy, running
// the real sim each game, and aggregate the results. Strategies model skill
// levels so you can see how RTP and outcomes shift with play quality.
//   'optimal' — best possible assignment of each rolled sequence
//   'good'    — strong human (greedy best-available, occasional 2nd-best)
//   'random'  — random valid picks (floor)
function labRollSequence() {
  const m = new Map();
  const note = (t, d) => { const k = t + '|' + d; if (!m.has(k)) m.set(k, { t, d }); };
  PLAYERS.forEach(p => { if (p.p !== 'OL') note(p.t, p.d); });
  UNITS.forEach(u => { if (u.p === 'OL') note(u.t, u.d); });
  const all = Array.from(m.values());
  const seq = []; const used = new Set(); let h70 = false;
  for (let r = 0; r < SLOT_ORDER.length; r++) {
    let pool = all.filter(p => !used.has(p.t + '|' + p.d) && !(h70 && p.d === '1970s'));
    if (!pool.length) pool = all;
    const pk = pool[Math.floor(Math.random() * pool.length)];
    seq.push({ t: pk.t, d: pk.d }); used.add(pk.t + '|' + pk.d); if (pk.d === '1970s') h70 = true;
  }
  return seq;
}
function labPoolFor(slotPos, pair) {
  if (slotPos === 'OL') return UNITS.filter(u => u.p === 'OL' && u.t === pair.t && u.d === pair.d);
  return PLAYERS.filter(p => p.p === slotPos && p.t === pair.t && p.d === pair.d);
}
const _posOfSlot = (s) => s === 'OL' ? 'OL' : s.startsWith('WR') ? 'WR' : s.startsWith('RB') ? 'RB' : s.startsWith('TE') ? 'TE' : s;
function labDraft(seq, strategy) {
  const roster = {};
  if (strategy === 'optimal') {
    const persp = computePerfectTeam(seq);
    persp.forEach(x => { if (x.player) roster[x.slot] = x.player; });
  } else if (strategy === 'good') {
    const open = [...SLOT_ORDER];
    for (let i = 0; i < seq.length; i++) {
      const pair = seq[i];
      const cand = open.map(s => { const pool = labPoolFor(_posOfSlot(s), pair); let b = null; for (const p of pool) if (!b || p.imp > b.imp) b = p; return { s, b }; }).filter(x => x.b).sort((a, b) => b.b.imp - a.b.imp);
      if (!cand.length) { const s = open.shift(); roster[s] = { imp: 40, p: _posOfSlot(s), s: {}, n: 'x', t: pair.t, d: pair.d }; continue; }
      const pick = (Math.random() < 0.2 && cand.length > 1) ? cand[1] : cand[0];
      roster[pick.s] = pick.b; open.splice(open.indexOf(pick.s), 1);
    }
  } else { // random
    const open = [...SLOT_ORDER];
    for (let i = 0; i < seq.length; i++) {
      const s = open.splice(Math.floor(Math.random() * open.length), 1)[0];
      const pool = labPoolFor(_posOfSlot(s), seq[i]);
      roster[s] = pool.length ? pool[Math.floor(Math.random() * pool.length)] : { imp: 35, p: _posOfSlot(s), s: {}, n: 'x', t: seq[i].t, d: seq[i].d };
    }
  }
  for (const s of SLOT_ORDER) if (!roster[s]) roster[s] = { imp: 38, p: _posOfSlot(s), s: {}, n: 'f', t: 'CHI', d: '2010s' };
  return roster;
}
function runLabBatch(N, strategy) {
  const bandHits = new Array(LAB_BANDS.length).fill(0);
  let wagered = 0, returned = 0, wins = 0, skillSum = 0, biggest = 0;
  let credits = 0, minCredits = 0, peakCredits = 0; // trajectory relative to 0
  for (let i = 0; i < N; i++) {
    const seq = labRollSequence();
    const roster = labDraft(seq, strategy);
    const beasts = assembleBeasts();
    const sim = simulateBeatdown(roster, beasts, false);
    const raw = sim.yourScore - sim.beastScore;
    const shown = labMargin(raw);
    const band = labBandFor(shown);
    const payout = band.mult * LAB_STAKE;
    wagered += LAB_STAKE; returned += payout;
    credits += payout - LAB_STAKE;
    if (credits < minCredits) minCredits = credits;
    if (credits > peakCredits) peakCredits = credits;
    if (payout > 0) wins++;
    if (payout > biggest) biggest = payout;
    bandHits[LAB_BANDS.indexOf(band)]++;
    // skill
    const yourImp = Object.values(roster).reduce((a, p) => a + (p && p.imp ? p.imp : 0), 0);
    const persp = computePerfectTeam(seq);
    const bestImp = persp.reduce((a, x) => a + (x.player ? x.player.imp : 0), 0);
    if (bestImp > 0) skillSum += Math.max(0, Math.min(100, (yourImp / bestImp) * 100));
  }
  return {
    N, strategy, wagered, returned,
    rtp: (returned / wagered) * 100,
    winPct: (wins / N) * 100,
    avgSkill: skillSum / N,
    biggest, net: returned - wagered,
    minCredits, peakCredits,
    bandHits: bandHits.map((h, i) => ({ name: LAB_BANDS[i].name, mult: LAB_BANDS[i].mult, hits: h, pct: (h / N) * 100 })),
  };
}


const SLOT_ORDER = ['QB', 'RB', 'RB2', 'WR1', 'WR2', 'WR3', 'TE', 'TE2', 'OL'];
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'OL'];
const ROUNDS = 9;
const YEARS = Array.from({ length: 55 }, (_, i) => 1970 + i);  // 1970-2024

// Warm vintage palette
const C = {
  bg: '#08070f',
  surface: '#120f1f',
  surfaceHi: '#1c1733',
  surfaceLo: '#06050c',
  border: '#2a2348',
  borderHi: '#43388a',
  text: '#f4f0ff',
  textMuted: '#9b93c4',
  textDim: '#5f5887',
  emerald: '#aaff00',
  emeraldDim: '#7ecc00',
  gold: '#ffd400',
  sky: '#00e5ff',
  field: '#0a1418',
  fieldStripe: '#0d1a1f',
};

const POS_HEX = {
  QB:  { bg: 'rgba(255,212,0,0.14)',   text: '#ffe14d', solid: '#ffd400', border: 'rgba(255,212,0,0.45)' },
  RB:  { bg: 'rgba(255,42,109,0.14)',  text: '#ff5c8a', solid: '#ff2a6d', border: 'rgba(255,42,109,0.45)' },
  WR:  { bg: 'rgba(0,229,255,0.14)',   text: '#5cf0ff', solid: '#00e5ff', border: 'rgba(0,229,255,0.45)' },
  TE:  { bg: 'rgba(189,107,255,0.14)', text: '#cf95ff', solid: '#bd6bff', border: 'rgba(189,107,255,0.45)' },
  OL:  { bg: 'rgba(255,138,0,0.14)',   text: '#ffac4d', solid: '#ff8a00', border: 'rgba(255,138,0,0.45)' },
  DEF: { bg: 'rgba(170,255,0,0.14)',   text: '#c2ff4d', solid: '#aaff00', border: 'rgba(170,255,0,0.45)' },
  // Defensive positions (Beat the Beasts)
  DE:  { bg: 'rgba(255,42,109,0.14)',  text: '#ff5c8a', solid: '#ff2a6d', border: 'rgba(255,42,109,0.48)' },
  DT:  { bg: 'rgba(255,138,0,0.14)',   text: '#ffac4d', solid: '#ff8a00', border: 'rgba(255,138,0,0.48)' },
  LB:  { bg: 'rgba(170,255,0,0.14)',   text: '#c2ff4d', solid: '#aaff00', border: 'rgba(170,255,0,0.48)' },
  CB:  { bg: 'rgba(0,229,255,0.14)',   text: '#5cf0ff', solid: '#00e5ff', border: 'rgba(0,229,255,0.48)' },
  S:   { bg: 'rgba(189,107,255,0.14)', text: '#cf95ff', solid: '#bd6bff', border: 'rgba(189,107,255,0.48)' },
  DB:  { bg: 'rgba(0,229,255,0.14)',   text: '#5cf0ff', solid: '#00e5ff', border: 'rgba(0,229,255,0.48)' },
};

const DECADE_HEX = {
  '1960s': { bg: 'rgba(255,212,0,0.16)',   text: '#ffe14d', border: 'rgba(255,212,0,0.42)' },
  '1970s': { bg: 'rgba(255,138,0,0.16)',   text: '#ffac4d', border: 'rgba(255,138,0,0.42)' },
  '1980s': { bg: 'rgba(255,42,109,0.16)',  text: '#ff5c8a', border: 'rgba(255,42,109,0.42)' },
  '1990s': { bg: 'rgba(189,107,255,0.16)', text: '#cf95ff', border: 'rgba(189,107,255,0.42)' },
  '2000s': { bg: 'rgba(0,229,255,0.16)',   text: '#5cf0ff', border: 'rgba(0,229,255,0.42)' },
  '2010s': { bg: 'rgba(0,255,179,0.16)',   text: '#4dffc4', border: 'rgba(0,255,179,0.42)' },
  '2020s': { bg: 'rgba(170,255,0,0.16)',   text: '#c2ff4d', border: 'rgba(170,255,0,0.42)' },
};

// ============================================================
// PLAYER CHARACTERIZATION (for pixel-avatar generation)
// Traits are set by the user via the in-app editor, never auto-assigned.
// Each player is keyed by name; values are indexes into the option arrays.
// ============================================================

// 5-step skin-tone ramp, light -> deep (Fitzpatrick-style swatches).
const SKIN_TONES = [
  { id: 0, label: 'Tone 1', hex: '#f2d6bd' },
  { id: 1, label: 'Tone 2', hex: '#e0b48f' },
  { id: 2, label: 'Tone 3', hex: '#c08552' },
  { id: 3, label: 'Tone 4', hex: '#8d5524' },
  { id: 4, label: 'Tone 5', hex: '#4b2e1a' },
];

// Trait metadata drives the editor UI generically.
const TRAIT_DEFS = [
  { key: 'skin',   name: 'Skin Tone',   options: SKIN_TONES,  swatch: true },
];

// ============================================================
// PLAYER DATABASE
// ============================================================
// Each player carries `ea`: an era-adjusted rating (backend only — never
// rendered in the UI). It normalizes `imp` for the league environment the
// player produced in: pre-passing-boom eras get credit (QB/WR/TE up to +4 in
// the 1970s), pass-inflated modern eras give a small discount, and modern RBs
// get a bump since current usage depresses their raw numbers.
const PLAYERS = [
  { n: "Terry Bradshaw", p: 'QB', t: 'PIT', d: '1970s', s: { y: 195, t: 1.5, i: 1.1, r: 70.9 , ry: 12 }, imp: 84, ea: 88 },
  { n: "Roger Staubach", p: 'QB', t: 'DAL', d: '1970s', s: { y: 200, t: 1.5, i: 0.9, r: 83.4 , ry: 18 }, imp: 88, ea: 92 },
  { n: "Bob Griese", p: 'QB', t: 'MIA', d: '1970s', s: { y: 175, t: 1.2, i: 0.8, r: 77.1 , ry: 8 }, imp: 82, ea: 86 },
  { n: "Ken Stabler", p: 'QB', t: 'LV', d: '1970s', s: { y: 215, t: 1.5, i: 1.1, r: 75.3 , ry: 8 }, imp: 84, ea: 88 },
  { n: "Fran Tarkenton", p: 'QB', t: 'MIN', d: '1970s', s: { y: 220, t: 1.5, i: 1, r: 76.8 , ry: 18 }, imp: 83, ea: 87 },
  { n: "Dan Fouts", p: 'QB', t: 'LAC', d: '1970s', s: { y: 270, t: 1.6, i: 1.3, r: 75.8 , ry: 2 }, imp: 85, ea: 89 },
  { n: "Ken Anderson", p: 'QB', t: 'CIN', d: '1970s', s: { y: 215, t: 1.3, i: 0.9, r: 81.9 , ry: 10 }, imp: 82, ea: 86 },
  { n: "Archie Manning", p: 'QB', t: 'NO', d: '1970s', s: { y: 200, t: 1.1, i: 1.2, r: 68.5 , ry: 18 }, imp: 75, ea: 79 },
  { n: "Jim Plunkett", p: 'QB', t: 'LV', d: '1970s', s: { y: 195, t: 1.4, i: 1.2, r: 70.1 , ry: 8 }, imp: 74, ea: 78 },
  { n: "Bert Jones", p: 'QB', t: 'IND', d: '1970s', s: { y: 215, t: 1.5, i: 1, r: 79.4 , ry: 12 }, imp: 80, ea: 84 },
  { n: "Joe Montana", p: 'QB', t: 'SF', d: '1980s', s: { y: 245, t: 1.8, i: 0.8, r: 95.6 , ry: 8 }, imp: 96, ea: 99 },
  { n: "Danny White", p: 'QB', t: 'DAL', d: '1980s', s: { y: 215, t: 1.5, i: 1.1, r: 81.7 , ry: 7 }, imp: 80, ea: 83 },
  { n: "Dan Marino", p: 'QB', t: 'MIA', d: '1980s', s: { y: 290, t: 2.2, i: 1.1, r: 90.4 , ry: 0.5 }, imp: 95, ea: 98 },
  { n: "John Elway", p: 'QB', t: 'DEN', d: '1980s', s: { y: 245, t: 1.5, i: 1, r: 78.6 , ry: 15 }, imp: 87, ea: 90 },
  { n: "Jim Kelly", p: 'QB', t: 'BUF', d: '1980s', s: { y: 240, t: 1.7, i: 1.1, r: 86.1 , ry: 8 }, imp: 86, ea: 89 },
  { n: "Warren Moon", p: 'QB', t: 'TEN', d: '1980s', s: { y: 270, t: 1.6, i: 1.2, r: 81.2 , ry: 14 }, imp: 85, ea: 88 },
  { n: "Phil Simms", p: 'QB', t: 'NYG', d: '1980s', s: { y: 215, t: 1.3, i: 1, r: 78.1 , ry: 6 }, imp: 80, ea: 83 },
  { n: "Boomer Esiason", p: 'QB', t: 'CIN', d: '1980s', s: { y: 240, t: 1.6, i: 1.1, r: 84.2 , ry: 12 }, imp: 83, ea: 86 },
  { n: "Joe Theismann", p: 'QB', t: 'WAS', d: '1980s', s: { y: 220, t: 1.5, i: 1.1, r: 81.5 , ry: 15 }, imp: 81, ea: 84 },
  { n: "Bernie Kosar", p: 'QB', t: 'CLE', d: '1980s', s: { y: 210, t: 1.3, i: 0.9, r: 81.8 , ry: 2 }, imp: 79, ea: 82 },
  { n: "Tony Eason", p: 'QB', t: 'NE', d: '1980s', s: { y: 195, t: 1.2, i: 0.9, r: 78.4 , ry: 7 }, imp: 73, ea: 76 },
  { n: "Steve Young", p: 'QB', t: 'SF', d: '1990s', s: { y: 254, t: 2, i: 0.7, r: 99.2 , ry: 28 }, imp: 95, ea: 97 },
  { n: "Brett Favre", p: 'QB', t: 'GB', d: '1990s', s: { y: 270, t: 2.1, i: 1.2, r: 87.4 , ry: 10 }, imp: 93, ea: 95 },
  { n: "Troy Aikman", p: 'QB', t: 'DAL', d: '1990s', s: { y: 235, t: 1.4, i: 0.9, r: 85.6 , ry: 4 }, imp: 88, ea: 90 },
  { n: "John Elway", p: 'QB', t: 'DEN', d: '1990s', s: { y: 250, t: 1.4, i: 1, r: 82.5 , ry: 10 }, imp: 89, ea: 91 },
  { n: "Dan Marino", p: 'QB', t: 'MIA', d: '1990s', s: { y: 265, t: 1.7, i: 1, r: 84.1 , ry: 0.5 }, imp: 90, ea: 92 },
  { n: "Warren Moon", p: 'QB', t: 'TEN', d: '1990s', s: { y: 280, t: 1.7, i: 1.1, r: 85.7 , ry: 14 }, imp: 87, ea: 89 },
  { n: "Drew Bledsoe", p: 'QB', t: 'NE', d: '1990s', s: { y: 245, t: 1.4, i: 1, r: 78.3 , ry: 1 }, imp: 82, ea: 84 },
  { n: "Jim Kelly", p: 'QB', t: 'BUF', d: '1990s', s: { y: 235, t: 1.6, i: 1.1, r: 84.7 , ry: 8 }, imp: 85, ea: 87 },
  { n: "Mark Brunell", p: 'QB', t: 'JAX', d: '1990s', s: { y: 240, t: 1.4, i: 0.9, r: 87.5 , ry: 20 }, imp: 81, ea: 83 },
  { n: "Randall Cunningham", p: 'QB', t: 'PHI', d: '1990s', s: { y: 215, t: 1.5, i: 1, r: 81.5 , ry: 30 }, imp: 84, ea: 86 },
  { n: "Peyton Manning", p: 'QB', t: 'IND', d: '2000s', s: { y: 290, t: 2.2, i: 1, r: 99.5 , ry: 1 }, imp: 96, ea: 97 },
  { n: "Tom Brady", p: 'QB', t: 'NE', d: '2000s', s: { y: 261, t: 1.9, i: 0.6, r: 96.4 , ry: 1.5 }, imp: 95, ea: 96 },
  { n: "Drew Brees", p: 'QB', t: 'NO', d: '2000s', s: { y: 295, t: 2, i: 1, r: 96.2 , ry: 2 }, imp: 92, ea: 93 },
  { n: "Brett Favre", p: 'QB', t: 'GB', d: '2000s', s: { y: 265, t: 1.8, i: 1.2, r: 89 , ry: 5 }, imp: 87, ea: 88 },
  { n: "Donovan McNabb", p: 'QB', t: 'PHI', d: '2000s', s: { y: 235, t: 1.5, i: 0.8, r: 87.9 , ry: 24 }, imp: 85, ea: 86 },
  { n: "Kurt Warner", p: 'QB', t: 'ARI', d: '2000s', s: { y: 270, t: 1.9, i: 1, r: 94.1 , ry: 2 }, imp: 86, ea: 87 },
  { n: "Carson Palmer", p: 'QB', t: 'CIN', d: '2000s', s: { y: 250, t: 1.7, i: 1, r: 88.4 , ry: 2 }, imp: 81, ea: 82 },
  { n: "Ben Roethlisberger", p: 'QB', t: 'PIT', d: '2000s', s: { y: 235, t: 1.6, i: 0.9, r: 92.5 , ry: 6 }, imp: 87, ea: 88 },
  { n: "Michael Vick", p: 'QB', t: 'ATL', d: '2000s', s: { y: 175, t: 1.2, i: 0.7, r: 75.7 , ry: 60 }, imp: 82, ea: 83 },
  { n: "Daunte Culpepper", p: 'QB', t: 'MIN', d: '2000s', s: { y: 280, t: 2, i: 1.1, r: 90.8 , ry: 28 }, imp: 84, ea: 85 },
  { n: "Eli Manning", p: 'QB', t: 'NYG', d: '2000s', s: { y: 235, t: 1.5, i: 1.1, r: 80.8 , ry: 2 }, imp: 81, ea: 82 },
  { n: "Aaron Rodgers", p: 'QB', t: 'GB', d: '2010s', s: { y: 270, t: 2.2, i: 0.4, r: 104.1 , ry: 15 }, imp: 96, ea: 96 },
  { n: "Tom Brady", p: 'QB', t: 'NE', d: '2010s', s: { y: 285, t: 2.1, i: 0.6, r: 99.2 , ry: 1.5 }, imp: 95, ea: 95 },
  { n: "Peyton Manning", p: 'QB', t: 'DEN', d: '2010s', s: { y: 305, t: 2.5, i: 1, r: 102.4 , ry: 1 }, imp: 93, ea: 93 },
  { n: "Drew Brees", p: 'QB', t: 'NO', d: '2010s', s: { y: 310, t: 2, i: 0.9, r: 101 , ry: 2 }, imp: 92, ea: 92 },
  { n: "Patrick Mahomes", p: 'QB', t: 'KC', d: '2010s', s: { y: 320, t: 2.5, i: 0.7, r: 108.9 , ry: 15 }, imp: 95, ea: 95 },
  { n: "Russell Wilson", p: 'QB', t: 'SEA', d: '2010s', s: { y: 245, t: 2, i: 0.5, r: 101.2 , ry: 28 }, imp: 88, ea: 88 },
  { n: "Cam Newton", p: 'QB', t: 'CAR', d: '2010s', s: { y: 235, t: 1.9, i: 0.8, r: 88.5 , ry: 40 }, imp: 86, ea: 86 },
  { n: "Matt Ryan", p: 'QB', t: 'ATL', d: '2010s', s: { y: 295, t: 2.1, i: 0.8, r: 99.4 , ry: 6 }, imp: 87, ea: 87 },
  { n: "Philip Rivers", p: 'QB', t: 'LAC', d: '2010s', s: { y: 285, t: 2.1, i: 1, r: 95.5 , ry: 1 }, imp: 84, ea: 84 },
  { n: "Andrew Luck", p: 'QB', t: 'IND', d: '2010s', s: { y: 275, t: 1.9, i: 0.9, r: 91.5 , ry: 7 }, imp: 84, ea: 84 },
  { n: "Ben Roethlisberger", p: 'QB', t: 'PIT', d: '2010s', s: { y: 280, t: 1.7, i: 0.9, r: 94.2 , ry: 6 }, imp: 84, ea: 84 },
  { n: "Patrick Mahomes", p: 'QB', t: 'KC', d: '2020s', s: { y: 290, t: 1.9, i: 0.7, r: 97 , ry: 15 }, imp: 95, ea: 94 },
  { n: "Josh Allen", p: 'QB', t: 'BUF', d: '2020s', s: { y: 250, t: 1.8, i: 0.6, r: 102.2 , ry: 30 }, imp: 92, ea: 91 },
  { n: "Lamar Jackson", p: 'QB', t: 'BAL', d: '2020s', s: { y: 225, t: 1.9, i: 0.5, r: 103.8 , ry: 50 }, imp: 92, ea: 91 },
  { n: "Joe Burrow", p: 'QB', t: 'CIN', d: '2020s', s: { y: 280, t: 2, i: 0.8, r: 100.8 , ry: 8 }, imp: 90, ea: 89 },
  { n: "Jalen Hurts", p: 'QB', t: 'PHI', d: '2020s', s: { y: 250, t: 1.5, i: 0.5, r: 101.5 , ry: 45 }, imp: 89, ea: 88 },
  { n: "Justin Herbert", p: 'QB', t: 'LAC', d: '2020s', s: { y: 270, t: 1.9, i: 0.6, r: 98.2 , ry: 12 }, imp: 87, ea: 86 },
  { n: "Tom Brady", p: 'QB', t: 'TB', d: '2020s', s: { y: 290, t: 2, i: 0.7, r: 99.5 , ry: 1.5 }, imp: 91, ea: 90 },
  { n: "Dak Prescott", p: 'QB', t: 'DAL', d: '2020s', s: { y: 268, t: 1.8, i: 0.6, r: 99.5 , ry: 8 }, imp: 86, ea: 85 },
  { n: "Jared Goff", p: 'QB', t: 'DET', d: '2020s', s: { y: 265, t: 2, i: 0.6, r: 105.5 , ry: 1 }, imp: 86, ea: 85 },
  { n: "Aaron Rodgers", p: 'QB', t: 'GB', d: '2020s', s: { y: 270, t: 2.5, i: 0.4, r: 111.9 , ry: 8 }, imp: 91, ea: 90 },
  { n: "C.J. Stroud", p: 'QB', t: 'HOU', d: '2020s', s: { y: 270, t: 1.6, i: 0.4, r: 100.8 , ry: 9 }, imp: 84, ea: 83 },
  { n: "Cam Ward", p: 'QB', t: 'TEN', d: '2020s', s: { y: 186, t: 0.9, i: 0.4, r: 80.2 , ry: 9 }, imp: 76, ea: 75 },
  { n: "Jaxson Dart", p: 'QB', t: 'NYG', d: '2020s', s: { y: 162, t: 1.1, i: 0.4, r: 91.7 , ry: 28 }, imp: 77, ea: 76 },
  { n: "Tyler Shough", p: 'QB', t: 'NO', d: '2020s', s: { y: 217, t: 0.9, i: 0.5, r: 91.3 , ry: 9 }, imp: 76, ea: 75 },
  { n: "J.J. McCarthy", p: 'QB', t: 'MIN', d: '2020s', s: { y: 163, t: 1.1, i: 1.2, r: 72.6 , ry: 12 }, imp: 73, ea: 72 },
  { n: "Steve Bartkowski", p: 'QB', t: 'ATL', d: '1970s', s: { y: 200, t: 1.3, i: 1, r: 72.5 , ry: 8 }, imp: 76, ea: 80 },
  { n: "Joe Ferguson", p: 'QB', t: 'BUF', d: '1970s', s: { y: 195, t: 1.2, i: 1.1, r: 71 , ry: 8 }, imp: 74, ea: 78 },
  { n: "Steve Grogan", p: 'QB', t: 'NE', d: '1970s', s: { y: 195, t: 1.3, i: 1, r: 69.5 , ry: 22 }, imp: 74, ea: 78 },
  { n: "Greg Landry", p: 'QB', t: 'DET', d: '1970s', s: { y: 190, t: 1.2, i: 0.9, r: 73 , ry: 30 }, imp: 74, ea: 78 },
  { n: "Pat Haden", p: 'QB', t: 'LAR', d: '1970s', s: { y: 195, t: 1.3, i: 1, r: 73.5 , ry: 8 }, imp: 74, ea: 78 },
  { n: "John Hadl", p: 'QB', t: 'LAC', d: '1970s', s: { y: 245, t: 1.7, i: 1.5, r: 70 , ry: 8 }, imp: 78, ea: 82 },
  { n: "Doug Williams", p: 'QB', t: 'TB', d: '1970s', s: { y: 220, t: 1.4, i: 1.4, r: 68 , ry: 10 }, imp: 76, ea: 80 },
  { n: "Brian Sipe", p: 'QB', t: 'CLE', d: '1970s', s: { y: 230, t: 1.5, i: 1.2, r: 76 , ry: 8 }, imp: 78, ea: 82 },
  { n: "Craig Morton", p: 'QB', t: 'DEN', d: '1970s', s: { y: 200, t: 1.3, i: 1.2, r: 71 , ry: 8 }, imp: 75, ea: 79 },
  { n: "Roman Gabriel", p: 'QB', t: 'PHI', d: '1970s', s: { y: 210, t: 1.3, i: 1, r: 73 , ry: 8 }, imp: 76, ea: 80 },
  { n: "Jim McMahon", p: 'QB', t: 'CHI', d: '1980s', s: { y: 200, t: 1.4, i: 1, r: 78.2 , ry: 12 }, imp: 81, ea: 84 },
  { n: "Dave Krieg", p: 'QB', t: 'SEA', d: '1980s', s: { y: 230, t: 1.6, i: 1.1, r: 82 , ry: 6 }, imp: 82, ea: 85 },
  { n: "Neil Lomax", p: 'QB', t: 'ARI', d: '1980s', s: { y: 240, t: 1.5, i: 1.1, r: 82.7 , ry: 7 }, imp: 81, ea: 84 },
  { n: "Lynn Dickey", p: 'QB', t: 'GB', d: '1980s', s: { y: 245, t: 1.6, i: 1.4, r: 75.8 , ry: 7 }, imp: 79, ea: 82 },
  { n: "Vinny Testaverde", p: 'QB', t: 'TB', d: '1980s', s: { y: 215, t: 1.3, i: 1.5, r: 70.5 , ry: 4 }, imp: 74, ea: 77 },
  { n: "Ken O'Brien", p: 'QB', t: 'NYJ', d: '1980s', s: { y: 235, t: 1.4, i: 0.8, r: 80.4 , ry: 7 }, imp: 80, ea: 83 },
  { n: "Tommy Kramer", p: 'QB', t: 'MIN', d: '1980s', s: { y: 230, t: 1.6, i: 1.4, r: 72.8 , ry: 7 }, imp: 76, ea: 79 },
  { n: "Steve DeBerg", p: 'QB', t: 'KC', d: '1980s', s: { y: 215, t: 1.4, i: 1, r: 74 , ry: 7 }, imp: 76, ea: 79 },
  { n: "Wade Wilson", p: 'QB', t: 'MIN', d: '1980s', s: { y: 215, t: 1.5, i: 1.1, r: 73 , ry: 7 }, imp: 75, ea: 78 },
  { n: "Doug Williams", p: 'QB', t: 'WAS', d: '1980s', s: { y: 200, t: 1.3, i: 1.2, r: 72 , ry: 10 }, imp: 76, ea: 79 },
  { n: "Bobby Hebert", p: 'QB', t: 'NO', d: '1980s', s: { y: 215, t: 1.4, i: 1, r: 78 , ry: 7 }, imp: 76, ea: 79 },
  { n: "Ron Jaworski", p: 'QB', t: 'PHI', d: '1980s', s: { y: 220, t: 1.4, i: 1.3, r: 73 , ry: 7 }, imp: 78, ea: 81 },
  { n: "Jim Plunkett", p: 'QB', t: 'LV', d: '1980s', s: { y: 200, t: 1.3, i: 1.2, r: 70.5 , ry: 7 }, imp: 76, ea: 79 },
  { n: "Bill Kenney", p: 'QB', t: 'KC', d: '1980s', s: { y: 220, t: 1.5, i: 1.1, r: 76 , ry: 7 }, imp: 76, ea: 79 },
  { n: "Steve McNair", p: 'QB', t: 'TEN', d: '1990s', s: { y: 215, t: 1.4, i: 0.7, r: 78 , ry: 28 }, imp: 80, ea: 82 },
  { n: "Rich Gannon", p: 'QB', t: 'KC', d: '1990s', s: { y: 210, t: 1.3, i: 0.8, r: 80 , ry: 14 }, imp: 78, ea: 80 },
  { n: "Vinny Testaverde", p: 'QB', t: 'NYJ', d: '1990s', s: { y: 245, t: 1.6, i: 1, r: 81.8 , ry: 4 }, imp: 80, ea: 82 },
  { n: "Jeff George", p: 'QB', t: 'ATL', d: '1990s', s: { y: 245, t: 1.5, i: 1, r: 78.5 , ry: 1 }, imp: 78, ea: 80 },
  { n: "Trent Dilfer", p: 'QB', t: 'TB', d: '1990s', s: { y: 195, t: 1, i: 1.1, r: 70.2 , ry: 6 }, imp: 72, ea: 74 },
  { n: "Jim Everett", p: 'QB', t: 'LAR', d: '1990s', s: { y: 240, t: 1.5, i: 1.1, r: 75.5 , ry: 6 }, imp: 78, ea: 80 },
  { n: "Phil Simms", p: 'QB', t: 'NYG', d: '1990s', s: { y: 215, t: 1.3, i: 1, r: 80 , ry: 6 }, imp: 80, ea: 82 },
  { n: "Erik Kramer", p: 'QB', t: 'CHI', d: '1990s', s: { y: 235, t: 1.6, i: 1, r: 80.5 , ry: 6 }, imp: 76, ea: 78 },
  { n: "Stan Humphries", p: 'QB', t: 'LAC', d: '1990s', s: { y: 215, t: 1.4, i: 1, r: 77 , ry: 6 }, imp: 78, ea: 80 },
  { n: "Neil O'Donnell", p: 'QB', t: 'PIT', d: '1990s', s: { y: 215, t: 1.2, i: 0.7, r: 81 , ry: 6 }, imp: 78, ea: 80 },
  { n: "Chris Chandler", p: 'QB', t: 'ATL', d: '1990s', s: { y: 240, t: 1.6, i: 0.9, r: 88 , ry: 6 }, imp: 80, ea: 82 },
  { n: "Brad Johnson", p: 'QB', t: 'MIN', d: '1990s', s: { y: 235, t: 1.4, i: 0.8, r: 84 , ry: 3 }, imp: 79, ea: 81 },
  { n: "Bernie Kosar", p: 'QB', t: 'CLE', d: '1990s', s: { y: 200, t: 1.2, i: 0.9, r: 78 , ry: 2 }, imp: 76, ea: 78 },
  { n: "Kerry Collins", p: 'QB', t: 'CAR', d: '1990s', s: { y: 215, t: 1.3, i: 1.1, r: 73.5 , ry: 3 }, imp: 75, ea: 77 },
  { n: "Steve McNair", p: 'QB', t: 'TEN', d: '2000s', s: { y: 215, t: 1.4, i: 0.7, r: 86.2 , ry: 20 }, imp: 86, ea: 87 },
  { n: "Rich Gannon", p: 'QB', t: 'LV', d: '2000s', s: { y: 245, t: 1.7, i: 0.8, r: 92 , ry: 10 }, imp: 86, ea: 87 },
  { n: "Jake Plummer", p: 'QB', t: 'DEN', d: '2000s', s: { y: 220, t: 1.3, i: 0.9, r: 81 , ry: 12 }, imp: 80, ea: 81 },
  { n: "Jake Delhomme", p: 'QB', t: 'CAR', d: '2000s', s: { y: 220, t: 1.4, i: 0.9, r: 82.4 , ry: 6 }, imp: 80, ea: 81 },
  { n: "Trent Green", p: 'QB', t: 'KC', d: '2000s', s: { y: 250, t: 1.5, i: 1, r: 87.5 , ry: 4 }, imp: 84, ea: 85 },
  { n: "Matt Hasselbeck", p: 'QB', t: 'SEA', d: '2000s', s: { y: 235, t: 1.4, i: 0.9, r: 84 , ry: 6 }, imp: 83, ea: 84 },
  { n: "Tony Romo", p: 'QB', t: 'DAL', d: '2000s', s: { y: 270, t: 1.7, i: 0.9, r: 96 , ry: 6 }, imp: 86, ea: 87 },
  { n: "Philip Rivers", p: 'QB', t: 'LAC', d: '2000s', s: { y: 250, t: 1.6, i: 0.7, r: 95.5 , ry: 1 }, imp: 84, ea: 85 },
  { n: "Jay Cutler", p: 'QB', t: 'DEN', d: '2000s', s: { y: 245, t: 1.5, i: 1.1, r: 84.3 , ry: 8 }, imp: 80, ea: 81 },
  { n: "Vince Young", p: 'QB', t: 'TEN', d: '2000s', s: { y: 175, t: 1, i: 0.7, r: 81.5 , ry: 26 }, imp: 78, ea: 79 },
  { n: "Chad Pennington", p: 'QB', t: 'NYJ', d: '2000s', s: { y: 215, t: 1.4, i: 0.6, r: 90 , ry: 4 }, imp: 80, ea: 81 },
  { n: "Marc Bulger", p: 'QB', t: 'LAR', d: '2000s', s: { y: 240, t: 1.4, i: 0.9, r: 85.2 , ry: 6 }, imp: 78, ea: 79 },
  { n: "Jeff Garcia", p: 'QB', t: 'SF', d: '2000s', s: { y: 230, t: 1.6, i: 0.8, r: 87.5 , ry: 16 }, imp: 81, ea: 82 },
  { n: "Aaron Brooks", p: 'QB', t: 'NO', d: '2000s', s: { y: 230, t: 1.5, i: 1.1, r: 76.5 , ry: 14 }, imp: 76, ea: 77 },
  { n: "David Garrard", p: 'QB', t: 'JAX', d: '2000s', s: { y: 220, t: 1.4, i: 0.6, r: 85.5 , ry: 16 }, imp: 78, ea: 79 },
  { n: "Andy Dalton", p: 'QB', t: 'CIN', d: '2010s', s: { y: 240, t: 1.5, i: 0.8, r: 87.5 , ry: 6 }, imp: 80, ea: 80 },
  { n: "Joe Flacco", p: 'QB', t: 'BAL', d: '2010s', s: { y: 230, t: 1.4, i: 0.8, r: 84.5 , ry: 4 }, imp: 82, ea: 82 },
  { n: "Alex Smith", p: 'QB', t: 'KC', d: '2010s', s: { y: 220, t: 1.4, i: 0.5, r: 92.8 , ry: 14 }, imp: 83, ea: 83 },
  { n: "Eli Manning", p: 'QB', t: 'NYG', d: '2010s', s: { y: 270, t: 1.7, i: 1, r: 84.7 , ry: 2 }, imp: 84, ea: 84 },
  { n: "Carson Wentz", p: 'QB', t: 'PHI', d: '2010s', s: { y: 245, t: 1.7, i: 0.7, r: 91 , ry: 12 }, imp: 82, ea: 82 },
  { n: "Ryan Tannehill", p: 'QB', t: 'MIA', d: '2010s', s: { y: 250, t: 1.4, i: 0.6, r: 87.5 , ry: 15 }, imp: 80, ea: 80 },
  { n: "Nick Foles", p: 'QB', t: 'PHI', d: '2010s', s: { y: 215, t: 1.5, i: 0.8, r: 88.5 , ry: 3 }, imp: 76, ea: 76 },
  { n: "Derek Carr", p: 'QB', t: 'LV', d: '2010s', s: { y: 240, t: 1.5, i: 0.6, r: 91.5 , ry: 4 }, imp: 82, ea: 82 },
  { n: "Jared Goff", p: 'QB', t: 'LAR', d: '2010s', s: { y: 250, t: 1.5, i: 0.7, r: 94 , ry: 1 }, imp: 84, ea: 84 },
  { n: "Kirk Cousins", p: 'QB', t: 'WAS', d: '2010s', s: { y: 250, t: 1.6, i: 0.7, r: 95.5 , ry: 5 }, imp: 83, ea: 83 },
  { n: "Marcus Mariota", p: 'QB', t: 'TEN', d: '2010s', s: { y: 230, t: 1.4, i: 0.6, r: 89.5 , ry: 22 }, imp: 78, ea: 78 },
  { n: "Dak Prescott", p: 'QB', t: 'DAL', d: '2010s', s: { y: 260, t: 1.6, i: 0.5, r: 97.5 , ry: 15 }, imp: 84, ea: 84 },
  { n: "Deshaun Watson", p: 'QB', t: 'HOU', d: '2010s', s: { y: 270, t: 1.8, i: 0.7, r: 100 , ry: 25 }, imp: 87, ea: 87 },
  { n: "Jameis Winston", p: 'QB', t: 'TB', d: '2010s', s: { y: 280, t: 1.7, i: 1.2, r: 87.5 , ry: 8 }, imp: 80, ea: 80 },
  { n: "Geno Smith", p: 'QB', t: 'SEA', d: '2020s', s: { y: 240, t: 1.6, i: 0.7, r: 100.5 , ry: 12 }, imp: 84, ea: 83 },
  { n: "Brock Purdy", p: 'QB', t: 'SF', d: '2020s', s: { y: 250, t: 1.7, i: 0.6, r: 105 , ry: 9 }, imp: 86, ea: 85 },
  { n: "Kirk Cousins", p: 'QB', t: 'MIN', d: '2020s', s: { y: 270, t: 1.7, i: 0.6, r: 99.5 , ry: 5 }, imp: 85, ea: 84 },
  { n: "Trevor Lawrence", p: 'QB', t: 'JAX', d: '2020s', s: { y: 240, t: 1.4, i: 0.7, r: 89.5 , ry: 14 }, imp: 82, ea: 81 },
  { n: "Kyler Murray", p: 'QB', t: 'ARI', d: '2020s', s: { y: 245, t: 1.6, i: 0.7, r: 92 , ry: 28 }, imp: 84, ea: 83 },
  { n: "Tua Tagovailoa", p: 'QB', t: 'MIA', d: '2020s', s: { y: 270, t: 1.5, i: 0.7, r: 97 , ry: 4 }, imp: 84, ea: 83 },
  { n: "Russell Wilson", p: 'QB', t: 'DEN', d: '2020s', s: { y: 220, t: 1.3, i: 0.7, r: 84 , ry: 12 }, imp: 80, ea: 79 },
  { n: "Matthew Stafford", p: 'QB', t: 'LAR', d: '2020s', s: { y: 277, t: 2.7, i: 0.5, r: 109.2 , ry: 4 }, imp: 92, ea: 91 },
  { n: "Daniel Jones", p: 'QB', t: 'NYG', d: '2020s', s: { y: 220, t: 1.2, i: 0.6, r: 84 , ry: 9 }, imp: 78, ea: 77 },
  { n: "Jordan Love", p: 'QB', t: 'GB', d: '2020s', s: { y: 240, t: 1.6, i: 0.4, r: 101.2 , ry: 9 }, imp: 84, ea: 83 },
  { n: "Baker Mayfield", p: 'QB', t: 'TB', d: '2020s', s: { y: 240, t: 1.5, i: 0.7, r: 96.5 , ry: 12 }, imp: 82, ea: 81 },
  { n: "Sam Darnold", p: 'QB', t: 'SEA', d: '2020s', s: { y: 238, t: 1.5, i: 0.8, r: 99.1 , ry: 6 }, imp: 85, ea: 84 },
  { n: "Deshaun Watson", p: 'QB', t: 'CLE', d: '2020s', s: { y: 220, t: 1.2, i: 0.7, r: 82.5 , ry: 10 }, imp: 76, ea: 75 },
  { n: "Caleb Williams", p: 'QB', t: 'CHI', d: '2020s', s: { y: 240, t: 1.6, i: 0.4, r: 90.1 , ry: 16 }, imp: 84, ea: 83 },
  { n: "Jayden Daniels", p: 'QB', t: 'WAS', d: '2020s', s: { y: 240, t: 1.4, i: 0.4, r: 100 , ry: 9 }, imp: 86, ea: 85 },
  { n: "Ryan Tannehill", p: 'QB', t: 'TEN', d: '2020s', s: { y: 230, t: 1.5, i: 0.7, r: 91.5 , ry: 10 }, imp: 78, ea: 77 },
  { n: "O.J. Simpson", p: 'RB', t: 'BUF', d: '1970s', s: { y: 143, c: 5, r: 15, t: 0.9 }, imp: 95, ea: 95 },
  { n: "Walter Payton", p: 'RB', t: 'CHI', d: '1970s', s: { y: 95, c: 4.5, r: 25, t: 0.8 }, imp: 92, ea: 92 },
  { n: "Earl Campbell", p: 'RB', t: 'TEN', d: '1970s', s: { y: 122, c: 4.6, r: 8, t: 1 }, imp: 93, ea: 93 },
  { n: "Franco Harris", p: 'RB', t: 'PIT', d: '1970s', s: { y: 82, c: 4.1, r: 12, t: 0.8 }, imp: 84, ea: 84 },
  { n: "Larry Csonka", p: 'RB', t: 'MIA', d: '1970s', s: { y: 75, c: 4.3, r: 10, t: 0.5 }, imp: 83, ea: 83 },
  { n: "Tony Dorsett", p: 'RB', t: 'DAL', d: '1970s', s: { y: 95, c: 4.7, r: 22, t: 0.7 }, imp: 87, ea: 87 },
  { n: "Chuck Foreman", p: 'RB', t: 'MIN', d: '1970s', s: { y: 75, c: 4, r: 50, t: 1 }, imp: 84, ea: 84 },
  { n: "John Riggins", p: 'RB', t: 'WAS', d: '1970s', s: { y: 80, c: 4, r: 12, t: 0.7 }, imp: 80, ea: 80 },
  { n: "Lydell Mitchell", p: 'RB', t: 'IND', d: '1970s', s: { y: 85, c: 4, r: 50, t: 0.8 }, imp: 78, ea: 78 },
  { n: "Walter Payton", p: 'RB', t: 'CHI', d: '1980s', s: { y: 95, c: 4.4, r: 30, t: 0.7 }, imp: 92, ea: 93 },
  { n: "Eric Dickerson", p: 'RB', t: 'LAR', d: '1980s', s: { y: 110, c: 4.5, r: 18, t: 0.7 }, imp: 93, ea: 94 },
  { n: "Marcus Allen", p: 'RB', t: 'LV', d: '1980s', s: { y: 85, c: 4.2, r: 38, t: 0.7 }, imp: 88, ea: 89 },
  { n: "Tony Dorsett", p: 'RB', t: 'DAL', d: '1980s', s: { y: 85, c: 4.3, r: 18, t: 0.5 }, imp: 84, ea: 85 },
  { n: "John Riggins", p: 'RB', t: 'WAS', d: '1980s', s: { y: 90, c: 4, r: 8, t: 1 }, imp: 84, ea: 85 },
  { n: "Roger Craig", p: 'RB', t: 'SF', d: '1980s', s: { y: 75, c: 4.4, r: 55, t: 0.7 }, imp: 86, ea: 87 },
  { n: "Earl Campbell", p: 'RB', t: 'TEN', d: '1980s', s: { y: 88, c: 4, r: 8, t: 0.8 }, imp: 82, ea: 83 },
  { n: "Billy Sims", p: 'RB', t: 'DET', d: '1980s', s: { y: 90, c: 4.6, r: 25, t: 0.8 }, imp: 81, ea: 82 },
  { n: "James Brooks", p: 'RB', t: 'CIN', d: '1980s', s: { y: 70, c: 4.8, r: 35, t: 0.6 }, imp: 78, ea: 79 },
  { n: "Christian Okoye", p: 'RB', t: 'KC', d: '1980s', s: { y: 75, c: 4.1, r: 5, t: 0.7 }, imp: 76, ea: 77 },
  { n: "Barry Sanders", p: 'RB', t: 'DET', d: '1990s', s: { y: 110, c: 5, r: 25, t: 0.7 }, imp: 97, ea: 98 },
  { n: "Barry Foster", p: 'RB', t: 'PIT', d: '1990s', s: { y: 92, c: 4.3, r: 14, t: 0.6 }, imp: 80, ea: 81 },
  { n: "Emmitt Smith", p: 'RB', t: 'DAL', d: '1990s', s: { y: 95, c: 4.3, r: 25, t: 1 }, imp: 95, ea: 96 },
  { n: "Terrell Davis", p: 'RB', t: 'DEN', d: '1990s', s: { y: 105, c: 4.8, r: 25, t: 1 }, imp: 90, ea: 91 },
  { n: "Marshall Faulk", p: 'RB', t: 'IND', d: '1990s', s: { y: 80, c: 4.2, r: 50, t: 0.8 }, imp: 88, ea: 89 },
  { n: "Thurman Thomas", p: 'RB', t: 'BUF', d: '1990s', s: { y: 85, c: 4.4, r: 40, t: 0.8 }, imp: 86, ea: 87 },
  { n: "Curtis Martin", p: 'RB', t: 'NE', d: '1990s', s: { y: 90, c: 4, r: 30, t: 0.7 }, imp: 84, ea: 85 },
  { n: "Jerome Bettis", p: 'RB', t: 'PIT', d: '1990s', s: { y: 90, c: 4, r: 12, t: 0.6 }, imp: 84, ea: 85 },
  { n: "Ricky Watters", p: 'RB', t: 'SF', d: '1990s', s: { y: 80, c: 4, r: 45, t: 0.7 }, imp: 81, ea: 82 },
  { n: "Edgerrin James", p: 'RB', t: 'IND', d: '1990s', s: { y: 105, c: 4.4, r: 40, t: 0.8 }, imp: 86, ea: 87 },
  { n: "LaDainian Tomlinson", p: 'RB', t: 'LAC', d: '2000s', s: { y: 105, c: 4.4, r: 45, t: 1.2 }, imp: 96, ea: 97 },
  { n: "Adrian Peterson", p: 'RB', t: 'MIN', d: '2000s', s: { y: 110, c: 4.9, r: 18, t: 0.9 }, imp: 92, ea: 93 },
  { n: "Edgerrin James", p: 'RB', t: 'IND', d: '2000s', s: { y: 95, c: 4.3, r: 35, t: 0.6 }, imp: 84, ea: 85 },
  { n: "Shaun Alexander", p: 'RB', t: 'SEA', d: '2000s', s: { y: 95, c: 4.3, r: 12, t: 1.3 }, imp: 86, ea: 87 },
  { n: "Marshall Faulk", p: 'RB', t: 'LAR', d: '2000s', s: { y: 90, c: 4.5, r: 55, t: 1 }, imp: 91, ea: 92 },
  { n: "Priest Holmes", p: 'RB', t: 'KC', d: '2000s', s: { y: 95, c: 4.4, r: 50, t: 1.4 }, imp: 88, ea: 89 },
  { n: "Tiki Barber", p: 'RB', t: 'NYG', d: '2000s', s: { y: 95, c: 5, r: 35, t: 0.6 }, imp: 84, ea: 85 },
  { n: "Frank Gore", p: 'RB', t: 'SF', d: '2000s', s: { y: 80, c: 4.4, r: 35, t: 0.5 }, imp: 82, ea: 83 },
  { n: "Steven Jackson", p: 'RB', t: 'LAR', d: '2000s', s: { y: 90, c: 4.2, r: 35, t: 0.6 }, imp: 83, ea: 84 },
  { n: "Brian Westbrook", p: 'RB', t: 'PHI', d: '2000s', s: { y: 70, c: 4.6, r: 45, t: 0.8 }, imp: 84, ea: 85 },
  { n: "Clinton Portis", p: 'RB', t: 'DEN', d: '2000s', s: { y: 90, c: 4.7, r: 20, t: 0.8 }, imp: 82, ea: 83 },
  { n: "Adrian Peterson", p: 'RB', t: 'MIN', d: '2010s', s: { y: 105, c: 5, r: 15, t: 0.8 }, imp: 92, ea: 93 },
  { n: "LeSean McCoy", p: 'RB', t: 'PHI', d: '2010s', s: { y: 90, c: 4.7, r: 35, t: 0.6 }, imp: 86, ea: 87 },
  { n: "Marshawn Lynch", p: 'RB', t: 'SEA', d: '2010s', s: { y: 95, c: 4.2, r: 18, t: 0.9 }, imp: 88, ea: 89 },
  { n: "Le'Veon Bell", p: 'RB', t: 'PIT', d: '2010s', s: { y: 85, c: 4.4, r: 50, t: 0.6 }, imp: 87, ea: 88 },
  { n: "Ezekiel Elliott", p: 'RB', t: 'DAL', d: '2010s', s: { y: 100, c: 4.7, r: 25, t: 0.7 }, imp: 86, ea: 87 },
  { n: "Todd Gurley", p: 'RB', t: 'LAR', d: '2010s', s: { y: 90, c: 4.5, r: 35, t: 1 }, imp: 87, ea: 88 },
  { n: "Arian Foster", p: 'RB', t: 'HOU', d: '2010s', s: { y: 95, c: 4.5, r: 35, t: 1 }, imp: 85, ea: 86 },
  { n: "DeMarco Murray", p: 'RB', t: 'DAL', d: '2010s', s: { y: 100, c: 4.5, r: 30, t: 0.8 }, imp: 84, ea: 85 },
  { n: "Jamaal Charles", p: 'RB', t: 'KC', d: '2010s', s: { y: 80, c: 5.5, r: 30, t: 0.7 }, imp: 87, ea: 88 },
  { n: "Christian McCaffrey", p: 'RB', t: 'CAR', d: '2010s', s: { y: 75, c: 4.5, r: 65, t: 0.8 }, imp: 88, ea: 89 },
  { n: "Derrick Henry", p: 'RB', t: 'TEN', d: '2020s', s: { y: 105, c: 4.9, r: 12, t: 0.9 }, imp: 92, ea: 94 },
  { n: "Christian McCaffrey", p: 'RB', t: 'SF', d: '2020s', s: { y: 95, c: 5, r: 50, t: 1.1 }, imp: 95, ea: 97 },
  { n: "Nick Chubb", p: 'RB', t: 'CLE', d: '2020s', s: { y: 95, c: 5.2, r: 10, t: 0.8 }, imp: 88, ea: 90 },
  { n: "Saquon Barkley", p: 'RB', t: 'NYG', d: '2020s', s: { y: 90, c: 4.5, r: 35, t: 0.7 }, imp: 88, ea: 90 },
  { n: "Jonathan Taylor", p: 'RB', t: 'IND', d: '2020s', s: { y: 93, c: 4.9, r: 22, t: 1.1 }, imp: 90, ea: 92 },
  { n: "Josh Jacobs", p: 'RB', t: 'LV', d: '2020s', s: { y: 90, c: 4.5, r: 20, t: 0.7 }, imp: 84, ea: 86 },
  { n: "Austin Ekeler", p: 'RB', t: 'LAC', d: '2020s', s: { y: 70, c: 4.4, r: 55, t: 1.1 }, imp: 84, ea: 86 },
  { n: "Bijan Robinson", p: 'RB', t: 'ATL', d: '2020s', s: { y: 87, c: 5.1, r: 35, t: 0.6 }, imp: 87, ea: 89 },
  { n: "Ashton Jeanty", p: 'RB', t: 'LV', d: '2020s', s: { y: 75, c: 4.0, r: 30, t: 0.6 }, imp: 80, ea: 82 },
  { n: "Omarion Hampton", p: 'RB', t: 'LAC', d: '2020s', s: { y: 78, c: 4.5, r: 28, t: 0.5 }, imp: 80, ea: 82 },
  { n: "TreVeyon Henderson", p: 'RB', t: 'NE', d: '2020s', s: { y: 58, c: 4.8, r: 25, t: 0.5 }, imp: 78, ea: 80 },
  { n: "Quinshon Judkins", p: 'RB', t: 'CLE', d: '2020s', s: { y: 65, c: 4.2, r: 12, t: 0.5 }, imp: 78, ea: 80 },
  { n: "Saquon Barkley", p: 'RB', t: 'PHI', d: '2020s', s: { y: 130, c: 5.8, r: 20, t: 1 }, imp: 94, ea: 96 },
  { n: "Wilbert Montgomery", p: 'RB', t: 'PHI', d: '1970s', s: { y: 85, c: 4.4, r: 35, t: 0.6 }, imp: 82, ea: 82 },
  { n: "Ottis Anderson", p: 'RB', t: 'ARI', d: '1970s', s: { y: 95, c: 4.3, r: 25, t: 0.5 }, imp: 80, ea: 80 },
  { n: "Greg Pruitt", p: 'RB', t: 'CLE', d: '1970s', s: { y: 75, c: 4.6, r: 30, t: 0.5 }, imp: 78, ea: 78 },
  { n: "Lawrence McCutcheon", p: 'RB', t: 'LAR', d: '1970s', s: { y: 80, c: 4.3, r: 18, t: 0.4 }, imp: 78, ea: 78 },
  { n: "Mike Pruitt", p: 'RB', t: 'CLE', d: '1970s', s: { y: 70, c: 4.3, r: 15, t: 0.5 }, imp: 76, ea: 76 },
  { n: "Sam Cunningham", p: 'RB', t: 'NE', d: '1970s', s: { y: 70, c: 4, r: 18, t: 0.5 }, imp: 75, ea: 75 },
  { n: "Rob Carpenter", p: 'RB', t: 'TEN', d: '1970s', s: { y: 60, c: 4, r: 12, t: 0.4 }, imp: 73, ea: 73 },
  { n: "Wendell Tyler", p: 'RB', t: 'LAR', d: '1970s', s: { y: 70, c: 4.6, r: 18, t: 0.5 }, imp: 75, ea: 75 },
  { n: "Terry Metcalf", p: 'RB', t: 'ARI', d: '1970s', s: { y: 60, c: 4.5, r: 35, t: 0.5 }, imp: 76, ea: 76 },
  { n: "Mark van Eeghen", p: 'RB', t: 'LV', d: '1970s', s: { y: 65, c: 4, r: 15, t: 0.4 }, imp: 75, ea: 75 },
  { n: "Joe Washington", p: 'RB', t: 'IND', d: '1970s', s: { y: 70, c: 4, r: 45, t: 0.5 }, imp: 77, ea: 77 },
  { n: "Ricky Bell", p: 'RB', t: 'TB', d: '1970s', s: { y: 75, c: 4, r: 12, t: 0.5 }, imp: 75, ea: 75 },
  { n: "Calvin Hill", p: 'RB', t: 'DAL', d: '1970s', s: { y: 65, c: 4.2, r: 15, t: 0.5 }, imp: 76, ea: 76 },
  { n: "Herschel Walker", p: 'RB', t: 'DAL', d: '1980s', s: { y: 95, c: 4.4, r: 35, t: 0.7 }, imp: 86, ea: 87 },
  { n: "James Wilder", p: 'RB', t: 'TB', d: '1980s', s: { y: 80, c: 4, r: 50, t: 0.5 }, imp: 80, ea: 81 },
  { n: "Joe Morris", p: 'RB', t: 'NYG', d: '1980s', s: { y: 85, c: 4.2, r: 10, t: 0.8 }, imp: 81, ea: 82 },
  { n: "Curt Warner", p: 'RB', t: 'SEA', d: '1980s', s: { y: 85, c: 4.3, r: 18, t: 0.5 }, imp: 80, ea: 81 },
  { n: "Greg Bell", p: 'RB', t: 'LAR', d: '1980s', s: { y: 85, c: 4.4, r: 20, t: 0.8 }, imp: 78, ea: 79 },
  { n: "Mike Rozier", p: 'RB', t: 'TEN', d: '1980s', s: { y: 70, c: 4, r: 18, t: 0.5 }, imp: 75, ea: 76 },
  { n: "Earnest Byner", p: 'RB', t: 'CLE', d: '1980s', s: { y: 70, c: 4.2, r: 30, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Kevin Mack", p: 'RB', t: 'CLE', d: '1980s', s: { y: 75, c: 4.2, r: 12, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Sammy Winder", p: 'RB', t: 'DEN', d: '1980s', s: { y: 65, c: 4, r: 18, t: 0.5 }, imp: 75, ea: 76 },
  { n: "William Andrews", p: 'RB', t: 'ATL', d: '1980s', s: { y: 95, c: 4.6, r: 50, t: 0.5 }, imp: 83, ea: 84 },
  { n: "Gerald Riggs", p: 'RB', t: 'ATL', d: '1980s', s: { y: 90, c: 4.3, r: 18, t: 0.6 }, imp: 80, ea: 81 },
  { n: "Neal Anderson", p: 'RB', t: 'CHI', d: '1980s', s: { y: 80, c: 4.4, r: 35, t: 0.6 }, imp: 81, ea: 82 },
  { n: "George Rogers", p: 'RB', t: 'NO', d: '1980s', s: { y: 95, c: 4, r: 8, t: 0.7 }, imp: 80, ea: 81 },
  { n: "Ottis Anderson", p: 'RB', t: 'NYG', d: '1980s', s: { y: 70, c: 3.9, r: 12, t: 0.7 }, imp: 78, ea: 79 },
  { n: "Freeman McNeil", p: 'RB', t: 'NYJ', d: '1980s', s: { y: 80, c: 4.5, r: 25, t: 0.4 }, imp: 80, ea: 81 },
  { n: "Wilbert Montgomery", p: 'RB', t: 'PHI', d: '1980s', s: { y: 70, c: 4.3, r: 25, t: 0.4 }, imp: 76, ea: 77 },
  { n: "Garrison Hearst", p: 'RB', t: 'SF', d: '1990s', s: { y: 95, c: 4.6, r: 25, t: 0.5 }, imp: 82, ea: 83 },
  { n: "Natrone Means", p: 'RB', t: 'LAC', d: '1990s', s: { y: 80, c: 4, r: 12, t: 0.6 }, imp: 78, ea: 79 },
  { n: "Rodney Hampton", p: 'RB', t: 'NYG', d: '1990s', s: { y: 80, c: 4, r: 20, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Chris Warren", p: 'RB', t: 'SEA', d: '1990s', s: { y: 80, c: 4.2, r: 25, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Ricky Watters", p: 'RB', t: 'PHI', d: '1990s', s: { y: 85, c: 4, r: 35, t: 0.5 }, imp: 80, ea: 81 },
  { n: "Robert Smith", p: 'RB', t: 'MIN', d: '1990s', s: { y: 85, c: 4.8, r: 25, t: 0.4 }, imp: 80, ea: 81 },
  { n: "Stephen Davis", p: 'RB', t: 'WAS', d: '1990s', s: { y: 95, c: 4.3, r: 12, t: 0.6 }, imp: 80, ea: 81 },
  { n: "Warrick Dunn", p: 'RB', t: 'TB', d: '1990s', s: { y: 70, c: 4, r: 35, t: 0.4 }, imp: 78, ea: 79 },
  { n: "Fred Taylor", p: 'RB', t: 'JAX', d: '1990s', s: { y: 95, c: 4.6, r: 15, t: 0.6 }, imp: 82, ea: 83 },
  { n: "Corey Dillon", p: 'RB', t: 'CIN', d: '1990s', s: { y: 95, c: 4.3, r: 12, t: 0.5 }, imp: 82, ea: 83 },
  { n: "Eddie George", p: 'RB', t: 'TEN', d: '1990s', s: { y: 95, c: 3.9, r: 15, t: 0.6 }, imp: 82, ea: 83 },
  { n: "Charlie Garner", p: 'RB', t: 'PHI', d: '1990s', s: { y: 70, c: 4.6, r: 35, t: 0.4 }, imp: 76, ea: 77 },
  { n: "Karim Abdul-Jabbar", p: 'RB', t: 'MIA', d: '1990s', s: { y: 80, c: 3.9, r: 12, t: 0.8 }, imp: 76, ea: 77 },
  { n: "James Stewart", p: 'RB', t: 'JAX', d: '1990s', s: { y: 65, c: 4, r: 15, t: 0.6 }, imp: 74, ea: 75 },
  { n: "Adrian Murrell", p: 'RB', t: 'NYJ', d: '1990s', s: { y: 70, c: 3.8, r: 20, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Larry Johnson", p: 'RB', t: 'KC', d: '2000s', s: { y: 110, c: 4.3, r: 25, t: 1.1 }, imp: 87, ea: 88 },
  { n: "Willis McGahee", p: 'RB', t: 'BUF', d: '2000s', s: { y: 85, c: 4, r: 15, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Maurice Jones-Drew", p: 'RB', t: 'JAX', d: '2000s', s: { y: 85, c: 4.5, r: 40, t: 0.8 }, imp: 84, ea: 85 },
  { n: "Thomas Jones", p: 'RB', t: 'CHI', d: '2000s', s: { y: 85, c: 4, r: 20, t: 0.4 }, imp: 78, ea: 79 },
  { n: "Ricky Williams", p: 'RB', t: 'MIA', d: '2000s', s: { y: 100, c: 4.2, r: 25, t: 0.6 }, imp: 82, ea: 83 },
  { n: "Warrick Dunn", p: 'RB', t: 'ATL', d: '2000s', s: { y: 75, c: 4.5, r: 35, t: 0.4 }, imp: 78, ea: 79 },
  { n: "Deuce McAllister", p: 'RB', t: 'NO', d: '2000s', s: { y: 90, c: 4.4, r: 25, t: 0.5 }, imp: 80, ea: 81 },
  { n: "Cedric Benson", p: 'RB', t: 'CIN', d: '2000s', s: { y: 80, c: 4, r: 20, t: 0.4 }, imp: 76, ea: 77 },
  { n: "Domanick Davis", p: 'RB', t: 'HOU', d: '2000s', s: { y: 75, c: 4, r: 35, t: 0.6 }, imp: 76, ea: 77 },
  { n: "Chester Taylor", p: 'RB', t: 'MIN', d: '2000s', s: { y: 65, c: 4.2, r: 35, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Rudi Johnson", p: 'RB', t: 'CIN', d: '2000s', s: { y: 90, c: 4, r: 15, t: 0.7 }, imp: 78, ea: 79 },
  { n: "Fred Taylor", p: 'RB', t: 'JAX', d: '2000s', s: { y: 75, c: 4.4, r: 18, t: 0.4 }, imp: 78, ea: 79 },
  { n: "Ronnie Brown", p: 'RB', t: 'MIA', d: '2000s', s: { y: 70, c: 4.3, r: 30, t: 0.5 }, imp: 76, ea: 77 },
  { n: "DeAngelo Williams", p: 'RB', t: 'CAR', d: '2000s', s: { y: 75, c: 4.7, r: 18, t: 0.6 }, imp: 78, ea: 79 },
  { n: "Corey Dillon", p: 'RB', t: 'NE', d: '2000s', s: { y: 90, c: 4.1, r: 12, t: 0.6 }, imp: 78, ea: 79 },
  { n: "Michael Turner", p: 'RB', t: 'ATL', d: '2000s', s: { y: 95, c: 4.5, r: 8, t: 0.8 }, imp: 80, ea: 81 },
  { n: "Doug Martin", p: 'RB', t: 'TB', d: '2010s', s: { y: 85, c: 4.3, r: 25, t: 0.5 }, imp: 80, ea: 81 },
  { n: "Matt Forte", p: 'RB', t: 'CHI', d: '2010s', s: { y: 85, c: 4.5, r: 50, t: 0.5 }, imp: 84, ea: 85 },
  { n: "Alfred Morris", p: 'RB', t: 'WAS', d: '2010s', s: { y: 90, c: 4.3, r: 10, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Lamar Miller", p: 'RB', t: 'MIA', d: '2010s', s: { y: 80, c: 4.5, r: 30, t: 0.4 }, imp: 77, ea: 78 },
  { n: "Mark Ingram II", p: 'RB', t: 'NO', d: '2010s', s: { y: 80, c: 4.6, r: 25, t: 0.5 }, imp: 80, ea: 81 },
  { n: "Jordan Howard", p: 'RB', t: 'CHI', d: '2010s', s: { y: 85, c: 4.2, r: 10, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Devonta Freeman", p: 'RB', t: 'ATL', d: '2010s', s: { y: 75, c: 4, r: 35, t: 0.7 }, imp: 80, ea: 81 },
  { n: "Melvin Gordon", p: 'RB', t: 'LAC', d: '2010s', s: { y: 75, c: 3.9, r: 30, t: 0.7 }, imp: 78, ea: 79 },
  { n: "David Johnson", p: 'RB', t: 'ARI', d: '2010s', s: { y: 85, c: 4.5, r: 45, t: 0.8 }, imp: 84, ea: 85 },
  { n: "Kareem Hunt", p: 'RB', t: 'KC', d: '2010s', s: { y: 85, c: 5, r: 35, t: 0.5 }, imp: 82, ea: 83 },
  { n: "Alvin Kamara", p: 'RB', t: 'NO', d: '2010s', s: { y: 70, c: 5, r: 65, t: 0.8 }, imp: 87, ea: 88 },
  { n: "Dalvin Cook", p: 'RB', t: 'MIN', d: '2010s', s: { y: 90, c: 4.6, r: 35, t: 0.6 }, imp: 84, ea: 85 },
  { n: "Aaron Jones", p: 'RB', t: 'GB', d: '2010s', s: { y: 75, c: 5, r: 30, t: 0.7 }, imp: 82, ea: 83 },
  { n: "Frank Gore", p: 'RB', t: 'IND', d: '2010s', s: { y: 60, c: 3.8, r: 20, t: 0.3 }, imp: 75, ea: 76 },
  { n: "James White", p: 'RB', t: 'NE', d: '2010s', s: { y: 35, c: 4, r: 55, t: 0.6 }, imp: 78, ea: 79 },
  { n: "Carlos Hyde", p: 'RB', t: 'SF', d: '2010s', s: { y: 70, c: 4, r: 15, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Joe Mixon", p: 'RB', t: 'CIN', d: '2020s', s: { y: 75, c: 4.2, r: 30, t: 0.5 }, imp: 82, ea: 84 },
  { n: "Tony Pollard", p: 'RB', t: 'DAL', d: '2020s', s: { y: 70, c: 4.8, r: 25, t: 0.5 }, imp: 80, ea: 82 },
  { n: "Aaron Jones", p: 'RB', t: 'GB', d: '2020s', s: { y: 80, c: 5, r: 35, t: 0.6 }, imp: 84, ea: 86 },
  { n: "Najee Harris", p: 'RB', t: 'PIT', d: '2020s', s: { y: 80, c: 4, r: 30, t: 0.5 }, imp: 80, ea: 82 },
  { n: "Breece Hall", p: 'RB', t: 'NYJ', d: '2020s', s: { y: 75, c: 4.8, r: 40, t: 0.4 }, imp: 82, ea: 84 },
  { n: "Kenneth Walker III", p: 'RB', t: 'SEA', d: '2020s', s: { y: 75, c: 4.4, r: 20, t: 0.6 }, imp: 80, ea: 82 },
  { n: "David Montgomery", p: 'RB', t: 'DET', d: '2020s', s: { y: 70, c: 4.4, r: 18, t: 0.7 }, imp: 80, ea: 82 },
  { n: "Rachaad White", p: 'RB', t: 'TB', d: '2020s', s: { y: 65, c: 3.9, r: 40, t: 0.4 }, imp: 76, ea: 78 },
  { n: "James Conner", p: 'RB', t: 'ARI', d: '2020s', s: { y: 75, c: 4.3, r: 25, t: 0.7 }, imp: 80, ea: 82 },
  { n: "De'Von Achane", p: 'RB', t: 'MIA', d: '2020s', s: { y: 85, c: 5.8, r: 35, t: 0.7 }, imp: 84, ea: 86 },
  { n: "Rhamondre Stevenson", p: 'RB', t: 'NE', d: '2020s', s: { y: 75, c: 4.5, r: 25, t: 0.4 }, imp: 78, ea: 80 },
  { n: "Isiah Pacheco", p: 'RB', t: 'KC', d: '2020s', s: { y: 75, c: 4.5, r: 15, t: 0.5 }, imp: 78, ea: 80 },
  { n: "Alvin Kamara", p: 'RB', t: 'NO', d: '2020s', s: { y: 65, c: 4.4, r: 60, t: 0.6 }, imp: 84, ea: 86 },
  { n: "James Cook", p: 'RB', t: 'BUF', d: '2020s', s: { y: 95, c: 5.2, r: 20, t: 0.7 }, imp: 85, ea: 87 },
  { n: "Javonte Williams", p: 'RB', t: 'DEN', d: '2020s', s: { y: 65, c: 4.2, r: 25, t: 0.4 }, imp: 76, ea: 78 },
  { n: "Lynn Swann", p: 'WR', t: 'PIT', d: '1970s', s: { y: 50, p: 10.5, t: 0.6, c: 55 }, imp: 81, ea: 85 },
  { n: "John Stallworth", p: 'WR', t: 'PIT', d: '1970s', s: { y: 55, p: 11, t: 0.5, c: 53 }, imp: 80, ea: 84 },
  { n: "Drew Pearson", p: 'WR', t: 'DAL', d: '1970s', s: { y: 60, p: 9.5, t: 0.4, c: 58 }, imp: 81, ea: 85 },
  { n: "Cliff Branch", p: 'WR', t: 'LV', d: '1970s', s: { y: 70, p: 12, t: 0.6, c: 50 }, imp: 84, ea: 88 },
  { n: "Harold Carmichael", p: 'WR', t: 'PHI', d: '1970s', s: { y: 75, p: 9, t: 0.5, c: 54 }, imp: 83, ea: 87 },
  { n: "Steve Largent", p: 'WR', t: 'SEA', d: '1970s', s: { y: 75, p: 9.5, t: 0.5, c: 60 }, imp: 85, ea: 89 },
  { n: "Paul Warfield", p: 'WR', t: 'MIA', d: '1970s', s: { y: 50, p: 14, t: 0.7, c: 56 }, imp: 84, ea: 88 },
  { n: "Charlie Joiner", p: 'WR', t: 'LAC', d: '1970s', s: { y: 65, p: 9, t: 0.4, c: 60 }, imp: 80, ea: 84 },
  { n: "Jerry Rice", p: 'WR', t: 'SF', d: '1980s', s: { y: 110, p: 11, t: 1.2, c: 65 }, imp: 95, ea: 98 },
  { n: "Steve Largent", p: 'WR', t: 'SEA', d: '1980s', s: { y: 90, p: 9.5, t: 0.7, c: 62 }, imp: 90, ea: 93 },
  { n: "Art Monk", p: 'WR', t: 'WAS', d: '1980s', s: { y: 75, p: 8.5, t: 0.4, c: 65 }, imp: 84, ea: 87 },
  { n: "James Lofton", p: 'WR', t: 'GB', d: '1980s', s: { y: 80, p: 11, t: 0.5, c: 58 }, imp: 84, ea: 87 },
  { n: "Andre Reed", p: 'WR', t: 'BUF', d: '1980s', s: { y: 75, p: 9, t: 0.6, c: 60 }, imp: 84, ea: 87 },
  { n: "Mark Clayton", p: 'WR', t: 'MIA', d: '1980s', s: { y: 75, p: 10.5, t: 0.8, c: 58 }, imp: 85, ea: 88 },
  { n: "Mark Duper", p: 'WR', t: 'MIA', d: '1980s', s: { y: 80, p: 11.5, t: 0.6, c: 55 }, imp: 84, ea: 87 },
  { n: "Cris Carter", p: 'WR', t: 'PHI', d: '1980s', s: { y: 60, p: 8, t: 0.7, c: 58 }, imp: 78, ea: 81 },
  { n: "Roy Green", p: 'WR', t: 'ARI', d: '1980s', s: { y: 75, p: 11, t: 0.5, c: 56 }, imp: 81, ea: 84 },
  { n: "Stanley Morgan", p: 'WR', t: 'NE', d: '1980s', s: { y: 65, p: 13, t: 0.5, c: 55 }, imp: 80, ea: 83 },
  { n: "Drew Hill", p: 'WR', t: 'TEN', d: '1980s', s: { y: 75, p: 11, t: 0.5, c: 56 }, imp: 80, ea: 83 },
  { n: "Jerry Rice", p: 'WR', t: 'SF', d: '1990s', s: { y: 95, p: 10.5, t: 0.8, c: 68 }, imp: 95, ea: 97 },
  { n: "Cris Carter", p: 'WR', t: 'MIN', d: '1990s', s: { y: 80, p: 8.5, t: 0.8, c: 65 }, imp: 89, ea: 91 },
  { n: "Michael Irvin", p: 'WR', t: 'DAL', d: '1990s', s: { y: 85, p: 11, t: 0.5, c: 60 }, imp: 87, ea: 89 },
  { n: "Randy Moss", p: 'WR', t: 'MIN', d: '1990s', s: { y: 85, p: 14, t: 1, c: 55 }, imp: 92, ea: 94 },
  { n: "Terrell Owens", p: 'WR', t: 'SF', d: '1990s', s: { y: 70, p: 11, t: 0.5, c: 62 }, imp: 83, ea: 85 },
  { n: "Marvin Harrison", p: 'WR', t: 'IND', d: '1990s', s: { y: 80, p: 10.5, t: 0.7, c: 65 }, imp: 87, ea: 89 },
  { n: "Tim Brown", p: 'WR', t: 'LV', d: '1990s', s: { y: 80, p: 9.5, t: 0.5, c: 62 }, imp: 86, ea: 88 },
  { n: "Andre Rison", p: 'WR', t: 'ATL', d: '1990s', s: { y: 75, p: 10, t: 0.6, c: 60 }, imp: 82, ea: 84 },
  { n: "Sterling Sharpe", p: 'WR', t: 'GB', d: '1990s', s: { y: 85, p: 10.5, t: 0.7, c: 62 }, imp: 86, ea: 88 },
  { n: "Herman Moore", p: 'WR', t: 'DET', d: '1990s', s: { y: 85, p: 9.5, t: 0.5, c: 65 }, imp: 84, ea: 86 },
  { n: "Isaac Bruce", p: 'WR', t: 'LAR', d: '1990s', s: { y: 85, p: 11.5, t: 0.5, c: 60 }, imp: 84, ea: 86 },
  { n: "Randy Moss", p: 'WR', t: 'NE', d: '2000s', s: { y: 95, p: 13.5, t: 1, c: 56 }, imp: 95, ea: 96 },
  { n: "Terrell Owens", p: 'WR', t: 'PHI', d: '2000s', s: { y: 85, p: 11, t: 0.7, c: 60 }, imp: 90, ea: 91 },
  { n: "Marvin Harrison", p: 'WR', t: 'IND', d: '2000s', s: { y: 100, p: 11, t: 0.8, c: 67 }, imp: 92, ea: 93 },
  { n: "Chad Johnson", p: 'WR', t: 'CIN', d: '2000s', s: { y: 85, p: 11, t: 0.5, c: 60 }, imp: 86, ea: 87 },
  { n: "Reggie Wayne", p: 'WR', t: 'IND', d: '2000s', s: { y: 90, p: 11, t: 0.6, c: 65 }, imp: 87, ea: 88 },
  { n: "Larry Fitzgerald", p: 'WR', t: 'ARI', d: '2000s', s: { y: 95, p: 10.5, t: 0.7, c: 65 }, imp: 92, ea: 93 },
  { n: "Andre Johnson", p: 'WR', t: 'HOU', d: '2000s', s: { y: 95, p: 10.5, t: 0.5, c: 65 }, imp: 89, ea: 90 },
  { n: "Torry Holt", p: 'WR', t: 'LAR', d: '2000s', s: { y: 85, p: 10.5, t: 0.5, c: 65 }, imp: 86, ea: 87 },
  { n: "Hines Ward", p: 'WR', t: 'PIT', d: '2000s', s: { y: 70, p: 9.5, t: 0.6, c: 65 }, imp: 82, ea: 83 },
  { n: "Wes Welker", p: 'WR', t: 'NE', d: '2000s', s: { y: 80, p: 9, t: 0.4, c: 73 }, imp: 84, ea: 85 },
  { n: "Calvin Johnson", p: 'WR', t: 'DET', d: '2000s', s: { y: 85, p: 12.5, t: 0.7, c: 60 }, imp: 90, ea: 91 },
  { n: "Calvin Johnson", p: 'WR', t: 'DET', d: '2010s', s: { y: 110, p: 12.5, t: 0.7, c: 60 }, imp: 95, ea: 95 },
  { n: "Antonio Brown", p: 'WR', t: 'PIT', d: '2010s', s: { y: 105, p: 10, t: 0.6, c: 70 }, imp: 95, ea: 95 },
  { n: "Julio Jones", p: 'WR', t: 'ATL', d: '2010s', s: { y: 110, p: 11.5, t: 0.5, c: 65 }, imp: 93, ea: 93 },
  { n: "Larry Fitzgerald", p: 'WR', t: 'ARI', d: '2010s', s: { y: 80, p: 9.5, t: 0.5, c: 70 }, imp: 87, ea: 87 },
  { n: "A.J. Green", p: 'WR', t: 'CIN', d: '2010s', s: { y: 95, p: 11, t: 0.6, c: 60 }, imp: 88, ea: 88 },
  { n: "Dez Bryant", p: 'WR', t: 'DAL', d: '2010s', s: { y: 85, p: 11, t: 0.8, c: 60 }, imp: 86, ea: 86 },
  { n: "DeAndre Hopkins", p: 'WR', t: 'HOU', d: '2010s', s: { y: 90, p: 9.5, t: 0.6, c: 65 }, imp: 90, ea: 90 },
  { n: "Odell Beckham Jr.", p: 'WR', t: 'NYG', d: '2010s', s: { y: 95, p: 11, t: 0.7, c: 65 }, imp: 88, ea: 88 },
  { n: "Mike Evans", p: 'WR', t: 'TB', d: '2010s', s: { y: 90, p: 11.5, t: 0.6, c: 55 }, imp: 87, ea: 87 },
  { n: "Davante Adams", p: 'WR', t: 'GB', d: '2010s', s: { y: 85, p: 10, t: 0.8, c: 65 }, imp: 88, ea: 88 },
  { n: "Tyreek Hill", p: 'WR', t: 'KC', d: '2010s', s: { y: 80, p: 12, t: 0.6, c: 65 }, imp: 88, ea: 88 },
  { n: "Justin Jefferson", p: 'WR', t: 'MIN', d: '2020s', s: { y: 105, p: 11.5, t: 0.5, c: 70 }, imp: 95, ea: 94 },
  { n: "Tyreek Hill", p: 'WR', t: 'MIA', d: '2020s', s: { y: 105, p: 11.5, t: 0.6, c: 70 }, imp: 94, ea: 93 },
  { n: "Davante Adams", p: 'WR', t: 'LV', d: '2020s', s: { y: 90, p: 10.5, t: 0.7, c: 65 }, imp: 90, ea: 89 },
  { n: "Stefon Diggs", p: 'WR', t: 'BUF', d: '2020s', s: { y: 95, p: 10, t: 0.5, c: 70 }, imp: 88, ea: 87 },
  { n: "CeeDee Lamb", p: 'WR', t: 'DAL', d: '2020s', s: { y: 95, p: 11, t: 0.6, c: 70 }, imp: 89, ea: 88 },
  { n: "Cooper Kupp", p: 'WR', t: 'LAR', d: '2020s', s: { y: 100, p: 10.5, t: 0.6, c: 75 }, imp: 91, ea: 90 },
  { n: "Ja'Marr Chase", p: 'WR', t: 'CIN', d: '2020s', s: { y: 88, p: 11.3, t: 0.5, c: 125 }, imp: 90, ea: 89 },
  { n: "A.J. Brown", p: 'WR', t: 'PHI', d: '2020s', s: { y: 95, p: 11.5, t: 0.6, c: 65 }, imp: 88, ea: 87 },
  { n: "Amon-Ra St. Brown", p: 'WR', t: 'DET', d: '2020s', s: { y: 82, p: 12, t: 0.6, c: 117 }, imp: 88, ea: 87 },
  { n: "Puka Nacua", p: 'WR', t: 'LAR', d: '2020s', s: { y: 107, p: 13.3, t: 0.6, c: 129 }, imp: 89, ea: 88 },
  { n: "Tetairoa McMillan", p: 'WR', t: 'CAR', d: '2020s', s: { y: 60, p: 14.5, t: 0.4, c: 70 }, imp: 80, ea: 79 },
  { n: "Emeka Egbuka", p: 'WR', t: 'TB', d: '2020s', s: { y: 55, p: 14.9, t: 0.4, c: 63 }, imp: 78, ea: 77 },
  { n: "DK Metcalf", p: 'WR', t: 'SEA', d: '2020s', s: { y: 75, p: 11, t: 0.5, c: 60 }, imp: 84, ea: 83 },
  { n: "Mel Gray", p: 'WR', t: 'ARI', d: '1970s', s: { y: 60, p: 11.5, t: 0.5, c: 52 }, imp: 78, ea: 82 },
  { n: "Roger Carr", p: 'WR', t: 'IND', d: '1970s', s: { y: 60, p: 12.5, t: 0.5, c: 50 }, imp: 76, ea: 80 },
  { n: "Ahmad Rashad", p: 'WR', t: 'MIN', d: '1970s', s: { y: 65, p: 10.5, t: 0.4, c: 60 }, imp: 80, ea: 84 },
  { n: "Wesley Walker", p: 'WR', t: 'NYJ', d: '1970s', s: { y: 65, p: 13.5, t: 0.5, c: 50 }, imp: 78, ea: 82 },
  { n: "Sammy White", p: 'WR', t: 'MIN', d: '1970s', s: { y: 55, p: 10.5, t: 0.5, c: 52 }, imp: 76, ea: 80 },
  { n: "Frank Lewis", p: 'WR', t: 'BUF', d: '1970s', s: { y: 60, p: 12, t: 0.4, c: 52 }, imp: 75, ea: 79 },
  { n: "Ken Burrough", p: 'WR', t: 'TEN', d: '1970s', s: { y: 70, p: 12, t: 0.4, c: 52 }, imp: 77, ea: 81 },
  { n: "Isaac Curtis", p: 'WR', t: 'CIN', d: '1970s', s: { y: 55, p: 13, t: 0.5, c: 50 }, imp: 77, ea: 81 },
  { n: "Gene Washington", p: 'WR', t: 'SF', d: '1970s', s: { y: 65, p: 12.5, t: 0.5, c: 50 }, imp: 78, ea: 82 },
  { n: "John Gilliam", p: 'WR', t: 'MIN', d: '1970s', s: { y: 60, p: 11.5, t: 0.5, c: 50 }, imp: 76, ea: 80 },
  { n: "Harold Jackson", p: 'WR', t: 'LAR', d: '1970s', s: { y: 65, p: 12, t: 0.4, c: 52 }, imp: 76, ea: 80 },
  { n: "Otis Taylor", p: 'WR', t: 'KC', d: '1970s', s: { y: 60, p: 11, t: 0.4, c: 53 }, imp: 76, ea: 80 },
  { n: "Anthony Carter", p: 'WR', t: 'MIN', d: '1980s', s: { y: 65, p: 12, t: 0.5, c: 55 }, imp: 80, ea: 83 },
  { n: "Henry Ellard", p: 'WR', t: 'LAR', d: '1980s', s: { y: 80, p: 12.5, t: 0.5, c: 58 }, imp: 82, ea: 85 },
  { n: "Ricky Sanders", p: 'WR', t: 'WAS', d: '1980s', s: { y: 65, p: 10.5, t: 0.5, c: 58 }, imp: 78, ea: 81 },
  { n: "Eric Martin", p: 'WR', t: 'NO', d: '1980s', s: { y: 70, p: 10.5, t: 0.4, c: 60 }, imp: 78, ea: 81 },
  { n: "Gary Clark", p: 'WR', t: 'WAS', d: '1980s', s: { y: 75, p: 11, t: 0.5, c: 60 }, imp: 82, ea: 85 },
  { n: "Webster Slaughter", p: 'WR', t: 'CLE', d: '1980s', s: { y: 65, p: 11.5, t: 0.4, c: 56 }, imp: 78, ea: 81 },
  { n: "Al Toon", p: 'WR', t: 'NYJ', d: '1980s', s: { y: 75, p: 10, t: 0.4, c: 60 }, imp: 82, ea: 85 },
  { n: "Mike Quick", p: 'WR', t: 'PHI', d: '1980s', s: { y: 70, p: 12.5, t: 0.5, c: 55 }, imp: 82, ea: 85 },
  { n: "Eddie Brown", p: 'WR', t: 'CIN', d: '1980s', s: { y: 65, p: 13, t: 0.4, c: 55 }, imp: 78, ea: 81 },
  { n: "Stephone Paige", p: 'WR', t: 'KC', d: '1980s', s: { y: 60, p: 12.5, t: 0.4, c: 55 }, imp: 76, ea: 79 },
  { n: "Carlos Carson", p: 'WR', t: 'KC', d: '1980s', s: { y: 60, p: 12, t: 0.4, c: 56 }, imp: 76, ea: 79 },
  { n: "Anthony Miller", p: 'WR', t: 'LAC', d: '1980s', s: { y: 65, p: 12.5, t: 0.6, c: 55 }, imp: 80, ea: 83 },
  { n: "Steve Watson", p: 'WR', t: 'DEN', d: '1980s', s: { y: 65, p: 13.5, t: 0.5, c: 53 }, imp: 78, ea: 81 },
  { n: "Mervyn Fernandez", p: 'WR', t: 'LV', d: '1980s', s: { y: 60, p: 13, t: 0.4, c: 53 }, imp: 76, ea: 79 },
  { n: "Vance Johnson", p: 'WR', t: 'DEN', d: '1980s', s: { y: 55, p: 11, t: 0.4, c: 58 }, imp: 75, ea: 78 },
  { n: "Rod Smith", p: 'WR', t: 'DEN', d: '1990s', s: { y: 75, p: 11, t: 0.4, c: 60 }, imp: 80, ea: 82 },
  { n: "Joey Galloway", p: 'WR', t: 'SEA', d: '1990s', s: { y: 75, p: 11.5, t: 0.5, c: 55 }, imp: 80, ea: 82 },
  { n: "Eric Moulds", p: 'WR', t: 'BUF', d: '1990s', s: { y: 75, p: 10.5, t: 0.4, c: 60 }, imp: 80, ea: 82 },
  { n: "Keenan McCardell", p: 'WR', t: 'JAX', d: '1990s', s: { y: 70, p: 10, t: 0.3, c: 62 }, imp: 78, ea: 80 },
  { n: "Robert Brooks", p: 'WR', t: 'GB', d: '1990s', s: { y: 70, p: 10.5, t: 0.4, c: 58 }, imp: 78, ea: 80 },
  { n: "Antonio Freeman", p: 'WR', t: 'GB', d: '1990s', s: { y: 75, p: 11, t: 0.7, c: 60 }, imp: 82, ea: 84 },
  { n: "Carl Pickens", p: 'WR', t: 'CIN', d: '1990s', s: { y: 75, p: 11, t: 0.7, c: 60 }, imp: 80, ea: 82 },
  { n: "Yancey Thigpen", p: 'WR', t: 'PIT', d: '1990s', s: { y: 75, p: 11.5, t: 0.5, c: 58 }, imp: 78, ea: 80 },
  { n: "Tony Martin", p: 'WR', t: 'LAC', d: '1990s', s: { y: 75, p: 13, t: 0.4, c: 55 }, imp: 78, ea: 80 },
  { n: "Curtis Conway", p: 'WR', t: 'CHI', d: '1990s', s: { y: 70, p: 11, t: 0.4, c: 58 }, imp: 76, ea: 78 },
  { n: "Andre Reed", p: 'WR', t: 'BUF', d: '1990s', s: { y: 70, p: 10, t: 0.4, c: 62 }, imp: 80, ea: 82 },
  { n: "Brett Perriman", p: 'WR', t: 'DET', d: '1990s', s: { y: 75, p: 9.5, t: 0.3, c: 65 }, imp: 76, ea: 78 },
  { n: "Jake Reed", p: 'WR', t: 'MIN', d: '1990s', s: { y: 70, p: 12, t: 0.3, c: 55 }, imp: 76, ea: 78 },
  { n: "Henry Ellard", p: 'WR', t: 'WAS', d: '1990s', s: { y: 70, p: 12, t: 0.3, c: 58 }, imp: 78, ea: 80 },
  { n: "Anthony Miller", p: 'WR', t: 'DEN', d: '1990s', s: { y: 70, p: 12, t: 0.6, c: 55 }, imp: 78, ea: 80 },
  { n: "Bill Brooks", p: 'WR', t: 'IND', d: '1990s', s: { y: 65, p: 11, t: 0.3, c: 60 }, imp: 76, ea: 78 },
  { n: "Webster Slaughter", p: 'WR', t: 'TEN', d: '1990s', s: { y: 65, p: 12, t: 0.3, c: 56 }, imp: 75, ea: 77 },
  { n: "Anquan Boldin", p: 'WR', t: 'ARI', d: '2000s', s: { y: 90, p: 9.5, t: 0.5, c: 65 }, imp: 86, ea: 87 },
  { n: "Brandon Marshall", p: 'WR', t: 'DEN', d: '2000s', s: { y: 95, p: 10.5, t: 0.5, c: 65 }, imp: 86, ea: 87 },
  { n: "Roddy White", p: 'WR', t: 'ATL', d: '2000s', s: { y: 80, p: 11, t: 0.5, c: 60 }, imp: 82, ea: 83 },
  { n: "Vincent Jackson", p: 'WR', t: 'LAC', d: '2000s', s: { y: 80, p: 13.5, t: 0.5, c: 55 }, imp: 82, ea: 83 },
  { n: "Greg Jennings", p: 'WR', t: 'GB', d: '2000s', s: { y: 80, p: 11, t: 0.7, c: 60 }, imp: 82, ea: 83 },
  { n: "DeSean Jackson", p: 'WR', t: 'PHI', d: '2000s', s: { y: 75, p: 14.5, t: 0.4, c: 55 }, imp: 82, ea: 83 },
  { n: "Sidney Rice", p: 'WR', t: 'MIN', d: '2000s', s: { y: 70, p: 11.5, t: 0.5, c: 60 }, imp: 78, ea: 79 },
  { n: "Lee Evans", p: 'WR', t: 'BUF', d: '2000s', s: { y: 75, p: 13.5, t: 0.5, c: 53 }, imp: 80, ea: 81 },
  { n: "Joe Horn", p: 'WR', t: 'NO', d: '2000s', s: { y: 80, p: 10.5, t: 0.5, c: 62 }, imp: 82, ea: 83 },
  { n: "Derrick Mason", p: 'WR', t: 'BAL', d: '2000s', s: { y: 75, p: 10.5, t: 0.3, c: 65 }, imp: 80, ea: 81 },
  { n: "Santonio Holmes", p: 'WR', t: 'PIT', d: '2000s', s: { y: 70, p: 12, t: 0.5, c: 60 }, imp: 80, ea: 81 },
  { n: "Donald Driver", p: 'WR', t: 'GB', d: '2000s', s: { y: 75, p: 10.5, t: 0.4, c: 60 }, imp: 80, ea: 81 },
  { n: "Plaxico Burress", p: 'WR', t: 'NYG', d: '2000s', s: { y: 70, p: 11, t: 0.5, c: 55 }, imp: 80, ea: 81 },
  { n: "Muhsin Muhammad", p: 'WR', t: 'CAR', d: '2000s', s: { y: 75, p: 11, t: 0.4, c: 60 }, imp: 78, ea: 79 },
  { n: "Amani Toomer", p: 'WR', t: 'NYG', d: '2000s', s: { y: 65, p: 10.5, t: 0.3, c: 60 }, imp: 76, ea: 77 },
  { n: "Mike Wallace", p: 'WR', t: 'PIT', d: '2000s', s: { y: 70, p: 15, t: 0.5, c: 55 }, imp: 80, ea: 81 },
  { n: "Brandon Marshall", p: 'WR', t: 'CHI', d: '2010s', s: { y: 95, p: 10.5, t: 0.7, c: 65 }, imp: 88, ea: 88 },
  { n: "Marques Colston", p: 'WR', t: 'NO', d: '2010s', s: { y: 75, p: 10.5, t: 0.5, c: 65 }, imp: 80, ea: 80 },
  { n: "Steve Smith Sr.", p: 'WR', t: 'BAL', d: '2010s', s: { y: 75, p: 11.5, t: 0.4, c: 60 }, imp: 80, ea: 80 },
  { n: "Jordy Nelson", p: 'WR', t: 'GB', d: '2010s', s: { y: 85, p: 11.5, t: 0.7, c: 65 }, imp: 86, ea: 86 },
  { n: "Randall Cobb", p: 'WR', t: 'GB', d: '2010s', s: { y: 65, p: 10, t: 0.4, c: 65 }, imp: 78, ea: 78 },
  { n: "Demaryius Thomas", p: 'WR', t: 'DEN', d: '2010s', s: { y: 95, p: 11, t: 0.5, c: 65 }, imp: 87, ea: 87 },
  { n: "Emmanuel Sanders", p: 'WR', t: 'DEN', d: '2010s', s: { y: 75, p: 11, t: 0.4, c: 65 }, imp: 80, ea: 80 },
  { n: "T.Y. Hilton", p: 'WR', t: 'IND', d: '2010s', s: { y: 80, p: 12.5, t: 0.5, c: 60 }, imp: 82, ea: 82 },
  { n: "Eric Decker", p: 'WR', t: 'DEN', d: '2010s', s: { y: 75, p: 11, t: 0.6, c: 60 }, imp: 78, ea: 78 },
  { n: "Pierre Garcon", p: 'WR', t: 'WAS', d: '2010s', s: { y: 75, p: 9.5, t: 0.3, c: 65 }, imp: 78, ea: 78 },
  { n: "Doug Baldwin", p: 'WR', t: 'SEA', d: '2010s', s: { y: 70, p: 10.5, t: 0.5, c: 70 }, imp: 80, ea: 80 },
  { n: "Golden Tate", p: 'WR', t: 'DET', d: '2010s', s: { y: 70, p: 9, t: 0.3, c: 70 }, imp: 78, ea: 78 },
  { n: "Sammy Watkins", p: 'WR', t: 'BUF', d: '2010s', s: { y: 65, p: 11.5, t: 0.5, c: 60 }, imp: 78, ea: 78 },
  { n: "Allen Robinson", p: 'WR', t: 'JAX', d: '2010s', s: { y: 75, p: 11, t: 0.5, c: 60 }, imp: 80, ea: 80 },
  { n: "Adam Thielen", p: 'WR', t: 'MIN', d: '2010s', s: { y: 75, p: 9.5, t: 0.4, c: 70 }, imp: 80, ea: 80 },
  { n: "Robert Woods", p: 'WR', t: 'LAR', d: '2010s', s: { y: 75, p: 9.5, t: 0.3, c: 65 }, imp: 80, ea: 80 },
  { n: "Cooper Kupp", p: 'WR', t: 'LAR', d: '2010s', s: { y: 75, p: 10, t: 0.5, c: 75 }, imp: 82, ea: 82 },
  { n: "Brandin Cooks", p: 'WR', t: 'NO', d: '2010s', s: { y: 70, p: 11, t: 0.5, c: 65 }, imp: 78, ea: 78 },
  { n: "Michael Crabtree", p: 'WR', t: 'SF', d: '2010s', s: { y: 70, p: 10, t: 0.5, c: 60 }, imp: 78, ea: 78 },
  { n: "Marvin Jones Jr.", p: 'WR', t: 'DET', d: '2010s', s: { y: 70, p: 12, t: 0.5, c: 60 }, imp: 78, ea: 78 },
  { n: "Anquan Boldin", p: 'WR', t: 'SF', d: '2010s', s: { y: 70, p: 9.5, t: 0.3, c: 65 }, imp: 78, ea: 78 },
  { n: "Stefon Diggs", p: 'WR', t: 'MIN', d: '2010s', s: { y: 70, p: 10.5, t: 0.4, c: 70 }, imp: 82, ea: 82 },
  { n: "Chris Olave", p: 'WR', t: 'NO', d: '2020s', s: { y: 73, p: 11.6, t: 0.55, c: 100 }, imp: 82, ea: 81 },
  { n: "Drake London", p: 'WR', t: 'ATL', d: '2020s', s: { y: 70, p: 9.5, t: 0.3, c: 65 }, imp: 80, ea: 79 },
  { n: "DeVonta Smith", p: 'WR', t: 'PHI', d: '2020s', s: { y: 80, p: 11, t: 0.4, c: 65 }, imp: 84, ea: 83 },
  { n: "Jaylen Waddle", p: 'WR', t: 'MIA', d: '2020s', s: { y: 75, p: 10.5, t: 0.4, c: 70 }, imp: 84, ea: 83 },
  { n: "DJ Moore", p: 'WR', t: 'CHI', d: '2020s', s: { y: 80, p: 11, t: 0.5, c: 65 }, imp: 84, ea: 83 },
  { n: "Diontae Johnson", p: 'WR', t: 'PIT', d: '2020s', s: { y: 65, p: 8.5, t: 0.3, c: 70 }, imp: 78, ea: 77 },
  { n: "Christian Kirk", p: 'WR', t: 'JAX', d: '2020s', s: { y: 75, p: 10, t: 0.4, c: 70 }, imp: 80, ea: 79 },
  { n: "Brandon Aiyuk", p: 'WR', t: 'SF', d: '2020s', s: { y: 80, p: 11.5, t: 0.5, c: 65 }, imp: 84, ea: 83 },
  { n: "Deebo Samuel", p: 'WR', t: 'SF', d: '2020s', s: { y: 75, p: 12, t: 0.4, c: 65 }, imp: 84, ea: 83 },
  { n: "Terry McLaurin", p: 'WR', t: 'WAS', d: '2020s', s: { y: 75, p: 10.5, t: 0.4, c: 65 }, imp: 82, ea: 81 },
  { n: "Calvin Ridley", p: 'WR', t: 'ATL', d: '2020s', s: { y: 75, p: 11, t: 0.5, c: 60 }, imp: 80, ea: 79 },
  { n: "Tyler Lockett", p: 'WR', t: 'SEA', d: '2020s', s: { y: 65, p: 10.5, t: 0.4, c: 70 }, imp: 80, ea: 79 },
  { n: "Chris Godwin", p: 'WR', t: 'TB', d: '2020s', s: { y: 75, p: 10, t: 0.4, c: 70 }, imp: 80, ea: 79 },
  { n: "Keenan Allen", p: 'WR', t: 'LAC', d: '2020s', s: { y: 80, p: 9.5, t: 0.5, c: 70 }, imp: 84, ea: 83 },
  { n: "Tee Higgins", p: 'WR', t: 'CIN', d: '2020s', s: { y: 70, p: 11, t: 0.5, c: 65 }, imp: 82, ea: 81 },
  { n: "Michael Pittman Jr.", p: 'WR', t: 'IND', d: '2020s', s: { y: 75, p: 9.5, t: 0.3, c: 70 }, imp: 80, ea: 79 },
  { n: "Nico Collins", p: 'WR', t: 'HOU', d: '2020s', s: { y: 74, p: 15.7, t: 0.5, c: 71 }, imp: 84, ea: 83 },
  { n: "Malik Nabers", p: 'WR', t: 'NYG', d: '2020s', s: { y: 75, p: 10, t: 0.4, c: 65 }, imp: 80, ea: 79 },
  { n: "Zay Flowers", p: 'WR', t: 'BAL', d: '2020s', s: { y: 71, p: 14.1, t: 0.3, c: 86 }, imp: 80, ea: 79 },
  { n: "Courtland Sutton", p: 'WR', t: 'DEN', d: '2020s', s: { y: 70, p: 11, t: 0.5, c: 60 }, imp: 80, ea: 79 },
  { n: "Mike Williams", p: 'WR', t: 'LAC', d: '2020s', s: { y: 70, p: 13, t: 0.4, c: 55 }, imp: 78, ea: 77 },
  { n: "Marquise Brown", p: 'WR', t: 'ARI', d: '2020s', s: { y: 70, p: 10.5, t: 0.4, c: 65 }, imp: 78, ea: 77 },
  { n: "Adam Thielen", p: 'WR', t: 'CAR', d: '2020s', s: { y: 70, p: 9, t: 0.4, c: 70 }, imp: 78, ea: 77 },
  { n: "Rashee Rice", p: 'WR', t: 'KC', d: '2020s', s: { y: 65, p: 10, t: 0.4, c: 70 }, imp: 78, ea: 77 },
  { n: "Tank Dell", p: 'WR', t: 'HOU', d: '2020s', s: { y: 65, p: 11, t: 0.4, c: 65 }, imp: 76, ea: 75 },
  { n: "Jordan Addison", p: 'WR', t: 'MIN', d: '2020s', s: { y: 65, p: 11, t: 0.5, c: 60 }, imp: 78, ea: 77 },
  { n: "Jerry Jeudy", p: 'WR', t: 'CLE', d: '2020s', s: { y: 75, p: 10, t: 0.3, c: 65 }, imp: 78, ea: 77 },
  { n: "DJ Chark", p: 'WR', t: 'JAX', d: '2020s', s: { y: 65, p: 11.5, t: 0.5, c: 55 }, imp: 76, ea: 75 },
  { n: "Romeo Doubs", p: 'WR', t: 'GB', d: '2020s', s: { y: 55, p: 9.5, t: 0.3, c: 65 }, imp: 74, ea: 73 },
  { n: "Christian Watson", p: 'WR', t: 'GB', d: '2020s', s: { y: 50, p: 12, t: 0.4, c: 55 }, imp: 75, ea: 74 },
  { n: "Jakobi Meyers", p: 'WR', t: 'LV', d: '2020s', s: { y: 65, p: 9.5, t: 0.3, c: 70 }, imp: 76, ea: 75 },
  { n: "Dave Casper", p: 'TE', t: 'LV', d: '1970s', s: { y: 50, t: 0.5, b: 85 }, imp: 86, ea: 90 },
  { n: "Charlie Sanders", p: 'TE', t: 'DET', d: '1970s', s: { y: 40, t: 0.3, b: 82 }, imp: 80, ea: 84 },
  { n: "Riley Odoms", p: 'TE', t: 'DEN', d: '1970s', s: { y: 45, t: 0.3, b: 80 }, imp: 78, ea: 82 },
  { n: "Ozzie Newsome", p: 'TE', t: 'CLE', d: '1970s', s: { y: 60, t: 0.4, b: 75 }, imp: 84, ea: 88 },
  { n: "Russ Francis", p: 'TE', t: 'NE', d: '1970s', s: { y: 40, t: 0.3, b: 78 }, imp: 77, ea: 81 },
  { n: "Kellen Winslow", p: 'TE', t: 'LAC', d: '1980s', s: { y: 70, t: 0.6, b: 70 }, imp: 90, ea: 93 },
  { n: "Ozzie Newsome", p: 'TE', t: 'CLE', d: '1980s', s: { y: 65, t: 0.4, b: 78 }, imp: 87, ea: 90 },
  { n: "Mark Bavaro", p: 'TE', t: 'NYG', d: '1980s', s: { y: 50, t: 0.4, b: 88 }, imp: 84, ea: 87 },
  { n: "Todd Christensen", p: 'TE', t: 'LV', d: '1980s', s: { y: 70, t: 0.5, b: 75 }, imp: 84, ea: 87 },
  { n: "Brent Jones", p: 'TE', t: 'SF', d: '1980s', s: { y: 50, t: 0.3, b: 80 }, imp: 80, ea: 83 },
  { n: "Shannon Sharpe", p: 'TE', t: 'DEN', d: '1990s', s: { y: 70, t: 0.5, b: 78 }, imp: 90, ea: 92 },
  { n: "Ben Coates", p: 'TE', t: 'NE', d: '1990s', s: { y: 60, t: 0.5, b: 80 }, imp: 84, ea: 86 },
  { n: "Mark Chmura", p: 'TE', t: 'GB', d: '1990s', s: { y: 50, t: 0.4, b: 80 }, imp: 80, ea: 82 },
  { n: "Wesley Walls", p: 'TE', t: 'CAR', d: '1990s', s: { y: 55, t: 0.5, b: 78 }, imp: 81, ea: 83 },
  { n: "Tony Gonzalez", p: 'TE', t: 'KC', d: '1990s', s: { y: 65, t: 0.5, b: 75 }, imp: 88, ea: 90 },
  { n: "Brent Jones", p: 'TE', t: 'SF', d: '1990s', s: { y: 55, t: 0.3, b: 80 }, imp: 81, ea: 83 },
  { n: "Tony Gonzalez", p: 'TE', t: 'KC', d: '2000s', s: { y: 75, t: 0.5, b: 78 }, imp: 92, ea: 93 },
  { n: "Antonio Gates", p: 'TE', t: 'LAC', d: '2000s', s: { y: 70, t: 0.7, b: 75 }, imp: 90, ea: 91 },
  { n: "Jason Witten", p: 'TE', t: 'DAL', d: '2000s', s: { y: 65, t: 0.4, b: 85 }, imp: 86, ea: 87 },
  { n: "Dallas Clark", p: 'TE', t: 'IND', d: '2000s', s: { y: 60, t: 0.5, b: 75 }, imp: 82, ea: 83 },
  { n: "Vernon Davis", p: 'TE', t: 'SF', d: '2000s', s: { y: 55, t: 0.4, b: 80 }, imp: 81, ea: 82 },
  { n: "Chris Cooley", p: 'TE', t: 'WAS', d: '2000s', s: { y: 55, t: 0.4, b: 78 }, imp: 79, ea: 80 },
  { n: "Rob Gronkowski", p: 'TE', t: 'NE', d: '2010s', s: { y: 75, t: 0.8, b: 88 }, imp: 95, ea: 95 },
  { n: "Travis Kelce", p: 'TE', t: 'KC', d: '2010s', s: { y: 75, t: 0.5, b: 78 }, imp: 92, ea: 92 },
  { n: "Jimmy Graham", p: 'TE', t: 'NO', d: '2010s', s: { y: 75, t: 0.7, b: 65 }, imp: 87, ea: 87 },
  { n: "Greg Olsen", p: 'TE', t: 'CAR', d: '2010s', s: { y: 65, t: 0.4, b: 78 }, imp: 84, ea: 84 },
  { n: "Zach Ertz", p: 'TE', t: 'PHI', d: '2010s', s: { y: 65, t: 0.4, b: 75 }, imp: 84, ea: 84 },
  { n: "Antonio Gates", p: 'TE', t: 'LAC', d: '2010s', s: { y: 55, t: 0.5, b: 75 }, imp: 82, ea: 82 },
  { n: "Jason Witten", p: 'TE', t: 'DAL', d: '2010s', s: { y: 60, t: 0.3, b: 85 }, imp: 83, ea: 83 },
  { n: "Travis Kelce", p: 'TE', t: 'KC', d: '2020s', s: { y: 80, t: 0.6, b: 78 }, imp: 95, ea: 94 },
  { n: "George Kittle", p: 'TE', t: 'SF', d: '2020s', s: { y: 70, t: 0.4, b: 92 }, imp: 91, ea: 90 },
  { n: "Mark Andrews", p: 'TE', t: 'BAL', d: '2020s', s: { y: 60, t: 0.5, b: 75 }, imp: 87, ea: 86 },
  { n: "T.J. Hockenson", p: 'TE', t: 'MIN', d: '2020s', s: { y: 60, t: 0.4, b: 78 }, imp: 84, ea: 83 },
  { n: "Sam LaPorta", p: 'TE', t: 'DET', d: '2020s', s: { y: 55, t: 0.5, b: 78 }, imp: 84, ea: 83 },
  { n: "Brock Bowers", p: 'TE', t: 'LV', d: '2020s', s: { y: 70, t: 0.4, b: 75 }, imp: 86, ea: 85 },
  { n: "Trey McBride", p: 'TE', t: 'ARI', d: '2020s', s: { y: 73, t: 0.65, b: 78 }, imp: 87, ea: 86 },
  { n: "Tyler Warren", p: 'TE', t: 'IND', d: '2020s', s: { y: 62, t: 0.4, b: 76 }, imp: 80, ea: 79 },
  { n: "Colston Loveland", p: 'TE', t: 'CHI', d: '2020s', s: { y: 48, t: 0.4, b: 72 }, imp: 77, ea: 76 },
  { n: "Raymond Chester", p: 'TE', t: 'LV', d: '1970s', s: { y: 45, t: 0.4, b: 80 }, imp: 80, ea: 84 },
  { n: "Billy Joe DuPree", p: 'TE', t: 'DAL', d: '1970s', s: { y: 45, t: 0.4, b: 82 }, imp: 80, ea: 84 },
  { n: "Bob Tucker", p: 'TE', t: 'NYG', d: '1970s', s: { y: 50, t: 0.3, b: 78 }, imp: 78, ea: 82 },
  { n: "Rich Caster", p: 'TE', t: 'NYJ', d: '1970s', s: { y: 50, t: 0.5, b: 75 }, imp: 78, ea: 82 },
  { n: "Dan Ross", p: 'TE', t: 'CIN', d: '1970s', s: { y: 55, t: 0.5, b: 75 }, imp: 78, ea: 82 },
  { n: "Jerry Smith", p: 'TE', t: 'WAS', d: '1970s', s: { y: 45, t: 0.4, b: 78 }, imp: 76, ea: 80 },
  { n: "Doug Cosbie", p: 'TE', t: 'DAL', d: '1980s', s: { y: 50, t: 0.4, b: 80 }, imp: 79, ea: 82 },
  { n: "Steve Jordan", p: 'TE', t: 'MIN', d: '1980s', s: { y: 55, t: 0.3, b: 80 }, imp: 80, ea: 83 },
  { n: "Mickey Shuler", p: 'TE', t: 'NYJ', d: '1980s', s: { y: 50, t: 0.3, b: 78 }, imp: 76, ea: 79 },
  { n: "Ferrell Edmunds", p: 'TE', t: 'MIA', d: '1980s', s: { y: 45, t: 0.4, b: 82 }, imp: 76, ea: 79 },
  { n: "Pete Holohan", p: 'TE', t: 'LAC', d: '1980s', s: { y: 50, t: 0.3, b: 75 }, imp: 75, ea: 78 },
  { n: "Hoby Brenner", p: 'TE', t: 'NO', d: '1980s', s: { y: 45, t: 0.3, b: 80 }, imp: 75, ea: 78 },
  { n: "Rodney Holman", p: 'TE', t: 'CIN', d: '1980s', s: { y: 45, t: 0.4, b: 78 }, imp: 76, ea: 79 },
  { n: "Jay Novacek", p: 'TE', t: 'DAL', d: '1990s', s: { y: 55, t: 0.4, b: 78 }, imp: 82, ea: 84 },
  { n: "Frank Wycheck", p: 'TE', t: 'TEN', d: '1990s', s: { y: 60, t: 0.3, b: 75 }, imp: 78, ea: 80 },
  { n: "Keith Jackson", p: 'TE', t: 'PHI', d: '1990s', s: { y: 55, t: 0.5, b: 78 }, imp: 80, ea: 82 },
  { n: "Eric Green", p: 'TE', t: 'PIT', d: '1990s', s: { y: 55, t: 0.5, b: 78 }, imp: 78, ea: 80 },
  { n: "Mark Bruener", p: 'TE', t: 'PIT', d: '1990s', s: { y: 30, t: 0.2, b: 88 }, imp: 75, ea: 77 },
  { n: "Pete Mitchell", p: 'TE', t: 'JAX', d: '1990s', s: { y: 50, t: 0.3, b: 75 }, imp: 76, ea: 78 },
  { n: "Howard Cross", p: 'TE', t: 'NYG', d: '1990s', s: { y: 30, t: 0.3, b: 85 }, imp: 75, ea: 77 },
  { n: "Irv Smith", p: 'TE', t: 'NO', d: '1990s', s: { y: 35, t: 0.3, b: 80 }, imp: 74, ea: 76 },
  { n: "Alge Crumpler", p: 'TE', t: 'ATL', d: '2000s', s: { y: 55, t: 0.4, b: 80 }, imp: 80, ea: 81 },
  { n: "Todd Heap", p: 'TE', t: 'BAL', d: '2000s', s: { y: 55, t: 0.4, b: 75 }, imp: 81, ea: 82 },
  { n: "Randy McMichael", p: 'TE', t: 'MIA', d: '2000s', s: { y: 50, t: 0.3, b: 78 }, imp: 78, ea: 79 },
  { n: "Bubba Franks", p: 'TE', t: 'GB', d: '2000s', s: { y: 40, t: 0.5, b: 78 }, imp: 76, ea: 77 },
  { n: "Heath Miller", p: 'TE', t: 'PIT', d: '2000s', s: { y: 50, t: 0.4, b: 85 }, imp: 80, ea: 81 },
  { n: "Owen Daniels", p: 'TE', t: 'HOU', d: '2000s', s: { y: 55, t: 0.4, b: 78 }, imp: 80, ea: 81 },
  { n: "Greg Olsen", p: 'TE', t: 'CHI', d: '2000s', s: { y: 45, t: 0.3, b: 75 }, imp: 78, ea: 79 },
  { n: "Kellen Winslow II", p: 'TE', t: 'CLE', d: '2000s', s: { y: 65, t: 0.3, b: 70 }, imp: 80, ea: 81 },
  { n: "Marcus Pollard", p: 'TE', t: 'IND', d: '2000s', s: { y: 40, t: 0.4, b: 78 }, imp: 75, ea: 76 },
  { n: "Delanie Walker", p: 'TE', t: 'TEN', d: '2010s', s: { y: 65, t: 0.4, b: 78 }, imp: 84, ea: 84 },
  { n: "Martellus Bennett", p: 'TE', t: 'CHI', d: '2010s', s: { y: 55, t: 0.4, b: 78 }, imp: 80, ea: 80 },
  { n: "Julius Thomas", p: 'TE', t: 'DEN', d: '2010s', s: { y: 55, t: 0.7, b: 70 }, imp: 80, ea: 80 },
  { n: "Charles Clay", p: 'TE', t: 'MIA', d: '2010s', s: { y: 50, t: 0.4, b: 78 }, imp: 78, ea: 78 },
  { n: "Jared Cook", p: 'TE', t: 'LV', d: '2010s', s: { y: 55, t: 0.4, b: 70 }, imp: 78, ea: 78 },
  { n: "Tyler Eifert", p: 'TE', t: 'CIN', d: '2010s', s: { y: 50, t: 0.5, b: 78 }, imp: 78, ea: 78 },
  { n: "Kyle Rudolph", p: 'TE', t: 'MIN', d: '2010s', s: { y: 50, t: 0.4, b: 80 }, imp: 78, ea: 78 },
  { n: "Hunter Henry", p: 'TE', t: 'LAC', d: '2010s', s: { y: 50, t: 0.5, b: 78 }, imp: 78, ea: 78 },
  { n: "Eric Ebron", p: 'TE', t: 'DET', d: '2010s', s: { y: 50, t: 0.4, b: 70 }, imp: 76, ea: 76 },
  { n: "Heath Miller", p: 'TE', t: 'PIT', d: '2010s', s: { y: 50, t: 0.3, b: 85 }, imp: 78, ea: 78 },
  { n: "Dennis Pitta", p: 'TE', t: 'BAL', d: '2010s', s: { y: 50, t: 0.3, b: 75 }, imp: 76, ea: 76 },
  { n: "Evan Engram", p: 'TE', t: 'JAX', d: '2020s', s: { y: 60, t: 0.3, b: 70 }, imp: 80, ea: 79 },
  { n: "David Njoku", p: 'TE', t: 'CLE', d: '2020s', s: { y: 55, t: 0.3, b: 75 }, imp: 80, ea: 79 },
  { n: "Kyle Pitts", p: 'TE', t: 'ATL', d: '2020s', s: { y: 55, t: 0.3, b: 70 }, imp: 80, ea: 79 },
  { n: "Cole Kmet", p: 'TE', t: 'CHI', d: '2020s', s: { y: 50, t: 0.4, b: 78 }, imp: 78, ea: 77 },
  { n: "Pat Freiermuth", p: 'TE', t: 'PIT', d: '2020s', s: { y: 50, t: 0.4, b: 78 }, imp: 78, ea: 77 },
  { n: "Dawson Knox", p: 'TE', t: 'BUF', d: '2020s', s: { y: 50, t: 0.5, b: 78 }, imp: 78, ea: 77 },
  { n: "Jake Ferguson", p: 'TE', t: 'DAL', d: '2020s', s: { y: 50, t: 0.4, b: 78 }, imp: 76, ea: 75 },
  { n: "Tucker Kraft", p: 'TE', t: 'GB', d: '2020s', s: { y: 50, t: 0.4, b: 80 }, imp: 76, ea: 75 },
  { n: "Dalton Schultz", p: 'TE', t: 'HOU', d: '2020s', s: { y: 55, t: 0.4, b: 75 }, imp: 78, ea: 77 },
  { n: "Tyler Higbee", p: 'TE', t: 'LAR', d: '2020s', s: { y: 50, t: 0.3, b: 78 }, imp: 76, ea: 75 },
  { n: "Isaiah Likely", p: 'TE', t: 'BAL', d: '2020s', s: { y: 45, t: 0.5, b: 75 }, imp: 76, ea: 75 },
  { n: "Jonnu Smith", p: 'TE', t: 'MIA', d: '2020s', s: { y: 55, t: 0.4, b: 75 }, imp: 76, ea: 75 },
  { n: "Joe Theismann", p: 'QB', t: 'WAS', d: '1970s', s: { y: 195, t: 1.3, i: 1, r: 76 , ry: 15 }, imp: 76, ea: 80 },
  { n: "James Harris", p: 'QB', t: 'LAR', d: '1970s', s: { y: 200, t: 1.3, i: 0.9, r: 76 , ry: 8 }, imp: 75, ea: 79 },
  { n: "Jim Hart", p: 'QB', t: 'ARI', d: '1970s', s: { y: 215, t: 1.4, i: 1.4, r: 70.5 , ry: 8 }, imp: 76, ea: 80 },
  { n: "Marc Wilson", p: 'QB', t: 'LV', d: '1980s', s: { y: 215, t: 1.3, i: 1.3, r: 72.5 , ry: 7 }, imp: 73, ea: 76 },
  { n: "Jeff Hostetler", p: 'QB', t: 'NYG', d: '1990s', s: { y: 200, t: 1.2, i: 0.8, r: 79 , ry: 6 }, imp: 77, ea: 79 },
  { n: "Trent Green", p: 'QB', t: 'LAR', d: '1990s', s: { y: 240, t: 1.6, i: 0.9, r: 91 , ry: 4 }, imp: 84, ea: 86 },
  { n: "Jim Harbaugh", p: 'QB', t: 'IND', d: '1990s', s: { y: 215, t: 1.2, i: 0.8, r: 84 , ry: 14 }, imp: 78, ea: 80 },
  { n: "Steve Beuerlein", p: 'QB', t: 'CAR', d: '1990s', s: { y: 235, t: 1.6, i: 1, r: 85 , ry: 2 }, imp: 78, ea: 80 },
  { n: "Drew Bledsoe", p: 'QB', t: 'DAL', d: '2000s', s: { y: 245, t: 1.4, i: 1, r: 80 , ry: 1 }, imp: 77, ea: 78 },
  { n: "Brett Favre", p: 'QB', t: 'NYJ', d: '2000s', s: { y: 245, t: 1.5, i: 1.1, r: 81 , ry: 6 }, imp: 80, ea: 81 },
  { n: "Brett Favre", p: 'QB', t: 'MIN', d: '2000s', s: { y: 250, t: 1.7, i: 0.5, r: 107.2 , ry: 6 }, imp: 88, ea: 89 },
  { n: "David Carr", p: 'QB', t: 'HOU', d: '2000s', s: { y: 215, t: 1, i: 1, r: 75 , ry: 6 }, imp: 72, ea: 73 },
  { n: "Brian Griese", p: 'QB', t: 'DEN', d: '2000s', s: { y: 220, t: 1.4, i: 1, r: 86.5 , ry: 6 }, imp: 76, ea: 77 },
  { n: "Jon Kitna", p: 'QB', t: 'CIN', d: '2000s', s: { y: 240, t: 1.5, i: 1.3, r: 80 , ry: 6 }, imp: 75, ea: 76 },
  { n: "Byron Leftwich", p: 'QB', t: 'JAX', d: '2000s', s: { y: 215, t: 1.3, i: 0.9, r: 81 , ry: 4 }, imp: 74, ea: 75 },
  { n: "Kerry Collins", p: 'QB', t: 'NYG', d: '2000s', s: { y: 245, t: 1.3, i: 1.1, r: 75.5 , ry: 3 }, imp: 78, ea: 79 },
  { n: "Robert Griffin III", p: 'QB', t: 'WAS', d: '2010s', s: { y: 210, t: 1.3, i: 0.4, r: 102.4 , ry: 7 }, imp: 80, ea: 80 },
  { n: "Colin Kaepernick", p: 'QB', t: 'SF', d: '2010s', s: { y: 215, t: 1.4, i: 0.6, r: 88.9 , ry: 7 }, imp: 80, ea: 80 },
  { n: "Ryan Fitzpatrick", p: 'QB', t: 'BUF', d: '2010s', s: { y: 240, t: 1.6, i: 1, r: 81 , ry: 12 }, imp: 75, ea: 75 },
  { n: "Sam Bradford", p: 'QB', t: 'LAR', d: '2010s', s: { y: 230, t: 1.3, i: 0.7, r: 79.3 , ry: 7 }, imp: 75, ea: 75 },
  { n: "Mitchell Trubisky", p: 'QB', t: 'CHI', d: '2010s', s: { y: 220, t: 1.4, i: 0.7, r: 88 , ry: 16 }, imp: 75, ea: 75 },
  { n: "Bryce Young", p: 'QB', t: 'CAR', d: '2020s', s: { y: 195, t: 1, i: 0.7, r: 75 , ry: 9 }, imp: 72, ea: 71 },
  { n: "Mac Jones", p: 'QB', t: 'NE', d: '2020s', s: { y: 235, t: 1.2, i: 0.7, r: 88.5 , ry: 9 }, imp: 75, ea: 74 },
  { n: "Bo Nix", p: 'QB', t: 'DEN', d: '2020s', s: { y: 235, t: 1.5, i: 0.6, r: 87.8 , ry: 12 }, imp: 82, ea: 81 },
  { n: "Anthony Richardson", p: 'QB', t: 'IND', d: '2020s', s: { y: 175, t: 1, i: 0.6, r: 75.5 , ry: 30 }, imp: 73, ea: 72 },
  { n: "Drake Maye", p: 'QB', t: 'NE', d: '2020s', s: { y: 259, t: 1.8, i: 0.5, r: 113.5 , ry: 25 }, imp: 89, ea: 88 },
  { n: "Justin Fields", p: 'QB', t: 'CHI', d: '2020s', s: { y: 180, t: 1, i: 0.7, r: 85 , ry: 40 }, imp: 76, ea: 75 },
  { n: "Kenny Pickett", p: 'QB', t: 'PIT', d: '2020s', s: { y: 215, t: 1, i: 0.8, r: 80 , ry: 9 }, imp: 72, ea: 71 },
  { n: "Tony Galbreath", p: 'RB', t: 'NO', d: '1970s', s: { y: 55, c: 4, r: 50, t: 0.3 }, imp: 74, ea: 74 },
  { n: "Robert Newhouse", p: 'RB', t: 'DAL', d: '1970s', s: { y: 55, c: 4.2, r: 10, t: 0.4 }, imp: 73, ea: 73 },
  { n: "Pete Banaszak", p: 'RB', t: 'LV', d: '1970s', s: { y: 50, c: 3.8, r: 8, t: 0.6 }, imp: 72, ea: 72 },
  { n: "Marcus Allen", p: 'RB', t: 'KC', d: '1990s', s: { y: 60, c: 3.9, r: 18, t: 0.7 }, imp: 80, ea: 81 },
  { n: "Ricky Williams", p: 'RB', t: 'NO', d: '1990s', s: { y: 80, c: 3.9, r: 20, t: 0.4 }, imp: 76, ea: 77 },
  { n: "Jamal Lewis", p: 'RB', t: 'BAL', d: '2000s', s: { y: 100, c: 4.4, r: 15, t: 0.7 }, imp: 86, ea: 87 },
  { n: "Travis Henry", p: 'RB', t: 'BUF', d: '2000s', s: { y: 80, c: 4, r: 18, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Ahman Green", p: 'RB', t: 'GB', d: '2000s', s: { y: 95, c: 4.6, r: 30, t: 0.6 }, imp: 84, ea: 85 },
  { n: "Reggie Bush", p: 'RB', t: 'NO', d: '2000s', s: { y: 50, c: 4, r: 50, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Knowshon Moreno", p: 'RB', t: 'DEN', d: '2010s', s: { y: 75, c: 4.3, r: 35, t: 0.6 }, imp: 76, ea: 77 },
  { n: "DeAngelo Williams", p: 'RB', t: 'PIT', d: '2010s', s: { y: 75, c: 4.5, r: 18, t: 0.6 }, imp: 76, ea: 77 },
  { n: "Steven Jackson", p: 'RB', t: 'ATL', d: '2010s', s: { y: 65, c: 3.8, r: 15, t: 0.4 }, imp: 73, ea: 74 },
  { n: "J.K. Dobbins", p: 'RB', t: 'BAL', d: '2020s', s: { y: 75, c: 5.2, r: 12, t: 0.5 }, imp: 75, ea: 77 },
  { n: "Bucky Irving", p: 'RB', t: 'TB', d: '2020s', s: { y: 70, c: 5, r: 25, t: 0.4 }, imp: 76, ea: 78 },
  { n: "Jaylen Warren", p: 'RB', t: 'PIT', d: '2020s', s: { y: 50, c: 4.8, r: 35, t: 0.3 }, imp: 73, ea: 75 },
  { n: "Jerome Ford", p: 'RB', t: 'CLE', d: '2020s', s: { y: 60, c: 4, r: 25, t: 0.3 }, imp: 72, ea: 74 },
  { n: "Tyjae Spears", p: 'RB', t: 'TEN', d: '2020s', s: { y: 55, c: 4.5, r: 30, t: 0.3 }, imp: 73, ea: 75 },
  { n: "Cris Collinsworth", p: 'WR', t: 'CIN', d: '1980s', s: { y: 65, p: 13, t: 0.4, c: 55 }, imp: 78, ea: 81 },
  { n: "Quinn Early", p: 'WR', t: 'NO', d: '1990s', s: { y: 65, p: 10.5, t: 0.4, c: 60 }, imp: 75, ea: 77 },
  { n: "Bobby Engram", p: 'WR', t: 'SEA', d: '2000s', s: { y: 65, p: 9.5, t: 0.3, c: 65 }, imp: 75, ea: 76 },
  { n: "Drew Bennett", p: 'WR', t: 'TEN', d: '2000s', s: { y: 65, p: 11, t: 0.4, c: 58 }, imp: 75, ea: 76 },
  { n: "Brandon Stokley", p: 'WR', t: 'IND', d: '2000s', s: { y: 50, p: 9.5, t: 0.4, c: 65 }, imp: 73, ea: 74 },
  { n: "Roy Williams", p: 'WR', t: 'DET', d: '2000s', s: { y: 65, p: 11, t: 0.4, c: 55 }, imp: 76, ea: 77 },
  { n: "Antonio Bryant", p: 'WR', t: 'TB', d: '2000s', s: { y: 65, p: 11.5, t: 0.4, c: 60 }, imp: 76, ea: 77 },
  { n: "Donte' Stallworth", p: 'WR', t: 'NO', d: '2000s', s: { y: 60, p: 12, t: 0.3, c: 55 }, imp: 73, ea: 74 },
  { n: "James Jones", p: 'WR', t: 'GB', d: '2010s', s: { y: 60, p: 12, t: 0.5, c: 60 }, imp: 76, ea: 76 },
  { n: "DeVante Parker", p: 'WR', t: 'MIA', d: '2010s', s: { y: 65, p: 12.5, t: 0.4, c: 60 }, imp: 76, ea: 76 },
  { n: "Mohamed Sanu", p: 'WR', t: 'ATL', d: '2010s', s: { y: 55, p: 9.5, t: 0.3, c: 70 }, imp: 73, ea: 73 },
  { n: "Allen Robinson", p: 'WR', t: 'CHI', d: '2010s', s: { y: 65, p: 9.5, t: 0.3, c: 60 }, imp: 78, ea: 78 },
  { n: "George Pickens", p: 'WR', t: 'DAL', d: '2020s', s: { y: 84, p: 15.4, t: 0.5, c: 93 }, imp: 83, ea: 82 },
  { n: "Tyler Boyd", p: 'WR', t: 'CIN', d: '2020s', s: { y: 55, p: 9.5, t: 0.3, c: 70 }, imp: 75, ea: 74 },
  { n: "Jameson Williams", p: 'WR', t: 'DET', d: '2020s', s: { y: 60, p: 11.5, t: 0.5, c: 60 }, imp: 78, ea: 77 },
  { n: "Khalil Shakir", p: 'WR', t: 'BUF', d: '2020s', s: { y: 55, p: 10.5, t: 0.3, c: 75 }, imp: 75, ea: 74 },
  { n: "Hollywood Brown", p: 'WR', t: 'KC', d: '2020s', s: { y: 55, p: 10, t: 0.5, c: 65 }, imp: 75, ea: 74 },
  { n: "Jaxon Smith-Njigba", p: 'WR', t: 'SEA', d: '2020s', s: { y: 105, p: 15.1, t: 0.6, c: 119 }, imp: 91, ea: 90 },
  { n: "Quentin Johnston", p: 'WR', t: 'LAC', d: '2020s', s: { y: 50, p: 11, t: 0.3, c: 55 }, imp: 73, ea: 72 },
  { n: "Rashod Bateman", p: 'WR', t: 'BAL', d: '2020s', s: { y: 55, p: 11.5, t: 0.3, c: 60 }, imp: 74, ea: 73 },
  { n: "Pete Metzelaars", p: 'TE', t: 'BUF', d: '1990s', s: { y: 35, t: 0.2, b: 80 }, imp: 73, ea: 75 },
  { n: "Eric Green", p: 'TE', t: 'BAL', d: '1990s', s: { y: 45, t: 0.4, b: 75 }, imp: 75, ea: 77 },
  { n: "Jeremy Shockey", p: 'TE', t: 'NYG', d: '2000s', s: { y: 55, t: 0.4, b: 72 }, imp: 80, ea: 81 },
  { n: "Brent Celek", p: 'TE', t: 'PHI', d: '2010s', s: { y: 50, t: 0.3, b: 78 }, imp: 78, ea: 78 },
  { n: "Vernon Davis", p: 'TE', t: 'WAS', d: '2010s', s: { y: 45, t: 0.4, b: 75 }, imp: 75, ea: 75 },
  { n: "Owen Daniels", p: 'TE', t: 'BAL', d: '2010s', s: { y: 45, t: 0.3, b: 75 }, imp: 75, ea: 75 },
  { n: "Eric Ebron", p: 'TE', t: 'IND', d: '2010s', s: { y: 50, t: 0.5, b: 70 }, imp: 76, ea: 76 },
  { n: "Hunter Henry", p: 'TE', t: 'NE', d: '2020s', s: { y: 45, t: 0.4, b: 78 }, imp: 75, ea: 74 },
  { n: "Logan Thomas", p: 'TE', t: 'WAS', d: '2020s', s: { y: 40, t: 0.3, b: 75 }, imp: 73, ea: 72 },
  { n: "Cade Otton", p: 'TE', t: 'TB', d: '2020s', s: { y: 45, t: 0.3, b: 78 }, imp: 73, ea: 72 },
  { n: "Mike Gesicki", p: 'TE', t: 'CIN', d: '2020s', s: { y: 45, t: 0.3, b: 70 }, imp: 73, ea: 72 },
  { n: "Matt Schaub", p: 'QB', t: 'HOU', d: '2000s', s: { y: 240, t: 1.5, i: 0.8, r: 88 , ry: 6 }, imp: 80, ea: 81 },
  { n: "Matt Schaub", p: 'QB', t: 'HOU', d: '2010s', s: { y: 270, t: 1.6, i: 0.9, r: 91 , ry: 7 }, imp: 82, ea: 82 },
  { n: "Carson Palmer", p: 'QB', t: 'ARI', d: '2010s', s: { y: 270, t: 1.7, i: 0.8, r: 94 , ry: 2 }, imp: 86, ea: 86 },
  { n: "Donovan McNabb", p: 'QB', t: 'WAS', d: '2010s', s: { y: 200, t: 1, i: 0.9, r: 77 , ry: 8 }, imp: 74, ea: 74 },
  { n: "Steve Beuerlein", p: 'QB', t: 'BUF', d: '1980s', s: { y: 215, t: 1.3, i: 1, r: 76.5 , ry: 2 }, imp: 74, ea: 77 },
  { n: "Frank Reich", p: 'QB', t: 'BUF', d: '1990s', s: { y: 195, t: 1.2, i: 1, r: 78 , ry: 6 }, imp: 73, ea: 75 },
  { n: "Cam Newton", p: 'QB', t: 'NE', d: '2020s', s: { y: 170, t: 0.5, i: 0.7, r: 82.9 , ry: 35 }, imp: 72, ea: 71 },
  { n: "Russell Wilson", p: 'QB', t: 'PIT', d: '2020s', s: { y: 215, t: 1.6, i: 0.5, r: 95.6 , ry: 10 }, imp: 80, ea: 79 },
  { n: "Sam Howell", p: 'QB', t: 'WAS', d: '2020s', s: { y: 245, t: 1.3, i: 1.1, r: 78 , ry: 9 }, imp: 72, ea: 71 },
  { n: "Marcus Mariota", p: 'QB', t: 'ATL', d: '2020s', s: { y: 190, t: 1, i: 0.6, r: 84 , ry: 20 }, imp: 74, ea: 73 },
  { n: "Sam Howell", p: 'QB', t: 'SEA', d: '2020s', s: { y: 220, t: 1.1, i: 0.9, r: 80 , ry: 9 }, imp: 72, ea: 71 },
  { n: "Kyren Williams", p: 'RB', t: 'LAR', d: '2020s', s: { y: 85, c: 4.7, r: 25, t: 0.7 }, imp: 80, ea: 82 },
  { n: "Saquon Barkley", p: 'RB', t: 'NYG', d: '2010s', s: { y: 95, c: 5, r: 35, t: 0.6 }, imp: 88, ea: 89 },
  { n: "Mark Ingram II", p: 'RB', t: 'BAL', d: '2020s', s: { y: 65, c: 4.7, r: 12, t: 0.6 }, imp: 76, ea: 78 },
  { n: "Carlos Hyde", p: 'RB', t: 'CLE', d: '2010s', s: { y: 60, c: 4.5, r: 15, t: 0.5 }, imp: 72, ea: 73 },
  { n: "Latavius Murray", p: 'RB', t: 'LV', d: '2010s', s: { y: 65, c: 4, r: 18, t: 0.5 }, imp: 74, ea: 75 },
  { n: "Lamar Miller", p: 'RB', t: 'HOU', d: '2010s', s: { y: 65, c: 4.1, r: 20, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Antonio Gibson", p: 'RB', t: 'WAS', d: '2020s', s: { y: 65, c: 4.4, r: 25, t: 0.5 }, imp: 75, ea: 77 },
  { n: "Brian Robinson Jr.", p: 'RB', t: 'WAS', d: '2020s', s: { y: 60, c: 4, r: 12, t: 0.5 }, imp: 72, ea: 74 },
  { n: "Wes Welker", p: 'WR', t: 'NE', d: '2010s', s: { y: 80, p: 9, t: 0.4, c: 75 }, imp: 84, ea: 84 },
  { n: "DK Metcalf", p: 'WR', t: 'SEA', d: '2010s', s: { y: 70, p: 12.5, t: 0.5, c: 60 }, imp: 80, ea: 80 },
  { n: "A.J. Brown", p: 'WR', t: 'TEN', d: '2010s', s: { y: 65, p: 13.5, t: 0.5, c: 60 }, imp: 82, ea: 82 },
  { n: "Mike Evans", p: 'WR', t: 'TB', d: '2020s', s: { y: 85, p: 14, t: 0.7, c: 60 }, imp: 88, ea: 87 },
  { n: "Allen Lazard", p: 'WR', t: 'NYJ', d: '2020s', s: { y: 50, p: 11, t: 0.4, c: 60 }, imp: 72, ea: 71 },
  { n: "Calvin Ridley", p: 'WR', t: 'TEN', d: '2020s', s: { y: 70, p: 11.5, t: 0.4, c: 60 }, imp: 78, ea: 77 },
  { n: "DJ Moore", p: 'WR', t: 'CAR', d: '2010s', s: { y: 70, p: 11, t: 0.3, c: 65 }, imp: 78, ea: 78 },
  { n: "Robert Woods", p: 'WR', t: 'TEN', d: '2020s', s: { y: 50, p: 9, t: 0.2, c: 65 }, imp: 72, ea: 71 },
  { n: "Adam Thielen", p: 'WR', t: 'MIN', d: '2020s', s: { y: 65, p: 9, t: 0.4, c: 70 }, imp: 76, ea: 75 },
  { n: "Amari Cooper", p: 'WR', t: 'LV', d: '2010s', s: { y: 75, p: 11.5, t: 0.5, c: 60 }, imp: 80, ea: 80 },
  { n: "Amari Cooper", p: 'WR', t: 'DAL', d: '2010s', s: { y: 80, p: 11, t: 0.5, c: 65 }, imp: 84, ea: 84 },
  { n: "Amari Cooper", p: 'WR', t: 'CLE', d: '2020s', s: { y: 75, p: 11.5, t: 0.4, c: 65 }, imp: 82, ea: 81 },
  { n: "Sterling Shepard", p: 'WR', t: 'NYG', d: '2010s', s: { y: 60, p: 9.5, t: 0.3, c: 70 }, imp: 75, ea: 75 },
  { n: "Kenny Stills", p: 'WR', t: 'MIA', d: '2010s', s: { y: 55, p: 14.5, t: 0.5, c: 55 }, imp: 76, ea: 76 },
  { n: "Marquise Goodwin", p: 'WR', t: 'SF', d: '2010s', s: { y: 50, p: 14, t: 0.3, c: 55 }, imp: 72, ea: 72 },
  { n: "Jakeem Grant", p: 'WR', t: 'MIA', d: '2010s', s: { y: 40, p: 12, t: 0.2, c: 60 }, imp: 70, ea: 70 },
  { n: "Noah Fant", p: 'TE', t: 'DEN', d: '2010s', s: { y: 40, t: 0.3, b: 72 }, imp: 75, ea: 75 },
  { n: "Noah Fant", p: 'TE', t: 'SEA', d: '2020s', s: { y: 45, t: 0.3, b: 72 }, imp: 74, ea: 73 },
  { n: "Jimmy Graham", p: 'TE', t: 'SEA', d: '2010s', s: { y: 50, t: 0.4, b: 70 }, imp: 76, ea: 76 },
  { n: "Vernon Davis", p: 'TE', t: 'SF', d: '2010s', s: { y: 50, t: 0.4, b: 75 }, imp: 78, ea: 78 },
  { n: "Mike Phipps", p: 'QB', t: 'CLE', d: '1970s', s: { y: 175, t: 1, i: 1.3, r: 65 , ry: 8 }, imp: 70, ea: 74 },
  { n: "Norris Weese", p: 'QB', t: 'DEN', d: '1970s', s: { y: 165, t: 0.9, i: 1.1, r: 64.5 , ry: 8 }, imp: 68, ea: 72 },
  { n: "Bob Berry", p: 'QB', t: 'ATL', d: '1970s', s: { y: 185, t: 1.2, i: 1.3, r: 67 , ry: 8 }, imp: 70, ea: 74 },
  { n: "Mike Boryla", p: 'QB', t: 'PHI', d: '1970s', s: { y: 180, t: 1.1, i: 1.3, r: 64 , ry: 8 }, imp: 68, ea: 72 },
  { n: "Steve Fuller", p: 'QB', t: 'KC', d: '1970s', s: { y: 175, t: 1, i: 1, r: 68 , ry: 8 }, imp: 70, ea: 74 },
  { n: "Vince Ferragamo", p: 'QB', t: 'LAR', d: '1970s', s: { y: 200, t: 1.4, i: 1.3, r: 73 , ry: 8 }, imp: 74, ea: 78 },
  { n: "Greg Cook", p: 'QB', t: 'CIN', d: '1970s', s: { y: 210, t: 1.4, i: 1.1, r: 88.3 , ry: 8 }, imp: 76, ea: 80 },
  { n: "Pat Sullivan", p: 'QB', t: 'ATL', d: '1970s', s: { y: 160, t: 1, i: 1.2, r: 62 , ry: 8 }, imp: 66, ea: 70 },
  { n: "Steve Pelluer", p: 'QB', t: 'DAL', d: '1980s', s: { y: 195, t: 1, i: 1, r: 75.5 , ry: 7 }, imp: 72, ea: 75 },
  { n: "Don Strock", p: 'QB', t: 'MIA', d: '1980s', s: { y: 190, t: 1.3, i: 1, r: 79.5 , ry: 7 }, imp: 73, ea: 76 },
  { n: "Bob Avellini", p: 'QB', t: 'CHI', d: '1980s', s: { y: 170, t: 0.9, i: 1.3, r: 60.5 , ry: 7 }, imp: 68, ea: 71 },
  { n: "Gary Hogeboom", p: 'QB', t: 'IND', d: '1980s', s: { y: 195, t: 1.2, i: 1.2, r: 70.5 , ry: 7 }, imp: 71, ea: 74 },
  { n: "Steve Walsh", p: 'QB', t: 'NO', d: '1980s', s: { y: 185, t: 1, i: 0.9, r: 76.5 , ry: 7 }, imp: 72, ea: 75 },
  { n: "David Woodley", p: 'QB', t: 'MIA', d: '1980s', s: { y: 195, t: 1.1, i: 1, r: 72 , ry: 7 }, imp: 72, ea: 75 },
  { n: "Pat Ryan", p: 'QB', t: 'NYJ', d: '1980s', s: { y: 180, t: 1.1, i: 0.9, r: 75.5 , ry: 7 }, imp: 71, ea: 74 },
  { n: "Eric Hipple", p: 'QB', t: 'DET', d: '1980s', s: { y: 200, t: 1.4, i: 1.4, r: 70 , ry: 7 }, imp: 72, ea: 75 },
  { n: "Mark Malone", p: 'QB', t: 'PIT', d: '1980s', s: { y: 195, t: 1.2, i: 1.3, r: 67.5 , ry: 7 }, imp: 71, ea: 74 },
  { n: "Jay Schroeder", p: 'QB', t: 'WAS', d: '1980s', s: { y: 220, t: 1.4, i: 1.2, r: 73.5 , ry: 7 }, imp: 76, ea: 79 },
  { n: "Wade Wilson", p: 'QB', t: 'ATL', d: '1990s', s: { y: 200, t: 1.3, i: 1, r: 78.5 , ry: 6 }, imp: 74, ea: 76 },
  { n: "Tony Banks", p: 'QB', t: 'LAR', d: '1990s', s: { y: 220, t: 1.2, i: 1.1, r: 74.5 , ry: 6 }, imp: 72, ea: 74 },
  { n: "Heath Shuler", p: 'QB', t: 'WAS', d: '1990s', s: { y: 175, t: 0.8, i: 1.4, r: 54.3 , ry: 6 }, imp: 65, ea: 67 },
  { n: "Ty Detmer", p: 'QB', t: 'PHI', d: '1990s', s: { y: 200, t: 1.2, i: 1, r: 80.5 , ry: 6 }, imp: 72, ea: 74 },
  { n: "Browning Nagle", p: 'QB', t: 'NYJ', d: '1990s', s: { y: 195, t: 1, i: 1.4, r: 65 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Cody Carlson", p: 'QB', t: 'TEN', d: '1990s', s: { y: 210, t: 1.4, i: 1.2, r: 75 , ry: 6 }, imp: 72, ea: 74 },
  { n: "Charlie Batch", p: 'QB', t: 'DET', d: '1990s', s: { y: 210, t: 1.3, i: 1, r: 79 , ry: 6 }, imp: 74, ea: 76 },
  { n: "Akili Smith", p: 'QB', t: 'CIN', d: '1990s', s: { y: 170, t: 0.7, i: 1.2, r: 52.8 , ry: 6 }, imp: 60, ea: 62 },
  { n: "Tim Couch", p: 'QB', t: 'CLE', d: '1990s', s: { y: 215, t: 1, i: 1, r: 74.5 , ry: 5 }, imp: 72, ea: 74 },
  { n: "Jim Miller", p: 'QB', t: 'CHI', d: '1990s', s: { y: 220, t: 1.3, i: 0.9, r: 82.5 , ry: 6 }, imp: 74, ea: 76 },
  { n: "Joey Harrington", p: 'QB', t: 'DET', d: '2000s', s: { y: 200, t: 1.1, i: 1.2, r: 68.1 , ry: 6 }, imp: 70, ea: 71 },
  { n: "Patrick Ramsey", p: 'QB', t: 'WAS', d: '2000s', s: { y: 215, t: 1.1, i: 1, r: 71 , ry: 6 }, imp: 71, ea: 72 },
  { n: "Tim Rattay", p: 'QB', t: 'SF', d: '2000s', s: { y: 215, t: 1.2, i: 1, r: 78.5 , ry: 6 }, imp: 71, ea: 72 },
  { n: "J.P. Losman", p: 'QB', t: 'BUF', d: '2000s', s: { y: 220, t: 1.3, i: 1.1, r: 75 , ry: 6 }, imp: 72, ea: 73 },
  { n: "Damon Huard", p: 'QB', t: 'KC', d: '2000s', s: { y: 220, t: 1.5, i: 0.8, r: 89 , ry: 6 }, imp: 75, ea: 76 },
  { n: "Kyle Boller", p: 'QB', t: 'BAL', d: '2000s', s: { y: 200, t: 1, i: 1, r: 70.5 , ry: 6 }, imp: 70, ea: 71 },
  { n: "Charlie Frye", p: 'QB', t: 'CLE', d: '2000s', s: { y: 215, t: 1, i: 1, r: 71.5 , ry: 6 }, imp: 70, ea: 71 },
  { n: "Sage Rosenfels", p: 'QB', t: 'HOU', d: '2000s', s: { y: 230, t: 1.4, i: 1.1, r: 81 , ry: 6 }, imp: 73, ea: 74 },
  { n: "Jeff Blake", p: 'QB', t: 'CIN', d: '1990s', s: { y: 215, t: 1.5, i: 1, r: 80.5 , ry: 16 }, imp: 76, ea: 78 },
  { n: "Brock Osweiler", p: 'QB', t: 'DEN', d: '2010s', s: { y: 220, t: 1.2, i: 0.9, r: 79.5 , ry: 7 }, imp: 73, ea: 73 },
  { n: "Trevor Siemian", p: 'QB', t: 'DEN', d: '2010s', s: { y: 220, t: 1.2, i: 1, r: 80.5 , ry: 7 }, imp: 72, ea: 72 },
  { n: "Brandon Weeden", p: 'QB', t: 'CLE', d: '2010s', s: { y: 215, t: 1, i: 1, r: 71 , ry: 7 }, imp: 70, ea: 70 },
  { n: "Mike Glennon", p: 'QB', t: 'TB', d: '2010s', s: { y: 215, t: 1.2, i: 0.7, r: 83 , ry: 7 }, imp: 72, ea: 72 },
  { n: "Blake Bortles", p: 'QB', t: 'JAX', d: '2010s', s: { y: 240, t: 1.5, i: 1.1, r: 80.5 , ry: 15 }, imp: 76, ea: 76 },
  { n: "EJ Manuel", p: 'QB', t: 'BUF', d: '2010s', s: { y: 175, t: 0.9, i: 0.7, r: 78 , ry: 7 }, imp: 70, ea: 70 },
  { n: "Christian Ponder", p: 'QB', t: 'MIN', d: '2010s', s: { y: 200, t: 1, i: 1, r: 75 , ry: 7 }, imp: 71, ea: 71 },
  { n: "Jacoby Brissett", p: 'QB', t: 'IND', d: '2010s', s: { y: 215, t: 1.2, i: 0.5, r: 86 , ry: 12 }, imp: 75, ea: 75 },
  { n: "Case Keenum", p: 'QB', t: 'MIN', d: '2010s', s: { y: 250, t: 1.5, i: 0.4, r: 98.3 , ry: 7 }, imp: 80, ea: 80 },
  { n: "Matt Cassel", p: 'QB', t: 'NE', d: '2000s', s: { y: 215, t: 1.3, i: 0.8, r: 89.4 , ry: 6 }, imp: 76, ea: 77 },
  { n: "Andy Dalton", p: 'QB', t: 'NO', d: '2020s', s: { y: 215, t: 1.5, i: 0.7, r: 92.5 , ry: 6 }, imp: 76, ea: 75 },
  { n: "Jameis Winston", p: 'QB', t: 'NO', d: '2020s', s: { y: 225, t: 1.4, i: 0.7, r: 92.5 , ry: 8 }, imp: 76, ea: 75 },
  { n: "Mason Rudolph", p: 'QB', t: 'PIT', d: '2020s', s: { y: 215, t: 1, i: 0.6, r: 86 , ry: 9 }, imp: 72, ea: 71 },
  { n: "Joshua Dobbs", p: 'QB', t: 'MIN', d: '2020s', s: { y: 210, t: 1.1, i: 0.8, r: 80 , ry: 9 }, imp: 72, ea: 71 },
  { n: "Tyler Huntley", p: 'QB', t: 'BAL', d: '2020s', s: { y: 195, t: 0.9, i: 0.6, r: 84 , ry: 9 }, imp: 72, ea: 71 },
  { n: "Bailey Zappe", p: 'QB', t: 'NE', d: '2020s', s: { y: 205, t: 1.1, i: 0.7, r: 82 , ry: 9 }, imp: 70, ea: 69 },
  { n: "Cooper Rush", p: 'QB', t: 'DAL', d: '2020s', s: { y: 195, t: 1, i: 0.6, r: 84.5 , ry: 9 }, imp: 71, ea: 70 },
  { n: "Aidan O'Connell", p: 'QB', t: 'LV', d: '2020s', s: { y: 220, t: 1, i: 0.7, r: 82.5 , ry: 9 }, imp: 71, ea: 70 },
  { n: "Joe Flacco", p: 'QB', t: 'CLE', d: '2020s', s: { y: 245, t: 1.7, i: 0.9, r: 90 , ry: 4 }, imp: 76, ea: 75 },
  { n: "Steve Owens", p: 'RB', t: 'DET', d: '1970s', s: { y: 70, c: 4, r: 18, t: 0.5 }, imp: 73, ea: 73 },
  { n: "Charlie Davis", p: 'RB', t: 'TB', d: '1970s', s: { y: 50, c: 3.7, r: 8, t: 0.3 }, imp: 68, ea: 68 },
  { n: "John Brockington", p: 'RB', t: 'GB', d: '1970s', s: { y: 75, c: 3.8, r: 12, t: 0.5 }, imp: 76, ea: 76 },
  { n: "Larry Brown", p: 'RB', t: 'WAS', d: '1970s', s: { y: 80, c: 4, r: 25, t: 0.5 }, imp: 80, ea: 80 },
  { n: "Ed Marinaro", p: 'RB', t: 'MIN', d: '1970s', s: { y: 55, c: 3.8, r: 25, t: 0.3 }, imp: 70, ea: 70 },
  { n: "Joe Cribbs", p: 'RB', t: 'BUF', d: '1980s', s: { y: 70, c: 4.2, r: 25, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Steve Sewell", p: 'RB', t: 'DEN', d: '1980s', s: { y: 50, c: 4, r: 30, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Earnest Jackson", p: 'RB', t: 'PIT', d: '1980s', s: { y: 60, c: 3.9, r: 8, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Lorenzo White", p: 'RB', t: 'TEN', d: '1980s', s: { y: 65, c: 4, r: 12, t: 0.5 }, imp: 73, ea: 74 },
  { n: "Pete Johnson", p: 'RB', t: 'CIN', d: '1980s', s: { y: 70, c: 3.8, r: 8, t: 0.7 }, imp: 76, ea: 77 },
  { n: "Frank Pollard", p: 'RB', t: 'PIT', d: '1980s', s: { y: 55, c: 4, r: 10, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Don Calhoun", p: 'RB', t: 'NE', d: '1980s', s: { y: 55, c: 4, r: 10, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Mike Alstott", p: 'RB', t: 'TB', d: '1990s', s: { y: 65, c: 3.9, r: 30, t: 0.5 }, imp: 80, ea: 81 },
  { n: "Tyrone Wheatley", p: 'RB', t: 'NYG', d: '1990s', s: { y: 55, c: 3.9, r: 15, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Lamar Smith", p: 'RB', t: 'MIA', d: '1990s', s: { y: 70, c: 4, r: 18, t: 0.5 }, imp: 74, ea: 75 },
  { n: "Olandis Gary", p: 'RB', t: 'DEN', d: '1990s', s: { y: 80, c: 4, r: 12, t: 0.5 }, imp: 73, ea: 74 },
  { n: "Dorsey Levens", p: 'RB', t: 'GB', d: '1990s', s: { y: 80, c: 4.1, r: 30, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Lawrence Phillips", p: 'RB', t: 'LAR', d: '1990s', s: { y: 60, c: 3.7, r: 15, t: 0.4 }, imp: 70, ea: 71 },
  { n: "James Allen", p: 'RB', t: 'CHI', d: '1990s', s: { y: 65, c: 4, r: 18, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Reggie Cobb", p: 'RB', t: 'TB', d: '1990s', s: { y: 65, c: 4, r: 15, t: 0.5 }, imp: 73, ea: 74 },
  { n: "Reuben Droughns", p: 'RB', t: 'CLE', d: '2000s', s: { y: 65, c: 3.9, r: 15, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Tatum Bell", p: 'RB', t: 'DEN', d: '2000s', s: { y: 65, c: 4.5, r: 12, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Kevan Barlow", p: 'RB', t: 'SF', d: '2000s', s: { y: 55, c: 4, r: 20, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Brandon Jacobs", p: 'RB', t: 'NYG', d: '2000s', s: { y: 65, c: 4.5, r: 12, t: 0.6 }, imp: 78, ea: 79 },
  { n: "LenDale White", p: 'RB', t: 'TEN', d: '2000s', s: { y: 60, c: 4, r: 8, t: 0.7 }, imp: 75, ea: 76 },
  { n: "Jonathan Stewart", p: 'RB', t: 'CAR', d: '2000s', s: { y: 75, c: 4.6, r: 18, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Marion Barber", p: 'RB', t: 'DAL', d: '2000s', s: { y: 65, c: 4, r: 18, t: 0.6 }, imp: 76, ea: 77 },
  { n: "Felix Jones", p: 'RB', t: 'DAL', d: '2000s', s: { y: 50, c: 5, r: 20, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Ladell Betts", p: 'RB', t: 'WAS', d: '2000s', s: { y: 50, c: 3.9, r: 25, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Mike Anderson", p: 'RB', t: 'DEN', d: '2000s', s: { y: 75, c: 4.2, r: 12, t: 0.6 }, imp: 76, ea: 77 },
  { n: "LaMont Jordan", p: 'RB', t: 'NYJ', d: '2000s', s: { y: 55, c: 4, r: 30, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Justin Fargas", p: 'RB', t: 'LV', d: '2000s', s: { y: 70, c: 4, r: 15, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Ron Dayne", p: 'RB', t: 'NYG', d: '2000s', s: { y: 50, c: 3.7, r: 8, t: 0.4 }, imp: 70, ea: 71 },
  { n: "Antowain Smith", p: 'RB', t: 'NE', d: '2000s', s: { y: 65, c: 3.8, r: 12, t: 0.6 }, imp: 75, ea: 76 },
  { n: "Bilal Powell", p: 'RB', t: 'NYJ', d: '2010s', s: { y: 55, c: 4.4, r: 30, t: 0.3 }, imp: 73, ea: 74 },
  { n: "CJ Spiller", p: 'RB', t: 'BUF', d: '2010s', s: { y: 70, c: 4.9, r: 30, t: 0.4 }, imp: 78, ea: 79 },
  { n: "BenJarvus Green-Ellis", p: 'RB', t: 'NE', d: '2010s', s: { y: 65, c: 3.9, r: 8, t: 0.6 }, imp: 74, ea: 75 },
  { n: "Stevan Ridley", p: 'RB', t: 'NE', d: '2010s', s: { y: 70, c: 4.4, r: 8, t: 0.6 }, imp: 75, ea: 76 },
  { n: "Donald Brown", p: 'RB', t: 'IND', d: '2010s', s: { y: 50, c: 4.2, r: 15, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Ryan Mathews", p: 'RB', t: 'LAC', d: '2010s', s: { y: 75, c: 4.5, r: 25, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Eddie Lacy", p: 'RB', t: 'GB', d: '2010s', s: { y: 80, c: 4.3, r: 25, t: 0.5 }, imp: 80, ea: 81 },
  { n: "Chris Ivory", p: 'RB', t: 'NYJ', d: '2010s', s: { y: 65, c: 4.3, r: 12, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Mike Davis", p: 'RB', t: 'SEA', d: '2010s', s: { y: 50, c: 4, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Jamaal Williams", p: 'RB', t: 'GB', d: '2010s', s: { y: 55, c: 3.9, r: 20, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Devontae Booker", p: 'RB', t: 'DEN', d: '2010s', s: { y: 45, c: 4, r: 20, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Tevin Coleman", p: 'RB', t: 'ATL', d: '2010s', s: { y: 50, c: 4.4, r: 25, t: 0.5 }, imp: 75, ea: 76 },
  { n: "Damien Harris", p: 'RB', t: 'NE', d: '2020s', s: { y: 70, c: 4.6, r: 12, t: 0.6 }, imp: 76, ea: 78 },
  { n: "Zack Moss", p: 'RB', t: 'IND', d: '2020s', s: { y: 60, c: 4, r: 18, t: 0.4 }, imp: 73, ea: 75 },
  { n: "Royce Freeman", p: 'RB', t: 'DEN', d: '2020s', s: { y: 45, c: 3.8, r: 15, t: 0.3 }, imp: 70, ea: 72 },
  { n: "Justin Jackson", p: 'RB', t: 'LAC', d: '2020s', s: { y: 45, c: 4.3, r: 20, t: 0.3 }, imp: 71, ea: 73 },
  { n: "Dameon Pierce", p: 'RB', t: 'HOU', d: '2020s', s: { y: 65, c: 4.2, r: 15, t: 0.4 }, imp: 75, ea: 77 },
  { n: "Zamir White", p: 'RB', t: 'LV', d: '2020s', s: { y: 50, c: 3.8, r: 8, t: 0.3 }, imp: 70, ea: 72 },
  { n: "Khalil Herbert", p: 'RB', t: 'CHI', d: '2020s', s: { y: 50, c: 4.5, r: 12, t: 0.3 }, imp: 71, ea: 73 },
  { n: "Devin Singletary", p: 'RB', t: 'NYG', d: '2020s', s: { y: 60, c: 4.2, r: 18, t: 0.4 }, imp: 74, ea: 76 },
  { n: "Chuba Hubbard", p: 'RB', t: 'CAR', d: '2020s', s: { y: 65, c: 4.5, r: 18, t: 0.4 }, imp: 75, ea: 77 },
  { n: "Miles Sanders", p: 'RB', t: 'PHI', d: '2020s', s: { y: 70, c: 4.5, r: 25, t: 0.4 }, imp: 78, ea: 80 },
  { n: "Gus Edwards", p: 'RB', t: 'BAL', d: '2020s', s: { y: 60, c: 5, r: 8, t: 0.5 }, imp: 75, ea: 77 },
  { n: "D'Andre Swift", p: 'RB', t: 'DET', d: '2020s', s: { y: 65, c: 4.5, r: 35, t: 0.5 }, imp: 78, ea: 80 },
  { n: "D'Andre Swift", p: 'RB', t: 'CHI', d: '2020s', s: { y: 65, c: 3.8, r: 25, t: 0.3 }, imp: 75, ea: 77 },
  { n: "Rashaad Penny", p: 'RB', t: 'SEA', d: '2020s', s: { y: 55, c: 5.5, r: 8, t: 0.4 }, imp: 73, ea: 75 },
  { n: "Antonio Gibson", p: 'RB', t: 'NE', d: '2020s', s: { y: 55, c: 4, r: 25, t: 0.4 }, imp: 73, ea: 75 },
  { n: "Stanley Morgan", p: 'WR', t: 'NE', d: '1970s', s: { y: 60, p: 15, t: 0.5, c: 50 }, imp: 78, ea: 82 },
  { n: "John Jefferson", p: 'WR', t: 'LAC', d: '1970s', s: { y: 75, p: 12.5, t: 0.6, c: 55 }, imp: 80, ea: 84 },
  { n: "Pat Tilley", p: 'WR', t: 'ARI', d: '1970s', s: { y: 55, p: 11.5, t: 0.3, c: 60 }, imp: 73, ea: 77 },
  { n: "Tony Hill", p: 'WR', t: 'DAL', d: '1970s', s: { y: 60, p: 12.5, t: 0.4, c: 55 }, imp: 76, ea: 80 },
  { n: "Charlie Brown", p: 'WR', t: 'WAS', d: '1980s', s: { y: 55, p: 11, t: 0.4, c: 60 }, imp: 75, ea: 78 },
  { n: "John Taylor", p: 'WR', t: 'SF', d: '1980s', s: { y: 65, p: 12.5, t: 0.5, c: 60 }, imp: 80, ea: 83 },
  { n: "Sterling Sharpe", p: 'WR', t: 'GB', d: '1980s', s: { y: 85, p: 11, t: 0.7, c: 65 }, imp: 84, ea: 87 },
  { n: "Curtis Duncan", p: 'WR', t: 'TEN', d: '1980s', s: { y: 50, p: 9.5, t: 0.3, c: 65 }, imp: 73, ea: 76 },
  { n: "Ernest Givins", p: 'WR', t: 'TEN', d: '1980s', s: { y: 65, p: 11, t: 0.4, c: 60 }, imp: 78, ea: 81 },
  { n: "Haywood Jeffires", p: 'WR', t: 'TEN', d: '1980s', s: { y: 60, p: 10.5, t: 0.4, c: 65 }, imp: 76, ea: 79 },
  { n: "Wes Chandler", p: 'WR', t: 'LAC', d: '1980s', s: { y: 75, p: 13, t: 0.5, c: 55 }, imp: 82, ea: 85 },
  { n: "Phil McConkey", p: 'WR', t: 'NYG', d: '1980s', s: { y: 35, p: 10.5, t: 0.2, c: 60 }, imp: 70, ea: 73 },
  { n: "Bobby Slay", p: 'WR', t: 'LAR', d: '1980s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Andre Hastings", p: 'WR', t: 'PIT', d: '1990s', s: { y: 55, p: 11, t: 0.3, c: 60 }, imp: 72, ea: 74 },
  { n: "James Jett", p: 'WR', t: 'LV', d: '1990s', s: { y: 50, p: 14, t: 0.4, c: 50 }, imp: 72, ea: 74 },
  { n: "Bert Emanuel", p: 'WR', t: 'ATL', d: '1990s', s: { y: 55, p: 11, t: 0.3, c: 60 }, imp: 73, ea: 75 },
  { n: "Wendell Davis", p: 'WR', t: 'CHI', d: '1990s', s: { y: 50, p: 10.5, t: 0.3, c: 60 }, imp: 72, ea: 74 },
  { n: "Charles Johnson", p: 'WR', t: 'PIT', d: '1990s', s: { y: 60, p: 12, t: 0.4, c: 58 }, imp: 75, ea: 77 },
  { n: "Keyshawn Johnson", p: 'WR', t: 'NYJ', d: '1990s', s: { y: 70, p: 10.5, t: 0.4, c: 65 }, imp: 80, ea: 82 },
  { n: "Tim Brown", p: 'WR', t: 'LV', d: '2000s', s: { y: 65, p: 11, t: 0.4, c: 60 }, imp: 78, ea: 79 },
  { n: "Terrell Owens", p: 'WR', t: 'DAL', d: '2000s', s: { y: 90, p: 13.5, t: 0.7, c: 58 }, imp: 88, ea: 89 },
  { n: "Santana Moss", p: 'WR', t: 'NYJ', d: '2000s', s: { y: 65, p: 12, t: 0.4, c: 60 }, imp: 78, ea: 79 },
  { n: "Santana Moss", p: 'WR', t: 'WAS', d: '2000s', s: { y: 75, p: 11, t: 0.4, c: 65 }, imp: 80, ea: 81 },
  { n: "Laveranues Coles", p: 'WR', t: 'NYJ', d: '2000s', s: { y: 75, p: 10.5, t: 0.4, c: 65 }, imp: 78, ea: 79 },
  { n: "Eddie Kennison", p: 'WR', t: 'KC', d: '2000s', s: { y: 65, p: 12, t: 0.4, c: 60 }, imp: 76, ea: 77 },
  { n: "T.J. Houshmandzadeh", p: 'WR', t: 'CIN', d: '2000s', s: { y: 75, p: 10, t: 0.4, c: 70 }, imp: 80, ea: 81 },
  { n: "Kevin Curtis", p: 'WR', t: 'PHI', d: '2000s', s: { y: 60, p: 12.5, t: 0.4, c: 58 }, imp: 75, ea: 76 },
  { n: "Nate Burleson", p: 'WR', t: 'MIN', d: '2000s', s: { y: 55, p: 11, t: 0.3, c: 60 }, imp: 73, ea: 74 },
  { n: "Steve Smith", p: 'WR', t: 'NYG', d: '2000s', s: { y: 65, p: 9.5, t: 0.3, c: 70 }, imp: 78, ea: 79 },
  { n: "Antwaan Randle El", p: 'WR', t: 'PIT', d: '2000s', s: { y: 55, p: 11, t: 0.3, c: 60 }, imp: 73, ea: 74 },
  { n: "Andre Roberts", p: 'WR', t: 'ARI', d: '2010s', s: { y: 50, p: 9.5, t: 0.3, c: 65 }, imp: 72, ea: 72 },
  { n: "Michael Floyd", p: 'WR', t: 'ARI', d: '2010s', s: { y: 60, p: 13, t: 0.4, c: 58 }, imp: 75, ea: 75 },
  { n: "Allen Hurns", p: 'WR', t: 'JAX', d: '2010s', s: { y: 65, p: 11.5, t: 0.5, c: 60 }, imp: 76, ea: 76 },
  { n: "Travis Benjamin", p: 'WR', t: 'CLE', d: '2010s', s: { y: 55, p: 13, t: 0.3, c: 55 }, imp: 73, ea: 73 },
  { n: "Robby Anderson", p: 'WR', t: 'NYJ', d: '2010s', s: { y: 60, p: 13, t: 0.4, c: 55 }, imp: 75, ea: 75 },
  { n: "Tavon Austin", p: 'WR', t: 'LAR', d: '2010s', s: { y: 35, p: 9.5, t: 0.2, c: 65 }, imp: 70, ea: 70 },
  { n: "Kendall Wright", p: 'WR', t: 'TEN', d: '2010s', s: { y: 55, p: 9.5, t: 0.2, c: 70 }, imp: 73, ea: 73 },
  { n: "Rishard Matthews", p: 'WR', t: 'TEN', d: '2010s', s: { y: 60, p: 11.5, t: 0.4, c: 60 }, imp: 74, ea: 74 },
  { n: "Greg Jennings", p: 'WR', t: 'MIN', d: '2010s', s: { y: 60, p: 10.5, t: 0.3, c: 65 }, imp: 75, ea: 75 },
  { n: "Jordan Matthews", p: 'WR', t: 'PHI', d: '2010s', s: { y: 65, p: 11, t: 0.4, c: 65 }, imp: 76, ea: 76 },
  { n: "Brandon LaFell", p: 'WR', t: 'NE', d: '2010s', s: { y: 60, p: 12, t: 0.4, c: 60 }, imp: 75, ea: 75 },
  { n: "Andre Holmes", p: 'WR', t: 'LV', d: '2010s', s: { y: 50, p: 12.5, t: 0.3, c: 55 }, imp: 72, ea: 72 },
  { n: "Justin Hunter", p: 'WR', t: 'TEN', d: '2010s', s: { y: 40, p: 14, t: 0.3, c: 50 }, imp: 70, ea: 70 },
  { n: "DeAndre Hopkins", p: 'WR', t: 'ARI', d: '2020s', s: { y: 75, p: 11, t: 0.4, c: 65 }, imp: 84, ea: 83 },
  { n: "DeAndre Hopkins", p: 'WR', t: 'TEN', d: '2020s', s: { y: 65, p: 11.5, t: 0.3, c: 65 }, imp: 80, ea: 79 },
  { n: "Treylon Burks", p: 'WR', t: 'TEN', d: '2020s', s: { y: 50, p: 11.5, t: 0.2, c: 60 }, imp: 72, ea: 71 },
  { n: "Kadarius Toney", p: 'WR', t: 'NYG', d: '2020s', s: { y: 45, p: 9.5, t: 0.2, c: 65 }, imp: 71, ea: 70 },
  { n: "Wan'Dale Robinson", p: 'WR', t: 'NYG', d: '2020s', s: { y: 55, p: 8.5, t: 0.3, c: 75 }, imp: 73, ea: 72 },
  { n: "Skyy Moore", p: 'WR', t: 'KC', d: '2020s', s: { y: 40, p: 9.5, t: 0.2, c: 65 }, imp: 70, ea: 69 },
  { n: "Xavier Worthy", p: 'WR', t: 'KC', d: '2020s', s: { y: 55, p: 11, t: 0.4, c: 65 }, imp: 75, ea: 74 },
  { n: "Calvin Austin III", p: 'WR', t: 'PIT', d: '2020s', s: { y: 50, p: 11, t: 0.3, c: 60 }, imp: 72, ea: 71 },
  { n: "Allen Lazard", p: 'WR', t: 'GB', d: '2020s', s: { y: 50, p: 11.5, t: 0.4, c: 60 }, imp: 73, ea: 72 },
  { n: "Marquez Valdes-Scantling", p: 'WR', t: 'KC', d: '2020s', s: { y: 45, p: 13, t: 0.3, c: 50 }, imp: 73, ea: 72 },
  { n: "Tutu Atwell", p: 'WR', t: 'LAR', d: '2020s', s: { y: 50, p: 12, t: 0.3, c: 55 }, imp: 73, ea: 72 },
  { n: "Demarcus Robinson", p: 'WR', t: 'LAR', d: '2020s', s: { y: 45, p: 12.5, t: 0.4, c: 55 }, imp: 72, ea: 71 },
  { n: "Curtis Samuel", p: 'WR', t: 'WAS', d: '2020s', s: { y: 55, p: 9, t: 0.3, c: 65 }, imp: 73, ea: 72 },
  { n: "Olamide Zaccheaus", p: 'WR', t: 'ATL', d: '2020s', s: { y: 50, p: 11.5, t: 0.3, c: 60 }, imp: 72, ea: 71 },
  { n: "Cedrick Wilson Jr.", p: 'WR', t: 'MIA', d: '2020s', s: { y: 40, p: 10.5, t: 0.2, c: 60 }, imp: 70, ea: 69 },
  { n: "Joshua Palmer", p: 'WR', t: 'LAC', d: '2020s', s: { y: 50, p: 11, t: 0.2, c: 65 }, imp: 72, ea: 71 },
  { n: "Brandin Cooks", p: 'WR', t: 'HOU', d: '2020s', s: { y: 60, p: 12, t: 0.4, c: 60 }, imp: 76, ea: 75 },
  { n: "Brandin Cooks", p: 'WR', t: 'DAL', d: '2020s', s: { y: 50, p: 11, t: 0.4, c: 60 }, imp: 74, ea: 73 },
  { n: "Calvin Ridley", p: 'WR', t: 'JAX', d: '2020s', s: { y: 70, p: 11.5, t: 0.4, c: 60 }, imp: 78, ea: 77 },
  { n: "Jim Mitchell", p: 'TE', t: 'ATL', d: '1970s', s: { y: 40, t: 0.3, b: 78 }, imp: 73, ea: 77 },
  { n: "Henry Childs", p: 'TE', t: 'NO', d: '1970s', s: { y: 45, t: 0.3, b: 75 }, imp: 73, ea: 77 },
  { n: "Anthony Munoz... ", p: 'TE', t: 'CIN', d: '1980s', s: { y: 30, t: 0.2, b: 88 }, imp: 76, ea: 79 },
  { n: "Don Hasselbeck", p: 'TE', t: 'NE', d: '1980s', s: { y: 30, t: 0.2, b: 80 }, imp: 71, ea: 74 },
  { n: "John Spagnola", p: 'TE', t: 'PHI', d: '1980s', s: { y: 40, t: 0.3, b: 78 }, imp: 73, ea: 76 },
  { n: "Eric Sievers", p: 'TE', t: 'LAC', d: '1980s', s: { y: 30, t: 0.3, b: 80 }, imp: 72, ea: 75 },
  { n: "Mickey Shuler", p: 'TE', t: 'PHI', d: '1990s', s: { y: 40, t: 0.3, b: 78 }, imp: 73, ea: 75 },
  { n: "Larry Donnell", p: 'TE', t: 'NYG', d: '2010s', s: { y: 40, t: 0.4, b: 70 }, imp: 73, ea: 73 },
  { n: "Coby Fleener", p: 'TE', t: 'IND', d: '2010s', s: { y: 50, t: 0.4, b: 70 }, imp: 76, ea: 76 },
  { n: "Coby Fleener", p: 'TE', t: 'NO', d: '2010s', s: { y: 45, t: 0.4, b: 70 }, imp: 73, ea: 73 },
  { n: "Zach Ertz", p: 'TE', t: 'ARI', d: '2020s', s: { y: 55, t: 0.4, b: 73 }, imp: 78, ea: 77 },
  { n: "Trey Burton", p: 'TE', t: 'PHI', d: '2010s', s: { y: 35, t: 0.4, b: 72 }, imp: 72, ea: 72 },
  { n: "Trey Burton", p: 'TE', t: 'CHI', d: '2010s', s: { y: 40, t: 0.4, b: 72 }, imp: 73, ea: 73 },
  { n: "Marcedes Lewis", p: 'TE', t: 'JAX', d: '2010s', s: { y: 35, t: 0.3, b: 82 }, imp: 74, ea: 74 },
  { n: "Marcedes Lewis", p: 'TE', t: 'GB', d: '2010s', s: { y: 25, t: 0.2, b: 85 }, imp: 73, ea: 73 },
  { n: "Garrett Celek", p: 'TE', t: 'SF', d: '2010s', s: { y: 30, t: 0.3, b: 75 }, imp: 71, ea: 71 },
  { n: "Brandon Pettigrew", p: 'TE', t: 'DET', d: '2010s', s: { y: 45, t: 0.3, b: 78 }, imp: 75, ea: 75 },
  { n: "George Kittle", p: 'TE', t: 'SF', d: '2010s', s: { y: 65, t: 0.3, b: 82 }, imp: 86, ea: 86 },
  { n: "Rob Gronkowski", p: 'TE', t: 'TB', d: '2020s', s: { y: 50, t: 0.5, b: 80 }, imp: 82, ea: 81 },
  { n: "Greg Olsen", p: 'TE', t: 'SEA', d: '2020s', s: { y: 30, t: 0.2, b: 72 }, imp: 72, ea: 71 },
  { n: "Hayden Hurst", p: 'TE', t: 'BAL', d: '2010s', s: { y: 30, t: 0.2, b: 73 }, imp: 71, ea: 71 },
  { n: "Hayden Hurst", p: 'TE', t: 'CIN', d: '2020s', s: { y: 35, t: 0.3, b: 73 }, imp: 72, ea: 71 },
  { n: "Tyler Conklin", p: 'TE', t: 'NYJ', d: '2020s', s: { y: 40, t: 0.3, b: 75 }, imp: 73, ea: 72 },
  { n: "Darren Waller", p: 'TE', t: 'LV', d: '2020s', s: { y: 65, t: 0.4, b: 70 }, imp: 84, ea: 83 },
  { n: "T.J. Hockenson", p: 'TE', t: 'DET', d: '2020s', s: { y: 50, t: 0.4, b: 75 }, imp: 80, ea: 79 },
  { n: "Gerald Everett", p: 'TE', t: 'LAC', d: '2020s', s: { y: 40, t: 0.3, b: 73 }, imp: 74, ea: 73 },
  { n: "Greg Dulcich", p: 'TE', t: 'DEN', d: '2020s', s: { y: 30, t: 0.2, b: 72 }, imp: 70, ea: 69 },
  { n: "Will Dissly", p: 'TE', t: 'SEA', d: '2020s', s: { y: 35, t: 0.3, b: 80 }, imp: 73, ea: 72 },
  { n: "Will Dissly", p: 'TE', t: 'LAC', d: '2020s', s: { y: 30, t: 0.3, b: 80 }, imp: 72, ea: 71 },
  { n: "Cole Turner", p: 'TE', t: 'WAS', d: '2020s', s: { y: 25, t: 0.2, b: 75 }, imp: 70, ea: 69 },
  { n: "Luke Musgrave", p: 'TE', t: 'GB', d: '2020s', s: { y: 30, t: 0.2, b: 72 }, imp: 71, ea: 70 },
  { n: "Juwan Johnson", p: 'TE', t: 'NO', d: '2020s', s: { y: 35, t: 0.4, b: 72 }, imp: 73, ea: 72 },
  { n: "Chig Okonkwo", p: 'TE', t: 'TEN', d: '2020s', s: { y: 35, t: 0.3, b: 73 }, imp: 72, ea: 71 },
  { n: "Jordan Akins", p: 'TE', t: 'CLE', d: '2020s', s: { y: 30, t: 0.3, b: 72 }, imp: 71, ea: 70 },
  { n: "Foster Moreau", p: 'TE', t: 'NO', d: '2020s', s: { y: 30, t: 0.3, b: 75 }, imp: 71, ea: 70 },
  { n: "Tyler Higbee", p: 'TE', t: 'LAR', d: '2010s', s: { y: 40, t: 0.3, b: 78 }, imp: 74, ea: 74 },
  { n: "Jared Cook", p: 'TE', t: 'NO', d: '2010s', s: { y: 50, t: 0.4, b: 70 }, imp: 76, ea: 76 },
  { n: "Jordan Reed", p: 'TE', t: 'WAS', d: '2010s', s: { y: 55, t: 0.4, b: 72 }, imp: 78, ea: 78 },
  { n: "Eric Ebron", p: 'TE', t: 'PIT', d: '2020s', s: { y: 35, t: 0.3, b: 70 }, imp: 72, ea: 71 },
  { n: "Dan Pastorini", p: 'QB', t: 'TEN', d: '1970s', s: { y: 215, t: 1.3, i: 1.5, r: 65 , ry: 8 }, imp: 74, ea: 78 },
  { n: "Lynn Dickey", p: 'QB', t: 'GB', d: '1970s', s: { y: 200, t: 1.2, i: 1.4, r: 70 , ry: 8 }, imp: 73, ea: 77 },
  { n: "Bob Avellini", p: 'QB', t: 'CHI', d: '1970s', s: { y: 175, t: 1, i: 1.4, r: 60 , ry: 8 }, imp: 70, ea: 74 },
  { n: "Joe Pisarcik", p: 'QB', t: 'NYG', d: '1970s', s: { y: 170, t: 1, i: 1.5, r: 58 , ry: 8 }, imp: 68, ea: 72 },
  { n: "Jim Plunkett", p: 'QB', t: 'NE', d: '1970s', s: { y: 195, t: 1.2, i: 1.4, r: 65 , ry: 8 }, imp: 72, ea: 76 },
  { n: "Joe Ferguson", p: 'QB', t: 'BUF', d: '1980s', s: { y: 215, t: 1.3, i: 1.2, r: 70 , ry: 7 }, imp: 73, ea: 76 },
  { n: "Steve Bartkowski", p: 'QB', t: 'ATL', d: '1980s', s: { y: 225, t: 1.4, i: 1.1, r: 78 , ry: 7 }, imp: 76, ea: 79 },
  { n: "Brian Sipe", p: 'QB', t: 'CLE', d: '1980s', s: { y: 240, t: 1.6, i: 1.2, r: 84 , ry: 7 }, imp: 80, ea: 83 },
  { n: "Vinny Testaverde", p: 'QB', t: 'CLE', d: '1990s', s: { y: 245, t: 1.5, i: 1.1, r: 82 , ry: 4 }, imp: 78, ea: 80 },
  { n: "Don Majkowski", p: 'QB', t: 'GB', d: '1980s', s: { y: 240, t: 1.6, i: 1, r: 82 , ry: 7 }, imp: 78, ea: 81 },
  { n: "Trent Dilfer", p: 'QB', t: 'BAL', d: '2000s', s: { y: 195, t: 1.1, i: 1, r: 73 , ry: 6 }, imp: 75, ea: 76 },
  { n: "Jim Everett", p: 'QB', t: 'NO', d: '1990s', s: { y: 220, t: 1.4, i: 1.2, r: 75 , ry: 6 }, imp: 73, ea: 75 },
  { n: "Tony Banks", p: 'QB', t: 'BAL', d: '1990s', s: { y: 215, t: 1.2, i: 1.2, r: 72 , ry: 6 }, imp: 72, ea: 74 },
  { n: "Scott Mitchell", p: 'QB', t: 'DET', d: '1990s', s: { y: 245, t: 1.5, i: 1.2, r: 80 , ry: 6 }, imp: 76, ea: 78 },
  { n: "Drew Bledsoe", p: 'QB', t: 'BUF', d: '2000s', s: { y: 245, t: 1.5, i: 1, r: 80 , ry: 1 }, imp: 78, ea: 79 },
  { n: "Steve Walsh", p: 'QB', t: 'NO', d: '1990s', s: { y: 195, t: 1.1, i: 1, r: 75 , ry: 6 }, imp: 72, ea: 74 },
  { n: "Rick Mirer", p: 'QB', t: 'SEA', d: '1990s', s: { y: 200, t: 1, i: 1.3, r: 65 , ry: 6 }, imp: 70, ea: 72 },
  { n: "Jake Plummer", p: 'QB', t: 'ARI', d: '2000s', s: { y: 215, t: 1.2, i: 1.2, r: 70 , ry: 12 }, imp: 72, ea: 73 },
  { n: "Tommy Maddox", p: 'QB', t: 'PIT', d: '2000s', s: { y: 220, t: 1.3, i: 1, r: 80 , ry: 6 }, imp: 73, ea: 74 },
  { n: "Trent Edwards", p: 'QB', t: 'BUF', d: '2000s', s: { y: 200, t: 1.1, i: 0.9, r: 78 , ry: 6 }, imp: 72, ea: 73 },
  { n: "Tarvaris Jackson", p: 'QB', t: 'MIN', d: '2000s', s: { y: 185, t: 1, i: 1.1, r: 72 , ry: 6 }, imp: 70, ea: 71 },
  { n: "Charlie Batch", p: 'QB', t: 'DET', d: '2000s', s: { y: 215, t: 1.3, i: 1.1, r: 75 , ry: 6 }, imp: 72, ea: 73 },
  { n: "Tim Couch", p: 'QB', t: 'CLE', d: '2000s', s: { y: 210, t: 1, i: 1.1, r: 73 , ry: 5 }, imp: 70, ea: 71 },
  { n: "Jay Cutler", p: 'QB', t: 'CHI', d: '2010s', s: { y: 245, t: 1.5, i: 1, r: 84 , ry: 8 }, imp: 78, ea: 78 },
  { n: "Mark Sanchez", p: 'QB', t: 'NYJ', d: '2010s', s: { y: 215, t: 1.2, i: 1.1, r: 74 , ry: 7 }, imp: 73, ea: 73 },
  { n: "Tim Tebow", p: 'QB', t: 'DEN', d: '2010s', s: { y: 175, t: 0.8, i: 0.5, r: 75 , ry: 7 }, imp: 73, ea: 73 },
  { n: "Geno Smith", p: 'QB', t: 'NYJ', d: '2010s', s: { y: 215, t: 1.1, i: 1.2, r: 70 , ry: 12 }, imp: 70, ea: 70 },
  { n: "Ryan Tannehill", p: 'QB', t: 'TEN', d: '2010s', s: { y: 255, t: 1.8, i: 0.6, r: 117.5 , ry: 12 }, imp: 88, ea: 88 },
  { n: "Teddy Bridgewater", p: 'QB', t: 'MIN', d: '2010s', s: { y: 215, t: 1.1, i: 0.6, r: 86 , ry: 7 }, imp: 76, ea: 76 },
  { n: "Jimmy Garoppolo", p: 'QB', t: 'SF', d: '2010s', s: { y: 250, t: 1.6, i: 0.8, r: 95 , ry: 3 }, imp: 82, ea: 82 },
  { n: "Brian Hoyer", p: 'QB', t: 'CLE', d: '2010s', s: { y: 225, t: 1, i: 0.7, r: 80 , ry: 7 }, imp: 72, ea: 72 },
  { n: "Sam Darnold", p: 'QB', t: 'NYJ', d: '2020s', s: { y: 215, t: 1.1, i: 1, r: 80 , ry: 8 }, imp: 72, ea: 71 },
  { n: "Aaron Rodgers", p: 'QB', t: 'NYJ', d: '2020s', s: { y: 200, t: 1.2, i: 0.4, r: 90 , ry: 5 }, imp: 78, ea: 77 },
  { n: "Dave Hampton", p: 'RB', t: 'ATL', d: '1970s', s: { y: 65, c: 4, r: 18, t: 0.4 }, imp: 73, ea: 73 },
  { n: "Mike Pruitt", p: 'RB', t: 'CLE', d: '1980s', s: { y: 70, c: 4.3, r: 20, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Wendell Tyler", p: 'RB', t: 'LAR', d: '1980s', s: { y: 70, c: 4.4, r: 20, t: 0.5 }, imp: 75, ea: 76 },
  { n: "Earnest Jackson", p: 'RB', t: 'PHI', d: '1980s', s: { y: 65, c: 3.9, r: 12, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Earnest Byner", p: 'RB', t: 'WAS', d: '1990s', s: { y: 65, c: 4, r: 30, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Tony Dorsett", p: 'RB', t: 'DEN', d: '1980s', s: { y: 55, c: 4, r: 20, t: 0.3 }, imp: 73, ea: 74 },
  { n: "James Brooks", p: 'RB', t: 'LAC', d: '1980s', s: { y: 50, c: 4.5, r: 25, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Robert Smith", p: 'RB', t: 'MIN', d: '2000s', s: { y: 95, c: 4.9, r: 30, t: 0.6 }, imp: 82, ea: 83 },
  { n: "Errict Rhett", p: 'RB', t: 'TB', d: '1990s', s: { y: 75, c: 3.6, r: 18, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Stephen Davis", p: 'RB', t: 'WAS', d: '2000s', s: { y: 85, c: 4, r: 15, t: 0.7 }, imp: 80, ea: 81 },
  { n: "Stephen Davis", p: 'RB', t: 'CAR', d: '2000s', s: { y: 80, c: 4, r: 15, t: 0.6 }, imp: 76, ea: 77 },
  { n: "Corey Dillon", p: 'RB', t: 'CIN', d: '2000s', s: { y: 90, c: 4.4, r: 15, t: 0.6 }, imp: 82, ea: 83 },
  { n: "Eddie George", p: 'RB', t: 'TEN', d: '2000s', s: { y: 75, c: 3.8, r: 18, t: 0.7 }, imp: 82, ea: 83 },
  { n: "Curtis Martin", p: 'RB', t: 'NYJ', d: '2000s', s: { y: 90, c: 4, r: 25, t: 0.6 }, imp: 86, ea: 87 },
  { n: "Justin Forsett", p: 'RB', t: 'BAL', d: '2010s', s: { y: 75, c: 5.4, r: 25, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Spencer Ware", p: 'RB', t: 'KC', d: '2010s', s: { y: 65, c: 4.5, r: 30, t: 0.5 }, imp: 75, ea: 76 },
  { n: "Latavius Murray", p: 'RB', t: 'NO', d: '2010s', s: { y: 55, c: 4.5, r: 15, t: 0.5 }, imp: 73, ea: 74 },
  { n: "Devin Singletary", p: 'RB', t: 'BUF', d: '2010s', s: { y: 60, c: 4.4, r: 18, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Kareem Hunt", p: 'RB', t: 'CLE', d: '2020s', s: { y: 55, c: 4, r: 18, t: 0.4 }, imp: 73, ea: 75 },
  { n: "Phillip Lindsay", p: 'RB', t: 'DEN', d: '2010s', s: { y: 70, c: 4.7, r: 18, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Tarik Cohen", p: 'RB', t: 'CHI', d: '2010s', s: { y: 40, c: 4, r: 40, t: 0.3 }, imp: 73, ea: 74 },
  { n: "James Conner", p: 'RB', t: 'PIT', d: '2010s', s: { y: 75, c: 4.2, r: 30, t: 0.6 }, imp: 78, ea: 79 },
  { n: "Rashaad Penny", p: 'RB', t: 'SEA', d: '2010s', s: { y: 50, c: 5, r: 12, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Sony Michel", p: 'RB', t: 'NE', d: '2010s', s: { y: 70, c: 4.2, r: 12, t: 0.4 }, imp: 75, ea: 76 },
  { n: "D'Onta Foreman", p: 'RB', t: 'CAR', d: '2020s', s: { y: 65, c: 4.5, r: 8, t: 0.4 }, imp: 73, ea: 75 },
  { n: "Aaron Jones", p: 'RB', t: 'MIN', d: '2020s', s: { y: 70, c: 4.5, r: 25, t: 0.4 }, imp: 76, ea: 78 },
  { n: "Cliff Branch", p: 'WR', t: 'LV', d: '1980s', s: { y: 55, p: 17, t: 0.4, c: 45 }, imp: 74, ea: 77 },
  { n: "John Stallworth", p: 'WR', t: 'PIT', d: '1980s', s: { y: 65, p: 15.5, t: 0.5, c: 55 }, imp: 80, ea: 83 },
  { n: "Harold Carmichael", p: 'WR', t: 'PHI', d: '1980s', s: { y: 55, p: 13, t: 0.4, c: 55 }, imp: 75, ea: 78 },
  { n: "Wesley Walker", p: 'WR', t: 'NYJ', d: '1980s', s: { y: 60, p: 16, t: 0.5, c: 50 }, imp: 76, ea: 79 },
  { n: "Eric Martin", p: 'WR', t: 'NO', d: '1990s', s: { y: 65, p: 13.5, t: 0.4, c: 55 }, imp: 74, ea: 76 },
  { n: "Mark Carrier", p: 'WR', t: 'TB', d: '1980s', s: { y: 55, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Mark Carrier", p: 'WR', t: 'CAR', d: '1990s', s: { y: 55, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "Irving Fryar", p: 'WR', t: 'NE', d: '1990s', s: { y: 60, p: 13.5, t: 0.4, c: 60 }, imp: 74, ea: 76 },
  { n: "Irving Fryar", p: 'WR', t: 'MIA', d: '1990s', s: { y: 70, p: 13.5, t: 0.4, c: 60 }, imp: 76, ea: 78 },
  { n: "Irving Fryar", p: 'WR', t: 'PHI', d: '1990s', s: { y: 70, p: 13.5, t: 0.5, c: 60 }, imp: 76, ea: 78 },
  { n: "O.J. McDuffie", p: 'WR', t: 'MIA', d: '1990s', s: { y: 60, p: 11, t: 0.3, c: 60 }, imp: 73, ea: 75 },
  { n: "Eddie Kennison", p: 'WR', t: 'LAR', d: '1990s', s: { y: 55, p: 14, t: 0.3, c: 55 }, imp: 73, ea: 75 },
  { n: "Tim McGee", p: 'WR', t: 'CIN', d: '1990s', s: { y: 55, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "Anthony Edwards", p: 'WR', t: 'ARI', d: '1990s', s: { y: 40, p: 11.5, t: 0.3, c: 55 }, imp: 70, ea: 72 },
  { n: "Joey Galloway", p: 'WR', t: 'TB', d: '2000s', s: { y: 75, p: 14, t: 0.5, c: 55 }, imp: 78, ea: 79 },
  { n: "Plaxico Burress", p: 'WR', t: 'PIT', d: '2000s', s: { y: 70, p: 14.5, t: 0.5, c: 55 }, imp: 78, ea: 79 },
  { n: "Steve Smith Sr.", p: 'WR', t: 'CAR', d: '2010s', s: { y: 65, p: 12.5, t: 0.4, c: 60 }, imp: 78, ea: 78 },
  { n: "Vincent Jackson", p: 'WR', t: 'TB', d: '2010s', s: { y: 80, p: 14, t: 0.5, c: 60 }, imp: 80, ea: 80 },
  { n: "Brandon Marshall", p: 'WR', t: 'MIA', d: '2010s', s: { y: 75, p: 12, t: 0.4, c: 60 }, imp: 78, ea: 78 },
  { n: "Brandon Marshall", p: 'WR', t: 'NYJ', d: '2010s', s: { y: 80, p: 12.5, t: 0.6, c: 65 }, imp: 80, ea: 80 },
  { n: "Jeremy Maclin", p: 'WR', t: 'PHI', d: '2010s', s: { y: 65, p: 11.5, t: 0.4, c: 60 }, imp: 76, ea: 76 },
  { n: "DeSean Jackson", p: 'WR', t: 'PHI', d: '2010s', s: { y: 75, p: 16.5, t: 0.5, c: 55 }, imp: 80, ea: 80 },
  { n: "DeSean Jackson", p: 'WR', t: 'WAS', d: '2010s', s: { y: 70, p: 16, t: 0.5, c: 55 }, imp: 78, ea: 78 },
  { n: "DeSean Jackson", p: 'WR', t: 'TB', d: '2010s', s: { y: 50, p: 16.5, t: 0.3, c: 50 }, imp: 73, ea: 73 },
  { n: "Pierre Garcon", p: 'WR', t: 'IND', d: '2010s', s: { y: 60, p: 12, t: 0.4, c: 60 }, imp: 75, ea: 75 },
  { n: "Eric Decker", p: 'WR', t: 'NYJ', d: '2010s', s: { y: 65, p: 12.5, t: 0.5, c: 60 }, imp: 76, ea: 76 },
  { n: "Golden Tate", p: 'WR', t: 'SEA', d: '2010s', s: { y: 60, p: 11.5, t: 0.3, c: 65 }, imp: 76, ea: 76 },
  { n: "Marvin Jones Jr.", p: 'WR', t: 'JAX', d: '2020s', s: { y: 50, p: 12, t: 0.3, c: 55 }, imp: 72, ea: 71 },
  { n: "Kenny Britt", p: 'WR', t: 'TEN', d: '2010s', s: { y: 50, p: 14, t: 0.3, c: 55 }, imp: 73, ea: 73 },
  { n: "Kenny Britt", p: 'WR', t: 'LAR', d: '2010s', s: { y: 60, p: 13.5, t: 0.3, c: 55 }, imp: 73, ea: 73 },
  { n: "Larry Fitzgerald", p: 'WR', t: 'ARI', d: '2020s', s: { y: 55, p: 9.5, t: 0.3, c: 65 }, imp: 76, ea: 75 },
  { n: "Anquan Boldin", p: 'WR', t: 'BAL', d: '2010s', s: { y: 55, p: 11, t: 0.3, c: 60 }, imp: 73, ea: 73 },
  { n: "Michael Thomas", p: 'WR', t: 'NO', d: '2010s', s: { y: 95, p: 10, t: 0.5, c: 75 }, imp: 88, ea: 88 },
  { n: "Michael Thomas", p: 'WR', t: 'NO', d: '2020s', s: { y: 70, p: 9.5, t: 0.3, c: 70 }, imp: 76, ea: 75 },
  { n: "JuJu Smith-Schuster", p: 'WR', t: 'PIT', d: '2010s', s: { y: 70, p: 11, t: 0.4, c: 65 }, imp: 78, ea: 78 },
  { n: "JuJu Smith-Schuster", p: 'WR', t: 'KC', d: '2020s', s: { y: 50, p: 10, t: 0.2, c: 70 }, imp: 73, ea: 72 },
  { n: "Chris Godwin", p: 'WR', t: 'TB', d: '2010s', s: { y: 65, p: 11, t: 0.4, c: 65 }, imp: 78, ea: 78 },
  { n: "Keenan Allen", p: 'WR', t: 'LAC', d: '2010s', s: { y: 80, p: 10, t: 0.4, c: 70 }, imp: 84, ea: 84 },
  { n: "Garrett Wilson", p: 'WR', t: 'NYJ', d: '2020s', s: { y: 75, p: 11, t: 0.3, c: 65 }, imp: 82, ea: 81 },
  { n: "Marvin Harrison Jr.", p: 'WR', t: 'ARI', d: '2020s', s: { y: 65, p: 11, t: 0.4, c: 60 }, imp: 80, ea: 79 },
  { n: "Rome Odunze", p: 'WR', t: 'CHI', d: '2020s', s: { y: 60, p: 11, t: 0.3, c: 60 }, imp: 78, ea: 77 },
  { n: "Ladd McConkey", p: 'WR', t: 'LAC', d: '2020s', s: { y: 70, p: 11, t: 0.4, c: 70 }, imp: 80, ea: 79 },
  { n: "Brian Thomas Jr.", p: 'WR', t: 'JAX', d: '2020s', s: { y: 75, p: 13, t: 0.6, c: 60 }, imp: 82, ea: 81 },
  { n: "Jackie Smith", p: 'TE', t: 'ARI', d: '1970s', s: { y: 45, t: 0.3, b: 78 }, imp: 76, ea: 80 },
  { n: "Russ Francis", p: 'TE', t: 'SF', d: '1980s', s: { y: 35, t: 0.3, b: 82 }, imp: 74, ea: 77 },
  { n: "Dan Ross", p: 'TE', t: 'CIN', d: '1980s', s: { y: 40, t: 0.3, b: 75 }, imp: 73, ea: 76 },
  { n: "Anthony Miller", p: 'WR', t: 'DAL', d: '1990s', s: { y: 30, t: 0.2, b: 80 }, imp: 72, ea: 74 },
  { n: "Shannon Sharpe", p: 'TE', t: 'DEN', d: '2000s', s: { y: 55, t: 0.4, b: 70 }, imp: 78, ea: 79 },
  { n: "Shannon Sharpe", p: 'TE', t: 'BAL', d: '2000s', s: { y: 55, t: 0.5, b: 70 }, imp: 80, ea: 81 },
  { n: "Wesley Walls", p: 'TE', t: 'CAR', d: '2000s', s: { y: 45, t: 0.5, b: 75 }, imp: 76, ea: 77 },
  { n: "Frank Wycheck", p: 'TE', t: 'TEN', d: '2000s', s: { y: 45, t: 0.3, b: 78 }, imp: 75, ea: 76 },
  { n: "Tony Gonzalez", p: 'TE', t: 'ATL', d: '2010s', s: { y: 55, t: 0.5, b: 72 }, imp: 82, ea: 82 },
  { n: "Ben Watson", p: 'TE', t: 'NE', d: '2000s', s: { y: 35, t: 0.3, b: 78 }, imp: 73, ea: 74 },
  { n: "L.J. Smith", p: 'TE', t: 'PHI', d: '2000s', s: { y: 35, t: 0.3, b: 75 }, imp: 72, ea: 73 },
  { n: "Jermaine Wiggins", p: 'TE', t: 'MIN', d: '2000s', s: { y: 35, t: 0.3, b: 78 }, imp: 72, ea: 73 },
  { n: "Marcedes Lewis", p: 'TE', t: 'JAX', d: '2000s', s: { y: 40, t: 0.3, b: 82 }, imp: 74, ea: 75 },
  { n: "Marcedes Lewis", p: 'TE', t: 'GB', d: '2020s', s: { y: 15, t: 0.1, b: 85 }, imp: 70, ea: 69 },
  { n: "Owen Daniels", p: 'TE', t: 'HOU', d: '2010s', s: { y: 45, t: 0.4, b: 75 }, imp: 75, ea: 75 },
  { n: "Anthony Fasano", p: 'TE', t: 'MIA', d: '2010s', s: { y: 25, t: 0.3, b: 80 }, imp: 72, ea: 72 },
  { n: "Jermaine Gresham", p: 'TE', t: 'CIN', d: '2010s', s: { y: 40, t: 0.3, b: 75 }, imp: 73, ea: 73 },
  { n: "Zach Ertz", p: 'TE', t: 'WAS', d: '2020s', s: { y: 40, t: 0.3, b: 70 }, imp: 73, ea: 72 },
  { n: "Delanie Walker", p: 'TE', t: 'SF', d: '2010s', s: { y: 35, t: 0.3, b: 80 }, imp: 73, ea: 73 },
  { n: "Greg Olsen", p: 'TE', t: 'CHI', d: '2010s', s: { y: 45, t: 0.3, b: 75 }, imp: 76, ea: 76 },
  { n: "Dallas Goedert", p: 'TE', t: 'PHI', d: '2020s', s: { y: 50, t: 0.3, b: 80 }, imp: 78, ea: 77 },
  { n: "Evan Engram", p: 'TE', t: 'NYG', d: '2010s', s: { y: 50, t: 0.3, b: 70 }, imp: 76, ea: 76 },
  { n: "Hayden Hurst", p: 'TE', t: 'ATL', d: '2020s', s: { y: 40, t: 0.4, b: 72 }, imp: 73, ea: 72 },
  { n: "Hunter Henry", p: 'TE', t: 'LAC', d: '2020s', s: { y: 50, t: 0.4, b: 78 }, imp: 76, ea: 75 },
  { n: "Cliff Stoudt", p: 'QB', t: 'PIT', d: '1980s', s: { y: 185, t: 1, i: 1.4, r: 60 , ry: 7 }, imp: 70, ea: 73 },
  { n: "Mike Pagel", p: 'QB', t: 'IND', d: '1980s', s: { y: 175, t: 1, i: 1.3, r: 62.5 , ry: 7 }, imp: 70, ea: 73 },
  { n: "Mike Pagel", p: 'QB', t: 'CLE', d: '1980s', s: { y: 170, t: 1, i: 1.2, r: 65 , ry: 7 }, imp: 70, ea: 73 },
  { n: "David Archer", p: 'QB', t: 'ATL', d: '1980s', s: { y: 195, t: 1.1, i: 1.4, r: 64 , ry: 7 }, imp: 70, ea: 73 },
  { n: "Mike Tomczak", p: 'QB', t: 'CHI', d: '1980s', s: { y: 185, t: 1.1, i: 1.3, r: 68 , ry: 7 }, imp: 71, ea: 74 },
  { n: "Dieter Brock", p: 'QB', t: 'LAR', d: '1980s', s: { y: 195, t: 1.2, i: 0.9, r: 78.5 , ry: 7 }, imp: 74, ea: 77 },
  { n: "Scott Brunner", p: 'QB', t: 'NYG', d: '1980s', s: { y: 175, t: 1, i: 1.4, r: 60.5 , ry: 7 }, imp: 68, ea: 71 },
  { n: "Bert Jones", p: 'QB', t: 'LAR', d: '1980s', s: { y: 170, t: 1, i: 1, r: 70.5 , ry: 12 }, imp: 70, ea: 73 },
  { n: "Richard Todd", p: 'QB', t: 'NYJ', d: '1980s', s: { y: 215, t: 1.3, i: 1.5, r: 67.5 , ry: 7 }, imp: 72, ea: 75 },
  { n: "Gary Danielson", p: 'QB', t: 'DET', d: '1980s', s: { y: 195, t: 1.2, i: 1.1, r: 75.5 , ry: 7 }, imp: 72, ea: 75 },
  { n: "Gary Danielson", p: 'QB', t: 'CLE', d: '1980s', s: { y: 215, t: 1.4, i: 1, r: 78.5 , ry: 7 }, imp: 74, ea: 77 },
  { n: "Archie Manning", p: 'QB', t: 'NO', d: '1980s', s: { y: 200, t: 1.1, i: 1.3, r: 66 , ry: 18 }, imp: 72, ea: 75 },
  { n: "Archie Manning", p: 'QB', t: 'TEN', d: '1980s', s: { y: 175, t: 1, i: 1.4, r: 60 , ry: 18 }, imp: 70, ea: 73 },
  { n: "Bubby Brister", p: 'QB', t: 'PIT', d: '1980s', s: { y: 215, t: 1.2, i: 1, r: 72.5 , ry: 7 }, imp: 73, ea: 76 },
  { n: "Steve Grogan", p: 'QB', t: 'NE', d: '1980s', s: { y: 195, t: 1.2, i: 1.3, r: 68 , ry: 22 }, imp: 73, ea: 76 },
  { n: "Mark Rypien", p: 'QB', t: 'WAS', d: '1980s', s: { y: 205, t: 1.3, i: 0.9, r: 81 , ry: 2 }, imp: 75, ea: 78 },
  { n: "Erik Kramer", p: 'QB', t: 'DET', d: '1980s', s: { y: 195, t: 1.2, i: 0.9, r: 80 , ry: 7 }, imp: 74, ea: 77 },
  { n: "Pat Haden", p: 'QB', t: 'LAR', d: '1980s', s: { y: 170, t: 1, i: 1.3, r: 68 , ry: 7 }, imp: 70, ea: 73 },
  { n: "Steve Fuller", p: 'QB', t: 'CHI', d: '1980s', s: { y: 175, t: 1, i: 0.9, r: 72 , ry: 7 }, imp: 71, ea: 74 },
  { n: "Vince Evans", p: 'QB', t: 'CHI', d: '1980s', s: { y: 165, t: 1, i: 1.3, r: 62 , ry: 7 }, imp: 68, ea: 71 },
  { n: "Mark Herrmann", p: 'QB', t: 'LAC', d: '1980s', s: { y: 175, t: 1, i: 1, r: 75 , ry: 7 }, imp: 70, ea: 73 },
  { n: "Hugh Millen", p: 'QB', t: 'NE', d: '1980s', s: { y: 195, t: 1.1, i: 1.3, r: 70 , ry: 7 }, imp: 70, ea: 73 },
  { n: "Mike Moroski", p: 'QB', t: 'ATL', d: '1980s', s: { y: 175, t: 0.9, i: 1.4, r: 58 , ry: 7 }, imp: 68, ea: 71 },
  { n: "Dave Wilson", p: 'QB', t: 'NO', d: '1980s', s: { y: 195, t: 1.1, i: 1.2, r: 70 , ry: 7 }, imp: 71, ea: 74 },
  { n: "Babe Laufenberg", p: 'QB', t: 'DAL', d: '1980s', s: { y: 170, t: 1, i: 1.1, r: 65 , ry: 7 }, imp: 68, ea: 71 },
  { n: "Mark Vlasic", p: 'QB', t: 'LAC', d: '1980s', s: { y: 165, t: 0.9, i: 1.2, r: 65 , ry: 7 }, imp: 67, ea: 70 },
  { n: "Joe Pisarcik", p: 'QB', t: 'PHI', d: '1980s', s: { y: 170, t: 1, i: 1.3, r: 62 , ry: 7 }, imp: 68, ea: 71 },
  { n: "Sam Wyche", p: 'QB', t: 'TB', d: '1980s', s: { y: 165, t: 0.9, i: 1.4, r: 58 , ry: 7 }, imp: 65, ea: 68 },
  { n: "Greg Landry", p: 'QB', t: 'CHI', d: '1980s', s: { y: 175, t: 1, i: 1.2, r: 70 , ry: 30 }, imp: 71, ea: 74 },
  { n: "Steve Beuerlein", p: 'QB', t: 'LV', d: '1980s', s: { y: 190, t: 1.1, i: 0.9, r: 78 , ry: 2 }, imp: 73, ea: 76 },
  { n: "Jay Schroeder", p: 'QB', t: 'LAR', d: '1980s', s: { y: 215, t: 1.3, i: 1.2, r: 74.5 , ry: 7 }, imp: 74, ea: 77 },
  { n: "Stan Humphries", p: 'QB', t: 'WAS', d: '1980s', s: { y: 195, t: 1.1, i: 0.9, r: 78 , ry: 7 }, imp: 73, ea: 76 },
  { n: "Doug Flutie", p: 'QB', t: 'NE', d: '1980s', s: { y: 200, t: 1.2, i: 1, r: 75 , ry: 18 }, imp: 75, ea: 78 },
  { n: "Doug Flutie", p: 'QB', t: 'CHI', d: '1980s', s: { y: 195, t: 1.1, i: 1, r: 73 , ry: 18 }, imp: 73, ea: 76 },
  { n: "George Rogers", p: 'RB', t: 'WAS', d: '1980s', s: { y: 75, c: 3.8, r: 10, t: 0.7 }, imp: 78, ea: 79 },
  { n: "Greg Bell", p: 'RB', t: 'BUF', d: '1980s', s: { y: 75, c: 4.2, r: 18, t: 0.6 }, imp: 76, ea: 77 },
  { n: "Marion Butts", p: 'RB', t: 'LAC', d: '1980s', s: { y: 75, c: 4, r: 12, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Eric Dickerson", p: 'RB', t: 'IND', d: '1980s', s: { y: 85, c: 4.2, r: 18, t: 0.5 }, imp: 84, ea: 85 },
  { n: "Bo Jackson", p: 'RB', t: 'LV', d: '1980s', s: { y: 85, c: 5.4, r: 15, t: 0.7 }, imp: 86, ea: 87 },
  { n: "Earl Campbell", p: 'RB', t: 'NO', d: '1980s', s: { y: 50, c: 3.5, r: 8, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Earnest Jackson", p: 'RB', t: 'LAC', d: '1980s', s: { y: 80, c: 4.4, r: 8, t: 0.6 }, imp: 75, ea: 76 },
  { n: "Wendell Tyler", p: 'RB', t: 'SF', d: '1980s', s: { y: 65, c: 4.4, r: 20, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Ottis Anderson", p: 'RB', t: 'ARI', d: '1980s', s: { y: 80, c: 3.8, r: 25, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Lionel James", p: 'RB', t: 'LAC', d: '1980s', s: { y: 40, c: 4, r: 55, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Ricky Bell", p: 'RB', t: 'TB', d: '1980s', s: { y: 65, c: 3.7, r: 12, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Herschel Walker", p: 'RB', t: 'MIN', d: '1980s', s: { y: 65, c: 3.5, r: 18, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Mark van Eeghen", p: 'RB', t: 'LV', d: '1980s', s: { y: 65, c: 4, r: 12, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Buford Jordan", p: 'RB', t: 'NO', d: '1980s', s: { y: 45, c: 4, r: 15, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Earl Cooper", p: 'RB', t: 'SF', d: '1980s', s: { y: 40, c: 3.8, r: 40, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Tony Hill", p: 'WR', t: 'DAL', d: '1980s', s: { y: 75, p: 14, t: 0.5, c: 55 }, imp: 80, ea: 83 },
  { n: "Drew Pearson", p: 'WR', t: 'DAL', d: '1980s', s: { y: 60, p: 13.5, t: 0.4, c: 55 }, imp: 75, ea: 78 },
  { n: "Charlie Joiner", p: 'WR', t: 'LAC', d: '1980s', s: { y: 65, p: 14, t: 0.3, c: 60 }, imp: 80, ea: 83 },
  { n: "Sammy White", p: 'WR', t: 'MIN', d: '1980s', s: { y: 60, p: 14, t: 0.4, c: 55 }, imp: 75, ea: 78 },
  { n: "Cris Burford", p: 'WR', t: 'KC', d: '1980s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Tim McGee", p: 'WR', t: 'CIN', d: '1980s', s: { y: 55, p: 14.5, t: 0.3, c: 55 }, imp: 73, ea: 76 },
  { n: "Anthony Allen", p: 'WR', t: 'WAS', d: '1980s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Roger Vick", p: 'RB', t: 'NYJ', d: '1980s', s: { y: 45, c: 3.6, r: 18, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Lionel Manuel", p: 'WR', t: 'NYG', d: '1980s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Bob Chandler", p: 'WR', t: 'LV', d: '1980s', s: { y: 50, p: 12.5, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Malcolm Barnwell", p: 'WR', t: 'LV', d: '1980s', s: { y: 50, p: 15.5, t: 0.3, c: 50 }, imp: 72, ea: 75 },
  { n: "Jerry Butler", p: 'WR', t: 'BUF', d: '1980s', s: { y: 65, p: 14, t: 0.4, c: 55 }, imp: 75, ea: 78 },
  { n: "Frank Lewis", p: 'WR', t: 'BUF', d: '1980s', s: { y: 60, p: 14.5, t: 0.4, c: 55 }, imp: 75, ea: 78 },
  { n: "Lee Williams", p: 'WR', t: 'SEA', d: '1980s', s: { y: 50, p: 13.5, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Mark Jackson", p: 'WR', t: 'DEN', d: '1980s', s: { y: 55, p: 14, t: 0.3, c: 55 }, imp: 73, ea: 76 },
  { n: "Ricky Nattiel", p: 'WR', t: 'DEN', d: '1980s', s: { y: 45, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Henry Marshall", p: 'WR', t: 'KC', d: '1980s', s: { y: 50, p: 12.5, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "James Brim", p: 'WR', t: 'MIN', d: '1980s', s: { y: 45, p: 14, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Hassan Jones", p: 'WR', t: 'MIN', d: '1980s', s: { y: 50, p: 13.5, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Calvin Williams", p: 'WR', t: 'PHI', d: '1980s', s: { y: 50, p: 12, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Eric Truvillion", p: 'WR', t: 'TB', d: '1980s', s: { y: 40, p: 13.5, t: 0.2, c: 50 }, imp: 70, ea: 73 },
  { n: "Kevin House", p: 'WR', t: 'TB', d: '1980s', s: { y: 55, p: 14.5, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Bruce Hill", p: 'WR', t: 'TB', d: '1980s', s: { y: 55, p: 14, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Isaac Curtis", p: 'WR', t: 'CIN', d: '1980s', s: { y: 55, p: 15, t: 0.3, c: 50 }, imp: 73, ea: 76 },
  { n: "Mike Sherrard", p: 'WR', t: 'DAL', d: '1980s', s: { y: 55, p: 14, t: 0.3, c: 55 }, imp: 73, ea: 76 },
  { n: "Kelvin Edwards", p: 'WR', t: 'DAL', d: '1980s', s: { y: 45, p: 12.5, t: 0.2, c: 55 }, imp: 70, ea: 73 },
  { n: "Pat Beach", p: 'TE', t: 'IND', d: '1980s', s: { y: 40, t: 0.3, b: 80 }, imp: 73, ea: 76 },
  { n: "Damone Johnson", p: 'TE', t: 'LAR', d: '1980s', s: { y: 35, t: 0.3, b: 75 }, imp: 71, ea: 74 },
  { n: "Doug Jolley", p: 'TE', t: 'LV', d: '1980s', s: { y: 35, t: 0.2, b: 75 }, imp: 70, ea: 73 },
  { n: "Eric Sievers", p: 'TE', t: 'NE', d: '1980s', s: { y: 30, t: 0.2, b: 78 }, imp: 70, ea: 73 },
  { n: "Keith Jackson", p: 'TE', t: 'PHI', d: '1980s', s: { y: 50, t: 0.4, b: 76 }, imp: 78, ea: 81 },
  { n: "Boomer Esiason", p: 'QB', t: 'NYJ', d: '1990s', s: { y: 230, t: 1.4, i: 1.1, r: 75 , ry: 12 }, imp: 76, ea: 78 },
  { n: "Bubby Brister", p: 'QB', t: 'PHI', d: '1990s', s: { y: 195, t: 1.1, i: 1, r: 72 , ry: 6 }, imp: 71, ea: 73 },
  { n: "Bubby Brister", p: 'QB', t: 'DEN', d: '1990s', s: { y: 200, t: 1.2, i: 0.9, r: 79 , ry: 6 }, imp: 73, ea: 75 },
  { n: "Mark Rypien", p: 'QB', t: 'WAS', d: '1990s', s: { y: 225, t: 1.4, i: 0.9, r: 86.5 , ry: 2 }, imp: 80, ea: 82 },
  { n: "Dave Krieg", p: 'QB', t: 'KC', d: '1990s', s: { y: 215, t: 1.4, i: 1, r: 84.5 , ry: 6 }, imp: 75, ea: 77 },
  { n: "Dave Krieg", p: 'QB', t: 'DET', d: '1990s', s: { y: 215, t: 1.3, i: 0.9, r: 81 , ry: 6 }, imp: 74, ea: 76 },
  { n: "Rodney Peete", p: 'QB', t: 'DET', d: '1990s', s: { y: 215, t: 1.2, i: 1, r: 80 , ry: 6 }, imp: 73, ea: 75 },
  { n: "Rodney Peete", p: 'QB', t: 'DAL', d: '1990s', s: { y: 195, t: 1.1, i: 1, r: 79 , ry: 6 }, imp: 72, ea: 74 },
  { n: "Rodney Peete", p: 'QB', t: 'PHI', d: '1990s', s: { y: 215, t: 1.2, i: 0.7, r: 85.5 , ry: 6 }, imp: 74, ea: 76 },
  { n: "Steve Bono", p: 'QB', t: 'KC', d: '1990s', s: { y: 215, t: 1.5, i: 0.9, r: 88 , ry: 6 }, imp: 76, ea: 78 },
  { n: "Steve Bono", p: 'QB', t: 'SF', d: '1990s', s: { y: 200, t: 1.2, i: 0.7, r: 85 , ry: 6 }, imp: 72, ea: 74 },
  { n: "Erik Wilhelm", p: 'QB', t: 'CIN', d: '1990s', s: { y: 175, t: 0.9, i: 1.1, r: 67 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Dan McGwire", p: 'QB', t: 'SEA', d: '1990s', s: { y: 170, t: 0.7, i: 1.2, r: 60 , ry: 6 }, imp: 66, ea: 68 },
  { n: "Scott Zolak", p: 'QB', t: 'NE', d: '1990s', s: { y: 180, t: 0.9, i: 1.1, r: 68 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Jim Harbaugh", p: 'QB', t: 'CHI', d: '1990s', s: { y: 200, t: 1.1, i: 0.9, r: 80 , ry: 14 }, imp: 75, ea: 77 },
  { n: "Mike Tomczak", p: 'QB', t: 'PIT', d: '1990s', s: { y: 195, t: 1.1, i: 1, r: 75 , ry: 6 }, imp: 72, ea: 74 },
  { n: "Gus Frerotte", p: 'QB', t: 'WAS', d: '1990s', s: { y: 220, t: 1.3, i: 1.1, r: 78 , ry: 6 }, imp: 73, ea: 75 },
  { n: "Gus Frerotte", p: 'QB', t: 'DET', d: '1990s', s: { y: 210, t: 1.2, i: 1, r: 79 , ry: 6 }, imp: 73, ea: 75 },
  { n: "Brian Griese", p: 'QB', t: 'DEN', d: '1990s', s: { y: 215, t: 1.4, i: 1, r: 85 , ry: 6 }, imp: 76, ea: 78 },
  { n: "Doug Pederson", p: 'QB', t: 'PHI', d: '1990s', s: { y: 180, t: 1, i: 1, r: 70 , ry: 6 }, imp: 69, ea: 71 },
  { n: "Jay Fiedler", p: 'QB', t: 'MIA', d: '1990s', s: { y: 215, t: 1.3, i: 1, r: 80.5 , ry: 6 }, imp: 74, ea: 76 },
  { n: "Damon Huard", p: 'QB', t: 'MIA', d: '1990s', s: { y: 195, t: 1.1, i: 0.9, r: 77 , ry: 6 }, imp: 71, ea: 73 },
  { n: "Scott Mitchell", p: 'QB', t: 'MIA', d: '1990s', s: { y: 205, t: 1.4, i: 1, r: 78.5 , ry: 6 }, imp: 74, ea: 76 },
  { n: "Kordell Stewart", p: 'QB', t: 'PIT', d: '1990s', s: { y: 200, t: 1.2, i: 1, r: 75.5 , ry: 28 }, imp: 75, ea: 77 },
  { n: "Donovan McNabb", p: 'QB', t: 'PHI', d: '1990s', s: { y: 215, t: 1.2, i: 0.6, r: 86 , ry: 28 }, imp: 78, ea: 80 },
  { n: "Daunte Culpepper", p: 'QB', t: 'MIN', d: '1990s', s: { y: 250, t: 1.6, i: 0.9, r: 88 , ry: 6 }, imp: 80, ea: 82 },
  { n: "Cade McNown", p: 'QB', t: 'CHI', d: '1990s', s: { y: 185, t: 1, i: 1, r: 70 , ry: 6 }, imp: 70, ea: 72 },
  { n: "Tony Banks", p: 'QB', t: 'WAS', d: '1990s', s: { y: 200, t: 1, i: 1, r: 75 , ry: 6 }, imp: 70, ea: 72 },
  { n: "Aaron Brooks", p: 'QB', t: 'NO', d: '1990s', s: { y: 195, t: 1.1, i: 0.9, r: 78 , ry: 14 }, imp: 73, ea: 75 },
  { n: "Stoney Case", p: 'QB', t: 'ARI', d: '1990s', s: { y: 175, t: 0.8, i: 1.1, r: 65 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Jake Plummer", p: 'QB', t: 'ARI', d: '1990s', s: { y: 215, t: 1.3, i: 1.1, r: 76 , ry: 12 }, imp: 75, ea: 77 },
  { n: "Steve Stenstrom", p: 'QB', t: 'CHI', d: '1990s', s: { y: 175, t: 0.9, i: 1, r: 70 , ry: 6 }, imp: 69, ea: 71 },
  { n: "Shaun King", p: 'QB', t: 'TB', d: '1990s', s: { y: 210, t: 1.2, i: 0.9, r: 75.5 , ry: 6 }, imp: 72, ea: 74 },
  { n: "Doug Pederson", p: 'QB', t: 'GB', d: '1990s', s: { y: 175, t: 1, i: 1, r: 71 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Glenn Foley", p: 'QB', t: 'NYJ', d: '1990s', s: { y: 200, t: 1.2, i: 1.1, r: 75 , ry: 6 }, imp: 70, ea: 72 },
  { n: "Hugh Millen", p: 'QB', t: 'NE', d: '1990s', s: { y: 195, t: 1.1, i: 1.4, r: 65 , ry: 6 }, imp: 70, ea: 72 },
  { n: "Marshall Faulk", p: 'RB', t: 'LAR', d: '1990s', s: { y: 85, c: 4.6, r: 60, t: 0.7 }, imp: 92, ea: 93 },
  { n: "Jerome Bettis", p: 'RB', t: 'LAR', d: '1990s', s: { y: 80, c: 4, r: 15, t: 0.6 }, imp: 80, ea: 81 },
  { n: "Garrison Hearst", p: 'RB', t: 'ARI', d: '1990s', s: { y: 70, c: 3.9, r: 18, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Garrison Hearst", p: 'RB', t: 'CIN', d: '1990s', s: { y: 50, c: 3.6, r: 12, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Ricky Watters", p: 'RB', t: 'SEA', d: '1990s', s: { y: 80, c: 4.3, r: 30, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Chris Warren", p: 'RB', t: 'DAL', d: '1990s', s: { y: 35, c: 3.7, r: 18, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Natrone Means", p: 'RB', t: 'JAX', d: '1990s', s: { y: 70, c: 3.9, r: 12, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Larry Centers", p: 'RB', t: 'ARI', d: '1990s', s: { y: 30, c: 3.8, r: 60, t: 0.3 }, imp: 76, ea: 77 },
  { n: "Reggie Brooks", p: 'RB', t: 'WAS', d: '1990s', s: { y: 70, c: 4.5, r: 18, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Rashaan Salaam", p: 'RB', t: 'CHI', d: '1990s', s: { y: 70, c: 3.6, r: 12, t: 0.6 }, imp: 73, ea: 74 },
  { n: "Tommy Vardell", p: 'RB', t: 'CLE', d: '1990s', s: { y: 50, c: 3.7, r: 12, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Leonard Russell", p: 'RB', t: 'NE', d: '1990s', s: { y: 65, c: 3.6, r: 12, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Lorenzo White", p: 'RB', t: 'TEN', d: '1990s', s: { y: 70, c: 3.8, r: 18, t: 0.5 }, imp: 75, ea: 76 },
  { n: "Gary Brown", p: 'RB', t: 'TEN', d: '1990s', s: { y: 65, c: 4.1, r: 15, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Gary Brown", p: 'RB', t: 'NYG', d: '1990s', s: { y: 70, c: 3.8, r: 18, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Greg Hill", p: 'RB', t: 'KC', d: '1990s', s: { y: 55, c: 3.7, r: 10, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Marion Butts", p: 'RB', t: 'LAC', d: '1990s', s: { y: 70, c: 3.9, r: 10, t: 0.5 }, imp: 73, ea: 74 },
  { n: "Marion Butts", p: 'RB', t: 'NE', d: '1990s', s: { y: 50, c: 3.5, r: 8, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Harvey Williams", p: 'RB', t: 'LV', d: '1990s', s: { y: 60, c: 3.9, r: 18, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Anthony Johnson", p: 'RB', t: 'CAR', d: '1990s', s: { y: 75, c: 3.8, r: 30, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Anthony Johnson", p: 'RB', t: 'JAX', d: '1990s', s: { y: 55, c: 3.7, r: 20, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Fred Lane", p: 'RB', t: 'CAR', d: '1990s', s: { y: 65, c: 4, r: 12, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Tim Biakabutuka", p: 'RB', t: 'CAR', d: '1990s', s: { y: 65, c: 3.9, r: 15, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Bam Morris", p: 'RB', t: 'PIT', d: '1990s', s: { y: 65, c: 3.7, r: 8, t: 0.5 }, imp: 73, ea: 74 },
  { n: "Byron Hanspard", p: 'RB', t: 'ATL', d: '1990s', s: { y: 45, c: 3.6, r: 18, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Cleveland Gary", p: 'RB', t: 'LAR', d: '1990s', s: { y: 60, c: 3.7, r: 18, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Jamal Anderson", p: 'RB', t: 'ATL', d: '1990s', s: { y: 90, c: 4.3, r: 20, t: 0.6 }, imp: 84, ea: 85 },
  { n: "Mario Bates", p: 'RB', t: 'NO', d: '1990s', s: { y: 60, c: 3.6, r: 12, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Mike Anderson", p: 'RB', t: 'DEN', d: '1990s', s: { y: 60, c: 4, r: 10, t: 0.5 }, imp: 73, ea: 74 },
  { n: "Ron Dayne", p: 'RB', t: 'NYG', d: '1990s', s: { y: 50, c: 3.6, r: 8, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Tyrone Wheatley", p: 'RB', t: 'LV', d: '1990s', s: { y: 50, c: 4, r: 12, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Gary Clark", p: 'WR', t: 'WAS', d: '1990s', s: { y: 75, p: 14.5, t: 0.5, c: 55 }, imp: 80, ea: 82 },
  { n: "Ricky Sanders", p: 'WR', t: 'WAS', d: '1990s', s: { y: 60, p: 13, t: 0.3, c: 60 }, imp: 75, ea: 77 },
  { n: "Mark Carrier", p: 'WR', t: 'TB', d: '1990s', s: { y: 60, p: 14.5, t: 0.3, c: 55 }, imp: 74, ea: 76 },
  { n: "Drew Hill", p: 'WR', t: 'TEN', d: '1990s', s: { y: 70, p: 15, t: 0.5, c: 55 }, imp: 78, ea: 80 },
  { n: "Webster Slaughter", p: 'WR', t: 'KC', d: '1990s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "Brian Blades", p: 'WR', t: 'SEA', d: '1990s', s: { y: 65, p: 12.5, t: 0.3, c: 60 }, imp: 76, ea: 78 },
  { n: "Bill Brooks", p: 'WR', t: 'BUF', d: '1990s', s: { y: 65, p: 13.5, t: 0.4, c: 55 }, imp: 75, ea: 77 },
  { n: "Yancey Thigpen", p: 'WR', t: 'TEN', d: '1990s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "Charles Johnson", p: 'WR', t: 'PHI', d: '1990s', s: { y: 55, p: 12.5, t: 0.3, c: 55 }, imp: 73, ea: 75 },
  { n: "Ed McCaffrey", p: 'WR', t: 'DEN', d: '1990s', s: { y: 60, p: 13, t: 0.4, c: 60 }, imp: 76, ea: 78 },
  { n: "Jimmy Smith", p: 'WR', t: 'JAX', d: '1990s', s: { y: 80, p: 12.5, t: 0.4, c: 65 }, imp: 84, ea: 86 },
  { n: "Michael Westbrook", p: 'WR', t: 'WAS', d: '1990s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 73, ea: 75 },
  { n: "Torry Holt", p: 'WR', t: 'LAR', d: '1990s', s: { y: 70, p: 12.5, t: 0.4, c: 60 }, imp: 80, ea: 82 },
  { n: "Az-Zahir Hakim", p: 'WR', t: 'LAR', d: '1990s', s: { y: 50, p: 14.5, t: 0.3, c: 55 }, imp: 73, ea: 75 },
  { n: "Marcus Robinson", p: 'WR', t: 'CHI', d: '1990s', s: { y: 55, p: 13.5, t: 0.3, c: 55 }, imp: 73, ea: 75 },
  { n: "Frank Sanders", p: 'WR', t: 'ARI', d: '1990s', s: { y: 60, p: 13, t: 0.3, c: 60 }, imp: 75, ea: 77 },
  { n: "Rob Moore", p: 'WR', t: 'NYJ', d: '1990s', s: { y: 70, p: 14, t: 0.3, c: 55 }, imp: 76, ea: 78 },
  { n: "Rob Moore", p: 'WR', t: 'ARI', d: '1990s', s: { y: 75, p: 14.5, t: 0.4, c: 55 }, imp: 78, ea: 80 },
  { n: "Wayne Chrebet", p: 'WR', t: 'NYJ', d: '1990s', s: { y: 65, p: 11.5, t: 0.4, c: 65 }, imp: 78, ea: 80 },
  { n: "Ricky Proehl", p: 'WR', t: 'CAR', d: '1990s', s: { y: 55, p: 13, t: 0.3, c: 55 }, imp: 74, ea: 76 },
  { n: "Muhsin Muhammad", p: 'WR', t: 'CAR', d: '1990s', s: { y: 70, p: 12.5, t: 0.4, c: 60 }, imp: 80, ea: 82 },
  { n: "Tony Martin", p: 'WR', t: 'ATL', d: '1990s', s: { y: 55, p: 13, t: 0.3, c: 55 }, imp: 73, ea: 75 },
  { n: "Mark Carrier", p: 'WR', t: 'CLE', d: '1990s', s: { y: 50, p: 12, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "Sean Dawkins", p: 'WR', t: 'IND', d: '1990s', s: { y: 60, p: 12.5, t: 0.3, c: 60 }, imp: 75, ea: 77 },
  { n: "Joe Horn", p: 'WR', t: 'KC', d: '1990s', s: { y: 55, p: 12.5, t: 0.3, c: 55 }, imp: 73, ea: 75 },
  { n: "Andre Hastings", p: 'WR', t: 'NO', d: '1990s', s: { y: 50, p: 11.5, t: 0.3, c: 60 }, imp: 72, ea: 74 },
  { n: "Lake Dawson", p: 'WR', t: 'KC', d: '1990s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "Derrick Alexander", p: 'WR', t: 'BAL', d: '1990s', s: { y: 60, p: 13.5, t: 0.3, c: 55 }, imp: 75, ea: 77 },
  { n: "Derrick Alexander", p: 'WR', t: 'KC', d: '1990s', s: { y: 65, p: 14, t: 0.4, c: 55 }, imp: 76, ea: 78 },
  { n: "Floyd Turner", p: 'WR', t: 'IND', d: '1990s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "Curtis Duncan", p: 'WR', t: 'TEN', d: '1990s', s: { y: 60, p: 11, t: 0.3, c: 65 }, imp: 75, ea: 77 },
  { n: "Ernest Givins", p: 'WR', t: 'TEN', d: '1990s', s: { y: 70, p: 11.5, t: 0.4, c: 60 }, imp: 78, ea: 80 },
  { n: "Keith Jackson", p: 'TE', t: 'MIA', d: '1990s', s: { y: 50, t: 0.5, b: 76 }, imp: 78, ea: 80 },
  { n: "Keith Jackson", p: 'TE', t: 'GB', d: '1990s', s: { y: 45, t: 0.4, b: 76 }, imp: 76, ea: 78 },
  { n: "Pete Holohan", p: 'TE', t: 'LAR', d: '1990s', s: { y: 35, t: 0.2, b: 82 }, imp: 72, ea: 74 },
  { n: "Brian Kinchen", p: 'TE', t: 'CLE', d: '1990s', s: { y: 30, t: 0.2, b: 80 }, imp: 70, ea: 72 },
  { n: "Greg McElroy", p: 'TE', t: 'CHI', d: '1990s', s: { y: 35, t: 0.3, b: 76 }, imp: 71, ea: 73 },
  { n: "Tyji Armstrong", p: 'TE', t: 'TB', d: '1990s', s: { y: 30, t: 0.2, b: 78 }, imp: 70, ea: 72 },
  { n: "Adrian Cooper", p: 'TE', t: 'PIT', d: '1990s', s: { y: 25, t: 0.2, b: 80 }, imp: 70, ea: 72 },
  { n: "Ronnie Harmon", p: 'TE', t: 'LAC', d: '1990s', s: { y: 35, t: 0.2, b: 75 }, imp: 71, ea: 73 },
  { n: "Jamie Asher", p: 'TE', t: 'WAS', d: '1990s', s: { y: 30, t: 0.3, b: 76 }, imp: 71, ea: 73 },
  { n: "Ferrell Edmunds", p: 'TE', t: 'SEA', d: '1990s', s: { y: 25, t: 0.2, b: 78 }, imp: 70, ea: 72 },
  { n: "Tony McGee", p: 'TE', t: 'CIN', d: '1990s', s: { y: 30, t: 0.2, b: 78 }, imp: 71, ea: 73 },
  { n: "Andrew Glover", p: 'TE', t: 'MIN', d: '1990s', s: { y: 35, t: 0.3, b: 76 }, imp: 71, ea: 73 },
  { n: "Christian Fauria", p: 'TE', t: 'SEA', d: '1990s', s: { y: 35, t: 0.3, b: 78 }, imp: 72, ea: 74 },
  { n: "Roland Williams", p: 'TE', t: 'LAR', d: '1990s', s: { y: 30, t: 0.2, b: 80 }, imp: 71, ea: 73 },
  { n: "Reggie Johnson", p: 'TE', t: 'DEN', d: '1990s', s: { y: 25, t: 0.2, b: 78 }, imp: 70, ea: 72 },
  { n: "David LaFleur", p: 'TE', t: 'DAL', d: '1990s', s: { y: 30, t: 0.3, b: 75 }, imp: 71, ea: 73 },
  { n: "Tony Cline", p: 'TE', t: 'BUF', d: '1990s', s: { y: 30, t: 0.2, b: 78 }, imp: 70, ea: 72 },
  { n: "Joe Pisarcik", p: 'QB', t: 'IND', d: '1980s', s: { y: 165, t: 0.9, i: 1.3, r: 62 , ry: 7 }, imp: 68, ea: 71 },
  { n: "Paul McDonald", p: 'QB', t: 'CLE', d: '1980s', s: { y: 180, t: 1, i: 1.3, r: 66 , ry: 7 }, imp: 69, ea: 72 },
  { n: "Matt Robinson", p: 'QB', t: 'DEN', d: '1980s', s: { y: 170, t: 1, i: 1.4, r: 60 , ry: 7 }, imp: 67, ea: 70 },
  { n: "Tommy Hodson", p: 'QB', t: 'NE', d: '1980s', s: { y: 165, t: 0.8, i: 1.2, r: 62 , ry: 7 }, imp: 67, ea: 70 },
  { n: "Jim Zorn", p: 'QB', t: 'SEA', d: '1980s', s: { y: 195, t: 1.2, i: 1.4, r: 67.5 , ry: 18 }, imp: 73, ea: 76 },
  { n: "Steve Dils", p: 'QB', t: 'MIN', d: '1980s', s: { y: 175, t: 0.9, i: 1.3, r: 65 , ry: 7 }, imp: 68, ea: 71 },
  { n: "Steve DeBerg", p: 'QB', t: 'TB', d: '1980s', s: { y: 215, t: 1.2, i: 1.2, r: 72 , ry: 7 }, imp: 72, ea: 75 },
  { n: "Steve DeBerg", p: 'QB', t: 'DEN', d: '1980s', s: { y: 220, t: 1.3, i: 1, r: 78 , ry: 7 }, imp: 74, ea: 77 },
  { n: "Chuck Long", p: 'QB', t: 'DET', d: '1980s', s: { y: 185, t: 1, i: 1.2, r: 67 , ry: 7 }, imp: 70, ea: 73 },
  { n: "Joe Dufek", p: 'QB', t: 'BUF', d: '1980s', s: { y: 155, t: 0.8, i: 1.4, r: 56 , ry: 7 }, imp: 66, ea: 69 },
  { n: "Joe Ferguson", p: 'QB', t: 'DET', d: '1980s', s: { y: 185, t: 1, i: 1.2, r: 70 , ry: 7 }, imp: 70, ea: 73 },
  { n: "Karl Sweetan", p: 'QB', t: 'LAR', d: '1980s', s: { y: 175, t: 1, i: 1.3, r: 64 , ry: 7 }, imp: 68, ea: 71 },
  { n: "Steve Pisarkiewicz", p: 'QB', t: 'ARI', d: '1980s', s: { y: 165, t: 0.9, i: 1.4, r: 58 , ry: 7 }, imp: 66, ea: 69 },
  { n: "Steve Fuller", p: 'QB', t: 'KC', d: '1980s', s: { y: 175, t: 1, i: 1, r: 68 , ry: 7 }, imp: 71, ea: 74 },
  { n: "Tom Owen", p: 'QB', t: 'NE', d: '1980s', s: { y: 170, t: 0.9, i: 1.3, r: 62 , ry: 7 }, imp: 68, ea: 71 },
  { n: "Jeff Komlo", p: 'QB', t: 'DET', d: '1980s', s: { y: 165, t: 0.9, i: 1.4, r: 60 , ry: 7 }, imp: 67, ea: 70 },
  { n: "Vince Evans", p: 'QB', t: 'LV', d: '1980s', s: { y: 165, t: 0.9, i: 1.3, r: 63 , ry: 7 }, imp: 68, ea: 71 },
  { n: "Sammy Garza", p: 'QB', t: 'CHI', d: '1980s', s: { y: 160, t: 0.8, i: 1.3, r: 60 , ry: 7 }, imp: 66, ea: 69 },
  { n: "Steve Bono", p: 'QB', t: 'PIT', d: '1980s', s: { y: 170, t: 0.9, i: 1, r: 70 , ry: 7 }, imp: 69, ea: 72 },
  { n: "Frank Reich", p: 'QB', t: 'BUF', d: '1980s', s: { y: 175, t: 1, i: 1, r: 75 , ry: 7 }, imp: 71, ea: 74 },
  { n: "James Jones", p: 'RB', t: 'DET', d: '1980s', s: { y: 50, c: 3.8, r: 40, t: 0.3 }, imp: 73, ea: 74 },
  { n: "James Wilder", p: 'RB', t: 'DET', d: '1980s', s: { y: 50, c: 3.7, r: 18, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Tony Nathan", p: 'RB', t: 'MIA', d: '1980s', s: { y: 55, c: 4.2, r: 35, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Andra Franklin", p: 'RB', t: 'MIA', d: '1980s', s: { y: 65, c: 3.9, r: 8, t: 0.5 }, imp: 73, ea: 74 },
  { n: "Kenny Easley", p: 'RB', t: 'SEA', d: '1980s', s: { y: 50, c: 3.8, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "David Overstreet", p: 'RB', t: 'MIA', d: '1980s', s: { y: 50, c: 3.8, r: 10, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Robb Riddick", p: 'RB', t: 'BUF', d: '1980s', s: { y: 60, c: 4, r: 25, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Ron Springs", p: 'RB', t: 'DAL', d: '1980s', s: { y: 55, c: 3.9, r: 25, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Tony Galbreath", p: 'RB', t: 'NYG', d: '1980s', s: { y: 45, c: 3.8, r: 35, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Tony Galbreath", p: 'RB', t: 'MIN', d: '1980s', s: { y: 40, c: 3.7, r: 30, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Tony Collins", p: 'RB', t: 'NE', d: '1980s', s: { y: 65, c: 4, r: 30, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Mike Anderson", p: 'RB', t: 'CHI', d: '1980s', s: { y: 45, c: 3.7, r: 10, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Calvin Murray", p: 'RB', t: 'PHI', d: '1980s', s: { y: 50, c: 4, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Pete Johnson", p: 'RB', t: 'LAC', d: '1980s', s: { y: 50, c: 3.5, r: 8, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Charlie White", p: 'RB', t: 'CLE', d: '1980s', s: { y: 50, c: 3.9, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Allen Pinkett", p: 'RB', t: 'TEN', d: '1980s', s: { y: 50, c: 3.8, r: 20, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Larry Kinnebrew", p: 'RB', t: 'CIN', d: '1980s', s: { y: 50, c: 3.6, r: 8, t: 0.6 }, imp: 72, ea: 73 },
  { n: "Bobby Humphrey", p: 'RB', t: 'DEN', d: '1980s', s: { y: 75, c: 3.9, r: 15, t: 0.5 }, imp: 75, ea: 76 },
  { n: "Mosi Tatupu", p: 'RB', t: 'NE', d: '1980s', s: { y: 40, c: 3.8, r: 8, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Robert Newhouse", p: 'RB', t: 'DAL', d: '1980s', s: { y: 45, c: 3.9, r: 8, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Vagas Ferguson", p: 'RB', t: 'NE', d: '1980s', s: { y: 50, c: 3.7, r: 10, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Larry Mason", p: 'RB', t: 'CLE', d: '1980s', s: { y: 35, c: 3.6, r: 8, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Trumaine Johnson", p: 'WR', t: 'LAC', d: '1980s', s: { y: 45, p: 13, t: 0.3, c: 55 }, imp: 71, ea: 74 },
  { n: "Anthony Carter", p: 'WR', t: 'MIA', d: '1980s', s: { y: 55, p: 15, t: 0.4, c: 55 }, imp: 75, ea: 78 },
  { n: "Carlos Carson", p: 'WR', t: 'PHI', d: '1980s', s: { y: 50, p: 13.5, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Floyd Dixon", p: 'WR', t: 'ATL', d: '1980s', s: { y: 55, p: 14, t: 0.3, c: 55 }, imp: 73, ea: 76 },
  { n: "Charlie Joiner", p: 'WR', t: 'CIN', d: '1980s', s: { y: 45, p: 12.5, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Mike Renfro", p: 'WR', t: 'TEN', d: '1980s', s: { y: 55, p: 12.5, t: 0.3, c: 60 }, imp: 73, ea: 76 },
  { n: "Mike Renfro", p: 'WR', t: 'DAL', d: '1980s', s: { y: 45, p: 12, t: 0.2, c: 60 }, imp: 71, ea: 74 },
  { n: "Earnest Gray", p: 'WR', t: 'NYG', d: '1980s', s: { y: 55, p: 13.5, t: 0.3, c: 55 }, imp: 73, ea: 76 },
  { n: "Wallace Francis", p: 'WR', t: 'ATL', d: '1980s', s: { y: 50, p: 14, t: 0.3, c: 55 }, imp: 72, ea: 75 },
  { n: "Charlie Brown", p: 'WR', t: 'ATL', d: '1980s', s: { y: 45, p: 12, t: 0.2, c: 60 }, imp: 71, ea: 74 },
  { n: "Bill Brooks", p: 'WR', t: 'IND', d: '1980s', s: { y: 65, p: 13, t: 0.3, c: 60 }, imp: 76, ea: 79 },
  { n: "Matt Bouza", p: 'WR', t: 'IND', d: '1980s', s: { y: 40, p: 12.5, t: 0.2, c: 55 }, imp: 70, ea: 73 },
  { n: "Ron Brown", p: 'WR', t: 'LAR', d: '1980s', s: { y: 50, p: 16, t: 0.3, c: 50 }, imp: 72, ea: 75 },
  { n: "Willie Anderson", p: 'WR', t: 'LAR', d: '1980s', s: { y: 55, p: 16.5, t: 0.3, c: 50 }, imp: 73, ea: 76 },
  { n: "Cris Burford", p: 'WR', t: 'TB', d: '1980s', s: { y: 35, p: 11.5, t: 0.2, c: 55 }, imp: 68, ea: 71 },
  { n: "Bobby Joe Edmonds", p: 'WR', t: 'SEA', d: '1980s', s: { y: 35, p: 13, t: 0.2, c: 50 }, imp: 68, ea: 71 },
  { n: "Daryl Turner", p: 'WR', t: 'SEA', d: '1980s', s: { y: 50, p: 15.5, t: 0.5, c: 50 }, imp: 73, ea: 76 },
  { n: "Joey Walters", p: 'WR', t: 'WAS', d: '1980s', s: { y: 40, p: 13, t: 0.2, c: 55 }, imp: 70, ea: 73 },
  { n: "Art Schlichter", p: 'WR', t: 'IND', d: '1980s', s: { y: 35, p: 12, t: 0.2, c: 50 }, imp: 67, ea: 70 },
  { n: "Phil Epps", p: 'WR', t: 'GB', d: '1980s', s: { y: 45, p: 14, t: 0.2, c: 55 }, imp: 71, ea: 74 },
  { n: "James Lofton", p: 'WR', t: 'LV', d: '1980s', s: { y: 60, p: 16, t: 0.4, c: 50 }, imp: 75, ea: 78 },
  { n: "Aaron Cox", p: 'WR', t: 'LAR', d: '1980s', s: { y: 40, p: 14, t: 0.2, c: 50 }, imp: 70, ea: 73 },
  { n: "Aaron Hill", p: 'WR', t: 'ARI', d: '1980s', s: { y: 35, p: 12.5, t: 0.2, c: 50 }, imp: 68, ea: 71 },
  { n: "Doug Marsh", p: 'TE', t: 'ARI', d: '1980s', s: { y: 35, t: 0.3, b: 75 }, imp: 71, ea: 74 },
  { n: "Pete Holohan", p: 'TE', t: 'LAR', d: '1980s', s: { y: 35, t: 0.2, b: 80 }, imp: 72, ea: 75 },
  { n: "Bobby Watkins", p: 'TE', t: 'DET', d: '1980s', s: { y: 25, t: 0.2, b: 78 }, imp: 68, ea: 71 },
  { n: "Donald Hair", p: 'TE', t: 'KC', d: '1980s', s: { y: 30, t: 0.2, b: 75 }, imp: 69, ea: 72 },
  { n: "Eric Sievers", p: 'TE', t: 'WAS', d: '1980s', s: { y: 25, t: 0.2, b: 76 }, imp: 70, ea: 73 },
  { n: "Junior Tautalatasi", p: 'TE', t: 'PHI', d: '1980s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 71 },
  { n: "Mike Cobb", p: 'TE', t: 'CIN', d: '1980s', s: { y: 30, t: 0.2, b: 78 }, imp: 70, ea: 73 },
  { n: "Jim Everett", p: 'QB', t: 'LAC', d: '1990s', s: { y: 200, t: 1.2, i: 1, r: 76 , ry: 6 }, imp: 72, ea: 74 },
  { n: "Steve Pelluer", p: 'QB', t: 'KC', d: '1990s', s: { y: 175, t: 0.9, i: 1.2, r: 65 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Tommy Maddox", p: 'QB', t: 'DEN', d: '1990s', s: { y: 175, t: 0.9, i: 1.2, r: 65 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Tommy Maddox", p: 'QB', t: 'LAR', d: '1990s', s: { y: 165, t: 0.8, i: 1.4, r: 58 , ry: 6 }, imp: 65, ea: 67 },
  { n: "Jim McMahon", p: 'QB', t: 'GB', d: '1990s', s: { y: 180, t: 1, i: 1, r: 75 , ry: 12 }, imp: 70, ea: 72 },
  { n: "Jim McMahon", p: 'QB', t: 'PHI', d: '1990s', s: { y: 195, t: 1.1, i: 1, r: 75 , ry: 12 }, imp: 71, ea: 73 },
  { n: "Mike Pagel", p: 'QB', t: 'LAR', d: '1990s', s: { y: 165, t: 0.9, i: 1.2, r: 62 , ry: 6 }, imp: 67, ea: 69 },
  { n: "Hugh Millen", p: 'QB', t: 'DAL', d: '1990s', s: { y: 175, t: 1, i: 1.4, r: 60 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Stan Gelbaugh", p: 'QB', t: 'SEA', d: '1990s', s: { y: 175, t: 1, i: 1.3, r: 62 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Kelly Stouffer", p: 'QB', t: 'SEA', d: '1990s', s: { y: 175, t: 1, i: 1.3, r: 64 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Jeff George", p: 'QB', t: 'IND', d: '1990s', s: { y: 235, t: 1.4, i: 1, r: 80.5 , ry: 1 }, imp: 78, ea: 80 },
  { n: "Jeff George", p: 'QB', t: 'LV', d: '1990s', s: { y: 230, t: 1.5, i: 1.1, r: 81.5 , ry: 1 }, imp: 76, ea: 78 },
  { n: "Jeff George", p: 'QB', t: 'MIN', d: '1990s', s: { y: 215, t: 1.4, i: 1, r: 81 , ry: 1 }, imp: 75, ea: 77 },
  { n: "Mike Phipps", p: 'QB', t: 'CHI', d: '1990s', s: { y: 165, t: 0.9, i: 1.4, r: 58 , ry: 6 }, imp: 66, ea: 68 },
  { n: "Frank Reich", p: 'QB', t: 'CAR', d: '1990s', s: { y: 175, t: 1, i: 1, r: 75 , ry: 6 }, imp: 70, ea: 72 },
  { n: "Frank Reich", p: 'QB', t: 'NYJ', d: '1990s', s: { y: 165, t: 0.9, i: 1.1, r: 65 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Mark Brunell", p: 'QB', t: 'GB', d: '1990s', s: { y: 175, t: 0.9, i: 0.8, r: 80 , ry: 6 }, imp: 71, ea: 73 },
  { n: "Don Majkowski", p: 'QB', t: 'IND', d: '1990s', s: { y: 195, t: 1.1, i: 1, r: 75 , ry: 6 }, imp: 71, ea: 73 },
  { n: "Don Majkowski", p: 'QB', t: 'DET', d: '1990s', s: { y: 185, t: 1, i: 1, r: 73 , ry: 6 }, imp: 70, ea: 72 },
  { n: "Babe Laufenberg", p: 'QB', t: 'DAL', d: '1990s', s: { y: 175, t: 1, i: 1.2, r: 65 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Sean Salisbury", p: 'QB', t: 'MIN', d: '1990s', s: { y: 195, t: 1.1, i: 1.1, r: 75 , ry: 6 }, imp: 70, ea: 72 },
  { n: "Bernie Kosar", p: 'QB', t: 'DAL', d: '1990s', s: { y: 195, t: 1.1, i: 0.9, r: 78 , ry: 2 }, imp: 72, ea: 74 },
  { n: "Bernie Kosar", p: 'QB', t: 'MIA', d: '1990s', s: { y: 200, t: 1.2, i: 0.9, r: 79.5 , ry: 2 }, imp: 73, ea: 75 },
  { n: "Vinny Testaverde", p: 'QB', t: 'TB', d: '1990s', s: { y: 220, t: 1.4, i: 1.4, r: 70 , ry: 4 }, imp: 73, ea: 75 },
  { n: "Bobby Hebert", p: 'QB', t: 'ATL', d: '1990s', s: { y: 225, t: 1.4, i: 1, r: 80.5 , ry: 6 }, imp: 76, ea: 78 },
  { n: "Boomer Esiason", p: 'QB', t: 'ARI', d: '1990s', s: { y: 200, t: 1.2, i: 1.2, r: 72 , ry: 12 }, imp: 72, ea: 74 },
  { n: "Bubby Brister", p: 'QB', t: 'NYJ', d: '1990s', s: { y: 185, t: 1, i: 1, r: 72 , ry: 6 }, imp: 70, ea: 72 },
  { n: "Bob Gagliano", p: 'QB', t: 'DET', d: '1990s', s: { y: 175, t: 1, i: 1.2, r: 67 , ry: 6 }, imp: 68, ea: 70 },
  { n: "Chris Miller", p: 'QB', t: 'ATL', d: '1990s', s: { y: 220, t: 1.3, i: 1.1, r: 75 , ry: 6 }, imp: 74, ea: 76 },
  { n: "Chris Miller", p: 'QB', t: 'DEN', d: '1990s', s: { y: 215, t: 1.3, i: 1.1, r: 74 , ry: 6 }, imp: 73, ea: 75 },
  { n: "Lewis Tillman", p: 'RB', t: 'NYG', d: '1990s', s: { y: 50, c: 3.6, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Rod Bernstine", p: 'RB', t: 'LAC', d: '1990s', s: { y: 55, c: 3.9, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Rod Bernstine", p: 'RB', t: 'DEN', d: '1990s', s: { y: 50, c: 3.8, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Eric Pegram", p: 'RB', t: 'ATL', d: '1990s', s: { y: 55, c: 4, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Eric Pegram", p: 'RB', t: 'PIT', d: '1990s', s: { y: 40, c: 3.9, r: 15, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Derek Loville", p: 'RB', t: 'SF', d: '1990s', s: { y: 45, c: 3.9, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Tony Smith", p: 'RB', t: 'ATL', d: '1990s', s: { y: 35, c: 3.5, r: 8, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Daryl Johnston", p: 'RB', t: 'DAL', d: '1990s', s: { y: 30, c: 3.8, r: 20, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Lorenzo Neal", p: 'RB', t: 'NO', d: '1990s', s: { y: 30, c: 3.7, r: 10, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Mark Higgs", p: 'RB', t: 'MIA', d: '1990s', s: { y: 70, c: 3.9, r: 12, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Mark Stock", p: 'RB', t: 'IND', d: '1990s', s: { y: 35, c: 3.7, r: 8, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Karl Williams", p: 'RB', t: 'TB', d: '1990s', s: { y: 30, c: 3.8, r: 15, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Reggie Cobb", p: 'RB', t: 'GB', d: '1990s', s: { y: 55, c: 3.7, r: 12, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Reggie Cobb", p: 'RB', t: 'NYJ', d: '1990s', s: { y: 40, c: 3.6, r: 10, t: 0.3 }, imp: 69, ea: 70 },
  { n: "Vaughn Dunbar", p: 'RB', t: 'NO', d: '1990s', s: { y: 50, c: 3.7, r: 10, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Vaughn Hebron", p: 'RB', t: 'PHI', d: '1990s', s: { y: 35, c: 3.8, r: 10, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Cleveland Gary", p: 'RB', t: 'MIA', d: '1990s', s: { y: 40, c: 3.6, r: 12, t: 0.2 }, imp: 69, ea: 70 },
  { n: "Sam Gash", p: 'RB', t: 'NE', d: '1990s', s: { y: 25, c: 3.6, r: 10, t: 0.2 }, imp: 69, ea: 70 },
  { n: "Sam Gash", p: 'RB', t: 'BUF', d: '1990s', s: { y: 20, c: 3.5, r: 8, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Howard Griffith", p: 'RB', t: 'DEN', d: '1990s', s: { y: 20, c: 3.6, r: 8, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Bennie Blades", p: 'RB', t: 'DET', d: '1990s', s: { y: 35, c: 3.7, r: 12, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Errict Rhett", p: 'RB', t: 'BAL', d: '1990s', s: { y: 45, c: 3.5, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Greg Lloyd", p: 'RB', t: 'CAR', d: '1990s', s: { y: 30, c: 3.6, r: 8, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Anthony Lynn", p: 'RB', t: 'DEN', d: '1990s', s: { y: 25, c: 3.5, r: 8, t: 0.2 }, imp: 67, ea: 68 },
  { n: "Anthony Johnson", p: 'RB', t: 'NYJ', d: '1990s', s: { y: 30, c: 3.6, r: 12, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Tony Smith", p: 'RB', t: 'SF', d: '1990s', s: { y: 30, c: 3.7, r: 8, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Heath Sherman", p: 'RB', t: 'PHI', d: '1990s', s: { y: 50, c: 3.8, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Keith Henderson", p: 'RB', t: 'SF', d: '1990s', s: { y: 30, c: 3.6, r: 12, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Johnny Bailey", p: 'RB', t: 'ARI', d: '1990s', s: { y: 40, c: 3.9, r: 15, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Sherman Williams", p: 'RB', t: 'DAL', d: '1990s', s: { y: 30, c: 3.5, r: 10, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Eric Metcalf", p: 'RB', t: 'CLE', d: '1990s', s: { y: 50, c: 4, r: 50, t: 0.3 }, imp: 76, ea: 77 },
  { n: "Eric Metcalf", p: 'RB', t: 'ATL', d: '1990s', s: { y: 30, c: 3.7, r: 40, t: 0.2 }, imp: 71, ea: 72 },
  { n: "Eric Metcalf", p: 'RB', t: 'LAC', d: '1990s', s: { y: 20, c: 3.5, r: 35, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Mark Ingram Sr.", p: 'WR', t: 'NYG', d: '1990s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "Stephen Baker", p: 'WR', t: 'NYG', d: '1990s', s: { y: 45, p: 13.5, t: 0.3, c: 55 }, imp: 71, ea: 73 },
  { n: "Mike Sherrard", p: 'WR', t: 'NYG', d: '1990s', s: { y: 50, p: 13.5, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "Tom Waddle", p: 'WR', t: 'CHI', d: '1990s', s: { y: 55, p: 11.5, t: 0.2, c: 65 }, imp: 73, ea: 75 },
  { n: "Anthony Morgan", p: 'WR', t: 'GB', d: '1990s', s: { y: 40, p: 12.5, t: 0.2, c: 55 }, imp: 70, ea: 72 },
  { n: "Don Beebe", p: 'WR', t: 'BUF', d: '1990s', s: { y: 50, p: 14, t: 0.3, c: 55 }, imp: 73, ea: 75 },
  { n: "Don Beebe", p: 'WR', t: 'GB', d: '1990s', s: { y: 45, p: 14.5, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "Steve Tasker", p: 'WR', t: 'BUF', d: '1990s', s: { y: 30, p: 11.5, t: 0.2, c: 60 }, imp: 70, ea: 72 },
  { n: "Vincent Brisby", p: 'WR', t: 'NE', d: '1990s', s: { y: 55, p: 13, t: 0.3, c: 55 }, imp: 73, ea: 75 },
  { n: "Terry Glenn", p: 'WR', t: 'NE', d: '1990s', s: { y: 75, p: 13.5, t: 0.4, c: 60 }, imp: 80, ea: 82 },
  { n: "Aaron Bailey", p: 'WR', t: 'IND', d: '1990s', s: { y: 35, p: 12, t: 0.2, c: 55 }, imp: 68, ea: 70 },
  { n: "Sean Dawkins", p: 'WR', t: 'NO', d: '1990s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "James McKnight", p: 'WR', t: 'SEA', d: '1990s', s: { y: 45, p: 13.5, t: 0.3, c: 55 }, imp: 71, ea: 73 },
  { n: "Hassan Jones", p: 'WR', t: 'KC', d: '1990s', s: { y: 35, p: 12.5, t: 0.2, c: 55 }, imp: 68, ea: 70 },
  { n: "Andre Coleman", p: 'WR', t: 'LAC', d: '1990s', s: { y: 40, p: 13, t: 0.2, c: 55 }, imp: 70, ea: 72 },
  { n: "Damon Dunn", p: 'WR', t: 'LAR', d: '1990s', s: { y: 35, p: 12.5, t: 0.2, c: 55 }, imp: 69, ea: 71 },
  { n: "Brian Mitchell", p: 'WR', t: 'WAS', d: '1990s', s: { y: 30, p: 11, t: 0.2, c: 60 }, imp: 71, ea: 73 },
  { n: "Reggie Langhorne", p: 'WR', t: 'CLE', d: '1990s', s: { y: 50, p: 12.5, t: 0.3, c: 60 }, imp: 73, ea: 75 },
  { n: "Reggie Langhorne", p: 'WR', t: 'IND', d: '1990s', s: { y: 60, p: 12.5, t: 0.3, c: 60 }, imp: 74, ea: 76 },
  { n: "Floyd Turner", p: 'WR', t: 'NO', d: '1990s', s: { y: 50, p: 13.5, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "Quinn Early", p: 'WR', t: 'BUF', d: '1990s', s: { y: 55, p: 12.5, t: 0.3, c: 60 }, imp: 73, ea: 75 },
  { n: "Lawyer Tillman", p: 'WR', t: 'CLE', d: '1990s', s: { y: 45, p: 13.5, t: 0.3, c: 55 }, imp: 71, ea: 73 },
  { n: "Dwight Stone", p: 'WR', t: 'PIT', d: '1990s', s: { y: 35, p: 13, t: 0.2, c: 55 }, imp: 69, ea: 71 },
  { n: "Marcus Robertson", p: 'WR', t: 'TEN', d: '1990s', s: { y: 35, p: 12, t: 0.2, c: 55 }, imp: 68, ea: 70 },
  { n: "Leeland McElroy", p: 'WR', t: 'ARI', d: '1990s', s: { y: 30, p: 12, t: 0.2, c: 50 }, imp: 67, ea: 69 },
  { n: "Will Moore", p: 'WR', t: 'NE', d: '1990s', s: { y: 40, p: 12.5, t: 0.2, c: 55 }, imp: 70, ea: 72 },
  { n: "Charles Wilson", p: 'WR', t: 'TB', d: '1990s', s: { y: 35, p: 13, t: 0.2, c: 50 }, imp: 68, ea: 70 },
  { n: "Lawrence Dawsey", p: 'WR', t: 'TB', d: '1990s', s: { y: 55, p: 13, t: 0.3, c: 55 }, imp: 73, ea: 75 },
  { n: "Courtney Hawkins", p: 'WR', t: 'TB', d: '1990s', s: { y: 45, p: 11.5, t: 0.3, c: 60 }, imp: 71, ea: 73 },
  { n: "Horace Copeland", p: 'WR', t: 'TB', d: '1990s', s: { y: 50, p: 13.5, t: 0.3, c: 55 }, imp: 72, ea: 74 },
  { n: "Tyrone Drakeford", p: 'WR', t: 'SF', d: '1990s', s: { y: 30, p: 11.5, t: 0.2, c: 55 }, imp: 68, ea: 70 },
  { n: "J.T. Smith", p: 'WR', t: 'ARI', d: '1990s', s: { y: 60, p: 11, t: 0.3, c: 65 }, imp: 75, ea: 77 },
  { n: "Yatil Green", p: 'WR', t: 'MIA', d: '1990s', s: { y: 30, p: 12.5, t: 0.2, c: 50 }, imp: 67, ea: 69 },
  { n: "Eric Drage", p: 'WR', t: 'LV', d: '1990s', s: { y: 30, p: 12, t: 0.2, c: 50 }, imp: 67, ea: 69 },
  { n: "Henry Bailey", p: 'WR', t: 'NYJ', d: '1990s', s: { y: 35, p: 11.5, t: 0.2, c: 55 }, imp: 68, ea: 70 },
  { n: "Andre Coleman", p: 'WR', t: 'PIT', d: '1990s', s: { y: 30, p: 12.5, t: 0.2, c: 50 }, imp: 67, ea: 69 },
  { n: "Patrick Jeffers", p: 'WR', t: 'CAR', d: '1990s', s: { y: 50, p: 14, t: 0.4, c: 55 }, imp: 73, ea: 75 },
  { n: "Charles Wilson", p: 'WR', t: 'GB', d: '1990s', s: { y: 30, p: 12, t: 0.2, c: 55 }, imp: 68, ea: 70 },
  { n: "Toby Wright", p: 'WR', t: 'LAR', d: '1990s', s: { y: 30, p: 11.5, t: 0.2, c: 55 }, imp: 67, ea: 69 },
  { n: "Tyrone Davis", p: 'WR', t: 'GB', d: '1990s', s: { y: 30, p: 12, t: 0.3, c: 55 }, imp: 68, ea: 70 },
  { n: "Greg McElroy", p: 'TE', t: 'WAS', d: '1990s', s: { y: 25, t: 0.2, b: 78 }, imp: 70, ea: 72 },
  { n: "Larry Centers", p: 'RB', t: 'WAS', d: '1990s', s: { y: 25, t: 0.2, b: 75 }, imp: 70, ea: 71 },
  { n: "Eric Bjornson", p: 'TE', t: 'DAL', d: '1990s', s: { y: 35, t: 0.3, b: 75 }, imp: 71, ea: 73 },
  { n: "Pat Carter", p: 'TE', t: 'LAR', d: '1990s', s: { y: 30, t: 0.2, b: 78 }, imp: 70, ea: 72 },
  { n: "Pat Carter", p: 'TE', t: 'DET', d: '1990s', s: { y: 25, t: 0.2, b: 78 }, imp: 70, ea: 72 },
  { n: "Mark Boyer", p: 'TE', t: 'IND', d: '1990s', s: { y: 30, t: 0.2, b: 78 }, imp: 70, ea: 72 },
  { n: "Tony Cline", p: 'TE', t: 'NO', d: '1990s', s: { y: 25, t: 0.2, b: 78 }, imp: 68, ea: 70 },
  { n: "Walter Reeves", p: 'TE', t: 'ARI', d: '1990s', s: { y: 25, t: 0.2, b: 78 }, imp: 69, ea: 71 },
  { n: "James Thornton", p: 'TE', t: 'CHI', d: '1990s', s: { y: 30, t: 0.3, b: 75 }, imp: 70, ea: 72 },
  { n: "Reggie Johnson", p: 'TE', t: 'GB', d: '1990s', s: { y: 25, t: 0.2, b: 76 }, imp: 70, ea: 72 },
  { n: "Mike Tice", p: 'TE', t: 'WAS', d: '1990s', s: { y: 20, t: 0.2, b: 82 }, imp: 70, ea: 72 },
  { n: "Mike Tice", p: 'TE', t: 'MIN', d: '1990s', s: { y: 20, t: 0.2, b: 82 }, imp: 70, ea: 72 },
  { n: "Greg DeLong", p: 'TE', t: 'MIN', d: '1990s', s: { y: 25, t: 0.2, b: 78 }, imp: 70, ea: 72 },
  { n: "Aaron Pierce", p: 'TE', t: 'NYG', d: '1990s', s: { y: 30, t: 0.2, b: 78 }, imp: 70, ea: 72 },
  { n: "Bobby Coffeen", p: 'TE', t: 'CIN', d: '1990s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 70 },
  { n: "Brian Williams", p: 'TE', t: 'GB', d: '1990s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 70 },
  { n: "Lonnie Marts", p: 'TE', t: 'NO', d: '1990s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 70 },
  { n: "Drew Brees", p: 'QB', t: 'LAC', d: '2000s', s: { y: 245, t: 1.5, i: 0.9, r: 89 , ry: 2 }, imp: 84, ea: 85 },
  { n: "Jason Campbell", p: 'QB', t: 'WAS', d: '2000s', s: { y: 220, t: 1.2, i: 0.8, r: 82 , ry: 6 }, imp: 74, ea: 75 },
  { n: "A.J. Feeley", p: 'QB', t: 'PHI', d: '2000s', s: { y: 195, t: 1.1, i: 1.1, r: 72 , ry: 6 }, imp: 70, ea: 71 },
  { n: "A.J. Feeley", p: 'QB', t: 'MIA', d: '2000s', s: { y: 200, t: 1.1, i: 1.2, r: 70 , ry: 6 }, imp: 70, ea: 71 },
  { n: "Kelly Holcomb", p: 'QB', t: 'CLE', d: '2000s', s: { y: 200, t: 1.2, i: 1, r: 76 , ry: 6 }, imp: 71, ea: 72 },
  { n: "Quincy Carter", p: 'QB', t: 'DAL', d: '2000s', s: { y: 200, t: 1.1, i: 1.1, r: 73 , ry: 6 }, imp: 70, ea: 71 },
  { n: "Seneca Wallace", p: 'QB', t: 'SEA', d: '2000s', s: { y: 175, t: 1, i: 0.8, r: 76 , ry: 6 }, imp: 70, ea: 71 },
  { n: "Charlie Whitehurst", p: 'QB', t: 'LAC', d: '2000s', s: { y: 165, t: 0.9, i: 1, r: 70 , ry: 6 }, imp: 68, ea: 69 },
  { n: "Cleo Lemon", p: 'QB', t: 'MIA', d: '2000s', s: { y: 195, t: 1, i: 1, r: 70 , ry: 6 }, imp: 69, ea: 70 },
  { n: "Anthony Wright", p: 'QB', t: 'BAL', d: '2000s', s: { y: 190, t: 1, i: 1.1, r: 70 , ry: 6 }, imp: 70, ea: 71 },
  { n: "Doug Pederson", p: 'QB', t: 'CLE', d: '2000s', s: { y: 175, t: 0.9, i: 1.1, r: 67 , ry: 6 }, imp: 68, ea: 69 },
  { n: "Mark Brunell", p: 'QB', t: 'WAS', d: '2000s', s: { y: 215, t: 1.3, i: 0.6, r: 86 , ry: 6 }, imp: 75, ea: 76 },
  { n: "Mark Brunell", p: 'QB', t: 'NO', d: '2000s', s: { y: 175, t: 0.9, i: 0.7, r: 80 , ry: 6 }, imp: 70, ea: 71 },
  { n: "Jeff Garcia", p: 'QB', t: 'PHI', d: '2000s', s: { y: 215, t: 1.3, i: 0.7, r: 89 , ry: 16 }, imp: 76, ea: 77 },
  { n: "Jeff Garcia", p: 'QB', t: 'TB', d: '2000s', s: { y: 220, t: 1.4, i: 0.7, r: 90 , ry: 16 }, imp: 76, ea: 77 },
  { n: "Brad Johnson", p: 'QB', t: 'TB', d: '2000s', s: { y: 215, t: 1.4, i: 0.9, r: 85 , ry: 3 }, imp: 80, ea: 81 },
  { n: "Brad Johnson", p: 'QB', t: 'DAL', d: '2000s', s: { y: 195, t: 1.1, i: 1, r: 76 , ry: 3 }, imp: 73, ea: 74 },
  { n: "Steve McNair", p: 'QB', t: 'BAL', d: '2000s', s: { y: 195, t: 1.1, i: 0.8, r: 80 , ry: 8 }, imp: 75, ea: 76 },
  { n: "Brian Griese", p: 'QB', t: 'CHI', d: '2000s', s: { y: 220, t: 1.3, i: 1, r: 81 , ry: 6 }, imp: 72, ea: 73 },
  { n: "Brian Griese", p: 'QB', t: 'TB', d: '2000s', s: { y: 215, t: 1.3, i: 1.1, r: 80 , ry: 6 }, imp: 72, ea: 73 },
  { n: "Brodie Croyle", p: 'QB', t: 'KC', d: '2000s', s: { y: 175, t: 1, i: 1.1, r: 70 , ry: 6 }, imp: 68, ea: 69 },
  { n: "Tyler Thigpen", p: 'QB', t: 'KC', d: '2000s', s: { y: 210, t: 1.4, i: 1.1, r: 76 , ry: 6 }, imp: 71, ea: 72 },
  { n: "Kerry Collins", p: 'QB', t: 'TEN', d: '2000s', s: { y: 215, t: 1.2, i: 1.1, r: 75 , ry: 3 }, imp: 74, ea: 75 },
  { n: "Kyle Orton", p: 'QB', t: 'CHI', d: '2000s', s: { y: 195, t: 1, i: 0.9, r: 75 , ry: 6 }, imp: 71, ea: 72 },
  { n: "Kyle Orton", p: 'QB', t: 'DEN', d: '2000s', s: { y: 230, t: 1.4, i: 0.9, r: 84 , ry: 6 }, imp: 74, ea: 75 },
  { n: "Steve Beuerlein", p: 'QB', t: 'DEN', d: '2000s', s: { y: 195, t: 1.1, i: 1, r: 75 , ry: 2 }, imp: 71, ea: 72 },
  { n: "Doug Flutie", p: 'QB', t: 'BUF', d: '2000s', s: { y: 195, t: 1.1, i: 0.8, r: 80 , ry: 18 }, imp: 75, ea: 76 },
  { n: "Chris Johnson", p: 'RB', t: 'TEN', d: '2000s', s: { y: 100, c: 4.9, r: 30, t: 0.7 }, imp: 88, ea: 89 },
  { n: "Cedric Benson", p: 'RB', t: 'CHI', d: '2000s', s: { y: 60, c: 3.5, r: 12, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Joseph Addai", p: 'RB', t: 'IND', d: '2000s', s: { y: 80, c: 4.2, r: 30, t: 0.7 }, imp: 80, ea: 81 },
  { n: "Willie Parker", p: 'RB', t: 'PIT', d: '2000s', s: { y: 90, c: 4.5, r: 12, t: 0.6 }, imp: 80, ea: 81 },
  { n: "Thomas Jones", p: 'RB', t: 'NYJ', d: '2000s', s: { y: 85, c: 4.2, r: 12, t: 0.7 }, imp: 80, ea: 81 },
  { n: "Kevin Jones", p: 'RB', t: 'DET', d: '2000s', s: { y: 65, c: 4, r: 25, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Julius Jones", p: 'RB', t: 'DAL', d: '2000s', s: { y: 70, c: 4, r: 12, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Julius Jones", p: 'RB', t: 'SEA', d: '2000s', s: { y: 60, c: 4, r: 12, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Beanie Wells", p: 'RB', t: 'ARI', d: '2000s', s: { y: 65, c: 4.3, r: 10, t: 0.5 }, imp: 75, ea: 76 },
  { n: "LeRon McClain", p: 'RB', t: 'BAL', d: '2000s', s: { y: 50, c: 3.8, r: 12, t: 0.6 }, imp: 74, ea: 75 },
  { n: "Ron Dayne", p: 'RB', t: 'HOU', d: '2000s', s: { y: 50, c: 3.7, r: 8, t: 0.5 }, imp: 72, ea: 73 },
  { n: "Pierre Thomas", p: 'RB', t: 'NO', d: '2000s', s: { y: 65, c: 4.5, r: 35, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Earnest Graham", p: 'RB', t: 'TB', d: '2000s', s: { y: 65, c: 3.9, r: 20, t: 0.5 }, imp: 74, ea: 75 },
  { n: "Chester Taylor", p: 'RB', t: 'BAL', d: '2000s', s: { y: 60, c: 4, r: 25, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Travis Henry", p: 'RB', t: 'TEN', d: '2000s', s: { y: 70, c: 3.8, r: 12, t: 0.5 }, imp: 75, ea: 76 },
  { n: "Travis Henry", p: 'RB', t: 'DEN', d: '2000s', s: { y: 80, c: 4.2, r: 12, t: 0.6 }, imp: 76, ea: 77 },
  { n: "Justin Forsett", p: 'RB', t: 'SEA', d: '2000s', s: { y: 50, c: 4.4, r: 25, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Kevin Smith", p: 'RB', t: 'DET', d: '2000s', s: { y: 70, c: 4, r: 25, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Ahmad Bradshaw", p: 'RB', t: 'NYG', d: '2000s', s: { y: 65, c: 4.5, r: 18, t: 0.4 }, imp: 76, ea: 77 },
  { n: "Brandon Jackson", p: 'RB', t: 'GB', d: '2000s', s: { y: 45, c: 3.7, r: 25, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Cadillac Williams", p: 'RB', t: 'TB', d: '2000s', s: { y: 75, c: 4, r: 18, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Kevin Faulk", p: 'RB', t: 'NE', d: '2000s', s: { y: 30, c: 4.3, r: 35, t: 0.3 }, imp: 75, ea: 76 },
  { n: "T.J. Duckett", p: 'RB', t: 'ATL', d: '2000s', s: { y: 55, c: 3.8, r: 8, t: 0.5 }, imp: 72, ea: 73 },
  { n: "Maurice Morris", p: 'RB', t: 'SEA', d: '2000s', s: { y: 50, c: 4.1, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Larry Centers", p: 'RB', t: 'BUF', d: '2000s', s: { y: 20, c: 3.6, r: 50, t: 0.2 }, imp: 72, ea: 73 },
  { n: "Mike Bell", p: 'RB', t: 'NO', d: '2000s', s: { y: 50, c: 4.6, r: 8, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Najeh Davenport", p: 'RB', t: 'GB', d: '2000s', s: { y: 35, c: 4.4, r: 8, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Marcel Shipp", p: 'RB', t: 'ARI', d: '2000s', s: { y: 55, c: 3.7, r: 8, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Mewelde Moore", p: 'RB', t: 'PIT', d: '2000s', s: { y: 35, c: 4, r: 30, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Mewelde Moore", p: 'RB', t: 'MIN', d: '2000s', s: { y: 40, c: 4.4, r: 30, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Verron Haynes", p: 'RB', t: 'PIT', d: '2000s', s: { y: 35, c: 3.9, r: 18, t: 0.2 }, imp: 70, ea: 71 },
  { n: "DeShaun Foster", p: 'RB', t: 'CAR', d: '2000s', s: { y: 65, c: 4, r: 12, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Randy Moss", p: 'WR', t: 'LV', d: '2000s', s: { y: 75, p: 13.5, t: 0.5, c: 55 }, imp: 80, ea: 81 },
  { n: "Randy Moss", p: 'WR', t: 'TEN', d: '2000s', s: { y: 50, p: 12, t: 0.3, c: 55 }, imp: 72, ea: 73 },
  { n: "Steve Smith Sr.", p: 'WR', t: 'CAR', d: '2000s', s: { y: 85, p: 13.5, t: 0.6, c: 60 }, imp: 88, ea: 89 },
  { n: "Wes Welker", p: 'WR', t: 'MIA', d: '2000s', s: { y: 50, p: 8.5, t: 0.2, c: 75 }, imp: 73, ea: 74 },
  { n: "Mike Williams", p: 'WR', t: 'DET', d: '2000s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 73 },
  { n: "Eddie Royal", p: 'WR', t: 'DEN', d: '2000s', s: { y: 55, p: 11, t: 0.3, c: 65 }, imp: 73, ea: 74 },
  { n: "David Boston", p: 'WR', t: 'ARI', d: '2000s', s: { y: 75, p: 13.5, t: 0.5, c: 55 }, imp: 80, ea: 81 },
  { n: "Joey Galloway", p: 'WR', t: 'DAL', d: '2000s', s: { y: 60, p: 13.5, t: 0.4, c: 55 }, imp: 75, ea: 76 },
  { n: "Joey Galloway", p: 'WR', t: 'NE', d: '2000s', s: { y: 40, p: 12.5, t: 0.2, c: 55 }, imp: 71, ea: 72 },
  { n: "Reggie Brown", p: 'WR', t: 'PHI', d: '2000s', s: { y: 55, p: 13, t: 0.3, c: 55 }, imp: 73, ea: 74 },
  { n: "Justin Gage", p: 'WR', t: 'CHI', d: '2000s', s: { y: 40, p: 12.5, t: 0.2, c: 55 }, imp: 70, ea: 71 },
  { n: "Justin Gage", p: 'WR', t: 'TEN', d: '2000s', s: { y: 55, p: 13.5, t: 0.3, c: 55 }, imp: 73, ea: 74 },
  { n: "Patrick Crayton", p: 'WR', t: 'DAL', d: '2000s', s: { y: 55, p: 13.5, t: 0.3, c: 55 }, imp: 73, ea: 74 },
  { n: "Devin Hester", p: 'WR', t: 'CHI', d: '2000s', s: { y: 45, p: 12.5, t: 0.3, c: 55 }, imp: 72, ea: 73 },
  { n: "Chris Henry", p: 'WR', t: 'CIN', d: '2000s', s: { y: 50, p: 14.5, t: 0.4, c: 55 }, imp: 73, ea: 74 },
  { n: "Earnest Wilford", p: 'WR', t: 'JAX', d: '2000s', s: { y: 50, p: 12.5, t: 0.3, c: 55 }, imp: 72, ea: 73 },
  { n: "Derrick Mason", p: 'WR', t: 'TEN', d: '2000s', s: { y: 70, p: 11.5, t: 0.3, c: 65 }, imp: 78, ea: 79 },
  { n: "Mark Clayton", p: 'WR', t: 'BAL', d: '2000s', s: { y: 55, p: 13, t: 0.3, c: 60 }, imp: 73, ea: 74 },
  { n: "Demetrius Williams", p: 'WR', t: 'BAL', d: '2000s', s: { y: 45, p: 13, t: 0.2, c: 55 }, imp: 71, ea: 72 },
  { n: "Kassim Osgood", p: 'WR', t: 'LAC', d: '2000s', s: { y: 30, p: 14, t: 0.2, c: 55 }, imp: 70, ea: 71 },
  { n: "Eric Parker", p: 'WR', t: 'LAC', d: '2000s', s: { y: 55, p: 11.5, t: 0.3, c: 60 }, imp: 73, ea: 74 },
  { n: "Ashley Lelie", p: 'WR', t: 'DEN', d: '2000s', s: { y: 55, p: 16.5, t: 0.3, c: 50 }, imp: 73, ea: 74 },
  { n: "Rod Smith", p: 'WR', t: 'DEN', d: '2000s', s: { y: 75, p: 12.5, t: 0.4, c: 60 }, imp: 82, ea: 83 },
  { n: "Marty Booker", p: 'WR', t: 'CHI', d: '2000s', s: { y: 65, p: 12, t: 0.4, c: 60 }, imp: 76, ea: 77 },
  { n: "Marty Booker", p: 'WR', t: 'MIA', d: '2000s', s: { y: 50, p: 11.5, t: 0.3, c: 60 }, imp: 72, ea: 73 },
  { n: "Bernard Berrian", p: 'WR', t: 'CHI', d: '2000s', s: { y: 55, p: 14.5, t: 0.3, c: 55 }, imp: 73, ea: 74 },
  { n: "Bernard Berrian", p: 'WR', t: 'MIN', d: '2000s', s: { y: 50, p: 14, t: 0.3, c: 55 }, imp: 72, ea: 73 },
  { n: "Mike Furrey", p: 'WR', t: 'DET', d: '2000s', s: { y: 55, p: 9.5, t: 0.3, c: 65 }, imp: 73, ea: 74 },
  { n: "Greg Camarillo", p: 'WR', t: 'MIA', d: '2000s', s: { y: 50, p: 10.5, t: 0.2, c: 65 }, imp: 71, ea: 72 },
  { n: "Isaac Bruce", p: 'WR', t: 'LAR', d: '2000s', s: { y: 75, p: 13, t: 0.4, c: 60 }, imp: 84, ea: 85 },
  { n: "Isaac Bruce", p: 'WR', t: 'SF', d: '2000s', s: { y: 60, p: 11, t: 0.3, c: 60 }, imp: 75, ea: 76 },
  { n: "Torry Holt", p: 'WR', t: 'JAX', d: '2000s', s: { y: 45, p: 11, t: 0.2, c: 60 }, imp: 71, ea: 72 },
  { n: "Az-Zahir Hakim", p: 'WR', t: 'DET', d: '2000s', s: { y: 40, p: 13, t: 0.2, c: 55 }, imp: 70, ea: 71 },
  { n: "Az-Zahir Hakim", p: 'WR', t: 'NO', d: '2000s', s: { y: 35, p: 13, t: 0.2, c: 55 }, imp: 69, ea: 70 },
  { n: "Kevin Curtis", p: 'WR', t: 'LAR', d: '2000s', s: { y: 55, p: 13, t: 0.3, c: 60 }, imp: 73, ea: 74 },
  { n: "Joe Jurevicius", p: 'WR', t: 'TB', d: '2000s', s: { y: 50, p: 13, t: 0.3, c: 60 }, imp: 72, ea: 73 },
  { n: "Joe Jurevicius", p: 'WR', t: 'SEA', d: '2000s', s: { y: 45, p: 12.5, t: 0.3, c: 60 }, imp: 71, ea: 72 },
  { n: "Michael Clayton", p: 'WR', t: 'TB', d: '2000s', s: { y: 55, p: 12, t: 0.3, c: 60 }, imp: 73, ea: 74 },
  { n: "Antonio Bryant", p: 'WR', t: 'CLE', d: '2000s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 73 },
  { n: "Braylon Edwards", p: 'WR', t: 'CLE', d: '2000s', s: { y: 75, p: 13.5, t: 0.5, c: 55 }, imp: 78, ea: 79 },
  { n: "Braylon Edwards", p: 'WR', t: 'NYJ', d: '2000s', s: { y: 65, p: 14, t: 0.4, c: 55 }, imp: 75, ea: 76 },
  { n: "Jerricho Cotchery", p: 'WR', t: 'NYJ', d: '2000s', s: { y: 60, p: 12.5, t: 0.3, c: 60 }, imp: 75, ea: 76 },
  { n: "Anthony Gonzalez", p: 'WR', t: 'IND', d: '2000s', s: { y: 45, p: 11.5, t: 0.3, c: 60 }, imp: 72, ea: 73 },
  { n: "Pierre Garcon", p: 'WR', t: 'IND', d: '2000s', s: { y: 55, p: 11.5, t: 0.3, c: 60 }, imp: 75, ea: 76 },
  { n: "Jerricho Cotchery", p: 'WR', t: 'PIT', d: '2010s', s: { y: 35, p: 13, t: 0.2, c: 60 }, imp: 70, ea: 70 },
  { n: "Limas Sweed", p: 'WR', t: 'PIT', d: '2000s', s: { y: 30, p: 13, t: 0.2, c: 50 }, imp: 68, ea: 69 },
  { n: "Mohamed Massaquoi", p: 'WR', t: 'CLE', d: '2000s', s: { y: 50, p: 14, t: 0.3, c: 55 }, imp: 72, ea: 73 },
  { n: "Devery Henderson", p: 'WR', t: 'NO', d: '2000s', s: { y: 55, p: 17, t: 0.3, c: 50 }, imp: 73, ea: 74 },
  { n: "Lance Moore", p: 'WR', t: 'NO', d: '2000s', s: { y: 55, p: 11, t: 0.3, c: 65 }, imp: 74, ea: 75 },
  { n: "Robert Meachem", p: 'WR', t: 'NO', d: '2000s', s: { y: 50, p: 16.5, t: 0.3, c: 50 }, imp: 73, ea: 74 },
  { n: "Marques Colston", p: 'WR', t: 'NO', d: '2000s', s: { y: 75, p: 13, t: 0.5, c: 60 }, imp: 84, ea: 85 },
  { n: "Reche Caldwell", p: 'WR', t: 'NE', d: '2000s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 73 },
  { n: "Jabar Gaffney", p: 'WR', t: 'NE', d: '2000s', s: { y: 50, p: 12.5, t: 0.3, c: 60 }, imp: 72, ea: 73 },
  { n: "Jabar Gaffney", p: 'WR', t: 'DEN', d: '2000s', s: { y: 55, p: 13, t: 0.3, c: 60 }, imp: 73, ea: 74 },
  { n: "Sammie Stroughter", p: 'WR', t: 'TB', d: '2000s', s: { y: 35, p: 11.5, t: 0.2, c: 55 }, imp: 68, ea: 69 },
  { n: "Domenik Hixon", p: 'WR', t: 'NYG', d: '2000s', s: { y: 35, p: 13, t: 0.2, c: 55 }, imp: 69, ea: 70 },
  { n: "Steve Breaston", p: 'WR', t: 'ARI', d: '2000s', s: { y: 55, p: 12.5, t: 0.3, c: 60 }, imp: 73, ea: 74 },
  { n: "Kelley Washington", p: 'WR', t: 'CIN', d: '2000s', s: { y: 30, p: 12.5, t: 0.2, c: 55 }, imp: 68, ea: 69 },
  { n: "Tony Gonzalez", p: 'TE', t: 'ATL', d: '2000s', s: { y: 60, t: 0.4, b: 72 }, imp: 84, ea: 85 },
  { n: "Jeremy Shockey", p: 'TE', t: 'NO', d: '2000s', s: { y: 45, t: 0.3, b: 72 }, imp: 75, ea: 76 },
  { n: "Tony Scheffler", p: 'TE', t: 'DEN', d: '2000s', s: { y: 40, t: 0.3, b: 78 }, imp: 73, ea: 74 },
  { n: "Bo Scaife", p: 'TE', t: 'TEN', d: '2000s', s: { y: 40, t: 0.3, b: 78 }, imp: 73, ea: 74 },
  { n: "Visanthe Shiancoe", p: 'TE', t: 'MIN', d: '2000s', s: { y: 40, t: 0.5, b: 75 }, imp: 75, ea: 76 },
  { n: "Visanthe Shiancoe", p: 'TE', t: 'NYG', d: '2000s', s: { y: 25, t: 0.2, b: 76 }, imp: 70, ea: 71 },
  { n: "Anthony Becht", p: 'TE', t: 'NYJ', d: '2000s', s: { y: 25, t: 0.2, b: 80 }, imp: 70, ea: 71 },
  { n: "Anthony Becht", p: 'TE', t: 'TB', d: '2000s', s: { y: 25, t: 0.2, b: 78 }, imp: 70, ea: 71 },
  { n: "Itula Mili", p: 'TE', t: 'SEA', d: '2000s', s: { y: 35, t: 0.3, b: 76 }, imp: 71, ea: 72 },
  { n: "Daniel Graham", p: 'TE', t: 'NE', d: '2000s', s: { y: 30, t: 0.4, b: 84 }, imp: 73, ea: 74 },
  { n: "Daniel Graham", p: 'TE', t: 'DEN', d: '2000s', s: { y: 30, t: 0.3, b: 82 }, imp: 71, ea: 72 },
  { n: "Doug Jolley", p: 'TE', t: 'NYJ', d: '2000s', s: { y: 30, t: 0.2, b: 75 }, imp: 69, ea: 70 },
  { n: "Eric Johnson", p: 'TE', t: 'SF', d: '2000s', s: { y: 45, t: 0.3, b: 76 }, imp: 73, ea: 74 },
  { n: "Robert Royal", p: 'TE', t: 'BUF', d: '2000s', s: { y: 30, t: 0.3, b: 78 }, imp: 70, ea: 71 },
  { n: "David Martin", p: 'TE', t: 'MIA', d: '2000s', s: { y: 30, t: 0.3, b: 76 }, imp: 70, ea: 71 },
  { n: "Stephen Alexander", p: 'TE', t: 'DEN', d: '2000s', s: { y: 30, t: 0.2, b: 76 }, imp: 70, ea: 71 },
  { n: "Stephen Alexander", p: 'TE', t: 'DET', d: '2000s', s: { y: 30, t: 0.2, b: 76 }, imp: 70, ea: 71 },
  { n: "Reggie Kelly", p: 'TE', t: 'CIN', d: '2000s', s: { y: 25, t: 0.2, b: 82 }, imp: 71, ea: 72 },
  { n: "Ben Troupe", p: 'TE', t: 'TEN', d: '2000s', s: { y: 40, t: 0.3, b: 75 }, imp: 72, ea: 73 },
  { n: "Jerramy Stevens", p: 'TE', t: 'SEA', d: '2000s', s: { y: 35, t: 0.3, b: 76 }, imp: 71, ea: 72 },
  { n: "Donald Lee", p: 'TE', t: 'GB', d: '2000s', s: { y: 30, t: 0.3, b: 75 }, imp: 71, ea: 72 },
  { n: "Aaron Hernandez", p: 'TE', t: 'NE', d: '2000s', s: { y: 50, t: 0.4, b: 72 }, imp: 76, ea: 77 },
  { n: "John Carlson", p: 'TE', t: 'SEA', d: '2000s', s: { y: 40, t: 0.4, b: 75 }, imp: 72, ea: 73 },
  { n: "Brandon Pettigrew", p: 'TE', t: 'DET', d: '2000s', s: { y: 35, t: 0.2, b: 78 }, imp: 70, ea: 71 },
  { n: "Dustin Keller", p: 'TE', t: 'NYJ', d: '2000s', s: { y: 50, t: 0.3, b: 72 }, imp: 75, ea: 76 },
  { n: "Jermichael Finley", p: 'TE', t: 'GB', d: '2000s', s: { y: 35, t: 0.3, b: 70 }, imp: 72, ea: 73 },
  { n: "Tony Curtis", p: 'TE', t: 'DAL', d: '2000s', s: { y: 25, t: 0.2, b: 76 }, imp: 69, ea: 70 },
  { n: "Martellus Bennett", p: 'TE', t: 'DAL', d: '2000s', s: { y: 25, t: 0.2, b: 78 }, imp: 70, ea: 71 },
  { n: "Kevin Boss", p: 'TE', t: 'NYG', d: '2000s', s: { y: 30, t: 0.3, b: 76 }, imp: 71, ea: 72 },
  { n: "Nick Foles", p: 'QB', t: 'JAX', d: '2010s', s: { y: 215, t: 1.2, i: 1, r: 80 , ry: 3 }, imp: 72, ea: 72 },
  { n: "Brian Hoyer", p: 'QB', t: 'HOU', d: '2010s', s: { y: 230, t: 1.3, i: 1, r: 84 , ry: 7 }, imp: 73, ea: 73 },
  { n: "Brian Hoyer", p: 'QB', t: 'CHI', d: '2010s', s: { y: 215, t: 1.1, i: 0.8, r: 87 , ry: 7 }, imp: 72, ea: 72 },
  { n: "Charlie Whitehurst", p: 'QB', t: 'TEN', d: '2010s', s: { y: 200, t: 1.1, i: 1, r: 80 , ry: 7 }, imp: 70, ea: 70 },
  { n: "Jason Campbell", p: 'QB', t: 'LV', d: '2010s', s: { y: 215, t: 1.2, i: 0.8, r: 84 , ry: 7 }, imp: 73, ea: 73 },
  { n: "Jason Campbell", p: 'QB', t: 'CHI', d: '2010s', s: { y: 195, t: 1.1, i: 0.9, r: 80 , ry: 7 }, imp: 71, ea: 71 },
  { n: "Jason Campbell", p: 'QB', t: 'CIN', d: '2010s', s: { y: 195, t: 1, i: 1, r: 75 , ry: 7 }, imp: 70, ea: 70 },
  { n: "Sam Bradford", p: 'QB', t: 'PHI', d: '2010s', s: { y: 230, t: 1.4, i: 0.8, r: 87 , ry: 7 }, imp: 76, ea: 76 },
  { n: "Sam Bradford", p: 'QB', t: 'MIN', d: '2010s', s: { y: 245, t: 1.5, i: 0.5, r: 99 , ry: 7 }, imp: 80, ea: 80 },
  { n: "Jacoby Brissett", p: 'QB', t: 'NE', d: '2010s', s: { y: 175, t: 0.9, i: 0.5, r: 80 , ry: 12 }, imp: 71, ea: 71 },
  { n: "Matt Cassel", p: 'QB', t: 'KC', d: '2010s', s: { y: 215, t: 1.2, i: 1, r: 78 , ry: 7 }, imp: 73, ea: 73 },
  { n: "Matt Cassel", p: 'QB', t: 'MIN', d: '2010s', s: { y: 210, t: 1.2, i: 1, r: 78 , ry: 7 }, imp: 72, ea: 72 },
  { n: "Josh McCown", p: 'QB', t: 'CHI', d: '2010s', s: { y: 230, t: 1.5, i: 0.4, r: 109 , ry: 7 }, imp: 76, ea: 76 },
  { n: "Josh McCown", p: 'QB', t: 'NYJ', d: '2010s', s: { y: 240, t: 1.5, i: 1.1, r: 87 , ry: 7 }, imp: 73, ea: 73 },
  { n: "Connor Cook", p: 'QB', t: 'LV', d: '2010s', s: { y: 170, t: 0.8, i: 1, r: 65 , ry: 7 }, imp: 67, ea: 67 },
  { n: "Tom Savage", p: 'QB', t: 'HOU', d: '2010s', s: { y: 175, t: 0.9, i: 1, r: 70 , ry: 7 }, imp: 68, ea: 68 },
  { n: "Christian Hackenberg", p: 'QB', t: 'NYJ', d: '2010s', s: { y: 165, t: 0.7, i: 1, r: 60 , ry: 7 }, imp: 65, ea: 65 },
  { n: "Paxton Lynch", p: 'QB', t: 'DEN', d: '2010s', s: { y: 175, t: 0.9, i: 1, r: 75 , ry: 7 }, imp: 68, ea: 68 },
  { n: "Kellen Clemens", p: 'QB', t: 'LAC', d: '2010s', s: { y: 170, t: 0.9, i: 1, r: 70 , ry: 7 }, imp: 68, ea: 68 },
  { n: "Kirk Cousins", p: 'QB', t: 'MIN', d: '2010s', s: { y: 270, t: 1.8, i: 0.6, r: 100 , ry: 5 }, imp: 84, ea: 84 },
  { n: "Tyrod Taylor", p: 'QB', t: 'BUF', d: '2010s', s: { y: 205, t: 1.1, i: 0.4, r: 91 , ry: 30 }, imp: 78, ea: 78 },
  { n: "Tyrod Taylor", p: 'QB', t: 'CLE', d: '2010s', s: { y: 165, t: 0.7, i: 0.5, r: 75 , ry: 7 }, imp: 70, ea: 70 },
  { n: "AJ McCarron", p: 'QB', t: 'CIN', d: '2010s', s: { y: 175, t: 1, i: 0.6, r: 85 , ry: 7 }, imp: 70, ea: 70 },
  { n: "LeSean McCoy", p: 'RB', t: 'BUF', d: '2010s', s: { y: 75, c: 4, r: 25, t: 0.4 }, imp: 78, ea: 79 },
  { n: "Marshawn Lynch", p: 'RB', t: 'LV', d: '2010s', s: { y: 55, c: 3.8, r: 12, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Adrian Peterson", p: 'RB', t: 'WAS', d: '2010s', s: { y: 65, c: 4, r: 12, t: 0.5 }, imp: 75, ea: 76 },
  { n: "Frank Gore", p: 'RB', t: 'SF', d: '2010s', s: { y: 85, c: 4.2, r: 25, t: 0.5 }, imp: 82, ea: 83 },
  { n: "Matt Forte", p: 'RB', t: 'NYJ', d: '2010s', s: { y: 55, c: 3.8, r: 35, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Ray Rice", p: 'RB', t: 'BAL', d: '2010s', s: { y: 85, c: 4.3, r: 50, t: 0.5 }, imp: 84, ea: 85 },
  { n: "DeMarco Murray", p: 'RB', t: 'TEN', d: '2010s', s: { y: 85, c: 4.4, r: 25, t: 0.5 }, imp: 80, ea: 81 },
  { n: "DeMarco Murray", p: 'RB', t: 'PHI', d: '2010s', s: { y: 50, c: 3.6, r: 18, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Maurice Jones-Drew", p: 'RB', t: 'JAX', d: '2010s', s: { y: 80, c: 4.1, r: 25, t: 0.6 }, imp: 78, ea: 79 },
  { n: "Steven Jackson", p: 'RB', t: 'LAR', d: '2010s', s: { y: 80, c: 4, r: 25, t: 0.4 }, imp: 78, ea: 79 },
  { n: "Chris Johnson", p: 'RB', t: 'TEN', d: '2010s', s: { y: 85, c: 4.5, r: 25, t: 0.5 }, imp: 82, ea: 83 },
  { n: "Chris Johnson", p: 'RB', t: 'NYJ', d: '2010s', s: { y: 50, c: 3.8, r: 15, t: 0.2 }, imp: 71, ea: 72 },
  { n: "Chris Johnson", p: 'RB', t: 'ARI', d: '2010s', s: { y: 65, c: 4.2, r: 12, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Michael Turner", p: 'RB', t: 'ATL', d: '2010s', s: { y: 75, c: 4.1, r: 8, t: 0.6 }, imp: 76, ea: 77 },
  { n: "Cedric Benson", p: 'RB', t: 'GB', d: '2010s', s: { y: 50, c: 3.6, r: 12, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Reggie Bush", p: 'RB', t: 'MIA', d: '2010s', s: { y: 70, c: 4.4, r: 25, t: 0.4 }, imp: 76, ea: 77 },
  { n: "Reggie Bush", p: 'RB', t: 'DET', d: '2010s', s: { y: 65, c: 4.4, r: 50, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Reggie Bush", p: 'RB', t: 'SF', d: '2010s', s: { y: 30, c: 3.5, r: 25, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Willis McGahee", p: 'RB', t: 'DEN', d: '2010s', s: { y: 70, c: 4.6, r: 12, t: 0.6 }, imp: 76, ea: 77 },
  { n: "Willis McGahee", p: 'RB', t: 'CLE', d: '2010s', s: { y: 50, c: 3.8, r: 8, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Peyton Hillis", p: 'RB', t: 'CLE', d: '2010s', s: { y: 75, c: 4.3, r: 35, t: 0.7 }, imp: 78, ea: 79 },
  { n: "Peyton Hillis", p: 'RB', t: 'KC', d: '2010s', s: { y: 45, c: 4, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Ryan Mathews", p: 'RB', t: 'PHI', d: '2010s', s: { y: 65, c: 4.7, r: 18, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Brandon Jacobs", p: 'RB', t: 'NYG', d: '2010s', s: { y: 55, c: 4, r: 8, t: 0.6 }, imp: 73, ea: 74 },
  { n: "Ahmad Bradshaw", p: 'RB', t: 'NYG', d: '2010s', s: { y: 75, c: 4.3, r: 20, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Ahmad Bradshaw", p: 'RB', t: 'IND', d: '2010s', s: { y: 65, c: 4.7, r: 12, t: 0.5 }, imp: 74, ea: 75 },
  { n: "Trent Richardson", p: 'RB', t: 'CLE', d: '2010s', s: { y: 70, c: 3.6, r: 25, t: 0.6 }, imp: 75, ea: 76 },
  { n: "Trent Richardson", p: 'RB', t: 'IND', d: '2010s', s: { y: 45, c: 3, r: 18, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Pierre Thomas", p: 'RB', t: 'NO', d: '2010s', s: { y: 50, c: 4.5, r: 40, t: 0.3 }, imp: 75, ea: 76 },
  { n: "Le'Veon Bell", p: 'RB', t: 'NYJ', d: '2010s', s: { y: 50, c: 3.3, r: 25, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Jay Ajayi", p: 'RB', t: 'MIA', d: '2010s', s: { y: 80, c: 4.3, r: 12, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Jay Ajayi", p: 'RB', t: 'PHI', d: '2010s', s: { y: 50, c: 4.1, r: 12, t: 0.3 }, imp: 72, ea: 73 },
  { n: "C.J. Anderson", p: 'RB', t: 'DEN', d: '2010s', s: { y: 65, c: 4.4, r: 18, t: 0.4 }, imp: 75, ea: 76 },
  { n: "C.J. Anderson", p: 'RB', t: 'LAR', d: '2010s', s: { y: 60, c: 4.7, r: 12, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Andre Ellington", p: 'RB', t: 'ARI', d: '2010s', s: { y: 55, c: 4.4, r: 30, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Demaryius Thomas", p: 'WR', t: 'HOU', d: '2010s', s: { y: 55, p: 11.5, t: 0.3, c: 60 }, imp: 73, ea: 73 },
  { n: "Eric Decker", p: 'WR', t: 'TEN', d: '2010s', s: { y: 35, p: 12.5, t: 0.2, c: 60 }, imp: 70, ea: 70 },
  { n: "Reggie Wayne", p: 'WR', t: 'IND', d: '2010s', s: { y: 75, p: 12, t: 0.4, c: 65 }, imp: 80, ea: 80 },
  { n: "Mike Wallace", p: 'WR', t: 'MIA', d: '2010s', s: { y: 65, p: 14.5, t: 0.4, c: 55 }, imp: 76, ea: 76 },
  { n: "Mike Wallace", p: 'WR', t: 'MIN', d: '2010s', s: { y: 55, p: 14.5, t: 0.3, c: 55 }, imp: 73, ea: 73 },
  { n: "Mike Wallace", p: 'WR', t: 'BAL', d: '2010s', s: { y: 60, p: 13.5, t: 0.3, c: 55 }, imp: 75, ea: 75 },
  { n: "Roddy White", p: 'WR', t: 'ATL', d: '2010s', s: { y: 75, p: 12, t: 0.4, c: 60 }, imp: 80, ea: 80 },
  { n: "Hines Ward", p: 'WR', t: 'PIT', d: '2010s', s: { y: 55, p: 11, t: 0.3, c: 65 }, imp: 75, ea: 75 },
  { n: "Pierre Garcon", p: 'WR', t: 'SF', d: '2010s', s: { y: 55, p: 12.5, t: 0.2, c: 65 }, imp: 73, ea: 73 },
  { n: "Anquan Boldin", p: 'WR', t: 'DET', d: '2010s', s: { y: 55, p: 11, t: 0.4, c: 65 }, imp: 73, ea: 73 },
  { n: "Wes Welker", p: 'WR', t: 'DEN', d: '2010s', s: { y: 60, p: 9.5, t: 0.6, c: 75 }, imp: 78, ea: 78 },
  { n: "Cole Beasley", p: 'WR', t: 'DAL', d: '2010s', s: { y: 50, p: 9.5, t: 0.3, c: 70 }, imp: 73, ea: 73 },
  { n: "James Jones", p: 'WR', t: 'LV', d: '2010s', s: { y: 45, p: 12, t: 0.2, c: 55 }, imp: 71, ea: 71 },
  { n: "Emmanuel Sanders", p: 'WR', t: 'PIT', d: '2010s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 73, ea: 73 },
  { n: "Andrew Hawkins", p: 'WR', t: 'CLE', d: '2010s', s: { y: 45, p: 11.5, t: 0.2, c: 65 }, imp: 71, ea: 71 },
  { n: "Josh Gordon", p: 'WR', t: 'CLE', d: '2010s', s: { y: 85, p: 18, t: 0.5, c: 55 }, imp: 84, ea: 84 },
  { n: "Dwayne Bowe", p: 'WR', t: 'KC', d: '2010s', s: { y: 70, p: 13, t: 0.4, c: 60 }, imp: 78, ea: 78 },
  { n: "Jeremy Maclin", p: 'WR', t: 'KC', d: '2010s', s: { y: 65, p: 12.5, t: 0.4, c: 65 }, imp: 76, ea: 76 },
  { n: "Jeremy Maclin", p: 'WR', t: 'BAL', d: '2010s', s: { y: 35, p: 11, t: 0.2, c: 60 }, imp: 70, ea: 70 },
  { n: "Tyler Lockett", p: 'WR', t: 'SEA', d: '2010s', s: { y: 60, p: 13, t: 0.4, c: 70 }, imp: 78, ea: 78 },
  { n: "Jermaine Kearse", p: 'WR', t: 'SEA', d: '2010s', s: { y: 45, p: 13, t: 0.3, c: 55 }, imp: 71, ea: 71 },
  { n: "Jermaine Kearse", p: 'WR', t: 'NYJ', d: '2010s', s: { y: 50, p: 11.5, t: 0.3, c: 55 }, imp: 72, ea: 72 },
  { n: "Mike Williams", p: 'WR', t: 'TB', d: '2010s', s: { y: 60, p: 14, t: 0.4, c: 55 }, imp: 75, ea: 75 },
  { n: "Vincent Brown", p: 'WR', t: 'LAC', d: '2010s', s: { y: 45, p: 12.5, t: 0.2, c: 60 }, imp: 71, ea: 71 },
  { n: "Malcom Floyd", p: 'WR', t: 'LAC', d: '2010s', s: { y: 55, p: 17, t: 0.3, c: 50 }, imp: 73, ea: 73 },
  { n: "Stevie Johnson", p: 'WR', t: 'BUF', d: '2010s', s: { y: 70, p: 13.5, t: 0.5, c: 60 }, imp: 78, ea: 78 },
  { n: "Stevie Johnson", p: 'WR', t: 'SF', d: '2010s', s: { y: 35, p: 12, t: 0.2, c: 60 }, imp: 70, ea: 70 },
  { n: "Sammy Watkins", p: 'WR', t: 'KC', d: '2010s', s: { y: 50, p: 13.5, t: 0.3, c: 60 }, imp: 73, ea: 73 },
  { n: "Marqise Lee", p: 'WR', t: 'JAX', d: '2010s', s: { y: 55, p: 12, t: 0.3, c: 60 }, imp: 73, ea: 73 },
  { n: "Allen Hurns", p: 'WR', t: 'DAL', d: '2010s', s: { y: 40, p: 12.5, t: 0.2, c: 55 }, imp: 70, ea: 70 },
  { n: "Terrance Williams", p: 'WR', t: 'DAL', d: '2010s', s: { y: 55, p: 15.5, t: 0.4, c: 55 }, imp: 73, ea: 73 },
  { n: "Miles Austin", p: 'WR', t: 'DAL', d: '2010s', s: { y: 65, p: 13.5, t: 0.4, c: 60 }, imp: 78, ea: 78 },
  { n: "Brandin Cooks", p: 'WR', t: 'NE', d: '2010s', s: { y: 70, p: 14.5, t: 0.4, c: 60 }, imp: 78, ea: 78 },
  { n: "Brandin Cooks", p: 'WR', t: 'LAR', d: '2010s', s: { y: 75, p: 14, t: 0.4, c: 60 }, imp: 80, ea: 80 },
  { n: "Willie Snead", p: 'WR', t: 'NO', d: '2010s', s: { y: 60, p: 11.5, t: 0.3, c: 65 }, imp: 73, ea: 73 },
  { n: "Kenny Stills", p: 'WR', t: 'NO', d: '2010s', s: { y: 50, p: 18.5, t: 0.3, c: 50 }, imp: 73, ea: 73 },
  { n: "Michael Floyd", p: 'WR', t: 'NE', d: '2010s', s: { y: 35, p: 13, t: 0.2, c: 55 }, imp: 70, ea: 70 },
  { n: "John Brown", p: 'WR', t: 'ARI', d: '2010s', s: { y: 60, p: 15.5, t: 0.4, c: 55 }, imp: 75, ea: 75 },
  { n: "Marvin Jones Jr.", p: 'WR', t: 'CIN', d: '2010s', s: { y: 50, p: 14, t: 0.4, c: 55 }, imp: 73, ea: 73 },
  { n: "Mohamed Sanu", p: 'WR', t: 'CIN', d: '2010s', s: { y: 50, p: 11.5, t: 0.3, c: 70 }, imp: 73, ea: 73 },
  { n: "Kelvin Benjamin", p: 'WR', t: 'CAR', d: '2010s', s: { y: 65, p: 13, t: 0.4, c: 55 }, imp: 76, ea: 76 },
  { n: "Devin Funchess", p: 'WR', t: 'CAR', d: '2010s', s: { y: 50, p: 12.5, t: 0.3, c: 55 }, imp: 73, ea: 73 },
  { n: "Donte Moncrief", p: 'WR', t: 'IND', d: '2010s', s: { y: 55, p: 13, t: 0.4, c: 55 }, imp: 73, ea: 73 },
  { n: "Marquise Goodwin", p: 'WR', t: 'BUF', d: '2010s', s: { y: 30, p: 14.5, t: 0.2, c: 50 }, imp: 70, ea: 70 },
  { n: "Trent Taylor", p: 'WR', t: 'SF', d: '2010s', s: { y: 35, p: 9.5, t: 0.2, c: 65 }, imp: 69, ea: 69 },
  { n: "Albert Wilson", p: 'WR', t: 'KC', d: '2010s', s: { y: 35, p: 11.5, t: 0.2, c: 65 }, imp: 70, ea: 70 },
  { n: "Chris Hogan", p: 'WR', t: 'NE', d: '2010s', s: { y: 50, p: 15.5, t: 0.3, c: 55 }, imp: 73, ea: 73 },
  { n: "Phillip Dorsett", p: 'WR', t: 'IND', d: '2010s', s: { y: 40, p: 13, t: 0.2, c: 55 }, imp: 70, ea: 70 },
  { n: "Jimmy Graham", p: 'TE', t: 'GB', d: '2010s', s: { y: 40, t: 0.3, b: 68 }, imp: 73, ea: 73 },
  { n: "Julius Thomas", p: 'TE', t: 'JAX', d: '2010s', s: { y: 30, t: 0.3, b: 70 }, imp: 71, ea: 71 },
  { n: "Martellus Bennett", p: 'TE', t: 'NYG', d: '2010s', s: { y: 50, t: 0.4, b: 75 }, imp: 76, ea: 76 },
  { n: "Martellus Bennett", p: 'TE', t: 'NE', d: '2010s', s: { y: 45, t: 0.5, b: 75 }, imp: 75, ea: 75 },
  { n: "Charles Clay", p: 'TE', t: 'BUF', d: '2010s', s: { y: 45, t: 0.3, b: 72 }, imp: 73, ea: 73 },
  { n: "Dustin Keller", p: 'TE', t: 'NYJ', d: '2010s', s: { y: 50, t: 0.3, b: 72 }, imp: 75, ea: 75 },
  { n: "Jordan Cameron", p: 'TE', t: 'CLE', d: '2010s', s: { y: 50, t: 0.4, b: 72 }, imp: 75, ea: 75 },
  { n: "Aaron Hernandez", p: 'TE', t: 'NE', d: '2010s', s: { y: 60, t: 0.4, b: 70 }, imp: 80, ea: 80 },
  { n: "Zach Miller", p: 'TE', t: 'SEA', d: '2010s', s: { y: 35, t: 0.3, b: 82 }, imp: 73, ea: 73 },
  { n: "Zach Miller", p: 'TE', t: 'CHI', d: '2010s', s: { y: 35, t: 0.4, b: 75 }, imp: 73, ea: 73 },
  { n: "Garrett Graham", p: 'TE', t: 'HOU', d: '2010s', s: { y: 30, t: 0.3, b: 75 }, imp: 71, ea: 71 },
  { n: "Anthony Fasano", p: 'TE', t: 'KC', d: '2010s', s: { y: 25, t: 0.3, b: 80 }, imp: 71, ea: 71 },
  { n: "Anthony Fasano", p: 'TE', t: 'TEN', d: '2010s', s: { y: 25, t: 0.2, b: 80 }, imp: 70, ea: 70 },
  { n: "Crockett Gillmore", p: 'TE', t: 'BAL', d: '2010s', s: { y: 30, t: 0.3, b: 78 }, imp: 71, ea: 71 },
  { n: "Vance McDonald", p: 'TE', t: 'SF', d: '2010s', s: { y: 30, t: 0.3, b: 75 }, imp: 71, ea: 71 },
  { n: "Vance McDonald", p: 'TE', t: 'PIT', d: '2010s', s: { y: 35, t: 0.3, b: 75 }, imp: 72, ea: 72 },
  { n: "Lance Kendricks", p: 'TE', t: 'LAR', d: '2010s', s: { y: 35, t: 0.2, b: 75 }, imp: 71, ea: 71 },
  { n: "Lance Kendricks", p: 'TE', t: 'GB', d: '2010s', s: { y: 30, t: 0.2, b: 75 }, imp: 70, ea: 70 },
  { n: "Ben Watson", p: 'TE', t: 'NO', d: '2010s', s: { y: 50, t: 0.4, b: 75 }, imp: 76, ea: 76 },
  { n: "Ben Watson", p: 'TE', t: 'BAL', d: '2010s', s: { y: 30, t: 0.2, b: 76 }, imp: 71, ea: 71 },
  { n: "Scott Chandler", p: 'TE', t: 'BUF', d: '2010s', s: { y: 30, t: 0.4, b: 75 }, imp: 72, ea: 72 },
  { n: "Jared Cook", p: 'TE', t: 'TEN', d: '2010s', s: { y: 40, t: 0.3, b: 70 }, imp: 73, ea: 73 },
  { n: "Jared Cook", p: 'TE', t: 'LAR', d: '2010s', s: { y: 35, t: 0.2, b: 70 }, imp: 71, ea: 71 },
  { n: "Jared Cook", p: 'TE', t: 'GB', d: '2010s', s: { y: 40, t: 0.2, b: 70 }, imp: 73, ea: 73 },
  { n: "Mychal Rivera", p: 'TE', t: 'LV', d: '2010s', s: { y: 30, t: 0.3, b: 72 }, imp: 71, ea: 71 },
  { n: "Cameron Brate", p: 'TE', t: 'TB', d: '2010s', s: { y: 35, t: 0.5, b: 72 }, imp: 73, ea: 73 },
  { n: "O.J. Howard", p: 'TE', t: 'TB', d: '2010s', s: { y: 40, t: 0.4, b: 78 }, imp: 75, ea: 75 },
  { n: "David Njoku", p: 'TE', t: 'CLE', d: '2010s', s: { y: 30, t: 0.4, b: 72 }, imp: 71, ea: 71 },
  { n: "Jacob Tamme", p: 'TE', t: 'IND', d: '2010s', s: { y: 35, t: 0.3, b: 70 }, imp: 71, ea: 71 },
  { n: "Jacob Tamme", p: 'TE', t: 'ATL', d: '2010s', s: { y: 35, t: 0.2, b: 70 }, imp: 70, ea: 70 },
  { n: "Quincy Carter", p: 'QB', t: 'NYJ', d: '2000s', s: { y: 165, t: 0.9, i: 1.2, r: 65 , ry: 6 }, imp: 68, ea: 69 },
  { n: "Drew Henson", p: 'QB', t: 'DAL', d: '2000s', s: { y: 170, t: 0.9, i: 1, r: 70 , ry: 6 }, imp: 68, ea: 69 },
  { n: "Chad Henne", p: 'QB', t: 'MIA', d: '2000s', s: { y: 215, t: 1.2, i: 1, r: 75 , ry: 6 }, imp: 72, ea: 73 },
  { n: "Bruce Gradkowski", p: 'QB', t: 'TB', d: '2000s', s: { y: 175, t: 0.9, i: 1, r: 65 , ry: 6 }, imp: 68, ea: 69 },
  { n: "Bruce Gradkowski", p: 'QB', t: 'LV', d: '2000s', s: { y: 180, t: 1, i: 0.9, r: 73 , ry: 6 }, imp: 70, ea: 71 },
  { n: "Gus Frerotte", p: 'QB', t: 'MIN', d: '2000s', s: { y: 215, t: 1.2, i: 1.1, r: 75 , ry: 6 }, imp: 72, ea: 73 },
  { n: "Gus Frerotte", p: 'QB', t: 'LAR', d: '2000s', s: { y: 200, t: 1.1, i: 1.1, r: 73 , ry: 6 }, imp: 70, ea: 71 },
  { n: "Gus Frerotte", p: 'QB', t: 'MIA', d: '2000s', s: { y: 205, t: 1.2, i: 1, r: 76 , ry: 6 }, imp: 71, ea: 72 },
  { n: "Jim Sorgi", p: 'QB', t: 'IND', d: '2000s', s: { y: 175, t: 1, i: 0.8, r: 78 , ry: 6 }, imp: 68, ea: 69 },
  { n: "Charlie Frye", p: 'QB', t: 'LV', d: '2000s', s: { y: 165, t: 0.9, i: 1, r: 68 , ry: 6 }, imp: 68, ea: 69 },
  { n: "Shaun Hill", p: 'QB', t: 'SF', d: '2000s', s: { y: 215, t: 1.2, i: 0.7, r: 87 , ry: 6 }, imp: 73, ea: 74 },
  { n: "J.T. O'Sullivan", p: 'QB', t: 'SF', d: '2000s', s: { y: 195, t: 1, i: 1.1, r: 70 , ry: 6 }, imp: 68, ea: 69 },
  { n: "Daunte Culpepper", p: 'QB', t: 'MIA', d: '2000s', s: { y: 200, t: 1, i: 1, r: 75 , ry: 6 }, imp: 72, ea: 73 },
  { n: "Daunte Culpepper", p: 'QB', t: 'LV', d: '2000s', s: { y: 195, t: 1, i: 1, r: 73 , ry: 6 }, imp: 70, ea: 71 },
  { n: "Daunte Culpepper", p: 'QB', t: 'DET', d: '2000s', s: { y: 215, t: 1.2, i: 1, r: 78 , ry: 6 }, imp: 72, ea: 73 },
  { n: "Rex Grossman", p: 'QB', t: 'CHI', d: '2000s', s: { y: 215, t: 1.3, i: 1.2, r: 73 , ry: 6 }, imp: 73, ea: 74 },
  { n: "Luke McCown", p: 'QB', t: 'TB', d: '2000s', s: { y: 175, t: 1, i: 1, r: 70 , ry: 6 }, imp: 68, ea: 69 },
  { n: "Luke McCown", p: 'QB', t: 'CLE', d: '2000s', s: { y: 165, t: 0.9, i: 1, r: 68 , ry: 6 }, imp: 67, ea: 68 },
  { n: "Derek Anderson", p: 'QB', t: 'CLE', d: '2000s', s: { y: 230, t: 1.5, i: 1.2, r: 76 , ry: 6 }, imp: 75, ea: 76 },
  { n: "Ken Dorsey", p: 'QB', t: 'SF', d: '2000s', s: { y: 175, t: 0.9, i: 1.2, r: 64 , ry: 6 }, imp: 67, ea: 68 },
  { n: "Ryan Lindley", p: 'QB', t: 'ARI', d: '2010s', s: { y: 165, t: 0.7, i: 1.1, r: 60 , ry: 7 }, imp: 65, ea: 65 },
  { n: "John Skelton", p: 'QB', t: 'ARI', d: '2010s', s: { y: 195, t: 1, i: 1.2, r: 68 , ry: 7 }, imp: 68, ea: 68 },
  { n: "Max Hall", p: 'QB', t: 'ARI', d: '2010s', s: { y: 165, t: 0.8, i: 1.2, r: 60 , ry: 7 }, imp: 65, ea: 65 },
  { n: "Drew Stanton", p: 'QB', t: 'ARI', d: '2010s', s: { y: 195, t: 1, i: 0.9, r: 75 , ry: 7 }, imp: 70, ea: 70 },
  { n: "Drew Stanton", p: 'QB', t: 'DET', d: '2010s', s: { y: 180, t: 0.9, i: 1, r: 70 , ry: 7 }, imp: 68, ea: 68 },
  { n: "Caleb Hanie", p: 'QB', t: 'CHI', d: '2010s', s: { y: 165, t: 0.7, i: 1.2, r: 58 , ry: 7 }, imp: 65, ea: 65 },
  { n: "T.J. Yates", p: 'QB', t: 'HOU', d: '2010s', s: { y: 195, t: 1, i: 1, r: 75 , ry: 7 }, imp: 70, ea: 70 },
  { n: "Curtis Painter", p: 'QB', t: 'IND', d: '2010s', s: { y: 175, t: 0.8, i: 1.1, r: 65 , ry: 7 }, imp: 66, ea: 66 },
  { n: "Dan Orlovsky", p: 'QB', t: 'IND', d: '2010s', s: { y: 175, t: 0.9, i: 1, r: 68 , ry: 7 }, imp: 67, ea: 67 },
  { n: "Bruce Gradkowski", p: 'QB', t: 'PIT', d: '2010s', s: { y: 175, t: 0.9, i: 0.9, r: 73 , ry: 7 }, imp: 68, ea: 68 },
  { n: "Charlie Batch", p: 'QB', t: 'PIT', d: '2010s', s: { y: 180, t: 1, i: 0.8, r: 80 , ry: 7 }, imp: 70, ea: 70 },
  { n: "Byron Leftwich", p: 'QB', t: 'PIT', d: '2010s', s: { y: 195, t: 1.1, i: 0.8, r: 82 , ry: 4 }, imp: 71, ea: 71 },
  { n: "Joe Webb", p: 'QB', t: 'MIN', d: '2010s', s: { y: 175, t: 0.9, i: 0.7, r: 80 , ry: 7 }, imp: 69, ea: 69 },
  { n: "McLeod Bethel-Thompson", p: 'QB', t: 'SF', d: '2010s', s: { y: 165, t: 0.8, i: 1.1, r: 60 , ry: 7 }, imp: 65, ea: 65 },
  { n: "Kellen Moore", p: 'QB', t: 'DAL', d: '2010s', s: { y: 175, t: 0.9, i: 1, r: 72 , ry: 7 }, imp: 67, ea: 67 },
  { n: "Brock Osweiler", p: 'QB', t: 'HOU', d: '2010s', s: { y: 215, t: 1.1, i: 0.9, r: 75 , ry: 7 }, imp: 72, ea: 72 },
  { n: "Brock Osweiler", p: 'QB', t: 'MIA', d: '2010s', s: { y: 200, t: 1, i: 1, r: 73 , ry: 7 }, imp: 70, ea: 70 },
  { n: "Michael Vick", p: 'QB', t: 'NYJ', d: '2010s', s: { y: 175, t: 0.9, i: 0.8, r: 75 , ry: 12 }, imp: 70, ea: 70 },
  { n: "Michael Vick", p: 'QB', t: 'PIT', d: '2010s', s: { y: 165, t: 0.8, i: 0.9, r: 70 , ry: 5 }, imp: 68, ea: 68 },
  { n: "Olandis Gary", p: 'RB', t: 'DET', d: '2000s', s: { y: 50, c: 3.7, r: 10, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Onterrio Smith", p: 'RB', t: 'MIN', d: '2000s', s: { y: 65, c: 4.6, r: 18, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Tatum Bell", p: 'RB', t: 'DET', d: '2000s', s: { y: 55, c: 4.2, r: 12, t: 0.3 }, imp: 71, ea: 72 },
  { n: "James Stewart", p: 'RB', t: 'DET', d: '2000s', s: { y: 70, c: 3.8, r: 12, t: 0.6 }, imp: 75, ea: 76 },
  { n: "Curtis Enis", p: 'RB', t: 'CHI', d: '2000s', s: { y: 45, c: 3.4, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Dominic Rhodes", p: 'RB', t: 'IND', d: '2000s', s: { y: 50, c: 4, r: 12, t: 0.4 }, imp: 72, ea: 73 },
  { n: "James Mungro", p: 'RB', t: 'IND', d: '2000s', s: { y: 30, c: 3.7, r: 8, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Antonio Pittman", p: 'RB', t: 'LAR', d: '2000s', s: { y: 35, c: 3.7, r: 8, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Selvin Young", p: 'RB', t: 'DEN', d: '2000s', s: { y: 45, c: 4.7, r: 12, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Adimchinobe Echemandu", p: 'RB', t: 'CLE', d: '2000s', s: { y: 35, c: 3.8, r: 8, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Anthony Thomas", p: 'RB', t: 'CHI', d: '2000s', s: { y: 65, c: 3.9, r: 12, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Kenny Watson", p: 'RB', t: 'CIN', d: '2000s', s: { y: 40, c: 3.7, r: 18, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Sammy Morris", p: 'RB', t: 'NE', d: '2000s', s: { y: 45, c: 4.3, r: 12, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Laurence Maroney", p: 'RB', t: 'NE', d: '2000s', s: { y: 60, c: 3.9, r: 8, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Fred Taylor", p: 'RB', t: 'NE', d: '2000s', s: { y: 50, c: 4.4, r: 12, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Greg Jones", p: 'RB', t: 'JAX', d: '2000s', s: { y: 35, c: 3.9, r: 10, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Quentin Griffin", p: 'RB', t: 'DEN', d: '2000s', s: { y: 45, c: 4.2, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Tashard Choice", p: 'RB', t: 'DAL', d: '2000s', s: { y: 40, c: 4.3, r: 12, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Mike Bell", p: 'RB', t: 'DEN', d: '2000s', s: { y: 50, c: 3.8, r: 8, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Tim Hightower", p: 'RB', t: 'ARI', d: '2000s', s: { y: 55, c: 3.6, r: 25, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Edgerrin James", p: 'RB', t: 'ARI', d: '2000s', s: { y: 80, c: 3.8, r: 20, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Eddie Kennison", p: 'WR', t: 'NO', d: '2000s', s: { y: 50, p: 13, t: 0.3, c: 55 }, imp: 72, ea: 73 },
  { n: "Eddie Kennison", p: 'WR', t: 'DEN', d: '2000s', s: { y: 45, p: 12.5, t: 0.2, c: 55 }, imp: 70, ea: 71 },
  { n: "Terance Mathis", p: 'WR', t: 'PIT', d: '2000s', s: { y: 35, p: 11.5, t: 0.2, c: 60 }, imp: 68, ea: 69 },
  { n: "Bobby Engram", p: 'WR', t: 'KC', d: '2000s', s: { y: 35, p: 9.5, t: 0.2, c: 65 }, imp: 70, ea: 71 },
  { n: "David Givens", p: 'WR', t: 'NE', d: '2000s', s: { y: 50, p: 11.5, t: 0.3, c: 60 }, imp: 73, ea: 74 },
  { n: "David Givens", p: 'WR', t: 'TEN', d: '2000s', s: { y: 30, p: 11, t: 0.2, c: 55 }, imp: 68, ea: 69 },
  { n: "Deion Branch", p: 'WR', t: 'NE', d: '2000s', s: { y: 55, p: 12.5, t: 0.3, c: 60 }, imp: 75, ea: 76 },
  { n: "Deion Branch", p: 'WR', t: 'SEA', d: '2000s', s: { y: 50, p: 11.5, t: 0.3, c: 60 }, imp: 73, ea: 74 },
  { n: "Troy Brown", p: 'WR', t: 'NE', d: '2000s', s: { y: 50, p: 10.5, t: 0.3, c: 65 }, imp: 75, ea: 76 },
  { n: "Donald Hayes", p: 'WR', t: 'NE', d: '2000s', s: { y: 25, p: 12, t: 0.2, c: 55 }, imp: 67, ea: 68 },
  { n: "Charlie Adams", p: 'WR', t: 'DEN', d: '2000s', s: { y: 30, p: 11.5, t: 0.2, c: 55 }, imp: 67, ea: 68 },
  { n: "Brandon Lloyd", p: 'WR', t: 'SF', d: '2000s', s: { y: 45, p: 13, t: 0.3, c: 55 }, imp: 71, ea: 72 },
  { n: "Brandon Lloyd", p: 'WR', t: 'WAS', d: '2000s', s: { y: 35, p: 13, t: 0.2, c: 55 }, imp: 69, ea: 70 },
  { n: "Brandon Lloyd", p: 'WR', t: 'DEN', d: '2000s', s: { y: 75, p: 17, t: 0.5, c: 50 }, imp: 80, ea: 81 },
  { n: "D.J. Hackett", p: 'WR', t: 'SEA', d: '2000s', s: { y: 45, p: 12, t: 0.3, c: 60 }, imp: 70, ea: 71 },
  { n: "Nate Burleson", p: 'WR', t: 'SEA', d: '2000s', s: { y: 55, p: 12.5, t: 0.3, c: 55 }, imp: 73, ea: 74 },
  { n: "Nate Burleson", p: 'WR', t: 'DET', d: '2000s', s: { y: 45, p: 11.5, t: 0.3, c: 60 }, imp: 71, ea: 72 },
  { n: "Andre' Davis", p: 'WR', t: 'HOU', d: '2000s', s: { y: 50, p: 14.5, t: 0.3, c: 55 }, imp: 72, ea: 73 },
  { n: "Andre' Davis", p: 'WR', t: 'CLE', d: '2000s', s: { y: 35, p: 13.5, t: 0.2, c: 55 }, imp: 68, ea: 69 },
  { n: "Kevin Walter", p: 'WR', t: 'HOU', d: '2000s', s: { y: 55, p: 11.5, t: 0.3, c: 60 }, imp: 73, ea: 74 },
  { n: "Drew Carter", p: 'WR', t: 'CAR', d: '2000s', s: { y: 35, p: 13, t: 0.2, c: 55 }, imp: 69, ea: 70 },
  { n: "Keary Colbert", p: 'WR', t: 'CAR', d: '2000s', s: { y: 35, p: 11.5, t: 0.2, c: 55 }, imp: 68, ea: 69 },
  { n: "Reggie Williams", p: 'WR', t: 'JAX', d: '2000s', s: { y: 50, p: 11.5, t: 0.4, c: 55 }, imp: 72, ea: 73 },
  { n: "Mike Williams", p: 'WR', t: 'TB', d: '2000s', s: { y: 50, p: 14, t: 0.3, c: 55 }, imp: 72, ea: 73 },
  { n: "Anthony Armstrong", p: 'WR', t: 'WAS', d: '2000s', s: { y: 35, p: 16, t: 0.2, c: 50 }, imp: 68, ea: 69 },
  { n: "Jacoby Jones", p: 'WR', t: 'HOU', d: '2000s', s: { y: 40, p: 13, t: 0.3, c: 55 }, imp: 70, ea: 71 },
  { n: "Mark Bradley", p: 'WR', t: 'CHI', d: '2000s', s: { y: 35, p: 12, t: 0.2, c: 55 }, imp: 68, ea: 69 },
  { n: "Devin Aromashodu", p: 'WR', t: 'CHI', d: '2000s', s: { y: 35, p: 14, t: 0.2, c: 55 }, imp: 68, ea: 69 },
  { n: "Hank Baskett", p: 'WR', t: 'PHI', d: '2000s', s: { y: 35, p: 13, t: 0.2, c: 55 }, imp: 68, ea: 69 },
  { n: "Cordarrelle Patterson", p: 'WR', t: 'MIN', d: '2010s', s: { y: 35, p: 11, t: 0.3, c: 60 }, imp: 71, ea: 71 },
  { n: "Cordarrelle Patterson", p: 'WR', t: 'NE', d: '2010s', s: { y: 25, p: 11, t: 0.2, c: 60 }, imp: 68, ea: 68 },
  { n: "Cordarrelle Patterson", p: 'WR', t: 'CHI', d: '2010s', s: { y: 30, p: 11, t: 0.2, c: 60 }, imp: 69, ea: 69 },
  { n: "Tre McBride", p: 'WR', t: 'TEN', d: '2010s', s: { y: 30, p: 11.5, t: 0.2, c: 55 }, imp: 67, ea: 67 },
  { n: "Justin Hardy", p: 'WR', t: 'ATL', d: '2010s', s: { y: 25, p: 9.5, t: 0.2, c: 65 }, imp: 67, ea: 67 },
  { n: "Taylor Gabriel", p: 'WR', t: 'CLE', d: '2010s', s: { y: 45, p: 13, t: 0.3, c: 60 }, imp: 71, ea: 71 },
  { n: "Taylor Gabriel", p: 'WR', t: 'ATL', d: '2010s', s: { y: 50, p: 13, t: 0.4, c: 60 }, imp: 73, ea: 73 },
  { n: "Robert Foster", p: 'WR', t: 'BUF', d: '2010s', s: { y: 35, p: 17.5, t: 0.2, c: 50 }, imp: 70, ea: 70 },
  { n: "Andrew Hawkins", p: 'WR', t: 'CIN', d: '2010s', s: { y: 35, p: 10.5, t: 0.2, c: 65 }, imp: 70, ea: 70 },
  { n: "Robert Meachem", p: 'WR', t: 'LAC', d: '2010s', s: { y: 35, p: 16, t: 0.2, c: 50 }, imp: 69, ea: 69 },
  { n: "Lance Moore", p: 'WR', t: 'PIT', d: '2010s', s: { y: 30, p: 10.5, t: 0.2, c: 60 }, imp: 68, ea: 68 },
  { n: "Davone Bess", p: 'WR', t: 'MIA', d: '2010s', s: { y: 50, p: 10, t: 0.2, c: 70 }, imp: 71, ea: 71 },
  { n: "Davone Bess", p: 'WR', t: 'CLE', d: '2010s', s: { y: 35, p: 9.5, t: 0.2, c: 65 }, imp: 68, ea: 68 },
  { n: "Riley Cooper", p: 'WR', t: 'PHI', d: '2010s', s: { y: 40, p: 13, t: 0.3, c: 55 }, imp: 71, ea: 71 },
  { n: "Jeff Cumberland", p: 'TE', t: 'NYJ', d: '2010s', s: { y: 30, t: 0.3, b: 72 }, imp: 70, ea: 70 },
  { n: "Ben Tate", p: 'RB', t: 'HOU', d: '2010s', s: { y: 70, c: 4.3, r: 12, t: 0.3 }, imp: 75, ea: 76 },
  { n: "Ben Tate", p: 'RB', t: 'CLE', d: '2010s', s: { y: 45, c: 3, r: 12, t: 0.2 }, imp: 69, ea: 70 },
  { n: "Bryce Brown", p: 'RB', t: 'PHI', d: '2010s', s: { y: 50, c: 4.5, r: 12, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Jonathan Stewart", p: 'RB', t: 'CAR', d: '2010s', s: { y: 65, c: 4, r: 15, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Mike Tolbert", p: 'RB', t: 'LAC', d: '2010s', s: { y: 35, c: 3.8, r: 25, t: 0.5 }, imp: 72, ea: 73 },
  { n: "Mike Tolbert", p: 'RB', t: 'CAR', d: '2010s', s: { y: 30, c: 3.7, r: 18, t: 0.5 }, imp: 71, ea: 72 },
  { n: "Ronnie Hillman", p: 'RB', t: 'DEN', d: '2010s', s: { y: 50, c: 4.1, r: 15, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Joique Bell", p: 'RB', t: 'DET', d: '2010s', s: { y: 55, c: 4, r: 35, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Theo Riddick", p: 'RB', t: 'DET', d: '2010s', s: { y: 25, c: 3.5, r: 45, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Latavius Murray", p: 'RB', t: 'MIN', d: '2010s', s: { y: 50, c: 3.9, r: 12, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Jerick McKinnon", p: 'RB', t: 'MIN', d: '2010s', s: { y: 45, c: 4, r: 30, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Knile Davis", p: 'RB', t: 'KC', d: '2010s', s: { y: 35, c: 3.5, r: 12, t: 0.3 }, imp: 69, ea: 70 },
  { n: "Charcandrick West", p: 'RB', t: 'KC', d: '2010s', s: { y: 40, c: 3.8, r: 18, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Dion Lewis", p: 'RB', t: 'NE', d: '2010s', s: { y: 50, c: 4.5, r: 30, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Dion Lewis", p: 'RB', t: 'TEN', d: '2010s', s: { y: 35, c: 3.5, r: 25, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Rex Burkhead", p: 'RB', t: 'NE', d: '2010s', s: { y: 30, c: 4.2, r: 20, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Robert Turbin", p: 'RB', t: 'SEA', d: '2010s', s: { y: 30, c: 4.5, r: 15, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Robert Turbin", p: 'RB', t: 'IND', d: '2010s', s: { y: 25, c: 3.5, r: 12, t: 0.4 }, imp: 70, ea: 71 },
  { n: "Mike James", p: 'RB', t: 'TB', d: '2010s', s: { y: 45, c: 4.2, r: 10, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Charles Sims", p: 'RB', t: 'TB', d: '2010s', s: { y: 35, c: 3.6, r: 30, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Toby Gerhart", p: 'RB', t: 'MIN', d: '2010s', s: { y: 35, c: 4.4, r: 15, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Toby Gerhart", p: 'RB', t: 'JAX', d: '2010s', s: { y: 30, c: 3, r: 10, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Chris Polk", p: 'RB', t: 'PHI', d: '2010s', s: { y: 25, c: 3.5, r: 8, t: 0.2 }, imp: 67, ea: 68 },
  { n: "Kenjon Barner", p: 'RB', t: 'PHI', d: '2010s', s: { y: 25, c: 3.8, r: 8, t: 0.2 }, imp: 67, ea: 68 },
  { n: "Andre Williams", p: 'RB', t: 'NYG', d: '2010s', s: { y: 35, c: 3.3, r: 8, t: 0.3 }, imp: 69, ea: 70 },
  { n: "David Wilson", p: 'RB', t: 'NYG', d: '2010s', s: { y: 30, c: 4.5, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Mikel Leshoure", p: 'RB', t: 'DET', d: '2010s', s: { y: 40, c: 3.7, r: 8, t: 0.4 }, imp: 70, ea: 71 },
  { n: "Daniel Thomas", p: 'RB', t: 'MIA', d: '2010s', s: { y: 35, c: 3.6, r: 10, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Lance Dunbar", p: 'RB', t: 'DAL', d: '2010s', s: { y: 20, c: 4.1, r: 30, t: 0.2 }, imp: 70, ea: 71 },
  { n: "Joseph Randle", p: 'RB', t: 'DAL', d: '2010s', s: { y: 35, c: 4, r: 8, t: 0.3 }, imp: 69, ea: 70 },
  { n: "Anthony Sherman", p: 'RB', t: 'KC', d: '2010s', s: { y: 10, c: 3.5, r: 8, t: 0.1 }, imp: 68, ea: 69 },
  { n: "Patrick DiMarco", p: 'RB', t: 'ATL', d: '2010s', s: { y: 10, c: 3.5, r: 12, t: 0.1 }, imp: 68, ea: 69 },
  { n: "Cole Beasley", p: 'WR', t: 'BUF', d: '2010s', s: { y: 55, p: 9.5, t: 0.3, c: 70 }, imp: 75, ea: 75 },
  { n: "John Brown", p: 'WR', t: 'BAL', d: '2010s', s: { y: 50, p: 14, t: 0.3, c: 55 }, imp: 73, ea: 73 },
  { n: "Quincy Enunwa", p: 'WR', t: 'NYJ', d: '2010s', s: { y: 45, p: 11.5, t: 0.3, c: 65 }, imp: 72, ea: 72 },
  { n: "Daryle Lamonica", p: 'QB', t: 'LV', d: '1970s', s: { y: 165, t: 1.3, i: 1.2, r: 70 , ry: 8 }, imp: 75, ea: 79 },
  { n: "John Hadl", p: 'QB', t: 'LAR', d: '1970s', s: { y: 170, t: 1.1, i: 1.3, r: 68 , ry: 8 }, imp: 73, ea: 77 },
  { n: "Charley Johnson", p: 'QB', t: 'DEN', d: '1970s', s: { y: 160, t: 1, i: 1.2, r: 69 , ry: 8 }, imp: 71, ea: 75 },
  { n: "Billy Kilmer", p: 'QB', t: 'WAS', d: '1970s', s: { y: 150, t: 1.1, i: 1.2, r: 70 , ry: 8 }, imp: 73, ea: 77 },
  { n: "Norm Snead", p: 'QB', t: 'NYG', d: '1970s', s: { y: 160, t: 1, i: 1.3, r: 68 , ry: 8 }, imp: 70, ea: 74 },
  { n: "Mercury Morris", p: 'RB', t: 'MIA', d: '1970s', s: { y: 60, c: 5.1, r: 8, t: 0.5 }, imp: 76, ea: 76 },
  { n: "Otis Armstrong", p: 'RB', t: 'DEN', d: '1970s', s: { y: 70, c: 4.5, r: 18, t: 0.4 }, imp: 77, ea: 77 },
  { n: "Rocky Bleier", p: 'RB', t: 'PIT', d: '1970s', s: { y: 55, c: 4.2, r: 12, t: 0.3 }, imp: 74, ea: 74 },
  { n: "Don Woods", p: 'RB', t: 'LAC', d: '1970s', s: { y: 60, c: 4.3, r: 15, t: 0.4 }, imp: 73, ea: 73 },
  { n: "Fred Biletnikoff", p: 'WR', t: 'LV', d: '1970s', s: { y: 55, p: 14.5, t: 0.5, c: 55 }, imp: 81, ea: 85 },
  { n: "Nat Moore", p: 'WR', t: 'MIA', d: '1970s', s: { y: 50, p: 15, t: 0.5, c: 52 }, imp: 76, ea: 80 },
  { n: "Vince Ferragamo", p: 'QB', t: 'LAR', d: '1980s', s: { y: 185, t: 1.2, i: 1.3, r: 73 , ry: 7 }, imp: 73, ea: 76 },
  { n: "Rueben Mayes", p: 'RB', t: 'NO', d: '1980s', s: { y: 70, c: 4, r: 15, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Elvis Grbac", p: 'QB', t: 'KC', d: '1990s', s: { y: 210, t: 1.3, i: 1.1, r: 80 , ry: 6 }, imp: 75, ea: 77 },
  { n: "Dave Brown", p: 'QB', t: 'NYG', d: '1990s', s: { y: 185, t: 0.9, i: 1.1, r: 72 , ry: 6 }, imp: 70, ea: 72 },
  { n: "Terry Allen", p: 'RB', t: 'WAS', d: '1990s', s: { y: 85, c: 3.9, r: 18, t: 0.7 }, imp: 80, ea: 81 },
  { n: "Leroy Hoard", p: 'RB', t: 'CLE', d: '1990s', s: { y: 60, c: 3.8, r: 30, t: 0.5 }, imp: 74, ea: 75 },
  { n: "Anthony Miller", p: 'WR', t: 'LAC', d: '1990s', s: { y: 70, p: 15.5, t: 0.5, c: 55 }, imp: 80, ea: 82 },
  { n: "Willie Davis", p: 'WR', t: 'KC', d: '1990s', s: { y: 60, p: 16, t: 0.5, c: 52 }, imp: 76, ea: 78 },
  { n: "Jon Kitna", p: 'QB', t: 'DET', d: '2000s', s: { y: 235, t: 1.3, i: 1.2, r: 78 , ry: 6 }, imp: 74, ea: 75 },
  { n: "Josh McCown", p: 'QB', t: 'ARI', d: '2000s', s: { y: 200, t: 1.1, i: 1.1, r: 76 , ry: 6 }, imp: 71, ea: 72 },
  { n: "Donald Driver", p: 'WR', t: 'GB', d: '2010s', s: { y: 55, p: 12.5, t: 0.3, c: 60 }, imp: 74, ea: 74 },
  { n: "Jarvis Landry", p: 'WR', t: 'MIA', d: '2010s', s: { y: 80, p: 10.5, t: 0.4, c: 68 }, imp: 81, ea: 81 },
  { n: "Jack Doyle", p: 'TE', t: 'IND', d: '2010s', s: { y: 45, t: 0.4, b: 78 }, imp: 74, ea: 74 },
  { n: "Gary Cuozzo", p: 'QB', t: 'MIN', d: '1970s', s: { y: 145, t: 0.9, i: 1.2, r: 66 , ry: 8 }, imp: 68, ea: 72 },
  { n: "Bobby Douglass", p: 'QB', t: 'CHI', d: '1970s', s: { y: 130, t: 0.8, i: 1.4, r: 58 , ry: 48 }, imp: 67, ea: 71 },
  { n: "Mike Livingston", p: 'QB', t: 'KC', d: '1970s', s: { y: 150, t: 0.9, i: 1.2, r: 67 , ry: 8 }, imp: 69, ea: 73 },
  { n: "Bill Munson", p: 'QB', t: 'DET', d: '1970s', s: { y: 150, t: 1, i: 1.2, r: 69 , ry: 8 }, imp: 69, ea: 73 },
  { n: "Marty Domres", p: 'QB', t: 'IND', d: '1970s', s: { y: 140, t: 0.8, i: 1.3, r: 63 , ry: 8 }, imp: 67, ea: 71 },
  { n: "Don Strock", p: 'QB', t: 'MIA', d: '1970s', s: { y: 155, t: 1, i: 1.1, r: 71 , ry: 8 }, imp: 70, ea: 74 },
  { n: "Gary Huff", p: 'QB', t: 'CHI', d: '1970s', s: { y: 140, t: 0.8, i: 1.4, r: 60 , ry: 8 }, imp: 66, ea: 70 },
  { n: "John Reaves", p: 'QB', t: 'PHI', d: '1970s', s: { y: 145, t: 0.9, i: 1.4, r: 62 , ry: 8 }, imp: 66, ea: 70 },
  { n: "Scott Hunter", p: 'QB', t: 'GB', d: '1970s', s: { y: 135, t: 0.8, i: 1.3, r: 62 , ry: 8 }, imp: 66, ea: 70 },
  { n: "Joe Reed", p: 'QB', t: 'SF', d: '1970s', s: { y: 140, t: 0.9, i: 1.3, r: 64 , ry: 8 }, imp: 67, ea: 71 },
  { n: "MacArthur Lane", p: 'RB', t: 'GB', d: '1970s', s: { y: 55, c: 3.9, r: 35, t: 0.4 }, imp: 73, ea: 73 },
  { n: "Norm Bulaich", p: 'RB', t: 'PHI', d: '1970s', s: { y: 55, c: 3.8, r: 12, t: 0.4 }, imp: 72, ea: 72 },
  { n: "Essex Johnson", p: 'RB', t: 'CIN', d: '1970s', s: { y: 60, c: 4.3, r: 18, t: 0.4 }, imp: 73, ea: 73 },
  { n: "Jim Otis", p: 'RB', t: 'ARI', d: '1970s', s: { y: 70, c: 3.8, r: 8, t: 0.5 }, imp: 75, ea: 75 },
  { n: "Cullen Bryant", p: 'RB', t: 'LAR', d: '1970s', s: { y: 55, c: 3.9, r: 18, t: 0.4 }, imp: 73, ea: 73 },
  { n: "Dexter Bussey", p: 'RB', t: 'DET', d: '1970s', s: { y: 60, c: 4, r: 15, t: 0.3 }, imp: 73, ea: 73 },
  { n: "Horace King", p: 'RB', t: 'DET', d: '1970s', s: { y: 45, c: 3.8, r: 25, t: 0.3 }, imp: 71, ea: 71 },
  { n: "Golden Richards", p: 'WR', t: 'DAL', d: '1970s', s: { y: 45, p: 16, t: 0.4, c: 48 }, imp: 73, ea: 77 },
  { n: "Frank Lewis", p: 'WR', t: 'PIT', d: '1970s', s: { y: 50, p: 17, t: 0.4, c: 48 }, imp: 74, ea: 78 },
  { n: "Reggie Rucker", p: 'WR', t: 'CLE', d: '1970s', s: { y: 55, p: 14.5, t: 0.4, c: 53 }, imp: 74, ea: 78 },
  { n: "Ron Shanklin", p: 'WR', t: 'PIT', d: '1970s', s: { y: 50, p: 17.5, t: 0.4, c: 46 }, imp: 73, ea: 77 },
  { n: "Billy Brooks", p: 'WR', t: 'CIN', d: '1970s', s: { y: 45, p: 16, t: 0.4, c: 48 }, imp: 71, ea: 75 },
  { n: "Jim Mandich", p: 'TE', t: 'MIA', d: '1970s', s: { y: 35, t: 0.4, b: 80 }, imp: 73, ea: 77 },
  { n: "Charle Young", p: 'TE', t: 'PHI', d: '1970s', s: { y: 45, t: 0.4, b: 78 }, imp: 77, ea: 81 },
  { n: "Bob Klein", p: 'TE', t: 'LAR', d: '1970s', s: { y: 30, t: 0.3, b: 80 }, imp: 72, ea: 76 },
  { n: "Greg Latta", p: 'TE', t: 'CHI', d: '1970s', s: { y: 30, t: 0.3, b: 76 }, imp: 70, ea: 74 },
  { n: "Steve Bono", p: 'QB', t: 'SF', d: '1980s', s: { y: 175, t: 1.1, i: 1, r: 78 , ry: 7 }, imp: 71, ea: 74 },
  { n: "Matt Cavanaugh", p: 'QB', t: 'SF', d: '1980s', s: { y: 160, t: 1, i: 1.1, r: 73 , ry: 7 }, imp: 69, ea: 72 },
  { n: "Alvin Garrett", p: 'WR', t: 'WAS', d: '1980s', s: { y: 45, p: 13.5, t: 0.3, c: 54 }, imp: 71, ea: 74 },
  { n: "Bobby Duckworth", p: 'WR', t: 'LAC', d: '1980s', s: { y: 45, p: 18.5, t: 0.3, c: 44 }, imp: 71, ea: 74 },
  { n: "Clarence Weathers", p: 'WR', t: 'CLE', d: '1980s', s: { y: 40, p: 17, t: 0.3, c: 46 }, imp: 70, ea: 73 },
  { n: "Byron Williams", p: 'WR', t: 'NYG', d: '1980s', s: { y: 40, p: 15, t: 0.3, c: 50 }, imp: 70, ea: 73 },
  { n: "Clint Didier", p: 'TE', t: 'WAS', d: '1980s', s: { y: 35, t: 0.4, b: 80 }, imp: 74, ea: 77 },
  { n: "Zeke Mowatt", p: 'TE', t: 'NYG', d: '1980s', s: { y: 35, t: 0.3, b: 80 }, imp: 73, ea: 76 },
  { n: "Jimmie Giles", p: 'TE', t: 'TB', d: '1980s', s: { y: 45, t: 0.5, b: 80 }, imp: 78, ea: 81 },
  { n: "Billy Joe Tolliver", p: 'QB', t: 'LAC', d: '1990s', s: { y: 185, t: 1.1, i: 1.3, r: 70 , ry: 6 }, imp: 69, ea: 71 },
  { n: "Raymont Harris", p: 'RB', t: 'CHI', d: '1990s', s: { y: 65, c: 3.9, r: 15, t: 0.5 }, imp: 74, ea: 75 },
  { n: "Lamar Smith", p: 'RB', t: 'SEA', d: '1990s', s: { y: 60, c: 3.9, r: 18, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Aaron Craver", p: 'RB', t: 'DEN', d: '1990s', s: { y: 45, c: 3.9, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Aubrey Matthews", p: 'WR', t: 'DET', d: '1990s', s: { y: 40, p: 13.5, t: 0.3, c: 54 }, imp: 70, ea: 72 },
  { n: "Johnny Mitchell", p: 'TE', t: 'NYJ', d: '1990s', s: { y: 40, t: 0.4, b: 74 }, imp: 73, ea: 75 },
  { n: "Jackie Harris", p: 'TE', t: 'TB', d: '1990s', s: { y: 45, t: 0.3, b: 76 }, imp: 74, ea: 76 },
  { n: "Desmond Clark", p: 'TE', t: 'CHI', d: '2000s', s: { y: 45, t: 0.4, b: 78 }, imp: 75, ea: 76 },
  { n: "Bo Scaife", p: 'TE', t: 'TEN', d: '2010s', s: { y: 40, t: 0.3, b: 74 }, imp: 72, ea: 72 },
  { n: "Ryan Fitzpatrick", p: 'QB', t: 'NYJ', d: '2010s', s: { y: 240, t: 1.6, i: 1.3, r: 82 , ry: 12 }, imp: 77, ea: 77 },
  { n: "Chase Daniel", p: 'QB', t: 'CHI', d: '2010s', s: { y: 200, t: 1.1, i: 1, r: 82 , ry: 7 }, imp: 70, ea: 70 },
  { n: "Mike Gillislee", p: 'RB', t: 'BUF', d: '2010s', s: { y: 55, c: 5, r: 8, t: 0.5 }, imp: 74, ea: 75 },
  { n: "Marlon Mack", p: 'RB', t: 'IND', d: '2010s', s: { y: 75, c: 4.5, r: 15, t: 0.5 }, imp: 77, ea: 78 },
  { n: "Tyrell Williams", p: 'WR', t: 'LAC', d: '2010s', s: { y: 60, p: 16.5, t: 0.5, c: 54 }, imp: 76, ea: 76 },
  { n: "Kenny Golladay", p: 'WR', t: 'DET', d: '2010s', s: { y: 75, p: 16, t: 0.6, c: 56 }, imp: 80, ea: 80 },
  { n: "Austin Hooper", p: 'TE', t: 'ATL', d: '2010s', s: { y: 55, t: 0.4, b: 74 }, imp: 78, ea: 78 },
  { n: "Gardner Minshew", p: 'QB', t: 'JAX', d: '2020s', s: { y: 235, t: 1.4, i: 0.8, r: 90 , ry: 10 }, imp: 75, ea: 74 },
  { n: "Jacoby Brissett", p: 'QB', t: 'CLE', d: '2020s', s: { y: 225, t: 1.2, i: 0.7, r: 88 , ry: 12 }, imp: 74, ea: 73 },
  { n: "Tyrod Taylor", p: 'QB', t: 'NYG', d: '2020s', s: { y: 200, t: 1.1, i: 0.6, r: 88 , ry: 9 }, imp: 72, ea: 71 },
  { n: "Jimmy Garoppolo", p: 'QB', t: 'SF', d: '2020s', s: { y: 240, t: 1.5, i: 0.9, r: 96 , ry: 3 }, imp: 80, ea: 79 },
  { n: "Derek Carr", p: 'QB', t: 'NO', d: '2020s', s: { y: 245, t: 1.5, i: 0.7, r: 92 , ry: 4 }, imp: 80, ea: 79 },
  { n: "Zach Wilson", p: 'QB', t: 'NYJ', d: '2020s', s: { y: 195, t: 0.9, i: 1, r: 74 , ry: 9 }, imp: 70, ea: 69 },
  { n: "Desmond Ridder", p: 'QB', t: 'ATL', d: '2020s', s: { y: 210, t: 1, i: 0.9, r: 82 , ry: 9 }, imp: 71, ea: 70 },
  { n: "Bill Munson", p: 'QB', t: 'LAC', d: '1970s', s: { y: 145, t: 0.9, i: 1.2, r: 68 , ry: 8 }, imp: 68, ea: 72 },
  { n: "Joe Namath", p: 'QB', t: 'NYJ', d: '1970s', s: { y: 175, t: 1.1, i: 1.5, r: 65 , ry: 8 }, imp: 78, ea: 82 },
  { n: "Bob Lee", p: 'QB', t: 'ATL', d: '1970s', s: { y: 135, t: 0.8, i: 1.2, r: 64 , ry: 8 }, imp: 66, ea: 70 },
  { n: "James Scott", p: 'WR', t: 'CHI', d: '1970s', s: { y: 45, p: 17, t: 0.3, c: 46 }, imp: 71, ea: 75 },
  { n: "Larry Seiple", p: 'WR', t: 'MIA', d: '1970s', s: { y: 35, p: 13, t: 0.2, c: 52 }, imp: 69, ea: 73 },
  { n: "Bob Chandler", p: 'WR', t: 'BUF', d: '1970s', s: { y: 55, p: 14.5, t: 0.4, c: 54 }, imp: 75, ea: 79 },
  { n: "Ron Jessie", p: 'WR', t: 'LAR', d: '1970s', s: { y: 50, p: 16, t: 0.4, c: 50 }, imp: 74, ea: 78 },
  { n: "Vern Den Herder", p: 'TE', t: 'MIA', d: '1970s', s: { y: 25, t: 0.2, b: 80 }, imp: 70, ea: 74 },
  { n: "Bob Moore", p: 'TE', t: 'LV', d: '1970s', s: { y: 28, t: 0.3, b: 80 }, imp: 71, ea: 75 },
  { n: "Don McCauley", p: 'RB', t: 'IND', d: '1970s', s: { y: 50, c: 3.8, r: 25, t: 0.4 }, imp: 72, ea: 72 },
  { n: "Roosevelt Leaks", p: 'RB', t: 'BUF', d: '1970s', s: { y: 45, c: 3.7, r: 8, t: 0.3 }, imp: 70, ea: 70 },
  { n: "Tom Sullivan", p: 'RB', t: 'PHI', d: '1970s', s: { y: 50, c: 3.9, r: 20, t: 0.3 }, imp: 71, ea: 71 },
  { n: "Boobie Clark", p: 'RB', t: 'CIN', d: '1970s', s: { y: 55, c: 3.7, r: 18, t: 0.4 }, imp: 72, ea: 72 },
  { n: "Andy Russell", p: 'RB', t: 'PIT', d: '1970s', s: { y: 30, c: 3.6, r: 8, t: 0.2 }, imp: 68, ea: 68 },
  { n: "Gary Anderson", p: 'RB', t: 'LAC', d: '1980s', s: { y: 60, c: 4.2, r: 35, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Buford McGee", p: 'RB', t: 'LAC', d: '1980s', s: { y: 40, c: 3.9, r: 15, t: 0.4 }, imp: 70, ea: 71 },
  { n: "Alonzo Highsmith", p: 'RB', t: 'TEN', d: '1980s', s: { y: 50, c: 3.7, r: 18, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Ron Davenport", p: 'RB', t: 'MIA', d: '1980s', s: { y: 45, c: 3.8, r: 12, t: 0.5 }, imp: 71, ea: 72 },
  { n: "Vyto Kab", p: 'TE', t: 'PHI', d: '1980s', s: { y: 25, t: 0.3, b: 78 }, imp: 69, ea: 72 },
  { n: "Stacey Bailey", p: 'WR', t: 'ATL', d: '1980s', s: { y: 50, p: 15, t: 0.4, c: 52 }, imp: 73, ea: 76 },
  { n: "Don Majkowski", p: 'QB', t: 'GB', d: '1990s', s: { y: 185, t: 1.1, i: 1.1, r: 76 , ry: 6 }, imp: 72, ea: 74 },
  { n: "Derrick Fenner", p: 'RB', t: 'CIN', d: '1990s', s: { y: 55, c: 3.7, r: 12, t: 0.5 }, imp: 72, ea: 73 },
  { n: "Johnny Johnson", p: 'RB', t: 'NYJ', d: '1990s', s: { y: 65, c: 3.8, r: 25, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Edgar Bennett", p: 'RB', t: 'GB', d: '1990s', s: { y: 65, c: 3.6, r: 30, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Ronald Moore", p: 'RB', t: 'ARI', d: '1990s', s: { y: 55, c: 3.5, r: 10, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Aaron Hayden", p: 'RB', t: 'LAC', d: '1990s', s: { y: 50, c: 3.7, r: 12, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Michael Timpson", p: 'WR', t: 'NE', d: '1990s', s: { y: 55, p: 13, t: 0.3, c: 55 }, imp: 73, ea: 75 },
  { n: "Alvin Harper", p: 'WR', t: 'DAL', d: '1990s', s: { y: 55, p: 19, t: 0.4, c: 48 }, imp: 76, ea: 78 },
  { n: "Mike Pritchard", p: 'WR', t: 'ATL', d: '1990s', s: { y: 60, p: 12.5, t: 0.4, c: 58 }, imp: 75, ea: 77 },
  { n: "Troy Drayton", p: 'TE', t: 'LAR', d: '1990s', s: { y: 40, t: 0.4, b: 74 }, imp: 73, ea: 75 },
  { n: "Billy Volek", p: 'QB', t: 'TEN', d: '2000s', s: { y: 215, t: 1.4, i: 1.1, r: 82 , ry: 6 }, imp: 72, ea: 73 },
  { n: "Musa Smith", p: 'RB', t: 'BAL', d: '2000s', s: { y: 45, c: 3.9, r: 10, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Michael Pittman", p: 'RB', t: 'TB', d: '2000s', s: { y: 60, c: 4, r: 35, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Correll Buckhalter", p: 'RB', t: 'PHI', d: '2000s', s: { y: 50, c: 4.3, r: 18, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Ryan Grant", p: 'RB', t: 'GB', d: '2000s', s: { y: 75, c: 4.2, r: 18, t: 0.6 }, imp: 78, ea: 79 },
  { n: "Bryant Johnson", p: 'WR', t: 'ARI', d: '2000s', s: { y: 50, p: 12.5, t: 0.3, c: 58 }, imp: 73, ea: 74 },
  { n: "Michael Jenkins", p: 'WR', t: 'ATL', d: '2000s', s: { y: 55, p: 13.5, t: 0.4, c: 56 }, imp: 74, ea: 75 },
  { n: "Justin McCareins", p: 'WR', t: 'NYJ', d: '2000s', s: { y: 55, p: 14.5, t: 0.4, c: 52 }, imp: 73, ea: 74 },
  { n: "David Patten", p: 'WR', t: 'NE', d: '2000s', s: { y: 55, p: 14.5, t: 0.4, c: 54 }, imp: 74, ea: 75 },
  { n: "Az-Zahir Hakim", p: 'WR', t: 'LAR', d: '2000s', s: { y: 50, p: 13, t: 0.4, c: 56 }, imp: 73, ea: 74 },
  { n: "Reche Caldwell", p: 'WR', t: 'LAC', d: '2000s', s: { y: 45, p: 13, t: 0.3, c: 55 }, imp: 71, ea: 72 },
  { n: "Matt Moore", p: 'QB', t: 'MIA', d: '2010s', s: { y: 210, t: 1.3, i: 1, r: 84 , ry: 7 }, imp: 71, ea: 71 },
  { n: "Blaine Gabbert", p: 'QB', t: 'JAX', d: '2010s', s: { y: 190, t: 0.9, i: 1.1, r: 72 , ry: 7 }, imp: 68, ea: 68 },
  { n: "Benny Cunningham", p: 'RB', t: 'LAR', d: '2010s', s: { y: 40, c: 4.2, r: 25, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Darren Sproles", p: 'RB', t: 'PHI', d: '2010s', s: { y: 40, c: 4.3, r: 40, t: 0.4 }, imp: 78, ea: 79 },
  { n: "Marquess Wilson", p: 'WR', t: 'CHI', d: '2010s', s: { y: 40, p: 14, t: 0.2, c: 54 }, imp: 70, ea: 70 },
  { n: "Kamar Aiken", p: 'WR', t: 'BAL', d: '2010s', s: { y: 55, p: 12.5, t: 0.4, c: 56 }, imp: 73, ea: 73 },
  { n: "Seth Roberts", p: 'WR', t: 'LV', d: '2010s', s: { y: 45, p: 12, t: 0.4, c: 58 }, imp: 71, ea: 71 },
  { n: "Chris Conley", p: 'WR', t: 'KC', d: '2010s', s: { y: 45, p: 14, t: 0.3, c: 54 }, imp: 72, ea: 72 },
  { n: "Dwayne Allen", p: 'TE', t: 'IND', d: '2010s', s: { y: 40, t: 0.5, b: 80 }, imp: 75, ea: 75 },
  { n: "Ladarius Green", p: 'TE', t: 'LAC', d: '2010s', s: { y: 45, t: 0.4, b: 72 }, imp: 74, ea: 74 },
  { n: "Joshua Dobbs", p: 'QB', t: 'ARI', d: '2020s', s: { y: 200, t: 1, i: 0.8, r: 84 , ry: 9 }, imp: 71, ea: 70 },
  { n: "Andy Dalton", p: 'QB', t: 'CAR', d: '2020s', s: { y: 225, t: 1.3, i: 0.9, r: 88 , ry: 6 }, imp: 75, ea: 74 },
  { n: "Zach Charbonnet", p: 'RB', t: 'SEA', d: '2020s', s: { y: 55, c: 4.4, r: 25, t: 0.4 }, imp: 75, ea: 77 },
  { n: "Zack Moss", p: 'RB', t: 'CIN', d: '2020s', s: { y: 60, c: 4.2, r: 18, t: 0.5 }, imp: 75, ea: 77 },
  { n: "Tyler Allgeier", p: 'RB', t: 'ATL', d: '2020s', s: { y: 65, c: 4.6, r: 12, t: 0.4 }, imp: 76, ea: 78 },
  { n: "Jayden Reed", p: 'WR', t: 'GB', d: '2020s', s: { y: 55, p: 13.5, t: 0.4, c: 62 }, imp: 76, ea: 75 },
  { n: "Dontayvion Wicks", p: 'WR', t: 'GB', d: '2020s', s: { y: 45, p: 13, t: 0.3, c: 56 }, imp: 72, ea: 71 },
  { n: "Dalton Kincaid", p: 'TE', t: 'BUF', d: '2020s', s: { y: 50, t: 0.4, b: 72 }, imp: 78, ea: 77 },
  { n: "Charlie Smith", p: 'RB', t: 'LV', d: '1970s', s: { y: 50, c: 4, r: 18, t: 0.4 }, imp: 71, ea: 71 },
  { n: "Hubert Ginn", p: 'RB', t: 'MIA', d: '1970s', s: { y: 35, c: 3.8, r: 8, t: 0.2 }, imp: 68, ea: 68 },
  { n: "Clarence Davis", p: 'RB', t: 'LV', d: '1970s', s: { y: 45, c: 4, r: 12, t: 0.3 }, imp: 70, ea: 70 },
  { n: "Benny Malone", p: 'RB', t: 'MIA', d: '1970s', s: { y: 50, c: 4, r: 12, t: 0.4 }, imp: 71, ea: 71 },
  { n: "Wally Chambers", p: 'RB', t: 'CHI', d: '1970s', s: { y: 30, c: 3.6, r: 8, t: 0.2 }, imp: 67, ea: 67 },
  { n: "Wallace Francis", p: 'WR', t: 'ATL', d: '1970s', s: { y: 50, p: 16, t: 0.4, c: 50 }, imp: 74, ea: 78 },
  { n: "Freddie Solomon", p: 'WR', t: 'MIA', d: '1970s', s: { y: 45, p: 16.5, t: 0.4, c: 48 }, imp: 73, ea: 77 },
  { n: "Bob Tucker", p: 'TE', t: 'MIN', d: '1970s', s: { y: 30, t: 0.3, b: 78 }, imp: 72, ea: 76 },
  { n: "Bobby Duckworth", p: 'WR', t: 'LAR', d: '1980s', s: { y: 40, p: 18, t: 0.3, c: 44 }, imp: 70, ea: 73 },
  { n: "Ted Brown", p: 'RB', t: 'MIN', d: '1980s', s: { y: 60, c: 3.9, r: 30, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Booker Russell", p: 'RB', t: 'LAC', d: '1980s', s: { y: 35, c: 3.7, r: 8, t: 0.4 }, imp: 69, ea: 70 },
  { n: "Junior Miller", p: 'TE', t: 'ATL', d: '1980s', s: { y: 35, t: 0.4, b: 78 }, imp: 72, ea: 75 },
  { n: "Mark Jackson", p: 'WR', t: 'DEN', d: '1990s', s: { y: 55, p: 15, t: 0.4, c: 52 }, imp: 74, ea: 76 },
  { n: "Vance Johnson", p: 'WR', t: 'DEN', d: '1990s', s: { y: 55, p: 14, t: 0.4, c: 54 }, imp: 74, ea: 76 },
  { n: "Willie Jackson", p: 'WR', t: 'JAX', d: '1990s', s: { y: 50, p: 12.5, t: 0.4, c: 56 }, imp: 73, ea: 75 },
  { n: "Ernie Mills", p: 'WR', t: 'PIT', d: '1990s', s: { y: 50, p: 15, t: 0.4, c: 52 }, imp: 73, ea: 75 },
  { n: "Johnnie Morton", p: 'WR', t: 'DET', d: '1990s', s: { y: 65, p: 14, t: 0.4, c: 56 }, imp: 77, ea: 79 },
  { n: "Leslie Shepherd", p: 'WR', t: 'WAS', d: '1990s', s: { y: 45, p: 15.5, t: 0.3, c: 52 }, imp: 71, ea: 73 },
  { n: "Derrick Lassic", p: 'RB', t: 'DAL', d: '1990s', s: { y: 40, c: 3.6, r: 10, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Peerless Price", p: 'WR', t: 'BUF', d: '2000s', s: { y: 65, p: 15, t: 0.5, c: 56 }, imp: 77, ea: 78 },
  { n: "Rod Gardner", p: 'WR', t: 'WAS', d: '2000s', s: { y: 55, p: 13.5, t: 0.4, c: 54 }, imp: 74, ea: 75 },
  { n: "Keenan McCardell", p: 'WR', t: 'TB', d: '2000s', s: { y: 65, p: 12.5, t: 0.4, c: 60 }, imp: 77, ea: 78 },
  { n: "Greg Lewis", p: 'WR', t: 'PHI', d: '2000s', s: { y: 40, p: 14, t: 0.3, c: 54 }, imp: 71, ea: 72 },
  { n: "Brad Smith", p: 'RB', t: 'NYJ', d: '2000s', s: { y: 35, c: 4.5, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Leon Washington", p: 'RB', t: 'NYJ', d: '2000s', s: { y: 50, c: 4.4, r: 30, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Jerious Norwood", p: 'RB', t: 'ATL', d: '2000s', s: { y: 50, c: 5, r: 18, t: 0.3 }, imp: 74, ea: 75 },
  { n: "Danny Amendola", p: 'WR', t: 'NE', d: '2010s', s: { y: 55, p: 10.5, t: 0.3, c: 66 }, imp: 75, ea: 75 },
  { n: "Brian Quick", p: 'WR', t: 'LAR', d: '2010s', s: { y: 45, p: 14.5, t: 0.3, c: 54 }, imp: 71, ea: 71 },
  { n: "Tyler Boyd", p: 'WR', t: 'CIN', d: '2010s', s: { y: 70, p: 11, t: 0.4, c: 66 }, imp: 79, ea: 79 },
  { n: "Alfred Blue", p: 'RB', t: 'HOU', d: '2010s', s: { y: 50, c: 3.6, r: 12, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Wendell Smallwood", p: 'RB', t: 'PHI', d: '2010s', s: { y: 40, c: 4, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Peyton Barber", p: 'RB', t: 'TB', d: '2010s', s: { y: 55, c: 3.7, r: 12, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Hunter Renfrow", p: 'WR', t: 'LV', d: '2020s', s: { y: 55, p: 9.5, t: 0.3, c: 72 }, imp: 75, ea: 74 },
  { n: "Darnell Mooney", p: 'WR', t: 'CHI', d: '2020s', s: { y: 55, p: 13, t: 0.3, c: 58 }, imp: 74, ea: 73 },
  { n: "Noah Brown", p: 'WR', t: 'HOU', d: '2020s', s: { y: 45, p: 13.5, t: 0.3, c: 60 }, imp: 72, ea: 71 },
  { n: "Josh Downs", p: 'WR', t: 'IND', d: '2020s', s: { y: 55, p: 10.5, t: 0.3, c: 68 }, imp: 75, ea: 74 },
  { n: "Roschon Johnson", p: 'RB', t: 'CHI', d: '2020s', s: { y: 40, c: 3.9, r: 18, t: 0.4 }, imp: 72, ea: 74 },
  { n: "Tank Bigsby", p: 'RB', t: 'JAX', d: '2020s', s: { y: 45, c: 4.3, r: 12, t: 0.4 }, imp: 73, ea: 75 },
  { n: "Jaylen Wright", p: 'RB', t: 'MIA', d: '2020s', s: { y: 45, c: 4.8, r: 12, t: 0.3 }, imp: 73, ea: 75 },
  { n: "Ty Chandler", p: 'RB', t: 'MIN', d: '2020s', s: { y: 45, c: 4.4, r: 15, t: 0.4 }, imp: 72, ea: 74 },
  { n: "Blake Corum", p: 'RB', t: 'LAR', d: '2020s', s: { y: 40, c: 4, r: 12, t: 0.4 }, imp: 72, ea: 74 },
  { n: "Hayden Hurst", p: 'TE', t: 'CAR', d: '2020s', s: { y: 40, t: 0.4, b: 72 }, imp: 73, ea: 72 },
  { n: "Mike Phipps", p: 'QB', t: 'CHI', d: '1970s', s: { y: 150, t: 0.9, i: 1.3, r: 65 , ry: 8 }, imp: 68, ea: 72 },
  { n: "Bobby Scott", p: 'QB', t: 'NO', d: '1970s', s: { y: 140, t: 0.8, i: 1.3, r: 62 , ry: 8 }, imp: 66, ea: 70 },
  { n: "Gary Marangi", p: 'QB', t: 'BUF', d: '1970s', s: { y: 120, t: 0.6, i: 1.5, r: 54 , ry: 8 }, imp: 63, ea: 67 },
  { n: "Clint Longley", p: 'QB', t: 'DAL', d: '1970s', s: { y: 135, t: 0.9, i: 1.2, r: 66 , ry: 8 }, imp: 66, ea: 70 },
  { n: "Jerry Tagge", p: 'QB', t: 'GB', d: '1970s', s: { y: 130, t: 0.7, i: 1.4, r: 58 , ry: 8 }, imp: 64, ea: 68 },
  { n: "Joe Gilliam", p: 'QB', t: 'PIT', d: '1970s', s: { y: 150, t: 1, i: 1.4, r: 64 , ry: 8 }, imp: 67, ea: 71 },
  { n: "Mike Rae", p: 'QB', t: 'LV', d: '1970s', s: { y: 135, t: 0.9, i: 1.2, r: 66 , ry: 8 }, imp: 65, ea: 69 },
  { n: "David Humm", p: 'QB', t: 'LV', d: '1970s', s: { y: 125, t: 0.7, i: 1.3, r: 60 , ry: 8 }, imp: 63, ea: 67 },
  { n: "Po James", p: 'RB', t: 'PHI', d: '1970s', s: { y: 50, c: 3.7, r: 15, t: 0.2 }, imp: 70, ea: 70 },
  { n: "Tony Reed", p: 'RB', t: 'KC', d: '1970s', s: { y: 55, c: 4.2, r: 25, t: 0.3 }, imp: 72, ea: 72 },
  { n: "Rod Phillips", p: 'RB', t: 'LAR', d: '1970s', s: { y: 45, c: 3.9, r: 8, t: 0.3 }, imp: 69, ea: 69 },
  { n: "Ronnie Coleman", p: 'RB', t: 'TEN', d: '1970s', s: { y: 45, c: 4, r: 18, t: 0.3 }, imp: 69, ea: 69 },
  { n: "Ike Forte", p: 'RB', t: 'NE', d: '1970s', s: { y: 40, c: 3.8, r: 18, t: 0.3 }, imp: 68, ea: 68 },
  { n: "Elmo Wright", p: 'WR', t: 'KC', d: '1970s', s: { y: 45, p: 16, t: 0.4, c: 48 }, imp: 71, ea: 75 },
  { n: "Larry Burton", p: 'WR', t: 'NO', d: '1970s', s: { y: 40, p: 16.5, t: 0.3, c: 46 }, imp: 69, ea: 73 },
  { n: "Jubilee Dunbar", p: 'WR', t: 'CLE', d: '1970s', s: { y: 35, p: 15, t: 0.2, c: 48 }, imp: 67, ea: 71 },
  { n: "Jean Fugett", p: 'TE', t: 'WAS', d: '1970s', s: { y: 38, t: 0.4, b: 78 }, imp: 74, ea: 78 },
  { n: "Bob Klein", p: 'TE', t: 'LAC', d: '1970s', s: { y: 30, t: 0.3, b: 80 }, imp: 71, ea: 75 },
  { n: "Sammy Baugh", p: 'QB', t: 'WAS', d: '1980s', s: { y: 150, t: 1, i: 1.4, r: 64 , ry: 7 }, imp: 66, ea: 69 },
  { n: "Greg Landry", p: 'QB', t: 'IND', d: '1980s', s: { y: 155, t: 0.9, i: 1.1, r: 71 , ry: 30 }, imp: 68, ea: 71 },
  { n: "Blair Kiel", p: 'QB', t: 'GB', d: '1980s', s: { y: 140, t: 0.8, i: 1.1, r: 68 , ry: 7 }, imp: 64, ea: 67 },
  { n: "Curtis Adams", p: 'RB', t: 'LAC', d: '1980s', s: { y: 40, c: 3.9, r: 25, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Keith Griffin", p: 'RB', t: 'WAS', d: '1980s', s: { y: 50, c: 4, r: 15, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Sammy Smith", p: 'RB', t: 'MIA', d: '1980s', s: { y: 55, c: 3.7, r: 10, t: 0.5 }, imp: 72, ea: 73 },
  { n: "Ray Alexander", p: 'WR', t: 'DAL', d: '1980s', s: { y: 40, p: 14.5, t: 0.3, c: 52 }, imp: 69, ea: 72 },
  { n: "Lonzell Hill", p: 'WR', t: 'NO', d: '1980s', s: { y: 45, p: 12.5, t: 0.3, c: 56 }, imp: 70, ea: 73 },
  { n: "Jamie Williams", p: 'TE', t: 'TEN', d: '1980s', s: { y: 32, t: 0.3, b: 80 }, imp: 71, ea: 74 },
  { n: "Gino Torretta", p: 'QB', t: 'SEA', d: '1990s', s: { y: 150, t: 0.7, i: 1.3, r: 62 , ry: 6 }, imp: 63, ea: 65 },
  { n: "Mike Buck", p: 'QB', t: 'NO', d: '1990s', s: { y: 160, t: 0.9, i: 1.2, r: 68 , ry: 6 }, imp: 65, ea: 67 },
  { n: "Steve Walsh", p: 'QB', t: 'CHI', d: '1990s', s: { y: 175, t: 1, i: 1.1, r: 74 , ry: 6 }, imp: 70, ea: 72 },
  { n: "Jay Schroeder", p: 'QB', t: 'ARI', d: '1990s', s: { y: 185, t: 1.1, i: 1.3, r: 72 , ry: 6 }, imp: 70, ea: 72 },
  { n: "Jeff Hostetler", p: 'QB', t: 'LV', d: '1990s', s: { y: 200, t: 1.2, i: 1, r: 80 , ry: 6 }, imp: 75, ea: 77 },
  { n: "Mike Pawlawski", p: 'QB', t: 'TB', d: '1990s', s: { y: 150, t: 0.8, i: 1.3, r: 62 , ry: 6 }, imp: 63, ea: 65 },
  { n: "Tony Sacca", p: 'QB', t: 'ARI', d: '1990s', s: { y: 140, t: 0.7, i: 1.4, r: 58 , ry: 6 }, imp: 62, ea: 64 },
  { n: "Marc Logan", p: 'RB', t: 'SF', d: '1990s', s: { y: 40, c: 3.9, r: 20, t: 0.4 }, imp: 70, ea: 71 },
  { n: "James Joseph", p: 'RB', t: 'PHI', d: '1990s', s: { y: 45, c: 3.6, r: 25, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Tony Brooks", p: 'RB', t: 'PHI', d: '1990s', s: { y: 40, c: 3.5, r: 10, t: 0.3 }, imp: 68, ea: 69 },
  { n: "Lamont Warren", p: 'RB', t: 'IND', d: '1990s', s: { y: 40, c: 3.9, r: 20, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Calvin Williams", p: 'WR', t: 'PHI', d: '1990s', s: { y: 55, p: 13.5, t: 0.5, c: 54 }, imp: 74, ea: 76 },
  { n: "Desmond Howard", p: 'WR', t: 'WAS', d: '1990s', s: { y: 40, p: 12, t: 0.3, c: 52 }, imp: 71, ea: 73 },
  { n: "Ricky Proehl", p: 'WR', t: 'ARI', d: '1990s', s: { y: 60, p: 13, t: 0.4, c: 58 }, imp: 76, ea: 78 },
  { n: "Derek Brown", p: 'TE', t: 'NYG', d: '1990s', s: { y: 32, t: 0.3, b: 76 }, imp: 71, ea: 73 },
  { n: "Scott Slutzker", p: 'TE', t: 'IND', d: '1990s', s: { y: 30, t: 0.3, b: 74 }, imp: 69, ea: 71 },
  { n: "Doug Johnson", p: 'QB', t: 'ATL', d: '2000s', s: { y: 185, t: 1.1, i: 1.3, r: 72 , ry: 6 }, imp: 68, ea: 69 },
  { n: "Shaun King", p: 'QB', t: 'TB', d: '2000s', s: { y: 175, t: 1, i: 1.2, r: 72 , ry: 6 }, imp: 69, ea: 70 },
  { n: "Chris Weinke", p: 'QB', t: 'CAR', d: '2000s', s: { y: 185, t: 1, i: 1.3, r: 68 , ry: 6 }, imp: 67, ea: 68 },
  { n: "Spergon Wynn", p: 'QB', t: 'CLE', d: '2000s', s: { y: 150, t: 0.7, i: 1.4, r: 58 , ry: 6 }, imp: 62, ea: 63 },
  { n: "Craig Nall", p: 'QB', t: 'GB', d: '2000s', s: { y: 175, t: 1, i: 1.1, r: 74 , ry: 6 }, imp: 67, ea: 68 },
  { n: "Mike Cloud", p: 'RB', t: 'KC', d: '2000s', s: { y: 35, c: 3.7, r: 12, t: 0.3 }, imp: 68, ea: 69 },
  { n: "J.J. Arrington", p: 'RB', t: 'ARI', d: '2000s', s: { y: 40, c: 3.9, r: 25, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Cedric Houston", p: 'RB', t: 'NYJ', d: '2000s', s: { y: 40, c: 3.8, r: 10, t: 0.4 }, imp: 69, ea: 70 },
  { n: "Tab Perry", p: 'WR', t: 'CIN', d: '2000s', s: { y: 35, p: 14, t: 0.2, c: 54 }, imp: 68, ea: 69 },
  { n: "Bethel Johnson", p: 'WR', t: 'NE', d: '2000s', s: { y: 40, p: 16, t: 0.3, c: 48 }, imp: 70, ea: 71 },
  { n: "Roydell Williams", p: 'WR', t: 'TEN', d: '2000s', s: { y: 45, p: 13.5, t: 0.3, c: 54 }, imp: 71, ea: 72 },
  { n: "Doug Gabriel", p: 'WR', t: 'LV', d: '2000s', s: { y: 45, p: 15, t: 0.4, c: 50 }, imp: 71, ea: 72 },
  { n: "Dennis Northcutt", p: 'WR', t: 'CLE', d: '2000s', s: { y: 50, p: 12, t: 0.3, c: 60 }, imp: 73, ea: 74 },
  { n: "Courtney Roby", p: 'WR', t: 'TEN', d: '2000s', s: { y: 35, p: 14, t: 0.2, c: 52 }, imp: 68, ea: 69 },
  { n: "Justin Peelle", p: 'TE', t: 'LAC', d: '2000s', s: { y: 30, t: 0.4, b: 78 }, imp: 70, ea: 71 },
  { n: "Billy Miller", p: 'TE', t: 'HOU', d: '2000s', s: { y: 40, t: 0.3, b: 74 }, imp: 71, ea: 72 },
  { n: "Boo Williams", p: 'TE', t: 'NO', d: '2000s', s: { y: 38, t: 0.4, b: 74 }, imp: 71, ea: 72 },
  { n: "Kellen Clemens", p: 'QB', t: 'LAR', d: '2010s', s: { y: 185, t: 0.9, i: 1, r: 78 , ry: 7 }, imp: 68, ea: 68 },
  { n: "Matt McGloin", p: 'QB', t: 'LV', d: '2010s', s: { y: 195, t: 1.1, i: 1.1, r: 78 , ry: 7 }, imp: 68, ea: 68 },
  { n: "Thad Lewis", p: 'QB', t: 'BUF', d: '2010s', s: { y: 185, t: 0.9, i: 1, r: 76 , ry: 7 }, imp: 67, ea: 67 },
  { n: "Scott Tolzien", p: 'QB', t: 'IND', d: '2010s', s: { y: 180, t: 0.9, i: 1.2, r: 72 , ry: 7 }, imp: 66, ea: 66 },
  { n: "Brett Hundley", p: 'QB', t: 'GB', d: '2010s', s: { y: 185, t: 0.9, i: 0.9, r: 78 , ry: 7 }, imp: 69, ea: 69 },
  { n: "Fozzy Whittaker", p: 'RB', t: 'CAR', d: '2010s', s: { y: 35, c: 4.1, r: 20, t: 0.3 }, imp: 69, ea: 70 },
  { n: "Damien Williams", p: 'RB', t: 'KC', d: '2010s', s: { y: 45, c: 4.3, r: 20, t: 0.5 }, imp: 73, ea: 74 },
  { n: "Zach Zenner", p: 'RB', t: 'DET', d: '2010s', s: { y: 35, c: 3.9, r: 12, t: 0.4 }, imp: 68, ea: 69 },
  { n: "Brian Tyms", p: 'WR', t: 'NE', d: '2010s', s: { y: 30, p: 16, t: 0.2, c: 48 }, imp: 67, ea: 67 },
  { n: "Marlon Brown", p: 'WR', t: 'BAL', d: '2010s', s: { y: 40, p: 12.5, t: 0.4, c: 56 }, imp: 70, ea: 70 },
  { n: "Aldrick Robinson", p: 'WR', t: 'WAS', d: '2010s', s: { y: 35, p: 16, t: 0.3, c: 50 }, imp: 69, ea: 69 },
  { n: "Dontrelle Inman", p: 'WR', t: 'LAC', d: '2010s', s: { y: 50, p: 13.5, t: 0.3, c: 58 }, imp: 72, ea: 72 },
  { n: "Ted Ginn Jr.", p: 'WR', t: 'CAR', d: '2010s', s: { y: 50, p: 16, t: 0.4, c: 50 }, imp: 73, ea: 73 },
  { n: "Levine Toilolo", p: 'TE', t: 'ATL', d: '2010s', s: { y: 25, t: 0.3, b: 82 }, imp: 71, ea: 71 },
  { n: "Ryan Griffin", p: 'TE', t: 'HOU', d: '2010s', s: { y: 35, t: 0.3, b: 76 }, imp: 71, ea: 71 },
  { n: "Will Levis", p: 'QB', t: 'TEN', d: '2020s', s: { y: 205, t: 1.1, i: 1, r: 80 , ry: 9 }, imp: 72, ea: 71 },
  { n: "Tommy DeVito", p: 'QB', t: 'NYG', d: '2020s', s: { y: 185, t: 0.9, i: 0.8, r: 82 , ry: 9 }, imp: 69, ea: 68 },
  { n: "Jake Browning", p: 'QB', t: 'CIN', d: '2020s', s: { y: 235, t: 1.3, i: 0.9, r: 90 , ry: 9 }, imp: 74, ea: 73 },
  { n: "Dorian Thompson-Robinson", p: 'QB', t: 'CLE', d: '2020s', s: { y: 175, t: 0.8, i: 1.1, r: 70 , ry: 9 }, imp: 66, ea: 65 },
  { n: "Nathan Rourke", p: 'QB', t: 'NE', d: '2020s', s: { y: 180, t: 0.9, i: 0.9, r: 78 , ry: 9 }, imp: 67, ea: 66 },
  { n: "Jaleel McLaughlin", p: 'RB', t: 'DEN', d: '2020s', s: { y: 45, c: 5, r: 20, t: 0.3 }, imp: 73, ea: 75 },
  { n: "Tyrone Tracy Jr.", p: 'RB', t: 'NYG', d: '2020s', s: { y: 60, c: 4.4, r: 25, t: 0.4 }, imp: 76, ea: 78 },
  { n: "Ray Davis", p: 'RB', t: 'BUF', d: '2020s', s: { y: 40, c: 4.4, r: 15, t: 0.4 }, imp: 72, ea: 74 },
  { n: "Jordan Mason", p: 'RB', t: 'SF', d: '2020s', s: { y: 65, c: 4.8, r: 12, t: 0.5 }, imp: 77, ea: 79 },
  { n: "Trey Benson", p: 'RB', t: 'ARI', d: '2020s', s: { y: 40, c: 4.5, r: 10, t: 0.3 }, imp: 72, ea: 74 },
  { n: "Audric Estime", p: 'RB', t: 'DEN', d: '2020s', s: { y: 35, c: 4.3, r: 8, t: 0.3 }, imp: 71, ea: 73 },
  { n: "MarShawn Lloyd", p: 'RB', t: 'GB', d: '2020s', s: { y: 35, c: 4.2, r: 12, t: 0.3 }, imp: 70, ea: 72 },
  { n: "Xavier Legette", p: 'WR', t: 'CAR', d: '2020s', s: { y: 45, p: 11, t: 0.3, c: 58 }, imp: 72, ea: 71 },
  { n: "Keon Coleman", p: 'WR', t: 'BUF', d: '2020s', s: { y: 45, p: 14.5, t: 0.4, c: 54 }, imp: 74, ea: 73 },
  { n: "Jermaine Burton", p: 'WR', t: 'CIN', d: '2020s', s: { y: 35, p: 14, t: 0.3, c: 54 }, imp: 70, ea: 69 },
  { n: "Jalen McMillan", p: 'WR', t: 'TB', d: '2020s', s: { y: 45, p: 12.5, t: 0.4, c: 60 }, imp: 73, ea: 72 },
  { n: "Ja'Tavion Sanders", p: 'TE', t: 'CAR', d: '2020s', s: { y: 35, t: 0.2, b: 72 }, imp: 71, ea: 70 },
  { n: "Theo Johnson", p: 'TE', t: 'NYG', d: '2020s', s: { y: 30, t: 0.3, b: 74 }, imp: 71, ea: 70 },
  { n: "Cade Stover", p: 'TE', t: 'HOU', d: '2020s', s: { y: 30, t: 0.3, b: 74 }, imp: 70, ea: 69 },
  { n: "Ben Sinnott", p: 'TE', t: 'WAS', d: '2020s', s: { y: 25, t: 0.2, b: 74 }, imp: 69, ea: 68 },
  { n: "Steve Young", p: 'QB', t: 'TB', d: '1980s', s: { y: 175, t: 0.9, i: 1.3, r: 68 , ry: 20 }, imp: 75, ea: 78 },
  { n: "Joe Montana", p: 'QB', t: 'KC', d: '1990s', s: { y: 225, t: 1.5, i: 0.8, r: 90 , ry: 8 }, imp: 88, ea: 90 },
  { n: "Johnny Unitas", p: 'QB', t: 'LAC', d: '1970s', s: { y: 150, t: 0.9, i: 1.3, r: 64 , ry: 8 }, imp: 74, ea: 78 },
  { n: "Warren Moon", p: 'QB', t: 'MIN', d: '1990s', s: { y: 240, t: 1.5, i: 1.1, r: 84 , ry: 14 }, imp: 82, ea: 84 },
  { n: "Warren Moon", p: 'QB', t: 'SEA', d: '1990s', s: { y: 230, t: 1.4, i: 1.1, r: 84 , ry: 14 }, imp: 80, ea: 82 },
  { n: "Kurt Warner", p: 'QB', t: 'NYG', d: '2000s', s: { y: 235, t: 1.4, i: 1, r: 88 , ry: 2 }, imp: 82, ea: 83 },
  { n: "Carson Palmer", p: 'QB', t: 'LV', d: '2010s', s: { y: 255, t: 1.6, i: 1.2, r: 86 , ry: 2 }, imp: 80, ea: 80 },
  { n: "Michael Vick", p: 'QB', t: 'PHI', d: '2010s', s: { y: 225, t: 1.4, i: 0.9, r: 88 , ry: 35 }, imp: 83, ea: 83 },
  { n: "Carson Wentz", p: 'QB', t: 'IND', d: '2020s', s: { y: 230, t: 1.4, i: 0.9, r: 88 , ry: 12 }, imp: 77, ea: 76 },
  { n: "Matt Ryan", p: 'QB', t: 'IND', d: '2020s', s: { y: 235, t: 1.2, i: 1, r: 86 , ry: 6 }, imp: 77, ea: 76 },
  { n: "Marshawn Lynch", p: 'RB', t: 'BUF', d: '2000s', s: { y: 80, c: 4.1, r: 18, t: 0.5 }, imp: 80, ea: 81 },
  { n: "Frank Gore", p: 'RB', t: 'BUF', d: '2010s', s: { y: 60, c: 3.9, r: 12, t: 0.3 }, imp: 77, ea: 78 },
  { n: "Jamaal Charles", p: 'RB', t: 'DEN', d: '2010s', s: { y: 45, c: 4.2, r: 18, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Eddie Lacy", p: 'RB', t: 'SEA', d: '2010s', s: { y: 45, c: 3.9, r: 8, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Mark Ingram II", p: 'RB', t: 'BAL', d: '2010s', s: { y: 70, c: 5, r: 18, t: 0.6 }, imp: 80, ea: 81 },
  { n: "Randy Moss", p: 'WR', t: 'TEN', d: '2010s', s: { y: 35, p: 13, t: 0.2, c: 50 }, imp: 72, ea: 72 },
  { n: "Terrell Owens", p: 'WR', t: 'BUF', d: '2000s', s: { y: 75, p: 13.5, t: 0.6, c: 56 }, imp: 82, ea: 83 },
  { n: "Terrell Owens", p: 'WR', t: 'CIN', d: '2010s', s: { y: 65, p: 13, t: 0.5, c: 56 }, imp: 78, ea: 78 },
  { n: "Andre Johnson", p: 'WR', t: 'IND', d: '2010s', s: { y: 50, p: 11.5, t: 0.3, c: 58 }, imp: 74, ea: 74 },
  { n: "Owen Daniels", p: 'TE', t: 'DEN', d: '2010s', s: { y: 40, t: 0.4, b: 76 }, imp: 74, ea: 74 },
  { n: "Mason Rudolph", p: 'QB', t: 'TEN', d: '2020s', s: { y: 200, t: 1.1, i: 0.9, r: 84 , ry: 9 }, imp: 71, ea: 70 },
  { n: "Drew Lock", p: 'QB', t: 'NYG', d: '2020s', s: { y: 200, t: 1.1, i: 1, r: 80 , ry: 9 }, imp: 70, ea: 69 },
  { n: "Mac Jones", p: 'QB', t: 'JAX', d: '2020s', s: { y: 205, t: 1.2, i: 0.9, r: 84 , ry: 9 }, imp: 73, ea: 72 },
  { n: "Kenny Pickett", p: 'QB', t: 'PHI', d: '2020s', s: { y: 195, t: 0.9, i: 0.8, r: 82 , ry: 9 }, imp: 71, ea: 70 },
  { n: "Malik Willis", p: 'QB', t: 'GB', d: '2020s', s: { y: 165, t: 0.8, i: 0.6, r: 84 , ry: 9 }, imp: 69, ea: 68 },
  { n: "Spencer Rattler", p: 'QB', t: 'NO', d: '2020s', s: { y: 200, t: 0.9, i: 1, r: 78 , ry: 9 }, imp: 69, ea: 68 },
  { n: "Michael Penix Jr.", p: 'QB', t: 'ATL', d: '2020s', s: { y: 215, t: 1.1, i: 0.9, r: 84 , ry: 9 }, imp: 74, ea: 73 },
  { n: "Jacoby Brissett", p: 'QB', t: 'NE', d: '2020s', s: { y: 200, t: 1, i: 0.7, r: 84 , ry: 12 }, imp: 72, ea: 71 },
  { n: "DeAndre Hopkins", p: 'WR', t: 'KC', d: '2020s', s: { y: 55, p: 12, t: 0.4, c: 62 }, imp: 78, ea: 77 },
  { n: "Keenan Allen", p: 'WR', t: 'CHI', d: '2020s', s: { y: 65, p: 10.5, t: 0.4, c: 68 }, imp: 79, ea: 78 },
  { n: "Davante Adams", p: 'WR', t: 'NYJ', d: '2020s', s: { y: 75, p: 12, t: 0.5, c: 62 }, imp: 84, ea: 83 },
  { n: "Cooper Kupp", p: 'WR', t: 'SEA', d: '2020s', s: { y: 65, p: 10.5, t: 0.4, c: 70 }, imp: 80, ea: 79 },
  { n: "Stefon Diggs", p: 'WR', t: 'HOU', d: '2020s', s: { y: 70, p: 10.5, t: 0.4, c: 66 }, imp: 81, ea: 80 },
  { n: "Derrick Henry", p: 'RB', t: 'BAL', d: '2020s', s: { y: 94, c: 5.2, r: 8, t: 0.95 }, imp: 90, ea: 92 },
  { n: "Joe Mixon", p: 'RB', t: 'HOU', d: '2020s', s: { y: 75, c: 4.2, r: 25, t: 0.7 }, imp: 80, ea: 82 },
  { n: "Josh Jacobs", p: 'RB', t: 'GB', d: '2020s', s: { y: 85, c: 4.4, r: 25, t: 0.7 }, imp: 83, ea: 85 },
  { n: "Jahmyr Gibbs", p: 'RB', t: 'DET', d: '2020s', s: { y: 80, c: 5.2, r: 35, t: 0.8 }, imp: 86, ea: 88 },
  { n: "Karl Sweetan", p: 'QB', t: 'LAR', d: '1970s', s: { y: 130, t: 0.7, i: 1.4, r: 58 , ry: 8 }, imp: 62, ea: 66 },
  { n: "Bobby Douglass", p: 'QB', t: 'NO', d: '1970s', s: { y: 120, t: 0.7, i: 1.4, r: 56 , ry: 48 }, imp: 63, ea: 67 },
  { n: "Dan Pastorini", p: 'QB', t: 'LV', d: '1970s', s: { y: 150, t: 0.9, i: 1.2, r: 68 , ry: 8 }, imp: 70, ea: 74 },
  { n: "John Reaves", p: 'QB', t: 'CIN', d: '1970s', s: { y: 135, t: 0.8, i: 1.3, r: 62 , ry: 8 }, imp: 65, ea: 69 },
  { n: "Edd Hargett", p: 'QB', t: 'TEN', d: '1970s', s: { y: 130, t: 0.7, i: 1.3, r: 60 , ry: 8 }, imp: 62, ea: 66 },
  { n: "Norm Snead", p: 'QB', t: 'SF', d: '1970s', s: { y: 155, t: 1, i: 1.3, r: 68 , ry: 8 }, imp: 69, ea: 73 },
  { n: "Jim Del Gaizo", p: 'QB', t: 'MIA', d: '1970s', s: { y: 125, t: 0.8, i: 1.3, r: 62 , ry: 8 }, imp: 62, ea: 66 },
  { n: "Fred Willis", p: 'RB', t: 'TEN', d: '1970s', s: { y: 45, c: 3.9, r: 25, t: 0.3 }, imp: 70, ea: 70 },
  { n: "Don Nottingham", p: 'RB', t: 'MIA', d: '1970s', s: { y: 40, c: 3.6, r: 8, t: 0.5 }, imp: 69, ea: 69 },
  { n: "John Riggins", p: 'RB', t: 'NYJ', d: '1970s', s: { y: 75, c: 4, r: 20, t: 0.6 }, imp: 80, ea: 80 },
  { n: "Lawrence McCutcheon", p: 'RB', t: 'DEN', d: '1970s', s: { y: 50, c: 3.9, r: 12, t: 0.3 }, imp: 71, ea: 71 },
  { n: "Arthur Whittington", p: 'RB', t: 'LV', d: '1970s', s: { y: 45, c: 4.1, r: 18, t: 0.4 }, imp: 70, ea: 70 },
  { n: "Bo Matthews", p: 'RB', t: 'LAC', d: '1970s', s: { y: 40, c: 3.7, r: 18, t: 0.3 }, imp: 69, ea: 69 },
  { n: "Mel Gray", p: 'WR', t: 'ARI', d: '1980s', s: { y: 40, p: 16, t: 0.3, c: 46 }, imp: 71, ea: 74 },
  { n: "Bob Grupp", p: 'WR', t: 'KC', d: '1970s', s: { y: 30, p: 13, t: 0.2, c: 50 }, imp: 65, ea: 69 },
  { n: "Mike Siani", p: 'WR', t: 'LV', d: '1970s', s: { y: 40, p: 15.5, t: 0.3, c: 48 }, imp: 69, ea: 73 },
  { n: "Ken Payne", p: 'WR', t: 'GB', d: '1970s', s: { y: 40, p: 14, t: 0.2, c: 50 }, imp: 68, ea: 72 },
  { n: "Mike Barber", p: 'TE', t: 'TEN', d: '1970s', s: { y: 38, t: 0.4, b: 76 }, imp: 73, ea: 77 },
  { n: "Bob Klein", p: 'TE', t: 'LAR', d: '1980s', s: { y: 25, t: 0.2, b: 80 }, imp: 69, ea: 72 },
  { n: "Rusty Hilger", p: 'QB', t: 'LV', d: '1980s', s: { y: 160, t: 0.9, i: 1.2, r: 68 , ry: 7 }, imp: 66, ea: 69 },
  { n: "Wilbert Montgomery", p: 'RB', t: 'DET', d: '1980s', s: { y: 45, c: 3.8, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Marcus Dupree", p: 'RB', t: 'NO', d: '1980s', s: { y: 55, c: 4.2, r: 8, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Curt Warner", p: 'RB', t: 'LAR', d: '1980s', s: { y: 50, c: 3.7, r: 15, t: 0.4 }, imp: 72, ea: 73 },
  { n: "D.J. Dozier", p: 'RB', t: 'MIN', d: '1980s', s: { y: 40, c: 3.6, r: 12, t: 0.3 }, imp: 69, ea: 70 },
  { n: "Bubby Brister", p: 'QB', t: 'PIT', d: '1990s', s: { y: 185, t: 1, i: 1.1, r: 74 , ry: 6 }, imp: 71, ea: 73 },
  { n: "Wade Wilson", p: 'QB', t: 'DAL', d: '1990s', s: { y: 180, t: 1.1, i: 1, r: 78 , ry: 6 }, imp: 71, ea: 73 },
  { n: "David Klingler", p: 'QB', t: 'CIN', d: '1990s', s: { y: 175, t: 0.9, i: 1.2, r: 66 , ry: 6 }, imp: 66, ea: 68 },
  { n: "Craig Erickson", p: 'QB', t: 'TB', d: '1990s', s: { y: 185, t: 1.1, i: 1.2, r: 72 , ry: 6 }, imp: 69, ea: 71 },
  { n: "Blair Thomas", p: 'RB', t: 'NYJ', d: '1990s', s: { y: 50, c: 3.6, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Roger Craig", p: 'RB', t: 'MIN', d: '1990s', s: { y: 55, c: 3.7, r: 35, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Barry Word", p: 'RB', t: 'KC', d: '1990s', s: { y: 60, c: 4, r: 8, t: 0.5 }, imp: 73, ea: 74 },
  { n: "Tommy Vardell", p: 'RB', t: 'SF', d: '1990s', s: { y: 35, c: 3.6, r: 25, t: 0.3 }, imp: 69, ea: 70 },
  { n: "Rodney Culver", p: 'RB', t: 'IND', d: '1990s', s: { y: 40, c: 3.4, r: 18, t: 0.4 }, imp: 69, ea: 70 },
  { n: "Terry Kirby", p: 'RB', t: 'MIA', d: '1990s', s: { y: 45, c: 3.9, r: 35, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Michael Jackson", p: 'WR', t: 'BAL', d: '1990s', s: { y: 65, p: 15.5, t: 0.6, c: 52 }, imp: 78, ea: 80 },
  { n: "Anthony Carter", p: 'WR', t: 'MIN', d: '1990s', s: { y: 60, p: 14.5, t: 0.4, c: 54 }, imp: 76, ea: 78 },
  { n: "Willie Green", p: 'WR', t: 'DET', d: '1990s', s: { y: 50, p: 16.5, t: 0.4, c: 48 }, imp: 73, ea: 75 },
  { n: "Ron Hall", p: 'TE', t: 'TB', d: '1990s', s: { y: 35, t: 0.3, b: 74 }, imp: 71, ea: 73 },
  { n: "Jay Fiedler", p: 'QB', t: 'MIA', d: '2000s', s: { y: 200, t: 1.2, i: 1.1, r: 78 , ry: 6 }, imp: 72, ea: 73 },
  { n: "Rodney Peete", p: 'QB', t: 'CAR', d: '2000s', s: { y: 195, t: 1.1, i: 1, r: 80 , ry: 6 }, imp: 71, ea: 72 },
  { n: "Jeff Blake", p: 'QB', t: 'BAL', d: '2000s', s: { y: 200, t: 1.2, i: 1.1, r: 78 , ry: 16 }, imp: 71, ea: 72 },
  { n: "Brian St. Pierre", p: 'QB', t: 'PIT', d: '2000s', s: { y: 170, t: 0.9, i: 1.1, r: 72 , ry: 6 }, imp: 65, ea: 66 },
  { n: "Vinny Testaverde", p: 'QB', t: 'DAL', d: '2000s', s: { y: 200, t: 1.2, i: 1.1, r: 78 , ry: 4 }, imp: 73, ea: 74 },
  { n: "Akili Smith", p: 'QB', t: 'CIN', d: '2000s', s: { y: 160, t: 0.7, i: 1.3, r: 60 , ry: 6 }, imp: 64, ea: 65 },
  { n: "Olandis Gary", p: 'RB', t: 'DEN', d: '2000s', s: { y: 60, c: 4, r: 12, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Lamar Gordon", p: 'RB', t: 'LAR', d: '2000s', s: { y: 45, c: 4, r: 18, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Lee Suggs", p: 'RB', t: 'CLE', d: '2000s', s: { y: 50, c: 3.9, r: 12, t: 0.5 }, imp: 71, ea: 72 },
  { n: "Domanick Williams", p: 'RB', t: 'HOU', d: '2000s', s: { y: 75, c: 4, r: 35, t: 0.5 }, imp: 77, ea: 78 },
  { n: "Chris Brown", p: 'RB', t: 'TEN', d: '2000s', s: { y: 60, c: 4, r: 12, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Ike Hilliard", p: 'WR', t: 'NYG', d: '2000s', s: { y: 55, p: 11.5, t: 0.3, c: 62 }, imp: 74, ea: 75 },
  { n: "Eric Moulds", p: 'WR', t: 'BUF', d: '2000s', s: { y: 70, p: 13.5, t: 0.4, c: 58 }, imp: 78, ea: 79 },
  { n: "Koren Robinson", p: 'WR', t: 'SEA', d: '2000s', s: { y: 55, p: 13.5, t: 0.4, c: 54 }, imp: 73, ea: 74 },
  { n: "Darrell Jackson", p: 'WR', t: 'SEA', d: '2000s', s: { y: 70, p: 13.5, t: 0.5, c: 58 }, imp: 79, ea: 80 },
  { n: "Jerry Porter", p: 'WR', t: 'LV', d: '2000s', s: { y: 60, p: 14.5, t: 0.4, c: 54 }, imp: 75, ea: 76 },
  { n: "Charlie Whitehurst", p: 'QB', t: 'LAC', d: '2010s', s: { y: 185, t: 1, i: 1, r: 78 , ry: 7 }, imp: 67, ea: 67 },
  { n: "Bruce Gradkowski", p: 'QB', t: 'CIN', d: '2010s', s: { y: 175, t: 0.9, i: 1.1, r: 74 , ry: 7 }, imp: 66, ea: 66 },
  { n: "Jimmy Clausen", p: 'QB', t: 'CAR', d: '2010s', s: { y: 175, t: 0.8, i: 1.2, r: 64 , ry: 7 }, imp: 64, ea: 64 },
  { n: "Colt McCoy", p: 'QB', t: 'CLE', d: '2010s', s: { y: 195, t: 1, i: 1, r: 78 , ry: 7 }, imp: 69, ea: 69 },
  { n: "Ryan Mallett", p: 'QB', t: 'HOU', d: '2010s', s: { y: 200, t: 1.1, i: 1.1, r: 76 , ry: 7 }, imp: 68, ea: 68 },
  { n: "Bryce Petty", p: 'QB', t: 'NYJ', d: '2010s', s: { y: 175, t: 0.8, i: 1.2, r: 66 , ry: 7 }, imp: 64, ea: 64 },
  { n: "Isaiah Crowell", p: 'RB', t: 'CLE', d: '2010s', s: { y: 65, c: 4.1, r: 15, t: 0.5 }, imp: 75, ea: 76 },
  { n: "Bishop Sankey", p: 'RB', t: 'TEN', d: '2010s', s: { y: 45, c: 3.7, r: 18, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Shane Vereen", p: 'RB', t: 'NE', d: '2010s', s: { y: 35, c: 4.2, r: 40, t: 0.3 }, imp: 73, ea: 74 },
  { n: "James Starks", p: 'RB', t: 'GB', d: '2010s', s: { y: 50, c: 4.3, r: 18, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Bobby Rainey", p: 'RB', t: 'TB', d: '2010s', s: { y: 45, c: 4, r: 25, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Andre Brown", p: 'RB', t: 'NYG', d: '2010s', s: { y: 55, c: 4.2, r: 12, t: 0.5 }, imp: 72, ea: 73 },
  { n: "Eddie Royal", p: 'WR', t: 'LAC', d: '2010s', s: { y: 50, p: 11, t: 0.4, c: 64 }, imp: 73, ea: 73 },
  { n: "Brian Hartline", p: 'WR', t: 'MIA', d: '2010s', s: { y: 60, p: 13, t: 0.3, c: 60 }, imp: 74, ea: 74 },
  { n: "Nate Washington", p: 'WR', t: 'TEN', d: '2010s', s: { y: 55, p: 14.5, t: 0.4, c: 56 }, imp: 74, ea: 74 },
  { n: "Markus Wheaton", p: 'WR', t: 'PIT', d: '2010s', s: { y: 45, p: 14, t: 0.3, c: 58 }, imp: 71, ea: 71 },
  { n: "Luke Willson", p: 'TE', t: 'SEA', d: '2010s', s: { y: 30, t: 0.3, b: 76 }, imp: 71, ea: 71 },
  { n: "Tyson Bagent", p: 'QB', t: 'CHI', d: '2020s', s: { y: 185, t: 0.9, i: 0.9, r: 80 , ry: 9 }, imp: 68, ea: 67 },
  { n: "Tyrod Taylor", p: 'QB', t: 'NYJ', d: '2020s', s: { y: 200, t: 1.1, i: 0.6, r: 88 , ry: 9 }, imp: 72, ea: 71 },
  { n: "Mike White", p: 'QB', t: 'MIA', d: '2020s', s: { y: 205, t: 1.1, i: 1.1, r: 80 , ry: 9 }, imp: 69, ea: 68 },
  { n: "Davis Mills", p: 'QB', t: 'HOU', d: '2020s', s: { y: 215, t: 1.1, i: 1, r: 80 , ry: 9 }, imp: 71, ea: 70 },
  { n: "Clayton Tune", p: 'QB', t: 'ARI', d: '2020s', s: { y: 165, t: 0.7, i: 1.1, r: 66 , ry: 9 }, imp: 64, ea: 63 },
  { n: "AJ Dillon", p: 'RB', t: 'GB', d: '2020s', s: { y: 55, c: 4, r: 18, t: 0.4 }, imp: 74, ea: 76 },
  { n: "Cam Akers", p: 'RB', t: 'LAR', d: '2020s', s: { y: 55, c: 4, r: 15, t: 0.4 }, imp: 73, ea: 75 },
  { n: "Devin Singletary", p: 'RB', t: 'HOU', d: '2020s', s: { y: 60, c: 4.2, r: 18, t: 0.4 }, imp: 76, ea: 78 },
  { n: "Samaje Perine", p: 'RB', t: 'CIN', d: '2020s', s: { y: 40, c: 4, r: 35, t: 0.4 }, imp: 73, ea: 75 },
  { n: "Justice Hill", p: 'RB', t: 'BAL', d: '2020s', s: { y: 40, c: 4.6, r: 18, t: 0.3 }, imp: 72, ea: 74 },
  { n: "Kareem Hunt", p: 'RB', t: 'KC', d: '2020s', s: { y: 55, c: 3.9, r: 18, t: 0.6 }, imp: 76, ea: 78 },
  { n: "Elijah Moore", p: 'WR', t: 'CLE', d: '2020s', s: { y: 55, p: 9.5, t: 0.2, c: 66 }, imp: 73, ea: 72 },
  { n: "Jahan Dotson", p: 'WR', t: 'WAS', d: '2020s', s: { y: 50, p: 12, t: 0.3, c: 58 }, imp: 73, ea: 72 },
  { n: "Gabe Davis", p: 'WR', t: 'BUF', d: '2020s', s: { y: 55, p: 15.5, t: 0.5, c: 52 }, imp: 75, ea: 74 },
  { n: "Rashid Shaheed", p: 'WR', t: 'NO', d: '2020s', s: { y: 55, p: 16, t: 0.4, c: 56 }, imp: 75, ea: 74 },
  { n: "Adam Trautman", p: 'TE', t: 'DEN', d: '2020s', s: { y: 30, t: 0.2, b: 78 }, imp: 71, ea: 70 },
  { n: "Chigoziem Okonkwo", p: 'TE', t: 'TEN', d: '2020s', s: { y: 40, t: 0.3, b: 72 }, imp: 73, ea: 72 },
  { n: "Emari Demercado", p: 'RB', t: 'ARI', d: '2020s', s: { y: 35, c: 4.6, r: 18, t: 0.2 }, imp: 71, ea: 73 },
  { n: "Michael Carter", p: 'RB', t: 'ARI', d: '2020s', s: { y: 35, c: 4, r: 20, t: 0.2 }, imp: 70, ea: 72 },
  { n: "Michael Wilson", p: 'WR', t: 'ARI', d: '2020s', s: { y: 50, p: 11.5, t: 0.3, c: 62 }, imp: 73, ea: 72 },
  { n: "Cordarrelle Patterson", p: 'RB', t: 'ATL', d: '2020s', s: { y: 45, c: 4.5, r: 25, t: 0.5 }, imp: 74, ea: 76 },
  { n: "Darnell Mooney", p: 'WR', t: 'ATL', d: '2020s', s: { y: 55, p: 14, t: 0.3, c: 56 }, imp: 74, ea: 73 },
  { n: "Mack Hollins", p: 'WR', t: 'ATL', d: '2020s', s: { y: 45, p: 13.5, t: 0.3, c: 56 }, imp: 72, ea: 71 },
  { n: "Jonnu Smith", p: 'TE', t: 'ATL', d: '2020s', s: { y: 50, t: 0.4, b: 74 }, imp: 76, ea: 75 },
  { n: "Nelson Agholor", p: 'WR', t: 'BAL', d: '2020s', s: { y: 40, p: 13.5, t: 0.3, c: 58 }, imp: 71, ea: 70 },
  { n: "Devontez Walker", p: 'WR', t: 'BAL', d: '2020s', s: { y: 35, p: 14, t: 0.3, c: 54 }, imp: 70, ea: 69 },
  { n: "Charlie Kolar", p: 'TE', t: 'BAL', d: '2020s', s: { y: 30, t: 0.3, b: 76 }, imp: 71, ea: 70 },
  { n: "Latavius Murray", p: 'RB', t: 'BUF', d: '2020s', s: { y: 40, c: 4, r: 8, t: 0.4 }, imp: 71, ea: 73 },
  { n: "Curtis Samuel", p: 'WR', t: 'BUF', d: '2020s', s: { y: 45, p: 9.5, t: 0.3, c: 66 }, imp: 73, ea: 72 },
  { n: "Miles Sanders", p: 'RB', t: 'CAR', d: '2020s', s: { y: 50, c: 3.9, r: 18, t: 0.3 }, imp: 74, ea: 76 },
  { n: "Diontae Johnson", p: 'WR', t: 'CAR', d: '2020s', s: { y: 55, p: 11, t: 0.3, c: 62 }, imp: 75, ea: 74 },
  { n: "Tommy Tremble", p: 'TE', t: 'CAR', d: '2020s', s: { y: 35, t: 0.3, b: 78 }, imp: 72, ea: 71 },
  { n: "Marcedes Lewis", p: 'TE', t: 'CHI', d: '2020s', s: { y: 20, t: 0.2, b: 82 }, imp: 71, ea: 70 },
  { n: "Chase Brown", p: 'RB', t: 'CIN', d: '2020s', s: { y: 60, c: 4.5, r: 25, t: 0.5 }, imp: 77, ea: 79 },
  { n: "Cedric Tillman", p: 'WR', t: 'CLE', d: '2020s', s: { y: 45, p: 12, t: 0.3, c: 58 }, imp: 72, ea: 71 },
  { n: "Rico Dowdle", p: 'RB', t: 'DAL', d: '2020s', s: { y: 55, c: 4.4, r: 25, t: 0.3 }, imp: 75, ea: 77 },
  { n: "Ezekiel Elliott", p: 'RB', t: 'DAL', d: '2020s', s: { y: 65, c: 3.9, r: 18, t: 0.6 }, imp: 78, ea: 80 },
  { n: "Rico Dowdle", p: 'RB', t: 'CAR', d: '2020s', s: { y: 60, c: 4.6, r: 20, t: 0.3 }, imp: 76, ea: 78 },
  { n: "Jalen Tolbert", p: 'WR', t: 'DAL', d: '2020s', s: { y: 40, p: 13, t: 0.3, c: 58 }, imp: 71, ea: 70 },
  { n: "Michael Gallup", p: 'WR', t: 'DAL', d: '2020s', s: { y: 50, p: 13.5, t: 0.3, c: 56 }, imp: 74, ea: 73 },
  { n: "Luke Schoonmaker", p: 'TE', t: 'DAL', d: '2020s', s: { y: 25, t: 0.2, b: 74 }, imp: 70, ea: 69 },
  { n: "Jerry Jeudy", p: 'WR', t: 'DEN', d: '2020s', s: { y: 60, p: 12.5, t: 0.3, c: 62 }, imp: 77, ea: 76 },
  { n: "Marvin Mims Jr.", p: 'WR', t: 'DEN', d: '2020s', s: { y: 40, p: 14, t: 0.3, c: 56 }, imp: 72, ea: 71 },
  { n: "Tim Patrick", p: 'WR', t: 'DEN', d: '2020s', s: { y: 45, p: 13, t: 0.3, c: 60 }, imp: 73, ea: 72 },
  { n: "Tim Patrick", p: 'WR', t: 'DET', d: '2020s', s: { y: 35, p: 12.5, t: 0.3, c: 60 }, imp: 71, ea: 70 },
  { n: "Brock Wright", p: 'TE', t: 'DET', d: '2020s', s: { y: 25, t: 0.3, b: 78 }, imp: 71, ea: 70 },
  { n: "Trey Sermon", p: 'RB', t: 'IND', d: '2020s', s: { y: 40, c: 4.2, r: 12, t: 0.3 }, imp: 70, ea: 72 },
  { n: "Alec Pierce", p: 'WR', t: 'IND', d: '2020s', s: { y: 55, p: 16.5, t: 0.3, c: 54 }, imp: 74, ea: 73 },
  { n: "Adonai Mitchell", p: 'WR', t: 'IND', d: '2020s', s: { y: 35, p: 13, t: 0.3, c: 54 }, imp: 70, ea: 69 },
  { n: "Mo Alie-Cox", p: 'TE', t: 'IND', d: '2020s', s: { y: 25, t: 0.2, b: 78 }, imp: 71, ea: 70 },
  { n: "Kylen Granson", p: 'TE', t: 'IND', d: '2020s', s: { y: 30, t: 0.2, b: 74 }, imp: 70, ea: 69 },
  { n: "Drew Ogletree", p: 'TE', t: 'IND', d: '2020s', s: { y: 25, t: 0.3, b: 74 }, imp: 69, ea: 68 },
  { n: "D'Ernest Johnson", p: 'RB', t: 'JAX', d: '2020s', s: { y: 35, c: 4, r: 18, t: 0.2 }, imp: 70, ea: 72 },
  { n: "Brenton Strange", p: 'TE', t: 'JAX', d: '2020s', s: { y: 35, t: 0.3, b: 74 }, imp: 71, ea: 70 },
  { n: "Noah Gray", p: 'TE', t: 'KC', d: '2020s', s: { y: 30, t: 0.4, b: 76 }, imp: 72, ea: 71 },
  { n: "J.K. Dobbins", p: 'RB', t: 'LAC', d: '2020s', s: { y: 75, c: 4.6, r: 15, t: 0.5 }, imp: 79, ea: 81 },
  { n: "Gus Edwards", p: 'RB', t: 'LAC', d: '2020s', s: { y: 55, c: 4.2, r: 8, t: 0.5 }, imp: 74, ea: 76 },
  { n: "Colby Parkinson", p: 'TE', t: 'LAR', d: '2020s', s: { y: 35, t: 0.3, b: 74 }, imp: 71, ea: 70 },
  { n: "Ameer Abdullah", p: 'RB', t: 'LV', d: '2020s', s: { y: 30, c: 4.2, r: 25, t: 0.2 }, imp: 70, ea: 72 },
  { n: "Tre Tucker", p: 'WR', t: 'LV', d: '2020s', s: { y: 40, p: 12.5, t: 0.3, c: 56 }, imp: 71, ea: 70 },
  { n: "Michael Mayer", p: 'TE', t: 'LV', d: '2020s', s: { y: 30, t: 0.3, b: 74 }, imp: 72, ea: 71 },
  { n: "Raheem Mostert", p: 'RB', t: 'MIA', d: '2020s', s: { y: 65, c: 4.5, r: 18, t: 0.8 }, imp: 78, ea: 80 },
  { n: "Jeff Wilson Jr.", p: 'RB', t: 'MIA', d: '2020s', s: { y: 45, c: 4.2, r: 15, t: 0.4 }, imp: 72, ea: 74 },
  { n: "Braxton Berrios", p: 'WR', t: 'MIA', d: '2020s', s: { y: 35, p: 10.5, t: 0.2, c: 66 }, imp: 70, ea: 69 },
  { n: "Durham Smythe", p: 'TE', t: 'MIA', d: '2020s', s: { y: 30, t: 0.2, b: 78 }, imp: 71, ea: 70 },
  { n: "Jalen Nailor", p: 'WR', t: 'MIN', d: '2020s', s: { y: 40, p: 13.5, t: 0.3, c: 58 }, imp: 71, ea: 70 },
  { n: "Josh Oliver", p: 'TE', t: 'MIN', d: '2020s', s: { y: 25, t: 0.2, b: 80 }, imp: 72, ea: 71 },
  { n: "DeMario Douglas", p: 'WR', t: 'NE', d: '2020s', s: { y: 50, p: 10.5, t: 0.2, c: 66 }, imp: 73, ea: 72 },
  { n: "Kendrick Bourne", p: 'WR', t: 'NE', d: '2020s', s: { y: 50, p: 12, t: 0.3, c: 64 }, imp: 73, ea: 72 },
  { n: "Austin Hooper", p: 'TE', t: 'NE', d: '2020s', s: { y: 40, t: 0.3, b: 74 }, imp: 73, ea: 72 },
  { n: "Kendre Miller", p: 'RB', t: 'NO', d: '2020s', s: { y: 40, c: 4, r: 12, t: 0.3 }, imp: 71, ea: 73 },
  { n: "Jamaal Williams", p: 'RB', t: 'NO', d: '2020s', s: { y: 45, c: 3.8, r: 12, t: 0.4 }, imp: 72, ea: 74 },
  { n: "Darius Slayton", p: 'WR', t: 'NYG', d: '2020s', s: { y: 55, p: 14.5, t: 0.3, c: 54 }, imp: 74, ea: 73 },
  { n: "Daniel Bellinger", p: 'TE', t: 'NYG', d: '2020s', s: { y: 30, t: 0.2, b: 76 }, imp: 71, ea: 70 },
  { n: "Braelon Allen", p: 'RB', t: 'NYJ', d: '2020s', s: { y: 45, c: 4, r: 12, t: 0.4 }, imp: 72, ea: 74 },
  { n: "Israel Abanikanda", p: 'RB', t: 'NYJ', d: '2020s', s: { y: 30, c: 4, r: 8, t: 0.3 }, imp: 69, ea: 71 },
  { n: "Jeremy Ruckert", p: 'TE', t: 'NYJ', d: '2020s', s: { y: 20, t: 0.2, b: 76 }, imp: 69, ea: 68 },
  { n: "Kenneth Gainwell", p: 'RB', t: 'PHI', d: '2020s', s: { y: 35, c: 4.2, r: 20, t: 0.3 }, imp: 71, ea: 73 },
  { n: "Jahan Dotson", p: 'WR', t: 'PHI', d: '2020s', s: { y: 40, p: 12, t: 0.3, c: 58 }, imp: 72, ea: 71 },
  { n: "Grant Calcaterra", p: 'TE', t: 'PHI', d: '2020s', s: { y: 25, t: 0.2, b: 74 }, imp: 70, ea: 69 },
  { n: "Elijah Mitchell", p: 'RB', t: 'SF', d: '2020s', s: { y: 55, c: 4.7, r: 12, t: 0.4 }, imp: 75, ea: 77 },
  { n: "Jauan Jennings", p: 'WR', t: 'SF', d: '2020s', s: { y: 50, p: 12, t: 0.4, c: 64 }, imp: 74, ea: 73 },
  { n: "Ricky Pearsall", p: 'WR', t: 'SF', d: '2020s', s: { y: 40, p: 13, t: 0.3, c: 60 }, imp: 71, ea: 70 },
  { n: "Kyle Juszczyk", p: 'TE', t: 'SF', d: '2020s', s: { y: 20, t: 0.2, b: 84 }, imp: 72, ea: 71 },
  { n: "Tony Pollard", p: 'RB', t: 'TEN', d: '2020s', s: { y: 70, c: 4.2, r: 25, t: 0.5 }, imp: 79, ea: 81 },
  { n: "Austin Ekeler", p: 'RB', t: 'WAS', d: '2020s', s: { y: 45, c: 4.2, r: 40, t: 0.4 }, imp: 76, ea: 78 },
  { n: "Rob Housler", p: 'TE', t: 'ARI', d: '2010s', s: { y: 35, t: 0.2, b: 72 }, imp: 70, ea: 70 },
  { n: "Jermaine Gresham", p: 'TE', t: 'ARI', d: '2010s', s: { y: 35, t: 0.3, b: 76 }, imp: 72, ea: 72 },
  { n: "Troy Niklas", p: 'TE', t: 'ARI', d: '2010s', s: { y: 20, t: 0.2, b: 74 }, imp: 68, ea: 68 },
  { n: "Ed Dickson", p: 'TE', t: 'CAR', d: '2010s', s: { y: 35, t: 0.2, b: 76 }, imp: 71, ea: 71 },
  { n: "Alshon Jeffery", p: 'WR', t: 'CHI', d: '2010s', s: { y: 75, p: 14, t: 0.5, c: 58 }, imp: 81, ea: 81 },
  { n: "Joe Mixon", p: 'RB', t: 'CIN', d: '2010s', s: { y: 75, c: 4.1, r: 25, t: 0.5 }, imp: 80, ea: 81 },
  { n: "Giovani Bernard", p: 'RB', t: 'CIN', d: '2010s', s: { y: 50, c: 4.1, r: 40, t: 0.4 }, imp: 76, ea: 77 },
  { n: "Jeremy Hill", p: 'RB', t: 'CIN', d: '2010s', s: { y: 65, c: 4, r: 12, t: 0.6 }, imp: 76, ea: 77 },
  { n: "BenJarvus Green-Ellis", p: 'RB', t: 'CIN', d: '2010s', s: { y: 60, c: 3.8, r: 8, t: 0.5 }, imp: 74, ea: 75 },
  { n: "Gavin Escobar", p: 'TE', t: 'DAL', d: '2010s', s: { y: 20, t: 0.3, b: 74 }, imp: 68, ea: 68 },
  { n: "Will Fuller", p: 'WR', t: 'HOU', d: '2010s', s: { y: 55, p: 15.5, t: 0.4, c: 54 }, imp: 76, ea: 76 },
  { n: "Kenny Stills", p: 'WR', t: 'HOU', d: '2010s', s: { y: 45, p: 14.5, t: 0.3, c: 54 }, imp: 72, ea: 72 },
  { n: "T.J. Yeldon", p: 'RB', t: 'JAX', d: '2010s', s: { y: 55, c: 3.9, r: 30, t: 0.3 }, imp: 74, ea: 75 },
  { n: "Chris Ivory", p: 'RB', t: 'JAX', d: '2010s', s: { y: 55, c: 3.8, r: 12, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Austin Ekeler", p: 'RB', t: 'LAC', d: '2010s', s: { y: 55, c: 4.5, r: 45, t: 0.6 }, imp: 80, ea: 81 },
  { n: "Justin Jackson", p: 'RB', t: 'LAC', d: '2010s', s: { y: 40, c: 4.4, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Mike Williams", p: 'WR', t: 'LAC', d: '2010s', s: { y: 60, p: 16.5, t: 0.5, c: 52 }, imp: 78, ea: 78 },
  { n: "Malcolm Brown", p: 'RB', t: 'LAR', d: '2010s', s: { y: 40, c: 4, r: 15, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Gerald Everett", p: 'TE', t: 'LAR', d: '2010s', s: { y: 40, t: 0.3, b: 72 }, imp: 73, ea: 73 },
  { n: "Mike Gesicki", p: 'TE', t: 'MIA', d: '2010s', s: { y: 45, t: 0.4, b: 68 }, imp: 74, ea: 74 },
  { n: "David Morgan", p: 'TE', t: 'MIN', d: '2010s', s: { y: 15, t: 0.1, b: 80 }, imp: 68, ea: 68 },
  { n: "Golden Tate", p: 'WR', t: 'NYG', d: '2010s', s: { y: 55, p: 10.5, t: 0.3, c: 66 }, imp: 74, ea: 74 },
  { n: "Chris Herndon", p: 'TE', t: 'NYJ', d: '2010s', s: { y: 40, t: 0.4, b: 74 }, imp: 73, ea: 73 },
  { n: "Doug Martin", p: 'RB', t: 'LV', d: '2010s', s: { y: 50, c: 3.8, r: 12, t: 0.3 }, imp: 72, ea: 73 },
  { n: "Michael Crabtree", p: 'WR', t: 'LV', d: '2010s', s: { y: 65, p: 11.5, t: 0.5, c: 60 }, imp: 78, ea: 78 },
  { n: "Lee Smith", p: 'TE', t: 'LV', d: '2010s', s: { y: 15, t: 0.2, b: 82 }, imp: 69, ea: 69 },
  { n: "Nelson Agholor", p: 'WR', t: 'PHI', d: '2010s', s: { y: 55, p: 11.5, t: 0.4, c: 62 }, imp: 74, ea: 74 },
  { n: "Danny Woodhead", p: 'RB', t: 'LAC', d: '2010s', s: { y: 40, c: 4.3, r: 45, t: 0.5 }, imp: 75, ea: 76 },
  { n: "Zac Stacy", p: 'RB', t: 'LAR', d: '2010s', s: { y: 65, c: 3.9, r: 12, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Chris Thompson", p: 'RB', t: 'WAS', d: '2010s', s: { y: 35, c: 4.2, r: 45, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Jamison Crowder", p: 'WR', t: 'WAS', d: '2010s', s: { y: 55, p: 10.5, t: 0.3, c: 66 }, imp: 74, ea: 74 },
  { n: "Freddie Jones", p: 'TE', t: 'ARI', d: '2000s', s: { y: 40, t: 0.3, b: 74 }, imp: 72, ea: 73 },
  { n: "Leonard Pope", p: 'TE', t: 'ARI', d: '2000s', s: { y: 30, t: 0.3, b: 74 }, imp: 70, ea: 71 },
  { n: "Ben Patrick", p: 'TE', t: 'ARI', d: '2000s', s: { y: 25, t: 0.3, b: 74 }, imp: 69, ea: 70 },
  { n: "Brian Finneran", p: 'WR', t: 'ATL', d: '2000s', s: { y: 45, p: 12.5, t: 0.3, c: 58 }, imp: 72, ea: 73 },
  { n: "Peerless Price", p: 'WR', t: 'ATL', d: '2000s', s: { y: 55, p: 14, t: 0.4, c: 54 }, imp: 74, ea: 75 },
  { n: "Laurent Robinson", p: 'WR', t: 'ATL', d: '2000s', s: { y: 45, p: 13, t: 0.3, c: 56 }, imp: 71, ea: 72 },
  { n: "Josh Reed", p: 'WR', t: 'BUF', d: '2000s', s: { y: 45, p: 11.5, t: 0.2, c: 60 }, imp: 71, ea: 72 },
  { n: "Jay Riemersma", p: 'TE', t: 'BUF', d: '2000s', s: { y: 40, t: 0.4, b: 76 }, imp: 72, ea: 73 },
  { n: "Kris Mangum", p: 'TE', t: 'CAR', d: '2000s', s: { y: 30, t: 0.2, b: 76 }, imp: 70, ea: 71 },
  { n: "Tony Stewart", p: 'TE', t: 'CIN', d: '2000s', s: { y: 20, t: 0.2, b: 76 }, imp: 68, ea: 69 },
  { n: "Jamal Lewis", p: 'RB', t: 'CLE', d: '2000s', s: { y: 80, c: 3.8, r: 12, t: 0.5 }, imp: 79, ea: 80 },
  { n: "Steve Heiden", p: 'TE', t: 'CLE', d: '2000s', s: { y: 30, t: 0.3, b: 76 }, imp: 71, ea: 72 },
  { n: "Terry Glenn", p: 'WR', t: 'DAL', d: '2000s', s: { y: 65, p: 15.5, t: 0.4, c: 56 }, imp: 78, ea: 79 },
  { n: "Casey FitzSimmons", p: 'TE', t: 'DET', d: '2000s', s: { y: 25, t: 0.3, b: 74 }, imp: 69, ea: 70 },
  { n: "James Jones", p: 'WR', t: 'GB', d: '2000s', s: { y: 50, p: 13.5, t: 0.4, c: 58 }, imp: 74, ea: 75 },
  { n: "Robert Ferguson", p: 'WR', t: 'GB', d: '2000s', s: { y: 40, p: 13, t: 0.3, c: 56 }, imp: 70, ea: 71 },
  { n: "Antonio Freeman", p: 'WR', t: 'GB', d: '2000s', s: { y: 60, p: 14, t: 0.5, c: 56 }, imp: 77, ea: 78 },
  { n: "Steve Slaton", p: 'RB', t: 'HOU', d: '2000s', s: { y: 70, c: 4.5, r: 30, t: 0.5 }, imp: 77, ea: 78 },
  { n: "Matt Jones", p: 'WR', t: 'JAX', d: '2000s', s: { y: 50, p: 13, t: 0.3, c: 58 }, imp: 73, ea: 74 },
  { n: "Kyle Brady", p: 'TE', t: 'JAX', d: '2000s', s: { y: 25, t: 0.3, b: 82 }, imp: 71, ea: 72 },
  { n: "Dwayne Bowe", p: 'WR', t: 'KC', d: '2000s', s: { y: 70, p: 14, t: 0.5, c: 56 }, imp: 79, ea: 80 },
  { n: "Jason Dunn", p: 'TE', t: 'KC', d: '2000s', s: { y: 15, t: 0.2, b: 82 }, imp: 69, ea: 70 },
  { n: "Chris Chambers", p: 'WR', t: 'MIA', d: '2000s', s: { y: 65, p: 14.5, t: 0.5, c: 54 }, imp: 78, ea: 79 },
  { n: "Davone Bess", p: 'WR', t: 'MIA', d: '2000s', s: { y: 50, p: 10.5, t: 0.2, c: 66 }, imp: 72, ea: 73 },
  { n: "Bobby Wade", p: 'WR', t: 'MIN', d: '2000s', s: { y: 50, p: 11.5, t: 0.3, c: 60 }, imp: 71, ea: 72 },
  { n: "Billy Miller", p: 'TE', t: 'NO', d: '2000s', s: { y: 35, t: 0.3, b: 74 }, imp: 71, ea: 72 },
  { n: "LaMont Jordan", p: 'RB', t: 'LV', d: '2000s', s: { y: 70, c: 4, r: 30, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Michael Bush", p: 'RB', t: 'LV', d: '2000s', s: { y: 60, c: 4.2, r: 18, t: 0.5 }, imp: 75, ea: 76 },
  { n: "Ronald Curry", p: 'WR', t: 'LV', d: '2000s', s: { y: 45, p: 12.5, t: 0.3, c: 58 }, imp: 71, ea: 72 },
  { n: "Zach Miller", p: 'TE', t: 'LV', d: '2000s', s: { y: 50, t: 0.4, b: 76 }, imp: 77, ea: 78 },
  { n: "Courtney Anderson", p: 'TE', t: 'LV', d: '2000s', s: { y: 25, t: 0.2, b: 74 }, imp: 68, ea: 69 },
  { n: "John Madsen", p: 'TE', t: 'LV', d: '2000s', s: { y: 20, t: 0.2, b: 74 }, imp: 67, ea: 68 },
  { n: "Duce Staley", p: 'RB', t: 'PHI', d: '2000s', s: { y: 70, c: 4, r: 30, t: 0.4 }, imp: 77, ea: 78 },
  { n: "Brent Celek", p: 'TE', t: 'PHI', d: '2000s', s: { y: 45, t: 0.4, b: 78 }, imp: 76, ea: 77 },
  { n: "Chad Lewis", p: 'TE', t: 'PHI', d: '2000s', s: { y: 40, t: 0.4, b: 76 }, imp: 73, ea: 74 },
  { n: "Jerome Bettis", p: 'RB', t: 'PIT', d: '2000s', s: { y: 70, c: 3.7, r: 8, t: 0.7 }, imp: 80, ea: 81 },
  { n: "Jerame Tuman", p: 'TE', t: 'PIT', d: '2000s', s: { y: 20, t: 0.2, b: 78 }, imp: 68, ea: 69 },
  { n: "Michael Turner", p: 'RB', t: 'LAC', d: '2000s', s: { y: 50, c: 5.5, r: 8, t: 0.4 }, imp: 75, ea: 76 },
  { n: "Darren Sproles", p: 'RB', t: 'LAC', d: '2000s', s: { y: 40, c: 4.5, r: 40, t: 0.4 }, imp: 76, ea: 77 },
  { n: "Arnaz Battle", p: 'WR', t: 'SF', d: '2000s', s: { y: 45, p: 11.5, t: 0.3, c: 60 }, imp: 71, ea: 72 },
  { n: "Randy McMichael", p: 'TE', t: 'LAR', d: '2000s', s: { y: 40, t: 0.3, b: 76 }, imp: 73, ea: 74 },
  { n: "Daniel Fells", p: 'TE', t: 'LAR', d: '2000s', s: { y: 30, t: 0.3, b: 74 }, imp: 70, ea: 71 },
  { n: "Roland Williams", p: 'TE', t: 'LAR', d: '2000s', s: { y: 25, t: 0.3, b: 78 }, imp: 70, ea: 71 },
  { n: "Alex Smith", p: 'TE', t: 'TB', d: '2000s', s: { y: 30, t: 0.3, b: 76 }, imp: 71, ea: 72 },
  { n: "Clinton Portis", p: 'RB', t: 'WAS', d: '2000s', s: { y: 85, c: 4.1, r: 18, t: 0.7 }, imp: 82, ea: 83 },
  { n: "Fred Davis", p: 'TE', t: 'WAS', d: '2000s', s: { y: 40, t: 0.4, b: 72 }, imp: 73, ea: 74 },
  { n: "Derek Ware", p: 'TE', t: 'ARI', d: '1990s', s: { y: 25, t: 0.3, b: 78 }, imp: 70, ea: 72 },
  { n: "Chris Gedney", p: 'TE', t: 'ARI', d: '1990s', s: { y: 25, t: 0.2, b: 76 }, imp: 69, ea: 71 },
  { n: "P.J. Franklin", p: 'TE', t: 'ARI', d: '1990s', s: { y: 20, t: 0.2, b: 74 }, imp: 67, ea: 69 },
  { n: "Terance Mathis", p: 'WR', t: 'ATL', d: '1990s', s: { y: 70, p: 13, t: 0.5, c: 58 }, imp: 79, ea: 81 },
  { n: "Brian Kozlowski", p: 'TE', t: 'ATL', d: '1990s', s: { y: 20, t: 0.2, b: 78 }, imp: 68, ea: 70 },
  { n: "Ed West", p: 'TE', t: 'ATL', d: '1990s', s: { y: 25, t: 0.3, b: 80 }, imp: 71, ea: 73 },
  { n: "Mitch Lyons", p: 'TE', t: 'ATL', d: '1990s', s: { y: 20, t: 0.2, b: 76 }, imp: 67, ea: 69 },
  { n: "Priest Holmes", p: 'RB', t: 'BAL', d: '1990s', s: { y: 65, c: 4.2, r: 25, t: 0.4 }, imp: 77, ea: 78 },
  { n: "Bam Morris", p: 'RB', t: 'BAL', d: '1990s', s: { y: 60, c: 3.7, r: 12, t: 0.5 }, imp: 73, ea: 74 },
  { n: "Jermaine Lewis", p: 'WR', t: 'BAL', d: '1990s', s: { y: 45, p: 13, t: 0.3, c: 56 }, imp: 71, ea: 73 },
  { n: "Brian Kinchen", p: 'TE', t: 'BAL', d: '1990s', s: { y: 30, t: 0.3, b: 76 }, imp: 70, ea: 72 },
  { n: "Antowain Smith", p: 'RB', t: 'BUF', d: '1990s', s: { y: 65, c: 3.8, r: 12, t: 0.5 }, imp: 75, ea: 76 },
  { n: "Kenneth Davis", p: 'RB', t: 'BUF', d: '1990s', s: { y: 45, c: 3.9, r: 15, t: 0.6 }, imp: 72, ea: 73 },
  { n: "Jay Riemersma", p: 'TE', t: 'BUF', d: '1990s', s: { y: 35, t: 0.4, b: 76 }, imp: 72, ea: 74 },
  { n: "Greg Clark", p: 'TE', t: 'CAR', d: '1990s', s: { y: 25, t: 0.2, b: 76 }, imp: 69, ea: 71 },
  { n: "Ryan Wetnight", p: 'TE', t: 'CHI', d: '1990s', s: { y: 30, t: 0.2, b: 74 }, imp: 70, ea: 72 },
  { n: "Ki-Jana Carter", p: 'RB', t: 'CIN', d: '1990s', s: { y: 50, c: 3.6, r: 12, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Darnay Scott", p: 'WR', t: 'CIN', d: '1990s', s: { y: 60, p: 15, t: 0.4, c: 52 }, imp: 76, ea: 78 },
  { n: "David Dunn", p: 'WR', t: 'CIN', d: '1990s', s: { y: 40, p: 13, t: 0.3, c: 54 }, imp: 70, ea: 72 },
  { n: "Michael Jackson", p: 'WR', t: 'CLE', d: '1990s', s: { y: 60, p: 15, t: 0.5, c: 52 }, imp: 76, ea: 78 },
  { n: "Andre Rison", p: 'WR', t: 'CLE', d: '1990s', s: { y: 60, p: 13, t: 0.4, c: 56 }, imp: 75, ea: 77 },
  { n: "Mark Bavaro", p: 'TE', t: 'CLE', d: '1990s', s: { y: 35, t: 0.3, b: 80 }, imp: 73, ea: 75 },
  { n: "Rocket Ismail", p: 'WR', t: 'DAL', d: '1990s', s: { y: 55, p: 15.5, t: 0.4, c: 52 }, imp: 75, ea: 77 },
  { n: "Kevin Williams", p: 'WR', t: 'DAL', d: '1990s', s: { y: 45, p: 13, t: 0.3, c: 56 }, imp: 71, ea: 73 },
  { n: "Billy Davis", p: 'WR', t: 'DAL', d: '1990s', s: { y: 35, p: 13.5, t: 0.3, c: 54 }, imp: 69, ea: 71 },
  { n: "Greg Hill", p: 'RB', t: 'DET', d: '1990s', s: { y: 45, c: 3.7, r: 12, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Ron Rivers", p: 'RB', t: 'DET', d: '1990s', s: { y: 35, c: 4, r: 18, t: 0.3 }, imp: 69, ea: 70 },
  { n: "David Sloan", p: 'TE', t: 'DET', d: '1990s', s: { y: 35, t: 0.3, b: 76 }, imp: 71, ea: 73 },
  { n: "Pete Metzelaars", p: 'TE', t: 'DET', d: '1990s', s: { y: 25, t: 0.2, b: 80 }, imp: 69, ea: 71 },
  { n: "Pat Coleman", p: 'TE', t: 'TEN', d: '1990s', s: { y: 25, t: 0.2, b: 74 }, imp: 68, ea: 70 },
  { n: "Pat Carter", p: 'TE', t: 'TEN', d: '1990s', s: { y: 20, t: 0.2, b: 80 }, imp: 68, ea: 70 },
  { n: "Ken Dilger", p: 'TE', t: 'IND', d: '1990s', s: { y: 45, t: 0.4, b: 78 }, imp: 75, ea: 77 },
  { n: "Rich Griffith", p: 'TE', t: 'JAX', d: '1990s', s: { y: 20, t: 0.2, b: 76 }, imp: 67, ea: 69 },
  { n: "Derrick Walker", p: 'TE', t: 'KC', d: '1990s', s: { y: 30, t: 0.3, b: 76 }, imp: 70, ea: 72 },
  { n: "David Lang", p: 'RB', t: 'LAR', d: '1990s', s: { y: 35, c: 3.8, r: 18, t: 0.3 }, imp: 69, ea: 70 },
  { n: "Henry Ellard", p: 'WR', t: 'LAR', d: '1990s', s: { y: 70, p: 16.5, t: 0.4, c: 52 }, imp: 79, ea: 81 },
  { n: "Flipper Anderson", p: 'WR', t: 'LAR', d: '1990s', s: { y: 60, p: 17, t: 0.4, c: 50 }, imp: 76, ea: 78 },
  { n: "Todd Kinchen", p: 'WR', t: 'LAR', d: '1990s', s: { y: 40, p: 14, t: 0.3, c: 52 }, imp: 70, ea: 72 },
  { n: "Fred Barnett", p: 'WR', t: 'MIA', d: '1990s', s: { y: 50, p: 14, t: 0.3, c: 54 }, imp: 73, ea: 75 },
  { n: "Troy Drayton", p: 'TE', t: 'MIA', d: '1990s', s: { y: 40, t: 0.4, b: 74 }, imp: 73, ea: 75 },
  { n: "Terry Allen", p: 'RB', t: 'MIN', d: '1990s', s: { y: 75, c: 3.9, r: 18, t: 0.6 }, imp: 78, ea: 79 },
  { n: "Lovett Purnell", p: 'TE', t: 'NE', d: '1990s', s: { y: 15, t: 0.2, b: 76 }, imp: 67, ea: 69 },
  { n: "Ike Hilliard", p: 'WR', t: 'NYG', d: '1990s', s: { y: 55, p: 11.5, t: 0.3, c: 60 }, imp: 74, ea: 76 },
  { n: "Kyle Brady", p: 'TE', t: 'NYJ', d: '1990s', s: { y: 30, t: 0.3, b: 82 }, imp: 72, ea: 74 },
  { n: "Fred Baxter", p: 'TE', t: 'NYJ', d: '1990s', s: { y: 20, t: 0.2, b: 78 }, imp: 68, ea: 70 },
  { n: "Napoleon Kaufman", p: 'RB', t: 'LV', d: '1990s', s: { y: 70, c: 4.6, r: 25, t: 0.3 }, imp: 77, ea: 78 },
  { n: "Rickey Dudley", p: 'TE', t: 'LV', d: '1990s', s: { y: 45, t: 0.5, b: 74 }, imp: 75, ea: 77 },
  { n: "Andrew Glover", p: 'TE', t: 'LV', d: '1990s', s: { y: 35, t: 0.4, b: 76 }, imp: 72, ea: 74 },
  { n: "Derek Brown", p: 'TE', t: 'LV', d: '1990s', s: { y: 20, t: 0.2, b: 76 }, imp: 68, ea: 70 },
  { n: "Chad Lewis", p: 'TE', t: 'PHI', d: '1990s', s: { y: 40, t: 0.4, b: 76 }, imp: 73, ea: 75 },
  { n: "Charlie Joiner", p: 'WR', t: 'LAC', d: '1990s', s: { y: 45, p: 13.5, t: 0.3, c: 56 }, imp: 71, ea: 73 },
  { n: "Alfred Pupunu", p: 'TE', t: 'LAC', d: '1990s', s: { y: 30, t: 0.3, b: 74 }, imp: 70, ea: 72 },
  { n: "Freddie Jones", p: 'TE', t: 'LAC', d: '1990s', s: { y: 45, t: 0.4, b: 74 }, imp: 74, ea: 76 },
  { n: "J.J. Stokes", p: 'WR', t: 'SF', d: '1990s', s: { y: 55, p: 13.5, t: 0.4, c: 56 }, imp: 74, ea: 76 },
  { n: "Greg Clark", p: 'TE', t: 'SF', d: '1990s', s: { y: 30, t: 0.3, b: 78 }, imp: 71, ea: 73 },
  { n: "Ernie Conwell", p: 'TE', t: 'LAR', d: '1990s', s: { y: 35, t: 0.3, b: 76 }, imp: 71, ea: 73 },
  { n: "Rodney Thomas", p: 'RB', t: 'TEN', d: '1990s', s: { y: 45, c: 3.7, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Lorenzo Neal", p: 'RB', t: 'TEN', d: '1990s', s: { y: 35, c: 3.6, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Kevin Dyson", p: 'WR', t: 'TEN', d: '1990s', s: { y: 50, p: 13.5, t: 0.4, c: 56 }, imp: 73, ea: 75 },
  { n: "Willie Davis", p: 'WR', t: 'TEN', d: '1990s', s: { y: 45, p: 14.5, t: 0.3, c: 54 }, imp: 71, ea: 73 },
  { n: "Chris Sanders", p: 'WR', t: 'TEN', d: '1990s', s: { y: 50, p: 16, t: 0.4, c: 52 }, imp: 73, ea: 75 },
  { n: "Jackie Harris", p: 'TE', t: 'TEN', d: '1990s', s: { y: 35, t: 0.3, b: 76 }, imp: 72, ea: 74 },
  { n: "Lynn Cain", p: 'RB', t: 'ATL', d: '1980s', s: { y: 50, c: 3.8, r: 18, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Alfred Jackson", p: 'TE', t: 'ATL', d: '1980s', s: { y: 30, t: 0.3, b: 76 }, imp: 70, ea: 73 },
  { n: "Ken Whisenhunt", p: 'TE', t: 'ATL', d: '1980s', s: { y: 25, t: 0.3, b: 78 }, imp: 70, ea: 73 },
  { n: "Curtis Dickey", p: 'RB', t: 'IND', d: '1980s', s: { y: 70, c: 4.2, r: 18, t: 0.5 }, imp: 76, ea: 77 },
  { n: "Randy McMillan", p: 'RB', t: 'IND', d: '1980s', s: { y: 65, c: 3.9, r: 18, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Zachary Dixon", p: 'RB', t: 'IND', d: '1980s', s: { y: 40, c: 3.8, r: 15, t: 0.3 }, imp: 69, ea: 70 },
  { n: "Don McCauley", p: 'RB', t: 'IND', d: '1980s', s: { y: 35, c: 3.7, r: 18, t: 0.3 }, imp: 69, ea: 70 },
  { n: "Roger Carr", p: 'WR', t: 'IND', d: '1980s', s: { y: 50, p: 17, t: 0.4, c: 46 }, imp: 73, ea: 76 },
  { n: "Ray Butler", p: 'WR', t: 'IND', d: '1980s', s: { y: 50, p: 16.5, t: 0.4, c: 48 }, imp: 72, ea: 75 },
  { n: "Reese McCall", p: 'WR', t: 'IND', d: '1980s', s: { y: 35, p: 14, t: 0.2, c: 50 }, imp: 69, ea: 72 },
  { n: "Tim Sherwin", p: 'TE', t: 'IND', d: '1980s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 71 },
  { n: "Ozzie Newsome", p: 'TE', t: 'IND', d: '1980s', s: { y: 30, t: 0.3, b: 78 }, imp: 71, ea: 74 },
  { n: "Pete Metzelaars", p: 'TE', t: 'BUF', d: '1980s', s: { y: 30, t: 0.3, b: 80 }, imp: 71, ea: 74 },
  { n: "Butch Rolle", p: 'TE', t: 'BUF', d: '1980s', s: { y: 15, t: 0.2, b: 80 }, imp: 67, ea: 70 },
  { n: "Willie Gault", p: 'WR', t: 'CHI', d: '1980s', s: { y: 55, p: 18, t: 0.4, c: 48 }, imp: 77, ea: 80 },
  { n: "Dennis McKinnon", p: 'WR', t: 'CHI', d: '1980s', s: { y: 45, p: 14.5, t: 0.4, c: 52 }, imp: 72, ea: 75 },
  { n: "Dennis Gentry", p: 'WR', t: 'CHI', d: '1980s', s: { y: 35, p: 14, t: 0.3, c: 54 }, imp: 70, ea: 73 },
  { n: "Ron Morris", p: 'WR', t: 'CHI', d: '1980s', s: { y: 40, p: 14, t: 0.3, c: 54 }, imp: 70, ea: 73 },
  { n: "Brad Muster", p: 'WR', t: 'CHI', d: '1980s', s: { y: 30, p: 8.5, t: 0.2, c: 62 }, imp: 69, ea: 72 },
  { n: "Emery Moorehead", p: 'TE', t: 'CHI', d: '1980s', s: { y: 35, t: 0.3, b: 78 }, imp: 72, ea: 75 },
  { n: "Tim Wrightman", p: 'TE', t: 'CHI', d: '1980s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 71 },
  { n: "Cap Boso", p: 'TE', t: 'CHI', d: '1980s', s: { y: 25, t: 0.3, b: 74 }, imp: 68, ea: 71 },
  { n: "Brian Brennan", p: 'WR', t: 'CLE', d: '1980s', s: { y: 50, p: 12.5, t: 0.3, c: 60 }, imp: 73, ea: 76 },
  { n: "Reggie Langhorne", p: 'WR', t: 'CLE', d: '1980s', s: { y: 50, p: 13.5, t: 0.3, c: 56 }, imp: 73, ea: 76 },
  { n: "Ricky Feacher", p: 'WR', t: 'CLE', d: '1980s', s: { y: 40, p: 15.5, t: 0.3, c: 50 }, imp: 70, ea: 73 },
  { n: "Harry Holt", p: 'TE', t: 'CLE', d: '1980s', s: { y: 30, t: 0.3, b: 76 }, imp: 70, ea: 73 },
  { n: "Jay Saldi", p: 'TE', t: 'DAL', d: '1980s', s: { y: 20, t: 0.2, b: 78 }, imp: 68, ea: 71 },
  { n: "Clarence Kay", p: 'TE', t: 'DEN', d: '1980s', s: { y: 30, t: 0.3, b: 78 }, imp: 71, ea: 74 },
  { n: "Orson Mobley", p: 'TE', t: 'DEN', d: '1980s', s: { y: 25, t: 0.2, b: 78 }, imp: 69, ea: 72 },
  { n: "Riley Odoms", p: 'TE', t: 'DEN', d: '1980s', s: { y: 30, t: 0.3, b: 78 }, imp: 72, ea: 75 },
  { n: "Leonard Thompson", p: 'WR', t: 'DET', d: '1980s', s: { y: 50, p: 16, t: 0.4, c: 50 }, imp: 73, ea: 76 },
  { n: "Pete Mandley", p: 'WR', t: 'DET', d: '1980s', s: { y: 45, p: 13, t: 0.4, c: 54 }, imp: 71, ea: 74 },
  { n: "Mark Nichols", p: 'WR', t: 'DET', d: '1980s', s: { y: 40, p: 16, t: 0.3, c: 48 }, imp: 70, ea: 73 },
  { n: "Jeff Chadwick", p: 'WR', t: 'DET', d: '1980s', s: { y: 45, p: 16.5, t: 0.3, c: 50 }, imp: 71, ea: 74 },
  { n: "Carl Bland", p: 'WR', t: 'DET', d: '1980s', s: { y: 30, p: 13.5, t: 0.2, c: 52 }, imp: 68, ea: 71 },
  { n: "David Lewis", p: 'TE', t: 'DET', d: '1980s', s: { y: 35, t: 0.3, b: 74 }, imp: 70, ea: 73 },
  { n: "Jimmie Giles", p: 'TE', t: 'DET', d: '1980s', s: { y: 25, t: 0.3, b: 78 }, imp: 70, ea: 73 },
  { n: "Gerry Ellis", p: 'RB', t: 'GB', d: '1980s', s: { y: 55, c: 4.1, r: 30, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Eddie Lee Ivery", p: 'RB', t: 'GB', d: '1980s', s: { y: 50, c: 4.2, r: 20, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Paul Ott Carruth", p: 'RB', t: 'GB', d: '1980s', s: { y: 40, c: 3.7, r: 15, t: 0.4 }, imp: 70, ea: 71 },
  { n: "Brent Fullwood", p: 'RB', t: 'GB', d: '1980s', s: { y: 50, c: 4, r: 12, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Phillip Epps", p: 'WR', t: 'GB', d: '1980s', s: { y: 45, p: 14.5, t: 0.3, c: 52 }, imp: 71, ea: 74 },
  { n: "Walter Stanley", p: 'WR', t: 'GB', d: '1980s', s: { y: 40, p: 14, t: 0.3, c: 52 }, imp: 70, ea: 73 },
  { n: "Paul Coffman", p: 'TE', t: 'GB', d: '1980s', s: { y: 45, t: 0.4, b: 76 }, imp: 75, ea: 78 },
  { n: "Ed West", p: 'TE', t: 'GB', d: '1980s', s: { y: 25, t: 0.3, b: 80 }, imp: 70, ea: 73 },
  { n: "Keith Jackson", p: 'TE', t: 'GB', d: '1980s', s: { y: 20, t: 0.2, b: 76 }, imp: 69, ea: 72 },
  { n: "Chris Dressel", p: 'TE', t: 'TEN', d: '1980s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 71 },
  { n: "Albert Bentley", p: 'RB', t: 'IND', d: '1980s', s: { y: 50, c: 4, r: 30, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Mark Boyer", p: 'TE', t: 'IND', d: '1980s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 71 },
  { n: "Herman Heard", p: 'RB', t: 'KC', d: '1980s', s: { y: 55, c: 4.1, r: 25, t: 0.4 }, imp: 73, ea: 74 },
  { n: "Mike Pruitt", p: 'RB', t: 'KC', d: '1980s', s: { y: 45, c: 3.8, r: 12, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Jonathan Hayes", p: 'TE', t: 'KC', d: '1980s', s: { y: 30, t: 0.3, b: 78 }, imp: 71, ea: 74 },
  { n: "Walt Arnold", p: 'TE', t: 'KC', d: '1980s', s: { y: 25, t: 0.2, b: 74 }, imp: 68, ea: 71 },
  { n: "Bruce Hardy", p: 'TE', t: 'MIA', d: '1980s', s: { y: 30, t: 0.3, b: 78 }, imp: 71, ea: 74 },
  { n: "Dan Johnson", p: 'TE', t: 'MIA', d: '1980s', s: { y: 25, t: 0.3, b: 76 }, imp: 69, ea: 72 },
  { n: "Leo Lewis", p: 'WR', t: 'MIN', d: '1980s', s: { y: 45, p: 15, t: 0.3, c: 52 }, imp: 72, ea: 75 },
  { n: "Mike Mularkey", p: 'TE', t: 'MIN', d: '1980s', s: { y: 25, t: 0.3, b: 78 }, imp: 69, ea: 72 },
  { n: "Irving Fryar", p: 'WR', t: 'NE', d: '1980s', s: { y: 55, p: 15.5, t: 0.4, c: 54 }, imp: 77, ea: 80 },
  { n: "Stephen Starring", p: 'WR', t: 'NE', d: '1980s', s: { y: 40, p: 16, t: 0.3, c: 48 }, imp: 70, ea: 73 },
  { n: "Cedric Jones", p: 'WR', t: 'NE', d: '1980s', s: { y: 35, p: 14, t: 0.3, c: 52 }, imp: 69, ea: 72 },
  { n: "Lin Dawson", p: 'TE', t: 'NE', d: '1980s', s: { y: 25, t: 0.3, b: 78 }, imp: 70, ea: 73 },
  { n: "Brett Perriman", p: 'WR', t: 'NO', d: '1980s', s: { y: 40, p: 12.5, t: 0.3, c: 56 }, imp: 70, ea: 73 },
  { n: "John Tice", p: 'TE', t: 'NO', d: '1980s', s: { y: 25, t: 0.3, b: 78 }, imp: 69, ea: 72 },
  { n: "Johnny Hector", p: 'RB', t: 'NYJ', d: '1980s', s: { y: 50, c: 4.2, r: 18, t: 0.6 }, imp: 73, ea: 74 },
  { n: "Rocky Klever", p: 'TE', t: 'NYJ', d: '1980s', s: { y: 20, t: 0.2, b: 76 }, imp: 67, ea: 70 },
  { n: "Jerome Barkum", p: 'TE', t: 'NYJ', d: '1980s', s: { y: 30, t: 0.3, b: 76 }, imp: 70, ea: 73 },
  { n: "Stump Mitchell", p: 'RB', t: 'ARI', d: '1980s', s: { y: 55, c: 4.4, r: 25, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Earl Ferrell", p: 'RB', t: 'ARI', d: '1980s', s: { y: 55, c: 3.9, r: 30, t: 0.5 }, imp: 73, ea: 74 },
  { n: "Tony Jordan", p: 'RB', t: 'ARI', d: '1980s', s: { y: 35, c: 3.7, r: 15, t: 0.3 }, imp: 69, ea: 70 },
  { n: "Vai Sikahema", p: 'RB', t: 'ARI', d: '1980s', s: { y: 30, c: 4, r: 18, t: 0.2 }, imp: 69, ea: 70 },
  { n: "J.T. Smith", p: 'WR', t: 'ARI', d: '1980s', s: { y: 65, p: 12.5, t: 0.4, c: 62 }, imp: 77, ea: 80 },
  { n: "Ernie Jones", p: 'WR', t: 'ARI', d: '1980s', s: { y: 45, p: 16, t: 0.3, c: 50 }, imp: 71, ea: 74 },
  { n: "Ron Wolfley", p: 'WR', t: 'ARI', d: '1980s', s: { y: 20, p: 8, t: 0.1, c: 58 }, imp: 66, ea: 69 },
  { n: "Robert Awalt", p: 'TE', t: 'ARI', d: '1980s', s: { y: 35, t: 0.3, b: 76 }, imp: 71, ea: 74 },
  { n: "Jay Novacek", p: 'TE', t: 'ARI', d: '1980s', s: { y: 35, t: 0.3, b: 76 }, imp: 73, ea: 76 },
  { n: "Walter Abercrombie", p: 'RB', t: 'PIT', d: '1980s', s: { y: 55, c: 3.8, r: 18, t: 0.4 }, imp: 72, ea: 73 },
  { n: "Louis Lipps", p: 'WR', t: 'PIT', d: '1980s', s: { y: 65, p: 15.5, t: 0.5, c: 54 }, imp: 79, ea: 82 },
  { n: "Calvin Sweeney", p: 'WR', t: 'PIT', d: '1980s', s: { y: 35, p: 15, t: 0.3, c: 50 }, imp: 69, ea: 72 },
  { n: "Weegie Thompson", p: 'WR', t: 'PIT', d: '1980s', s: { y: 35, p: 15.5, t: 0.3, c: 50 }, imp: 69, ea: 72 },
  { n: "Bennie Cunningham", p: 'TE', t: 'PIT', d: '1980s', s: { y: 35, t: 0.3, b: 80 }, imp: 73, ea: 76 },
  { n: "Preston Gothard", p: 'TE', t: 'PIT', d: '1980s', s: { y: 20, t: 0.2, b: 76 }, imp: 67, ea: 70 },
  { n: "Eric Green", p: 'TE', t: 'PIT', d: '1980s', s: { y: 40, t: 0.5, b: 76 }, imp: 75, ea: 78 },
  { n: "John L. Williams", p: 'RB', t: 'SEA', d: '1980s', s: { y: 55, c: 4.1, r: 45, t: 0.4 }, imp: 76, ea: 77 },
  { n: "Mike Tice", p: 'TE', t: 'SEA', d: '1980s', s: { y: 25, t: 0.3, b: 80 }, imp: 70, ea: 73 },
  { n: "Charle Young", p: 'TE', t: 'SEA', d: '1980s', s: { y: 30, t: 0.3, b: 78 }, imp: 71, ea: 74 },
  { n: "Pat Hunter", p: 'TE', t: 'SEA', d: '1980s', s: { y: 15, t: 0.1, b: 76 }, imp: 66, ea: 69 },
  { n: "Dwight Clark", p: 'WR', t: 'SF', d: '1980s', s: { y: 60, p: 13.5, t: 0.4, c: 60 }, imp: 79, ea: 82 },
  { n: "Freddie Solomon", p: 'WR', t: 'SF', d: '1980s', s: { y: 45, p: 14.5, t: 0.4, c: 54 }, imp: 73, ea: 76 },
  { n: "Mike Wilson", p: 'WR', t: 'SF', d: '1980s', s: { y: 40, p: 14, t: 0.3, c: 56 }, imp: 71, ea: 74 },
  { n: "Pat Tilley", p: 'WR', t: 'ARI', d: '1980s', s: { y: 55, p: 13.5, t: 0.4, c: 58 }, imp: 74, ea: 77 },
  { n: "Greg LaFleur", p: 'TE', t: 'ARI', d: '1980s', s: { y: 20, t: 0.2, b: 76 }, imp: 67, ea: 70 },
  { n: "Jerry Eckwood", p: 'RB', t: 'TB', d: '1980s', s: { y: 45, c: 3.8, r: 18, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Art Malone", p: 'RB', t: 'ATL', d: '1970s', s: { y: 55, c: 3.9, r: 12, t: 0.4 }, imp: 72, ea: 72 },
  { n: "Jim Butler", p: 'RB', t: 'ATL', d: '1970s', s: { y: 45, c: 3.8, r: 10, t: 0.3 }, imp: 70, ea: 70 },
  { n: "Haskel Stanback", p: 'RB', t: 'ATL', d: '1970s', s: { y: 50, c: 3.8, r: 12, t: 0.4 }, imp: 71, ea: 71 },
  { n: "Ken Burrow", p: 'WR', t: 'ATL', d: '1970s', s: { y: 45, p: 16.5, t: 0.4, c: 46 }, imp: 71, ea: 75 },
  { n: "Alfred Jenkins", p: 'WR', t: 'ATL', d: '1970s', s: { y: 55, p: 17.5, t: 0.4, c: 48 }, imp: 75, ea: 79 },
  { n: "Billy Ryckman", p: 'WR', t: 'ATL', d: '1970s', s: { y: 30, p: 14, t: 0.2, c: 50 }, imp: 67, ea: 71 },
  { n: "Greg McCrary", p: 'TE', t: 'ATL', d: '1970s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 72 },
  { n: "Glenn Doughty", p: 'WR', t: 'IND', d: '1970s', s: { y: 45, p: 14.5, t: 0.3, c: 52 }, imp: 71, ea: 75 },
  { n: "Freddie Scott", p: 'WR', t: 'IND', d: '1970s', s: { y: 40, p: 15, t: 0.3, c: 50 }, imp: 70, ea: 74 },
  { n: "Eddie Hinton", p: 'WR', t: 'IND', d: '1970s', s: { y: 40, p: 14.5, t: 0.3, c: 52 }, imp: 70, ea: 74 },
  { n: "Raymond Chester", p: 'TE', t: 'IND', d: '1970s', s: { y: 40, t: 0.4, b: 80 }, imp: 75, ea: 79 },
  { n: "John Mackey", p: 'TE', t: 'IND', d: '1970s', s: { y: 35, t: 0.3, b: 80 }, imp: 76, ea: 80 },
  { n: "Dan Sullivan", p: 'TE', t: 'IND', d: '1970s', s: { y: 15, t: 0.1, b: 80 }, imp: 66, ea: 70 },
  { n: "Joe Kapp", p: 'QB', t: 'NE', d: '1970s', s: { y: 150, t: 0.8, i: 1.4, r: 58 , ry: 8 }, imp: 68, ea: 72 },
  { n: "Carl Garrett", p: 'RB', t: 'NE', d: '1970s', s: { y: 55, c: 4.2, r: 18, t: 0.4 }, imp: 72, ea: 72 },
  { n: "Jim Nance", p: 'RB', t: 'NE', d: '1970s', s: { y: 55, c: 3.7, r: 8, t: 0.5 }, imp: 73, ea: 73 },
  { n: "Odell Lawson", p: 'RB', t: 'NE', d: '1970s', s: { y: 35, c: 3.6, r: 10, t: 0.2 }, imp: 67, ea: 67 },
  { n: "Jim Whalen", p: 'RB', t: 'NE', d: '1970s', s: { y: 25, c: 3.5, r: 12, t: 0.2 }, imp: 65, ea: 65 },
  { n: "Ron Sellers", p: 'WR', t: 'NE', d: '1970s', s: { y: 50, p: 16, t: 0.4, c: 48 }, imp: 73, ea: 77 },
  { n: "Bake Turner", p: 'WR', t: 'NE', d: '1970s', s: { y: 40, p: 14.5, t: 0.3, c: 50 }, imp: 69, ea: 73 },
  { n: "Charlie Frazier", p: 'WR', t: 'NE', d: '1970s', s: { y: 35, p: 15, t: 0.3, c: 48 }, imp: 68, ea: 72 },
  { n: "Hubie Bryant", p: 'WR', t: 'NE', d: '1970s', s: { y: 25, p: 14, t: 0.2, c: 48 }, imp: 65, ea: 69 },
  { n: "Eric Crabtree", p: 'WR', t: 'NE', d: '1970s', s: { y: 30, p: 14.5, t: 0.2, c: 50 }, imp: 66, ea: 70 },
  { n: "Tom Beer", p: 'TE', t: 'NE', d: '1970s', s: { y: 25, t: 0.2, b: 76 }, imp: 67, ea: 71 },
  { n: "Roland Moss", p: 'TE', t: 'NE', d: '1970s', s: { y: 18, t: 0.2, b: 74 }, imp: 65, ea: 69 },
  { n: "Bob Adams", p: 'TE', t: 'NE', d: '1970s', s: { y: 15, t: 0.1, b: 74 }, imp: 64, ea: 68 },
  { n: "Jim Braxton", p: 'RB', t: 'BUF', d: '1970s', s: { y: 50, c: 3.9, r: 12, t: 0.5 }, imp: 72, ea: 72 },
  { n: "J.D. Hill", p: 'WR', t: 'BUF', d: '1970s', s: { y: 50, p: 15, t: 0.4, c: 50 }, imp: 73, ea: 77 },
  { n: "Marlin Briscoe", p: 'WR', t: 'BUF', d: '1970s', s: { y: 50, p: 15.5, t: 0.4, c: 50 }, imp: 73, ea: 77 },
  { n: "Paul Seymour", p: 'TE', t: 'BUF', d: '1970s', s: { y: 20, t: 0.2, b: 80 }, imp: 68, ea: 72 },
  { n: "Reuben Gant", p: 'TE', t: 'BUF', d: '1970s', s: { y: 30, t: 0.3, b: 78 }, imp: 70, ea: 74 },
  { n: "Jan White", p: 'TE', t: 'BUF', d: '1970s', s: { y: 20, t: 0.2, b: 76 }, imp: 66, ea: 70 },
  { n: "Roland Harper", p: 'RB', t: 'CHI', d: '1970s', s: { y: 55, c: 3.8, r: 30, t: 0.4 }, imp: 73, ea: 73 },
  { n: "Bo Rather", p: 'WR', t: 'CHI', d: '1970s', s: { y: 40, p: 15, t: 0.3, c: 50 }, imp: 69, ea: 73 },
  { n: "Steve Schubert", p: 'WR', t: 'CHI', d: '1970s', s: { y: 30, p: 14.5, t: 0.2, c: 48 }, imp: 67, ea: 71 },
  { n: "Golden Richards", p: 'WR', t: 'CHI', d: '1970s', s: { y: 35, p: 15, t: 0.3, c: 50 }, imp: 69, ea: 73 },
  { n: "Bob Parsons", p: 'TE', t: 'CHI', d: '1970s', s: { y: 20, t: 0.2, b: 76 }, imp: 66, ea: 70 },
  { n: "Archie Griffin", p: 'RB', t: 'CIN', d: '1970s', s: { y: 55, c: 4, r: 18, t: 0.3 }, imp: 73, ea: 73 },
  { n: "Chip Myers", p: 'WR', t: 'CIN', d: '1970s', s: { y: 45, p: 14.5, t: 0.3, c: 54 }, imp: 71, ea: 75 },
  { n: "Charlie Joiner", p: 'WR', t: 'CIN', d: '1970s', s: { y: 55, p: 15.5, t: 0.4, c: 54 }, imp: 77, ea: 81 },
  { n: "Bob Trumpy", p: 'TE', t: 'CIN', d: '1970s', s: { y: 45, t: 0.4, b: 78 }, imp: 76, ea: 80 },
  { n: "Bruce Coslet", p: 'TE', t: 'CIN', d: '1970s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 72 },
  { n: "Cleo Miller", p: 'RB', t: 'CLE', d: '1970s', s: { y: 45, c: 3.8, r: 18, t: 0.3 }, imp: 71, ea: 71 },
  { n: "Paul Warfield", p: 'WR', t: 'CLE', d: '1970s', s: { y: 50, p: 18, t: 0.4, c: 50 }, imp: 79, ea: 83 },
  { n: "Dave Logan", p: 'WR', t: 'CLE', d: '1970s', s: { y: 50, p: 16, t: 0.4, c: 50 }, imp: 73, ea: 77 },
  { n: "Gary Parris", p: 'TE', t: 'CLE', d: '1970s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 72 },
  { n: "Jean Fugett", p: 'TE', t: 'DAL', d: '1970s', s: { y: 30, t: 0.3, b: 78 }, imp: 72, ea: 76 },
  { n: "Rob Lytle", p: 'RB', t: 'DEN', d: '1970s', s: { y: 45, c: 4, r: 15, t: 0.3 }, imp: 71, ea: 71 },
  { n: "Haven Moses", p: 'WR', t: 'DEN', d: '1970s', s: { y: 50, p: 17, t: 0.4, c: 48 }, imp: 75, ea: 79 },
  { n: "Rick Upchurch", p: 'WR', t: 'DEN', d: '1970s', s: { y: 45, p: 15.5, t: 0.4, c: 50 }, imp: 73, ea: 77 },
  { n: "Jack Dolbin", p: 'WR', t: 'DEN', d: '1970s', s: { y: 35, p: 16, t: 0.3, c: 48 }, imp: 68, ea: 72 },
  { n: "John Schultz", p: 'WR', t: 'DEN', d: '1970s', s: { y: 25, p: 14, t: 0.2, c: 50 }, imp: 65, ea: 69 },
  { n: "Ron Egloff", p: 'TE', t: 'DEN', d: '1970s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 72 },
  { n: "Larry Walton", p: 'WR', t: 'DET', d: '1970s', s: { y: 35, p: 16, t: 0.3, c: 48 }, imp: 68, ea: 72 },
  { n: "Ron Jessie", p: 'WR', t: 'DET', d: '1970s', s: { y: 45, p: 16, t: 0.4, c: 50 }, imp: 72, ea: 76 },
  { n: "Leonard Thompson", p: 'WR', t: 'DET', d: '1970s', s: { y: 40, p: 16.5, t: 0.3, c: 48 }, imp: 70, ea: 74 },
  { n: "David Hill", p: 'TE', t: 'DET', d: '1970s', s: { y: 40, t: 0.4, b: 78 }, imp: 74, ea: 78 },
  { n: "Steve Odom", p: 'WR', t: 'GB', d: '1970s', s: { y: 35, p: 16, t: 0.3, c: 48 }, imp: 68, ea: 72 },
  { n: "James Lofton", p: 'WR', t: 'GB', d: '1970s', s: { y: 55, p: 18, t: 0.4, c: 50 }, imp: 79, ea: 83 },
  { n: "Aundra Thompson", p: 'WR', t: 'GB', d: '1970s', s: { y: 30, p: 15, t: 0.2, c: 50 }, imp: 66, ea: 70 },
  { n: "Rich McGeorge", p: 'TE', t: 'GB', d: '1970s', s: { y: 30, t: 0.3, b: 78 }, imp: 70, ea: 74 },
  { n: "Paul Coffman", p: 'TE', t: 'GB', d: '1970s', s: { y: 35, t: 0.4, b: 76 }, imp: 73, ea: 77 },
  { n: "Bert Askson", p: 'TE', t: 'GB', d: '1970s', s: { y: 15, t: 0.1, b: 76 }, imp: 64, ea: 68 },
  { n: "Mike Renfro", p: 'WR', t: 'TEN', d: '1970s', s: { y: 45, p: 14.5, t: 0.3, c: 52 }, imp: 71, ea: 75 },
  { n: "Rich Caster", p: 'WR', t: 'TEN', d: '1970s', s: { y: 40, p: 15, t: 0.3, c: 52 }, imp: 72, ea: 76 },
  { n: "Billy Johnson", p: 'WR', t: 'TEN', d: '1970s', s: { y: 45, p: 14, t: 0.4, c: 52 }, imp: 73, ea: 77 },
  { n: "Ed Podolak", p: 'RB', t: 'KC', d: '1970s', s: { y: 55, c: 3.9, r: 30, t: 0.4 }, imp: 74, ea: 74 },
  { n: "Woody Green", p: 'RB', t: 'KC', d: '1970s', s: { y: 50, c: 3.9, r: 12, t: 0.3 }, imp: 71, ea: 71 },
  { n: "MacArthur Lane", p: 'RB', t: 'KC', d: '1970s', s: { y: 45, c: 3.8, r: 25, t: 0.3 }, imp: 71, ea: 71 },
  { n: "Walter White", p: 'TE', t: 'KC', d: '1970s', s: { y: 35, t: 0.4, b: 76 }, imp: 72, ea: 76 },
  { n: "Billy Masters", p: 'TE', t: 'KC', d: '1970s', s: { y: 20, t: 0.2, b: 78 }, imp: 67, ea: 71 },
  { n: "Tony Samuels", p: 'TE', t: 'KC', d: '1970s', s: { y: 18, t: 0.2, b: 76 }, imp: 65, ea: 69 },
  { n: "Billy Waddy", p: 'WR', t: 'LAR', d: '1970s', s: { y: 40, p: 16, t: 0.3, c: 50 }, imp: 70, ea: 74 },
  { n: "Terry Nelson", p: 'TE', t: 'LAR', d: '1970s', s: { y: 25, t: 0.2, b: 78 }, imp: 68, ea: 72 },
  { n: "Charle Young", p: 'TE', t: 'LAR', d: '1970s', s: { y: 35, t: 0.3, b: 78 }, imp: 73, ea: 77 },
  { n: "Brent McClanahan", p: 'RB', t: 'MIN', d: '1970s', s: { y: 40, c: 3.8, r: 12, t: 0.3 }, imp: 69, ea: 69 },
  { n: "Stu Voigt", p: 'TE', t: 'MIN', d: '1970s', s: { y: 30, t: 0.3, b: 78 }, imp: 70, ea: 74 },
  { n: "Andy Johnson", p: 'RB', t: 'NE', d: '1970s', s: { y: 45, c: 3.9, r: 18, t: 0.3 }, imp: 71, ea: 71 },
  { n: "Darryl Stingley", p: 'WR', t: 'NE', d: '1970s', s: { y: 45, p: 15.5, t: 0.4, c: 50 }, imp: 72, ea: 76 },
  { n: "Randy Vataha", p: 'WR', t: 'NE', d: '1970s', s: { y: 45, p: 15, t: 0.4, c: 50 }, imp: 72, ea: 76 },
  { n: "Harold Jackson", p: 'WR', t: 'NE', d: '1970s', s: { y: 45, p: 17, t: 0.4, c: 48 }, imp: 73, ea: 77 },
  { n: "Bob Windsor", p: 'TE', t: 'NE', d: '1970s', s: { y: 20, t: 0.2, b: 78 }, imp: 67, ea: 71 },
  { n: "Chuck Muncie", p: 'RB', t: 'NO', d: '1970s', s: { y: 70, c: 4.3, r: 25, t: 0.5 }, imp: 78, ea: 78 },
  { n: "Andy Livingston", p: 'RB', t: 'NO', d: '1970s', s: { y: 40, c: 3.7, r: 15, t: 0.3 }, imp: 69, ea: 69 },
  { n: "Danny Abramowicz", p: 'WR', t: 'NO', d: '1970s', s: { y: 50, p: 13.5, t: 0.4, c: 56 }, imp: 74, ea: 78 },
  { n: "Joe Campbell", p: 'WR', t: 'NO', d: '1970s', s: { y: 30, p: 15, t: 0.2, c: 48 }, imp: 66, ea: 70 },
  { n: "Paul Seal", p: 'TE', t: 'NO', d: '1970s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 72 },
  { n: "Ron Johnson", p: 'RB', t: 'NYG', d: '1970s', s: { y: 65, c: 3.9, r: 25, t: 0.5 }, imp: 75, ea: 75 },
  { n: "Doug Kotar", p: 'RB', t: 'NYG', d: '1970s', s: { y: 55, c: 3.9, r: 18, t: 0.3 }, imp: 72, ea: 72 },
  { n: "Larry Csonka", p: 'RB', t: 'NYG', d: '1970s', s: { y: 55, c: 3.7, r: 8, t: 0.4 }, imp: 74, ea: 74 },
  { n: "Bobby Hammond", p: 'RB', t: 'NYG', d: '1970s', s: { y: 35, c: 3.8, r: 18, t: 0.2 }, imp: 68, ea: 68 },
  { n: "Jimmy Robinson", p: 'WR', t: 'NYG', d: '1970s', s: { y: 35, p: 15, t: 0.2, c: 50 }, imp: 67, ea: 71 },
  { n: "Earnest Gray", p: 'WR', t: 'NYG', d: '1970s', s: { y: 50, p: 16, t: 0.4, c: 50 }, imp: 73, ea: 77 },
  { n: "Johnny Perkins", p: 'WR', t: 'NYG', d: '1970s', s: { y: 40, p: 16, t: 0.3, c: 48 }, imp: 69, ea: 73 },
  { n: "Gary Shirk", p: 'TE', t: 'NYG', d: '1970s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 72 },
  { n: "Al Dixon", p: 'TE', t: 'NYG', d: '1970s', s: { y: 20, t: 0.2, b: 76 }, imp: 66, ea: 70 },
  { n: "Emerson Boozer", p: 'RB', t: 'NYJ', d: '1970s', s: { y: 50, c: 3.7, r: 25, t: 0.5 }, imp: 73, ea: 73 },
  { n: "Clark Gaines", p: 'RB', t: 'NYJ', d: '1970s', s: { y: 50, c: 3.8, r: 35, t: 0.3 }, imp: 72, ea: 72 },
  { n: "Eddie Bell", p: 'WR', t: 'NYJ', d: '1970s', s: { y: 40, p: 14.5, t: 0.3, c: 50 }, imp: 69, ea: 73 },
  { n: "Jerome Barkum", p: 'TE', t: 'NYJ', d: '1970s', s: { y: 40, t: 0.4, b: 76 }, imp: 73, ea: 77 },
  { n: "Morris Bradshaw", p: 'WR', t: 'LV', d: '1970s', s: { y: 30, p: 16, t: 0.2, c: 48 }, imp: 67, ea: 71 },
  { n: "Charles Smith", p: 'WR', t: 'PHI', d: '1970s', s: { y: 40, p: 14.5, t: 0.3, c: 52 }, imp: 70, ea: 74 },
  { n: "Harold Jackson", p: 'WR', t: 'PHI', d: '1970s', s: { y: 55, p: 17, t: 0.4, c: 48 }, imp: 76, ea: 80 },
  { n: "Vince Papale", p: 'WR', t: 'PHI', d: '1970s', s: { y: 15, p: 14, t: 0.1, c: 48 }, imp: 64, ea: 68 },
  { n: "Keith Krepfle", p: 'TE', t: 'PHI', d: '1970s', s: { y: 30, t: 0.4, b: 76 }, imp: 71, ea: 75 },
  { n: "Randy Grossman", p: 'TE', t: 'PIT', d: '1970s', s: { y: 25, t: 0.3, b: 78 }, imp: 69, ea: 73 },
  { n: "Larry Brown", p: 'TE', t: 'PIT', d: '1970s', s: { y: 20, t: 0.2, b: 82 }, imp: 69, ea: 73 },
  { n: "Bennie Cunningham", p: 'TE', t: 'PIT', d: '1970s', s: { y: 30, t: 0.3, b: 80 }, imp: 72, ea: 76 },
  { n: "Lydell Mitchell", p: 'RB', t: 'LAC', d: '1970s', s: { y: 60, c: 3.9, r: 35, t: 0.4 }, imp: 75, ea: 75 },
  { n: "Gary Garrison", p: 'WR', t: 'LAC', d: '1970s', s: { y: 45, p: 16, t: 0.4, c: 50 }, imp: 72, ea: 76 },
  { n: "Pat Curran", p: 'TE', t: 'LAC', d: '1970s', s: { y: 25, t: 0.2, b: 78 }, imp: 68, ea: 72 },
  { n: "Jim Zorn", p: 'QB', t: 'SEA', d: '1970s', s: { y: 175, t: 1.1, i: 1.3, r: 68 , ry: 18 }, imp: 73, ea: 77 },
  { n: "Sherman Smith", p: 'RB', t: 'SEA', d: '1970s', s: { y: 60, c: 4.2, r: 30, t: 0.5 }, imp: 74, ea: 74 },
  { n: "David Sims", p: 'RB', t: 'SEA', d: '1970s', s: { y: 50, c: 3.7, r: 12, t: 0.7 }, imp: 72, ea: 72 },
  { n: "Dan Doornink", p: 'RB', t: 'SEA', d: '1970s', s: { y: 45, c: 3.8, r: 25, t: 0.3 }, imp: 71, ea: 71 },
  { n: "Tony Benjamin", p: 'RB', t: 'SEA', d: '1970s', s: { y: 30, c: 3.6, r: 12, t: 0.2 }, imp: 66, ea: 66 },
  { n: "Steve Raible", p: 'WR', t: 'SEA', d: '1970s', s: { y: 35, p: 16, t: 0.3, c: 48 }, imp: 68, ea: 72 },
  { n: "Sam McCullum", p: 'WR', t: 'SEA', d: '1970s', s: { y: 45, p: 14.5, t: 0.3, c: 52 }, imp: 71, ea: 75 },
  { n: "Duke Ferguson", p: 'WR', t: 'SEA', d: '1970s', s: { y: 25, p: 15, t: 0.2, c: 48 }, imp: 65, ea: 69 },
  { n: "John Sawyer", p: 'TE', t: 'SEA', d: '1970s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 72 },
  { n: "Ron Howard", p: 'TE', t: 'SEA', d: '1970s', s: { y: 25, t: 0.3, b: 74 }, imp: 68, ea: 72 },
  { n: "Don Clune", p: 'TE', t: 'SEA', d: '1970s', s: { y: 15, t: 0.1, b: 74 }, imp: 64, ea: 68 },
  { n: "Delvin Williams", p: 'RB', t: 'SF', d: '1970s', s: { y: 65, c: 4.2, r: 25, t: 0.4 }, imp: 75, ea: 75 },
  { n: "Wilbur Jackson", p: 'RB', t: 'SF', d: '1970s', s: { y: 55, c: 4, r: 18, t: 0.4 }, imp: 73, ea: 73 },
  { n: "Paul Hofer", p: 'RB', t: 'SF', d: '1970s', s: { y: 50, c: 4.1, r: 30, t: 0.4 }, imp: 72, ea: 72 },
  { n: "O.J. Simpson", p: 'RB', t: 'SF', d: '1970s', s: { y: 55, c: 3.7, r: 12, t: 0.3 }, imp: 74, ea: 74 },
  { n: "Freddie Solomon", p: 'WR', t: 'SF', d: '1970s', s: { y: 45, p: 15.5, t: 0.4, c: 50 }, imp: 73, ea: 77 },
  { n: "Dwight Clark", p: 'WR', t: 'SF', d: '1970s', s: { y: 45, p: 13, t: 0.3, c: 58 }, imp: 74, ea: 78 },
  { n: "Mike Shumann", p: 'WR', t: 'SF', d: '1970s', s: { y: 30, p: 15, t: 0.2, c: 50 }, imp: 66, ea: 70 },
  { n: "Ted Kwalick", p: 'TE', t: 'SF', d: '1970s', s: { y: 35, t: 0.4, b: 78 }, imp: 74, ea: 78 },
  { n: "Tom Mitchell", p: 'TE', t: 'SF', d: '1970s', s: { y: 25, t: 0.2, b: 76 }, imp: 68, ea: 72 },
  { n: "Eason Ramson", p: 'TE', t: 'SF', d: '1970s', s: { y: 20, t: 0.2, b: 76 }, imp: 66, ea: 70 },
  { n: "J.V. Cain", p: 'TE', t: 'ARI', d: '1970s', s: { y: 30, t: 0.3, b: 76 }, imp: 71, ea: 75 },
  { n: "Jerry Eckwood", p: 'RB', t: 'TB', d: '1970s', s: { y: 55, c: 3.8, r: 18, t: 0.3 }, imp: 72, ea: 72 },
  { n: "Morris Owens", p: 'WR', t: 'TB', d: '1970s', s: { y: 45, p: 14.5, t: 0.4, c: 50 }, imp: 71, ea: 75 },
  { n: "Isaac Hagins", p: 'WR', t: 'TB', d: '1970s', s: { y: 40, p: 14, t: 0.3, c: 50 }, imp: 69, ea: 73 },
  { n: "Larry Mucker", p: 'WR', t: 'TB', d: '1970s', s: { y: 35, p: 14.5, t: 0.2, c: 50 }, imp: 68, ea: 72 },
  { n: "Gordon Jones", p: 'WR', t: 'TB', d: '1970s', s: { y: 40, p: 15.5, t: 0.3, c: 48 }, imp: 69, ea: 73 },
  { n: "Kevin House", p: 'WR', t: 'TB', d: '1970s', s: { y: 40, p: 17, t: 0.3, c: 46 }, imp: 70, ea: 74 },
  { n: "Jimmie Giles", p: 'TE', t: 'TB', d: '1970s', s: { y: 40, t: 0.5, b: 78 }, imp: 76, ea: 80 },
  { n: "Jim Obradovich", p: 'TE', t: 'TB', d: '1970s', s: { y: 25, t: 0.3, b: 76 }, imp: 68, ea: 72 },
  { n: "Bob Moore", p: 'TE', t: 'TB', d: '1970s', s: { y: 20, t: 0.2, b: 76 }, imp: 66, ea: 70 },
  { n: "Mike Thomas", p: 'RB', t: 'WAS', d: '1970s', s: { y: 55, c: 3.9, r: 35, t: 0.4 }, imp: 73, ea: 73 },
  { n: "Charley Taylor", p: 'WR', t: 'WAS', d: '1970s', s: { y: 50, p: 14.5, t: 0.4, c: 54 }, imp: 78, ea: 82 },
  { n: "Roy Jefferson", p: 'WR', t: 'WAS', d: '1970s', s: { y: 50, p: 15, t: 0.4, c: 52 }, imp: 74, ea: 78 },
  { n: "Frank Grant", p: 'WR', t: 'WAS', d: '1970s', s: { y: 40, p: 14.5, t: 0.3, c: 52 }, imp: 69, ea: 73 },
  { n: "Danny Buggs", p: 'WR', t: 'WAS', d: '1970s', s: { y: 35, p: 15, t: 0.2, c: 50 }, imp: 67, ea: 71 },
  { n: "John Gilliam", p: 'WR', t: 'ATL', d: '1970s', s: { y: 45, p: 16.5, t: 0.4, c: 48 }, imp: 73, ea: 77 },
  { n: "Bob Adams", p: 'TE', t: 'ATL', d: '1970s', s: { y: 20, t: 0.2, b: 76 }, imp: 66, ea: 70 },
  { n: "Sanders Shiver", p: 'WR', t: 'IND', d: '1970s', s: { y: 25, p: 13, t: 0.2, c: 50 }, imp: 65, ea: 69 },
  { n: "Bobby Moore", p: 'WR', t: 'BUF', d: '1970s', s: { y: 30, p: 14, t: 0.2, c: 50 }, imp: 66, ea: 70 },
  { n: "Robin Earl", p: 'RB', t: 'CHI', d: '1970s', s: { y: 40, c: 3.7, r: 12, t: 0.3 }, imp: 69, ea: 69 },
  { n: "Brian Baschnagel", p: 'WR', t: 'CHI', d: '1970s', s: { y: 40, p: 13.5, t: 0.2, c: 54 }, imp: 69, ea: 73 },
  { n: "J.R. Boone", p: 'TE', t: 'CHI', d: '1970s', s: { y: 18, t: 0.2, b: 74 }, imp: 64, ea: 68 },
  { n: "Stan Fritts", p: 'RB', t: 'CIN', d: '1970s', s: { y: 35, c: 3.6, r: 10, t: 0.3 }, imp: 67, ea: 67 },
  { n: "Lenvil Elliott", p: 'WR', t: 'CIN', d: '1970s', s: { y: 25, p: 11, t: 0.2, c: 54 }, imp: 65, ea: 69 },
  { n: "Bo Cornell", p: 'RB', t: 'CLE', d: '1970s', s: { y: 30, c: 3.6, r: 18, t: 0.2 }, imp: 66, ea: 66 },
  { n: "Steve Holden", p: 'WR', t: 'CLE', d: '1970s', s: { y: 30, p: 14.5, t: 0.2, c: 50 }, imp: 66, ea: 70 },
  { n: "Oscar Roan", p: 'TE', t: 'CLE', d: '1970s', s: { y: 25, t: 0.3, b: 76 }, imp: 68, ea: 72 },
  { n: "Doug Dennison", p: 'RB', t: 'DAL', d: '1970s', s: { y: 35, c: 3.8, r: 8, t: 0.4 }, imp: 68, ea: 68 },
  { n: "Butch Johnson", p: 'WR', t: 'DAL', d: '1970s', s: { y: 40, p: 16, t: 0.4, c: 50 }, imp: 72, ea: 76 },
  { n: "Ron Howard", p: 'TE', t: 'DAL', d: '1970s', s: { y: 25, p: 12, t: 0.2, c: 54 }, imp: 65, ea: 69 },
  { n: "Jay Saldi", p: 'TE', t: 'DAL', d: '1970s', s: { y: 20, t: 0.2, b: 78 }, imp: 67, ea: 71 },
  { n: "Jon Keyworth", p: 'RB', t: 'DEN', d: '1970s', s: { y: 40, c: 3.6, r: 12, t: 0.5 }, imp: 70, ea: 70 },
  { n: "Rick Kane", p: 'RB', t: 'DET', d: '1970s', s: { y: 35, c: 3.7, r: 12, t: 0.3 }, imp: 67, ea: 67 },
  { n: "Ulysses Norris", p: 'TE', t: 'DET', d: '1970s', s: { y: 20, t: 0.2, b: 76 }, imp: 66, ea: 70 },
  { n: "Eric Torkelson", p: 'RB', t: 'GB', d: '1970s', s: { y: 35, c: 3.7, r: 15, t: 0.3 }, imp: 67, ea: 67 },
  { n: "Barty Smith", p: 'RB', t: 'GB', d: '1970s', s: { y: 40, c: 3.6, r: 18, t: 0.3 }, imp: 69, ea: 69 },
  { n: "Ollie Smith", p: 'WR', t: 'GB', d: '1970s', s: { y: 30, p: 16, t: 0.2, c: 48 }, imp: 66, ea: 70 },
  { n: "Larry Brunson", p: 'WR', t: 'KC', d: '1970s', s: { y: 30, p: 14.5, t: 0.2, c: 50 }, imp: 66, ea: 70 },
  { n: "Henry Marshall", p: 'WR', t: 'KC', d: '1970s', s: { y: 45, p: 15, t: 0.3, c: 52 }, imp: 72, ea: 76 },
  { n: "Lance Rentzel", p: 'WR', t: 'LAR', d: '1970s', s: { y: 35, p: 15, t: 0.3, c: 50 }, imp: 68, ea: 72 },
  { n: "Dwight Scales", p: 'WR', t: 'LAR', d: '1970s', s: { y: 30, p: 16, t: 0.2, c: 48 }, imp: 66, ea: 70 },
  { n: "Howard Twilley", p: 'WR', t: 'MIA', d: '1970s', s: { y: 35, p: 13, t: 0.3, c: 54 }, imp: 70, ea: 74 },
  { n: "Andre Tillman", p: 'TE', t: 'MIA', d: '1970s', s: { y: 20, t: 0.2, b: 76 }, imp: 66, ea: 70 },
  { n: "Rickey Young", p: 'RB', t: 'MIN', d: '1970s', s: { y: 45, c: 3.7, r: 45, t: 0.3 }, imp: 72, ea: 72 },
  { n: "Bob Grim", p: 'WR', t: 'MIN', d: '1970s', s: { y: 30, p: 14.5, t: 0.2, c: 50 }, imp: 66, ea: 70 },
  { n: "Sammy Johnson", p: 'WR', t: 'MIN', d: '1970s', s: { y: 20, p: 10, t: 0.1, c: 54 }, imp: 64, ea: 68 },
  { n: "Joe Senser", p: 'TE', t: 'MIN', d: '1970s', s: { y: 30, t: 0.3, b: 74 }, imp: 70, ea: 74 },
  { n: "Don Calhoun", p: 'RB', t: 'NE', d: '1970s', s: { y: 45, c: 4, r: 8, t: 0.3 }, imp: 70, ea: 70 },
  { n: "Marlin Briscoe", p: 'WR', t: 'NE', d: '1970s', s: { y: 30, p: 14, t: 0.2, c: 50 }, imp: 67, ea: 71 },
  { n: "Don Hasselbeck", p: 'TE', t: 'NE', d: '1970s', s: { y: 25, t: 0.3, b: 78 }, imp: 68, ea: 72 },
  { n: "Jess Phillips", p: 'RB', t: 'NO', d: '1970s', s: { y: 35, c: 3.6, r: 18, t: 0.3 }, imp: 67, ea: 67 },
  { n: "Ike Harris", p: 'WR', t: 'NO', d: '1970s', s: { y: 40, p: 15, t: 0.3, c: 50 }, imp: 69, ea: 73 },
  { n: "Kevin Long", p: 'RB', t: 'NYJ', d: '1970s', s: { y: 45, c: 3.7, r: 12, t: 0.4 }, imp: 70, ea: 70 },
  { n: "Bobby Jones", p: 'WR', t: 'NYJ', d: '1970s', s: { y: 35, p: 15.5, t: 0.3, c: 48 }, imp: 67, ea: 71 },
  { n: "Carl Garrett", p: 'RB', t: 'LV', d: '1970s', s: { y: 20, p: 10, t: 0.1, c: 54 }, imp: 64, ea: 64 },
  { n: "Wally Henry", p: 'WR', t: 'PHI', d: '1970s', s: { y: 30, p: 14, t: 0.2, c: 50 }, imp: 66, ea: 70 },
  { n: "Sidney Thornton", p: 'RB', t: 'PIT', d: '1970s', s: { y: 40, c: 4, r: 15, t: 0.5 }, imp: 70, ea: 70 },
  { n: "Theo Bell", p: 'WR', t: 'PIT', d: '1970s', s: { y: 30, p: 14, t: 0.2, c: 52 }, imp: 67, ea: 71 },
  { n: "Hank Bauer", p: 'RB', t: 'LAC', d: '1970s', s: { y: 25, c: 3.6, r: 12, t: 0.4 }, imp: 66, ea: 66 },
  { n: "Dwight McDonald", p: 'WR', t: 'LAC', d: '1970s', s: { y: 25, p: 14, t: 0.2, c: 50 }, imp: 64, ea: 68 },
  { n: "J.J. Jones", p: 'WR', t: 'LAC', d: '1970s', s: { y: 20, p: 13, t: 0.1, c: 50 }, imp: 63, ea: 67 },
  { n: "Wayne Morris", p: 'RB', t: 'ARI', d: '1970s', s: { y: 45, c: 3.8, r: 12, t: 0.5 }, imp: 71, ea: 71 },
  { n: "Ike Harris", p: 'WR', t: 'ARI', d: '1970s', s: { y: 40, p: 15.5, t: 0.3, c: 50 }, imp: 69, ea: 73 },
  { n: "Dave Stief", p: 'WR', t: 'ARI', d: '1970s', s: { y: 25, p: 15, t: 0.2, c: 48 }, imp: 64, ea: 68 },
  { n: "Louis Carter", p: 'RB', t: 'TB', d: '1970s', s: { y: 40, c: 3.6, r: 18, t: 0.2 }, imp: 68, ea: 68 },
  { n: "Benny Malone", p: 'RB', t: 'WAS', d: '1970s', s: { y: 40, c: 3.8, r: 12, t: 0.3 }, imp: 69, ea: 69 },
  { n: "Reggie Haynes", p: 'TE', t: 'WAS', d: '1970s', s: { y: 18, t: 0.2, b: 76 }, imp: 65, ea: 69 },
  { n: "Cliff Austin", p: 'RB', t: 'ATL', d: '1980s', s: { y: 35, c: 3.8, r: 12, t: 0.3 }, imp: 68, ea: 69 },
  { n: "Chris Burkett", p: 'WR', t: 'BUF', d: '1980s', s: { y: 45, p: 15, t: 0.3, c: 52 }, imp: 71, ea: 74 },
  { n: "Trumaine Johnson", p: 'WR', t: 'BUF', d: '1980s', s: { y: 35, p: 14, t: 0.2, c: 52 }, imp: 68, ea: 71 },
  { n: "Thomas Sanders", p: 'RB', t: 'CHI', d: '1980s', s: { y: 35, c: 3.9, r: 8, t: 0.3 }, imp: 68, ea: 69 },
  { n: "Charles Alexander", p: 'RB', t: 'CIN', d: '1980s', s: { y: 40, c: 3.7, r: 18, t: 0.4 }, imp: 70, ea: 71 },
  { n: "Derek Tennell", p: 'TE', t: 'CLE', d: '1980s', s: { y: 18, t: 0.2, b: 78 }, imp: 66, ea: 69 },
  { n: "Fred Cornwell", p: 'TE', t: 'DAL', d: '1980s', s: { y: 15, t: 0.2, b: 78 }, imp: 65, ea: 68 },
  { n: "Clint Sampson", p: 'WR', t: 'DEN', d: '1980s', s: { y: 30, p: 14.5, t: 0.3, c: 52 }, imp: 67, ea: 70 },
  { n: "Mike Akiu", p: 'TE', t: 'TEN', d: '1980s', s: { y: 15, t: 0.1, b: 76 }, imp: 64, ea: 67 },
  { n: "George Wonsley", p: 'RB', t: 'IND', d: '1980s', s: { y: 40, c: 3.8, r: 15, t: 0.4 }, imp: 69, ea: 70 },
  { n: "Wayne Capers", p: 'WR', t: 'IND', d: '1980s', s: { y: 30, p: 15, t: 0.2, c: 50 }, imp: 66, ea: 69 },
  { n: "Jeff Smith", p: 'RB', t: 'KC', d: '1980s', s: { y: 30, c: 3.8, r: 12, t: 0.3 }, imp: 67, ea: 68 },
  { n: "Jim Jensen", p: 'WR', t: 'MIA', d: '1980s', s: { y: 30, p: 9.5, t: 0.3, c: 62 }, imp: 68, ea: 71 },
  { n: "Tommy Vigorito", p: 'WR', t: 'MIA', d: '1980s', s: { y: 25, p: 10, t: 0.2, c: 58 }, imp: 65, ea: 68 },
  { n: "Carl Hilton", p: 'TE', t: 'MIN', d: '1980s', s: { y: 18, t: 0.2, b: 78 }, imp: 66, ea: 69 },
  { n: "Mike Jones", p: 'WR', t: 'NO', d: '1980s', s: { y: 35, p: 14, t: 0.3, c: 52 }, imp: 68, ea: 71 },
  { n: "Wes Chandler", p: 'WR', t: 'NO', d: '1980s', s: { y: 50, p: 15, t: 0.4, c: 54 }, imp: 75, ea: 78 },
  { n: "Lee Rouson", p: 'RB', t: 'NYG', d: '1980s', s: { y: 30, c: 3.8, r: 18, t: 0.3 }, imp: 67, ea: 68 },
  { n: "Stacy Robinson", p: 'WR', t: 'NYG', d: '1980s', s: { y: 35, p: 15, t: 0.3, c: 50 }, imp: 68, ea: 71 },
  { n: "Don Hasselbeck", p: 'TE', t: 'NYG', d: '1980s', s: { y: 18, t: 0.2, b: 78 }, imp: 66, ea: 69 },
  { n: "Tony Paige", p: 'RB', t: 'NYJ', d: '1980s', s: { y: 30, c: 3.6, r: 18, t: 0.5 }, imp: 68, ea: 69 },
  { n: "Kurt Sohn", p: 'WR', t: 'NYJ', d: '1980s', s: { y: 30, p: 12.5, t: 0.2, c: 56 }, imp: 67, ea: 70 },
  { n: "JoJo Townsell", p: 'WR', t: 'NYJ', d: '1980s', s: { y: 35, p: 13, t: 0.3, c: 54 }, imp: 68, ea: 71 },
  { n: "Frank Hawkins", p: 'RB', t: 'LV', d: '1980s', s: { y: 35, c: 3.8, r: 18, t: 0.4 }, imp: 69, ea: 70 },
  { n: "Trey Junkin", p: 'TE', t: 'LV', d: '1980s', s: { y: 15, t: 0.2, b: 80 }, imp: 65, ea: 68 },
  { n: "Michael Haddix", p: 'RB', t: 'PHI', d: '1980s', s: { y: 35, c: 3.5, r: 25, t: 0.2 }, imp: 67, ea: 68 },
  { n: "Rich Erenberg", p: 'RB', t: 'PIT', d: '1980s', s: { y: 30, c: 3.7, r: 25, t: 0.2 }, imp: 67, ea: 68 },
  { n: "Gregg Garrity", p: 'WR', t: 'PIT', d: '1980s', s: { y: 35, p: 15, t: 0.3, c: 52 }, imp: 68, ea: 71 },
  { n: "David Krieg", p: 'WR', t: 'SEA', d: '1980s', s: { y: 20, p: 8, t: 0.1, c: 50 }, imp: 62, ea: 65 },
  { n: "Byron Walker", p: 'WR', t: 'SEA', d: '1980s', s: { y: 30, p: 15, t: 0.2, c: 50 }, imp: 66, ea: 69 },
  { n: "Bill Ring", p: 'RB', t: 'SF', d: '1980s', s: { y: 30, c: 3.9, r: 12, t: 0.3 }, imp: 67, ea: 68 },
  { n: "John Frank", p: 'TE', t: 'SF', d: '1980s', s: { y: 25, t: 0.4, b: 78 }, imp: 70, ea: 73 },
  { n: "Theotis Brown", p: 'RB', t: 'ARI', d: '1980s', s: { y: 40, c: 3.8, r: 12, t: 0.5 }, imp: 70, ea: 71 },
  { n: "Melvin Carver", p: 'RB', t: 'TB', d: '1980s', s: { y: 30, c: 3.6, r: 10, t: 0.2 }, imp: 66, ea: 67 },
  { n: "Calvin Magee", p: 'TE', t: 'TB', d: '1980s', s: { y: 35, t: 0.4, b: 74 }, imp: 71, ea: 74 },
  { n: "Carwell Gardner", p: 'RB', t: 'BAL', d: '1990s', s: { y: 35, c: 3.6, r: 12, t: 0.4 }, imp: 68, ea: 69 },
  { n: "Patrick Johnson", p: 'WR', t: 'BAL', d: '1990s', s: { y: 40, p: 15, t: 0.3, c: 52 }, imp: 69, ea: 71 },
  { n: "Billy Davis", p: 'WR', t: 'BAL', d: '1990s', s: { y: 30, p: 13, t: 0.2, c: 54 }, imp: 66, ea: 68 },
  { n: "Frank Wycheck", p: 'TE', t: 'BAL', d: '1990s', s: { y: 30, t: 0.3, b: 76 }, imp: 70, ea: 72 },
  { n: "Robert Green", p: 'RB', t: 'CHI', d: '1990s', s: { y: 40, c: 3.8, r: 18, t: 0.3 }, imp: 69, ea: 70 },
  { n: "Bobby Engram", p: 'WR', t: 'CHI', d: '1990s', s: { y: 55, p: 11, t: 0.3, c: 62 }, imp: 74, ea: 76 },
  { n: "Marco Battaglia", p: 'TE', t: 'CIN', d: '1990s', s: { y: 25, t: 0.3, b: 74 }, imp: 68, ea: 70 },
  { n: "Lawrence Phillips", p: 'RB', t: 'CLE', d: '1990s', s: { y: 40, c: 3.5, r: 12, t: 0.3 }, imp: 68, ea: 69 },
  { n: "Frank Hartley", p: 'TE', t: 'CLE', d: '1990s', s: { y: 22, t: 0.2, b: 76 }, imp: 67, ea: 69 },
  { n: "Dwayne Carswell", p: 'TE', t: 'DEN', d: '1990s', s: { y: 25, t: 0.3, b: 78 }, imp: 69, ea: 71 },
  { n: "William Henderson", p: 'RB', t: 'GB', d: '1990s', s: { y: 30, c: 3.6, r: 30, t: 0.2 }, imp: 69, ea: 70 },
  { n: "Spencer Tillman", p: 'RB', t: 'TEN', d: '1990s', s: { y: 30, c: 3.6, r: 12, t: 0.3 }, imp: 66, ea: 67 },
  { n: "Alvis Whitted", p: 'WR', t: 'JAX', d: '1990s', s: { y: 30, p: 14, t: 0.2, c: 52 }, imp: 66, ea: 68 },
  { n: "Damon Jones", p: 'WR', t: 'JAX', d: '1990s', s: { y: 25, p: 13, t: 0.2, c: 52 }, imp: 65, ea: 67 },
  { n: "Donnell Bennett", p: 'RB', t: 'KC', d: '1990s', s: { y: 40, c: 3.7, r: 8, t: 0.5 }, imp: 70, ea: 71 },
  { n: "Ted Popson", p: 'TE', t: 'KC', d: '1990s', s: { y: 25, t: 0.3, b: 74 }, imp: 68, ea: 70 },
  { n: "Tim Lester", p: 'RB', t: 'LAR', d: '1990s', s: { y: 25, c: 3.4, r: 18, t: 0.2 }, imp: 65, ea: 66 },
  { n: "Lawrence Phillips", p: 'RB', t: 'MIN', d: '1990s', s: { y: 30, c: 3.5, r: 12, t: 0.2 }, imp: 67, ea: 68 },
  { n: "Dedric Ward", p: 'WR', t: 'NYJ', d: '1990s', s: { y: 45, p: 15, t: 0.3, c: 54 }, imp: 71, ea: 73 },
  { n: "Derrick Fenner", p: 'RB', t: 'LV', d: '1990s', s: { y: 40, c: 3.7, r: 12, t: 0.5 }, imp: 70, ea: 71 },
  { n: "Daryl Hobbs", p: 'WR', t: 'LV', d: '1990s', s: { y: 30, p: 13.5, t: 0.2, c: 54 }, imp: 66, ea: 68 },
  { n: "Olanda Truitt", p: 'WR', t: 'LV', d: '1990s', s: { y: 25, p: 14, t: 0.2, c: 52 }, imp: 65, ea: 67 },
  { n: "Mike Bartrum", p: 'WR', t: 'PHI', d: '1990s', s: { y: 15, p: 8, t: 0.1, c: 56 }, imp: 63, ea: 65 },
  { n: "Dave Krieg", p: 'QB', t: 'ARI', d: '1990s', s: { y: 200, t: 1.2, i: 1.2, r: 76 , ry: 6 }, imp: 73, ea: 75 },
  { n: "Ron Moore", p: 'RB', t: 'ARI', d: '1990s', s: { y: 45, c: 3.5, r: 8, t: 0.4 }, imp: 70, ea: 71 },
  { n: "Gary Clark", p: 'WR', t: 'ARI', d: '1990s', s: { y: 55, p: 14, t: 0.4, c: 54 }, imp: 75, ea: 77 },
  { n: "Randal Hill", p: 'WR', t: 'ARI', d: '1990s', s: { y: 45, p: 14.5, t: 0.3, c: 52 }, imp: 71, ea: 73 },
  { n: "Butch Rolle", p: 'TE', t: 'ARI', d: '1990s', s: { y: 18, t: 0.2, b: 78 }, imp: 66, ea: 68 },
  { n: "Tim Lester", p: 'RB', t: 'PIT', d: '1990s', s: { y: 25, c: 3.4, r: 15, t: 0.2 }, imp: 65, ea: 66 },
  { n: "Shawn Jefferson", p: 'WR', t: 'LAC', d: '1990s', s: { y: 50, p: 15, t: 0.3, c: 52 }, imp: 73, ea: 75 },
  { n: "Steve Broussard", p: 'RB', t: 'SEA', d: '1990s', s: { y: 35, c: 3.9, r: 18, t: 0.3 }, imp: 68, ea: 69 },
  { n: "Mike Pritchard", p: 'WR', t: 'SEA', d: '1990s', s: { y: 50, p: 12.5, t: 0.3, c: 60 }, imp: 73, ea: 75 },
  { n: "Robb Thomas", p: 'WR', t: 'SEA', d: '1990s', s: { y: 35, p: 13, t: 0.2, c: 56 }, imp: 67, ea: 69 },
  { n: "Itula Mili", p: 'TE', t: 'SEA', d: '1990s', s: { y: 25, t: 0.2, b: 74 }, imp: 68, ea: 70 },
  { n: "Ted Popson", p: 'TE', t: 'SF', d: '1990s', s: { y: 25, t: 0.3, b: 76 }, imp: 68, ea: 70 },
  { n: "June Henley", p: 'RB', t: 'LAR', d: '1990s', s: { y: 25, c: 3.5, r: 12, t: 0.2 }, imp: 65, ea: 66 },
  { n: "Jerald Sowell", p: 'TE', t: 'LAR', d: '1990s', s: { y: 18, t: 0.2, b: 76 }, imp: 65, ea: 67 },
  { n: "George Jones", p: 'RB', t: 'TEN', d: '1990s', s: { y: 30, c: 3.6, r: 8, t: 0.3 }, imp: 66, ea: 67 },
  { n: "Derrick Mason", p: 'WR', t: 'TEN', d: '1990s', s: { y: 45, p: 12.5, t: 0.3, c: 58 }, imp: 73, ea: 75 },
  { n: "John Gilmore", p: 'TE', t: 'TEN', d: '1990s', s: { y: 18, t: 0.2, b: 76 }, imp: 65, ea: 67 },
  { n: "Brian Kozlowski", p: 'TE', t: 'ATL', d: '2000s', s: { y: 18, t: 0.2, b: 78 }, imp: 66, ea: 67 },
  { n: "Brandon Stokley", p: 'WR', t: 'BAL', d: '2000s', s: { y: 45, p: 11.5, t: 0.3, c: 62 }, imp: 72, ea: 73 },
  { n: "Travis Taylor", p: 'WR', t: 'BAL', d: '2000s', s: { y: 45, p: 13, t: 0.3, c: 54 }, imp: 71, ea: 72 },
  { n: "Daniel Wilcox", p: 'TE', t: 'BAL', d: '2000s', s: { y: 25, t: 0.3, b: 76 }, imp: 68, ea: 69 },
  { n: "Tony Curtis", p: 'TE', t: 'BUF', d: '2000s', s: { y: 18, t: 0.2, b: 76 }, imp: 65, ea: 66 },
  { n: "Jeff King", p: 'TE', t: 'CAR', d: '2000s', s: { y: 25, t: 0.3, b: 78 }, imp: 69, ea: 70 },
  { n: "John Gilmore", p: 'TE', t: 'CHI', d: '2000s', s: { y: 18, t: 0.2, b: 78 }, imp: 66, ea: 67 },
  { n: "Daniel Coats", p: 'TE', t: 'CIN', d: '2000s', s: { y: 22, t: 0.2, b: 76 }, imp: 67, ea: 68 },
  { n: "Sam Hurd", p: 'WR', t: 'DAL', d: '2000s', s: { y: 30, p: 13.5, t: 0.3, c: 54 }, imp: 67, ea: 68 },
  { n: "David Anderson", p: 'WR', t: 'HOU', d: '2000s', s: { y: 30, p: 10.5, t: 0.2, c: 62 }, imp: 67, ea: 68 },
  { n: "Joel Dreessen", p: 'TE', t: 'HOU', d: '2000s', s: { y: 30, t: 0.3, b: 76 }, imp: 70, ea: 71 },
  { n: "Bryan Fletcher", p: 'TE', t: 'IND', d: '2000s', s: { y: 25, t: 0.3, b: 74 }, imp: 68, ea: 69 },
  { n: "Alvin Pearman", p: 'RB', t: 'JAX', d: '2000s', s: { y: 30, c: 3.9, r: 25, t: 0.2 }, imp: 67, ea: 68 },
  { n: "Dennis Northcutt", p: 'WR', t: 'JAX', d: '2000s', s: { y: 40, p: 11, t: 0.2, c: 62 }, imp: 70, ea: 71 },
  { n: "George Wrighster", p: 'TE', t: 'JAX', d: '2000s', s: { y: 25, t: 0.3, b: 74 }, imp: 68, ea: 69 },
  { n: "Kolby Smith", p: 'RB', t: 'KC', d: '2000s', s: { y: 35, c: 3.7, r: 18, t: 0.3 }, imp: 67, ea: 68 },
  { n: "Samie Parker", p: 'WR', t: 'KC', d: '2000s', s: { y: 35, p: 13, t: 0.2, c: 56 }, imp: 67, ea: 68 },
  { n: "Kris Wilson", p: 'TE', t: 'KC', d: '2000s', s: { y: 20, t: 0.2, b: 74 }, imp: 66, ea: 67 },
  { n: "Lamar Gordon", p: 'RB', t: 'MIA', d: '2000s', s: { y: 35, c: 3.7, r: 12, t: 0.3 }, imp: 67, ea: 68 },
  { n: "Sammy Morris", p: 'RB', t: 'MIA', d: '2000s', s: { y: 45, c: 3.8, r: 18, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Anthony Fasano", p: 'TE', t: 'MIA', d: '2000s', s: { y: 35, t: 0.4, b: 78 }, imp: 73, ea: 74 },
  { n: "Troy Williamson", p: 'WR', t: 'MIN', d: '2000s', s: { y: 35, p: 14, t: 0.2, c: 50 }, imp: 68, ea: 69 },
  { n: "Jim Kleinsasser", p: 'TE', t: 'MIN', d: '2000s', s: { y: 25, t: 0.2, b: 82 }, imp: 71, ea: 72 },
  { n: "Zack Crockett", p: 'RB', t: 'LV', d: '2000s', s: { y: 25, c: 3.4, r: 8, t: 0.6 }, imp: 67, ea: 68 },
  { n: "Tony Hunt", p: 'RB', t: 'PHI', d: '2000s', s: { y: 25, c: 3.6, r: 12, t: 0.2 }, imp: 65, ea: 66 },
  { n: "Matt Spaeth", p: 'TE', t: 'PIT', d: '2000s', s: { y: 20, t: 0.3, b: 80 }, imp: 68, ea: 69 },
  { n: "Andrew Pinnock", p: 'RB', t: 'LAC', d: '2000s', s: { y: 25, c: 3.5, r: 18, t: 0.3 }, imp: 65, ea: 66 },
  { n: "Brandon Manumaleuna", p: 'TE', t: 'LAC', d: '2000s', s: { y: 25, t: 0.3, b: 80 }, imp: 70, ea: 71 },
  { n: "Maurice Hicks", p: 'RB', t: 'SF', d: '2000s', s: { y: 30, c: 3.9, r: 12, t: 0.3 }, imp: 67, ea: 68 },
  { n: "Michael Robinson", p: 'RB', t: 'SF', d: '2000s', s: { y: 25, c: 3.7, r: 12, t: 0.3 }, imp: 66, ea: 67 },
  { n: "Bryan Gilmore", p: 'WR', t: 'SF', d: '2000s', s: { y: 30, p: 13, t: 0.2, c: 54 }, imp: 66, ea: 67 },
  { n: "Billy Bajema", p: 'TE', t: 'SF', d: '2000s', s: { y: 15, t: 0.1, b: 80 }, imp: 65, ea: 66 },
  { n: "Shaun McDonald", p: 'WR', t: 'LAR', d: '2000s', s: { y: 40, p: 11.5, t: 0.3, c: 60 }, imp: 70, ea: 71 },
  { n: "B.J. Askew", p: 'RB', t: 'TB', d: '2000s', s: { y: 25, c: 3.6, r: 18, t: 0.3 }, imp: 65, ea: 66 },
  { n: "Jerramy Stevens", p: 'TE', t: 'TB', d: '2000s', s: { y: 30, t: 0.3, b: 74 }, imp: 70, ea: 71 },
  { n: "Rock Cartwright", p: 'RB', t: 'WAS', d: '2000s', s: { y: 30, c: 3.8, r: 15, t: 0.3 }, imp: 66, ea: 67 },
  { n: "Antwaan Randle El", p: 'WR', t: 'WAS', d: '2000s', s: { y: 45, p: 11.5, t: 0.3, c: 60 }, imp: 71, ea: 72 },
  { n: "Todd Yoder", p: 'TE', t: 'WAS', d: '2000s', s: { y: 15, t: 0.2, b: 78 }, imp: 65, ea: 66 },
  { n: "Stepfan Taylor", p: 'RB', t: 'ARI', d: '2010s', s: { y: 35, c: 3.8, r: 18, t: 0.3 }, imp: 68, ea: 69 },
  { n: "J.J. Nelson", p: 'WR', t: 'ARI', d: '2010s', s: { y: 40, p: 15.5, t: 0.3, c: 50 }, imp: 70, ea: 70 },
  { n: "Javorius Allen", p: 'RB', t: 'BAL', d: '2010s', s: { y: 40, c: 3.8, r: 30, t: 0.4 }, imp: 71, ea: 72 },
  { n: "Lee Smith", p: 'TE', t: 'BUF', d: '2010s', s: { y: 12, t: 0.2, b: 82 }, imp: 67, ea: 67 },
  { n: "Chris Manhertz", p: 'TE', t: 'CAR', d: '2010s', s: { y: 12, t: 0.1, b: 80 }, imp: 65, ea: 65 },
  { n: "Ka'Deem Carey", p: 'RB', t: 'CHI', d: '2010s', s: { y: 35, c: 3.9, r: 12, t: 0.3 }, imp: 68, ea: 69 },
  { n: "C.J. Uzomah", p: 'TE', t: 'CIN', d: '2010s', s: { y: 30, t: 0.4, b: 74 }, imp: 71, ea: 71 },
  { n: "Seth DeValve", p: 'TE', t: 'CLE', d: '2010s', s: { y: 25, t: 0.3, b: 74 }, imp: 68, ea: 68 },
  { n: "Geoff Swaim", p: 'TE', t: 'DAL', d: '2010s', s: { y: 18, t: 0.2, b: 78 }, imp: 66, ea: 66 },
  { n: "Cody Latimer", p: 'WR', t: 'DEN', d: '2010s', s: { y: 25, p: 13, t: 0.2, c: 54 }, imp: 66, ea: 66 },
  { n: "Michael Roberts", p: 'TE', t: 'DET', d: '2010s', s: { y: 18, t: 0.3, b: 74 }, imp: 66, ea: 66 },
  { n: "Keith Mumphery", p: 'WR', t: 'HOU', d: '2010s', s: { y: 25, p: 12, t: 0.2, c: 56 }, imp: 65, ea: 65 },
  { n: "Rashad Greene", p: 'WR', t: 'JAX', d: '2010s', s: { y: 25, p: 10.5, t: 0.2, c: 60 }, imp: 65, ea: 65 },
  { n: "Arrelious Benn", p: 'WR', t: 'JAX', d: '2010s', s: { y: 25, p: 13.5, t: 0.2, c: 52 }, imp: 65, ea: 65 },
  { n: "Demetrius Harris", p: 'TE', t: 'KC', d: '2010s', s: { y: 20, t: 0.3, b: 74 }, imp: 67, ea: 67 },
  { n: "Branden Oliver", p: 'RB', t: 'LAC', d: '2010s', s: { y: 30, c: 3.8, r: 20, t: 0.3 }, imp: 67, ea: 68 },
  { n: "Sean McGrath", p: 'TE', t: 'LAC', d: '2010s', s: { y: 18, t: 0.2, b: 74 }, imp: 65, ea: 65 },
  { n: "Tre Mason", p: 'RB', t: 'LAR', d: '2010s', s: { y: 45, c: 3.9, r: 12, t: 0.3 }, imp: 70, ea: 71 },
  { n: "Cory Harkey", p: 'TE', t: 'LAR', d: '2010s', s: { y: 15, t: 0.1, b: 80 }, imp: 65, ea: 65 },
  { n: "MyCole Pruitt", p: 'TE', t: 'MIN', d: '2010s', s: { y: 15, t: 0.2, b: 76 }, imp: 65, ea: 65 },
  { n: "Roger Lewis", p: 'WR', t: 'NYG', d: '2010s', s: { y: 30, p: 13.5, t: 0.2, c: 52 }, imp: 66, ea: 66 },
  { n: "Taiwan Jones", p: 'RB', t: 'LV', d: '2010s', s: { y: 20, c: 4, r: 12, t: 0.2 }, imp: 65, ea: 66 },
  { n: "Roosevelt Nix", p: 'RB', t: 'PIT', d: '2010s', s: { y: 12, c: 3.5, r: 8, t: 0.2 }, imp: 64, ea: 65 },
  { n: "Xavier Grimble", p: 'TE', t: 'PIT', d: '2010s', s: { y: 18, t: 0.3, b: 74 }, imp: 66, ea: 66 },
  { n: "Donald Brown", p: 'RB', t: 'LAC', d: '2010s', s: { y: 35, c: 3.7, r: 18, t: 0.3 }, imp: 68, ea: 69 },
  { n: "Sean Culkin", p: 'TE', t: 'LAC', d: '2010s', s: { y: 12, t: 0.1, b: 78 }, imp: 64, ea: 64 },
  { n: "DuJuan Harris", p: 'RB', t: 'SF', d: '2010s', s: { y: 25, c: 3.8, r: 12, t: 0.2 }, imp: 65, ea: 66 },
  { n: "Daryl Richardson", p: 'RB', t: 'LAR', d: '2010s', s: { y: 35, c: 3.9, r: 18, t: 0.2 }, imp: 68, ea: 69 },
  { n: "Austin Pettis", p: 'WR', t: 'LAR', d: '2010s', s: { y: 30, p: 10.5, t: 0.2, c: 60 }, imp: 66, ea: 66 },
  { n: "Chris Givens", p: 'WR', t: 'LAR', d: '2010s', s: { y: 40, p: 15.5, t: 0.3, c: 50 }, imp: 69, ea: 69 },
  { n: "Antony Auclair", p: 'TE', t: 'TB', d: '2010s', s: { y: 12, t: 0.1, b: 80 }, imp: 64, ea: 64 },
  { n: "Mack Brown", p: 'RB', t: 'WAS', d: '2010s', s: { y: 25, c: 3.7, r: 8, t: 0.3 }, imp: 65, ea: 66 },
  { n: "Maurice Harris", p: 'WR', t: 'WAS', d: '2010s', s: { y: 30, p: 11.5, t: 0.2, c: 60 }, imp: 66, ea: 66 },
  { n: "Niles Paul", p: 'TE', t: 'WAS', d: '2010s', s: { y: 25, t: 0.2, b: 74 }, imp: 67, ea: 67 },
  { n: "James Conner", p: 'RB', t: 'ATL', d: '2020s', s: { y: 55, c: 4.2, r: 18, t: 0.5 }, imp: 74, ea: 76 },
  { n: "Tylan Wallace", p: 'WR', t: 'BAL', d: '2020s', s: { y: 25, p: 13, t: 0.2, c: 56 }, imp: 67, ea: 66 },
  { n: "Ty Johnson", p: 'RB', t: 'BUF', d: '2020s', s: { y: 30, c: 4.5, r: 18, t: 0.3 }, imp: 69, ea: 71 },
  { n: "Jonathan Mingo", p: 'WR', t: 'CAR', d: '2020s', s: { y: 35, p: 11, t: 0.2, c: 58 }, imp: 69, ea: 68 },
  { n: "Jalen Coker", p: 'WR', t: 'CAR', d: '2020s', s: { y: 40, p: 13, t: 0.3, c: 58 }, imp: 70, ea: 69 },
  { n: "Gerald Everett", p: 'TE', t: 'CHI', d: '2020s', s: { y: 35, t: 0.3, b: 72 }, imp: 72, ea: 71 },
  { n: "Andrei Iosivas", p: 'WR', t: 'CIN', d: '2020s', s: { y: 40, p: 12.5, t: 0.4, c: 58 }, imp: 71, ea: 70 },
  { n: "Drew Sample", p: 'TE', t: 'CIN', d: '2020s', s: { y: 20, t: 0.2, b: 78 }, imp: 68, ea: 67 },
  { n: "Pierre Strong Jr.", p: 'RB', t: 'CLE', d: '2020s', s: { y: 35, c: 4.6, r: 15, t: 0.3 }, imp: 70, ea: 72 },
  { n: "Hunter Luepke", p: 'RB', t: 'DAL', d: '2020s', s: { y: 20, c: 4, r: 18, t: 0.3 }, imp: 67, ea: 69 },
  { n: "KaVontae Turpin", p: 'WR', t: 'DAL', d: '2020s', s: { y: 30, p: 13, t: 0.2, c: 58 }, imp: 69, ea: 68 },
  { n: "Devaughn Vele", p: 'WR', t: 'DEN', d: '2020s', s: { y: 35, p: 11.5, t: 0.2, c: 62 }, imp: 69, ea: 68 },
  { n: "Lucas Krull", p: 'TE', t: 'DEN', d: '2020s', s: { y: 25, t: 0.3, b: 72 }, imp: 68, ea: 67 },
  { n: "Craig Reynolds", p: 'RB', t: 'DET', d: '2020s', s: { y: 25, c: 4.3, r: 12, t: 0.2 }, imp: 68, ea: 70 },
  { n: "Kalif Raymond", p: 'WR', t: 'DET', d: '2020s', s: { y: 40, p: 12.5, t: 0.2, c: 60 }, imp: 71, ea: 70 },
  { n: "Tyler Goodson", p: 'RB', t: 'IND', d: '2020s', s: { y: 30, c: 4.5, r: 18, t: 0.2 }, imp: 69, ea: 71 },
  { n: "Travis Etienne Jr.", p: 'RB', t: 'JAX', d: '2020s', s: { y: 70, c: 4.3, r: 25, t: 0.5 }, imp: 80, ea: 82 },
  { n: "Carson Steele", p: 'RB', t: 'KC', d: '2020s', s: { y: 30, c: 4, r: 8, t: 0.3 }, imp: 69, ea: 71 },
  { n: "Alexander Mattison", p: 'RB', t: 'LV', d: '2020s', s: { y: 45, c: 3.8, r: 15, t: 0.3 }, imp: 71, ea: 73 },
  { n: "Malik Washington", p: 'WR', t: 'MIA', d: '2020s', s: { y: 30, p: 9.5, t: 0.2, c: 66 }, imp: 69, ea: 68 },
  { n: "Cam Akers", p: 'RB', t: 'MIN', d: '2020s', s: { y: 35, c: 4, r: 12, t: 0.3 }, imp: 70, ea: 72 },
  { n: "C.J. Ham", p: 'RB', t: 'MIN', d: '2020s', s: { y: 12, c: 3.6, r: 10, t: 0.2 }, imp: 65, ea: 67 },
  { n: "Kayshon Boutte", p: 'WR', t: 'NE', d: '2020s', s: { y: 40, p: 13, t: 0.3, c: 58 }, imp: 71, ea: 70 },
  { n: "Cedrick Wilson Jr.", p: 'WR', t: 'NO', d: '2020s', s: { y: 35, p: 12, t: 0.2, c: 60 }, imp: 70, ea: 69 },
  { n: "Isaiah Davis", p: 'RB', t: 'NYJ', d: '2020s', s: { y: 30, c: 4.3, r: 12, t: 0.2 }, imp: 68, ea: 70 },
  { n: "Mike Williams", p: 'WR', t: 'NYJ', d: '2020s', s: { y: 35, p: 14, t: 0.3, c: 54 }, imp: 71, ea: 70 },
  { n: "Will Shipley", p: 'RB', t: 'PHI', d: '2020s', s: { y: 25, c: 4.2, r: 15, t: 0.3 }, imp: 69, ea: 71 },
  { n: "Johnny Wilson", p: 'WR', t: 'PHI', d: '2020s', s: { y: 25, p: 12.5, t: 0.2, c: 56 }, imp: 67, ea: 66 },
  { n: "Cordarrelle Patterson", p: 'RB', t: 'PIT', d: '2020s', s: { y: 30, c: 4.2, r: 12, t: 0.3 }, imp: 69, ea: 71 },
  { n: "Van Jefferson", p: 'WR', t: 'PIT', d: '2020s', s: { y: 30, p: 13, t: 0.2, c: 54 }, imp: 68, ea: 67 },
  { n: "Isaac Guerendo", p: 'RB', t: 'SF', d: '2020s', s: { y: 35, c: 4.7, r: 15, t: 0.3 }, imp: 70, ea: 72 },
  { n: "Sean Tucker", p: 'RB', t: 'TB', d: '2020s', s: { y: 35, c: 4.5, r: 15, t: 0.3 }, imp: 70, ea: 72 },
  { n: "Sterling Shepard", p: 'WR', t: 'TB', d: '2020s', s: { y: 35, p: 10.5, t: 0.2, c: 64 }, imp: 70, ea: 69 },
  { n: "Trey Palmer", p: 'WR', t: 'TB', d: '2020s', s: { y: 35, p: 13, t: 0.2, c: 56 }, imp: 69, ea: 68 },
  { n: "Nick Westbrook-Ikhine", p: 'WR', t: 'TEN', d: '2020s', s: { y: 35, p: 14.5, t: 0.4, c: 54 }, imp: 70, ea: 69 },
  { n: "Jeremy McNichols", p: 'RB', t: 'WAS', d: '2020s', s: { y: 25, c: 4, r: 20, t: 0.2 }, imp: 67, ea: 69 },
  { n: "Olamide Zaccheaus", p: 'WR', t: 'WAS', d: '2020s', s: { y: 35, p: 12.5, t: 0.3, c: 58 }, imp: 70, ea: 69 },
  { n: "Don Nottingham", p: 'RB', t: 'IND', d: '1970s', s: { y: 40, c: 3.6, r: 8, t: 0.5 }, imp: 70, ea: 70 },
  { n: "Terry Miller", p: 'RB', t: 'BUF', d: '1970s', s: { y: 45, c: 3.7, r: 10, t: 0.4 }, imp: 70, ea: 70 },
  { n: "Billy Masters", p: 'TE', t: 'DEN', d: '1970s', s: { y: 22, t: 0.2, b: 78 }, imp: 67, ea: 71 },
  { n: "Mack Alston", p: 'TE', t: 'TEN', d: '1970s', s: { y: 25, t: 0.3, b: 78 }, imp: 68, ea: 72 },
  { n: "John Beasley", p: 'TE', t: 'NO', d: '1970s', s: { y: 20, t: 0.2, b: 78 }, imp: 66, ea: 70 },
  { n: "Mickey Shuler", p: 'TE', t: 'NYJ', d: '1970s', s: { y: 25, t: 0.3, b: 76 }, imp: 68, ea: 72 },
  { n: "Pettis Norman", p: 'TE', t: 'LAC', d: '1970s', s: { y: 22, t: 0.2, b: 78 }, imp: 67, ea: 71 },
  { n: "Bob Picard", p: 'WR', t: 'SEA', d: '1970s', s: { y: 30, p: 14, t: 0.2, c: 50 }, imp: 66, ea: 70 },
  { n: "Gary Parris", p: 'TE', t: 'ARI', d: '1970s', s: { y: 25, t: 0.3, b: 76 }, imp: 68, ea: 72 },
  { n: "Booker Moore", p: 'RB', t: 'BUF', d: '1980s', s: { y: 35, c: 3.7, r: 12, t: 0.3 }, imp: 68, ea: 69 },
  { n: "Anthony Hancock", p: 'WR', t: 'KC', d: '1980s', s: { y: 35, p: 15, t: 0.2, c: 50 }, imp: 68, ea: 71 },
  { n: "Hart Lee Dykes", p: 'WR', t: 'NE', d: '1980s', s: { y: 45, p: 15.5, t: 0.3, c: 50 }, imp: 71, ea: 74 },
  { n: "Larry Hardy", p: 'TE', t: 'NO', d: '1980s', s: { y: 22, t: 0.3, b: 78 }, imp: 67, ea: 70 },
  { n: "Dan Doornink", p: 'RB', t: 'SEA', d: '1980s', s: { y: 45, c: 3.8, r: 30, t: 0.3 }, imp: 71, ea: 72 },
  { n: "Kris Mangum", p: 'TE', t: 'CAR', d: '1990s', s: { y: 30, t: 0.3, b: 76 }, imp: 70, ea: 72 },
  { n: "Derek Brown", p: 'TE', t: 'JAX', d: '1990s', s: { y: 25, t: 0.3, b: 76 }, imp: 69, ea: 71 },
  { n: "Lamar Thomas", p: 'WR', t: 'MIA', d: '1990s', s: { y: 45, p: 15, t: 0.4, c: 52 }, imp: 71, ea: 73 },
  { n: "Ed Perry", p: 'TE', t: 'MIA', d: '1990s', s: { y: 25, t: 0.3, b: 78 }, imp: 68, ea: 70 },
  { n: "Qadry Ismail", p: 'WR', t: 'MIN', d: '1990s', s: { y: 45, p: 16, t: 0.3, c: 50 }, imp: 72, ea: 74 },
  { n: "Marv Cook", p: 'TE', t: 'NE', d: '1990s', s: { y: 40, t: 0.3, b: 78 }, imp: 73, ea: 75 },
  { n: "Tip Reiman", p: 'TE', t: 'ARI', d: '2020s', s: { y: 20, t: 0.2, b: 80 }, imp: 68, ea: 67 },
  { n: "Quintin Morris", p: 'TE', t: 'BUF', d: '2020s', s: { y: 18, t: 0.2, b: 78 }, imp: 67, ea: 66 },
  { n: "Travis Homer", p: 'RB', t: 'CHI', d: '2020s', s: { y: 20, c: 4, r: 12, t: 0.2 }, imp: 67, ea: 69 },
  { n: "Tyler Scott", p: 'WR', t: 'CHI', d: '2020s', s: { y: 30, p: 12.5, t: 0.2, c: 56 }, imp: 68, ea: 67 },
  { n: "Harrison Bryant", p: 'TE', t: 'CLE', d: '2020s', s: { y: 25, t: 0.3, b: 76 }, imp: 70, ea: 69 },
  { n: "Sean McKeon", p: 'TE', t: 'DAL', d: '2020s', s: { y: 15, t: 0.2, b: 80 }, imp: 67, ea: 66 },
  { n: "Josh Reynolds", p: 'WR', t: 'DET', d: '2020s', s: { y: 45, p: 14.5, t: 0.4, c: 56 }, imp: 73, ea: 72 },
  { n: "Dare Ogunbowale", p: 'RB', t: 'HOU', d: '2020s', s: { y: 15, c: 3.9, r: 15, t: 0.2 }, imp: 66, ea: 68 },
  { n: "Brevin Jordan", p: 'TE', t: 'HOU', d: '2020s', s: { y: 22, t: 0.3, b: 72 }, imp: 68, ea: 67 },
  { n: "Ashton Dulin", p: 'WR', t: 'IND', d: '2020s', s: { y: 25, p: 13.5, t: 0.2, c: 56 }, imp: 67, ea: 66 },
  { n: "Luke Farrell", p: 'TE', t: 'JAX', d: '2020s', s: { y: 18, t: 0.2, b: 80 }, imp: 67, ea: 66 },
  { n: "Jared Wiley", p: 'TE', t: 'KC', d: '2020s', s: { y: 18, t: 0.2, b: 74 }, imp: 67, ea: 66 },
  { n: "Ronnie Rivers", p: 'RB', t: 'LAR', d: '2020s', s: { y: 20, c: 4, r: 15, t: 0.2 }, imp: 66, ea: 68 },
  { n: "Jordan Whittington", p: 'WR', t: 'LAR', d: '2020s', s: { y: 40, p: 11, t: 0.2, c: 62 }, imp: 70, ea: 69 },
  { n: "Davis Allen", p: 'TE', t: 'LAR', d: '2020s', s: { y: 20, t: 0.3, b: 74 }, imp: 68, ea: 67 },
  { n: "DJ Turner", p: 'WR', t: 'LV', d: '2020s', s: { y: 25, p: 11, t: 0.2, c: 58 }, imp: 67, ea: 66 },
  { n: "Julian Hill", p: 'TE', t: 'MIA', d: '2020s', s: { y: 15, t: 0.2, b: 80 }, imp: 67, ea: 66 },
  { n: "Trent Sherfield", p: 'WR', t: 'MIN', d: '2020s', s: { y: 30, p: 12.5, t: 0.2, c: 56 }, imp: 68, ea: 67 },
  { n: "Johnny Mundt", p: 'TE', t: 'MIN', d: '2020s', s: { y: 18, t: 0.2, b: 78 }, imp: 67, ea: 66 },
  { n: "Kevin Harris", p: 'RB', t: 'NE', d: '2020s', s: { y: 25, c: 3.9, r: 8, t: 0.3 }, imp: 67, ea: 69 },
  { n: "Ja'Lynn Polk", p: 'WR', t: 'NE', d: '2020s', s: { y: 30, p: 11, t: 0.2, c: 56 }, imp: 68, ea: 67 },
  { n: "Mike Gesicki", p: 'TE', t: 'NE', d: '2020s', s: { y: 35, t: 0.3, b: 68 }, imp: 72, ea: 71 },
  { n: "Tony Jones Jr.", p: 'RB', t: 'NO', d: '2020s', s: { y: 30, c: 4, r: 12, t: 0.3 }, imp: 69, ea: 71 },
  { n: "Adam Trautman", p: 'TE', t: 'NO', d: '2020s', s: { y: 25, t: 0.3, b: 78 }, imp: 70, ea: 69 },
  { n: "Eric Gray", p: 'RB', t: 'NYG', d: '2020s', s: { y: 25, c: 4, r: 15, t: 0.2 }, imp: 68, ea: 70 },
  { n: "Jalin Hyatt", p: 'WR', t: 'NYG', d: '2020s', s: { y: 30, p: 14, t: 0.2, c: 54 }, imp: 69, ea: 68 },
  { n: "Chris Manhertz", p: 'TE', t: 'NYG', d: '2020s', s: { y: 12, t: 0.1, b: 80 }, imp: 66, ea: 65 },
  { n: "Malachi Corley", p: 'WR', t: 'NYJ', d: '2020s', s: { y: 25, p: 9.5, t: 0.2, c: 62 }, imp: 67, ea: 66 },
  { n: "Kenny Yeboah", p: 'TE', t: 'NYJ', d: '2020s', s: { y: 15, t: 0.2, b: 76 }, imp: 66, ea: 65 },
  { n: "Britain Covey", p: 'WR', t: 'PHI', d: '2020s', s: { y: 25, p: 9, t: 0.1, c: 64 }, imp: 67, ea: 66 },
  { n: "Jack Stoll", p: 'TE', t: 'PHI', d: '2020s', s: { y: 18, t: 0.2, b: 78 }, imp: 67, ea: 66 },
  { n: "Anthony McFarland Jr.", p: 'RB', t: 'PIT', d: '2020s', s: { y: 25, c: 4.2, r: 12, t: 0.2 }, imp: 67, ea: 69 },
  { n: "Roman Wilson", p: 'WR', t: 'PIT', d: '2020s', s: { y: 25, p: 12.5, t: 0.2, c: 56 }, imp: 67, ea: 66 },
  { n: "Connor Heyward", p: 'TE', t: 'PIT', d: '2020s', s: { y: 20, t: 0.2, b: 76 }, imp: 68, ea: 67 },
  { n: "DeeJay Dallas", p: 'RB', t: 'SEA', d: '2020s', s: { y: 25, c: 4, r: 18, t: 0.3 }, imp: 68, ea: 70 },
  { n: "Jake Bobo", p: 'WR', t: 'SEA', d: '2020s', s: { y: 30, p: 10, t: 0.3, c: 62 }, imp: 69, ea: 68 },
  { n: "Jacob Cowing", p: 'WR', t: 'SF', d: '2020s', s: { y: 25, p: 10.5, t: 0.2, c: 60 }, imp: 67, ea: 66 },
  { n: "Charlie Woerner", p: 'TE', t: 'SF', d: '2020s', s: { y: 15, t: 0.1, b: 82 }, imp: 68, ea: 67 },
  { n: "Ke'Shawn Vaughn", p: 'RB', t: 'TB', d: '2020s', s: { y: 30, c: 4, r: 12, t: 0.3 }, imp: 69, ea: 71 },
  { n: "Cameron Brate", p: 'TE', t: 'TB', d: '2020s', s: { y: 35, t: 0.4, b: 74 }, imp: 72, ea: 71 },
  { n: "Julius Chestnut", p: 'RB', t: 'TEN', d: '2020s', s: { y: 20, c: 4.1, r: 8, t: 0.2 }, imp: 67, ea: 69 },
  { n: "Jamari Thrash", p: 'WR', t: 'CLE', d: '2020s', s: { y: 25, p: 11, t: 0.2, c: 58 }, imp: 67, ea: 66 },
  { n: "Clyde Edwards-Helaire", p: 'RB', t: 'KC', d: '2020s', s: { y: 50, c: 4.2, r: 20, t: 0.4 }, imp: 74, ea: 76 },
  { n: "Marquez Valdes-Scantling", p: 'WR', t: 'NO', d: '2020s', s: { y: 35, p: 15.5, t: 0.3, c: 48 }, imp: 70, ea: 69 },
  { n: "Josh Whyle", p: 'TE', t: 'TEN', d: '2020s', s: { y: 25, t: 0.3, b: 74 }, imp: 69, ea: 68 },
  { n: "Dyami Brown", p: 'WR', t: 'WAS', d: '2020s', s: { y: 35, p: 14.5, t: 0.2, c: 54 }, imp: 70, ea: 69 },
  { n: "Matthew Stafford", p: 'QB', t: 'DET', d: '2010s', s: { y: 275, t: 1.8, i: 1.0, r: 89.9 , ry: 4 }, imp: 86, ea: 86 },
  { n: "Tony Romo", p: 'QB', t: 'DAL', d: '2010s', s: { y: 265, t: 1.9, i: 0.9, r: 97.1 , ry: 6 }, imp: 86, ea: 86 },
  { n: "Matt Ryan", p: 'QB', t: 'ATL', d: '2020s', s: { y: 255, t: 1.5, i: 0.7, r: 92.0 , ry: 6 }, imp: 82, ea: 81 },
  { n: "Alex Smith", p: 'QB', t: 'SF', d: '2000s', s: { y: 190, t: 1.0, i: 0.9, r: 74.0 , ry: 12 }, imp: 76, ea: 77 },
  { n: "Josh Freeman", p: 'QB', t: 'TB', d: '2010s', s: { y: 230, t: 1.4, i: 1.0, r: 81.6 , ry: 7 }, imp: 76, ea: 76 },
  { n: "Baker Mayfield", p: 'QB', t: 'CLE', d: '2010s', s: { y: 245, t: 1.5, i: 1.0, r: 87.8 , ry: 12 }, imp: 80, ea: 80 },
  { n: "Lamar Jackson", p: 'QB', t: 'BAL', d: '2010s', s: { y: 210, t: 1.9, i: 0.5, r: 105.0 , ry: 50 }, imp: 90, ea: 90 },
  { n: "Josh Allen", p: 'QB', t: 'BUF', d: '2010s', s: { y: 230, t: 1.5, i: 0.8, r: 84.0 , ry: 30 }, imp: 84, ea: 84 },
  { n: "Russell Wilson", p: 'QB', t: 'SEA', d: '2020s', s: { y: 245, t: 1.9, i: 0.6, r: 101.0 , ry: 18 }, imp: 86, ea: 85 },
  { n: "Cam Newton", p: 'QB', t: 'CAR', d: '2020s', s: { y: 200, t: 1.0, i: 0.8, r: 82.0 , ry: 30 }, imp: 78, ea: 77 },
  { n: "Kurt Warner", p: 'QB', t: 'LAR', d: '2000s', s: { y: 285, t: 1.9, i: 1.2, r: 92.0 , ry: 2 }, imp: 86, ea: 87 },
  { n: "Ben Roethlisberger", p: 'QB', t: 'PIT', d: '2020s', s: { y: 255, t: 1.6, i: 0.8, r: 91.0 , ry: 6 }, imp: 83, ea: 82 },
  { n: "Drew Brees", p: 'QB', t: 'NO', d: '2020s', s: { y: 270, t: 1.8, i: 0.6, r: 106.0 , ry: 2 }, imp: 88, ea: 87 },
  { n: "Aaron Rodgers", p: 'QB', t: 'GB', d: '2000s', s: { y: 250, t: 1.7, i: 0.8, r: 96.0 , ry: 12 }, imp: 88, ea: 89 },
  { n: "Andre Johnson", p: 'WR', t: 'HOU', d: '2010s', s: { y: 90, p: 9.2, t: 0.4, c: 63 }, imp: 86, ea: 86 },
  { n: "Greg Jennings", p: 'WR', t: 'GB', d: '2010s', s: { y: 80, p: 9.2, t: 0.6, c: 62 }, imp: 82, ea: 82 },
  { n: "Mike Wallace", p: 'WR', t: 'PIT', d: '2010s', s: { y: 80, p: 10.5, t: 0.6, c: 58 }, imp: 81, ea: 81 },
  { n: "Victor Cruz", p: 'WR', t: 'NYG', d: '2010s', s: { y: 80, p: 9.0, t: 0.5, c: 60 }, imp: 80, ea: 80 },
  { n: "Emmitt Smith", p: 'RB', t: 'ARI', d: '2000s', s: { y: 60, c: 3.6, r: 12, t: 0.4 }, imp: 78, ea: 79 },
  { n: "Jerry Rice", p: 'WR', t: 'LV', d: '2000s', s: { y: 70, p: 8.5, t: 0.4, c: 62 }, imp: 85, ea: 86 },
  { n: "LaDainian Tomlinson", p: 'RB', t: 'NYJ', d: '2010s', s: { y: 55, c: 3.9, r: 25, t: 0.5 }, imp: 78, ea: 79 },
  { n: "Adrian Peterson", p: 'RB', t: 'WAS', d: '2020s', s: { y: 55, c: 4.0, r: 8, t: 0.4 }, imp: 74, ea: 76 },
  { n: "Frank Gore", p: 'RB', t: 'NYJ', d: '2020s', s: { y: 50, c: 3.6, r: 10, t: 0.2 }, imp: 72, ea: 74 },
  { n: "Ricky Williams", p: 'RB', t: 'BAL', d: '2010s', s: { y: 45, c: 4.1, r: 10, t: 0.3 }, imp: 73, ea: 74 },
  { n: "Joe Namath", p: 'QB', t: 'LAR', d: '1970s', s: { y: 140, t: 0.8, i: 1.4, r: 56.0 , ry: 8 }, imp: 72, ea: 76 },
  { n: "Joe Flacco", p: 'QB', t: 'DEN', d: '2010s', s: { y: 210, t: 1.1, i: 0.9, r: 78.0 , ry: 4 }, imp: 75, ea: 75 },
  { n: "Warren Moon", p: 'QB', t: 'KC', d: '1990s', s: { y: 215, t: 1.3, i: 0.9, r: 83.0 , ry: 14 }, imp: 80, ea: 82 },
  { n: "Jerry Rice", p: 'WR', t: 'SEA', d: '2000s', s: { y: 50, p: 8.0, t: 0.2, c: 62 }, imp: 76, ea: 77 },
  { n: "Randy Moss", p: 'WR', t: 'SF', d: '2010s', s: { y: 50, p: 9.5, t: 0.3, c: 55 }, imp: 76, ea: 76 },
  { n: "Cris Carter", p: 'WR', t: 'MIA', d: '2000s', s: { y: 45, p: 7.5, t: 0.3, c: 60 }, imp: 74, ea: 75 },
  { n: "Tim Brown", p: 'WR', t: 'TB', d: '2000s', s: { y: 50, p: 7.8, t: 0.2, c: 60 }, imp: 74, ea: 75 },
  { n: "Vinny Testaverde", p: 'QB', t: 'BAL', d: '1990s', s: { y: 230, t: 1.6, i: 1, r: 83, ry: 6 }, imp: 79, ea: 81 },
  { n: "Randall Cunningham", p: 'QB', t: 'PHI', d: '1980s', s: { y: 200, t: 1.4, i: 0.9, r: 79, ry: 38 }, imp: 84, ea: 87 },
  { n: "Randall Cunningham", p: 'QB', t: 'MIN', d: '1990s', s: { y: 215, t: 2.1, i: 0.6, r: 97, ry: 12 }, imp: 84, ea: 86 },
  { n: "Rich Gannon", p: 'QB', t: 'MIN', d: '1990s', s: { y: 160, t: 1, i: 0.7, r: 79, ry: 14 }, imp: 72, ea: 74 },
  { n: "Ken Anderson", p: 'QB', t: 'CIN', d: '1980s', s: { y: 205, t: 1.3, i: 0.8, r: 85, ry: 9 }, imp: 83, ea: 86 },
  { n: "Ken Stabler", p: 'QB', t: 'TEN', d: '1980s', s: { y: 175, t: 0.9, i: 1.2, r: 65, ry: 1 }, imp: 70, ea: 73 },
  { n: "Ken Stabler", p: 'QB', t: 'NO', d: '1980s', s: { y: 170, t: 0.8, i: 1.1, r: 64, ry: 1 }, imp: 68, ea: 71 },
  { n: "Bart Starr", p: 'QB', t: 'GB', d: '1970s', s: { y: 150, t: 0.6, i: 0.9, r: 68, ry: 2 }, imp: 68, ea: 72 },
  { n: "Craig Morton", p: 'QB', t: 'DAL', d: '1970s', s: { y: 160, t: 1.1, i: 1.1, r: 72, ry: 2 }, imp: 73, ea: 77 },
  { n: "Jim Everett", p: 'QB', t: 'LAR', d: '1980s', s: { y: 230, t: 1.8, i: 1.1, r: 84, ry: 3 }, imp: 80, ea: 83 },
  { n: "Neil O'Donnell", p: 'QB', t: 'NYJ', d: '1990s', s: { y: 180, t: 1, i: 0.7, r: 77, ry: 3 }, imp: 71, ea: 73 },
  { n: "Neil O'Donnell", p: 'QB', t: 'TEN', d: '1990s', s: { y: 150, t: 1, i: 0.5, r: 81, ry: 3 }, imp: 70, ea: 72 },
  { n: "Elvis Grbac", p: 'QB', t: 'BAL', d: '2000s', s: { y: 210, t: 1.2, i: 1.1, r: 71, ry: 2 }, imp: 72, ea: 73 },
  { n: "Kordell Stewart", p: 'QB', t: 'PIT', d: '2000s', s: { y: 175, t: 0.9, i: 0.7, r: 77, ry: 22 }, imp: 73, ea: 74 },
  { n: "Kordell Stewart", p: 'QB', t: 'CHI', d: '2000s', s: { y: 140, t: 0.7, i: 1, r: 62, ry: 18 }, imp: 64, ea: 65 },
  { n: "Robert Griffin III", p: 'QB', t: 'BAL', d: '2010s', s: { y: 90, t: 0.5, i: 0.4, r: 82, ry: 15 }, imp: 64, ea: 64 },
  { n: "Chad Pennington", p: 'QB', t: 'MIA', d: '2000s', s: { y: 220, t: 1.2, i: 0.5, r: 93, ry: 3 }, imp: 76, ea: 77 },
  { n: "Teddy Bridgewater", p: 'QB', t: 'NO', d: '2010s', s: { y: 170, t: 1.1, i: 0.4, r: 92, ry: 4 }, imp: 73, ea: 73 },
  { n: "Teddy Bridgewater", p: 'QB', t: 'CAR', d: '2020s', s: { y: 230, t: 1, i: 0.7, r: 92, ry: 10 }, imp: 72, ea: 71 },
  { n: "Justin Fields", p: 'QB', t: 'PIT', d: '2020s', s: { y: 150, t: 0.8, i: 0.2, r: 88, ry: 30 }, imp: 73, ea: 72 },
  { n: "Gerald Riggs", p: 'RB', t: 'WAS', d: '1990s', s: { y: 45, c: 3.8, r: 4, t: 0.8 }, imp: 68, ea: 69 },
  { n: "Christian Okoye", p: 'RB', t: 'KC', d: '1990s', s: { y: 70, c: 3.9, r: 3, t: 0.6 }, imp: 72, ea: 73 },
  { n: "Charlie Garner", p: 'RB', t: 'SF', d: '1990s', s: { y: 72, c: 4.9, r: 20, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Charlie Garner", p: 'RB', t: 'LV', d: '2000s', s: { y: 60, c: 4.6, r: 35, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Leroy Hoard", p: 'RB', t: 'MIN', d: '1990s', s: { y: 40, c: 4, r: 10, t: 0.7 }, imp: 69, ea: 70 },
  { n: "Duce Staley", p: 'RB', t: 'PHI', d: '1990s', s: { y: 70, c: 4.1, r: 25, t: 0.4 }, imp: 74, ea: 75 },
  { n: "Duce Staley", p: 'RB', t: 'PIT', d: '2000s', s: { y: 50, c: 4.2, r: 6, t: 0.3 }, imp: 69, ea: 70 },
  { n: "Mike Alstott", p: 'RB', t: 'TB', d: '2000s', s: { y: 40, c: 3.6, r: 14, t: 0.7 }, imp: 74, ea: 75 },
  { n: "Isaiah Pacheco", p: 'RB', t: 'KC', d: '2020s', s: { y: 62, c: 4.5, r: 12, t: 0.5 }, imp: 75, ea: 77 },
  { n: "John Jefferson", p: 'WR', t: 'GB', d: '1980s', s: { y: 40, p: 12, t: 0.2, c: 40 }, imp: 68, ea: 71 },
  { n: "Haywood Jeffires", p: 'WR', t: 'TEN', d: '1990s', s: { y: 68, p: 10.5, t: 0.5, c: 70 }, imp: 76, ea: 78 },
  { n: "Chris Chambers", p: 'WR', t: 'LAC', d: '2000s', s: { y: 45, p: 13.5, t: 0.3, c: 40 }, imp: 70, ea: 71 },
  { n: "Laveranues Coles", p: 'WR', t: 'WAS', d: '2000s', s: { y: 68, p: 11, t: 0.4, c: 70 }, imp: 74, ea: 75 },
  { n: "Sidney Rice", p: 'WR', t: 'SEA', d: '2010s', s: { y: 48, p: 13.5, t: 0.3, c: 45 }, imp: 71, ea: 71 },
  { n: "Kenny Golladay", p: 'WR', t: 'NYG', d: '2020s', s: { y: 30, p: 11, t: 0.1, c: 35 }, imp: 64, ea: 63 },
  { n: "Corey Davis", p: 'WR', t: 'TEN', d: '2010s', s: { y: 55, p: 12.5, t: 0.3, c: 55 }, imp: 72, ea: 72 },
  { n: "Christian Kirk", p: 'WR', t: 'ARI', d: '2010s', s: { y: 55, p: 11.5, t: 0.3, c: 58 }, imp: 72, ea: 72 },
  { n: "Cam Cleeland", p: 'TE', t: 'NO', d: '1990s', s: { y: 35, t: 0.3, b: 64 }, imp: 68, ea: 70 },
  { n: "Jermichael Finley", p: 'TE', t: 'GB', d: '2010s', s: { y: 48, t: 0.4, b: 60 }, imp: 75, ea: 75 }
];

// ============================================================
// UNIT DATABASE (O-Line + Defense, team+decade)
// ============================================================

// ============================================================
// DEFENSIVE PLAYER DATABASE ("Beat the Beasts")
// p: 'DE'|'DT'|'LB'|'CB'|'S'  — stat columns vary by era (see notes)
// ============================================================
const DEFENSE = [

  // =====================  1960s  =====================
  // DL
  { n: "Deacon Jones", p:'DE', t:'LAR', d:'1960s', s:{ sk:159.5, u:true, int:2, fr:15, ap:5, pb:8 }, imp:97 },
  { n: "Bob Lilly", p:'DT', t:'DAL', d:'1960s', s:{ sk:95.5, u:true, int:1, fr:18, ap:7, pb:11 }, imp:96 },
  { n: "Merlin Olsen", p:'DT', t:'LAR', d:'1960s', s:{ sk:91, u:true, int:1, fr:14, ap:6, pb:14 }, imp:94 },
  { n: "Buck Buchanan", p:'DT', t:'KC', d:'1960s', s:{ sk:63, u:true, int:0, fr:10, ap:3, pb:8 }, imp:90 },
  { n: "Willie Davis", p:'DE', t:'GB', d:'1960s', s:{ sk:100, u:true, int:0, fr:21, ap:5, pb:5 }, imp:90 },
  { n: "Gino Marchetti", p:'DE', t:'IND', d:'1960s', s:{ sk:70, u:true, int:0, fr:9, ap:4, pb:6 }, imp:89 },
  { n: "Doug Atkins", p:'DE', t:'CHI', d:'1960s', s:{ sk:75, u:true, int:0, fr:7, ap:1, pb:6 }, imp:87 },
  { n: "Carl Eller", p:'DE', t:'MIN', d:'1960s', s:{ sk:70, u:true, int:0, fr:12, ap:3, pb:4 }, imp:86 },
  { n: "Alex Karras", p:'DT', t:'DET', d:'1960s', s:{ sk:90, u:true, int:0, fr:6, ap:3, pb:4 }, imp:86 },
  { n: "Henry Jordan", p:'DT', t:'GB', d:'1960s', s:{ sk:60, u:true, int:0, fr:8, ap:2, pb:4 }, imp:84 },
  { n: "Roger Brown", p:'DT', t:'DET', d:'1960s', s:{ sk:55, u:true, int:0, fr:5, ap:1, pb:6 }, imp:83 },
  { n: "Ernie Ladd", p:'DT', t:'LAC', d:'1960s', s:{ sk:50, u:true, int:0, fr:4, ap:2, pb:4 }, imp:80 },
  { n: "Lamar Lundy", p:'DE', t:'LAR', d:'1960s', s:{ sk:50, u:true, int:1, fr:6, ap:0, pb:1 }, imp:80 },
  { n: "Rosey Grier", p:'DT', t:'LAR', d:'1960s', s:{ sk:45, u:true, int:0, fr:5, ap:0, pb:2 }, imp:79 },
  { n: "Jim Marshall", p:'DE', t:'MIN', d:'1960s', s:{ sk:65, u:true, int:0, fr:16, ap:0, pb:2 }, imp:81 },
  { n: "Ron McDole", p:'DE', t:'BUF', d:'1960s', s:{ sk:45, u:true, int:3, fr:8, ap:0, pb:0 }, imp:76 },
  // LB
  { n: "Dick Butkus", p:'LB', t:'CHI', d:'1960s', s:{ sk:11, u:true, int:22, fr:27, ap:5, pb:8 }, imp:96 },
  { n: "Ray Nitschke", p:'LB', t:'GB', d:'1960s', s:{ sk:20, u:true, int:25, fr:23, ap:1, pb:1 }, imp:90 },
  { n: "Bobby Bell", p:'LB', t:'KC', d:'1960s', s:{ sk:26, u:true, int:26, fr:15, ap:6, pb:9 }, imp:90 },
  { n: "Willie Lanier", p:'LB', t:'KC', d:'1960s', s:{ sk:15, u:true, int:27, fr:15, ap:2, pb:8 }, imp:89 },
  { n: "Chuck Howley", p:'LB', t:'DAL', d:'1960s', s:{ sk:20, u:true, int:24, fr:18, ap:5, pb:6 }, imp:86 },
  { n: "Tommy Nobis", p:'LB', t:'ATL', d:'1960s', s:{ sk:12, u:true, int:11, fr:12, ap:2, pb:5 }, imp:85 },
  { n: "Lee Roy Jordan", p:'LB', t:'DAL', d:'1960s', s:{ sk:14, u:true, int:32, fr:19, ap:1, pb:5 }, imp:84 },
  { n: "Nick Buoniconti", p:'LB', t:'NE', d:'1960s', s:{ sk:18, u:true, int:24, fr:13, ap:2, pb:6 }, imp:84 },
  { n: "Dave Robinson", p:'LB', t:'GB', d:'1960s', s:{ sk:18, u:true, int:21, fr:12, ap:1, pb:3 }, imp:83 },
  { n: "Maxie Baughan", p:'LB', t:'PHI', d:'1960s', s:{ sk:15, u:true, int:18, fr:11, ap:2, pb:9 }, imp:82 },
  { n: "Joe Fortunato", p:'LB', t:'CHI', d:'1960s', s:{ sk:12, u:true, int:16, fr:22, ap:1, pb:5 }, imp:79 },
  { n: "Wayne Walker", p:'LB', t:'DET', d:'1960s', s:{ sk:14, u:true, int:11, fr:9, ap:1, pb:3 }, imp:78 },
  { n: "Larry Morris", p:'LB', t:'CHI', d:'1960s', s:{ sk:12, u:true, int:12, fr:10, ap:1, pb:2 }, imp:78 },
  // DB
  { n: "Larry Wilson", p:'S', t:'ARI', d:'1960s', s:{ int:52, fr:13, td:5, ap:5, pb:8 }, imp:90 },
  { n: "Herb Adderley", p:'CB', t:'GB', d:'1960s', s:{ int:48, fr:8, td:7, ap:5, pb:5 }, imp:90 },
  { n: "Willie Wood", p:'S', t:'GB', d:'1960s', s:{ int:48, fr:8, td:2, ap:6, pb:8 }, imp:89 },
  { n: "Mel Renfro", p:'CB', t:'DAL', d:'1960s', s:{ int:52, fr:9, td:3, ap:5, pb:10 }, imp:89 },
  { n: "Paul Krause", p:'S', t:'WAS', d:'1960s', s:{ int:81, fr:8, td:3, ap:3, pb:8 }, imp:88 },
  { n: "Emlen Tunnell", p:'S', t:'NYG', d:'1960s', s:{ int:79, fr:6, td:4, ap:4, pb:9 }, imp:86 },
  { n: "Lem Barney", p:'CB', t:'DET', d:'1960s', s:{ int:56, fr:7, td:11, ap:1, pb:7 }, imp:86 },
  { n: "Johnny Robinson", p:'S', t:'KC', d:'1960s', s:{ int:57, fr:6, td:1, ap:3, pb:6 }, imp:86 },
  { n: "Jimmy Johnson", p:'CB', t:'SF', d:'1960s', s:{ int:47, fr:8, td:2, ap:4, pb:5 }, imp:85 },
  { n: "Bobby Boyd", p:'CB', t:'IND', d:'1960s', s:{ int:57, fr:4, td:4, ap:2, pb:2 }, imp:84 },
  { n: "Dave Grayson", p:'S', t:'LV', d:'1960s', s:{ int:48, fr:5, td:5, ap:3, pb:6 }, imp:83 },
  { n: "Yale Lary", p:'S', t:'DET', d:'1960s', s:{ int:50, fr:5, td:2, ap:3, pb:9 }, imp:83 },
  { n: "Cornell Green", p:'CB', t:'DAL', d:'1960s', s:{ int:34, fr:8, td:1, ap:3, pb:5 }, imp:82 },
  { n: "Kermit Alexander", p:'CB', t:'SF', d:'1960s', s:{ int:32, fr:6, td:3, ap:1, pb:2 }, imp:78 },
  { n: "Dave Whitsell", p:'CB', t:'NO', d:'1960s', s:{ int:46, fr:5, td:4, ap:1, pb:1 }, imp:77 },

  { n: "Ordell Braase", p:'DE', t:'IND', d:'1960s', s:{ sk:50, u:true, int:0, fr:6, ap:0, pb:2 }, imp:76 },
  { n: "George Andrie", p:'DE', t:'DAL', d:'1960s', s:{ sk:55, u:true, int:1, fr:7, ap:0, pb:5 }, imp:79 },
  { n: "Bob Brown", p:'DT', t:'GB', d:'1960s', s:{ sk:42, u:true, int:0, fr:5, ap:1, pb:2 }, imp:77 },
  { n: "Verlon Biggs", p:'DE', t:'NYJ', d:'1960s', s:{ sk:60, u:true, int:0, fr:6, ap:0, pb:3 }, imp:78 },
  { n: "Ed Budde", p:'LB', t:'KC', d:'1960s', s:{ sk:12, u:true, int:8, fr:7, ap:1, pb:5 }, imp:76 },
  { n: "Wahoo McDaniel", p:'LB', t:'NYJ', d:'1960s', s:{ sk:10, u:true, int:6, fr:8, ap:0, pb:1 }, imp:75 },
  { n: "Dave Wilcox", p:'LB', t:'SF', d:'1960s', s:{ sk:16, u:true, int:14, fr:12, ap:2, pb:7 }, imp:84 },
  { n: "Butch Byrd", p:'CB', t:'BUF', d:'1960s', s:{ int:40, fr:5, td:5, ap:1, pb:4 }, imp:80 },
  { n: "Dick LeBeau", p:'CB', t:'DET', d:'1960s', s:{ int:62, fr:5, td:3, ap:0, pb:3 }, imp:82 },

  // =====================  1970s  =====================
  // DL
  { n: "Joe Greene", p:'DT', t:'PIT', d:'1970s', s:{ sk:78.5, u:true, int:1, fr:16, dpoy:2, ap:4, pb:10 }, imp:96 },
  { n: "Alan Page", p:'DT', t:'MIN', d:'1970s', s:{ sk:148.5, u:true, int:2, fr:23, dpoy:1, ap:6, pb:9 }, imp:95 },
  { n: "Jack Youngblood", p:'DE', t:'LAR', d:'1970s', s:{ sk:151.5, u:true, int:0, fr:8, ap:5, pb:7 }, imp:91 },
  { n: "L.C. Greenwood", p:'DE', t:'PIT', d:'1970s', s:{ sk:78, u:true, int:1, fr:14, ap:2, pb:6 }, imp:88 },
  { n: "Carl Eller", p:'DE', t:'MIN', d:'1970s', s:{ sk:60, u:true, int:0, fr:11, ap:2, pb:2 }, imp:86 },
  { n: "Coy Bacon", p:'DE', t:'CIN', d:'1970s', s:{ sk:130, u:true, int:0, fr:10, ap:1, pb:3 }, imp:86 },
  { n: "Cedrick Hardman", p:'DE', t:'SF', d:'1970s', s:{ sk:112.5, u:true, int:0, fr:9, ap:1, pb:2 }, imp:84 },
  { n: "Claude Humphrey", p:'DE', t:'ATL', d:'1970s', s:{ sk:122, u:true, int:0, fr:11, ap:2, pb:6 }, imp:88 },
  { n: "Elvin Bethea", p:'DE', t:'TEN', d:'1970s', s:{ sk:105, u:true, int:0, fr:9, ap:1, pb:8 }, imp:85 },
  { n: "Curley Culp", p:'DT', t:'TEN', d:'1970s', s:{ sk:65, u:true, int:0, fr:7, dpoy:1, ap:1, pb:6 }, imp:85 },
  { n: "Dwight White", p:'DE', t:'PIT', d:'1970s', s:{ sk:46, u:true, int:0, fr:7, ap:0, pb:2 }, imp:81 },
  { n: "Ernie Holmes", p:'DT', t:'PIT', d:'1970s', s:{ sk:40, u:true, int:0, fr:5, ap:0, pb:1 }, imp:79 },
  { n: "Harvey Martin", p:'DE', t:'DAL', d:'1970s', s:{ sk:114, u:true, int:0, fr:8, ap:1, pb:4 }, imp:86 },
  { n: "Lyle Alzado", p:'DE', t:'DEN', d:'1970s', s:{ sk:97, u:true, int:0, fr:8, ap:1, pb:2 }, imp:83 },
  { n: "Wally Chambers", p:'DT', t:'CHI', d:'1970s', s:{ sk:50, u:true, int:1, fr:6, ap:2, pb:3 }, imp:82 },
  { n: "Mike Reid", p:'DT', t:'CIN', d:'1970s', s:{ sk:49, u:true, int:0, fr:5, ap:1, pb:2 }, imp:80 },
  { n: "Jim Marshall", p:'DE', t:'MIN', d:'1970s', s:{ sk:55, u:true, int:0, fr:14, ap:0, pb:0 }, imp:78 },
  // LB
  { n: "Jack Ham", p:'LB', t:'PIT', d:'1970s', s:{ sk:25.5, u:true, int:32, fr:21, ap:6, pb:8 }, imp:93 },
  { n: "Jack Lambert", p:'LB', t:'PIT', d:'1970s', s:{ sk:23.5, u:true, int:28, fr:17, dpoy:1, ap:6, pb:9 }, imp:93 },
  { n: "Willie Lanier", p:'LB', t:'KC', d:'1970s', s:{ sk:12, u:true, int:20, fr:8, ap:0, pb:6 }, imp:88 },
  { n: "Ted Hendricks", p:'LB', t:'LV', d:'1970s', s:{ sk:60.5, u:true, int:26, fr:16, ap:4, pb:8 }, imp:89 },
  { n: "Robert Brazile", p:'LB', t:'TEN', d:'1970s', s:{ sk:48, u:true, int:13, fr:11, ap:5, pb:7 }, imp:87 },
  { n: "Isiah Robertson", p:'LB', t:'LAR', d:'1970s', s:{ sk:25, u:true, int:25, fr:9, ap:3, pb:6 }, imp:84 },
  { n: "Tom Jackson", p:'LB', t:'DEN', d:'1970s', s:{ sk:20, u:true, int:20, fr:21, ap:1, pb:3 }, imp:82 },
  { n: "Randy Gradishar", p:'LB', t:'DEN', d:'1970s', s:{ sk:20, u:true, int:20, fr:13, dpoy:1, ap:2, pb:7 }, imp:86 },
  { n: "Bill Bergey", p:'LB', t:'PHI', d:'1970s', s:{ sk:21, u:true, int:27, fr:21, ap:4, pb:5 }, imp:84 },
  { n: "Brad Van Pelt", p:'LB', t:'NYG', d:'1970s', s:{ sk:20, u:true, int:20, fr:8, ap:1, pb:5 }, imp:81 },
  { n: "Chris Hanburger", p:'LB', t:'WAS', d:'1970s', s:{ sk:19, u:true, int:19, fr:17, ap:4, pb:9 }, imp:83 },
  { n: "Andy Russell", p:'LB', t:'PIT', d:'1970s', s:{ sk:18, u:true, int:18, fr:11, ap:1, pb:7 }, imp:80 },
  // DB
  { n: "Mel Blount", p:'CB', t:'PIT', d:'1970s', s:{ int:57, fr:13, td:4, dpoy:1, ap:2, pb:5 }, imp:91 },
  { n: "Ken Houston", p:'S', t:'WAS', d:'1970s', s:{ int:49, fr:21, td:12, ap:5, pb:12 }, imp:89 },
  { n: "Cliff Harris", p:'S', t:'DAL', d:'1970s', s:{ int:29, fr:18, td:1, ap:4, pb:6 }, imp:86 },
  { n: "Roger Wehrli", p:'CB', t:'ARI', d:'1970s', s:{ int:40, fr:19, td:1, ap:5, pb:7 }, imp:87 },
  { n: "Willie Brown", p:'CB', t:'LV', d:'1970s', s:{ int:54, fr:8, td:2, ap:4, pb:9 }, imp:88 },
  { n: "Jake Scott", p:'S', t:'MIA', d:'1970s', s:{ int:49, fr:11, td:4, ap:2, pb:5 }, imp:84 },
  { n: "Dick Anderson", p:'S', t:'MIA', d:'1970s', s:{ int:34, fr:14, td:3, dpoy:1, ap:3, pb:3 }, imp:84 },
  { n: "Louis Wright", p:'CB', t:'DEN', d:'1970s', s:{ int:26, fr:12, td:4, ap:3, pb:5 }, imp:83 },
  { n: "Jimmy Johnson", p:'CB', t:'SF', d:'1970s', s:{ int:47, fr:8, td:2, ap:1, pb:5 }, imp:82 },
  { n: "Donnie Shell", p:'S', t:'PIT', d:'1970s', s:{ int:51, fr:19, td:0, ap:3, pb:5 }, imp:85 },
  { n: "Paul Krause", p:'S', t:'MIN', d:'1970s', s:{ int:81, fr:8, td:3, ap:2, pb:8 }, imp:86 },
  { n: "Lemar Parrish", p:'CB', t:'CIN', d:'1970s', s:{ int:47, fr:9, td:13, ap:3, pb:8 }, imp:84 },
  { n: "Emmitt Thomas", p:'CB', t:'KC', d:'1970s', s:{ int:58, fr:6, td:5, ap:2, pb:5 }, imp:83 },
  { n: "Nolan Cromwell", p:'S', t:'LAR', d:'1970s', s:{ int:37, fr:11, td:2, ap:4, pb:4 }, imp:82 },
  { n: "Eddie Lewis", p:'CB', t:'SF', d:'1970s', s:{ int:20, fr:5, td:1, ap:0, pb:1 }, imp:75 },

  { n: "Fred Dryer", p:'DE', t:'LAR', d:'1970s', s:{ sk:65, u:true, int:1, fr:8, ap:0, pb:0 }, imp:79 },
  { n: "Carl Hairston", p:'DE', t:'PHI', d:'1970s', s:{ sk:55, u:true, int:0, fr:7, ap:0, pb:0 }, imp:77 },
  { n: "Tommy Hart", p:'DE', t:'SF', d:'1970s', s:{ sk:96, u:true, int:0, fr:8, ap:1, pb:1 }, imp:81 },
  { n: "Larry Brooks", p:'DT', t:'LAR', d:'1970s', s:{ sk:40, u:true, int:0, fr:5, ap:1, pb:5 }, imp:80 },
  { n: "Jeff Siemon", p:'LB', t:'MIN', d:'1970s', s:{ sk:14, u:true, int:11, fr:9, ap:1, pb:4 }, imp:79 },
  { n: "Tom Cousineau", p:'LB', t:'CLE', d:'1970s', s:{ sk:8, u:true, int:5, fr:6, ap:0, pb:0 }, imp:74 },
  { n: "Mike Curtis", p:'LB', t:'IND', d:'1970s', s:{ sk:15, u:true, int:21, fr:13, ap:2, pb:4 }, imp:82 },
  { n: "Jack Tatum", p:'S', t:'LV', d:'1970s', s:{ int:37, fr:10, td:1, ap:1, pb:3 }, imp:84 },
  { n: "Mike Wagner", p:'S', t:'PIT', d:'1970s', s:{ int:36, fr:9, td:1, ap:1, pb:2 }, imp:81 },
  { n: "Ken Riley", p:'CB', t:'CIN', d:'1970s', s:{ int:65, fr:6, td:5, ap:1, pb:0 }, imp:83 },

  // =====================  1980s  =====================
  // DL
  { n: "Reggie White", p:'DE', t:'PHI', d:'1980s', s:{ sk:81, int:0, ff:18, fr:8, dpoy:1, ap:4, pb:5 }, imp:97 },
  { n: "Bruce Smith", p:'DE', t:'BUF', d:'1980s', s:{ sk:60, int:0, ff:14, fr:6, ap:2, pb:3 }, imp:92 },
  { n: "Howie Long", p:'DE', t:'LV', d:'1980s', s:{ sk:62, int:0, ff:10, fr:9, ap:2, pb:7 }, imp:89 },
  { n: "Randy White", p:'DT', t:'DAL', d:'1980s', s:{ sk:78, u:true, int:0, ff:9, fr:12, ap:6, pb:9 }, imp:92 },
  { n: "Dan Hampton", p:'DT', t:'CHI', d:'1980s', s:{ sk:57, int:0, ff:7, fr:9, ap:4, pb:4 }, imp:88 },
  { n: "Lee Roy Selmon", p:'DE', t:'TB', d:'1980s', s:{ sk:78.5, u:true, int:0, ff:8, fr:10, dpoy:1, ap:3, pb:6 }, imp:88 },
  { n: "Richard Dent", p:'DE', t:'CHI', d:'1980s', s:{ sk:96.5, int:0, ff:25, fr:10, ap:1, pb:3 }, imp:90 },
  { n: "Fred Dean", p:'DE', t:'SF', d:'1980s', s:{ sk:55, int:0, ff:6, fr:5, dpoy:1, ap:2, pb:4 }, imp:86 },
  { n: "Mark Gastineau", p:'DE', t:'NYJ', d:'1980s', s:{ sk:107.5, int:0, ff:9, fr:7, ap:2, pb:5 }, imp:87 },
  { n: "Steve McMichael", p:'DT', t:'CHI', d:'1980s', s:{ sk:62, int:0, ff:9, fr:13, ap:2, pb:2 }, imp:84 },
  { n: "Doug Betters", p:'DE', t:'MIA', d:'1980s', s:{ sk:43, int:0, ff:4, fr:6, ap:1, pb:1 }, imp:80 },
  { n: "Keith Millard", p:'DT', t:'MIN', d:'1980s', s:{ sk:53, int:0, ff:6, fr:5, dpoy:1, ap:2, pb:2 }, imp:84 },
  { n: "William Perry", p:'DT', t:'CHI', d:'1980s', s:{ sk:29.5, int:0, ff:4, fr:5, ap:0, pb:0 }, imp:78 },
  { n: "Jacob Green", p:'DE', t:'SEA', d:'1980s', s:{ sk:97.5, int:0, ff:11, fr:8, ap:0, pb:2 }, imp:83 },
  { n: "Ed Jones", p:'DE', t:'DAL', d:'1980s', s:{ sk:57.5, int:0, ff:6, fr:8, ap:1, pb:3 }, imp:83 },
  { n: "Rulon Jones", p:'DE', t:'DEN', d:'1980s', s:{ sk:73.5, int:0, ff:7, fr:7, ap:1, pb:2 }, imp:82 },
  { n: "Dexter Manley", p:'DE', t:'WAS', d:'1980s', s:{ sk:91, int:0, ff:9, fr:7, ap:0, pb:1 }, imp:82 },
  // LB
  { n: "Lawrence Taylor", p:'LB', t:'NYG', d:'1980s', s:{ sk:107.5, int:7, ff:25, fr:9, dpoy:3, ap:8, pb:10 }, imp:99 },
  { n: "Mike Singletary", p:'LB', t:'CHI', d:'1980s', s:{ sk:19, int:7, ff:7, fr:12, dpoy:2, ap:7, pb:10 }, imp:92 },
  { n: "Andre Tippett", p:'LB', t:'NE', d:'1980s', s:{ sk:100, int:1, ff:17, fr:7, ap:2, pb:5 }, imp:88 },
  { n: "Rickey Jackson", p:'LB', t:'NO', d:'1980s', s:{ sk:115, int:2, ff:35, fr:25, ap:2, pb:6 }, imp:89 },
  { n: "Karl Mecklenburg", p:'LB', t:'DEN', d:'1980s', s:{ sk:79, int:5, ff:12, fr:9, ap:3, pb:6 }, imp:86 },
  { n: "Mike Merriweather", p:'LB', t:'PIT', d:'1980s', s:{ sk:51, int:6, ff:9, fr:6, ap:1, pb:4 }, imp:82 },
  { n: "Carl Banks", p:'LB', t:'NYG', d:'1980s', s:{ sk:39, int:3, ff:9, fr:9, ap:1, pb:1 }, imp:83 },
  { n: "Wilber Marshall", p:'LB', t:'CHI', d:'1980s', s:{ sk:45, int:5, ff:11, fr:13, ap:2, pb:3 }, imp:85 },
  { n: "Hugh Green", p:'LB', t:'TB', d:'1980s', s:{ sk:53, int:5, ff:8, fr:7, ap:2, pb:2 }, imp:83 },
  { n: "Clay Matthews Jr.", p:'LB', t:'CLE', d:'1980s', s:{ sk:62, int:7, ff:14, fr:14, ap:0, pb:4 }, imp:83 },
  { n: "Jack Lambert", p:'LB', t:'PIT', d:'1980s', s:{ sk:8, int:5, ff:5, fr:4, ap:2, pb:5 }, imp:84 },
  { n: "E.J. Junior", p:'LB', t:'ARI', d:'1980s', s:{ sk:35, int:5, ff:7, fr:9, ap:1, pb:2 }, imp:80 },
  { n: "Harry Carson", p:'LB', t:'NYG', d:'1980s', s:{ sk:15, int:6, ff:6, fr:14, ap:2, pb:9 }, imp:84 },
  // DB
  { n: "Ronnie Lott", p:'S', t:'SF', d:'1980s', s:{ int:46, ff:8, fr:13, td:5, ap:6, pb:8 }, imp:94 },
  { n: "Mike Haynes", p:'CB', t:'LAR', d:'1980s', s:{ int:46, fr:7, td:2, ap:2, pb:9 }, imp:88 },
  { n: "Lester Hayes", p:'CB', t:'LV', d:'1980s', s:{ int:39, fr:8, td:4, ap:2, pb:5 }, imp:86 },
  { n: "Kenny Easley", p:'S', t:'SEA', d:'1980s', s:{ int:32, fr:9, td:3, dpoy:1, ap:4, pb:5 }, imp:88 },
  { n: "Deion Sanders", p:'CB', t:'ATL', d:'1980s', s:{ int:8, fr:2, td:3, ap:0, pb:1 }, imp:82 },
  { n: "Everson Walls", p:'CB', t:'DAL', d:'1980s', s:{ int:44, fr:6, td:1, ap:3, pb:4 }, imp:85 },
  { n: "Joey Browner", p:'S', t:'MIN', d:'1980s', s:{ int:37, fr:12, td:2, ap:3, pb:6 }, imp:85 },
  { n: "Dennis Smith", p:'S', t:'DEN', d:'1980s', s:{ int:30, fr:14, td:2, ap:1, pb:6 }, imp:83 },
  { n: "Albert Lewis", p:'CB', t:'KC', d:'1980s', s:{ int:42, fr:7, td:1, ap:1, pb:4 }, imp:83 },
  { n: "Hanford Dixon", p:'CB', t:'CLE', d:'1980s', s:{ int:26, fr:7, td:1, ap:2, pb:3 }, imp:82 },
  { n: "Frank Minnifield", p:'CB', t:'CLE', d:'1980s', s:{ int:20, fr:5, td:0, ap:2, pb:4 }, imp:81 },
  { n: "Wes Hopkins", p:'S', t:'PHI', d:'1980s', s:{ int:30, fr:11, td:1, ap:1, pb:1 }, imp:80 },
  { n: "Vann McElroy", p:'S', t:'LV', d:'1980s', s:{ int:31, fr:7, td:0, ap:1, pb:2 }, imp:79 },
  { n: "Gary Fencik", p:'S', t:'CHI', d:'1980s', s:{ int:38, fr:11, td:1, ap:1, pb:2 }, imp:80 },
  { n: "Mark Haynes", p:'CB', t:'NYG', d:'1980s', s:{ int:18, fr:7, td:0, ap:1, pb:3 }, imp:79 },

  { n: "Sean Jones", p:'DE', t:'LAR', d:'1980s', s:{ sk:57, int:0, ff:8, fr:5, ap:0, pb:0 }, imp:80 },
  { n: "Greg Townsend", p:'DE', t:'LV', d:'1980s', s:{ sk:67.5, int:1, ff:9, fr:8, ap:1, pb:2 }, imp:82 },
  { n: "Gary Johnson", p:'DT', t:'LAC', d:'1980s', s:{ sk:45, int:0, ff:5, fr:6, ap:1, pb:4 }, imp:81 },
  { n: "Charles Mann", p:'DE', t:'WAS', d:'1980s', s:{ sk:66, int:0, ff:9, fr:6, ap:1, pb:4 }, imp:82 },
  { n: "Brian Bosworth", p:'LB', t:'SEA', d:'1980s', s:{ sk:4, int:1, ff:3, fr:4, ap:0, pb:0 }, imp:74 },
  { n: "Matt Millen", p:'LB', t:'LV', d:'1980s', s:{ sk:9, int:9, ff:5, fr:8, ap:0, pb:0 }, imp:78 },
  { n: "Jim Collins", p:'LB', t:'LAR', d:'1980s', s:{ sk:11, int:5, ff:4, fr:6, ap:0, pb:1 }, imp:76 },
  { n: "Donnie Shell", p:'S', t:'PIT', d:'1980s', s:{ int:51, ff:6, fr:19, td:0, ap:0, pb:5 }, imp:82 },
  { n: "LeRoy Irvin", p:'CB', t:'LAR', d:'1980s', s:{ int:35, fr:7, td:5, ap:1, pb:2 }, imp:81 },
  { n: "Mike Kenn", p:'S', t:'MIN', d:'1980s', s:{ int:25, fr:6, td:1, ap:0, pb:2 }, imp:77 },

  // =====================  1990s  =====================
  // DL
  { n: "Reggie White", p:'DE', t:'GB', d:'1990s', s:{ sk:111.5, int:3, ff:23, fr:13, dpoy:1, ap:4, pb:8 }, imp:96 },
  { n: "Bruce Smith", p:'DE', t:'BUF', d:'1990s', s:{ sk:111, int:0, ff:29, fr:8, dpoy:1, ap:6, pb:8 }, imp:95 },
  { n: "John Randle", p:'DT', t:'MIN', d:'1990s', s:{ sk:114, int:0, ff:22, fr:7, ap:6, pb:6 }, imp:91 },
  { n: "Cortez Kennedy", p:'DT', t:'SEA', d:'1990s', s:{ sk:58, int:0, ff:6, fr:5, dpoy:1, ap:3, pb:8 }, imp:89 },
  { n: "Chris Doleman", p:'DE', t:'MIN', d:'1990s', s:{ sk:96.5, int:0, ff:24, fr:11, ap:2, pb:6 }, imp:88 },
  { n: "Neil Smith", p:'DE', t:'KC', d:'1990s', s:{ sk:86.5, int:0, ff:14, fr:9, ap:2, pb:6 }, imp:86 },
  { n: "Charles Haley", p:'DE', t:'DAL', d:'1990s', s:{ sk:73, int:0, ff:14, fr:7, ap:1, pb:3 }, imp:86 },
  { n: "Warren Sapp", p:'DT', t:'TB', d:'1990s', s:{ sk:47, int:1, ff:9, fr:6, dpoy:1, ap:2, pb:4 }, imp:88 },
  { n: "Michael Strahan", p:'DE', t:'NYG', d:'1990s', s:{ sk:55.5, int:0, ff:13, fr:6, ap:1, pb:2 }, imp:85 },
  { n: "Kevin Greene", p:'DE', t:'PIT', d:'1990s', s:{ sk:113, int:0, ff:18, fr:7, ap:2, pb:4 }, imp:87 },
  { n: "Sean Gilbert", p:'DT', t:'LAR', d:'1990s', s:{ sk:38, int:0, ff:5, fr:6, ap:1, pb:1 }, imp:80 },
  { n: "Leslie O'Neal", p:'DE', t:'LAC', d:'1990s', s:{ sk:92.5, int:0, ff:12, fr:6, ap:1, pb:6 }, imp:84 },
  { n: "Clyde Simmons", p:'DE', t:'PHI', d:'1990s', s:{ sk:76, int:0, ff:11, fr:9, ap:1, pb:2 }, imp:82 },
  { n: "Trace Armstrong", p:'DE', t:'CHI', d:'1990s', s:{ sk:68, int:0, ff:9, fr:5, ap:0, pb:1 }, imp:79 },
  { n: "La'Roi Glover", p:'DT', t:'NO', d:'1990s', s:{ sk:50, int:0, ff:8, fr:5, ap:1, pb:2 }, imp:82 },
  { n: "Simeon Rice", p:'DE', t:'ARI', d:'1990s', s:{ sk:51.5, int:0, ff:10, fr:4, ap:1, pb:1 }, imp:82 },
  // LB
  { n: "Junior Seau", p:'LB', t:'LAC', d:'1990s', s:{ sk:47, int:11, ff:11, fr:11, ap:6, pb:10 }, imp:93 },
  { n: "Derrick Thomas", p:'LB', t:'KC', d:'1990s', s:{ sk:123.5, int:1, ff:41, fr:19, ap:2, pb:9 }, imp:92 },
  { n: "Cornelius Bennett", p:'LB', t:'BUF', d:'1990s', s:{ sk:71.5, int:7, ff:26, fr:13, ap:1, pb:5 }, imp:86 },
  { n: "Greg Lloyd", p:'LB', t:'PIT', d:'1990s', s:{ sk:54.5, int:11, ff:25, fr:13, ap:3, pb:5 }, imp:86 },
  { n: "Bryce Paup", p:'LB', t:'BUF', d:'1990s', s:{ sk:75, int:6, ff:20, fr:8, dpoy:1, ap:1, pb:4 }, imp:85 },
  { n: "Ken Norton Jr.", p:'LB', t:'SF', d:'1990s', s:{ sk:14, int:6, ff:8, fr:11, ap:1, pb:3 }, imp:82 },
  { n: "Hardy Nickerson", p:'LB', t:'TB', d:'1990s', s:{ sk:20, int:12, ff:9, fr:9, ap:2, pb:5 }, imp:84 },
  { n: "Bryan Cox", p:'LB', t:'MIA', d:'1990s', s:{ sk:51.5, int:5, ff:8, fr:5, ap:2, pb:3 }, imp:82 },
  { n: "Pat Swilling", p:'LB', t:'NO', d:'1990s', s:{ sk:107.5, int:1, ff:21, fr:7, dpoy:1, ap:2, pb:5 }, imp:86 },
  { n: "Seth Joyner", p:'LB', t:'PHI', d:'1990s', s:{ sk:52, int:24, ff:35, fr:18, ap:1, pb:1 }, imp:85 },
  { n: "Chris Spielman", p:'LB', t:'DET', d:'1990s', s:{ sk:11, int:9, ff:8, fr:9, ap:2, pb:4 }, imp:82 },
  { n: "Wilber Marshall", p:'LB', t:'WAS', d:'1990s', s:{ sk:23, int:6, ff:8, fr:7, ap:1, pb:1 }, imp:81 },
  { n: "Levon Kirkland", p:'LB', t:'PIT', d:'1990s', s:{ sk:19, int:11, ff:6, fr:7, ap:1, pb:2 }, imp:81 },
  // DB
  { n: "Deion Sanders", p:'CB', t:'DAL', d:'1990s', s:{ int:45, fr:6, td:9, dpoy:1, ap:6, pb:8 }, imp:95 },
  { n: "Rod Woodson", p:'CB', t:'PIT', d:'1990s', s:{ int:38, ff:15, fr:11, td:7, dpoy:1, ap:5, pb:7 }, imp:91 },
  { n: "Darrell Green", p:'CB', t:'WAS', d:'1990s', s:{ int:35, fr:6, td:4, ap:2, pb:5 }, imp:87 },
  { n: "Aeneas Williams", p:'CB', t:'ARI', d:'1990s', s:{ int:46, fr:9, td:7, ap:3, pb:6 }, imp:87 },
  { n: "Steve Atwater", p:'S', t:'DEN', d:'1990s', s:{ int:24, fr:8, td:1, ap:2, pb:8 }, imp:86 },
  { n: "Eric Allen", p:'CB', t:'PHI', d:'1990s', s:{ int:54, fr:5, td:8, ap:1, pb:6 }, imp:85 },
  { n: "Carnell Lake", p:'S', t:'PIT', d:'1990s', s:{ int:16, fr:9, td:2, ap:1, pb:5 }, imp:83 },
  { n: "Merton Hanks", p:'S', t:'SF', d:'1990s', s:{ int:31, fr:7, td:2, ap:1, pb:4 }, imp:82 },
  { n: "Eugene Robinson", p:'S', t:'SEA', d:'1990s', s:{ int:57, fr:9, td:1, ap:1, pb:3 }, imp:83 },
  { n: "Dale Carter", p:'CB', t:'KC', d:'1990s', s:{ int:23, fr:7, td:5, ap:1, pb:4 }, imp:82 },
  { n: "Terrell Buckley", p:'CB', t:'GB', d:'1990s', s:{ int:50, fr:6, td:8, ap:0, pb:0 }, imp:79 },
  { n: "LeRoy Butler", p:'S', t:'GB', d:'1990s', s:{ int:38, ff:13, fr:11, td:3, ap:4, pb:4 }, imp:86 },
  { n: "Tim McDonald", p:'S', t:'SF', d:'1990s', s:{ int:40, fr:8, td:2, ap:1, pb:6 }, imp:83 },
  { n: "Eric Turner", p:'S', t:'CLE', d:'1990s', s:{ int:31, fr:7, td:3, ap:2, pb:2 }, imp:82 },
  { n: "Ray Buchanan", p:'CB', t:'ATL', d:'1990s', s:{ int:35, fr:6, td:5, ap:1, pb:1 }, imp:80 },

  { n: "Sean Jones", p:'DE', t:'GB', d:'1990s', s:{ sk:59.5, int:0, ff:10, fr:6, ap:0, pb:0 }, imp:80 },
  { n: "Wayne Martin", p:'DE', t:'NO', d:'1990s', s:{ sk:71, int:0, ff:8, fr:5, ap:1, pb:1 }, imp:81 },
  { n: "Ted Washington", p:'DT', t:'BUF', d:'1990s', s:{ sk:29, int:0, ff:4, fr:6, ap:1, pb:3 }, imp:81 },
  { n: "Hugh Douglas", p:'DE', t:'PHI', d:'1990s', s:{ sk:54, int:0, ff:11, fr:5, ap:1, pb:2 }, imp:82 },
  { n: "Dana Stubblefield", p:'DT', t:'SF', d:'1990s', s:{ sk:42, int:0, ff:6, fr:5, dpoy:1, ap:1, pb:3 }, imp:84 },
  { n: "Zach Thomas", p:'LB', t:'MIA', d:'1990s', s:{ sk:9, int:5, ff:6, fr:4, ap:2, pb:3 }, imp:84 },
  { n: "Sam Mills", p:'LB', t:'NO', d:'1990s', s:{ sk:20.5, int:11, ff:10, fr:8, ap:1, pb:5 }, imp:84 },
  { n: "Dexter Coakley", p:'LB', t:'DAL', d:'1990s', s:{ sk:11, int:9, ff:7, fr:6, ap:1, pb:3 }, imp:81 },
  { n: "Sam Madison", p:'CB', t:'MIA', d:'1990s', s:{ int:31, fr:4, td:3, ap:1, pb:2 }, imp:82 },
  { n: "Ty Law", p:'CB', t:'NE', d:'1990s', s:{ int:36, fr:5, td:7, ap:2, pb:5 }, imp:85 },

  // =====================  2000s  =====================
  // DL
  { n: "Michael Strahan", p:'DE', t:'NYG', d:'2000s', s:{ sk:85, int:0, ff:13, fr:9, dpoy:0, ap:3, pb:5 }, imp:90 },
  { n: "Julius Peppers", p:'DE', t:'CAR', d:'2000s', s:{ sk:81, int:5, ff:30, fr:7, ap:2, pb:5 }, imp:90 },
  { n: "Warren Sapp", p:'DT', t:'TB', d:'2000s', s:{ sk:49.5, int:3, ff:10, fr:5, ap:2, pb:3 }, imp:88 },
  { n: "Dwight Freeney", p:'DE', t:'IND', d:'2000s', s:{ sk:84, int:0, ff:32, fr:5, ap:3, pb:5 }, imp:89 },
  { n: "Jason Taylor", p:'DE', t:'MIA', d:'2000s', s:{ sk:108.5, int:8, ff:38, fr:11, dpoy:1, ap:3, pb:6 }, imp:90 },
  { n: "Richard Seymour", p:'DE', t:'NE', d:'2000s', s:{ sk:39, int:0, ff:6, fr:6, ap:3, pb:5 }, imp:86 },
  { n: "Kevin Williams", p:'DT', t:'MIN', d:'2000s', s:{ sk:53, int:0, ff:9, fr:7, ap:5, pb:5 }, imp:87 },
  { n: "John Abraham", p:'DE', t:'ATL', d:'2000s', s:{ sk:94.5, int:0, ff:31, fr:6, ap:1, pb:5 }, imp:86 },
  { n: "Jared Allen", p:'DE', t:'KC', d:'2000s', s:{ sk:89.5, int:0, ff:18, fr:8, ap:3, pb:4 }, imp:88 },
  { n: "Trevor Pryce", p:'DE', t:'DEN', d:'2000s', s:{ sk:64, int:0, ff:8, fr:5, ap:1, pb:4 }, imp:83 },
  { n: "Pat Williams", p:'DT', t:'MIN', d:'2000s', s:{ sk:18, int:0, ff:4, fr:6, ap:1, pb:3 }, imp:82 },
  { n: "La'Roi Glover", p:'DT', t:'DAL', d:'2000s', s:{ sk:33, int:0, ff:5, fr:5, ap:1, pb:4 }, imp:82 },
  { n: "Aaron Smith", p:'DE', t:'PIT', d:'2000s', s:{ sk:44, int:1, ff:7, fr:6, ap:0, pb:0 }, imp:80 },
  { n: "Justin Tuck", p:'DE', t:'NYG', d:'2000s', s:{ sk:42, int:0, ff:14, fr:5, ap:1, pb:2 }, imp:82 },
  { n: "Robert Mathis", p:'DE', t:'IND', d:'2000s', s:{ sk:70.5, int:0, ff:35, fr:8, ap:0, pb:3 }, imp:84 },
  { n: "Albert Haynesworth", p:'DT', t:'TEN', d:'2000s', s:{ sk:30.5, int:0, ff:5, fr:6, ap:2, pb:2 }, imp:84 },
  { n: "Shaun Ellis", p:'DE', t:'NYJ', d:'2000s', s:{ sk:60, int:1, ff:9, fr:5, ap:0, pb:2 }, imp:80 },
  // LB
  { n: "Ray Lewis", p:'LB', t:'BAL', d:'2000s', s:{ sk:25, int:21, ff:13, fr:13, dpoy:1, ap:6, pb:8 }, imp:96 },
  { n: "Brian Urlacher", p:'LB', t:'CHI', d:'2000s', s:{ sk:34, int:18, ff:9, fr:9, dpoy:1, ap:4, pb:7 }, imp:90 },
  { n: "Derrick Brooks", p:'LB', t:'TB', d:'2000s', s:{ sk:11, int:23, ff:12, fr:8, dpoy:1, ap:5, pb:8 }, imp:90 },
  { n: "Zach Thomas", p:'LB', t:'MIA', d:'2000s', s:{ sk:15, int:15, ff:14, fr:9, ap:4, pb:5 }, imp:87 },
  { n: "Joey Porter", p:'LB', t:'PIT', d:'2000s', s:{ sk:82, int:3, ff:21, fr:7, ap:2, pb:4 }, imp:86 },
  { n: "DeMarcus Ware", p:'LB', t:'DAL', d:'2000s', s:{ sk:80, int:0, ff:25, fr:5, ap:3, pb:4 }, imp:89 },
  { n: "Shawne Merriman", p:'LB', t:'LAC', d:'2000s', s:{ sk:43.5, int:0, ff:9, fr:3, ap:2, pb:3 }, imp:84 },
  { n: "Lance Briggs", p:'LB', t:'CHI', d:'2000s', s:{ sk:13, int:14, ff:14, fr:8, ap:1, pb:6 }, imp:85 },
  { n: "Adalius Thomas", p:'LB', t:'BAL', d:'2000s', s:{ sk:46.5, int:6, ff:13, fr:9, ap:1, pb:2 }, imp:83 },
  { n: "Patrick Willis", p:'LB', t:'SF', d:'2000s', s:{ sk:13.5, int:6, ff:13, fr:5, dpoy:0, ap:5, pb:7 }, imp:90 },
  { n: "Keith Bulluck", p:'LB', t:'TEN', d:'2000s', s:{ sk:21, int:18, ff:14, fr:9, ap:1, pb:1 }, imp:84 },
  { n: "Jonathan Vilma", p:'LB', t:'NYJ', d:'2000s', s:{ sk:9, int:11, ff:5, fr:6, ap:1, pb:1 }, imp:82 },
  { n: "London Fletcher", p:'LB', t:'BUF', d:'2000s', s:{ sk:30, int:12, ff:12, fr:11, ap:0, pb:1 }, imp:84 },
  // DB
  { n: "Ed Reed", p:'S', t:'BAL', d:'2000s', s:{ int:46, ff:9, fr:11, td:11, dpoy:1, ap:5, pb:7 }, imp:94 },
  { n: "Champ Bailey", p:'CB', t:'DEN', d:'2000s', s:{ int:41, fr:6, td:3, ap:3, pb:9 }, imp:91 },
  { n: "Charles Woodson", p:'CB', t:'GB', d:'2000s', s:{ int:38, ff:18, fr:9, td:11, dpoy:1, ap:3, pb:5 }, imp:90 },
  { n: "Troy Polamalu", p:'S', t:'PIT', d:'2000s', s:{ int:23, ff:8, fr:7, td:3, ap:4, pb:6 }, imp:89 },
  { n: "Brian Dawkins", p:'S', t:'PHI', d:'2000s', s:{ int:25, ff:23, fr:11, td:3, ap:4, pb:7 }, imp:88 },
  { n: "Ronde Barber", p:'CB', t:'TB', d:'2000s', s:{ int:34, ff:14, fr:9, td:8, ap:3, pb:5 }, imp:86 },
  { n: "Nnamdi Asomugha", p:'CB', t:'LV', d:'2000s', s:{ int:13, fr:5, td:2, ap:2, pb:3 }, imp:85 },
  { n: "John Lynch", p:'S', t:'TB', d:'2000s', s:{ int:23, ff:8, fr:8, td:2, ap:2, pb:7 }, imp:85 },
  { n: "Asante Samuel", p:'CB', t:'NE', d:'2000s', s:{ int:42, fr:5, td:6, ap:2, pb:4 }, imp:84 },
  { n: "Bob Sanders", p:'S', t:'IND', d:'2000s', s:{ int:6, ff:6, fr:5, td:2, dpoy:1, ap:2, pb:2 }, imp:83 },
  { n: "Antoine Winfield", p:'CB', t:'MIN', d:'2000s', s:{ int:24, ff:14, fr:6, td:3, ap:1, pb:3 }, imp:83 },
  { n: "Darrelle Revis", p:'CB', t:'NYJ', d:'2000s', s:{ int:14, fr:3, td:1, ap:2, pb:3 }, imp:88 },
  { n: "Lito Sheppard", p:'CB', t:'PHI', d:'2000s', s:{ int:18, fr:4, td:4, ap:1, pb:2 }, imp:81 },
  { n: "Roy Williams", p:'S', t:'DAL', d:'2000s', s:{ int:13, ff:7, fr:6, td:2, ap:1, pb:5 }, imp:81 },

  { n: "Mario Williams", p:'DE', t:'HOU', d:'2000s', s:{ sk:53, int:0, ff:9, fr:5, ap:1, pb:3 }, imp:84 },
  { n: "Tommie Harris", p:'DT', t:'CHI', d:'2000s', s:{ sk:32, int:0, ff:5, fr:4, ap:1, pb:3 }, imp:82 },
  { n: "Kris Jenkins", p:'DT', t:'CAR', d:'2000s', s:{ sk:30, int:0, ff:4, fr:5, ap:2, pb:4 }, imp:83 },
  { n: "Osi Umenyiora", p:'DE', t:'NYG', d:'2000s', s:{ sk:64, int:0, ff:24, fr:5, ap:1, pb:2 }, imp:84 },
  { n: "Karlos Dansby", p:'LB', t:'ARI', d:'2000s', s:{ sk:25, int:13, ff:9, fr:8, ap:0, pb:0 }, imp:82 },
  { n: "DeMeco Ryans", p:'LB', t:'HOU', d:'2000s', s:{ sk:13, int:6, ff:5, fr:6, ap:1, pb:2 }, imp:83 },
  { n: "Lofa Tatupu", p:'LB', t:'SEA', d:'2000s', s:{ sk:8, int:9, ff:5, fr:6, ap:1, pb:3 }, imp:82 },
  { n: "Bart Scott", p:'LB', t:'BAL', d:'2000s', s:{ sk:23, int:3, ff:8, fr:5, ap:1, pb:1 }, imp:81 },
  { n: "Cortland Finnegan", p:'CB', t:'TEN', d:'2000s', s:{ int:14, ff:8, fr:5, td:3, ap:1, pb:1 }, imp:81 },
  { n: "Nathan Vasher", p:'CB', t:'CHI', d:'2000s', s:{ int:17, fr:4, td:2, ap:1, pb:1 }, imp:80 },
  { n: "Adrian Wilson", p:'S', t:'ARI', d:'2000s', s:{ sk:21.5, int:25, ff:8, fr:5, ap:2, pb:5 }, imp:85 },

  // =====================  2010s  =====================
  // DL
  { n: "Aaron Donald", p:'DT', t:'LAR', d:'2010s', s:{ sk:72, int:0, ff:18, fr:4, dpoy:3, ap:6, pb:6 }, imp:98 },
  { n: "J.J. Watt", p:'DE', t:'HOU', d:'2010s', s:{ sk:96, int:1, ff:25, fr:16, td:4, dpoy:3, ap:5, pb:5 }, imp:96 },
  { n: "Calais Campbell", p:'DE', t:'ARI', d:'2010s', s:{ sk:71.5, int:1, ff:11, fr:8, ap:1, pb:4 }, imp:88 },
  { n: "Cameron Jordan", p:'DE', t:'NO', d:'2010s', s:{ sk:87, int:2, ff:13, fr:8, ap:1, pb:5 }, imp:88 },
  { n: "Fletcher Cox", p:'DT', t:'PHI', d:'2010s', s:{ sk:53, int:0, ff:11, fr:6, ap:3, pb:5 }, imp:88 },
  { n: "Geno Atkins", p:'DT', t:'CIN', d:'2010s', s:{ sk:69, int:0, ff:8, fr:3, ap:2, pb:7 }, imp:87 },
  { n: "Ndamukong Suh", p:'DT', t:'DET', d:'2010s', s:{ sk:56, int:0, ff:7, fr:5, ap:3, pb:5 }, imp:87 },
  { n: "Julius Peppers", p:'DE', t:'CHI', d:'2010s', s:{ sk:78.5, int:6, ff:21, fr:7, td:3, ap:1, pb:4 }, imp:87 },
  { n: "Cameron Wake", p:'DE', t:'MIA', d:'2010s', s:{ sk:90, int:0, ff:18, fr:3, ap:1, pb:5 }, imp:86 },
  { n: "Robert Quinn", p:'DE', t:'LAR', d:'2010s', s:{ sk:80, int:0, ff:22, fr:4, ap:1, pb:2 }, imp:84 },
  { n: "Everson Griffen", p:'DE', t:'MIN', d:'2010s', s:{ sk:74.5, int:0, ff:14, fr:5, ap:0, pb:4 }, imp:83 },
  { n: "Gerald McCoy", p:'DT', t:'TB', d:'2010s', s:{ sk:54.5, int:0, ff:8, fr:5, ap:3, pb:6 }, imp:85 },
  { n: "Chandler Jones", p:'DE', t:'ARI', d:'2010s', s:{ sk:96, int:0, ff:24, fr:7, ap:2, pb:3 }, imp:88 },
  { n: "Michael Bennett", p:'DE', t:'SEA', d:'2010s', s:{ sk:63.5, int:0, ff:9, fr:6, ap:1, pb:3 }, imp:83 },
  { n: "Carlos Dunlap", p:'DE', t:'CIN', d:'2010s', s:{ sk:82.5, int:1, ff:14, fr:5, ap:0, pb:2 }, imp:82 },
  { n: "Jurrell Casey", p:'DT', t:'TEN', d:'2010s', s:{ sk:51, int:0, ff:8, fr:5, ap:0, pb:5 }, imp:83 },
  { n: "Muhammad Wilkerson", p:'DE', t:'NYJ', d:'2010s', s:{ sk:44.5, int:0, ff:8, fr:6, ap:1, pb:1 }, imp:81 },
  // LB
  { n: "Von Miller", p:'LB', t:'DEN', d:'2010s', s:{ sk:106, int:1, ff:25, fr:9, ap:3, pb:8 }, imp:93 },
  { n: "Khalil Mack", p:'LB', t:'LV', d:'2010s', s:{ sk:66.5, int:3, ff:21, fr:7, td:2, dpoy:1, ap:3, pb:5 }, imp:91 },
  { n: "Luke Kuechly", p:'LB', t:'CAR', d:'2010s', s:{ sk:12.5, int:18, ff:9, fr:8, dpoy:1, ap:5, pb:7 }, imp:91 },
  { n: "Bobby Wagner", p:'LB', t:'SEA', d:'2010s', s:{ sk:19.5, int:11, ff:11, fr:7, ap:5, pb:6 }, imp:90 },
  { n: "Patrick Willis", p:'LB', t:'SF', d:'2010s', s:{ sk:6, int:2, ff:3, fr:4, ap:2, pb:4 }, imp:87 },
  { n: "NaVorro Bowman", p:'LB', t:'SF', d:'2010s', s:{ sk:12, int:5, ff:6, fr:6, ap:3, pb:4 }, imp:85 },
  { n: "Lavonte David", p:'LB', t:'TB', d:'2010s', s:{ sk:21.5, int:11, ff:23, fr:9, ap:1, pb:1 }, imp:85 },
  { n: "Justin Houston", p:'LB', t:'KC', d:'2010s', s:{ sk:97.5, int:1, ff:17, fr:5, ap:1, pb:4 }, imp:85 },
  { n: "Ryan Kerrigan", p:'LB', t:'WAS', d:'2010s', s:{ sk:90, int:1, ff:26, fr:6, td:2, ap:0, pb:4 }, imp:83 },
  { n: "Telvin Smith", p:'LB', t:'JAX', d:'2010s', s:{ sk:6, int:9, ff:9, fr:4, td:3, ap:1, pb:1 }, imp:82 },
  { n: "C.J. Mosley", p:'LB', t:'BAL', d:'2010s', s:{ sk:8.5, int:9, ff:5, fr:6, ap:1, pb:4 }, imp:83 },
  { n: "Sean Lee", p:'LB', t:'DAL', d:'2010s', s:{ sk:6, int:14, ff:8, fr:6, ap:1, pb:2 }, imp:82 },
  // DB
  { n: "Richard Sherman", p:'CB', t:'SEA', d:'2010s', s:{ int:32, fr:3, td:3, ap:3, pb:5 }, imp:89 },
  { n: "Earl Thomas", p:'S', t:'SEA', d:'2010s', s:{ int:28, ff:11, fr:6, td:2, ap:3, pb:7 }, imp:89 },
  { n: "Patrick Peterson", p:'CB', t:'ARI', d:'2010s', s:{ int:23, fr:6, td:4, ap:3, pb:8 }, imp:88 },
  { n: "Darrelle Revis", p:'CB', t:'NYJ', d:'2010s', s:{ int:15, fr:3, td:1, ap:2, pb:4 }, imp:87 },
  { n: "Eric Berry", p:'S', t:'KC', d:'2010s', s:{ int:14, ff:5, fr:6, td:4, ap:3, pb:5 }, imp:86 },
  { n: "Tyrann Mathieu", p:'S', t:'ARI', d:'2010s', s:{ int:18, ff:8, fr:7, td:2, ap:2, pb:2 }, imp:85 },
  { n: "Chris Harris Jr.", p:'CB', t:'DEN', d:'2010s', s:{ int:20, fr:5, td:2, ap:1, pb:4 }, imp:85 },
  { n: "Kam Chancellor", p:'S', t:'SEA', d:'2010s', s:{ int:12, ff:8, fr:5, td:1, ap:1, pb:4 }, imp:84 },
  { n: "Eric Weddle", p:'S', t:'LAC', d:'2010s', s:{ int:29, ff:8, fr:7, td:2, ap:2, pb:6 }, imp:85 },
  { n: "Aqib Talib", p:'CB', t:'DEN', d:'2010s', s:{ int:35, fr:5, td:10, ap:1, pb:5 }, imp:84 },
  { n: "Joe Haden", p:'CB', t:'CLE', d:'2010s', s:{ int:29, fr:6, td:2, ap:1, pb:3 }, imp:83 },
  { n: "Harrison Smith", p:'S', t:'MIN', d:'2010s', s:{ int:24, ff:8, fr:5, td:3, ap:2, pb:5 }, imp:85 },
  { n: "Malcolm Jenkins", p:'S', t:'PHI', d:'2010s', s:{ int:18, ff:10, fr:8, td:4, ap:1, pb:3 }, imp:84 },
  { n: "Devin McCourty", p:'S', t:'NE', d:'2010s', s:{ int:24, ff:7, fr:6, td:3, ap:1, pb:2 }, imp:83 },
  { n: "Marshon Lattimore", p:'CB', t:'NO', d:'2010s', s:{ int:9, fr:3, td:1, ap:0, pb:3 }, imp:81 },
  { n: "Stephon Gilmore", p:'CB', t:'NE', d:'2010s', s:{ int:21, fr:5, td:3, dpoy:1, ap:2, pb:3 }, imp:87 },

  { n: "Joey Bosa", p:'DE', t:'LAC', d:'2010s', s:{ sk:47.5, int:0, ff:9, fr:4, ap:1, pb:3 }, imp:85 },
  { n: "DeMarcus Lawrence", p:'DE', t:'DAL', d:'2010s', s:{ sk:46, int:1, ff:10, fr:5, ap:1, pb:2 }, imp:83 },
  { n: "Yannick Ngakoue", p:'DE', t:'JAX', d:'2010s', s:{ sk:45.5, int:0, ff:14, fr:3, ap:0, pb:1 }, imp:82 },
  { n: "Damon Harrison", p:'DT', t:'NYG', d:'2010s', s:{ sk:9, int:0, ff:4, fr:5, ap:2, pb:0 }, imp:84 },
  { n: "Kawann Short", p:'DT', t:'CAR', d:'2010s', s:{ sk:32.5, int:1, ff:8, fr:5, ap:1, pb:2 }, imp:83 },
  { n: "Grady Jarrett", p:'DT', t:'ATL', d:'2010s', s:{ sk:25, int:0, ff:4, fr:4, ap:0, pb:1 }, imp:82 },
  { n: "Demario Davis", p:'LB', t:'NO', d:'2010s', s:{ sk:23, int:5, ff:8, fr:5, ap:1, pb:0 }, imp:83 },
  { n: "Deion Jones", p:'LB', t:'ATL', d:'2010s', s:{ sk:5, int:9, ff:5, fr:4, td:2, ap:1, pb:1 }, imp:82 },
  { n: "Jamal Adams", p:'S', t:'NYJ', d:'2010s', s:{ sk:12, int:2, ff:5, fr:4, ap:1, pb:3 }, imp:84 },
  { n: "Casey Hayward", p:'CB', t:'LAC', d:'2010s', s:{ int:23, fr:3, td:2, ap:1, pb:2 }, imp:83 },
  { n: "Xavier Rhodes", p:'CB', t:'MIN', d:'2010s', s:{ int:11, fr:4, td:2, ap:1, pb:3 }, imp:82 },
  { n: "Landon Collins", p:'S', t:'NYG', d:'2010s', s:{ sk:5, int:11, ff:6, fr:5, ap:1, pb:3 }, imp:83 },

  // =====================  2020s  =====================
  // DL
  { n: "Aaron Donald", p:'DT', t:'LAR', d:'2020s', s:{ sk:39.5, int:0, ff:6, fr:3, ap:3, pb:4 }, imp:96 },
  { n: "Myles Garrett", p:'DE', t:'CLE', d:'2020s', s:{ sk:78.5, int:0, ff:14, fr:5, td:1, dpoy:1, ap:4, pb:5 }, imp:95 },
  { n: "Nick Bosa", p:'DE', t:'SF', d:'2020s', s:{ sk:57, int:0, ff:9, fr:3, dpoy:1, ap:2, pb:3 }, imp:91 },
  { n: "Chris Jones", p:'DT', t:'KC', d:'2020s', s:{ sk:55, int:0, ff:7, fr:3, ap:3, pb:5 }, imp:90 },
  { n: "Maxx Crosby", p:'DE', t:'LV', d:'2020s', s:{ sk:55, int:0, ff:11, fr:4, ap:2, pb:4 }, imp:89 },
  { n: "T.J. Watt", p:'DE', t:'PIT', d:'2020s', s:{ sk:81, int:7, ff:25, fr:8, td:1, dpoy:1, ap:4, pb:5 }, imp:94 },
  { n: "Cameron Heyward", p:'DT', t:'PIT', d:'2020s', s:{ sk:34, int:0, ff:5, fr:4, ap:3, pb:4 }, imp:87 },
  { n: "DeForest Buckner", p:'DT', t:'IND', d:'2020s', s:{ sk:36, int:0, ff:6, fr:4, ap:1, pb:2 }, imp:85 },
  { n: "Quinnen Williams", p:'DT', t:'NYJ', d:'2020s', s:{ sk:28, int:0, ff:4, fr:3, ap:1, pb:2 }, imp:85 },
  { n: "Dexter Lawrence", p:'DT', t:'NYG', d:'2020s', s:{ sk:25, int:0, ff:3, fr:2, ap:2, pb:3 }, imp:87 },
  { n: "Trey Hendrickson", p:'DE', t:'CIN', d:'2020s', s:{ sk:57, int:0, ff:7, fr:3, ap:2, pb:3 }, imp:88 },
  { n: "Danielle Hunter", p:'DE', t:'MIN', d:'2020s', s:{ sk:62, int:0, ff:10, fr:4, ap:1, pb:3 }, imp:87 },
  { n: "Cameron Jordan", p:'DE', t:'NO', d:'2020s', s:{ sk:42, int:0, ff:8, fr:4, ap:0, pb:3 }, imp:83 },
  { n: "Jeffery Simmons", p:'DT', t:'TEN', d:'2020s', s:{ sk:30, int:0, ff:4, fr:3, ap:1, pb:2 }, imp:84 },
  { n: "Christian Wilkins", p:'DT', t:'MIA', d:'2020s', s:{ sk:22, int:0, ff:3, fr:3, ap:0, pb:0 }, imp:81 },
  { n: "Calais Campbell", p:'DE', t:'BAL', d:'2020s', s:{ sk:35, int:0, ff:5, fr:4, ap:0, pb:2 }, imp:82 },
  // LB
  { n: "Micah Parsons", p:'LB', t:'DAL', d:'2020s', s:{ sk:52.5, int:1, ff:11, fr:4, dpoy:0, ap:3, pb:4 }, imp:93 },
  { n: "Fred Warner", p:'LB', t:'SF', d:'2020s', s:{ sk:8, int:10, ff:8, fr:7, ap:4, pb:5 }, imp:91 },
  { n: "Roquan Smith", p:'LB', t:'BAL', d:'2020s', s:{ sk:13, int:7, ff:6, fr:5, ap:3, pb:3 }, imp:88 },
  { n: "Bobby Wagner", p:'LB', t:'SEA', d:'2020s', s:{ sk:14, int:5, ff:6, fr:4, ap:3, pb:4 }, imp:88 },
  { n: "Nick Bolton", p:'LB', t:'KC', d:'2020s', s:{ sk:6, int:3, ff:5, fr:4, ap:0, pb:0 }, imp:83 },
  { n: "Matthew Judon", p:'LB', t:'BAL', d:'2020s', s:{ sk:48, int:0, ff:7, fr:3, ap:1, pb:4 }, imp:85 },
  { n: "Haason Reddick", p:'LB', t:'PHI', d:'2020s', s:{ sk:50.5, int:0, ff:17, fr:3, ap:1, pb:1 }, imp:85 },
  { n: "Shaquil Barrett", p:'LB', t:'TB', d:'2020s', s:{ sk:39, int:1, ff:9, fr:3, ap:1, pb:2 }, imp:84 },
  { n: "Demarcus Lawrence", p:'DE', t:'DAL', d:'2020s', s:{ sk:34, int:1, ff:8, fr:5, ap:0, pb:2 }, imp:83 },
  { n: "Josh Allen", p:'DE', t:'JAX', d:'2020s', s:{ sk:45, int:1, ff:9, fr:3, ap:1, pb:2 }, imp:84 },
  { n: "Brian Burns", p:'DE', t:'CAR', d:'2020s', s:{ sk:46, int:0, ff:11, fr:3, ap:0, pb:2 }, imp:83 },
  { n: "Zaire Franklin", p:'LB', t:'IND', d:'2020s', s:{ sk:8, int:3, ff:5, fr:4, ap:1, pb:0 }, imp:82 },
  // DB
  { n: "Trevon Diggs", p:'CB', t:'DAL', d:'2020s', s:{ int:18, fr:2, td:3, ap:1, pb:2 }, imp:84 },
  { n: "Jalen Ramsey", p:'CB', t:'LAR', d:'2020s', s:{ int:13, ff:5, fr:3, td:2, ap:3, pb:5 }, imp:88 },
  { n: "Sauce Gardner", p:'CB', t:'NYJ', d:'2020s', s:{ int:4, fr:2, td:0, ap:2, pb:2 }, imp:88 },
  { n: "Patrick Surtain II", p:'CB', t:'DEN', d:'2020s', s:{ int:8, fr:2, td:2, dpoy:1, ap:2, pb:2 }, imp:90 },
  { n: "Minkah Fitzpatrick", p:'S', t:'PIT', d:'2020s', s:{ int:18, ff:5, fr:5, td:3, ap:3, pb:4 }, imp:89 },
  { n: "Derwin James", p:'S', t:'LAC', d:'2020s', s:{ sk:13, int:6, ff:5, fr:4, ap:3, pb:4 }, imp:89 },
  { n: "Antoine Winfield Jr.", p:'S', t:'TB', d:'2020s', s:{ int:9, ff:11, fr:5, td:1, ap:2, pb:2 }, imp:87 },
  { n: "Budda Baker", p:'S', t:'ARI', d:'2020s', s:{ int:5, ff:6, fr:4, td:1, ap:2, pb:5 }, imp:86 },
  { n: "Jaire Alexander", p:'CB', t:'GB', d:'2020s', s:{ int:9, fr:2, td:1, ap:1, pb:2 }, imp:85 },
  { n: "Marlon Humphrey", p:'CB', t:'BAL', d:'2020s', s:{ int:9, ff:11, fr:4, td:2, ap:1, pb:3 }, imp:85 },
  { n: "Kyle Hamilton", p:'S', t:'BAL', d:'2020s', s:{ int:5, ff:3, fr:3, td:1, ap:2, pb:2 }, imp:87 },
  { n: "L'Jarius Sneed", p:'CB', t:'KC', d:'2020s', s:{ int:6, ff:6, fr:4, td:2, ap:0, pb:1 }, imp:83 },
  { n: "Brian Branch", p:'S', t:'DET', d:'2020s', s:{ int:7, ff:4, fr:3, td:2, ap:1, pb:1 }, imp:84 },
  { n: "Xavien Howard", p:'CB', t:'MIA', d:'2020s', s:{ int:18, fr:3, td:1, ap:2, pb:2 }, imp:85 },
  { n: "Tariq Woolen", p:'CB', t:'SEA', d:'2020s', s:{ int:9, fr:2, td:1, ap:0, pb:1 }, imp:82 },
  { n: "Kerby Joseph", p:'S', t:'DET', d:'2020s', s:{ int:17, ff:3, fr:2, td:2, ap:1, pb:1 }, imp:84 },

  { n: "Will Anderson Jr.", p:'DE', t:'HOU', d:'2020s', s:{ sk:22, int:0, ff:4, fr:3, ap:0, pb:1 }, imp:84 },
  { n: "Montez Sweat", p:'DE', t:'CHI', d:'2020s', s:{ sk:43, int:0, ff:6, fr:4, ap:0, pb:1 }, imp:83 },
  { n: "Josh Hines-Allen", p:'DE', t:'JAX', d:'2020s', s:{ sk:45, int:1, ff:9, fr:3, ap:1, pb:2 }, imp:84 },
  { n: "Rashan Gary", p:'DE', t:'GB', d:'2020s', s:{ sk:39, int:0, ff:6, fr:3, ap:0, pb:1 }, imp:83 },
  { n: "Vita Vea", p:'DT', t:'TB', d:'2020s', s:{ sk:22, int:0, ff:3, fr:3, ap:1, pb:2 }, imp:84 },
  { n: "Jonathan Greenard", p:'DE', t:'MIN', d:'2020s', s:{ sk:34, int:0, ff:9, fr:3, ap:0, pb:1 }, imp:82 },
  { n: "Aidan Hutchinson", p:'DE', t:'DET', d:'2020s', s:{ sk:28, int:1, ff:5, fr:3, ap:1, pb:1 }, imp:86 },
  { n: "Devin White", p:'LB', t:'TB', d:'2020s', s:{ sk:22, int:4, ff:7, fr:6, ap:1, pb:1 }, imp:83 },
  { n: "Tremaine Edmunds", p:'LB', t:'BUF', d:'2020s', s:{ sk:9, int:6, ff:4, fr:5, ap:0, pb:2 }, imp:82 },
  { n: "Foyesade Oluokun", p:'LB', t:'JAX', d:'2020s', s:{ sk:8, int:7, ff:4, fr:5, ap:1, pb:0 }, imp:82 },
  { n: "Quay Walker", p:'LB', t:'GB', d:'2020s', s:{ sk:7, int:3, ff:3, fr:3, ap:0, pb:0 }, imp:80 },
  { n: "DaRon Bland", p:'CB', t:'DAL', d:'2020s', s:{ int:14, fr:2, td:5, ap:1, pb:1 }, imp:84 },
  { n: "Devon Witherspoon", p:'CB', t:'SEA', d:'2020s', s:{ sk:5, int:3, ff:3, fr:2, td:1, ap:1, pb:1 }, imp:84 },
  { n: "Jevon Holland", p:'S', t:'MIA', d:'2020s', s:{ sk:6, int:5, ff:4, fr:3, ap:0, pb:0 }, imp:82 },

];

const UNITS = [
  { n: "Pittsburgh Steelers", p: 'OL', t: 'PIT', d: '1970s', s: { ry: 135, sa: 1.7, pb: 88, pbl: 4 }, imp: 88, key: "Mike Webster · Jon Kolb · Larry Brown" },
  { n: "Miami Dolphins", p: 'OL', t: 'MIA', d: '1970s', s: { ry: 145, sa: 1.5, pb: 92, pbl: 5 }, imp: 92, key: "Larry Little · Jim Langer · Bob Kuechenberg" },
  { n: "Dallas Cowboys", p: 'OL', t: 'DAL', d: '1970s', s: { ry: 140, sa: 1.9, pb: 86, pbl: 4 }, imp: 87, key: "Rayfield Wright · Pat Donovan · John Fitzgerald" },
  { n: "Las Vegas Raiders", p: 'OL', t: 'LV', d: '1970s', s: { ry: 135, sa: 1.6, pb: 90, pbl: 5 }, imp: 89, key: "Art Shell · Gene Upshaw · Dave Dalby" },
  { n: "Washington Redskins", p: 'OL', t: 'WAS', d: '1970s', s: { ry: 130, sa: 2, pb: 84, pbl: 3 }, imp: 82, key: "Len Hauss · George Starke" },
  { n: "Minnesota Vikings", p: 'OL', t: 'MIN', d: '1970s', s: { ry: 125, sa: 1.8, pb: 85, pbl: 3 }, imp: 82, key: "Ron Yary · Mick Tingelhoff · Ed White" },
  { n: "Washington Redskins", p: 'OL', t: 'WAS', d: '1980s', s: { ry: 145, sa: 1.4, pb: 94, pbl: 6 }, imp: 95, key: "Russ Grimm · Joe Jacoby · Jim Lachey · The Hogs" },
  { n: "San Francisco 49ers", p: 'OL', t: 'SF', d: '1980s', s: { ry: 130, sa: 1.5, pb: 92, pbl: 4 }, imp: 90, key: "Randy Cross · Keith Fahnhorst · Harris Barton" },
  { n: "Cincinnati Bengals", p: 'OL', t: 'CIN', d: '1980s', s: { ry: 135, sa: 1.6, pb: 90, pbl: 4 }, imp: 88, key: "Anthony Muñoz · Max Montoya" },
  { n: "Chicago Bears", p: 'OL', t: 'CHI', d: '1980s', s: { ry: 150, sa: 1.7, pb: 86, pbl: 3 }, imp: 86, key: "Jimbo Covert · Jim Covert · Mark Bortz" },
  { n: "Buffalo Bills", p: 'OL', t: 'BUF', d: '1980s', s: { ry: 130, sa: 1.8, pb: 87, pbl: 3 }, imp: 83, key: "Will Wolford · Howard Ballard · Kent Hull" },
  { n: "Las Vegas Raiders", p: 'OL', t: 'LV', d: '1980s', s: { ry: 135, sa: 1.7, pb: 88, pbl: 3 }, imp: 84, key: "Henry Lawrence · Mickey Marvin · Don Mosebar" },
  { n: "Dallas Cowboys", p: 'OL', t: 'DAL', d: '1990s', s: { ry: 145, sa: 1.4, pb: 95, pbl: 6 }, imp: 96, key: "Larry Allen · Erik Williams · Nate Newton · Mark Stepnoski" },
  { n: "Denver Broncos", p: 'OL', t: 'DEN', d: '1990s', s: { ry: 155, sa: 1.6, pb: 90, pbl: 4 }, imp: 91, key: "Gary Zimmerman · Mark Schlereth · Tom Nalen" },
  { n: "Pittsburgh Steelers", p: 'OL', t: 'PIT', d: '1990s', s: { ry: 140, sa: 1.7, pb: 88, pbl: 3 }, imp: 86, key: "Dermontti Dawson · Tunch Ilkin" },
  { n: "Washington Redskins", p: 'OL', t: 'WAS', d: '1990s', s: { ry: 135, sa: 1.6, pb: 89, pbl: 4 }, imp: 86, key: "Jim Lachey · Jeff Bostic · Mark Schlereth" },
  { n: "San Francisco 49ers", p: 'OL', t: 'SF', d: '1990s', s: { ry: 130, sa: 1.5, pb: 92, pbl: 4 }, imp: 89, key: "Steve Wallace · Harris Barton · Jesse Sapolu" },
  { n: "Buffalo Bills", p: 'OL', t: 'BUF', d: '1990s', s: { ry: 130, sa: 1.7, pb: 88, pbl: 3 }, imp: 84, key: "Jim Ritcher · Kent Hull · Will Wolford" },
  { n: "Indianapolis Colts", p: 'OL', t: 'IND', d: '2000s', s: { ry: 110, sa: 1, pb: 95, pbl: 4 }, imp: 92, key: "Tarik Glenn · Jeff Saturday · Ryan Diem" },
  { n: "Denver Broncos", p: 'OL', t: 'DEN', d: '2000s', s: { ry: 150, sa: 1.5, pb: 90, pbl: 3 }, imp: 89, key: "Tom Nalen · Cooper Carlisle · Matt Lepsis" },
  { n: "Pittsburgh Steelers", p: 'OL', t: 'PIT', d: '2000s', s: { ry: 130, sa: 1.7, pb: 88, pbl: 4 }, imp: 87, key: "Alan Faneca · Marvel Smith · Jeff Hartings" },
  { n: "New Orleans Saints", p: 'OL', t: 'NO', d: '2000s', s: { ry: 115, sa: 1.3, pb: 92, pbl: 3 }, imp: 87, key: "Jahri Evans · Carl Nicks · Jon Stinchcomb" },
  { n: "Kansas City Chiefs", p: 'OL', t: 'KC', d: '2000s', s: { ry: 140, sa: 1.5, pb: 92, pbl: 5 }, imp: 91, key: "Willie Roaf · Will Shields · Brian Waters" },
  { n: "Philadelphia Eagles", p: 'OL', t: 'PHI', d: '2000s', s: { ry: 125, sa: 1.6, pb: 89, pbl: 3 }, imp: 84, key: "Jon Runyan · Tra Thomas · Shawn Andrews" },
  { n: "Dallas Cowboys", p: 'OL', t: 'DAL', d: '2010s', s: { ry: 145, sa: 1.2, pb: 95, pbl: 6 }, imp: 95, key: "Tyron Smith · Travis Frederick · Zack Martin" },
  { n: "Philadelphia Eagles", p: 'OL', t: 'PHI', d: '2010s', s: { ry: 135, sa: 1.3, pb: 93, pbl: 5 }, imp: 91, key: "Jason Peters · Jason Kelce · Brandon Brooks · Lane Johnson" },
  { n: "New Orleans Saints", p: 'OL', t: 'NO', d: '2010s', s: { ry: 115, sa: 1.1, pb: 93, pbl: 4 }, imp: 88, key: "Jahri Evans · Terron Armstead · Max Unger" },
  { n: "Cleveland Browns", p: 'OL', t: 'CLE', d: '2010s', s: { ry: 130, sa: 1.4, pb: 91, pbl: 4 }, imp: 87, key: "Joe Thomas · Alex Mack · Joel Bitonio" },
  { n: "New England Patriots", p: 'OL', t: 'NE', d: '2010s', s: { ry: 110, sa: 1.4, pb: 90, pbl: 3 }, imp: 85, key: "Logan Mankins · Matt Light · Sebastian Vollmer" },
  { n: "Las Vegas Raiders", p: 'OL', t: 'LV', d: '2010s', s: { ry: 125, sa: 1.5, pb: 88, pbl: 3 }, imp: 84, key: "Donald Penn · Rodney Hudson · Kelechi Osemele" },
  { n: "Philadelphia Eagles", p: 'OL', t: 'PHI', d: '2020s', s: { ry: 150, sa: 1.2, pb: 96, pbl: 5 }, imp: 96, key: "Jason Kelce · Lane Johnson · Jordan Mailata · Landon Dickerson" },
  { n: "San Francisco 49ers", p: 'OL', t: 'SF', d: '2020s', s: { ry: 140, sa: 1.3, pb: 92, pbl: 3 }, imp: 90, key: "Trent Williams · Daniel Brunskill · Mike McGlinchey" },
  { n: "Detroit Lions", p: 'OL', t: 'DET', d: '2020s', s: { ry: 145, sa: 1.3, pb: 93, pbl: 4 }, imp: 91, key: "Penei Sewell · Frank Ragnow · Taylor Decker" },
  { n: "Kansas City Chiefs", p: 'OL', t: 'KC', d: '2020s', s: { ry: 110, sa: 1.4, pb: 91, pbl: 3 }, imp: 86, key: "Joe Thuney · Creed Humphrey · Trey Smith" },
  { n: "Cleveland Browns", p: 'OL', t: 'CLE', d: '2020s', s: { ry: 140, sa: 1.5, pb: 89, pbl: 3 }, imp: 86, key: "Joel Bitonio · Wyatt Teller · Jedrick Wills" },
  { n: "Baltimore Ravens", p: 'OL', t: 'BAL', d: '2020s', s: { ry: 175, sa: 1.5, pb: 88, pbl: 3 }, imp: 88, key: "Ronnie Stanley · Kevin Zeitler · Tyler Linderbaum" },
  { n: "Pittsburgh Steelers", p: 'DEF', t: 'PIT', d: '1970s', s: { pa: 11.6, ya: 250, to: 2.8, sk: 3.5 }, imp: 98, key: "Joe Greene · Jack Lambert · Jack Ham · Mel Blount · Steel Curtain" },
  { n: "Minnesota Vikings", p: 'DEF', t: 'MIN', d: '1970s', s: { pa: 13.5, ya: 270, to: 2.5, sk: 3.4 }, imp: 90, key: "Alan Page · Carl Eller · Jim Marshall · Purple People Eaters" },
  { n: "Dallas Cowboys", p: 'DEF', t: 'DAL', d: '1970s', s: { pa: 14, ya: 280, to: 2.6, sk: 3.2 }, imp: 89, key: "Randy White · Harvey Martin · Ed Jones · Cliff Harris" },
  { n: "Miami Dolphins", p: 'DEF', t: 'MIA', d: '1970s', s: { pa: 13.8, ya: 275, to: 2.4, sk: 3 }, imp: 89, key: "Nick Buoniconti · Dick Anderson · Bill Stanfill · No-Name Defense" },
  { n: "Las Vegas Raiders", p: 'DEF', t: 'LV', d: '1970s', s: { pa: 15.2, ya: 290, to: 2.5, sk: 3 }, imp: 87, key: "Willie Brown · Jack Tatum · Phil Villapiano · Ted Hendricks" },
  { n: "Denver Broncos", p: 'DEF', t: 'DEN', d: '1970s', s: { pa: 14.5, ya: 285, to: 2.5, sk: 3.3 }, imp: 87, key: "Randy Gradishar · Tom Jackson · Lyle Alzado · Orange Crush" },
  { n: "Los Angeles Rams", p: 'DEF', t: 'LAR', d: '1970s', s: { pa: 14.8, ya: 290, to: 2.3, sk: 3.4 }, imp: 86, key: "Jack Youngblood · Jack Reynolds · Fred Dryer" },
  { n: "Chicago Bears", p: 'DEF', t: 'CHI', d: '1980s', s: { pa: 12.4, ya: 258, to: 2.8, sk: 4 }, imp: 99, key: "Mike Singletary · Richard Dent · Dan Hampton · Steve McMichael · 46 Defense" },
  { n: "New York Giants", p: 'DEF', t: 'NYG', d: '1980s', s: { pa: 14.5, ya: 285, to: 2.5, sk: 3.5 }, imp: 92, key: "Lawrence Taylor · Harry Carson · Carl Banks · Leonard Marshall" },
  { n: "San Francisco 49ers", p: 'DEF', t: 'SF', d: '1980s', s: { pa: 14.8, ya: 280, to: 2.6, sk: 3.2 }, imp: 89, key: "Ronnie Lott · Charles Haley · Eric Wright · Hacksaw Reynolds" },
  { n: "Washington Redskins", p: 'DEF', t: 'WAS', d: '1980s', s: { pa: 15.5, ya: 290, to: 2.6, sk: 3.4 }, imp: 87, key: "Dexter Manley · Charles Mann · Darrell Green" },
  { n: "Philadelphia Eagles", p: 'DEF', t: 'PHI', d: '1980s', s: { pa: 14, ya: 275, to: 2.4, sk: 3.7 }, imp: 88, key: "Reggie White · Jerome Brown · Seth Joyner · Clyde Simmons" },
  { n: "Denver Broncos", p: 'DEF', t: 'DEN', d: '1980s', s: { pa: 16.2, ya: 295, to: 2.3, sk: 3 }, imp: 84, key: "Karl Mecklenburg · Dennis Smith · Steve Atwater" },
  { n: "Las Vegas Raiders", p: 'DEF', t: 'LV', d: '1980s', s: { pa: 15.8, ya: 290, to: 2.5, sk: 3.5 }, imp: 86, key: "Howie Long · Ted Hendricks · Lester Hayes · Mike Haynes" },
  { n: "Baltimore Ravens", p: 'DEF', t: 'BAL', d: '1990s', s: { pa: 14.5, ya: 270, to: 2.6, sk: 3.5 }, imp: 88, key: "Ray Lewis · Peter Boulware · Rod Woodson" },
  { n: "Dallas Cowboys", p: 'DEF', t: 'DAL', d: '1990s', s: { pa: 15, ya: 275, to: 2.5, sk: 3.4 }, imp: 89, key: "Charles Haley · Leon Lett · Darren Woodson · Deion Sanders" },
  { n: "San Francisco 49ers", p: 'DEF', t: 'SF', d: '1990s', s: { pa: 15.5, ya: 285, to: 2.5, sk: 3.3 }, imp: 88, key: "Bryant Young · Ken Norton Jr. · Deion Sanders · Merton Hanks" },
  { n: "Pittsburgh Steelers", p: 'DEF', t: 'PIT', d: '1990s', s: { pa: 15.2, ya: 280, to: 2.6, sk: 3.6 }, imp: 89, key: "Greg Lloyd · Kevin Greene · Rod Woodson · Carnell Lake" },
  { n: "Buffalo Bills", p: 'DEF', t: 'BUF', d: '1990s', s: { pa: 16, ya: 290, to: 2.4, sk: 3.5 }, imp: 86, key: "Bruce Smith · Cornelius Bennett · Darryl Talley" },
  { n: "Green Bay Packers", p: 'DEF', t: 'GB', d: '1990s', s: { pa: 15.5, ya: 285, to: 2.7, sk: 3.5 }, imp: 88, key: "Reggie White · Sean Jones · LeRoy Butler · Santana Dotson" },
  { n: "Philadelphia Eagles", p: 'DEF', t: 'PHI', d: '1990s', s: { pa: 16.5, ya: 295, to: 2.4, sk: 3.4 }, imp: 84, key: "Reggie White · Jerome Brown · Eric Allen · Clyde Simmons" },
  { n: "Baltimore Ravens", p: 'DEF', t: 'BAL', d: '2000s', s: { pa: 12, ya: 245, to: 2.8, sk: 3.8 }, imp: 97, key: "Ray Lewis · Ed Reed · Terrell Suggs · Haloti Ngata" },
  { n: "Tampa Bay Buccaneers", p: 'DEF', t: 'TB', d: '2000s', s: { pa: 12.3, ya: 252, to: 2.7, sk: 3.5 }, imp: 95, key: "Derrick Brooks · Warren Sapp · John Lynch · Ronde Barber" },
  { n: "Pittsburgh Steelers", p: 'DEF', t: 'PIT', d: '2000s', s: { pa: 14.5, ya: 268, to: 2.5, sk: 3.6 }, imp: 91, key: "Troy Polamalu · James Harrison · Joey Porter · Casey Hampton" },
  { n: "New England Patriots", p: 'DEF', t: 'NE', d: '2000s', s: { pa: 16.5, ya: 290, to: 2.4, sk: 3 }, imp: 86, key: "Tedy Bruschi · Mike Vrabel · Ty Law · Rodney Harrison" },
  { n: "Philadelphia Eagles", p: 'DEF', t: 'PHI', d: '2000s', s: { pa: 16, ya: 285, to: 2.5, sk: 3.5 }, imp: 87, key: "Brian Dawkins · Jeremiah Trotter · Lito Sheppard · Asante Samuel" },
  { n: "Chicago Bears", p: 'DEF', t: 'CHI', d: '2000s', s: { pa: 15.5, ya: 282, to: 2.6, sk: 3.4 }, imp: 87, key: "Brian Urlacher · Lance Briggs · Charles Tillman · Mike Brown" },
  { n: "Indianapolis Colts", p: 'DEF', t: 'IND', d: '2000s', s: { pa: 18, ya: 295, to: 2.3, sk: 3.2 }, imp: 82, key: "Dwight Freeney · Robert Mathis · Bob Sanders" },
  { n: "Seattle Seahawks", p: 'DEF', t: 'SEA', d: '2010s', s: { pa: 14.2, ya: 274, to: 2.5, sk: 2.9 }, imp: 97, key: "Richard Sherman · Earl Thomas · Kam Chancellor · Bobby Wagner · Legion of Boom" },
  { n: "Denver Broncos", p: 'DEF', t: 'DEN', d: '2010s', s: { pa: 18.5, ya: 283, to: 2.5, sk: 3.2 }, imp: 92, key: "Von Miller · DeMarcus Ware · Aqib Talib · Chris Harris Jr." },
  { n: "San Francisco 49ers", p: 'DEF', t: 'SF', d: '2010s', s: { pa: 17, ya: 285, to: 2.4, sk: 3.1 }, imp: 88, key: "Patrick Willis · NaVorro Bowman · Aldon Smith · Justin Smith" },
  { n: "Houston Texans", p: 'DEF', t: 'HOU', d: '2010s', s: { pa: 19.5, ya: 290, to: 2.2, sk: 3.4 }, imp: 84, key: "J.J. Watt · Jadeveon Clowney · Brian Cushing" },
  { n: "Carolina Panthers", p: 'DEF', t: 'CAR', d: '2010s', s: { pa: 19.3, ya: 295, to: 2.3, sk: 2.9 }, imp: 86, key: "Luke Kuechly · Thomas Davis · Josh Norman" },
  { n: "Baltimore Ravens", p: 'DEF', t: 'BAL', d: '2010s', s: { pa: 17.8, ya: 280, to: 2.4, sk: 3.2 }, imp: 87, key: "Ray Lewis · Ed Reed · Terrell Suggs · Haloti Ngata" },
  { n: "New York Giants", p: 'DEF', t: 'NYG', d: '2010s', s: { pa: 20, ya: 300, to: 2.2, sk: 3 }, imp: 82, key: "Jason Pierre-Paul · Justin Tuck · Antrel Rolle" },
  { n: "San Francisco 49ers", p: 'DEF', t: 'SF', d: '2020s', s: { pa: 17.5, ya: 285, to: 2.3, sk: 3.4 }, imp: 92, key: "Nick Bosa · Fred Warner · Talanoa Hufanga · Charvarius Ward" },
  { n: "Buffalo Bills", p: 'DEF', t: 'BUF', d: '2020s', s: { pa: 18, ya: 285, to: 2.4, sk: 2.8 }, imp: 88, key: "Von Miller · Tre'Davious White · Matt Milano · Jordan Poyer" },
  { n: "Dallas Cowboys", p: 'DEF', t: 'DAL', d: '2020s', s: { pa: 19, ya: 295, to: 2.5, sk: 3.2 }, imp: 88, key: "Micah Parsons · DeMarcus Lawrence · Trevon Diggs" },
  { n: "Baltimore Ravens", p: 'DEF', t: 'BAL', d: '2020s', s: { pa: 16.5, ya: 280, to: 2.5, sk: 3.5 }, imp: 92, key: "Roquan Smith · Patrick Queen · Kyle Hamilton · Marlon Humphrey" },
  { n: "Philadelphia Eagles", p: 'DEF', t: 'PHI', d: '2020s', s: { pa: 18.5, ya: 290, to: 2.4, sk: 3.4 }, imp: 88, key: "Haason Reddick · Fletcher Cox · Darius Slay · Brandon Graham" },
  { n: "Pittsburgh Steelers", p: 'DEF', t: 'PIT', d: '2020s', s: { pa: 19.5, ya: 295, to: 2.4, sk: 3.1 }, imp: 86, key: "T.J. Watt · Cameron Heyward · Minkah Fitzpatrick" },
  { n: "New York Jets", p: 'DEF', t: 'NYJ', d: '2020s', s: { pa: 18.8, ya: 280, to: 2.3, sk: 3 }, imp: 85, key: "Sauce Gardner · Quinnen Williams · C.J. Mosley" },
  { n: "Detroit Lions", p: 'DEF', t: 'DET', d: '2020s', s: { pa: 20, ya: 295, to: 2.4, sk: 3 }, imp: 84, key: "Aidan Hutchinson · Brian Branch · Alim McNeill" },
  { n: "Atlanta Falcons", p: 'OL', t: 'ATL', d: '1980s', s: { ry: 130, sa: 1.7, pb: 87, pbl: 2 }, imp: 80, key: "Mike Kenn · Bill Fralic · Jeff Van Note" },
  { n: "Tennessee Titans", p: 'OL', t: 'TEN', d: '1980s', s: { ry: 125, sa: 1.6, pb: 86, pbl: 2 }, imp: 80, key: "Mike Munchak · Bruce Matthews · Bob Young" },
  { n: "Seattle Seahawks", p: 'OL', t: 'SEA', d: '2000s', s: { ry: 135, sa: 1.6, pb: 91, pbl: 3 }, imp: 88, key: "Walter Jones · Steve Hutchinson · Robbie Tobeck" },
  { n: "New York Giants", p: 'OL', t: 'NYG', d: '2000s', s: { ry: 125, sa: 1.8, pb: 88, pbl: 2 }, imp: 84, key: "Chris Snee · David Diehl · Shaun O'Hara" },
  { n: "New York Jets", p: 'OL', t: 'NYJ', d: '2010s', s: { ry: 130, sa: 1.7, pb: 89, pbl: 3 }, imp: 86, key: "Nick Mangold · D'Brickashaw Ferguson · Brandon Moore" },
  { n: "Tampa Bay Buccaneers", p: 'OL', t: 'TB', d: '2020s', s: { ry: 120, sa: 1.5, pb: 92, pbl: 3 }, imp: 88, key: "Tristan Wirfs · Ali Marpet · Ryan Jensen" },
  { n: "Tennessee Titans", p: 'OL', t: 'TEN', d: '2010s', s: { ry: 145, sa: 1.8, pb: 86, pbl: 2 }, imp: 84, key: "Taylor Lewan · Jack Conklin · Ben Jones" },
  { n: "Arizona Cardinals", p: 'OL', t: 'ARI', d: '2010s', s: { ry: 115, sa: 1.9, pb: 85, pbl: 1 }, imp: 78, key: "Lyle Sendlein · Bobby Massie · Jared Veldheer" },
  { n: "Jacksonville Jaguars", p: 'OL', t: 'JAX', d: '1990s', s: { ry: 130, sa: 1.8, pb: 87, pbl: 2 }, imp: 82, key: "Tony Boselli · Leon Searcy · Ben Coleman" },
  { n: "Detroit Lions", p: 'OL', t: 'DET', d: '1990s', s: { ry: 145, sa: 1.7, pb: 88, pbl: 2 }, imp: 86, key: "Lomas Brown · Kevin Glover · Mike Compton" },
  { n: "Minnesota Vikings", p: 'OL', t: 'MIN', d: '1990s', s: { ry: 130, sa: 1.6, pb: 89, pbl: 3 }, imp: 86, key: "Randall McDaniel · Todd Steussie · Jeff Christy" },
  { n: "Carolina Panthers", p: 'OL', t: 'CAR', d: '2000s', s: { ry: 130, sa: 1.7, pb: 88, pbl: 2 }, imp: 84, key: "Jordan Gross · Travelle Wharton · Justin Hartwig" },
  { n: "Arizona Cardinals", p: 'DEF', t: 'ARI', d: '2000s', s: { pa: 19, ya: 295, to: 2.4, sk: 3 }, imp: 84, key: "Bertrand Berry · Karlos Dansby · Adrian Wilson" },
  { n: "Jacksonville Jaguars", p: 'DEF', t: 'JAX', d: '2010s', s: { pa: 16.8, ya: 275, to: 2.5, sk: 3.7 }, imp: 90, key: "Calais Campbell · Jalen Ramsey · Telvin Smith · Yannick Ngakoue" },
  { n: "New Orleans Saints", p: 'DEF', t: 'NO', d: '2000s', s: { pa: 21, ya: 320, to: 2.5, sk: 3 }, imp: 82, key: "Will Smith · Jonathan Vilma · Darren Sharper" },
  { n: "Los Angeles Chargers", p: 'DEF', t: 'LAC', d: '2000s', s: { pa: 19, ya: 295, to: 2.4, sk: 3.2 }, imp: 86, key: "Shawne Merriman · Antonio Cromartie · Jamal Williams" },
  { n: "Tennessee Titans", p: 'DEF', t: 'TEN', d: '2000s', s: { pa: 18, ya: 285, to: 2.5, sk: 3.2 }, imp: 86, key: "Albert Haynesworth · Keith Bulluck · Cortland Finnegan" },
  { n: "New York Jets", p: 'DEF', t: 'NYJ', d: '1980s', s: { pa: 18, ya: 285, to: 2.5, sk: 3.4 }, imp: 86, key: "Joe Klecko · Mark Gastineau · Marty Lyons" },
  { n: "Washington Redskins", p: 'DEF', t: 'WAS', d: '2000s', s: { pa: 17, ya: 280, to: 2.4, sk: 3.2 }, imp: 86, key: "Sean Taylor · LaVar Arrington · Shawn Springs" },
  { n: "Kansas City Chiefs", p: 'DEF', t: 'KC', d: '1970s', s: { pa: 16.5, ya: 280, to: 2.4, sk: 3.1 }, imp: 84, key: "Buck Buchanan · Willie Lanier · Bobby Bell" },
  { n: "Cleveland Browns", p: 'OL', t: 'CLE', d: '1980s', s: { ry: 135, sa: 1.7, pb: 87, pbl: 2 }, imp: 82, key: "Cody Risien · Mike Baab · Paul Farren" },
  { n: "Seattle Seahawks", p: 'OL', t: 'SEA', d: '1980s', s: { ry: 130, sa: 1.7, pb: 86, pbl: 1 }, imp: 78, key: "Bryan Millard · Edwin Bailey · Blair Bush" },
  { n: "Tampa Bay Buccaneers", p: 'OL', t: 'TB', d: '1980s', s: { ry: 115, sa: 2.1, pb: 82, pbl: 0 }, imp: 70, key: "Sean Farrell · Steve Wilson · Randy Grimes" },
  { n: "Green Bay Packers", p: 'OL', t: 'GB', d: '1990s', s: { ry: 130, sa: 1.6, pb: 89, pbl: 3 }, imp: 86, key: "Frank Winters · Adam Timmerman · Marco Rivera" },
  { n: "Pittsburgh Steelers", p: 'OL', t: 'PIT', d: '2010s', s: { ry: 125, sa: 1.5, pb: 92, pbl: 3 }, imp: 88, key: "David DeCastro · Maurkice Pouncey · Marcus Gilbert" },
  { n: "Atlanta Falcons", p: 'OL', t: 'ATL', d: '2010s', s: { ry: 125, sa: 1.7, pb: 90, pbl: 2 }, imp: 84, key: "Alex Mack · Jake Matthews · Andy Levitre" },
  { n: "Carolina Panthers", p: 'OL', t: 'CAR', d: '2010s', s: { ry: 135, sa: 1.7, pb: 87, pbl: 2 }, imp: 82, key: "Ryan Kalil · Mike Remmers · Andrew Norwell" },
  { n: "Cincinnati Bengals", p: 'OL', t: 'CIN', d: '2010s', s: { ry: 120, sa: 1.8, pb: 86, pbl: 1 }, imp: 78, key: "Andrew Whitworth · Kevin Zeitler · Clint Boling" },
  { n: "Miami Dolphins", p: 'OL', t: 'MIA', d: '2020s', s: { ry: 115, sa: 1.6, pb: 87, pbl: 1 }, imp: 78, key: "Terron Armstead · Connor Williams · Liam Eichenberg" },
  { n: "Arizona Cardinals", p: 'DEF', t: 'ARI', d: '1970s', s: { pa: 18.5, ya: 295, to: 2.4, sk: 2.8 }, imp: 80, key: "Larry Stallings · Dan Dierdorf · Roger Wehrli" },
  { n: "Cincinnati Bengals", p: 'DEF', t: 'CIN', d: '1970s', s: { pa: 17.5, ya: 285, to: 2.4, sk: 3 }, imp: 82, key: "Coy Bacon · Reggie Williams · Lemar Parrish" },
  { n: "Tennessee Titans", p: 'DEF', t: 'TEN', d: '1970s', s: { pa: 17, ya: 290, to: 2.5, sk: 3.1 }, imp: 84, key: "Curley Culp · Robert Brazile · Elvin Bethea" },
  { n: "Buffalo Bills", p: 'DEF', t: 'BUF', d: '1980s', s: { pa: 18, ya: 290, to: 2.5, sk: 3.4 }, imp: 84, key: "Bruce Smith · Cornelius Bennett · Darryl Talley" },
  { n: "Cleveland Browns", p: 'DEF', t: 'CLE', d: '1980s', s: { pa: 18, ya: 290, to: 2.5, sk: 3.2 }, imp: 82, key: "Hanford Dixon · Frank Minnifield · Clay Matthews Sr." },
  { n: "Tennessee Titans", p: 'DEF', t: 'TEN', d: '1980s', s: { pa: 18, ya: 290, to: 2.5, sk: 3.3 }, imp: 82, key: "Sean Jones · Ray Childress · Robert Lyles" },
  { n: "New Orleans Saints", p: 'DEF', t: 'NO', d: '1990s', s: { pa: 17.5, ya: 285, to: 2.5, sk: 3.4 }, imp: 86, key: "Rickey Jackson · Pat Swilling · Sam Mills · Vaughan Johnson" },
  { n: "New York Jets", p: 'DEF', t: 'NYJ', d: '1990s', s: { pa: 19, ya: 295, to: 2.4, sk: 3 }, imp: 80, key: "Marvin Jones · Hugh Douglas · Aaron Glenn" },
  { n: "Miami Dolphins", p: 'DEF', t: 'MIA', d: '1990s', s: { pa: 17.5, ya: 285, to: 2.5, sk: 3.2 }, imp: 84, key: "Jason Taylor · Zach Thomas · Patrick Surtain" },
  { n: "Miami Dolphins", p: 'DEF', t: 'MIA', d: '2000s', s: { pa: 18.5, ya: 290, to: 2.4, sk: 3.3 }, imp: 84, key: "Jason Taylor · Zach Thomas · Joey Porter" },
  { n: "Carolina Panthers", p: 'DEF', t: 'CAR', d: '2000s', s: { pa: 17.5, ya: 285, to: 2.5, sk: 3.5 }, imp: 86, key: "Julius Peppers · Mike Rucker · Dan Morgan" },
  { n: "Cincinnati Bengals", p: 'DEF', t: 'CIN', d: '2010s', s: { pa: 20.5, ya: 305, to: 2.3, sk: 3 }, imp: 80, key: "Geno Atkins · Vontaze Burfict · Carlos Dunlap" },
  { n: "Arizona Cardinals", p: 'DEF', t: 'ARI', d: '2010s', s: { pa: 18.5, ya: 290, to: 2.4, sk: 3.2 }, imp: 84, key: "Patrick Peterson · Tyrann Mathieu · Calais Campbell" },
  { n: "New Orleans Saints", p: 'DEF', t: 'NO', d: '2010s', s: { pa: 22, ya: 305, to: 2.4, sk: 3 }, imp: 80, key: "Cameron Jordan · Marshon Lattimore · Demario Davis" },
  { n: "Tennessee Titans", p: 'DEF', t: 'TEN', d: '2010s', s: { pa: 20.5, ya: 300, to: 2.3, sk: 3 }, imp: 80, key: "Jurrell Casey · Logan Ryan · Kevin Byard" },
  { n: "Cleveland Browns", p: 'DEF', t: 'CLE', d: '2020s', s: { pa: 17.8, ya: 280, to: 2.4, sk: 3.5 }, imp: 88, key: "Myles Garrett · Denzel Ward · Jeremiah Owusu-Koramoah" },
  { n: "Cincinnati Bengals", p: 'DEF', t: 'CIN', d: '2020s', s: { pa: 21, ya: 305, to: 2.3, sk: 3.2 }, imp: 80, key: "Trey Hendrickson · Logan Wilson · Jessie Bates" },
  { n: "Los Angeles Rams", p: 'DEF', t: 'LAR', d: '2010s', s: { pa: 18.5, ya: 290, to: 2.5, sk: 3.4 }, imp: 86, key: "Aaron Donald · Robert Quinn · Janoris Jenkins" },
  { n: "Los Angeles Rams", p: 'DEF', t: 'LAR', d: '2020s', s: { pa: 18.5, ya: 285, to: 2.5, sk: 3.4 }, imp: 88, key: "Aaron Donald · Jalen Ramsey · Bobby Wagner" },
  { n: "New York Jets", p: 'DEF', t: 'NYJ', d: '2010s', s: { pa: 19.5, ya: 295, to: 2.3, sk: 3 }, imp: 80, key: "Darrelle Revis · Muhammad Wilkerson · Calvin Pace" },
  { n: "New England Patriots", p: 'OL', t: 'NE', d: '1970s', s: { ry: 150, sa: 1.9, pb: 88, pbl: 4 }, imp: 86, key: "John Hannah · Leon Gray · Sam Adams" },
  { n: "Los Angeles Rams", p: 'OL', t: 'LAR', d: '1970s', s: { ry: 140, sa: 2, pb: 86, pbl: 3 }, imp: 82, key: "Tom Mack · Charlie Cowan · Joe Scibelli" },
  { n: "Buffalo Bills", p: 'OL', t: 'BUF', d: '1970s', s: { ry: 152, sa: 2.2, pb: 84, pbl: 3 }, imp: 81, key: "Reggie McKenzie · Joe DeLamielleure · Dave Foley" },
  { n: "Indianapolis Colts", p: 'OL', t: 'IND', d: '1970s', s: { ry: 125, sa: 2.1, pb: 84, pbl: 2 }, imp: 78, key: "George Kunz · Robert Pratt · Ken Mendenhall" },
  { n: "Cincinnati Bengals", p: 'OL', t: 'CIN', d: '1970s', s: { ry: 130, sa: 2, pb: 85, pbl: 2 }, imp: 79, key: "Bob Johnson · Vern Holland · Rufus Mayes" },
  { n: "Miami Dolphins", p: 'OL', t: 'MIA', d: '1980s', s: { ry: 120, sa: 1.3, pb: 94, pbl: 5 }, imp: 90, key: "Dwight Stephenson · Ed Newman · Jon Giesler" },
  { n: "New York Giants", p: 'OL', t: 'NYG', d: '1980s', s: { ry: 135, sa: 1.9, pb: 87, pbl: 3 }, imp: 84, key: "Brad Benson · Bart Oates · Karl Nelson" },
  { n: "Los Angeles Rams", p: 'OL', t: 'LAR', d: '1980s', s: { ry: 150, sa: 2, pb: 86, pbl: 3 }, imp: 85, key: "Jackie Slater · Dennis Harrah · Doug Smith" },
  { n: "Denver Broncos", p: 'OL', t: 'DEN', d: '1980s', s: { ry: 125, sa: 2, pb: 85, pbl: 2 }, imp: 80, key: "Keith Bishop · Bill Bryan · Dave Studdard" },
  { n: "New England Patriots", p: 'OL', t: 'NE', d: '1980s', s: { ry: 140, sa: 1.8, pb: 88, pbl: 3 }, imp: 84, key: "John Hannah · Pete Brock · Brian Holloway" },
  { n: "Dallas Cowboys", p: 'OL', t: 'DAL', d: '1980s', s: { ry: 130, sa: 2, pb: 86, pbl: 2 }, imp: 82, key: "Tom Rafferty · Kurt Petersen · Glen Titensor" },
  { n: "New York Jets", p: 'OL', t: 'NYJ', d: '1980s', s: { ry: 128, sa: 1.9, pb: 86, pbl: 2 }, imp: 81, key: "Marvin Powell · Joe Fields · Dan Alexander" },
  { n: "Miami Dolphins", p: 'OL', t: 'MIA', d: '1990s', s: { ry: 115, sa: 1.6, pb: 90, pbl: 3 }, imp: 85, key: "Richmond Webb · Keith Sims · Ron Heller" },
  { n: "Kansas City Chiefs", p: 'OL', t: 'KC', d: '1990s', s: { ry: 130, sa: 1.8, pb: 89, pbl: 4 }, imp: 86, key: "Will Shields · Tim Grunhard · Dave Szott" },
  { n: "New England Patriots", p: 'OL', t: 'NE', d: '1990s', s: { ry: 120, sa: 1.9, pb: 87, pbl: 3 }, imp: 83, key: "Bruce Armstrong · Max Lane · Dave Wohlabaugh" },
  { n: "New York Giants", p: 'OL', t: 'NYG', d: '1990s', s: { ry: 128, sa: 2, pb: 86, pbl: 2 }, imp: 81, key: "Jumbo Elliott · William Roberts · Doug Riesenberg" },
  { n: "Indianapolis Colts", p: 'OL', t: 'IND', d: '1990s', s: { ry: 122, sa: 1.9, pb: 87, pbl: 2 }, imp: 82, key: "Will Wolford · Kirk Lowdermilk · Joe Staysniak" },
  { n: "Carolina Panthers", p: 'OL', t: 'CAR', d: '1990s', s: { ry: 120, sa: 1.9, pb: 86, pbl: 2 }, imp: 80, key: "Blake Brockermeyer · Frank Garcia · Greg Skrepenak" },
  { n: "Baltimore Ravens", p: 'OL', t: 'BAL', d: '2000s', s: { ry: 138, sa: 1.6, pb: 91, pbl: 4 }, imp: 88, key: "Jonathan Ogden · Edwin Mulitalo · Mike Flynn" },
  { n: "Washington Redskins", p: 'OL', t: 'WAS', d: '2000s', s: { ry: 135, sa: 1.8, pb: 89, pbl: 3 }, imp: 85, key: "Chris Samuels · Jon Jansen · Randy Thomas" },
  { n: "New England Patriots", p: 'OL', t: 'NE', d: '2000s', s: { ry: 120, sa: 1.6, pb: 90, pbl: 3 }, imp: 86, key: "Matt Light · Logan Mankins · Dan Koppen" },
  { n: "Dallas Cowboys", p: 'OL', t: 'DAL', d: '2000s', s: { ry: 130, sa: 1.8, pb: 89, pbl: 3 }, imp: 85, key: "Flozell Adams · Andre Gurode · Leonard Davis" },
  { n: "Los Angeles Chargers", p: 'OL', t: 'LAC', d: '2000s', s: { ry: 135, sa: 1.8, pb: 88, pbl: 3 }, imp: 84, key: "Marcus McNeill · Nick Hardwick · Kris Dielman" },
  { n: "Tampa Bay Buccaneers", p: 'OL', t: 'TB', d: '2000s', s: { ry: 118, sa: 2, pb: 85, pbl: 2 }, imp: 79, key: "Kenyatta Walker · Jeff Christy · Cosey Coleman" },
  { n: "Atlanta Falcons", p: 'OL', t: 'ATL', d: '2000s', s: { ry: 145, sa: 1.9, pb: 86, pbl: 2 }, imp: 82, key: "Todd McClure · Kynan Forney · Wayne Gandy" },
  { n: "San Francisco 49ers", p: 'OL', t: 'SF', d: '2010s', s: { ry: 140, sa: 1.7, pb: 90, pbl: 4 }, imp: 87, key: "Joe Staley · Mike Iupati · Anthony Davis" },
  { n: "Baltimore Ravens", p: 'OL', t: 'BAL', d: '2010s', s: { ry: 135, sa: 1.7, pb: 90, pbl: 3 }, imp: 86, key: "Marshal Yanda · Kelechi Osemele · Ronnie Stanley" },
  { n: "Green Bay Packers", p: 'OL', t: 'GB', d: '2010s', s: { ry: 120, sa: 1.6, pb: 91, pbl: 3 }, imp: 85, key: "David Bakhtiari · Josh Sitton · T.J. Lang" },
  { n: "Washington Redskins", p: 'OL', t: 'WAS', d: '2010s', s: { ry: 135, sa: 1.8, pb: 89, pbl: 3 }, imp: 85, key: "Trent Williams · Brandon Scherff · Shawn Lauvao" },
  { n: "Houston Texans", p: 'OL', t: 'HOU', d: '2010s', s: { ry: 130, sa: 1.9, pb: 87, pbl: 2 }, imp: 82, key: "Duane Brown · Chris Myers · Wade Smith" },
  { n: "Indianapolis Colts", p: 'OL', t: 'IND', d: '2010s', s: { ry: 128, sa: 1.7, pb: 90, pbl: 3 }, imp: 85, key: "Quenton Nelson · Ryan Kelly · Anthony Castonzo" },
  { n: "Detroit Lions", p: 'OL', t: 'DET', d: '2010s', s: { ry: 115, sa: 1.9, pb: 87, pbl: 2 }, imp: 81, key: "Taylor Decker · Larry Warford · Riley Reiff" },
  { n: "Indianapolis Colts", p: 'OL', t: 'IND', d: '2020s', s: { ry: 140, sa: 1.5, pb: 92, pbl: 4 }, imp: 88, key: "Quenton Nelson · Ryan Kelly · Braden Smith" },
  { n: "Dallas Cowboys", p: 'OL', t: 'DAL', d: '2020s', s: { ry: 135, sa: 1.6, pb: 92, pbl: 4 }, imp: 88, key: "Zack Martin · Tyron Smith · Tyler Biadasz" },
  { n: "Atlanta Falcons", p: 'OL', t: 'ATL', d: '2020s', s: { ry: 140, sa: 1.5, pb: 91, pbl: 3 }, imp: 87, key: "Chris Lindstrom · Jake Matthews · Drew Dalman" },
  { n: "Los Angeles Chargers", p: 'OL', t: 'LAC', d: '2020s', s: { ry: 125, sa: 1.7, pb: 90, pbl: 3 }, imp: 84, key: "Rashawn Slater · Corey Linsley · Zion Johnson" },
  { n: "Green Bay Packers", p: 'OL', t: 'GB', d: '2020s', s: { ry: 128, sa: 1.6, pb: 90, pbl: 2 }, imp: 84, key: "Elgton Jenkins · Josh Myers · Rasheed Walker" },
  { n: "Buffalo Bills", p: 'OL', t: 'BUF', d: '2020s', s: { ry: 122, sa: 1.7, pb: 89, pbl: 2 }, imp: 83, key: "Dion Dawkins · Mitch Morse · Spencer Brown" },
  { n: "New Orleans Saints", p: 'OL', t: 'NO', d: '2020s', s: { ry: 120, sa: 1.8, pb: 88, pbl: 2 }, imp: 82, key: "Erik McCoy · Ryan Ramczyk · James Hurst" },
  { n: "Washington Commanders", p: 'OL', t: 'WAS', d: '2020s', s: { ry: 120, sa: 1.8, pb: 88, pbl: 2 }, imp: 82, key: "Brandon Scherff · Charles Leno · Sam Cosmi" },
  { n: "Atlanta Falcons", p: 'OL', t: 'ATL', d: '1970s', s: { ry: 120, sa: 2.4, pb: 76, pbl: 1 }, imp: 74, key: "Jeff Van Note · George Kunz · Warren Bryant" },
  { n: "Chicago Bears", p: 'OL', t: 'CHI', d: '1970s', s: { ry: 128, sa: 2.3, pb: 78, pbl: 1 }, imp: 77, key: "Noah Jackson · Dan Neal · Ted Albrecht" },
  { n: "Cleveland Browns", p: 'OL', t: 'CLE', d: '1970s', s: { ry: 122, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Doug Dieken · Tom DeLeone · Robert E. Jackson" },
  { n: "Denver Broncos", p: 'OL', t: 'DEN', d: '1970s', s: { ry: 118, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Tom Glassic · Paul Howard · Claudie Minor" },
  { n: "Detroit Lions", p: 'OL', t: 'DET', d: '1970s', s: { ry: 120, sa: 2.3, pb: 77, pbl: 1 }, imp: 75, key: "Lynn Boden · Jon Morris · Rocky Freitas" },
  { n: "Green Bay Packers", p: 'OL', t: 'GB', d: '1970s', s: { ry: 116, sa: 2.4, pb: 76, pbl: 1 }, imp: 74, key: "Gale Gillingham · Larry McCarren · Dick Himes" },
  { n: "Tennessee Titans", p: 'OL', t: 'TEN', d: '1970s', s: { ry: 132, sa: 2.0, pb: 80, pbl: 2 }, imp: 80, key: "Carl Mauck · Greg Sampson · Conway Hayman" },
  { n: "Kansas City Chiefs", p: 'OL', t: 'KC', d: '1970s', s: { ry: 120, sa: 2.2, pb: 78, pbl: 2 }, imp: 77, key: "Jim Tyrer · Ed Budde · Jack Rudnay" },
  { n: "New Orleans Saints", p: 'OL', t: 'NO', d: '1970s', s: { ry: 115, sa: 2.5, pb: 75, pbl: 1 }, imp: 73, key: "Jake Kupp · John Hill · Don Morrison" },
  { n: "New York Giants", p: 'OL', t: 'NYG', d: '1970s', s: { ry: 116, sa: 2.5, pb: 75, pbl: 1 }, imp: 73, key: "Doug Van Horn · Brad Benson · John Hicks" },
  { n: "New York Jets", p: 'OL', t: 'NYJ', d: '1970s', s: { ry: 118, sa: 2.3, pb: 77, pbl: 1 }, imp: 75, key: "Randy Rasmussen · Garry Puetz · Joe Fields" },
  { n: "Philadelphia Eagles", p: 'OL', t: 'PHI', d: '1970s', s: { ry: 118, sa: 2.3, pb: 77, pbl: 1 }, imp: 76, key: "Stan Walters · Wade Key · Guy Morriss" },
  { n: "Los Angeles Chargers", p: 'OL', t: 'LAC', d: '1970s', s: { ry: 120, sa: 2.2, pb: 80, pbl: 2 }, imp: 79, key: "Russ Washington · Doug Wilkerson · Ed White" },
  { n: "Seattle Seahawks", p: 'OL', t: 'SEA', d: '1970s', s: { ry: 112, sa: 2.6, pb: 74, pbl: 1 }, imp: 72, key: "Nick Bebout · Bob Newton · Art Kuehn" },
  { n: "San Francisco 49ers", p: 'OL', t: 'SF', d: '1970s', s: { ry: 118, sa: 2.3, pb: 78, pbl: 2 }, imp: 77, key: "Forrest Blue · Randy Cross · Cas Banaszek" },
  { n: "Arizona Cardinals", p: 'OL', t: 'ARI', d: '1970s', s: { ry: 138, sa: 1.8, pb: 86, pbl: 4 }, imp: 86, key: "Dan Dierdorf · Conrad Dobler · Tom Banks" },
  { n: "Tampa Bay Buccaneers", p: 'OL', t: 'TB', d: '1970s', s: { ry: 110, sa: 2.7, pb: 72, pbl: 0 }, imp: 70, key: "Steve Wilson · Greg Roberts · Charley Hannah" },
  { n: "Detroit Lions", p: 'OL', t: 'DET', d: '1980s', s: { ry: 120, sa: 2.3, pb: 78, pbl: 1 }, imp: 76, key: "Keith Dorney · Kevin Glover · Lomas Brown" },
  { n: "Green Bay Packers", p: 'OL', t: 'GB', d: '1980s', s: { ry: 118, sa: 2.4, pb: 77, pbl: 1 }, imp: 76, key: "Karl Swanke · Larry McCarren · Ron Hallstrom" },
  { n: "Indianapolis Colts", p: 'OL', t: 'IND', d: '1980s', s: { ry: 122, sa: 2.1, pb: 80, pbl: 2 }, imp: 79, key: "Chris Hinton · Ray Donaldson · Ron Solt" },
  { n: "Kansas City Chiefs", p: 'OL', t: 'KC', d: '1980s', s: { ry: 120, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Brian Jozwiak · Dave Lutz · Bill Maas" },
  { n: "Minnesota Vikings", p: 'OL', t: 'MIN', d: '1980s', s: { ry: 122, sa: 2.1, pb: 80, pbl: 2 }, imp: 79, key: "Gary Zimmerman · Tim Irwin · Kirk Lowdermilk" },
  { n: "New Orleans Saints", p: 'OL', t: 'NO', d: '1980s', s: { ry: 124, sa: 2.0, pb: 81, pbl: 3 }, imp: 81, key: "Jim Dombrowski · Brad Edelman · Stan Brock" },
  { n: "Philadelphia Eagles", p: 'OL', t: 'PHI', d: '1980s', s: { ry: 118, sa: 2.4, pb: 77, pbl: 1 }, imp: 76, key: "Ron Heller · Ron Baker · Stan Walters" },
  { n: "Arizona Cardinals", p: 'OL', t: 'ARI', d: '1980s', s: { ry: 120, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Luis Sharpe · Joe Bostic · Lance Smith" },
  { n: "Pittsburgh Steelers", p: 'OL', t: 'PIT', d: '1980s', s: { ry: 124, sa: 2.1, pb: 80, pbl: 2 }, imp: 80, key: "Tunch Ilkin · Mike Webster · Craig Wolfley" },
  { n: "Los Angeles Chargers", p: 'OL', t: 'LAC', d: '1980s', s: { ry: 126, sa: 2.0, pb: 82, pbl: 3 }, imp: 82, key: "Ed White · Don Macek · Billy Shields" },
  { n: "Arizona Cardinals", p: 'OL', t: 'ARI', d: '1990s', s: { ry: 118, sa: 2.3, pb: 78, pbl: 2 }, imp: 77, key: "Lomas Brown · Aaron Graham · Lester Holmes" },
  { n: "Atlanta Falcons", p: 'OL', t: 'ATL', d: '1990s', s: { ry: 120, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Bob Whitfield · Chris Hinton · Roman Fortin" },
  { n: "Baltimore Ravens", p: 'OL', t: 'BAL', d: '1990s', s: { ry: 128, sa: 1.9, pb: 82, pbl: 3 }, imp: 82, key: "Jonathan Ogden · Wally Williams · Orlando Brown" },
  { n: "Chicago Bears", p: 'OL', t: 'CHI', d: '1990s', s: { ry: 118, sa: 2.3, pb: 78, pbl: 1 }, imp: 76, key: "Jay Hilgenberg · Jerry Fontenot · James Williams" },
  { n: "Cincinnati Bengals", p: 'OL', t: 'CIN', d: '1990s', s: { ry: 122, sa: 2.1, pb: 80, pbl: 3 }, imp: 80, key: "Anthony Munoz · Bruce Reimers · Joe Walter" },
  { n: "Cleveland Browns", p: 'OL', t: 'CLE', d: '1990s', s: { ry: 120, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Tony Jones · Steve Everitt · Wally Williams" },
  { n: "Tennessee Titans", p: 'OL', t: 'TEN', d: '1990s', s: { ry: 124, sa: 2.0, pb: 81, pbl: 3 }, imp: 81, key: "Bruce Matthews · Mike Munchak · Don Maggs" },
  { n: "New Orleans Saints", p: 'OL', t: 'NO', d: '1990s', s: { ry: 120, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Willie Roaf · Jim Dombrowski · Joel Hilgenberg" },
  { n: "New York Jets", p: 'OL', t: 'NYJ', d: '1990s', s: { ry: 122, sa: 2.1, pb: 80, pbl: 2 }, imp: 79, key: "Jumbo Elliott · Kevin Mawae · Roger Duffy" },
  { n: "Las Vegas Raiders", p: 'OL', t: 'LV', d: '1990s', s: { ry: 124, sa: 2.0, pb: 81, pbl: 3 }, imp: 81, key: "Steve Wisniewski · Don Mosebar · Steve Wright" },
  { n: "Philadelphia Eagles", p: 'OL', t: 'PHI', d: '1990s', s: { ry: 120, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Antone Davis · Tra Thomas · Steve Everitt" },
  { n: "Los Angeles Chargers", p: 'OL', t: 'LAC', d: '1990s', s: { ry: 122, sa: 2.1, pb: 80, pbl: 2 }, imp: 79, key: "Harry Swayne · Courtney Hall · Stan Brock" },
  { n: "Seattle Seahawks", p: 'OL', t: 'SEA', d: '1990s', s: { ry: 120, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Walter Jones · Howard Ballard · Kevin Glover" },
  { n: "Los Angeles Rams", p: 'OL', t: 'LAR', d: '1990s', s: { ry: 126, sa: 1.9, pb: 82, pbl: 3 }, imp: 82, key: "Orlando Pace · Tom Nutten · Adam Timmerman" },
  { n: "Tampa Bay Buccaneers", p: 'OL', t: 'TB', d: '1990s', s: { ry: 120, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Paul Gruber · Tony Mayberry · Jim Pyne" },
  { n: "Tennessee Oilers/Titans", p: 'OL', t: 'TEN', d: '1990s', s: { ry: 124, sa: 2.0, pb: 81, pbl: 3 }, imp: 81, key: "Bruce Matthews · Brad Hopkins · Benji Olson" },
  { n: "Arizona Cardinals", p: 'OL', t: 'ARI', d: '2000s', s: { ry: 114, sa: 2.4, pb: 76, pbl: 1 }, imp: 75, key: "Leonard Davis · Reggie Wells · Mike Gandy" },
  { n: "Buffalo Bills", p: 'OL', t: 'BUF', d: '2000s', s: { ry: 116, sa: 2.3, pb: 77, pbl: 1 }, imp: 76, key: "Jason Peters · Eric Wood · Brad Butler" },
  { n: "Chicago Bears", p: 'OL', t: 'CHI', d: '2000s', s: { ry: 118, sa: 2.2, pb: 78, pbl: 2 }, imp: 77, key: "Olin Kreutz · Ruben Brown · John Tait" },
  { n: "Cincinnati Bengals", p: 'OL', t: 'CIN', d: '2000s', s: { ry: 118, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Willie Anderson · Levi Jones · Rich Braham" },
  { n: "Cleveland Browns", p: 'OL', t: 'CLE', d: '2000s', s: { ry: 116, sa: 2.3, pb: 77, pbl: 2 }, imp: 77, key: "Joe Thomas · Eric Steinbach · Hank Fraley" },
  { n: "Detroit Lions", p: 'OL', t: 'DET', d: '2000s', s: { ry: 114, sa: 2.4, pb: 76, pbl: 1 }, imp: 75, key: "Jeff Backus · Dominic Raiola · Damien Woody" },
  { n: "Green Bay Packers", p: 'OL', t: 'GB', d: '2000s', s: { ry: 120, sa: 2.1, pb: 80, pbl: 2 }, imp: 79, key: "Chad Clifton · Mark Tauscher · Mike Wahle" },
  { n: "Houston Texans", p: 'OL', t: 'HOU', d: '2000s', s: { ry: 114, sa: 2.4, pb: 76, pbl: 1 }, imp: 75, key: "Chester Pitts · Eric Winston · Mike Flanagan" },
  { n: "Jacksonville Jaguars", p: 'OL', t: 'JAX', d: '2000s', s: { ry: 122, sa: 2.0, pb: 80, pbl: 2 }, imp: 79, key: "Tony Boselli · Brad Meester · Vince Manuwai" },
  { n: "Miami Dolphins", p: 'OL', t: 'MIA', d: '2000s', s: { ry: 116, sa: 2.3, pb: 77, pbl: 2 }, imp: 77, key: "Richmond Webb · Tim Ruddy · Vernon Carey" },
  { n: "Minnesota Vikings", p: 'OL', t: 'MIN', d: '2000s', s: { ry: 124, sa: 1.9, pb: 82, pbl: 3 }, imp: 82, key: "Steve Hutchinson · Bryant McKinnie · Matt Birk" },
  { n: "New York Jets", p: 'OL', t: 'NYJ', d: '2000s', s: { ry: 122, sa: 2.0, pb: 81, pbl: 3 }, imp: 81, key: "D'Brickashaw Ferguson · Nick Mangold · Alan Faneca" },
  { n: "Las Vegas Raiders", p: 'OL', t: 'LV', d: '2000s', s: { ry: 118, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Barret Robbins · Mo Collins · Lincoln Kennedy" },
  { n: "San Francisco 49ers", p: 'OL', t: 'SF', d: '2000s', s: { ry: 116, sa: 2.3, pb: 77, pbl: 2 }, imp: 77, key: "Joe Staley · Larry Allen · Eric Heitmann" },
  { n: "Los Angeles Rams", p: 'OL', t: 'LAR', d: '2000s', s: { ry: 118, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Orlando Pace · Adam Timmerman · Andy McCollum" },
  { n: "Tennessee Titans", p: 'OL', t: 'TEN', d: '2000s', s: { ry: 124, sa: 1.9, pb: 82, pbl: 3 }, imp: 82, key: "Bruce Matthews · Brad Hopkins · Benji Olson" },
  { n: "Buffalo Bills", p: 'OL', t: 'BUF', d: '2010s', s: { ry: 122, sa: 2.0, pb: 80, pbl: 2 }, imp: 79, key: "Cordy Glenn · Eric Wood · Richie Incognito" },
  { n: "Chicago Bears", p: 'OL', t: 'CHI', d: '2010s', s: { ry: 116, sa: 2.3, pb: 78, pbl: 2 }, imp: 77, key: "Kyle Long · Charles Leno · Roberto Garza" },
  { n: "Denver Broncos", p: 'OL', t: 'DEN', d: '2010s', s: { ry: 116, sa: 2.3, pb: 78, pbl: 2 }, imp: 77, key: "Ryan Clady · Matt Paradis · Louis Vasquez" },
  { n: "Jacksonville Jaguars", p: 'OL', t: 'JAX', d: '2010s', s: { ry: 114, sa: 2.4, pb: 76, pbl: 1 }, imp: 75, key: "Brandon Linder · Cam Robinson · Luke Joeckel" },
  { n: "Kansas City Chiefs", p: 'OL', t: 'KC', d: '2010s', s: { ry: 118, sa: 2.2, pb: 80, pbl: 2 }, imp: 79, key: "Mitchell Schwartz · Eric Fisher · Mitch Morse" },
  { n: "Los Angeles Chargers", p: 'OL', t: 'LAC', d: '2010s', s: { ry: 116, sa: 2.3, pb: 78, pbl: 2 }, imp: 77, key: "Russell Okung · Mike Pouncey · Forrest Lamp" },
  { n: "Los Angeles Rams", p: 'OL', t: 'LAR', d: '2010s', s: { ry: 120, sa: 2.1, pb: 80, pbl: 2 }, imp: 79, key: "Andrew Whitworth · Rodger Saffold · John Sullivan" },
  { n: "Miami Dolphins", p: 'OL', t: 'MIA', d: '2010s', s: { ry: 114, sa: 2.4, pb: 77, pbl: 1 }, imp: 76, key: "Mike Pouncey · Branden Albert · Laremy Tunsil" },
  { n: "Minnesota Vikings", p: 'OL', t: 'MIN', d: '2010s', s: { ry: 118, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Matt Kalil · John Sullivan · Joe Berger" },
  { n: "New York Giants", p: 'OL', t: 'NYG', d: '2010s', s: { ry: 114, sa: 2.4, pb: 77, pbl: 1 }, imp: 76, key: "Justin Pugh · Weston Richburg · Will Beatty" },
  { n: "Seattle Seahawks", p: 'OL', t: 'SEA', d: '2010s', s: { ry: 118, sa: 2.2, pb: 78, pbl: 1 }, imp: 77, key: "Russell Okung · Max Unger · Justin Britt" },
  { n: "Tampa Bay Buccaneers", p: 'OL', t: 'TB', d: '2010s', s: { ry: 116, sa: 2.3, pb: 78, pbl: 2 }, imp: 77, key: "Donovan Smith · Ali Marpet · Demar Dotson" },
  { n: "Arizona Cardinals", p: 'OL', t: 'ARI', d: '2020s', s: { ry: 116, sa: 2.2, pb: 78, pbl: 1 }, imp: 77, key: "D.J. Humphries · Will Hernandez · Rodney Hudson" },
  { n: "Carolina Panthers", p: 'OL', t: 'CAR', d: '2020s', s: { ry: 114, sa: 2.3, pb: 77, pbl: 1 }, imp: 76, key: "Taylor Moton · Bradley Bozeman · Ikem Ekwonu" },
  { n: "Chicago Bears", p: 'OL', t: 'CHI', d: '2020s', s: { ry: 116, sa: 2.2, pb: 78, pbl: 1 }, imp: 77, key: "Braxton Jones · Cody Whitehair · Teven Jenkins" },
  { n: "Cincinnati Bengals", p: 'OL', t: 'CIN', d: '2020s', s: { ry: 114, sa: 2.3, pb: 78, pbl: 1 }, imp: 77, key: "Orlando Brown Jr. · Ted Karras · Alex Cappa" },
  { n: "Denver Broncos", p: 'OL', t: 'DEN', d: '2020s', s: { ry: 116, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Garett Bolton · Quinn Meinerz · Lloyd Cushenberry" },
  { n: "Houston Texans", p: 'OL', t: 'HOU', d: '2020s', s: { ry: 114, sa: 2.3, pb: 77, pbl: 1 }, imp: 76, key: "Laremy Tunsil · Tytus Howard · Shaq Mason" },
  { n: "Jacksonville Jaguars", p: 'OL', t: 'JAX', d: '2020s', s: { ry: 114, sa: 2.3, pb: 77, pbl: 1 }, imp: 76, key: "Cam Robinson · Brandon Scherff · Walker Little" },
  { n: "Los Angeles Rams", p: 'OL', t: 'LAR', d: '2020s', s: { ry: 116, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Andrew Whitworth · Rob Havenstein · Austin Corbett" },
  { n: "Las Vegas Raiders", p: 'OL', t: 'LV', d: '2020s', s: { ry: 116, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Kolton Miller · Andre James · Dylan Parham" },
  { n: "Minnesota Vikings", p: 'OL', t: 'MIN', d: '2020s', s: { ry: 118, sa: 2.1, pb: 80, pbl: 2 }, imp: 79, key: "Christian Darrisaw · Brian O'Neill · Garrett Bradbury" },
  { n: "New England Patriots", p: 'OL', t: 'NE', d: '2020s', s: { ry: 114, sa: 2.3, pb: 77, pbl: 1 }, imp: 76, key: "David Andrews · Mike Onwenu · Trent Brown" },
  { n: "New York Giants", p: 'OL', t: 'NYG', d: '2020s', s: { ry: 112, sa: 2.4, pb: 76, pbl: 1 }, imp: 75, key: "Andrew Thomas · Ben Bredeson · John Michael Schmitz" },
  { n: "New York Jets", p: 'OL', t: 'NYJ', d: '2020s', s: { ry: 114, sa: 2.3, pb: 77, pbl: 1 }, imp: 76, key: "Mekhi Becton · Connor McGovern · Alijah Vera-Tucker" },
  { n: "Pittsburgh Steelers", p: 'OL', t: 'PIT', d: '2020s', s: { ry: 116, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "David DeCastro · Maurkice Pouncey · Alejandro Villanueva" },
  { n: "Seattle Seahawks", p: 'OL', t: 'SEA', d: '2020s', s: { ry: 116, sa: 2.2, pb: 78, pbl: 1 }, imp: 77, key: "Charles Cross · Damien Lewis · Abraham Lucas" },
  { n: "Tennessee Titans", p: 'OL', t: 'TEN', d: '2020s', s: { ry: 116, sa: 2.2, pb: 79, pbl: 2 }, imp: 78, key: "Taylor Lewan · Ben Jones · Rodger Saffold" },
];

// ============================================================
// YEAR-BY-YEAR DEFENSE DATABASE (1970-2024)
// Format: YEAR_DEFENSES[year] = [[team, PA/G, PF/G], ...]
// PA = points allowed per game (defense rating)
// PF = points scored per game (used for opponent's score in the matchup)
// Team abbreviations reflect the franchise's location in that year.
// ============================================================
const YEAR_DEFENSES = {
  1970: [['BAL',16.4,21.7],['BOS',23.4,10.0],['BUF',20.4,14.4],['CIN',19.6,22.4],['CLE',17.5,22.6],['DAL',14.7,21.6],['DEN',18.1,18.5],['DET',14.4,24.7],['GB',14.3,14.4],['HOU',24.4,15.6],['KC',16.0,19.9],['LAR',13.6,22.6],['MIA',16.1,21.9],['MIN',9.9,24.9],['NO',23.9,12.7],['NYG',19.4,21.0],['NYJ',21.4,18.9],['OAK',18.9,21.7],['PHI',21.5,17.9],['PIT',23.5,15.6],['SD',19.7,20.6],['SF',17.8,24.0],['STL',14.9,22.4],['WAS',21.6,21.3],['ATL',19.5,15.4],['CHI',24.2,17.3]],
  1971: [['BAL',10.6,28.7],['BUF',26.7,13.4],['CIN',17.8,20.2],['CLE',22.1,21.9],['DAL',15.2,29.8],['DEN',20.3,14.3],['DET',16.1,24.0],['GB',20.1,19.3],['HOU',26.3,18.0],['KC',15.6,21.3],['LAR',14.5,22.5],['MIA',12.8,22.0],['MIN',10.6,17.6],['NE',22.6,16.4],['NO',24.6,18.3],['NYG',23.4,16.1],['NYJ',24.4,15.5],['OAK',18.0,24.9],['PHI',23.8,16.1],['PIT',23.8,17.4],['SD',23.1,22.7],['SF',16.9,21.5],['STL',16.9,16.1],['WAS',13.6,19.6],['ATL',16.6,19.9],['CHI',20.3,13.6]],
  1972: [['BAL',16.6,16.4],['BUF',25.6,18.6],['CIN',19.1,21.7],['CLE',20.4,19.7],['DAL',16.4,22.3],['DEN',18.7,21.9],['DET',16.4,24.4],['GB',16.6,21.4],['HOU',32.0,11.5],['KC',23.9,20.4],['LAR',21.5,22.6],['MIA',12.2,27.5],['MIN',17.4,21.5],['NE',31.9,13.3],['NO',23.4,15.5],['NYG',22.5,23.4],['NYJ',24.2,26.4],['OAK',16.2,25.1],['PHI',23.0,12.7],['PIT',12.7,24.4],['SD',23.6,18.1],['SF',16.4,25.6],['STL',24.1,14.7],['WAS',16.7,23.3],['ATL',22.1,20.5],['CHI',23.7,15.1]],
  1973: [['BAL',20.2,16.1],['BUF',16.6,18.9],['CIN',13.5,20.1],['CLE',17.0,16.6],['DAL',16.2,27.3],['DEN',13.6,25.2],['DET',23.6,19.5],['GB',15.0,14.4],['HOU',32.0,14.7],['KC',16.4,16.3],['LAR',12.6,27.9],['MIA',10.7,24.5],['MIN',13.0,21.0],['NE',23.8,18.5],['NO',24.6,11.3],['NYG',23.0,16.5],['NYJ',26.5,17.3],['OAK',13.6,21.9],['PHI',26.8,22.5],['PIT',12.9,24.6],['SD',25.7,13.7],['SF',18.6,18.1],['STL',16.6,20.4],['WAS',15.2,23.5],['ATL',13.3,22.4],['CHI',22.5,14.7]],
  1974: [['BAL',23.2,13.3],['BUF',19.0,18.6],['CIN',15.4,20.0],['CLE',23.7,17.1],['DAL',17.2,21.4],['DEN',16.1,22.6],['DET',16.2,18.4],['GB',12.4,15.4],['HOU',20.0,17.1],['KC',19.0,16.6],['LAR',13.4,18.4],['MIA',16.6,23.1],['MIN',13.7,22.3],['NE',21.1,24.2],['NO',23.9,12.0],['NYG',18.4,13.4],['NYJ',21.5,20.2],['OAK',15.9,25.5],['PHI',21.0,17.6],['PIT',13.5,22.4],['SD',24.2,15.0],['SF',16.4,16.7],['STL',16.9,20.6],['WAS',15.4,23.4],['ATL',16.6,8.4],['CHI',23.8,11.1]],
  1975: [['BAL',16.1,28.6],['BUF',20.5,30.1],['CIN',16.4,24.6],['CLE',26.0,15.1],['DAL',19.6,25.0],['DEN',19.4,18.6],['DET',16.3,17.3],['GB',23.8,16.0],['HOU',16.4,21.4],['KC',23.7,20.9],['LAR',9.6,22.7],['MIA',16.4,25.9],['MIN',13.6,26.7],['NE',24.6,17.5],['NO',23.4,11.6],['NYG',24.0,15.9],['NYJ',31.0,18.0],['OAK',16.1,26.5],['PHI',21.3,16.1],['PIT',11.6,26.1],['SD',23.9,13.0],['SF',16.6,18.5],['STL',13.1,22.7],['WAS',16.4,23.1],['ATL',20.0,17.1],['CHI',28.7,13.4]],
  1976: [['BAL',16.1,29.1],['BUF',28.4,17.4],['CIN',16.6,24.6],['CLE',19.5,19.4],['DAL',13.4,21.1],['DEN',14.6,22.2],['DET',19.4,18.9],['GB',16.1,15.0],['HOU',16.4,16.1],['KC',26.1,19.6],['LAR',13.3,24.5],['MIA',18.1,18.6],['MIN',13.0,21.4],['NE',16.2,26.2],['NO',24.4,17.9],['NYG',24.4,12.0],['NYJ',26.4,12.4],['OAK',17.2,25.6],['PHI',23.4,12.3],['PIT',9.9,24.4],['SD',23.4,17.7],['SF',16.4,19.7],['STL',13.0,22.4],['WAS',16.6,21.6],['ATL',15.6,12.6],['CHI',16.7,17.2],['SEA',31.1,16.0],['TB',29.4,9.0]],
  1977: [['BAL',13.4,21.1],['BUF',22.2,11.4],['CIN',16.0,17.3],['CLE',19.5,19.9],['DAL',15.5,25.1],['DEN',10.5,19.5],['DET',23.3,13.5],['GB',21.3,9.6],['HOU',17.6,21.4],['KC',24.7,16.0],['LAR',9.5,21.9],['MIA',14.2,22.1],['MIN',14.7,16.8],['NE',16.6,20.4],['NO',23.4,16.4],['NYG',16.4,13.6],['NYJ',27.7,12.0],['OAK',17.2,25.4],['PHI',16.6,15.4],['PIT',16.0,20.4],['SD',16.4,15.5],['SF',16.1,15.5],['STL',16.6,18.7],['WAS',13.6,14.7],['ATL',9.2,12.7],['CHI',15.9,18.6],['SEA',26.4,19.7],['TB',16.6,7.4]],
  1978: [['BAL',24.4,15.4],['BUF',22.6,18.9],['CIN',24.6,15.2],['CLE',21.4,21.3],['DAL',13.7,23.7],['DEN',12.1,17.6],['DET',23.6,18.0],['GB',16.7,15.8],['HOU',16.0,17.6],['KC',16.4,15.5],['LAR',15.1,19.0],['MIA',12.2,23.2],['MIN',17.6,18.6],['NE',16.6,22.3],['NO',18.6,17.8],['NYG',17.7,15.9],['NYJ',23.4,22.4],['OAK',16.6,19.4],['PHI',17.4,17.4],['PIT',12.2,22.4],['SD',16.4,22.4],['SF',23.6,14.7],['STL',23.4,15.2],['WAS',15.7,17.4],['ATL',16.4,14.6],['CHI',22.4,16.6],['SEA',16.4,21.3],['TB',23.6,15.7]],
  1979: [['BAL',23.4,16.6],['BUF',16.4,16.6],['CIN',24.6,21.6],['CLE',23.0,22.7],['DAL',19.4,23.6],['DEN',14.5,18.3],['DET',23.6,13.4],['GB',16.6,15.2],['HOU',16.4,22.1],['KC',16.4,15.0],['LAR',16.4,21.4],['MIA',13.6,21.4],['MIN',24.4,16.7],['NE',13.6,25.1],['NO',24.6,23.4],['NYG',16.6,15.6],['NYJ',16.0,21.4],['OAK',23.4,22.4],['PHI',17.0,21.6],['PIT',16.4,26.0],['SD',23.4,25.5],['SF',26.0,19.6],['STL',23.6,18.4],['WAS',16.6,21.6],['ATL',23.6,18.6],['CHI',16.6,19.0],['SEA',23.6,23.4],['TB',13.4,17.6]],
  1980: [['BAL',24.4,21.7],['BUF',16.6,20.6],['CIN',24.6,15.6],['CLE',23.1,22.6],['DAL',18.6,27.6],['DEN',23.6,19.4],['DET',16.4,21.6],['GB',16.4,14.4],['HOU',16.6,18.6],['KC',23.6,20.6],['LAR',23.6,26.4],['MIA',16.6,16.6],['MIN',23.6,19.6],['NE',23.7,27.6],['NO',26.6,18.6],['NYG',23.6,15.7],['NYJ',24.6,19.6],['OAK',19.0,22.5],['PHI',13.0,24.4],['PIT',16.4,21.4],['SD',24.6,26.4],['SF',23.4,20.6],['STL',23.6,18.7],['WAS',16.6,16.6],['ATL',16.6,25.6],['CHI',23.6,18.3],['SEA',23.6,18.6],['TB',16.4,17.6]],
  1981: [['BAL',33.1,16.4],['BUF',16.4,19.4],['CIN',19.6,26.4],['CLE',23.6,17.6],['DAL',16.4,23.6],['DEN',24.0,20.0],['DET',24.4,24.4],['GB',24.6,18.4],['HOU',24.6,17.4],['KC',23.4,21.6],['LAR',24.6,18.4],['MIA',16.4,21.1],['MIN',24.6,20.4],['NE',24.6,20.0],['NO',24.4,13.6],['NYG',16.4,18.6],['NYJ',16.6,22.6],['OAK',24.4,16.6],['PHI',17.6,23.6],['PIT',21.6,22.4],['SD',24.6,28.4],['SF',16.4,22.3],['STL',24.6,19.4],['WAS',24.4,21.6],['ATL',16.6,26.6],['CHI',23.6,16.6],['SEA',26.6,20.6],['TB',16.4,20.4]],
  1982: [['BAL',23.0,11.6],['BUF',16.4,16.4],['CIN',16.4,28.4],['CLE',16.6,17.6],['DAL',13.7,25.2],['DEN',24.6,16.4],['DET',23.6,18.4],['GB',23.6,24.6],['HOU',24.6,17.4],['KC',19.4,19.6],['LAR',24.6,21.4],['MIA',16.0,21.6],['MIN',24.0,21.6],['NE',13.4,16.4],['NO',23.4,15.6],['NYG',22.6,18.6],['NYJ',16.6,28.6],['OAK',16.4,29.6],['PHI',18.0,21.4],['PIT',16.4,21.1],['SD',23.6,29.4],['SF',23.6,20.6],['STL',17.6,18.7],['WAS',16.4,24.4],['ATL',22.4,19.4],['CHI',24.6,19.4],['SEA',23.6,21.6],['TB',13.0,20.6]],
  1983: [['BAL',24.6,16.4],['BUF',21.4,18.7],['CIN',21.4,21.7],['CLE',16.4,22.4],['DAL',20.4,29.7],['DEN',17.4,18.6],['DET',23.6,21.4],['GB',24.6,26.6],['HOU',26.4,18.4],['KC',24.6,23.4],['LAR',23.6,22.4],['MIA',13.6,24.4],['MIN',23.6,19.7],['NE',23.6,16.0],['NO',23.6,19.4],['NYG',22.6,16.4],['NYJ',24.4,19.4],['OAK',20.6,27.5],['PHI',18.6,14.4],['PIT',23.6,22.4],['SD',23.6,22.0],['SF',16.4,26.7],['STL',23.6,23.4],['WAS',19.7,33.8],['ATL',23.4,23.6],['CHI',19.6,19.7],['SEA',20.6,25.6],['TB',23.6,15.4]],
  1984: [['BUF',26.4,15.4],['CIN',24.6,21.1],['CLE',18.6,16.4],['DAL',19.6,19.4],['DEN',15.6,22.7],['DET',23.4,17.6],['GB',26.4,24.4],['HOU',24.4,15.4],['IND',24.4,15.4],['KC',23.4,19.6],['LAR',18.0,21.5],['MIA',18.6,32.7],['MIN',26.4,17.7],['NE',16.4,22.6],['NO',23.4,18.0],['NYG',18.6,19.7],['NYJ',18.4,21.6],['OAK',16.4,23.4],['PHI',16.6,17.4],['PIT',17.4,24.3],['SD',24.4,24.6],['SF',14.3,29.8],['STL',23.6,26.6],['WAS',19.6,26.6],['ATL',23.6,18.0],['CHI',16.7,20.5],['SEA',16.4,26.6],['TB',23.4,21.4]],
  1985: [['BUF',23.6,12.4],['CIN',23.6,27.4],['CLE',19.4,18.0],['DAL',21.6,22.1],['DEN',20.6,23.4],['DET',23.6,19.4],['GB',21.6,21.7],['HOU',23.6,17.4],['IND',23.4,20.4],['KC',20.4,19.4],['LAR',13.6,21.4],['MIA',18.6,26.5],['MIN',20.7,21.4],['NE',19.4,22.4],['NO',24.0,18.6],['NYG',17.5,24.4],['NYJ',17.6,24.0],['OAK',19.6,21.6],['PHI',20.6,17.4],['PIT',19.6,23.6],['SD',26.0,29.6],['SF',16.4,25.4],['STL',24.4,17.6],['WAS',19.6,18.6],['ATL',28.6,17.4],['CHI',12.4,28.5],['SEA',20.4,21.6],['TB',27.6,18.4]],
  1986: [['BUF',24.6,18.6],['CIN',23.4,25.4],['CLE',18.6,24.0],['DAL',21.6,17.4],['DEN',20.5,23.7],['DET',23.6,17.4],['GB',23.6,15.0],['HOU',22.6,17.4],['IND',23.6,14.4],['KC',20.6,22.4],['LAR',16.4,19.6],['MIA',24.6,26.4],['MIN',19.7,24.6],['NE',19.6,25.6],['NO',23.0,18.6],['NYG',14.8,23.3],['NYJ',24.6,23.0],['OAK',20.4,21.6],['PHI',21.6,15.6],['PIT',21.6,19.4],['SD',22.4,21.6],['SF',16.4,23.7],['STL',23.6,13.4],['WAS',18.4,23.4],['ATL',17.4,17.4],['CHI',11.7,22.7],['SEA',18.6,23.4],['TB',29.6,15.0]],
  1987: [['BUF',19.6,17.4],['CIN',24.6,18.6],['CLE',18.4,25.2],['DAL',21.6,21.6],['DEN',20.5,23.5],['DET',23.6,18.6],['GB',16.4,16.6],['HOU',18.4,22.0],['IND',23.4,20.6],['KC',24.4,18.6],['LAR',24.6,21.6],['MIA',24.4,23.4],['MIN',16.4,21.6],['NE',16.6,21.7],['NO',16.0,26.6],['NYG',21.4,18.4],['NYJ',23.6,21.6],['OAK',19.4,19.4],['PHI',23.6,22.6],['PIT',24.6,19.6],['SD',16.4,16.7],['SF',16.4,30.7],['STL',24.4,23.6],['WAS',17.5,24.0],['ATL',24.0,13.6],['CHI',16.4,24.6],['SEA',20.4,25.3],['TB',23.6,18.4]],
  1988: [['BUF',15.4,21.4],['CIN',18.6,28.2],['CLE',16.7,19.8],['DAL',23.5,16.5],['DEN',23.4,20.7],['DET',16.7,14.6],['GB',23.6,15.4],['HOU',21.4,26.5],['IND',23.6,22.6],['KC',16.4,16.4],['LAR',18.6,25.5],['MIA',23.4,20.7],['MIN',15.5,25.6],['NE',16.7,15.6],['NO',16.0,25.6],['NYG',16.4,22.6],['NYJ',23.6,23.4],['OAK',19.5,21.5],['PHI',16.4,23.6],['PIT',26.0,21.0],['SD',23.4,14.4],['SF',18.6,22.0],['PHX',23.4,21.0],['WAS',23.6,21.7],['ATL',24.4,15.6],['CHI',13.5,19.4],['SEA',18.4,21.0],['TB',24.0,16.0]],
  1989: [['BUF',19.5,25.5],['CIN',21.5,25.7],['CLE',15.6,20.4],['DAL',24.6,12.4],['DEN',14.1,22.9],['DET',23.6,19.4],['GB',23.6,22.8],['HOU',21.6,22.3],['IND',23.6,18.4],['KC',16.5,19.0],['LAR',19.6,26.3],['MIA',24.5,21.5],['MIN',16.6,21.7],['NE',24.4,18.6],['NO',16.4,24.7],['NYG',16.5,21.5],['NYJ',24.5,15.6],['OAK',19.6,19.5],['PHI',18.4,21.6],['PIT',19.6,16.0],['SD',16.6,16.7],['SF',16.4,27.8],['PHX',23.6,16.0],['WAS',24.0,24.5],['ATL',23.4,17.6],['CHI',22.4,22.7],['SEA',19.5,15.6],['TB',24.5,19.0]],
  1990: [['BUF',16.5,26.8],['CIN',19.6,22.5],['CLE',28.4,14.3],['DAL',23.4,15.6],['DEN',23.6,20.5],['DET',23.4,23.0],['GB',16.4,17.1],['HOU',20.7,25.0],['IND',23.0,17.7],['KC',16.6,23.3],['LAR',26.4,21.4],['MIA',16.6,21.4],['MIN',16.4,22.4],['NE',24.4,11.7],['NO',16.4,17.4],['NYG',13.2,20.6],['NYJ',24.5,18.4],['OAK',16.6,21.7],['PHI',15.6,24.1],['PIT',16.6,18.0],['SD',16.4,20.0],['SF',15.7,22.7],['PHX',26.6,16.4],['WAS',19.6,23.7],['ATL',23.6,21.6],['CHI',16.6,21.5],['SEA',20.6,19.0],['TB',26.4,16.8]],
  1991: [['BUF',18.4,28.6],['CIN',26.4,16.0],['CLE',19.6,18.4],['DAL',18.6,21.6],['DEN',16.6,18.7],['DET',18.6,21.4],['GB',16.6,17.6],['HOU',16.4,24.6],['IND',23.6,9.6],['KC',16.0,20.4],['LAR',24.6,14.6],['MIA',16.0,21.0],['MIN',20.5,18.4],['NE',24.4,13.0],['NO',13.2,21.4],['NYG',13.6,18.6],['NYJ',19.4,19.6],['OAK',18.6,18.6],['PHI',13.1,17.2],['PIT',18.6,18.6],['SD',20.4,17.0],['SF',16.4,24.7],['PHX',18.6,12.4],['WAS',14.0,30.3],['ATL',23.4,22.4],['CHI',18.6,18.5],['SEA',16.7,17.4],['TB',23.5,12.7]],
  1992: [['BUF',18.6,23.5],['CIN',24.6,17.6],['CLE',19.6,17.4],['DAL',15.2,25.6],['DEN',19.6,16.4],['DET',16.6,17.4],['GB',17.6,17.6],['HOU',16.0,22.0],['IND',16.4,14.6],['KC',13.0,21.6],['LAR',23.6,19.4],['MIA',16.4,21.5],['MIN',16.6,23.4],['NE',23.4,12.6],['NO',13.5,20.6],['NYG',23.6,19.4],['NYJ',19.4,13.6],['OAK',23.4,16.4],['PHI',15.6,22.1],['PIT',14.5,18.6],['SD',16.4,21.4],['SF',14.9,26.9],['PHX',23.6,15.4],['WAS',16.6,18.4],['ATL',23.6,20.0],['CHI',22.6,18.4],['SEA',19.4,8.4],['TB',23.6,16.6]],
  1993: [['BUF',15.7,20.6],['CIN',20.5,11.0],['CLE',18.4,18.6],['DAL',14.7,24.0],['DEN',18.7,23.5],['DET',16.4,18.4],['GB',13.6,21.1],['HOU',16.4,23.6],['IND',23.6,11.4],['KC',16.4,20.4],['LAR',23.4,13.0],['MIA',16.4,22.4],['MIN',15.7,17.5],['NE',18.6,15.6],['NO',16.5,19.4],['NYG',13.6,18.6],['NYJ',16.4,16.4],['OAK',16.4,19.4],['PHI',18.6,18.4],['PIT',17.6,19.4],['SD',23.5,20.1],['SF',16.0,29.8],['PHX',22.4,20.5],['WAS',23.6,14.6],['ATL',24.4,19.0],['CHI',13.6,14.0],['SEA',19.0,17.4],['TB',23.6,14.0]],
  1994: [['BUF',18.6,21.6],['CIN',24.6,17.6],['CLE',13.0,21.6],['DAL',15.2,25.8],['DEN',20.5,21.0],['DET',19.6,22.4],['GB',16.4,23.5],['HOU',23.6,15.4],['IND',23.6,18.4],['KC',16.6,19.4],['LAR',22.6,17.0],['MIA',16.4,24.7],['MIN',21.5,22.8],['NE',23.4,21.6],['NO',24.6,21.6],['NYG',18.6,17.4],['NYJ',18.6,16.6],['OAK',23.4,18.4],['PHI',18.4,19.4],['PIT',14.4,19.7],['SD',16.6,23.4],['SF',18.8,31.6],['ARI',24.5,15.0],['WAS',26.4,20.0],['ATL',26.4,19.4],['CHI',19.4,17.4],['SEA',16.7,17.4],['TB',23.6,15.0]],
  1995: [['BUF',24.6,21.4],['CAR',20.6,17.0],['CIN',23.6,21.6],['CLE',23.4,17.5],['DAL',18.8,27.2],['DEN',23.4,24.5],['DET',23.6,27.4],['GB',19.6,25.4],['HOU',16.6,21.5],['IND',20.4,20.4],['JAX',26.4,17.4],['KC',15.6,22.4],['LAR',23.6,18.4],['MIA',19.7,24.0],['MIN',18.6,25.7],['NE',23.5,18.6],['NO',23.4,19.4],['NYG',18.4,16.4],['NYJ',26.4,14.6],['OAK',21.6,18.4],['PHI',19.4,20.7],['PIT',18.6,25.7],['SD',23.6,19.7],['SF',16.7,28.8],['ARI',26.6,17.4],['WAS',23.0,19.4],['ATL',22.5,22.0],['CHI',19.4,24.7],['SEA',24.4,22.0],['TB',23.4,15.0]],
  1996: [['BAL',23.6,23.6],['BUF',23.4,19.4],['CAR',13.6,22.0],['CIN',20.6,23.6],['DAL',19.6,18.6],['DEN',16.6,24.7],['DET',23.6,18.6],['GB',13.1,28.5],['HOU',16.6,21.4],['IND',23.6,19.4],['JAX',26.4,20.4],['KC',16.4,18.4],['MIA',20.5,21.0],['MIN',18.4,18.4],['NE',19.5,26.4],['NO',23.0,14.4],['NYG',19.6,15.5],['NYJ',28.4,16.6],['OAK',24.6,18.4],['PHI',18.5,22.4],['PIT',16.6,21.6],['SD',23.6,19.6],['SF',16.4,24.7],['ARI',23.5,18.6],['WAS',19.4,22.0],['ATL',27.9,19.7],['CHI',22.6,17.6],['SEA',20.6,19.4],['STL',24.4,18.0],['TB',23.4,13.5]],
  1997: [['BAL',16.4,20.0],['BUF',19.6,15.4],['CAR',16.6,16.7],['CIN',21.4,23.6],['DAL',18.6,18.6],['DEN',18.4,29.4],['DET',23.6,23.0],['GB',18.5,26.4],['IND',24.0,19.4],['JAX',16.6,24.4],['KC',15.5,23.4],['MIA',16.5,21.7],['MIN',23.4,22.4],['NE',16.6,21.7],['NO',18.6,15.6],['NYG',16.4,19.4],['NYJ',17.4,21.5],['OAK',24.4,20.4],['PHI',19.4,19.4],['PIT',13.6,23.5],['SD',23.6,16.4],['SF',16.5,23.4],['ARI',26.4,17.4],['WAS',19.6,21.0],['ATL',24.4,21.0],['CHI',26.4,16.4],['SEA',23.4,23.4],['STL',23.6,18.4],['TB',16.4,18.4],['TEN',19.6,19.4]],
  1998: [['BAL',17.5,16.6],['BUF',18.6,25.5],['CAR',21.5,18.7],['CIN',26.4,16.4],['DAL',20.4,23.0],['DEN',16.0,31.3],['DET',24.5,21.0],['GB',16.5,25.5],['IND',26.4,19.0],['JAX',21.6,24.4],['KC',19.4,18.6],['MIA',16.4,20.4],['MIN',18.4,34.8],['NE',19.7,21.6],['NO',24.4,18.6],['NYG',18.7,17.4],['NYJ',16.6,26.4],['OAK',24.4,18.0],['PHI',19.6,10.0],['PIT',16.6,16.4],['SD',16.7,15.4],['SF',16.5,29.9],['ARI',23.6,20.0],['WAS',19.5,19.4],['ATL',18.5,27.4],['CHI',24.6,17.0],['SEA',18.5,22.6],['STL',22.7,18.6],['TB',16.4,19.4],['TEN',20.5,20.7]],
  1999: [['BAL',16.4,20.0],['BUF',13.4,20.0],['CAR',19.6,21.0],['CIN',23.5,17.6],['CLE',26.6,13.6],['DAL',19.6,22.4],['DEN',23.5,19.4],['DET',19.6,20.4],['GB',16.6,22.4],['IND',24.4,26.4],['JAX',13.6,25.7],['KC',19.4,23.6],['MIA',16.6,20.4],['MIN',16.5,24.7],['NE',16.4,18.0],['NO',24.4,16.5],['NYG',19.4,17.6],['NYJ',19.6,17.6],['OAK',16.4,24.0],['PHI',21.6,17.4],['PIT',19.6,19.6],['SD',23.4,17.6],['SF',26.4,18.4],['ARI',24.4,15.6],['WAS',24.4,27.5],['ATL',23.6,17.5],['CHI',20.5,17.4],['SEA',19.4,21.4],['STL',15.1,32.9],['TB',14.4,17.4],['TEN',19.7,24.0]],
  2000: [['BAL',10.3,20.8],['BUF',19.4,19.0],['CAR',19.0,19.4],['CIN',23.5,11.0],['CLE',26.4,10.6],['DAL',23.4,18.4],['DEN',19.4,30.4],['DET',19.5,19.4],['GB',21.4,21.4],['IND',23.6,26.4],['JAX',23.5,22.4],['KC',22.4,22.4],['MIA',13.6,20.4],['MIN',23.5,24.6],['NE',16.6,17.0],['NO',19.4,22.4],['NYG',15.6,20.5],['NYJ',19.7,20.4],['OAK',19.6,29.6],['PHI',16.4,22.4],['PIT',16.5,20.4],['SD',23.6,16.6],['SF',26.4,24.4],['ARI',26.6,13.4],['WAS',16.6,17.4],['ATL',26.4,15.5],['CHI',22.6,13.6],['SEA',19.4,20.4],['STL',29.4,33.7],['TB',12.5,24.4],['TEN',12.5,21.4]],
  2001: [['BAL',16.6,18.0],['BUF',26.6,16.4],['CAR',16.6,15.6],['CIN',26.4,14.4],['CLE',16.4,17.4],['DAL',24.4,15.4],['DEN',21.5,21.5],['DET',26.4,19.4],['GB',18.0,23.4],['IND',26.6,25.4],['JAX',19.6,18.7],['KC',23.4,20.6],['MIA',16.6,21.0],['MIN',23.4,18.4],['NE',17.1,23.2],['NO',23.4,21.7],['NYG',16.6,18.6],['NYJ',17.7,19.4],['OAK',20.5,24.4],['PHI',13.6,21.0],['PIT',16.7,22.1],['SD',20.4,20.6],['SF',16.7,25.5],['ARI',23.6,18.5],['WAS',16.6,16.0],['ATL',23.4,18.0],['CHI',12.7,21.4],['SEA',18.4,18.0],['STL',16.5,31.4],['TB',17.0,20.4],['TEN',23.6,21.6]],
  2002: [['BAL',23.4,19.4],['BUF',22.5,23.5],['CAR',18.7,16.5],['CIN',26.4,17.4],['CLE',19.6,21.6],['DAL',26.4,13.6],['DEN',16.5,24.4],['DET',23.4,18.4],['GB',23.0,24.4],['HOU',24.4,13.4],['IND',20.7,21.5],['JAX',16.5,20.6],['KC',26.4,29.4],['MIA',18.7,23.4],['MIN',26.4,24.0],['NE',18.5,23.4],['NO',26.4,26.0],['NYG',20.4,20.4],['NYJ',18.5,22.4],['OAK',19.5,28.1],['PHI',15.0,25.9],['PIT',17.0,21.4],['SD',17.5,21.5],['SF',22.6,22.6],['ARI',23.4,16.0],['WAS',23.5,19.4],['ATL',19.0,24.0],['CHI',23.4,17.4],['SEA',23.5,22.5],['STL',23.5,19.6],['TB',12.3,21.6],['TEN',17.5,23.5]],
  2003: [['BAL',16.4,24.5],['BUF',18.4,15.6],['CAR',18.4,20.4],['CIN',23.4,21.0],['CLE',22.4,15.4],['DAL',16.0,17.6],['DEN',16.0,23.0],['DET',23.4,16.0],['GB',19.6,27.4],['HOU',24.4,15.4],['IND',21.4,27.0],['JAX',19.4,17.4],['KC',21.6,30.3],['MIA',16.5,19.4],['MIN',21.5,26.4],['NE',14.9,21.0],['NO',24.4,21.0],['NYG',23.4,15.4],['NYJ',18.4,17.4],['OAK',23.4,16.4],['PHI',16.4,23.7],['PIT',20.5,18.0],['SD',26.4,20.0],['SF',23.4,23.0],['ARI',23.4,14.4],['WAS',19.4,18.5],['ATL',26.4,18.4],['CHI',24.4,17.4],['SEA',21.6,24.6],['STL',20.4,27.5],['TB',16.4,18.7],['TEN',20.0,27.7]],
  2004: [['BAL',16.6,19.6],['BUF',17.4,24.8],['CAR',20.6,22.6],['CIN',23.4,22.4],['CLE',24.4,17.6],['DAL',25.4,18.4],['DEN',18.6,23.5],['DET',23.6,18.6],['GB',23.6,26.4],['HOU',20.4,19.6],['IND',21.4,32.6],['JAX',16.5,16.4],['KC',26.4,30.5],['MIA',22.4,17.0],['MIN',24.4,25.4],['NE',16.3,27.3],['NO',25.6,21.4],['NYG',20.5,18.5],['NYJ',17.6,20.4],['OAK',26.4,20.5],['PHI',16.2,24.0],['PIT',15.6,23.0],['SD',19.4,27.9],['SF',26.4,16.4],['ARI',24.4,18.0],['WAS',16.6,15.0],['ATL',21.0,21.0],['CHI',20.4,14.6],['SEA',24.6,23.0],['STL',23.4,19.4],['TB',18.7,18.0],['TEN',27.5,21.6]],
  2005: [['BAL',19.4,16.5],['BUF',16.5,17.6],['CAR',16.4,24.0],['CIN',20.5,26.0],['CLE',24.4,14.4],['DAL',19.7,20.7],['DEN',16.6,24.1],['DET',23.6,16.4],['GB',24.4,18.6],['HOU',26.4,16.6],['IND',15.4,27.4],['JAX',16.6,22.7],['KC',20.4,25.6],['MIA',17.7,20.0],['MIN',18.7,19.4],['NE',20.5,23.7],['NO',26.4,14.4],['NYG',18.0,26.0],['NYJ',22.5,15.0],['OAK',21.4,18.0],['PHI',24.4,19.4],['PIT',16.0,24.4],['SD',20.7,26.4],['SF',26.4,15.5],['ARI',24.4,19.4],['WAS',16.6,22.0],['ATL',21.5,21.6],['CHI',12.6,16.0],['SEA',16.6,28.4],['STL',24.4,23.5],['TB',16.5,18.7],['TEN',24.4,19.4]],
  2006: [['BAL',12.6,22.1],['BUF',18.4,18.4],['CAR',18.6,16.4],['CIN',21.4,23.4],['CLE',22.4,14.6],['DAL',19.7,26.6],['DEN',18.0,19.0],['DET',24.5,18.6],['GB',17.5,18.7],['HOU',23.4,16.6],['IND',22.6,26.7],['JAX',16.4,23.4],['KC',18.7,20.7],['MIA',17.5,16.4],['MIN',17.0,17.6],['NE',14.8,24.1],['NO',20.5,25.8],['NYG',22.4,22.6],['NYJ',18.7,20.5],['OAK',20.4,10.5],['PHI',19.6,24.0],['PIT',19.7,22.7],['SD',18.0,30.8],['SF',26.4,18.6],['ARI',24.4,19.4],['WAS',22.5,19.6],['ATL',19.6,18.4],['CHI',15.9,26.7],['SEA',19.7,21.0],['STL',23.4,22.9],['TB',20.4,13.7],['TEN',24.6,20.0]],
  2007: [['BAL',24.4,17.2],['BUF',22.5,15.5],['CAR',21.4,16.4],['CIN',24.4,23.5],['CLE',24.7,25.1],['DAL',20.0,28.3],['DEN',24.4,20.0],['DET',23.7,21.7],['GB',18.0,21.6],['HOU',24.4,23.4],['IND',16.4,28.1],['JAX',16.4,25.7],['KC',20.4,14.4],['MIA',27.3,16.7],['MIN',20.8,22.9],['NE',17.1,36.8],['NO',24.6,23.7],['NYG',22.0,23.3],['NYJ',22.7,16.7],['OAK',24.4,17.4],['PHI',18.7,21.0],['PIT',16.6,24.4],['SD',17.6,25.8],['SF',26.4,13.7],['ARI',24.4,25.0],['WAS',19.6,20.4],['ATL',25.7,16.2],['CHI',21.0,21.4],['SEA',18.6,24.6],['STL',24.5,16.4],['TB',16.6,20.9],['TEN',18.0,18.8]],
  2008: [['BAL',15.3,23.2],['BUF',24.4,21.4],['CAR',20.4,25.9],['CIN',21.6,12.8],['CLE',23.6,14.5],['DAL',23.0,22.7],['DEN',28.0,23.1],['DET',32.3,16.7],['GB',23.8,26.0],['HOU',23.7,23.7],['IND',18.7,23.6],['JAX',24.5,18.8],['KC',26.6,18.0],['MIA',19.8,21.5],['MIN',20.8,23.7],['NE',19.3,25.6],['NO',24.9,29.1],['NYG',18.4,26.6],['NYJ',22.0,25.3],['OAK',24.2,16.4],['PHI',17.1,26.0],['PIT',13.9,21.7],['SD',21.0,27.4],['SF',24.2,21.5],['ARI',26.6,26.6],['WAS',19.3,16.6],['ATL',20.3,24.4],['CHI',22.3,23.4],['SEA',24.8,18.9],['STL',29.2,14.5],['TB',19.4,22.4],['TEN',14.6,23.4]],
  2009: [['BAL',16.3,24.1],['BUF',20.9,16.9],['CAR',19.3,19.1],['CIN',18.2,19.1],['CLE',23.8,15.3],['DAL',15.6,22.6],['DEN',20.4,20.5],['DET',30.9,16.4],['GB',18.6,28.8],['HOU',20.5,24.4],['IND',19.3,26.0],['JAX',23.0,18.0],['KC',26.0,16.3],['MIA',24.2,22.3],['MIN',19.5,29.4],['NE',17.0,26.7],['NO',21.3,31.9],['NYG',26.6,25.4],['NYJ',14.8,21.8],['OAK',24.7,12.3],['PHI',20.6,26.8],['PIT',20.6,23.0],['SD',20.0,28.4],['SF',18.0,20.5],['ARI',20.3,23.3],['WAS',20.3,16.6],['ATL',20.4,22.7],['CHI',23.4,20.6],['SEA',24.4,17.4],['STL',27.0,10.9],['TB',25.4,15.2],['TEN',24.4,22.8]],
  2010: [['BAL',17.0,22.5],['BUF',26.0,17.5],['CAR',25.7,12.2],['CIN',24.3,19.1],['CLE',20.8,17.3],['DAL',27.3,24.6],['DEN',29.4,21.6],['DET',23.0,22.6],['GB',15.0,24.3],['HOU',26.7,24.2],['IND',24.0,27.2],['JAX',26.6,21.9],['KC',20.8,22.9],['MIA',17.1,17.1],['MIN',21.6,17.6],['NE',19.6,32.4],['NO',19.2,24.0],['NYG',22.1,24.5],['NYJ',19.0,22.9],['OAK',23.1,25.6],['PHI',23.4,27.4],['PIT',14.5,23.4],['SD',20.4,27.6],['SF',21.5,19.0],['ARI',27.3,18.9],['WAS',23.3,18.9],['ATL',18.0,22.0],['CHI',17.9,20.9],['SEA',25.4,19.4],['STL',20.4,18.1],['TB',20.9,21.3],['TEN',21.8,22.0]],
  2011: [['BAL',16.6,23.6],['BUF',26.1,23.3],['CAR',26.8,25.4],['CIN',20.2,21.5],['CLE',19.2,13.6],['DAL',21.7,23.3],['DEN',24.4,19.3],['DET',23.1,29.4],['GB',22.4,35.0],['HOU',17.4,23.4],['IND',26.9,15.2],['JAX',20.1,15.2],['KC',21.1,13.2],['MIA',19.6,20.6],['MIN',19.3,21.2],['NE',21.4,32.1],['NO',21.2,34.2],['NYG',25.0,24.6],['NYJ',22.7,23.6],['OAK',27.0,22.4],['PHI',20.5,24.8],['PIT',14.2,20.3],['SD',23.0,25.0],['SF',14.3,23.8],['ARI',21.6,19.5],['WAS',21.1,18.0],['ATL',21.1,25.1],['CHI',21.3,22.3],['SEA',19.7,19.4],['STL',25.7,12.1],['TB',30.9,17.9],['TEN',20.9,20.3]],
  2012: [['BAL',21.5,24.9],['BUF',27.2,21.5],['CAR',22.7,22.3],['CIN',20.0,24.5],['CLE',23.1,18.9],['DAL',25.0,23.5],['DEN',18.1,30.1],['DET',27.3,23.2],['GB',21.0,27.1],['HOU',20.7,26.0],['IND',24.2,22.3],['JAX',27.8,15.9],['KC',26.6,13.2],['MIA',19.8,18.0],['MIN',21.8,23.7],['NE',20.7,34.8],['NO',28.4,28.8],['NYG',21.5,26.8],['NYJ',23.4,17.6],['OAK',27.7,18.1],['PHI',27.8,17.5],['PIT',20.2,21.0],['SD',21.9,21.9],['SF',17.1,24.8],['ARI',23.8,15.6],['WAS',24.2,27.3],['ATL',18.7,26.2],['CHI',17.3,23.4],['SEA',15.3,25.8],['STL',21.8,18.7],['TB',24.6,24.3],['TEN',29.4,20.6]],
  2013: [['BAL',21.9,20.0],['BUF',24.7,21.2],['CAR',15.1,22.9],['CIN',19.1,26.2],['CLE',25.6,19.0],['DAL',27.0,27.4],['DEN',24.9,37.9],['DET',23.4,24.7],['GB',26.8,26.1],['HOU',26.8,17.2],['IND',21.3,24.6],['JAX',27.9,15.4],['KC',19.1,26.9],['MIA',20.9,19.8],['MIN',30.0,25.2],['NE',21.0,27.8],['NO',19.0,25.9],['NYG',24.9,18.4],['NYJ',24.1,17.0],['OAK',28.3,20.1],['PHI',24.3,27.6],['PIT',23.5,23.7],['SD',21.6,24.8],['SF',17.0,25.4],['ARI',20.3,23.7],['WAS',29.9,20.9],['ATL',27.7,22.3],['CHI',29.8,27.8],['SEA',14.4,26.1],['STL',23.7,21.8],['TB',24.0,18.0],['TEN',24.0,22.0]],
  2014: [['BAL',18.9,25.6],['BUF',18.1,21.8],['CAR',23.6,18.7],['CIN',22.7,21.6],['CLE',21.1,18.3],['DAL',22.0,28.4],['DEN',22.0,30.0],['DET',17.6,20.1],['GB',23.4,30.4],['HOU',22.4,23.9],['IND',23.0,28.6],['JAX',26.0,15.6],['KC',17.6,22.1],['MIA',23.0,24.0],['MIN',21.7,20.6],['NE',19.6,29.3],['NO',26.5,25.0],['NYG',24.4,23.6],['NYJ',24.9,17.6],['OAK',27.5,15.8],['PHI',26.3,29.6],['PIT',23.3,27.3],['SD',21.4,21.6],['SF',21.6,19.1],['ARI',18.7,18.9],['WAS',26.4,18.0],['ATL',26.1,23.8],['CHI',27.8,19.9],['SEA',15.9,24.6],['STL',22.0,20.4],['TB',25.6,17.3],['TEN',27.4,15.9]],
  2015: [['BAL',25.1,20.0],['BUF',23.4,23.6],['CAR',19.3,31.3],['CIN',17.4,26.2],['CLE',27.0,17.4],['DAL',23.6,17.2],['DEN',18.5,22.2],['DET',25.0,22.1],['GB',20.2,23.0],['HOU',20.4,21.2],['IND',25.5,20.9],['JAX',28.2,23.5],['KC',17.9,25.3],['MIA',24.4,19.3],['MIN',18.9,22.8],['NE',19.7,29.1],['NO',29.8,25.5],['NYG',27.6,26.3],['NYJ',19.6,24.2],['OAK',24.9,22.4],['PHI',26.9,23.6],['PIT',19.9,26.4],['SD',25.5,20.0],['SF',24.0,14.9],['ARI',19.6,30.6],['WAS',23.9,21.1],['ATL',21.6,21.2],['CHI',24.9,20.9],['SEA',17.3,26.4],['STL',20.6,17.5],['TB',26.1,21.1],['TEN',26.4,18.7]],
  2016: [['BAL',19.4,21.4],['BUF',23.4,24.9],['CAR',25.1,23.1],['CIN',24.9,17.9],['CLE',28.3,16.5],['DAL',19.1,26.3],['DEN',18.6,20.8],['DET',22.5,21.8],['GB',24.2,27.0],['HOU',20.5,17.4],['IND',23.6,25.5],['JAX',25.0,19.0],['KC',19.4,23.3],['MIA',23.8,22.7],['MIN',19.2,20.4],['NE',15.6,27.4],['NO',28.4,29.3],['NYG',17.8,19.4],['NYJ',26.9,17.2],['OAK',24.2,26.0],['PHI',22.9,22.9],['PIT',20.4,24.9],['SD',26.4,25.4],['SF',30.7,19.3],['ARI',22.6,26.1],['WAS',24.8,24.8],['ATL',25.4,33.8],['CHI',24.9,17.4],['SEA',18.3,22.1],['LAR',24.6,14.0],['TB',22.4,22.1],['TEN',23.8,23.8]],
  2017: [['BAL',18.9,24.3],['BUF',22.4,18.9],['CAR',20.4,22.7],['CIN',20.4,18.1],['CLE',25.6,14.6],['DAL',20.8,22.1],['DEN',22.6,18.1],['DET',23.5,25.6],['GB',24.0,20.0],['HOU',27.3,21.1],['IND',25.0,16.4],['JAX',16.8,26.1],['KC',21.2,25.9],['LAC',19.9,22.1],['LAR',20.6,29.9],['MIA',24.6,17.6],['MIN',19.5,23.9],['NE',18.5,28.6],['NO',20.4,28.0],['NYG',24.5,15.4],['NYJ',25.6,18.1],['OAK',24.9,18.8],['PHI',18.4,28.6],['PIT',19.5,25.4],['SF',22.0,18.9],['ARI',22.6,18.4],['WAS',23.6,21.6],['ATL',19.7,22.1],['CHI',20.0,16.5],['SEA',18.9,22.9],['TB',24.8,20.9],['TEN',22.3,20.9]],
  2018: [['BAL',17.9,24.3],['BUF',23.4,16.8],['CAR',24.7,23.6],['CIN',28.4,23.6],['CLE',23.4,21.0],['DAL',20.3,21.2],['DEN',21.8,20.6],['DET',24.4,20.9],['GB',25.0,23.5],['HOU',19.8,25.1],['IND',20.5,27.1],['JAX',19.8,15.3],['KC',26.3,35.3],['LAC',20.6,26.8],['LAR',24.0,32.9],['MIA',26.6,19.9],['MIN',21.3,22.5],['NE',20.3,27.3],['NO',22.1,31.5],['NYG',26.4,23.1],['NYJ',27.6,20.8],['OAK',29.2,18.1],['PHI',23.0,22.9],['PIT',21.4,26.8],['SF',27.2,21.4],['ARI',26.6,14.1],['WAS',22.3,17.6],['ATL',26.4,25.9],['CHI',17.7,26.3],['SEA',21.7,26.8],['TB',29.0,24.7],['TEN',18.9,19.4]],
  2019: [['BAL',17.6,33.2],['BUF',16.2,19.6],['CAR',29.4,21.3],['CIN',26.5,17.4],['CLE',24.4,21.0],['DAL',20.1,27.1],['DEN',20.0,17.6],['DET',26.4,21.3],['GB',19.6,23.5],['HOU',24.1,23.6],['IND',23.1,22.6],['JAX',25.4,18.8],['KC',19.3,28.2],['LAC',22.9,20.7],['LAR',23.1,24.6],['MIA',30.9,19.1],['MIN',18.9,25.4],['NE',14.1,26.3],['NO',21.3,28.6],['NYG',28.2,21.5],['NYJ',22.4,17.2],['OAK',26.2,19.6],['PHI',22.1,23.6],['PIT',18.9,18.9],['SF',19.4,29.9],['ARI',27.6,22.6],['WAS',27.1,16.6],['ATL',24.9,23.9],['CHI',18.6,17.5],['SEA',24.9,25.3],['TB',28.1,28.6],['TEN',18.9,25.1]],
  2020: [['BAL',18.9,29.3],['BUF',23.4,31.3],['CAR',25.3,21.9],['CIN',26.5,19.5],['CLE',25.6,25.3],['DAL',29.6,24.7],['DEN',27.8,20.2],['DET',32.4,21.1],['GB',23.1,31.8],['HOU',29.0,23.6],['IND',22.6,28.2],['JAX',30.8,18.8],['KC',22.6,29.6],['LAC',26.6,23.9],['LAR',18.5,23.3],['MIA',21.1,25.0],['MIN',29.7,26.9],['NE',22.6,20.6],['NO',21.1,30.1],['NYG',22.6,17.5],['NYJ',28.6,15.2],['LV',29.9,24.6],['PHI',26.1,20.9],['PIT',19.0,26.0],['SF',23.3,23.7],['ARI',22.9,26.1],['WAS',20.6,20.6],['ATL',25.9,25.6],['CHI',23.1,23.4],['SEA',23.2,28.7],['TB',22.2,30.8],['TEN',27.4,30.7]],
  2021: [['BAL',23.1,22.8],['BUF',17.0,28.4],['CAR',21.9,17.9],['CIN',22.1,27.1],['CLE',21.8,21.8],['DAL',21.1,31.2],['DEN',18.9,19.7],['DET',27.0,19.1],['GB',21.8,26.5],['HOU',26.8,16.5],['IND',21.5,24.3],['JAX',26.9,14.9],['KC',21.4,28.2],['LAC',27.0,27.0],['LAR',21.9,27.1],['MIA',20.6,20.1],['MIN',25.1,25.0],['NE',17.8,27.2],['NO',19.7,20.3],['NYG',24.5,15.2],['NYJ',29.6,18.2],['LV',24.6,22.5],['PHI',22.0,26.1],['PIT',23.2,20.2],['SF',21.5,25.1],['ARI',21.7,26.4],['WAS',25.5,19.7],['ATL',25.9,18.4],['CHI',23.9,18.3],['SEA',21.5,23.2],['TB',20.8,30.1],['TEN',20.8,28.0]],
  2022: [['BAL',20.6,20.6],['BUF',17.9,28.4],['CAR',21.8,20.7],['CIN',20.1,26.1],['CLE',23.0,21.9],['DAL',20.1,27.5],['DEN',18.9,16.9],['DET',25.1,26.6],['GB',21.8,21.8],['HOU',24.7,17.0],['IND',24.7,17.0],['JAX',20.6,23.8],['KC',21.7,29.2],['LAC',21.7,23.4],['LAR',21.5,18.1],['MIA',24.4,23.4],['MIN',25.1,24.9],['NE',20.4,21.4],['NO',20.4,19.7],['NYG',21.9,21.5],['NYJ',20.6,17.4],['LV',24.6,23.2],['PHI',20.2,28.1],['PIT',20.4,18.1],['SF',16.3,26.5],['ARI',24.6,20.4],['WAS',20.2,18.9],['ATL',23.4,21.5],['CHI',27.2,19.2],['SEA',23.6,23.9],['TB',18.7,18.4],['TEN',22.2,17.5]],
  2023: [['BAL',16.5,28.4],['BUF',19.7,26.4],['CAR',23.5,13.9],['CIN',20.2,22.6],['CLE',16.0,23.6],['DAL',18.4,29.9],['DEN',26.0,20.7],['DET',23.2,27.1],['GB',21.8,23.5],['HOU',21.8,22.2],['IND',23.7,23.3],['JAX',22.2,21.7],['KC',17.3,21.8],['LAC',24.9,21.7],['LAR',22.6,23.7],['MIA',21.4,29.2],['MIN',22.7,21.7],['NE',18.7,13.9],['NO',20.5,23.5],['NYG',24.4,15.6],['NYJ',21.4,15.9],['LV',20.4,19.5],['PHI',25.2,25.5],['PIT',19.4,18.1],['SF',17.5,28.9],['ARI',27.4,21.0],['WAS',30.5,19.4],['ATL',22.2,19.5],['CHI',24.1,21.2],['SEA',24.5,21.4],['TB',20.9,19.7],['TEN',21.9,17.3]],
  2024: [['BAL',19.7,30.5],['BUF',20.8,30.9],['CAR',31.4,21.9],['CIN',25.5,28.1],['CLE',24.1,15.7],['DAL',27.4,18.5],['DEN',18.2,21.3],['DET',20.1,33.2],['GB',19.9,27.1],['HOU',22.1,21.7],['IND',25.1,22.8],['JAX',26.5,18.7],['KC',19.2,22.3],['LAC',18.7,24.1],['LAR',27.0,23.8],['MIA',22.7,20.1],['MIN',19.5,26.5],['NE',24.8,14.4],['NO',26.1,19.6],['NYG',26.1,16.1],['NYJ',23.4,19.9],['LV',25.5,17.2],['PHI',17.8,27.2],['PIT',20.4,21.0],['SF',23.8,23.5],['ARI',23.0,23.8],['WAS',23.8,28.5],['ATL',24.9,22.8],['CHI',22.6,18.2],['SEA',23.0,22.8],['TB',20.9,29.5],['TEN',26.5,18.7]],
};

// ============================================================
// HELPERS
// ============================================================
const getInitials = (name) => {
  const parts = name.split(' ');
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
};

// Open positions in current roster (returns array of base positions: 'QB','RB','WR','TE','OL')
const getOpenPositions = (roster) => {
  const open = [];
  if (!roster.QB) open.push('QB');
  if (!roster.RB || !roster.RB2) open.push('RB');
  if (!roster.WR1 || !roster.WR2 || !roster.WR3) open.push('WR');
  if (!roster.TE || !roster.TE2) open.push('TE');
  if (!roster.OL) open.push('OL');
  return open;
};

// For a given (team, decade), return picks grouped by position (only OPEN positions)
// Returns picks grouped by position for a team+decade — ALL positions, not just open ones.
// Filled positions still show up so the player can see the full roster (greyed out in UI).
const getAvailablePicks = (team, decade, roster, usedIds) => {
  const usedNames = new Set(Object.values(roster).filter(Boolean).map(p => p.n));
  const result = {};
  POSITIONS.forEach(pos => {
    if (pos === 'OL') {
      const units = UNITS.filter(u => u.p === pos && u.t === team && u.d === decade);
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

// Extract last name (used for field labels)
const lastNameOf = (name) => {
  const parts = name.split(' ');
  const suffixes = ['Jr.', 'Sr.', 'II', 'III', 'IV'];
  let last = parts[parts.length - 1];
  if (suffixes.includes(last) && parts.length >= 2) last = parts[parts.length - 2];
  return last;
};

// All valid (team, decade) pairs where at least one OPEN position has ≥1 unused pick.
// A player whose NAME is already on the roster (even at a different team/decade) is excluded.
const getValidPairs = (roster, usedIds) => {
  const open = getOpenPositions(roster);
  const usedNames = new Set(Object.values(roster).filter(Boolean).map(p => p.n));
  const seen = new Set();
  const pairs = [];

  const allEntries = [
    ...PLAYERS.map((pl, idx) => ({ p: pl.p, t: pl.t, d: pl.d, n: pl.n, isUnit: false, idx })),
    ...UNITS.filter(u => u.p === 'OL').map(u => ({ p: u.p, t: u.t, d: u.d, n: u.n, isUnit: true })),
  ];

  allEntries.forEach(e => {
    if (!open.includes(e.p)) return;
    if (!e.isUnit && usedIds.has(e.idx)) return;
    if (!e.isUnit && usedNames.has(e.n)) return;
    const key = `${e.t}|${e.d}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ t: e.t, d: e.d });
  });

  return pairs;
};

// Which roster slot to assign a picked player/unit
const targetSlotFor = (position, roster) => {
  if (position === 'RB') return roster.RB ? 'RB2' : 'RB';
  if (position === 'WR') return roster.WR1 ? (roster.WR2 ? 'WR3' : 'WR2') : 'WR1';
  if (position === 'TE') return roster.TE ? 'TE2' : 'TE';
  return position;
};

// ============================================================
// ============================================================
// SEASON SIMULATION (year-based, against random opponents from that year)
// ============================================================

// Era baselines — approximate league-average STARTER production by decade.
// Used to normalize raw counting stats into era-relative dominance so that a
// 1970s star (low-volume era) competes fairly against a modern stat-stuffer.
const ERA_BASE = {
  '1970s': { passY: 155, passTD: 1.00, rate: 66, int: 1.45, rbY: 62, rbTD: 0.50, recY: 44, recTD: 0.32 },
  '1980s': { passY: 200, passTD: 1.25, rate: 75, int: 1.25, rbY: 64, rbTD: 0.52, recY: 50, recTD: 0.36 },
  '1990s': { passY: 212, passTD: 1.28, rate: 78, int: 1.15, rbY: 60, rbTD: 0.50, recY: 52, recTD: 0.36 },
  '2000s': { passY: 228, passTD: 1.42, rate: 83, int: 1.00, rbY: 58, rbTD: 0.50, recY: 55, recTD: 0.40 },
  '2010s': { passY: 245, passTD: 1.52, rate: 88, int: 0.85, rbY: 54, rbTD: 0.46, recY: 58, recTD: 0.42 },
  '2020s': { passY: 238, passTD: 1.50, rate: 90, int: 0.80, rbY: 54, rbTD: 0.46, recY: 58, recTD: 0.42 },
};
const REF_ERA = '2010s';
const REF = ERA_BASE[REF_ERA];

// ============================================================
// DERIVED PLAYER PROFILE
// Everything here is computed from a player's own accurate per-game rates plus
// the era-average table above. No hand-entered or remembered data — so there is
// zero fabrication risk. Adds: (1) derived stat lines, (2) era context, and
// (3) an Archetype label inferred from the player's own numbers.
// ============================================================

const round1 = (x) => Math.round(x * 10) / 10;
const pct = (x) => Math.round(x);

function deriveProfile(p) {
  const s = p.s || {};
  const era = ERA_BASE[p.d] || REF;
  const out = { era: p.d, derived: {}, archetype: '', archetypeNote: '' };

  if (p.p === 'QB') {
    // y=passYds/g, t=passTD/g, i=INT/g, r=rating
    const tdIntRatio = s.i > 0 ? round1(s.t / s.i) : (s.t > 0 ? 99 : 0);
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

const clampN = (x, a, b) => Math.max(a, Math.min(b, x));

// Convert a raw era stat into modern-equivalent production. The compression
// exponent (<1) keeps extreme outliers from exploding while preserving dominance.
const eraEquiv = (raw, base, ref, compress = 0.85) => {
  if (!base || raw == null) return ref;
  return ref * Math.pow(Math.max(0.05, raw / base), compress);
};

// Tunable scoring constants (calibrated so league-average ≈ 21 PPG, all-time ≈ 36, poor ≈ 14)
const SCORE_K = { TD: 7.15, fgC: 3.2, fgY: 0.013, fgTD: 0.55, rate: 0.06, int: 2.0, sack: 0.35, base: -1.4, pivot: 21, up: 1.70, down: 0.90 };

// Build the team's offensive profile from the 9 starters, era-normalized.
const calculateOffensivePF = (roster) => {
  const { QB: qb, RB: rb, RB2: rb2, WR1: wr1, WR2: wr2, WR3: wr3, TE: te, TE2: te2, OL: ol } = roster;

  const qb_b = ERA_BASE[qb.d] || REF;
  const qbPassY  = eraEquiv(qb.s.y, qb_b.passY, REF.passY);
  const qbPassTD = eraEquiv(qb.s.t, qb_b.passTD, REF.passTD);
  const qbRate   = eraEquiv(qb.s.r, qb_b.rate, REF.rate, 0.9);
  const qbINT    = eraEquiv(qb.s.i, qb_b.int, REF.int, 0.9);

  // Receiving corps — production index weighted by realistic target share, blended with impact
  const corps = [
    { p: wr1, w: 0.30 }, { p: wr2, w: 0.22 }, { p: te, w: 0.18 },
    { p: wr3, w: 0.16 }, { p: te2, w: 0.08 },
  ];
  let recYIdx = 0, recTDIdx = 0, impW = 0, wSum = 0;
  corps.forEach(({ p, w }) => {
    if (!p) return;
    const b = ERA_BASE[p.d] || REF;
    const yBase = p.p === 'TE' ? b.recY * 0.7 : b.recY;
    recYIdx += w * ((p.s.y || 0) / yBase);
    recTDIdx += w * ((p.s.t || 0) / b.recTD);
    impW += w * (p.imp || 75);
    wSum += w;
  });
  if (wSum > 0) { recYIdx /= wSum; recTDIdx /= wSum; impW /= wSum; }
  const recMult = 0.62 + 0.26 * recYIdx + 0.12 * (impW / 86);

  // Offensive line: pass protection & run blocking factors
  const oS = ol.s || { ry: 130, sa: 2.0, pb: 86, pbl: 2 };
  const olPass = clampN(0.80 + 0.20 * (oS.pb / 88) - 0.03 * (oS.sa - 2.0) + 0.015 * ((oS.pbl || 0) - 2), 0.82, 1.20);
  const olRun  = clampN(0.78 + 0.32 * (oS.ry / 135), 0.82, 1.28);

  // Backfield (RB1 primary, RB2 change-of-pace)
  const rbY   = eraEquiv(rb.s.y, (ERA_BASE[rb.d] || REF).rbY, REF.rbY);
  const rbTD  = eraEquiv(rb.s.t, (ERA_BASE[rb.d] || REF).rbTD, REF.rbTD);
  const rb2Y  = eraEquiv(rb2.s.y, (ERA_BASE[rb2.d] || REF).rbY, REF.rbY);
  const rb2TD = eraEquiv(rb2.s.t, (ERA_BASE[rb2.d] || REF).rbTD, REF.rbTD);
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
    qbRating: qb.s.r.toFixed(1),
  };
};

// Era-appropriate league average PA per game (used as anchor for matchup math)
const LEAGUE_AVG_PA = {
  1970: 17.5, 1971: 17.5, 1972: 17.0, 1973: 17.0, 1974: 17.5, 1975: 18.5,
  1976: 17.0, 1977: 16.0, 1978: 18.5, 1979: 19.5,
  1980: 20.5, 1981: 21.0, 1982: 19.0, 1983: 21.5, 1984: 21.0,
  1985: 21.5, 1986: 20.5, 1987: 20.5, 1988: 20.0, 1989: 20.5,
  1990: 20.0, 1991: 19.5, 1992: 19.5, 1993: 19.5, 1994: 20.5,
  1995: 20.5, 1996: 20.5, 1997: 20.0, 1998: 20.5, 1999: 20.5,
  2000: 20.5, 2001: 20.5, 2002: 21.0, 2003: 20.5, 2004: 21.5,
  2005: 20.5, 2006: 20.5, 2007: 21.5, 2008: 22.0, 2009: 21.5,
  2010: 22.0, 2011: 22.0, 2012: 22.5, 2013: 23.5, 2014: 22.5,
  2015: 22.5, 2016: 22.5, 2017: 21.5, 2018: 23.5, 2019: 22.5,
  2020: 24.5, 2021: 22.5, 2022: 21.5, 2023: 21.5, 2024: 22.0,
};

// Approx-normal noise (Box-Muller) and a plausible-score rounder (avoids impossible 1-point games)
const gaussNoise = (rand = Math.random) => {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const plausibleScore = (x) => { const r = Math.max(0, Math.round(x)); return r === 1 ? 2 : r; };

// Simulate a 17-game season against random defenses from the chosen year
const simulateSeason = (roster, year) => {
  const off = calculateOffensivePF(roster);
  const xPF = off.pf;
  const yearDefs = YEAR_DEFENSES[year] || [];
  const leagueAvg = LEAGUE_AVG_PA[year] || 21;

  // Ball-control: a dominant rushing attack eats clock and limits opponent possessions
  const clockFactor = 1 - clampN((off.rushY - 110) / 110, 0, 0.12);

  // Draw 17 opponents (without replacement, refilling if the year has < 17 teams)
  const opponents = [];
  const pool = [...yearDefs];
  for (let i = 0; i < 17; i++) {
    if (pool.length === 0) pool.push(...yearDefs);
    const idx = Math.floor(Math.random() * pool.length);
    opponents.push(pool.splice(idx, 1)[0]);
  }

  let wins = 0, losses = 0, ties = 0;
  let totalPF = 0, totalPA = 0;
  const games = [];

  opponents.forEach((opp, i) => {
    const [oppTeam, oppPA, oppPF] = opp;

    // Your scoring: your baseline scaled by how the opponent's defense compares to its league.
    // oppPA > leagueAvg  → worse defense → you score MORE.  (corrected direction, compressed)
    const defFactor = Math.pow(oppPA / leagueAvg, 0.6);
    const yourScore = plausibleScore(xPF * defFactor + gaussNoise() * 8.0);

    // Opponent scoring: their actual offense, lightly suppressed by your time-of-possession edge.
    const oppScore = plausibleScore(oppPF * clockFactor + gaussNoise() * 8.0);

    if (yourScore > oppScore) wins++;
    else if (yourScore < oppScore) losses++;
    else ties++;

    totalPF += yourScore;
    totalPA += oppScore;
    games.push({ week: i + 1, opp: oppTeam, yourScore, oppScore, result: yourScore > oppScore ? 'W' : yourScore < oppScore ? 'L' : 'T' });
  });

  return {
    wins,
    losses,
    ties,
    year,
    pf: (totalPF / 17).toFixed(1),
    pa: (totalPA / 17).toFixed(1),
    diff: ((totalPF - totalPA) / 17).toFixed(1),
    pfSeason: totalPF,
    paSeason: totalPA,
    games,
    offense: off,
  };
};

// ============================================================
// BEAT THE BEASTS — DEFENSE ENGINE
// ============================================================

// League-average defensive production by decade, used to era-normalize the
// Beasts the same way ERA_BASE normalizes offenses. Per-player-season approximations.
const DEF_ERA_BASE = {
  '1960s': { sk: 6.0, int: 3.5, ff: 1.2, fr: 1.5, imp: 78 },
  '1970s': { sk: 7.0, int: 3.2, ff: 1.3, fr: 1.6, imp: 78 },
  '1980s': { sk: 7.5, int: 2.8, ff: 1.6, fr: 1.4, imp: 78 },
  '1990s': { sk: 7.5, int: 2.6, ff: 1.8, fr: 1.3, imp: 78 },
  '2000s': { sk: 7.0, int: 2.4, ff: 1.8, fr: 1.2, imp: 78 },
  '2010s': { sk: 7.0, int: 2.2, ff: 1.8, fr: 1.0, imp: 78 },
  '2020s': { sk: 7.0, int: 2.0, ff: 1.8, fr: 1.0, imp: 78 },
};

// Assemble an 11-man cross-era Beasts defense: 4 DL, 3 LB, 4 DB.
// DL skews to a realistic DE/DT mix; DB to a CB/S mix. Players are drawn
// from across all decades, weighted toward higher-impact greats but not
// purely top-down (so you don't always face the same 11).
const assembleBeastsOnce = () => {
  const byPos = { DE: [], DT: [], LB: [], CB: [], S: [] };
  DEFENSE.forEach((p, idx) => { if (byPos[p.p]) byPos[p.p].push({ ...p, idx }); });

  // Weighted random pick: probability scales with impact^3 so stars appear
  // more often, but role players still slip in. No duplicates (by name).
  const used = new Set();
  const pickWeighted = (pool) => {
    const avail = pool.filter(p => !used.has(p.n));
    if (avail.length === 0) return null;
    const weights = avail.map(p => Math.pow(Math.max(1, p.imp - 70), 3) + 1);
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < avail.length; i++) {
      r -= weights[i];
      if (r <= 0) { used.add(avail[i].n); return avail[i]; }
    }
    used.add(avail[avail.length - 1].n);
    return avail[avail.length - 1];
  };

  const beasts = [];
  // Fixed NFL-style formation: 2 DE, 2 DT, 3 LB, 2 CB, 2 S.
  // Each beast gets `slot` (DL/LB/DB group) for the rating engine and `role`
  // (DE/DT/CB/S/LB plus MLB for the middle linebacker) for field positioning.
  const take = (pos, slot) => { const p = pickWeighted(byPos[pos]) || pickWeighted(byPos[pos === 'DE' ? 'DT' : pos === 'DT' ? 'DE' : pos === 'CB' ? 'S' : 'CB']); if (p) beasts.push({ ...p, slot, role: p.p }); };

  take('DE', 'DL'); take('DT', 'DL'); take('DT', 'DL'); take('DE', 'DL'); // line order: DE DT DT DE
  take('LB', 'LB'); take('LB', 'LB'); take('LB', 'LB');                    // 3 linebackers
  take('CB', 'DB'); take('S', 'DB'); take('S', 'DB'); take('CB', 'DB');    // 2 CB, 2 S

  return beasts;
};

// Rate the assembled defense into per-game allowed-points and a 0-99 rating.
// Pulls apart pass rush (sacks), coverage (INT/PD from DBs+LBs), and overall
// impact, era-normalized, then maps to points allowed per game.
const rateBeasts = (beasts) => {
  let rushIdx = 0, covIdx = 0, impSum = 0, n = 0;
  let totSacks = 0, totINT = 0, totFF = 0;

  beasts.forEach(p => {
    const b = DEF_ERA_BASE[p.d] || DEF_ERA_BASE['2010s'];
    const sk = p.s.sk || 0;
    const intc = p.s.int || 0;
    const ff = p.s.ff || 0;
    // Per-decade career counting stats are normalized to a per-season-ish rate
    // by leaning on impact as the primary signal and counting stats as texture.
    const skRate = sk / (b.sk * 8);    // ~8 prime seasons baseline
    const intRate = intc / (b.int * 8);
    rushIdx += (p.slot === 'DL' || p.p === 'LB') ? (0.5 + 0.5 * Math.min(2.5, skRate)) : 0.15;
    covIdx  += (p.slot === 'DB' || p.p === 'LB') ? (0.5 + 0.5 * Math.min(2.5, intRate)) : 0.1;
    impSum += p.imp;
    n++;
    totSacks += sk; totINT += intc; totFF += ff;
  });

  const avgImp = impSum / Math.max(1, n);                 // ~78 avg .. 99 elite
  const rush = rushIdx / Math.max(1, n);                  // pass-rush index
  const cov  = covIdx / Math.max(1, n);                   // coverage index

  // Defensive rating tracks the players' own impact numbers — a unit of 80+
  // guys rates ~80+. Rush & coverage balance nudge it a few points either way.
  const rating = clampN(Math.round(avgImp + (rush - 0.85) * 10 + (cov - 0.75) * 7), 40, 99);

  // Points allowed per game: rating ~95 ≈ 11 PA, ~85 ≈ 15, ~78 ≈ 17.5,
  // ~70 ≈ 20, weak (~55) ≈ 25. Concave so elite units separate.
  const basePA = clampN(25 - (rating - 55) * (14 / 40), 9.5, 28);

  return {
    rating,
    basePA,
    rushIndex: rush,
    covIndex: cov,
    avgImp,
    sackPressure: clampN(0.6 + (rush - 0.7) * 1.4, 0.55, 1.85), // multiplier on offense sacks-allowed
    takeawayRate: clampN(0.05 + (cov - 0.6) * 0.12, 0.04, 0.22), // chance to force a turnover-ish drag
  };
};

// The Beasts are always an elite unit (88+ rating). We don't inflate anyone's
// stats — instead we keep rolling real lineups until the assembled group rates
// 88 or better, then return it. The pool is deep enough that this converges in
// a handful of tries; a generous cap keeps the best attempt as a safeguard.
const assembleBeasts = () => {
  let best = null, bestRating = -1;
  for (let attempt = 0; attempt < 60; attempt++) {
    const beasts = assembleBeastsOnce();
    const rating = rateBeasts(beasts).rating;
    if (rating > bestRating) { bestRating = rating; best = beasts; }
    if (rating >= 88) return beasts;
  }
  return best; // safeguard: return the strongest lineup found (effectively always 88+)
};

// ============================================================
// DAILY CHALLENGE — deterministic, same for everyone (Wordle-style)
// Everything is seeded from the calendar date, so the Beasts defense and the
// exact team+decade draft sequence are identical for every player that day.
// ============================================================

// Mulberry32: tiny, fast, deterministic PRNG. Same seed -> same stream.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stable integer seed from a YYYY-MM-DD string.
function seedFromDate(dateStr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < dateStr.length; i++) {
    h ^= dateStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Local calendar date as YYYY-MM-DD (so the daily flips at the player's midnight).
function todayKey(d) {
  const dt = d || new Date();
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Seeded Beasts assembly — identical logic to assembleBeastsOnce but draws from
// an injected rng, and seeded re-rolls to clear the 88+ bar.
function assembleBeastsSeeded(rng) {
  const buildOnce = () => {
    const byPos = { DE: [], DT: [], LB: [], CB: [], S: [] };
    DEFENSE.forEach((p, idx) => { if (byPos[p.p]) byPos[p.p].push({ ...p, idx }); });
    const used = new Set();
    const pickWeighted = (pool) => {
      const avail = pool.filter(p => !used.has(p.n));
      if (avail.length === 0) return null;
      const weights = avail.map(p => Math.pow(Math.max(1, p.imp - 70), 3) + 1);
      const total = weights.reduce((a, b) => a + b, 0);
      let r = rng() * total;
      for (let i = 0; i < avail.length; i++) {
        r -= weights[i];
        if (r <= 0) { used.add(avail[i].n); return avail[i]; }
      }
      used.add(avail[avail.length - 1].n);
      return avail[avail.length - 1];
    };
    const beasts = [];
    const take = (pos, slot) => { const p = pickWeighted(byPos[pos]) || pickWeighted(byPos[pos === 'DE' ? 'DT' : pos === 'DT' ? 'DE' : pos === 'CB' ? 'S' : 'CB']); if (p) beasts.push({ ...p, slot, role: p.p }); };
    take('DE', 'DL'); take('DT', 'DL'); take('DT', 'DL'); take('DE', 'DL');
    take('LB', 'LB'); take('LB', 'LB'); take('LB', 'LB');
    take('CB', 'DB'); take('S', 'DB'); take('S', 'DB'); take('CB', 'DB');
    return beasts;
  };
  let best = null, bestRating = -1;
  for (let attempt = 0; attempt < 60; attempt++) {
    const beasts = buildOnce();
    const rating = rateBeasts(beasts).rating;
    if (rating > bestRating) { bestRating = rating; best = beasts; }
    if (rating >= 88) return beasts;
  }
  return best;
}

// Precompute the daily's fixed draft sequence: one {t,d} pair per round, drawn
// deterministically, respecting the same rules as live play (no dup team+decade,
// at most one 1970s entry). Returned in slot order.
function buildDailySequence(rng) {
  // Build the full universe of valid team+decade pairs that have draftable players.
  const pairSet = new Map();
  const note = (t, d) => { const k = t + '|' + d; if (!pairSet.has(k)) pairSet.set(k, { t, d }); };
  PLAYERS.forEach(p => { if (p.p !== 'OL') note(p.t, p.d); });
  UNITS.forEach(u => { if (u.p === 'OL') note(u.t, u.d); });
  const allPairs = Array.from(pairSet.values());

  const seq = [];
  const usedPairs = new Set();
  let has70s = false;
  for (let round = 0; round < SLOT_ORDER.length; round++) {
    let pool = allPairs.filter(p => {
      if (usedPairs.has(p.t + '|' + p.d)) return false;
      if (has70s && p.d === '1970s') return false;
      return true;
    });
    if (pool.length === 0) pool = allPairs;
    const pick = pool[Math.floor(rng() * pool.length)];
    seq.push({ t: pick.t, d: pick.d });
    usedPairs.add(pick.t + '|' + pick.d);
    if (pick.d === '1970s') has70s = true;
  }
  return seq;
}

// For the daily, compute the "perfect team": the single best pick available at
// each round, given that round's fixed slot + team + decade. Best = highest
// impact (the same signal the sim weights), respecting no duplicate player.
// The "perfect team" is the best roster achievable across the 9 rounds. Each
// round presents a team+decade pool and the player may slot ANY open position
// from it — so this is an assignment problem: match each round to one roster
// slot, taking the best player that round's pool offers for that slot, to
// maximize total roster quality. (e.g. if round 9's pool has the best QB of any
// round, the QB slot is filled from round 9.) Pools are distinct team+decades
// with no name overlap, so no player can be picked twice.
function computePerfectTeam(sequence) {
  const posOf = (s) => s === 'OL' ? 'OL' : s.startsWith('WR') ? 'WR' : s.startsWith('RB') ? 'RB' : s.startsWith('TE') ? 'TE' : s;
  const N = SLOT_ORDER.length;

  // best[round][slot] = best player (by impact) that round's pool offers for slot.
  const best = [];
  for (let r = 0; r < N; r++) {
    const { t, d } = sequence[r];
    best[r] = [];
    for (let sIdx = 0; sIdx < N; sIdx++) {
      const pos = posOf(SLOT_ORDER[sIdx]);
      let pool;
      if (pos === 'OL') pool = UNITS.filter(u => u.p === 'OL' && u.t === t && u.d === d);
      else pool = PLAYERS.filter(p => p.p === pos && p.t === t && p.d === d);
      let top = null;
      for (const p of pool) if (!top || p.imp > top.imp) top = p;
      best[r][sIdx] = top; // may be null if pool has nobody for that slot's position
    }
  }

  // Maximize total impact over all round->slot matchings. N=9, so we solve with
  // memoized DP over the bitmask of filled slots, iterating rounds in order.
  const memo = new Map();
  const solve = (round, usedMask) => {
    if (round === N) return { score: 0, picks: [] };
    const key = round * 1024 + usedMask;
    if (memo.has(key)) return memo.get(key);
    let bestRes = { score: -Infinity, picks: [] };
    for (let sIdx = 0; sIdx < N; sIdx++) {
      if (usedMask & (1 << sIdx)) continue;
      const player = best[round][sIdx];
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
  // Materialize into slot order: slot -> { player, and which round/team+era it came from }
  const bySlot = {};
  result.picks.forEach(({ round, sIdx, player }) => {
    const { t, d } = sequence[round];
    bySlot[SLOT_ORDER[sIdx]] = { slot: SLOT_ORDER[sIdx], t, d, player, round };
  });
  return SLOT_ORDER.map(slot => bySlot[slot] || { slot, t: null, d: null, player: null, round: -1 });
}

// The top-N lineups for the day. Slots are effectively independent in the sim,
// so a lineup's strength is the sum of its players' impact. We rank each slot's
// candidates by impact, then enumerate the highest-impact-sum combinations.
// Returns an array of lineups; each lineup is a map { slot: playerName }.
// These (the strongest fraction of all 226k+ combos) get a guaranteed win.
function computeTopLineups(sequence, topN) {
  // Start from the optimal assignment (the perfect team), then generate the
  // strongest variations by substituting the next-best player at one slot at a
  // time. Each lineup is returned as a set of player names (order-independent),
  // since the player assembles freely across rounds.
  const perfect = computePerfectTeam(sequence);

  // For each slot in the perfect team, the ranked candidate list from the round
  // it was drawn from (so we can compute realistic single-slot downgrades).
  const posOf = (s) => s === 'OL' ? 'OL' : s.startsWith('WR') ? 'WR' : s.startsWith('RB') ? 'RB' : s.startsWith('TE') ? 'TE' : s;
  const slotInfo = perfect.map(pick => {
    if (!pick.player) return { slot: pick.slot, cands: [] };
    const pos = posOf(pick.slot);
    const pool = (pos === 'OL'
      ? UNITS.filter(u => u.p === 'OL' && u.t === pick.t && u.d === pick.d)
      : PLAYERS.filter(p => p.p === pos && p.t === pick.t && p.d === pick.d)
    ).sort((a, b) => b.imp - a.imp);
    return { slot: pick.slot, cands: pool };
  });

  const baseNames = {};
  perfect.forEach(pick => { if (pick.player) baseNames[pick.slot] = pick.player.n; });

  // Best-first over per-slot candidate indices (0 = perfect pick), maximizing
  // total impact, to enumerate the strongest distinct rosters.
  const start = slotInfo.map(() => 0);
  const keyOf = (idx) => idx.join(',');
  const sumOf = (idx) => idx.reduce((acc, ci, si) => acc + (slotInfo[si].cands[ci] ? slotInfo[si].cands[ci].imp : 0), 0);
  const visited = new Set([keyOf(start)]);
  let frontier = [{ idx: start, sum: sumOf(start) }];
  const results = [];

  while (results.length < topN && frontier.length) {
    frontier.sort((a, b) => b.sum - a.sum);
    const cur = frontier.shift();
    const lineup = {};
    let ok = true;
    cur.idx.forEach((ci, si) => {
      const c = slotInfo[si].cands[ci];
      if (!c) ok = false; else lineup[slotInfo[si].slot] = c.n;
    });
    if (ok) results.push(lineup);
    cur.idx.forEach((ci, si) => {
      if (ci + 1 < slotInfo[si].cands.length) {
        const nidx = cur.idx.slice();
        nidx[si] = ci + 1;
        const k = keyOf(nidx);
        if (!visited.has(k)) { visited.add(k); frontier.push({ idx: nidx, sum: sumOf(nidx) }); }
      }
    });
  }
  return results;
}

// Assemble the full daily challenge for a given date key.
function getDailyChallenge(dateKey) {
  const seed = seedFromDate(dateKey);
  // Two independent streams so defense and sequence don't correlate.
  const beasts = assembleBeastsSeeded(makeRng(seed ^ 0x9e3779b9));
  const sequence = buildDailySequence(makeRng(seed ^ 0x85ebca6b));
  const perfect = computePerfectTeam(sequence);
  const topLineups = computeTopLineups(sequence, 10);
  // Pool-matched difficulty: diffAdj is a HANDICAP SUBTRACTED from the Beasts'
  // effective rating in simulateBeatdown (higher diffAdj => weaker Beasts =>
  // EASIER). It lets a perfectly drafted team stay a strong favorite even when
  // the day's pool is weak in absolute all-time terms. The 16.3 constant is the
  // original tuning; raising avgImp (a stronger pool) lowers diffAdj, which
  // makes the day HARDER, so the pool buff did not require a recalibration here.
  const imps = perfect.map(pk => (pk && pk.player && pk.player.imp) || 75);
  const avgImp = imps.reduce((a, b) => a + b, 0) / imps.length;
  const beastRating = rateBeasts(beasts).rating;
  const diffAdj = Math.max(0, Math.min(20, beastRating - (0.68 * avgImp + 16.3)));
  return { dateKey, beasts, sequence, perfect, topLineups, diffAdj };
}



// ============================================================
// BEAT THE BEASTS — SINGLE-GAME SIMULATION
// ============================================================
const ratio = (raw, base) => (base > 0 ? raw / base : 1);

// Offensive player ability ratings (0-100), era-adjusted. Each returns a small
// object of the sub-skills the drive engine reads.
const rateOffense = (roster) => {
  const eb = (d) => ERA_BASE[d] || ERA_BASE['2010s'];

  // QB: arm (yards), accuracy/decision (rating + low INT), explosiveness (TD)
  const qb = roster.QB;
  const qbB = eb(qb.d);
  const QB = {
    name: qb.n, team: qb.t, dec: qb.d, imp: qb.imp,
    arm: clampN(66 + (ratio(qb.s.y, qbB.passY) - 1) * 40 + (qb.imp - 72) * 0.8, 35, 97),
    acc: clampN(66 + (qb.s.r - qbB.rate) * 0.5 + (qb.imp - 72) * 0.8, 35, 97),
    care: clampN(66 + (qbB.int - qb.s.i) * 20 + (qb.imp - 72) * 0.5, 35, 97), // ball security
    explos: clampN(66 + (ratio(qb.s.t, qbB.passTD) - 1) * 38 + (qb.imp - 72) * 0.8, 35, 97),
    // Mobility from real rushing yds/game (s.ry): Lamar/Vick ~97, statues ~45.
    legs: clampN(38 + (qb.s.ry || 6) * 1.0 + (qb.imp - 72) * 0.25, 30, 97),
  };

  // RBs: power/elusiveness (YPC), volume (yards), receiving, scoring
  const mkRB = (rb) => {
    if (!rb) return null;
    const b = eb(rb.d);
    return {
      name: rb.n, team: rb.t, dec: rb.d, imp: rb.imp,
      power: clampN(66 + ((rb.s.c || 4.0) - 4.0) * 16 + (rb.imp - 72) * 0.7, 35, 97),
      vol: clampN(66 + (ratio(rb.s.y, b.rbY) - 1) * 36 + (rb.imp - 72) * 0.8, 35, 97),
      recv: clampN(56 + (rb.s.r || 0) * 1.3 + (rb.imp - 72) * 0.3, 25, 97),
      score: clampN(66 + (ratio(rb.s.t, b.rbTD) - 1) * 34, 35, 97),
    };
  };
  const RB1 = mkRB(roster.RB);
  const RB2 = mkRB(roster.RB2);

  // Receivers (WR/TE): separation (catch% + yds/target), big-play (yds), hands, scoring
  const mkREC = (r, isTE) => {
    if (!r) return null;
    const b = eb(r.d);
    const recYBase = isTE ? b.recY * 0.72 : b.recY;
    return {
      name: r.n, team: r.t, dec: r.d, imp: r.imp, isTE: !!isTE,
      sep: clampN(66 + ((r.s.c || 58) - 58) * 0.7 + ((r.s.p || 8) - 8) * 3 + (r.imp - 72) * 0.55, 35, 97),
      big: clampN(66 + (ratio(r.s.y, recYBase) - 1) * 36 + (r.imp - 72) * 0.8, 35, 97),
      hands: clampN(63 + ((r.s.c || 58) - 58) * 1.0 + (r.imp - 72) * 0.4, 30, 97),
      score: clampN(66 + (ratio(r.s.t, b.recTD) - 1) * 32, 35, 97),
      block: isTE ? clampN((r.s.b || 60), 25, 97) : 45,
    };
  };
  // Re-rank receivers by ability, NOT draft order, so the best WR lines up as
  // WR1 (and draws the top corner), the best TE as TE. A receiving-quality score
  // blends separation, big-play, hands, scoring, and overall impact.
  const recQuality = (r) => r ? (r.big * 0.30 + r.sep * 0.26 + r.hands * 0.14 + r.score * 0.12 + r.imp * 0.18) : -1;
  const wrs = [mkREC(roster.WR1), mkREC(roster.WR2), mkREC(roster.WR3)]
    .filter(Boolean)
    .sort((a, b) => recQuality(b) - recQuality(a));
  const tes = [mkREC(roster.TE, true), mkREC(roster.TE2, true)]
    .filter(Boolean)
    .sort((a, b) => recQuality(b) - recQuality(a));
  const WR1 = wrs[0] || null;
  const WR2 = wrs[1] || null;
  const WR3 = wrs[2] || null;
  const TE  = tes[0] || null;
  const TE2 = tes[1] || null;

  // O-line: pass protection and run blocking (0-100), scaled to compete with
  // elite defensive fronts (which average ~85-90).
  const oS = roster.OL.s || { ry: 130, sa: 2.2, pb: 80, pbl: 2 };
  const OL = {
    name: roster.OL.n, team: roster.OL.t, dec: roster.OL.d, imp: roster.OL.imp,
    pass: clampN(70 + (oS.pb - 80) * 1.1 - (oS.sa - 2.2) * 7 + (oS.pbl || 0) * 2.2 + (roster.OL.imp - 72) * 0.5, 38, 96),
    run:  clampN(68 + ((oS.ry || 120) - 120) * 0.34 + (oS.pbl || 0) * 1.9 + (roster.OL.imp - 72) * 0.8, 38, 96),
  };

  return { QB, RB1, RB2, WR1, WR2, WR3, TE, TE2, OL };
};

// Defender ability ratings (0-100), era-adjusted, by role.
const rateDefenders = (beasts) => {
  const eb = (d) => DEF_ERA_BASE[d] || DEF_ERA_BASE['2010s'];
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

// Sort helpers to find the "best" defender of a role for 1-on-1 assignment.
const bestBy = (arr, key) => [...arr].sort((a, b) => b[key] - a[key]);

// ---------- the matchup map ----------
// Assign coverage 1-on-1s: WR1 vs top CB, WR2 vs 2nd CB, slot/TE vs S/LB.
const buildMatchups = (off, defenders) => {
  const CBs = bestBy(defenders.filter(d => d.role === 'CB'), 'cover');
  const Ss  = bestBy(defenders.filter(d => d.role === 'S'), 'cover');
  const LBs = bestBy(defenders.filter(d => d.role === 'LB' || d.role === 'MLB'), 'cover');
  const DL  = defenders.filter(d => d.role === 'DE' || d.role === 'DT');

  const cov = [];
  const assignCov = (rec, defender, slot) => { if (rec && defender) cov.push({ rec, defender, slot }); };
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

  // Run front vs run blocking: anchored by the interior + best run stuffer, so
  // an all-time front (great DTs/MLB) genuinely walls off the run.
  const front = [...DL, ...LBs];
  const runAvg = front.reduce((s, d) => s + d.runD, 0) / Math.max(1, front.length);
  const topRunD = Math.max(...front.map(d => d.runD), 0);
  const runFront = 0.62 * runAvg + 0.38 * topRunD;

  return { cov, passRush, runFront, defenders, CBs, Ss, LBs, DL };
};

// ---------- drive-by-drive simulation ----------
const NUM_DRIVES = 10; // offensive possessions in a typical game

// Deterministic matchup seed: the exact same drafted lineup against the exact
// same Beasts defense always plays out the exact same game — every matchup is
// still simulated play by play, but the dice are fixed by the matchup itself.
const matchupSeed = (roster, beasts) => {
  const rosterKey = SLOT_ORDER.map(s => { const p = roster[s]; return p ? p.n + '|' + p.t + '|' + p.d : '-'; }).join('~');
  const beastKey = (beasts || []).map(b => b.n + '|' + b.t + '|' + b.d).join('~');
  const str = rosterKey + '##' + beastKey;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

const simulateBeatdown = (roster, beasts, forceWin = false, diffAdj = 0) => {
  const rng = makeRng(matchupSeed(roster, beasts));
  // diffAdj (daily mode): grades the game on the curve of the day's draft
  // pool. The Beasts play to an EFFECTIVE rating reduced by diffAdj so that a
  // perfectly drafted pool team is a strong favorite even when the pool is
  // weak in absolute all-time terms. Classic mode passes 0 (full strength).
  const off = rateOffense(roster);
  const defenders = rateDefenders(beasts);
  const M = buildMatchups(off, defenders);
  const era = ERA_BASE[off.QB.dec] || ERA_BASE['2010s'];
  const defR = rateBeasts(beasts);
  // Defense tax: how much an elite unit suppresses yards on every play.
  // rating 70 ≈ 0, rating 90 ≈ strong drag. Keeps great Ds dominant.
  const effRating = defR.rating - clampN(diffAdj, 0, 20);
  const defTax = clampN((effRating - 71) * 0.15, 0, 4.2);

  // ---- box score accumulators ----
  const box = {
    pass: { name: off.QB.name, team: off.QB.team, dec: off.QB.dec, cmp: 0, att: 0, yds: 0, td: 0, int: 0 },
    qbRush: { att: 0, yds: 0 },
    rush: {}, // by player name
    rec: {},  // by player name
    def: {},  // by player name: { tk, sk, int }
  };
  const initRush = (p) => { if (p && !box.rush[p.name]) box.rush[p.name] = { name: p.name, team: p.team, dec: p.dec, car: 0, yds: 0, td: 0, long: 0 }; };
  const initRec = (p) => { if (p && !box.rec[p.name]) box.rec[p.name] = { name: p.name, team: p.team, dec: p.dec, tgt: 0, rec: 0, yds: 0, td: 0, long: 0 }; };
  initRush(off.RB1); initRush(off.RB2);
  [off.WR1, off.WR2, off.WR3, off.TE, off.TE2].forEach(initRec);
  defenders.forEach(d => { box.def[d.n] = { name: d.n, role: d.role, team: d.t, dec: d.d, tk: 0, sk: 0, int: 0 }; });

  // Receiver target shares. Start from a slot baseline, then bias heavily toward
  // the most talented receivers — real offenses scheme their best player the ball
  // no matter where he lines up, so a stud at WR3 still eats.
  const rawReceivers = [
    { p: off.WR1, m: M.cov.find(c => c.slot === 'WR1'), slotBase: 0.24 },
    { p: off.WR2, m: M.cov.find(c => c.slot === 'WR2'), slotBase: 0.19 },
    { p: off.WR3, m: M.cov.find(c => c.slot === 'WR3'), slotBase: 0.13 },
    { p: off.TE,  m: M.cov.find(c => c.slot === 'TE'),  slotBase: 0.16 },
    { p: off.TE2, m: M.cov.find(c => c.slot === 'TE2'), slotBase: 0.07 },
  ].filter(r => r.p);
  // Talent score per receiver (their ceiling as a pass-catcher).
  rawReceivers.forEach(r => { r.talent = (r.p.big * 0.55 + r.p.sep * 0.45); });
  const avgTalent = rawReceivers.reduce((s, r) => s + r.talent, 0) / rawReceivers.length;
  // Blend slot role (40%) with talent-driven share (60%). Elite players pull a
  // disproportionate share via an exponential talent weight.
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
  const tackler = () => {
    // Weighted by tackle rating — front-seven & safeties make most tackles.
    const pool = defenders;
    const weights = pool.map(d => d.tackle + (d.role === 'LB' || d.role === 'MLB' ? 25 : d.role === 'S' ? 12 : d.role === 'DT' ? 8 : 5));
    const tot = weights.reduce((a, b) => a + b, 0);
    let r = rng() * tot;
    for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  };

  const runPlay = () => {
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
      // Tighter noise + heavier skill weighting: outcomes track roster quality
      // more reliably, with less per-play luck.
      yds = 3.9 + edge * 0.06 - defTax * 0.42 + gaussNoise(rng) * 2.3;
      if (rng() < 0.012 + Math.max(0, rb.power - 72) * 0.0016) yds += 9 + rng() * 19; // breakaway (rating-driven)
    }
    yds = Math.max(-6, Math.round(yds));
    const t = tackler();
    box.def[t.n].tk += 1;
    box.rush[rb.name].car += 1;
    box.rush[rb.name].yds += yds;
    box.rush[rb.name].long = Math.max(box.rush[rb.name].long, yds);
    // Fumble chance — higher on big hits by an elite front; the defender who
    // made the tackle gets credit for the forced takeaway.
    const fumbleP = clampN(0.012 + defTax * 0.004, 0.008, 0.03);
    if (rng() < fumbleP) {
      box.def[t.n].ff = (box.def[t.n].ff || 0) + 1;
      return { yards: yds, rb, turnover: true, fumble: true, forcedBy: t };
    }
    return { yards: yds, rb };
  };

  const passPlay = (toGo = 10) => {
    // QB scramble — mobile QBs tuck and run. Frequency and yardage scale with
    // the legs rating (real rushing yds/game), so Lamar and Vick break runs
    // while pocket statues almost never do. No INT risk on a scramble.
    if (rng() < 0.035 + Math.max(0, off.QB.legs - 55) * 0.0022) {
      let yds = 3.5 + (off.QB.legs - 50) * 0.10 + gaussNoise(rng) * 2.2;
      if (rng() < 0.008 + Math.max(0, off.QB.legs - 75) * 0.0015) yds += 8 + rng() * 14; // breaks contain
      yds = Math.max(-2, Math.round(yds));
      box.qbRush.att += 1; box.qbRush.yds += yds;
      const t = tackler(); if (t) box.def[t.n].tk += 1;
      return { yards: yds, scramble: true };
    }
    box.pass.att += 1;
    // Protection battle: OL pass vs pass rush. Sacks ~2-3/game; elite fronts get more.
    const protect = off.OL.pass - M.passRush + gaussNoise(rng) * 10;
    const sacked = protect < -28 || (rng() < clampN(0.05 - protect * 0.004, 0.015, 0.22));
    if (sacked) {
      // Credit a sack to a pass rusher (weighted by rush rating)
      const rushers = M.DL.length ? M.DL : defenders;
      const w = rushers.map(d => Math.pow(d.rush, 2));
      const tot = w.reduce((a, b) => a + b, 0);
      let r = rng() * tot, who = rushers[0];
      for (let i = 0; i < rushers.length; i++) { r -= w[i]; if (r <= 0) { who = rushers[i]; break; } }
      box.def[who.n].sk += 1;
      box.def[who.n].tk += 1;
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
    let target;
    if (rbCheck) {
      target = { p: off.RB1, m: null, rb: true };
    } else {
      const tot = weighted.reduce((a, b) => a + b.w, 0);
      let r = rng() * tot; target = weighted[0];
      for (const wj of weighted) { r -= wj.w; if (r <= 0) { target = wj; break; } }
    }

    const rec = target.p;
    if (!box.rec[rec.name]) box.rec[rec.name] = { name: rec.name, team: rec.team, dec: rec.dec, tgt: 0, rec: 0, yds: 0, td: 0, long: 0 };
    box.rec[rec.name].tgt += 1;

    const cover = target.m ? target.m.defender : null;
    const covRating = cover ? cover.cover : 52;
    // Completion probability — anchored near the ~64% league average. Elite
    // coverage lowers it, but realistic QBs still complete most short throws.
    const sepEdge = (rec.sep || 55) - covRating;
    let compP = 0.73 + (off.QB.acc - 65) * 0.0045 + sepEdge * 0.0030 - defTax * 0.009;
    if (pressured) compP -= 0.15;
    if (toGo >= 8) compP -= 0.05;   // 3rd-and-long is harder through the air
    compP = clampN(compP, 0.42, 0.82);

    // Interception chance: QB care (low = risky) + strong coverage.
    // Interception chance. Elite ball-security QBs (high care) throw far fewer
    // picks; reckless ones throw more. Coverage winning its matchup adds risk.
    let intP = 0.017 + Math.max(0, covRating - (rec.sep || 55)) * 0.0007 + (72 - off.QB.care) * 0.0010;
    if (pressured) intP += 0.012;
    intP = clampN(intP, 0.004, 0.060);

    const roll = rng();
    if (roll < intP) {
      box.pass.int += 1;
      let pick = cover;
      if (!pick) { const dbs = bestBy(defenders.filter(d => d.role === 'CB' || d.role === 'S'), 'cover'); pick = dbs[0]; }
      if (pick) { box.def[pick.n].int += 1; }
      return { yards: 0, turnover: true, int: true, pick };
    }
    if (roll < intP + (1 - compP)) {
      return { yards: 0, incomplete: true };
    }

    // Completion — yards from receiver big-play vs coverage + QB arm.
    // Calibrated to ~11-12 yards/completion league average.
    box.pass.cmp += 1;
    box.rec[rec.name].rec += 1;
    let yds = 6.55 + ((rec.big || 55) - covRating) * 0.13 + (off.QB.arm - 65) * 0.042 - defTax * 0.56 + gaussNoise(rng) * 3.2;
    if (rng() < 0.020 + Math.max(0, (rec.big || 55) - 76) * 0.0034) yds += 11 + rng() * 23; // explosive (rating-driven)
    yds = Math.max(0, Math.round(yds));
    box.pass.yds += yds;
    box.rec[rec.name].yds += yds;
    box.rec[rec.name].long = Math.max(box.rec[rec.name].long, yds);
    const t = tackler();
    box.def[t.n].tk += 1;
    return { yards: yds, rec, complete: true };
  };

  // ---- simulate one drive, returns points + how it ended ----
  const simDrive = (isOffense) => {
    if (!isOffense) return { pts: 0 };
    let yard = 25;          // own 25
    let down = 1, toGo = 10;
    let plays = 0;
    while (plays < 20) {
      plays++;
      // Play call: pass rate scales with era + down/distance
      // Play call: realistic run/pass balance. Lean pass on long/late downs,
      // run on early downs and short yardage. Era nudges the baseline.
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

      // Red-zone resistance: great defenses stiffen near the goal line, turning
      // would-be TDs into field goals. The closer you started and the better the
      // defense, the more likely the drive stalls short of the end zone.
      let gain = res.yards;
      if (yard + gain >= 100) {
        // Elite defenses bend-but-don't-break: red-zone TD rate falls sharply as
        // the Beasts' rating climbs, turning more would-be TDs into FGs. This is
        // the main lever that keeps the "greatest defense ever" to realistic scores.
        const scoreChance = clampN(0.70 - defTax * 0.075, 0.34, 0.76);
        if (rng() < scoreChance) {
          const tdYard = Math.round(100 - yard); // length of the scoring play
          if (res.rec) { box.rec[res.rec.name].td += 1; box.pass.td += 1;
            return { pts: 7, end: 'TD', yard: 100, event: { type: 'PASS_TD', passer: off.QB && off.QB.name, by: res.rec.name, team: res.rec.team, yard: tdYard } }; }
          else if (res.rb) { box.rush[res.rb.name].td += 1;
            return { pts: 7, end: 'TD', yard: 100, event: { type: 'RUSH_TD', by: res.rb.name, team: res.rb.team, yard: tdYard } }; }
          else if (isPass && res.complete) { box.pass.td += 1;
            return { pts: 7, end: 'TD', yard: 100, event: { type: 'PASS_TD', passer: off.QB && off.QB.name, by: (res.rec && res.rec.name) || null, team: res.rec && res.rec.team, yard: tdYard } }; }
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
          down = 4; toGo = toGo; // simulate one more play next loop by resetting to 4th
          // actually run a single conversion attempt inline
        }
        return { pts: 0, end: yard >= 50 ? 'DOWNS' : 'PUNT', yard };
      }
    }
    return { pts: 0, end: 'PUNT', yard };
  };

  // ---- run the game ----
  const drives = [];
  let yourScore = 0;
  for (let i = 0; i < NUM_DRIVES; i++) {
    const d = simDrive(true);
    yourScore += d.pts;
    drives.push({ n: i + 1, ...d });
  }

  // ---- build the cinematic play timeline ----
  // Each scoring play and turnover becomes an ordered event with a synthetic
  // game clock, so the post-game cinematic can play the story out in sequence.
  // This reads the data the sim already produced; it changes no outcomes.
  const cinematicEvents = [];
  let runScore = 0;
  drives.forEach((d, i) => {
    // Monotonic game clock: each drive consumes a steady slice of a 60-minute
    // game, so the clock always counts down in order no matter which drives
    // become shown events. Drive i runs from elapsed fraction i/N to (i+1)/N.
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
      cinematicEvents.push({ type: 'FG', by: TEAM_NAME, yard: Math.round((100 - d.yard) + 17), drive: d.n, q, clock, yourScore: runScore, pts: 3 });
    } else if (d.end === 'MISS') {
      cinematicEvents.push({ type: 'FG_MISS', by: TEAM_NAME, yard: Math.round((100 - d.yard) + 17), drive: d.n, q, clock, yourScore: runScore, pts: 0 });
    } else if (d.end === 'DOWNS') {
      cinematicEvents.push({ type: 'DOWNS', by: TEAM_NAME, drive: d.n, q, clock, yourScore: runScore, pts: 0 });
    }
  });

  // Beasts scoring. The Beasts are a complete team — their OFFENSE puts up a
  // realistic output (you have no defense to stop them), plus their elite
  // defense generates extra points off your turnovers (pick-sixes, short fields).
  const totINT = Object.values(box.def).reduce((s, d) => s + d.int, 0);
  const totSk = Object.values(box.def).reduce((s, d) => s + d.sk, 0);
  // Baseline team offense scales with the Beasts' rating, PLUS a shootout
  // component: when your offense lights up the scoreboard, it's a track meet and
  // the Beasts' all-time offense answers back. This keeps superteams honest
  // without burying mid-tier rosters (who don't trigger the shootout bonus).
  // Beasts team offense: a solid, realistic output (you have no defense), scaled
  // to their rating. They answer back somewhat in shootouts, but only modestly —
  // the Beasts are built to WIN ON DEFENSE, not to win a track meet. Keeping
  // their ceiling lower makes a 20-17 grind the texture of the game, not 45-43.
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

  // Daily perfect team: guarantee the win. If the player assembled the optimal
  // roster, they always beat the Beasts — bump the score above the Beasts if the
  // sim didn't already land there.
  if (forceWin && yourScore <= beastScore) {
    yourScore = beastScore + 3 + Math.round(rng() * 4);
  }

  const won = yourScore > beastScore;

  // ---- distribute the Beasts' score across the timeline (presentational) ----
  // The Beasts score is a single final number; to drive a running scoreboard in
  // the cinematic, we sprinkle their points across the game's timeline as a few
  // scoring "moments" interleaved with your events, ending exactly at beastScore.
  if (cinematicEvents.length > 0) {
    // Break beastScore into 7s and 3s (a plausible set of scoring plays).
    let remaining = beastScore;
    const chunks = [];
    while (remaining >= 7 && (remaining % 7 === 0 || remaining > 9)) { chunks.push(7); remaining -= 7; }
    while (remaining >= 3) { chunks.push(3); remaining -= 3; }
    if (remaining > 0) chunks.push(remaining);
    // Place each chunk at a sorted event index, then accrue forward so the tally
    // is strictly non-decreasing and lands exactly on beastScore at the end.
    const n = cinematicEvents.length;
    // Each chunk is shown as its OWN scene (one TD or FG per scene — never
    // condensed into "N quick points"). Chunks land at random event indices.
    const chunksAt = new Array(n).fill(null).map(() => []);
    chunks.forEach(c => { chunksAt[Math.floor(rng() * n)].push(c); });
    let beastRun = 0;
    let prevYour = 0;
    // Track the leader so scenes can call out lead changes as they happen.
    const leaderOf = (y, b) => (y > b ? 'C' : b > y ? 'B' : 'T');
    let leader = 'T';
    const merged = [];
    for (let i = 0; i < n; i++) {
      for (const delta of chunksAt[i]) {
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
          drive: cinematicEvents[i].drive,
          q: cinematicEvents[i].q,
          clock: cinematicEvents[i].clock,
          yourScore: prevYour,
          beastScore: beastRun + delta,
        });
        beastRun += delta;
      }
      cinematicEvents[i].beastScore = beastRun;
      {
        const newY = cinematicEvents[i].yourScore;
        const nl = leaderOf(newY, beastRun);
        // pre-event totals: the game's opening score is not a "lead change"
        cinematicEvents[i].leadChange = nl !== leader && nl !== 'T' && (prevYour + beastRun) > 0 && (cinematicEvents[i].pts || 0) > 0;
        leader = nl === 'T' ? leader : nl;
      }
      prevYour = cinematicEvents[i].yourScore;
      merged.push(cinematicEvents[i]);
    }
    cinematicEvents.length = 0;
    merged.forEach(e => cinematicEvents.push(e));
    // The tie-break/force-win steps above may have nudged the final Contenders
    // score after the per-event running totals were built; make the last event
    // reflect the true final so the closing scoreboard matches the result.
    cinematicEvents[cinematicEvents.length - 1].yourScore = yourScore;
    cinematicEvents[cinematicEvents.length - 1].beastScore = beastScore;
  }

  // ---- assemble box score arrays (filter zero-touch players) ----
  const rushArr = Object.values(box.rush).filter(r => r.car > 0).sort((a, b) => b.yds - a.yds);
  const recArr = Object.values(box.rec).filter(r => r.tgt > 0).sort((a, b) => b.yds - a.yds);
  const defArr = Object.values(box.def).sort((a, b) => (b.sk * 10 + b.int * 12 + b.tk) - (a.sk * 10 + a.int * 12 + a.tk));

  // ---- key matchup callouts ----
  // Winner reflects what ACTUALLY happened in the game (production), with the
  // rating margin as a tiebreaker — so the label never contradicts the box score.
  const matchupNotes = M.cov.map(c => {
    const sep = c.rec.sep, cov = c.defender.cover;
    const recStat = box.rec[c.rec.name] || { rec: 0, yds: 0, td: 0, tgt: 0 };
    const ratingMargin = sep - cov;
    // Production score: yards + TD bonus, scaled. A strong game = WR won.
    const prod = recStat.yds + recStat.td * 20;
    let won;
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
  let grade, gradeLabel;
  if (margin >= 21) { grade = 'A+'; gradeLabel = 'Total Domination'; }
  else if (margin >= 11) { grade = 'A'; gradeLabel = 'Statement Win'; }
  else if (margin >= 4) { grade = 'B'; gradeLabel = 'Solid Win'; }
  else if (margin >= 1) { grade = 'C'; gradeLabel = 'Nailbiter Win'; }
  else if (margin >= -10) { grade = 'L'; gradeLabel = 'Tough Loss'; }
  else { grade = 'L-'; gradeLabel = 'Beatdown'; }

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
      qbRating: roster.QB.s.r.toFixed(1),
    },
  };
};


// ============================================================
// COMPONENTS
// ============================================================

function Logo({ size = 'normal' }) {
  const small = size === 'small';
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="rounded-lg flex items-center justify-center font-black"
        style={{
          width: small ? 36 : 48,
          height: small ? 36 : 48,
          background: 'linear-gradient(135deg, #aaff00 0%, #7ecc00 100%)',
          color: '#08070f',
          fontSize: small ? 11 : 14,
          fontFamily: 'var(--font-display, ui-serif, Georgia, serif)',
          letterSpacing: '-0.04em',
        }}
      >
        BTB
      </div>
      <span
        className="tracking-tight"
        style={{
          color: C.text,
          fontFamily: 'var(--font-display, ui-serif, Georgia, serif)',
          fontSize: small ? 19 : 26,
          letterSpacing: '0.01em',
          textTransform: 'uppercase',
        }}
      >
        Beat the Beasts
      </span>
    </div>
  );
}

function Pill({ children, style, className = '' }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-widest border ${className}`}
      style={style}
    >
      {children}
    </span>
  );
}

function HomeScreen({ onSelectMode, onStartDaily, onStartLab, onShowHowTo, onOpenEditor }) {
  const [showDetails, setShowDetails] = useState(false);
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  return (
    <div className="min-h-screen flex flex-col relative" style={{ background: C.bg, color: C.text }}>
      <header className="w-full py-6 px-6 relative z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Logo />
          <div className="flex items-center gap-4">
            <button
              onClick={onShowHowTo}
              className="text-xs uppercase tracking-widest font-medium transition-opacity hover:opacity-100"
              style={{ color: C.textMuted, opacity: 0.7 }}
            >
              How to Play
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 relative z-10 -mt-8">
        <div className="text-center mb-10 max-w-xl">
          <h1
            className="mb-4"
            style={{
              fontFamily: 'var(--font-display, ui-serif, Georgia, serif)',
              fontSize: 'clamp(2.3rem, 7.5vw, 4.2rem)',
              letterSpacing: '0.01em',
              lineHeight: 1.05,
              textTransform: 'uppercase',
              color: C.text,
              textShadow: '0 0 24px rgba(0,229,255,0.35)',
            }}
          >
            Can you <span style={{ color: C.emerald, textShadow: '0 0 28px rgba(170,255,0,0.85), 0 0 8px rgba(170,255,0,0.6)' }}>Beat the Beasts</span>?
          </h1>
          <p className="text-base leading-relaxed" style={{ color: C.textMuted }}>
            Draft an all-time offense. Take on the greatest defense ever assembled.
          </p>
        </div>

        {/* Daily Challenge — same for everyone, stats visible */}
        <button
          onClick={onStartDaily}
          className="group w-full max-w-md rounded-xl px-5 py-4 mb-3 text-left transition-all duration-150 relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${C.surfaceHi} 0%, ${C.surface} 100%)`,
            border: `1.5px solid ${C.emerald}`,
            boxShadow: `0 0 24px -8px ${C.emerald}66`,
          }}
        >
          <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: C.emerald }} />
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: C.emerald }}>Daily Challenge</span>
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: C.gold + '22', color: C.gold }}>Stats Hidden</span>
              </div>
              <div className="text-lg font-bold" style={{ color: C.text, fontFamily: 'var(--font-display, sans-serif)', letterSpacing: '0.01em' }}>Today&apos;s Beasts</div>
              <div className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>{todayLabel} · same challenge for everyone</div>
            </div>
            <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide shrink-0" style={{ color: C.emerald }}>
              Play <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </span>
          </div>
        </button>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
          <ModeCard
            onClick={() => onSelectMode('classic')}
            tag="Unlimited · Classic"
            title="Stats Visible"
            accent={C.gold}
          />
          <ModeCard
            onClick={() => onSelectMode('film')}
            tag="Unlimited · Film Room"
            title="Stats Hidden"
            accent={C.sky}
          />
        </div>

        {/* ODDS LAB — play-credits-only pay-to-play simulation sandbox (hidden behind SHOW_ODDS_LAB) */}
        {SHOW_ODDS_LAB && (
        <button
          onClick={onStartLab}
          className="group w-full max-w-md rounded-xl px-5 py-4 mt-3 text-left transition-all duration-150 relative overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${C.surfaceHi} 0%, ${C.surface} 100%)`,
            border: `1.5px solid ${C.gold}`,
            boxShadow: `0 0 24px -10px ${C.gold}66`,
          }}
        >
          <span className="absolute left-0 top-0 bottom-0 w-1.5" style={{ background: C.gold }} />
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color: C.gold }}>Odds Lab</span>
                <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded" style={{ background: C.gold + '22', color: C.gold }}>Play Credits</span>
              </div>
              <div className="text-lg font-bold" style={{ color: C.text, fontFamily: 'var(--font-display, sans-serif)', letterSpacing: '0.01em' }}>Gambling Test</div>
              <div className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>Win by more, win more · 97% RTP model · not real money</div>
            </div>
            <span className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide shrink-0" style={{ color: C.gold }}>
              Enter <ChevronRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </span>
          </div>
        </button>
        )}

        <button
          onClick={() => setShowDetails(v => !v)}
          className="mt-5 text-xs font-medium transition-opacity hover:opacity-100 flex items-center gap-1"
          style={{ color: C.textDim, opacity: 0.8 }}
        >
          What&apos;s the difference?
          <ChevronRight
            className="w-3.5 h-3.5 transition-transform"
            style={{ transform: showDetails ? 'rotate(90deg)' : 'none' }}
          />
        </button>

        <div
          className="w-full max-w-md overflow-hidden transition-all duration-300"
          style={{ maxHeight: showDetails ? 220 : 0, opacity: showDetails ? 1 : 0 }}
        >
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl p-4" style={{ background: C.surfaceLo, border: `1px solid ${C.border}` }}>
              <div className="font-semibold mb-1" style={{ color: C.gold }}>Classic</div>
              <p style={{ color: C.textMuted, lineHeight: 1.5 }}>Full peak-decade stats on every player. Draft on the numbers.</p>
            </div>
            <div className="rounded-xl p-4" style={{ background: C.surfaceLo, border: `1px solid ${C.border}` }}>
              <div className="font-semibold mb-1" style={{ color: C.sky }}>Film Room</div>
              <p style={{ color: C.textMuted, lineHeight: 1.5 }}>Names only, no numbers. Draft from football knowledge alone.</p>
            </div>
          </div>
        </div>
      </main>

      <footer className="w-full text-center py-6 px-4 text-xs relative z-10" style={{ color: C.textDim, opacity: 0.7 }}>
        Independent project · not affiliated with the NFL
      </footer>
    </div>
  );
}

function ModeCard({ onClick, tag, title, accent }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative rounded-xl px-5 py-5 text-left transition-all duration-150 overflow-hidden"
      style={{
        background: hover ? C.surfaceHi : C.surface,
        border: `1.5px solid ${hover ? accent : C.border}`,
        boxShadow: hover ? `0 8px 24px -8px rgba(0,0,0,0.6)` : '0 2px 8px -4px rgba(0,0,0,0.5)',
        transform: hover ? 'translateY(-2px)' : 'none',
      }}
    >
      {/* accent edge bar to signal interactivity */}
      <span
        className="absolute left-0 top-0 bottom-0 w-1 transition-all duration-150"
        style={{ background: accent, opacity: hover ? 1 : 0.55 }}
      />
      <span className="block text-[10px] font-bold tracking-widest uppercase mb-1" style={{ color: accent }}>
        {tag}
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="block font-bold whitespace-nowrap" style={{ color: C.text, fontFamily: 'var(--font-display, sans-serif)', fontSize: '1.15rem', letterSpacing: '0.01em' }}>{title}</span>
        <span
          className="flex items-center gap-0.5 text-[11px] font-bold uppercase tracking-wide transition-all duration-150 shrink-0"
          style={{ color: accent, transform: hover ? 'translateX(2px)' : 'none' }}
        >
          Play <ChevronRight className="w-3.5 h-3.5" />
        </span>
      </span>
    </button>
  );
}

function SlotMachine({ team, decade, spinning }) {
  const [displayTeam, setDisplayTeam] = useState(team);
  const [displayDecade, setDisplayDecade] = useState(decade);

  useEffect(() => {
    if (spinning) {
      const teams = Array.from(new Set([...PLAYERS, ...UNITS].map(x => x.t)));
      let count = 0;
      const interval = setInterval(() => {
        setDisplayTeam(teams[Math.floor(Math.random() * teams.length)]);
        setDisplayDecade(DECADES[Math.floor(Math.random() * DECADES.length)]);
        count++;
        if (count >= 14) {
          clearInterval(interval);
          setDisplayTeam(team);
          setDisplayDecade(decade);
        }
      }, 65);
      return () => clearInterval(interval);
    } else {
      setDisplayTeam(team);
      setDisplayDecade(decade);
    }
  }, [spinning, team, decade]);

  const dc = DECADE_HEX[displayDecade] || { bg: C.surfaceHi, text: C.text, border: C.border };

  return (
    <div className="flex items-center gap-2">
      <Pill
        style={{ background: C.surfaceHi, color: C.text, borderColor: C.borderHi }}
        className={spinning ? 'animate-pulse' : ''}
      >
        {displayTeam || '—'}
      </Pill>
      <Pill
        style={{ background: dc.bg, color: dc.text, borderColor: dc.border }}
        className={spinning ? 'animate-pulse' : ''}
      >
        {displayDecade || '—'}
      </Pill>
    </div>
  );
}

function PickCard({ pick, position, mode, daily, onSelect, disabled = false }) {
  const [hover, setHover] = useState(false);
  const ph = POS_HEX[position];
  const isUnit = position === 'OL' || position === 'DEF';
  // Classic shows stats. Film Room and the Daily Challenge both hide them, so
  // the daily draft leans on knowledge/instinct rather than reading the numbers.
  const showStats = mode === 'classic';

  return (
    <button
      onClick={() => !disabled && onSelect(pick, position)}
      onMouseEnter={() => !disabled && setHover(true)}
      onMouseLeave={() => setHover(false)}
      disabled={disabled}
      className="w-full text-left rounded-xl p-4 transition-all"
      style={{
        background: disabled ? C.surfaceLo : (hover ? C.surfaceHi : C.surface),
        border: `1px solid ${disabled ? C.border : (hover ? C.emerald : C.border)}`,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-bold leading-tight" style={{ color: C.text, fontSize: 16 }}>
            {pick.n}
          </h4>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider"
              style={{ background: ph.bg, color: ph.text }}
            >
              {position}
            </span>
            <span className="text-xs" style={{ color: C.textMuted }}>
              {pick.t} · {pick.d}
            </span>
            {disabled && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: C.textDim, border: `1px solid ${C.border}` }}>
                Filled
              </span>
            )}
          </div>
          {isUnit && pick.key && (
            <p className="text-xs italic mt-2 leading-relaxed line-clamp-2" style={{ color: C.textMuted }}>
              {pick.key}
            </p>
          )}
        </div>
        <ChevronRight
          className="w-5 h-5 flex-shrink-0 transition-all"
          style={{
            color: disabled ? C.textDim : (hover ? C.emerald : C.textDim),
            transform: !disabled && hover ? 'translateX(2px)' : 'none',
          }}
        />
      </div>

      {showStats && (
        <div className="mt-3 grid grid-cols-4 gap-2 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
          {position === 'QB' && (
            <>
              <Stat label="YDS/G" value={pick.s.y} />
              <Stat label="TD/G" value={pick.s.t} />
              <Stat label="INT/G" value={pick.s.i} />
              <Stat label="RTG" value={pick.s.r} />
            </>
          )}
          {position === 'RB' && (
            <>
              <Stat label="RUSH/G" value={pick.s.y} />
              <Stat label="YPC" value={pick.s.c} />
              <Stat label="REC/G" value={pick.s.r} />
              <Stat label="TD/G" value={pick.s.t} />
            </>
          )}
          {position === 'WR' && (
            <>
              <Stat label="REC/G" value={pick.s.y} />
              <Stat label="YPT" value={pick.s.p} />
              <Stat label="TD/G" value={pick.s.t} />
              <Stat label="CTC%" value={pick.s.c} />
            </>
          )}
          {position === 'TE' && (
            <>
              <Stat label="REC/G" value={pick.s.y} />
              <Stat label="TD/G" value={pick.s.t} />
              <Stat label="BLK" value={pick.s.b} />
              <Stat label="IMP" value={pick.imp} />
            </>
          )}
          {position === 'OL' && (
            <>
              <Stat label="RUSH/G" value={pick.s.ry} />
              <Stat label="SA/G" value={pick.s.sa} />
              <Stat label="PBS" value={pick.s.pb} />
              <Stat label="PB" value={pick.s.pbl} />
            </>
          )}
          {position === 'DEF' && (
            <>
              <Stat label="PA/G" value={pick.s.pa} />
              <Stat label="YA/G" value={pick.s.ya} />
              <Stat label="TO/G" value={pick.s.to} />
              <Stat label="SK/G" value={pick.s.sk} />
            </>
          )}
        </div>
      )}
    </button>
  );
}

function Stat({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-[9px] uppercase tracking-wider font-bold" style={{ color: C.textDim }}>{label}</div>
      <div className="text-sm font-bold tabular-nums mt-0.5" style={{ color: C.text }}>{value}</div>
    </div>
  );
}

function FootballField({ roster, activeSlot, beasts = [] }) {
  const slotPos = {
    OL:  { x: 260, y: 262 },
    TE:  { x: 395, y: 262 },
    TE2: { x: 395, y: 332 },
    WR1: { x: 55,  y: 300 },
    WR2: { x: 465, y: 300 },
    WR3: { x: 120, y: 332 },
    QB:  { x: 260, y: 372 },
    RB:  { x: 225, y: 446 },
    RB2: { x: 300, y: 446 },
  };

  const renderSlot = (slot) => {
    const pos = slotPos[slot];
    const player = roster[slot];
    const isActive = activeSlot === slot;
    const isFilled = !!player;
    const basePos = slot.replace(/[123]/g, '');
    const ph = POS_HEX[basePos];

    if (slot === 'OL') {
      const startX = pos.x - 100;
      const spacing = 50;
      const filled = isFilled;
      return (
        <g key="OL">
          {[0, 1, 2, 3, 4].map(i => (
            <g key={i}>
              <rect
                x={startX + i * spacing - 18}
                y={pos.y - 18}
                width={36}
                height={36}
                rx={6}
                fill={filled ? ph.solid : 'rgba(170,255,0,0.05)'}
                stroke={filled ? ph.solid : isActive ? C.emerald : 'rgba(168,160,146,0.3)'}
                strokeWidth={isActive && !filled ? 2 : 1.5}
                strokeDasharray={filled ? '0' : '4 3'}
                opacity={filled ? 0.9 : 1}
                className={isActive && !filled ? 'animate-pulse' : ''}
              />
              {filled && (
                <text x={startX + i * spacing} y={pos.y + 4} textAnchor="middle" fill="#08070f" fontSize="10" fontWeight="800">
                  {['LT','LG','C','RG','RT'][i]}
                </text>
              )}
            </g>
          ))}
          <text x={pos.x} y={pos.y + 38} textAnchor="middle" fill={filled ? ph.solid : isActive ? C.emerald : C.textMuted} fontSize="10" fontWeight="800" letterSpacing="2">
            {filled ? player.t + ' · O-LINE' : 'O-LINE'}
          </text>
        </g>
      );
    }

    if (slot === 'DEF') return null;

    const fillColor = isFilled ? ph.solid : 'rgba(170,255,0,0.05)';

    return (
      <g key={slot}>
        <rect
          x={pos.x - 28}
          y={pos.y - 28}
          width={56}
          height={56}
          rx={10}
          fill={fillColor}
          stroke={isFilled ? ph.solid : isActive ? C.emerald : 'rgba(168,160,146,0.3)'}
          strokeWidth={isActive && !isFilled ? 2 : 1.5}
          strokeDasharray={isFilled ? '0' : '4 3'}
          opacity={isFilled ? 0.95 : 1}
          className={isActive && !isFilled ? 'animate-pulse' : ''}
        />
        {isFilled ? (
          <>
            {(() => {
              const parts = player.n.split(' ');
              const suffixes = ['Jr.', 'Sr.', 'II', 'III', 'IV'];
              let lastName = parts[parts.length - 1];
              if (suffixes.includes(lastName) && parts.length >= 2) {
                lastName = parts[parts.length - 2];
              }
              const len = lastName.length;
              const fontSize = len <= 6 ? 12 : len <= 8 ? 11 : len <= 10 ? 9 : len <= 12 ? 8 : 7;
              return (
                <text x={pos.x} y={pos.y - 1} textAnchor="middle" fill="#08070f" fontSize={fontSize} fontWeight="900">
                  {lastName}
                </text>
              );
            })()}
            <text x={pos.x} y={pos.y + 14} textAnchor="middle" fill="#08070f" fontSize="8" fontWeight="800" opacity="0.85">
              {slot}
            </text>
          </>
        ) : (
          <text x={pos.x} y={pos.y + 4} textAnchor="middle" fill={isActive ? C.emerald : C.textMuted} fontSize="12" fontWeight="800">
            {slot}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="relative w-full rounded-2xl overflow-hidden" style={{ background: C.field, border: `1px solid ${C.border}` }}>
      <svg viewBox="0 0 520 520" className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="stripes" patternUnits="userSpaceOnUse" width="520" height="40">
            <rect width="520" height="40" fill={C.field} />
            <rect width="520" height="20" fill={C.fieldStripe} />
          </pattern>
        </defs>

        <rect width="520" height="520" fill="url(#stripes)" opacity="0.6" />

        {[40, 80, 120, 160, 200, 240, 280, 320, 360, 400, 440, 480].map(y => (
          <line key={y} x1="25" x2="495" y1={y} y2={y} stroke="rgba(240,232,214,0.04)" strokeWidth="1" />
        ))}

        <line x1="25" x2="25" y1="40" y2="480" stroke="rgba(240,232,214,0.08)" strokeWidth="1" />
        <line x1="495" x2="495" y1="40" y2="480" stroke="rgba(240,232,214,0.08)" strokeWidth="1" />

        <line x1="25" x2="495" y1="220" y2="220" stroke="rgba(240,232,214,0.25)" strokeWidth="1.5" strokeDasharray="5 4" />
        <text x="35" y="215" fill="rgba(240,232,214,0.35)" fontSize="9" fontWeight="800" letterSpacing="3">LOS</text>

        {/* The Beasts — opponent defense above the LOS, in a realistic alignment:
            safeties deepest, corners wide at CB depth, 3 LBs (middle = MLB), then
            the line as DE-DT-DT-DE just above the LOS. */}
        {beasts.length === 11 && (() => {
          const line = beasts.filter(b => b.slot === 'DL');     // DE DT DT DE (assembly order)
          const lbs  = beasts.filter(b => b.slot === 'LB');     // 3
          const dbs  = beasts.filter(b => b.slot === 'DB');
          const cbs  = dbs.filter(b => b.role === 'CB');
          const safs = dbs.filter(b => b.role === 'S');

          const chip = (b, x, y, labelOverride) => {
            const ph = POS_HEX[b.role] || POS_HEX[b.p] || POS_HEX.DE;
            return (
              <g key={`${b.role}-${x}-${y}`}>
                <circle cx={x} cy={y} r={13} fill={ph.bg} stroke={ph.solid} strokeWidth={1.75} />
                <text x={x} y={y + 3.5} textAnchor="middle" fill={ph.text} fontSize="8.5" fontWeight="900">{labelOverride || b.role}</text>
                <text x={x} y={y + 26} textAnchor="middle" fill="rgba(240,232,214,0.82)" fontSize={b.n.length > 15 ? 7 : 8} fontWeight="700">{b.n}</text>
              </g>
            );
          };

          // Safeties: deepest, two of them split toward the hashes.
          const safX = [180, 340];
          // Corners: wide, slightly ahead of the safeties.
          const cbX = [60, 460];
          // Linebackers: spread across the middle; center one is the MLB.
          const lbX = [130, 260, 390];
          // Line: DE wide, DTs inside, just above the LOS.
          const dlX = [110, 210, 310, 410];

          return (
            <g opacity="0.96">
              {safs.map((b, i) => chip(b, safX[i] ?? 260, 64))}
              {cbs.map((b, i) => chip(b, cbX[i] ?? 60, 104))}
              {lbs.map((b, i) => chip(b, lbX[i] ?? 260, 150, i === 1 ? 'MLB' : 'LB'))}
              {line.map((b, i) => chip(b, dlX[i] ?? 260, 196))}
            </g>
          );
        })()}

        <rect x="0" y="0" width="520" height="40" fill="rgba(20,184,166,0.08)" />
        <text x="260" y="26" textAnchor="middle" fill="rgba(94,234,212,0.5)" fontSize="10" fontWeight="800" letterSpacing="4">OPPONENT</text>
        <rect x="0" y="480" width="520" height="40" fill="rgba(170,255,0,0.08)" />
        <text x="260" y="506" textAnchor="middle" fill="rgba(134,239,172,0.5)" fontSize="10" fontWeight="800" letterSpacing="4">YOUR OFFENSE</text>

        {['OL','TE','TE2','WR1','WR2','WR3','QB','RB','RB2'].map(s => renderSlot(s))}
      </svg>
    </div>
  );
}

function HowToPlayModal({ onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(10,14,26,0.85)', backdropFilter: 'blur(8px)' }} onClick={onClose}>
      <div className="rounded-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto" style={{ background: C.surface, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 px-6 py-4 flex items-center justify-between" style={{ background: C.surface, borderBottom: `1px solid ${C.border}` }}>
          <h2 className="text-xl font-bold" style={{ color: C.text, fontFamily: 'var(--font-display, ui-serif, Georgia, serif)' }}>How to Play Beat the Beasts</h2>
          <button onClick={onClose} style={{ color: C.textMuted }}><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-5 text-sm leading-relaxed" style={{ color: C.textMuted }}>
          <p style={{ color: C.text, fontSize: 16 }}>The Beasts are an 11-man defense built from the greatest defenders in NFL history, pulled from every era. Your job: draft an offense good enough to beat them.</p>

          <Section title="1. Meet the Beasts">
            <p>Every game opens with a randomly assembled defense — 4 linemen, 3 linebackers, 4 defensive backs, mixed across all decades. You'll see exactly who you're up against and how dangerous they are (their Defense Rating and points allowed) before you draft.</p>
          </Section>

          <Section title="2. Draft Your Offense">
            <ul className="space-y-1.5 list-disc list-inside">
              <li>9 rounds — one offensive pick per round</li>
              <li>Each round, the slot machine spins a random <strong>team</strong> and <strong>decade</strong></li>
              <li>You choose which position to fill from that team's roster in that era</li>
              <li>One Team Skip and one Era Skip per game</li>
            </ul>
          </Section>

          <Section title="The Roster">
            <div className="grid grid-cols-2 gap-1.5">
              <div>• QB</div><div>• RB · RB2</div>
              <div>• WR1 · WR2 · WR3</div><div>• TE · TE2</div>
              <div className="col-span-2">• O-Line</div>
            </div>
          </Section>

          <Section title="3. Beat the Beasts">
            <p>Once your offense is set, the matchup is simulated — a single game, final score shown. Win or lose, you get a dominance grade from <strong>Total Domination</strong> down to <strong>Beatdown</strong>.</p>
            <p className="mt-2">Everything is era-normalized — a 1970s legend competes fairly with a modern star. Your QB, receiving corps, backfield and O-line feed an Offensive Power Rating; the Beasts' pass rush, coverage and overall impact set how many points they allow. The better the defense, the harder it is to put up points — beating an all-time unit is supposed to be tough.</p>
          </Section>

          <Section title="Modes">
            <div className="space-y-1.5">
              <div><span className="font-bold" style={{ color: C.gold }}>Classic</span> — all stats visible</div>
              <div><span className="font-bold" style={{ color: C.sky }}>Film Room</span> — stats hidden, draft from memory</div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h3 className="text-[11px] font-bold tracking-widest uppercase mb-2" style={{ color: C.emerald }}>{title}</h3>
      {children}
    </div>
  );
}

function YearWheelScreen({ roster, onComplete }) {
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState(null);  // the final year, once spin completes
  const [scrollY, setScrollY] = useState(0);   // current reel offset in px
  const ROW_H = 80;  // height of each year row
  const VISIBLE_ROWS = 5;

  // Build a long repeating list so the reel scrolls smoothly past many years
  const reel = useMemo(() => {
    const r = [];
    for (let i = 0; i < 8; i++) r.push(...YEARS);
    return r;
  }, []);

  const spin = () => {
    if (spinning) return;
    setSpinning(true);
    setLanded(null);

    // Pick a target year and figure out the index in the reel near the end so we land going forward
    const targetYear = YEARS[Math.floor(Math.random() * YEARS.length)];
    // Find an index in the last third of the reel that matches the target
    const startSearch = Math.floor(reel.length * 0.65);
    let targetIdx = reel.indexOf(targetYear, startSearch);
    if (targetIdx === -1) targetIdx = reel.lastIndexOf(targetYear);

    // The center of the visible reel is at scrollY + (VISIBLE_ROWS/2)*ROW_H, where the middle row index is scrollY/ROW_H + (VISIBLE_ROWS-1)/2
    // We want reel[middleIdx] === targetYear, so middleIdx = targetIdx, scrollY = (targetIdx - (VISIBLE_ROWS-1)/2) * ROW_H
    const finalScroll = (targetIdx - Math.floor(VISIBLE_ROWS / 2)) * ROW_H;

    // Animate the scroll over ~4 seconds with easing
    const startTime = Date.now();
    const duration = 4200;
    const startScroll = 0;

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const t = Math.min(1, elapsed / duration);
      // Ease-out cubic for nice deceleration
      const eased = 1 - Math.pow(1 - t, 3);
      const current = startScroll + (finalScroll - startScroll) * eased;
      setScrollY(current);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        setLanded(targetYear);
        setSpinning(false);
      }
    };
    requestAnimationFrame(tick);
  };

  // Spin automatically on mount
  useEffect(() => {
    const timer = setTimeout(() => spin(), 600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const middleIdx = Math.round(scrollY / ROW_H) + Math.floor(VISIBLE_ROWS / 2);
  const visibleStart = Math.max(0, middleIdx - Math.floor(VISIBLE_ROWS / 2) - 2);
  const visibleEnd = Math.min(reel.length, middleIdx + Math.ceil(VISIBLE_ROWS / 2) + 2);
  const visibleSlice = reel.slice(visibleStart, visibleEnd).map((y, i) => ({ year: y, idx: visibleStart + i }));

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 relative" style={{ background: C.bg, color: C.text }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: `repeating-linear-gradient(90deg, transparent 0px, transparent 80px, rgba(170,255,0,0.03) 80px, rgba(170,255,0,0.03) 82px)`,
      }} />

      <div className="text-center mb-8 relative z-10">
        <div className="text-[11px] uppercase tracking-[0.3em] font-bold mb-2" style={{ color: C.emerald }}>Final Step</div>
        <h1 className="text-3xl sm:text-5xl font-black mb-3" style={{ color: C.text, fontFamily: 'var(--font-display, ui-serif, Georgia, serif)', letterSpacing: '-0.03em' }}>
          {landed ? `Welcome to ${landed}` : 'Spinning the Years…'}
        </h1>
        <p className="text-sm max-w-md mx-auto" style={{ color: C.textMuted }}>
          {landed
            ? `Your offense faces 17 random NFL defenses from the ${landed} season.`
            : 'The wheel will land on a season. You\'ll play 17 games against random defenses from that year.'}
        </p>
      </div>

      {/* The wheel — a vertical scrolling drum of years */}
      <div className="relative z-10" style={{ width: 280, height: ROW_H * VISIBLE_ROWS }}>
        {/* Outer drum frame */}
        <div className="absolute inset-0 rounded-3xl overflow-hidden" style={{
          background: `linear-gradient(180deg, #1c2236 0%, #120f1f 50%, #1c2236 100%)`,
          border: `3px solid ${C.borderHi}`,
          boxShadow: `inset 0 4px 24px rgba(0,0,0,0.6), 0 0 60px rgba(170,255,0,0.15)`,
        }}>
          {/* The scrolling reel */}
          <div style={{
            transform: `translateY(${-scrollY % (reel.length * ROW_H)}px)`,
            willChange: 'transform',
          }}>
            {visibleSlice.map(({ year, idx }) => {
              const isMiddle = idx === middleIdx;
              return (
                <div
                  key={idx}
                  className="flex items-center justify-center font-black tabular-nums"
                  style={{
                    position: 'absolute',
                    top: idx * ROW_H,
                    left: 0,
                    right: 0,
                    height: ROW_H,
                    fontSize: isMiddle && landed ? 64 : 48,
                    fontFamily: 'var(--font-display, ui-serif, Georgia, serif)',
                    color: isMiddle && landed ? C.emerald : C.text,
                    opacity: isMiddle ? 1 : 0.4,
                    transition: 'font-size 0.3s ease, color 0.3s ease',
                  }}
                >
                  {year}
                </div>
              );
            })}
          </div>

          {/* Gradient fades top and bottom for drum effect */}
          <div className="absolute top-0 left-0 right-0 pointer-events-none" style={{ height: 80, background: `linear-gradient(180deg, rgba(10,14,26,0.95) 0%, transparent 100%)` }} />
          <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ height: 80, background: `linear-gradient(0deg, rgba(10,14,26,0.95) 0%, transparent 100%)` }} />

          {/* Center indicator lines */}
          <div className="absolute left-0 right-0 pointer-events-none" style={{
            top: '50%',
            height: ROW_H,
            transform: 'translateY(-50%)',
            borderTop: `2px solid ${C.emerald}`,
            borderBottom: `2px solid ${C.emerald}`,
            boxShadow: `0 0 12px rgba(170,255,0,0.4)`,
          }} />
        </div>

        {/* Side pointers (the arrow markers) */}
        <div className="absolute pointer-events-none" style={{
          left: -12,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 0, height: 0,
          borderTop: '14px solid transparent',
          borderBottom: '14px solid transparent',
          borderLeft: `18px solid ${C.emerald}`,
        }} />
        <div className="absolute pointer-events-none" style={{
          right: -12,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 0, height: 0,
          borderTop: '14px solid transparent',
          borderBottom: '14px solid transparent',
          borderRight: `18px solid ${C.emerald}`,
        }} />
      </div>

      {/* Continue button */}
      <div className="mt-10 relative z-10">
        {landed ? (
          <button
            onClick={() => onComplete(landed)}
            className="px-8 py-4 rounded-xl font-black tracking-wide transition-transform hover:scale-105 active:scale-95 text-base"
            style={{
              background: `linear-gradient(135deg, ${C.emerald} 0%, ${C.emeraldDim} 100%)`,
              color: '#08070f',
              boxShadow: `0 8px 24px rgba(170,255,0,0.35)`,
              letterSpacing: '0.05em',
            }}
          >
            Play the {landed} Season →
          </button>
        ) : (
          <div className="text-xs uppercase tracking-[0.3em] font-bold opacity-60" style={{ color: C.textMuted }}>
            Hold on…
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// BEAT THE BEASTS — SCREENS
// ============================================================

// Small helper: a single Beast card (used on reveal + result).
function BeastChip({ b, mode, daily, revealStats = true }) {
  const ph = POS_HEX[b.p] || POS_HEX.DE;
  const dh = DECADE_HEX[b.d] || {};
  const showStats = revealStats && (mode !== 'film' || daily);
  let line = null;
  if (showStats) {
    const s = b.s || {};
    if (b.p === 'DE' || b.p === 'DT') line = `${s.sk ?? '—'}${s.u ? '*' : ''} sacks · ${s.int || 0} INT`;
    else if (b.p === 'LB') line = `${s.sk ?? 0}${s.u ? '*' : ''} sk · ${s.int || 0} INT · ${s.fr || 0} FR`;
    else line = `${s.int || 0} INT · ${s.fr || 0} FR${s.td ? ` · ${s.td} TD` : ''}`;
  }
  return (
    <div className="rounded-lg p-2.5 flex items-center gap-2.5" style={{ background: C.surfaceHi, border: `1px solid ${C.border}` }}>
      <span className="text-[9px] font-black px-1.5 py-1 rounded uppercase tracking-wider text-center" style={{ background: ph.bg, color: ph.text, minWidth: 30 }}>{b.p}</span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-sm truncate" style={{ color: C.text }}>{b.n}</div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wide" style={{ color: C.textMuted }}>{b.t}</span>
          <span className="text-[9px] px-1 rounded" style={{ background: dh.bg, color: dh.text }}>{b.d}</span>
        </div>
        {line && <div className="text-[10px] tabular-nums mt-0.5" style={{ color: C.textDim }}>{line}</div>}
      </div>
      <span className="font-black tabular-nums text-sm" style={{ color: b.imp >= 92 ? C.emerald : b.imp >= 84 ? C.sky : C.textMuted }}>{b.imp}</span>
    </div>
  );
}

// The field layout for the 11 Beasts: 4 DL, 3 LB, 4 DB.
function BeastsField({ beasts }) {
  const dl = beasts.filter(b => b.slot === 'DL');
  const lb = beasts.filter(b => b.slot === 'LB');
  const db = beasts.filter(b => b.slot === 'DB');
  const Node = ({ b }) => {
    const ph = POS_HEX[b.p] || POS_HEX.DE;
    return (
      <div className="flex flex-col items-center" style={{ width: 76 }}>
        <div className="rounded-full flex items-center justify-center font-black text-[11px]" style={{ width: 34, height: 34, background: ph.bg, border: `1.5px solid ${ph.solid}`, color: ph.text }}>
          {getInitials(b.n)}
        </div>
        <div className="text-[8px] font-bold mt-1 text-center leading-tight" style={{ color: C.textMuted }}>{b.n}</div>
        <div className="text-[7px] uppercase" style={{ color: C.textDim }}>{b.d}</div>
      </div>
    );
  };
  return (
    <div className="rounded-2xl p-5 relative overflow-hidden" style={{ background: C.field, border: `1px solid ${C.border}` }}>
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `repeating-linear-gradient(0deg, transparent 0, transparent 28px, ${C.fieldStripe} 28px, ${C.fieldStripe} 29px)` }} />
      <div className="relative z-10 flex flex-col gap-5 items-center">
        <div className="flex justify-center gap-2 flex-wrap">{db.map((b,i) => <Node key={i} b={b} />)}</div>
        <div className="text-[8px] uppercase tracking-[0.3em]" style={{ color: C.textDim }}>Secondary</div>
        <div className="flex justify-center gap-3 flex-wrap">{lb.map((b,i) => <Node key={i} b={b} />)}</div>
        <div className="text-[8px] uppercase tracking-[0.3em]" style={{ color: C.textDim }}>Linebackers</div>
        <div className="flex justify-center gap-2 flex-wrap">{dl.map((b,i) => <Node key={i} b={b} />)}</div>
        <div className="w-full mt-1" style={{ borderTop: `2px dashed ${C.borderHi}` }} />
        <div className="text-[8px] uppercase tracking-[0.3em] -mt-3 px-2" style={{ color: C.textDim, background: C.field }}>Line of Scrimmage</div>
      </div>
    </div>
  );
}

// Slot-machine "drafting the Beasts" animation. Each of the 11 slots rapidly
// shuffles candidate names from the right position pool, then locks onto the
// real pick with a flash — one after another — before handing off to the reveal.
function BeastsDraftScreen({ beasts, onComplete }) {
  const STAGGER = 230;   // ms between each slot locking
  const SHUFFLE = 55;    // ms per name flicker
  const [locked, setLocked] = useState(0);     // how many slots are locked in
  const [tick, setTick] = useState(0);         // drives the flicker on unlocked slots

  // Candidate name pools per position (for the flicker), built once.
  const pools = useMemo(() => {
    const byPos = { DE: [], DT: [], LB: [], CB: [], S: [] };
    DEFENSE.forEach(p => { if (byPos[p.p]) byPos[p.p].push(p.n); });
    return byPos;
  }, []);

  // Flicker timer: keep cycling shuffled names on not-yet-locked slots.
  useEffect(() => {
    if (locked >= beasts.length) return;
    const id = setInterval(() => setTick(t => t + 1), SHUFFLE);
    return () => clearInterval(id);
  }, [locked, beasts.length]);

  // Lock slots one at a time.
  useEffect(() => {
    if (locked >= beasts.length) {
      const done = setTimeout(onComplete, 600);
      return () => clearTimeout(done);
    }
    const id = setTimeout(() => setLocked(n => n + 1), STAGGER);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  const groups = [
    { label: 'Defensive Line', slot: 'DL', color: POS_HEX.DE.text },
    { label: 'Linebackers', slot: 'LB', color: POS_HEX.LB.text },
    { label: 'Secondary', slot: 'DB', color: POS_HEX.DB.text },
  ];

  // Stable index of each beast in the overall lock order = its array position.
  const indexOf = (b) => beasts.indexOf(b);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 relative" style={{ background: C.bg, color: C.text }}>
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `repeating-linear-gradient(90deg, transparent 0px, transparent 80px, rgba(255,92,138,0.04) 80px, rgba(255,92,138,0.04) 82px)` }} />
      <div className="relative z-10 w-full max-w-3xl text-center">
        <div className="text-[11px] font-bold tracking-[0.4em] uppercase mb-2" style={{ color: '#ff2a6d' }}>Assembling</div>
        <h1 className="font-black leading-none mb-2" style={{ fontFamily: 'var(--font-display, ui-serif, Georgia, serif)', fontSize: 'clamp(2.4rem, 8vw, 4.5rem)', letterSpacing: '-0.04em' }}>
          THE BEASTS
        </h1>
        <div className="text-sm mb-8 tabular-nums" style={{ color: C.textMuted }}>
          {Math.min(locked, beasts.length)} / {beasts.length} locked in
        </div>

        <div className="space-y-5">
          {groups.map(g => {
            const groupBeasts = beasts.filter(b => b.slot === g.slot);
            return (
              <div key={g.slot}>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: g.color }}>{g.label}</div>
                <div className="flex flex-wrap justify-center gap-2">
                  {groupBeasts.map((b) => {
                    const idx = indexOf(b);
                    const isLocked = idx < locked;
                    const justLocked = idx === locked - 1;
                    const ph = POS_HEX[b.p] || POS_HEX.DE;
                    // While unlocked, show a flickering random name from the pool.
                    const pool = pools[b.p] || [b.n];
                    const flickerName = pool[(tick + idx * 7) % pool.length];
                    return (
                      <div
                        key={idx}
                        className="rounded-lg px-3 py-2 flex items-center gap-2 transition-all"
                        style={{
                          minWidth: 168,
                          background: isLocked ? ph.bg : C.surface,
                          border: `1px solid ${isLocked ? ph.solid : C.border}`,
                          transform: justLocked ? 'scale(1.06)' : 'scale(1)',
                          boxShadow: justLocked ? `0 0 18px ${ph.solid}66` : 'none',
                          opacity: isLocked ? 1 : 0.7,
                        }}
                      >
                        <span className="text-[9px] font-black px-1.5 py-1 rounded uppercase text-center" style={{ background: isLocked ? 'transparent' : ph.bg, color: ph.text, minWidth: 28 }}>{b.p}</span>
                        <span
                          className="font-bold text-sm truncate text-left flex-1"
                          style={{ color: isLocked ? C.text : C.textDim, fontVariantNumeric: 'tabular-nums' }}
                        >
                          {isLocked ? b.n : flickerName}
                        </span>
                        {isLocked && <span className="font-black tabular-nums text-xs" style={{ color: b.imp >= 92 ? C.emerald : b.imp >= 84 ? C.sky : C.textMuted }}>{b.imp}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BeastsRevealScreen({ beasts, mode, daily, onStart, onReset }) {
  const rating = useMemo(() => rateBeasts(beasts), [beasts]);
  const dl = beasts.filter(b => b.slot === 'DL');
  const lb = beasts.filter(b => b.slot === 'LB');
  const db = beasts.filter(b => b.slot === 'DB');
  const tier = rating.rating >= 90 ? { l: 'NIGHTMARE', c: '#ff2a6d' }
            : rating.rating >= 87 ? { l: 'BRUTAL', c: C.gold }
            : rating.rating >= 84 ? { l: 'STOUT', c: C.sky }
            : { l: 'BEATABLE', c: C.emerald };

  return (
    <div className="min-h-screen px-4 py-10 relative" style={{ background: C.bg, color: C.text }}>
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `repeating-linear-gradient(90deg, transparent 0px, transparent 80px, rgba(170,255,0,0.03) 80px, rgba(170,255,0,0.03) 82px)` }} />
      <div className="max-w-4xl mx-auto relative z-10">
        <div className="text-center mb-8">
          <div className="text-[11px] font-bold tracking-[0.4em] uppercase mb-3" style={{ color: '#ff2a6d' }}>Your Opponent</div>
          <h1 className="font-black leading-none mb-3" style={{ fontFamily: 'var(--font-display, ui-serif, Georgia, serif)', fontSize: 'clamp(2.6rem, 9vw, 5rem)', letterSpacing: '-0.04em' }}>
            THE BEASTS
          </h1>
          <p className="text-sm max-w-xl mx-auto" style={{ color: C.textMuted }}>
            Eleven of the greatest defenders ever to play, pulled from across every era and assembled into one front. Build an offense that can beat them.
          </p>
          <div className="mt-5 inline-flex items-center gap-4 px-5 py-3 rounded-xl" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <div className="text-center">
              <div className="text-[9px] uppercase tracking-widest" style={{ color: C.textDim }}>Defense Rating</div>
              <div className="font-black text-3xl tabular-nums" style={{ color: tier.c }}>{rating.rating}</div>
            </div>
            <div className="h-9 w-px" style={{ background: C.border }} />
            <div className="text-center">
              <div className="text-[9px] uppercase tracking-widest" style={{ color: C.textDim }}>Threat Level</div>
              <div className="font-black text-lg tracking-wider" style={{ color: tier.c }}>{tier.l}</div>
            </div>
            <div className="h-9 w-px" style={{ background: C.border }} />
            <div className="text-center">
              <div className="text-[9px] uppercase tracking-widest" style={{ color: C.textDim }}>Pts Allowed/G</div>
              <div className="font-black text-3xl tabular-nums" style={{ color: C.text }}>{rating.basePA.toFixed(1)}</div>
            </div>
          </div>
        </div>

        <div className="flex gap-3 justify-center mb-8">
          <button onClick={onStart} className="px-8 py-4 font-black rounded-xl uppercase tracking-widest text-sm transition" style={{ background: C.emerald, color: C.bg }}>
            Draft My Offense →
          </button>
          <button onClick={onReset} className="px-5 py-4 font-bold rounded-xl uppercase tracking-wider text-sm transition" style={{ border: `1px solid ${C.border}`, color: C.textMuted }}>
            New Beasts
          </button>
        </div>

        <div className="grid md:grid-cols-2 gap-5 mb-8">
          <BeastsField beasts={beasts} />
          <div className="space-y-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: POS_HEX.DE.text }}>Defensive Line ({dl.length})</div>
              <div className="space-y-2">{dl.map((b,i) => <BeastChip key={i} b={b} mode={mode} daily={daily} />)}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: POS_HEX.LB.text }}>Linebackers ({lb.length})</div>
              <div className="space-y-2">{lb.map((b,i) => <BeastChip key={i} b={b} mode={mode} daily={daily} />)}</div>
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest mb-2" style={{ color: POS_HEX.DB.text }}>Defensive Backs ({db.length})</div>
              <div className="space-y-2">{db.map((b,i) => <BeastChip key={i} b={b} mode={mode} daily={daily} />)}</div>
            </div>
          </div>
        </div>

        {mode !== 'film' && <p className="text-center text-[10px] mt-4" style={{ color: C.textDim }}>* sacks unofficial (pre-1982)</p>}
      </div>
    </div>
  );
}

// Brief "running the matchup" interstitial before the result.
function SimRunScreen({ roster, beasts, onComplete }) {
  const [step, setStep] = useState(0);
  const lines = ['Setting the line of scrimmage', 'Reading the defense', 'Running the matchup', 'Final whistle'];
  useEffect(() => {
    if (step < lines.length) {
      const t = setTimeout(() => setStep(step + 1), 520);
      return () => clearTimeout(t);
    }
    const t = setTimeout(onComplete, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4" style={{ background: C.bg, color: C.text }}>
      <div className="text-[11px] font-bold tracking-[0.4em] uppercase mb-6" style={{ color: '#ff2a6d' }}>You vs. The Beasts</div>
      <div className="font-black mb-8" style={{ fontFamily: 'var(--font-display, ui-serif, Georgia, serif)', fontSize: 'clamp(2rem,7vw,3.5rem)', letterSpacing: '-0.04em' }}>KICKOFF</div>
      <div className="space-y-2 text-center">
        {lines.map((l, i) => (
          <div key={i} className="text-sm transition-opacity duration-300" style={{ color: i <= step ? C.emerald : C.textDim, opacity: i <= step ? 1 : 0.3 }}>
            {i < step ? '✓ ' : i === step ? '› ' : ''}{l}
          </div>
        ))}
      </div>
    </div>
  );
}

// Convert a 0-100 performance score into a letter grade.
const scoreToGrade = (s) => {
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
const gradeColor = (g) => {
  if (g.startsWith('A')) return '#aaff00';
  if (g.startsWith('B')) return '#a3e635';
  if (g.startsWith('C')) return '#fbbf24';
  if (g.startsWith('D')) return '#fb923c';
  return '#ff2a6d';
};

// Grade an individual player's game by their actual stat line (not their rating).
// Each returns 0-100; calibrated to typical single-game production vs the Beasts.
const gradeQB = (p) => {
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
const gradeRush = (r) => {
  if (!r || r.car === 0) return 73;
  const ypc = r.yds / Math.max(1, r.car);
  let s = 76;
  s += (ypc - 3.8) * 6.5;               // efficiency
  s += (r.yds - 55) * 0.12;            // volume production
  s += r.td * 6.5;                      // TDs
  s += (r.long >= 20 ? 4 : 0);          // explosive run
  return clampN(Math.round(s), 35, 99);
};
const gradeRec = (r) => {
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

function GradeBadge({ grade }) {
  const col = gradeColor(grade);
  return (
    <span className="inline-flex items-center justify-center font-black tabular-nums rounded ml-2 align-middle"
      style={{ color: col, background: `${col}22`, fontSize: '10px', minWidth: 26, padding: '1px 5px', lineHeight: 1.4 }}>
      {grade}
    </span>
  );
}

// Find the source player record (with its prime-era stat block) by the
// name + team + decade that was drafted, so the box score can surface it.
function findSourcePlayer(name, team, dec) {
  return PLAYERS.find(p => p.n === name && p.t === team && p.d === dec)
      || PLAYERS.find(p => p.n === name && p.t === team)
      || PLAYERS.find(p => p.n === name)
      || null;
}

// Per-position stat lines for the popup (prime-era, per-game representative).
function statLinesFor(p) {
  if (!p) return [];
  const s = p.s || {};
  if (p.p === 'QB') return [
    ['Pass Yds/G', s.y], ['Pass TD/G', s.t], ['INT/G', s.i], ['Rating', s.r],
  ];
  if (p.p === 'RB') return [
    ['Rush Yds/G', s.y], ['Yds/Carry', s.c], ['Rec Yds/G', s.r], ['TD/G', s.t],
  ];
  if (p.p === 'WR') return [
    ['Rec Yds/G', s.y], ['Yds/Target', s.p], ['TD/G', s.t], ['Catch %', s.c],
  ];
  if (p.p === 'TE') return [
    ['Rec Yds/G', s.y], ['TD/G', s.t], ['Block Grade', s.b],
  ];
  return [];
}

function PlayerStatPopup({ name, team, dec, onClose }) {
  const p = findSourcePlayer(name, team, dec);
  const prof = p ? deriveProfile(p) : null;
  const lines = prof ? Object.entries(prof.derived) : [];
  const pos = p ? p.p : null;
  const accent = pos && POS_HEX[pos] ? POS_HEX[pos].text : C.emerald;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(4,3,8,0.78)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-2xl overflow-hidden"
        style={{ background: C.surface, border: `1.5px solid ${C.borderHi}`, boxShadow: `0 0 36px -6px ${accent}55` }}
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 flex items-start justify-between" style={{ borderBottom: `1px solid ${C.border}`, background: C.surfaceLo }}>
          <div>
            <div className="text-lg font-bold leading-tight" style={{ color: C.text }}>{name}</div>
            <div className="text-[11px] mt-0.5 flex items-center gap-1.5" style={{ color: C.textMuted }}>
              {pos && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase" style={{ background: POS_HEX[pos].bg, color: POS_HEX[pos].text }}>{pos}</span>}
              <span>{team} · {dec}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg shrink-0" style={{ color: C.textMuted }}><X className="w-4 h-4" /></button>
        </div>

        {/* Archetype banner */}
        {prof && prof.archetype && (
          <div className="px-5 py-3" style={{ borderBottom: `1px solid ${C.border}`, background: `${accent}12` }}>
            <div className="text-[9px] font-bold uppercase tracking-widest mb-0.5" style={{ color: C.textDim }}>Archetype</div>
            <div className="text-sm font-bold" style={{ color: accent }}>{prof.archetype}</div>
            <div className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>{prof.archetypeNote}</div>
          </div>
        )}

        <div className="px-5 py-4">
          <div className="text-[9px] font-bold uppercase tracking-widest mb-2" style={{ color: C.textDim }}>Prime-era profile</div>
          {lines.length ? (
            <div className="space-y-1.5">
              {lines.map(([label, val], i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: C.textMuted }}>{label}</span>
                  <span className="text-sm font-bold tabular-nums" style={{ color: accent }}>{val != null ? val : '—'}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs" style={{ color: C.textDim }}>No stat profile found for this player.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CINEMATIC PLAYBACK — elevated broadcast-angle pixel scenes per scoring play.
// Two cameras: FieldCam (angled high sideline view, perspective field, the end
// zone under attack framed in-shot) and KickCam (centered behind the kicker,
// uprights dead-ahead) — modeled on the reference broadcast stills.
// ============================================================

// NFL team colors (factual) keyed by the 2025 franchise codes the roster uses.
// { j: jersey, t: trim/number, h: helmet }
const TEAM_COLORS = {
  ARI: { j: '#97233f', t: '#ffb612', h: '#97233f' }, ATL: { j: '#a71930', t: '#000000', h: '#000000' },
  BAL: { j: '#241773', t: '#9e7c0c', h: '#241773' }, BUF: { j: '#00338d', t: '#c60c30', h: '#00338d' },
  CAR: { j: '#0085ca', t: '#101820', h: '#101820' }, CHI: { j: '#0b162a', t: '#c83803', h: '#0b162a' },
  CIN: { j: '#fb4f14', t: '#000000', h: '#000000' }, CLE: { j: '#311d00', t: '#ff3c00', h: '#ff3c00' },
  DAL: { j: '#003594', t: '#869397', h: '#003594' }, DEN: { j: '#fb4f14', t: '#002244', h: '#002244' },
  DET: { j: '#0076b6', t: '#b0b7bc', h: '#0076b6' }, GB: { j: '#203731', t: '#ffb612', h: '#203731' },
  HOU: { j: '#03202f', t: '#a71930', h: '#03202f' }, IND: { j: '#002c5f', t: '#ffffff', h: '#002c5f' },
  JAX: { j: '#006778', t: '#d7a22a', h: '#101820' }, KC: { j: '#e31837', t: '#ffb81c', h: '#e31837' },
  LAC: { j: '#0080c6', t: '#ffc20e', h: '#0080c6' }, LAR: { j: '#003594', t: '#ffd100', h: '#003594' },
  LV: { j: '#000000', t: '#a5acaf', h: '#000000' }, MIA: { j: '#008e97', t: '#fc4c02', h: '#008e97' },
  MIN: { j: '#4f2683', t: '#ffc62f', h: '#4f2683' }, NE: { j: '#002244', t: '#c60c30', h: '#002244' },
  NO: { j: '#101820', t: '#d3bc8d', h: '#d3bc8d' }, NYG: { j: '#0b2265', t: '#a71930', h: '#0b2265' },
  NYJ: { j: '#125740', t: '#ffffff', h: '#125740' }, PHI: { j: '#004c54', t: '#a5acaf', h: '#004c54' },
  PIT: { j: '#101820', t: '#ffb612', h: '#101820' }, SF: { j: '#aa0000', t: '#b3995d', h: '#aa0000' },
  SEA: { j: '#002244', t: '#69be28', h: '#002244' }, TB: { j: '#d50a0a', t: '#34302b', h: '#34302b' },
  TEN: { j: '#0c2340', t: '#4b92db', h: '#0c2340' }, WAS: { j: '#5a1414', t: '#ffb612', h: '#5a1414' },
};
const teamColors = (code) => TEAM_COLORS[code] || { j: '#1a5e34', t: '#d6ff6a', h: '#123f24' };
// End-zone wordmarks per franchise — the scene paints the end zone under
// attack with the hero's team brand, like a real broadcast.
const TEAM_NICKS = {
  ARI: 'CARDINALS', ATL: 'FALCONS', BAL: 'RAVENS', BUF: 'BILLS', CAR: 'PANTHERS',
  CHI: 'BEARS', CIN: 'BENGALS', CLE: 'BROWNS', DAL: 'COWBOYS', DEN: 'BRONCOS',
  DET: 'LIONS', GB: 'PACKERS', HOU: 'TEXANS', IND: 'COLTS', JAX: 'JAGUARS',
  KC: 'CHIEFS', LAC: 'CHARGERS', LAR: 'RAMS', LV: 'RAIDERS', MIA: 'DOLPHINS',
  MIN: 'VIKINGS', NE: 'PATRIOTS', NO: 'SAINTS', NYG: 'GIANTS', NYJ: 'JETS',
  PHI: 'EAGLES', PIT: 'STEELERS', SF: '49ERS', SEA: 'SEAHAWKS', TB: 'BUCS',
  TEN: 'TITANS', WAS: 'COMMANDERS',
};
const teamNick = (code) => TEAM_NICKS[code] || 'CONTENDERS';

// Look up a drafted player's skin-tone hex from the characterization map (set by
// the user in the editor). Falls back to a neutral mid-tone when unset.
function skinHexFor(name) {
  try {
    if (_charCache && _charCache[name] && _charCache[name].skin != null) {
      return SKIN_TONES[_charCache[name].skin].hex;
    }
  } catch (e) {}
  return '#b07a4a';
}

const _shade = (hex, amt) => {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 255) + amt, b = (n & 255) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
};

// Deterministic crowd so it doesn't reshuffle on every React render.
function crowdRects(seed, w, y0, h, bands) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const cols = ['#3a4070', '#4a3a60', '#5a4a40', '#6a5a4a', '#2f3a55', '#4a5d3a', '#5d6b46', '#445566'];
  const out = [];
  const bh = h / bands;
  for (let band = 0; band < bands; band++) {
    const yb = y0 + band * bh, density = Math.round((w / 3) * (0.9 + band * 0.16));
    for (let i = 0; i < density; i++) {
      const x = Math.floor(rnd() * w), y = yb + Math.floor(rnd() * (bh - 1));
      const c = cols[Math.floor(rnd() * cols.length)], ww = rnd() < 0.5 ? 2 : 3;
      out.push(<rect key={`c${band}-${i}`} x={x} y={y} width={ww} height="2" fill={c} />);
    }
  }
  return out;
}

// Seeded pseudo game-situation per event (down & distance, play clock, wind) —
// the sim doesn't track these, so the HUD derives believable, stable values.
function situFor(e) {
  const sd = (((e.drive || 1) * 7919) ^ ((e.q || 1) * 104729)) >>> 0;
  const t = e.type || '';
  const playClk = ':' + String(5 + (sd % 18)).padStart(2, '0');
  const wind = 2 + (sd % 11);
  const isTD = t.indexOf('TD') !== -1;
  const isKick = t === 'FG' || t === 'FG_MISS' || t === 'BEAST_FG' || t === 'PUNT';
  let dnd, clockSub;
  if (isTD) {
    const spot = e.yard != null ? Math.round(e.yard) : 1 + (sd % 9);
    dnd = '1ST & ' + (spot <= 9 ? 'GOAL' : '10');
    clockSub = spot <= 50 ? 'BALL ON ' + spot : 'OWN ' + (100 - spot);
  } else if (isKick) {
    dnd = '4TH & ' + (2 + (sd % 8));
    clockSub = Math.round(e.yard || 40) + ' YARD FG ATTEMPT';
  } else if (t === 'DOWNS' || t === 'BEAST_SAFETY') {
    dnd = '4TH & ' + (1 + (sd % 3));
    clockSub = dnd;
  } else {
    const dn = 1 + (sd % 3);
    dnd = (dn === 1 ? '1ST' : dn === 2 ? '2ND' : '3RD') + ' & ' + (3 + (sd % 8));
    clockSub = dnd;
  }
  return { dnd, clockSub, playClk, wind };
}

// ----------------------------------------------------------------
// PERSPECTIVE CAMERA (FieldCam): u = 0..1 across the visible field,
// v = 0..1 depth (0 = back sideline, 1 = bottom of frame). Returns screen
// {x, y, s}: the field fans wider toward the viewer and sprites scale with
// depth, which is what sells the elevated broadcast angle.
// ----------------------------------------------------------------
const FCAM = { top: 56, bot: 244, tl: 14, tw: 348, bl: -95, bw: 560, exp: 1.3 };
function fcam(u, v) {
  const w = Math.pow(Math.max(0, Math.min(1, v)), FCAM.exp);
  const xt = FCAM.tl + u * FCAM.tw;
  const xb = FCAM.bl + u * FCAM.bw;
  return { x: xt + (xb - xt) * w, y: FCAM.top + (FCAM.bot - FCAM.top) * w, s: 0.34 + 0.42 * w };
}
const _pts = (arr) => arr.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
// A quad covering u0..u1 across the full depth of the field.
function fieldQuad(u0, u1) {
  return _pts([fcam(u0, 0), fcam(u1, 0), fcam(u1, 1), fcam(u0, 1)]);
}

// ----------------------------------------------------------------
// Small SVG-string sprites for the new chrome (back-view kick unit, sideline
// photographers, refs, helmet badge). Built from chunky rects to match the
// pixel-grid art style.
// ----------------------------------------------------------------
function helmetIconSVG(shell, mask, letter) {
  // Side-view helmet badge for the ticker / banner, facing right.
  return '<g>'
    + '<rect x="1" y="3" width="16" height="11" rx="5" fill="' + shell + '"/>'
    + '<rect x="2" y="4" width="13" height="3" rx="1.5" fill="' + _shade(shell, 26) + '"/>'
    + '<rect x="13" y="9" width="7" height="2" fill="#dfe3ee"/>'
    + '<rect x="13" y="12" width="6" height="2" fill="#dfe3ee"/>'
    + '<rect x="15" y="7" width="2" height="8" fill="#dfe3ee"/>'
    + '<rect x="1" y="9" width="2" height="4" fill="' + _shade(shell, -30) + '"/>'
    + (letter ? '<text x="8" y="11.5" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="700" font-size="7" fill="' + mask + '">' + letter + '</text>' : '')
    + '</g>';
}
function photogSVG(jacket) {
  // Kneeling sideline photographer with a long lens, pointed at the field.
  return '<g>'
    + '<rect x="0" y="3" width="5" height="6" fill="' + jacket + '"/>'
    + '<rect x="0.5" y="0" width="3.5" height="3" rx="1" fill="#5a4632"/>'
    + '<rect x="4" y="3.5" width="5" height="2" fill="#16161e"/>'
    + '<rect x="8" y="3" width="2.5" height="3" fill="#23232e"/>'
    + '<rect x="1" y="9" width="6" height="2" fill="#1a1d2c"/>'
    + '</g>';
}
function refStandSVG() {
  return '<g>'
    + '<rect x="0" y="3" width="5" height="9" fill="#e8e8ee"/>'
    + '<rect x="0" y="4.4" width="5" height="1.5" fill="#16161e"/>'
    + '<rect x="0" y="7.4" width="5" height="1.5" fill="#16161e"/>'
    + '<rect x="1" y="0" width="3" height="3" rx="1" fill="#caa275"/>'
    + '<rect x="0.4" y="12" width="1.8" height="3" fill="#16161e"/>'
    + '<rect x="2.8" y="12" width="1.8" height="3" fill="#16161e"/>'
    + '</g>';
}
// Ref under the uprights: arms shoot up on a good kick (SMIL one-shot).
function refSignalSVG(armsBegin) {
  const arms = armsBegin != null
    ? '<g opacity="0">'
      + '<animate attributeName="opacity" values="0;1" dur="0.12s" begin="' + armsBegin + 's" fill="freeze"/>'
      + '<rect x="-2" y="-4" width="2" height="6" fill="#e8e8ee"/><rect x="6" y="-4" width="2" height="6" fill="#e8e8ee"/>'
      + '</g>'
    : '';
  return '<g>'
    + '<rect x="0.5" y="3" width="5" height="9" fill="#e8e8ee"/>'
    + '<rect x="0.5" y="4.4" width="5" height="1.5" fill="#16161e"/>'
    + '<rect x="0.5" y="7.4" width="5" height="1.5" fill="#16161e"/>'
    + '<rect x="1.5" y="0" width="3" height="3" rx="1" fill="#8a5a32"/>'
    + '<rect x="0.9" y="12" width="1.8" height="3" fill="#16161e"/>'
    + '<rect x="3.3" y="12" width="1.8" height="3" fill="#16161e"/>'
    + arms
    + '</g>';
}
// Long-snapper / linemen seen from BEHIND in a crouched stance (kick cam).
function backLinemanSVG(j, helm, skin, pants) {
  const jd = _shade(j, -26), pd = pants || _shade(j, -44);
  return '<g>'
    + '<rect x="2" y="0" width="8" height="6" rx="2.5" fill="' + helm + '"/>'
    + '<rect x="3" y="0.6" width="6" height="1.6" rx="0.8" fill="' + _shade(helm, 30) + '"/>'
    + '<rect x="0" y="5" width="12" height="7" rx="2" fill="' + j + '"/>'
    + '<rect x="0" y="10" width="12" height="2" fill="' + jd + '"/>'
    + '<rect x="1" y="12" width="10" height="5" rx="2" fill="' + pd + '"/>'
    + '<rect x="0.6" y="16" width="3.4" height="6" fill="' + skin + '"/>'
    + '<rect x="8" y="16" width="3.4" height="6" fill="' + skin + '"/>'
    + '<rect x="0.2" y="21" width="4.2" height="2.4" fill="#16161e"/>'
    + '<rect x="7.6" y="21" width="4.2" height="2.4" fill="#16161e"/>'
    + '</g>';
}
// Kicker seen from behind — number on the back, plant arm out, soccer-style
// swing handled by the scene's rotate animation.
function backKickerSVG(j, trim, helm, skin, num) {
  const jd = _shade(j, -26);
  return '<g>'
    + '<rect x="5" y="0" width="9" height="8" rx="3" fill="' + helm + '"/>'
    + '<rect x="6" y="1" width="7" height="2" rx="1" fill="' + _shade(helm, 30) + '"/>'
    + '<rect x="2" y="8" width="15" height="13" rx="2.5" fill="' + j + '"/>'
    + '<rect x="2" y="18" width="15" height="3" fill="' + jd + '"/>'
    + '<rect x="0" y="9" width="3" height="8" fill="' + j + '"/>'
    + '<rect x="-0.5" y="16" width="3" height="3" fill="' + skin + '"/>'
    + '<rect x="16" y="9" width="3" height="6" fill="' + j + '"/>'
    + '<rect x="16.5" y="14.6" width="2.6" height="2.6" fill="' + skin + '"/>'
    + '<text x="9.5" y="17" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="700" font-size="8.5" fill="' + trim + '">' + (num || '3') + '</text>'
    + '<rect x="3" y="21" width="13" height="5" rx="2" fill="' + _shade(j, -48) + '"/>'
    + '<rect x="4" y="25" width="4.4" height="10" fill="' + skin + '"/>'
    + '<rect x="11" y="25" width="4.4" height="10" fill="' + skin + '"/>'
    + '<rect x="4" y="31" width="4.4" height="4" fill="#f2f0f8"/>'
    + '<rect x="11" y="31" width="4.4" height="4" fill="#f2f0f8"/>'
    + '<rect x="3.4" y="35" width="5.4" height="3" fill="#16161e"/>'
    + '<rect x="10.6" y="35" width="5.4" height="3" fill="#16161e"/>'
    + '</g>';
}
// Holder kneeling, ball spotted upright in front (kick cam, viewed from behind).
function backHolderSVG(j, helm, skin) {
  const jd = _shade(j, -26);
  return '<g>'
    + '<rect x="3" y="0" width="7" height="6" rx="2.5" fill="' + helm + '"/>'
    + '<rect x="1.5" y="5" width="10" height="9" rx="2" fill="' + j + '"/>'
    + '<rect x="1.5" y="12" width="10" height="2" fill="' + jd + '"/>'
    + '<rect x="2" y="14" width="9" height="4" rx="1.5" fill="' + _shade(j, -44) + '"/>'
    + '<rect x="1" y="17.6" width="11" height="2.6" fill="#16161e"/>'
    + '<rect x="10.5" y="8" width="6" height="2.4" fill="' + skin + '"/>'
    + '</g>';
}
// Upright spotted ball for the hold (laces out, of course).
function spottedBallSVG() {
  return '<g>'
    + '<rect x="0" y="0" width="4.6" height="9.5" rx="2.3" fill="#9c5520"/>'
    + '<rect x="0.6" y="0.6" width="1.6" height="8" rx="0.8" fill="#7a3f16"/>'
    + '<rect x="3" y="2.5" width="1" height="4.5" fill="#f4ead0"/>'
    + '</g>';
}
// Orange LED yardage board mounted in the stands (kick cam flavor).
function ledBoardSVG(num) {
  return '<g>'
    + '<rect x="0" y="0" width="24" height="14" rx="2" fill="#0d0b14" stroke="#2a2348" stroke-width="1"/>'
    + '<text x="12" y="10.8" text-anchor="middle" font-family="Oswald, sans-serif" font-weight="700" font-size="9.5" fill="#ff9d1f" letter-spacing="1">' + num + '</text>'
    + '</g>';
}

// ----------------------------------------------------------------
// Shared motion helpers — MiniG places a sprite string with depth scale;
// Move wraps children in a one-shot translate (nested non-additive SMIL).
// ----------------------------------------------------------------
function MiniG({ x, y, s, flip, html, op }) {
  return <g opacity={op || 1} transform={'translate(' + x + ',' + y + ') scale(' + (flip ? -s : s) + ',' + s + ')'} dangerouslySetInnerHTML={{ __html: html }} />;
}
// Cubic-bezier easing presets for SMIL keySplines. `in` accelerates from a
// stop, `out` decelerates into a stop, `inout` does both, `burst` is an
// explosive jump-start that settles — all far more physical than linear glide.
const EASE = {
  in: '0.45 0 0.9 0.35',
  out: '0.1 0.7 0.25 1',
  inout: '0.42 0 0.58 1',
  burst: '0.12 0.8 0.4 1',
  lead: '0.3 0 0.4 1',
};
function Move({ to, dur, begin, ease, children }) {
  const sp = EASE[ease];
  return (
    <g>
      <animateTransform
        attributeName="transform" type="translate"
        values={'0 0; ' + to} dur={dur || '2.2s'} begin={begin || '0s'} fill="freeze"
        calcMode={sp ? 'spline' : undefined} keyTimes={sp ? '0;1' : undefined} keySplines={sp || undefined}
      />
      {children}
    </g>
  );
}
function DustTrail({ x, y, flip }) {
  const d = flip ? 1 : -1;
  return (
    <g>
      {[0, 1, 2].map(i => (
        <rect key={i} x={x + d * (8 + i * 7)} y={y - 2} width="3" height="3" rx="1" fill="#cfe8c0" opacity="0">
          <animate attributeName="opacity" values="0;0.5;0" dur="0.6s" begin={(i * 0.2) + 's'} repeatCount="indefinite" />
          <animateTransform attributeName="transform" type="translate" values={'0 0; ' + (d * 6) + ' -4'} dur="0.6s" begin={(i * 0.2) + 's'} repeatCount="indefinite" />
        </rect>
      ))}
    </g>
  );
}
function ImpactRing({ x, y, begin }) {
  return (
    <circle cx={x} cy={y} r="3" fill="none" stroke="#f4f0ff" strokeWidth="2" opacity="0">
      <animate attributeName="opacity" values="0;0.9;0" keyTimes="0;0.15;1" dur="0.55s" begin={begin || '0.55s'} fill="freeze" />
      <animate attributeName="r" values="3;15" dur="0.55s" begin={begin || '0.55s'} fill="freeze" />
    </circle>
  );
}
function Shadow({ cx, cy, rx, ry }) {
  return <ellipse cx={cx} cy={cy} rx={rx} ry={ry || 3.4} fill="#08130a" opacity="0.36" />;
}
// Ball flying along an arc path, spinning end over end, one-shot. `shrink`
// scales it down over the flight so it reads as traveling away from camera.
function FlightBall({ path, dur, begin, shrink }) {
  return (
    <g>
      <animateMotion path={path} dur={dur || '1.2s'} begin={begin || '0.15s'} fill="freeze"
        calcMode="spline" keyTimes="0;1" keySplines="0.2 0.5 0.5 1" />
      <g>
        {shrink && <animateTransform attributeName="transform" type="scale" values="1;0.45" dur={dur || '1.2s'} begin={begin || '0.15s'} fill="freeze" />}
        <g>
          <animateTransform attributeName="transform" type="rotate" values="0;360" dur="0.5s" repeatCount="indefinite" />
          <rect x="-5" y="-3" width="10" height="6" rx="3" fill="#9c5520" />
          <rect x="-4" y="-3" width="8" height="2" rx="1" fill="#5e3210" />
          <rect x="-2" y="-1" width="4" height="1" fill="#f4ead0" />
        </g>
      </g>
    </g>
  );
}
function Confetti() {
  const colors = ['#aaff00', '#ffd400', '#00e5ff', '#ff2a6d'];
  const bits = [];
  for (let i = 0; i < 16; i++) {
    const x = 22 + (i * 211) % 318;
    const delay = ((i * 37) % 20) / 10;
    const dur = 2.0 + ((i * 13) % 12) / 10;
    bits.push(
      <rect key={i} x={x} y="2" width="2.5" height="2.5" fill={colors[i % 4]} opacity="0.9">
        <animateTransform attributeName="transform" type="translate" values={'0 0; ' + ((i % 3) - 1) * 14 + ' 110'} dur={dur + 's'} begin={delay + 's'} repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.9;0.9;0" keyTimes="0;0.1;0.7;1" dur={dur + 's'} begin={delay + 's'} repeatCount="indefinite" />
      </rect>
    );
  }
  return <g>{bits}</g>;
}
function SpeedStreaks({ x, y, flip }) {
  const d = flip ? -1 : 1;
  return (
    <g stroke="#eef4ff" strokeWidth="1.4" strokeLinecap="round">
      <animate attributeName="opacity" values="0.12;0.4;0.12" dur="0.7s" repeatCount="indefinite" />
      <line x1={x - 28 * d} y1={y - 10} x2={x - 10 * d} y2={y - 10} />
      <line x1={x - 34 * d} y1={y - 1} x2={x - 13 * d} y2={y - 1} />
      <line x1={x - 25 * d} y1={y + 8} x2={x - 8 * d} y2={y + 8} />
    </g>
  );
}
// Crowd camera flashes popping at random spots in the stands.
function FlashPops({ spots }) {
  return (
    <g fill="#ffffff">
      {spots.map((f, i) => (
        <rect key={i} x={f[0]} y={f[1]} width="2.5" height="2.5">
          <animate attributeName="opacity" values="0;0;1;0;0" keyTimes="0;0.42;0.5;0.58;1" dur="2.6s" begin={f[2]} repeatCount="indefinite" />
        </rect>
      ))}
    </g>
  );
}
const EXTRA_SKINS = ['#8a5a32', '#6e4020', '#b07a4a', '#5a3318'];
// One engaged blocker-vs-rusher pair, depth-scaled, with trench jitter.
// swap = the Beasts are the ones blocking (possession flipped).
function TrenchPair({ x, y, s, swap, jersey, jShadow, trim, helmet, defJ, defS, defH, ska, skb }) {
  const blockJ = swap ? defJ : jersey, blockT = swap ? '#c9ccd8' : trim, blockH = swap ? defH : helmet;
  const rushJ = swap ? jersey : defJ, rushH = swap ? helmet : defH;
  const a = ska || EXTRA_SKINS[0], b = skb || EXTRA_SKINS[1];
  return (
    <g>
      <ellipse cx={x + 8 * s} cy={y + 30 * s} rx={26 * s} ry={3.4 * s + 1} fill="#08130a" opacity="0.3" />
      <animateTransform attributeName="transform" type="translate" values="0 0; 1.4 0.4; 0 0; -1.4 -0.4; 0 0" dur="1.1s" repeatCount="indefinite" />
      <MiniG x={x - 6 * s} y={y} s={s} flip={swap} html={stuffedSVG(blockJ, _shade(blockJ, -30), blockT, blockH, a, _shade(a, -30), blockT)} />
      <MiniG x={x + 14 * s} y={y - 1} s={s} flip={!swap} html={chaserSVG(rushJ, _shade(rushJ, -30), rushH, b, _shade(b, -30))} />
    </g>
  );
}

// ----------------------------------------------------------------
// HUD — broadcast chrome shared by both cameras.
// ----------------------------------------------------------------
// Broadcast scorebox — a single TV-style score bug that sits along the BOTTOM,
// directly above the result banner, so the score, clock, and down/distance are
// all in one place near where the eye already is. Layout: [CON | score] —
// [quarter/clock + down/dist] — [score | BST], colored accents per team.
function BroadcastScore({ event, situ }) {
  const isBeast = (event.type || '').startsWith('BEAST');
  const scores = (event.pts || 0) > 0;
  const conCol = '#aaff00', bstCol = '#ff2a6d';
  // ~30% of the 360-wide stage, centered. x: 125..235 (w=110).
  const x = 125, w = 110, y = 174, h = 26, cx = x + w / 2;
  return (
    <g>
      {/* compact bug, centered */}
      <rect x={x} y={y} width={w} height={h} rx="4" fill="#0a0814" stroke="#2a2348" strokeWidth="1.3" opacity="0.97" />
      {/* team accent edges */}
      <rect x={x} y={y} width="4" height={h} rx="2" fill={conCol} />
      <rect x={x + w - 4} y={y} width="4" height={h} rx="2" fill={bstCol} />
      {/* score row: CON 24 · 17 BST */}
      <text x={x + 9} y={y + 12} fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="8" fill={conCol} letterSpacing="0.5">CON</text>
      <text x={x + 38} y={y + 13} textAnchor="end" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="13" fill="#f4f0ff">{event.yourScore != null ? event.yourScore : 0}</text>
      <text x={cx} y={y + 12} textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="8" fill="#4a4468">–</text>
      <text x={x + w - 38} y={y + 13} fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="13" fill="#f4f0ff">{event.beastScore != null ? event.beastScore : 0}</text>
      <text x={x + w - 9} y={y + 12} textAnchor="end" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="8" fill={bstCol} letterSpacing="0.5">BST</text>
      {/* possession arrow under the team with the ball */}
      <path d={!isBeast ? 'M ' + (x + 7) + ' ' + (y + 19) + ' l 4 2 l -4 2 Z' : 'M ' + (x + w - 7) + ' ' + (y + 19) + ' l -4 2 l 4 2 Z'} fill="#ffd400" />
      {/* clock + down/distance row */}
      <line x1={x + 6} y1={y + 15.5} x2={x + w - 6} y2={y + 15.5} stroke="#221d3a" strokeWidth="0.8" />
      <text x={cx} y={y + 23} textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="8" fill="#ffd400" letterSpacing="0.8">{`${event.q}Q ${event.clock}  ·  ${situ.dnd}`}</text>
      {/* brief score flash on the scoring side */}
      {scores && (
        <rect x={isBeast ? x + w / 2 : x} y={y} width={w / 2} height={h} rx="3" fill={isBeast ? bstCol : conCol} opacity="0">
          <animate attributeName="opacity" values="0;0.3;0;0.3;0" dur="1.1s" begin="0.35s" fill="freeze" />
        </rect>
      )}
    </g>
  );
}
function ScoreBoard({ event, situ }) {
  const isBeast = (event.type || '').startsWith('BEAST');
  const scores = (event.pts || 0) > 0;
  return (
    <g>
      <rect x="6" y="6" width="96" height="46" rx="3" fill="#06050c" stroke="#2a2348" strokeWidth="1.5" />
      {scores && (
        <rect x="7" y={isBeast ? 21 : 7} width="94" height="14" rx="2" fill={isBeast ? '#ff2a6d' : '#aaff00'} opacity="0">
          <animate attributeName="opacity" values="0;0.45;0;0.45;0" dur="1.1s" begin="0.35s" fill="freeze" />
        </rect>
      )}
      <rect x="6" y="7" width="3.5" height="14" fill="#aaff00" />
      <rect x="6" y="21" width="3.5" height="14" fill="#ff2a6d" />
      {/* possession arrow on the side with the ball */}
      <path d={isBeast ? 'M 1 26 L 5 28 L 1 30 Z' : 'M 1 12 L 5 14 L 1 16 Z'} fill="#ffd400" />
      <text x="14" y="18" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="9" fill="#aaff00" letterSpacing="0.5">CON</text>
      <text x="96" y="18" textAnchor="end" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="11" fill="#f4f0ff">{event.yourScore != null ? event.yourScore : 0}</text>
      <text x="14" y="32" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="9" fill="#ff2a6d" letterSpacing="0.5">BST</text>
      <text x="96" y="32" textAnchor="end" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="11" fill="#f4f0ff">{event.beastScore != null ? event.beastScore : 0}</text>
      <line x1="7" y1="37" x2="101" y2="37" stroke="#221d3a" strokeWidth="1" />
      <text x="14" y="47" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="7" fill="#cfd0e2" letterSpacing="0.8">{situ.dnd}</text>
      <text x="96" y="47" textAnchor="end" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="7" fill="#7f7a99" letterSpacing="0.8">{situ.playClk}</text>
    </g>
  );
}
function ClockPanel({ event, situ }) {
  return (
    <g>
      <rect x="246" y="6" width="108" height="32" rx="3" fill="#06050c" stroke="#ffd400" strokeWidth="1.5" />
      <text x="300" y="21" textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="12" fill="#ffd400" letterSpacing="1.5">{`${event.q}Q ${event.clock}`}</text>
      <line x1="252" y1="25" x2="348" y2="25" stroke="#2a2348" strokeWidth="1" />
      <text x="300" y="34" textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="7" fill="#f4f0ff" letterSpacing="1.2">{situ.clockSub}</text>
    </g>
  );
}
function WindChip({ mph }) {
  return (
    <g>
      <rect x="284" y="42" width="70" height="16" rx="3" fill="#06050c" stroke="#2a2348" strokeWidth="1" opacity="0.95" />
      <text x="292" y="53" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="7" fill="#7f7a99" letterSpacing="1">WIND</text>
      <path d="M 316 47 L 321 50 L 316 53 Z" fill="#cfd0e2" />
      <text x="325" y="53" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="7" fill="#f4f0ff" letterSpacing="0.6">{mph} MPH</text>
    </g>
  );
}
// On-field down & distance chip, like the broadcast pennant on the turf.
function DnDPill({ x, y, situ }) {
  return (
    <g transform={'translate(' + x + ',' + y + ')'} opacity="0">
      <animate attributeName="opacity" values="0;0.96" dur="0.3s" begin="0.1s" fill="freeze" />
      <path d="M 0 8 L 8 0 L 96 0 L 96 16 L 8 16 Z" fill="#0a0d14" opacity="0.92" />
      <path d="M 13 4.5 L 19 8 L 13 11.5 Z" fill="#aaff00" />
      <text x="24" y="11.5" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="8.5" fill="#e9f7d0" letterSpacing="1">{situ.dnd}</text>
      <text x="88" y="11.5" textAnchor="end" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="8" fill="#86c50f" letterSpacing="0.5">{situ.playClk}</text>
    </g>
  );
}
// Replay progress dots — lime for your scores, magenta for Beasts, dim rest.
function ProgressDots({ events, idx, right, y }) {
  if (!events || !events.length) return null;
  const n = events.length;
  const gap = n > 12 ? Math.max(5, 84 / n) : 7;
  return (
    <g>
      {events.map((e, i) => {
        const scored = (e.type || '').indexOf('TD') !== -1 || e.type === 'FG';
        const beast = (e.type || '').startsWith('BEAST');
        const col = beast ? '#ff2a6d' : scored ? '#aaff00' : '#4a4468';
        const cx = right - (n - 1 - i) * gap;
        return <circle key={i} cx={cx} cy={y} r={i === idx ? 3 : 2} fill={col} opacity={i === idx ? 1 : i < idx ? 0.85 : 0.4} />;
      })}
    </g>
  );
}
// ----------------------------------------------------------------
// One standardized lower-third used by EVERY replay scenario. Same height,
// width, margin, radius, padding, and type hierarchy every time — only the
// team accent color changes. Title line + one descriptive sentence.
// ----------------------------------------------------------------
function ResultBanner({ event, accent, helmet, mask, letter, begin }) {
  const B = bannerFor(event);
  const sub = captionFor(event) || '';
  // Static: the banner is simply present from the start, no slide/fade each time.
  return (
    <g>
      <rect x="10" y="202" width="340" height="32" rx="5" fill="#06050c" stroke={accent} strokeWidth="1.5" opacity="0.97" />
      <rect x="10" y="202" width="4" height="32" rx="2" fill={accent} />
      <g transform="translate(21,207) scale(0.95)" dangerouslySetInnerHTML={{ __html: helmetIconSVG(helmet, mask, letter) }} />
      <text x="44" y="217" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="13" fill="#f4f0ff" letterSpacing="1">{B.word}</text>
      <text x="44" y="229" fontFamily="Oswald, sans-serif" fontWeight="600" fontSize="8.5" fill="#b9bbd0" letterSpacing="0.3">{sub.length > 62 ? sub.slice(0, 60) + '…' : sub}</text>
    </g>
  );
}

// ----------------------------------------------------------------
// FIELD CAM — elevated angled broadcast view. side='right' frames the right
// end zone (Contenders attacking); side='left' frames the left (Beasts).
// ----------------------------------------------------------------
function FieldChrome({ side, jersey, trim, mark, drive }) {
  const right = side !== 'left';
  const uG = right ? 0.78 : 0.22;          // goal line
  const uB = right ? 1.1 : -0.1;           // back of the end zone (bleeds off)
  // yard lines marching away from the goal line
  const lines = [];
  for (let k = 1; k <= 8; k++) {
    const u = right ? uG - k * 0.115 : uG + k * 0.115;
    if (u < -0.05 || u > 1.05) break;
    lines.push(u);
  }
  const ezTint = _shade(jersey, -28);
  const post = { x: right ? 342 : 18, y: 104 };
  const pyl1 = fcam(uG, 0.015), pyl2 = fcam(uG, 0.96);
  const wm = { x: right ? 334 : 26, y: 152 };
  const numV = 0.84;
  const nums = right ? ['2 0', '3 0', '4 0'] : ['4 0', '3 0', '2 0'];
  const numUs = right ? [uG - 0.46, uG - 0.575, uG - 0.69].reverse() : [uG + 0.46, uG + 0.575, uG + 0.69];
  return (
    <g>
      {/* sky + crowd */}
      <rect x="0" y="0" width="360" height="42" fill="url(#csky)" />
      <rect x="0" y="4" width="360" height="38" fill="#161a30" />
      <g>{crowdRects((drive || 1) * 2654435761, 360, 0, 40, 5)}</g>
      <FlashPops spots={[[44, 24, '0s'], [104, 36, '0.7s'], [168, 18, '1.3s'], [222, 32, '0.4s'], [292, 26, '1.7s'], [130, 38, '2.1s']]} />
      {/* stadium light banks */}
      {[112, 218].map((lx, i) => (
        <g key={i}>
          <rect x={lx + 7} y="4" width="3" height="12" fill="#0d1024" />
          <rect x={lx} y="0" width="17" height="7" rx="1.5" fill="#181c38" stroke="#2a2f55" strokeWidth="0.8" />
          <g fill="#fff8d8">
            {[0, 1, 2, 3].map(c => <rect key={c} x={lx + 2 + c * 4} y="1.5" width="2.5" height="1.8" />)}
            {[0, 1, 2, 3].map(c => <rect key={'b' + c} x={lx + 2 + c * 4} y="4.2" width="2.5" height="1.8" />)}
          </g>
          <circle cx={lx + 8.5} cy="3.5" r="11" fill="#fff8d8" opacity="0.08" />
        </g>
      ))}
      {/* stadium wall + sideline row */}
      <rect x="0" y="40" width="360" height="16" fill="#14172e" />
      <rect x="0" y="40" width="360" height="1.6" fill="#2a2f55" />
      {/* photographers + staff kneeling along the wall */}
      <g>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => {
          const px = 14 + i * 40;
          return i % 3 === 1
            ? <g key={i} transform={'translate(' + px + ',45) scale(' + (right ? 1 : -1) + ',1)'} dangerouslySetInnerHTML={{ __html: photogSVG(i % 2 ? '#2e3548' : '#37412e') }} />
            : <g key={i} transform={'translate(' + px + ',44)'}><rect x="0" y="3" width="4" height="7" fill={i % 2 ? '#222838' : '#2e3548'} /><rect x="0.4" y="0" width="3.2" height="3" rx="1" fill="#5a4632" /></g>;
        })}
        <g transform="translate(150,42)" dangerouslySetInnerHTML={{ __html: refStandSVG() }} />
        {/* chain crew + down marker near the goal-line side */}
        <g transform={'translate(' + (right ? 268 : 76) + ',41)'}>
          <rect x="0" y="2" width="2" height="13" fill="#ff8a00" /><rect x="-3" y="0" width="8" height="5" rx="2" fill="#ff8a00" />
          <text x="1" y="4.2" textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="4" fill="#0a0d14">1</text>
          <rect x="14" y="2" width="2" height="13" fill="#ff8a00" /><path d="M 12 0 L 18 6 M 18 0 L 12 6" stroke="#ff8a00" strokeWidth="1.6" />
        </g>
      </g>
      {/* the field, fanned in perspective */}
      <polygon points={_pts([fcam(-0.1, 0), fcam(1.1, 0), fcam(1.1, 1), fcam(-0.1, 1)])} fill="url(#cgrass)" />
      {/* mow stripes between yard lines */}
      {lines.map((u, i) => {
        if (i % 2 === 0) return null;
        const u2 = lines[i - 1];
        return <polygon key={'st' + i} points={fieldQuad(Math.min(u, u2), Math.max(u, u2))} fill="#ffffff" opacity="0.05" />;
      })}
      {/* end zone */}
      <polygon points={fieldQuad(Math.min(uG, uB), Math.max(uG, uB))} fill={ezTint} opacity="0.82" />
      <g stroke={_shade(jersey, -6)} strokeWidth="2" opacity="0.22">
        {[0.12, 0.36, 0.6, 0.84].map((v, i) => {
          const a = fcam(right ? uG + 0.04 : uB + 0.04, v), b = fcam(right ? uB - 0.02 : uG - 0.04, v + 0.14);
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}
      </g>
      {/* yard lines + goal line + pylons */}
      <g stroke="#dfe7df" strokeWidth="1.2" opacity="0.5">
        {lines.map((u, i) => { const a = fcam(u, 0), b = fcam(u, 1); return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />; })}
      </g>
      {(() => { const a = fcam(uG, 0), b = fcam(uG, 1); return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#fff" strokeWidth="2" opacity="0.75" />; })()}
      <rect x={pyl1.x - 2} y={pyl1.y - 8} width="4" height="9" fill="#ff8a00" />
      <rect x={pyl1.x - 2} y={pyl1.y - 8} width="4" height="2.5" fill="#ffac4d" />
      <rect x={pyl2.x - 2.6} y={pyl2.y - 11} width="5.2" height="11" fill="#ff8a00" />
      <rect x={pyl2.x - 2.6} y={pyl2.y - 11} width="5.2" height="3" fill="#ffac4d" />
      {/* hash marks, two perspective rows */}
      <g stroke="#dfe7df" strokeWidth="1" opacity="0.26">
        {lines.map((u, i) => {
          const m1 = fcam(u + (right ? 0.057 : -0.057), 0.34), m2 = fcam(u + (right ? 0.057 : -0.057), 0.6);
          return <g key={i}><line x1={m1.x} y1={m1.y} x2={m1.x + 4} y2={m1.y} /><line x1={m2.x} y1={m2.y} x2={m2.x + 5} y2={m2.y} /></g>;
        })}
      </g>
      {/* yard numbers along the near side */}
      <g fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="11" fill="#dfe7df" opacity="0.3">
        {numUs.map((u, i) => { const p = fcam(u, numV); return <text key={i} x={p.x} y={p.y} transform={'skewX(-5)'}>{nums[i]}</text>; })}
      </g>
      {/* gooseneck goal post at the BACK of the end zone */}
      <g>
        <rect x={post.x - 6} y={post.y - 4} width="13" height="7" rx="2" fill="#d9b400" />
        <path d={'M ' + post.x + ' ' + (post.y - 3) + ' L ' + post.x + ' ' + (post.y - 26) + ' Q ' + post.x + ' ' + (post.y - 40) + ' ' + (post.x + (right ? -4 : 4)) + ' ' + (post.y - 44)} stroke="#f4d000" strokeWidth="4" fill="none" strokeLinecap="round" />
        <line x1={post.x - 28} y1={post.y - 43} x2={post.x + 28} y2={post.y - 45} stroke="#f4d000" strokeWidth="4" strokeLinecap="round" />
        <line x1={post.x - 27} y1={post.y - 44} x2={post.x - 27} y2={post.y - 76} stroke="#f4d000" strokeWidth="3.6" strokeLinecap="round" />
        <line x1={post.x + 27} y1={post.y - 46} x2={post.x + 27} y2={post.y - 78} stroke="#f4d000" strokeWidth="3.6" strokeLinecap="round" />
        <rect x={post.x - 29} y={post.y - 78} width="4.4" height="4.4" fill="#ff3030" />
        <rect x={post.x + 25} y={post.y - 80} width="4.4" height="4.4" fill="#ff3030" />
      </g>
    </g>
  );
}

// ----------------------------------------------------------------
// FIELD-CAM SCENES. Coordinates come from fcam(u, v), so every sprite scales
// with depth and motion vectors follow the perspective toward the end zone.
//
// FIELD-LOGIC CONSTRAINTS (every scene must respect these — NFL believability):
//   1. The Contenders attack the RIGHT end zone; the Beasts attack LEFT.
//   2. Ball-carrier motion vectors point toward the attacking end zone.
//   3. Touchdowns END with the ball across the goal line INTO the drawn end
//      zone; the TD catch is made IN the end zone, never mid-field.
//   4. The trench battle sits BEHIND the ball relative to the attack.
//   5. The QB is in the backfield, BEHIND his protection. Defenders converge
//      on the ball, never away from it.
// ----------------------------------------------------------------
function FieldScene({ event, jersey, jShadow, trim, helmet, skin, skinShadow, sock, defJ, defS, defH }) {
  const t = event.type || '';
  const isBeast = t.startsWith('BEAST');
  // ---------------------------------------------------------------
  // DIRECTION. Offense attacks RIGHT (dir=+1) when the Contenders have the
  // ball, LEFT (dir=-1) when the Beasts do. Every coordinate below is written
  // in OFFENSE-RELATIVE terms and mapped through `dir`, so one set of routes /
  // blocks / pursuit paths mirrors cleanly for either possession.
  // ---------------------------------------------------------------
  const dir = isBeast ? -1 : 1;
  const ez = isBeast ? 0.20 : 0.80;           // u of the goal line being attacked
  const los = ez - dir * 0.34;                // line of scrimmage, ~34% back
  // field point: prog = downfield progress (0 = LOS, 1 = goal line, can exceed),
  // lat = across the field (0 = top sideline .. 1 = bottom sideline).
  const fp = (prog, lat) => fcam(los + dir * prog * 0.34, lat);
  // a screen-space delta between two field points, for <Move to=...>
  const dlt = (a, b) => (b.x - a.x).toFixed(1) + ' ' + (b.y - a.y).toFixed(1);
  // sprites are authored facing +u (right); when attacking left they face -u.
  const faceFwd = dir < 0;          // pass `flip` to offensive sprites to face them downfield
  const faceBack = dir > 0;         // defenders (pre-mirrored to face left) need flip when D faces left

  // possession kit (offense) — Contenders blue or Beasts dark red, per dir.
  const oJ = jersey, oT = trim, oH = helmet, oShd = jShadow, oSk = skin, oSkS = skinShadow, oSock = sock;
  // defense kit — the OTHER team's colors (red when you attack, blue when the
  // Beasts attack). Passed in as defJ/defH/defS from CinematicScene.
  const dJ = defJ, dH = defH, dShd = defS, dT = '#e8edf6';

  // ---- seeded variation pick (stable per drive/quarter) ----
  const _vseed = (((event.drive || 1) * 2246822519) ^ ((event.q || 1) * 3266489917)) >>> 0;
  const yd = event.yard || 0;
  // distance bucket still informs which variation reads best, but each play
  // type defines its own 3 variations and falls back to the seed.
  const pick3 = yd > 0 ? (yd < 8 ? 0 : yd < 22 ? 1 : 2) : (_vseed % 3);

  // ===============================================================
  // SPRITE PLACEMENT HELPERS (offense-relative)
  // ===============================================================
  // Offensive skill/však player at (prog,lat). `cyc` = running cycle, else set/stand.
  const Off = ({ prog, lat, cyc, lean, sc = 1, k }) => {
    const p = fp(prog, lat);
    const html = cyc ? runCycleSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)
                     : receiverSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock, true);
    return (
      <g key={k}>
        <Shadow cx={p.x} cy={p.y + 26 * p.s} rx={10 * p.s + 3} />
        <MiniG x={p.x} y={p.y} s={p.s * sc} flip={faceFwd} html={html} />
      </g>
    );
  };
  // Defender at (prog,lat). `cyc` = pursuit cycle, else a set/dive defenderSVG.
  const Def = ({ prog, lat, cyc, sc = 1, sk = EXTRA_SKINS[2], k }) => {
    const p = fp(prog, lat);
    const html = cyc ? chaseCycleSVG(dJ, dShd, dH, sk, _shade(sk, -30))
                     : defenderSVG(dJ, dShd, dH, sk, _shade(sk, -30), dT);
    // defenderSVG is pre-mirrored to face LEFT (toward a right-attacking O).
    // chaseCycle faces +u (right). Flip each so it faces the offense.
    const fl = cyc ? (dir > 0 ? false : true) : (dir > 0 ? false : true);
    return (
      <g key={k}>
        <Shadow cx={p.x} cy={p.y + 26 * p.s} rx={10 * p.s + 3} />
        <MiniG x={p.x} y={p.y} s={p.s * sc} flip={cyc ? (dir < 0) : (dir < 0)} html={html} />
      </g>
    );
  };

  // ---- FORMATIONS (offense-relative lateral positions) ----
  // Clean 5-man line: constant prog (at the LOS), evenly spread across the
  // middle of the field in `lat`. This renders as a believable line of
  // scrimmage in the perspective cam (a line of constant field-depth).
  const OL_LATS = [0.36, 0.43, 0.50, 0.57, 0.64];
  const OLine = ({ prog = 0, fire = 0, beginFire = '0.45s' }) => (
    <>
      {OL_LATS.map((lat, i) => {
        const a = fp(prog, lat);
        const b = fire ? fp(prog + fire, lat) : null;
        const body = (
          <>
            <Shadow cx={a.x} cy={a.y + 26 * a.s} rx={11 * a.s + 3} />
            <MiniG x={a.x} y={a.y} s={a.s} flip={faceFwd} html={blockerSVG(oJ, oShd, oT, oH, EXTRA_SKINS[i % 4], _shade(EXTRA_SKINS[i % 4], -30), oSock)} />
          </>
        );
        return fire
          ? <Move key={'ol' + i} to={dlt(a, b)} dur="0.55s" begin={beginFire} ease="burst">{body}</Move>
          : <g key={'ol' + i}>{body}</g>;
      })}
    </>
  );
  // Defensive line: just across the LOS from the OL, slightly staggered gaps.
  const DLine = ({ prog = 0.06, push = 0, lats = [0.40, 0.50, 0.60] }) => (
    <>
      {lats.map((lat, i) => {
        const a = fp(prog, lat);
        const b = push ? fp(prog - push, lat) : null;   // push = driven back toward LOS
        const body = (
          <>
            <Shadow cx={a.x} cy={a.y + 26 * a.s} rx={11 * a.s + 3} />
            <MiniG x={a.x} y={a.y} s={a.s} flip={dir < 0} html={blockerSVG(dJ, dShd, dT, dH, EXTRA_SKINS[(i + 1) % 4], _shade(EXTRA_SKINS[(i + 1) % 4], -30), _shade(dJ, 16))} />
          </>
        );
        return push
          ? <Move key={'dl' + i} to={dlt(a, b)} dur="0.6s" begin="0.42s" ease="out">{body}</Move>
          : <g key={'dl' + i}>{body}</g>;
      })}
    </>
  );

  // QB set point (shotgun depth behind center)
  const QBset = ({ prog = -0.16, lat = 0.5, html, sc = 1.04, k }) => {
    const p = fp(prog, lat);
    return (
      <g key={k}>
        <Shadow cx={p.x} cy={p.y + 26 * p.s} rx={12 * p.s + 3} />
        <MiniG x={p.x} y={p.y} s={p.s * sc} flip={faceFwd} html={html} />
      </g>
    );
  };

  // dotted ball arc between two field points, with a peak height
  const arcPath = (a, b, h) => 'M ' + a.x + ' ' + (a.y - 8) + ' Q ' + ((a.x + b.x) / 2) + ' ' + (Math.min(a.y, b.y) - h) + ' ' + b.x + ' ' + (b.y - 8);

  // ===============================================================
  // PASSING TOUCHDOWN — 3 variations: 0 slant, 1 corner/fade, 2 screen
  // ===============================================================
  if (t === 'PASS_TD' || (isBeast && t === 'BEAST_TD' && (_vseed % 2 === 0))) {
    const qbHtml = passerSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock);
    const qb = fp(-0.16, 0.5);
    let catchP, route, db, throwBegin = '0.85s', catchBegin = '1.15s', arcDur = '0.85s', arcH = 46;
    if (pick3 === 0) {
      // QUICK SLANT — receiver from the right slot breaks in, catches at ~12 yds, runs in.
      const start = fp(0.05, 0.30); catchP = fp(0.45, 0.46); const ezP = fp(1.02, 0.52);
      db = fp(0.5, 0.40); arcH = 24; throwBegin = '0.75s'; arcDur = '0.45s'; catchBegin = '1.2s';
      route = (
        <>
          {/* slot receiver releases at the snap, breaks to the catch point as the ball arrives (1.2s) */}
          <Move to={dlt(start, catchP)} dur="0.8s" begin="0.4s" ease="inout">
            <Off prog={0.05} lat={0.30} cyc />
          </Move>
          {/* catch-and-run: accelerate out of the break upfield into the end zone */}
          <Move to={dlt(catchP, ezP)} dur="1.25s" begin="1.2s" ease="in">
            <SpeedStreaks x={catchP.x} y={catchP.y} flip={dir < 0} />
            <Shadow cx={catchP.x} cy={catchP.y + 26 * catchP.s} rx={11 * catchP.s + 3} />
            <MiniG x={catchP.x} y={catchP.y} s={catchP.s * 1.05} flip={faceFwd} html={runCycleSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} />
          </Move>
          {/* trailing corner gives chase a beat late */}
          <Move to={dlt(db, fp(0.82, 0.5))} dur="1.6s" begin="1.25s" ease="in"><Def prog={0.5} lat={0.40} cyc sk={EXTRA_SKINS[3]} /></Move>
        </>
      );
    } else if (pick3 === 1) {
      // CORNER / FADE — split-wide receiver up the sideline, catches in the back corner.
      const start = fp(0.05, 0.80); catchP = fp(0.92, 0.86); db = fp(0.7, 0.80);
      arcH = 56; throwBegin = '1.0s'; arcDur = '1.1s'; catchBegin = '2.1s';
      route = (
        <>
          {/* receiver releases at the snap and climbs the sideline, decelerating into the corner */}
          <Move to={dlt(start, catchP)} dur="1.7s" begin="0.4s" ease="out">
            <Off prog={0.05} lat={0.80} cyc />
          </Move>
          {/* the leaping catch appears exactly when the ball lands (2.1s) */}
          <g opacity="0"><animate attributeName="opacity" values="0;1" begin="2.1s" dur="0.01s" fill="freeze" />
            <Shadow cx={catchP.x} cy={catchP.y + 27 * catchP.s} rx={11 * catchP.s + 3} />
            <MiniG x={catchP.x} y={catchP.y} s={catchP.s * 1.05} flip={faceFwd} html={receiverSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} />
          </g>
          {/* corner trailing on the outside, beaten */}
          <Move to={dlt(db, fp(0.9, 0.80))} dur="1.8s" begin="0.6s" ease="inout"><Def prog={0.7} lat={0.80} cyc sk={EXTRA_SKINS[3]} /></Move>
        </>
      );
    } else {
      // DEEP SEAM (TE/WR up the middle) — catch over the top in the end zone.
      const start = fp(0.05, 0.40); catchP = fp(0.96, 0.46); db = fp(0.78, 0.34);
      arcH = 72; throwBegin = '1.1s'; arcDur = '1.2s'; catchBegin = '2.3s';
      route = (
        <>
          {/* receiver streaks up the seam, easing into the catch point */}
          <Move to={dlt(start, catchP)} dur="1.9s" begin="0.4s" ease="out">
            <Off prog={0.05} lat={0.40} cyc />
          </Move>
          {/* catch over the top, synced to the ball landing (2.3s) */}
          <g opacity="0"><animate attributeName="opacity" values="0;1" begin="2.3s" dur="0.01s" fill="freeze" />
            <Shadow cx={catchP.x} cy={catchP.y + 27 * catchP.s} rx={11 * catchP.s + 3} />
            <MiniG x={catchP.x} y={catchP.y} s={catchP.s * 1.05} flip={faceFwd} html={receiverSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} />
          </g>
          {/* deep safety beaten over the top */}
          <Move to={dlt(db, fp(0.92, 0.42))} dur="1.9s" begin="0.5s" ease="inout"><Def prog={0.78} lat={0.34} cyc sk={EXTRA_SKINS[1]} /></Move>
        </>
      );
    }
    const arc = arcPath(qb, catchP, arcH);
    return (
      <>
        {/* downfield safety + second receiver to fill the picture */}
        <Def prog={0.62} lat={0.16} sk={EXTRA_SKINS[1]} sc={0.95} />
        <Off prog={0.18} lat={0.18} cyc sc={0.95} />
        {/* clean line of scrimmage, pass protection holding */}
        <OLine prog={0} />
        <DLine prog={0.07} lats={[0.40, 0.50, 0.60]} />
        {/* back chipping / staying in to block */}
        <Off prog={-0.02} lat={0.66} sc={0.95} />
        <QBset prog={-0.16} lat={0.5} html={qbHtml} />
        {/* the throw */}
        <path d={arc} stroke="#f4f0ff" strokeWidth="1.5" strokeDasharray="2.5 5" fill="none" opacity="0.36" />
        <FlightBall path={arc} dur={arcDur} begin={throwBegin} shrink />
        {route}
        <Confetti />
      </>
    );
  }

  // ===============================================================
  // RUSHING TOUCHDOWN — 3 variations: 0 inside dive, 1 outside stretch, 2 cutback
  // ===============================================================
  if (t === 'RUSH_TD' || (isBeast && t === 'BEAST_TD')) {
    const rbStart = fp(-0.14, 0.42);
    let lanePath, holeLat;
    if (pick3 === 0) {
      // INSIDE RUN (A-gap) — straight through the middle behind the line.
      holeLat = 0.50;
      lanePath = [fp(-0.14, 0.42), fp(0.1, 0.5), fp(0.55, 0.5), fp(1.04, 0.5)];
    } else if (pick3 === 1) {
      // OUTSIDE STRETCH — bounce to the sideline then up the edge.
      holeLat = 0.66;
      lanePath = [fp(-0.14, 0.42), fp(0.06, 0.62), fp(0.45, 0.74), fp(1.04, 0.74)];
    } else {
      // CUTBACK — start one way, cut back across the grain to the backside.
      holeLat = 0.40;
      lanePath = [fp(-0.14, 0.5), fp(0.12, 0.64), fp(0.5, 0.36), fp(1.04, 0.34)];
    }
    // build a 3-segment move chain following the lane
    const seg = (a, b) => dlt(a, b);
    const L = lanePath;
    return (
      <>
        {/* second-level defenders pursuing toward the runner's lane (a beat after the snap) */}
        <Move to={dlt(fp(0.42, 0.18), fp(0.8, holeLat))} dur="1.9s" begin="0.7s" ease="in"><Def prog={0.42} lat={0.18} cyc sk={EXTRA_SKINS[3]} /></Move>
        <Move to={dlt(fp(0.5, 0.84), fp(0.85, holeLat + 0.05))} dur="1.9s" begin="0.8s" ease="in"><Def prog={0.5} lat={0.84} cyc sk={EXTRA_SKINS[2]} /></Move>
        {/* deep safety as the last line of defense */}
        <Def prog={0.7} lat={holeLat} sk={EXTRA_SKINS[1]} sc={0.95} />
        {/* offensive line fires forward into run blocks */}
        <OLine prog={0} fire={0.06} beginFire="0.4s" />
        <DLine prog={0.07} push={0.03} lats={[0.40, 0.50, 0.60]} />
        {/* a lead blocker pulls through the hole ahead of the back */}
        <Move to={dlt(fp(0.0, holeLat), fp(0.45, holeLat))} dur="1.0s" begin="0.45s" ease="out"><Off prog={0.0} lat={holeLat} cyc sc={1.0} /></Move>
        {/* QB hands off then watches */}
        <QBset prog={-0.16} lat={0.52} html={runnerSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} sc={0.98} />
        {/* the back: hold for the handoff, BURST into the hole, cruise the second
            level, then accelerate to daylight — three eased segments, no glide. */}
        <Move to={seg(L[0], L[1])} dur="0.45s" begin="0.45s" ease="burst">
          <g>
            <Move to={seg(L[1], L[2])} dur="0.75s" begin="0.45s" ease="inout">
              <g>
                <Move to={seg(L[2], L[3])} dur="0.95s" begin="0.75s" ease="in">
                  <SpeedStreaks x={L[0].x} y={L[0].y} flip={dir < 0} />
                  <DustTrail x={L[0].x} y={L[0].y + 22 * L[0].s} flip={dir < 0} />
                  <Shadow cx={L[0].x} cy={L[0].y + 27 * L[0].s} rx={12 * L[0].s + 3} />
                  <MiniG x={L[0].x} y={L[0].y} s={L[0].s * 1.08} flip={faceFwd} html={runCycleSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} />
                </Move>
              </g>
            </Move>
          </g>
        </Move>
        <Confetti />
      </>
    );
  }

  // ===============================================================
  // TURNOVER ON DOWNS — 3 variations: 0 stuffed run, 1 incomplete, 2 tackle short
  // Shows the line-to-gain so the FAILURE is visible.
  // ===============================================================
  if (t === 'DOWNS') {
    const gain = fp(0.5, 0.5);            // line-to-gain marker (the stick)
    const gainTop = fp(0.5, 0.06), gainBot = fp(0.5, 0.96);
    const marker = (
      <g>
        <line x1={gainTop.x} y1={gainTop.y} x2={gainBot.x} y2={gainBot.y} stroke="#ffd400" strokeWidth="1.4" strokeDasharray="3 4" opacity="0.8" />
        <text x={fp(0.5, 0.5).x} y={fp(0.5, 0.5).y - 10} textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="6.5" fill="#ffd400" opacity="0.9" letterSpacing="1">LINE TO GAIN</text>
      </g>
    );
    if (pick3 === 1) {
      // INCOMPLETE on 4th down — pass sails past a covered receiver short of the stick.
      const qb = fp(-0.16, 0.5), tgt = fp(0.4, 0.66), past = fp(0.62, 0.7);
      const arc = arcPath(qb, past, 38);
      return (
        <>
          {marker}
          <Def prog={0.45} lat={0.66} sk={EXTRA_SKINS[3]} sc={0.95} />
          <OLine prog={0} />
          <DLine prog={0.07} lats={[0.40, 0.50, 0.60]} />
          {/* covered receiver works to the spot as the ball is in the air */}
          <Move to={dlt(fp(0.18, 0.66), tgt)} dur="0.9s" begin="0.4s" ease="inout"><Off prog={0.18} lat={0.66} cyc sc={0.95} /></Move>
          <QBset prog={-0.16} lat={0.5} html={passerSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} />
          <path d={arc} stroke="#f4f0ff" strokeWidth="1.4" strokeDasharray="2.5 5" fill="none" opacity="0.3">
            <animate attributeName="opacity" values="0.3;0.3;0" keyTimes="0;0.6;1" dur="2.2s" fill="freeze" />
          </path>
          <FlightBall path={arc} dur="0.85s" begin="1.0s" />
          {/* incomplete: ball hits the turf past the marker, "X" flashes as it lands */}
          <g opacity="0"><animate attributeName="opacity" values="0;0;1" keyTimes="0;0.84;0.88" dur="2.2s" fill="freeze" />
            <text x={past.x} y={past.y} textAnchor="middle" fontFamily="Oswald, sans-serif" fontWeight="700" fontSize="13" fill="#ff2a6d">✕</text>
          </g>
        </>
      );
    }
    // STUFFED / TACKLE SHORT — runner met short of the stick by the defense.
    const stopP = pick3 === 2 ? fp(0.36, 0.58) : fp(0.28, 0.5);
    const rbStart = fp(-0.12, 0.46);
    return (
      <>
        {marker}
        <OLine prog={0} fire={0.04} beginFire="0.4s" />
        <DLine prog={0.07} push={-0.02} lats={[0.40, 0.50, 0.60]} />
        {/* defenders converging hard on the stop point */}
        <Move to={dlt(fp(0.5, 0.2), stopP)} dur="0.8s" begin="0.55s" ease="in"><Def prog={0.5} lat={0.2} cyc sk={EXTRA_SKINS[3]} /></Move>
        <Move to={dlt(fp(0.5, 0.82), stopP)} dur="0.8s" begin="0.6s" ease="in"><Def prog={0.5} lat={0.82} cyc sk={EXTRA_SKINS[2]} /></Move>
        <QBset prog={-0.16} lat={0.5} html={runnerSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} sc={0.96} />
        {/* the back: bursts off the snap, meets the wall, then is rocked back (stuffed) */}
        <Move to={dlt(rbStart, stopP)} dur="0.7s" begin="0.45s" ease="out">
          <g>
            <Shadow cx={rbStart.x} cy={rbStart.y + 27 * rbStart.s} rx={12 * rbStart.s + 3} />
            <g><animate attributeName="opacity" values="1;0" begin="1.15s" dur="0.01s" fill="freeze" />
              <MiniG x={rbStart.x} y={rbStart.y} s={rbStart.s * 1.06} flip={faceFwd} html={runCycleSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} /></g>
            <g opacity="0"><animate attributeName="opacity" values="0;1" begin="1.15s" dur="0.01s" fill="freeze" />
              {/* slight backward jolt on contact */}
              <animateTransform attributeName="transform" type="translate" values={'0 0; ' + (-dir * 4) + ' 1'} dur="0.25s" begin="1.15s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.2 0.7 0.3 1" />
              <MiniG x={rbStart.x} y={rbStart.y} s={rbStart.s * 1.06} flip={faceFwd} html={stuffedSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} /></g>
          </g>
        </Move>
        <ImpactRing x={stopP.x} y={stopP.y} begin="1.15s" />
      </>
    );
  }

  // ===============================================================
  // TURNOVERS via INT / FUM (Beasts take it the other way) — keep readable.
  // ===============================================================
  if (t === 'INT') {
    const qb = fp(-0.16, 0.5), tgt = fp(0.42, 0.6), pickP = fp(0.5, 0.56);
    const arc = arcPath(qb, pickP, 40);
    return (
      <>
        <OLine prog={0} />
        <DLine prog={0.07} lats={[0.40, 0.50, 0.60]} />
        <Off prog={0.42} lat={0.6} sc={0.95} />
        <QBset prog={-0.16} lat={0.5} html={passerSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} />
        <path d={arc} stroke="#f4f0ff" strokeWidth="1.4" strokeDasharray="2.5 5" fill="none" opacity="0.3">
          <animate attributeName="opacity" values="0.3;0.3;0" keyTimes="0;0.5;1" dur="2.3s" fill="freeze" />
        </path>
        <FlightBall path={arc} dur="0.75s" begin="0.85s" />
        {/* the defender jumps the route and accelerates it back the OTHER way (−dir) */}
        <Move to={dlt(pickP, fcam(los + dir * 0.5 * 0.34 - dir * 0.5, 0.62))} dur="1.7s" begin="1.6s" ease="in">
          <SpeedStreaks x={pickP.x} y={pickP.y} flip={dir > 0} />
          <Shadow cx={pickP.x} cy={pickP.y + 27 * pickP.s} rx={12 * pickP.s + 3} />
          <MiniG x={pickP.x} y={pickP.y} s={pickP.s * 1.05} flip={dir > 0} html={runCycleSVG(dJ, dShd, dT, dH, EXTRA_SKINS[0], _shade(EXTRA_SKINS[0], -30), _shade(dJ, 16))} />
        </Move>
      </>
    );
  }
  if (t === 'FUM') {
    const ball = fp(0.18, 0.52), rb = fp(0.04, 0.46), beast = fp(0.32, 0.4);
    return (
      <>
        <OLine prog={0} fire={0.04} beginFire="0.4s" />
        <DLine prog={0.07} lats={[0.40, 0.50, 0.60]} />
        <g transform={'translate(' + ball.x + ',' + ball.y + ') scale(' + (ball.s * 1.6) + ')'} dangerouslySetInnerHTML={{ __html: looseBallSVG() }} />
        <ImpactRing x={ball.x} y={ball.y} begin="0.4s" />
        {/* the back lunging after the loose ball */}
        <Move to={dlt(rb, fp(0.12, 0.5))} dur="1.0s" begin="0.45s" ease="out">
          <Shadow cx={rb.x} cy={rb.y + 26 * rb.s} rx={11 * rb.s + 3} />
          <MiniG x={rb.x} y={rb.y} s={rb.s * 1.05} flip={faceFwd} html={reachBackSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} />
        </Move>
        {/* a Beast accelerating in to recover it */}
        <Move to={dlt(beast, fp(0.24, 0.48))} dur="0.85s" begin="0.5s" ease="in">
          <Shadow cx={beast.x} cy={beast.y + 27 * beast.s} rx={13 * beast.s + 3} />
          <MiniG x={beast.x} y={beast.y} s={beast.s * 1.12} flip={dir < 0} html={defenderSVG(dJ, dShd, dH, EXTRA_SKINS[1], _shade(EXTRA_SKINS[1], -30), _shade(dJ, 16))} />
        </Move>
      </>
    );
  }

  // ===============================================================
  // BEAST_SAFETY — runner swallowed in his own end zone.
  // ===============================================================
  if (t === 'BEAST_SAFETY') {
    const pile = fp(-0.02, 0.5);
    return (
      <>
        <OLine prog={0.02} />
        <DLine prog={-0.04} push={-0.03} lats={[0.40, 0.50, 0.60]} />
        <Move to={dlt(fp(0.18, 0.3), pile)} dur="0.8s" begin="0.45s" ease="in"><Def prog={0.18} lat={0.3} cyc sk={EXTRA_SKINS[3]} /></Move>
        <g>
          <Shadow cx={pile.x} cy={pile.y + 26 * pile.s} rx={12 * pile.s + 3} />
          <MiniG x={pile.x} y={pile.y} s={pile.s} flip={faceFwd} html={stuffedSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} />
        </g>
        <ImpactRing x={pile.x} y={pile.y} begin="0.6s" />
      </>
    );
  }

  // ===============================================================
  // GENERIC TD FALLBACK — short score up the middle.
  // ===============================================================
  const gStart = fp(0.2, 0.5), gEz = fp(1.02, 0.5);
  return (
    <>
      <Def prog={0.6} lat={0.36} sk={EXTRA_SKINS[1]} sc={0.95} />
      <OLine prog={0} fire={0.05} beginFire="0.35s" />
      <DLine prog={0.07} push={0.02} lats={[0.40, 0.50, 0.60]} />
      <Move to={dlt(gStart, gEz)} dur="1.4s" begin="0.5s" ease="in">
        <SpeedStreaks x={gStart.x} y={gStart.y} flip={dir < 0} />
        <Shadow cx={gStart.x} cy={gStart.y + 27 * gStart.s} rx={12 * gStart.s + 3} />
        <MiniG x={gStart.x} y={gStart.y} s={gStart.s * 1.06} flip={faceFwd} html={runCycleSVG(oJ, oShd, oT, oH, oSk, oSkS, oSock)} />
      </Move>
      <Confetti />
    </>
  );
}

// ----------------------------------------------------------------
// KICK CAM — centered behind the kicker, uprights dead ahead. Handles FG,
// FG_MISS, BEAST_FG and PUNT with team-appropriate kits and accents.
// ----------------------------------------------------------------
function KickScene({ event, jersey, trim, helmet, skin, defJ, defS, defH, isBeast }) {
  const t = event.type;
  const miss = t === 'FG_MISS';
  const punt = t === 'PUNT';
  const situ = situFor(event);
  const accent = isBeast ? '#ff2a6d' : miss ? '#ff8a00' : '#aaff00';
  // kit: the kicking unit IS the offense (jersey/helmet/trim already carry the
  // correct team identity from CinematicScene); the rushers are the defense.
  const kJ = jersey, kH = helmet, kT = trim;
  const dJ = defJ, dH = defH;
  const yard = event.yard || 40;
  // ball flight: good = up the middle through the posts; miss = pushed right
  const goodPath = 'M 187 192 Q 184 110 181 50';
  const missPath = 'M 187 192 Q 210 104 254 58';
  const path = miss ? missPath : punt ? 'M 187 196 Q 180 60 176 16' : goodPath;
  const segs = 12, fillSegs = miss ? 11 : Math.max(6, Math.min(11, Math.round((yard - 18) / 3.2)));
  const lo = 30, hi = 55;
  const mk = Math.max(0.04, Math.min(0.96, (yard - lo + 4) / (hi - lo + 8)));
  return (
    <g>
      {/* night sky + wraparound crowd */}
      <rect x="0" y="0" width="360" height="14" fill="#0b0e20" />
      <g fill="#f4f0ff" opacity="0.8"><rect x="38" y="4" width="1.5" height="1.5" /><rect x="132" y="7" width="1.5" height="1.5" /><rect x="246" y="3" width="1.5" height="1.5" /><rect x="318" y="8" width="1.5" height="1.5" /><rect x="196" y="5" width="1.2" height="1.2" /></g>
      <rect x="0" y="13" width="360" height="54" fill="url(#csky)" />
      <rect x="0" y="16" width="360" height="51" fill="#161a30" />
      <g>{crowdRects(((event.drive || 1) + 7) * 2654435761, 360, 13, 53, 4)}</g>
      <FlashPops spots={[[52, 30, '0.2s'], [142, 44, '0.9s'], [232, 24, '1.5s'], [306, 40, '0.5s'], [88, 56, '1.9s']]} />
      {/* light towers flanking the posts */}
      {[78, 252].map((lx, i) => (
        <g key={i}>
          <rect x={lx + 7} y="16" width="3" height="10" fill="#0d1024" />
          <rect x={lx} y="12" width="17" height="7" rx="1.5" fill="#181c38" stroke="#2a2f55" strokeWidth="0.8" />
          <g fill="#fff8d8">
            {[0, 1, 2, 3].map(c => <rect key={c} x={lx + 2 + c * 4} y="13.5" width="2.5" height="1.8" />)}
            {[0, 1, 2, 3].map(c => <rect key={'b' + c} x={lx + 2 + c * 4} y="16.2" width="2.5" height="1.8" />)}
          </g>
          <circle cx={lx + 8.5} cy="15.5" r="10" fill="#fff8d8" opacity="0.09" />
        </g>
      ))}
      {/* wall + sideline staff + LED yardage boards */}
      <rect x="0" y="66" width="360" height="14" fill="#14172e" />
      <rect x="0" y="66" width="360" height="1.6" fill="#2a2f55" />
      <g>
        {[0, 1, 2, 3, 4, 5, 6, 7].map(i => {
          const px = 20 + i * 46;
          return px > 140 && px < 220 ? null : (i % 3 === 1
            ? <g key={i} transform={'translate(' + px + ',70)'} dangerouslySetInnerHTML={{ __html: photogSVG(i % 2 ? '#2e3548' : '#37412e') }} />
            : <g key={i} transform={'translate(' + px + ',69)'}><rect x="0" y="3" width="4" height="7" fill={i % 2 ? '#222838' : '#2e3548'} /><rect x="0.4" y="0" width="3.2" height="3" rx="1" fill="#5a4632" /></g>);
        })}
      </g>
      {/* end zone band + goal line */}
      <rect x="0" y="80" width="360" height="38" fill="#173f20" />
      <rect x="0" y="117" width="360" height="2.4" fill="#dfe7df" opacity="0.8" />
      {/* field in down-the-barrel perspective: lines compress toward the EZ */}
      <rect x="0" y="119" width="360" height="121" fill="url(#cgrass)" />
      <g stroke="#dfe7df" strokeWidth="1.2" opacity="0.45">
        {[127, 138, 153, 172, 195, 222].map((y, i) => <line key={i} x1="0" y1={y} x2="360" y2={y} />)}
      </g>
      {/* mow stripes */}
      <rect x="0" y="138" width="360" height="15" fill="#ffffff" opacity="0.045" />
      <rect x="0" y="172" width="360" height="23" fill="#ffffff" opacity="0.045" />
      {/* center hashes */}
      <g stroke="#dfe7df" strokeWidth="1" opacity="0.3">
        {[131, 144, 161, 182, 207].map((y, i) => <g key={i}><line x1="167" y1={y} x2="167" y2={y + 3} /><line x1="193" y1={y} x2="193" y2={y + 3} /></g>)}
      </g>
      {/* perspective yard numbers down both sidelines */}
      <g fontFamily="Oswald, sans-serif" fontWeight="700" fill="#dfe7df" opacity="0.28">
        <text x="30" y="150" fontSize="9" transform="skewY(4)">1 0</text>
        <text x="312" y="172" fontSize="9" transform="skewY(-4)">1 0</text>
        <text x="22" y="196" fontSize="12" transform="skewY(5)">2 0</text>
        <text x="316" y="222" fontSize="12" transform="skewY(-5)">2 0</text>
      </g>
      {/* pylons */}
      <rect x="2" y="108" width="4.5" height="10" fill="#ff8a00" /><rect x="2" y="108" width="4.5" height="2.6" fill="#ffac4d" />
      <rect x="353.5" y="108" width="4.5" height="10" fill="#ff8a00" /><rect x="353.5" y="108" width="4.5" height="2.6" fill="#ffac4d" />
      {/* GOAL POSTS, dead center */}
      <g>
        <rect x="174" y="106" width="12" height="7" rx="2" fill="#d9b400" />
        <rect x="178" y="86" width="4" height="22" fill="#f4d000" />
        <rect x="129" y="84" width="102" height="3.5" rx="1.5" fill="#f4d000" />
        <rect x="129" y="12" width="3.5" height="74" fill="#f4d000" />
        <rect x="227.5" y="12" width="3.5" height="74" fill="#f4d000" />
        <path d="M 132.5 13 L 142 16 L 132.5 19 Z" fill="#ff3030" />
        <path d="M 227.5 13 L 218 16 L 227.5 19 Z" fill="#ff3030" />
      </g>
      {/* refs under the uprights — arms up when it's good */}
      <g transform="translate(140,96) scale(0.9)" dangerouslySetInnerHTML={{ __html: refSignalSVG(!miss && !punt ? 1.7 : null) }} />
      <g transform="translate(214,96) scale(0.9)" dangerouslySetInnerHTML={{ __html: refSignalSVG(!miss && !punt ? 1.7 : null) }} />
      {/* protection line from behind, edge rushers crashing */}
      {!punt && (
        <g>
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => {
            const lx = 104 + i * 19, ly = 148 + (i === 4 ? 3 : Math.abs(i - 4) > 2 ? -2 : 0);
            const sk = EXTRA_SKINS[i % 4];
            return <g key={i} transform={'translate(' + lx + ',' + ly + ') scale(0.92)'} dangerouslySetInnerHTML={{ __html: backLinemanSVG(kJ, kH, sk, _shade(kJ, -48)) }} />;
          })}
          {/* defenders crashing the edges */}
          <Move to="14 6" dur="1.1s" begin="0.35s" ease="in">
            <g transform="translate(58,132) scale(1.0)" dangerouslySetInnerHTML={{ __html: backLinemanSVG(dJ, dH, EXTRA_SKINS[2], _shade(dJ, -40)) }} />
          </Move>
          <Move to="-14 6" dur="1.1s" begin="0.35s" ease="in">
            <g transform="translate(292,132) scale(1.0)" dangerouslySetInnerHTML={{ __html: backLinemanSVG(dJ, dH, EXTRA_SKINS[3], _shade(dJ, -40)) }} />
          </Move>
        </g>
      )}
      {/* the hold */}
      {!punt && (
        <g>
          <Shadow cx={208} cy={211} rx={12} ry={3} />
          <g transform="translate(200,189) scale(1.2)" dangerouslySetInnerHTML={{ __html: backHolderSVG(kJ, kH, EXTRA_SKINS[1]) }} />
          <g transform="translate(188,184) scale(1.15)">
            <g dangerouslySetInnerHTML={{ __html: spottedBallSVG() }}>
            </g>
            <animate attributeName="opacity" values="1;1;0" keyTimes="0;0.31;0.33" dur="2.6s" fill="freeze" />
          </g>
        </g>
      )}
      {/* the kicker: two-step approach, plant, swing */}
      <Move to={punt ? '0 0' : '22 11'} dur="0.5s" begin="0.18s">
        <Shadow cx={punt ? 184 : 158} cy={punt ? 216 : 208} rx={14} ry={3.4} />
        <g transform={'translate(' + (punt ? 170 : 140) + ',' + (punt ? 172 : 160) + ') scale(1.32)'}>
          <g>
            <animateTransform attributeName="transform" type="rotate" values="0 10 36; 0 10 36; -10 10 36; 6 10 36" keyTimes="0;0.26;0.34;0.42" dur="2.2s" fill="freeze" />
            <g dangerouslySetInnerHTML={{ __html: backKickerSVG(kJ, kT, kH, skin, 10 + (((event.drive || 1) * 97) % 80)) }} />
          </g>
        </g>
      </Move>
      {/* the kick — ball launches exactly as the leg swings through (≈0.92s) */}
      <path d={path} stroke="#f4f0ff" strokeWidth="1.4" strokeDasharray="2.5 5" fill="none" opacity="0">
        <animate attributeName="opacity" values="0;0.32" dur="0.2s" begin="0.92s" fill="freeze" />
      </path>
      <FlightBall path={path} dur="1.2s" begin="0.92s" shrink />
      {miss && (
        <g fill="#ff2a6d">
          <animate attributeName="opacity" values="0;0;1;0.4;1" keyTimes="0;0.62;0.74;0.86;1" dur="2.4s" fill="freeze" />
          <rect x="247" y="54" width="13" height="3.4" transform="rotate(45 253 56)" />
          <rect x="247" y="54" width="13" height="3.4" transform="rotate(-45 253 56)" />
        </g>
      )}
      {!miss && !punt && (
        <rect x="132" y="14" width="96" height="70" fill={accent} opacity="0">
          <animate attributeName="opacity" values="0;0;0.14;0" keyTimes="0;0.62;0.72;1" dur="2.6s" fill="freeze" />
        </rect>
      )}
    </g>
  );
}

// ----------------------------------------------------------------
// The cinematic scene for a single event. Picks the camera, draws the chrome,
// the sprites, and the HUD. `events`/`idx` feed the in-ticker progress dots.
// ----------------------------------------------------------------
function CinematicScene({ event, events, idx }) {
  const isBeast = (event.type || '').startsWith('BEAST');
  // FIXED TEAM IDENTITIES. The Contenders are ALWAYS the BLUE team and the
  // Beasts are ALWAYS the DARK RED team — on offense or defense. Whoever has
  // the ball wears their own kit; the other team defends in theirs. This keeps
  // each side a constant color instead of the offense always rendering green.
  const CONTENDER_KIT = { j: '#1d4ed8', t: '#bfdbfe', h: '#172a6b' };   // blue
  const BEAST_KIT     = { j: '#7f1420', t: '#f0a8a8', h: '#4a0c14' };   // dark red
  const offKit = isBeast ? BEAST_KIT : CONTENDER_KIT;
  const defKit = isBeast ? CONTENDER_KIT : BEAST_KIT;
  let jersey = offKit.j, trim = offKit.t, helmet = offKit.h;
  const jShadow = _shade(jersey, -30);
  const skin = skinHexFor(event.heroName || event.by || event.passer);
  const skinShadow = _shade(skin, -34);
  const sock = _shade(jersey, 18);
  const defJ = defKit.j, defH = defKit.h, defS = _shade(defKit.j, -28);
  const t = event.type || '';
  const isKick = t === 'FG' || t === 'FG_MISS' || t === 'BEAST_FG' || t === 'PUNT';
  const isTD = t.indexOf('TD') !== -1;
  const situ = situFor(event);
  const accent = isBeast ? '#ff2a6d' : (t === 'FG' || isTD) ? '#aaff00' : t === 'FG_MISS' || t === 'DOWNS' ? '#7f7a99' : (t === 'INT' || t === 'FUM') ? '#ff2a6d' : '#8a93b8';
  const mark = isBeast ? 'BEASTS' : (event.team ? teamNick(event.team) : 'CONTENDERS');

  return (
    <svg viewBox="0 0 360 240" style={{ width: '100%', imageRendering: 'pixelated', borderRadius: 12, border: '1.5px solid #2a2348', boxShadow: '0 0 30px -8px rgba(170,255,0,0.4)', display: 'block', background: '#0b0e20' }}>
      <defs>
        <radialGradient id="btbVig" cx="0.5" cy="0.42" r="0.78">
          <stop offset="62%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.34" />
        </radialGradient>
        <linearGradient id="csky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1a1d3a" /><stop offset="100%" stopColor="#2a2f55" /></linearGradient>
        <linearGradient id="cgrass" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2f7d3a" /><stop offset="100%" stopColor="#24632e" /></linearGradient>
      </defs>

      {isKick ? (
        <KickScene event={event} jersey={jersey} trim={trim} helmet={helmet} skin={skin} defJ={defJ} defS={defS} defH={defH} isBeast={isBeast} />
      ) : (
        <g>
          <FieldChrome side={isBeast || t === 'BEAST_SAFETY' ? 'left' : 'right'} jersey={jersey} trim={trim} mark={mark} drive={event.drive} />
          <FieldScene event={event} jersey={jersey} jShadow={jShadow} trim={trim} helmet={helmet} skin={skin} skinShadow={skinShadow} sock={sock} defJ={defJ} defS={defS} defH={defH} />
          {/* TD flash as the ball crosses the goal line */}
          {isTD && (
            <rect x="0" y="56" width="360" height="184" fill={isBeast ? '#ff2a6d' : '#aaff00'} opacity="0">
              <animate attributeName="opacity" values="0;0;0.22;0" keyTimes="0;0.68;0.76;1" dur="2.7s" fill="freeze" />
            </rect>
          )}
          {/* crowd eruption sparkles on scores */}
          {isTD && (
            <g>
              {[0, 1, 2, 3, 4, 5].map(i => (
                <rect key={i} x={20 + i * 58} y={14 + (i % 3) * 9} width="3" height="3" fill={i % 2 ? '#ffd400' : '#f4f0ff'} opacity="0">
                  <animate attributeName="opacity" values="0;0.95;0" dur="0.5s" begin={(0.2 + i * 0.18) + 's'} repeatCount="4" />
                </rect>
              ))}
            </g>
          )}
        </g>
      )}

      {/* broadcast vignette */}
      <rect x="0" y="0" width="360" height="240" fill="url(#btbVig)" pointerEvents="none" />

      {/* HUD — single broadcast scorebox along the bottom, above the banner */}
      <BroadcastScore event={event} situ={situ} />

      {/* one standardized lower-third for every scenario */}
      <ResultBanner
        event={event}
        accent={accent}
        helmet={isBeast ? '#11182f' : helmet}
        mask={isBeast ? '#ff2a6d' : trim}
        letter={isBeast ? 'B' : 'C'}
        begin={isTD ? 0.62 : 0.3}
      />
    </svg>
  );
}

// ============================================================
// PIXEL-GRID SPRITE SYSTEM — sprites authored as a character map on a fine grid
// (one rect per pixel, horizontal runs merged). Real sprite-art resolution:
// curves, taper, shading. Glyphs map to a per-player palette (team + skin).
// ============================================================
const RUNNER_PIXELS = [
"..........XXXXXXX.............",
".........EEEEEEEEE............",
"........EEEEEEEEEEE...........",
".......ENNEEEEEEEEEe..........",
".......ENNEEEEEEEEEe..........",
".......EEEEEEEEEEEEe..........",
".......EEEEEEEEEEEEe..........",
".......eEEEEEEEEESSSMM........",
".......eEEEEEEEEESSSMM........",
"........eEEEEEEEsSSSMM........",
".........eeeeee.MMMMM.........",
".............ee.MMM...........",
"....LLLLLLLLLLLLLLLLLLLL......",
"...LLLLLLLLLLLLLLLLLLLLLL.....",
"..jLLLLLLLLLLLLLLLLLLLLLj.....",
"..jjJJJJJJJJJJJJJJJJJJJjj.....",
"..jjjJJJJJJJJJJJJJJJJSS.bBB...",
"..SSjjJJJJNNNNNNJJJJJSSbBBBb..",
"..SSjjJJJJNNNNNNJJJJJSGbBlBb..",
"...ssjjJJJJJJJJJJJJJ..GbBBBb..",
".....jjJJJJJJJJJJJJJ....bBB...",
"......jJJJJJJJJJJJJ...........",
".......jJJJJJJJJJJ............",
"........JJJJJJJJJJ............",
"........JJJJJJJJJJJ...........",
"........jJJJJJJJJJJ...........",
"........jjjjjJJJJJJ...........",
"........jjjj..JJJJJJ..........",
".......jjjj....JJJJJJ.........",
".......jjj......JJJJJ.........",
"......SSS........SSSS.........",
".....SSS..........SSSS........",
".....SSS..........SSSS........",
"....WWW...........WWWW........",
"..WWWWW..........WWWWWW.......",
".KWWWW..........KWWWWWK.......",
];
// Frame B of the run cycle: passing pose (legs gathered, trail heel up).
// Rows 0-25 are identical to frame A so the torso never jitters mid-cycle.
const RUNNER_PIXELS_B = [
"..........XXXXXXX.............",
".........EEEEEEEEE............",
"........EEEEEEEEEEE...........",
".......ENNEEEEEEEEEe..........",
".......ENNEEEEEEEEEe..........",
".......EEEEEEEEEEEEe..........",
".......EEEEEEEEEEEEe..........",
".......eEEEEEEEEESSSMM........",
".......eEEEEEEEEESSSMM........",
"........eEEEEEEEsSSSMM........",
".........eeeeee.MMMMM.........",
".............ee.MMM...........",
"....LLLLLLLLLLLLLLLLLLLL......",
"...LLLLLLLLLLLLLLLLLLLLLL.....",
"..jLLLLLLLLLLLLLLLLLLLLLj.....",
"..jjJJJJJJJJJJJJJJJJJJJjj.....",
"..jjjJJJJJJJJJJJJJJJJSS.bBB...",
"..SSjjJJJJNNNNNNJJJJJSSbBBBb..",
"..SSjjJJJJNNNNNNJJJJJSGbBlBb..",
"...ssjjJJJJJJJJJJJJJ..GbBBBb..",
".....jjJJJJJJJJJJJJJ....bBB...",
"......jJJJJJJJJJJJJ...........",
".......jJJJJJJJJJJ............",
"........JJJJJJJJJJ............",
"........JJJJJJJJJJJ...........",
"........jJJJJJJJJJJ...........",
".........jjjjJJJJJJ...........",
".........jjjjJJJJJJ...........",
"..........jjj.JJJJJ...........",
"..........jjj.JJJJJ...........",
".........SSS...SSSS...........",
"........WWWW...SSSS...........",
".......KK.......SSS...........",
"...............WWWW...........",
"..............WWWWWW..........",
".............KWWWWWK..........",
];
function spritePalette(jersey, trim, helmet, skin) {
  return {
    'J': jersey, 'j': _shade(jersey, -30), 'L': _shade(jersey, 28), 'N': trim,
    'S': skin, 's': _shade(skin, -34), 'H': _shade(skin, 26),
    'E': helmet, 'e': _shade(helmet, -34), 'X': _shade(helmet, 40), 'M': '#e2e5ee',
    'W': '#f2f0f8', 'K': '#16161e', 'B': '#9c5520', 'b': '#5e3210', 'l': '#f4ead0',
    'G': _shade(skin, -48),
  };
}
// Render a pixel map to an SVG string (for dangerouslySetInnerHTML on a <g>).
// Render a pixel map to an SVG string. `skip(ch, x, y)` optionally drops pixels
// — used to derive pose variants from the proven runner map (omit the ball, or
// surgically remove an arm region before overlaying a new pose arm) instead of
// authoring whole new maps blind, which proved unreliable.
function pixelSprite(map, pal, cell, skip) {
  cell = cell || 1;
  let out = '';
  for (let y = 0; y < map.length; y++) {
    const row = map[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.' || ch === ' ' || (skip && skip(ch, x, y))) { x++; continue; }
      let run = 1;
      while (x + run < row.length && row[x + run] === ch && !(skip && skip(ch, x + run, y))) run++;
      const color = pal[ch] || '#ff00ff';
      out += '<rect x="' + (x * cell) + '" y="' + (y * cell) + '" width="' + (run * cell) + '" height="' + cell + '" fill="' + color + '"/>';
      x += run;
    }
  }
  return out;
}

// Tiny helper: a list of [x, y, w, h] pixel rects in map coordinates -> SVG string.
function pxRects(list, color) {
  return list.map(r => '<rect x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + (r[3] || 1) + '" fill="' + color + '"/>').join('');
}

// Skip predicates for deriving poses from RUNNER_PIXELS:
const SKIP_BALL = (ch) => 'BblG'.includes(ch); // ball + carrying hand
const SKIP_LEAD_ARM = (ch, x, y) => ('SsjGBbl'.includes(ch) && y >= 15 && y <= 21 && x >= 21); // whole ball arm
const SKIP_TRAIL_ARM = (ch, x, y) => ('Ssj'.includes(ch) && y >= 15 && y <= 20 && x <= 4); // off arm

function runnerSVG(jersey, jShadow, trim, helmet, skin, skinShadow, sock) {
  // Pixel-grid runner. Map is 36w x 52h; cell=1, centered on the origin so the
  // existing scene transforms (translate/scale) place it like the old sprite.
  const pal = spritePalette(jersey, trim, helmet, skin);
  const px = pixelSprite(RUNNER_PIXELS, pal, 1);
  return '<g transform="scale(1.6) translate(-15,-21)">' + px + '</g>';
}

function defenderSVG(jersey, jShadow, helmet, skin, skinShadow, sock) {
  // Reuse the pixel-grid player, flipped horizontally and rotated into a
  // forward-diving lunge — so the defender matches the runner's art style and
  // reads as an airborne tackle attempt. (Authoring a separate diagonal pose
  // map blind proved unreliable; mirroring the proven sprite is cleaner.)
  const pal = spritePalette(jersey, '#c9ccd8', helmet, skin);
  const px = pixelSprite(RUNNER_PIXELS, pal, 1);
  // scale(-1,1) mirrors to face left; rotate tips him into a dive; translate centers.
  return '<g transform="rotate(62) scale(-1.6,1.6) translate(-15,-21)">' + px + '</g>';
}

// QB mid-throw — pixel runner minus ball & trail arm, with a raised throwing
// arm + ball overlaid above the trail shoulder. Lead arm stays extended forward
// as the balance arm. (Derived from the proven map, not authored blind.)
function passerSVG(jersey, jShadow, trim, helmet, skin, skinShadow, sock) {
  const pal = spritePalette(jersey, trim, helmet, skin);
  const px = pixelSprite(RUNNER_PIXELS, pal, 1, (ch, x, y) => SKIP_BALL(ch) || SKIP_TRAIL_ARM(ch, x, y));
  const arm = pxRects([[21,11,2,2],[22,9,2,2],[23,7,2,2],[24,5,2,2]], skin)
            + pxRects([[25,3,2,2]], _shade(skin, -34)); // hand open: ball just released
  return '<g transform="scale(1.6) translate(-15,-21)">' + px + arm + '</g>';
}

// Receiver leaping for the catch — pixel runner minus ball & both arms, with
// two raised arms and the ball arriving overhead. Slight back-lean for the leap.
function receiverSVG(jersey, jShadow, trim, helmet, skin, skinShadow, sock, noBall) {
  const pal = spritePalette(jersey, trim, helmet, skin);
  const px = pixelSprite(RUNNER_PIXELS, pal, 1, (ch, x, y) => SKIP_BALL(ch) || SKIP_LEAD_ARM(ch, x, y) || SKIP_TRAIL_ARM(ch, x, y));
  const arms = pxRects([[4,9,2,3],[3,6,2,3],[2,3,2,3]], skin) + pxRects([[2,1,2,2]], _shade(skin, -34))
             + pxRects([[23,9,2,3],[24,6,2,3],[25,3,2,3]], skin) + pxRects([[25,1,2,2]], _shade(skin, -34))
             + (noBall ? '' : pxRects([[11,-4,8,4]], '#9c5520') + pxRects([[14,-3,3,1]], '#f4ead0') + pxRects([[11,0,8,1]], '#5e3210'));
  return '<g transform="rotate(-5)"><g transform="scale(1.6) translate(-15,-21)">' + px + arms + '</g></g>';
}

// Trailing player in pursuit — the pixel runner without the ball, arms pumping.
function chaserSVG(jersey, jShadow, helmet, skin, skinShadow) {
  const pal = spritePalette(jersey, _shade(jersey, 30), helmet, skin);
  const px = pixelSprite(RUNNER_PIXELS, pal, 1, SKIP_BALL);
  return '<g transform="scale(1.6) translate(-15,-21)">' + px + '</g>';
}

// Loose ball on the turf — pixel football with laces, bouncing.
// Two-frame run cycle: alternates stride frames at 0.32s with a subtle bob
// and forward lean — sprites RUN across the field instead of gliding.
function _cyclePair(pal, skip) {
  const a = pixelSprite(RUNNER_PIXELS, pal, 1, skip);
  const b = pixelSprite(RUNNER_PIXELS_B, pal, 1, skip);
  return '<g>'
    + '<g>' + a + '<animate attributeName="opacity" values="1;0" keyTimes="0;0.5" calcMode="discrete" dur="0.32s" repeatCount="indefinite"/></g>'
    + '<g opacity="0">' + b + '<animate attributeName="opacity" values="0;1" keyTimes="0;0.5" calcMode="discrete" dur="0.32s" repeatCount="indefinite"/></g>'
    + '<animateTransform attributeName="transform" type="translate" values="0 0; 0 -1.1; 0 0" dur="0.32s" repeatCount="indefinite"/>'
    + '</g>';
}
function runCycleSVG(jersey, jShadow, trim, helmet, skin, skinShadow, sock) {
  const pal = spritePalette(jersey, trim, helmet, skin);
  return '<g transform="scale(1.6) translate(-15,-21)"><g transform="rotate(5 15 20)">' + _cyclePair(pal) + '</g></g>';
}
function chaseCycleSVG(jersey, jShadow, helmet, skin, skinShadow) {
  const pal = spritePalette(jersey, _shade(jersey, 30), helmet, skin);
  return '<g transform="scale(1.6) translate(-15,-21)"><g transform="rotate(5 15 20)">' + _cyclePair(pal, SKIP_BALL) + '</g></g>';
}
function looseBallSVG() {
  return '<g>'
    + '<animateTransform attributeName="transform" type="translate" values="0 0; 0 -4; 0 0" dur="0.5s" repeatCount="indefinite"/>'
    + '<rect x="1" y="3" width="11" height="6" rx="3" fill="#6b3f1d"/>'
    + '<rect x="2" y="3" width="9" height="2" rx="1" fill="#7d4d28"/>'
    + '<rect x="4" y="5" width="5" height="1" fill="#ecdcb0"/>'
    + '<rect x="6" y="4" width="1" height="3" fill="#ecdcb0"/>'
    + '<rect x="-4" y="11" width="3" height="1.5" fill="#1d3a24" opacity="0.7"/><rect x="13" y="10" width="3" height="1.5" fill="#1d3a24" opacity="0.7"/>'
    + '</g>';
}

// Lineman in a braced blocking stance — pixel runner without the ball, squared
// up and leaning into contact. Used for both O-line and D-line so the trenches
// read as a clean wall rather than a cluster of diving bodies.
function blockerSVG(jersey, jShadow, trim, helmet, skin, skinShadow, sock) {
  const pal = spritePalette(jersey, trim, helmet, skin);
  const px = pixelSprite(RUNNER_PIXELS, pal, 1, SKIP_BALL);
  return '<g transform="translate(0,1)"><g transform="scale(1.5) translate(-15,-20)">' + px + '</g></g>';
}

// Ball-carrier lunging after the lost ball — forward lean, lead arm reaching.
function reachBackSVG(jersey, jShadow, trim, helmet, skin, skinShadow, sock) {
  const pal = spritePalette(jersey, trim, helmet, skin);
  const px = pixelSprite(RUNNER_PIXELS, pal, 1, SKIP_BALL);
  return '<g transform="rotate(10)"><g transform="scale(1.6) translate(-15,-21)">' + px + '</g></g>';
}

// Kicker in follow-through — the stride pose minus the ball, leaning back as
// the kicking knee drives up. The flying ball is drawn by the scene.
function kickerSVG(jersey, jShadow, trim, helmet, skin, skinShadow, sock) {
  const pal = spritePalette(jersey, trim, helmet, skin);
  const px = pixelSprite(RUNNER_PIXELS, pal, 1, SKIP_BALL);
  return '<g transform="rotate(-6)"><g transform="scale(1.6) translate(-15,-21)">' + px + '</g></g>';
}

// Ball-carrier stuffed at the line — rocked backward on contact, ball protected.
function stuffedSVG(jersey, jShadow, trim, helmet, skin, skinShadow, sock) {
  const pal = spritePalette(jersey, trim, helmet, skin);
  const px = pixelSprite(RUNNER_PIXELS, pal, 1);
  return '<g transform="rotate(-10)"><g transform="scale(1.6) translate(-15,-21)">' + px + '</g></g>';
}

// Build a human caption for an event.
// Lower-third banner content per event type (broadcast-style: big event
// word, player name, yardage detail, position chip).
function bannerFor(e) {
  const t = e.type || '';
  const yd = e.yard ? Math.round(e.yard) + '-YD ' : '';
  if (t === 'RUSH_TD') return { word: 'TOUCHDOWN!', name: e.by, det: yd + 'TD RUN', pos: 'RB', theme: 'gold' };
  if (t === 'PASS_TD') return { word: 'TOUCHDOWN!', name: e.by, det: yd + 'TD RECEPTION', pos: 'WR', theme: 'gold' };
  if (t === 'FG') return { word: 'FIELD GOAL!', name: e.by, det: yd + 'FIELD GOAL IS GOOD', pos: 'K', theme: 'gold' };
  if (t === 'FG_MISS') return { word: 'NO GOOD!', name: e.by, det: yd + 'ATTEMPT SAILS WIDE', pos: 'K', theme: 'dim' };
  if (t === 'PUNT') return { word: 'PUNT', name: e.by, det: 'PUNTING IT AWAY', pos: 'P', theme: 'dim' };
  if (t === 'DOWNS') return { word: 'TURNOVER ON DOWNS', name: e.by, det: 'STUFFED ON 4TH DOWN', pos: '', theme: 'dim' };
  if (t === 'INT') return { word: 'INTERCEPTED!', name: e.by, det: 'THE BEASTS TAKE IT AWAY', pos: 'DB', theme: 'beast' };
  if (t === 'FUM') return { word: 'FUMBLE!', name: e.by, det: 'RECOVERED BY THE BEASTS', pos: 'LB', theme: 'beast' };
  if (t === 'BEAST_TD') return { word: 'TOUCHDOWN!', name: 'THE BEASTS', det: (captionFor(e) || '').replace('The Beasts ', '').replace('.', '').toUpperCase(), pos: '', theme: 'beast' };
  if (t === 'BEAST_FG') return { word: 'FIELD GOAL!', name: 'THE BEASTS', det: (captionFor(e) || '').replace('The Beasts ', '').replace('.', '').toUpperCase(), pos: '', theme: 'beast' };
  if (t === 'BEAST_SAFETY') return { word: 'SAFETY!', name: 'THE BEASTS', det: 'TWO POINTS THE OTHER WAY', pos: '', theme: 'beast' };
  return { word: t, name: e.by || '', det: '', pos: '', theme: 'dim' };
}
// Head-and-shoulders crop of the pixel sprite — the banner "portrait".
function bustSVG(jersey, trim, helmet, skin) {
  const pal = spritePalette(jersey, trim, helmet, skin);
  return pixelSprite(RUNNER_PIXELS, pal, 1, (ch, x, y) => y > 17 || 'BblG'.includes(ch));
}
function captionFor(e) {
  if (e.type === 'RUSH_TD') return `${e.by} runs for a ${Math.round(e.yard)}-yard touchdown.`;
  if (e.type === 'PASS_TD') return `${e.passer} finds ${e.by} for a ${Math.round(e.yard)}-yard touchdown.`;
  if (e.type === 'FG') return `${TEAM_NAME} kick a ${Math.round(e.yard)}-yard field goal.`;
  if (e.type === 'FG_MISS') return `${TEAM_NAME} miss a ${Math.round(e.yard)}-yard field goal.`;
  if (e.type === 'INT') return `Intercepted by ${e.by}!`;
  if (e.type === 'FUM') return `${e.by} forces a fumble. Beasts ball!`;
  if (e.type === 'DOWNS') return `${TEAM_NAME} turn it over on downs.`;
  if (e.type === 'BEAST_TD') {
    if (e.pts === 8) return 'The Beasts score a touchdown and convert for two.';
    return e.opening ? 'The Beasts strike first with a touchdown.' : 'The Beasts punch in a touchdown.';
  }
  if (e.type === 'BEAST_FG') return e.opening ? 'The Beasts open the scoring with a field goal.' : 'The Beasts drill a field goal.';
  if (e.type === 'BEAST_SAFETY') return 'The Beasts force a safety.';
  if (e.type === 'PUNT') return `${TEAM_NAME} punt it away.`;
  return 'Big play.';
}

// The playback screen: auto-advances through scoring/turnover events, tap to skip.
function CinematicScreen({ result, onDone }) {
  const events = (result.cinematicEvents || []).map(e => ({
    ...e,
    heroName: e.by || e.passer,
    caption: captionFor(e),
  }));
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (events.length === 0) { onDone(); return; }
    // Pacing varies with the play: touchdowns breathe, kicks move quickly.
    const tt = (events[idx] && events[idx].type) || '';
    const dur = tt.indexOf('TD') !== -1 ? 3300 : (tt === 'FG' || tt === 'FG_MISS' || tt === 'PUNT' || tt === 'BEAST_FG') ? 2700 : 2800;
    const t = setTimeout(() => {
      if (idx < events.length - 1) setIdx(idx + 1);
      else onDone();
    }, dur);
    return () => clearTimeout(t);
  }, [idx, events.length]);

  if (events.length === 0) return null;
  const ev = events[idx];
  const advance = () => { if (idx < events.length - 1) setIdx(idx + 1); else onDone(); };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 relative" style={{ background: C.bg, color: C.text }} onClick={advance}>
      <div className="w-full max-w-xl">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.emerald }}>Game Replay</span>
          <span className="text-[11px] tabular-nums" style={{ color: C.textMuted }}>{idx + 1} / {events.length}</span>
        </div>
        <style>{`@keyframes btbSceneIn { from { opacity: 0; transform: translateX(16px) scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes btbShake { 0%,100% { transform: translate(0,0); } 20% { transform: translate(-4px,1px); } 40% { transform: translate(3px,-1px); } 60% { transform: translate(-2px,1px); } 80% { transform: translate(2px,0); } }`}</style>
        <div key={idx} style={{ animation: 'btbSceneIn 0.45s ease-out' + ((ev.type === 'DOWNS' || ev.type === 'FUM' || ev.type === 'BEAST_SAFETY') ? ', btbShake 0.45s ease-in-out 0.55s' : '') }}>
          <CinematicScene event={ev} events={events} idx={idx} />
        </div>
        {/* the replay progress dots now live inside the broadcast ticker */}
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs" style={{ color: C.textDim }}>Tap to skip ahead</span>
          <span className="text-sm font-bold tabular-nums" style={{ color: C.text }}>
            <span style={{ color: C.emerald }}>Contenders {ev.yourScore != null ? ev.yourScore : 0}</span>
            <span style={{ color: C.textDim }}> · </span>
            <span style={{ color: '#ff2a6d' }}>Beasts {ev.beastScore != null ? ev.beastScore : 0}</span>
          </span>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={(e) => { e.stopPropagation(); onDone(); }} className="text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-lg" style={{ color: C.textMuted, background: C.surface, border: `1px solid ${C.border}` }}>
            Skip to result
          </button>
        </div>
      </div>
    </div>
  );
}

function ResultScreen({ roster, result, beasts, onReset, dailyPerfect }) {
  const [showPerfect, setShowPerfect] = useState(false);
  const [showRecap, setShowRecap] = useState(false);
  const [yourAnim, setYourAnim] = useState(0);
  const [beastAnim, setBeastAnim] = useState(0);
  const won = result.won;

  useEffect(() => {
    const dur = 1100, t0 = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      setYourAnim(Math.round(result.yourScore * e));
      setBeastAnim(Math.round(result.beastScore * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [result.yourScore, result.beastScore]);

  const accent = won ? C.emerald : '#ff2a6d';
  const b = result.box;
  const [popup, setPopup] = useState(null); // { name, team, dec }

  // Small reusable stat-table row
  const Th = ({ children, right }) => (
    <th className={`text-[9px] font-bold uppercase tracking-wider pb-1.5 ${right ? 'text-right' : 'text-left'}`} style={{ color: C.textDim }}>{children}</th>
  );
  const Td = ({ children, right, bold, color }) => (
    <td className={`py-1.5 text-xs tabular-nums ${right ? 'text-right' : 'text-left'} ${bold ? 'font-bold' : ''}`} style={{ color: color || C.text, borderTop: `1px solid ${C.border}` }}>{children}</td>
  );

  // Tappable player name -> opens the stat popup for their drafted team+era.
  const PlayerName = ({ row, children }) => (
    <button
      onClick={() => setPopup({ name: row.name, team: row.team, dec: row.dec })}
      className="inline-flex items-center text-left transition-opacity hover:opacity-80"
      style={{ color: 'inherit', cursor: 'pointer' }}
    >
      <span style={{ borderBottom: `1px dotted ${C.borderHi}` }}>{row.name}</span>
      {children}
    </button>
  );

  const driveColor = (end) => {
    if (end === 'TD') return C.emerald;
    if (end === 'FG') return C.gold;
    if (end === 'INT' || end === 'FUM') return '#ff2a6d';
    return C.textDim;
  };

  return (
    <div className="min-h-screen px-4 py-12 relative" style={{ background: C.bg, color: C.text }}>
      {popup && <PlayerStatPopup name={popup.name} team={popup.team} dec={popup.dec} onClose={() => setPopup(null)} />}
      <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `repeating-linear-gradient(90deg, transparent 0px, transparent 80px, rgba(170,255,0,0.03) 80px, rgba(170,255,0,0.03) 82px)` }} />
      <div className="max-w-3xl mx-auto relative z-10">

        {/* Scoreboard */}
        <div className="text-center mb-8">
          <div className="mb-5 inline-flex items-center gap-2 px-4 py-2 rounded-full" style={{ background: won ? 'rgba(170,255,0,0.15)' : 'rgba(255,92,138,0.12)', border: `1px solid ${accent}` }}>
            {won && <Trophy className="w-4 h-4" style={{ color: accent }} />}
            <span className="text-xs font-bold tracking-widest uppercase" style={{ color: accent }}>{won ? 'You Beat the Beasts' : 'The Beasts Win'}</span>
          </div>
          <div className="flex items-center justify-center gap-6 mb-2">
            <div className="text-center">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: C.textMuted }}>You</div>
              <div className="font-black tabular-nums leading-none" style={{ fontFamily: 'var(--font-display, ui-serif, Georgia, serif)', fontSize: 'clamp(4rem, 14vw, 8rem)', letterSpacing: '-0.05em', color: won ? C.emerald : C.text, textShadow: won ? '0 0 50px rgba(170,255,0,0.5)' : 'none' }}>{yourAnim}</div>
            </div>
            <div className="font-black text-3xl" style={{ color: C.textDim }}>–</div>
            <div className="text-center">
              <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: '#ff2a6d' }}>Beasts</div>
              <div className="font-black tabular-nums leading-none" style={{ fontFamily: 'var(--font-display, ui-serif, Georgia, serif)', fontSize: 'clamp(4rem, 14vw, 8rem)', letterSpacing: '-0.05em', color: !won ? '#ff2a6d' : C.textMuted, textShadow: !won ? '0 0 50px rgba(255,92,138,0.45)' : 'none' }}>{beastAnim}</div>
            </div>
          </div>
          <div className="mt-4 inline-flex items-center gap-3 px-4 py-2 rounded-xl" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
            <span className="text-sm font-bold uppercase tracking-wider" style={{ color: C.text }}>{result.gradeLabel}</span>
          </div>
          <div className="mt-4 flex items-center justify-center gap-6 flex-wrap text-sm" style={{ color: C.textMuted }}>
            <span>Beasts Rating <span className="font-bold tabular-nums ml-1" style={{ color: C.text }}>{result.defRating}</span></span>
            <span style={{ color: C.textDim }}>·</span>
            <span>Total Yards <span className="font-bold tabular-nums ml-1" style={{ color: C.text }}>{result.totalYds}</span></span>
          </div>
        </div>

        {/* Drive summary */}
        <div className="rounded-2xl p-5 mb-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <h3 className="text-[11px] font-bold tracking-widest uppercase mb-3" style={{ color: C.emerald }}>Drive Summary</h3>
          <div className="flex flex-wrap gap-1.5">
            {result.drives.map((d, i) => (
              <div key={i} className="flex flex-col items-center px-2 py-1.5 rounded-md" style={{ background: C.surfaceHi, border: `1px solid ${C.border}`, minWidth: 42 }}>
                <span className="text-[8px] uppercase" style={{ color: C.textDim }}>D{d.n}</span>
                <span className="text-[10px] font-black uppercase" style={{ color: driveColor(d.end) }}>{d.end}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-[10px] uppercase tracking-wide" style={{ color: C.textDim }}>
            <span><span style={{ color: C.emerald }}>■</span> TD</span>
            <span><span style={{ color: C.gold }}>■</span> FG</span>
            <span><span style={{ color: '#ff2a6d' }}>■</span> Turnover</span>
            <span><span style={{ color: C.textDim }}>■</span> Punt/Downs</span>
          </div>
        </div>

        {/* Key matchups */}
        <div className="rounded-2xl p-5 mb-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <h3 className="text-[11px] font-bold tracking-widest uppercase mb-3" style={{ color: C.gold }}>Key Matchups</h3>
          <div className="space-y-2">
            {result.matchups.map((m, i) => {
              const wc = m.winner === 'offense' ? C.emerald : m.winner === 'defense' ? '#ff2a6d' : C.textMuted;
              const wl = m.winner === 'offense' ? 'WR WON' : m.winner === 'defense' ? 'CB WON' : 'EVEN';
              return (
                <div key={i} className="flex items-center gap-3 py-2" style={{ borderBottom: i < result.matchups.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                  <span className="text-[9px] font-bold px-1.5 py-1 rounded uppercase text-center" style={{ background: C.surfaceHi, color: C.textMuted, minWidth: 34 }}>{m.slot}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate" style={{ color: C.text }}>
                      {m.off} <span style={{ color: C.textDim }}>vs</span> {m.def} <span style={{ color: C.textDim }}>({m.defRole})</span>
                    </div>
                    <div className="text-[10px] tabular-nums" style={{ color: C.textMuted }}>{m.recCatches} rec, {m.recYds} yds{m.recTD ? `, ${m.recTD} TD` : ''}</div>
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded" style={{ color: wc, background: m.winner === 'even' ? 'transparent' : `${wc}22` }}>{wl}</span>
                </div>
              );
            })}
          </div>
          {/* Trenches */}
          <div className="mt-3 pt-3 grid grid-cols-2 gap-3 text-[11px]" style={{ borderTop: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between">
              <span style={{ color: C.textMuted }}>Pass Pro vs Rush</span>
              <span className="font-bold tabular-nums" style={{ color: result.trench.passWin >= 0 ? C.emerald : '#ff2a6d' }}>{result.trench.olPass}–{result.trench.passRush}</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: C.textMuted }}>Sacks Allowed</span>
              <span className="font-bold tabular-nums" style={{ color: result.trench.sacks <= 2 ? C.emerald : '#ff2a6d' }}>{result.trench.sacks}</span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: C.textMuted }}>Run Block vs Front</span>
              <span className="font-bold tabular-nums" style={{ color: result.trench.runWin >= 0 ? C.emerald : '#ff2a6d' }}>{result.trench.olRun}–{result.trench.runFront}</span>
            </div>
          </div>
        </div>

        {/* Box score — offense */}
        <div className="rounded-2xl p-5 mb-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <h3 className="text-[11px] font-bold tracking-widest uppercase mb-3" style={{ color: C.emerald }}>Your Box Score</h3>

          {/* Passing */}
          <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: POS_HEX.QB.text }}>Passing</div>
          <table className="w-full mb-4">
            <thead><tr><Th>Player</Th><Th right>C/ATT</Th><Th right>Yds</Th><Th right>TD</Th><Th right>INT</Th></tr></thead>
            <tbody>
              <tr>
                <Td bold><PlayerName row={b.pass} /><GradeBadge grade={scoreToGrade(gradeQB(b.pass))} /></Td>
                <Td right>{b.pass.cmp}/{b.pass.att}</Td>
                <Td right bold>{b.pass.yds}</Td>
                <Td right color={C.emerald}>{b.pass.td}</Td>
                <Td right color={b.pass.int ? '#ff2a6d' : C.textMuted}>{b.pass.int}</Td>
              </tr>
            </tbody>
          </table>

          {/* Rushing */}
          <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: POS_HEX.RB.text }}>Rushing</div>
          <table className="w-full mb-4">
            <thead><tr><Th>Player</Th><Th right>Car</Th><Th right>Yds</Th><Th right>Avg</Th><Th right>TD</Th><Th right>Long</Th></tr></thead>
            <tbody>
              {b.rush.map((r, i) => (
                <tr key={i}>
                  <Td bold><PlayerName row={r} /><GradeBadge grade={scoreToGrade(gradeRush(r))} /></Td>
                  <Td right>{r.car}</Td>
                  <Td right bold>{r.yds}</Td>
                  <Td right>{(r.yds / Math.max(1, r.car)).toFixed(1)}</Td>
                  <Td right color={r.td ? C.emerald : C.textMuted}>{r.td}</Td>
                  <Td right>{r.long}</Td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Receiving */}
          <div className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: POS_HEX.WR.text }}>Receiving</div>
          <table className="w-full">
            <thead><tr><Th>Player</Th><Th right>Rec/Tgt</Th><Th right>Yds</Th><Th right>TD</Th><Th right>Long</Th></tr></thead>
            <tbody>
              {b.rec.map((r, i) => (
                <tr key={i}>
                  <Td bold><PlayerName row={r} /><GradeBadge grade={scoreToGrade(gradeRec(r))} /></Td>
                  <Td right>{r.rec}/{r.tgt}</Td>
                  <Td right bold>{r.yds}</Td>
                  <Td right color={r.td ? C.emerald : C.textMuted}>{r.td}</Td>
                  <Td right>{r.long}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Box score — Beasts defense */}
        <div className="rounded-2xl p-5 mb-4" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <h3 className="text-[11px] font-bold tracking-widest uppercase mb-3" style={{ color: '#ff2a6d' }}>Beasts Defense</h3>
          <table className="w-full">
            <thead><tr><Th>Player</Th><Th>Pos</Th><Th right>Tkl</Th><Th right>Sacks</Th><Th right>INT</Th></tr></thead>
            <tbody>
              {b.def.filter(d => d.tk > 0 || d.sk > 0 || d.int > 0).map((d, i) => (
                <tr key={i}>
                  <Td bold>{d.name}</Td>
                  <Td color={C.textMuted}>{d.role}</Td>
                  <Td right>{d.tk}</Td>
                  <Td right color={d.sk ? C.gold : C.textMuted}>{d.sk}</Td>
                  <Td right color={d.int ? C.emerald : C.textMuted}>{d.int}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Analysis */}
        <div className="rounded-2xl p-6 mb-6" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <h3 className="text-[11px] font-bold tracking-widest uppercase mb-3" style={{ color: C.textMuted }}>Game Analysis</h3>
          <p className="text-sm leading-relaxed" style={{ color: C.text }}>{generateBeatdownAnalysis(result, roster, beasts)}</p>
        </div>

        {/* Daily: reveal the perfect team */}
        {dailyPerfect && (
          <div className="mb-6">
            <button
              onClick={() => setShowPerfect(true)}
              className="w-full px-5 py-4 rounded-xl font-bold uppercase tracking-wider text-sm transition flex items-center justify-center gap-2"
              style={{ background: C.surfaceHi, border: `1.5px solid ${C.emerald}`, color: C.emerald, boxShadow: `0 0 20px -8px ${C.emerald}66` }}
            >
              <Trophy className="w-4 h-4" /> Reveal Perfect Team
            </button>
          </div>
        )}

        <div className="flex gap-3 justify-center">
          <button onClick={() => setShowRecap(true)} className="px-6 py-3 font-bold rounded-xl uppercase tracking-wider text-sm transition flex items-center gap-2" style={{ background: C.surfaceHi, border: `1.5px solid ${accent}`, color: accent }}>
            <Sparkles className="w-4 h-4" /> Share Results
          </button>
          <button onClick={onReset} className="px-6 py-3 font-bold rounded-xl uppercase tracking-wider text-sm transition" style={{ background: C.emerald, color: C.bg }}>
            {dailyPerfect ? 'Back to Menu' : 'Face New Beasts'}
          </button>
        </div>
      </div>

      {/* Perfect team reveal modal */}
      {showPerfect && dailyPerfect && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: 'rgba(4,3,8,0.8)' }} onClick={() => setShowPerfect(false)}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: C.surface, border: `1.5px solid ${C.emerald}`, boxShadow: `0 0 40px -6px ${C.emerald}66`, maxHeight: '85vh' }} onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}`, background: C.surfaceLo }}>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: C.emerald }}>Today's Perfect Team</div>
                <div className="text-xs mt-0.5" style={{ color: C.textMuted }}>The best possible combination of players</div>
              </div>
              <button onClick={() => setShowPerfect(false)} className="p-1 rounded-lg shrink-0" style={{ color: C.textMuted }}><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 overflow-y-auto" style={{ maxHeight: 'calc(85vh - 70px)' }}>
              <div className="space-y-2">
                {dailyPerfect.map((pick, i) => {
                  const ph = POS_HEX[pick.slot === 'OL' ? 'OL' : pick.slot.startsWith('WR') ? 'WR' : pick.slot.startsWith('RB') ? 'RB' : pick.slot.startsWith('TE') ? 'TE' : pick.slot] || POS_HEX.QB;
                  const yourNames = Object.values(roster).filter(Boolean).map(p => p.n);
                  const gotIt = pick.player && yourNames.includes(pick.player.n);
                  return (
                    <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg" style={{ background: C.surfaceLo, border: `1px solid ${gotIt ? C.emerald : C.border}` }}>
                      <span className="text-[10px] font-bold w-8 shrink-0" style={{ color: C.textDim }}>{pick.slot}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase shrink-0" style={{ background: ph.bg, color: ph.text }}>{pick.t} · {pick.d}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold truncate" style={{ color: C.text }}>{pick.player ? pick.player.n : '—'}</span>
                      </span>
                      {gotIt && <span className="text-[9px] font-bold uppercase shrink-0" style={{ color: C.emerald }}>✓ you</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shareable recap card modal */}
      {showRecap && (
        <RecapModal roster={roster} result={result} dailyPerfect={dailyPerfect} accent={accent} onClose={() => setShowRecap(false)} />
      )}
    </div>
  );
}

// Shareable end-of-game recap: renders a self-contained SVG "card" the player
// can screenshot or download as a PNG to post/share. Built as SVG so it can be
// rasterized to PNG in the browser via an offscreen canvas.
function RecapModal({ roster, result, dailyPerfect, accent, onClose }) {
  const won = result.won;
  const CON = '#1d4ed8', BST = '#7f1420';
  const W = 600, H = 760;
  const rosArr = Object.values(roster).filter(Boolean);
  const lines = [];
  const qb = rosArr.find(p => p.p === 'QB'); if (qb) lines.push(['QB', qb.n]);
  const rb = rosArr.find(p => p.p === 'RB'); if (rb) lines.push(['RB', rb.n]);
  const wr = rosArr.find(p => p.p === 'WR'); if (wr) lines.push(['WR', wr.n]);
  const te = rosArr.find(p => p.p === 'TE'); if (te) lines.push(['TE', te.n]);
  const totalYds = result.totalYds != null ? result.totalYds : (result.offense ? result.offense.totalYpg : 0);
  const qbRating = result.offense ? result.offense.qbRating : '—';
  const dateStr = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

  const svgMarkup = () => `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Oswald, Arial, sans-serif">
  <defs>
    <linearGradient id="bgg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#0b0e20"/><stop offset="100%" stop-color="#08070f"/></linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.32" r="0.7"><stop offset="0%" stop-color="${accent}" stop-opacity="0.18"/><stop offset="100%" stop-color="${accent}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bgg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="20" fill="none" stroke="${accent}" stroke-width="2" opacity="0.55"/>
  <text x="${W / 2}" y="64" text-anchor="middle" fill="#7f7a99" font-size="18" font-weight="700" letter-spacing="6">BEAT THE BEASTS</text>
  <text x="${W / 2}" y="92" text-anchor="middle" fill="#5a5575" font-size="13" font-weight="600" letter-spacing="2">${dailyPerfect ? 'DAILY CHALLENGE · ' + dateStr.toUpperCase() : dateStr.toUpperCase()}</text>
  <text x="${W / 2}" y="172" text-anchor="middle" fill="${accent}" font-size="76" font-weight="700" letter-spacing="2">${won ? 'WIN' : 'LOSS'}</text>
  <text x="${W / 2}" y="206" text-anchor="middle" fill="#f4f0ff" font-size="22" font-weight="700" letter-spacing="3">${(result.gradeLabel || '').toUpperCase()}</text>
  <g transform="translate(${W / 2 - 210}, 250)">
    <rect x="0" y="0" width="420" height="92" rx="12" fill="#120f1f" stroke="#2a2348" stroke-width="1.5"/>
    <rect x="0" y="0" width="10" height="92" rx="5" fill="${CON}"/>
    <rect x="410" y="0" width="10" height="92" rx="5" fill="${BST}"/>
    <text x="46" y="38" fill="#6f9bff" font-size="20" font-weight="700" letter-spacing="2">CON</text>
    <text x="46" y="78" fill="#f4f0ff" font-size="46" font-weight="700">${result.yourScore}</text>
    <text x="210" y="56" text-anchor="middle" fill="#4a4468" font-size="22" font-weight="700">—</text>
    <text x="374" y="38" text-anchor="end" fill="#e07a8a" font-size="20" font-weight="700" letter-spacing="2">BST</text>
    <text x="374" y="78" text-anchor="end" fill="#f4f0ff" font-size="46" font-weight="700">${result.beastScore}</text>
  </g>
  <g transform="translate(${W / 2 - 210}, 364)">
    <text x="0" y="20" fill="#7f7a99" font-size="13" font-weight="700" letter-spacing="1">TOTAL YARDS</text>
    <text x="0" y="48" fill="#f4f0ff" font-size="30" font-weight="700">${totalYds}</text>
    <text x="420" y="20" text-anchor="end" fill="#7f7a99" font-size="13" font-weight="700" letter-spacing="1">QB RATING</text>
    <text x="420" y="48" text-anchor="end" fill="#f4f0ff" font-size="30" font-weight="700">${qbRating}</text>
  </g>
  <text x="${W / 2 - 210}" y="452" fill="#7f7a99" font-size="13" font-weight="700" letter-spacing="2">MY LINEUP</text>
  ${lines.map((l, i) => `
    <g transform="translate(${W / 2 - 210}, ${466 + i * 52})">
      <rect x="0" y="0" width="420" height="44" rx="8" fill="#120f1f" stroke="#2a2348" stroke-width="1"/>
      <text x="16" y="29" fill="#9b93c4" font-size="15" font-weight="700" letter-spacing="1">${l[0]}</text>
      <text x="64" y="29" fill="#f4f0ff" font-size="18" font-weight="600">${(l[1] || '').replace(/&/g, '&amp;').slice(0, 28)}</text>
    </g>`).join('')}
  <text x="${W / 2}" y="${H - 28}" text-anchor="middle" fill="#5a5575" font-size="14" font-weight="600" letter-spacing="2">Can you beat the Beasts?</text>
</svg>`;

  const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup());

  // Rasterize the SVG to a real PNG data-URL once on open. iOS Safari only
  // offers "Save Image" / "Copy" on raster images, not SVG data-URLs, so we
  // display the PNG (falling back to the SVG until the raster is ready).
  const [pngUrl, setPngUrl] = useState(null);
  useEffect(() => {
    let cancelled = false;
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = 2;
          const canvas = document.createElement('canvas');
          canvas.width = W * scale; canvas.height = H * scale;
          const ctx = canvas.getContext('2d');
          ctx.scale(scale, scale);
          ctx.drawImage(img, 0, 0, W, H);
          const url = canvas.toDataURL('image/png');
          if (!cancelled) setPngUrl(url);
        } catch (e) { /* keep SVG fallback */ }
      };
      img.src = svgDataUrl;
    } catch (e) { /* keep SVG fallback */ }
    return () => { cancelled = true; };
  }, []);

  const imgSrc = pngUrl || svgDataUrl;

  const download = () => {
    try {
      const a = document.createElement('a');
      if (pngUrl) {
        a.href = pngUrl; a.download = 'beat-the-beasts-recap.png';
        document.body.appendChild(a); a.click(); a.remove();
        return;
      }
      // PNG not ready yet — rasterize on demand, then download.
      const img = new Image();
      img.onload = () => {
        const scale = 2;
        const canvas = document.createElement('canvas');
        canvas.width = W * scale; canvas.height = H * scale;
        const ctx = canvas.getContext('2d');
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, W, H);
        canvas.toBlob((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const dl = document.createElement('a');
          dl.href = url; dl.download = 'beat-the-beasts-recap.png';
          document.body.appendChild(dl); dl.click(); dl.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }, 'image/png');
      };
      img.src = svgDataUrl;
    } catch (e) { /* no-op */ }
  };

  const overlay = (
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4" style={{ background: 'rgba(4,3,8,0.85)' }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: C.surface, border: `1.5px solid ${accent}`, boxShadow: `0 0 40px -6px ${accent}66`, maxHeight: '92vh' }} onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}`, background: C.surfaceLo }}>
          <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: accent }}>Share Your Recap</div>
          <button onClick={onClose} className="p-1 rounded-lg shrink-0" style={{ color: C.textMuted }}><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 overflow-y-auto" style={{ maxHeight: 'calc(92vh - 110px)' }}>
          <img src={imgSrc} alt="Game recap" className="w-full rounded-xl" style={{ border: `1px solid ${C.border}` }} />
          <p className="text-[11px] mt-3 text-center" style={{ color: C.textMuted }}>Long-press the image to save or copy it, or use Download below.</p>
        </div>
        <div className="px-4 py-3 flex gap-2" style={{ borderTop: `1px solid ${C.border}`, background: C.surfaceLo }}>
          <button onClick={download} className="flex-1 px-4 py-2.5 font-bold rounded-xl uppercase tracking-wider text-xs transition" style={{ background: accent, color: C.bg }}>
            Download PNG
          </button>
          <button onClick={onClose} className="px-4 py-2.5 font-bold rounded-xl uppercase tracking-wider text-xs transition" style={{ background: C.surfaceHi, border: `1px solid ${C.border}`, color: C.text }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );

  // Portal to <body> so the modal escapes any transformed/stacking-context
  // ancestor in ResultScreen and renders ABOVE the box-score screen.
  return (typeof document !== 'undefined' && ReactDOM && ReactDOM.createPortal)
    ? ReactDOM.createPortal(overlay, document.body)
    : overlay;
}

function generateBeatdownAnalysis(result, roster, beasts) {
  const { won, yourScore, beastScore, defRating, box, trench, matchups } = result;
  const qb = roster.QB;
  const ol = roster.OL;
  const topBeast = beasts.reduce((a, b) => (b.imp > a.imp ? b : a));
  const margin = Math.abs(yourScore - beastScore);
  const passRush = trench.sacks >= 4 ? 'relentless' : trench.sacks >= 2 ? 'steady' : 'manageable';

  // Find the standout offensive performer and the matchup that swung the game.
  const topRec = (box.rec || []).slice().sort((a, b) => b.yds - a.yds)[0];
  const topRush = (box.rush || []).slice().sort((a, b) => b.yds - a.yds)[0];
  const wonMatch = matchups.find(m => m.winner === 'offense');
  const lostMatch = matchups.find(m => m.winner === 'defense');
  const qbLine = `${box.pass.cmp}/${box.pass.att} for ${box.pass.yds}, ${box.pass.td} TD${box.pass.int ? ` and ${box.pass.int} INT` : ''}${box.qbRush && box.qbRush.att > 0 ? `, plus ${box.qbRush.yds} yds on ${box.qbRush.att} scrambles` : ''}`;

  const recBit = topRec ? `${topRec.name} led the way with ${topRec.rec} catches for ${topRec.yds}${topRec.td ? ` and ${topRec.td} TD` : ''}` : 'the passing game struggled to find a rhythm';
  const rushBit = topRush ? `${topRush.name} carried ${topRush.car} times for ${topRush.yds}${topRush.td ? ` and ${topRush.td} on the ground` : ''}` : 'the run game never got going';

  if (won && margin >= 21) {
    return `A total dismantling. ${qb.n} went ${qbLine} against a Beasts front anchored by ${topBeast.n}, and the ${ol.t} line kept the ${passRush} pass rush off him (${trench.sacks} sacks allowed). ${recBit}, and ${rushBit}. ${wonMatch ? `${wonMatch.off} owned his matchup with ${wonMatch.def} for ${wonMatch.recYds} yards. ` : ''}Beating an all-time defense rated ${defRating} by ${margin} is the kind of game you frame.`;
  }
  if (won) {
    return `You beat the Beasts ${yourScore}-${beastScore}. ${qb.n} went ${qbLine} behind a line that handled a ${passRush} rush (${trench.sacks} sacks). ${recBit[0].toUpperCase() + recBit.slice(1)}, and ${rushBit}. ${wonMatch ? `The difference was ${wonMatch.off} beating ${wonMatch.def} (${wonMatch.recYds} yds). ` : ''}A defense rated ${defRating} doesn't give up much, but you made the plays that mattered.`;
  }
  if (margin <= 10) {
    return `So close. You fell ${beastScore}-${yourScore} to a Beasts unit rated ${defRating}. ${qb.n} went ${qbLine} and ${recBit}, but ${lostMatch ? `${lostMatch.def} blanketed ${lostMatch.off} (just ${lostMatch.recYds} yds) and ` : ''}a ${passRush} rush got home ${trench.sacks} times. A few plays the other way and this is a win — run it back against new Beasts.`;
  }
  return `The Beasts handled you ${beastScore}-${yourScore}. A front led by ${topBeast.n} brought a ${passRush} rush (${trench.sacks} sacks) that the ${ol.t} line couldn't slow, and ${qb.n} went ${qbLine}. ${lostMatch ? `${lostMatch.def} erased ${lostMatch.off} in coverage. ` : ''}Against a defense rated ${defRating}, you'll need a more complete offense — draft again and find a better matchup.`;
}

// ============================================================
// MAIN GAME
// ============================================================
// Odds Lab payout reveal + running session stats. Play credits only.
function LabResultScreen({ roster, result, beasts, labState, onPlayAgain, onFastForward, onReset }) {
  const lab = result._lab;
  const won = lab.payout > 0;
  const net = lab.payout - lab.stake;
  const s = labState; // { credits, games, wins, wagered, returned } AFTER this game

  const rtp = s.wagered > 0 ? (s.returned / s.wagered) * 100 : 0;
  const winPct = s.games > 0 ? (s.wins / s.games) * 100 : 0;
  const avgSkill = s.skillGames > 0 ? s.skillSum / s.skillGames : null;
  const thisSkill = lab.skillPct;

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-10 relative" style={{ background: C.bg, color: C.text }}>
      <div className="w-full max-w-md">
        {/* Disclaimer strip */}
        <div className="text-center text-[10px] uppercase tracking-widest mb-4" style={{ color: C.textDim }}>
          Odds Lab · Play Credits · Not Real Money
        </div>

        {/* Payout card */}
        <div className="rounded-2xl px-6 py-7 text-center relative overflow-hidden" style={{
          background: won ? `linear-gradient(160deg, ${C.surfaceHi} 0%, ${C.surface} 100%)` : C.surface,
          border: `2px solid ${won ? lab.band.mult >= 18 ? C.gold : C.emerald : C.border}`,
          boxShadow: won ? `0 0 40px -12px ${(lab.band.mult >= 18 ? C.gold : C.emerald)}99` : 'none',
        }}>
          <div className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: won ? (lab.band.mult >= 18 ? C.gold : C.emerald) : C.textMuted }}>
            {lab.band.name}
          </div>
          <div className="text-sm mb-3" style={{ color: C.textMuted }}>
            {won ? `Beat the Beasts by ${lab.shownMargin}` : `Lost by ${Math.abs(lab.shownMargin)}`}
          </div>
          <div className="font-bold mb-1" style={{ fontFamily: 'var(--font-display, sans-serif)', fontSize: 'clamp(2.4rem, 9vw, 3.6rem)', lineHeight: 1, color: won ? (lab.band.mult >= 18 ? C.gold : C.emerald) : C.textMuted }}>
            {won ? `${lab.band.mult}×` : '0×'}
          </div>
          <div className="text-sm" style={{ color: C.text }}>
            {won ? <>Won <span style={{ color: C.emerald, fontWeight: 700 }}>{lab.payout.toFixed(2)}</span> credits</> : <>Staked {lab.stake} credits</>}
          </div>
          {lab.band.mult >= 18 && (
            <div className="mt-3 text-[11px] font-bold uppercase tracking-widest" style={{ color: C.gold }}>
              {lab.band.mult >= 69 ? 'JACKPOT' : 'Huge Win'}
            </div>
          )}
        </div>

        {/* Net this game */}
        <div className="text-center mt-3 text-sm font-bold" style={{ color: net > 0 ? C.emerald : net < 0 ? C.loss : C.textMuted }}>
          {net > 0 ? '+' : ''}{net.toFixed(2)} credits this game
        </div>

        {/* Draft skill this game (your roster impact vs the optimal assignment) */}
        {thisSkill != null && (
          <div className="mt-3 rounded-xl px-5 py-3" style={{ background: C.surfaceLo, border: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs uppercase tracking-widest" style={{ color: C.textMuted }}>Draft Skill</span>
              <span className="text-sm font-bold tabular-nums" style={{ color: thisSkill >= 95 ? C.emerald : thisSkill >= 80 ? C.gold : C.textMuted }}>{thisSkill.toFixed(0)}% of optimal</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: C.surface }}>
              <div className="h-full rounded-full transition-all" style={{ width: thisSkill + '%', background: thisSkill >= 95 ? C.emerald : thisSkill >= 80 ? C.gold : C.sky }} />
            </div>
            <div className="text-[10px] mt-1.5" style={{ color: C.textDim }}>
              {thisSkill >= 99 ? 'Perfect draft — best possible roster from your rolls.' : thisSkill >= 90 ? 'Strong draft. A near-optimal lineup.' : thisSkill >= 75 ? 'Solid, but a better assignment was available.' : 'Room to improve: you left impact on the board.'}
            </div>
          </div>
        )}

        {/* Balance */}
        <div className="mt-5 rounded-xl px-5 py-4 flex items-center justify-between" style={{ background: C.surfaceLo, border: `1px solid ${C.border}` }}>
          <span className="text-xs uppercase tracking-widest" style={{ color: C.textMuted }}>Balance</span>
          <span className="font-bold tabular-nums" style={{ fontSize: '1.5rem', color: C.text, fontFamily: 'var(--font-display, sans-serif)' }}>{s.credits.toFixed(2)}</span>
        </div>

        {/* Session stats */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <LabStat label="Games" value={s.games} />
          <LabStat label="Win %" value={winPct.toFixed(0) + '%'} />
          <LabStat label="Realized RTP" value={rtp.toFixed(1) + '%'} accent={Math.abs(rtp - 97) < 6 ? C.emerald : C.textMuted} />
          <LabStat label="Avg Skill" value={avgSkill != null ? avgSkill.toFixed(0) + '%' : '—'} accent={avgSkill != null && avgSkill >= 90 ? C.emerald : C.textMuted} />
        </div>
        <div className="text-center text-[10px] mt-2" style={{ color: C.textDim }}>
          Model targets ~97% RTP at optimal (100% skill) play · RTP and skill converge over many games
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={onPlayAgain}
            disabled={s.credits < LAB_STAKE}
            className="px-6 py-4 font-bold rounded-xl uppercase tracking-wider text-sm transition"
            style={{ background: s.credits < LAB_STAKE ? C.surface : C.gold, color: s.credits < LAB_STAKE ? C.textDim : C.bg, border: `1px solid ${s.credits < LAB_STAKE ? C.border : C.gold}` }}
          >
            {s.credits < LAB_STAKE ? 'Out of Credits' : `Play Again · ${LAB_STAKE} credits`}
          </button>
          <button onClick={onFastForward} className="px-6 py-3 font-bold rounded-xl uppercase tracking-wider text-xs transition" style={{ border: `1px solid ${C.sky}`, color: C.sky }}>
            Fast-Forward · Simulate Thousands
          </button>
          <button onClick={onReset} className="px-6 py-3 font-bold rounded-xl uppercase tracking-wider text-xs transition" style={{ border: `1px solid ${C.border}`, color: C.textMuted }}>
            Back to Menu
          </button>
        </div>
      </div>
    </div>
  );
}

function LabStat({ label, value, accent }) {
  return (
    <div className="rounded-xl px-3 py-3 text-center" style={{ background: C.surfaceLo, border: `1px solid ${C.border}` }}>
      <div className="text-[9px] uppercase tracking-widest mb-1" style={{ color: C.textDim }}>{label}</div>
      <div className="font-bold tabular-nums" style={{ color: accent || C.text, fontSize: '1.05rem' }}>{value}</div>
    </div>
  );
}

// Fast-Forward: batch-simulate many lab entries and chart the aggregate.
function LabBatchScreen({ onBack }) {
  const [count, setCount] = useState(1000);
  const [strategy, setStrategy] = useState('optimal');
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState(null);

  const run = () => {
    setRunning(true);
    setRes(null);
    // defer so the running state paints before the synchronous batch blocks
    setTimeout(() => {
      const out = runLabBatch(count, strategy);
      setRes(out);
      setRunning(false);
    }, 30);
  };

  const STRAT = [
    { id: 'optimal', label: 'Optimal', desc: 'Best possible roster every game' },
    { id: 'good', label: 'Strong', desc: 'Skilled human, occasional miss' },
    { id: 'random', label: 'Random', desc: 'Random valid picks' },
  ];
  const COUNTS = [100, 1000, 10000];

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-10 relative" style={{ background: C.bg, color: C.text }}>
      <div className="w-full max-w-md">
        <div className="text-center text-[10px] uppercase tracking-widest mb-4" style={{ color: C.textDim }}>
          Odds Lab · Fast-Forward · Play Credits
        </div>
        <h2 className="text-center font-bold mb-1" style={{ fontFamily: 'var(--font-display, sans-serif)', fontSize: '1.6rem', color: C.gold }}>Fast-Forward</h2>
        <p className="text-center text-xs mb-6" style={{ color: C.textMuted }}>Auto-play thousands of entries and watch the model's true numbers emerge.</p>

        {/* Strategy */}
        <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: C.textMuted }}>Drafting Skill</div>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {STRAT.map(st => (
            <button key={st.id} onClick={() => setStrategy(st.id)} className="rounded-xl px-2 py-3 text-center transition" style={{
              background: strategy === st.id ? C.surfaceHi : C.surfaceLo,
              border: `1.5px solid ${strategy === st.id ? C.gold : C.border}`,
            }}>
              <div className="text-sm font-bold" style={{ color: strategy === st.id ? C.gold : C.text }}>{st.label}</div>
              <div className="text-[9px] mt-1 leading-tight" style={{ color: C.textDim }}>{st.desc}</div>
            </button>
          ))}
        </div>

        {/* Count */}
        <div className="text-[10px] uppercase tracking-widest mb-2" style={{ color: C.textMuted }}>Entries</div>
        <div className="grid grid-cols-3 gap-2 mb-6">
          {COUNTS.map(c => (
            <button key={c} onClick={() => setCount(c)} className="rounded-xl px-2 py-3 text-center font-bold transition" style={{
              background: count === c ? C.surfaceHi : C.surfaceLo,
              border: `1.5px solid ${count === c ? C.sky : C.border}`,
              color: count === c ? C.sky : C.text,
            }}>{c.toLocaleString()}</button>
          ))}
        </div>

        <button onClick={run} disabled={running} className="w-full px-6 py-4 font-bold rounded-xl uppercase tracking-wider text-sm transition mb-3" style={{ background: running ? C.surface : C.gold, color: running ? C.textDim : C.bg, border: `1px solid ${C.gold}` }}>
          {running ? 'Simulating…' : `Run ${count.toLocaleString()} Entries`}
        </button>

        {res && (
          <div className="mt-2">
            {/* headline RTP */}
            <div className="rounded-2xl px-6 py-6 text-center mb-3" style={{ background: `linear-gradient(160deg, ${C.surfaceHi} 0%, ${C.surface} 100%)`, border: `2px solid ${C.emerald}` }}>
              <div className="text-[11px] font-bold uppercase tracking-widest mb-1" style={{ color: C.emerald }}>Realized RTP</div>
              <div className="font-bold" style={{ fontFamily: 'var(--font-display, sans-serif)', fontSize: '3rem', lineHeight: 1, color: C.emerald }}>{res.rtp.toFixed(1)}%</div>
              <div className="text-xs mt-2" style={{ color: C.textMuted }}>house edge {(100 - res.rtp).toFixed(1)}% over {res.N.toLocaleString()} entries</div>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <LabStat label="Win %" value={res.winPct.toFixed(1) + '%'} />
              <LabStat label="Avg Skill" value={res.avgSkill.toFixed(0) + '%'} accent={res.avgSkill >= 90 ? C.emerald : C.textMuted} />
              <LabStat label="Net Credits" value={(res.net >= 0 ? '+' : '') + res.net.toFixed(0)} accent={res.net >= 0 ? C.emerald : C.loss} />
              <LabStat label="Biggest Win" value={res.biggest.toFixed(0)} accent={C.gold} />
            </div>

            {/* band hit table */}
            <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
              <div className="px-4 py-2 text-[10px] uppercase tracking-widest" style={{ background: C.surfaceLo, color: C.textMuted }}>Outcome Frequency</div>
              {res.bandHits.map((b, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-2 text-xs" style={{ background: i % 2 ? C.surface : C.surfaceLo, borderTop: `1px solid ${C.border}` }}>
                  <span style={{ color: b.mult >= 18 ? C.gold : C.text }}>{b.name} {b.mult > 0 && <span style={{ color: C.textDim }}>· {b.mult}×</span>}</span>
                  <span className="tabular-nums" style={{ color: C.textMuted }}>{b.pct < 0.01 && b.hits > 0 ? '<0.01' : b.pct.toFixed(2)}% <span style={{ color: C.textDim }}>({b.hits})</span></span>
                </div>
              ))}
            </div>
            <div className="text-center text-[10px] mt-3" style={{ color: C.textDim }}>
              Bankroll swing across the run: peak +{res.peakCredits.toFixed(0)} / trough {res.minCredits.toFixed(0)} credits
            </div>
          </div>
        )}

        <button onClick={onBack} className="w-full mt-4 px-6 py-3 font-bold rounded-xl uppercase tracking-wider text-xs transition" style={{ border: `1px solid ${C.border}`, color: C.textMuted }}>
          Back
        </button>
      </div>
    </div>
  );
}

// Main game flow: draft the Beasts, reveal, draft your offense, sim, cinematic,
// result. Reused by Classic, Film Room, Daily, and the Odds Lab (lab=true).
function GameScreen({ mode, daily, lab, labState, onLabResult, onLabEntry, onFastForward, onReset }) {
  const [roster, setRoster] = useState({ QB: null, RB: null, RB2: null, WR1: null, WR2: null, WR3: null, TE: null, TE2: null, OL: null });
  const [usedIds, setUsedIds] = useState(new Set());
  const [slot, setSlot] = useState({ t: null, d: null });
  const [spinning, setSpinning] = useState(false);
  // Beasts: daily challenges use the pre-set deterministic defense; otherwise random.
  const [beasts] = useState(() => (daily ? daily.beasts : assembleBeasts()));
  const [phase, setPhase] = useState(daily ? 'reveal' : 'draftBeasts');
  const [teamSkipUsed, setTeamSkipUsed] = useState(false);
  const [eraSkipUsed, setEraSkipUsed] = useState(false);
  const [posFilter, setPosFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [result, setResult] = useState(null);
  const [showHowTo, setShowHowTo] = useState(false);
  // Lab skill tracking: record the team+decade pair shown each round so we can
  // compare the player's drafted impact to the optimal assignment of that exact
  // sequence (computePerfectTeam). Captured only in lab mode.
  const [rolledSeq, setRolledSeq] = useState([]);

  // Odds Lab: when a result with a payout is produced, report it to App exactly
  // once so credits/stats update. Keyed to the result object identity.
  const [labReported, setLabReported] = useState(false);
  useEffect(() => {
    if (lab && result && result._lab && !labReported) {
      setLabReported(true);
      if (onLabResult) onLabResult(result._lab);
    }
  }, [lab, result, labReported]);

  const filledCount = Object.values(roster).filter(Boolean).length;
  const currentRound = filledCount + 1;
  const openPositions = useMemo(() => getOpenPositions(roster), [roster]);

  // Determine the active slot on the field for visualization
  const activeFieldSlot = useMemo(() => {
    if (!slot.t) return null;
    if (openPositions.includes('WR')) {
      if (!roster.WR1) return 'WR1';
      if (!roster.WR2) return 'WR2';
      if (!roster.WR3) return 'WR3';
    }
    return null;
  }, [slot, openPositions, roster]);

  // spinSlot can be called three ways:
  //   - {}: full random spin (both team and decade)
  //   - {fixTeam: 'DET'}: keep the team, re-roll only the decade
  //   - {fixDecade: '1970s'}: keep the decade, re-roll only the team
  const spinSlot = ({ fixTeam = null, fixDecade = null } = {}) => {
    // Daily mode: team+decade are pre-set and identical for everyone, so they
    // appear instantly (no roll) — signaling the challenge is fixed/shared.
    if (daily) {
      setSearch('');
      setPosFilter('ALL');
      const idx = Object.values(roster).filter(Boolean).length;
      const pair = daily.sequence[idx] || daily.sequence[daily.sequence.length - 1];
      setSlot(pair || { t: null, d: null });
      setSpinning(false);
      setPhase('drafting');
      return;
    }
    setSpinning(true);
    setPhase('rolling');
    setSearch('');
    setPosFilter('ALL');
    setTimeout(() => {
      const allPairs = getValidPairs(roster, usedIds);
      // Cap the 1970s: once a '70s player is on the roster, no more '70s rolls.
      // (Players find the decade less fun, so it appears at most once.)
      const has70s = Object.values(roster).some(e => e && e.d === '1970s');
      const eligible = has70s ? allPairs.filter(p => p.d !== '1970s') : allPairs;
      let pool = eligible;
      if (fixTeam) {
        // Keep team, only need a different decade for it
        pool = eligible.filter(p => p.t === fixTeam && p.d !== slot.d);
        if (pool.length === 0) pool = eligible.filter(p => p.t === fixTeam);  // fallback
      } else if (fixDecade) {
        // Keep decade, only need a different team for it
        pool = eligible.filter(p => p.d === fixDecade && p.t !== slot.t);
        if (pool.length === 0) pool = eligible.filter(p => p.d === fixDecade);  // fallback
      }
      if (pool.length === 0) pool = eligible;  // fallback within the cap
      if (pool.length === 0) pool = allPairs;  // ultimate fallback
      const pair = pool[Math.floor(Math.random() * pool.length)];
      setSlot(pair || { t: null, d: null });
      // Lab: record the pair faced this round (skip rerolls, which keep the same
      // round — only the final committed pair per round matters for optimal calc).
      if (lab && pair) {
        setRolledSeq(seq => {
          const idx = Object.values(roster).filter(Boolean).length; // current round
          const next = [...seq];
          next[idx] = { t: pair.t, d: pair.d };
          return next.slice(0, idx + 1);
        });
      }
      setSpinning(false);
      setPhase('drafting');
    }, 950);
  };

  // Auto-spin once per draft round. Keyed to filledCount only — NOT phase —
  // because spinSlot itself flips phase ('rolling' -> 'drafting'), and including
  // phase here caused the effect to re-fire mid-spin and launch overlapping
  // spins that raced each other (the "rolls too long / jumps to a new team" bug).
  const lastSpunCount = React.useRef(-1);
  useEffect(() => {
    const draftingActive = phase !== 'draftBeasts' && phase !== 'reveal' && phase !== 'sim' && phase !== 'complete';
    if (draftingActive && filledCount < ROUNDS && lastSpunCount.current !== filledCount) {
      lastSpunCount.current = filledCount;
      spinSlot();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filledCount, phase]);

  // Player dismisses the Beasts reveal and starts drafting.
  const handleStartDraft = () => {
    setPhase('drafting');
  };

  const handleSelectPick = (pick, position) => {
    const targetSlot = targetSlotFor(position, roster);
    const entry = {
      n: pick.n,
      t: pick.t,
      d: pick.d,
      p: position,
      imp: pick.imp,
      slot: targetSlot,
      s: pick.s,
      key: pick.key,
    };
    const newRoster = { ...roster, [targetSlot]: entry };
    setRoster(newRoster);
    if (pick.idx !== undefined) {
      const newIds = new Set(usedIds);
      newIds.add(pick.idx);
      setUsedIds(newIds);
    }

    if (Object.values(newRoster).every(Boolean)) {
      setPhase('sim');
    }
  };

  // Run the matchup against the assembled Beasts.
  const handleRunSim = () => {
    // Daily: the strongest 10 lineups (a fraction of a percent of all ~226k
    // combinations) are guaranteed wins. Everything else runs the normal sim.
    // A lineup is a SET of players (you can slot them however you like), so we
    // compare the drafted player names as a set, not by exact slot.
    let forceWin = false;
    if (daily && daily.topLineups) {
      const yourSet = new Set(Object.values(roster).filter(Boolean).map(p => p.n));
      forceWin = daily.topLineups.some(lineup => {
        const want = Object.values(lineup).filter(Boolean);
        return want.length === yourSet.size && want.every(n => yourSet.has(n));
      });
    }
    const sim = simulateBeatdown(roster, beasts, forceWin, daily ? (daily.diffAdj || 0) : 0);
    // Odds Lab: derive the play-credit payout from the margin (with the rare
    // supernova tail that makes big bands reachable). Purely play money.
    if (lab) {
      const rawMargin = sim.yourScore - sim.beastScore;
      const shownMargin = labMargin(rawMargin);
      const band = labBandFor(shownMargin);
      const payout = +(band.mult * LAB_STAKE).toFixed(2);
      // Skill: compare your drafted total impact to the OPTIMAL assignment of the
      // exact sequence you faced. 100% = you built the best possible roster.
      let skillPct = null;
      try {
        const yourImp = Object.values(roster).reduce((a, p) => a + (p && p.imp ? p.imp : 0), 0);
        const persp = computePerfectTeam(rolledSeq);
        const bestImp = persp.reduce((a, x) => a + (x.player ? x.player.imp : 0), 0);
        if (bestImp > 0) skillPct = Math.max(0, Math.min(100, (yourImp / bestImp) * 100));
      } catch (e) { skillPct = null; }
      sim._lab = { rawMargin, shownMargin, band, payout, stake: LAB_STAKE, skillPct };
    }
    setResult(sim);
    setPhase('cinematic');
  };

  // "Skip Team" — keep the decade, re-roll only the team
  const handleSkipTeam = () => {
    if (teamSkipUsed) return;
    setTeamSkipUsed(true);
    spinSlot({ fixDecade: slot.d });
  };

  // AUTO-DRAFT — fills the entire roster with a strong team in one pass, then
  // jumps straight to the sim. Greedy: each round, take the highest-impact
  // available player for that round's team/decade pair. Lands ~90-100% of the
  // optimal roster, so you can watch results fast without hand-picking 9 slots.
  const handleAutoDraft = () => {
    // Build the team/decade sequence: fixed in daily, rolled in unlimited.
    let sequence;
    if (daily) {
      sequence = daily.sequence;
    } else {
      sequence = [];
      let work = { QB: null, RB: null, RB2: null, WR1: null, WR2: null, WR3: null, TE: null, TE2: null, OL: null };
      for (let i = 0; i < ROUNDS; i++) {
        const pairs = getValidPairs(work, new Set());
        const has70s = sequence.some(p => p.d === '1970s');
        const elig = has70s ? pairs.filter(p => p.d !== '1970s') : pairs;
        const from = elig.length ? elig : pairs;
        if (!from.length) break;
        const pair = from[Math.floor(Math.random() * from.length)];
        sequence.push(pair);
        // tentatively occupy a slot so getValidPairs varies the open positions
        const openP = getOpenPositions(work);
        const slotName = SLOT_ORDER.find(s => !work[s] && openP.includes(_posOfSlot(s)));
        if (slotName) work[slotName] = { n: '_', t: pair.t, d: pair.d, imp: 0, p: _posOfSlot(slotName), s: {} };
      }
    }
    // Solve the optimal slot assignment for that sequence (same DP the game uses
    // for the "perfect team"), so the auto roster is the best possible for the
    // draw — 100% of optimal. In the daily that triggers the guaranteed win.
    const persp = (daily ? daily.perfect : computePerfectTeam(sequence));
    const r = { QB: null, RB: null, RB2: null, WR1: null, WR2: null, WR3: null, TE: null, TE2: null, OL: null };
    persp.forEach(x => {
      if (x.player) {
        r[x.slot] = { n: x.player.n, t: x.player.t || x.t, d: x.player.d || x.d, p: _posOfSlot(x.slot), imp: x.player.imp, slot: x.slot, s: x.player.s, key: x.player.key };
      }
    });
    // Safety net: never leave a slot empty (the sim needs every slot populated).
    SLOT_ORDER.forEach(s => { if (!r[s]) r[s] = { n: '—', t: 'FA', d: '2010s', p: _posOfSlot(s), imp: 50, slot: s, s: {} }; });
    setRoster(r);
    setPhase('sim');
  };

  // "Skip Era" — keep the team, re-roll only the decade
  const handleSkipEra = () => {
    if (eraSkipUsed) return;
    setEraSkipUsed(true);
    spinSlot({ fixTeam: slot.t });
  };

  const availablePicks = useMemo(() => {
    if (!slot.t || !slot.d || phase !== 'drafting') return {};
    return getAvailablePicks(slot.t, slot.d, roster, usedIds);
  }, [slot, roster, usedIds, phase]);

  const filteredList = useMemo(() => {
    const positions = posFilter === 'ALL' ? Object.keys(availablePicks) : (availablePicks[posFilter] ? [posFilter] : []);
    const out = [];
    positions.forEach(pos => {
      availablePicks[pos].forEach(item => {
        if (search) {
          const hay = (item.n + ' ' + (item.key || '')).toLowerCase();
          if (!hay.includes(search.toLowerCase())) return;
        }
        out.push({ pick: item, position: pos });
      });
    });
    return out;
  }, [availablePicks, posFilter, search]);

  if (phase === 'draftBeasts') {
    return <BeastsDraftScreen beasts={beasts} onComplete={() => setPhase('reveal')} />;
  }

  if (phase === 'reveal') {
    return <BeastsRevealScreen beasts={beasts} mode={mode} daily={!!daily} onStart={handleStartDraft} onReset={onReset} />;
  }

  if (phase === 'sim') {
    return <SimRunScreen roster={roster} beasts={beasts} onComplete={handleRunSim} />;
  }

  if (phase === 'cinematic' && result) {
    return <CinematicScreen result={result} onDone={() => setPhase('complete')} />;
  }

  if (phase === 'complete' && result) {
    if (lab) {
      return <LabResultScreen roster={roster} result={result} beasts={beasts} labState={labState} onPlayAgain={onLabEntry} onFastForward={onFastForward} onReset={onReset} />;
    }
    return <ResultScreen roster={roster} result={result} beasts={beasts} onReset={onReset} dailyPerfect={daily ? daily.perfect : null} />;
  }

  return (
    <div className="min-h-screen relative" style={{ background: C.bg, color: C.text }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: `repeating-linear-gradient(90deg, transparent 0px, transparent 80px, rgba(170,255,0,0.03) 80px, rgba(170,255,0,0.03) 82px)`,
      }} />
      {showHowTo && <HowToPlayModal onClose={() => setShowHowTo(false)} />}

      {/* Header */}
      <header className="w-full px-4 py-3 relative z-10" style={{ background: C.surfaceLo, borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <Logo size="small" />
            <div className="flex items-center gap-3 pl-3" style={{ borderLeft: `1px solid ${C.border}` }}>
              <div>
                <div className="text-[9px] uppercase tracking-widest font-bold" style={{ color: C.textDim }}>Round</div>
                <div className="font-black tabular-nums" style={{ color: C.text }}>{currentRound}/{ROUNDS}</div>
              </div>
              <Pill style={{
                background: daily ? 'rgba(170,255,0,0.15)' : (mode === 'classic' ? 'rgba(251,191,36,0.15)' : 'rgba(56,189,248,0.15)'),
                color: daily ? C.emerald : (mode === 'classic' ? C.gold : C.sky),
                borderColor: daily ? 'rgba(170,255,0,0.4)' : (mode === 'classic' ? 'rgba(251,191,36,0.4)' : 'rgba(56,189,248,0.4)'),
              }}>
                {daily ? 'Daily' : (mode === 'classic' ? 'Classic' : 'Film Room')}
              </Pill>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowHowTo(true)} className="w-9 h-9 rounded-md flex items-center justify-center transition" style={{ border: `1px solid ${C.border}`, color: C.textMuted }}>
              <Info className="w-4 h-4" />
            </button>
            <button onClick={onReset} className="w-9 h-9 rounded-md flex items-center justify-center transition" style={{ border: `1px solid ${C.border}`, color: C.textMuted }}>
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Slot row */}
      <div className="w-full px-4 py-4 relative z-10">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: C.textDim }}>You drew</span>
            <SlotMachine team={slot.t} decade={slot.d} spinning={spinning} />
            {!spinning && slot.t && (
              <span className="text-[11px] uppercase tracking-widest" style={{ color: C.textMuted }}>
                · Pick any open position
              </span>
            )}
          </div>
          {!daily && !lab && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleSkipTeam}
              disabled={teamSkipUsed || spinning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition"
              style={{
                border: `1px solid ${teamSkipUsed ? C.border : C.borderHi}`,
                color: teamSkipUsed ? C.textDim : C.text,
                opacity: teamSkipUsed ? 0.4 : 1,
                cursor: teamSkipUsed || spinning ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw className="w-3 h-3" /> Team
            </button>
            <button
              onClick={handleSkipEra}
              disabled={eraSkipUsed || spinning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition"
              style={{
                border: `1px solid ${eraSkipUsed ? C.border : C.borderHi}`,
                color: eraSkipUsed ? C.textDim : C.text,
                opacity: eraSkipUsed ? 0.4 : 1,
                cursor: eraSkipUsed || spinning ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw className="w-3 h-3" /> Era
            </button>
          </div>
          )}
          {!lab && (
            <button
              onClick={handleAutoDraft}
              disabled={spinning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition"
              style={{
                background: C.emerald,
                color: C.bg,
                opacity: spinning ? 0.5 : 1,
                cursor: spinning ? 'not-allowed' : 'pointer',
              }}
              title="Fill a strong roster and jump straight to results"
            >
              <Sparkles className="w-3 h-3" /> Auto-Draft
            </button>
          )}
        </div>
      </div>

      {/* Main grid */}
      <main className="px-4 pb-8 relative z-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT */}
          <div>
            {/* Position filter tabs */}
            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              <FilterTab
                label="All"
                count={Object.values(availablePicks).reduce((s, a) => s + a.length, 0)}
                active={posFilter === 'ALL'}
                onClick={() => setPosFilter('ALL')}
              />
              {POSITIONS.map(pos => {
                const isFilled = !openPositions.includes(pos);
                const count = (availablePicks[pos] || []).length;
                return (
                  <FilterTab
                    key={pos}
                    label={pos}
                    count={count}
                    active={posFilter === pos}
                    disabled={count === 0}
                    dimmed={isFilled}
                    color={POS_HEX[pos]}
                    onClick={() => setPosFilter(pos)}
                  />
                );
              })}
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.textDim }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search players or units..."
                className="w-full pl-10 pr-4 py-2.5 rounded-lg text-sm focus:outline-none transition"
                style={{
                  background: C.surface,
                  border: `1px solid ${C.border}`,
                  color: C.text,
                }}
              />
            </div>

            <div className="space-y-2.5 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 340px)' }}>
              {spinning ? (
                <div className="text-center py-12 text-sm" style={{ color: C.textMuted }}>Spinning the wheel...</div>
              ) : filteredList.length === 0 ? (
                <div className="rounded-xl p-8 text-center" style={{ background: C.surface, border: `1px dashed ${C.border}` }}>
                  <div className="text-sm mb-2" style={{ color: C.textMuted }}>
                    {Object.keys(availablePicks).length === 0
                      ? 'No open positions match this team/decade.'
                      : 'No matches for your filter.'}
                  </div>
                  <div className="text-xs" style={{ color: C.textDim }}>Try a different filter, clear search, or use a skip.</div>
                </div>
              ) : (
                filteredList.map((item, i) => (
                  <PickCard
                    key={`${item.position}-${i}`}
                    pick={item.pick}
                    position={item.position}
                    mode={mode}
                    daily={!!daily}
                    onSelect={handleSelectPick}
                    disabled={!openPositions.includes(item.position)}
                  />
                ))
              )}
            </div>
          </div>

          {/* RIGHT */}
          <div className="lg:sticky lg:top-4 h-fit">
            <div className="max-w-md mx-auto">
              <FootballField roster={roster} activeSlot={activeFieldSlot} beasts={beasts} />
            </div>
            <div className="mt-3 grid grid-cols-5 gap-1.5 max-w-md mx-auto">
              {SLOT_ORDER.map(s => {
                const filled = !!roster[s];
                const basePos = s.replace(/[123]/g, '');
                const ph = POS_HEX[basePos];
                return (
                  <div
                    key={s}
                    className="relative aspect-square rounded-md flex flex-col items-center justify-center transition"
                    style={{
                      background: filled ? ph.bg : C.surface,
                      border: `1px solid ${filled ? ph.border : C.border}`,
                    }}
                  >
                    <div className="text-[9px] font-bold uppercase" style={{ color: filled ? ph.text : C.textDim }}>{s}</div>
                    <div className="text-[8px] tabular-nums" style={{ color: filled ? ph.text : C.textDim, opacity: 0.7 }}>
                      {filled ? roster[s].d.slice(0, 2) + "'" : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function FilterTab({ label, count, active, disabled, dimmed, color, onClick }) {
  const baseStyle = {
    background: active ? (color ? color.bg : C.surfaceHi) : C.surface,
    color: disabled ? C.textDim : active ? (color ? color.text : C.text) : C.textMuted,
    border: `1px solid ${active ? (color ? color.border : C.borderHi) : C.border}`,
    opacity: disabled ? 0.35 : dimmed ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition"
      style={baseStyle}
    >
      {label}
      {count > 0 && (
        <span className="text-[9px] tabular-nums opacity-70">{count}</span>
      )}
    </button>
  );
}

// ============================================================
// ROOT
// ============================================================
// ============================================================
// CHARACTERIZATION STORE + EDITOR
// ============================================================

// Persistence: prefer the artifact storage API when present; otherwise keep an
// in-memory map and rely on JSON export/import so work survives in the
// standalone build. Shape: { [playerName]: { skin, hair, style, face } }.
const CHAR_KEY = 'btb_characterization_v1';
let _charCache = null;

async function loadCharacterization() {
  if (_charCache) return _charCache;
  try {
    if (typeof window !== 'undefined' && window.storage && window.storage.get) {
      const res = await window.storage.get(CHAR_KEY);
      _charCache = res && res.value ? JSON.parse(res.value) : {};
      return _charCache;
    }
  } catch (e) { /* fall through to in-memory */ }
  _charCache = _charCache || {};
  return _charCache;
}

async function saveCharacterization(map) {
  _charCache = map;
  try {
    if (typeof window !== 'undefined' && window.storage && window.storage.set) {
      await window.storage.set(CHAR_KEY, JSON.stringify(map));
    }
  } catch (e) { /* in-memory only */ }
}

function CharacterizationEditor({ onClose }) {
  const [charMap, setCharMap] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [group, setGroup] = useState('ALL');
  const [query, setQuery] = useState('');
  const [onlyUnset, setOnlyUnset] = useState(false);
  const [selected, setSelected] = useState(null); // player name being edited

  useEffect(() => {
    let alive = true;
    loadCharacterization().then(m => { if (alive) { setCharMap({ ...m }); setLoaded(true); } });
    return () => { alive = false; };
  }, []);

  // Build the editable pool: every offense + defense player EXCEPT offensive line.
  const pool = useMemo(() => {
    const off = PLAYERS.filter(p => p.p !== 'OL');
    const def = DEFENSE.map(p => ({ ...p }));
    const all = [...off, ...def];
    // de-dupe by name+team+decade so a player appears once
    const seen = new Set();
    const uniq = [];
    for (const p of all) {
      const k = p.n + '|' + p.t + '|' + p.d;
      if (!seen.has(k)) { seen.add(k); uniq.push(p); }
    }
    return uniq;
  }, []);

  const GROUPS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'DEF'];
  const inGroup = (p) => {
    if (group === 'ALL') return true;
    if (group === 'DEF') return ['DE', 'DT', 'LB', 'CB', 'S', 'DB'].includes(p.p);
    return p.p === group;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool.filter(p => {
      if (!inGroup(p)) return false;
      if (q && !p.n.toLowerCase().includes(q)) return false;
      if (onlyUnset && charMap[p.n]) return false;
      return true;
    });
  }, [pool, group, query, onlyUnset, charMap]);

  const setTrait = (name, key, val) => {
    setCharMap(prev => {
      const next = { ...prev, [name]: { ...(prev[name] || {}), [key]: val } };
      saveCharacterization(next);
      return next;
    });
  };

  const setCount = Object.keys(charMap).filter(n => charMap[n] && charMap[n].skin != null).length;

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(charMap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'btb_characterization.json'; a.click();
    URL.revokeObjectURL(url);
  };
  const importJSON = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const merged = { ...charMap, ...data };
        setCharMap(merged); saveCharacterization(merged);
      } catch (err) { /* ignore bad file */ }
    };
    reader.readAsText(file);
  };

  const swatchFor = (p) => {
    const c = charMap[p.n];
    if (c && c.skin != null) return SKIN_TONES[c.skin].hex;
    return null;
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: C.bg }}>
      {/* header */}
      <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.border}`, background: C.surfaceLo }}>
        <div className="flex items-center gap-3">
          <h2 className="text-xl" style={{ fontFamily: 'var(--font-display, sans-serif)', fontWeight: 800, color: C.text, textTransform: 'uppercase', letterSpacing: '0.02em' }}>Characterization</h2>
          <span className="text-xs tabular-nums" style={{ color: C.textMuted }}>{setCount} / {pool.length} set</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportJSON} className="text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-lg" style={{ color: C.text, background: C.surface, border: `1px solid ${C.border}` }}>Export</button>
          <label className="text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-lg cursor-pointer" style={{ color: C.text, background: C.surface, border: `1px solid ${C.border}` }}>
            Import<input type="file" accept="application/json" onChange={importJSON} style={{ display: 'none' }} />
          </label>
          <button onClick={onClose} className="p-1.5 rounded-lg" style={{ color: C.textMuted, background: C.surface, border: `1px solid ${C.border}` }}><X className="w-4 h-4" /></button>
        </div>
      </div>

      {/* filters */}
      <div className="px-5 py-3 flex flex-wrap items-center gap-2" style={{ borderBottom: `1px solid ${C.border}` }}>
        {GROUPS.map(g => (
          <button key={g} onClick={() => setGroup(g)} className="text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-lg transition"
            style={{ color: group === g ? C.bg : C.textMuted, background: group === g ? C.emerald : C.surface, border: `1px solid ${group === g ? C.emerald : C.border}` }}>{g}</button>
        ))}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg flex-1 min-w-[160px]" style={{ background: C.surface, border: `1px solid ${C.border}` }}>
          <Search className="w-3.5 h-3.5" style={{ color: C.textDim }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search player..." className="bg-transparent outline-none text-sm flex-1" style={{ color: C.text }} />
        </div>
        <button onClick={() => setOnlyUnset(v => !v)} className="text-[11px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-lg"
          style={{ color: onlyUnset ? C.bg : C.textMuted, background: onlyUnset ? C.gold : C.surface, border: `1px solid ${onlyUnset ? C.gold : C.border}` }}>Unset only</button>
      </div>

      {/* player grid */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {filtered.slice(0, 600).map((p, i) => {
            const sw = swatchFor(p);
            const c = charMap[p.n] || {};
            return (
              <button key={p.n + i} onClick={() => setSelected(p.n)} className="flex items-center gap-3 px-3 py-2 rounded-lg text-left transition"
                style={{ background: selected === p.n ? C.surfaceHi : C.surface, border: `1px solid ${selected === p.n ? C.emerald : C.border}` }}>
                <span className="w-6 h-6 rounded-full shrink-0" style={{ background: sw || 'transparent', border: sw ? 'none' : `1.5px dashed ${C.borderHi}` }} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate" style={{ color: C.text }}>{p.n}</span>
                  <span className="block text-[10px] truncate" style={{ color: C.textDim }}>{p.p} · {p.t} · {p.d}</span>
                </span>
                {c.skin != null && <span className="text-[9px] font-bold uppercase" style={{ color: C.emerald }}>set</span>}
              </button>
            );
          })}
        </div>
        {filtered.length > 600 && <p className="text-xs mt-3 text-center" style={{ color: C.textDim }}>Showing first 600 of {filtered.length}. Narrow with filters.</p>}
      </div>

      {/* trait picker drawer */}
      {selected && (
        <div className="px-5 py-4" style={{ borderTop: `1px solid ${C.border}`, background: C.surfaceLo }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold" style={{ color: C.text }}>{selected}</span>
            <button onClick={() => setSelected(null)} className="text-[11px] uppercase tracking-wide" style={{ color: C.textMuted }}>Done</button>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            {TRAIT_DEFS.map(tr => (
              <div key={tr.key}>
                <div className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: C.textMuted }}>{tr.name}</div>
                <div className="flex flex-wrap gap-1.5">
                  {tr.options.map(opt => {
                    const active = (charMap[selected] || {})[tr.key] === opt.id;
                    return (
                      <button key={opt.id} onClick={() => setTrait(selected, tr.key, opt.id)}
                        className="px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1.5 transition"
                        style={{ background: active ? C.surfaceHi : C.surface, border: `1.5px solid ${active ? C.emerald : C.border}`, color: C.text }}>
                        {tr.swatch && opt.hex && opt.hex !== 'none' && <span className="w-3 h-3 rounded-full" style={{ background: opt.hex }} />}
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState('home');
  const [mode, setMode] = useState('classic');
  const [showHowTo, setShowHowTo] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [daily, setDaily] = useState(null);
  const [lab, setLab] = useState(false);
  // Odds Lab session: play credits + running stats. Resets when you leave the lab.
  const [labState, setLabState] = useState({ credits: LAB_START_CREDITS, games: 0, wins: 0, wagered: 0, returned: 0, skillSum: 0, skillGames: 0 });
  const [gameKey, setGameKey] = useState(0);

  const startGame = (m) => {
    setMode(m);
    setDaily(null);
    setLab(false);
    setScreen('game');
    setGameKey(k => k + 1);
  };

  // Enter the Odds Lab: fresh session credits, deduct first stake, start a game.
  const startLab = () => {
    setLab(true);
    setDaily(null);
    setMode('classic');
    setLabState({ credits: LAB_START_CREDITS - LAB_STAKE, games: 0, wins: 0, wagered: LAB_STAKE, returned: 0, skillSum: 0, skillGames: 0 });
    setScreen('game');
    setGameKey(k => k + 1);
  };

  // Play another lab entry: deduct the stake, start a fresh game (same session).
  const labEntry = () => {
    setLabState(s => ({ ...s, credits: s.credits - LAB_STAKE, wagered: s.wagered + LAB_STAKE }));
    setGameKey(k => k + 1);
  };

  // A lab game finished: credit the payout and update session stats.
  const labResult = (labInfo) => {
    setLabState(s => ({
      ...s,
      credits: s.credits + labInfo.payout,
      games: s.games + 1,
      wins: s.wins + (labInfo.payout > 0 ? 1 : 0),
      returned: s.returned + labInfo.payout,
      skillSum: s.skillSum + (labInfo.skillPct != null ? labInfo.skillPct : 0),
      skillGames: s.skillGames + (labInfo.skillPct != null ? 1 : 0),
    }));
  };

  const openFastForward = () => setScreen('labBatch');
  const closeFastForward = () => setScreen('home');

  // Daily challenge: deterministic for everyone, always Film Room.
  const startDaily = () => {
    setDaily(getDailyChallenge(todayKey()));
    setMode('film');
    setScreen('game');
    setGameKey(k => k + 1);
  };

  const reset = () => {
    setScreen('home');
    setDaily(null);
    setLab(false);
    setGameKey(k => k + 1);
  };

  return (
    <div style={{ fontFamily: 'var(--font-body, system-ui, sans-serif)' }}>
      {showHowTo && <HowToPlayModal onClose={() => setShowHowTo(false)} />}
      {showEditor && <CharacterizationEditor onClose={() => setShowEditor(false)} />}
      {screen === 'home' && <HomeScreen onSelectMode={startGame} onStartDaily={startDaily} onStartLab={startLab} onShowHowTo={() => setShowHowTo(true)} onOpenEditor={() => setShowEditor(true)} />}
      {screen === 'game' && <GameScreen key={gameKey} mode={mode} daily={daily} lab={lab} labState={labState} onLabResult={labResult} onLabEntry={labEntry} onFastForward={openFastForward} onReset={reset} />}
      {screen === 'labBatch' && <LabBatchScreen onBack={closeFastForward} />}
    </div>
  );
}
