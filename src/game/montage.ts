// The Beasts' possessions on screen (M7, Playtest 1 #4; cut down after M7 to
// the deciding play only, the owner's call: "just show their scoring play if
// they had one, or their turnover/turnover on downs/punt"): the drive
// resolver (match.ts beastsPossession) decides what a Beasts drive did,
// statistically (TD, FG, punt, turnover..., plays, yards, time); this
// stages the play that decided it so the screen can show it. Nothing here
// changes the game: the resolver's numbers are the drive, the staged play
// only shows one of its plays, chosen to agree with them.
//
// Who plays. The Beasts are an all-time defense, and the game never names
// their offense (BRIEF §5, GDD §7.3: "the Beasts' offense is abstracted"),
// nor a Contenders defense. The sim needs real men to move, so each side
// is drawn once per game from the ratings snapshot with legacy's weighted
// pick (engine/legacy/beasts makePickWeighted: ∝ max(1, OVR − 70)³ + 1,
// the Beasts' own draw), leaving out everyone on the field for real (your
// drafted men and the Beasts, by person, so no one plays both ways). They
// play anonymously: their ratings drive the snap, but the screen shows only
// the kits and their jersey numbers (no nameplates), because the game has
// no Beasts offense to name.
//
// The deciding play: the score on a touchdown drive, the pick (or the strip)
// on a turnover, the failed fourth down, the safety; a punt or a field goal
// (made or missed) is the kick itself, staged for the kick view with the
// kicking game's own flight (kick.ts) and no search (stageKick). A half run
// out with yards on it shows the drive's longest gain. A snap is found by search: plays from the book for the situation and the field
// (red-zone concepts and goal-line runs for a short score, shot plays from
// farther out), calls the Contenders could play, and seeds, in an order
// drawn from the game seed, run headless until one ends the way the drive
// did (within a tolerance on yards and the next spot). The offense is the
// sim's own AI (setup.user false): its QB reads and throws, its carriers
// run. A bounded count of tries, never a time budget, so the same game seed
// always stages the same snap on any machine. If nothing fits, the caller
// shows the old Meanwhile card: the montage never shows a play that
// contradicts the drive.
//
// Pure: no React, three, DOM or wall clock.

import { makePickWeighted } from '@/engine/legacy/beasts';
import type { IndexedDefender } from '@/engine/legacy/types';
import type { SnapshotEntry } from '@/engine/ratings/snapshot';
import { deriveStream, type Rng } from '@/engine/rng';
import { createPlay, DEF_SLOTS, defById, defenseFor, FIELD_HALF_W, input, NEUTRAL, OFF_SLOTS, offenseFor, playById, simPlayer, stepPlay, TICK, type BeastsDefense, type ContendersRoster, type DefSlot, type InputFrame, type PlaySetup, type PlayState, type SimEvent, type SimPlayer } from '@/sim';
import type { Catalog } from './draft';
import { aimFor, kickFlight, PUNT_DEPTH, puntFlight } from './kick';
import type { BeastsDrive } from './match';
import { keyMoment, type ReplaySource } from './replay';
import { HASH_Y } from './situation';

// ---- The two elevens --------------------------------------------------------------------

/** The Beasts' offense and the Contenders' defense for the montage (anonymous on screen). */
export interface MontageTeams {
  offense: ContendersRoster;
  defense: BeastsDefense;
}

/** Jersey numbers when the catalog has none (the usual range for the position). */
const DEFAULT_NUM: Record<string, number> = { QB: 12, RB: 28, WR: 81, TE: 86, OL: 66, DE: 94, DT: 97, LB: 55, CB: 24, S: 31 };

type Pickable = IndexedDefender & { entry: SnapshotEntry };

/**
 * Draw the montage's two elevens from the snapshot (see the header). `onField`:
 * the ratings ids of everyone really in the game (your drafted men, the Beasts).
 */
