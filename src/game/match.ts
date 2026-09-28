// A full game against the Beasts (GDD §7), as a pure state machine the game
// screen drives. It never touches the sim's internals: it's told how each
// of your plays ended (the sim's PlayResult) and what you chose (PAT or two,
// field goal, punt), and it decides the rest: downs, scores, possessions, the
// Beasts' "Meanwhile" drives, the clock, overtime and the grade.
//
// Two formats (Playtest 1, decision 1):
// - A timed game (Classic, Film Room, the Daily): four quarters of
//   `quarterSecs`, a game clock that runs on plays and stops by the rules, a
//   40-second play clock with delay of game, halftime (you receive the second
//   half) and the Beasts' possessions eating the clock. Every clock number is
//   whole seconds, so a game is the same game however fast the screen runs.
// - Quick Play's drive count: N rounds, a presentational clock, and the live
//   two-minute drill on the last drive (M6).
//
// Deterministic from the game seed (§15 D1): every random draw comes from
// named streams of it (engine/rng deriveStream). The wall clock never gets
// in: the play clock is advanced a whole second at a time by the caller.

import { clampN } from '@/engine/legacy/util';
import { deriveStream, gaussNoise, type Rng } from '@/engine/rng';
import { FIELD_HALF_W, type PlayResult } from '@/sim';
import { PUNT_DEPTH, type PuntFlight } from './kick';
import { HASH_Y, type Situation } from './situation';

export type GameLength = 4 | 6 | 10;
export type Side = 'user' | 'beasts';

export interface MatchConfig {
  /** Quick Play's rounds. (A timed game's grade uses the rounds it actually played: gradeRounds.) */
  drives: GameLength;
  /** A timed game: seconds in a quarter. Absent or null: Quick Play's drive count. */
  quarterSecs?: number | null;
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
  result: 'TD' | 'FG' | 'Punt' | 'Turnover' | 'Downs' | 'Safety' | 'MissedFG' | 'EndOfHalf' | 'EndOfGame';
  points: number;
  plays: number;
  yards: number;
  /** Minutes:seconds it took. */
  top: string;
  /** A timed game: the seconds it took off the clock, and the quarter it started in (5: overtime). */
  secs?: number;
  q?: number;
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
  /** Where the Beasts take over after it (yards from their goal line), when a kick decided it. */
  next?: number;
  /** A timed game: the quarter it started in (5: overtime). */
  q?: number;
}

export type MatchPhase =
  | 'meanwhile' // a Beasts possession is being shown
  | 'drive' // your drive: the play call is next
  | 'fourth' // a 4th-down decision (go, punt, field goal)
  | 'try' // after your TD: PAT or 2
  | 'twoPoint' // a 2-point try is on (one play from the 3)
  | 'kick' // a field goal, PAT or punt is on
  | 'final';

export interface ClockState {
  quarter: number;
  /** Seconds left in the quarter (whole seconds in a timed game). */
  secs: number;
  /** The clock is real: always on your drives in a timed game; Quick Play's two-minute drill. */
  live: boolean;
  timeouts: number;
}

/** Things the clock did that the screen says out loud. */
export type ClockEvent = 'twoMinuteWarning' | 'endOfQuarter' | 'halftime' | 'endOfGame' | 'delayOfGame';

