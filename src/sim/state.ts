// A play's state and its setup: both sides aligned from the play and the
// coverage, with the defense aligning to the offense's formation.

import { deriveStream } from '@/engine/rng';
import { effects } from './effects';
import type { RushMove } from './blocks';
import { type Streams, streams } from './rand';
import { defById, DEF_SLOTS, mirrorPlay, OFF_SLOTS, type DefCall, type OffPlay, type RouteName, type ZoneName, ZONES } from './plays';
import type { CatchType } from './input';
import { FIELD_HALF_W, type Agent, type Ball, type DefSlot, type OffSlot, type Phase, type PlayResult, type SimEvent, type SimPlayer } from './types';
import { v2, type V2 } from './vec';

export type Difficulty = 'rookie' | 'pro' | 'legend' | 'beast';

/**
 * Difficulty changes AI reaction and reads, never ratings (GDD §10.4):
 * read latency, pump-fake bite, and how often the coordinator disguises the
 * call (none / light / frequent / frequent; Beast adds simulated pressure,
 * defense.ts).
 */
export const DIFFICULTY: Record<Difficulty, { latency: number; pumpBite: number; disguise: number }> = {
  rookie: { latency: 0.25, pumpBite: 1.4, disguise: 0 },
  pro: { latency: 0.1, pumpBite: 1.0, disguise: 0.15 },
  legend: { latency: 0.03, pumpBite: 0.8, disguise: 0.45 },
  beast: { latency: 0, pumpBite: 0.7, disguise: 0.5 },
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
  /**
   * The user's touch-pass threshold (s): a receiver key held this long or
   * less is a tap (the driven ball), longer is a hold (touch). The player's
   * Settings value, passed in so a replay throws the same ball. Default TAP_MAX.
   */
  tapMax?: number;
  /** Run the play flipped (its mirror image: the strength, the run and the fake to the other side; the line stays put). */
  flip?: boolean;
  /**
   * QB–receiver chemistry, 0–1 per receiver slot (M6.5 #6): a roster
   * synergy between them to start with, growing as the QB keeps going to
   * him over a game (src/game). It tightens the throw to him a little and
   * he finds the ball in the air a little sooner.
   */
  chem?: Partial<Record<OffSlot, number>>;
  /** The down (1–4), when known: on third and fourth down receivers work back to the sticks (M6.5 #7). */
  down?: number;
}

