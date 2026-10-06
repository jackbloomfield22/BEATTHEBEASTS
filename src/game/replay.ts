// Instant replay (M7, Playtest 1 #8; GDD §11.5). A snap is its setup and the
// InputFrame the sim got on every tick (runner.ts records them), so a replay
// is the play run again: createPlay with the recorded setup, then the
// recorded frames, tick by tick, through a SimRunner like the live play's.
// Nothing is approximated: the replay's state after the last frame hashes
// the same as the original's, and a replay that doesn't (a record from an
// older build) is refused (tests/replay.test.ts).
//
// Scrubbing: forward steps the play on and the scene animates every step;
// back rebuilds the play at the start of the replay window (a beat before
// the snap, everyone set in his stance) and steps it forward to the new
// tick, the scene animating the way there (GameScene catchUp). TECH_PLAN
// §4.5 planned a ring buffer of render snapshots instead; but the drawn
// bodies carry state a sim snapshot can't restore (a clip part-way through
// its blend, a fall under way, a catch in the hands, a man lying where the
// tackle left him), and running the window again through the scene
// restores all of it. The sim is cheap (a whole play re-simulates in a few
// milliseconds); the cost is the animation, which the scene runs coarse
// far from the target and fine near it, time-sliced across frames.
//
// Pure: no React, three or DOM (replaySession.ts drives it from the scene).

import { createPlay, mirrorPlay, playById, stepPlay, TICK, toStrength, type InputFrame, type PlaySetup, type PlayState, type SimEvent } from '@/sim';
import { hashPlay } from '@/sim/hash';
import { decodeFrames, encodeFrames, type ReplayCapsule } from './record';
import { SimRunner } from './runner';

/** What a replay runs: the sim's setup, every tick's input, and the original's state hash after the last of them. */
export interface ReplaySource {
  setup: PlaySetup;
  frames: readonly InputFrame[];
  hash?: number;
}

/** What flags a play for the replay (GDD §11.5: touchdowns, turnovers and big hits). */
export type FlagKind = 'touchdown' | 'turnover' | 'bigHit';

/** The moment a flagged replay is built around: its tick, the man it's about (agent index) and its name. */
export interface ReplayKey {
  kind: FlagKind;
  tick: number;
  who: number;
  label: string;
}

/** The replay window opens this long before the snap (ticks: 1 s), the offense set. */
export const LEAD_TICKS = 60;
/** A flagged replay opens this long before its key moment (1.5 s): the beat before it. */
export const KEY_LEAD = 90;
/** Jumping to the key moment lands this long before it (0.5 s), so it plays into it. */
export const KEY_JUMP = 30;
/** An automatic replay hands back to the result card this long after the key moment (2.5 s of play), or at the end. */
export const AUTO_TAIL = 150;
/** The replay's speeds, in the order the speed key cycles them. */
export const SPEEDS = [1, 0.5, 0.25] as const;
/** The scrub keys' step (ticks: 1 s) and a frame step (ticks: 1/30 s, a broadcast frame). */
export const SCRUB_TICKS = 60;
export const FRAME_TICKS = 2;

/**
 * The director's slow motion through a key moment (ticks from it): full
 * speed until EASE_IN before it, easing down to SLOW by HOLD_FROM before it,
 * held through HOLD_TO after it (the hit landing, the ball in the hands, the
 * plane broken), then easing back up over EASE_OUT. 0.3× is the broadcast's
 * super slow-mo feel; GDD §11.5's in-play slow motion is 0.35×.
 */
const DIRECTOR = { easeIn: 36, holdFrom: 10, holdTo: 48, easeOut: 30, slow: 0.3 };

const smooth = (k: number) => {
  const x = Math.min(1, Math.max(0, k));
  return x * x * (3 - 2 * x);
};

/** The director's speed at `d` ticks from the key moment. */
export function directorSpeed(d: number): number {
  const D = DIRECTOR;
  if (d < -D.easeIn || d > D.holdTo + D.easeOut) return 1;
  if (d < -D.holdFrom) return 1 + (D.slow - 1) * smooth((d + D.easeIn) / (D.easeIn - D.holdFrom));
  if (d <= D.holdTo) return D.slow;
  return D.slow + (1 - D.slow) * smooth((d - D.holdTo) / D.easeOut);
}

const tickOf = (e: SimEvent) => Math.round(e.t / TICK);

/**
 * The play's key moment, if it's one the replay flags: a turnover (the
 * pick, the strip), a touchdown (the catch when the ball was caught at or
 * near the goal line, else the ball breaking the plane), or a big hit (the
 * hardest). Read from the finished play's events.
 */
