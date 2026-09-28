// A full game against the Beasts (GDD §7): the match state (match.ts) over
// the Practice Field's play engine (practice.ts). The play engine runs each
// snap exactly as in practice; this layer owns everything between snaps:
// the Beasts' "Meanwhile" possessions, downs and scores, fourth-down
// decisions, tries, kicks and punts, the game clock and the play clock
// (M6.6), overtime, the pause menu, the box score and the result. React
// reads the small store; per-frame work stays in the play engine.
//
// The play clock runs in real time while a snap is due (the play call, the
// fourth-down card, the offense at the line), paused with the game. Each
// whole second that passes goes to the match as one tick (match.tickClock),
// so the match only ever sees whole seconds and stays deterministic.
//
// The moment the match is over (and when you leave it from the pause menu)
// the game's record is built and saved to History (src/app/history.ts)
// before anything else happens, so the results screen can always be reached
// again: from the game, the Locker Room's Last Game panel, or History.

import { create } from 'zustand';
import type { Slot } from '@data/legacy/types';
import { Input } from '@/input/InputManager';
import { Audio } from '@/audio/audio';
import { saveRecord } from '@/app/history';
import { DEF_CALLS, callDefense, emptyTendencies, recordPlay, type BeastsDefense, type ContendersRoster, type DefCall, type DefSlot, type OffSlot, type PlayResult, type PlayState, type SimPlayer, simPlayer, type Difficulty, type Tendencies } from '@/sim';
import { deriveStream, type Rng } from '@/engine/rng';
import type { Catalog, DraftMode, Roster } from './draft';
import { draftedTeam } from './draft';
import { depthChart } from './depth';
import { squadFor } from './rotation';
import type { RatedBeasts } from './beasts';
import type { NewDaily } from './daily';
import { describe } from './describe';
import { applyBeastsDrive, applyKick, applyPlay, applyPunt, beastsPossession, callTimeout, canVictoryFormation, chooseFourth, chooseTry, clockText, createMatch, fgMakePct, halfSecs, isTimed, KICKER_RANGE, quarterName, readyForPlay, resolvePunt, SIDELINE, snapped, spikeOrKneel, tickClock, type BeastsDrive, type ClockEvent, type GameLength, type Match, type PlayOutcome, type PuntResult } from './match';
import { kickFlight, puntFlight, type KickResult } from './kick';
import { urlFlags } from '@/app/platform';
import { practice, usePractice } from './practice';
import { buildRecord, encodeFrames, keyMatchups, type GameRecord, type RecordMeta, type ReplayCapsule } from './record';
import type { Situation } from './situation';
import { emptyGameBox, pickPlayOfGame, sampleShadow, tallySnap, type GameBox, type PlayLog } from './stats';

export { emptyGameBox, type GameBox } from './stats';

/**
 * 'pregame': after the walk-out, the field, the Beasts and the scoreboard,
 * held until an explicit "press to kick off" (Playtest 1: a button pressed
 * during the walk-out ran the first play).
 */
export type GameStage = 'loading' | 'pregame' | 'meanwhile' | 'call' | 'play' | 'fourth' | 'try' | 'kick' | 'penalty' | 'break' | 'final';

/** The kick on screen: a PAT, a field goal or a punt, and once struck, its flight and how it came down. */
export interface KickUi {
  kind: 'PAT' | 'FG' | 'PUNT';
  distance: number;
  /** The field goal's make chance for a clean strike (0 for a punt). */
  pct: number;
  /** A PAT or field goal, once struck. */
  result: KickResult | null;
  /** A punt, once struck. */
  punt: PuntResult | null;
  /** The flight (kick frame), once struck. */
  path: [number, number, number][] | null;
  hang: number;
}

