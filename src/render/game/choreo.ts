import * as THREE from 'three';
import { carrierPace, GOAL_X, manOf, pullers, TICK } from '@/sim';
import type { PlayerAnimator } from '@/anim/animator';
import type { Ragdoll } from '@/anim/ragdoll';
import type { Agent, PlayState, SimEvent } from '@/sim';
import type { Player } from '../players/playerAsset';
import { YARD } from '../world/constants';
import { worldDir, worldX, worldY, worldZ } from '@/game/coords';
import { latency } from '@/game/latency';
import { catchLook, findsBallAt, reach, releaseOf, type CatchLook } from '@/sim/passing';
import { dropPlan, dropStart, GUN_CATCH, planFrom, UC_EXCHANGE, type DropPlan } from '@/sim/pocket';
import { pressureOn, routeOf } from '@/sim/ai';
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
  /** M6.5 #12: the man he's contesting a catch with (body index) until this sim time, or null. */
  contest: { with: number; until: number } | null;
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
      continue;
    }
    if (c.with > k) out.push([k, c.with]);
  }
  return out;
}

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
/** The ones that leave him lying on the ball. */
const CATCH_LYING = new Set(['catch_body_down', 'catch_dive_l', 'catch_dive_r']);
/** The most (s) the catch is taken ahead of the ball's arrival at its spot: a slow ball he's running at is in his reach a little early, but no more than this. Ours (the slant and the out measured 0.03-0.06 s). */
const ENTRY_MAX = 0.08;
/** How far ahead of the ball's arrival (s) the look is asked for: the longest lead (the high point's gather and jump, 0.73 s) and a little. */
const CATCH_LOOKAHEAD = 0.9;
/** Below this (yd, ~0.9 m: the belt) a hands catch is taken with the pinkies together. */
const LOW_HANDS = 1.0;
/** GO UP leaps only for a ball arriving at least this high (yd, ~1.6 m: the shoulders). */
const LEAP_MIN = 1.75;
/** The drawn ball bends into the hands only when they're this close to its flight (m); farther, a pull would read as a warp. */
const MAGNET_NEAR = 0.45;
const MAGNET_FAR = 1.0;

