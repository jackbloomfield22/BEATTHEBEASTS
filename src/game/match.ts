// A full game against the Beasts (GDD §7), as a pure state machine the game
// screen drives. It never touches the sim's internals: it's told how each
// of your plays ended (the sim's PlayResult) and what you chose (PAT or two,
// field goal, punt), and it decides the rest: downs, scores, possessions, the
// Beasts' "Meanwhile" drives, the clock, overtime and the grade.
//
// Deterministic from the game seed (§15 D1): every random draw comes from
// named streams of it (engine/rng deriveStream).

import { clampN } from '@/engine/legacy/util';
import { deriveStream, gaussNoise, type Rng } from '@/engine/rng';
import type { PlayResult } from '@/sim';
import { HASH_Y, type Situation } from './situation';

export type GameLength = 4 | 6 | 10;
export type Side = 'user' | 'beasts';

export interface MatchConfig {
  drives: GameLength;
  seed: number;
  /** The Beasts' unit rating on the OVR-fed scale (src/game/beasts.ts). */
  beastsRating: number;
  /** The Daily's handicap on the Beasts' scoring (legacy units; 0 outside the Daily). */
  diffAdj: number;
  /** The Contenders kicker's longest make with a perfect strike, yd (fixed per difficulty, GDD §9.6). */
  kickerRange: number;
}

/** What one Beasts possession did (the "Meanwhile" cut's lower third). */
export interface BeastsDrive {
  result: 'TD' | 'FG' | 'Punt' | 'Turnover' | 'Downs' | 'Safety' | 'MissedFG';
  points: number;
  plays: number;
  yards: number;
  /** Minutes:seconds it took (presentational). */
  top: string;
  twoPoint?: { tried: true; good: boolean };
  /** Where your next drive starts (yards from your goal line). */
  nextStart: number;
}

export interface UserDrive {
  start: number;
  plays: number;
  yards: number;
  result: 'TD' | 'FG' | 'MissedFG' | 'Punt' | 'Turnover' | 'Downs' | 'Safety' | 'EndOfHalf' | 'EndOfGame' | 'TwoPoint';
  points: number;
  /** Beasts points scored on the drive (a pick-six, a safety). */
  against: number;
}

export type MatchPhase =
  | 'meanwhile' // a Beasts possession is being shown
  | 'drive' // your drive: the play call is next
  | 'fourth' // a 4th-down decision (go, punt, field goal)
  | 'try' // after your TD: PAT or 2
  | 'twoPoint' // a 2-point try is on (one play from the 3)
  | 'kick' // a field goal or PAT kick is on
  | 'final';

export interface ClockState {
  quarter: number;
  /** Seconds left in the quarter. */
  secs: number;
  /** The live two-minute drill is on (your last drive, trailing or tied). */
  live: boolean;
  timeouts: number;
}

export interface Match {
  cfg: MatchConfig;
  /** 1-based round (a Beasts possession and your drive). */
  round: number;
  /** Overtime period (0 in regulation). */
  ot: number;
  phase: MatchPhase;
  score: Record<Side, number>;
  sit: Situation;
  clock: ClockState;
  beastsDrives: BeastsDrive[];
  userDrives: UserDrive[];
  /** The drive in progress. */
  drive: UserDrive | null;
  /** The kick on now: its distance (yd from the spot to the goal posts) and kind. */
  kick: { kind: 'PAT' | 'FG'; distance: number } | null;
  /** Wind for the game: mph and direction (radians; 0 = blowing downfield, toward the posts you attack). */
  wind: { mph: number; dir: number };
  /** The Beasts' game-level noise (legacy's per-game gauss term). */
  z: number;
  /** Seconds of play-clock runoff since the last snap (the live two-minute clock). */
  lastWhistle: 'stops' | 'runs';
  log: string[];
}

const RNG_CACHE = new WeakMap<Match, Record<string, Rng>>();
function stream(m: Match, name: string): Rng {
  let c = RNG_CACHE.get(m);
  if (!c) RNG_CACHE.set(m, (c = {}));
  return (c[name] ??= deriveStream(m.cfg.seed, `match:${name}`));
}