export interface GameUi {
  stage: GameStage;
  match: Match | null;
  /** Bumped on every match change (the match is mutated in place). */
  v: number;
  meanwhile: BeastsDrive | null;
  kick: KickUi | null;
  /** A clock banner (the two-minute warning, the end of a quarter), with when it went up (performance.now()). */
  flag: { event: ClockEvent; line: string; at: number } | null;
  /** The delay-of-game card's line ("5 yards, offense. Repeat 2nd down."). */
  penalty: string | null;
  /** The last snap's outcome for the banner ("First down", "Touchdown!"). */
  outcome: PlayOutcome['kind'] | null;
  box: GameBox;
  mode: string;
  /** A short line for the clock events (timeouts, spikes). */
  note: string | null;
  /** The pause menu is up over a card (a snap pauses in the play engine: practice stage 'paused'). */
  paused: boolean;
  /** The game's record, once it's over (saved to History the moment it's built). */
  record: GameRecord | null;
}

export const useGame = create<GameUi>(() => ({ stage: 'loading', match: null, v: 0, meanwhile: null, kick: null, flag: null, penalty: null, outcome: null, box: emptyGameBox(), mode: 'classic', note: null, paused: false, record: null }));
const set = (p: Partial<GameUi>) => useGame.setState((s) => ({ ...p, v: s.v + 1 }));
const get = () => useGame.getState();

/** The pre-game picture's formation: your eleven in 11 personnel, singleback (display only). */
const PREGAME_PLAY = 'singleback-drive';

/** The Beasts in the sim's defensive slots: legacy order DE DT DT DE / LB LB LB / CB S S CB. */
const BEAST_SLOTS: DefSlot[] = ['LE', 'LDT', 'RDT', 'RE', 'WLB', 'MLB', 'SLB', 'LCB', 'FS', 'SS', 'RCB'];
const DEFAULT_NUM: Record<string, number> = { DE: 94, DT: 97, LB: 55, CB: 24, S: 31 };

export function gameRosters(cat: Catalog, roster: Roster, beasts: RatedBeasts): { offense: Record<OffSlot, SimPlayer>; defense: Record<DefSlot, SimPlayer>; team: ContendersRoster; beastsD: BeastsDefense } {
  const t = draftedTeam(cat, roster);
  const offense = { QB: t.QB, RB: t.RB, X: t.WR1, Z: t.WR2, SLOT: t.WR3, TE: t.TE, LT: t.OL[0], LG: t.OL[1], C: t.OL[2], RG: t.OL[3], RT: t.OL[4] } as Record<OffSlot, SimPlayer>;
  const defense = {} as Record<DefSlot, SimPlayer>;
  const used = new Set<number>();
  beasts.beasts.forEach((b, i) => {
    const e = cat.entry.get(b.id)!;
    let num = cat.numbers[b.id] ?? DEFAULT_NUM[b.p] ?? 50;
    while (used.has(num)) num = (num % 99) + 1;
    used.add(num);
    defense[BEAST_SLOTS[i]!] = simPlayer(e, num);
  });
  // The sub package: the nickel corner and the dime safety drawn after the base eleven.
  const sub = (k: number, pos: 'CB' | 'S'): SimPlayer => {
    const b = beasts.subs[k];
    const e = b ? cat.entry.get(b.id) : undefined;
    if (!e) return defense[pos === 'CB' ? 'RCB' : 'SS'];
    let num = cat.numbers[b!.id] ?? DEFAULT_NUM[pos]!;
    while (used.has(num)) num = (num % 99) + 1;
    used.add(num);
    return simPlayer(e, num);
  };
  return { offense, defense, team: t, beastsD: { base: defense, nickel: sub(0, 'CB'), dime: sub(1, 'S') } };
}

export interface GameStart {
  cat: Catalog;
  roster: Roster;
  beasts: RatedBeasts;
  mode: DraftMode;
  /** Quick Play's rounds (the drive-count format). */
  drives: GameLength;
  /** A timed game's quarter, seconds (null: the drive count). */
  quarterSecs?: number | null;
  seed: number;
  diffAdj: number;
  difficulty: Difficulty;
  /** Wind scale from the weather (rain and snow blow harder). */
  windScale?: number;
  /** The Daily (its date and perfect team, for the results). */
  daily?: NewDaily | null;
}

/** Wall-clock ms for the record's date (the game layer's clock; the sim never sees it). */
const wallNow = (): number => Date.now();

