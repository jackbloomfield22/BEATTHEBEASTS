import * as THREE from 'three';
import { carrierPace, GOAL_X, manOf, pullers, TAP_MAX, TICK } from '@/sim';
import type { PlayerAnimator } from '@/anim/animator';
import type { Ragdoll } from '@/anim/ragdoll';
import type { Agent, PlayState, SimEvent } from '@/sim';
import type { Player } from '../players/playerAsset';
import { YARD } from '../world/constants';
import { worldDir, worldX, worldY, worldZ } from '@/game/coords';
import { latency } from '@/game/latency';
import { catchAhead, findsBallAt, laneAhead, LANE_MAX, releaseOf, type CatchLook } from '@/sim/passing';
import { has } from '@/sim/traits';
import { arrivalOf, catchStyle, contactAt, meetTime, pluckOf, type CatchStyle } from '@/sim/catchstyle';
import { dropPlan, dropStart, GUN_CATCH, planFrom, UC_EXCHANGE, type DropPlan } from '@/sim/pocket';
import { pressureOn, routeOf } from '@/sim/ai';
import { boxOut } from '@/sim/bodies';
import { threatOf } from '@/sim/moves';
import type { BodyExtent } from './contact';

// The choreographer: which clip each player plays, from the sim's state and
// events (TECH_PLAN §9.2). The sim decides everything; this only picks and
// times the motion: the QB's drop and a throw whose release frame lands on
// the sim's release, a catch whose secure frame lands on the ball's arrival,
// the carrier's tuck and moves, the form tackle, the fall (ragdoll) and the
// get-up after the whistle.

export interface Body {
  /** Who the body is dressed as (player id) and in which kit (personnel can change the man in a slot). */
  who: string;
  kit: string;
  player: Player;
  animator: PlayerAnimator;
  ragdoll: Ragdoll;
  slot: string;
  lastYaw: number;
  lastSpeed: number;
  /** Per-play bookkeeping: the throw (its windup's start, and the clip it plays) and the ball arrival already animated. */
  throwAt: number;
  throwClip: string | null;
  catchFor: number;
  /** After a fall: where he lies (world x, z) and his yaw, instead of the sim's spot. */
  lie: { x: number; z: number; yaw: number; prone: boolean; up?: boolean } | null;
  /** He has gone down this play (a fall, a tackle or a dive clip): never twice. */
  fallen: boolean;
  /** A clip that ends with him lying down (the tackle, the dive) is playing. */
  lyingClip: boolean;
  /** The drawn facing (rad), turned toward the sim's at a limited rate so a change of heading is a turn, not a snap. */
  yaw: number;
  /** The speed fed to the gait, eased (a move's sidestep shouldn't jolt the stride). */
  gaitSpeed: number;
  /** One-shot clips already played this play (the handoff, the fake). */
  once: Set<string>;
  /** The catch clip playing for this play's catch (M6.5 #5), or null. */
  catchClip: string | null;
  /** M6.5 #11: a dive reaching the ball out (the ball in the hand at full length). */
  reach: boolean;
  /** Downed bodies he has hurdled this play (never twice over the same man). */
  hurdled: Set<number>;
  /** The AI carrier's heading (rad) and when it was read (sim s), and the last cut played (sim s). */
  head: number;
  headT: number;
  cutAt: number;
  /** His trunk's measured extent (contact.ts), from his position, height and weight. */
  ext: BodyExtent;
  /** Passing round 8: the throw's drawn arm slot (throwSlot): the throw it rides, its eased weight (− side-arm, + over the top), the last sim time and the released throw's lane. */
  armSlot?: { base: string | null; w: number; t: number; lane: number | null };
  /** M6.5 #12: the man he's contesting a catch with (body index) until this sim time, or null. */
  contest: { with: number; until: number } | null;
  /** Passing round 5: the catch being drawn (its style, his pluck) and where his hands met the ball, or null. */
  grip: CatchGrip | null;
  /** Passing round 5: his share of a contested pair's lean (contact.ts): 0.5 even, more for the man who boxes the other out. */
  box: number;
  /** Passing round 6: the arm the ball is carried in (carrySide), or null before he has it. */
  carry?: CarryArm | null;
}

/**
 * The ball's arm (passing round 6): which arm it's in, the arm he wants it
 * in and since when (sim s), and a switch under way (from which arm, and
 * when it started), the ball crossing his chest under both hands.
 */
export interface CarryArm {
  side: 'l' | 'r';
  want: 'l' | 'r';
  since: number;
  from: 'l' | 'r';
  at: number;
}

/**
 * The catch being drawn (passing round 5): its style (sim/catchstyle.ts), his
 * pluck (how far out his hands meet it), and the hands' targets at the
 * ball in his root's frame with their weight, kept so the hands stay on the
 * ball through the catch tick and give with it into the clip, instead of
 * snapping back to the clip's pose the frame the sim calls it caught.
 */
export interface CatchGrip {
  style: CatchStyle;
  pluck: number;
  l: THREE.Vector3;
  r: THREE.Vector3;
  w: number;
  /** The hands have been put on the ball where the sim took it (passing round 7: catchSpot), once, on the first frame drawn after the catch. */
  met?: boolean;
}

/** Upper body, for a throw on the run (the legs keep running). */
export const THROW_MASK = [
  'spine_02', 'spine_03', 'spine_04', 'neck_01', 'neck_02', 'head',
  ...['l', 'r'].flatMap((s) => ['clavicle', 'upperarm', 'upperarm_twist', 'forearm', 'forearm_twist', 'hand', 'fingers_01', 'fingers_02', 'fingers_03', 'index_01', 'index_02', 'index_03', 'thumb_01', 'thumb_02', 'thumb_03'].map((b) => `${b}_${s}`)),
];

const RELEASE_FRAME = 11 / 30;
const SECURE = 0.2;
const TACKLE_CONTACT = 8 / 30;
/** The tackle clip's going-down key (tools/blender/lib/actions.py tackle: `going` at 0.6 s). */
const TACKLE_GOING = 0.6;
/** The sim's fall, from his feet going to a knee down (sim/tackle.ts FALL_T). */
const SIM_FALL_T = 0.3;
/** The dive's reach, when the clip has no `reach` event (actions.py dive: the hands at the legs ~0.3 s). */
const DIVE_REACH_T = 0.3;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** New play: forget clips, falls and per-play state. */
export function resetBody(b: Body): void {
  b.ragdoll.stop();
  b.throwAt = -1;
  b.throwClip = null;
  b.catchFor = -1;
  b.lie = null;
  b.fallen = false;
  b.lyingClip = false;
  b.once.clear();
  b.catchClip = null;
  b.reach = false;
  b.hurdled.clear();
  b.headT = -1;
  b.cutAt = -9;
  b.contest = null;
  b.grip = null;
  b.box = 0.5;
  b.carry = null;
  b.armSlot = undefined;
  b.animator.setSlot(null, null, 0);
  b.animator.onTurn = null;
}

// --- Contested catches (M6.5 #12) ---------------------------------------------------
// A defender at the catch point plays through the receiver: his contest
// overlay (tools/blender/lib/actions_m65_contact.py) puts the near hand on
// the receiver's hip and the far arm across to the ball, timed so its
// contact frame lands on the arrival, and the two lean into each other
// (contact.ts) instead of being drawn through each other.

/** A defender this close to the receiver at the ball's arrival (yd, predicted) contests it. */
export const CONTEST_R = 1.2;
/** How far ahead of the arrival (s) the contest is read: the overlay's lead to its contact frame and a little. */
const CONTEST_LOOKAHEAD = 0.45;
/** The pair stays in contact this long after the arrival (s): the rake and the fight for the ball. */
const CONTEST_HOLD = 0.45;

/**
 * The defender contesting the ball to target `i` at its arrival: the
 * nearest standing defender whose predicted spot at the arrival is within
 * CONTEST_R of the receiver's, or -1. `side` is where the receiver is from
 * the defender's run (+1 his left, -1 his right).
 */
export function contestFor(s: PlayState, i: number): { d: number; side: 1 | -1 } | null {
  const a = s.agents[i]!;
  const T = Math.max(0, s.ball.arrive - s.t);
  const ax = a.pos.x + a.vel.x * T;
  const ay = a.pos.y + a.vel.y * T;
  let best = -1;
  let bd = CONTEST_R;
  for (const j of s.def) {
    const o = s.agents[j]!;
    if (o.down || o.side === a.side) continue;
    const k = Math.hypot(o.pos.x + o.vel.x * T - ax, o.pos.y + o.vel.y * T - ay);
    if (k < bd) {
      bd = k;
      best = j;
    }
  }
  if (best < 0) return null;
  const o = s.agents[best]!;
  const sp = Math.hypot(o.vel.x, o.vel.y);
  const hx = sp > 1 ? o.vel.x / sp : Math.cos(o.face);
  const hy = sp > 1 ? o.vel.y / sp : Math.sin(o.face);
  // The sim's y is to the left of its x: positive cross is on his left.
  const rx = ax - (o.pos.x + o.vel.x * T);
  const ry = ay - (o.pos.y + o.vel.y * T);
  return { d: best, side: hx * ry - hy * rx >= 0 ? 1 : -1 };
}

/**
 * Per frame, before the bodies are driven: start the contest at a catch
 * point and return the pairs in contact now (body indices).
 */
export function contests(bodies: Body[], s: PlayState, simT: number, out: [number, number][]): [number, number][] {
  out.length = 0;
  const ball = s.ball;
  const i = ball.target;
  if (ball.mode === 'air' && i >= 0 && s.agents[i]!.side === 'off') {
    const b = bodies[i];
    const left = ball.arrive - simT;
    if (b && !b.contest && left <= CONTEST_LOOKAHEAD && left > 0) {
      const c = contestFor(s, i);
      const d = c ? bodies[c.d] : undefined;
      if (c && d && !d.fallen && !d.contest) {
        const until = ball.arrive + CONTEST_HOLD;
        b.contest = { with: c.d, until };
        d.contest = { with: i, until };
        // Who wins the spot (passing round 5): the bigger, stronger man boxes the other out.
        b.box = boxShare(s.agents[i]!, s.agents[c.d]!);
        d.box = 1 - b.box;
        const clip = c.side > 0 ? 'def_contest_l' : 'def_contest_r';
        const lead = eventAt(d, clip, 'contact');
        if (lead !== null) d.animator.playOverlay(clip, { t0: Math.max(0, lead - left) });
      }
    }
  }
  for (let k = 0; k < bodies.length; k++) {
    const c = bodies[k]!.contest;
    if (!c) continue;
    if (simT > c.until || s.phase === 'dead') {
      bodies[k]!.contest = null;
      bodies[k]!.box = 0.5;
      continue;
    }
    if (c.with > k) out.push([k, c.with]);
  }
  return out;
}

/**
 * A contested pair's share of the lean into each other (contact.ts) that the
 * receiver takes: 0.5 even; the bigger, stronger man drives into the other
 * and holds his spot (Gronk boxing out). The sim's own body-position terms
 * (passing.ts resolveCatch BOX_MASS, BOX_STR: the mass share and the
 * Strength gap) times BOX_LEAN, and a Big Body's box-out (+0.1, the trait's
 * "ball in front of the defender"). Ours: a 265-lb tight end with
 * Strength 85 on a 200-lb safety takes ~0.7 of it.
 */
export function boxShare(r: Agent, d: Agent): number {
  // (Passing round 8: the sim's own box-out, sim/bodies.ts boxOut, which also holds his ground in the bodies' push.)
  return Math.max(0.25, Math.min(0.8, 0.5 + BOX_LEAN * (boxOut(r, d) - boxOut(d, r))));
}
/** How far a unit of the box-out moves the lean share. Ours: Gronkowski on a safety (~0.7) takes ~0.75 of it. */
const BOX_LEAN = 0.35;

