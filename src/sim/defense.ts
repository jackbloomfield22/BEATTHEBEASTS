// The Beasts' defensive coordinator (GDD §10.4): packages, the call from
// the situation, tendency learning within the game, and disguise. Pure:
// the game layer owns the Tendencies object (recordPlay returns a new one)
// and passes a seeded stream for the call.

import type { Rng } from '@/engine/rng';
import { receiversIn } from './personnel';
import { DEF_CALLS, SINGLE_HIGH, defById, type DefCall, type Package, type PlayType, type Personnel } from './plays';
import { DIFFICULTY, type Difficulty } from './state';
import type { DefSlot, SimPlayer } from './types';

/** The Beasts' defense: the base 4-3 eleven, the sub corner (nickel) and the sub safety (dime). */
export interface BeastsDefense {
  base: Record<DefSlot, SimPlayer>;
  /** Sub CB */
  nickel: SimPlayer;
  /** Sub S */
  dime: SimPlayer;
}

/**
 * The eleven for a call: the base defense, with the nickel corner in the
 * linebacker slot the call gives him and, in dime, the sub safety in the
 * next one. The sim reads each man's real position where behaviour depends
 * on it (alignment, run fits, reads).
 */
export function defenseFor(call: DefCall, beasts: BeastsDefense): Record<DefSlot, SimPlayer> {
  const out = { ...beasts.base };
  if (call.package === 'nickel' || call.package === 'dime') out[call.nickel] = beasts.nickel;
  if (call.package === 'dime') out[call.dime] = beasts.dime;
  return out;
}

// ---- Tendencies ----------------------------------------------------------------

/** What the offense has done so far this game, as the Beasts' staff charts it. */
export interface Tendencies {
  plays: number;
  /** Pass plays with a target. */
  passes: number;
  /** Targets and the yards they produced, by receiver (player id). */
  targets: Record<string, number>;
  targetYards: Record<string, number>;
  /** Runs and passes by down and distance (downBucket). */
  mix: Record<string, { run: number; pass: number }>;
  /** Times each play was called. */
  calls: Record<string, number>;
}

export const emptyTendencies = (): Tendencies => ({ plays: 0, passes: 0, targets: {}, targetYards: {}, mix: {}, calls: {} });

/** The charting buckets: 1st down, then 2nd and 3rd/4th by short (≤3), medium (4–6) and long (7+). */
export function downBucket(down: number, toGo: number): string {
  if (down <= 1) return '1st';
  const d = down === 2 ? '2nd' : '3rd';
  return `${d}-${toGo <= 3 ? 'short' : toGo <= 6 ? 'med' : 'long'}`;
}

export interface PlayRecord {
  /** The receiver the ball went to (player id), if it was thrown to someone. */
  targetId?: string;
  playId: string;
  type: PlayType;
  down: number;
  toGo: number;
  yards: number;
}

/** Chart one play (pure: a new object). */
export function recordPlay(t: Tendencies, r: PlayRecord): Tendencies {
  const bucket = downBucket(r.down, r.toGo);
  const run = r.type === 'run';
  const m = t.mix[bucket] ?? { run: 0, pass: 0 };
  const out: Tendencies = {
    plays: t.plays + 1,
    passes: t.passes + (r.targetId ? 1 : 0),
    targets: { ...t.targets },
    targetYards: { ...t.targetYards },
    mix: { ...t.mix, [bucket]: { run: m.run + (run ? 1 : 0), pass: m.pass + (run ? 0 : 1) } },
    calls: { ...t.calls, [r.playId]: (t.calls[r.playId] ?? 0) + 1 },
  };
  if (r.targetId) {
    out.targets[r.targetId] = (out.targets[r.targetId] ?? 0) + 1;
    out.targetYards[r.targetId] = (out.targetYards[r.targetId] ?? 0) + r.yards;
  }
  return out;
}

/**
 * How fast the staff learns (GDD §10.4 table: tendency learning off / slow
 * / normal / aggressive): the share of a clear tendency they act on, and
 * how many targets before they believe one.
 */
