import * as THREE from 'three';
import type { PlayerAnimator } from '@/anim/animator';
import type { Ragdoll } from '@/anim/ragdoll';
import type { PlayState, SimEvent } from '@/sim';
import type { Player } from '../players/playerAsset';
import { YARD } from '../world/constants';
import { worldDir } from '@/game/coords';
import { latency } from '@/game/latency';

// The choreographer: which clip each player plays, from the sim's state and
// events (TECH_PLAN §9.2). The sim decides everything; this only picks and
// times the motion: the QB's drop and a throw whose release frame lands on
// the sim's release, a catch whose secure frame lands on the ball's arrival,
// the carrier's tuck and moves, the form tackle, the fall (ragdoll) and the
// get-up after the whistle.

export interface Body {
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
}

function lyingClip(b: Body, name: string, t0 = 0): void {
  b.animator.play(name, { now: true, t0 });
  b.fallen = true;
  b.lyingClip = true;
}

function fall(b: Body, vel: THREE.Vector3, push: THREE.Vector3, big = false): void {
  if (b.fallen && !b.lyingClip) return;
  b.lyingClip = false;
  b.fallen = true;
  b.ragdoll.start(vel, push, big);
}

/** The snap: get-offs out of the stances, the QB's drop. */
export function onSnap(bodies: Body[], s: PlayState, stanceOf: (slot: string) => string): void {
  bodies.forEach((b, i) => {
    if (i === s.qb) {
      const k = s.setup.play.drop.kind;
      if (k !== 'handoff') b.animator.play(`qb_drop_${k}`, { now: true });
      return;
    }
    const st = stanceOf(b.slot);
    const off = `getoff_${st.slice(7)}`;
    if (b.animator.lib.meta[off]) b.animator.play(off);
    else b.animator.setStance('stance_idle');
  });
}

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
        else if (mv === 'dive') lyingClip(a, 'dive');
        else if (mv === 'stiffArm') a.animator.playOverlay('ovl_stiff_arm');
        else if (mv === 'truck') a.animator.playOverlay('ovl_truck');
        else if (mv === 'pumpFake') a.animator.playOverlay('ovl_pump');
        break;
      }
      case 'catch':
      case 'interception':
        // Already reaching (the catch overlay started before the ball got there)? Let it finish into the tuck.
        if (a && a.animator.overlayAction?.name.startsWith('ovl_catch') !== true) a.animator.playOverlay('ovl_catch', { t0: SECURE });
        break;
      case 'missedTackle':
        if (a && e.data?.dive) lyingClip(a, 'dive');
        break;
      case 'shed':
        // Off the block: the get-off, pads low into the chase.
        if (a && !e.data?.whiff && !a.fallen) a.animator.playOverlay('ovl_getoff');
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
  const out: Drive = { speed: Math.max(0, along) * YARD, backpedal: false, faceVelocity: false, look: null };
  // Backward: a pedal up to a quick pace, else turn and run.
  if (along < -0.8 && !tr?.name.startsWith('qb_drop_')) {
    if (sp * YARD < 5.2) {
      out.backpedal = true;
      out.speed = sp * YARD;
    } else {
      out.faceVelocity = true;
      out.speed = sp * YARD;
    }
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
  // The catch: hands out so the secure frame meets the ball.
  if (ball.mode === 'air' && ball.target === i && b.catchFor !== ball.arrive && ball.arrive - simT <= SECURE) {
    b.catchFor = ball.arrive;
    anim.playOverlay(ball.aim.z > 1.75 ? 'ovl_catch_high' : 'ovl_catch');
  }
  // What the hands hold.
  const holder = ball.mode === 'held' && s.phase !== 'presnap' && simT - s.snapT > 0.3 ? ball.holder : -1;
  const throwing = tr?.name === 'qb_throw' && !tr.done;
  if (i === holder && !a.down) {
    // (A scrambling QB has it tucked; a play-action or handoff overlay owns the hands while it plays.)
    const pocket = i === s.qb && s.scrambleT < 0 && (s.phase === 'snap' || s.phase === 'dropback' || s.phase === 'pocket');
    anim.setHold(pocket ? (throwing ? null : 'ovl_qb_hold') : a.move === 'protect' ? 'ovl_protect' : 'ovl_carry_r');
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
  return out;
}

const _h = new THREE.Vector3();
const _e = new THREE.Vector3();
const _d = new THREE.Vector3();
const _X = new THREE.Vector3(1, 0, 0);

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
  if (throwing) {
    // In the fingers: just past the palm.
    ball.position.copy(_h).addScaledVector(_d, 0.06);
  } else {
    ball.position.copy(_h).addScaledVector(_d, -0.09);
  }
  ball.quaternion.setFromUnitVectors(_X, _d);
  return true;
}