/** The two-minute warning's and the quarter's banners. */
function bannerLine(ev: ClockEvent, m: Match): string {
  if (ev === 'twoMinuteWarning') return 'Two-minute warning';
  if (ev === 'endOfQuarter') return `End of the ${quarterName(m.clock.quarter - 1)} quarter`;
  if (ev === 'halftime') return 'Halftime';
  if (ev === 'endOfGame') return 'End of regulation';
  return 'Delay of game';
}

class GameSession {
  private m: Match | null = null;
  /** The play clock's real-time driver (a rAF loop while a game is on). */
  private raf = 0;
  private lastFrame = 0;
  private acc = 0;
  private halftimeShown = false;
  private offKeys: (() => void) | null = null;
  private names: { qb: string } = { qb: '' };
  private start0: GameStart | null = null;
  private team: ContendersRoster | null = null;
  private beastsD: BeastsDefense | null = null;
  /** Every snap of the game (the play of the game is picked from these). */
  private plays: PlayLog[] = [];
  private capsules: (ReplayCapsule | null)[] = [];
  /** The play engine's id of the snap whose coverage snapshot is taken. */
  private shadowed = -1;
  /** What the Beasts' staff has charted about you this game (targets, run/pass by down). */
  tendencies: Tendencies = emptyTendencies();
  private dcRng: Rng = deriveStream(0, 'dc');
  private difficulty: Difficulty = 'pro';
  /** The Beasts' call: package, coverage and pressure from the situation, the difficulty and what they've charted (sim/defense.ts). */
  defCall = (sit: Situation): DefCall => {
    const m = this.m!;
    return callDefense({ down: sit.down, toGo: sit.toGo, los: sit.los, secondsLeft: m.clock.live ? halfSecs(m) : undefined, scoreDiff: m.score.user - m.score.beasts }, this.difficulty, this.tendencies, this.dcRng, this.alphaId());
  };

  /** The Contenders' Alpha receiver, if they have one (the Beasts roll coverage to him). */
  private alphaId(): string | undefined {
    const t = this.team;
    if (!t) return undefined;
    return [t.WR1, t.WR2, t.WR3, t.TE].find((p) => p.traits?.includes('alpha') || p.traits?.includes('go-to-guy'))?.id;
  }

  get match(): Match | null {
    return this.m;
  }

  async start(o: GameStart): Promise<void> {
    set({ stage: 'loading', match: null, meanwhile: null, kick: null, flag: null, penalty: null, outcome: null, mode: o.mode, note: null, paused: false, record: null });
    const rosters = gameRosters(o.cat, o.roster, o.beasts);
    this.names.qb = rosters.offense.QB.name;
    this.start0 = o;
    this.team = rosters.team;
    this.beastsD = rosters.beastsD;
    this.plays = [];
    this.halftimeShown = false;
    this.acc = 0;
    this.capsules = [];
    this.shadowed = -1;
    this.tendencies = emptyTendencies();
    this.dcRng = deriveStream(o.seed, 'beasts-dc');
    this.difficulty = o.difficulty;
    const m = createMatch({ drives: o.drives, quarterSecs: o.quarterSecs ?? null, seed: o.seed, beastsRating: o.beasts.rating.rating, diffAdj: o.diffAdj, kickerRange: KICKER_RANGE[o.difficulty] }, o.windScale ?? 1);
    this.m = m;
    practice.difficulty = o.difficulty;
    await practice.enter(o.seed, {
      rosters: { offense: rosters.offense, defense: rosters.defense },
      teams: { team: rosters.team, beasts: rosters.beastsD },
      game: {
        situation: () => this.m!.sit,
        defCall: (sit) => this.defCall(sit),
        onResult: (s, r, endY) => this.onResult(s, r, endY),
        onTick: (s) => this.onTick(s),
        // The depth chart's rotation: RB2 on his downs (src/game/rotation.ts).
        squad: (play, sit) => squadFor(this.team!, play, sit, (this.m?.drive?.plays ?? 0) + 1),
      },
    });
    this.offKeys?.();
    this.offKeys = Input.onAction((id, info) => {
      if (info.repeat || get().paused) return;
      if (id === 'global.spike') this.spike();
      else if (id === 'global.kneel') this.kneel();
      else if (id === 'global.timeout') this.timeout();
    });
    cancelAnimationFrame(this.raf);
    this.lastFrame = 0;
    this.raf = requestAnimationFrame(this.clockFrame);
    set({ match: m, box: emptyGameBox(this.names.qb), stage: 'pregame' });
    // The pre-game picture: both teams set at the opening spot, the Beasts in their base defense.
    practice.showLineup(PREGAME_PLAY, DEF_CALLS[0]!, m.sit);
  }