export const LEARNING: Record<Difficulty, { rate: number; minTargets: number }> = {
  rookie: { rate: 0, minTargets: 99 },
  pro: { rate: 0.3, minTargets: 6 },
  legend: { rate: 0.6, minTargets: 4 },
  beast: { rate: 0.9, minTargets: 3 },
};

/** The receiver the offense leans on (share of targets), if the staff believes it at this difficulty. */
export function favouriteTarget(t: Tendencies, difficulty: Difficulty): { id: string; share: number } | null {
  const L = LEARNING[difficulty];
  let best: { id: string; share: number } | null = null;
  for (const [id, n] of Object.entries(t.targets)) {
    if (n < L.minTargets) continue;
    const share = n / Math.max(1, t.passes);
    if (!best || share > best.share) best = { id, share };
  }
  return best;
}

// ---- The call ----------------------------------------------------------------------

export interface DefSituation {
  down: number;
  toGo: number;
  /** Line of scrimmage, yards from the offense's goal line. */
  los: number;
  /** Seconds left in the half. */
  secondsLeft?: number;
  /** The offense's score minus the Beasts'. */
  scoreDiff?: number;
  /** The offense's personnel grouping as it comes on the field (the sub trigger). */
  personnel?: Personnel;
}

/**
 * The package for the situation (GDD §10.4): dime on 3rd and long (and the
 * prevent look late), nickel on passing downs and against three-receiver
 * sets, base against the heavy groupings and in short yardage.
 */
export function packageFor(sit: DefSituation): Package {
  const heavy = sit.personnel === '21' || sit.personnel === '22' || sit.personnel === '12';
  const goalLine = sit.los + sit.toGo >= 100 && sit.toGo <= 3;
  if (goalLine || (sit.toGo <= 2 && sit.down >= 3)) return 'base';
  if (sit.down >= 3 && sit.toGo >= 7 && sit.personnel !== '22') return 'dime';
  const late = (sit.secondsLeft ?? 999) <= 120 && (sit.scoreDiff ?? 0) < 0;
  if (late && !heavy) return 'dime';
  const passingDown = (sit.down === 2 && sit.toGo >= 8) || (sit.down >= 3 && sit.toGo >= 4);
  const wide = sit.personnel ? receiversIn(sit.personnel) >= 3 : false;
  if (wide) return 'nickel';
  if (passingDown && sit.personnel !== '22') return 'nickel';
  return 'base';
}

/**
 * Call weights by situation. The mix is the NFL's rough shape: Cover 3 and
 * Cover 1 the base of it (single-high ~55–60% of snaps), quarters and
 * two-deep on passing downs and to protect a lead, pressure (five or more
 * rushers ~25–30% of dropbacks) on third down and in the red zone, man near
 * the goal line (Sports Info Solutions / PFF coverage charting, 2019–2023).
 */