/** The Beasts' rating on legacy's scale (legacy ≈ 1.518·new − 53.01: src/game/daily.ts). */
export const legacyScale = (r: number): number => 1.518 * r - 53.01;

export function createMatch(cfg: MatchConfig, windScale = 1): Match {
  const r = deriveStream(cfg.seed, 'match:setup');
  // Wind: the legacy WindChip range, 2–12 mph (GDD §9.6), stronger in weather presets.
  const mph = Math.round((2 + r() * 10) * windScale);
  const m: Match = {
    cfg,
    round: 1,
    ot: 0,
    phase: 'meanwhile',
    score: { user: 0, beasts: 0 },
    sit: { los: 25, ballY: 0, down: 1, toGo: 10 },
    clock: { quarter: 1, secs: 15 * 60, live: false, timeouts: 3 },
    beastsDrives: [],
    userDrives: [],
    drive: null,
    kick: null,
    wind: { mph, dir: r() * Math.PI * 2 },
    z: gaussNoise(r) * 3.5,
    lastWhistle: 'stops',
    log: [],
  };
  return m;
}

// ---- The Beasts' possessions -----------------------------------------------------------

/**
 * Expected Beasts points over a legacy 10-drive game (legacy simulateBeatdown,
 * legacy 4974–5460): 19.5 + (effRating − 80)·0.53 plus a per-game noise
 * (sd 3.5), and the answer-back term clamp((yourScore − 23)·1.05, 0, 28)
 * that makes elite offenses face a shootout. effRating is the Beasts'
 * rating on legacy's scale minus the Daily's handicap (clamped 0..20, as
 * legacy).
 */
export function beastsGameTotal(m: Match, userPace10: number): number {
  const eff = legacyScale(m.cfg.beastsRating) - clampN(m.cfg.diffAdj, 0, 20);
  const base = clampN(19.5 + (eff - 80) * 0.53 + m.z, 6, 37);
  return base + clampN((userPace10 - 23) * 1.05, 0, 28);
}

/**
 * One Beasts possession. Legacy scores a whole game at once; here each
 * possession aims at the points still "owed" on legacy's game total, scaled
 * to game length (§7.3): expectation e = (total·N/10 − scored) / possessions
 * left, clamped 0..7, re-read every possession so the answer-back follows
 * your running score. The outcome is drawn around e: field goals are a share
 * that grows with e, touchdowns make up the rest of it; the misses split into
 * punts, turnovers and turnovers on downs as NFL drives do (≈ 70/22/8).
 */