export interface Match {
  cfg: MatchConfig;
  /** 1-based round: the Beasts' possessions so far (Quick Play: a Beasts possession and your drive). */
  round: number;
  /** Overtime period (0 in regulation). */
  ot: number;
  phase: MatchPhase;
  score: Record<Side, number>;
  /** Points by quarter (index 4 is overtime). */
  byQuarter: Record<Side, number[]>;
  sit: Situation;
  clock: ClockState;
  beastsDrives: BeastsDrive[];
  userDrives: UserDrive[];
  /** The drive in progress. */
  drive: UserDrive | null;
  /** The kick on now: its distance (yd from the spot to the goal posts; a punt: from the line) and kind. */
  kick: { kind: 'PAT' | 'FG' | 'PUNT'; distance: number } | null;
  /** Wind now: mph and direction (radians; 0 = blowing downfield, toward the posts you attack). The teams change ends each quarter, so it turns round with them. */
  wind: { mph: number; dir: number };
  /** The wind's direction in the first quarter. */
  windDir0: number;
  /** The Beasts' game-level noise (legacy's per-game gauss term). */
  z: number;
  /** The game clock is running between plays ('runs') or stopped until the snap. */
  lastWhistle: 'stops' | 'runs';
  /** Whole seconds on the play clock while a snap is due; null when none is (or the clock is presentational). */
  playClock: number | null;
  /** The next play clock is the 25-second one (after an administrative stoppage: a timeout, the two-minute warning, a new quarter, a penalty). */
  admin: boolean;
  /** Quarters whose two-minute warning has been given. */
  warned: number[];
  /** The last thing the clock did, for the banner (cleared at the next ready-for-play). */
  event: ClockEvent | null;
  /** A timed game: the Beasts' possessions in regulation (set when it ends). */
  regRounds?: number;
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

export const isTimed = (m: Match): boolean => !!m.cfg.quarterSecs;

export function createMatch(cfg: MatchConfig, windScale = 1): Match {
  const r = deriveStream(cfg.seed, 'match:setup');
  // Wind: the legacy WindChip range, 2–12 mph (GDD §9.6), stronger in weather presets.
  const mph = Math.round((2 + r() * 10) * windScale);
  const dir = r() * Math.PI * 2;
  const m: Match = {
    cfg,
    round: 1,
    ot: 0,
    phase: 'meanwhile',
    score: { user: 0, beasts: 0 },
    byQuarter: { user: [0, 0, 0, 0, 0], beasts: [0, 0, 0, 0, 0] },
    sit: { los: 25, ballY: 0, down: 1, toGo: 10 },
    clock: { quarter: 1, secs: cfg.quarterSecs || 15 * 60, live: false, timeouts: 3 },
    beastsDrives: [],
    userDrives: [],
    drive: null,
    kick: null,
    wind: { mph, dir },
    windDir0: dir,
    z: gaussNoise(r) * 3.5,
    lastWhistle: 'stops',
    playClock: null,
    admin: false,
    warned: [],
    event: null,
    log: [],
  };
  return m;
}

function addPoints(m: Match, side: Side, pts: number): void {
  if (!pts) return;
  m.score[side] += pts;
  const q = m.ot ? 4 : Math.min(4, Math.max(1, m.clock.quarter)) - 1;
  m.byQuarter[side][q] = (m.byQuarter[side][q] ?? 0) + pts;
}

// ---- The clock (a timed game) -------------------------------------------------------------

/** NFL play clock: 40 s from the end of a play, 25 s after an administrative stoppage (Rule 4-6-2). */
export const PLAY_CLOCK = 40;
export const PLAY_CLOCK_ADMIN = 25;
/**
 * The huddle: outside the hurry-up the offense breaks it with 25 on the play
 * clock, so a running clock loses 15 s before the call even comes up (NFL
 * offenses huddle for ~12–15 s and snap with ~5–10 s left; this is the
 * "accelerated clock" a short quarter needs to feel like football).
 */
export const HUDDLE_TO = 25;
/** The two-minute warning (Q2 and Q4). */
export const TWO_MIN = 120;
/** Delay of game: 5 yards, the down replayed. */
export const DELAY_YARDS = 5;

/** Seconds left in the half (in the 1st and 3rd quarters, the quarter after counts too). */
export function halfSecs(m: Match): number {
  const q = m.clock.quarter;
  if (!isTimed(m) || q > 4) return m.clock.secs;
  return q % 2 === 1 ? m.clock.secs + m.cfg.quarterSecs! : m.clock.secs;
}

/** Seconds left in regulation. */
export function gameSecs(m: Match): number {
  const q = m.clock.quarter;
  if (!isTimed(m)) return m.clock.secs;
  if (q > 4) return 0;
  return (4 - q) * m.cfg.quarterSecs! + m.clock.secs;
}

/**
 * The hurry-up (no huddle): the last two minutes of the first half, the
 * last two of the game when you're not ahead, and Quick Play's drill.
 */
export function hurry(m: Match): boolean {
  if (!m.clock.live || m.ot) return false;
  if (!isTimed(m)) return true;
  const q = m.clock.quarter;
  if (q === 2) return m.clock.secs <= TWO_MIN;
  if (q === 4) return m.clock.secs <= TWO_MIN && m.score.user <= m.score.beasts;
  return false;
}

/**
 * Out of bounds stops the clock until the snap only late in a half (NFL
 * Rule 4-3-2: the last two minutes of the first half and the last five of
 * the game; otherwise it restarts on the ready signal, which here is the
 * same as running). A short quarter scales the five minutes (a third of
 * the quarter), never under two.
 */
function oobStops(m: Match): boolean {
  if (!isTimed(m)) return true;
  const q = m.clock.quarter;
  if (q === 2) return m.clock.secs <= TWO_MIN;
  if (q === 4) return m.clock.secs <= clampN(m.cfg.quarterSecs! / 3, TWO_MIN, 300);
  return false;
}

/** A new quarter: the full clock, stopped, the teams (and so the wind) change ends. */
function setQuarter(m: Match, q: number): void {
  m.clock.quarter = q;
  m.clock.secs = m.cfg.quarterSecs!;
  m.wind.dir = m.windDir0 + (q % 2 === 0 ? Math.PI : 0);
  m.lastWhistle = 'stops';
  m.admin = true;
}

function twoMinuteWarning(m: Match): ClockEvent {
  m.warned.push(m.clock.quarter);
  m.lastWhistle = 'stops';
  m.admin = true;
  if (m.playClock !== null) m.playClock = PLAY_CLOCK_ADMIN;
  m.event = 'twoMinuteWarning';
  m.log.push(`Two-minute warning (Q${m.clock.quarter})`);
  return m.event;
}

/** The warning is due when a Q2/Q4 clock goes from above 2:00 to 2:00 or under. */
const warningDue = (m: Match, before: number, after: number) => isTimed(m) && (m.clock.quarter === 2 || m.clock.quarter === 4) && !m.warned.includes(m.clock.quarter) && before > TWO_MIN && after <= TWO_MIN;

/**
 * The running clock between plays: `secs` off it, stopping at the two-minute
 * warning or the end of the quarter (which ends the quarter now).
 */
function runOff(m: Match, secs: number): ClockEvent | null {
  const before = m.clock.secs;
  const after = Math.max(0, before - secs);
  if (warningDue(m, before, after) && after > 0) {
    m.clock.secs = TWO_MIN;
    return twoMinuteWarning(m);
  }
  m.clock.secs = after;
  if (after <= 0) return endOfPeriod(m);
  return null;
}

/**
 * The quarter ran out between plays (a running clock while you called the
 * play, or at the line). The 1st and 3rd: on to the next quarter, the
 * drive carrying on where it stood. The 2nd and 4th end the half: your
 * drive is over.
 */
function endOfPeriod(m: Match): ClockEvent {
  m.playClock = null;
  const q = m.clock.quarter;
  if (!isTimed(m)) {
    // Quick Play's drill: time's up on the last drive.
    if (m.drive) endDrive(m, 'EndOfGame', 0);
    return (m.event = 'endOfGame');
  }
  if (q === 1 || q === 3) {
    setQuarter(m, q + 1);
    // The drive carries on: a fresh 25-second play clock.
    m.admin = false;
    m.playClock = m.drive ? PLAY_CLOCK_ADMIN : null;
    m.log.push(`End of Q${q}`);
    return (m.event = 'endOfQuarter');
  }
  if (m.drive) endDrive(m, q === 2 ? 'EndOfHalf' : 'EndOfGame', 0);
  else nextRound(m);
  return m.event ?? (q === 2 ? 'halftime' : 'endOfGame');
}

/**
 * The offense is ready for the next snap (the play call comes up): the play
 * clock starts, at 40 after a play or 25 after an administrative stoppage.
 * Outside the hurry-up the huddle takes it down to 25 first, and a running
 * game clock loses those seconds with it. Returns what the clock did on the
 * way (the huddle can run into the two-minute warning or the end of the
 * quarter). No play clock for the presentational clock, tries and overtime.
 */
export function readyForPlay(m: Match): ClockEvent | null {
  if (m.playClock !== null) return null;
  m.event = null;
  if (!m.clock.live || m.ot || m.phase === 'twoPoint' || (m.phase !== 'drive' && m.phase !== 'fourth')) return null;
  let start = m.admin ? PLAY_CLOCK_ADMIN : PLAY_CLOCK;
  m.admin = false;
  let ev: ClockEvent | null = null;
  if (!hurry(m) && start > HUDDLE_TO) {
    if (m.lastWhistle === 'runs') ev = runOff(m, start - HUDDLE_TO);
    start = HUDDLE_TO;
  }
  if (ev === 'halftime' || ev === 'endOfGame') return ev;
  if (ev === 'endOfQuarter' || ev === 'twoMinuteWarning') start = PLAY_CLOCK_ADMIN;
  m.admin = false;
  m.playClock = start;
  return ev;
}

/**
 * One second passes with a snap due: the play clock ticks, and the game
 * clock too if it's running (into the two-minute warning or the end of the
 * quarter). At 0 on the play clock, delay of game.
 */
export function tickClock(m: Match): ClockEvent | null {
  if (m.playClock === null) return null;
  if (m.lastWhistle === 'runs') {
    const ev = runOff(m, 1);
    if (ev) return ev;
  }
  m.playClock--;
  if (m.playClock <= 0) return delayOfGame(m);
  return null;
}

/**
 * Delay of game on the offense: 5 yards (half the distance inside the 10),
 * the down replayed, the play clock reset to 25. A running clock keeps
 * running from the ready signal.
 */
export function delayOfGame(m: Match): ClockEvent {
  const back = Math.min(DELAY_YARDS, m.sit.los / 2);
  m.sit = { ...m.sit, los: m.sit.los - back, toGo: m.sit.toGo + back };
  m.playClock = PLAY_CLOCK_ADMIN;
  m.admin = false;
  m.event = 'delayOfGame';
  m.log.push(`Delay of game: ${Math.round(back)} yd`);
  return m.event;
}

/** The ball is snapped: the play clock is done with. */
export function snapped(m: Match): void {
  m.playClock = null;
  m.admin = false;
}

/** The clock through a play of `secs` (it runs from the snap), then stopped or running per the whistle. True if the quarter ran out on the play. */
function playClockRun(m: Match, secs: number, stops: boolean): boolean {
  const before = m.clock.secs;
  m.clock.secs = Math.max(0, before - Math.max(1, Math.round(secs)));
  m.lastWhistle = stops ? 'stops' : 'runs';
  if (m.clock.secs > 0 && warningDue(m, before, m.clock.secs)) twoMinuteWarning(m);
  return m.clock.secs <= 0;
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
 * A timed game's pace: game seconds a round (a Beasts possession and your
 * drive) takes. The prior is ~2:20 for theirs (6–7 plays at ~21 s) and ~2:40
 * for yours; once a few rounds are in, the game's own pace takes over.
 */
const ROUND_PRIOR = 300;
export function possessionsLeft(m: Match): { played: number; left: number } {
  const played = m.beastsDrives.length;
  const regulation = 4 * m.cfg.quarterSecs!;
  const remaining = gameSecs(m);
  const w = Math.min(1, played / 4);
  const per = played ? ((regulation - remaining) / played) * w + ROUND_PRIOR * (1 - w) : ROUND_PRIOR;
  return { played, left: Math.max(1, remaining / Math.max(60, per)) };
}

/** Seconds a Beasts play takes, snap to snap (a timed game): 17–25 s, the same accelerated pace as yours. */
const BEAST_PLAY = { base: 17, spread: 8 };
/** Their hurry-up, snap to snap (stops, spikes, the sideline): ~13 s. */
const BEAST_HURRY = 13;
/** Kneeling it out: ~42 s a snap (a kneel, then the play clock). */
const BEAST_KNEEL = 42;

/**
 * One Beasts possession. Legacy scores a whole game at once; here each
 * possession aims at the points still "owed" on legacy's game total, scaled
 * to game length (§7.3): expectation e = (total·N/10 − scored) / possessions
 * left, clamped 0..7, re-read every possession so the answer-back follows
 * your running score. The outcome is drawn around e: field goals are a share
 * that grows with e, touchdowns make up the rest of it; the misses split into
 * punts, turnovers and turnovers on downs as NFL drives do (≈ 70/22/8).
 * In a timed game N is the possessions played plus those the clock is
 * likely to leave, and the drive takes time off the clock (it has to fit
 * in the half: see fitHalf).
 */
export function beastsPossession(m: Match): BeastsDrive {
  const r = stream(m, `beasts${m.round}-${m.ot}`);
  const timed = isTimed(m) && !m.ot;
  const n = m.cfg.drives;
  const played = m.userDrives.length;
  const pace10 = played ? (m.score.user / played) * 10 : 0;
  // Early in the game the projection is thin: blend it in with the rounds played.
  const pace = played ? pace10 * Math.min(1, played / 3) + 23 * (1 - Math.min(1, played / 3)) : 23;
  let e: number;
  if (m.ot) {
    // Overtime from your 25: roughly college OT (≈ 50% TD, 25% FG) scaled by strength.
    e = clampN(4.3 + (legacyScale(m.cfg.beastsRating) - 85) * 0.08, 3, 5.6);
  } else if (timed) {
    const p = possessionsLeft(m);
    const total = (beastsGameTotal(m, pace) * (p.played + p.left)) / 10;
    e = clampN((total - m.score.beasts) / p.left, 0, 7);
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
  let secs = 0;
  // Time of possession: one draw either way (so Quick Play's stream is as it was).
  const top = (p: number) => {
    const w = r();
    secs = Math.round(p * (timed ? BEAST_PLAY.base + w * BEAST_PLAY.spread : 24 + w * 14));
    return clockText(secs);
  };
  let d: BeastsDrive;
  if (u < pTD) {
    const p = plays(5, 13);
    d = { result: 'TD', points: 7, plays: p, yards: 100 - start, top: top(p), nextStart: 25 };
    // Their two-point chart: go for two down 2, up 1 or up 5 after the six (late); else kick.
    const after6 = m.score.beasts + 6 - m.score.user;
    const late = timed ? m.clock.quarter === 4 && m.clock.secs <= 300 : m.round >= n - 1 || m.ot > 0;
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
  if (timed) {
    d.secs = secs;
    fitHalf(m, d, r);
    d.top = clockText(d.secs!);
  }
  return d;
}

/** "2:35". */
export const clockText = (s: number): string => {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/**
 * A Beasts drive has to fit in the half. If it doesn't: ahead in the second
 * half, they kneel it out; otherwise they go to the hurry-up (~13 s a
 * snap), and if even that doesn't fit, the gun goes mid-drive: a scoring
 * drive that got 60% of the way kicks a field goal at the gun (85%, NFL
 * make rate from ~35–45 yd), anything else just ends the half.
 */
function fitHalf(m: Match, d: BeastsDrive, r: Rng): void {
  const left = halfSecs(m);
  if (d.secs! < left) return;
  const secondHalf = m.clock.quarter >= 3;
  const end: BeastsDrive['result'] = secondHalf ? 'EndOfGame' : 'EndOfHalf';
  const p0 = d.plays;
  if (secondHalf && m.score.beasts > m.score.user) {
    Object.assign(d, { result: end, points: 0, plays: Math.max(1, Math.ceil(left / BEAST_KNEEL)), yards: -Math.max(1, Math.ceil(left / BEAST_KNEEL)), secs: left, twoPoint: undefined, nextStart: 25 });
    return;
  }
  if (p0 * BEAST_HURRY < left) {
    d.secs = p0 * BEAST_HURRY;
    return;
  }
  const k = Math.floor(left / BEAST_HURRY);
  const yards = Math.round((d.yards * k) / Math.max(1, p0));
  if ((d.result === 'TD' || d.result === 'FG') && k >= Math.ceil(p0 * 0.6)) {
    const good = r() < 0.85;
    Object.assign(d, { result: good ? 'FG' : 'MissedFG', points: good ? 3 : 0, plays: k + 1, yards, secs: left, twoPoint: undefined, nextStart: 25 });
    return;
  }
  Object.assign(d, { result: end, points: 0, plays: Math.max(1, k), yards, secs: left, twoPoint: undefined, nextStart: 25 });
}

/** Where the Beasts start after your drive (for the Meanwhile line; yards from their goal line). */
function beastsStartFrom(u: UserDrive): number {
  if (u.next !== undefined) return u.next;
  if (u.result === 'Punt') return 20;
  if (u.result === 'Turnover' || u.result === 'Downs') return clampN(100 - (u.start + u.yards), 5, 80);
  return 25;
}

/** The Beasts' time off the clock: across the 1st/3rd quarter break, and to 0:00 at the half. */
function consume(m: Match, secs: number): void {
  let s = Math.max(0, Math.round(secs));
  while (s > 0) {
    const take = Math.min(s, m.clock.secs);
    m.clock.secs -= take;
    s -= take;
    if (m.clock.secs > 0) break;
    const q = m.clock.quarter;
    if (q === 1 || q === 3) {
      setQuarter(m, q + 1);
      m.event = 'endOfQuarter';
    } else break;
  }
}

/** Apply a Beasts possession: score it, and set up your drive. */
export function applyBeastsDrive(m: Match, d: BeastsDrive): void {
  m.event = null;
  if (isTimed(m)) d.q = m.ot ? 5 : m.clock.quarter;
  m.beastsDrives.push(d);
  const timed = isTimed(m) && !m.ot;
  if (timed) consume(m, d.secs ?? parseClock(d.top));
  addPoints(m, 'beasts', d.points);
  if (d.result === 'Safety') addPoints(m, 'user', 2);
  m.log.push(`Beasts: ${d.result}${d.points ? ` (+${d.points})` : ''}`);
  if (m.ot >= 3) {
    startTwoPointOnly(m);
    return;
  }
  if (timed && m.clock.secs <= 0) {
    // The half (or the game) ran out on their drive.
    if (m.clock.quarter === 2) halftime(m);
    else endRegulation(m);
    return;
  }
  startDrive(m, d.nextStart);
}

const parseClock = (t: string): number => {
  const [a, b] = t.split(':').map(Number);
  return (a ?? 0) * 60 + (b ?? 0);
};

// ---- Your drives -----------------------------------------------------------------------

function startDrive(m: Match, los: number): void {
  m.sit = { los, ballY: 0, down: 1, toGo: Math.min(10, 100 - los) };
  m.drive = { start: los, plays: 0, yards: 0, result: 'Downs', points: 0, against: 0 };
  m.phase = 'drive';
  m.kick = null;
  m.playClock = null;
  m.lastWhistle = 'stops';
  if (isTimed(m)) {
    m.clock.live = !m.ot;
    m.drive.q = m.ot ? 5 : m.clock.quarter;
    return;
  }
  // The last regulation drive: the clock goes live when you're trailing or tied (§7.4).
  const last = !m.ot && m.round === m.cfg.drives;
  m.clock.live = last && m.score.user <= m.score.beasts;
  if (last) {
    m.clock.quarter = 4;
    m.clock.secs = m.clock.live ? 120 : Math.min(m.clock.secs, 150);
    m.clock.timeouts = 3;
  }
}

function startTwoPointOnly(m: Match): void {
  m.sit = { los: 97, ballY: 0, down: 1, toGo: 3 };
  m.drive = { start: 97, plays: 0, yards: 0, result: 'TwoPoint', points: 0, against: 0 };
  m.phase = 'twoPoint';
}

/** Halftime: three timeouts again, and you receive the second half's kickoff (the Beasts took the first). */
function halftime(m: Match): void {
  setQuarter(m, 3);
  m.clock.timeouts = 3;
  m.event = 'halftime';
  m.log.push('Halftime');
  startDrive(m, 25);
  m.admin = true;
}

/** The end of the fourth quarter: tied goes to overtime, anything else is the final. */
function endRegulation(m: Match): void {
  m.clock.secs = 0;
  m.playClock = null;
  m.event = 'endOfGame';
  m.regRounds = m.beastsDrives.length;
  if (m.score.user === m.score.beasts) {
    m.ot = 1;
    m.phase = 'meanwhile';
    m.clock = { quarter: 5, secs: 0, live: false, timeouts: 0 };
    return;
  }
  m.phase = 'final';
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
 * Your play ended. `playSecs` is how long it ran (snap to whistle, sim
 * seconds; a timed game rounds it to whole seconds). `between` is running
 * clock before the snap not already ticked off (Quick Play's drill only, up
 * to the 40-second play clock; a timed game's runoff is all ticked off live
 * by tickClock, and the game screen passes 0 either way).
 */
export function applyPlay(m: Match, r: PlayResult, endY: number, playSecs: number, between = 0): PlayOutcome {
  const d = m.drive!;
  d.plays++;
  m.playClock = null;
  m.event = null;
  const timed = isTimed(m);
  const q = m.clock.quarter;
  const stops = (r.reason === 'outOfBounds' ? oobStops(m) : STOPS.has(r.reason)) || !r.offenseBall;
  if (m.clock.live) {
    if (timed) {
      playClockRun(m, playSecs, stops);
    } else {
      const clockRan = m.lastWhistle === 'runs';
      m.clock.secs = Math.max(0, m.clock.secs - (clockRan ? Math.min(40, between) : 0) - playSecs);
      m.lastWhistle = STOPS.has(r.reason) || !r.offenseBall ? 'stops' : 'runs';
    }
  }
  const expired = m.clock.live && m.clock.secs <= 0;
  if (m.phase === 'twoPoint') {
    const good = r.touchdown && r.offenseBall;
    if (good) addPoints(m, 'user', 2);
    if (r.touchdown && !r.offenseBall) addPoints(m, 'beasts', 2); // a defensive two-point return
    m.log.push(`Two-point try ${good ? 'good' : 'no good'}`);
    endDrive(m, d.result === 'TwoPoint' ? 'TwoPoint' : 'TD', good ? 2 : 0);
    return { kind: good ? 'twoPointGood' : 'twoPointFailed' };
  }
  if (r.touchdown && !r.offenseBall) {
    addPoints(m, 'beasts', 7);
    d.against += 7;
    endDrive(m, 'Turnover', 0);
    return { kind: 'pickSix' };
  }
  if (r.reason === 'safety') {
    addPoints(m, 'beasts', 2);
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
    // The try comes first even at 0:00; the quarter ends after it (nextRound).
    addPoints(m, 'user', 6);
    d.points = 6;
    d.result = 'TD';
    m.phase = 'try';
    m.log.push('TD');
    return { kind: 'touchdown' };
  }
  const los = r.reason === 'incomplete' ? m.sit.los : clampN(r.spot, 1, 99);
  const ballY = r.reason === 'incomplete' ? m.sit.ballY : clampN(endY, -HASH_Y, HASH_Y);
  if (expired) {
    if (timed && (q === 1 || q === 3)) {
      // End of the 1st or 3rd: the drive carries on in the next quarter.
      setQuarter(m, q + 1);
      m.event = 'endOfQuarter';
    } else {
      endDrive(m, timed ? (q === 2 ? 'EndOfHalf' : 'EndOfGame') : m.round === m.cfg.drives && !m.ot ? 'EndOfGame' : 'EndOfHalf', 0);
      return { kind: 'timeExpired' };
    }
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
export function chooseFourth(m: Match, choice: 'go' | 'punt' | 'fg'): void {
  if (choice === 'go') {
    // The play clock that started with the decision keeps running into the call.
    m.phase = 'drive';
    return;
  }
  m.playClock = null;
  m.kick = choice === 'fg' ? { kind: 'FG', distance: fgDistance(m.sit.los) } : { kind: 'PUNT', distance: 0 };
  m.phase = 'kick';
}

/** NFL snap to whistle on a field goal try: ~1.3 s to the kick plus the flight (~2.5 s). */
const FG_PLAY_SECS = 4;

/** The kick came down: good or not. `hang`: its time in the air (the clock's share of a field goal try). */
export function applyKick(m: Match, good: boolean, hang = 2.5): void {
  const k = m.kick!;
  if (k.kind === 'PAT') {
    if (good) addPoints(m, 'user', 1);
    m.log.push(`PAT ${good ? 'good' : 'no good'}`);
    // The drive's points include the try (the drive chart's "Touchdown +7").
    endDrive(m, 'TD', good ? 1 : 0);
  } else {
    // A field goal try is a play: the clock runs through it (and stops on the change of possession).
    if (isTimed(m) && m.clock.live) playClockRun(m, Math.max(FG_PLAY_SECS, 1.3 + hang), true);
    if (good) addPoints(m, 'user', 3);
    m.log.push(`FG ${Math.round(k.distance)} ${good ? 'good' : 'no good'}`);
    // A miss: the Beasts take over at the spot of the kick, or their 20, whichever is farther from their goal (NFL Rule 11-4-3).
    if (!good) m.drive!.next = Math.round(Math.max(20, 100 - (m.sit.los - 7)));
    endDrive(m, good ? 'FG' : 'MissedFG', good ? 3 : 0);
  }
  m.kick = null;
}

/** How a punt ended (all yardage whole yards). */
export interface PuntResult {
  /** From the line of scrimmage to where it came down (or went out), yd. */
  gross: number;
  /** Return yards (0 on a fair catch, a touchback, out of bounds, downed). */
  ret: number;
  /** The line to where the Beasts take over, yd (a touchback nets to their 20). */
  net: number;
  how: 'returned' | 'fairCatch' | 'outOfBounds' | 'touchback' | 'downed';
  hang: number;
  /** Where the Beasts take over, yards from their goal line. */
  beastsStart: number;
}

/**
 * The punt came down (src/game/kick.ts puntFlight): where, and what the
 * returner did with it. Out of bounds in the air: their ball where it
 * crossed. Into the end zone: a touchback to their 20. Inside their 10 the
 * returner lets it bounce (it rolls 2–8 yd, maybe into the end zone).
 * Otherwise a fair catch, likelier the longer it hangs (NFL: ~25–30% of
 * punts, most of them the high ones), or a return of ~9 yd (NFL average
 * 2015–2023 ≈ 9–10), shorter the longer it hung.
 */
export function resolvePunt(m: Match, f: PuntFlight): PuntResult {
  const r = stream(m, `punt${m.userDrives.length}-${m.ot}`);
  const los = m.sit.los;
  const land = los - PUNT_DEPTH + f.carry; // field x, from your goal line
  const hang = Math.round(f.hang * 10) / 10;
  let spot: number;
  let how: PuntResult['how'];
  let ret = 0;
  if (land >= 100) {
    how = 'touchback';
    spot = 80;
  } else if (f.out) {
    how = 'outOfBounds';
    spot = land;
  } else if (land >= 90) {
    const roll = 2 + r() * 6;
    if (land + roll >= 100) {
      how = 'touchback';
      spot = 80;
    } else {
      how = 'downed';
      spot = land + roll;
    }
  } else if (r() < clampN(0.15 + 0.4 * (f.hang - 4), 0.05, 0.7)) {
    how = 'fairCatch';
    spot = land;
  } else {
    how = 'returned';
    ret = Math.round(clampN(9 + gaussNoise(r) * 6 - 4 * (f.hang - 4.2), 0, 45));
    spot = land - ret;
  }
  spot = clampN(spot, 1, 99);
  const beastsStart = Math.round(100 - spot);
  return { gross: Math.round(land - los), ret, net: Math.round(spot - los), how, hang, beastsStart };
}

/** Apply the punt: the drive is over, the Beasts take over where it ended; the clock runs through the play. */
export function applyPunt(m: Match, p: PuntResult): void {
  if (isTimed(m) && m.clock.live) playClockRun(m, 2.1 + p.hang + (p.how === 'returned' ? 1 + p.ret / 8 : 1), true);
  m.drive!.plays++;
  m.drive!.next = p.beastsStart;
  m.log.push(`Punt ${p.gross} yd, net ${p.net}`);
  endDrive(m, 'Punt', 0);
  m.kick = null;
}

/**
 * A timeout: the clock stops and the play clock resets to 25. Any time a
 * snap is due (to stop a running clock, or to save a delay of game).
 */
export function callTimeout(m: Match): boolean {
  if (!m.clock.live || m.clock.timeouts <= 0) return false;
  if (m.playClock === null && m.lastWhistle === 'stops') return false;
  m.clock.timeouts--;
  m.lastWhistle = 'stops';
  if (m.playClock !== null) m.playClock = PLAY_CLOCK_ADMIN;
  m.log.push(`Timeout (${m.clock.timeouts} left)`);
  return true;
}

/**
 * Spike: the clock stops, a down is used (about 3 s off the clock).
 * Kneel: the clock runs, a yard lost (about 2 s, then the play clock).
 */
export function spikeOrKneel(m: Match, kind: 'spike' | 'kneel', between = 0): PlayOutcome {
  const d = m.drive!;
  d.plays++;
  m.playClock = null;
  m.event = null;
  const timed = isTimed(m);
  const q = m.clock.quarter;
  if (timed && m.clock.live) playClockRun(m, kind === 'spike' ? 3 : 2, kind === 'spike');
  else {
    if (m.clock.live) m.clock.secs = Math.max(0, m.clock.secs - (m.lastWhistle === 'runs' ? Math.min(40, between) : 0) - (kind === 'spike' ? 3 : 2));
    m.lastWhistle = kind === 'spike' ? 'stops' : 'runs';
  }
  const los = kind === 'kneel' ? Math.max(1, m.sit.los - 1) : m.sit.los;
  const expired = m.clock.live && m.clock.secs <= 0;
  if (expired && timed && (q === 1 || q === 3)) {
    setQuarter(m, q + 1);
    m.event = 'endOfQuarter';
  } else if (expired || (!timed && kind === 'kneel' && !m.clock.live && m.round === m.cfg.drives && !m.ot && m.sit.down >= 3)) {
    endDrive(m, timed && q === 2 ? 'EndOfHalf' : 'EndOfGame', 0);
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

/**
 * Victory Formation: you lead and kneeling can run out the clock (§7.4).
 * A timed game: the fourth quarter, ahead, with no more on the clock than
 * the kneels left on this set of downs can take (~42 s each).
 */
export function canVictoryFormation(m: Match): boolean {
  if (m.ot || m.score.user <= m.score.beasts) return false;
  if (isTimed(m)) return m.clock.quarter === 4 && m.clock.secs <= (5 - m.sit.down) * BEAST_KNEEL;
  return m.round === m.cfg.drives && !m.clock.live;
}

function endDrive(m: Match, result: UserDrive['result'], points: number): void {
  const d = m.drive!;
  d.result = result;
  d.points += points;
  m.userDrives.push(d);
  m.drive = null;
  m.kick = null;
  m.playClock = null;
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
  if (isTimed(m)) {
    // The ball goes over (a stopped clock), unless the period is over.
    m.lastWhistle = 'stops';
    if (m.clock.secs <= 0) {
      const q = m.clock.quarter;
      if (q === 2) return halftime(m);
      if (q >= 4) return endRegulation(m);
      setQuarter(m, q + 1);
      m.event = 'endOfQuarter';
    }
    m.round++;
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

/** Regulation rounds (Beasts possessions before overtime): Quick Play's setting, or what a timed game actually played. */
export function regulationRounds(m: Match): number {
  if (!isTimed(m)) return m.cfg.drives;
  return m.regRounds ?? m.beastsDrives.length;
}

/** The grade table a game is judged on: Quick Play's length, or a timed game's nearest by the rounds it played. */
export function gradeRounds(m: Match): GameLength {
  if (!isTimed(m)) return m.cfg.drives;
  const n = regulationRounds(m);
  return n <= 5 ? 4 : n <= 8 ? 6 : 10;
}

/** "Q2 7:30", "OT", "FINAL". */
export function clockLabel(m: Match): string {
  if (m.phase === 'final') return m.ot ? `FINAL/${m.ot > 1 ? `${m.ot}OT` : 'OT'}` : 'FINAL';
  if (m.ot) return m.ot > 1 ? `${m.ot}OT` : 'OT';
  return `Q${m.clock.quarter} ${clockText(m.clock.secs)}`;
}

/** "1st", "2nd"… */
export const quarterName = (q: number): string => (q > 4 ? 'OT' : ['1st', '2nd', '3rd', '4th'][q - 1]!);

/** Kicker range per difficulty (GDD §9.6: a generated Contenders kicker, rating fixed per difficulty). */
export const KICKER_RANGE = { rookie: 60, pro: 56, legend: 53, beast: 50 } as const;

/** The sidelines, for the punt's flight (the field is 53⅓ yd wide). */
export const SIDELINE = FIELD_HALF_W;

// ---- The format --------------------------------------------------------------------------

/** The Daily's quarter: fixed, so every player's score that day is on the same clock (Playtest 1, decision 1). */
export const DAILY_QUARTER_MIN = 5;

/** A mode's game: Quick Play keeps the drive count (null), the Daily plays its fixed quarter, the rest the setting. Seconds. */
export function quarterSecsFor(mode: string, quarterMinutes: number): number | null {
  if (mode === 'quick') return null;
  if (mode === 'daily') return DAILY_QUARTER_MIN * 60;
  return Math.round(clampN(quarterMinutes, 1, 15) * 60);
}