export function montageTeams(cat: Catalog, onField: readonly string[], seed: number): MontageTeams {
  const r = deriveStream(seed, 'montage:teams');
  const taken = new Set<string>();
  for (const id of onField) {
    const e = cat.entry.get(id);
    if (e) taken.add(e.personId);
  }
  const pools = new Map<string, Pickable[]>();
  for (const e of cat.entry.values()) {
    if (taken.has(e.personId)) continue;
    // legacy weights on `imp`; OVR stands in for it, as in the Beasts' own draw (src/game/beasts.ts).
    const p = { n: e.personId, imp: e.ovr, idx: 0, entry: e } as unknown as Pickable;
    const list = pools.get(e.pos) ?? [];
    list.push(p);
    pools.set(e.pos, list);
  }
  const used = new Set<string>(taken);
  const pick = makePickWeighted(r, used);
  const nums = new Set<number>();
  const man = (pos: string): SimPlayer => {
    const p = pick(pools.get(pos) ?? []) as Pickable | null;
    if (!p) throw new Error(`montage: no ${pos} left to draw`);
    let num = cat.numbers[p.entry.id] ?? DEFAULT_NUM[pos] ?? 50;
    while (nums.has(num)) num = (num % 99) + 1;
    nums.add(num);
    return simPlayer(p.entry, num);
  };
  // The offense: a line that blocks together (an OL unit, weighted the same way, none of whose men are taken), then the skill players.
  const units = [...cat.unit.values()].filter((u) => u.linemen.every((id) => !taken.has(cat.entry.get(id)?.personId ?? id)));
  const unitPick = makePickWeighted(r, new Set());
  const unit = unitPick(units.map((u) => ({ n: u.id, imp: u.ovr, idx: 0, unit: u }) as unknown as IndexedDefender)) as unknown as { unit: (typeof units)[number] };
  const unitTraits = unit.unit.traits.map((t) => t.id);
  const ol = unit.unit.linemen.map((id) => {
    const e = cat.entry.get(id)!;
    used.add(e.personId);
    let num = cat.numbers[id] ?? DEFAULT_NUM.OL!;
    while (nums.has(num)) num = (num % 99) + 1;
    nums.add(num);
    return simPlayer(e, num, unitTraits);
  }) as ContendersRoster['OL'];
  const offense: ContendersRoster = { QB: man('QB'), RB: man('RB'), RB2: man('RB'), WR1: man('WR'), WR2: man('WR'), WR3: man('WR'), TE: man('TE'), TE2: man('TE'), OL: ol };
  // The defense: the Beasts' own shape (DE DT DT DE / LB LB LB / CB S S CB, then the nickel corner and the dime safety).
  nums.clear();
  const base = { LE: man('DE'), LDT: man('DT'), RDT: man('DT'), RE: man('DE'), WLB: man('LB'), MLB: man('LB'), SLB: man('LB'), LCB: man('CB'), FS: man('S'), SS: man('S'), RCB: man('CB') } as Record<DefSlot, SimPlayer>;
  return { offense, defense: { base, nickel: man('CB'), dime: man('S') } };
}

// ---- The key play -------------------------------------------------------------------------

export type KeyKind = 'td' | 'turnover' | 'stop' | 'gain' | 'safety' | 'punt' | 'fg';

/** A staged key play: the snap to show (setup and every tick's input) and where its beats fall. */
export interface StagedPlay {
  type: 'snap';
  kind: Exclude<KeyKind, 'punt' | 'fg'>;
  src: ReplaySource;
  snapTick: number;
  /** The moment: the catch or the plane, the pick, the sack or the breakup, the tackle. */
  keyTick: number;
  whistleTick: number;
  /** The man the reaction shot is on (agent index). */
  who: number;
  /** The result as the broadcast calls it ("Touchdown", "Intercepted", "Sacked", "Incomplete", "Stopped", "23-yard gain"). */
  label: string;
  /** The snap's situation (down, distance, line of scrimmage: yards from the Beasts' goal line) and its gain. */
  down: number;
  toGo: number;
  los: number;
  yards: number;
  /** Tries the search took (for the notes and the tests). */
  tries: number;
}

/**
 * A staged kick (a punt, a field goal made or missed): what the kick view
 * needs (render/game/kickView.ts, in the montage's field frame: x from the
 * Beasts' goal line, toward the end they attack), the flight from the
 * kicking game's own model (kick.ts), and the twenty-two who line up for
 * it, by body (OFF_SLOTS then DEF_SLOTS, the scene's order).
 */
