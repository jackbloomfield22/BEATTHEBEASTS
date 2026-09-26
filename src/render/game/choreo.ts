import * as THREE from 'three';
import { carrierPace, GOAL_X, pullers } from '@/sim';
import type { PlayerAnimator } from '@/anim/animator';
import type { Ragdoll } from '@/anim/ragdoll';
import type { PlayState, SimEvent } from '@/sim';
import type { Player } from '../players/playerAsset';
import { YARD } from '../world/constants';
import { worldDir } from '@/game/coords';
import { latency } from '@/game/latency';
import { catchLook, type CatchLook } from '@/sim/passing';
import { threatOf } from '@/sim/moves';

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
  /** Per-play bookkeeping: the throw and the ball arrival already animated. */
  throwAt: number;
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
}

/** Upper body, for a throw on the run (the legs keep running). */
export const THROW_MASK = [
  'spine_02', 'spine_03', 'spine_04', 'neck_01', 'neck_02', 'head',
  ...['l', 'r'].flatMap((s) => ['clavicle', 'upperarm', 'upperarm_twist', 'forearm', 'forearm_twist', 'hand', 'fingers_01', 'fingers_02', 'fingers_03', 'index_01', 'index_02', 'index_03', 'thumb_01', 'thumb_02', 'thumb_03'].map((b) => `${b}_${s}`)),
];

const RELEASE_FRAME = 11 / 30;
const SECURE = 0.2;
const TACKLE_CONTACT = 8 / 30;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** New play: forget clips, falls and per-play state. */
export function resetBody(b: Body): void {
  b.ragdoll.stop();
  b.throwAt = -1;
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
  b.animator.onTurn = null;
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
  if (secure === null || tuck === null || t < secure - 0.05 || t >= tuck) return null;
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
  const secure = eventAt(b, c, 'secure');
  if (secure === null) return 0;
  const k = THREE.MathUtils.smoothstep(t, secure - 0.12, secure);
  if (k <= 0 || !handsPoint(b, catchHands(c), out)) return 0;
  return k * (1 - THREE.MathUtils.smoothstep(ball.distanceTo(out), MAGNET_NEAR, MAGNET_FAR));
}

// --- The ball carrier (M6.5 #11) -----------------------------------------------
// The sim decides where he goes; this picks how he moves: the carrier's gait
// families (space, traffic by the sim's context pace, the burst's drive),
// the press of a designed run, the plant-and-cut on the sim's cut, the dip
// before contact, the hurdle over a downed man, the reach for the line, and
// where his eyes are.

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
/** The hurdle: at speed (yd/s) over a downed man whose body he'll cross (within BODY_R yd) this far ahead (s). */
const HURDLE_SPEED = 5;
const HURDLE_AHEAD = [0.3, 0.62] as const;
const BODY_R = 0.8;
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
  // The hurdle over a man on the turf in his path (render only: the sim doesn't block on downed players).
  if (sp > HURDLE_SPEED && moving && anim.lib.meta.hurdle) {
    for (let j = 0; j < s.agents.length; j++) {
      const o = s.agents[j]!;
      if (j === i || !o.down || b.hurdled.has(j)) continue;
      const rx = o.pos.x - a.pos.x;
      const ry = o.pos.y - a.pos.y;
      const tc = (rx * a.vel.x + ry * a.vel.y) / (sp * sp);
      if (tc < HURDLE_AHEAD[0] || tc > HURDLE_AHEAD[1]) continue;
      if (Math.hypot(rx - a.vel.x * tc, ry - a.vel.y * tc) > BODY_R) continue;
      b.hurdled.add(j);
      const over = eventAt(b, 'hurdle', 'over') ?? 0.6;
      anim.play('hurdle', { now: true, t0: Math.max(0, Math.min(0.3, over - tc)) });
      break;
    }
  }
  // Eyes: on the nearest free tackler in front of him or beside him, else scanning upfield.
  const d = threatOf(s, a);
  if (d && Math.hypot(d.pos.x - a.pos.x, d.pos.y - a.pos.y) < LOOK_R) out.look = _look.set(-d.pos.y * YARD, 1.7, (50 - d.pos.x) * YARD);
  else {
    const ax = a.pos.x + attack * 12;
    const ay = a.pos.y + 5 * Math.sin(simT * 1.3 + i);
    out.look = _look.set(-ay * YARD, 1.6, (50 - ax) * YARD);
  }
}

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
      if (k !== 'handoff') b.animator.play(`qb_drop_${k}`, { now: true });
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
        if (kind === 'juke' || kind === 'spin' || kind === 'stiffArm' || kind === 'truck' || kind === 'dive') latency.respond(kind);
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
        else if (mv === 'pumpFake') a.animator.playOverlay('ovl_pump');
        else if (mv === 'secureDown') {
          // SECURE in traffic: the cradle turns into going down with it (from the catch's secure frame on).
          a.animator.stopOverlay();
          a.catchClip = 'catch_body_down';
          lyingClip(a, 'catch_body_down', eventAt(a, 'catch_body_down', 'secure') ?? 0);
        }
        break;
      }
      case 'catch': {
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
      case 'interception':
        // Already reaching (the catch overlay started before the ball got there)? Let it finish into the tuck.
        if (a && a.animator.overlayAction?.name.startsWith('ovl_catch') !== true) a.animator.playOverlay('ovl_catch', { t0: SECURE });
        break;
      case 'missedTackle':
        if (a && e.data?.dive) lyingClip(a, 'dive');
        break;
      case 'hit': {
        const t = a;
        const c = who[1] !== undefined ? bodies[who[1]] : undefined;
        if (t && !t.fallen) lyingClip(t, 'tackle', TACKLE_CONTACT);
        if (c && who[1] !== undefined && who[0] !== undefined) {
          // The fall: the carrier's run plus the hit's push, along the tackler's line.
          const vel = worldVel(s, who[1]).clone();
          const tv = worldVel(s, who[0]);
          const force = Number(e.data?.force ?? 5);
          const push = _w.copy(tv).setY(0);
          if (push.lengthSq() < 1e-4) push.subVectors(c.player.root.position, t!.player.root.position).setY(0);
          // The launch: harder on a big hit, but capped (4.5 m/s across, a little lift): a
          // man is knocked off his feet and back, not thrown across the field.
          const big = !!e.data?.big;
          push.normalize().multiplyScalar(Math.min(4.5, 1.5 + Math.min(4, force * 0.35) * (big ? 1.5 : 1)));
          push.y = big ? 1.1 : 0.6;
          fall(c, vel.multiplyScalar(0.8), push, big);
        }
        break;
      }
    }
  }
}

