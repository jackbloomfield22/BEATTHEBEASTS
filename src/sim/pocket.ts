// The quarterback's feet and eyes before the throw (docs/passing/PASSING2.md):
// the drop on its rhythm, the hitch up into the pocket, where his eyes are
// from the snap to his first read (the middle of the field, a look-off, or
// staring his man down), and his shoulders turned to where he's looking.
// Pure and deterministic (CLAUDE.md rule 4); the render reads the same plan
// (render/game/choreo.ts) so the drop clip's steps land on the sim's.

import { atan2 } from '@/engine/math/detmath';
import { advance } from './movement';
import type { PlayState } from './state';
import type { Agent } from './types';
import type { Drop } from './plays';

/**
 * The drop's velocity profile, as a share of the drop's time: he builds his
 * speed over the first DROP_A (the open step and the first crossover), runs
 * the middle steps at one pace, and brakes over the last DROP_B into the
 * plant (the last step's heel hits and stops him). A trapezoid; the clips
 * (tools/blender/lib/actions_drop.py) are keyed on the same one, so the
 * drawn feet travel exactly as the sim moves him. Shares ours, from the
 * cadence of coached drops: the plant step is the shortest, the first two
 * the quickest to build.
 */
export const DROP_A = 0.3;
export const DROP_B = 0.2;
const DROP_AREA = 1 - DROP_A / 2 - DROP_B / 2;

/** Share of the drop's depth covered at u (0..1 of its time), and the speed there (depth per unit u). */
export function dropProfile(u: number): { p: number; v: number } {
  const t = Math.max(0, Math.min(1, u));
  const a = DROP_A;
  const b = DROP_B;
  let p: number;
  let v: number;
  if (t < a) {
    v = t / a;
    p = (t * t) / (2 * a);
  } else if (t <= 1 - b) {
    v = 1;
    p = a / 2 + (t - a);
  } else {
    const r = 1 - t;
    v = r / b;
    p = DROP_AREA - (r * r) / (2 * b);
  }
  return { p: p / DROP_AREA, v: v / DROP_AREA };
}

/** Under center the exchange takes this long before the first step (s); from the gun the snap's flight (play.ts ballStep: 0.33 s), less the reach for it. */
export const UC_EXCHANGE = 0.06;
export const GUN_CATCH = 0.28;

/**
 * The hitch (s and yd): off a five- or seven-step drop he steps up into the
 * pocket after the plant, the front foot and a gather, ready to throw on the
 * break (play.ts HITCH is its time). About a yard: the coaching "hitch up".
 */
export const HITCH_D = 0.7;

/**
 * How he takes his drop: turned and running (the hips open to his arm side,
 * crossover steps) or pedalling square (the shoulders to the line, his eyes
 * on the whole field). A drop he can take at a pedal he pedals: its top
 * speed within his backpedal (movement.ts BACKPEDAL, 62% of his top speed,
 * less PEDAL_MARGIN to keep his balance). A quick or athletic quarterback
 * pedals a 3-step; nearly every 5- and 7-step is turned. Ratings decide it:
 * his top speed.
 */
export type DropStyle = 'open' | 'pedal';
const PEDAL_SHARE = 0.62 * 0.9;
const PEDAL_MARGIN = 1;

export interface DropPlan {
  /** Where (yd) and when (s after the snap) the drop starts, its depth (yd) and its time (s) to the plant. */
  x0: number;
  t0: number;
  depth: number;
  T: number;
  style: DropStyle;
}

/**
 * The drop as he'll take it, fixed at its first step (kept on the QB's
 * scratch memory, not hashed): from where he is to the play's depth, by its
 * set. The render calls it with the same agent to choose and time the clip.
 */
export function dropPlan(s: PlayState, qb: Agent): DropPlan | null {
  const m = qb.mem;
  if (m.dropT0 === undefined) return null;
  return planFrom(s, qb, m.dropX0 as number, m.dropT0 as number);
}

/** The drop from `x0` starting `t0` s after the snap (the render asks it at the snap, before the sim's first drop step). */
export function planFrom(s: PlayState, qb: Agent, x0: number, t0: number): DropPlan {
  const drop = s.setup.play.drop;
  const depth = Math.max(0, x0 - (s.setup.los - drop.depth));
  const T = Math.max(0.2, drop.set - t0);
  const peak = (depth / T) * (1 / DROP_AREA);
  const style: DropStyle = peak <= qb.fx.vmax * PEDAL_SHARE * PEDAL_MARGIN ? 'pedal' : 'open';
  return { x0, t0, depth, T, style };
}

/** When the drop starts (s after the snap): after the exchange, the catch, or the fake. */
export function dropStart(s: PlayState, drop: Drop): number {
  const pa = s.setup.play.pa;
  if (pa) return 0.2 + pa.fake;
  return s.setup.play.formation.center ? UC_EXCHANGE : drop.kind.startsWith('gun') ? GUN_CATCH : UC_EXCHANGE;
}

/**
 * One tick of the drop: on its profile to the play's depth, by its set. The
 * velocity is the profile's (a trained movement, not a sprint: every QB
 * hits his coached spot on time), re-centring on the ball across.
 */