export interface StagedKick {
  type: 'kick';
  kind: 'punt' | 'fg';
  /** "Punt", "Field goal", "No good". */
  label: string;
  good: boolean;
  down: number;
  toGo: number;
  los: number;
  /** A punt's gross (line of scrimmage to where it comes down), a field goal's distance. */
  yards: number;
  /** The spot of the kick (where the punter meets it, or the hold) and a field goal's distance to the posts' plane. */
  spotX: number;
  distance: number;
  /** The flight in the kick frame, every 1/30 s, and its time in the air (s). */
  path: [number, number, number][];
  hang: number;
  wind: { mph: number; dir: number };
  men: SimPlayer[];
}

export type Staged = StagedPlay | StagedKick;

/** Ticks of the offense set at the line before the snap (the search runs the AI's set; the screen shows the last of it). */
export const PRE_SNAP = 150;
/** Ticks the snap runs on after the whistle (the reaction shot). */
export const TAIL = 150;
/** Most snaps searched for a key play: bounded by count (deterministic), ~5–30 ms each in Node. A turnover (a pick that lands where your drive starts) is the rare one: tools/sim/montage.ts. */
export const MAX_TRIES = 64;
/** The moment must come this soon after the snap (s), so the drive's play stays short (~4–6 s on screen). */
const MAX_TO_KEY = 4.6;

/** Plays from the book by situation (src/sim/plays.ts ids). */
const GOAL_LINE = ['heavy-dive', 'iform-iso', 'heavy-power', 'iform-power', 'singleback-power', 'singleback-inside-zone', 'bunch-snag', 'heavy-pa-te-leak', 'pistol-pa-boot'];
const RED_ZONE = ['bunch-snag', 'doubles-slants', 'doubles-smash', 'trips-stick', 'doubles-quick-outs', 'empty-spot', 'pistol-pa-boot', 'singleback-inside-zone', 'iform-toss', 'singleback-outside-zone'];
const SHOT = ['trips-four-verts', 'doubles-smash', 'singleback-pa-post', 'doubles-dagger', 'bunch-flood', 'trips-y-cross', 'ace-te-seam', 'bunch-snag'];
const DROPBACK = ['trips-four-verts', 'doubles-slants', 'doubles-dagger', 'singleback-pa-post', 'bunch-flood', 'doubles-smash', 'trips-y-cross', 'doubles-curls', 'doubles-mesh'];
const MIXED = ['singleback-inside-zone', 'singleback-outside-zone', 'iform-power', 'pistol-stretch', 'doubles-draw', 'doubles-curls', 'doubles-smash', 'trips-y-cross', 'ace-te-seam', 'singleback-pa-post', 'bunch-flood', 'doubles-rb-screen'];
/**
 * Throws into coverage that gets its hands on the ball: the pairs that pick
 * most often against the montage's elevens, and how far past the line the
 * ball comes down after the return (yd), so the line can be set for the
 * spot your drive starts from (tools/sim/montage.ts; 40 seeds a pair: the
 * hitch-seam and curl-flat against Cover 1 are picked ~22% of the time,
 * 4–10 yd past the line; the deeper ones ~10%, 20–30 yd).
 */
const PICK_PAIRS: [string, string, number][] = [
  ['doubles-hitch-seam', 'cover1', 5],
  ['doubles-curls', 'cover1', 9],
  ['doubles-hitch-seam', 'cover1blitz', 5],
  ['doubles-curls', 'cover1blitz', 10],
  ['trips-y-cross', 'cover1blitz', 20],
  ['doubles-dagger', 'tampa2', 27],
  ['trips-stick', 'cover2', 24],
  ['trips-four-verts', 'firezone', 28],
];
const SHORT_YARDAGE = ['heavy-dive', 'iform-iso', 'singleback-power', 'heavy-power', 'trips-stick', 'doubles-slants', 'doubles-quick-outs'];
/** The Contenders' calls: the red zone (tight man and two-deep looks, pressure) and the open field. */
const RZ_CALLS = ['cover1', 'cover2man', 'cover3', 'tampa2', 'cover1blitz', 'firezone'];
const FIELD_CALLS = ['cover3', 'cover1', 'cover2', 'cover4', 'cover2man', 'tampa2', 'firezone', 'simpressure'];

