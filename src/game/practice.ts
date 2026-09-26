// The Practice Field's free play (GDD §4): pick a play and a situation, snap,
// play it out against the Beasts, see the result, go again. The session owns
// the sim runner and the input contexts; React reads a small store that
// changes only when the stage, the phase or the situation does (TECH_PLAN
// §4.3: React never drives per-frame logic).

import { create } from 'zustand';
import { Input } from '@/input/InputManager';
import { loadJSON, saveJSON } from '@/app/storage';
import type { InputContext } from '@/input/actions';
import { createPlay, defenseFor, offenseFor, type BeastsDefense, type ContendersRoster, DEAD_HOLD, DEF_CALLS, HOT_ROUTES, type DefCall, type InputFrame, type RouteName, defById, playById, PLAYS, type CatchType, type DefSlot, type Difficulty, type OffSlot, type Phase, type PlayResult, type PlayState, type SimPlayer } from '@/sim';
import { getSettings } from '@/app/settings';
import { Controls } from './controls';
import { describe, type ResultCard } from './describe';
import { loadPracticeRosters } from './rosters';
import { SimRunner } from './runner';
import type { Clip } from './clips';
import { routeOf } from '@/sim/ai';
import type { OffPlay } from '@/sim/plays';
import { detectSynergies } from '@/engine/ratings/traits/synergies';
import type { RatedPos } from '@/engine/ratings/types';

/** QB–receiver chemistry (M6.5 #6): a passing synergy on the roster starts it here; each throw to him in a game adds this; it tops out at 1. */
const CHEM_SYNERGY = 0.3;
const CHEM_PER_TARGET = 0.07;
import { nextSituation, startSituation, type Situation } from './situation';

export type PracticeStage = 'loading' | 'call' | 'presnap' | 'live' | 'result' | 'paused';

export interface PracticeUi {
  stage: PracticeStage;
  /** Where the next (or current) snap is. */
  situation: Situation;
  /** The situation of the snap on the field now (the score bug shows it until the next snap). */
  playSit: Situation;
  /** Start choices (indices into START_SPOTS / START_DOWNS) and the coverage choice. */
  startSpot: number;
  startDowns: number;
  cover: 'random' | string;
  playId: string;
  phase: Phase;
  /** The user's ball carrier (offense) or null. */
  carrier: string | null;
  /** The QB has tucked it and is scrambling (he can still throw until the line). */
  scrambling: boolean;
  /** The session's box score. */
  box: BoxScore;
  /** The catch the user called while the ball is in the air (null = none yet). */
  catchType: CatchType | null;
  /** The first-play tutorial's step, or null when it's off (done once, or skipped). */
  tutorial: TutorialStep | null;
  /** The hot-route picker, when open: choosing the receiver, then his route. */
  hot: HotPicker | null;
  result: ResultCard | null;
  /** The coverage the Beasts played on the last snap (revealed with the result). */
  lastCover: string | null;
  /** The series ended on the last play; the next snap restarts from the chosen start. */
  seriesOver: boolean;
  error: string | null;
}

export const usePractice = create<PracticeUi>(() => ({
  stage: 'loading',
  situation: startSituation(0, 0),
  playSit: startSituation(0, 0),
  startSpot: 0,
  startDowns: 0,
  cover: 'random',
  playId: PLAYS[0]!.id,
  phase: 'presnap',
  carrier: null,
  scrambling: false,
  box: emptyBox(),
  catchType: null,
  tutorial: null,
  hot: null,
  result: null,
  lastCover: null,
  seriesOver: false,
  error: null,
}));

/**
 * The first-play tutorial (M5.5): one pass through snap, read, throw, catch
 * and run on the first Practice Field play, then never again unless asked
 * for (pause menu). Each step shows while it applies and moves on with the
 * play; it never waits for the player.
 */
export type HotPicker = { stage: 'receiver' } | { stage: 'route'; icon: number; focus: number };

