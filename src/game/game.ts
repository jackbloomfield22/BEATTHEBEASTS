// A full game against the Beasts (GDD §7): the match state (match.ts) over
// the Practice Field's play engine (practice.ts). The play engine runs each
// snap exactly as in practice; this layer owns everything between snaps:
// the Beasts' "Meanwhile" possessions, downs and scores, fourth-down
// decisions, tries, kicks and punts, the live two-minute clock, overtime,
// the box score and the result. React reads the small store; per-frame work
// stays in the play engine.

import { create } from 'zustand';
import type { Slot } from '@data/legacy/types';
import { Input } from '@/input/InputManager';
import { DEF_CALLS, type DefCall, type DefSlot, type OffSlot, type PlayResult, type PlayState, type SimPlayer, simPlayer, type Difficulty } from '@/sim';
import type { Catalog, Roster } from './draft';
import { draftedTeam } from './draft';
import type { RatedBeasts } from './beasts';
import { applyBeastsDrive, applyKick, applyPlay, beastsPossession, callTimeout, canVictoryFormation, chooseFourth, chooseTry, createMatch, fgMakePct, KICKER_RANGE, spikeOrKneel, type BeastsDrive, type GameLength, type Match, type PlayOutcome } from './match';
import { kickFlight, type KickResult } from './kick';
import { practice, usePractice } from './practice';
import type { Situation } from './situation';

export type GameStage = 'loading' | 'meanwhile' | 'call' | 'play' | 'fourth' | 'try' | 'kick' | 'punt' | 'final';

export interface PassLine {
  name: string;
  cmp: number;
  att: number;
  yds: number;
  td: number;
  int: number;
  sacks: number;
}
export interface RushLine {
  name: string;
  car: number;
  yds: number;
  td: number;
  long: number;
}
export interface RecLine {
  name: string;
  tgt: number;
  rec: number;
  yds: number;
  td: number;
  long: number;
}

/** The box score: legacy's categories, plus the big hits you took. */
export interface GameBox {
  pass: PassLine;
  rush: Record<string, RushLine>;
  rec: Record<string, RecLine>;
  /** Targets by receiver, by the defender nearest the ball when it arrived (the matchups). */
  covered: Record<string, Record<string, { tgt: number; yds: number }>>;
  bigHits: number;
  firstDowns: number;
  plays: number;
  yards: number;
  turnovers: number;
  sacks: number;
}

export interface GameUi {
  stage: GameStage;
  match: Match | null;
  /** Bumped on every match change (the match is mutated in place). */
  v: number;
  meanwhile: BeastsDrive | null;
  punt: { yards: number; spot: number } | null;
  kick: { kind: 'PAT' | 'FG'; distance: number; pct: number; result: KickResult | null } | null;
  /** The last snap's outcome for the banner ("First down", "Touchdown!"). */
  outcome: PlayOutcome['kind'] | null;
  box: GameBox;
  mode: string;
  /** A short line for the clock events (timeouts, spikes). */
  note: string | null;
}

export function emptyGameBox(qb = ''): GameBox {
  return { pass: { name: qb, cmp: 0, att: 0, yds: 0, td: 0, int: 0, sacks: 0 }, rush: {}, rec: {}, covered: {}, bigHits: 0, firstDowns: 0, plays: 0, yards: 0, turnovers: 0, sacks: 0 };
}

export const useGame = create<GameUi>(() => ({ stage: 'loading', match: null, v: 0, meanwhile: null, punt: null, kick: null, outcome: null, box: emptyGameBox(), mode: 'classic', note: null }));
const set = (p: Partial<GameUi>) => useGame.setState((s) => ({ ...p, v: s.v + 1 }));
const get = () => useGame.getState();

/** The Beasts in the sim's defensive slots: legacy order DE DT DT DE / LB LB LB / CB S S CB. */
const BEAST_SLOTS: DefSlot[] = ['LE', 'LDT', 'RDT', 'RE', 'WLB', 'MLB', 'SLB', 'LCB', 'FS', 'SS', 'RCB'];
const DEFAULT_NUM: Record<string, number> = { DE: 94, DT: 97, LB: 55, CB: 24, S: 31 };

export function gameRosters(cat: Catalog, roster: Roster, beasts: RatedBeasts): { offense: Record<OffSlot, SimPlayer>; defense: Record<DefSlot, SimPlayer>; bench: SimPlayer[] } {
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
  return { offense, defense, bench: [t.RB2, t.TE2] };
}

export interface GameStart {
  cat: Catalog;
  roster: Roster;
  beasts: RatedBeasts;
  mode: string;
  drives: GameLength;
  seed: number;
  diffAdj: number;
  difficulty: Difficulty;
  /** Wind scale from the weather (rain and snow blow harder). */
  windScale?: number;
}