export function keyMoment(s: PlayState): ReplayKey | null {
  const r = s.result;
  if (!r) return null;
  const ev = s.events;
  if (!r.offenseBall) {
    const pick = ev.find((e) => e.type === 'interception');
    if (pick) return { kind: 'turnover', tick: tickOf(pick), who: pick.who?.[0] ?? -1, label: r.touchdown ? 'Pick six' : 'Interception' };
    const strip = ev.find((e) => e.type === 'fumble');
    if (strip) return { kind: 'turnover', tick: tickOf(strip), who: strip.who?.[0] ?? -1, label: 'Fumble' };
  }
  if (r.touchdown && r.offenseBall) {
    const td = ev.find((e) => e.type === 'touchdown');
    const scorer = td?.who?.[0] ?? s.carrier;
    const caught = ev.find((e) => e.type === 'catch' && e.who?.[0] === scorer);
    // Caught in the end zone or a stride short of it (within 1.5 s of the score): the catch is the moment.
    const k = caught && (!td || tickOf(td) - tickOf(caught) <= 90) ? caught : td;
    if (k) return { kind: 'touchdown', tick: tickOf(k), who: scorer, label: 'Touchdown' };
  }
  let hit: SimEvent | null = null;
  for (const e of ev) if ((e.type === 'hit' || e.type === 'tackle') && e.data?.big && (!hit || Number(e.data.force ?? 0) > Number(hit.data?.force ?? 0))) hit = e;
  if (hit) return { kind: 'bigHit', tick: tickOf(hit), who: hit.who?.[1] ?? -1, label: 'Big hit' };
  return null;
}

/** The replay's source from a live play: its setup, a copy of its inputs so far, and its hash now. */
export function captureSource(s: PlayState, frames: readonly InputFrame[]): ReplaySource {
  return { setup: s.setup, frames: frames.slice(), hash: s.tick === frames.length ? hashPlay(s) : undefined };
}

/**
 * A play as the game record keeps it (record.ts ReplayCapsule): the setup
 * by name (the play's id, flipped or not), the eleven on each side, and the
 * inputs run-length encoded. `down`: the snap's down (the game's own count).
 */
export function capsuleOf(s: PlayState, frames: readonly InputFrame[], down = s.setup.down ?? 1): ReplayCapsule {
  const st = s.setup;
  const base = playById(st.play.id);
  // createPlay keeps a flipped call's mirrored play (and flip: false); name it by its id and the flip.
  const flip = st.play !== base && JSON.stringify(mirrorPlay(base)) === JSON.stringify(st.play);
  return {
    seed: st.seed,
    playId: st.play.id,
    // The call as it was made: createPlay keeps it played by the formation's strength (byStrength), and plays it so again.
    def: st.byStrength ? { ...st.def, assign: toStrength(st.def.assign, -1) } : st.def,
    los: st.los,
    ballY: st.ballY ?? 0,
    toGo: st.toGo,
    down,
    difficulty: st.difficulty,
    tapMax: st.tapMax,
    flip: flip || undefined,
    fatigue: st.fatigue as Record<string, number> | undefined,
    legs: st.legs as Record<string, number> | undefined,
    chem: st.chem as Record<string, number> | undefined,
    user: st.user,
    players: { offense: st.offense, defense: st.defense },
    hash: s.tick === frames.length ? hashPlay(s) : undefined,
    frames: encodeFrames(frames),
  };
}

/** The setup and inputs a capsule replays (null: a capsule from before M7, without its players). */
export function sourceOf(c: ReplayCapsule): ReplaySource | null {
  if (!c.players) return null;
  const setup: PlaySetup = {
    seed: c.seed,
    offense: c.players.offense,
    defense: c.players.defense,
    play: playById(c.playId),
    def: c.def,
    los: c.los,
    ballY: c.ballY,
    toGo: c.toGo,
    user: c.user ?? true,
    difficulty: c.difficulty,
    tapMax: c.tapMax,
    flip: c.flip,
    fatigue: c.fatigue,
    legs: c.legs,
    chem: c.chem,
    down: c.down,
  };
  return { setup, frames: decodeFrames(c.frames), hash: c.hash };
}

/** Run the whole play once, headless: where the snap and the whistle fall, the key moment, the final hash. */
function analyze(src: ReplaySource): { snap: number; whistle: number; key: ReplayKey | null; hash: number } {
  const s = createPlay(src.setup);
  let snap = -1;
  let whistle = -1;
  for (const f of src.frames) {
    stepPlay(s, f);
    if (snap < 0 && s.phase !== 'presnap') snap = s.tick;
    if (whistle < 0 && s.result) whistle = s.tick;
  }
  return { snap, whistle, key: keyMoment(s), hash: hashPlay(s) };
}

/**
 * A replay being watched: the play rebuilt and stepped through its recorded
 * inputs, with play/pause, speeds, scrubbing and the director's slow motion
 * through a flagged moment. `runner` is what the scene draws (the same
 * interface as the live play's); `epoch` changes whenever it's rebuilt (the
 * scene sets every body again); `target` is a scrub's destination, which the
 * scene steps to (stepTicks) animating as it goes.
 */