function lyingClip(b: Body, name: string, t0 = 0): void {
  b.animator.play(name, { now: true, t0 });
  b.fallen = true;
  b.lyingClip = true;
  // A clip that lays him down turned (the dive toward the ball) turns his
  // root by as much as it hands over, so he lies where the clip left him.
  b.animator.onTurn = (deg) => {
    const r = b.player.root;
    r.rotation.y += (deg * Math.PI) / 180;
    b.lie = { x: r.position.x, z: r.position.z, yaw: r.rotation.y, prone: true };
    b.lyingClip = false;
    b.animator.onTurn = null;
  };
}

// --- The catch (M6.5 #5) ------------------------------------------------------
// The catch call and the ball decide the look (sim/passing.ts catchLook);
// this picks the clip for it, starts it so its secure frame meets the ball,
// holds the ball in the hands until the clip's tuck, and puts him down with
// it on a SECURE catch in traffic.

/** Catch clips that drive the whole body (the rest are overlays over the legs' gait). */
const CATCH_FULL = new Set(['catch_high_point', 'catch_body_down', 'catch_dive_l', 'catch_dive_r', 'catch_toe_tap_l', 'catch_toe_tap_r']);
/** Overlays that start their whole lead before the ball (passing round 8: the box-out posts up for half a second, then the late hands). */
const POSTED = new Set(['catch_box_l', 'catch_box_r']);
/** The ones that leave him lying on the ball. */
const CATCH_LYING = new Set(['catch_body_down', 'catch_dive_l', 'catch_dive_r']);
/**
 * A body catch lets the ball into his chest (BODY_MEET, m from his centre:
 * passing round 5): its secure frame comes that much after the ball reaches
 * his line (at most MEET_LATE_MAX past its arrival), the ball flying on past
 * his hands into him. Every other catch is secured on the sim's own catch,
 * at his hands (passing round 6: sim/passing.ts handsAt, the pluck).
 */
const BODY_MEET = 0.22;
const MEET_LATE_MAX = 0.06;
/** Late hands: an in-stride catch's hands come up this long (s) before the ball. Receiver coaching: the arms pump until the last moment (a corner reads early hands); the clip's reach is keyed 0.17 s out. */
const LATE_HANDS = 0.2;
/** How far ahead of the ball's arrival (s) the look is asked for: the longest lead (the high point's gather and jump, 0.73 s) and a little. */
const CATCH_LOOKAHEAD = 0.9;
/** Below this (yd, ~0.9 m: the belt) a hands catch is taken with the pinkies together. */
const LOW_HANDS = 1.0;
/** A receiver who boxes the man out at least this well (sim/bodies.ts boxOut: Gronkowski on a safety ~0.7, Tony Gonzalez ~0.55, Kelvin Benjamin on a corner ~0.7, Terrell Owens ~0.2) posts up for it (catch_box). Ours. */
const BOX_CLIP = 0.4;
/** Over the shoulder, a ball taken below this (yd, ~1.1 m: just above the belt) drops into the low basket (catch_over_shoulder_low: the hands at 0.84 m, the high basket's at 1.69 m; tools/blender/measure_reach.py). Ours: between them, nearer the low one, where a hand catch turns its pinkies together (LOW_HANDS). */
const LOW_SHOULDER = 1.2;
/** GO UP leaps only for a ball arriving at least this high (yd, ~1.6 m: the shoulders). */
const LEAP_MIN = 1.75;
/** The drawn ball bends into the hands only when they're this close to its flight (m); farther, a pull would read as a warp. */
const MAGNET_NEAR = 0.45;
const MAGNET_FAR = 1.0;

/** The sim's own looks (passing.ts catchLook) as drawn styles: the catch event's final word on what the catch does. */
const LOOK_STYLE: Record<CatchLook, CatchStyle> = { dive: 'dive', oneHand: 'oneHand', highPoint: 'highPoint', overShoulder: 'overShoulder', toeTap: 'toeTap', body: 'body', hands: 'hands' };

/** The clip for a catch style (sim/catchstyle.ts), from where the ball is going relative to his run. */
export function catchClip(s: PlayState, i: number, style: CatchStyle): string {
  const a = s.agents[i]!;
  const ball = s.ball;
  const sp = Math.hypot(a.vel.x, a.vel.y);
  const hx = sp > 1 ? a.vel.x / sp : Math.cos(a.face);
  const hy = sp > 1 ? a.vel.y / sp : Math.sin(a.face);
  // The sim's y is to the left of its x: a point is on his left when the cross product is positive.
  const leftOf = (dx: number, dy: number) => hx * dy - hy * dx > 0;
  const T = Math.max(0, ball.arrive - s.t);
  const aimLeft = leftOf(ball.aim.x - (a.pos.x + a.vel.x * T), ball.aim.y - (a.pos.y + a.vel.y * T));
  switch (style) {
    case 'hands': {
      // (Passing round 8) Chosen from where the sim will take it (catchAhead), not the aim: a ball led a stride
      // ahead is taken out at the end of his reach, the whole upper body extended into it (catch_reach_out).
      const at = catchPoint(s, a);
      if (at.z < LOW_HANDS) return 'catch_hands_run_low';
      return at.ahead > REACH_OUT_FROM && at.z < HIGH_OUT ? 'catch_reach_out' : 'catch_hands_run';
    }
    case 'handsHigh':
      return 'catch_hands_high';
    case 'handsLow':
      return 'catch_hands_run_low';
    case 'scoop':
      return 'catch_scoop';
    case 'reach':
      return arrivalOf(s, a).across > 0 ? 'catch_reach_l' : 'catch_reach_r';
    case 'body':
      return 'catch_body';
    case 'contested': {
      // The near shoulder into the man: the side he'll be on at the arrival.
      const d = contactAt(s, a);
      if (!d) return 'catch_hands_run';
      const left = leftOf(d.pos.x + d.vel.x * T - (a.pos.x + a.vel.x * T), d.pos.y + d.vel.y * T - (a.pos.y + a.vel.y * T));
      // (Passing round 8) A big, strong man boxes him out (sim/bodies.ts boxOut, which the sim's contest and tackle use):
      // posted up, the near forearm a bar on the man, then up for it over him.
      if (boxOut(a, d) >= BOX_CLIP) return left ? 'catch_box_l' : 'catch_box_r';
      return left ? 'catch_contested_l' : 'catch_contested_r';
    }
    case 'highPoint':
      // GO UP on a ball he can't jump for (it arrives below his shoulders):
      // leaping over it would read wrong, so he attacks it with his hands.
      return ball.aim.z >= LEAP_MIN ? 'catch_high_point' : ball.aim.z < LOW_HANDS ? 'catch_hands_run_low' : 'catch_hands_run';
    case 'overShoulder': {
      // Over the shoulder on the side the ball is dropping in from. (Passing round 8) A ball the sim will take below
      // his belt (catchAhead, not the aim: round seven's falling deep ball is taken where it gets to him) drops into
      // the low basket at his hip, pinkies together; higher, the hands go up in front of the face mask.
      const left = leftOf(ball.pos.x - a.pos.x, ball.pos.y - a.pos.y);
      if (catchPoint(s, a).z < LOW_SHOULDER) return left ? 'catch_over_shoulder_low_l' : 'catch_over_shoulder_low_r';
      return left ? 'catch_over_shoulder_l' : 'catch_over_shoulder_r';
    }
    case 'dive':
      return aimLeft ? 'catch_dive_l' : 'catch_dive_r';
    case 'toeTap':
      // The upper body leans out over the nearer sideline.
      return leftOf(0, ball.aim.y >= 0 ? 1 : -1) ? 'catch_toe_tap_l' : 'catch_toe_tap_r';
    case 'oneHand':
      return aimLeft ? 'catch_one_hand_l' : 'catch_one_hand_r';
  }
}

/**
 * Where the sim will take the ball against him (passing round 8): out in
 * front of where he'll be (m, along his run) and its height (yd), from the
 * tick it gets to his hands (sim/passing.ts catchAhead), or the throw's aim
 * when it never does.
 */
export function catchPoint(s: PlayState, a: Agent): { ahead: number; z: number } {
  const c = catchAhead(s, a);
  const dt = c ? c.dt : Math.max(0, s.ball.arrive - s.t);
  const p = c ? c.pos : s.ball.aim;
  const sp = Math.hypot(a.vel.x, a.vel.y);
  const hx = sp > 1 ? a.vel.x / sp : Math.cos(a.face);
  const hy = sp > 1 ? a.vel.y / sp : Math.sin(a.face);
  return { ahead: ((p.x - (a.pos.x + a.vel.x * dt)) * hx + (p.y - (a.pos.y + a.vel.y * dt)) * hy) * YARD, z: p.z };
}
/** The lunge into a ball at the end of his reach: the press input (× animator.ts PRESS_PITCH, 0.12 rad), from this long before the secure frame to this long after it (s of clip). Ours: ~10 degrees at full weight, eased in over ~0.2 s (sim/passing.ts REACH_OUT counts on ~0.05 m of it). */
const LUNGE = 1.5;
const LUNGE_FROM = 0.3;
const LUNGE_HOLD = 0.1;
/** A chest-high ball taken further than this (m) ahead of his centre is the forward reach: the chest catch's straight arms put the finger roots 0.67 m ahead (tools/blender/measure_reach.py), the reach out 1.00. Ours: between them. */
const REACH_OUT_FROM = 0.78;
/** ...below this (yd, ~1.6 m: the shoulders); higher, the hands go up over the face mask instead. */
const HIGH_OUT = 1.75;

/** Seconds (drawn time) until the sim calls the catch for him: the tick the ball gets to his hands (sim/passing.ts catchAhead), or its arrival at its aim when it never does. */
function simCatchIn(s: PlayState, a: Agent, simT: number): number {
  const ahead = catchAhead(s, a);
  return (ahead ? ahead.dt : Math.max(0, s.ball.arrive - s.t)) + (s.t - simT);
}

/** Pace the catch clip so its secure frame lands on the sim's catch (between PACE_MIN and PACE_MAX of its own speed; at its own speed from the secure frame on). */
function paceCatch(b: Body, s: PlayState, a: Agent, simT: number): void {
  const c = b.catchClip!;
  const t = catchTime(b);
  const sec = eventAt(b, c, 'secure');
  if (t === null || sec === null) return;
  const left = simCatchIn(s, a, simT);
  const rate = t >= sec || left <= 0 ? 1 : Math.max(PACE_MIN, Math.min(PACE_MAX, (sec - t) / left));
  const tr = b.animator.transition;
  if (tr && tr.name === c && !tr.done) b.animator.retime(c, { rate });
  else b.animator.retimeOverlay(c, rate);
}
/** How far the catch clip's pace may bend to meet the sim's catch (× its keyed speed). Ours: past these the hands visibly rush or stall. */
const PACE_MIN = 0.6;
const PACE_MAX = 1.6;

/**
 * The throw's arm slot (passing round 8). Round seven's throwing lane moves
 * his release up to LANE_MAX off a lineman whose hands are in the line of the
 * throw (sim/passing.ts throwingLane), and the throw looked the same. Now the
 * throw playing is laid over with its side-arm version (the release moved to
 * his throwing side: the elbow drops and he slings it round the man) or its
 * over-the-top one (to his glove side: tall, the glove shoulder down, the
 * hand over the helmet), keyed in-house on the same timing
 * (tools/blender/lib/actions_p8.py throw_slot), weighted by how far he moved
 * it: through the windup by the lane he'd find for the throw as it would go
 * now (laneAhead), from the release by the throw's own (its event's lane).
 * The QB is himself in it: the move is his Pocket Presence's (none for a man
 * with none), the motion his Release's (quick, long, the fade), and a QB who
 * throws Off-Platform slings it lower on the run.
 */