export type TutorialStep = 'snap' | 'read' | 'throw' | 'catch' | 'run';
const TUTORIAL_KEY = 'practice.tutorialDone';
/** Seconds of the read step before it hands to the throw step (sooner if he picks a receiver). */
const READ_STEP = 1.6;
/**
 * The session's first catch plays at this speed (the ball's flight and the
 * catch), so the catch buttons register before they're second nature. The
 * speed eases in and out rather than cutting.
 */
const FIRST_CATCH_SPEED = 0.6;

const set = (p: Partial<PracticeUi>) => usePractice.setState(p);

/** The practice session's box score (the offense's side). */
export interface BoxScore {
  plays: number;
  yards: number;
  att: number;
  comp: number;
  passYds: number;
  rushes: number;
  rushYds: number;
  sacks: number;
  turnovers: number;
  /** Big hits the Beasts put on you. */
  bigHits: number;
}
export function emptyBox(): BoxScore {
  return { plays: 0, yards: 0, att: 0, comp: 0, passYds: 0, rushes: 0, rushYds: 0, sacks: 0, turnovers: 0, bigHits: 0 };
}

function addToBox(b: BoxScore, r: PlayResult): BoxScore {
  const n = { ...b, plays: b.plays + 1 };
  const y = r.offenseBall ? r.yards : 0;
  n.yards += y;
  if (r.sack) n.sacks++;
  if (r.pass?.attempted) {
    n.att++;
    if (r.pass.complete && !r.pass.intercepted) {
      n.comp++;
      n.passYds += y;
    }
  } else if (!r.sack) {
    n.rushes++;
    n.rushYds += y;
  }
  if (!r.offenseBall) n.turnovers++;
  if (r.bigHit) n.bigHits++;
  return n;
}

/**
 * A big hit's toll (feedback item 5): the man who took it starts the next
 * play down this much stamina (by the hit's force), and gets half of it
 * back each play after.
 */
const hitToll = (force: number) => Math.min(0.45, 0.15 + force * 0.02);
/** Hit-stop on a big hit (wall-clock s at ~5% speed), and the slow motion on the biggest (force ≥ 9) if it's on. */
const HIT_STOP = 0.09;
const SLOWMO = { force: 9, secs: 0.8, speed: 0.35 };
const get = () => usePractice.getState();

function contextFor(phase: Phase, userCarrier: boolean): InputContext {
  switch (phase) {
    case 'presnap':
      return 'preSnap';
    case 'snap':
    case 'dropback':
    case 'pocket':
      return 'pocket';
    case 'air':
    case 'loose':
      return 'ballInAir';
    case 'carrier':
      return userCarrier ? 'carrier' : 'ballInAir';
    default:
      return 'preSnap';
  }
}

/** A full game drives the play engine through these (src/game/game.ts). */
export interface GameHooks {
  /** Where the next snap is. */
  situation(): Situation;
  /** The Beasts' call for this snap. */
  defCall(sit: Situation, seed: number): DefCall;
  /** A snap's whistle: the game scores it and says where the next snap is. */
  onResult(s: PlayState, r: PlayResult, endY: number): { next: Situation; over: boolean };
  /** Each tick of a snap, before it steps (read-only: the box score's coverage snapshot). */
  onTick?(s: PlayState): void;
}

type Rosters = { offense: Record<OffSlot, SimPlayer>; defense: Record<DefSlot, SimPlayer> };