interface Spec {
  kind: KeyKind;
  los: number;
  down: number;
  toGo: number;
  plays: string[];
  calls: string[];
  /** Play and call together (instead of drawing each from its list), and the line set this far short of `end`. */
  pairs?: [string, string, number][];
  end?: number;
  accept(s: PlayState): boolean;
}

const tickOf = (e: SimEvent) => Math.round(e.t / TICK);
const NO_WIND = { mph: 0, dir: 0 };
const between = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** What the drive needs its key play to be (null: nothing to stage, e.g. a kneel-out). */
function specFor(d: BeastsDrive, r: Rng): Spec | null {
  const start = d.start ?? between(100 - d.yards, 1, 80);
  const yards = Math.max(0, Math.round(d.yards));
  const pickOf = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)]!;
  const twoPoint = !!d.twoPoint && d.plays === 1;
  if (d.result === 'TD') {
    // The scoring play: from the 3 on a two-point try; else short (goal line), red zone or from distance, never longer than the drive.
    const u = r();
    const k = twoPoint ? 3 : Math.min(yards, 100 - start, u < 0.35 ? 1 + Math.floor(r() * 4) : u < 0.8 ? 5 + Math.floor(r() * 12) : 17 + Math.floor(r() * 18));
    const kk = Math.max(1, k);
    const plays = kk <= 4 ? GOAL_LINE : kk <= 16 ? RED_ZONE : SHOT;
    return { kind: 'td', los: 100 - kk, down: twoPoint ? 1 : kk <= 4 ? 1 + Math.floor(r() * 3) : 1 + Math.floor(r() * 2), toGo: Math.min(10, kk), plays, calls: RZ_CALLS, accept: (s) => !!s.result?.touchdown && s.result.offenseBall };
  }
  if (twoPoint) {
    // A failed two-point try: stopped short from the 3.
    return { kind: 'stop', los: 97, down: 1, toGo: 3, plays: GOAL_LINE, calls: RZ_CALLS, accept: (s) => !!s.result && !s.result.touchdown && (s.result.offenseBall || !!s.result.pass?.intercepted) };
  }
  if (d.result === 'Turnover') {
    // The pick near the drive's end: it must come down (after the return) where your drive starts, within a few yards.
    const end = 100 - d.nextStart;
    // The line is set per throw, short of where it's picked and brought back (PICK_PAIRS): the spot is what you see.
    return { kind: 'turnover', los: end, end, down: 1 + Math.floor(r() * 3), toGo: 10, plays: [], calls: [], pairs: PICK_PAIRS, accept: (s) => !!s.result && !s.result.offenseBall && !s.result.touchdown && Math.abs(s.result.spot - end) <= 10 };
  }
  if (d.result === 'Downs') {
    // The failed fourth down: short of the sticks, where your drive starts (an incompletion, a sack, a stuff).
    const toGo = 1 + Math.floor(r() * 3);
    const end = 100 - d.nextStart;
    const los = between(end, 2, 95);
    const plays = [...SHORT_YARDAGE, ...DROPBACK.slice(0, 4)];
    return { kind: 'stop', los, down: 4, toGo: Math.min(toGo, 100 - los), plays, calls: los > 80 ? RZ_CALLS : FIELD_CALLS, accept: (s) => !!s.result && s.result.offenseBall && !s.result.touchdown && s.result.yards <= Math.min(toGo, 100 - los) - 1 && s.result.yards > -9 && Math.abs(s.result.spot - end) <= 2 };
  }
  if (d.result === 'Safety') {
    return { kind: 'safety', los: 1 + Math.floor(r() * 2), down: 1 + Math.floor(r() * 3), toGo: 10, plays: [...GOAL_LINE.slice(0, 6), 'doubles-curls', 'trips-four-verts', 'singleback-pa-post'], calls: ['cover1blitz', 'firezone', 'simpressure', 'cover1', 'cover3'], accept: (s) => s.result?.reason === 'safety' };
  }
  // A half that ran out with yards on it (or a field goal that won't stage): the drive's longest gain.
  if (yards < 8) return null;
  const lo = Math.max(6, Math.ceil(yards / Math.max(1, d.plays)) + 2);
  const hi = Math.min(yards, 40);
  if (lo > hi) return null;
  const want = lo + Math.floor(r() * (hi - lo + 1));
  const los = between(start + Math.floor(r() * Math.max(1, yards - want)), start, 95 - want);
  return { kind: 'gain', los, down: 1 + Math.floor(r() * 3), toGo: Math.min(10, 100 - los), plays: pickOf([MIXED, DROPBACK]), calls: los > 80 ? RZ_CALLS : FIELD_CALLS, accept: (s) => !!s.result && s.result.offenseBall && !s.result.touchdown && s.result.yards >= lo && s.result.yards <= hi };
}