function weights(sit: DefSituation, difficulty: Difficulty, t: Tendencies | undefined): Record<string, number> {
  const w: Record<string, number> = { cover3: 22, cover1: 12, cover1off: 8, cover2: 8, cover4: 12, tampa2: 8, cover2man: 5, cover1blitz: 5, firezone: 6, simpressure: 0 };
  const long = sit.toGo >= 7;
  const short = sit.toGo <= 2;
  if (sit.down >= 3 && long) {
    w.cover4! += 10;
    w.tampa2! += 6;
    w.cover2man! += 6;
    w.firezone! += 4;
    w.cover1off! += 4;
    w.cover3! -= 8;
  } else if (sit.down >= 3 && !short) {
    w.cover1! += 8;
    w.cover1blitz! += 6;
    w.firezone! += 5;
    w.cover2man! += 4;
  } else if (short && sit.down >= 2) {
    w.cover1! += 10;
    w.cover1blitz! += 8;
    w.cover3! += 4;
    w.cover4! -= 8;
    w.tampa2! -= 6;
    w.cover2! -= 4;
  }
  // The red zone compresses the field: man and pressure; at the goal line almost all of it.
  if (sit.los >= 80) {
    w.cover1! += 8;
    w.cover2man! += 5;
    w.cover1blitz! += 5;
    w.cover4! -= 6;
    w.tampa2! -= 5;
  }
  if (sit.los + sit.toGo >= 100 && sit.toGo <= 3) {
    w.cover1blitz! += 10;
    w.cover3! -= 10;
  }
  // Late, protecting a lead (the offense behind): keep everything in front.
  if ((sit.secondsLeft ?? 999) <= 120 && (sit.scoreDiff ?? 0) < 0) {
    w.cover4! += 15;
    w.cover2! += 10;
    w.tampa2! += 8;
    w.cover1blitz! = 0;
    w.firezone! = 0;
  }
  // Simulated pressure is the Beast staff's (GDD §10.4 table).
  if (difficulty === 'beast') w.simpressure = sit.down >= 2 && !short ? 9 : 4;
  // A run-heavy offense on this down: the eighth man in the box (single-high, the pressure).
  const L = DIFFICULTY_LEARN(difficulty);
  if (t && L > 0) {
    const m = t.mix[downBucket(sit.down, sit.toGo)];
    const n = m ? m.run + m.pass : 0;
    if (m && n >= 3) {
      const runLean = m.run / n - 0.5;
      const k = L * Math.max(-0.5, Math.min(0.5, runLean)) * 2;
      w.cover3! += 10 * k;
      w.cover1! += 8 * k;
      w.firezone! += 6 * k;
      w.cover4! -= 8 * k;
      w.tampa2! -= 6 * k;
      w.cover2! -= 6 * k;
    }
  }
  for (const k of Object.keys(w)) w[k] = Math.max(0, w[k]!);
  return w;
}

const DIFFICULTY_LEARN = (d: Difficulty): number => LEARNING[d].rate;

/** Pick by weight (one uniform draw). */
function pick(w: Record<string, number>, u: number): string {
  const keys = Object.keys(w).filter((k) => w[k]! > 0);
  const total = keys.reduce((a, k) => a + w[k]!, 0);
  let x = u * total;
  for (const k of keys) {
    x -= w[k]!;
    if (x < 0) return k;
  }
  return keys[keys.length - 1] ?? 'cover3';
}

/**
 * The Beasts' call for the snap: coverage and package from down, distance,
 * field position, score and clock; a bracket on the offense's favourite
 * receiver as the staff learns him (at the difficulty's rate); and at the
 * higher difficulties a disguise, the other shell shown until the snap.
 */
export function callDefense(sit: DefSituation, difficulty: Difficulty, tendencies: Tendencies | undefined, rng: Rng): DefCall {
  const id = pick(weights(sit, difficulty, tendencies), rng());
  const base = defById(id);
  const call: DefCall = { ...base, package: packageFor(sit) };
  // Tendency learning: bracket the man they keep throwing to.
  const fav = tendencies ? favouriteTarget(tendencies, difficulty) : null;
  const u = rng();
  if (fav && u < LEARNING[difficulty].rate * Math.min(1, Math.max(0, (fav.share - 0.25) / 0.25))) {
    const single = SINGLE_HIGH.includes(id) && base.assign.FS.kind === 'zone';
    // Single-high: the free safety shades his deep middle to him. Two-high,
    // or with the free safety in man: the middle linebacker sits on his area (a robber).
    if (single) call.bracket = { id: fav.id, by: 'FS', how: 'shade' };
    else if (base.assign.MLB.kind === 'zone') call.bracket = { id: fav.id, by: 'MLB', how: 'lurk' };
    else if (base.assign.FS.kind === 'zone') call.bracket = { id: fav.id, by: 'FS', how: 'shade' };
  }
  // Disguise: show the other family's shell and rotate at the snap.
  const v = rng();
  if (v < DIFFICULTY[difficulty].disguise) {
    const others = DEF_CALLS.filter((c) => SINGLE_HIGH.includes(c.id) !== SINGLE_HIGH.includes(id) && c.id !== 'simpressure');
    call.shell = others[Math.floor(rng() * others.length)]!.id;
  }
  return call;
}