export function beastsPossession(m: Match): BeastsDrive {
  const r = stream(m, `beasts${m.round}-${m.ot}`);
  const n = m.cfg.drives;
  const played = m.userDrives.length;
  const pace10 = played ? (m.score.user / played) * 10 : 0;
  // Early in the game the projection is thin: blend it in with the rounds played.
  const pace = played ? pace10 * Math.min(1, played / 3) + 23 * (1 - Math.min(1, played / 3)) : 23;
  let e: number;
  if (m.ot) {
    // Overtime from your 25: roughly college OT (≈ 50% TD, 25% FG) scaled by strength.
    e = clampN(4.3 + (legacyScale(m.cfg.beastsRating) - 85) * 0.08, 3, 5.6);
  } else {
    const total = (beastsGameTotal(m, pace) * n) / 10;
    const left = n - m.beastsDrives.length;
    e = clampN((total - m.score.beasts) / Math.max(1, left), 0, 7);
  }
  if (m.ot >= 3) {
    // Third overtime on: each possession is one two-point try (§7.5).
    const good = r() < 0.48;
    return { result: good ? 'TD' : 'Downs', points: good ? 2 : 0, plays: 1, yards: good ? 3 : 0, top: '0:00', twoPoint: { tried: true, good }, nextStart: 97 };
  }
  const pFG = clampN(0.1 * e, 0.04, 0.3);
  const pTD = clampN((e - 3 * pFG) / 6.95, 0, 0.93);
  const u = r();
  const start = m.userDrives.length ? beastsStartFrom(m.userDrives[m.userDrives.length - 1]!) : 25;
  const plays = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const top = (p: number) => {
    const s = Math.round(p * (24 + r() * 14));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  let d: BeastsDrive;
  if (u < pTD) {
    const p = plays(5, 13);
    d = { result: 'TD', points: 7, plays: p, yards: 100 - start, top: top(p), nextStart: 25 };
    // Their two-point chart: go for two down 2, up 1 or up 5 after the six (late); else kick.
    const after6 = m.score.beasts + 6 - m.score.user;
    const late = m.round >= n - 1 || m.ot > 0;
    if (m.ot >= 3 || (late && (after6 === -2 || after6 === 1 || after6 === 5))) {
      const good = r() < 0.48; // NFL two-point conversion rate, 2015–2023 ≈ 48%
      d.twoPoint = { tried: true, good };
      d.points = 6 + (good ? 2 : 0);
    } else if (r() < 0.06) d.points = 6; // a missed PAT: 94% since the 2015 move back
  } else if (u < pTD + pFG) {
    const p = plays(6, 12);
    const yards = Math.round((100 - start) * (0.55 + r() * 0.2));
    d = { result: 'FG', points: 3, plays: p, yards, top: top(p), nextStart: 25 };
  } else {
    const v = r();
    const p = plays(3, 8);
    const yards = Math.round(p * (1.5 + r() * 4));
    if (v < 0.7) d = { result: 'Punt', points: 0, plays: p, yards, top: top(p), nextStart: Math.round(12 + r() * 18) };
    else if (v < 0.92) d = { result: 'Turnover', points: 0, plays: p, yards, top: top(p), nextStart: Math.round(40 + r() * 15) };
    else if (v < 0.985) d = { result: 'Downs', points: 0, plays: p, yards, top: top(p), nextStart: Math.round(100 - clampN(start + yards, 30, 70)) };
    else d = { result: 'Safety', points: 0, plays: p, yards: -Math.round(r() * 3), top: top(p), nextStart: 35 };
  }
  if (m.ot) d.nextStart = 75; // OT: you start at their 25
  return d;
}

/** Where the Beasts start after your drive (for the Meanwhile line; yards from their goal line). */
function beastsStartFrom(u: UserDrive): number {
  if (u.result === 'Punt') return 20;
  if (u.result === 'Turnover' || u.result === 'Downs') return clampN(100 - (u.start + u.yards), 5, 80);
  return 25;
}

/** Apply a Beasts possession: score it, and set up your drive. */
export function applyBeastsDrive(m: Match, d: BeastsDrive): void {
  m.beastsDrives.push(d);
  m.score.beasts += d.points;
  if (d.result === 'Safety') m.score.user += 2;
  m.log.push(`Beasts: ${d.result}${d.points ? ` (+${d.points})` : ''}`);
  if (m.ot >= 3) {
    startTwoPointOnly(m);
    return;
  }
  startDrive(m, d.nextStart);
}

// ---- Your drives -----------------------------------------------------------------------

function startDrive(m: Match, los: number): void {
  m.sit = { los, ballY: 0, down: 1, toGo: Math.min(10, 100 - los) };
  m.drive = { start: los, plays: 0, yards: 0, result: 'Downs', points: 0, against: 0 };
  m.phase = 'drive';
  m.kick = null;
  // The last regulation drive: the clock goes live when you're trailing or tied (§7.4).
  const last = !m.ot && m.round === m.cfg.drives;
  m.clock.live = last && m.score.user <= m.score.beasts;
  if (last) {
    m.clock.quarter = 4;
    m.clock.secs = m.clock.live ? 120 : Math.min(m.clock.secs, 150);
    m.clock.timeouts = 3;
  }
  m.lastWhistle = 'stops';
}

function startTwoPointOnly(m: Match): void {
  m.sit = { los: 97, ballY: 0, down: 1, toGo: 3 };
  m.drive = { start: 97, plays: 0, yards: 0, result: 'TwoPoint', points: 0, against: 0 };
  m.phase = 'twoPoint';
}

/** Presentational clock: each round is an equal share of the 60 minutes. */
function advanceClockForRound(m: Match): void {
  if (m.ot) return;
  const per = 3600 / m.cfg.drives;
  const elapsed = per * (m.round - 1);
  const q = Math.min(4, Math.floor(elapsed / 900) + 1);
  const secs = Math.max(0, 900 * q - elapsed);
  m.clock.quarter = q;
  m.clock.secs = secs === 0 && q < 4 ? 900 : secs;
  if (secs === 0 && q < 4) m.clock.quarter = q + 1;
}

/** Stops the live clock (incompletion, out of bounds, score, turnover, change of possession). */
const STOPS = new Set(['incomplete', 'outOfBounds', 'touchdown', 'touchback', 'interceptionDown', 'safety', 'fumbleOut', 'timeout']);

export interface PlayOutcome {
  /** What the play did to the drive. */
  kind: 'continue' | 'firstDown' | 'touchdown' | 'turnover' | 'downs' | 'safety' | 'pickSix' | 'twoPointGood' | 'twoPointFailed' | 'timeExpired';
}

/**
 * Your play ended. `playSecs` is how long it ran (snap to whistle) and
 * `between` the real seconds you spent between the last whistle and this
 * snap (the live clock counts them after a play that kept the clock running,
 * up to the 40-second play clock).
 */
export function applyPlay(m: Match, r: PlayResult, endY: number, playSecs: number, between = 0): PlayOutcome {
  const d = m.drive!;
  d.plays++;
  const clockRan = m.clock.live && m.lastWhistle === 'runs';
  if (m.clock.live) {
    m.clock.secs = Math.max(0, m.clock.secs - (clockRan ? Math.min(40, between) : 0) - playSecs);
    m.lastWhistle = STOPS.has(r.reason) || !r.offenseBall ? 'stops' : 'runs';
  }
  const expired = m.clock.live && m.clock.secs <= 0;
  if (m.phase === 'twoPoint') {
    const good = r.touchdown && r.offenseBall;
    if (good) m.score.user += 2;
    if (r.touchdown && !r.offenseBall) m.score.beasts += 2; // a defensive two-point return
    m.log.push(`Two-point try ${good ? 'good' : 'no good'}`);
    endDrive(m, d.result === 'TwoPoint' ? 'TwoPoint' : 'TD', 0);
    return { kind: good ? 'twoPointGood' : 'twoPointFailed' };
  }
  if (r.touchdown && !r.offenseBall) {
    m.score.beasts += 7;
    d.against += 7;
    endDrive(m, 'Turnover', 0);
    return { kind: 'pickSix' };
  }
  if (r.reason === 'safety') {
    m.score.beasts += 2;
    d.against += 2;
    endDrive(m, 'Safety', 0);
    return { kind: 'safety' };
  }
  if (!r.offenseBall) {
    d.yards += Math.max(0, r.spot - m.sit.los);
    endDrive(m, 'Turnover', 0);
    return { kind: 'turnover' };
  }
  const gained = r.reason === 'incomplete' ? 0 : r.spot - m.sit.los;
  d.yards += gained;
  if (r.touchdown) {
    m.score.user += 6;
    d.points = 6;
    d.result = 'TD';
    m.phase = 'try';
    m.log.push('TD');
    return { kind: 'touchdown' };
  }
  const los = r.reason === 'incomplete' ? m.sit.los : clampN(r.spot, 1, 99);
  const ballY = r.reason === 'incomplete' ? m.sit.ballY : clampN(endY, -HASH_Y, HASH_Y);
  if (expired) {
    endDrive(m, m.round === m.cfg.drives && !m.ot ? 'EndOfGame' : 'EndOfHalf', 0);
    return { kind: 'timeExpired' };
  }
  if (gained >= m.sit.toGo - 1e-6) {
    m.sit = { los, ballY, down: 1, toGo: Math.min(10, 100 - los) };
    m.phase = 'drive';
    return { kind: 'firstDown' };
  }
  if (m.sit.down >= 4) {
    endDrive(m, 'Downs', 0);
    return { kind: 'downs' };
  }
  m.sit = { los, ballY, down: m.sit.down + 1, toGo: m.sit.toGo - gained };
  m.phase = m.sit.down === 4 ? 'fourth' : 'drive';
  return { kind: 'continue' };
}

/** The field goal's distance from a line of scrimmage: the spot is 7 yd back, the posts 10 yd deep. */
export const fgDistance = (los: number): number => 100 - los + 17;

/**
 * Chance a kick of `distance` is good for the Contenders kicker (the 4th-down
 * card's estimate): near-automatic inside 35, then falling off to 0 at his
 * range; a headwind shortens the range and a crosswind costs a little.
 * Shape from NFL make rates by distance (2015–2023: ~97% under 30, ~91% 30–39,
 * ~80% 40–49, ~66% 50+).
 */
export function fgMakePct(m: Match, distance: number): number {
  const head = Math.cos(m.wind.dir) * m.wind.mph; // + = blowing toward the posts (a tailwind)
  const cross = Math.abs(Math.sin(m.wind.dir)) * m.wind.mph;
  const range = m.cfg.kickerRange + head * 0.35;
  if (distance > range) return 0;
  const x = (distance - 20) / Math.max(1, range - 20);
  return clampN(0.99 - 0.7 * Math.pow(Math.max(0, x), 2.2) - cross * 0.004, 0, 0.99);
}

/** At the try: the PAT kick or a two-point play. */
export function chooseTry(m: Match, twoPoint: boolean): void {
  if (twoPoint) {
    m.sit = { los: 97, ballY: 0, down: 1, toGo: 3 };
    m.phase = 'twoPoint';
  } else {
    m.kick = { kind: 'PAT', distance: 33 }; // the 15-yard line snap since 2015: a 33-yard kick
    m.phase = 'kick';
  }
}

/** At 4th down: go for it (back to the play call), punt, or kick a field goal. */
export function chooseFourth(m: Match, choice: 'go' | 'punt' | 'fg'): number | null {
  if (choice === 'go') {
    m.phase = 'drive';
    return null;
  }
  if (choice === 'fg') {
    m.kick = { kind: 'FG', distance: fgDistance(m.sit.los) };
    m.phase = 'kick';
    return null;
  }
  // Punt: auto-simmed. Net ~41 yd (NFL net average 2015–2023 ≈ 41), sd ~6, and never past the end line.
  const r = stream(m, `punt${m.round}-${m.ot}`);
  const net = Math.round(clampN(41 + gaussNoise(r) * 6, 25, 60));
  const land = Math.min(m.sit.los + net, 80); // a touchback brings it out to the 20
  m.drive!.plays++;
  endDrive(m, 'Punt', 0);
  return land - m.sit.los;
}

/** The kick came down: good or not. */
export function applyKick(m: Match, good: boolean): void {
  const k = m.kick!;
  if (k.kind === 'PAT') {
    if (good) m.score.user += 1;
    m.log.push(`PAT ${good ? 'good' : 'no good'}`);
    endDrive(m, 'TD', 0);
  } else {
    if (good) m.score.user += 3;
    m.log.push(`FG ${k.distance} ${good ? 'good' : 'no good'}`);
    endDrive(m, good ? 'FG' : 'MissedFG', good ? 3 : 0);
  }
  m.kick = null;
}

/** A timeout (the live clock only). */
export function callTimeout(m: Match): boolean {
  if (!m.clock.live || m.clock.timeouts <= 0 || m.lastWhistle === 'stops') return false;
  m.clock.timeouts--;
  m.lastWhistle = 'stops';
  return true;
}

/**
 * Spike: the clock stops, a down is used (about 3 s off the clock).
 * Kneel: the clock runs, a yard lost (about 2 s, then the play clock).
 */
export function spikeOrKneel(m: Match, kind: 'spike' | 'kneel', between = 0): PlayOutcome {
  const d = m.drive!;
  d.plays++;
  if (m.clock.live) m.clock.secs = Math.max(0, m.clock.secs - (m.lastWhistle === 'runs' ? Math.min(40, between) : 0) - (kind === 'spike' ? 3 : 2));
  m.lastWhistle = kind === 'spike' ? 'stops' : 'runs';
  const los = kind === 'kneel' ? Math.max(1, m.sit.los - 1) : m.sit.los;
  const expired = m.clock.live && m.clock.secs <= 0;
  if (expired || (kind === 'kneel' && !m.clock.live && m.round === m.cfg.drives && !m.ot && m.sit.down >= 3)) {
    endDrive(m, 'EndOfGame', 0);
    return { kind: 'timeExpired' };
  }
  if (m.sit.down >= 4) {
    endDrive(m, 'Downs', 0);
    return { kind: 'downs' };
  }
  m.sit = { ...m.sit, los, down: m.sit.down + 1, toGo: m.sit.toGo + (m.sit.los - los) };
  m.phase = m.sit.down === 4 ? 'fourth' : 'drive';
  return { kind: 'continue' };
}

/** Victory Formation: you lead on the last drive and kneeling can run out the clock (§7.4). */
export function canVictoryFormation(m: Match): boolean {
  return !m.ot && m.round === m.cfg.drives && m.score.user > m.score.beasts && !m.clock.live;
}

function endDrive(m: Match, result: UserDrive['result'], points: number): void {
  const d = m.drive!;
  d.result = result;
  d.points += points;
  m.userDrives.push(d);
  m.drive = null;
  m.kick = null;
  nextRound(m);
}

function nextRound(m: Match): void {
  if (m.ot) {
    // A pair of possessions is done: someone leads, or on to the next overtime.
    if (m.score.user !== m.score.beasts) {
      m.phase = 'final';
      return;
    }
    m.ot++;
    m.phase = 'meanwhile';
    return;
  }
  if (m.round >= m.cfg.drives) {
    if (m.score.user === m.score.beasts) {
      m.ot = 1;
      m.phase = 'meanwhile';
      m.clock = { quarter: 5, secs: 0, live: false, timeouts: 0 };
      return;
    }
    m.phase = 'final';
    m.clock.secs = 0;
    return;
  }
  m.round++;
  advanceClockForRound(m);
  m.phase = 'meanwhile';
}

/** Overtime's start for your drive: the Beasts' 25 (college rules), or the 3 for a two-point-only round. */
export const OT_START = 75;

// ---- The grade -------------------------------------------------------------------------

export type Grade = 'A+' | 'A' | 'B' | 'C' | 'L' | 'L-';

/**
 * Dominance grade on legacy's margin thresholds scaled to game length
 * (GDD §7.6: legacy's 10-drive numbers × drives/10, rounded to football
 * numbers).
 */
export const GRADE_TABLE: Record<GameLength, [number, number, number, number, number]> = {
  10: [21, 11, 4, 1, -10],
  6: [13, 7, 3, 1, -6],
  4: [9, 5, 2, 1, -4],
};

export function matchGrade(margin: number, drives: GameLength): { grade: Grade; label: string } {
  const [a1, a, b, c, l] = GRADE_TABLE[drives];
  if (margin >= a1) return { grade: 'A+', label: 'Total Domination' };
  if (margin >= a) return { grade: 'A', label: 'Statement Win' };
  if (margin >= b) return { grade: 'B', label: 'Solid Win' };
  if (margin >= c) return { grade: 'C', label: 'Nailbiter Win' };
  if (margin >= l) return { grade: 'L', label: 'Tough Loss' };
  return { grade: 'L-', label: 'Beatdown' };
}

/** "Q2 7:30", "OT", "FINAL". */
export function clockLabel(m: Match): string {
  if (m.phase === 'final') return m.ot ? `FINAL/${m.ot > 1 ? `${m.ot}OT` : 'OT'}` : 'FINAL';
  if (m.ot) return m.ot > 1 ? `${m.ot}OT` : 'OT';
  const s = Math.max(0, Math.ceil(m.clock.secs));
  return `Q${m.clock.quarter} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Kicker range per difficulty (GDD §9.6: a generated Contenders kicker, rating fixed per difficulty). */
export const KICKER_RANGE = { rookie: 60, pro: 56, legend: 53, beast: 50 } as const;
