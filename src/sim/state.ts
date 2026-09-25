// A play's state and its setup: both sides aligned from the play and the
// coverage, with the defense aligning to the offense's formation.

import { deriveStream } from '@/engine/rng';
import { effects } from './effects';
import { type Streams, streams } from './rand';
import { DEF_SLOTS, OFF_SLOTS, type DefCall, type OffPlay, type RouteName, type ZoneName, ZONES } from './plays';
import type { CatchType } from './input';
import { FIELD_HALF_W, type Agent, type Ball, type DefSlot, type OffSlot, type Phase, type PlayResult, type SimEvent, type SimPlayer } from './types';
import { v2, type V2 } from './vec';

export type Difficulty = 'rookie' | 'pro' | 'legend' | 'beast';

/** Difficulty changes AI reaction and reads, never ratings (GDD §10.4). */
export const DIFFICULTY: Record<Difficulty, { latency: number; pumpBite: number }> = {
  rookie: { latency: 0.25, pumpBite: 1.4 },
  pro: { latency: 0.1, pumpBite: 1.0 },
  legend: { latency: 0.03, pumpBite: 0.8 },
  beast: { latency: 0, pumpBite: 0.7 },
};

export interface PlaySetup {
  seed: number;
  offense: Record<OffSlot, SimPlayer>;
  defense: Record<DefSlot, SimPlayer>;
  play: OffPlay;
  def: DefCall;
  /** Line of scrimmage, x yards from the offense's goal line. */
  los: number;
  /** Ball's lateral spot (hash), yd. */
  ballY?: number;
  toGo: number;
  /** The user controls the offense (the QB, then the ball carrier). */
  user: boolean;
  difficulty?: Difficulty;
  /** AI snaps immediately; the user snaps with the Snap input. */
  autoSnap?: boolean;
  /** Stamina each player starts the play without (0–1), e.g. still shaking off a big hit. */
  fatigue?: Partial<Record<OffSlot | DefSlot, number>>;
}

export interface Block {
  /** Blocker (offense) and defender. */
  b: number;
  d: number;
  /** −1 blocker winning … +1 defender sheds. */
  lev: number;
  kind: 'pass' | 'run';
  move: 'bull' | 'speed' | 'swim' | 'spin' | 'drive';
  t: number;
  /** This rep's edge at contact (hands, pad level, footwork): the same matchup doesn't play out the same every snap. */
  bias: number;
}

export interface PlayState {
  setup: PlaySetup;
  t: number;
  tick: number;
  phase: Phase;
  snapT: number;
  agents: Agent[];
  off: number[];
  def: number[];
  slot: Record<string, number>;
  ball: Ball;
  blocks: Block[];
  events: SimEvent[];
  result: PlayResult | null;
  rng: Streams;
  qb: number;
  carrier: number;
  /** Receivers by icon number: [0] is icon 1 … up to 5 (read order). */
  icons: number[];
  /** QB's eyes: the point he is looking at (zone defenders read it). */
  eyes: V2;
  /** Pump fake in progress until this time. */
  pumpUntil: number;
  /** Throw charge: ticks the current icon has been held, and which. */
  hold: { icon: number; ticks: number };
  /** A throw wound up: released at `at` (play time). */
  windup: { at: number; icon: number; charge: number; aim: V2; away: boolean } | null;
  catchType: CatchType | null;
  /** Hot routes called at the line, by offensive slot (they replace the play's route at the snap). */
  hot: Partial<Record<OffSlot, RouteName>>;
  /** Agents that already tried to play the ball on this throw. */
  touched: number[];
  /** Forward progress (x) of the ball carrier. */
  maxX: number;
  /** Whistle time (play keeps animating the dead ball after). */
  whistleT: number;
  /** The handoff (play time; −1 before one). */
  runReadT: number;
  /**
   * When the offense showed run (the line firing out, a handoff, a fake) and
   * pass (the line setting, the QB's drop, the ball pulled out of a fake);
   * −1 if it hasn't. Each defender believes the latest he has read (runs.ts).
   */
  runShow: number;
  passShow: number;
  /** The QB tucked it and is running (a scramble), since this play time; −1 if not. */
  scrambleT: number;
  /** The QB left the pocket (outside the tackles, or tucked it), since this play time; −1 if not. The rush reacts to it. */
  escapeT: number;
  /** First time a free defender got on the QB (pressure ≥ 0.7), for the harness; −1 if never. */
  pressureT: number;
  /** The defenders who rally to this throw (decided at the release, keyed by it); the rest keep their men and zones. */
  rally: { at: number; who: number[] } | null;
  /** Throw bookkeeping for the result. */
  pass: PlayResult['pass'];
  sack: boolean;
  /** A big hit on this play (for the result). */
  bigHit: PlayResult['bigHit'];
  /** AI QB read state. */
  read: { idx: number; since: number };
}

