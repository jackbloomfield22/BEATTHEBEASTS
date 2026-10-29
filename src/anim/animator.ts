import * as THREE from 'three';
import type { Player } from '@/render/players/playerAsset';
import { advancePhase, familyWeights, MIN_LOCO_SPEED, sampleSorted, warpPhase, type GaitClip, type GaitSample } from './blend';
import { rotateBoneWorld, solveTwoBone } from './ik';
import { planted, travelAt, type AnimLibrary, type ClipMeta } from './library';

// The per-player animation runtime (TECH_PLAN §9.2), layered:
//   1. clips: a settled stance, or locomotion (the two gait clips that
//      bracket the speed, on one stride-matched phase), crossfaded;
//   2. foot lock: a foot that plants stays where it planted (two-bone IK)
//      until it lifts, which removes the residual slide of blends, speed
//      changes and turns;
//   3. body lean into turns and with acceleration, pivoting at the feet;
//   4. look-at for the neck and head, clamped and spring-smoothed;
//   5. shoulder-pad springs driven by the chest's vertical acceleration.
// One-shot transitions (huddle break, set, get-off, stop) play over the
// loops: they fade in, drive the feet from their own contacts, report root
// motion from their travel curve, and hand over to the clip they end on
// (a stance, or the run at phase 0).
// Render-side only: it reads the sim's state (speed, heading) and never
// feeds anything back (CLAUDE.md rule 4).

export interface AnimInput {
  /** Ground speed (m/s) along the facing direction (0 = standing). */
  speed: number;
  /** Turn rate (rad/s, + = left), for leaning into turns. */
  yawRate?: number;
  /** Forward acceleration (m/s²), for leaning into a burst. */
  accel?: number;
  /** World point to look at (null: look where the body faces). */
  lookAt?: THREE.Vector3 | null;
  /**
   * The look may turn the chest as well as the neck (passing round 2: a
   * receiver looking back over his shoulder for a deep ball, eyes down into
   * his hands): up to LOOK_WIDE either way, the upper spine taking what the
   * neck can't, and the head down to LOOK_DOWN_WIDE.
   */
  lookWide?: boolean;
  /** World velocity of the ground under the player (the Lab's treadmill; 0 in the game). */
  groundVelocity?: THREE.Vector3;
  /** Moving backward facing forward (a defensive back's pedal): `speed` is then the backward speed. */
  backpedal?: boolean;
  /**
   * The ball carrier (M6.5 #11), each 0..1 and eased here: how much he runs
   * like a carrier (the carry gaits), how much of that is traffic (short,
   * choppy steps) and the burst's drive, and the press of a designed run
   * (the trunk pitched into the hole).
   */
  carry?: number;
  /** The ball's arm while he carries (passing round 6): 0 the right, 1 the left (the left-arm carry families), eased like the carry. */
  carryLeft?: number;
  traffic?: number;
  drive?: number;
  press?: number;
  /** The dip before contact: + a tackler closing on his left, − on his right; the size is the weight (0..1). */
  dip?: number;
  /**
   * Leaning into another body (M6.5 #12, render/game/contact.ts): the world
   * horizontal direction to lean toward, its length the angle (rad). The
   * body pivots at the feet, which stay planted.
   */
  contactLean?: { x: number; z: number };
  /**
   * (Passing round 14) Hold the body over its planted feet against the sim's drift, and let a planted point give
   * past that (holdOver, lockFoot: KNEE_GIVE, ROOT_GIVE). The game sets it for the quarterback, whose set, throws and
   * finishes are planted one-shots while the sim slides him in the pocket; everyone else keeps the lock as it was.
   */
  holdFeet?: boolean;
  /**
   * (Round 15) The sim's ground velocity (world m/s, x and z): the gait is paced by it and the hips turn toward it
   * (warpHips). Null or absent: the gait runs on `speed` alone, as before.
   */
  vel?: { x: number; z: number } | null;
  /** (Round 15) The hips may turn toward `vel` (default true; the quarterback's pocket keeps his clips square). */
  warp?: boolean;
  /**
   * (Round 16) Which side loops a player moving at an angle to his facing plays (the side layer, sideDrive): the
   * shuffle (default), or the line's slide and kick-slide ('ol': an offensive lineman, who never backpedals). False
   * turns the layer off.
   */
  side?: 'ol' | 'lb' | false;
  /** (Round 16) The side the layer takes when he goes straight back (+1 his left, -1 his right): a tackle's kick foot is his outside one. */
  sidePref?: number;
}

const FEET = ['l', 'r'] as const;
const NO_SYNC = (): void => {};
/**
 * (Round 16) An eased share (the gait's, the pedal's, the side layer's, a stance's) toward 0 or 1, taken there once it's
 * within SNAP. Eased by a fraction a frame they never got there, and a clip at a weight of 1e-5 is sampled whole by the
 * mixer all the same: half the clips sampled each frame were under 1e-3 (tools/sim/a16_animbench.ts --count). A share
 * this close moves no bone by more than a tenth of a millimetre.
 */
const SNAP = 1e-3;
const ease = (v: number, target: number, k: number): number => {
  const n = v + (target - v) * k;
  return Math.abs(target - n) < SNAP ? target : n;
};
const G = 9.81;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _pole = new THREE.Vector3();
const _fwd = new THREE.Vector3();

interface FootState {
  weight: number;
  locked: boolean;
  pos: THREE.Vector3;
  /** (Passing round 14) Where the sim had him (the player's root) when the foot planted: holdOver's drift. */
  anchor: THREE.Vector3;
  /** (Passing round 14) The one-shot's travel (m, transTravel) when the foot planted: the stride it keys over the foot since. */
  travel0: number;
  /** (Passing round 14) How far the planted point has given since it planted (m, lockFoot): drift already taken. */
  spent: number;
  /** What planted it: standing, locomotion or a one-shot (round 15: a change keeps the lock). */
  source: 'stand' | 'loco' | 'trans' | null;
  /** (Round 15) Where the ball of the foot was drawn last frame (world). */
  drawn: THREE.Vector3;
  /** (Round 15) Lifted: the lock's difference from the clip's foot at the lift, blended out over RELEASE (horizontal). */
  relOff: THREE.Vector3;
  /** (Round 15) A step under way (stepFoot): its progress 0..1, its time (s) and its arc's height (m); from where. */
  step: { u: number; dur: number; h: number } | null;
  stepFrom: THREE.Vector3;
  /** (Round 15) The ball's height before the leans where the lock took it (its settle, lockFoot). */
  preY: number;
  /** (Round 15) What the leans had moved the clip's foot by where the lock took it (horizontal; the step's 'far'). */
  leanOff: THREE.Vector3;
  /** (Round 15) This release's length (s, letGo). */
  relDur: number;
  /** (Round 16) How long it has been planted (s): the pop meter's step records. */
  age: number;
}

const newFoot = (): FootState => ({ weight: 0, locked: false, pos: new THREE.Vector3(), anchor: new THREE.Vector3(), travel0: 0, spent: 0, source: null, drawn: new THREE.Vector3(), relOff: new THREE.Vector3(), step: null, stepFrom: new THREE.Vector3(), preY: 0, leanOff: new THREE.Vector3(), relDur: 0.08, age: 0 });

interface TransitionState {
  name: string;
  t: number;
  /** Playback rate (a throw is timed to the sim's release). */
  rate: number;
  /** Layer weight: fades in over TRANS_IN, out over TRANS_OUT after the hand-over. */
  w: number;
  done: boolean;
  travel: number;
}

// s: each transition starts from the pose it leaves, so a short fade; long
// enough that the change spans ~4 frames at 30 fps and ~8 at 60 (M5.5: at
// 0.08 s the get-offs and jukes popped in two frames).
const TRANS_IN = 0.14;
const TRANS_OUT = 0.16;

/**
 * An upper-body overlay (a carry, a catch, a stiff arm): its clip, sampled
 * at `t`, drives only the bones in its mask, over whatever the base layers
 * (stance, gait, transition) posed, by weight `w`.
 */
interface Overlay {
  name: string;
  t: number;
  w: number;
  rate: number;
  loop: boolean;
  duration: number;
  /** Fading out (a one-shot that ended, or a hold that was cleared). */
  out: boolean;
  tracks: OverlayTrack[];
}

interface OverlayTrack {
  bone: THREE.Bone;
  interp: THREE.Interpolant;
}

/** How the look is shared out (passing round 2): the neck and head; wide, the upper back first. */
const LOOK_PARTS: readonly (readonly [string, number])[] = [
  ['neck_02', 0.4],
  ['head', 0.6],
];
const LOOK_PARTS_WIDE: readonly (readonly [string, number])[] = [
  ['spine_04', 0.35],
  ['neck_02', 0.26],
  ['head', 0.39],
];
/**
 * A wide look's reach (rad, ~125°: a receiver running away from the QB gets
 * his eyes back over his shoulder by turning his chest ~45° and his neck
 * ~80°) and how far down (rad, ~60°: eyes into his hands at the chest).
 * Ours, from the broadcast's over-the-shoulder catch and the coaching line
 * "look it into the tuck".
 */
const LOOK_WIDE = 2.2;
const LOOK_DOWN_WIDE = 1.05;

/** The trunk's fold toward the hands' targets (reachTrunk), shared down the spine. Ours: most in the thorax, as a reach is. */
const TRUNK_REACH: readonly (readonly [string, number])[] = [
  ['spine_01', 0.2],
  ['spine_02', 0.3],
  ['spine_03', 0.3],
  ['spine_04', 0.2],
];
/** The arms count as reaching this share of their length (the elbow never quite locks). */
const REACH_SLACK = 0.97;
const OVERLAY_IN = 0.13;
const OVERLAY_OUT = 0.16;
/** The carrier's family weights ease in over ~0.2 s (a burst or traffic reads within a stride, not in a frame). */
const FAMILY_RATE = 6;
/** The dip comes in over ~0.12 s and goes over ~0.2 s. */
const DIP_IN = 0.12;
const DIP_OUT = 0.2;
/** The press of a designed run: the trunk pitched this much further forward (rad, ~7°). */
const PRESS_PITCH = 0.12;
/** The run's lean pivots this high (m, base body: the hips, near the centre of mass; skeleton.py pelvis at 1.00). */
const LEAN_PIVOT = 0.95;
/**
 * (Passing round 14) A planted foot keeps the clip's knee. The lock holds a planted foot where it landed while the
 * body goes where the sim has it, and the clips play in place; when the sim carried him off a planted foot (the
 * contested ball's QB drifting 0.10 m back in the pocket as he threw off his front foot), the IK reached the foot with
 * a straight leg: 3 deg at the release against 34 keyed (docs/passing/PASSING14.md). For the QB (AnimInput.holdFeet),
 * in a one-shot (his throws and finishes: not a stance, where a walk-off drifts him off both feet at once, nor the
 * run's cycle, whose feet re-plant every step), the body is first held over its planted feet against the sim's drift, up
 * to ROOT_GIVE off the sim's spot (holdOver), and past that the planted point gives: it follows the clip's foot by just
 * enough that the knee is never straighter than the clip's less KNEE_GIVE (lockFoot).
 * KNEE_GIVE: ours, ~1.5 cm of reach at a set QB's ~35 deg, under a pixel at broadcast distance (the QB ~80 px tall).
 * ROOT_GIVE: ours, the contested ball's 0.10 m with room, under a third of a stride (the drawn body that far off the
 * sim's spot reads as the same man in the same place). ROOT_OUT: the hold lets go over ~0.25 s once no planted foot
 * needs it (the feet stepping again), so the body comes back to the sim's spot within a stride.
 */
const KNEE_GIVE = (5 * Math.PI) / 180;
const ROOT_GIVE = 0.12;
const ROOT_OUT = 0.25;
/** (Round 15) A planted point gives at most this far (m) in all: the pop meter's 'planted' line is 2 cm (popMeter.ts). */
const GIVE_MAX = 0.015;
type LockSource = 'loco' | 'stand' | 'trans';
const _hip = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _ank = new THREE.Vector3();
const _need = new THREE.Vector3();
const _rp = new THREE.Vector3();
const _oq = new THREE.Quaternion();
const _oq2 = new THREE.Quaternion();
const _oq3 = new THREE.Quaternion();
const _cb = new THREE.Vector3();
/**
 * (Round 15) A bone's world position from its world matrix as it stands. getWorldPosition recomputes every ancestor's
 * matrix on each call; the round's reads come where the skeleton is already up to date (after the leans' and the
 * solves' updateMatrixWorld), so they read it as it is (the animator's cost per body: docs/anim/FEET15.md).
 */
const wpos = (b: THREE.Object3D, v: THREE.Vector3): THREE.Vector3 => v.setFromMatrixPosition(b.matrixWorld);
/** (Round 16) Its world rotation, the same way (getWorldQuaternion's decompose, without recomputing the ancestors first). */
const wquat = (b: THREE.Object3D, q: THREE.Quaternion): THREE.Quaternion => {
  b.matrixWorld.decompose(_dpos, q, _dscale);
  return q;
};
const _dpos = new THREE.Vector3();
const _lw = new THREE.Quaternion();
const _lq = new THREE.Quaternion();
const _lp = new THREE.Quaternion();
const _le = new THREE.Euler();
const _dscale = new THREE.Vector3();
const _tb = new THREE.Vector3();
const _fq = new THREE.Quaternion();
/**
 * (Round 15) The planted feet: a planted foot holds until it lifts, and one that can't hold steps (lockFoot, stepFoot).
 * STEP_FAR: a planted foot steps when the clip has its foot this far (m, base body) from where the lock holds it. Ours: a
 * set lineman's or a defensive back's feet are ~0.3-0.4 m apart, so 0.2 m off reads as a different stance; under it the
 * lock takes up the stride's own mismatches (the gait blends' 2-10 cm), which are gone at the next lift.
 * REACH_MISS: or when the leg can't reach it: the hip to the ankle's target longer than the straight leg by this much
 * (m). Ours: 3 cm of a ball of the foot held short of the turf is under a pixel at broadcast distance, and a banked
 * runner's outside leg (lean: the bank tips him about the hips) reaches for the turf at the edge of its length.
 * The step: STEP_T0 + d/STEP_V s for a step of d m, at most STEP_TMAX; its arc STEP_H0 + STEP_HK·d m high, at most
 * STEP_HMAX. Ours, from the gait keyer's quick steps (tools/blender/lib/gait.py: a shuffle step's 0.17 s swing and 6 cm
 * lift at 2 m/s, actions_m6_back7.py SHUFFLE; a run's 0.2 s swing): a 0.2 m step takes ~0.15 s and clears 5 cm.
 * RELEASE: a lifted foot's lock blends out over this long (s): a sixth of a jog's swing (0.47 s at 3.5 m/s).
 */