  /** The pre-game moment's "press to kick off": the Beasts get the ball first. */
  kickoff(): void {
    if (!this.m || get().stage !== 'pregame' || get().paused) return;
    practice.abandon();
    this.nextBeasts();
  }

  /** A snap is due and the clock is being watched: the play call, the 4th-down card, the offense at the line (not paused). */
  private clockRuns(): boolean {
    const m = this.m;
    if (!m || m.playClock === null || get().paused) return false;
    const st = get().stage;
    if (st === 'call' || st === 'fourth') return true;
    return st === 'play' && usePractice.getState().stage === 'presnap' && !practice.runner?.paused;
  }

  /** Each frame: real time onto the play clock, a whole second at a time. */
  private clockFrame = (t: number): void => {
    // The capture harness steps its (slow) frames at a fixed 1/60 s, as the play engine does.
    const dt = urlFlags.shot !== null || urlFlags.video ? 1 / 60 : this.lastFrame ? Math.min(0.25, (t - this.lastFrame) / 1000) : 0;
    this.lastFrame = t;
    if (this.clockRuns()) {
      this.acc += dt;
      while (this.acc >= 1 && this.clockRuns()) {
        this.acc -= 1;
        this.second();
      }
    } else if (this.m?.playClock === null) this.acc = 0;
    if (this.m) this.raf = requestAnimationFrame(this.clockFrame);
  };

  /** One second off the play clock (and the game clock, if it's running). */
  private second(): void {
    const m = this.m!;
    const los = m.sit.los;
    const ev = tickClock(m);
    if (!ev) {
      if (m.playClock !== null && m.playClock <= 5) Audio.playClockTick();
      set({});
      return;
    }
    this.clockEvent(ev, los - m.sit.los);
  }

  /** What the clock did between plays. `yards`: a penalty's. */
  private clockEvent(ev: ClockEvent, yards = 0): void {
    const m = this.m!;
    const atLine = get().stage === 'play' && usePractice.getState().stage === 'presnap';
    if (ev === 'delayOfGame') {
      // The flag: the play at the line is dead, five yards, the down again.
      if (atLine) practice.abandon();
      Audio.whistle();
      const n = ['1st', '2nd', '3rd', '4th'][m.sit.down - 1];
      this.acc = 0;
      set({ stage: 'penalty', penalty: `${Math.round(yards)} yards, offense. Repeat ${n} down.`, flag: null, note: null });
      return;
    }
    if (ev === 'twoMinuteWarning') {
      this.banner(ev);
      return;
    }
    if (ev === 'endOfQuarter') {
      // The teams change ends: back to the huddle.
      if (atLine) practice.abandon();
      this.banner(ev);
      if (atLine || get().stage === 'call') this.toCall(false);
      return;
    }
    // The half or the game ran out before the snap.
    if (atLine) practice.abandon();
    this.toPhase();
  }

  private banner(ev: ClockEvent): void {
    set({ flag: { event: ev, line: bannerLine(ev, this.m!), at: performance.now() } });
  }

  /** After the delay-of-game card: back to the huddle, the play clock at 25. */
  afterPenalty(): void {
    if (get().stage !== 'penalty' || get().paused) return;
    set({ penalty: null });
    // Back to the call (or the 4th-down card, if it was 4th down), the play clock at 25.
    this.toPhase();
  }

  /** After the halftime card. */
  afterBreak(): void {
    if (get().stage !== 'break' || get().paused) return;
    this.toPhase();
  }

  leave(): void {
    this.offKeys?.();
    this.offKeys = null;
    cancelAnimationFrame(this.raf);
    practice.leave();
    this.m = null;
    set({ stage: 'loading', match: null, paused: false });
  }