function makeAgent(i: number, side: 'off' | 'def', slot: OffSlot | DefSlot, p: SimPlayer, pos: V2, face: number): Agent {
  return {
    i,
    side,
    slot,
    p,
    fx: effects(p),
    pos,
    vel: v2(),
    face,
    anim: 'stance',
    busy: 0,
    move: null,
    moveCooldown: 0,
    moveFatigue: 0,
    burst: 0,
    burstCd: 0,
    moveBuf: null,
    impulse: null,
    stamina: 1,
    down: false,
    hist: [],
    route: null,
    mem: {},
  };
}

/** Where each defender lines up, from the coverage and the offense's formation. */
function defensiveAlignment(s: PlaySetup, offPos: Record<OffSlot, V2>): Record<DefSlot, V2> {
  const los = s.los;
  const by = s.ballY ?? 0;
  // Receivers split to each side (the widest two set the corners).
  const wide = (OFF_SLOTS.filter((k) => ['X', 'Z', 'SLOT', 'TE', 'RB'].includes(k)) as OffSlot[]).map((k) => ({ k, p: offPos[k] }));
  const left = wide.filter((w) => w.p.y > by + 5).sort((a, b) => b.p.y - a.p.y);
  const right = wide.filter((w) => w.p.y < by - 5).sort((a, b) => a.p.y - b.p.y);
  const out: Partial<Record<DefSlot, V2>> = {};
  // Front four: ends outside the tackles, tackles over the guards' outside shoulders.
  out.LE = v2(los + 0.9, by + 3.9);
  out.LDT = v2(los + 0.8, by + 1.0);
  out.RDT = v2(los + 0.8, by - 1.0);
  out.RE = v2(los + 0.9, by - 3.9);
  // Linebackers at 4.5 yd, shaded toward the strength (more receivers).
  const strength = right.length > left.length ? -1 : 1;
  out.WLB = v2(los + 4.5, by - 3.6 * strength);
  out.MLB = v2(los + 5, by + 0.4 * strength);
  out.SLB = v2(los + 4.5, by + 3.6 * strength);
  const call = s.def.assign;
  const cb = (slot: 'LCB' | 'RCB', rec: { p: V2 } | undefined, sideSign: number) => {
    const a = call[slot];
    const press = a.kind === 'man' && a.press;
    const y = rec ? rec.p.y + sideSign * 0.8 : by + sideSign * 15;
    return v2(los + (press ? 1.2 : a.kind === 'zone' && ZONES[a.zone].deep ? 7 : 5.5), y);
  };
  out.LCB = cb('LCB', left[0], 1);
  out.RCB = cb('RCB', right[0], -1);
  const safety = (slot: 'FS' | 'SS', side: number) => {
    const a = call[slot];
    if (a.kind === 'zone') {
      const z = ZONES[a.zone];
      return v2(los + Math.min(z.d, 12) + (z.deep ? 1 : -3), by + (z.deep ? z.y * 0.8 : z.y * 0.6));
    }
    return v2(los + 8, by + side * 5);
  };
  out.FS = safety('FS', 1);
  out.SS = safety('SS', -1);
  // Man defenders line up over their man.
  for (const slot of DEF_SLOTS) {
    const a = call[slot];
    if (a.kind === 'man' && slot !== 'LCB' && slot !== 'RCB') {
      const m = offPos[a.on];
      out[slot] = v2(los + (slot === 'SS' || slot === 'FS' ? 6 : 4.5), m.y + (m.y > by ? -0.8 : 0.8));
    }
  }
  return out as Record<DefSlot, V2>;
}