export class ReplayPlayer {
  readonly setup: PlaySetup;
  readonly frames: readonly InputFrame[];
  /** The window: from a beat before the snap to the last recorded tick. */
  readonly start: number;
  readonly end: number;
  readonly snapTick: number;
  readonly whistleTick: number;
  readonly key: ReplayKey | null;
  /** The replay's final state hash, and whether it matches the original's (a source without one counts as matching). */
  readonly hash: number;
  readonly verified: boolean;
  runner: SimRunner;
  epoch = 0;
  target = -1;
  playing = true;
  /** The user's speed (SPEEDS). */
  speed = 1;
  /** The director's slow motion through the key moment is on (until the user takes the speed or the scrub). */
  director = false;

  /** `lead`: ticks of the window before the snap (the Beasts' drive montage opens on a longer look at the offense set). */
  constructor(src: ReplaySource, lead = LEAD_TICKS) {
    this.setup = src.setup;
    this.frames = src.frames;
    const a = analyze(src);
    this.snapTick = a.snap;
    this.whistleTick = a.whistle;
    this.key = a.key;
    this.hash = a.hash;
    this.verified = src.hash === undefined || src.hash === a.hash;
    this.end = src.frames.length;
    this.start = a.snap >= 0 ? Math.max(0, a.snap - lead) : 0;
    this.runner = this.build(this.start);
  }

  /** Ticks stepped so far (the replay's clock). */
  get tick(): number {
    return this.runner.frames.length;
  }

  /** A scrub is still on its way to its target (the scene steps it there). */
  get seeking(): boolean {
    return this.target > this.tick;
  }

  get atEnd(): boolean {
    return this.tick >= this.end;
  }

  /** The play rebuilt and stepped silently to `to` (events up to it already seen). */
  private build(to: number): SimRunner {
    const r = new SimRunner(createPlay(this.setup));
    while (r.frames.length < to) r.step(this.frames[r.frames.length]!);
    r.drainEvents();
    r.showLatest();
    this.epoch++;
    return r;
  }

  /** Go to a tick: on from here, or back to the window's start and on from there. */
  seek(t: number): void {
    const to = Math.max(this.start, Math.min(this.end, Math.round(t)));
    if (to < this.tick) this.runner = this.build(this.start);
    this.target = to > this.tick ? to : -1;
  }

  /** Step up to n ticks toward the target (the scene's catch-up). Returns the ticks stepped. */
  stepTicks(n: number): number {
    const stop = Math.min(this.end, this.target >= 0 ? this.target : this.end);
    let k = 0;
    while (k < n && this.tick < stop) {
      this.runner.step(this.frames[this.tick]!);
      k++;
    }
    if (this.target >= 0 && this.tick >= this.target) this.target = -1;
    if (k) this.runner.showLatest();
    return k;
  }

  /** The speed now: the director's through the key moment, else the user's. */
  rate(): number {
    return this.director && this.key ? directorSpeed(this.tick - this.key.tick) : this.speed;
  }

  /** Play on by a frame's real time (nothing while a scrub is under way or paused). */
  frame(dt: number): void {
    if (this.seeking || !this.playing) return;
    if (this.atEnd) {
      this.playing = false;
      return;
    }
    this.runner.timeScale = this.rate();
    this.runner.advance(dt, () => this.frames[this.tick]!, this.end);
    if (this.atEnd) this.playing = false;
  }

  // ---- The transport (the user's controls) -------------------------------------------

  togglePlay(): void {
    if (!this.playing && this.atEnd) this.seek(this.start);
    this.playing = !this.playing;
  }

  /** The next speed (1×, 0.5×, 0.25×); the director's slow motion hands over. */
  cycleSpeed(): void {
    const i = SPEEDS.indexOf(this.speed as (typeof SPEEDS)[number]);
    this.speed = SPEEDS[(i + 1) % SPEEDS.length]!;
    this.director = false;
  }

  scrub(ticks: number): void {
    this.director = false;
    this.seek(this.tick + ticks);
  }

  /** A frame on or back, paused there. */
  stepFrame(dir: 1 | -1): void {
    this.playing = false;
    this.scrub(dir * FRAME_TICKS);
  }

  toStart(): void {
    this.director = false;
    this.seek(this.start);
  }

  /** Just before the key moment (or the snap), playing into it in the director's slow motion. */
  toKey(): void {
    const k = this.key ? this.key.tick : this.snapTick;
    this.seek(k - KEY_JUMP);
    this.director = !!this.key;
    this.playing = true;
  }

  /** Where a scrub bar position (0–1 of the window) is, in ticks. */
  tickAt(frac: number): number {
    return this.start + (this.end - this.start) * Math.min(1, Math.max(0, frac));
  }

  /** The window position (0–1) of a tick. */
  fracOf(tick: number): number {
    return this.end > this.start ? (tick - this.start) / (this.end - this.start) : 0;
  }
}