class PracticeSession {
  /** Set while a full game is on (null on the Practice Field). */
  game: GameHooks | null = null;
  /**
   * The two teams as squads: the offense's personnel groupings (each play
   * lines up its own eleven: an FB or a second TE comes on in I-Form and
   * Heavy) and the Beasts' sub packages (the nickel and dime come on for the
   * call). `rosters` stays the base eleven the render builds bodies from.
   */
  teams: { team: ContendersRoster; beasts: BeastsDefense } | null = null;
  /** The offense's uniform: the classic line-up's Royal on the Practice Field, the Contenders' Blackout Lime in a game. */
  offenseKit = 'royal';
  runner: SimRunner | null = null;
  rosters: Rosters | null = null;
  readonly controls = new Controls();
  difficulty: Difficulty = 'pro';
  private ctxPop: (() => void) | null = null;
  private ctx: InputContext | null = null;
  private seedBase = 0;
  private snaps = 0;
  private offPause: (() => void) | null = null;
  private customRosters = false;
  private offHot: (() => void) | null = null;
  private resuming = false;
  private stageBeforePause: PracticeStage = 'presnap';
  /** The situation of the last snap (Run It Back replays from here). */
  private lastSit: Situation = startSituation(0, 0);
  /** Bumped whenever a new play is set up (the render re-reads the runner). */
  playId = 0;
  /** The tutorial runs on the next play. */
  private tutorialNext = !loadJSON<boolean>(TUTORIAL_KEY);
  private readSince = -1;
  private hotPop: (() => void) | null = null;
  /** The route art stays up this long after a hot route is called (performance.now() ms). */
  routeFlashUntil = 0;
  /** The session's first catch is still to come (it plays slowed). */
  private firstCatch = true;
  /** Stamina each offensive player is down going into the next play (a big hit's toll). */
  private fatigue: Partial<Record<OffSlot, number>> = {};
  /** Throws to each receiver (by player id) this game: QB–receiver chemistry builds with them (M6.5 #6). */
  private targets: Record<string, number> = {};
  /** Sim events already looked at this play (for the hit-stop). */
  private seenEvents = 0;
  private hitStop = 0;
  private slowmo = 0;
  private sawAir = false;

  /** Enter the Practice Field: load the rosters, open the play call. */
  async enter(seed?: number, opts: { rosters?: Rosters; teams?: { team: ContendersRoster; beasts: BeastsDefense }; game?: GameHooks } = {}): Promise<void> {
    this.seedBase = seed ?? (Math.random() * 0x7fffffff) | 0;
    this.game = opts.game ?? null;
    // A game brings its own rosters; the Practice Field uses the classic line-up.
    if (opts.rosters) this.rosters = opts.rosters;
    else if (!this.game && this.customRosters) this.rosters = null;
    this.customRosters = !!opts.rosters;
    this.teams = opts.teams ?? null;
    this.offenseKit = this.game ? 'blackoutLime' : 'royal';
    this.snaps = 0;
    this.firstCatch = true;
    this.targets = {};
    set({ stage: 'loading', result: null, error: null });
    this.offPause ??= Input.onAction((id, info) => {
      // In a game the game screen owns the pause (its menu can come up over a card too).
      if (id !== 'global.pause' || info.repeat || this.game) return;
      const st = get().stage;
      // The same Esc that just resumed (menu.back fires first) doesn't pause again.
      if ((st === 'presnap' || st === 'live') && !this.resuming) this.pause();
    });
    this.offHot ??= Input.onAction((id, info) => {
      if (!info.repeat) this.onHot(id, info.device);
    });
    try {
      if (!this.rosters || !this.teams) {
        const r = await loadPracticeRosters();
        this.rosters ??= r;
        if (!this.game) this.teams = { team: r.team, beasts: r.beasts };
      }
      set({ stage: 'call', situation: this.game ? this.game.situation() : startSituation(get().startSpot, get().startDowns), box: emptyBox() });
    } catch (e) {
      set({ error: `The rosters didn't load (${(e as Error).message}).` });
    }
  }

  leave(): void {
    this.game = null;
    this.closeHot();
    this.setContext(null);
    this.offPause?.();
    this.offPause = null;
    this.offHot?.();
    this.offHot = null;
    this.runner = null;
    this.playId++;
    this.controls.clear();
    set({ stage: 'loading', result: null });
  }

