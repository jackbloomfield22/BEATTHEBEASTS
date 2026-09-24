// The Practice Field's free play (GDD §4): pick a play and a situation, snap,
// play it out against the Beasts, see the result, go again. The session owns
// the sim runner and the input contexts; React reads a small store that
// changes only when the stage, the phase or the situation does (TECH_PLAN
// §4.3: React never drives per-frame logic).

import { create } from 'zustand';
import { Input } from '@/input/InputManager';
import type { InputContext } from '@/input/actions';
import { createPlay, DEAD_HOLD, DEF_CALLS, defById, playById, PLAYS, type CatchType, type DefSlot, type Difficulty, type OffSlot, type Phase, type SimPlayer } from '@/sim';
import { Controls } from './controls';
import { describe, type ResultCard } from './describe';
import { loadPracticeRosters } from './rosters';
import { SimRunner } from './runner';
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
  result: null,
  lastCover: null,
  seriesOver: false,
  error: null,
}));

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
  private resuming = false;
  private stageBeforePause: PracticeStage = 'presnap';
  /** The situation of the last snap (Run It Back replays from here). */
  private lastSit: Situation = startSituation(0, 0);
  /** Bumped whenever a new play is set up (the render re-reads the runner). */
  playId = 0;

  /** Enter the Practice Field: load the rosters, open the play call. */
  async enter(seed?: number): Promise<void> {
    this.seedBase = seed ?? (Math.random() * 0x7fffffff) | 0;
    this.snaps = 0;
    set({ stage: 'loading', result: null, error: null });
    this.offPause ??= Input.onAction((id, info) => {
      if (id !== 'global.pause' || info.repeat) return;
      const st = get().stage;
      // The same Esc that just resumed (menu.back fires first) doesn't pause again.
      if ((st === 'presnap' || st === 'live') && !this.resuming) this.pause();
    });
    try {
      this.rosters ??= await loadPracticeRosters();
      set({ stage: 'call', situation: startSituation(get().startSpot, get().startDowns) });
    } catch (e) {
      set({ error: `The rosters didn't load (${(e as Error).message}).` });
    }
  }

  leave(): void {
    this.setContext(null);
    this.offPause?.();
    this.offPause = null;
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
    set({ stage: 'presnap', playId, situation: sit, playSit: sit, phase: 'presnap', carrier: null, result: null, lastCover: def.name, seriesOver: false });
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
    this.runner!.advance(dt, () => {
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
    if (s.result && get().stage === 'live' && s.t - s.whistleT >= DEAD_HOLD) {
      const ui = get();
      const next = nextSituation(ui.situation, s.result, s.carrier >= 0 ? s.agents[s.carrier]!.pos.y : s.ball.pos.y);
      this.setContext(null);
      set({ stage: 'result', result: describe(s), situation: next ?? startSituation(ui.startSpot, ui.startDowns), seriesOver: next === null });
    }
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