class GameSession {
  private m: Match | null = null;
  private lastWhistleWall = 0;
  private offKeys: (() => void) | null = null;
  private names: { qb: string } = { qb: '' };
  /** The Beasts' coverage choice: seeded by snap (the full DC arrives with the situational AI). */
  defCall: (sit: Situation, seed: number) => DefCall = (_sit, seed) => DEF_CALLS[(seed >>> 4) % DEF_CALLS.length]!;

  get match(): Match | null {
    return this.m;
  }

  async start(o: GameStart): Promise<void> {
    set({ stage: 'loading', match: null, meanwhile: null, punt: null, kick: null, outcome: null, mode: o.mode, note: null });
    const rosters = gameRosters(o.cat, o.roster, o.beasts);
    this.names.qb = rosters.offense.QB.name;
    const m = createMatch({ drives: o.drives, seed: o.seed, beastsRating: o.beasts.rating.rating, diffAdj: o.diffAdj, kickerRange: KICKER_RANGE[o.difficulty] }, o.windScale ?? 1);
    this.m = m;
    practice.difficulty = o.difficulty;
    await practice.enter(o.seed, {
      rosters,
      game: {
        situation: () => this.m!.sit,
        defCall: (sit, seed) => this.defCall(sit, seed),
        onResult: (s, r, endY) => this.onResult(s, r, endY),
      },
    });
    this.offKeys?.();
    this.offKeys = Input.onAction((id, info) => {
      if (info.repeat) return;
      if (id === 'global.spike') this.spike();
      else if (id === 'global.kneel') this.kneel();
      else if (id === 'global.timeout') this.timeout();
    });
    set({ match: m, box: emptyGameBox(this.names.qb) });
    this.nextBeasts();
  }

  leave(): void {
    this.offKeys?.();
    this.offKeys = null;
    practice.leave();
    this.m = null;
    set({ stage: 'loading', match: null });
  }

  /** A Beasts possession: computed now, shown as the Meanwhile cut. */
  private nextBeasts(): void {
    const m = this.m!;
    const d = beastsPossession(m);
    set({ stage: 'meanwhile', meanwhile: d, punt: null, kick: null });
  }

  /** The Meanwhile cut is over (or skipped): score it, and to your drive. */
  endMeanwhile(): void {
    const m = this.m!;
    const d = get().meanwhile;
    if (!d || get().stage !== 'meanwhile') return;
    applyBeastsDrive(m, d);
    set({ meanwhile: null });
    this.toPhase();
  }

