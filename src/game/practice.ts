// The Practice Field's free play (GDD §4): pick a play and a situation, snap,
// play it out against the Beasts, see the result, go again. The session owns
// the sim runner and the input contexts; React reads a small store that
// changes only when the stage, the phase or the situation does (TECH_PLAN
// §4.3: React never drives per-frame logic).

import { create } from 'zustand';
import { Input } from '@/input/InputManager';
import { loadJSON, saveJSON } from '@/app/storage';
import type { InputContext } from '@/input/actions';
import { createPlay, defenseFor, offenseFor, type BeastsDefense, type ContendersRoster, DEAD_HOLD, DEF_CALLS, HOT_COLS, HOT_ROUTES, type DefCall, type InputFrame, type RouteName, defById, playById, PLAYS, type CatchType, type DefSlot, type Difficulty, type OffSlot, type Phase, type PlayResult, type PlayState, type SimPlayer } from '@/sim';
import { getSettings } from '@/app/settings';
import { Controls } from './controls';
import { describe, type ResultCard } from './describe';
import { loadPracticeRosters, loadSnapshot } from './rosters';
import { SimRunner } from './runner';
import { withSwap, type Clip } from './clips';
import { audiblePlay, audiblesFor, type AudibleKind } from './audible';
import { afterSnap, defenseSnaps, emptyFatigue, fatigueOf, freshLegs, type DriveFatigue, type Snap } from './fatigue';
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
  /** Play action, readable (Playtest 2): through the fake, how many linebackers bit on it (null: no fake on). */
  pa: { bit: number; lbs: boolean } | null;
  /** The audible picker is open (pre-snap, Playtest 2). */
  audible: boolean;
  /** The last audible's call, shown at the line until the snap (its play's name). */
  audibled: string | null;
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
  pa: null,
  audible: false,
  audibled: null,
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
/** Change of Pace's fresh legs: +3% top speed on his first two touches of a drive (the trait catalog's line). */
const FRESH_LEGS = 1.03;
/** Seconds the play-action call stays up after the fake ends (the drop out of it, while the linebackers recover). */
const PA_CALL_HOLD = 0.9;

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
  /**
   * The squad for this snap (M6.6: the depth chart's rotation, the change-of-pace
   * back on his downs). The formation's personnel grouping then fills the
   * eleven from it as always (sim/personnel.ts). Absent: `teams.team`.
   */
  squad?(play: OffPlay, sit: Situation): ContendersRoster;
  /** Which of the user's drives this is (it changes when a series ends): fatigue resets with a new one. */
  driveKey?(): number;
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
  /**
   * The offense's uniform: the Contenders' white and lime (M6.6, Playtest 1
   * decision 5), on the Practice Field too, so the kit you practise in is
   * the one you play in. The render checks it against the Beasts' (kitAgainst).
   */
  offenseKit = 'whiteLime';
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
  /** Stamina through the drive, by player (src/game/fatigue.ts). */
  private drive: DriveFatigue = emptyFatigue();
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
    this.offenseKit = 'whiteLime';
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

  /**
   * The pre-game picture (M6.6): both teams set at the spot, still, before
   * the first snap is called. Display only: the play never steps (the stage
   * stays 'call', so frame() leaves it alone), no input context is pushed
   * (no key can snap it), and it uses none of the game's seeds or streams.
   * The next callPlay (or abandon) replaces it.
   */
  showLineup(playId: string, def: DefCall, sit: Situation): void {
    if (!this.rosters || !this.teams) return;
    const play = playById(playId);
    const state = createPlay({ seed: 1, offense: offenseFor(play, this.teams.team), defense: defenseFor(def, this.teams.beasts), play, def, los: sit.los, ballY: sit.ballY, toGo: sit.toGo, user: true, down: sit.down });
    this.runner = new SimRunner(state);
    this.runner.paused = true;
    this.playId++;
    this.setContext(null);
    set({ stage: 'call', result: null, situation: sit, playSit: sit });
  }

  /** A scripted clip's play (the feel videos): its seed, coverage and spot. Step it with tickWith. */
  /** The classic line-up, kept while clips swap men in and out. */
  private clipTeams: { team: ContendersRoster; beasts: BeastsDefense } | null = null;

  async callClip(c: Clip): Promise<void> {
    set({ playId: c.play });
    this.clipTeams ??= this.teams;
    if (this.clipTeams) this.teams = c.swap ? withSwap(this.clipTeams, c.play, c.swap, await loadSnapshot()) : this.clipTeams;
    this.setUp(c.play, c.seed, defById(c.def), { ...startSituation(0, 0), los: c.los, ballY: 0, toGo: 10, down: 1 }, true, c.user ?? true);
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
  private chemistry(play: OffPlay, sit: Situation): Partial<Record<OffSlot, number>> {
    const off = this.teams ? offenseFor(play, this.squadFor(play, sit)) : this.rosters?.offense;
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

  /** The squad a snap draws its eleven from: the game's rotation, or the two teams as they are. */
  private squadFor(play: OffPlay, sit: Situation): ContendersRoster {
    return this.game?.squad?.(play, sit) ?? this.teams!.team;
  }

  /** `clip`: a scripted clip's play, set up exactly as Node finds it (createPlay's defaults: no chemistry, fatigue or difficulty from this session). */
  private setUp(playId: string, seed: number, def: DefCall, sit: Situation, clip = false, user = true): void {
    if (!this.rosters) return;
    this.closeHot();
    const play = playById(playId);
    const offense = this.teams ? offenseFor(play, this.squadFor(play, sit)) : this.rosters.offense;
    // The drive so far: what each man starts without, and a Change of Pace back's fresh legs.
    const fatigue: Partial<Record<OffSlot | DefSlot, number>> = {};
    const legs: Partial<Record<OffSlot, number>> = {};
    for (const [k, p] of Object.entries(offense) as [OffSlot, SimPlayer][]) {
      const f = fatigueOf(this.drive, p.id);
      if (f > 0) fatigue[k] = f;
      if (freshLegs(this.drive, p.id, p.traits ?? [])) legs[k] = FRESH_LEGS;
    }
    // (The Beasts wear through your drive too: fatigue.ts, Ground and Pound.)
    const defense = this.teams ? defenseFor(def, this.teams.beasts) : this.rosters.defense;
    for (const [k, p] of Object.entries(defense) as [DefSlot, SimPlayer][]) if (fatigueOf(this.drive, p.id) > 0) fatigue[k] = fatigueOf(this.drive, p.id);
    const state = createPlay({
      seed,
      offense,
      defense,
      play,
      // The Touch pass hold setting: how long a receiver key is held before a driven ball becomes touch.
      tapMax: clip ? undefined : getSettings().controls.bulletHoldMs / 1000,
      def,
      los: sit.los,
      ballY: sit.ballY,
      toGo: sit.toGo,
      user,
      difficulty: clip ? undefined : this.difficulty,
      fatigue: clip ? undefined : fatigue,
      legs: clip || !Object.keys(legs).length ? undefined : legs,
      chem: clip ? undefined : this.chemistry(play, sit),
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
    set({ stage: 'presnap', playId, situation: sit, playSit: sit, phase: 'presnap', carrier: null, scrambling: false, result: null, lastCover: def.name, seriesOver: false, tutorial: this.tutorialNext ? 'snap' : null, audibled: null });
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
    if (ui.audible) {
      // The audible picker shares the hot-route context's keys: 1–4 (A, B, X, Y) call, H (LB) closes.
      if (id === 'hot.cancel') return this.closeHot();
      const k = id.startsWith('hot.n') ? Number(id.slice(5)) : 0;
      const list = audiblesFor(s.agents[s.qb]!.p);
      if (k >= 1 && k <= list.length) this.callAudible(list[k - 1]!.kind);
      return;
    }
    const hot = ui.hot;
    if (!hot) {
      if (id === 'preSnap.audible') {
        this.hotPop = Input.pushContext('hotRoute');
        set({ audible: true });
        return;
      }
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
    if (id === 'hot.up' || id === 'hot.down' || id === 'hot.left' || id === 'hot.right') {
      // A grid (Playtest 2): up and down move a row (deep, intermediate, short), left and right along it; both wrap.
      const rows = HOT_ROUTES.length / HOT_COLS;
      let r = Math.floor(hot.focus / HOT_COLS);
      let c = hot.focus % HOT_COLS;
      if (id === 'hot.up') r = (r + rows - 1) % rows;
      else if (id === 'hot.down') r = (r + 1) % rows;
      else if (id === 'hot.left') c = (c + HOT_COLS - 1) % HOT_COLS;
      else c = (c + 1) % HOT_COLS;
      set({ hot: { ...hot, focus: r * HOT_COLS + c } });
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
    if (get().hot || get().audible) set({ hot: null, audible: false });
  }

  /** The play an audible of this kind checks to now (null: none in this personnel), for the picker. */
  audibleFor(kind: AudibleKind): OffPlay | null {
    const s = this.runner?.state;
    if (!s) return null;
    const sit = get().playSit;
    return audiblePlay(s.setup.play, kind, { down: sit.down, toGo: sit.toGo, los: sit.los }, this.teams?.team ?? null);
  }

  /**
   * Check to another play at the line (Playtest 2): the offense re-sets in
   * the new play against the same defense (its call, the same seed: the
   * Beasts showed their look and keep it), same spot and down. Hot routes
   * called before it are gone with the old play.
   */
  callAudible(kind: AudibleKind): void {
    const s = this.runner?.state;
    const play = this.audibleFor(kind);
    if (!s || !play || s.phase !== 'presnap') return;
    const { seed, def } = s.setup;
    this.setUp(play.id, seed, def, get().playSit);
    set({ audibled: play.name });
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
    // The sim's count of the receiver hold goes back to the controls, so a tap is held until the sim has seen it (controls.ts holdStep).
    r.advance(dt, (s) => {
      this.sync();
      return this.controls.sample(s.hold);
    });
    this.sync();
  }

  /** Step ticks directly (browser tests and the dev console), through the same path as frames. */
  tick(n: number): void {
    for (let k = 0; k < n && this.live(); k++) {
      this.sync();
      this.runner!.step(this.controls.sample(this.runner!.state.hold));
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
    // Play action: the call shows from the snap through the fake and a beat
    // after (PA_CALL_HOLD), with the linebackers who triggered on it
    // (runs.ts runFit marks them), gone at the throw or the scramble.
    const pa = s.setup.play.pa;
    const paOn = !!pa && s.snapT >= 0 && s.t - s.snapT < 0.25 + pa.fake + PA_CALL_HOLD && s.ball.mode === 'held' && s.ball.holder === s.qb && s.scrambleT < 0;
    const bitten = paOn ? s.def.map((i) => s.agents[i]!).filter((a) => a.mem.paFrom !== undefined) : [];
    const bit = bitten.length;
    const cur = get().pa;
    if (paOn ? cur?.bit !== bit : cur !== null) set({ pa: paOn ? { bit, lbs: bitten.every((a) => a.p.pos === 'LB') } : null });
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
    const driveBefore = this.game?.driveKey?.();
    const g = this.game ? this.game.onResult(s, s.result, endY) : null;
    const next = g ? (g.over ? null : g.next) : nextSituation(ui.situation, s.result, endY);
    this.setContext(null);
    // Fatigue for the next snap (src/game/fatigue.ts): what this play took, the carries, a big hit's toll; a new series starts fresh.
    const bh = s.result.bigHit;
    const snaps: Snap[] = s.off.map((i) => {
      const a = s.agents[i]!;
      return {
        id: a.p.id,
        start: Math.max(0.2, 1 - (s.setup.fatigue?.[a.slot as OffSlot] ?? 0)),
        end: a.stamina,
        staminaAttr: a.fx.a('stamina'),
        touched: a.i === s.carrier || s.events.some((e) => (e.type === 'handoff' && e.who?.[1] === a.i) || (e.type === 'catch' && e.who?.[0] === a.i)),
        dropback: a.i === s.qb && !s.setup.play.run,
        traits: a.p.traits ?? [],
        hit: bh && bh.on === a.i ? hitToll(bh.force) : 0,
      };
    });
    snaps.push(...defenseSnaps(s));
    this.drive = afterSnap(this.drive, snaps, next === null || (driveBefore !== undefined && this.game?.driveKey?.() !== driveBefore));
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
      return [...m.CLIPS, ...m.CONCEPTS, ...m.IDENTITY, ...m.PASSING, ...m.PHYSICS, ...m.PASSING2, ...m.PASSING3, ...m.PASSING4, ...m.PASSING5, ...m.PASSING6, ...m.PASSING7, ...m.PASSING8, ...m.PASSING9];
    },
    // The browser half of the determinism check (e2e/practice.spec.ts).
    __btbSimHashes: async () => (await import('./determinism')).simHashes(await loadPracticeRosters()),
  });
}