function throwSlot(b: Body, s: PlayState, qb: Agent, simT: number, running: boolean): void {
  const anim = b.animator;
  const sl = (b.armSlot ??= { base: null, w: 0, t: simT, lane: null });
  const dt = Math.max(0, Math.min(0.1, simT - sl.t));
  sl.t = simT;
  if (b.throwClip && sl.base !== b.throwClip) {
    sl.base = b.throwClip;
    sl.lane = null;
  }
  const base = sl.base;
  const tr = anim.transition;
  if (!base || !anim.lib.meta[`${base}_side`] || (tr?.name !== base && anim.overlayAction?.name !== base)) {
    sl.base = null;
    sl.w = 0;
    anim.setSlot(null, null, 0);
    return;
  }
  const w = s.windup;
  let lane: number;
  if (w && b.throwAt === w.from) {
    // Winding up: the lane he'd take for this throw now.
    const rec = s.agents[s.icons[w.icon] ?? -1];
    lane = w.away || !rec ? 0 : laneAhead(s, qb, rec, w.charge, w.aim);
  } else {
    // Out of his hand: the lane he took (the throw event's).
    if (sl.lane === null) {
      let ev: SimEvent | undefined;
      for (let k = s.events.length - 1; k >= 0 && !ev; k--) if (s.events[k]!.type === 'throw' && s.events[k]!.who?.[0] === qb.i) ev = s.events[k];
      if (ev) sl.lane = Number(ev.data?.lane ?? 0);
    }
    lane = sl.lane ?? 0;
  }
  const target = SLOT_K * Math.max(-1, Math.min(1, lane / LANE_MAX - (running && has(qb, 'off-platform') ? SLING : 0)));
  sl.w += (target - sl.w) * (1 - Math.exp(-dt * SLOT_RATE));
  anim.setSlot(base, `${base}_${sl.w < 0 ? 'side' : 'over'}`, Math.abs(sl.w));
}
/** The most of a slot variant drawn (at the full move, LANE_MAX): three-quarters to side-arm, or nearly over the top; the rest of the move is the slide and the ball's own blend onto its line (ballFlight.ts). Ours: the AI book moves the release on 56% of throws, by 0.3 yd or more on a third (tools/sim/p8_lane.ts), and a pure side-arm on one throw in three would read as a gimmick. */
const SLOT_K = 0.8;
/** The arm slot eases to where he wants it at this rate (1/s: ~0.1 s, a beat of the windup). Ours. */
const SLOT_RATE = 12;
/** An Off-Platform QB on the run drops his arm this far toward side-arm (of the slot's full weight). Ours: the broadcast's off-balance sling. */
const SLING = 0.35;

/** A clip this library has, or the in-stride hands catch (an older library without passing round five's set). */
function clipOr(b: Body, clip: string): string {
  return b.animator.lib.meta[clip] ? clip : 'catch_hands_run';
}

/**
 * The throwing motion for this QB and this throw (tools/blender/lib/actions_pass.py):
 * with a rusher in his face (pressure past FADE_PRESSURE) standing, the
 * fade-away off his back foot; else by how quick his release is: the
 * compact motion for a quick one (Marino, Brees), the loop for a long one,
 * the M4 throw between. On the run the upper body's version rides over
 * the legs. An older library without the set: the M4 throw.
 */
export function throwClip(b: Body, s: PlayState, qb: Agent, running: boolean): string {
  const has = (n: string) => !!b.animator.lib.meta[n];
  if (!running && has('qb_throw_fade') && pressureOn(s, qb) >= FADE_PRESSURE) return 'qb_throw_fade';
  const rel = releaseOf(qb);
  if (rel <= QUICK_RELEASE && has('qb_throw_quick')) return 'qb_throw_quick';
  if (rel >= LONG_RELEASE && has('qb_throw_long')) return 'qb_throw_long';
  return 'qb_throw';
}
/** A rusher this close (the sim's pressure, 0..1: a free man within ~2.4 yd) puts him on his back foot. Ours. */
const FADE_PRESSURE = 0.6;
/** Held past his release (the player choosing the touch), the arm waits this far (s of clip) short of the release frame: cocked, the ball behind the ear. Ours: a frame at 30 fps. */
const COCKED = 1 / 30;
/** Release times (s, effects.ts releaseTime: 0.45 s at 70 Release → 0.30 at 99) that read as quick (~88+) and long (~74 and under). */
const QUICK_RELEASE = 0.345;
const LONG_RELEASE = 0.43;

/** A clip event's time (s), or null when the clip or the event is missing. */
function eventAt(b: Body, clip: string, ev: string): number | null {
  const f = b.animator.lib.meta[clip]?.events?.[ev];
  return f === undefined ? null : f / b.animator.lib.fps;
}

/** Start a catch clip at t0 (s into it). */
function startCatch(b: Body, clip: string, t0: number): void {
  b.catchClip = clip;
  if (CATCH_LYING.has(clip)) lyingClip(b, clip, t0);
  else if (CATCH_FULL.has(clip)) b.animator.play(clip, { now: true, t0 });
  else b.animator.playOverlay(clip, { t0 });
}

/** The catch clip's time now, or null when it isn't the one playing. */
function catchTime(b: Body): number | null {
  const c = b.catchClip;
  if (!c) return null;
  const tr = b.animator.transition;
  if (tr && tr.name === c && !tr.done) return tr.t;
  const ov = b.animator.overlayAction;
  if (ov && ov.name === c) return ov.t;
  return null;
}

function catchHands(clip: string): 'two' | 'l' | 'r' {
  return clip.startsWith('catch_one_hand_') ? (clip.endsWith('_l') ? 'l' : 'r') : 'two';
}

/**
 * The ball held in the hands through a catch clip: from its secure frame
 * until the tuck, in both hands or in one, with `k` easing off into the
 * tuck (along the forearm) over the last 0.1 s.
 */
export function catchHold(b: Body): { hands: 'two' | 'l' | 'r'; k: number } | null {
  const t = catchTime(b);
  const c = b.catchClip;
  if (t === null || !c) return null;
  const secure = eventAt(b, c, 'secure');
  const tuck = eventAt(b, c, 'tuck');
  if (secure === null || tuck === null || t < secure - HOLD_EARLY || t >= tuck) return null;
  return { hands: catchHands(c), k: 1 - THREE.MathUtils.smoothstep(t, tuck - 0.1, tuck) };
}

const _p = new THREE.Vector3();

/** Where the ball sits in the catching hands (world): between the palms, or in the one hand. */
function handsPoint(b: Body, hands: 'two' | 'l' | 'r', out: THREE.Vector3): boolean {
  const bones = b.player.bones;
  const l = bones.get(hands === 'r' ? 'fingers_01_r' : 'fingers_01_l');
  const r = bones.get(hands === 'l' ? 'fingers_01_l' : 'fingers_01_r');
  if (!l || !r) return false;
  l.getWorldPosition(out);
  r.getWorldPosition(_p);
  out.add(_p).multiplyScalar(0.5);
  return true;
}

/**
 * The ball's last frames in the air bend into the hands: over the 0.12 s
 * before the clip's secure frame the drawn ball eases from the sim's flight
 * onto the catching hands (render only; the sim's ball is untouched).
 * Returns the blend (0: the sim's position) and writes the hands point.
 */
export function catchMagnet(b: Body, ball: THREE.Vector3, out: THREE.Vector3): number {
  const t = catchTime(b);
  const c = b.catchClip;
  if (t === null || !c) return 0;
  // A bobble's hands meet it again on its regrab, not its first touch.
  const secure = eventAt(b, c, c === 'catch_bobble' ? 'regrab' : 'secure');
  if (secure === null) return 0;
  const k = THREE.MathUtils.smoothstep(t, secure - 0.12, secure);
  if (k <= 0 || !handsPoint(b, catchHands(c), out)) return 0;
  return k * (1 - THREE.MathUtils.smoothstep(ball.distanceTo(out), MAGNET_NEAR, MAGNET_FAR));
}

/**
 * The sim can call the catch a few ticks before the clip's secure frame (it's
 * the tick the ball comes within his reach: passing round 3 measured 0.03-0.06
 * s early on the driven slant and out): the ball is put in his hands from
 * this far (s of clip) before that frame, not along his forearm.
 */
const HOLD_EARLY = 0.1;

/** The run-speed catches whose hands go to the ball (the full-body ones are keyed to their own reach). */
// (Passing round 6: and the high point and the toe tap, full-body clips keyed to a fixed reach: on the recorded toe tap the ball came in 0.4 m from where the clip held the hands.)
const REACH_CLIPS = new Set(['catch_hands_run', 'catch_reach_out', 'catch_hands_run_low', 'catch_hands_high', 'catch_scoop', 'catch_reach_l', 'catch_reach_r', 'catch_contested_l', 'catch_contested_r', 'catch_box_l', 'catch_box_r', 'catch_over_shoulder_l', 'catch_over_shoulder_r', 'catch_over_shoulder_low_l', 'catch_over_shoulder_low_r', 'catch_one_hand_l', 'catch_one_hand_r', 'catch_high_point', 'catch_toe_tap_l', 'catch_toe_tap_r']);
/** The hands come to the ball over this long (s of clip) before the secure frame: the late hands. */
const REACH_IN = 0.2;
/** How far the hands can go for it (m from between the shoulders) at full weight, and past which they don't chase it. Ours: a long arm's reach. */
const REACH_NEAR = 0.75;
const REACH_FAR = 1.15;
/** His eyes stay on the ball into his hands this long past the secure frame (s): "look it into the tuck". Ours: the clips bring it to the sternum ~0.15 s after the secure. */
const EYES_IN = 0.15;
/** Gravity in yd/s² (sim/ball.ts G in m/s², over a yard). */
const G_YD = 9.81 / 0.9144;
const _bp = new THREE.Vector3();
const _hl = new THREE.Vector3();
const _hr = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _bd = new THREE.Vector3();
const _ac = new THREE.Vector3();

/**
 * The hands to the ball (passing round 3). The catch clips reach to a fixed
 * spot in front of the chest, and the drawn ball was bent from its flight
 * into them over its last 0.12 s (catchMagnet), so a ball coming in at his
 * shoulder or across his body curved into his chest. Now, over the reach,
 * his hands go to where the ball will be at the clip's secure frame (the
 * sim's flight, run forward), either side of it and a little behind it (the
 * diamond, the basket), and the ball comes into them on its own line. Render
 * only; after the animator's update.
 */