/** The offense set at the line, the snap, then nothing (the AI plays it): run to the whistle (or a cap), recording every tick's input. */
function runToWhistleFrom(s: PlayState, out: InputFrame[]): void {
  const snap = input({ snap: true });
  while (!s.result && out.length < PRE_SNAP + 60 * 14) {
    const f = out.length === PRE_SNAP ? snap : NEUTRAL;
    stepPlay(s, f);
    out.push(f);
  }
}

/** On after the whistle (the dead ball, the reaction shot). */
function runTail(s: PlayState, out: InputFrame[]): void {
  for (let k = 0; k < TAIL; k++) {
    stepPlay(s, NEUTRAL);
    out.push(NEUTRAL);
  }
}

/** The moment, the man and the call for a finished snap of this kind. */
function beatOf(kind: KeyKind, s: PlayState): { tick: number; who: number; label: string } {
  const res = s.result!;
  const ev = s.events;
  const whistle = Math.round(s.whistleT / TICK);
  if (kind === 'td' || kind === 'turnover') {
    const k = keyMoment(s);
    if (k && (k.kind === 'touchdown' || k.kind === 'turnover')) return { tick: k.tick, who: k.who, label: k.kind === 'touchdown' ? 'Touchdown' : k.label === 'Fumble' ? 'Fumble' : 'Intercepted' };
  }
  const sack = ev.find((e) => e.type === 'sack');
  if (sack) return { tick: tickOf(sack), who: sack.who?.[0] ?? s.qb, label: kind === 'safety' ? 'Safety' : 'Sacked' };
  if (res.pass?.attempted && !res.pass.complete) {
    const brk = ev.find((e) => e.type === 'deflection');
    const tgt = res.pass.target;
    // The man who broke it up, else the nearest defender to the target when it fell.
    let who = brk?.who?.[0] ?? -1;
    if (who < 0 && tgt >= 0) {
      let best = Infinity;
      for (const i of s.def) {
        const a = s.agents[i]!.pos;
        const b = s.agents[tgt]!.pos;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < best) {
          best = d;
          who = i;
        }
      }
    }
    return { tick: brk ? tickOf(brk) : whistle, who: who >= 0 ? who : s.qb, label: 'Incomplete' };
  }
  const tackle = [...ev].reverse().find((e) => e.type === 'tackle');
  if (kind === 'safety') return { tick: tackle ? tickOf(tackle) : whistle, who: tackle?.who?.[0] ?? s.carrier, label: 'Safety' };
  if (kind === 'stop') return { tick: tackle ? tickOf(tackle) : whistle, who: tackle?.who?.[0] ?? s.carrier, label: 'Stopped' };
  // A gain: the catch (or the handoff) is where it starts; the reaction is on the man who made it.
  const y = Math.round(res.yards);
  return { tick: tackle ? tickOf(tackle) : whistle, who: s.carrier >= 0 ? s.carrier : s.qb, label: `${y}-yard ${res.pass?.complete ? 'catch' : 'run'}` };
}

// ---- On screen (montageSession.ts plays it; the timing is here so the tests and tools can measure it) ----

/** Seconds the result graphic holds over the dead ball (the lower third reads in ~1.5 s: result, numbers, where your drive starts). */
export const RESULT_SECS = 1.6;
/** A snap's window opens this long before the snap (ticks: 0.3 s): the offense set, then it goes. */
export const LEAD = 18;
/**
 * The result graphic comes up AFTER_KEY after the moment at the earliest
 * (ticks: 1/3 s: the ball in, the pick made), at the whistle, or at the
 * latest KEY_RUN after the moment (0.75 s: a pick's return isn't the story).
 */