/**
 * (Round 15) The hips toward the sim's velocity (warpHips): by up to WARP_MAX (rad, 55 deg) either way, eased at
 * WARP_RATE (1/s, ~0.1 s), once he moves faster than WARP_MIN (m/s, a slow walk's 0.5). Ours: a back-seven player who
 * opens to run with his eyes on the quarterback turns his hips ~45-60 deg off his chest ("open the hips"; a corner's
 * bail at 45 deg); past that he turns and runs (the sim's facing goes with him). WARP_TWIST: the turn back up the
 * spine, most in the thorax (as TRUNK_REACH), all of it, so the chest faces where it did.
 */
const WARP_MAX = (55 * Math.PI) / 180;
const WARP_RATE = 10;
const WARP_MIN = 0.5;
/** (Round 15) Past this (rad, 120 deg) off his facing he isn't turned toward it (moving back a step or two, no pedal). */
const WARP_OFF = (120 * Math.PI) / 180;
const WARP_TWIST: readonly (readonly [string, number])[] = [
  ['spine_01', 0.2],
  ['spine_02', 0.3],
  ['spine_03', 0.3],
  ['spine_04', 0.2],
];
const _up = new THREE.Vector3(0, 1, 0);
/**
 * (Round 16) The side layer (sideDrive): a player moving at an angle to the way he faces shuffles (the keyed lb_shuffle
 * and its quick version, tools/blender/lib/actions_a16.py), and a lineman slides or kick-slides (ol_slide, ol_set),
 * instead of running a forward gait turned sideways (round 15's warpHips alone: a crossover run, docs/anim/FEET16.md).
 * SIDE_IN / SIDE_OUT: his velocity this far (rad) off his facing, and as far off straight back, takes him into the layer;
 * under SIDE_OUT (or past pi - SIDE_OUT) he leaves it (hysteresis: a scrape's angle wobbles a few degrees a tick). Ours:
 * past ~55 deg off his chest a coach says "shuffle", not "open and run"; the forward gait's hips cover WARP_MAX (55 deg).
 * The line has no upper bound: a lineman retreating kick-slides (a set), he never backpedals.
 * SIDE_VIN / SIDE_VOUT: faster than this (m/s) he turns and runs instead (the quick shuffle is keyed at 3.4 m/s and reads
 * as a shuffle to ~1.15x; past that a linebacker's scrape is a crossover run, the round-15 gait). The line's: a tackle's
 * vertical set is kick-slides at the sim's 3-4 m/s (the deep set keyed at 3.2 m/s, played to ~1.4x).
 * SIDE_WARP: in the layer the hips turn toward his velocity by up to this (rad, 45 deg) off the loop's own travel (a
 * shuffle on a slant: the hips open or close, the chest kept where he faces, as warpHips).
 * SET_OUT: the kick-slide loop's travel off straight back (rad, 28 deg: actions_a16.py KICK_OUT, the one-shot's 1.05 m
 * back and 0.55 m out); the line's layer blends the slide (sideways) into the set (back and out) by the angle.
 * SIDE_FLIP: the layer changes side (left to right) only once his velocity is this far (sin) on the other side, so a
 * tackle setting straight back keeps his kick foot.
 */
const SIDE_IN = (58 * Math.PI) / 180;
const SIDE_OUT = (48 * Math.PI) / 180;
const SIDE_VIN = 3.9;
const SIDE_VOUT = 4.4;
const SIDE_VIN_OL = 5.0;
const SIDE_VOUT_OL = 5.6;
const SIDE_WARP = (45 * Math.PI) / 180;
const SET_OUT = (28 * Math.PI) / 180;
const SIDE_FLIP = 0.3;
/** (Round 16) The side loops by style and side: the slide (sideways) and the set (back and out), each slow to fast. */
const SIDE_CLIPS = {
  lb: { l: { slide: ['lb_shuffle_l', 'lb_shuffle_fast_l'], set: [] as string[] }, r: { slide: ['lb_shuffle_r', 'lb_shuffle_fast_r'], set: [] as string[] } },
  ol: { l: { slide: ['ol_slide_l'], set: ['ol_set_l', 'ol_set_fast_l'] }, r: { slide: ['ol_slide_r'], set: ['ol_set_r', 'ol_set_fast_r'] } },
} as const;
type SideFam = { slide: GaitClip[]; set: GaitClip[] };
const STEP_FAR = 0.2;
const REACH_MISS = 0.03;
/** (Round 16: a little longer, for the toe-off and the landing's roll either side of the swing; see STEP_OFF.) */
const STEP_T0 = 0.12;
const STEP_V = 4;
const STEP_TMAX = 0.26;
/**
 * (Round 16) The step's shape (stepRoll), from our gait keyer (tools/blender/lib/gait.py; the quick steps' numbers from
 * actions_m6_back7.py SHUFFLE and gait.py's backpedal): the heel comes up off the ball over the first STEP_OFF of the step
 * (toe-off, to STEP_TOE: the shuffle's 24 deg), the swing runs to STEP_ON, and the foot lands heel first (STEP_STRIKE toes
 * up: between the keyer's walk, 16, and jog, 6) and rolls flat over the rest; a clip that has him on the balls of his
 * feet (pitched STEP_ON_BALLS or more: a set lineman, a shuffle's 16) lands on the ball, as the keyer's forefoot gaits do.
 */
const STEP_OFF = 0.2;
const STEP_ON = 0.85;
const STEP_TOE = (24 * Math.PI) / 180;
const STEP_STRIKE = (9 * Math.PI) / 180;
const STEP_ON_BALLS = (12 * Math.PI) / 180;
/**
 * (Round 16) The rest foot (tools/blender/lib/skeleton.py J, poses.py HEEL_REST): the ankle 6.3 cm over and 14.5 cm
 * behind the ball (its pitch), and the heel 21.0 cm behind the ball and 1.0 cm under it: off the ankle-from-ball
 * direction by HEEL_TURN (rad, down) and HEEL_K times its length.
 */
const FOOT_REST_PITCH = Math.atan2(0.063, 0.145);
const HEEL_TURN = -(Math.atan2(0.063, 0.145) + Math.atan2(0.01, 0.21));
const HEEL_K = Math.hypot(0.21, 0.01) / Math.hypot(0.145, 0.063);
const smooth01 = (x: number): number => {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};
const _so = new THREE.Vector3();
const _sa = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _sq = new THREE.Quaternion();
const STEP_H0 = 0.03;
const STEP_HK = 0.12;
const STEP_HMAX = 0.09;
const RELEASE = 0.08;
/** (Round 15) A release's difference goes at no more than REL_V m/s (a jog's swing foot), in at most REL_MAX s. */
const REL_V = 3;
const REL_MAX = 0.25;
/** (Round 15) A planted foot the clips lift within this long (s) lets go early rather than step: a quarter of a run's swing. */
const LIFT_SOON = 0.06;
/** (Round 15) The lock follows the clip's ball down while it's still landing: the ball this far (m) under where the lock took it. */
const SETTLE = 0.002;
/** (Round 15) A lock this far engaged (its weight) is planted: the pop meter's own line (popMeter.ts LOCK_FULL). */
const LOCK_ON = 0.98;
/** (Round 15) The clip's knee this far (m) off the hip-to-ankle line is a bend the leg's solve keeps (~8 deg on this rig's 0.46 m bones). */
const KNEE_BENT = 0.03;

export class PlayerAnimator {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  /** (Round 16) The transition given weight last frame. */
  private transAct: THREE.AnimationAction | null = null;

  /** (Round 16) A clip's action, made (playing, silent) the first time it's wanted. */
  private act(name: string): THREE.AnimationAction | undefined {
    let a = this.actions.get(name);
    if (!a) {
      const clip = this.lib.clips.get(name);
      if (!clip) return undefined;
      a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      this.off(a);
      this.actions.set(name, a);
    }
    return a;
  }

  /**
   * (Round 16) A clip at a weight: made if it's wanted and isn't yet; at 0, off (`enabled` false: the mixer passes it by
   * without stepping its time, the same as a weight of 0). Returns its action, if it has one.
   */
  private weigh(name: string, w: number): THREE.AnimationAction | undefined {
    const a = w > 0 ? this.act(name) : this.actions.get(name);
    if (a) {
      if (w > 0) this.on(a, w);
      else this.off(a);
    }
    return a;
  }
  private on(a: THREE.AnimationAction, w: number): void {
    a.enabled = true;
    a.setEffectiveWeight(w);
  }
  private off(a: THREE.AnimationAction): void {
    a.enabled = false;
    a.setEffectiveWeight(0);
  }
  private stance = 'stance_idle';
  private stanceWeights = new Map<string, number>();
  private stanceTime = 0;
  private loco = 0; // 0 standing .. 1 moving
  phase = 0;
  /** The backpedal cycle's share of the gait layer and its own phase. */
  private back = 0;
  private backPhase = 0;
  /**
   * (Round 16) The side layer (sideDrive): its shares to the left and right (eased), its phase (the left loops'; the
   * right ones play half a cycle on, so each foot keeps its own phase through a change of side), the sim's speed along
   * the loop's travel (eased), the slide-to-set blend (the line's), the side it's on and whether it's on (hysteresis).
   */
  private sideL = 0;
  private sideR = 0;
  sidePhase = 0;
  private sideSpeed = 0;
  private sideU = 0;
  private sideDir = 1;
  private sideOn = false;
  private sideStyle: 'lb' | 'ol' = 'lb';
  /** Its loops (preallocated: no per-frame garbage), by style and side, and each one's weight and phase this frame. */
  private sideFam: Record<'lb' | 'ol', Record<'l' | 'r', SideFam>> = { lb: { l: { slide: [], set: [] }, r: { slide: [], set: [] } }, ol: { l: { slide: [], set: [] }, r: { slide: [], set: [] } } };
  private sideClips: GaitClip[] = [];
  /** (Round 16) The pedal's family: its slow version and itself (slow to fast), and this frame's sample. */
  private bpSlow: GaitClip | null = null;
  private backFam: GaitClip[] = [];
  private backSmp: GaitSample = { a: null as unknown as GaitClip, b: null as unknown as GaitClip, w: 1, stride: 0 };
  private sideRight: boolean[] = [];
  private sideW: number[] = [];
  private sidePh: number[] = [];
  private sideSmp: GaitSample[] = [0, 1].map(() => ({ a: null as unknown as GaitClip, b: null as unknown as GaitClip, w: 0, stride: 0 }));
  private feet: Record<'l' | 'r', FootState> = { l: newFoot(), r: newFoot() };
  private look = new THREE.Quaternion();
  private padSpring = { x: 0, v: 0 };
  private chestY: number[] = [];
  /**
   * Every bone's rotation as the clips alone left it last frame. three's
   * mixer only writes a bone when its mixed value changes, so a bone whose
   * clip value holds still (the root, a frozen stance) would keep last
   * frame's procedural edits (lean, IK, look-at, pads) and they would
   * compound. Each update puts this pose back before the mixer runs.
   */
  private animPose: [THREE.Bone, THREE.Quaternion][] = [];
  /** The root bone's position as the clips left it (the lean moves it about the hips; it must not compound either). */
  private animRootPos = new THREE.Vector3();
  private trans: TransitionState | null = null;
  /** A stop waiting for the left foot's touch-down (the clip starts there). */
  private queued: string | null = null;
  /** Overlays: a held one (the ball carried, the QB's hold) and a one-shot action over it. */
  private holdLayer: Overlay | null = null;
  private actionLayer: Overlay | null = null;
  /**
   * The throw's arm slot (passing round 8): a variant of the throw playing now
   * (its side-arm or over-the-top version, keyed on the same timing), laid
   * over its upper body at the throw's own time, by a weight the caller sets.
   */
  private slot: { base: string; o: Overlay; w: number } | null = null;
  /**
   * A one-shot's depth (passing round 9): another clip keyed on the same beat
   * (the chest catch under the forward reach) laid over the one-shot `base`
   * over base's own mask, at base's time plus `shift` (their secure frames
   * aligned), by a weight the caller sets.
   */
  private mix: { base: string; o: Overlay; w: number; shift: number } | null = null;
  /** The dip before contact, one held overlay per side, weighted by the input (between the hold and the action). */
  private dipL: Overlay | null = null;
  private dipR: Overlay | null = null;
  /** The gait families' eased inputs (carry, traffic, drive) and the press. */
  private carryW = 0;
  private leftW = 0;
  private trafficW = 0;
  private driveW = 0;
  private pressW = 0;
  /** Every locomotion clip in the families, its weight this frame and its warped phase (preallocated: no per-frame garbage). */
  private locos: GaitClip[] = [];
  private locoW: number[] = [];
  private locoPhase: number[] = [];
  private famW = [1, 0, 0, 0, 0, 0, 0];
  private samples: GaitSample[] = [];
  /** Root motion this update (m along the facing, body-scaled) and its rate (m/s). */
  rootMotion = 0;
  rootSpeed = 0;
  footLock = true;
  /** The trunk's last fold toward the hands (rad, reachTrunk): for the per-frame catch log. */
  trunkReach = 0;
  /** The chest (spine_04) in the world after the clips and the run's lean, before any contact lean (M6.5 #12). */
  readonly trunk = new THREE.Vector3();
  /** Last frame's foot-lock correction per foot (m): how much slide the lock removed. */
  readonly correction = { l: 0, r: 0 };
  /** (Passing round 14) The body held over its planted feet: the root bone's world offset off the sim's spot (m, holdOver). */
  readonly give = new THREE.Vector3();
  /** (Passing round 14) Last frame's give of each planted point (m): how far the lock let the foot follow the clip's to keep the knee. */
  readonly slid = { l: 0, r: 0 };
  /** (Passing round 14) Each knee's flexion as the clips keyed it this frame, before the lock's IK (rad; keyedReach): for the per-frame log. */
  readonly keyedKnee = { l: 0, r: 0 };