export function catchReach(b: Body, i: number, s: PlayState, drawn: THREE.Vector3 | null = null): void {
  const c = b.catchClip;
  const g = b.grip;
  if (!c || !REACH_CLIPS.has(c)) return;
  const ball = s.ball;
  const t = catchTime(b);
  const secure = eventAt(b, c, 'secure');
  const tuck = eventAt(b, c, 'tuck');
  if (t === null || secure === null || tuck === null) return;
  const root = b.player.root;
  const one = c.startsWith('catch_one_hand_') ? (c.endsWith('_l') ? 'l' : 'r') : null;
  if (ball.mode !== 'air' || ball.target !== i) {
    // Caught (passing round 5): the hands stay on the ball where they met it
    // (in his own frame, so they ride with him) and give with it into the
    // clip's own secure and tuck over GIVE_T, instead of dropping to the
    // clip's pose the frame the sim calls it caught (round four's in-game
    // log: the hands 0.4 m off the ball one frame, on the belt the next).
    if (!g || (g.w <= 0 && g.met !== false) || ball.mode !== 'held' || ball.holder !== i) return;
    // (Passing round 6) The catch frame (the last tick in the air drawn into the catch): the hands go onto
    // the ball where it's drawn on its flight, and hold there in his frame through the give.
    // (Passing round 7: also when the frame drawn after the catch is already past the catch tick, as at 30 fps
    // when the sim takes it on the first of the frame's two ticks: once, where the sim took it.)
    const spot = drawn ?? (g.met ? null : catchSpot(b, s.agents[i]!, null));
    if (spot) {
      _bd.set(worldX(ball.vel.y) - worldX(0), 0, worldZ(ball.vel.x) - worldZ(0));
      if (_bd.lengthSq() < 1e-6) _bd.set(0, 0, 1);
      _bd.normalize();
      handsOn(b, drawn ? catchSpot(b, s.agents[i]!, drawn) : spot, _bd, one);
      root.worldToLocal(g.l.copy(_hl));
      root.worldToLocal(g.r.copy(_hr));
      g.w = 1;
      g.met = true;
    }
    const k = g.w * (1 - THREE.MathUtils.smoothstep(t, secure, secure + GIVE_T));
    if (k <= 0) return;
    root.localToWorld(_hl.copy(g.l));
    root.localToWorld(_hr.copy(g.r));
    b.animator.reachHands(one === 'r' ? null : _hl, k, one === 'l' ? null : _hr, k);
    return;
  }
  let w = THREE.MathUtils.smoothstep(t, secure - REACH_IN, secure - 0.02);
  if (w <= 0) return;
  // The ball at the secure frame (sim yd, z up): where the sim will call the
  // catch (passing round 6: the tick it gets to his hands, its own flight
  // stepped forward), else its flight run forward to the secure frame.
  const ahead = catchAhead(s, s.agents[i]!);
  const dt = Math.max(0, Math.min(0.3, secure - t));
  if (ahead) _bp.set(worldX(ahead.pos.y), worldY(ahead.pos.z), worldZ(ahead.pos.x));
  else _bp.set(worldX(ball.pos.y + ball.vel.y * dt), worldY(ball.pos.z + ball.vel.z * dt - 0.5 * G_YD * dt * dt), worldZ(ball.pos.x + ball.vel.x * dt));
  // Not for a ball he can't get his hands to.
  const bones = b.player.bones;
  const sl = bones.get('upperarm_l');
  const sr = bones.get('upperarm_r');
  if (!sl || !sr) return;
  sl.getWorldPosition(_sh);
  sr.getWorldPosition(_hl);
  _sh.add(_hl).multiplyScalar(0.5);
  w *= 1 - THREE.MathUtils.smoothstep(_sh.distanceTo(_bp), REACH_NEAR, REACH_FAR);
  if (w <= 0) {
    if (g) g.w = 0;
    return;
  }
  // (Passing round 6 tracked the ball where it was drawn over the last tenth of a second. Passing round 7: on a
  // crosser or a slant the ball comes in from his side, ~13 yd/s across him, so a tenth of a second out it's a yard
  // to his side and the hands went out there after it: the catch was drawn beside him. They stay on the sim's
  // catch, out in front, and the catch frame puts the ball there: catchSpot.)
  // Either side of it across its line, a little behind it (the hands meet it, the ball comes into them).
  _bd.set(worldX(ball.vel.y) - worldX(0), 0, worldZ(ball.vel.x) - worldZ(0));
  if (_bd.lengthSq() < 1e-6) _bd.set(0, 0, 1);
  _bd.normalize();
  handsOn(b, _bp, _bd, one);
  // Kept in his frame for the give after the catch tick.
  if (g) {
    root.worldToLocal(g.l.copy(_hl));
    root.worldToLocal(g.r.copy(_hr));
    g.w = w;
  }
  b.animator.reachHands(one === 'r' ? null : _hl, w, one === 'l' ? null : _hr, w);
}
/**
 * Where the ball is drawn on the catch frame (passing round 7): where it was
 * against his body on the tick the sim took it (sim/play.ts atHands,
 * mem.catchRel), from where his body is drawn. The frame drawn across the
 * catch tick is interpolated between the last tick in the air and the catch
 * (at 30 fps it's the tick before), and on a ball coming in from his side
 * that's 0.2 m further out to the side than where it's caught: round six drew
 * the crosser caught 0.6 m beside him and 0.2 m in front, where the sim took
 * it 0.5 m in front and 0.2 m to the side (tools/sim/p7_ahead.ts, the diag log).
 * Falls back to `drawn` (the interpolated ball) with no catch on record.
 */
const _cs = new THREE.Vector3();
export function catchSpot(b: Body, a: Agent, drawn: THREE.Vector3): THREE.Vector3;
export function catchSpot(b: Body, a: Agent, drawn: THREE.Vector3 | null): THREE.Vector3 | null;
export function catchSpot(b: Body, a: Agent, drawn: THREE.Vector3 | null): THREE.Vector3 | null {
  const rel = a.mem.catchRel as { x: number; y: number } | null | undefined;
  const z = a.mem.catchRelZ as number | undefined;
  if (!rel || typeof z !== 'number' || typeof a.mem.caughtAt !== 'number') return drawn;
  const root = b.player.root.position;
  return _cs.set(root.x + worldX(rel.y), worldY(z), root.z + worldZ(rel.x) - worldZ(0));
}

/** The hand targets (_hl, _hr, world) on a ball at `at` flying along `dir` (horizontal, unit): either side of it across its line, a little behind it; one hand on it for a one-hander. */
function handsOn(b: Body, at: THREE.Vector3, dir: THREE.Vector3, one: 'l' | 'r' | null): void {
  const bones = b.player.bones;
  const sl = bones.get('upperarm_l');
  const sr = bones.get('upperarm_r');
  if (sl && sr) {
    sl.getWorldPosition(_hl);
    sr.getWorldPosition(_sh);
    _sh.add(_hl).multiplyScalar(0.5);
  }
  // (Its own vector: round five built it in _hr, which the right hand's target then overwrote mid-expression, so the right hand went off the ball's line.)
  const across = _ac.set(dir.z, 0, -dir.x);
  // Which of those is his left: the side his left shoulder is on.
  const leftSign = (_hl.x - _sh.x) * across.x + (_hl.z - _sh.z) * across.z >= 0 ? 1 : -1;
  _hl.copy(at).addScaledVector(dir, -HANDS_BEHIND).addScaledVector(across, HANDS_APART * leftSign);
  _hr.copy(at).addScaledVector(dir, -HANDS_BEHIND).addScaledVector(across, -HANDS_APART * leftSign);
  if (one) (one === 'l' ? _hl : _hr).copy(at).addScaledVector(dir, -HANDS_BEHIND);
}

/** After the catch the hands hold where they met the ball and give into the clip's own pose over this long (s of clip): the absorb, then the ball brought in. Ours: the clip's give and its ball at the sternum are keyed 0.05 and 0.15 s after the secure frame. */
const GIVE_T = 0.16;
/** The hands' spread either side of the ball (m: about its width) and how far behind it along its flight they meet it (m). Ours. */
const HANDS_APART = 0.1;
const HANDS_BEHIND = 0.05;

// --- The ball carrier (M6.5 #11) -----------------------------------------------
// The sim decides where he goes; this picks how he moves: the carrier's gait
// families (space, traffic by the sim's context pace, the burst's drive),
// the press of a designed run, the plant-and-cut on the sim's cut, the dip
// before contact, the hurdle over a downed man, the reach for the line, and
// where his eyes are.

/** A cut's clip gives way to the burst's drive gait this long (clip s) after its push-off: the first step out of the plant is the clip's. */
const CUT_RELEASE = 0.05;
/** A cut this sharp (deg) or more plays the deep plant (the sim's cuts run 30° to 180°). */
const SHARP_CUT = 75;
/** Traffic is all the way in at the sim's slowest context pace (carrierPace: 0.86 with a free tackler at 1.2 yd). */
const TRAFFIC_PACE = 0.86;
/** A designed run presses the hole until he's this far past the line (yd). */
const PRESS_UNTIL = 1;
/** The dip: a free tackler closing inside this (yd), within 60° of his run, all the way in by DIP_FULL. */
const DIP_R = 1.6;
const DIP_FULL = 0.9;
/** His eyes go to the nearest free tackler inside this (yd); farther, he scans upfield. */
const LOOK_R = 9;
/** An AI carrier whose run turns faster than this (rad/s) at speed (yd/s) plays the light cut. */
const AI_CUT_RATE = 2.5;
const AI_CUT_SPEED = 5;
/** A dive reaches the ball out within this (yd) of the goal line or the line to gain. */
const REACH_R = 2.2;
/** The ball's nose ahead of his body (yd): sim/play.ts BALL_NOSE. */
const NOSE = 0.4;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The plant-and-cut, timed so its plant spans the sim's (dur, s; null: the clip's own pace). */
function playCut(b: Body, side: 'L' | 'R', deg: number, dur: number | null, simT: number): void {
  const name = `${deg >= SHARP_CUT ? 'cut_plant_sharp' : 'cut_plant'}_${side === 'L' ? 'l' : 'r'}`;
  if (!b.animator.lib.meta[name]) return;
  const plant = eventAt(b, name, 'plant') ?? 0.1;
  const push = eventAt(b, name, 'push') ?? 0.3;
  const rate = dur ? Math.max(0.6, Math.min(1.8, (push - plant) / dur)) : 1;
  // In just before the plant foot lands: the sim's plant has started.
  b.animator.play(name, { now: true, rate, t0: Math.max(0, plant - 0.04) });
  b.cutAt = simT;
}

/** A dive near the goal line or the line to gain reaches the ball out for it. */
export function reachDive(s: PlayState, i: number): boolean {
  const a = s.agents[i]!;
  const attack = a.side === 'off' ? 1 : -1;
  const nose = a.pos.x + attack * NOSE;
  const toGoal = ((attack > 0 ? GOAL_X : 0) - nose) * attack;
  if (toGoal > -0.3 && toGoal < REACH_R) return true;
  if (a.side !== 'off') return false;
  const gain = s.setup.los + s.setup.toGo;
  return gain < GOAL_X && gain - nose > -0.3 && gain - nose < REACH_R;
}

/**
 * The dip before contact: a free tackler closing in front of him (within
 * 60° of his run) and inside DIP_R. + on his left, − on his right; the size
 * grows as he closes.
 */
export function dipFor(s: PlayState, i: number): number {
  const a = s.agents[i]!;
  const d = threatOf(s, a);
  if (!d) return 0;
  const rx = d.pos.x - a.pos.x;
  const ry = d.pos.y - a.pos.y;
  const k = Math.hypot(rx, ry);
  if (k > DIP_R || k < 1e-3) return 0;
  const sp = Math.hypot(a.vel.x, a.vel.y);
  const attack = a.side === 'off' ? 1 : -1;
  const hx = sp > 1 ? a.vel.x / sp : attack;
  const hy = sp > 1 ? a.vel.y / sp : 0;
  if ((rx * hx + ry * hy) / k < 0.5) return 0;
  // Closing: the gap shrinking (their relative velocity along the line between them).
  const closing = -((d.vel.x - a.vel.x) * rx + (d.vel.y - a.vel.y) * ry) / k;
  if (closing < 0.5) return 0;
  const w = clamp01((DIP_R - k) / (DIP_R - DIP_FULL));
  // The sim's y is to the left of its x: positive cross is on his left.
  return (hx * ry - hy * rx >= 0 ? 1 : -1) * w;
}

/** How much of his run is traffic: the sim's context pace (1 in space, 0.86 with a free tackler at 1.2 yd). */
export function trafficOf(s: PlayState, i: number): number {
  const a = s.agents[i]!;
  return clamp01((1 - carrierPace(s, a, a.side === 'off' ? 1 : -1)) / (1 - TRAFFIC_PACE));
}

/**
 * A full-body clip owns him (no dip, no hurdle, no AI cut over it); a cut
 * once he has pushed off is only running back into his stride, so a
 * hurdle or a dip may take over from there.
 */
function clipBusy(b: Body, tr: { name: string; t: number; done: boolean } | null): boolean {
  if (!tr || tr.done || tr.name === 'getup_prone') return false;
  if (tr.name.startsWith('cut_plant')) return tr.t < (eventAt(b, tr.name, 'push') ?? 0.3) + 0.06;
  return true;
}