  /** A Beasts possession: computed now, shown as the Meanwhile cut. */
  private nextBeasts(): void {
    const m = this.m!;
    const d = beastsPossession(m);
    set({ stage: 'meanwhile', meanwhile: d, kick: null });
  }

  /** The Meanwhile cut is over (or skipped): score it, and to your drive. */
  endMeanwhile(): void {
    const m = this.m;
    const d = get().meanwhile;
    if (!m || !d || get().stage !== 'meanwhile' || get().paused) return;
    applyBeastsDrive(m, d);
    set({ meanwhile: null });
    this.toPhase();
  }

  /** Move the UI to wherever the match is now. */
  private toPhase(): void {
    const m = this.m!;
    this.checkFinal();
    if (m.event === 'halftime' && !this.halftimeShown && m.phase !== 'final') {
      // The half is over (on a snap, a kick, their drive, or the clock at the line): the halftime card.
      this.halftimeShown = true;
      practice.abandon();
      set({ stage: 'break', flag: null });
      return;
    }
    if (m.event === 'endOfQuarter' || m.event === 'twoMinuteWarning') this.banner(m.event);
    switch (m.phase) {
      case 'meanwhile':
        practice.abandon();
        this.nextBeasts();
        return;
      case 'final':
        practice.abandon();
        set({ stage: 'final' });
        return;
      case 'fourth':
        // The play clock starts with the decision (and runs on into the call if you go for it).
        if (!this.ready()) return;
        set({ stage: 'fourth' });
        return;
      case 'try':
        set({ stage: 'try' });
        return;
      case 'kick': {
        const k = m.kick!;
        set({ stage: 'kick', kick: { ...k, pct: k.kind === 'PUNT' ? 0 : fgMakePct(m, k.distance), result: null, punt: null, path: null, hang: 0 } });
        return;
      }
      default:
        this.toCall();
    }
  }

  /** Ready for the snap: the play clock starts (the huddle may run the quarter out). False if that ended the drive (the screen has moved on). */
  private ready(): boolean {
    const m = this.m!;
    const ev = readyForPlay(m);
    if (ev === 'halftime' || ev === 'endOfGame') {
      practice.abandon();
      this.toPhase();
      return false;
    }
    if (ev) this.banner(ev);
    return true;
  }

  private toCall(ready = true): void {
    if (ready && !this.ready()) return;
    usePractice.setState({ situation: this.m!.sit, playSit: this.m!.sit, seriesOver: false });
    practice.nextPlay();
    set({ stage: 'call' });
  }

  /** The match just went final (any path: a snap, a kick, a punt, a kneel): record it now, before the UI moves. */
  private checkFinal(): void {
    if (this.m?.phase === 'final' && !get().record) this.finish('final');
  }

  /** Build the game's record and save it to History (once). */
  private finish(end: 'final' | 'left'): GameRecord | null {
    const m = this.m;
    const o = this.start0;
    if (!m || !o || !this.team || !this.beastsD) return null;
    if (get().record) return get().record;
    const box = get().box;
    const t = this.team;
    const person = (slot: string, p: SimPlayer) => ({ slot, id: p.id, name: p.name, num: p.num, pos: p.pos });
    const offense = [person('QB', t.QB), person('RB', t.RB), person('RB2', t.RB2), person('WR1', t.WR1), person('WR2', t.WR2), person('WR3', t.WR3), person('TE', t.TE), person('TE2', t.TE2), ...(['LT', 'LG', 'C', 'RG', 'RT'] as const).map((s, i) => person(s, t.OL[i]!))];
    const bd = this.beastsD;
    const beasts = [...BEAST_SLOTS.map((s) => person(s, bd.base[s])), person('NB', bd.nickel), person('DB', bd.dime)];
    const perfect = o.daily?.perfect.map((p) => {
      const mine = o.roster[p.slot];
      return { slot: p.slot, pick: p.pick?.name ?? null, mine: mine?.name ?? null, same: !!(mine && p.pick && mine.id === p.pick.id) };
    });
    const finishedAt = wallNow();
    const meta: RecordMeta = {
      id: `${finishedAt.toString(36)}-${m.cfg.seed.toString(36)}`,
      finishedAt,
      mode: o.mode,
      dailyKey: o.daily?.dateKey ?? null,
      difficulty: o.difficulty,
      end,
      offense,
      beasts,
      matchups: keyMatchups(o.cat, depthChart(o.roster), o.beasts, box),
      perfect: perfect ?? null,
    };
    const idx = pickPlayOfGame(this.plays);
    const rec = buildRecord(m, box, meta, this.plays, idx >= 0 ? { index: idx, capsule: this.capsules[idx] ?? null } : null);
    saveRecord(rec);
    set({ record: rec });
    return rec;
  }