  /** A foot's lock as it stands after this frame (passing round 14: the pop meter's slide on planted feet, render/game/popMeter.ts). */
  footLockOf(s: 'l' | 'r'): { readonly locked: boolean; readonly weight: number; readonly pos: THREE.Vector3; readonly source: LockSource | null } {
    return this.feet[s];
  }
  /**
   * (Round 15, the pop meter's causes) Each foot's lock this frame: how far the leg's IK fell short of the ankle's
   * target (m: out of reach), and what re-planted it this frame ('' none; else the source it left and the one it took).
   */
  readonly lockDbg = { l: { miss: 0, replant: '', stepped: false, why: '', cb: new THREE.Vector3(), far: 0, over: 0, age: 0 }, r: { miss: 0, replant: '', stepped: false, why: '', cb: new THREE.Vector3(), far: 0, over: 0, age: 0 } };
  /** (Round 15) The gait's state this frame, for the pop meter's traces: the speed fed, the loco and backpedal shares, the phases. */
  gaitDbg(): { speed: number; loco: number; back: number; phase: number; backPhase: number; side: number; sideSpeed: number; sidePhase: number; sideU: number; style: string } {
    return { speed: this.lastSpeed, loco: this.loco, back: this.back, phase: this.phase, backPhase: this.backPhase, side: this.sideL - this.sideR, sideSpeed: this.sideSpeed, sidePhase: this.sidePhase, sideU: this.sideU, style: this.sideStyle };
  }
  private lastSpeed = 0;
  /** (Round 15) This frame's lean (rad): the bank into the turn and the pitch, for the per-frame log. */
  readonly leanDbg = { bank: 0, pitch: 0 };

  constructor(
    readonly player: Player,
    readonly lib: AnimLibrary,
  ) {
    this.mixer = new THREE.AnimationMixer(player.root);
    // An action for every clip, in the library's order (the mixer blends them in that order; made as each is first
    // wanted instead, the order changes a three-way crossfade by a few mm: tools/sim/a16_animbench.ts --dump). (Round 16)
    // Each is off (`enabled` false) while it has no weight: the mixer passes it by without stepping its time.
    for (const n of lib.clips.keys()) this.act(n);
    this.stanceWeights.set(this.stance, 1);
    this.rootB = this.bone('root');
    this.chestB = this.bone('spine_04');
    this.headB = this.bone('head');
    this.neckB = this.bone('neck_02');
    const both = (n: string) => ({ l: this.bone(`${n}_l`), r: this.bone(`${n}_r`) });
    this.legs = { toe: both('toe'), foot: both('foot'), thigh: both('thigh'), calf: both('calf'), pad: both('pad') };
    this.twistB = WARP_TWIST.map(([n]) => this.bone(n));
    for (const bone of player.bones.values()) this.animPose.push([bone, bone.quaternion.clone()]);
    // (Round 16) A bone's Euler rotation is never read (its matrix is made from its quaternion, and nothing in the game
    // reads a bone's .rotation), so its quaternion no longer keeps it in step: three converts the quaternion to Euler
    // angles on every write (Object3D's onQuaternionChange), and the clips, the restore of the clip pose, the overlays
    // and the solves write every bone several times a frame. It was a fifth of the animator's time (docs/anim/FEET16.md).
    for (const bone of player.bones.values()) bone.quaternion._onChange(NO_SYNC);
    this.animRootPos.copy(this.rootB.position);
    for (const f of lib.families) {
      for (const g of f) if (!this.locos.includes(g)) this.locos.push(g);
      this.samples.push({ a: f[0]!, b: f[0]!, w: 0, stride: 0 });
    }
    this.locoW = this.locos.map(() => 0);
    this.locoPhase = this.locos.map(() => 0);
    // (Round 16) The side loops, from the library (an older library without them: no side layer).
    for (const st of ['lb', 'ol'] as const) {
      for (const sd of ['l', 'r'] as const) {
        for (const part of ['slide', 'set'] as const) {
          const out = this.sideFam[st][sd][part];
          for (const n of SIDE_CLIPS[st][sd][part]) {
            const m = lib.meta[n];
            if (!m || !lib.clips.has(n)) continue;
            const [a, b] = m.contacts.l[0]!;
            const g = this.sideClips.find((c) => c.name === n) ?? { name: n, speed: m.speed, duration: m.duration, duty: ((b - a + m.frames) % m.frames) / m.frames };
            if (!this.sideClips.includes(g)) {
              this.sideClips.push(g);
              this.sideRight.push(sd === 'r');
            }
            out.push(g);
          }
          out.sort((x, y) => x.speed - y.speed);
        }
      }
    }
    this.sideW = this.sideClips.map(() => 0);
    // (Round 16) The slow pedal, when the library has it.
    const ms = lib.meta.loco_backpedal_slow;
    const mb = lib.meta.loco_backpedal;
    if (ms && mb && lib.clips.has('loco_backpedal_slow')) {
      const gc = (n: string, m: ClipMeta): GaitClip => ({ name: n, speed: m.speed, duration: m.duration, duty: 0.5 });
      this.bpSlow = gc('loco_backpedal_slow', ms);
      this.backFam = [this.bpSlow, gc('loco_backpedal', mb)];
    }
    this.sidePh = this.sideClips.map(() => 0);
  }

  /** Forget all runtime state (phase, planted feet, springs): replay from a clean start. */
  reset(): void {
    this.phase = 0;
    this.loco = 0;
    this.stanceTime = 0;
    for (const s of FEET) {
      this.feet[s].locked = false;
      this.feet[s].weight = 0;
      this.feet[s].source = null;
      this.feet[s].step = null;
    }
    this.give.set(0, 0, 0);
    this.sideL = this.sideR = 0;
    this.sideOn = false;
    this.sideSpeed = 0;
    this.look.identity();
    this.padSpring = { x: 0, v: 0 };
    this.chestY = [];
    this.trans = null;
    this.queued = null;
    this.holdLayer = null;
    this.actionLayer = null;
    this.slot = null;
    this.mix = null;
    this.dipL = null;
    this.dipR = null;
    this.carryW = 0;
    this.leftW = 0;
    this.trafficW = 0;
    this.driveW = 0;
    this.pressW = 0;
    this.rootMotion = 0;
    this.rootSpeed = 0;
  }

  /**
   * Play a transition clip. Stops (from a gait) wait for the next left
   * touch-down, which is where they were authored from; everything else
   * starts now. The caller keeps feeding the speed it wants after the clip:
   * the run speed through a get-off, zero through a stop.
   */
  play(name: string, opts: { now?: boolean; rate?: number; t0?: number } = {}): void {
    const m = this.lib.meta[name];
    if (!m || m.kind !== 'transition') return;
    if (!opts.now && m.from?.startsWith('loco_') && this.loco > 0.5 && name.startsWith('stop_')) this.queued = name;
    else this.start(name, opts.rate ?? 1, opts.t0 ?? 0);
  }

  /**
   * Let a transition out of a gait go early: it fades out over the gait,
   * which carries on from the phase it's at (a cut's run-out steps giving
   * way to the burst's drive).
   */
  release(toGait = true): void {
    const tr = this.trans;
    if (!tr || tr.done) return;
    tr.done = true;
    // (Round 16: or, toGait false, into whatever his speed asks for: a get-off let go as the sim starts him back or
    // sideways at a walk eases into the gait rather than taking it at once.)
    if (toGait) this.loco = 1;
  }

  /**
   * Re-time the transition playing now (if it's `name`): jump ahead to `t`
   * (never back) and/or change its rate. A tackle clip is timed to the sim's
   * hold as it goes: slowed while he rides the ball carrier, caught up to its
   * going-down key when the sim puts them down.
   */
  retime(name: string, opts: { t?: number; rate?: number }): void {
    const tr = this.trans;
    if (!tr || tr.done || tr.name !== name) return;
    if (opts.t !== undefined && opts.t > tr.t) tr.t = opts.t;
    if (opts.rate !== undefined) tr.rate = opts.rate;
  }

  /** The transition playing now and its time (s), or null. */
  get transition(): { name: string; t: number; done: boolean } | null {
    return this.trans ? { name: this.trans.name, t: this.trans.t, done: this.trans.done } : null;
  }

  /** Hold an overlay (null clears it): the ball tucked, the QB's two-hand hold. */
  setHold(name: string | null): void {
    if (name === (this.holdLayer && !this.holdLayer.out ? this.holdLayer.name : null)) return;
    if (!name) {
      if (this.holdLayer) this.holdLayer.out = true;
      return;
    }
    this.holdLayer = this.overlay(name, { loop: true });
  }

  /**
   * Play a one-shot overlay: a catch, a stiff arm, a pump fake, or any clip
   * masked to the upper body (a throw on the run: pass `mask`). `rate` and
   * `t0` time it to the sim.
   */
  playOverlay(name: string, opts: { rate?: number; t0?: number; mask?: string[] } = {}): void {
    const o = this.overlay(name, { rate: opts.rate, t0: opts.t0, mask: opts.mask });
    if (o) this.actionLayer = o;
  }

  /** Change the rate of the one-shot overlay playing now, if it's this clip (a throw on the run paced to the sim's release). */
  retimeOverlay(name: string, rate: number): void {
    const o = this.actionLayer;
    if (o && !o.out && o.name === name) o.rate = rate;
  }

  /**
   * The throw's arm slot (passing round 8): `name` (a slot variant of the
   * throw `base`: render/game/choreo.ts throwSlot) over the upper body at
   * weight `w`, sampled at the time `base` is at (as a transition, or as the
   * one-shot overlay of a throw on the run). Null clears it.
   */
  setSlot(base: string | null, name: string | null, w: number): void {
    if (!base || !name || w <= 0) {
      this.slot = null;
      return;
    }
    if (!this.slot || this.slot.o.name !== name || this.slot.base !== base) {
      const o = this.overlay(name, {});
      this.slot = o ? { base, o, w } : null;
    }
    if (this.slot) this.slot.w = Math.min(1, w);
  }

  /**
   * Carry the throw playing now on as another clip that is the same pose for
   * pose up to where it is (passing round 10: a throw's finish, keyed from its
   * release frame on: tools/blender/lib/actions_p10.py). The transition (or
   * the throw-on-the-run overlay, over `mask`) keeps its time, rate and
   * weight, so the swap never shows. False when `base` isn't playing or
   * `name` isn't in the library.
   */
  continueAs(base: string, name: string, mask?: string[]): boolean {
    const m = this.lib.meta[name];
    if (!m) return false;
    const tr = this.trans;
    if (tr && !tr.done && tr.name === base && m.kind === 'transition') {
      tr.name = name;
      return true;
    }
    const o = this.actionLayer;
    if (o && !o.out && o.name === base) {
      const n = this.overlay(name, { rate: o.rate, t0: o.t, mask });
      if (!n) return false;
      n.w = o.w;
      this.actionLayer = n;
      return true;
    }
    return false;
  }

  /**
   * The one-shot `base`'s depth (passing round 9: render/game/choreo.ts
   * reachDepth): `name` laid over it at weight `w` (0..1), sampled at base's
   * time plus `shift` (s), over base's mask, faded with it. A forward reach
   * for a ball 0.8 m out is mostly the chest catch, one at 1.15 m all reach.
   * Null clears it.
   */
  setMix(base: string | null, name: string | null, w: number, shift = 0): void {
    if (!base || !name) {
      this.mix = null;
      return;
    }
    if (!this.mix || this.mix.o.name !== name || this.mix.base !== base) {
      const o = this.overlay(name, { mask: this.lib.meta[base]?.mask });
      this.mix = o ? { base, o, w, shift } : null;
    }
    if (this.mix) {
      this.mix.w = Math.max(0, Math.min(1, w));
      this.mix.shift = shift;
    }
  }

  /** Let the one-shot overlay go (it fades out): a full-body clip takes the arms over. */
  stopOverlay(): void {
    if (this.actionLayer) this.actionLayer.out = true;
  }

  /**
   * Called when a transition that turns the body (meta.turn, deg + left)
   * hands over to a stance: the caller turns the player's root by it at once,
   * so the stance (authored facing straight) lands where the clip left him.
   * The transition then cuts instead of fading (its last frame is the turned stance).
   */
  onTurn: ((deg: number) => void) | null = null;
  /** (Round 15) This frame's update handed a turning clip over (onTurn): the pose is the same in the world, its bones' local rotations jumped by the turn (the pop meter skips the frame). */
  turned = false;