  /** Line up a play at the current situation (the offense sets, waiting for the snap). */
  callPlay(playId: string): void {
    if (!this.rosters) return;
    const ui = get();
    const seed = (this.seedBase + this.snaps * 7919) | 0;
    this.snaps++;
    const g = this.game;
    const sit = g ? g.situation() : ui.seriesOver ? startSituation(ui.startSpot, ui.startDowns) : ui.situation;
    const def = g ? g.defCall(sit, seed) : ui.cover === 'random' ? DEF_CALLS[(seed >>> 4) % DEF_CALLS.length]! : defById(ui.cover);
    this.setUp(playId, seed, def, sit);
  }

  /** A scripted clip's play (the feel videos): its seed, coverage and spot. Step it with tickWith. */
  callClip(c: Clip): void {
    set({ playId: c.play });
    this.setUp(c.play, c.seed, defById(c.def), { ...startSituation(0, 0), los: c.los, ballY: 0, toGo: 10, down: 1 }, true);
    // Held until the script steps it: time before the snap changes the play
    // (the concept videos: pre-snap ticks run while the page loaded took the
    // go route from a 48-yard catch to a drop), and Node snaps on tick 0.
    if (this.runner) this.runner.paused = true;
  }

  /** Step one tick with a given input (a scripted clip), through the same path as tick(). */
  tickWith(inp: InputFrame): void {
    if (!this.live()) return;
    this.sync();
    this.runner!.step(inp);
    this.sync();
  }

  /**
   * QB–receiver chemistry for this play's receivers (M6.5 #6): 0.3 for a
   * pair with a passing synergy on the roster (Timing Offense, Moonball,
   * Throw It Up, Pitch and Catch), plus 0.07 a throw to him this game, to 1.
   */
  private chemistry(play: OffPlay): Partial<Record<OffSlot, number>> {
    const off = this.teams ? offenseFor(play, this.teams.team) : this.rosters?.offense;
    if (!off) return {};
    const qb = off.QB;
    const recs = (['X', 'Z', 'SLOT', 'TE', 'RB'] as const).filter((k) => off[k]);
    const hits = detectSynergies({ players: [qb, ...recs.map((k) => off[k])].map((p) => ({ id: p.id, pos: p.pos as RatedPos, traits: p.traits ?? [] })) });
    const passing = new Set(['pass.deepError', 'route.breakSeparation', 'catch.contested', 'catch.thirdDown']);
    const out: Partial<Record<OffSlot, number>> = {};
    for (const k of recs) {
      const p = off[k];
      const syn = hits.some((h) => passing.has(h.synergy.effect.key) && ((h.a.id === qb.id && h.b.id === p.id) || (h.b.id === qb.id && h.a.id === p.id)));
      const c = (syn ? CHEM_SYNERGY : 0) + CHEM_PER_TARGET * (this.targets[p.id] ?? 0);
      if (c > 0) out[k] = Math.min(1, c);
    }
    return out;
  }

  /** `clip`: a scripted clip's play, set up exactly as Node finds it (createPlay's defaults: no chemistry, fatigue or difficulty from this session). */
  private setUp(playId: string, seed: number, def: DefCall, sit: Situation, clip = false): void {
    if (!this.rosters) return;
    this.closeHot();
    const play = playById(playId);
    const state = createPlay({
      seed,
      offense: this.teams ? offenseFor(play, this.teams.team) : this.rosters.offense,
      defense: this.teams ? defenseFor(def, this.teams.beasts) : this.rosters.defense,
      play,
      // The Touch pass hold setting: how long a receiver key is held before a driven ball becomes touch.
      tapMax: clip ? undefined : getSettings().controls.bulletHoldMs / 1000,
      def,
      los: sit.los,
      ballY: sit.ballY,
      toGo: sit.toGo,
      user: true,
      difficulty: clip ? undefined : this.difficulty,
      fatigue: clip ? undefined : { ...this.fatigue },
      chem: clip ? undefined : this.chemistry(play),
      down: sit.down,
    });
    this.runner = new SimRunner(state);
    this.seenEvents = 0;
    this.hitStop = 0;
    this.slowmo = 0;
    this.lastSit = sit;
    this.playId++;
    this.controls.clear();
    this.setContext('preSnap');
    this.readSince = -1;
    this.sawAir = false;
    set({ stage: 'presnap', playId, situation: sit, playSit: sit, phase: 'presnap', carrier: null, scrambling: false, result: null, lastCover: def.name, seriesOver: false, tutorial: this.tutorialNext ? 'snap' : null });
  }