  /** Move the UI to wherever the match is now. */
  private toPhase(): void {
    const m = this.m!;
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
        set({ stage: 'fourth' });
        return;
      case 'try':
        set({ stage: 'try' });
        return;
      case 'kick': {
        const k = m.kick!;
        set({ stage: 'kick', kick: { ...k, pct: fgMakePct(m, k.distance), result: null } });
        return;
      }
      default:
        this.toCall();
    }
  }

  private toCall(): void {
    usePractice.setState({ situation: this.m!.sit, playSit: this.m!.sit, seriesOver: false });
    practice.nextPlay();
    set({ stage: 'call' });
  }

  /** A play's whistle (from the play engine). */
  private onResult(s: PlayState, r: PlayResult, endY: number): { next: Situation; over: boolean } {
    const m = this.m!;
    const now = performance.now();
    const playSecs = Math.max(0, s.whistleT - Math.max(0, s.snapT));
    const between = this.lastWhistleWall ? Math.max(0, (now - this.lastWhistleWall) / 1000 - playSecs) : 0;
    this.lastWhistleWall = now;
    const before = m.sit;
    this.tally(s, r, before);
    const out = applyPlay(m, r, endY, playSecs, between);
    if (out.kind === 'firstDown' || (out.kind === 'touchdown' && r.offenseBall)) get().box.firstDowns++;
    set({ outcome: out.kind, stage: 'play' });
    return { next: m.sit, over: m.phase !== 'drive' && m.phase !== 'fourth' };
  }

  /** From the result card: on to the next snap, decision or possession. */
  afterResult(): void {
    this.toPhase();
  }

  fourth(choice: 'go' | 'punt' | 'fg'): void {
    const m = this.m!;
    const spot = m.sit.los;
    const y = chooseFourth(m, choice);
    if (choice === 'punt') {
      set({ stage: 'punt', punt: { yards: y ?? 0, spot } });
      return;
    }
    this.toPhase();
  }

  /** The punt cut is over. */
  endPunt(): void {
    this.toPhase();
  }

  try(twoPoint: boolean): void {
    chooseTry(this.m!, twoPoint);
    this.toPhase();
  }

  /** The strike (from the kick view): power 0..1+, aim radians. */
  strike(power: number, aim: number): KickResult {
    const m = this.m!;
    const k = m.kick!;
    const res = kickFlight({ distance: k.distance, power, aim, range: m.cfg.kickerRange, wind: m.wind });
    set({ kick: { ...get().kick!, result: res } });
    return res;
  }

  /** The kick's flight has been shown. */
  endKick(): void {
    const m = this.m!;
    const k = get().kick;
    if (!k?.result) return;
    applyKick(m, k.result.good);
    set({ kick: null });
    this.toPhase();
  }

  timeout(): void {
    const m = this.m;
    if (!m || get().stage !== 'call') return;
    if (callTimeout(m)) set({ note: `Timeout: ${m.clock.timeouts} left` });
  }

  spike(): void {
    const m = this.m;
    if (!m || get().stage !== 'call' || !m.clock.live) return;
    const between = this.lastWhistleWall ? (performance.now() - this.lastWhistleWall) / 1000 : 0;
    this.lastWhistleWall = performance.now();
    spikeOrKneel(m, 'spike', between);
    set({ note: 'Spiked: the clock stops' });
    this.toPhase();
  }

  kneel(): void {
    const m = this.m;
    if (!m || get().stage !== 'call') return;
    if (!m.clock.live && !canVictoryFormation(m)) return;
    const between = this.lastWhistleWall ? (performance.now() - this.lastWhistleWall) / 1000 : 0;
    this.lastWhistleWall = performance.now();
    spikeOrKneel(m, 'kneel', between);
    set({ note: 'Kneel' });
    this.toPhase();
  }

  /** Box score from one snap (the sim's agents and the result). */
  private tally(s: PlayState, r: PlayResult, before: Situation): void {
    const b = get().box;
    b.plays++;
    const y = r.offenseBall ? r.spot - before.los : 0;
    const td = r.touchdown && r.offenseBall ? 1 : 0;
    if (r.bigHit && s.agents[r.bigHit.on]?.side === 'off') b.bigHits++;
    if (!r.offenseBall) b.turnovers++;
    if (r.sack) {
      b.sacks++;
      b.pass.sacks++;
      b.yards += y;
      return;
    }
    if (r.pass?.attempted) {
      b.pass.att++;
      const tgt = s.agents[r.pass.target];
      const name = tgt?.p.name ?? '';
      const line = (b.rec[name] ??= { name, tgt: 0, rec: 0, yds: 0, td: 0, long: 0 });
      line.tgt++;
      // The nearest Beast when the ball got there: who covered him on this target.
      const cov = nearestDefender(s, r.pass.target);
      if (cov) {
        const c = ((b.covered[name] ??= {})[cov] ??= { tgt: 0, yds: 0 });
        c.tgt++;
        if (r.pass.complete && !r.pass.intercepted) c.yds += y;
      }
      if (r.pass.intercepted) b.pass.int++;
      else if (r.pass.complete) {
        b.pass.cmp++;
        b.pass.yds += y;
        b.pass.td += td;
        line.rec++;
        line.yds += y;
        line.td += td;
        line.long = Math.max(line.long, y);
      }
    } else {
      const c = s.carrier >= 0 ? s.agents[s.carrier] : null;
      const name = c && c.side === 'off' ? c.p.name : this.names.qb;
      const line = (b.rush[name] ??= { name, car: 0, yds: 0, td: 0, long: 0 });
      line.car++;
      line.yds += y;
      line.td += td;
      line.long = Math.max(line.long, y);
    }
    b.yards += y;
  }
}

function nearestDefender(s: PlayState, target: number): string | null {
  const a = s.agents[target];
  if (!a) return null;
  let best: string | null = null;
  let bd = Infinity;
  for (const d of s.agents) {
    if (d.side !== 'def') continue;
    const dx = d.pos.x - a.pos.x;
    const dy = d.pos.y - a.pos.y;
    const dd = dx * dx + dy * dy;
    if (dd < bd) {
      bd = dd;
      best = d.p.name;
    }
  }
  return best;
}

export const game = new GameSession();

/** Draft slots for the box score's order. */
export const SLOT_OF_OFF: Partial<Record<OffSlot, Slot>> = { QB: 'QB', RB: 'RB', X: 'WR1', Z: 'WR2', SLOT: 'WR3', TE: 'TE' };

if (import.meta.env.DEV) Object.assign(globalThis, { __btbGame: game, __btbGameUi: useGame });