export const AFTER_KEY = 20;
const KEY_RUN = 45;
/**
 * Slow motion through a score or a turnover, a touch: down to SLOW over
 * EASE ticks before the moment, held to HOLD after it, back up over EASE
 * (~0.5 s added to the play; the old montage held 0.4x for ~0.6 s of play).
 */
const SLOWMO = { slow: 0.5, ease: 14, from: -6, hold: 14 };
/**
 * A kick cuts in this far into its operation (s from the snap): a punt
 * with the ball in the punter's hands, two steps from the kick (render/game/
 * kickView.ts PUNT_SNAP: caught at 0.92 s, met at 2.22 s); a field goal at
 * the snap (the hold and the kick take 1.3 s).
 */
export const KICK_FROM = { punt: 1.25, fg: 0 };
/**
 * The result comes up as the punt comes down (s from its landing: on its
 * way down, the returner under it, so the plate is up as he fields it), or
 * as the field goal reaches the posts (the share of its flight).
 */
export const KICK_RESULT = { puntAfterLand: -0.6, fgFlight: 0.8 };

const smoothstep = (k: number) => {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
};

/** The play's speed at `d` ticks from the moment (1 outside the slow motion). */
export function montageSpeed(d: number): number {
  const S = SLOWMO;
  if (d < S.from - S.ease || d > S.hold + S.ease) return 1;
  if (d < S.from) return 1 + (S.slow - 1) * smoothstep((d - (S.from - S.ease)) / S.ease);
  if (d <= S.hold) return S.slow;
  return S.slow + (1 - S.slow) * smoothstep((d - S.hold) / S.ease);
}

/** Where a snap's result graphic comes up (ticks): at the whistle, but not before the moment has landed nor long after it. */
export const resultTick = (st: StagedPlay): number => Math.min(st.src.frames.length, Math.max(st.keyTick + AFTER_KEY, Math.min(st.whistleTick, st.keyTick + KEY_RUN)));

/**
 * How long the drive's play is on screen, unskipped (s): the snap from LEAD
 * before it to the result (slowed through a score or a turnover), or the
 * kick from its cut-in to the ball down; then the result graphic.
 * `contact`: the kick view's snap-to-foot time for that kind of kick.
 */
export function screenSecs(st: Staged, contact: (kind: 'punt' | 'fg') => number): number {
  if (st.type === 'kick') {
    const c = contact(st.kind);
    const at = c + (st.kind === 'punt' ? st.hang + KICK_RESULT.puntAfterLand : st.hang * KICK_RESULT.fgFlight);
    return at - KICK_FROM[st.kind] + RESULT_SECS;
  }
  const slow = st.kind === 'td' || st.kind === 'turnover';
  let s = 0;
  for (let t = st.snapTick - LEAD; t < resultTick(st); t++) s += TICK / (slow ? montageSpeed(t - st.keyTick) : 1);
  return s + RESULT_SECS;
}

// ---- Kicks ---------------------------------------------------------------------------------

/**
 * The Beasts' kicker's range (yd: a clean strike in still air just clears
 * the bar from here, kick.ts legSpeed). A strong NFL leg: makes from 55–60
 * were routine for the best kickers of 2015–2023, and the Beasts' kicker is
 * anonymous like the rest of their offense. The Contenders' is the
 * difficulty's (match.ts KICKER_RANGE, 50–60).
 */
const BEASTS_KICKER_RANGE = 58;
/** The longest field goal staged (yd): a resolver FG from farther out (a drive cut short by the gun) is kicked from here. */
const MAX_FG = 55;
/**
 * A punt's carry from the punter that's staged (yd): a pooch of 30 to a
 * full, overcooked one (kick.ts PUNT_CARRY is 52 at full leg in still air;
 * the leg goes to 1.08, ~56). The resolver's punts net 40–70 yd from where
 * the drive ended, so a long one is kicked from a few yards farther up.
 */
const PUNT_CARRY_RANGE = { min: 30, max: 56 };
/** The play and the call the twenty-two are drawn from for a kick (a two-receiver set: the gunners are wideouts; the return team's base). */
const KICK_PLAY = 'doubles-curls';
const KICK_CALL = 'cover3';