export interface Drive {
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
  // The throw: the release frame lands on the sim's release.
  const w = s.windup;
  if (i === s.qb && w && b.throwAt !== w.at) {
    b.throwAt = w.at;
    const rate = Math.max(0.6, Math.min(1.8, RELEASE_FRAME / Math.max(0.05, w.at - simT)));
    if (sp * YARD < 1.6) anim.play('qb_throw', { now: true, rate });
    else anim.playOverlay('qb_throw', { rate, mask: THROW_MASK });
    latency.respond('throwRelease');
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
  // The catch (M6.5 #5): the look the call and the ball ask for (the sim's
  // own catchLook, pure), started so its secure frame lands on the arrival.
  if (ball.mode === 'air' && ball.target === i && b.catchFor !== ball.arrive && ball.arrive - simT <= CATCH_LOOKAHEAD) {
    const left = ball.arrive - simT;
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
  const throwing = tr?.name === 'qb_throw' && !tr.done;
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
  if (b.fallen && !gettingUp && !(b.lie?.up && !tr)) out.speed = 0;
  // After the whistle, a player lying down gets up (once).
  if (s.phase === 'dead' && simT - s.whistleT > 1.3 && b.lie && !b.lie.up && !b.ragdoll.active && (!tr || tr.done)) {
    b.lie.up = true;
    anim.play(b.lie.prone ? 'getup_prone' : 'getup_supine', { now: true });
  }
  // Eyes: the QB on his read, everyone on a ball in the air.
  if (ball.mode === 'air') out.look = _look.set(-ball.pos.y * YARD, Math.max(ball.pos.z, 1.2) * YARD, (50 - ball.pos.x) * YARD);
  else if (i === s.qb && s.phase !== 'presnap' && s.phase !== 'carrier') out.look = _look.set(-s.eyes.y * YARD, 1.6, (50 - s.eyes.x) * YARD);
  // The ball carrier runs like one (M6.5 #11): the carry gaits, and his eyes up.
  if (carrying && !b.fallen) carrierDrive(b, i, s, simT, out, !!tr && !tr.done && tr.name !== 'getup_prone');
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
  const throwing = (tr?.name === 'qb_throw' && !tr.done) || anim.overlayAction?.name === 'qb_throw';
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