function carrierDrive(b: Body, i: number, s: PlayState, simT: number, out: Drive, busy: boolean): void {
  const a = s.agents[i]!;
  const anim = b.animator;
  const attack = a.side === 'off' ? 1 : -1;
  out.carry = 1;
  let traffic = trafficOf(s, i);
  // A designed run presses the hole: pitched into it, patient choppy steps, until he's through the line.
  if (s.setup.play.run && a.side === 'off' && (a.pos.x - s.setup.los) * attack < PRESS_UNTIL) {
    out.press = 1;
    traffic = Math.max(traffic, 0.5);
  }
  out.traffic = traffic;
  out.drive = a.burst > 0 ? 1 : 0;
  // Out of a cut into the burst: once he has pushed off, the cut's own run-out steps give way to the drive.
  const tr = anim.transition;
  if (a.burst > 0 && tr && !tr.done && tr.name.startsWith('cut_plant') && tr.t > (eventAt(b, tr.name, 'push') ?? 0.3) + CUT_RELEASE) anim.release();
  const moving = !busy && a.busy <= 0;
  out.dip = moving ? dipFor(s, i) : 0;
  const sp = Math.hypot(a.vel.x, a.vel.y);
  // An AI carrier's sharp turn at speed reads as a (light) cut; the player's cuts come from the sim's cut event.
  const user = s.setup.user && a.side === 'off';
  if (!user && sp > AI_CUT_SPEED && moving) {
    const h = Math.atan2(a.vel.y, a.vel.x);
    if (b.headT < 0) {
      b.head = h;
      b.headT = simT;
    } else if (simT - b.headT >= 1 / 30) {
      const turn = Math.atan2(Math.sin(h - b.head), Math.cos(h - b.head)) / (simT - b.headT);
      b.head = h;
      b.headT = simT;
      if (Math.abs(turn) > AI_CUT_RATE && simT - b.cutAt > 0.8) playCut(b, turn > 0 ? 'L' : 'R', 45, null, simT);
    }
  } else b.headT = -1;
  // Eyes: on the nearest free tackler in front of him or beside him, else scanning upfield.
  const d = threatOf(s, a);
  if (d && Math.hypot(d.pos.x - a.pos.x, d.pos.y - a.pos.y) < LOOK_R) out.look = _look.set(-d.pos.y * YARD, 1.7, (50 - d.pos.x) * YARD);
  else {
    const ax = a.pos.x + attack * 12;
    const ay = a.pos.y + 5 * Math.sin(simT * 1.3 + i);
    out.look = _look.set(-ay * YARD, 1.6, (50 - ax) * YARD);
  }
}

/** Up off the turf mid-play (the sim's get-up): from wherever the fall or the clip left him. */
function getUp(b: Body): void {
  if (!b.fallen) return;
  if (b.ragdoll.active) {
    b.lie = b.ragdoll.handOff();
    b.animator.reset();
  }
  if (!b.lie) {
    const r = b.player.root;
    b.lie = { x: r.position.x, z: r.position.z, yaw: r.rotation.y, prone: true };
  }
  b.lyingClip = false;
  b.lie.up = true;
  b.animator.play(b.lie.prone ? 'getup_prone' : 'getup_supine', { now: true });
}