/** The men on the field for a kick, by body (OFF_SLOTS then DEF_SLOTS). */
function kickMen(teams: MontageTeams): SimPlayer[] {
  const off = offenseFor(playById(KICK_PLAY), teams.offense);
  const def = defenseFor(defById(KICK_CALL), teams.defense);
  return [...OFF_SLOTS.map((k) => off[k]), ...DEF_SLOTS.map((k) => def[k])];
}

/**
 * A punt or a field goal (made or missed), kicked: no search, the flight is
 * solved for. A punt comes down where your drive starts (100 - nextStart in
 * this frame: fielded there), from the line the drive ended on (moved up or
 * back when the carry would be out of PUNT_CARRY_RANGE). A field goal from
 * where the drive ended (no farther than MAX_FG), struck clean and aimed
 * through the middle against the wind; a miss pushed wide of an upright.
 * Null: a field goal that won't come out the way the drive did (the caller
 * shows the longest gain instead).
 */
function stageKick(d: BeastsDrive, teams: MontageTeams, r: Rng, wind: { mph: number; dir: number }): StagedKick | null {
  const start = d.start ?? between(100 - d.yards, 1, 80);
  const yards = Math.max(0, Math.round(d.yards));
  // Fourth and 2–10.
  const toGo = 2 + Math.floor(r() * 9);
  if (d.result === 'Punt') {
    const land = 100 - d.nextStart;
    let los = between(start + yards, 5, 80);
    const carry = land - (los - PUNT_DEPTH);
    if (carry > PUNT_CARRY_RANGE.max) los = land + PUNT_DEPTH - PUNT_CARRY_RANGE.max;
    else if (carry < PUNT_CARRY_RANGE.min) los = land + PUNT_DEPTH - PUNT_CARRY_RANGE.min;
    los = Math.round(between(los, 3, 85));
    const spotX = los - PUNT_DEPTH;
    const want = land - spotX;
    // A touch off straight (up to 2.3 degrees), to either side.
    const aim = (r() - 0.5) * 0.08;
    const fly = (power: number) => puntFlight({ power, aim, wind, y0: 0, halfWidth: FIELD_HALF_W });
    // The leg that carries it there (carry grows with power: bisection).
    let lo = 0.3;
    let hi = 1.08;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fly(mid).carry < want) lo = mid;
      else hi = mid;
    }
    const f = fly((lo + hi) / 2);
    return { type: 'kick', kind: 'punt', label: 'Punt', good: true, down: 4, toGo: Math.min(toGo, 100 - los), los, yards: Math.round(spotX + f.carry - los), spotX, distance: 0, path: f.path, hang: f.hang, wind, men: kickMen(teams) };
  }
  const good = d.result === 'FG';
  // fgDistance (match.ts): the hold 7 yd behind the line, the posts' plane 10 past the goal line.
  const los = Math.round(between(start + yards, 117 - MAX_FG, 98));
  const distance = 117 - los;
  const side = r() < 0.5 ? 1 : -1;
  for (const power of [1, 1.04, 1.08]) {
    const base = { distance, range: BEASTS_KICKER_RANGE, wind, power };
    const straight = aimFor(base);
    // A make straight through; a miss pushed wide, a little wider each try (an upright is atan(3.08/d) off the middle: 0.07 rad at 45 yd).
    for (let k = 0; k < (good ? 1 : 6); k++) {
      const aim = good ? straight : straight + side * (Math.atan(4.2 / distance) + 0.012 * k);
      const f = kickFlight({ ...base, aim });
      if (f.good !== good || (!good && f.why === 'short')) continue;
      return { type: 'kick', kind: 'fg', label: good ? 'Field goal' : 'No good', good, down: 4, toGo: Math.min(toGo, 100 - los), los, yards: distance, spotX: los - 7, distance, path: f.path, hang: f.hang, wind, men: kickMen(teams) };
    }
  }
  return null;
}

/**
 * Stage a Beasts drive's deciding play, or null if it has none to show (or
 * no snap in MAX_TRIES fits): the caller shows the Meanwhile card instead.
 * `round` and `ot` key the stream, so each possession of a game has its own.
 * `wind`: the match's (a kick flies in it).
 */