  /** The one-shot overlay playing now and its time, or null. */
  get overlayAction(): { name: string; t: number } | null {
    return this.actionLayer && !this.actionLayer.out ? { name: this.actionLayer.name, t: this.actionLayer.t } : null;
  }

  private overlay(name: string, opts: { loop?: boolean; rate?: number; t0?: number; mask?: string[] }): Overlay | null {
    const clip = this.lib.clips.get(name);
    const meta = this.lib.meta[name];
    if (!clip || !meta) return null;
    const mask = new Set(opts.mask ?? meta.mask ?? []);
    const tracks: OverlayTrack[] = [];
    for (const tr of clip.tracks) {
      const [bone, prop] = tr.name.split('.');
      if (prop !== 'quaternion' || !bone || !mask.has(bone)) continue;
      const b = this.player.bones.get(bone);
      // three sets createInterpolant per track (linear, or slerp for quaternions); the types leave it out.
      if (b) tracks.push({ bone: b, interp: (tr as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant() });
    }
    return { name, t: opts.t0 ?? 0, w: 0, rate: opts.rate ?? 1, loop: !!opts.loop, duration: meta.duration, out: false, tracks };
  }

  private stepOverlay(o: Overlay | null, dt: number): Overlay | null {
    if (!o) return null;
    o.t += dt * o.rate;
    if (o.loop) o.t %= o.duration;
    else if (o.t >= o.duration - OVERLAY_OUT * o.rate) o.out = true;
    o.w = o.out ? o.w - dt / OVERLAY_OUT : Math.min(1, o.w + dt / OVERLAY_IN);
    if (o.w <= 0) return null;
    this.applyOverlay(o, o.w);
    return o;
  }

  private applyOverlay(o: Overlay, w: number): void {
    const t = Math.min(o.t, o.duration - 1e-4);
    for (const k of o.tracks) {
      const v = k.interp.evaluate(t);
      _oq.set(v[0]!, v[1]!, v[2]!, v[3]!);
      k.bone.quaternion.slerp(_oq, Math.min(1, w));
    }
  }

  /** A held overlay whose weight follows a target (the dip): made when it's wanted, dropped when it has faded out. */
  private stepWeighted(o: Overlay | null, name: string, target: number, dt: number): Overlay | null {
    if (!o) {
      if (target <= 0) return null;
      o = this.overlay(name, { loop: true });
      if (!o) return null;
    }
    o.t = (o.t + dt) % o.duration;
    o.w = target > o.w ? Math.min(target, o.w + dt / DIP_IN) : Math.max(target, o.w - dt / DIP_OUT);
    if (o.w <= 0 && target <= 0) return null;
    this.applyOverlay(o, o.w);
    return o;
  }

  /** The stop for the gait nearest a speed. */
  stopFor(speed: number): string {
    let best = 'stop_walk';
    let d = Infinity;
    for (const g of this.lib.gaits) {
      const n = `stop_${g.name.slice(5)}`;
      if (this.lib.meta[n] && Math.abs(g.speed - speed) < d) {
        d = Math.abs(g.speed - speed);
        best = n;
      }
    }
    return best;
  }

  /** A stop is waiting for the next left touch-down. */
  get waiting(): boolean {
    return this.queued !== null;
  }

  /** A transition is playing or waiting to start. */
  get busy(): boolean {
    return this.queued !== null || (this.trans !== null && !this.trans.done);
  }

  /** Metres per second of root motion the active transition would make now (0 if none). */
  transitionSpeed(): number {
    const tr = this.trans;
    if (!tr || tr.done) return 0;
    const m = this.lib.meta[tr.name]!;
    const h = 1 / this.lib.fps;
    return ((travelAt(m, this.lib.fps, tr.t + h) - travelAt(m, this.lib.fps, tr.t)) / h) * this.player.shape.scale;
  }

  private start(name: string, rate = 1, t0 = 0): void {
    this.queued = null;
    this.trans = { name, t: t0, rate, w: this.trans && !this.trans.done ? this.trans.w : 0, done: false, travel: 0 };
  }

  /** The transition finished: its last frame is the first of the clip it hands to. */
  private handOver(to: string, toPhase = 0): void {
    if (to.startsWith('loco_')) {
      this.loco = 1;
      this.phase = toPhase;
    } else {
      this.loco = 0;
      this.stance = to;
      this.stanceWeights.clear();
      this.stanceWeights.set(to, 1);
      this.stanceTime = 0;
    }
  }

  /** (Round 16) The stance he settles into (setStance). */
  get stanceName(): string {
    return this.stance;
  }

  /** Settle into a stance (crossfades from whatever is playing). */
  setStance(name: string): void {
    if (!this.lib.clips.has(name)) return;
    this.stance = name;
    if (!this.stanceWeights.has(name)) this.stanceWeights.set(name, 0);
  }

  private bone(name: string): THREE.Bone {
    const b = this.player.bones.get(name);
    if (!b) throw new Error(`bone ${name} missing`);
    return b;
  }
  /** (Round 16) The bones the animator reads every frame, looked up once (the animator's cost: docs/anim/FEET16.md). */
  private rootB!: THREE.Bone;
  private chestB!: THREE.Bone;
  private headB!: THREE.Bone;
  private neckB!: THREE.Bone;
  private legs!: Record<'toe' | 'foot' | 'thigh' | 'calf' | 'pad', Record<'l' | 'r', THREE.Bone>>;
  private twistB!: THREE.Bone[];

  update(dt: number, input: AnimInput): void {
    this.turned = false;
    const speed = this.gaitSpeed(input, dt);
    this.lastSpeed = speed;
    const scale = this.player.shape.scale;
    // 1. Clips.
    const k = 1 - Math.exp(-dt * 8); // ~0.12 s fades
    // (Round 16) The side layer's shares, eased as the backpedal's.
    this.sideL = ease(this.sideL, this.sideOn && this.sideDir > 0 ? 1 : 0, k);
    this.sideR = ease(this.sideR, this.sideOn && this.sideDir < 0 ? 1 : 0, k);
    const side = this.sideL + this.sideR;
    this.loco = ease(this.loco, (side > 0.5 ? this.sideSpeed : speed) > MIN_LOCO_SPEED ? 1 : 0, k);
    // The gait families (M6.5 #11): every clip of each family with weight,
    // on one shared phase advanced by the blended stride, each warped so the
    // feet plant and lift together.
    const kf = 1 - Math.exp(-dt * FAMILY_RATE);
    this.carryW += ((input.carry ?? 0) - this.carryW) * kf;
    this.trafficW += ((input.traffic ?? 0) - this.trafficW) * kf;
    this.driveW += ((input.drive ?? 0) - this.driveW) * kf;
    this.pressW += ((input.press ?? 0) - this.pressW) * kf;
    this.leftW += ((input.carryLeft ?? 0) - this.leftW) * kf;
    const fam = familyWeights(this.carryW, this.trafficW, this.driveW, this.famW, this.leftW);
    const lw = this.locoW;
    lw.fill(0);
    let stride = 0;
    let duty = 0;
    const families = this.lib.families;
    for (let f = 0; f < families.length; f++) {
      const fw = fam[f] ?? 0;
      if (fw < 1e-3 && f > 0) continue;
      const smp = sampleSorted(families[f]!, speed, scale, this.samples[f]!);
      stride += fw * smp.stride;
      duty += fw * (smp.a.duty + (smp.b.duty - smp.a.duty) * smp.w);
      lw[this.locos.indexOf(smp.a)]! += fw * (1 - smp.w);
      lw[this.locos.indexOf(smp.b)]! += fw * smp.w;
    }
    // (Round 16) The side loops with weight, on the side layer's phase (sideLoops).
    const sd = this.sideLoops(side, scale, dt);
    const lastPhase = this.phase;
    this.back = ease(this.back, input.backpedal ? 1 : 0, k);
    const bpMeta = this.lib.meta.loco_backpedal;
    // (Round 16) The phases advance by the ground he covers this frame (the sim's speed as it is), the clips' blend by the
    // eased speed: stride matching is the feet moving back at the ground speed, and paced by the eased speed (60 ms behind
    // the sim) a back accelerating at 10 m/s^2 ran his gait 0.6 m/s slow, his planted foot left behind the body.
    // (Round 16) The pedal's stride: its slow version's (loco_backpedal_slow, actions_a16.py) blended in under its speed.
    const bpSlow = this.bpSlow;
    const bpStride = bpMeta ? (bpSlow ? sampleSorted(this.backFam, speed, scale, this.backSmp).stride : bpMeta.speed * bpMeta.duration * scale) : 0;
    if (bpMeta && this.back > 0.01) this.backPhase = advancePhase(this.backPhase, this.rawSpeed, dt, bpStride);
    if (!input.backpedal) this.phase = advancePhase(this.phase, this.rawSpeed, dt, stride);
    // A queued stop starts at the left touch-down (the phase wrapping).
    if (this.queued && (this.phase < lastPhase || this.loco < 0.5)) {
      this.start(this.queued);
      this.phase = 0;
    }
    this.rootMotion = 0;
    this.rootSpeed = 0;
    const tr = this.trans;
    let trMeta = tr ? this.lib.meta[tr.name] : undefined;
    if (tr && trMeta) {
      const before = travelAt(trMeta, this.lib.fps, tr.t);
      if (!tr.done) {
        tr.t += dt * tr.rate;
        if (tr.t >= trMeta.duration) {
          tr.t = trMeta.duration;
          tr.done = true;
          if (trMeta.to) this.handOver(trMeta.to, trMeta.toPhase);
          // (Round 15: into the gait too, when the caller holds the facing through the clip: choreo.ts turnClip.)
          if (trMeta.turn && trMeta.to && this.onTurn) {
            this.turned = true;
            this.onTurn(trMeta.turn);
            tr.w = 0;
          }
        }
      }
      this.rootMotion = (travelAt(trMeta, this.lib.fps, tr.t) - before) * scale;
      this.rootSpeed = dt > 0 ? this.rootMotion / dt : 0;
      tr.w = tr.done ? Math.max(0, tr.w - dt / TRANS_OUT) : Math.min(1, tr.w + dt / TRANS_IN);
      if (tr.done && tr.w <= 0) {
        this.trans = null;
        trMeta = undefined;
      }
    }
    const tw = this.trans ? this.trans.w : 0;
    // Every clip with weight plants and lifts each foot on the same frame
    // (warped phases), so the blended foot is either planted in all or swinging in all.
    for (let j = 0; j < this.locos.length; j++) {
      const gait = this.locos[j]!;
      const w = this.loco * lw[j]! * (1 - tw) * (1 - this.back) * (1 - side);
      const a = this.weigh(gait.name, w);
      // (Round 16) A clip with no weight leaves the pose alone: its phase isn't needed (warpPhase was a tenth of the cost).
      if (w > 0 || lw[j]! > 0.02) {
        const p = warpPhase(this.phase, gait.duty, duty);
        this.locoPhase[j] = p;
        if (a) a.time = p * gait.duration;
      }
    }
    if (bpMeta) {
      const wb = this.loco * this.back * (1 - tw) * (1 - side);
      const ws = bpSlow ? wb * (1 - this.backSmp.w) : 0;
      const bp = this.weigh('loco_backpedal', wb - ws);
      if (bp) bp.time = this.backPhase * bpMeta.duration;
      if (bpSlow) {
        const sl = this.weigh(bpSlow.name, ws);
        // (The same contacts as the pedal's, the left foot down at 0 for half the cycle: no warp.)
        if (sl) sl.time = this.backPhase * bpSlow.duration;
      }
    }
    for (let j = 0; j < this.sideClips.length; j++) {
      const w = this.sideW[j]!;
      const a = this.weigh(this.sideClips[j]!.name, this.loco * w * (1 - tw));
      if (a && w > 0) a.time = this.sidePh[j]! * this.sideClips[j]!.duration;
    }
    this.stanceTime += dt;
    let total = 0;
    for (const [name, w0] of this.stanceWeights) {
      const w = ease(w0, name === this.stance ? 1 : 0, k);
      if (w === 0 && name !== this.stance) {
        // (Round 16) Faded out: silent from now on, and no longer weighed every frame.
        this.weigh(name, 0);
        this.stanceWeights.delete(name);
        continue;
      }
      this.stanceWeights.set(name, w);
      total += w;
    }
    for (const [name, w] of this.stanceWeights) {
      const a = this.weigh(name, (1 - this.loco) * (total > 0 ? w / total : 0) * (1 - tw));
      if (a) a.time = this.stanceTime % a.getClip().duration;
    }
    // (Round 16) Only the transition playing has weight: the one that played last is set back to 0 (every other one
    // already is), rather than setting all of them every frame.
    const ta = this.trans && this.lib.meta[this.trans.name]?.kind === 'transition' ? this.act(this.trans.name) : undefined;
    if (this.transAct && this.transAct !== ta) this.off(this.transAct);
    this.transAct = ta ?? null;
    if (ta) {
      this.on(ta, tw);
      // Just inside the end: at exactly the duration a repeating action wraps to frame 0.
      ta.time = Math.min(this.trans!.t, ta.getClip().duration - 1e-4);
    }
    // Everything else (the backpedal, future clips) stays silent unless driven.
    const rootBone = this.rootB;
    const ap = this.animPose;
    for (let i = 0; i < ap.length; i++) ap[i]![0].quaternion.copy(ap[i]![1]);
    rootBone.position.copy(this.animRootPos);
    this.mixer.update(0);
    for (let i = 0; i < ap.length; i++) ap[i]![1].copy(ap[i]![0].quaternion);
    this.animRootPos.copy(rootBone.position);
    // Overlays over the clips (the snapshot above is what the next frame
    // restores, so they never compound).
    this.holdLayer = this.stepOverlay(this.holdLayer, dt);
    const dip = input.dip ?? 0;
    this.dipL = this.stepWeighted(this.dipL, 'ovl_dip_l', dip > 0 ? Math.min(1, dip) : 0, dt);
    this.dipR = this.stepWeighted(this.dipR, 'ovl_dip_r', dip < 0 ? Math.min(1, -dip) : 0, dt);
    this.actionLayer = this.stepOverlay(this.actionLayer, dt);
    const mx = this.mix;
    const al0 = this.actionLayer;
    if (mx && al0 && al0.name === mx.base && mx.w > 0) {
      // At the one-shot's own time (its secure frame on the partner's), faded with it.
      mx.o.t = Math.max(0, al0.t + mx.shift);
      this.applyOverlay(mx.o, mx.w * al0.w);
    }
    const sl = this.slot;
    if (sl) {
      // At the throw's own time, faded with it: the transition's weight, or the throw-on-the-run overlay's.
      const tr2 = this.trans;
      const al = this.actionLayer;
      // (A throw carried on into its finish, continueAs, is still the slot's throw: passing round 10.)
      const fin = sl.base + '_fin_';
      const at = tr2 && (tr2.name === sl.base || tr2.name.startsWith(fin)) ? { t: tr2.t, w: tr2.w } : al && (al.name === sl.base || al.name.startsWith(fin)) ? { t: al.t, w: al.w } : null;
      if (at) {
        sl.o.t = at.t;
        this.applyOverlay(sl.o, sl.w * at.w);
      }
    }
    // (Round 16) The skeleton and what it hangs from, not the meshes beside it (the render brings those up to date).
    rootBone.parent?.updateWorldMatrix(true, false);
    rootBone.updateMatrixWorld(true);

    // (Round 15) The hips toward where he's going, the chest kept where he faces.
    this.warpHips(tw);
    // (Passing round 14) The feet as the clips keyed them, before the leans tilt the whole body: a planted foot stays
    // flat on the ground under a lean (lockFoot, for AnimInput.holdFeet).
    // (Round 15) And the balls' heights before the leans, for the lock's settle (lockFoot).
    for (const s of FEET) this.preBallY[s] = wpos(this.legs.toe[s], this.preBall[s]).y;
    if (input.holdFeet) {
      for (const s of FEET) {
        const f = this.legs.foot[s];
        wquat(f, this.footQ[s]);
        wpos(f, this.footOff[s]).sub(wpos(this.legs.toe[s], _v));
        this.footBall[s] = _v.y;
      }
    }
    // 3. Lean (before the feet are locked, so the lock sees the leaned body).
    // (Round 15) For the quarterback (holdFeet) the run's lean is his gait's alone: in his one-shots (the drop, the set,
    // the throw and its finish) the clip has him balanced. On the contested ball the sim turns him 3 rad/s and stops
    // his drift just as the ball goes, and the lean read that as a run: banked 13 deg and pitched from +17 to -9 deg in
    // 0.1 s, it lifted his front hip 5 cm over the planted foot (the front leg straight, 2 deg, for two frames after the
    // release: docs/anim/FEET15.md).
    const leanW = input.holdFeet ? 1 - tw : 1;
    this.lean(speed, (input.yawRate ?? 0) * leanW, (input.accel ?? 0) * leanW, this.pressW * PRESS_PITCH);
    // Where the trunk is before any contact lean (contact.ts reads it: leaning must not feed back into the lean).
    wpos(this.chestB, this.trunk);
    const cl = input.contactLean;
    if (cl && (cl.x !== 0 || cl.z !== 0)) this.leanToward(cl.x, cl.z);
    // 2. Foot lock.
    // A foot is planted when every clip with weight has it planted (when the
    // warp can't align them, e.g. walk against jog, the stricter of the two).
    const plant = this.plant;
    // (Round 15) And whether the clips lift it within LIFT_SOON: a foot that can't hold that close to its lift lets go
    // into its swing (lockFoot) instead of stepping.
    const phaseSoon = stride > 1e-6 ? this.phase + (speed * LIFT_SOON) / stride : this.phase;
    const bpSoon = bpMeta ? this.backPhase + (speed * LIFT_SOON) / Math.max(1e-6, bpStride) : 0;
    // (Round 16) The stance playing, if its feet are keyed to lift (its contacts aren't the whole loop) and it has most of the weight.
    const stMeta = this.lib.meta[this.stance];
    const stFull = (c: [number, number][], n: number) => c.length === 1 && c[0]![0] === 0 && c[0]![1] === n;
    const stPart = stMeta && (this.stanceWeights.get(this.stance) ?? 0) > 0.5 && !(stFull(stMeta.contacts.l, stMeta.frames) && stFull(stMeta.contacts.r, stMeta.frames)) ? stMeta : null;
    for (const s of FEET) {
      const pl = plant[s];
      if (this.trans && trMeta && tw > 0.5) {
        // The transition's own contacts (its frames are absolute, not a cycle).
        pl.down = planted(trMeta, s, Math.min(this.trans.t, trMeta.duration - 1e-4) / trMeta.duration);
        pl.soon = !planted(trMeta, s, Math.min(this.trans.t + LIFT_SOON * this.trans.rate, trMeta.duration - 1e-4) / trMeta.duration);
        pl.source = 'trans';
        continue;
      }
      let down: boolean;
      let soon = false;
      if (this.loco > 0.5 && side > 0.5 && sd.stride > 1e-6) {
        // (Round 16) The side layer's loops: planted when every one with weight has it planted.
        down = true;
        const soonP = this.sidePhase + (this.sideSpeed * LIFT_SOON) / sd.stride;
        for (let j = 0; j < this.sideClips.length; j++) {
          if (this.sideW[j]! > 0.02) {
            const m = this.lib.meta[this.sideClips[j]!.name]!;
            down &&= planted(m, s, this.sidePh[j]!);
            soon ||= !planted(m, s, warpPhase((soonP + (this.sideRight[j] ? 0.5 : 0)) % 1, this.sideClips[j]!.duty, sd.duty));
          }
        }
      } else if (this.loco > 0.5 && this.back > 0.5 && bpMeta) {
        down = planted(bpMeta, s, this.backPhase);
        soon = !planted(bpMeta, s, bpSoon % 1);
      } else if (this.loco > 0.5) {
        down = true;
        for (let j = 0; j < this.locos.length; j++) {
          if (lw[j]! > 0.02) {
            const m = this.lib.meta[this.locos[j]!.name]!;
            down &&= planted(m, s, this.locoPhase[j]!);
            soon ||= !planted(m, s, warpPhase(phaseSoon % 1, this.locos[j]!.duty, duty));
          }
        }
      } else if (this.loco < 0.5 && stPart) {
        // (Round 16) A stance whose feet are keyed to move (the engaged hand fight's chopping feet: dl_engage, ol_engage)
        // plants them by its own contacts, as the gait does: the feet re-set under the block where the clip puts them,
        // rather than held while the sim drifts the pair and then stepped off (docs/anim/FEET16.md).
        const ph = (this.stanceTime % stPart.duration) / stPart.duration;
        down = planted(stPart, s, ph);
        soon = !planted(stPart, s, ((this.stanceTime + LIFT_SOON) % stPart.duration) / stPart.duration);
      } else down = this.loco < 0.5;
      pl.down = down;
      pl.soon = soon;
      pl.source = this.loco > 0.5 ? 'loco' : 'stand';
    }
    // (Passing round 14) The body over its planted feet, then each foot's lock.
    this.holdFeet = !!input.holdFeet;
    this.holdOver(dt, input.groundVelocity);
    for (const s of FEET) this.lockFoot(s, plant[s].source, plant[s].down, dt, input.groundVelocity, plant[s].soon);
    // 4 and 5.
    this.lookAt(input.lookAt ?? null, dt, !!input.lookWide);
    this.pads(dt);
  }

  /**
   * The hands to the ball (passing round 3): after the frame's pose, the
   * arms are bent by two-bone IK so each hand (its fingers' root) goes to a
   * world point, blended by its weight (0 leaves the clip's arm). The
   * elbows bend down and out, the way a receiver's do with his hands up
   * for a ball; the hands keep the clip's orientation (the diamond, the
   * basket). Called by the catch (render/game/choreo.ts catchReach) after
   * update(), so it layers on the catch clip's own reach.
   */
  reachHands(l: THREE.Vector3 | null, wl: number, r: THREE.Vector3 | null, wr: number, trunk = 0): void {
    if (trunk > 0) this.reachTrunk(l, wl, r, wr, trunk);
    const right = _w.set(-1, 0, 0).applyQuaternion(this.player.root.getWorldQuaternion(_q2));
    for (const [side, target, w] of [['l', l, wl] as const, ['r', r, wr] as const]) {
      if (!target || w <= 0) continue;
      const upper = this.player.bones.get(`upperarm_${side}`);
      const lower = this.player.bones.get(`forearm_${side}`);
      const hand = this.player.bones.get(`hand_${side}`);
      const fingers = this.player.bones.get(`fingers_01_${side}`);
      if (!upper || !lower || !hand || !fingers) continue;
      const handWorld = hand.getWorldQuaternion(new THREE.Quaternion());
      // The wrist target: the target less the clip's wrist-to-fingers offset (the ball sits in the fingers, not the wrist).
      hand.getWorldPosition(_v);
      fingers.getWorldPosition(_fwd);
      const wrist = new THREE.Vector3().copy(target).sub(_fwd).add(_v);
      // Elbow pole: below the elbow and out to his side.
      lower.getWorldPosition(_pole);
      _pole.y -= 0.4;
      _pole.addScaledVector(right, side === 'r' ? 0.25 : -0.25);
      solveTwoBone(upper, lower, hand, wrist, _pole, Math.min(1, w));
      const pq = hand.parent!.getWorldQuaternion(new THREE.Quaternion());
      hand.quaternion.copy(pq.invert().multiply(handWorld));
      hand.updateMatrixWorld(true);
    }
  }

  /**
   * The chest goes after the hands (passing round 8): when the hands' targets
   * are out past what the arms reach from the shoulders as the clip has them,
   * the trunk folds toward them from the lower spine (spine_01 to spine_04,
   * a share each) by as much as it takes, up to `maxAng` (rad), by the
   * hands' weight. A receiver reaching for a ball led a stride long extends
   * his whole upper body into it; the catch clips put the trunk where a
   * keyed catch has it, and this finishes the reach to the ball the sim
   * caught (render/game/choreo.ts catchReach). Before the arms' IK.
   */
  private reachTrunk(l: THREE.Vector3 | null, wl: number, r: THREE.Vector3 | null, wr: number, maxAng: number): void {
    this.trunkReach = 0;
    const n = (l && wl > 0 ? 1 : 0) + (r && wr > 0 ? 1 : 0);
    if (n === 0) return;
    const T = new THREE.Vector3();
    if (l && wl > 0) T.add(l);
    if (r && wr > 0) T.add(r);
    T.multiplyScalar(1 / n);
    const w = Math.min(1, Math.max(l ? wl : 0, r ? wr : 0));
    // The shoulders and the arm's length to the finger roots, as posed now.
    const S = new THREE.Vector3();
    let arm = 0;
    for (const side of ['l', 'r'] as const) {
      const u = this.bone(`upperarm_${side}`).getWorldPosition(new THREE.Vector3());
      const f = this.bone(`forearm_${side}`).getWorldPosition(new THREE.Vector3());
      const h = this.bone(`hand_${side}`).getWorldPosition(new THREE.Vector3());
      const g = this.bone(`fingers_01_${side}`).getWorldPosition(new THREE.Vector3());
      S.addScaledVector(u, 0.5);
      arm += 0.5 * (u.distanceTo(f) + f.distanceTo(h) + h.distanceTo(g));
    }
    const reach = REACH_SLACK * arm;
    if (S.distanceTo(T) <= reach) return;
    const P = this.bone('spine_01').getWorldPosition(new THREE.Vector3());
    const axis = new THREE.Vector3().subVectors(S, P).cross(new THREE.Vector3().subVectors(T, P));
    if (axis.lengthSq() < 1e-8) return;
    axis.normalize();
    // The fold that brings the shoulders within reach of the targets (about spine_01, bisected), at most maxAng.
    const at = (ang: number) => new THREE.Vector3().subVectors(S, P).applyAxisAngle(axis, ang).add(P).distanceTo(T);
    let ang = maxAng;
    if (at(maxAng) < reach) {
      let lo = 0;
      let hi = maxAng;
      for (let k = 0; k < 12; k++) {
        const mid = 0.5 * (lo + hi);
        if (at(mid) > reach) lo = mid;
        else hi = mid;
      }
      ang = hi;
    }
    ang *= w;
    this.trunkReach = ang;
    const q = new THREE.Quaternion();
    for (const [name, share] of TRUNK_REACH) {
      const bone = this.bone(name);
      q.setFromAxisAngle(axis, ang * share);
      const wq = bone.getWorldQuaternion(new THREE.Quaternion());
      const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(pq.invert().multiply(q).multiply(wq));
      bone.updateMatrixWorld(true);
    }
  }

  /**
   * (Round 16) The side layer's loops this frame: each one's weight (sideW: the layer's share to each side, the slide or
   * the set by sideU, the two speeds that bracket the side speed) and phase (sidePh: the layer's phase, warped so every
   * loop plants and lifts each foot together, the right loops half a cycle on), the phase advanced by the blended stride.
   * Returns the blended stride (m per cycle) and duty.
   */
  private sideLoops(side: number, scale: number, dt: number): { stride: number; duty: number } {
    const sw = this.sideW;
    sw.fill(0);
    const out = this._sideOut;
    out.stride = 0;
    out.duty = 0;
    if (side <= 0) return out;
    const fam = this.sideFam[this.sideStyle];
    const u = fam.l.set.length ? this.sideU : 0;
    const smp = this.sideSmp[0]!;
    const add = (list: GaitClip[], w: number) => {
      if (!list.length || w <= 0) return;
      sampleSorted(list, this.sideSpeed, scale, smp);
      sw[this.sideClips.indexOf(smp.a)]! += w * (1 - smp.w);
      sw[this.sideClips.indexOf(smp.b)]! += w * smp.w;
      out.stride += w * smp.stride;
      out.duty += w * (smp.a.duty + (smp.b.duty - smp.a.duty) * smp.w);
    };
    add(fam.l.slide, this.sideL * (1 - u));
    add(fam.l.set, this.sideL * u);
    add(fam.r.slide, this.sideR * (1 - u));
    add(fam.r.set, this.sideR * u);
    out.stride /= side;
    out.duty /= side;
    this.sidePhase = advancePhase(this.sidePhase, this.sideOn ? this.rawSide : this.sideSpeed, dt, out.stride);
    for (let j = 0; j < this.sideClips.length; j++) {
      if (sw[j]! > 0) this.sidePh[j] = warpPhase((this.sidePhase + (this.sideRight[j] ? 0.5 : 0)) % 1, this.sideClips[j]!.duty, out.duty);
    }
    return out;
  }
  private _sideOut = { stride: 0, duty: 0 };

  /** (Round 15) The hips' turn toward the sim's velocity (rad, + left of the facing), eased; and the gait's eased ground speed. */
  private warp = 0;
  private groundSpeed = 0;

  /**
   * (Round 15) The gait's speed. With the sim's velocity (AnimInput.vel), the speed along the way the hips point
   * (warpHips): the clips are keyed going straight ahead (or straight back), and fed only the speed along his facing
   * a player moving sideways or on a slant to it (a linebacker scraping, a corner bailing, a back-seven player opening
   * to run with his eyes on the quarterback, a lineman sliding) ran his gait slow or stood, his planted feet left
   * behind by the body (docs/anim/FEET15.md: a linebacker's planted foot dragged 0.9 m sideways). Eased over ~60 ms
   * as GameScene eases the speed it feeds (a juke's sidestep changes it in a tick).
   */
  private gaitSpeed(input: AnimInput, dt: number): number {
    const v = input.vel;
    const base = Math.max(0, input.speed);
    let want = 0;
    // (Round 16) The side layer needs the angle too, the quarterback's included (his hips stay square: warp false).
    const sideOk = input.side !== false && this.sideClips.length > 0;
    let psi: number | null = null;
    if (v && (input.warp !== false || sideOk)) {
      const sp = Math.hypot(v.x, v.z);
      const fwd = _fwd.set(0, 0, 1).applyQuaternion(this.player.root.getWorldQuaternion(_q2));
      if (sp > WARP_MIN) {
        const th0 = Math.atan2(v.x, v.z) - Math.atan2(fwd.x, fwd.z);
        let a = th0;
        if (input.backpedal) a -= Math.PI;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        if (sideOk) psi = this.sideMode(input, Math.atan2(Math.sin(th0), Math.cos(th0)), sp);
        else this.sideOn = false;
        if (input.warp !== false) {
          if (psi !== null) {
            // (Round 16) In the side layer the hips turn toward his velocity off the loop's own travel (sideAxis).
            want = this.sideDir * THREE.MathUtils.clamp(psi - this.sideAxis(psi), -SIDE_WARP, SIDE_WARP);
          } else {
            // (Going away from where he faces without a pedal, a step or two back: no turn, the hips square.)
            want = Math.abs(a) > WARP_OFF ? 0 : THREE.MathUtils.clamp(a, -WARP_MAX, WARP_MAX);
          }
          this.warpRes = a;
        }
      }
    } else this.sideOn = false;
    const k = 1 - Math.exp(-dt * WARP_RATE);
    this.warp += (want - this.warp) * k;
    // (Round 16) The side layer's speed: the sim's along the loop's travel, as the hips have turned it.
    const ke = 1 - Math.exp(-dt / 0.06);
    if (this.sideOn && v) {
      const sp = Math.hypot(v.x, v.z);
      let side = sp;
      if (psi !== null) {
        const r = psi - this.sideDir * this.warp;
        const ax = this.sideAxis(r);
        this.sideU = this.sideStyle === 'ol' ? THREE.MathUtils.clamp((ax - Math.PI / 2) / (Math.PI / 2 - SET_OUT), 0, 1) : 0;
        side = sp * Math.max(0, Math.cos(r - ax));
      }
      this.rawSide = side;
      this.sideSpeed += (side - this.sideSpeed) * ke;
    } else this.sideSpeed += (0 - this.sideSpeed) * ke;
    if (!v || input.warp === false) {
      this.rawSpeed = base;
      return base;
    }
    const sp = Math.hypot(v.x, v.z);
    const along = sp > WARP_MIN ? sp * Math.max(0, Math.cos(this.warpRes - this.warp)) : base;
    this.rawSpeed = along;
    this.groundSpeed += (along - this.groundSpeed) * ke;
    return Math.max(0, this.groundSpeed);
  }
  private warpRes = 0;
  /** (Round 16) This frame's speed along the gait's travel and along the side loop's, before the easing (the phases' pace). */
  private rawSpeed = 0;
  private rawSide = 0;

  /**
   * (Round 16) Into the side layer or out of it (SIDE_IN, SIDE_OUT, SIDE_VIN, SIDE_VOUT), and which side, from his
   * velocity's angle off his facing (`th`, rad, + to his left) and his speed. Returns the angle measured toward the side
   * it's on (pi/2 straight sideways; past pi for a lineman set back past straight back), or null when off.
   */
  private sideMode(input: AnimInput, th: number, sp: number): number | null {
    const ol = input.side === 'ol';
    this.sideStyle = ol ? 'ol' : 'lb';
    const at = Math.abs(th);
    const on = this.sideOn;
    this.sideOn = on
      ? sp < (ol ? SIDE_VOUT_OL : SIDE_VOUT) && at > SIDE_OUT && (ol || at < Math.PI - SIDE_OUT)
      : sp < (ol ? SIDE_VIN_OL : SIDE_VIN) && at > SIDE_IN && (ol || at < Math.PI - SIDE_IN);
    if (!this.sideOn) return null;
    const sn = Math.sin(th);
    const fresh = this.sideL + this.sideR < 0.05;
    if (fresh || sn * this.sideDir < -SIDE_FLIP) this.sideDir = fresh && Math.abs(sn) < SIDE_FLIP && input.sidePref ? Math.sign(input.sidePref) : sn >= 0 ? 1 : -1;
    if (fresh && !on) {
      // Into the layer from the gait or a stance: the phase the feet are in (the left loops' phase; the left foot is the
      // lead going left). One foot planted: mid-way through its plant. Both: just before the lead foot lifts.
      const l = this.feet.l.locked;
      const r = this.feet.r.locked;
      this.sidePhase = l && !r ? 0.2 : r && !l ? 0.7 : l && r ? (this.sideDir > 0 ? 0.5 : 0) : 0;
    }
    let psi = this.sideDir * th;
    if (psi < -Math.PI / 2) psi += 2 * Math.PI;
    return psi;
  }

  /** (Round 16) The side loop's travel (rad, toward the side) nearest an angle: sideways, or for the line out to its set's. */
  private sideAxis(psi: number): number {
    return this.sideStyle === 'ol' ? THREE.MathUtils.clamp(psi, Math.PI / 2, Math.PI - SET_OUT) : Math.PI / 2;
  }

  /**
   * (Round 15) The hips turned toward the sim's velocity by `warp` (up to WARP_MAX), the trunk turned back over the
   * spine so the chest stays where he faces (where the sim has him looking: the quarterback, his man, the ball). Only
   * on the gait (not in a one-shot, whose clip turns him as it's keyed: a cut, a break, the hip flip), by its weight.
   */
  private warpHips(tw: number): void {
    const a = this.warp * this.loco * (1 - tw);
    if (Math.abs(a) < 1e-4) return;
    const root = this.rootB;
    // Every turn here is about the world's up, so they commute: each spine bone's new local rotation comes from the pose's
    // world rotations as they stand (its parent's and its own), and the skeleton is brought up to date once.
    for (let k = 0; k < WARP_TWIST.length; k++) {
      const bone = this.twistB[k]!;
      wquat(bone.parent!, this.twistP[k]!);
      wquat(bone, this.twistW[k]!);
    }
    _q.setFromAxisAngle(_up, a);
    const wq = wquat(root, _oq2);
    const pq = root.parent ? wquat(root.parent, _oq3) : _oq3.identity();
    root.quaternion.copy(pq.invert().multiply(_q).multiply(wq));
    for (let k = 0; k < WARP_TWIST.length; k++) {
      const share = WARP_TWIST[k]![1];
      _q.setFromAxisAngle(_up, -a * share);
      this.twistB[k]!.quaternion.copy(this.twistP[k]!.invert().multiply(_q).multiply(this.twistW[k]!));
    }
    // (Round 16) Only the root, the pelvis and the legs now: the feet are read next (before the leans), and the lean
    // that follows brings the whole skeleton up to date (or, with no lean this frame, does it then: upperStale).
    this.legsFresh();
    this.upperStale = true;
  }
  private twistP = WARP_TWIST.map(() => new THREE.Quaternion());
  /** (Round 16) warpHips brought only the legs up to date; the rest of the skeleton waits for the lean (or its end). */
  private upperStale = false;
  /** (Round 16) The root's chain down to the thighs (the pelvis), parent first. */
  private hipChain: THREE.Object3D[] | null = null;

  /**
   * (Round 16) The world matrices of the root, the pelvis and both legs, made as updateMatrixWorld makes them (each
   * from its own matrix and its parent's world), and of nothing else: the spine, the arms and the head are left for the
   * lean's update of the whole skeleton. warpHips's own full update was a sixth of the matrix work (docs/anim/FEET16.md).
   */
  private legsFresh(): void {
    if (!this.hipChain) {
      const chain: THREE.Object3D[] = [];
      for (let o = this.legs.thigh.l.parent; o && o !== this.rootB.parent; o = o.parent) chain.unshift(o);
      this.hipChain = chain;
    }
    for (const o of this.hipChain) {
      o.updateMatrix();
      if (o.parent) o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
      else o.matrixWorld.copy(o.matrix);
      o.matrixWorldNeedsUpdate = false;
    }
    this.legs.thigh.l.updateMatrixWorld(true);
    this.legs.thigh.r.updateMatrixWorld(true);
  }
  private twistW = WARP_TWIST.map(() => new THREE.Quaternion());

  private lean(speed: number, yawRate: number, accel: number, press = 0): void {
    // A body turning at ω while moving at v leans by atan(v·ω / g) into the
    // turn; a burst pitches it forward (half the physical angle, which reads
    // right on screen without looking like a fall); a back pressing the hole
    // runs pitched a little further into it.
    const bank = THREE.MathUtils.clamp(Math.atan2(speed * yawRate, G), -0.35, 0.35);
    const pitch = THREE.MathUtils.clamp(Math.atan2(accel, G) * 0.5 + press, -0.15, 0.3);
    this.leanDbg.bank = bank;
    this.leanDbg.pitch = pitch;
    const root = this.rootB;
    if (Math.abs(bank) < 1e-4 && Math.abs(pitch) < 1e-4) {
      if (this.upperStale) root.updateMatrixWorld(true);
      this.upperStale = false;
      return;
    }
    this.upperStale = false;
    const rootQ = wquat(this.player.root, _q2);
    _fwd.set(0, 0, 1).applyQuaternion(rootQ);
    const right = _w.set(-1, 0, 0).applyQuaternion(rootQ);
    _q.setFromAxisAngle(_fwd, -bank).multiply(_oq.setFromAxisAngle(right, pitch));
    const wq = wquat(root, _oq2);
    const pq = root.parent ? wquat(root.parent, _oq3) : _oq3.identity();
    root.quaternion.copy(pq.invert().multiply(_q).multiply(wq));
    // About the hips, not the feet (M6.5 #12): the sim's spot is where his
    // mass goes, so the body tilts about it and the feet swing out under a
    // turn. Pivoting at the feet swung the chest up to half a metre off the
    // sim's spot at the bank's limit, into whoever was beside him (a
    // receiver adjusting to the ball banks at the limit on one catch in
    // five; tools/sim/catchcontact.ts).
    if (root.parent) {
      const h = LEAN_PIVOT * this.player.shape.scale;
      wpos(root, _v);
      _pole.set(0, h, 0).applyQuaternion(_q);
      _v.y += h;
      _v.sub(_pole);
      root.parent.worldToLocal(_v);
      root.position.copy(_v);
    }
    root.updateMatrixWorld(true);
  }

  /** Tilt the whole body about the feet toward a world direction by its length (rad). */
  private leanToward(x: number, z: number): void {
    const ang = Math.hypot(x, z);
    if (ang < 1e-5) return;
    const root = this.rootB;
    // Up turns toward (x, z): about the axis up × dir.
    _q.setFromAxisAngle(_w.set(z / ang, 0, -x / ang), ang);
    const wq = wquat(root, _oq2);
    const pq = root.parent ? wquat(root.parent, _oq3) : _oq3.identity();
    root.quaternion.copy(pq.invert().multiply(_q).multiply(wq));
    root.updateMatrixWorld(true);
  }

  /** This frame's AnimInput.holdFeet. */
  private holdFeet = false;
  /** (Passing round 14) Each foot's world rotation and ankle-from-ball offset as the clips keyed them, before the leans (holdFeet). */
  private footQ = { l: new THREE.Quaternion(), r: new THREE.Quaternion() };
  private footOff = { l: new THREE.Vector3(), r: new THREE.Vector3() };
  private footBall = { l: 0, r: 0 };
  /** (Round 15) Each ball of the foot's height as the clips keyed it this frame, before the leans (the lock's settle). */
  private preBallY = { l: 0, r: 0 };
  private preBall = { l: new THREE.Vector3(), r: new THREE.Vector3() };
  /** This frame's plant per foot (down, and what plants it), from the clips' contacts. */
  private plant: Record<'l' | 'r', { down: boolean; soon: boolean; source: LockSource }> = { l: { down: false, soon: false, source: 'stand' }, r: { down: false, soon: false, source: 'stand' } };

  /**
   * The keyed leg's reach (passing round 14): the hip, the clip's own ankle and the farthest the hip may be from the
   * ankle before the knee is straighter than the clip's less KNEE_GIVE (the pose as the clips and leans left it, before
   * any IK). Fills _hip and _ank.
   */
  private keyedReach(s: 'l' | 'r'): number {
    wpos(this.legs.thigh[s], _hip);
    wpos(this.legs.calf[s], _knee);
    wpos(this.legs.foot[s], _ank);
    const la = _hip.distanceTo(_knee);
    const lb = _knee.distanceTo(_ank);
    const d = _hip.distanceTo(_ank);
    // The knee's flexion (0 straight): d² = la² + lb² + 2·la·lb·cos(flexion).
    const flex = Math.acos(THREE.MathUtils.clamp((d * d - la * la - lb * lb) / (2 * la * lb), -1, 1));
    this.keyedKnee[s] = flex;
    const f = Math.max(0, flex - KNEE_GIVE);
    return Math.sqrt(la * la + lb * lb + 2 * la * lb * Math.cos(f));
  }

  /**
   * (Passing round 14) The body held over its planted feet (KNEE_GIVE, ROOT_GIVE): in a one-shot (holdFeet), when the
   * sim has carried him off a planted foot since it planted (his spot moving away from it: the contested ball's QB
   * drifting back off his front foot as he throws) and the leg would be straighter than the clip's less KNEE_GIVE, the
   * body is drawn back over it along the ground, by as much as the knee needs and no more than the drift, up to
   * ROOT_GIVE. Held while the foot stays planted, let go over ROOT_OUT once none needs it. The sim's drift and the
   * one-shot's own stride over the foot since it planted (its travel, played in place); not the clip's mismatches
   * otherwise. The run's cycle re-plants its feet every step and is left alone.
   */
  private holdOver(dt: number, ground?: THREE.Vector3): void {
    const root = this.rootB;
    const on = this.footLock && this.holdFeet && !(ground && ground.lengthSq() > 0);
    let any = false;
    _need.set(0, 0, 0);
    if (on) {
      // The sim's spot (where the game puts the player's root), against where it was when each foot planted.
      const spot = wpos(this.player.root, _rp);
      const fwd = _fwd.set(0, 0, 1).applyQuaternion(wquat(this.player.root, _q2));
      for (const s of FEET) {
        const st = this.feet[s];
        const pl = this.plant[s];
        if (!pl.down || pl.source !== 'trans' || !st.locked || st.source !== pl.source || st.weight < 0.5) continue;
        any = true;
        const dMax = this.keyedReach(s);
        // The ankle's target, as lockFoot puts it: the locked ball plus the clip's ankle-to-ball offset before the leans
        // (the hip as the clips and leans left it, before any hold).
        const o = this.footOff[s];
        const tx = o.x + st.pos.x - _hip.x;
        const ty = o.y + st.pos.y - _hip.y;
        const tz = o.z + st.pos.z - _hip.z;
        const r = Math.hypot(tx, tz);
        // (Out of reach straight down, the hips are too high over it: moving them along the ground won't bend the knee.)
        if (tx * tx + ty * ty + tz * tz <= dMax * dMax || r < 1e-6 || ty * ty >= dMax * dMax) continue;
        const ux = tx / r;
        const uz = tz / r;
        // As far as the knee needs, and no further than the sim has carried him away from the foot since it planted,
        // plus the stride the one-shot keys over the foot since (its travel, played in place: the throw's step onto the
        // front foot, which the sim doesn't make).
        const e = r - Math.sqrt(Math.max(0, dMax * dMax - ty * ty));
        const away = -((spot.x - st.anchor.x) * ux + (spot.z - st.anchor.z) * uz);
        // (The stride carries him forward: only onto a foot ahead of him.)
        const ahead = ux * fwd.x + uz * fwd.z > 0;
        const stride = pl.source === 'trans' && ahead ? Math.max(0, this.transTravel() - st.travel0) : 0;
        const k = Math.min(e, Math.max(0, away) + stride) * st.weight;
        _need.x += ux * k;
        _need.z += uz * k;
      }
    }
    if (_need.length() > ROOT_GIVE) _need.setLength(ROOT_GIVE);
    if (!any) _need.set(0, 0, 0);
    // Taken up at once (it follows the sim's own drift, which is smooth); let go over ROOT_OUT.
    const out = _need.lengthSq() >= this.give.lengthSq() ? 1 : 1 - Math.exp(-dt / ROOT_OUT);
    this.give.lerp(_need, out);
    if (this.give.lengthSq() < 1e-8) this.give.set(0, 0, 0);
    if (this.give.lengthSq() > 0) this.shiftRoot(root, this.give);
  }

  /** The one-shot playing now: how far it has carried the body (m, its travel, scaled), or 0. */
  private transTravel(): number {
    const tr = this.trans;
    const m = tr ? this.lib.meta[tr.name] : undefined;
    return tr && m ? travelAt(m, this.lib.fps, tr.t) * this.player.shape.scale : 0;
  }

  /** Move the root bone by a world offset (the whole body, the feet's IK still to come). */
  private shiftRoot(root: THREE.Bone, by: THREE.Vector3): void {
    if (by.lengthSq() === 0) return;
    wpos(root, _v).add(by);
    if (root.parent) root.parent.worldToLocal(_v);
    root.position.copy(_v);
    root.updateMatrixWorld(true);
  }

  private lockFoot(
    s: 'l' | 'r',
    source: LockSource,
    isDown: boolean,
    dt: number,
    ground?: THREE.Vector3,
    soon = false,
  ): void {
    const st = this.feet[s];
    const foot = this.legs.foot[s];
    // The ball of the foot is what stays put on the ground: through late
    // stance the heel rises and the ankle rolls forward over it.
    const ball = this.legs.toe[s];
    const down = this.footLock && isDown;
    const dbg = this.lockDbg[s];
    dbg.replant = '';
    dbg.miss = 0;
    dbg.stepped = false;
    this.correction[s] = 0;
    this.slid[s] = 0;
    const scale = this.player.shape.scale;
    // Where the clips (and the leans) put the ball of the foot this frame.
    const cb = wpos(ball, _cb);
    dbg.cb.copy(cb);
    if (!this.footLock) {
      st.locked = false;
      st.source = null;
      st.step = null;
      st.weight = 0;
      st.drawn.copy(cb);
      return;
    }
    if (ground) {
      st.pos.addScaledVector(ground, dt);
      st.drawn.addScaledVector(ground, dt);
      if (st.step) st.stepFrom.addScaledVector(ground, dt);
    }
    const thigh = this.legs.thigh[s];
    const calf = this.legs.calf[s];
    // (Round 15) A step under way (stepFoot): the foot goes on in its arc whatever the clip's contacts say, and lands
    // where the clip has its foot when it gets there.
    const step = st.step;
    if (step) {
      step.u += dt / step.dur;
      if (step.u >= 1) {
        st.step = null;
        if (down) {
          // Planted where it landed (the clip's foot): the lock at full weight, as it was through the step.
          this.capture(st, source, cb, s);
          st.weight = 1;
        } else {
          // In the air when it got there (the clip's swing): the IK fades off over RELEASE (cut off at once, the knee
          // snapped from the IK's plane to the clip's: 150-170 rad/s on the calf through a hip flip).
          st.locked = false;
          st.source = null;
          st.weight = 1;
          st.relOff.set(0, 0, 0);
          st.relDur = RELEASE;
        }
      }
    }
    if (!st.step) {
      if (down) {
        if (!st.locked) {
          // Plant where the drawn foot is: the clip's, or (re-planting as a release still fades) where the fade has it.
          this.capture(st, source, st.weight > 0.01 ? st.drawn : cb, s);
        } else if (st.source !== source) {
          // (Round 15) A planted foot stays where it is when what plants it changes (a stance's foot into the get-off's,
          // the gait's into a cut's): the clips hand over on the same foot. Re-captured at the new clip's foot, it jumped
          // in a frame by however far the two clips' feet were apart (up to 0.4 m: docs/anim/FEET15.md). A foot the new
          // clip has far from it steps there (below).
          dbg.replant = `keep:${st.source}>${source}`;
          st.source = source;
          wpos(this.player.root, st.anchor);
          st.travel0 = this.transTravel();
          st.spent = 0;
        }
        // Engage in ~50 ms.
        st.weight += (1 - st.weight) * (1 - Math.exp(-dt * 40));
        st.age += dt;
      } else if (st.locked) {
        // (Round 15) Lifted: the foot goes with the clip's swing from where the lock held it, the difference blended out
        // over RELEASE. Let go in ~15 ms (round 1's, so a lingering lock wouldn't drag the swinging foot back), the
        // foot jumped by whatever the lock had corrected (the mismatch between the clip's stride and the sim's).
        this.letGo(st, cb);
      }
    }
    // The ball's target this frame and the IK's weight.
    let w: number;
    const tgt = _tb;
    if (st.step) {
      // (Round 16) The swing between the toe-off and the landing (STEP_OFF, STEP_ON): the ball of the foot from where it
      // was to the clip's, on the gait keyer's swing (tools/blender/lib/gait.py foot_track: the lift peaks early, the foot
      // set down slower than it came up). Before it the ball stays on the turf (the heel rises off it); after it the foot
      // is down and rolls onto the clip's pose (stepRoll).
      const sw = THREE.MathUtils.clamp((st.step.u - STEP_OFF) / (STEP_ON - STEP_OFF), 0, 1);
      const k = sw * sw * (3 - 2 * sw);
      tgt.lerpVectors(st.stepFrom, cb, k);
      tgt.y += st.step.h * Math.sin(Math.PI * Math.min(1, sw ** 0.8)) ** 1.3;
      w = 1;
    } else if (st.locked) {
      // (Round 15) The lock settles with the ball of the foot: while the clip still has it coming down (a heel strike
      // rolling onto the ball, a foot set down out of a step), the point goes with it, and holds from where it lands. At
      // a run's touch-down the contact starts on the heel with the ball up to 12 cm off the turf, and a lock taken there
      // held the ball in the air while the clip rolled it 10-20 cm on: the leg stretched for it, and it slid.
      // (Read before the leans: a lean tips the feet about the hips, and is no landing.)
      // (Only as it engages: past that it's planted, and a clip's ball that dips later is the clip's own roll.)
      if (!this.holdFeet && st.weight < LOCK_ON && this.preBallY[s] < st.preY - SETTLE) {
        st.pos.set(cb.x, this.preBallY[s], cb.z);
        st.preY = this.preBallY[s];
        st.leanOff.subVectors(cb, this.preBall[s]).setY(0);
      }
      // (Passing round 14) For holdFeet the lock holds the ball of the foot where it planted along the ground; its height
      // is the clip's (a front foot keyed toes-up on the stride, heel=-6 deg, 2 cm off the turf: pinned at its landing
      // height the ankle went 2 cm under the keyed one and the leg straightened).
      if (this.holdFeet) st.pos.y = this.footBall[s];
      tgt.copy(st.pos);
      w = st.weight;
      this.correction[s] = cb.distanceTo(st.pos);
    } else {
      st.weight = Math.max(0, st.weight - dt / st.relDur);
      if (st.weight <= 0) {
        st.drawn.copy(cb);
        return;
      }
      tgt.copy(cb).add(st.relOff);
      w = st.weight * st.weight * (3 - 2 * st.weight);
    }
    // Keep the foot's own orientation through the solve.
    // (Passing round 14: for holdFeet, as the clip keyed it before the leans. The run's lean pitches the whole body
    // about the hips on the sim's acceleration, the planted foot with it: on the contested ball the QB's drift back
    // tipped him ~15 deg as he threw and his planted front foot rolled onto its heel, the ankle pulled 5 cm down to the
    // turf and the leg dead straight, 4 deg at the release against 34 keyed.)
    const footWorld = this.holdFeet ? _fq.copy(this.footQ[s]) : wquat(foot, _fq);
    // Ankle target: the ball's target plus the clip's current ankle-to-ball offset.
    const ankleTarget = this.holdFeet ? _w.copy(this.footOff[s]).add(tgt) : wpos(foot, _w).sub(cb).add(tgt);
    // (Round 16) The step's toe-off, heel strike and roll.
    if (st.step) this.stepRoll(st.step.u, tgt, ankleTarget, footWorld);
    if (this.holdFeet && st.locked && source === 'trans' && down) {
      // (Passing round 14) Past what the hold over the feet took up, the planted point gives: along the ground toward
      // the clip's own foot, by just enough that the knee is no straighter than the clip's less KNEE_GIVE, and no
      // further than the sim's drift away from the foot that the hold didn't take (a clip's own travel played in place
      // is left as it was: the leg turns about the planted foot).
      const dMax = this.keyedReach(s);
      const ax = ankleTarget.x - _hip.x;
      const ay = ankleTarget.y - _hip.y;
      const az = ankleTarget.z - _hip.z;
      const c = ax * ax + ay * ay + az * az - dMax * dMax;
      const gx = _ank.x - ankleTarget.x;
      const gz = _ank.z - ankleTarget.z;
      const a = gx * gx + gz * gz;
      const r = Math.hypot(ax, az);
      if (c > 0 && a > 1e-10 && r > 1e-6) {
        const spot = wpos(this.player.root, _rp);
        const away = -((spot.x - st.anchor.x) * ax + (spot.z - st.anchor.z) * az) / r;
        const held = (this.give.x * ax + this.give.z * az) / r;
        // (Round 15: and no more than GIVE_MAX in all. Past that it's a slide: on the contested ball the point gave 12 cm
        // over the finish as the sim walked him off, and the foot steps instead, below.)
        const room = Math.max(0, Math.min(away - Math.max(0, held), GIVE_MAX * this.player.shape.scale) - st.spent);
        // |(ankleTarget - hip) + u·(gx, 0, gz)| = dMax: the nearest u in (0, 1] (all the way to the clip's foot at most);
        // none when moving toward the clip's foot doesn't bring it in reach (the hips too high over it).
        const b = ax * gx + az * gz;
        const disc = b * b - a * c;
        const u = disc >= 0 && b < 0 ? Math.min(1, (-b - Math.sqrt(disc)) / a, room / Math.sqrt(a)) : 0;
        if (u > 0) {
          st.pos.x += gx * u;
          st.pos.z += gz * u;
          // (The drift it took is spent.)
          st.spent += Math.sqrt(a) * u;
          ankleTarget.x += gx * u;
          ankleTarget.z += gz * u;
          this.slid[s] = Math.sqrt(a) * u;
        }
      }
    }
    if (st.locked && !st.step && st.weight > 0.9) {
      // (Round 15) A planted foot that can't stay planted steps (stepFoot): the lock held it where it landed while the
      // body went where the sim has it, and when the two parted (the sim moving him sideways or back on a forward clip,
      // a stance he drifts out of, a one-shot whose travel isn't the sim's, a turn on a planted foot) the IK reached for
      // it with a straight leg and then dragged it: 0.3-1.4 m on every play (docs/anim/FEET15.md). It steps instead
      // when the clip has its foot STEP_FAR from where it's held, or when the leg can't reach it.
      wpos(thigh, _hip);
      const reach = _hip.distanceTo(wpos(calf, _knee)) + _knee.distanceTo(wpos(foot, _ank));
      // (Against the clip's foot before the leans, less what the leans moved it when it planted: a burst's pitch or a
      // turn's bank swings the feet about the hips, and the lock holds a planted one through it, as it should.)
      const pb = this.preBall[s];
      // (For the quarterback, less the hold over his feet too, holdOver: the body drawn back over the foot moves the
      // clip's foot with it, and that is the hold working.)
      const gx = this.holdFeet ? this.give.x : 0;
      const gz = this.holdFeet ? this.give.z : 0;
      const far = Math.hypot(st.pos.x - pb.x - st.leanOff.x - gx, st.pos.z - pb.z - st.leanOff.z - gz);
      const over = _hip.distanceTo(ankleTarget) > reach + REACH_MISS * scale;
      // (Round 16, the pop meter's step records) How far off and how far out of reach, and how long it had held.
      dbg.far = far;
      dbg.over = _hip.distanceTo(ankleTarget) - reach;
      dbg.age = st.age;
      const other = this.feet[s === 'l' ? 'r' : 'l'].step;
      if ((far > STEP_FAR * scale || over) && soon) {
        // About to lift anyway: let go into the clip's swing now (the release's blend), rather than step.
        dbg.why = `${st.source}:lift`;
        this.letGo(st, cb);
        dbg.stepped = true;

      } else if ((far > STEP_FAR * scale || over) && (!other || other.u > 0.5 || over)) {
        dbg.why = `${st.source}:${over ? 'reach' : 'far'}`;
        this.stepFoot(st, cb, scale);
        dbg.stepped = true;
        tgt.copy(st.stepFrom);
        ankleTarget.copy(this.holdFeet ? this.footOff[s] : wpos(foot, _v).sub(cb)).add(tgt);
        w = 1;
      }
    }
    // Knee pole: (round 15) the way the clip bends the knee (the knee off the hip-to-ankle line), or, with the leg near
    // straight, over the toes. It was 0.5 m ahead of the knee along his facing, so a clip that turns the body off the
    // root (a hip flip, the hips turned toward his run, warpHips) had its knees bent sideways by the solve.
    this.kneePole(thigh, calf, foot, cb);
    dbg.miss = solveTwoBone(thigh, calf, foot, ankleTarget, _pole, w, true);
    const pq = wquat(foot.parent!, _q);
    foot.quaternion.copy(pq.invert().multiply(footWorld));
    foot.updateMatrixWorld(true);
    wpos(ball, st.drawn);
  }

  /**
   * (Round 15) A foot let go of its lock into the clip's own motion: the lock's difference from the clip's foot blended
   * out over RELEASE, longer for a larger difference (at most REL_V m/s of foot, up to REL_MAX s).
   */
  private letGo(st: FootState, cb: THREE.Vector3): void {
    st.locked = false;
    st.source = null;
    st.relOff.subVectors(st.drawn, cb).setY(0);
    st.relDur = THREE.MathUtils.clamp(st.relOff.length() / (REL_V * this.player.shape.scale), RELEASE, REL_MAX);
    st.weight = 1;
  }

  /**
   * (Round 16) The step's foot: the clip's own foot (its pose and orientation), pitched about its own lateral axis through
   * the step, as the gait keyer pitches a stepping foot (tools/blender/lib/gait.py stance_heel, swing_heel): the heel
   * rises off the ball (toe-off, STEP_TOE, pivoting at the ball while it's still on the turf), the foot comes level through
   * the swing, it lands heel first (STEP_STRIKE: toes up, less for a clip that has him on the balls of his feet) and rolls
   * down about the heel onto the clip's foot. `tgt` is where the ball of the foot would be with the foot at the clip's
   * pitch; the ankle's target and the foot's world rotation are turned with it.
   */
  private stepRoll(u: number, tgt: THREE.Vector3, ankle: THREE.Vector3, footWorld: THREE.Quaternion): void {
    // The clip's foot: the ankle from the ball, and its pitch (heel up +) against the rest foot's.
    const off = _so.subVectors(ankle, tgt);
    const h = Math.hypot(off.x, off.z);
    if (h < 1e-4) return;
    const pitch = Math.atan2(off.y, h) - FOOT_REST_PITCH;
    const strike = -STEP_STRIKE * (1 - THREE.MathUtils.clamp(pitch / STEP_ON_BALLS, 0, 1));
    let d: number;
    if (u < STEP_OFF) d = STEP_TOE * smooth01(u / STEP_OFF);
    else if (u < STEP_ON) {
      const sw = (u - STEP_OFF) / (STEP_ON - STEP_OFF);
      d = STEP_TOE * (1 - smooth01(sw / 0.55)) + strike * smooth01((sw - 0.7) / 0.3);
    } else d = strike * (1 - smooth01((u - STEP_ON) / (1 - STEP_ON)));
    if (Math.abs(d) < 1e-4) return;
    // The foot's lateral axis (a turn about it by + takes the heel up).
    const ax = _sa.set(off.x / h, 0, off.z / h).cross(_up).normalize();
    const q = _sq.setFromAxisAngle(ax, d);
    if (d > 0) {
      // About the ball.
      ankle.copy(off).applyQuaternion(q).add(tgt);
    } else {
      // About the heel: the rest foot's heel from its ball (tools/blender/lib/skeleton.py, poses.py HEEL_REST), turned and
      // scaled off the clip's ankle-from-ball.
      const heel = _sh.copy(off).applyAxisAngle(ax, HEEL_TURN).multiplyScalar(HEEL_K);
      ankle.subVectors(off, heel).applyQuaternion(q).add(heel).add(tgt);
    }
    footWorld.premultiply(q);
  }

  /** (Round 15) The knee's pole for the leg's solve, into _pole: the clip's own bend, or over the toes. */
  private kneePole(thigh: THREE.Bone, calf: THREE.Bone, foot: THREE.Bone, ball: THREE.Vector3): void {
    wpos(thigh, _hip);
    wpos(calf, _knee);
    wpos(foot, _ank);
    // The knee off the hip-to-ankle line.
    _need.subVectors(_ank, _hip);
    const l2 = _need.lengthSq();
    _pole.subVectors(_knee, _hip);
    if (l2 > 1e-8) _pole.addScaledVector(_need, -_pole.dot(_need) / l2);
    if (_pole.lengthSq() < KNEE_BENT * KNEE_BENT) {
      // Near straight: over the toes (the ankle to the ball, along the ground).
      _pole.set(ball.x - _ank.x, 0, ball.z - _ank.z);
      if (_pole.lengthSq() < 1e-8) _pole.set(0, 0, 1).applyQuaternion(wquat(this.player.root, _q2));
    }
    _pole.normalize().multiplyScalar(0.5).add(_knee);
  }

  /** (Passing round 14; round 15) A foot planted now at `at` (a world point): the lock and the hold's bookkeeping. */
  private capture(st: FootState, source: LockSource, at: THREE.Vector3, s: 'l' | 'r'): void {
    st.pos.copy(at);
    st.preY = this.preBallY[s];
    // (Round 15) On the turf: at the height the clip keys the ball (before the leans). The run's bank tips the body about
    // the hips (lean, M6.5 #12), the outside foot up to ~12 cm off the ground and the inside one into it, and a lock taken
    // there held a receiver's planted foot in the air through a curved route.
    st.pos.y = this.preBallY[s];
    st.leanOff.subVectors(_cb, this.preBall[s]).setY(0);
    wpos(this.player.root, st.anchor);
    st.travel0 = this.transTravel();
    st.spent = 0;
    st.locked = true;
    st.source = source;
    st.age = 0;
  }

  /**
   * (Round 15) A step: the planted foot lifts from where it's drawn and goes to where the clip has its foot, in an arc
   * (STEP_T, STEP_H by the distance), then plants there if the clip has it down. Built from the clip's own foot (its
   * pose and orientation through the step are the clip's): the IK only carries the ball of the foot.
   */
  private stepFoot(st: FootState, cb: THREE.Vector3, scale: number): void {
    const d = Math.hypot(st.drawn.x - cb.x, st.drawn.z - cb.z) / scale;
    st.step = {
      u: 0,
      dur: THREE.MathUtils.clamp(STEP_T0 + d / STEP_V, STEP_T0, STEP_TMAX),
      h: THREE.MathUtils.clamp(STEP_H0 + STEP_HK * d, STEP_H0, STEP_HMAX) * scale,
    };
    st.stepFrom.copy(st.drawn);
    st.locked = false;
    st.source = null;
  }

  private lookAt(target: THREE.Vector3 | null, dt: number, wide = false): void {
    const head = this.headB;
    const neck = this.neckB;
    // (Round 16: the world matrices as they stand, and no allocation.)
    const rootQ = wquat(this.player.root, _q2);
    const facing = _fwd.set(0, 0, 1).applyQuaternion(rootQ);
    const want = _lw.identity();
    if (target) {
      wpos(head, _v);
      const d = _w.subVectors(target, _v).normalize();
      // Clamp to what a neck can do: ±70° side to side, ±35° up and down
      // (wide: the chest turns too, and the eyes go down into the hands).
      const yawLim = wide ? LOOK_WIDE : 1.22;
      const yaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(Math.atan2(d.x, d.z) - Math.atan2(facing.x, facing.z)), Math.cos(Math.atan2(d.x, d.z) - Math.atan2(facing.x, facing.z))), -yawLim, yawLim);
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)), wide ? -LOOK_DOWN_WIDE : -0.6, 0.6);
      want.setFromEuler(_le.set(-pitch, yaw, 0, 'YXZ'));
      want.premultiply(rootQ).multiply(_lq.copy(rootQ).invert());
    }
    // Critically damped-ish follow (~0.15 s).
    this.look.slerp(want, 1 - Math.exp(-dt * 10));
    if (Math.abs(this.look.w) > 0.99999) return;
    // 40% in the neck, 60% in the head; a wide look puts a third of it in the upper back first (the shoulders turn with the head).
    const parts = wide ? LOOK_PARTS_WIDE : LOOK_PARTS;
    for (const [name, share] of parts) {
      const bone = name === 'head' ? head : name === 'neck_02' ? neck : this.chestB;
      const part = _lp.identity().slerp(this.look, share);
      const wq = wquat(bone, _oq2);
      const pq = wquat(bone.parent!, _oq3);
      bone.quaternion.copy(pq.invert().multiply(part).multiply(wq));
      bone.updateMatrixWorld(true);
    }
  }

  private pads(dt: number): void {
    if (dt <= 0) return;
    const chest = this.chestB;
    wpos(chest, _v);
    this.chestY.push(_v.y);
    if (this.chestY.length > 3) this.chestY.shift();
    if (this.chestY.length < 3) return;
    const [y0, y1, y2] = this.chestY as [number, number, number];
    const accel = THREE.MathUtils.clamp((y2 - 2 * y1 + y0) / (dt * dt), -40, 40);
    // Pads lag the chest: a stiff spring (~6 Hz), lightly damped.
    const sp = this.padSpring;
    const kS = (2 * Math.PI * 6) ** 2;
    sp.v += (-kS * sp.x - 12 * sp.v - accel * 0.02) * dt;
    sp.x += sp.v * dt;
    const angle = THREE.MathUtils.clamp(sp.x, -0.08, 0.08);
    const right = _w.set(1, 0, 0).applyQuaternion(wquat(this.player.root, _q2));
    for (const s of FEET) {
      const pad = this.legs.pad[s];
      rotateBoneWorld(pad, _fwd.set(0, 0, 1), _pole.set(0, 0, 1).applyAxisAngle(right, angle), 1, true);
    }
  }
}