const _s3 = new THREE.Vector3();
const sub3 = (a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 => _s3.subVectors(a, b);

function fall(b: Body, vel: THREE.Vector3, push: THREE.Vector3, big = false): void {
  if (b.fallen && !b.lyingClip) return;
  b.lyingClip = false;
  b.fallen = true;
  b.ragdoll.start(vel, push, big);
}

/** The snap: get-offs out of the stances, the QB's drop. */
export function onSnap(bodies: Body[], s: PlayState, stanceOf: (slot: string) => string): void {
  const play = s.setup.play;
  const pull = pullers(play);
  const has = (b: Body, n: string) => !!b.animator.lib.meta[n];
  bodies.forEach((b, i) => {
    const a = s.agents[i]!;
    if (i === s.qb) {
      const k = play.drop.kind;
      // The drop on the sim's rhythm (startDrop); a play-action drop starts after the fake (drive), a boot rolls out on the gait.
      if (k !== 'handoff' && !play.pa && !play.drop.boot) startDrop(b, s, planFrom(s, a, a.pos.x, dropStart(s, play.drop)), 0);
      else if (k !== 'handoff' && play.run) b.animator.play(`qb_drop_${k}`, { now: true });
      return;
    }
    const slot = a.slot as string;
    // Line play (M6 clips): pass sets kick-slide at the tackles and set at
    // the guards and center; runs fire off and drive; power and counter
    // pull the backside guard down the line.
    if (a.side === 'off' && OL.has(slot)) {
      if (play.run) {
        const dirL = play.run.aim >= 0;
        if ((slot === pull.kick || slot === pull.lead) && has(b, 'ol_pull_l')) b.animator.play(dirL ? 'ol_pull_l' : 'ol_pull_r', { now: true });
        else if (has(b, 'ol_fire_drive')) b.animator.play('ol_fire_drive', { now: true });
      } else if ((slot === 'LT' || slot === 'RT') && has(b, 'ol_kick_slide_l')) b.animator.play(slot === 'LT' ? 'ol_kick_slide_l' : 'ol_kick_slide_r', { now: true });
      else if (has(b, 'stance_ol_pass')) b.animator.setStance('stance_ol_pass');
      return;
    }
    // Linebackers read the backfield before they go.
    if (a.side === 'def' && LB.has(slot) && has(b, 'lb_read_step')) {
      b.animator.play('lb_read_step', { now: true });
      return;
    }
    // Pressed corners jam at the line.
    const asg = s.setup.def.assign[slot as keyof typeof s.setup.def.assign];
    if (a.side === 'def' && asg && asg.kind === 'man' && asg.press && has(b, 'db_press_jam_l')) {
      const on = s.agents.find((x) => x.side === 'off' && x.slot === asg.on);
      b.animator.play(on && on.pos.y > a.pos.y ? 'db_press_jam_l' : 'db_press_jam_r', { now: true });
      return;
    }
    const st = stanceOf(b.slot);
    const off = `getoff_${st.slice(7)}`;
    if (b.animator.lib.meta[off]) b.animator.play(off);
    else b.animator.setStance('stance_idle');
  });
}

/**
 * The drop clip for the sim's plan (tools/blender/lib/actions_drop.py),
 * turned or pedalled as the sim decides (pocket.ts dropPlan), at the rate
 * that lands its plant on the sim's set: the clip's steps are keyed on the
 * same profile as the sim's drop, so the feet and the body agree. `t0` skips
 * the snap or exchange (a play-action drop, started after the fake).
 */
function startDrop(b: Body, s: PlayState, plan: DropPlan, t0: number): void {
  const k = s.setup.play.drop.kind;
  const lib = b.animator.lib.meta;
  const name = plan.style === 'pedal' && lib[`qb_drop_${k}_pedal`] ? `qb_drop_${k}_pedal` : `qb_drop_${k}`;
  const m = lib[name];
  if (!m) return;
  const ts = k.startsWith('gun') ? GUN_CATCH : UC_EXCHANGE;
  const rate = Math.max(0.6, Math.min(1.6, (m.duration - ts) / plan.T));
  b.once.add('drop');
  b.animator.play(name, { now: true, rate, t0: t0 > 0 ? ts : 0 });
}

const OL = new Set(['LT', 'LG', 'C', 'RG', 'RT']);
const LB = new Set(['WLB', 'MLB', 'SLB']);

/** Pass-rush moves (sim/blocks.ts RushMove) to the M6 clips; the side is where the rusher goes around the blocker. */
const RUSH_CLIP: Record<string, string | null> = { bull: 'dl_bull_rush', longArm: 'dl_bull_rush', swim: 'dl_swim', rip: 'dl_rip', club: 'dl_club', spin: 'dl_spin', speed: null };

function worldVel(s: PlayState, i: number): THREE.Vector3 {
  const a = s.agents[i]!;
  const [x, z] = worldDir(a.vel.x, a.vel.y);
  return _v.set(x * YARD, 0, z * YARD);
}

/** Sim events this frame: moves, catches, hits. */
export function onEvents(bodies: Body[], s: PlayState, events: SimEvent[]): void {
  for (const e of events) {
    const who = e.who ?? [];
    const a = who[0] !== undefined ? bodies[who[0]] : undefined;
    switch (e.type) {
      case 'engage': {
        // A block is on: the rusher's move, and a bull rush meets an anchor.
        const blk = a;
        const d = who[1] !== undefined ? bodies[who[1]] : undefined;
        if (!blk || !d) break;
        const mv = String(e.data?.move ?? '');
        const clip = RUSH_CLIP[mv];
        const side = s.agents[who[1]!]!.pos.y > s.agents[who[0]!]!.pos.y ? 'l' : 'r';
        if (clip) {
          const name = clip === 'dl_bull_rush' ? clip : `${clip}_${side}`;
          if (d.animator.lib.meta[name]) d.animator.play(name, { now: true });
        }
        if ((mv === 'bull' || mv === 'longArm') && blk.animator.lib.meta.ol_anchor) blk.animator.play('ol_anchor', { now: true });
        else if (!s.setup.play.run && blk.animator.lib.meta.ol_punch_mirror_l && !blk.once.has('punch')) {
          blk.once.add('punch');
          blk.animator.play(side === 'l' ? 'ol_punch_mirror_l' : 'ol_punch_mirror_r', { now: true });
        }
        break;
      }
      case 'shed': {
        // Off the block: the rusher throws the blocker by.
        if (!a || a.fallen || e.data?.whiff) break;
        const bl = who[1] !== undefined ? s.agents[who[1]] : undefined;
        const side = bl && s.agents[who[0]!]!.pos.y > bl.pos.y ? 'l' : 'r';
        const name = `dl_shed_${side}`;
        // A lineman sheds with the full-body clip; anyone else gets off with pads low into the chase.
        if (s.agents[who[0]!]!.slot.match(/^(LE|RE|LDT|RDT)$/) && a.animator.lib.meta[name]) a.animator.play(name, { now: true });
        else a.animator.playOverlay('ovl_getoff');
        break;
      }
      case 'move': {
        if (!a) break;
        const mv = e.data?.move;
        const kind = mv === 'jukeL' || mv === 'jukeR' ? 'juke' : mv;
        if (kind === 'juke' || kind === 'spin' || kind === 'stiffArm' || kind === 'truck' || kind === 'hurdle' || kind === 'dive') latency.respond(kind);
        if (mv === 'tuck') a.animator.playOverlay('ovl_tuck');
        else if (mv === 'slide') lyingClip(a, 'qb_slide');
        else if (mv === 'redirect') a.animator.play(Number(e.data?.side ?? 1) > 0 ? 'rush_redirect_l' : 'rush_redirect_r', { now: true });
        else if (mv === 'jukeL') a.animator.play('juke_l', { now: true });
        else if (mv === 'jukeR') a.animator.play('juke_r', { now: true });
        else if (mv === 'spin') a.animator.play('spin', { now: true });
        else if (mv === 'dive') {
          // Near the goal line or the sticks the ball goes out for it (M6.5 #11).
          const reach = !!a.animator.lib.meta.dive_reach && reachDive(s, who[0]!);
          a.reach = reach;
          lyingClip(a, reach ? 'dive_reach' : 'dive');
        } else if (mv === 'cut') {
          // The player's planted cut (sim/play.ts plantCut): the plant lands in the sim's plant.
          const dur = Number(e.data?.dur ?? 0);
          playCut(a, e.data?.side === 'L' ? 'L' : 'R', Number(e.data?.deg ?? 45), dur > 0 ? dur : null, s.t);
        } else if (mv === 'stiffArm') a.animator.playOverlay('ovl_stiff_arm');
        else if (mv === 'truck') {
          // Pads low, the forearm up and through, the legs driving (full body at speed; the overlay standing).
          const v = s.agents[who[0]!]!.vel;
          if (a.animator.lib.meta.truck && Math.hypot(v.x, v.y) > 2.5) a.animator.play('truck', { now: true });
          else a.animator.playOverlay('ovl_truck');
        }
        else if (mv === 'hurdle' && a.animator.lib.meta.hurdle) {
          // Over the man in front (the sim's hurdle move): the clip starts so its flight's `over` frame comes as he meets him.
          // (Over a man on the turf, the sim says when he gets there: `tc`.)
          const c = s.agents[who[0]!]!;
          const d = threatOf(s, c);
          const sp = Math.hypot(c.vel.x, c.vel.y);
          const tc = e.data?.tc !== undefined ? Number(e.data.tc) : d && sp > 1 ? Math.hypot(d.pos.x - c.pos.x, d.pos.y - c.pos.y) / (sp + Math.max(0, Math.hypot(d.vel.x, d.vel.y) * 0.5)) : 0.4;
          if (e.data?.over !== undefined) a.hurdled.add(Number(e.data.over));
          const over = eventAt(a, 'hurdle', 'over') ?? 0.6;
          a.animator.play('hurdle', { now: true, t0: Math.max(0, Math.min(0.35, over - tc)) });
        } else if (mv === 'pumpFake') a.animator.playOverlay('ovl_pump');
        else if (mv === 'stumble') a.animator.playOverlay(Number(e.data?.over ?? 0) % 2 ? 'ovl_dip_l' : 'ovl_dip_r');
        else if (mv === 'getup') getUp(a);
        else if (mv === 'secureDown') {
          // SECURE in traffic: the cradle turns into going down with it (from the catch's secure frame on).
          a.animator.stopOverlay();
          a.catchClip = 'catch_body_down';
          lyingClip(a, 'catch_body_down', eventAt(a, 'catch_body_down', 'secure') ?? 0);
        }
        break;
      }
      case 'bobble': {
        // Off his hands and up (the sim's bobble): the hands follow it up and come back together under it (actions_pass.py catch_bobble).
        if (!a || !a.animator.lib.meta.catch_bobble) break;
        if (a.catchClip && CATCH_FULL.has(a.catchClip) && catchTime(a) !== null) break;
        a.catchClip = 'catch_bobble';
        a.animator.playOverlay('catch_bobble', { t0: eventAt(a, 'catch_bobble', 'secure') ?? SECURE });
        break;
      }
      case 'catch': {
        // Secured on the second chance: pulled in from the regrab (catch_resecure).
        if (a && e.data?.bobble && a.animator.lib.meta.catch_resecure) {
          startCatch(a, 'catch_resecure', eventAt(a, 'catch_resecure', 'secure') ?? 0);
          break;
        }
        // The final look: if the prediction a beat ago was a different one,
        // switch to it at its secure frame (a full-body clip already under
        // way is committed and plays on).
        if (!a) break;
        const look = e.data?.look as CatchLook | undefined;
        if (look) {
          // (Passing round 5) An in-stride catch keeps the style it was drawn
          // with a beat ago (where the ball got to him and who he is,
          // sim/catchstyle.ts): restarting it at the ball is the pop round four
          // saw. A catch the sim calls a dive, a toe tap, a jump, one hand,
          // over the shoulder or SECURE does what the sim says.
          const drawing = a.catchClip !== null && catchTime(a) !== null;
          const secures = a.catchClip === 'catch_body' || a.catchClip?.startsWith('catch_contested_') === true || a.catchClip?.startsWith('catch_box_') === true;
          const keep = drawing && (look === 'hands' || (look === 'body' && secures));
          const want0 = keep ? a.catchClip! : clipOr(a, catchClip(s, who[0]!, LOOK_STYLE[look]));
          // (Passing round 6) The same catch on the other side (over the other shoulder, the other sideline) is the one already drawn: the ball is in
          // his hands out in front of him now, so the side read off it at the catch can differ from the one read as it came; restarting it was a pop.
          // (Passing round 8: and over the shoulder high or low is the one already drawn, chosen from where the sim would take it.)
          const family = (c: string) => c.replace(/_[lr]$/, '').replace(/_low$/, '');
          const want = drawing && family(a.catchClip!) === family(want0) ? a.catchClip! : want0;
          const committed = drawing && CATCH_FULL.has(a.catchClip!);
          if (a.catchClip !== want && !committed) startCatch(a, want, eventAt(a, want, 'secure') ?? SECURE);
        } else if (!a.catchClip) a.animator.playOverlay('ovl_catch', { t0: SECURE });
        break;
      }
      case 'drop':
      case 'deflection': {
        // Off his hands (a drop, or the ball knocked out of them): the hands
        // spring apart and chase it down (actions_pass.py catch_drop). A
        // full-body catch already under way (the high point, the dive) plays on.
        const r = e.type === 'drop' ? who[0] : who[1];
        const rb = r !== undefined ? bodies[r] : undefined;
        if (!rb || r === undefined || s.agents[r]!.side !== 'off' || !rb.animator.lib.meta.catch_drop) break;
        if (rb.catchClip && CATCH_FULL.has(rb.catchClip) && catchTime(rb) !== null) break;
        rb.catchClip = null;
        rb.animator.playOverlay('catch_drop', { t0: eventAt(rb, 'catch_drop', 'secure') ?? SECURE });
        break;
      }
      case 'interception':
        // Already reaching (the catch overlay started before the ball got there)? Let it finish into the tuck.
        if (a && a.animator.overlayAction?.name.startsWith('ovl_catch') !== true) a.animator.playOverlay('ovl_catch', { t0: SECURE });
        break;
      case 'missedTackle':
        if (a && e.data?.dive) lyingClip(a, 'dive');
        // An Ankle Breaker's juke: the man who bit is on the turf (the sim knocked him down).
        else if (a && e.data?.fell && who[0] !== undefined) fall(a, worldVel(s, who[0]).clone().multiplyScalar(0.6), _w.set(0, 0.3, 0));
        break;
      case 'brokenTackle': {
        // He's out of it (sim/tackle.ts): through an arm, out of a hold, or a man put on the turf.
        const t = who[1] !== undefined ? bodies[who[1]] : undefined;
        if (!t || who[0] === undefined || who[1] === undefined) break;
        const how = String(e.data?.how ?? '');
        if (e.data?.flat) {
          // Run over, stiff-armed or spun to the ground: off his feet, away from the ball carrier.
          if (!t.fallen || t.lyingClip) {
            const away = sub3(t.player.root.position, bodies[who[0]]!.player.root.position);
            away.y = 0;
            if (away.lengthSq() < 1e-4) away.set(1, 0, 0);
            away.normalize().multiplyScalar(how === 'truck' || how === 'runOver' ? 2.6 : 1.8);
            away.y = 0.5;
            fall(t, worldVel(s, who[1]).clone().multiplyScalar(0.5), away);
          }
        } else if (how === 'runThrough' && !t.fallen) {
          // A hand on him that didn't hold: the reach across and the rake (the contest overlay's arm).
          const c = s.agents[who[0]]!;
          const d = s.agents[who[1]]!;
          const side = (c.pos.y - d.pos.y) * Math.cos(d.face) - (c.pos.x - d.pos.x) * Math.sin(d.face) > 0 ? 'l' : 'r';
          const clip = `def_contest_${side}`;
          if (t.animator.lib.meta[clip]) t.animator.playOverlay(clip, { t0: eventAt(t, clip, 'contact') ?? 0.3 });
        }
        break;
      }
      case 'hit': {
        // Contact (sim/tackle.ts): the tackler's clip lands on the hit and is
        // timed to the hold. The ball carrier stays up and fights; he falls
        // when the sim says his feet are gone (the tackle event).
        const t = a;
        if (!t || t.fallen) break;
        const kind = String(e.data?.kind ?? 'wrap');
        if (kind === 'ankle') {
          // At his shoestrings: the dive, from its reach.
          lyingClip(t, 'dive', eventAt(t, 'dive', 'reach') ?? DIVE_REACH_T);
          break;
        }
        lyingClip(t, 'tackle', TACKLE_CONTACT);
        // Slowed while he rides him, so the clip's going-down lands on the sim's fall (`eta`, s from now).
        const eta = Number(e.data?.eta ?? 0.6);
        const rate = Math.max(0.35, Math.min(1.4, (TACKLE_GOING - TACKLE_CONTACT) / Math.max(0.05, eta - SIM_FALL_T)));
        t.animator.retime('tackle', { rate });
        if (kind === 'big' && who[1] !== undefined) {
          const c = bodies[who[1]];
          if (c) c.animator.stopOverlay();
        }
        break;
      }
      case 'tackle':
      case 'sack': {
        const t = a;
        const c = who[1] !== undefined ? bodies[who[1]] : undefined;
        // The men who had him go down with him: their tackle clips catch up to going down.
        for (const k of [who[0], ...String(e.data?.assists ?? '').split(',').filter((x) => x !== '').map(Number)]) {
          const b = k !== undefined && k >= 0 ? bodies[k] : undefined;
          if (b) {
            b.animator.retime('tackle', { t: TACKLE_GOING, rate: 1 });
          }
        }
        if (e.data?.fall === 'held') break;
        if (c && c.fallen) break;
        if (c && who[1] !== undefined) {
          // The fall the sim decided: his momentum, and his upper body thrown the way he's going down
          // (forward over a man at his legs, back off a square hit, sideways off a hit from the side).
          const vel = worldVel(s, who[1]).clone();
          const big = !!e.data?.big;
          const fx = Number(e.data?.fx ?? NaN);
          const fy = Number(e.data?.fy ?? NaN);
          const push = _w.set(0, 0, 0);
          if (Number.isFinite(fx) && Number.isFinite(fy)) {
            const [x, z] = worldDir(fx, fy);
            push.set(x, 0, z);
          } else if (t && who[0] !== undefined && who[0] >= 0) {
            push.subVectors(c.player.root.position, t.player.root.position).setY(0);
          }
          if (push.lengthSq() < 1e-4) push.set(0, 0, 1);
          // The launch: harder on a big hit, but capped (4.5 m/s across, a little lift): a
          // man is knocked off his feet and back, not thrown across the field.
          const force = Number(e.data?.force ?? s.bigHit?.force ?? 5);
          // Held in a tackle he's taken down, not launched: a gentle topple the way the sim says (at 2 m/s and a lift he cartwheeled clear of the men who had him).
          const mag = big ? Math.min(4.5, 1.5 + Math.min(4, force * 0.35) * 1.5) : e.data?.fall === 'forward' ? 0.9 : 0.7;
          push.normalize().multiplyScalar(mag);
          push.y = big ? 1.1 : 0.1;
          fall(c, vel.multiplyScalar(big ? 0.8 : 0.5), push, big);
        }
        break;
      }
    }
  }
}

/**
 * Where a man is looking (passing round 2). The QB: the sim's eyes (the
 * middle of the field on the drop, a look-off, his reads: pocket.ts). A
 * receiver on a timing route brings his head round to the QB coming out of
 * his break and has the ball from the release; on a vertical his eyes are up
 * the field until he finds the ball (the sim's findsBallAt), then he looks
 * back for it over his shoulder (lookWide: the chest turns with the head),
 * and tracks it into his hands. Defenders in zone have their eyes on the QB,
 * in man on their man, and go to the ball once they've read the throw (the
 * sim's onBall); after the catch everyone looks at the ball carrier (his own
 * eyes are carrierDrive's).
 */
function eyesFor(i: number, s: PlayState, simT: number, out: Drive): void {
  const a = s.agents[i]!;
  const ball = s.ball;
  if (s.phase === 'presnap' || a.down) return;
  const at = (x: number, y: number, h: number) => (out.look = _look.set(-y * YARD, h, (50 - x) * YARD));
  const atBall = () => at(ball.pos.x, ball.pos.y, Math.max(ball.pos.z, 0.9) * YARD);
  const air = ball.mode === 'air';
  if (i === s.qb) {
    if (air) atBall();
    else if (s.phase !== 'carrier') at(s.eyes.x, s.eyes.y, 1.6);
    return;
  }
  if (s.phase === 'carrier' || s.phase === 'dead') {
    const c = s.carrier >= 0 ? s.agents[s.carrier]! : null;
    if (c && i !== s.carrier) at(c.pos.x, c.pos.y, 1.2);
    return;
  }
  if (a.side === 'off') {
    if (!a.route) return;
    const timing = TIMING_ROUTES.has(routeOf(s, a) ?? '');
    const outOfBreak = a.route.idx >= 1 || a.route.pts.length === 1;
    if (air && ball.target === i) {
      if ((timing && outOfBreak) || simT >= findsBallAt(s, a)) {
        atBall();
        out.lookWide = true;
      }
      return;
    }
    if (air) {
      if (simT - ball.releaseT > 0.4) atBall();
      return;
    }
    if (timing && a.route.idx >= 1) {
      const qb = s.agents[s.qb]!;
      at(qb.pos.x, qb.pos.y, 1.7);
    }
    return;
  }
  if (air && a.mem.onBall) {
    atBall();
    return;
  }
  const as = s.setup.def.assign[a.slot as keyof typeof s.setup.def.assign];
  const man = as?.kind === 'man' ? manOf(s, a) : null;
  if (man) at(man.pos.x, man.pos.y, 1.2);
  else {
    const qb = s.agents[s.qb]!;
    at(qb.pos.x, qb.pos.y, 1.6);
  }
}
/** A QB stepping up faster than this (yd/s along his facing) is climbing the pocket, not shuffling in it. Ours. */
const CLIMB_ALONG = 0.8;

/** Routes that come back to the QB out of their break (the ball's on him as he turns): every break but the verticals. */
const TIMING_ROUTES = new Set(['slant', 'out', 'qout', 'in', 'qin', 'dig', 'curl', 'hitch', 'stick', 'comeback', 'spot', 'sit', 'option', 'angle', 'drag', 'cross', 'flat', 'checkdown', 'swing', 'arrow', 'sail', 'leak', 'chip', 'slip', 'bubble']);

export interface Drive {
  /** The look may turn the chest with the head (over the shoulder for a ball behind him). */
  lookWide?: boolean;
  /** Speed to feed the animator (m/s). */
  speed: number;
  /** Moving backward facing forward (backpedal). */
  backpedal: boolean;
  /** Face along the velocity instead of the sim's facing (running away backward). */
  faceVelocity: boolean;
  look: THREE.Vector3 | null;
  /** The ball carrier's gait and layers (M6.5 #11): see AnimInput. */
  carry: number;
  traffic: number;
  drive: number;
  press: number;
  dip: number;
  /** The ball in his left arm (passing round 6: the left-arm carry families), 0..1. */
  carryLeft?: number;
}

const _look = new THREE.Vector3();

/**
 * Per frame, per player: the held overlay, the throw and catch timing,
 * backpedal, falls, get-ups. `along` is his speed along his facing (yd/s,
 * negative backward), `sp` his ground speed.
 */
export function drive(b: Body, i: number, s: PlayState, simT: number, along: number, sp: number): Drive {
  const a = s.agents[i]!;
  const anim = b.animator;
  const ball = s.ball;
  const tr = anim.transition;
  const out: Drive = { speed: Math.max(0, along) * YARD, backpedal: false, faceVelocity: false, look: null, carry: 0, traffic: 0, drive: 0, press: 0, dip: 0 };
  // Backward: a pedal up to a quick pace, else turn and run.
  if (along < -0.8 && !tr?.name.startsWith('qb_drop_')) {
    if (sp * YARD < 5.2) {
      out.backpedal = true;
      out.speed = sp * YARD;
    } else {
      out.faceVelocity = true;
      out.speed = sp * YARD;
      // A defensive back out of his pedal opens his hips and runs (once a play).
      if (a.side === 'def' && b.once.has('pedal') && !b.once.has('flip') && anim.lib.meta.db_hip_flip_l) {
        b.once.add('flip');
        const turnLeft = Math.sin(Math.atan2(a.vel.y, a.vel.x) - a.face) > 0;
        anim.play(turnLeft ? 'db_hip_flip_l' : 'db_hip_flip_r', { now: true });
      }
    }
    if (out.backpedal) b.once.add('pedal');
  }
  // The throw: the release frame lands on the sim's release. The motion is
  // the man's (throwClip): a quick release's compact one, a long windup's
  // loop, or the fade-away with a rusher in his face.
  // Passing round 3: the motion starts on the player's key and his hold
  // chooses the touch as it comes through (sim/play.ts holdThrough), so the
  // release can move while the clip plays: each frame it's paced to land
  // its release frame on the sim's release, slowing at the top (the ball
  // cocked behind his ear) while the key is held past his own release.
  const w = s.windup;
  // The arm starts a release's length before the ball goes, at its own pace (a key pressed on the drop
  // throws on the plant), or at once on a hold past a tap (the touch: it comes up and waits at the top).
  const touchHold = !!w && w.held && s.hold.ticks * TICK > (s.setup.tapMax ?? TAP_MAX);
  if (i === s.qb && w && b.throwAt !== w.from && (touchHold || w.at - simT <= (eventAt(b, throwClip(b, s, a, sp * YARD >= 1.6), 'release') ?? RELEASE_FRAME) + TICK)) {
    b.throwAt = w.from;
    const running = sp * YARD >= 1.6;
    const clip = throwClip(b, s, a, running);
    b.throwClip = clip;
    const rel = eventAt(b, clip, 'release') ?? RELEASE_FRAME;
    const rate = Math.max(0.6, Math.min(1.8, rel / Math.max(0.05, w.at - simT)));
    if (!running) anim.play(clip, { now: true, rate });
    else anim.playOverlay(clip, { rate, mask: THROW_MASK });
    latency.respond('throwRelease');
  } else if (i === s.qb && w && b.throwClip && b.throwAt === w.from) {
    const clip = b.throwClip;
    const rel = eventAt(b, clip, 'release') ?? RELEASE_FRAME;
    const t = tr && tr.name === clip && !tr.done ? tr.t : anim.overlayAction?.name === clip ? anim.overlayAction.t : null;
    if (t !== null) {
      // At the top of the motion (a frame short of the release) it waits for the sim's release.
      const left = rel - t - (w.held ? COCKED : 0);
      const rate = left <= 0 ? 0 : Math.min(1.8, left / Math.max(TICK, w.at - simT));
      if (tr && tr.name === clip) anim.retime(clip, { rate });
      else anim.retimeOverlay(clip, rate);
    }
  }
  // The key's release answered (passing round 3: the arm starts on the press, so the release shows as the throw going, no longer held).
  if (i === s.qb && w && !w.held) latency.respond('throwRelease');
  if (i === s.qb && !w && b.throwClip) {
    // Out of his hand: the follow-through at the clip's own pace.
    const clip = b.throwClip;
    b.throwClip = null;
    if (tr && tr.name === clip) anim.retime(clip, { rate: 1 });
    else anim.retimeOverlay(clip, 1);
  }
  if (i === s.qb) throwSlot(b, s, a, simT, sp * YARD >= 1.6);
  // The handoff (the QB places it, the back's pocket takes it) and the
  // play-action fake, timed to the sim's mesh: overlays, the legs are the sim's.
  const play = s.setup.play;
  const since = simT - s.snapT;
  if (s.snapT >= 0 && play.run) {
    const side = play.run.aim < 0 ? 'r' : 'l';
    if (i === s.qb && since >= play.run.mesh - 0.33 && !b.once.has('handoff')) {
      b.once.add('handoff');
      anim.playOverlay(`ovl_handoff_${side}`);
    }
    if (a.slot === 'RB' && since >= play.run.mesh - 0.25 && !b.once.has('take')) {
      b.once.add('take');
      anim.playOverlay(`ovl_take_${side}`);
    }
  }
  if (s.snapT >= 0 && play.pa && i === s.qb && since >= 0.12 && !b.once.has('fake')) {
    b.once.add('fake');
    anim.playOverlay(`ovl_pa_fake_${play.pa.aim < 0 ? 'r' : 'l'}`);
  }
  // Out of the fake into the drop, when the sim starts it (pocket.ts dropStep); then the hitch up into the pocket at the set.
  if (i === s.qb && !play.run && !w) {
    const plan = dropPlan(s, a);
    if (plan && play.pa && !play.drop.boot && !b.once.has('drop')) startDrop(b, s, plan, 1);
    if (a.mem.hitchX0 !== undefined && a.mem.noHitch === undefined && !b.once.has('hitch') && since < play.drop.set + 0.1 && anim.lib.meta.qb_hitch) {
      b.once.add('hitch');
      anim.play('qb_hitch', { now: true });
    }
  }
  // The catch (M6.5 #5): the look the call and the ball ask for (the sim's
  // own catchLook, pure), drawn by where the ball gets to him and who he is
  // (passing round 5: sim/catchstyle.ts), started so its secure frame lands
  // where his hands meet the ball.
  if (ball.mode === 'air' && ball.target === i && s.bobble?.who !== i && b.catchFor !== ball.arrive && ball.arrive - simT <= CATCH_LOOKAHEAD) {
    const style = catchStyle(s, a);
    const clip = clipOr(b, catchClip(s, i, style));
    const pluck = pluckOf(a);
    // (Passing round 6) The secure frame lands on the sim's own catch: the
    // tick the ball gets to his hands, out in front of him by his pluck
    // (sim/passing.ts handsAt, catchAhead), so the drawn ball and the hands
    // meet on the frame the sim calls it. Round five timed it on a guess at
    // where his hands would meet it while the sim took the ball a yard off
    // them. A body catch lets the ball on past his hands into his chest.
    const left = clip === 'catch_body' ? Math.min(ball.arrive - simT + MEET_LATE_MAX, meetTime(s, a, BODY_MEET / YARD) - (simT - s.t)) : simCatchIn(s, a, simT);
    const lead = eventAt(b, clip, 'secure');
    if (lead === null) {
      // (An older clip library without the catch set: the M5 overlay.)
      if (left <= SECURE) {
        b.catchFor = ball.arrive;
        anim.playOverlay(ball.aim.z > 1.75 ? 'ovl_catch_high' : 'ovl_catch');
      }
    } else if (left <= (CATCH_FULL.has(clip) || POSTED.has(clip) ? lead : Math.min(lead, LATE_HANDS))) {
      // Late hands (passing round 5): an in-stride catch comes up out of the
      // run's arm swing LATE_HANDS before the ball, not the whole of its lead;
      // a full-body one (the jump, the dive) needs all of its own.
      b.catchFor = ball.arrive;
      const g = b.grip ?? { style, pluck, l: new THREE.Vector3(), r: new THREE.Vector3(), w: 0 };
      g.style = style;
      g.pluck = pluck;
      g.w = 0;
      g.met = false;
      b.grip = g;
      startCatch(b, clip, Math.max(0, lead - left));
    }
  }
  // (Passing round 6) Kept on the sim's catch as it comes: he speeds up or
  // eases off in the last tenths, and the clip's secure frame is paced to
  // land on the tick the ball gets to his hands, not where it was predicted
  // when the clip started.
  if (b.catchClip && b.catchClip !== 'catch_body' && ball.mode === 'air' && ball.target === i && s.bobble?.who !== i) paceCatch(b, s, a, simT);
  // (Passing round 8) Out at the end of his reach he lunges into it: the run's own forward pitch (the press of a
  // designed run, animator.ts) through the reach and the catch, so the drawn hands get as far as the sim takes it.
  if (b.catchClip === 'catch_reach_out') {
    const t = catchTime(b);
    const sec = eventAt(b, 'catch_reach_out', 'secure');
    if (t !== null && sec !== null && t > sec - LUNGE_FROM && t < sec + LUNGE_HOLD) out.press = Math.max(out.press, LUNGE);
  }
  // What the hands hold.
  const holder = ball.mode === 'held' && s.phase !== 'presnap' && simT - s.snapT > 0.3 ? ball.holder : -1;
  // (The throw on the move is an overlay over the legs: its hands are the throw's too, not the two-hand hold's.
  // Passing round 3: with the hold left on, the off hand stayed on the ball and both went up over his helmet.)
  const throwing = (!!tr?.name.startsWith('qb_throw') && !tr.done) || !!anim.overlayAction?.name.startsWith('qb_throw');
  let carrying = false;
  if (i === holder && !a.down) {
    // (A scrambling QB has it tucked; a play-action or handoff overlay owns the hands while it plays.)
    const pocket = i === s.qb && s.scrambleT < 0 && (s.phase === 'snap' || s.phase === 'dropback' || s.phase === 'pocket');
    // A catch clip owns the hands until it has tucked the ball; the reach for the line holds it out in the hand.
    const catching = catchHold(b) !== null;
    carrying = !pocket && !catching;
    // The ball's arm (passing round 6): crossing his chest under both hands while it switches.
    const arm = carrying && !b.reach ? carrySide(b, s, i, simT) : null;
    const crossing = !!arm && simT - arm.at < SWITCH_T;
    // (In a tackle both hands are on it too: one hold a frame, so the layer isn't re-made every frame at its first fade step. Passing round 6.)
    const piled = carrying && !b.fallen && s.pile?.c === i;
    anim.setHold(catching || b.reach ? null : pocket ? (throwing ? null : 'ovl_qb_hold') : a.move === 'protect' || crossing || piled ? 'ovl_protect' : arm?.side === 'l' ? 'ovl_carry_l' : 'ovl_carry_r');
    if (a.move === 'protect') latency.respond('protect');
  } else anim.setHold(null);
  // Down without a clip that lies him down: he falls, once (a dove-and-
  // missed tackler whose clip ended, a player knocked over).
  if (a.down && !b.fallen) fall(b, worldVel(s, i).clone().multiplyScalar(0.8), _w.set(0, 0.3, 0));
  // A lying clip that finished: he lies where it left him.
  if (b.lyingClip && (!tr || tr.done) && !b.lie) {
    const r = b.player.root;
    b.lie = { x: r.position.x, z: r.position.z, yaw: r.rotation.y, prone: true };
    b.lyingClip = false;
  }
  // A lying catch the sim didn't put down (the sim downs a diving catch
  // when he lands, busy running out; this is the guard if it ever doesn't):
  // off the turf and after it rather than lie there while he runs on.
  if (b.lie && !b.lie.up && !a.down && a.busy <= 0 && i === s.carrier && s.phase === 'carrier' && b.catchClip && CATCH_LYING.has(b.catchClip)) {
    b.lie = null;
    b.fallen = false;
    b.lyingClip = false;
    anim.play('getup_prone', { now: true });
  }
  // The fall hands over to lying on the turf once he's down (the ragdoll
  // has no muscles to straighten out with; the lying clips do).
  if (b.ragdoll.active && !b.lie && b.ragdoll.time > 0.75) {
    b.lie = b.ragdoll.handOff();
    anim.reset();
    anim.setStance(b.lie.prone ? 'stance_down_prone' : 'stance_down_supine');
  }
  const gettingUp = tr?.name.startsWith('getup') ?? false;
  // Up again mid-play (sim/tackle.ts tickDowned): back on his sim spot once the get-up is done.
  if (b.lie?.up && !a.down && s.phase !== 'dead' && !(gettingUp && !tr!.done)) {
    b.lie = null;
    b.fallen = false;
    b.lyingClip = false;
  }
  if (b.fallen && !gettingUp && !(b.lie?.up && !tr)) out.speed = 0;
  // After the whistle, a player lying down gets up (once).
  if (s.phase === 'dead' && simT - s.whistleT > 1.3 && b.lie && !b.lie.up && !b.ragdoll.active && (!tr || tr.done)) {
    b.lie.up = true;
    anim.play(b.lie.prone ? 'getup_prone' : 'getup_supine', { now: true });
  }
  // Eyes (passing round 2): see eyesFor.
  eyesFor(i, s, simT, out);
  // Eyes, hands, tuck (passing round 5): through the secure his eyes stay on
  // the ball into his hands (a wide look: the chin comes down to it), then
  // they come up the field (carrierDrive's) as it's put away.
  const hold = catchHold(b);
  if (hold && b.catchClip) {
    const t = catchTime(b);
    const sec = eventAt(b, b.catchClip, 'secure');
    if (t !== null && sec !== null && t < sec + EYES_IN && handsPoint(b, hold.hands, _look)) {
      out.look = _look;
      out.lookWide = true;
    }
  }
  // The scoop (passing round 5): the hips sink under the ball at his shoe tops (the carrier's traffic gait: shorter, lower), as the clip folds the trunk over it.
  if (b.catchClip === 'catch_scoop') {
    const t = catchTime(b);
    const sec = eventAt(b, 'catch_scoop', 'secure');
    if (t !== null && sec !== null) {
      const k = THREE.MathUtils.smoothstep(t, sec - 0.25, sec - 0.05) * (1 - THREE.MathUtils.smoothstep(t, sec + 0.1, sec + 0.35));
      out.carry = Math.max(out.carry, k);
      out.traffic = Math.max(out.traffic, k);
    }
  }
  // Climbing the pocket (passing round 2): moving up in it after the set, the QB's steps are the short, choppy, hips-down
  // ones of the carrier's traffic gaits (stride-matched to the sim's pace), the ball still in both hands at the numbers
  // (his hold overlay owns the arms) and his eyes downfield.
  if (i === s.qb && s.phase === 'pocket' && s.scrambleT < 0 && !w && along > CLIMB_ALONG && (!tr || tr.done)) {
    out.carry = 1;
    out.traffic = 1;
  }
  // The ball carrier runs like one (M6.5 #11): the carry gaits, and his eyes up.
  if (carrying && !b.fallen) carrierDrive(b, i, s, simT, out, clipBusy(b, tr));
  if (carrying && b.carry?.side === 'l') out.carryLeft = 1;
  // In a tackle (sim/tackle.ts): pads low, legs churning, both hands on the ball.
  if (carrying && !b.fallen && s.pile?.c === i) {
    out.drive = 1;
    out.press = 1;
    out.traffic = 1;
  }
  return out;
}

// --- The ball's arm (passing round 6) ----------------------------------------------------
// Runners are coached to carry the ball in the arm away from the nearest
// tackler (the outside arm in the open field, toward the sideline), so the
// near arm is free to fend and the ball is away from the strip, and to switch
// it to the other arm when they cut across. Render only, from the sim's state.

/** A tackler within this (yd) decides the arm; farther, the sideline does. Ours: about two strides. */
const ARM_THREAT_R = 5;
/** Out from the middle of the field this far (yd) the sideline decides; inside it, the arm he has. */
const ARM_WIDE = 4;
/** He wants it in the other arm this long (s) before it goes there, and keeps an arm at least ARM_HOLD (no flicking it back and forth). A cut switches it at once. */
const ARM_WANT = 0.25;
const ARM_HOLD = 0.8;
/** The switch: the ball crosses his chest under both hands over this long (s). Ours: a quick two-hand exchange. */
const SWITCH_T = 0.22;

/** The ball's arm for the carrier this frame, deciding and starting a switch when it's time. */
function carrySide(b: Body, s: PlayState, i: number, simT: number): CarryArm {
  const a = s.agents[i]!;
  const c = (b.carry ??= { side: 'r', want: 'r', since: simT, from: 'r', at: -9 });
  const sp = Math.hypot(a.vel.x, a.vel.y);
  const hx = sp > 1 ? a.vel.x / sp : Math.cos(a.face);
  const hy = sp > 1 ? a.vel.y / sp : Math.sin(a.face);
  // The sim's y is to the left of its x: a point is on his left when the cross product is positive.
  const leftOf = (dx: number, dy: number) => hx * dy - hy * dx > 0;
  let want = c.want;
  const d = threatOf(s, a);
  if (d && Math.hypot(d.pos.x - a.pos.x, d.pos.y - a.pos.y) < ARM_THREAT_R) want = leftOf(d.pos.x - a.pos.x, d.pos.y - a.pos.y) ? 'r' : 'l';
  else if (Math.abs(a.pos.y) > ARM_WIDE) want = leftOf(0, Math.sign(a.pos.y)) ? 'l' : 'r';
  if (want !== c.want) {
    c.want = want;
    c.since = simT;
  }
  // A move clip keyed with the ball in the right arm (the spin, the juke, the stiff arm with the left): it goes back to the right arm for it.
  const tr = b.animator.transition;
  const move = !!tr && !tr.done && !tr.name.startsWith('cut_plant') && !tr.name.startsWith('catch_');
  const target = move ? 'r' : c.want;
  const cutting = !!tr && !tr.done && tr.name.startsWith('cut_plant');
  if (target !== c.side && simT - c.at >= SWITCH_T && (move || cutting || (simT - c.since >= ARM_WANT && simT - c.at >= ARM_HOLD))) {
    c.from = c.side;
    c.side = target;
    c.at = simT;
  }
  return c;
}

const _h = new THREE.Vector3();
const _e = new THREE.Vector3();
const _d = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0);
const _c = new THREE.Vector3();