  /**
   * The pause menu's way out: a snap whose whistle has blown still counts
   * (the last play of the game ends it properly), then the game is over
   * where it stands and its record is saved. Returns the record (the
   * results screen shows it).
   */
  quitToResults(): GameRecord | null {
    const m = this.m;
    if (!m) return get().record;
    practice.settle();
    const rec = get().record ?? this.finish(m.phase === 'final' ? 'final' : 'left');
    practice.abandon();
    set({ paused: false, stage: 'final' });
    return rec;
  }

  pause(): void {
    if (this.m && !get().paused) set({ paused: true });
  }

  resume(): void {
    if (get().paused) set({ paused: false });
  }

  /** Each tick of a snap: the coverage snapshot, once a dropback, when the ball comes out or the pocket breaks down. */
  private onTick(s: PlayState): void {
    // The snap: the play clock is done with.
    if (s.snapT >= 0 && this.m && this.m.playClock !== null) {
      snapped(this.m);
      set({});
    }
    if (this.shadowed === practice.playId || s.setup.play.run || s.snapT < 0) return;
    const out = s.phase === 'air' || s.phase === 'carrier' || s.phase === 'loose' || !!s.result;
    if (!out) return;
    this.shadowed = practice.playId;
    sampleShadow(get().box, s);
  }

  /** A play's whistle (from the play engine). */
  private onResult(s: PlayState, r: PlayResult, endY: number): { next: Situation; over: boolean } {
    const m = this.m!;
    // Snap to whistle in sim seconds (a timed game rounds it); the time before the snap was ticked off live.
    const playSecs = Math.max(0, s.whistleT - Math.max(0, s.snapT));
    const before = m.sit;
    const score = { ...m.score };
    const driveIdx = m.userDrives.length;
    const n = (m.drive?.plays ?? 0) + 1;
    const round = m.round;
    const ot = m.ot;
    const q = m.clock.quarter;
    const clock = m.ot ? (m.ot > 1 ? `${m.ot}OT` : 'OT') : `Q${q} ${clockText(m.clock.secs)}`;
    tallySnap(get().box, s, r, before, this.names.qb, { round, ot });
    // The Beasts' staff charts it.
    const tgt = r.pass?.attempted ? s.agents[r.pass.target]?.p.id : undefined;
    this.tendencies = recordPlay(this.tendencies, { targetId: tgt, playId: s.setup.play.id, type: s.setup.play.type, down: before.down, toGo: before.toGo, yards: r.offenseBall ? r.spot - before.los : 0 });
    const out = applyPlay(m, r, endY, playSecs, 0);
    if (out.kind === 'firstDown' || (out.kind === 'touchdown' && r.offenseBall)) get().box.firstDowns++;
    this.logPlay(s, r, before, { drive: driveIdx, n, round, ot, score, q, clock });
    set({ outcome: out.kind, stage: 'play' });
    this.checkFinal();
    return { next: m.sit, over: m.phase !== 'drive' && m.phase !== 'fourth' };
  }

