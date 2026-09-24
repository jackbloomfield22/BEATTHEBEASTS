// The Practice Field's free play (GDD §4): pick a play and a situation, snap,
// play it out against the Beasts, see the result, go again. The session owns
// the sim runner and the input contexts; React reads a small store that
// changes only when the stage, the phase or the situation does (TECH_PLAN
// §4.3: React never drives per-frame logic).

import { create } from 'zustand';
import { Input } from '@/input/InputManager';
import { loadJSON, saveJSON } from '@/app/storage';
import type { InputContext } from '@/input/actions';
import { createPlay, DEAD_HOLD, DEF_CALLS, HOT_ROUTES, type RouteName, defById, playById, PLAYS, type CatchType, type DefSlot, type Difficulty, type OffSlot, type Phase, type PlayState, type SimPlayer } from '@/sim';
import { Controls } from './controls';
import { describe, type ResultCard } from './describe';
import { loadPracticeRosters } from './rosters';
import { SimRunner } from './runner';
import { routeOf } from '@/sim/ai';
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

class PracticeSession {
  runner: SimRunner | null = null;
  rosters: { offense: Record<OffSlot, SimPlayer>; defense: Record<DefSlot, SimPlayer> } | null = null;
  readonly controls = new Controls();
  difficulty: Difficulty = 'pro';
  private ctxPop: (() => void) | null = null;
  private ctx: InputContext | null = null;
  private seedBase = 0;
  private snaps = 0;
  private offPause: (() => void) | null = null;
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
  private sawAir = false;

  /** Enter the Practice Field: load the rosters, open the play call. */
  async enter(seed?: number): Promise<void> {
    this.seedBase = seed ?? (Math.random() * 0x7fffffff) | 0;
    this.snaps = 0;
    this.firstCatch = true;
    set({ stage: 'loading', result: null, error: null });
    this.offPause ??= Input.onAction((id, info) => {
      if (id !== 'global.pause' || info.repeat) return;
      const st = get().stage;
      // The same Esc that just resumed (menu.back fires first) doesn't pause again.
      if ((st === 'presnap' || st === 'live') && !this.resuming) this.pause();
    });
    this.offHot ??= Input.onAction((id, info) => {
      if (!info.repeat) this.onHot(id, info.device);
    });
    try {
      this.rosters ??= await loadPracticeRosters();
      set({ stage: 'call', situation: startSituation(get().startSpot, get().startDowns) });
    } catch (e) {
      set({ error: `The rosters didn't load (${(e as Error).message}).` });
    }
  }

  leave(): void {
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
    const def = ui.cover === 'random' ? DEF_CALLS[(seed >>> 4) % DEF_CALLS.length]! : defById(ui.cover);
    const sit = ui.seriesOver ? startSituation(ui.startSpot, ui.startDowns) : ui.situation;
    this.closeHot();
    const state = createPlay({
      seed,
      offense: this.rosters.offense,
      defense: this.rosters.defense,
      play: playById(playId),
      def,
      los: sit.los,
      ballY: sit.ballY,
      toGo: sit.toGo,
      user: true,
      difficulty: this.difficulty,
    });
    this.runner = new SimRunner(state);
    this.lastSit = sit;
    this.playId++;
    this.controls.clear();
    this.setContext('preSnap');
    this.readSince = -1;
    this.sawAir = false;
    set({ stage: 'presnap', playId, situation: sit, playSit: sit, phase: 'presnap', carrier: null, result: null, lastCover: def.name, seriesOver: false, tutorial: this.tutorialNext ? 'snap' : null });
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
    // The session's first catch: ease the play down while the ball is in the air, and back up after.
    const slow = this.firstCatch && r.state.phase === 'air';
    r.timeScale += ((slow ? FIRST_CATCH_SPEED : 1) - r.timeScale) * (1 - Math.exp(-dt * 10));
    if (Math.abs(r.timeScale - 1) < 1e-3) r.timeScale = 1;
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
    if (s.phase === 'air') this.sawAir = true;
    else if (this.sawAir) this.firstCatch = false;
    this.stepTutorial(s);
    if (s.result && get().stage === 'live' && s.t - s.whistleT >= DEAD_HOLD) {
      const ui = get();
      const next = nextSituation(ui.situation, s.result, s.carrier >= 0 ? s.agents[s.carrier]!.pos.y : s.ball.pos.y);
      this.setContext(null);
      set({ stage: 'result', result: describe(s), situation: next ?? startSituation(ui.startSpot, ui.startDowns), seriesOver: next === null });
    }
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
    // The browser half of the determinism check (e2e/practice.spec.ts).
    __btbSimHashes: async () => (await import('./determinism')).simHashes(await loadPracticeRosters()),
  });
}