  /**
   * The hot-route picker (pre-snap): the hot-route key opens it; a
   * receiver's number picks him; a route's number (or up/down and confirm)
   * calls it. The call goes to the sim with the next tick, so a replay has it.
   */
  private onHot(id: string, device: string): void {
    const ui = get();
    if (ui.stage !== 'presnap' || !this.runner) return;
    const s = this.runner.state;
    const hot = ui.hot;
    if (!hot) {
      if (id === 'preSnap.hotRoute') {
        this.hotPop = Input.pushContext('hotRoute');
        set({ hot: { stage: 'receiver' } });
      }
      return;
    }
    if (id === 'hot.cancel') return this.closeHot();
    const n = id.startsWith('hot.n') ? Number(id.slice(5)) : 0;
    if (hot.stage === 'receiver') {
      if (n >= 1 && n <= s.icons.length) {
        const cur = routeOf(s, s.agents[s.icons[n - 1]!]!);
        set({ hot: { stage: 'route', icon: n, focus: Math.max(0, HOT_ROUTES.indexOf(cur as RouteName)) } });
      }
      return;
    }
    const pad = device === 'gamepad';
    if (id === 'hot.up' || id === 'hot.down') {
      const k = HOT_ROUTES.length;
      set({ hot: { ...hot, focus: (hot.focus + (id === 'hot.up' ? k - 1 : 1)) % k } });
    } else if (id === 'hot.confirm' || (pad && n === 1)) this.callHot(hot.icon, HOT_ROUTES[hot.focus]!);
    else if (pad && n === 2) set({ hot: { stage: 'receiver' } });
    else if (!pad && n >= 1 && n <= HOT_ROUTES.length) this.callHot(hot.icon, HOT_ROUTES[n - 1]!);
  }

  /** A route clicked in the picker. */
  pickHot(icon: number, route: RouteName): void {
    if (get().hot) this.callHot(icon, route);
  }

  private callHot(icon: number, route: RouteName): void {
    this.controls.queueHot(icon, route);
    this.routeFlashUntil = performance.now() + 1600;
    this.closeHot();
  }

  closeHot(): void {
    this.hotPop?.();
    this.hotPop = null;
    if (get().hot) set({ hot: null });
  }

  /** Stop the tutorial now and don't show it again. */
  skipTutorial(): void {
    this.tutorialNext = false;
    saveJSON(TUTORIAL_KEY, true);
    set({ tutorial: null });
  }

  /** Show the tutorial again on the next play. */
  replayTutorial(): void {
    this.tutorialNext = true;
  }

  get tutorialPending(): boolean {
    return this.tutorialNext;
  }

  /** Run the same play again from the same spot (a new seed). */
  runItBack(): void {
    set({ situation: this.lastSit, seriesOver: false });
    this.callPlay(get().playId);
  }

  /** From the result: to the play call at the next spot. */
  nextPlay(): void {
    this.setContext(null);
    set({ stage: 'call', result: null });
  }

  pause(): void {
    if (!this.runner) return;
    this.closeHot();
    this.stageBeforePause = get().stage;
    this.runner.paused = true;
    this.setContext(null);
    set({ stage: 'paused' });
  }