export function dropStep(s: PlayState, qb: Agent, face: number): void {
  const since = s.t - s.snapT;
  const drop = s.setup.play.drop;
  const by = s.setup.ballY ?? 0;
  if (since < dropStart(s, drop)) {
    qb.vel = { x: 0, y: 0 };
    advance(qb, 0, face);
    return;
  }
  if (qb.mem.dropT0 === undefined) {
    qb.mem.dropT0 = Math.max(0, since - 1 / 60);
    qb.mem.dropX0 = qb.pos.x;
  }
  const plan = dropPlan(s, qb)!;
  const u = (since - plan.t0) / plan.T;
  const { p, v } = dropProfile(u);
  const want = plan.x0 - plan.depth * p;
  // The profile's speed, and the last few centimetres of any drift taken up.
  const vx = -(plan.depth / plan.T) * v + (want - qb.pos.x) * 4;
  const vy = Math.max(-2, Math.min(2, (by - qb.pos.y) * 2));
  qb.vel = { x: vx, y: vy };
  advance(qb, Math.sqrt(vx * vx + vy * vy), face);
}

/** The hitch: up HITCH_D into the pocket over `T` s from where the drop planted him. */
export function hitchStep(s: PlayState, qb: Agent, T: number, face: number): void {
  const since = s.t - s.snapT;
  const set = s.setup.play.drop.set;
  if (qb.mem.hitchX0 === undefined) qb.mem.hitchX0 = qb.pos.x;
  const { p, v } = dropProfile((since - set) / T);
  const want = (qb.mem.hitchX0 as number) + HITCH_D * p;
  const vx = (HITCH_D / T) * v + (want - qb.pos.x) * 4;
  qb.vel = { x: vx, y: 0 };
  advance(qb, Math.abs(vx), face);
}

// --- The eyes ------------------------------------------------------------------

/**
 * Where his eyes are before his first read (AI and player alike; play.ts
 * qbRead takes over at the read, the player's held icon whenever he holds
 * one). On the drop every QB reads the middle of the field (the safety
 * shell). Then, off a five- or seven-step drop:
 * - a QB who reads the field (Awareness LOOK_OFF_AWARE+, the Field General
 *   range) looks the safety off: his eyes go away from his first read for
 *   the last steps of the drop and the hitch, and come back to it;
 * - anyone else locks on to his first read from there (staring him down).
 * The quick game's eyes go to the first read once he has the ball. The
 * deep safety reads them (ai.ts zoneCover): the look-off moves him away
 * from the throw, the stare-down toward it.
 */
export const LOOK_OFF_AWARE = 0.85;
/** How long before the set the eyes leave the middle for the look-off or the first read (s): the last two steps of the drop. */
export const LOOK_LEAD = 0.35;

export function eyesBeforeRead(s: PlayState, qb: Agent, hitch: number): void {
  const since = s.t - s.snapT;
  const play = s.setup.play;
  const by = s.setup.ballY ?? 0;
  const first = s.icons.length ? s.agents[s.icons[0]!]! : null;
  const quick = play.type === 'quick' || play.type === 'screen';
  if (!first) return;
  if (quick) {
    if (since >= GUN_CATCH) s.eyes = { x: first.pos.x, y: first.pos.y };
    return;
  }
  if (since < play.drop.set - LOOK_LEAD) {
    // The middle of the field: the safety shell, ~18 yd deep over the ball.
    s.eyes = { x: s.setup.los + MOF_DEPTH, y: by };
    return;
  }
  if (lookOff(qb) && since < play.drop.set + hitch) {
    s.eyes = decoy(s, first, by);
    return;
  }
  s.eyes = { x: first.pos.x, y: first.pos.y };
}
/** The middle-of-field read's depth (yd past the line): where the deep safety stands. */
const MOF_DEPTH = 18;

/** He looks the safety off: a field-reading QB (Awareness LOOK_OFF_AWARE and up). */
export const lookOff = (qb: Agent): boolean => qb.fx.a('awareness') >= LOOK_OFF_AWARE;

/** Where a look-off goes: the widest man on the far side from his first read, or that read's mirror across the ball. */
function decoy(s: PlayState, first: Agent, by: number): { x: number; y: number } {
  const side = Math.sign(first.pos.y - by) || 1;
  let best: Agent | null = null;
  for (const k of s.icons) {
    const a = s.agents[k]!;
    if ((a.pos.y - by) * side < -2 && (!best || Math.abs(a.pos.y - by) > Math.abs(best.pos.y - by))) best = a;
  }
  return best ? { x: Math.max(best.pos.x, s.setup.los + 10), y: best.pos.y } : { x: Math.max(first.pos.x, s.setup.los + 10), y: by - (first.pos.y - by) };
}

/**
 * His shoulders: turned to where his eyes are, as far as a set QB turns in
 * the pocket (QB_TURN either way: past it he resets his feet, which is a
 * turn of the body, not the trunk). The feet follow the eyes: "eyes, then
 * feet" in every QB school; the throw then goes off a front foot pointed at
 * the target. Facing has no other effect in the sim (the QB is a circle in
 * contact.ts), so it's only how he stands.
 */
export function qbFace(s: PlayState, qb: Agent): number {
  const dx = s.eyes.x - qb.pos.x;
  const dy = s.eyes.y - qb.pos.y;
  if (dx * dx + dy * dy < 1) return 0;
  const a = atan2(dy, dx);
  return Math.max(-QB_TURN, Math.min(QB_TURN, a));
}
/** ~80°: a right-hander can set to the far sideline from the pocket. */
const QB_TURN = 1.4;