/**
 * The ball in a player's hands: the QB's two-hand hold (between the hands),
 * the throwing grip (in the right hand until the release), or tucked (its
 * nose in the right hand, its back along the forearm). Returns false when
 * the render should use the sim's position instead.
 */
export function ballInHands(b: Body, s: PlayState, ball: THREE.Object3D): boolean {
  const anim = b.animator;
  const bones = b.player.bones;
  const hr = bones.get('hand_r');
  const hl = bones.get('hand_l');
  const er = bones.get('forearm_r');
  if (!hr || !hl || !er) return false;
  hr.getWorldPosition(_h);
  er.getWorldPosition(_e);
  const tr = anim.transition;
  const throwing = (!!tr?.name.startsWith('qb_throw') && !tr.done) || !!anim.overlayAction?.name.startsWith('qb_throw');
  const holder = s.ball.holder;
  const qbHold = holder === s.qb && (s.phase === 'snap' || s.phase === 'dropback' || s.phase === 'pocket') && !throwing;
  if (qbHold) {
    hl.getWorldPosition(_d);
    ball.position.addVectors(_h, _d).multiplyScalar(0.5);
    // Nose forward and a little up, as a QB carries it at the numbers.
    const yaw = b.player.root.rotation.y;
    _d.set(Math.sin(yaw), 0.5, Math.cos(yaw)).normalize();
    ball.quaternion.setFromUnitVectors(_X, _d);
    return true;
  }
  // Along the forearm, from the elbow through the hand.
  _d.subVectors(_h, _e).normalize();
  if (throwing || b.reach) {
    // In the fingers: just past the palm (a throw, or the ball reached out for the line).
    ball.position.copy(_h).addScaledVector(_d, 0.06);
  } else {
    ball.position.copy(_h).addScaledVector(_d, -0.09);
    // (Passing round 6) Carried in the left arm, or crossing his chest to the other one.
    const c = b.carry;
    const el = bones.get('forearm_l');
    if (c && el && holder !== s.qb && (c.side === 'l' || c.from === 'l')) {
      hl.getWorldPosition(_c);
      el.getWorldPosition(_e);
      _w.subVectors(_c, _e).normalize();
      _c.addScaledVector(_w, -0.09);
      const k = THREE.MathUtils.smoothstep(s.t - c.at, 0, SWITCH_T);
      const toL = c.side === 'l' ? k : 1 - k;
      ball.position.lerp(_c, toL);
      _d.lerp(_w, toL).normalize();
    }
  }
  ball.quaternion.setFromUnitVectors(_X, _d);
  // Caught and not yet tucked: in the hands (easing into the tuck above).
  const held = catchHold(b);
  if (held && handsPoint(b, held.hands, _c)) ball.position.lerp(_c, held.k);
  return true;
}