  resume(): void {
    if (!this.runner) return;
    this.resuming = true;
    queueMicrotask(() => (this.resuming = false));
    this.runner.paused = false;
    this.controls.clear();
    set({ stage: this.stageBeforePause });
    this.syncContext(true);
  }

  /** Back to the play call from a pause, at the same situation. */
  abandon(): void {
    this.runner = null;
    this.playId++;
    this.setContext(null);
    set({ stage: 'call', result: null });
  }

  /** Each rendered frame: advance the sim and move the UI along. */
  frame(dt: number): void {
    if (!this.live()) return;
    // The UI and the input context follow the play tick by tick (a frame can
    // step several ticks: a catch and the carrier's first move can land in one).
    const r = this.runner!;
    // The session's first catch, if it's switched on (off by default: the play must never hitch at the catch).
    const slow = this.firstCatch && getSettings().gameplay.firstCatchSlowmo && r.state.phase === 'air';
    // A big hit: a beat of hit-stop, then (the biggest, if it's on) a moment of slow motion.
    for (; this.seenEvents < r.state.events.length; this.seenEvents++) {
      const e = r.state.events[this.seenEvents]!;
      if (e.type !== 'hit' || !e.data?.big) continue;
      this.hitStop = HIT_STOP;
      if (getSettings().gameplay.bigHitSlowmo && Number(e.data.force ?? 0) >= SLOWMO.force) this.slowmo = SLOWMO.secs;
    }
    if (this.hitStop > 0) {
      this.hitStop -= dt;
      r.timeScale = 0.05;
    } else {
      if (this.slowmo > 0) this.slowmo -= dt;
      const want = this.slowmo > 0 ? SLOWMO.speed : slow ? FIRST_CATCH_SPEED : 1;
      r.timeScale += (want - r.timeScale) * (1 - Math.exp(-dt * 10));
      if (Math.abs(r.timeScale - 1) < 1e-3) r.timeScale = 1;
    }
    r.advance(dt, () => {
      this.sync();
      return this.controls.sample();
    });
    this.sync();
  }

  /** Step ticks directly (browser tests and the dev console), through the same path as frames. */
  tick(n: number): void {
    for (let k = 0; k < n && this.live(); k++) {
      this.sync();
      this.runner!.step(this.controls.sample());
    }
    this.sync();
  }

  private live(): boolean {
    const r = this.runner;
    const stage = get().stage;
    if (!r || stage === 'paused' || stage === 'call' || stage === 'loading') return false;
    // After the result card is up, the dead ball settles for a few more seconds, then holds.
    return !(stage === 'result' && r.state.t - r.state.whistleT > DEAD_HOLD + 4);
  }

  private sync(): void {
    const s = this.runner!.state;
    const stage = get().stage;
    if (s.phase !== get().phase) {
      const c = s.carrier >= 0 ? s.agents[s.carrier]! : null;
      set({ phase: s.phase, stage: s.phase === 'presnap' ? 'presnap' : stage === 'result' ? 'result' : 'live', carrier: c && c.side === 'off' ? c.p.name : null });
      this.syncContext(false);
    }
    if (s.catchType !== get().catchType) set({ catchType: s.catchType });
    if (s.scrambleT >= 0 !== get().scrambling) set({ scrambling: s.scrambleT >= 0 });
    if (s.phase === 'air') this.sawAir = true;
    else if (this.sawAir) this.firstCatch = false;
    this.stepTutorial(s);
    this.game?.onTick?.(s);
    if (s.result && get().stage === 'live' && s.t - s.whistleT >= DEAD_HOLD) this.report();
  }

  /**
   * A paused snap whose whistle has already blown (the dead-ball hold was
   * still running): score it now, as if the hold had run out. Leaving a game
   * from the pause menu after the last play's whistle ends it properly.
   * True if there was one.
   */
  settle(): boolean {
    const s = this.runner?.state;
    if (!s?.result || (get().stage !== 'paused' && get().stage !== 'live') || this.reported === this.playId) return false;
    if (get().stage === 'paused') {
      this.runner!.paused = false;
      set({ stage: 'live' });
    }
    this.report();
    return true;
  }