export interface Block {
  /** Blocker (offense) and defender. */
  b: number;
  d: number;
  /** −1 blocker winning … +1 defender sheds. */
  lev: number;
  kind: 'pass' | 'run';
  move: RushMove | 'drive';
  t: number;
  /** This rep's edge at contact (hands, pad level, footwork): the same matchup doesn't play out the same every snap. */
  bias: number;
  /** A pass rush: when (block time, s) the rusher tries his next counter, and how many he's tried. */
  next: number;
  tries: number;
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
  windup: { at: number; from: number; icon: number; charge: number; aim: V2; away: boolean } | null;
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
  /** A toss: when the QB pitched it and from where (the ball flies to the back over PITCH_T). */
  pitch: { t: number; from: V2 } | null;
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
  /** Each defender who got pressure on the QB (his own share ≥ 0.45), when, and the blocker he beat (−1 free). Box-score bookkeeping (play.ts notePressures): not hashed, and nothing in the sim reads it. */
  pressures: { by: number; beat: number; t: number }[];
  /** The defenders who rally to this throw (decided at the release, keyed by it); the rest keep their men and zones. */
  rally: { at: number; who: number[] } | null;
  /** Throw bookkeeping for the result. */
  pass: PlayResult['pass'];
  sack: boolean;
  /** A big hit on this play (for the result). */
  bigHit: PlayResult['bigHit'];
  /** AI QB read state. */
  read: { idx: number; since: number; noise: number; noiseFor: number };
  /** Man assignments resolved to this formation (resolveMan). */
  man: Partial<Record<DefSlot, OffSlot>>;
  /** The coordinator's bracket, resolved to this play: the receiver (agent index), who brackets him and how. */
  bracket: { r: number; by: DefSlot; how: 'shade' | 'lurk' } | null;
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

/**
 * Who each man defender covers on this snap. The call names its men for
 * the formation as drawn (the X split left, the Z right); a corner takes
 * the widest receiver on his side whatever the offense does (a flipped
 * formation, trips to the other side), and whoever the call gave that man
 * to takes the corner's instead.
 */
export function resolveMan(call: DefCall['assign'], offPos: Record<OffSlot, V2>, by: number): Partial<Record<DefSlot, OffSlot>> {
  const res: Partial<Record<DefSlot, OffSlot>> = {};
  for (const slot of DEF_SLOTS) {
    const a = call[slot];
    if (a.kind === 'man') res[slot] = a.on;
  }
  const eligible: OffSlot[] = ['X', 'Z', 'SLOT', 'TE', 'RB'];
  for (const [cb, side] of [['LCB', 1], ['RCB', -1]] as const) {
    if (!res[cb]) continue;
    const widest = eligible.filter((k) => (offPos[k].y - by) * side > 5).sort((p, q) => Math.abs(offPos[q].y - by) - Math.abs(offPos[p].y - by))[0];
    if (!widest || widest === res[cb]) continue;
    const other = DEF_SLOTS.find((k) => k !== cb && res[k] === widest);
    if (other) res[other] = res[cb];
    res[cb] = widest;
  }
  return res;
}

/** A defender who plays like a defensive back (a corner or safety, wherever the package puts him). */
export const isDB = (p: SimPlayer): boolean => p.pos === 'CB' || p.pos === 'S';

/**
 * Where each defender lines up, from the call and the offense's formation.
 * The look is the call's, or its disguise's shell (the call rotates at the
 * snap). A sub defensive back in a linebacker's slot lines up like one: the
 * nickel corner over the slot receiver, the dime safety at 8 yd. Blitzers
 * in the look's `show` walk up into the gaps.
 */
function defensiveAlignment(s: PlaySetup, offPos: Record<OffSlot, V2>, bracketY: number | null): Record<DefSlot, V2> {
  const los = s.los;
  const by = s.ballY ?? 0;
  const look = s.def.shell ? defById(s.def.shell) : s.def;
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
  const call = look.assign;
  const cb = (slot: 'LCB' | 'RCB', rec: { p: V2 } | undefined, sideSign: number) => {
    const a = call[slot];
    const press = a.kind === 'man' && a.press;
    const y = rec ? rec.p.y + sideSign * 0.8 : by + sideSign * 15;
    // Press at the line; off man at ~6.5 yd (the cushion he bails from); a deep third at 7; a flat/cloud corner at 5.5.
    return v2(los + (press ? 1.2 : a.kind === 'man' ? 6.5 : a.kind === 'zone' && ZONES[a.zone].deep ? 7 : 5.5), y);
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
  // Sub defensive backs in linebacker slots.
  for (const slot of ['WLB', 'MLB', 'SLB'] as DefSlot[]) {
    const p = s.defense[slot];
    if (!isDB(p)) continue;
    const a = call[slot];
    const lb = out[slot]!;
    if (p.pos === 'S') {
      out[slot] = v2(los + 8, lb.y * 0.7 + by * 0.3);
      continue;
    }
    // The nickel: over the inside receiver on his side (#2), 5 yd off, a step inside.
    const side = a.kind === 'zone' ? Math.sign(ZONES[a.zone].y) || Math.sign(lb.y - by) || 1 : Math.sign(lb.y - by) || 1;
    const rec = (side > 0 ? left : right)[1] ?? (side > 0 ? left : right)[0];
    out[slot] = rec ? v2(los + 5, rec.p.y - side * 1) : v2(los + 5.5, by + side * 6);
  }
  // Man defenders line up over their man.
  const man = resolveMan(call, offPos, by);
  for (const slot of DEF_SLOTS) {
    const a = call[slot];
    if (a.kind === 'man' && slot !== 'LCB' && slot !== 'RCB') {
      const m = offPos[man[slot]!];
      out[slot] = v2(los + (slot === 'SS' || slot === 'FS' ? 6 : isDB(s.defense[slot]) ? 5 : 4.5), m.y + (m.y > by ? -0.8 : 0.8));
    }
  }
  // Pressure shown: the blitzers walk up into the A and B gaps.
  const gaps = [by + 1.8, by - 1.8, by + 3.2, by - 3.2];
  (look.show ?? []).forEach((slot, j) => (out[slot] = v2(los + 1.3, gaps[j % gaps.length]!)));
  // A bracket shows before the snap too: the free safety shaded toward the man, the robber cheating toward him.
  const b = s.def.bracket;
  if (b && bracketY !== null && out[b.by]) {
    const at = out[b.by]!;
    out[b.by] = v2(at.x, at.y + (bracketY - at.y) * (b.how === 'shade' ? 0.35 : 0.25));
  }
  return out as Record<DefSlot, V2>;
}

export function createPlay(setup: PlaySetup): PlayState {
  // A flipped call runs the mirror image (the setup the play keeps is the one it runs).
  const s: PlaySetup = setup.flip ? { ...setup, play: mirrorPlay(setup.play), flip: false } : setup;
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
  // The bracketed receiver, if he's on the field this play.
  const bk = s.def.bracket ? OFF_SLOTS.find((k) => s.offense[k].id === s.def.bracket!.id) : undefined;
  const defPos = defensiveAlignment(s, offPos, bk ? offPos[bk].y : null);
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
    pitch: null,
    runShow: -1,
    passShow: -1,
    scrambleT: -1,
    escapeT: -1,
    pressureT: -1,
    pressures: [],
    rally: null,
    pass: undefined,
    sack: false,
    bigHit: undefined,
    read: { idx: 0, since: 0, noise: 0, noiseFor: -1 },
    bracket: bk && s.def.bracket ? { r: slot[bk]!, by: s.def.bracket.by, how: s.def.bracket.how } : null,
    man: resolveMan(s.def.assign, offPos, by),
  };
}

/** The receiver a man defender has on this snap (resolveMan), or null. */
export function manOf(s: PlayState, d: Agent): Agent | null {
  const k = s.man[d.slot as DefSlot];
  return k ? s.agents[s.slot[k]!]! : null;
}

export const clampY = (y: number): number => Math.max(-FIELD_HALF_W + 0.5, Math.min(FIELD_HALF_W - 0.5, y));

export const zoneSpot = (s: PlayState, z: ZoneName): V2 => {
  const Z = ZONES[z];
  return v2(s.setup.los + Z.d, clampY((s.setup.ballY ?? 0) * 0.5 + Z.y));
};