  private logPlay(s: PlayState, r: PlayResult, before: Situation, at: { drive: number; n: number; round: number; ot: number; score: { user: number; beasts: number }; q: number; clock: string }): void {
    const card = describe(s);
    const m = this.m!;
    this.plays.push({
      ...at,
      down: before.down,
      toGo: before.toGo,
      los: before.los,
      playId: s.setup.play.id,
      playName: s.setup.play.name,
      headline: card.headline,
      detail: card.detail,
      yards: r.offenseBall ? r.spot - before.los : 0,
      touchdown: r.touchdown && r.offenseBall,
      turnover: !r.offenseBall,
      pickSix: r.touchdown && !r.offenseBall,
      late: at.ot > 0 || (isTimed(m) ? at.q >= 4 : at.round >= m.cfg.drives),
      q: at.q,
      clock: at.clock,
    });
    const run = practice.runner;
    const st = s.setup;
    this.capsules.push(
      run && run.state === s
        ? { seed: st.seed, playId: st.play.id, def: st.def, los: st.los, ballY: st.ballY ?? 0, toGo: st.toGo, down: before.down, difficulty: st.difficulty, tapMax: st.tapMax, flip: st.flip, fatigue: st.fatigue as Record<string, number> | undefined, frames: encodeFrames(run.frames) }
        : null,
    );
    // Keep the inputs of the snaps that could still be the play of the game (memory: a game is ~60 snaps).
    const keep = pickPlayOfGame(this.plays);
    this.capsules = this.capsules.map((c, i) => (i === keep || i === this.capsules.length - 1 ? c : null));
  }

  /** From the result card: on to the next snap, decision or possession. */
  afterResult(): void {
    if (get().paused) return;
    this.toPhase();
  }

  fourth(choice: 'go' | 'punt' | 'fg'): void {
    chooseFourth(this.m!, choice);
    this.toPhase();
  }

  try(twoPoint: boolean): void {
    chooseTry(this.m!, twoPoint);
    this.toPhase();
  }

  /** The strike (from the kick view): power 0..1+, aim radians (+ = left). The flight, for the view. */
  strike(power: number, aim: number): { path: [number, number, number][]; hang: number } {
    const m = this.m!;
    const k = m.kick!;
    if (k.kind === 'PUNT') {
      const f = puntFlight({ power, aim, wind: m.wind, y0: 0, halfWidth: SIDELINE });
      const p = resolvePunt(m, f);
      set({ kick: { ...get().kick!, punt: p, path: f.path, hang: f.hang } });
      return { path: f.path, hang: f.hang };
    }
    const res = kickFlight({ distance: k.distance, power, aim, range: m.cfg.kickerRange, wind: m.wind });
    set({ kick: { ...get().kick!, result: res, path: res.path, hang: res.hang } });
    return { path: res.path, hang: res.hang };
  }

  /** The kick's flight has been shown. */
  endKick(): void {
    const m = this.m;
    const k = get().kick;
    if (!m || !k || (!k.result && !k.punt)) return;
    if (k.punt) applyPunt(m, k.punt);
    else applyKick(m, k.result!.good, k.result!.hang);
    set({ kick: null });
    this.toPhase();
  }

  /** A timeout: from the call, the 4th-down card or at the line (the clock stops; 25 on the play clock). */
  timeout(): void {
    const m = this.m;
    const st = get().stage;
    const atLine = st === 'play' && usePractice.getState().stage === 'presnap';
    if (!m || (st !== 'call' && st !== 'fourth' && !atLine)) return;
    if (callTimeout(m)) {
      this.acc = 0;
      set({ note: `Timeout: ${m.clock.timeouts} left` });
    }
  }

  spike(): void {
    const m = this.m;
    if (!m || get().stage !== 'call' || !m.clock.live || m.phase !== 'drive') return;
    spikeOrKneel(m, 'spike', 0);
    set({ note: 'Spiked: the clock stops' });
    this.toPhase();
  }

  kneel(): void {
    const m = this.m;
    if (!m || get().stage !== 'call' || m.phase !== 'drive') return;
    if (!m.clock.live && !canVictoryFormation(m)) return;
    spikeOrKneel(m, 'kneel', 0);
    set({ note: 'Kneel' });
    this.toPhase();
  }
}

export const game = new GameSession();

/** Draft slots for the box score's order. */
export const SLOT_OF_OFF: Partial<Record<OffSlot, Slot>> = { QB: 'QB', RB: 'RB', X: 'WR1', Z: 'WR2', SLOT: 'WR3', TE: 'TE' };

if (import.meta.env.DEV) Object.assign(globalThis, { __btbGame: game, __btbGameUi: useGame });
