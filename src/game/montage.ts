// The Beasts' possessions as a broadcast montage (M7, Playtest 1 #4): the
// drive resolver (match.ts beastsPossession) decides what a Beasts drive
// did, statistically (TD, FG, punt, turnover..., plays, yards, time); this
// stages its key play in the sim so the screen can show it. Nothing here
// changes the game: the resolver's numbers are the drive, the staged snap
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
// The key play: the score on a touchdown drive, the pick (or the strip) on
// a turnover, the stop that forced the punt or turned it over on downs, the
// safety, else the drive's longest gain (field goals, a half run out). It is
// found by search: plays from the book for the situation and the field
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
import { createPlay, defById, defenseFor, input, NEUTRAL, offenseFor, playById, simPlayer, stepPlay, TICK, type BeastsDefense, type ContendersRoster, type DefSlot, type InputFrame, type PlaySetup, type PlayState, type SimEvent, type SimPlayer } from '@/sim';
import type { Catalog } from './draft';
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

export type KeyKind = 'td' | 'turnover' | 'stop' | 'gain' | 'safety';

/** A staged key play: the snap to show (setup and every tick's input) and where its beats fall. */
export interface StagedPlay {
  kind: KeyKind;
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

/** Ticks of the offense set at the line before the snap (the establishing shot runs over them). */
export const PRE_SNAP = 150;
/** Ticks the snap runs on after the whistle (the reaction shot). */
export const TAIL = 150;
/** Most snaps searched for a key play: bounded by count (deterministic), ~5–30 ms each in Node. A turnover (a pick that lands where your drive starts) is the rare one: tools/sim/montage.ts. */
export const MAX_TRIES = 64;
/** The moment must come this soon after the snap (s), so the montage stays about ten seconds. */
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
  if (d.result === 'Punt' || d.result === 'Downs') {
    // The stop: third down (fourth on downs), short of the sticks, where the drive ended (an incompletion, a sack, a stuff).
    const fourth = d.result === 'Downs';
    const toGo = fourth ? 1 + Math.floor(r() * 3) : 2 + Math.floor(r() * 8);
    const end = fourth ? 100 - d.nextStart : between(start + yards, 3, 95);
    const los = between(end, 2, 95);
    const plays = toGo <= 3 ? [...SHORT_YARDAGE, ...DROPBACK.slice(0, 4)] : DROPBACK;
    return { kind: 'stop', los, down: fourth ? 4 : 3, toGo: Math.min(toGo, 100 - los), plays, calls: los > 80 ? RZ_CALLS : FIELD_CALLS, accept: (s) => !!s.result && s.result.offenseBall && !s.result.touchdown && s.result.yards <= Math.min(toGo, 100 - los) - 1 && s.result.yards > -9 && Math.abs(s.result.spot - end) <= (fourth ? 2 : 8) };
  }
  if (d.result === 'Safety') {
    return { kind: 'safety', los: 1 + Math.floor(r() * 2), down: 1 + Math.floor(r() * 3), toGo: 10, plays: [...GOAL_LINE.slice(0, 6), 'doubles-curls', 'trips-four-verts', 'singleback-pa-post'], calls: ['cover1blitz', 'firezone', 'simpressure', 'cover1', 'cover3'], accept: (s) => s.result?.reason === 'safety' };
  }
  // A field goal (made or missed) or a half that ran out with yards on it: the drive's longest gain.
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

/**
 * Stage a Beasts drive's key play, or null if it has none to show (or no
 * snap in MAX_TRIES fits): the caller shows the Meanwhile card instead.
 * `round` and `ot` key the stream, so each possession of a game has its own.
 */
export function stageDrive(d: BeastsDrive, teams: MontageTeams, seed: number, round: number, ot: number): StagedPlay | null {
  const it = staging(d, teams, seed, round, ot);
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
export function* staging(d: BeastsDrive, teams: MontageTeams, seed: number, round: number, ot: number): Generator<void, StagedPlay | null, void> {
  const r = deriveStream(seed, `montage:${round}-${ot}`);
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
    return { kind: spec.kind, src: { setup, frames: run.frames }, snapTick, keyTick: beat.tick, whistleTick, who: beat.who, label: beat.label, down: spec.down, toGo: setup.toGo, los: setup.los, yards, tries };
  }
  return null;
}