export function stageDrive(d: BeastsDrive, teams: MontageTeams, seed: number, round: number, ot: number, wind = NO_WIND): Staged | null {
  const it = staging(d, teams, seed, round, ot, wind);
  for (;;) {
    const n = it.next();
    if (n.done) return n.value;
  }
}

/**
 * The search one try at a time (each `next()` runs one snap, ~5–30 ms), so
 * the game can spread it over frames (montageSession.ts) without a hitch.
 * The result is the same however it's sliced: the tries are counted, not timed.
 */
export function* staging(d: BeastsDrive, teams: MontageTeams, seed: number, round: number, ot: number, wind = NO_WIND): Generator<void, Staged | null, void> {
  const r = deriveStream(seed, `montage:${round}-${ot}`);
  // A punt or a field goal: the kick itself (a field goal that won't stage falls back to the longest gain).
  if (!d.twoPoint && (d.result === 'Punt' || d.result === 'FG' || d.result === 'MissedFG')) {
    const k = stageKick(d, teams, r, wind);
    if (k) return k;
  }
  const spec = specFor(d, r);
  if (!spec) return null;
  // One snap of the search: the setup, run to the whistle, and whether it ends the way the drive did.
  const attempt = (setup: PlaySetup): { s: PlayState; frames: InputFrame[]; ok: boolean } => {
    const s = createPlay(setup);
    const frames: InputFrame[] = [];
    runToWhistleFrom(s, frames);
    const ok = !!s.result && spec.accept(s) && (beatOf(spec.kind, s).tick - Math.round(s.snapT / TICK)) * TICK <= MAX_TO_KEY;
    return { s, frames, ok };
  };
  let tries = 0;
  while (tries < MAX_TRIES) {
    if (tries > 0) yield;
    tries++;
    const pair = spec.pairs?.[Math.floor(r() * spec.pairs.length)];
    const los = pair && spec.end !== undefined ? between(spec.end - pair[2], 5, 90) : spec.los;
    const play = playById(pair ? pair[0] : spec.plays[Math.floor(r() * spec.plays.length)]!);
    const call = defById(pair ? pair[1] : spec.calls[Math.floor(r() * spec.calls.length)]!);
    const flip = r() < 0.5;
    const hash = Math.floor(r() * 3) - 1;
    const sim = (r() * 0x7fffffff) | 0;
    // The ball on a hash (the middle inside the 10).
    const setupAt = (l: number): PlaySetup => ({
      seed: sim,
      offense: offenseFor(play, teams.offense),
      defense: defenseFor(call, teams.defense),
      play,
      def: call,
      los: l,
      ballY: l > 90 ? 0 : hash * HASH_Y,
      toGo: Math.min(spec.toGo, 100 - l),
      user: false,
      autoSnap: false,
      difficulty: 'pro',
      flip,
      down: spec.down,
    });
    let setup = setupAt(los);
    let run = attempt(setup);
    // A pick that came down too far from where your drive starts: the same snap from a line moved by the difference
    // (a pass play is much the same play a few yards up or down the field) usually lands it; that counts as a try.
    const res = run.s.result;
    if (!run.ok && spec.end !== undefined && res && !res.offenseBall && !res.touchdown && tries < MAX_TRIES) {
      const moved = between(los + Math.round(spec.end - res.spot), 5, 90);
      if (moved !== los) {
        yield;
        tries++;
        setup = setupAt(moved);
        run = attempt(setup);
      }
    }
    if (!run.ok) continue;
    const s = run.s;
    const snapTick = Math.round(s.snapT / TICK);
    const beat = beatOf(spec.kind, s);
    const whistleTick = Math.round(s.whistleT / TICK);
    const yards = Math.round(s.result!.yards);
    runTail(s, run.frames);
    return { type: 'snap', kind: spec.kind as StagedPlay['kind'], src: { setup, frames: run.frames }, snapTick, keyTick: beat.tick, whistleTick, who: beat.who, label: beat.label, down: spec.down, toGo: setup.toGo, los: setup.los, yards, tries };
  }
  return null;
}