export function createPlay(s: PlaySetup): PlayState {
  const by = s.ballY ?? 0;
  const agents: Agent[] = [];
  const slot: Record<string, number> = {};
  const offPos = {} as Record<OffSlot, V2>;
  for (const k of OFF_SLOTS) {
    const a = s.play.formation.align[k];
    offPos[k] = v2(s.los + a.dx, clampY(by + a.dy));
  }
  for (const k of OFF_SLOTS) {
    const ag = makeAgent(agents.length, 'off', k, s.offense[k], offPos[k], 0);
    slot[k] = ag.i;
    agents.push(ag);
  }
  const defPos = defensiveAlignment(s, offPos);
  for (const k of DEF_SLOTS) {
    const ag = makeAgent(agents.length, 'def', k, s.defense[k], defPos[k], Math.PI);
    slot[k] = ag.i;
    agents.push(ag);
  }
  const off = agents.filter((a) => a.side === 'off').map((a) => a.i);
  const def = agents.filter((a) => a.side === 'def').map((a) => a.i);
  // Icons 1–5: the eligible receivers in read order.
  const icons = (['X', 'Z', 'SLOT', 'TE', 'RB'] as OffSlot[])
    .map((k) => ({ k, a: s.play.assign[k] }))
    .filter((r) => r.a.kind === 'route')
    .sort((p, q) => (p.a.kind === 'route' ? p.a.read : 9) - (q.a.kind === 'route' ? q.a.read : 9))
    .map((r) => slot[r.k]!);
  const c = agents[slot.C!]!;
  const ball: Ball = {
    mode: 'held',
    holder: c.i,
    pos: { x: s.los, y: by, z: 0.12 },
    vel: { x: 0, y: 0, z: 0 },
    target: -1,
    aim: { x: 0, y: 0, z: 0 },
    arrive: 0,
    meant: { x: 0, y: 0 },
    releaseT: -1,
    thrower: -1,
    kind: null,
    spin: 0,
  };
  for (const a of agents) for (let k = 0; k < 3; k++) a.hist.push({ pos: { ...a.pos }, vel: { ...a.vel } });
  // Effort on this snap: ±2% top speed per player (seeded), so no two plays run alike.
  const effort = deriveStream(s.seed, 'effort');
  for (const a of agents) a.fx.vmax *= 1 + (effort() - 0.5) * 0.04;
  for (const a of agents) a.stamina = Math.max(0.2, 1 - (s.fatigue?.[a.slot] ?? 0));
  return {
    setup: s,
    t: 0,
    tick: 0,
    phase: 'presnap',
    snapT: -1,
    agents,
    off,
    def,
    slot,
    ball,
    blocks: [],
    events: [],
    result: null,
    rng: streams(s.seed),
    qb: slot.QB!,
    carrier: -1,
    icons,
    eyes: v2(s.los + 10, by),
    pumpUntil: -1,
    hold: { icon: 0, ticks: 0 },
    windup: null,
    catchType: null,
    hot: {},
    touched: [],
    maxX: -Infinity,
    whistleT: -1,
    runReadT: -1,
    runShow: -1,
    passShow: -1,
    scrambleT: -1,
    escapeT: -1,
    pressureT: -1,
    rally: null,
    pass: undefined,
    sack: false,
    bigHit: undefined,
    read: { idx: 0, since: 0 },
  };
}

export const clampY = (y: number): number => Math.max(-FIELD_HALF_W + 0.5, Math.min(FIELD_HALF_W - 0.5, y));

export const zoneSpot = (s: PlayState, z: ZoneName): V2 => {
  const Z = ZONES[z];
  return v2(s.setup.los + Z.d, clampY((s.setup.ballY ?? 0) * 0.5 + Z.y));
};