/** The clip for a look, from where the ball is going relative to his run. */
export function catchClip(s: PlayState, i: number, look: CatchLook): string {
  const a = s.agents[i]!;
  const ball = s.ball;
  const sp = Math.hypot(a.vel.x, a.vel.y);
  const hx = sp > 1 ? a.vel.x / sp : Math.cos(a.face);
  const hy = sp > 1 ? a.vel.y / sp : Math.sin(a.face);
  // The sim's y is to the left of its x: a point is on his left when the cross product is positive.
  const leftOf = (dx: number, dy: number) => hx * dy - hy * dx > 0;
  const T = Math.max(0, ball.arrive - s.t);
  const aimLeft = leftOf(ball.aim.x - (a.pos.x + a.vel.x * T), ball.aim.y - (a.pos.y + a.vel.y * T));
  switch (look) {
    case 'hands':
      return ball.aim.z < LOW_HANDS ? 'catch_hands_run_low' : 'catch_hands_run';
    case 'body':
      return 'catch_body';
    case 'highPoint':
      // GO UP on a ball he can't jump for (it arrives below his shoulders):
      // leaping over it would read wrong, so he attacks it with his hands.
      return ball.aim.z >= LEAP_MIN ? 'catch_high_point' : ball.aim.z < LOW_HANDS ? 'catch_hands_run_low' : 'catch_hands_run';
    case 'overShoulder':
      // Over the shoulder on the side the ball is dropping in from.
      return leftOf(ball.pos.x - a.pos.x, ball.pos.y - a.pos.y) ? 'catch_over_shoulder_l' : 'catch_over_shoulder_r';
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
const REACH_CLIPS = new Set(['catch_hands_run', 'catch_hands_run_low', 'catch_over_shoulder_l', 'catch_over_shoulder_r', 'catch_one_hand_l', 'catch_one_hand_r']);
/** The hands come to the ball over this long (s of clip) before the secure frame: the late hands. */
const REACH_IN = 0.2;
/** How far the hands can go for it (m from between the shoulders) at full weight, and past which they don't chase it. Ours: a long arm's reach. */
const REACH_NEAR = 0.75;
const REACH_FAR = 1.15;
/** Gravity in yd/s² (sim/ball.ts G in m/s², over a yard). */
const G_YD = 9.81 / 0.9144;
const _bp = new THREE.Vector3();
const _hl = new THREE.Vector3();
const _hr = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _bd = new THREE.Vector3();

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
export function catchReach(b: Body, i: number, s: PlayState): void {
  const c = b.catchClip;
  if (!c || !REACH_CLIPS.has(c)) return;
  const ball = s.ball;
  if (ball.mode !== 'air' || ball.target !== i) return;
  const t = catchTime(b);
  const secure = eventAt(b, c, 'secure');
  const tuck = eventAt(b, c, 'tuck');
  if (t === null || secure === null || tuck === null) return;
  let w = THREE.MathUtils.smoothstep(t, secure - REACH_IN, secure - 0.02);
  if (w <= 0) return;
  // The ball at the secure frame (sim yd, z up): its flight run forward (drag is a few cm over this).
  const dt = Math.max(0, Math.min(0.3, secure - t));
  _bp.set(worldX(ball.pos.y + ball.vel.y * dt), worldY(ball.pos.z + ball.vel.z * dt - 0.5 * G_YD * dt * dt), worldZ(ball.pos.x + ball.vel.x * dt));
  // Not for a ball he can't get his hands to.
  const bones = b.player.bones;
  const sl = bones.get('upperarm_l');
  const sr = bones.get('upperarm_r');
  if (!sl || !sr) return;
  sl.getWorldPosition(_sh);
  sr.getWorldPosition(_hl);
  _sh.add(_hl).multiplyScalar(0.5);
  w *= 1 - THREE.MathUtils.smoothstep(_sh.distanceTo(_bp), REACH_NEAR, REACH_FAR);
  if (w <= 0) return;
  // Either side of it across its line, a little behind it (the hands meet it, the ball comes into them).
  _bd.set(worldX(ball.vel.y) - worldX(0), 0, worldZ(ball.vel.x) - worldZ(0));
  if (_bd.lengthSq() < 1e-6) _bd.set(0, 0, 1);
  _bd.normalize();
  const across = _hr.set(_bd.z, 0, -_bd.x);
  // Which of those is his left: the side his left shoulder is on.
  sl.getWorldPosition(_hl);
  const leftSign = (_hl.x - _sh.x) * across.x + (_hl.z - _sh.z) * across.z >= 0 ? 1 : -1;
  _hl.copy(_bp).addScaledVector(_bd, -HANDS_BEHIND).addScaledVector(across, HANDS_APART * leftSign);
  _hr.copy(_bp).addScaledVector(_bd, -HANDS_BEHIND).addScaledVector(across, -HANDS_APART * leftSign);
  const one = c.startsWith('catch_one_hand_') ? (c.endsWith('_l') ? 'l' : 'r') : null;
  if (one) (one === 'l' ? _hl : _hr).copy(_bp).addScaledVector(_bd, -HANDS_BEHIND);
  b.animator.reachHands(one === 'r' ? null : _hl, w, one === 'l' ? null : _hr, w);
}
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
          const want = catchClip(s, who[0]!, look);
          const committed = a.catchClip !== null && CATCH_FULL.has(a.catchClip) && catchTime(a) !== null;
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
  // (A key pressed on the drop throws on the plant: the arm starts a release's length before it, at its own pace.)
  if (i === s.qb && w && b.throwAt !== w.from && (w.held || w.at - simT <= (eventAt(b, throwClip(b, s, a, sp * YARD >= 1.6), 'release') ?? RELEASE_FRAME) + TICK)) {
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
  } else if (i === s.qb && !w && b.throwClip) {
    // Out of his hand: the follow-through at the clip's own pace.
    const clip = b.throwClip;
    b.throwClip = null;
    if (tr && tr.name === clip) anim.retime(clip, { rate: 1 });
    else anim.retimeOverlay(clip, 1);
  }
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
  // own catchLook, pure), started so its secure frame lands on the arrival.
  if (ball.mode === 'air' && ball.target === i && s.bobble?.who !== i && b.catchFor !== ball.arrive && ball.arrive - simT <= CATCH_LOOKAHEAD) {
    // The sim takes it as it comes within his reach, a beat before it gets
    // to the spot it was thrown to (passing round 3): the secure frame lands there.
    const closing = Math.hypot(ball.vel.x - a.vel.x, ball.vel.y - a.vel.y);
    const left = ball.arrive - simT - Math.min(ENTRY_MAX, reach(a).r / Math.max(1, closing));
    const clip = catchClip(s, i, catchLook(s, a));
    const lead = eventAt(b, clip, 'secure');
    if (lead === null) {
      // (An older clip library without the catch set: the M5 overlay.)
      if (left <= SECURE) {
        b.catchFor = ball.arrive;
        anim.playOverlay(ball.aim.z > 1.75 ? 'ovl_catch_high' : 'ovl_catch');
      }
    } else if (left <= lead) {
      b.catchFor = ball.arrive;
      startCatch(b, clip, Math.max(0, lead - left));
    }
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
    anim.setHold(catching || b.reach ? null : pocket ? (throwing ? null : 'ovl_qb_hold') : a.move === 'protect' ? 'ovl_protect' : 'ovl_carry_r');
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
  // Climbing the pocket (passing round 2): moving up in it after the set, the QB's steps are the short, choppy, hips-down
  // ones of the carrier's traffic gaits (stride-matched to the sim's pace), the ball still in both hands at the numbers
  // (his hold overlay owns the arms) and his eyes downfield.
  if (i === s.qb && s.phase === 'pocket' && s.scrambleT < 0 && !w && along > CLIMB_ALONG && (!tr || tr.done)) {
    out.carry = 1;
    out.traffic = 1;
  }
  // The ball carrier runs like one (M6.5 #11): the carry gaits, and his eyes up.
  if (carrying && !b.fallen) carrierDrive(b, i, s, simT, out, clipBusy(b, tr));
  // In a tackle (sim/tackle.ts): pads low, legs churning, both hands on the ball.
  if (carrying && !b.fallen && s.pile?.c === i) {
    out.drive = 1;
    out.press = 1;
    out.traffic = 1;
    anim.setHold('ovl_protect');
  }
  return out;
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
  }
  ball.quaternion.setFromUnitVectors(_X, _d);
  // Caught and not yet tucked: in the hands (easing into the tuck above).
  const held = catchHold(b);
  if (held && handsPoint(b, held.hands, _c)) ball.position.lerp(_c, held.k);
  return true;
}