  /** The whistle's result goes to the game (or the practice series) and the result card. */
  private reported = -1;
  private report(): void {
    const s = this.runner!.state;
    if (!s.result || this.reported === this.playId) return;
    this.reported = this.playId;
    const ui = get();
    const endY = s.carrier >= 0 ? s.agents[s.carrier]!.pos.y : s.ball.pos.y;
    const g = this.game ? this.game.onResult(s, s.result, endY) : null;
    const next = g ? (g.over ? null : g.next) : nextSituation(ui.situation, s.result, endY);
    this.setContext(null);
    // Fatigue for the next play: last play's toll recovers by half; a big hit adds his.
    const f: Partial<Record<OffSlot, number>> = {};
    for (const [k, v] of Object.entries(this.fatigue)) if (v && v / 2 > 0.02) f[k as OffSlot] = v / 2;
    const bh = s.result.bigHit;
    if (bh && s.agents[bh.on]!.side === 'off') {
      const slot = s.agents[bh.on]!.slot as OffSlot;
      f[slot] = Math.min(0.6, (f[slot] ?? 0) + hitToll(bh.force));
    }
    this.fatigue = f;
    // Chemistry: every throw to a receiver counts toward his timing with the QB.
    const tgt = s.ball.target;
    if (s.pass?.attempted && tgt >= 0 && s.agents[tgt]!.side === 'off') {
      const id = s.agents[tgt]!.p.id;
      this.targets[id] = (this.targets[id] ?? 0) + 1;
    }
    set({ stage: 'result', result: describe(s), situation: next ?? (g ? g.next : startSituation(ui.startSpot, ui.startDowns)), seriesOver: next === null, box: addToBox(ui.box, s.result) });
  }

  private stepTutorial(s: PlayState): void {
    if (s.phase !== 'presnap' && get().hot) this.closeHot();
    const step = get().tutorial;
    if (!step) return;
    let next: TutorialStep | null = step;
    const pocket = s.phase === 'snap' || s.phase === 'dropback' || s.phase === 'pocket';
    const c = s.carrier >= 0 ? s.agents[s.carrier]! : null;
    if (s.result) {
      // The play is over: the tutorial has done its one pass.
      this.skipTutorial();
      return;
    }
    if (pocket && step === 'snap') {
      next = 'read';
      this.readSince = s.t;
    } else if (pocket && step === 'read' && (s.t - this.readSince > READ_STEP || this.controls.heldIcon)) next = 'throw';
    else if (s.phase === 'air') next = 'catch';
    else if (s.phase === 'carrier' && c?.side === 'off') next = 'run';
    if (next !== step) set({ tutorial: next });
  }

  private syncContext(force: boolean): void {
    const s = this.runner?.state;
    const st = get().stage;
    if (!s || st === 'paused' || st === 'result' || st === 'call') return;
    const c = s.carrier >= 0 ? s.agents[s.carrier]! : null;
    const want = contextFor(s.phase, !!c && c.side === 'off');
    if (force || want !== this.ctx) this.setContext(want);
  }

  private setContext(ctx: InputContext | null): void {
    this.ctxPop?.();
    this.ctxPop = ctx ? Input.pushContext(ctx) : null;
    this.ctx = ctx;
  }
}

export const practice = new PracticeSession();

if (import.meta.env.DEV) {
  Object.assign(globalThis, {
    __btbPractice: practice,
    __btbPracticeUi: usePractice,
    __btbInput: Input,
    __btbClips: async () => {
      const m = await import('./clips');
      return [...m.CLIPS, ...m.CONCEPTS];
    },
    // The browser half of the determinism check (e2e/practice.spec.ts).
    __btbSimHashes: async () => (await import('./determinism')).simHashes(await loadPracticeRosters()),
  });
}
