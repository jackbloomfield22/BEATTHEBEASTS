import * as THREE from 'three';
import type { Player } from '@/render/players/playerAsset';
import { advancePhase, familyWeights, MIN_LOCO_SPEED, sampleSorted, warpPhase, type GaitClip, type GaitSample } from './blend';
import { rotateBoneWorld, solveTwoBone } from './ik';
import { planted, travelAt, type AnimLibrary } from './library';

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
}

const FEET = ['l', 'r'] as const;
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
  /** What planted it: standing, or locomotion. A change re-captures the lock. */
  source: 'stand' | 'loco' | 'trans' | null;
}

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
type LockSource = 'loco' | 'stand' | 'trans';
const _hip = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _ank = new THREE.Vector3();
const _need = new THREE.Vector3();
const _rp = new THREE.Vector3();
const _oq = new THREE.Quaternion();
const _oq2 = new THREE.Quaternion();
const _oq3 = new THREE.Quaternion();

export class PlayerAnimator {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private stance = 'stance_idle';
  private stanceWeights = new Map<string, number>();
  private stanceTime = 0;
  private loco = 0; // 0 standing .. 1 moving
  phase = 0;
  /** The backpedal cycle's share of the gait layer and its own phase. */
  private back = 0;
  private backPhase = 0;
  private feet: Record<'l' | 'r', FootState> = {
    l: { weight: 0, locked: false, pos: new THREE.Vector3(), anchor: new THREE.Vector3(), travel0: 0, spent: 0, source: null },
    r: { weight: 0, locked: false, pos: new THREE.Vector3(), anchor: new THREE.Vector3(), travel0: 0, spent: 0, source: null },
  };
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
  footLockOf(s: 'l' | 'r'): { readonly locked: boolean; readonly weight: number; readonly pos: THREE.Vector3 } {
    return this.feet[s];
  }

  constructor(
    readonly player: Player,
    readonly lib: AnimLibrary,
  ) {
    this.mixer = new THREE.AnimationMixer(player.root);
    for (const [name, clip] of lib.clips) {
      const a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopRepeat, Infinity);
      a.play();
      a.setEffectiveWeight(0);
      this.actions.set(name, a);
    }
    this.stanceWeights.set(this.stance, 1);
    for (const bone of player.bones.values()) this.animPose.push([bone, bone.quaternion.clone()]);
    this.animRootPos.copy(this.bone('root').position);
    for (const f of lib.families) {
      for (const g of f) if (!this.locos.includes(g)) this.locos.push(g);
      this.samples.push({ a: f[0]!, b: f[0]!, w: 0, stride: 0 });
    }
    this.locoW = this.locos.map(() => 0);
    this.locoPhase = this.locos.map(() => 0);
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
    }
    this.give.set(0, 0, 0);
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
  release(): void {
    const tr = this.trans;
    if (!tr || tr.done) return;
    tr.done = true;
    this.loco = 1;
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

  update(dt: number, input: AnimInput): void {
    const speed = Math.max(0, input.speed);
    const scale = this.player.shape.scale;
    // 1. Clips.
    const k = 1 - Math.exp(-dt * 8); // ~0.12 s fades
    this.loco += ((speed > MIN_LOCO_SPEED ? 1 : 0) - this.loco) * k;
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
    const lastPhase = this.phase;
    this.back += ((input.backpedal ? 1 : 0) - this.back) * k;
    const bpMeta = this.lib.meta.loco_backpedal;
    if (bpMeta && this.back > 0.01) this.backPhase = advancePhase(this.backPhase, speed, dt, bpMeta.speed * bpMeta.duration * scale);
    if (!input.backpedal) this.phase = advancePhase(this.phase, speed, dt, stride);
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
          if (trMeta.turn && trMeta.to && !trMeta.to.startsWith('loco_') && this.onTurn) {
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
      const a = this.actions.get(gait.name)!;
      const p = warpPhase(this.phase, gait.duty, duty);
      this.locoPhase[j] = p;
      a.setEffectiveWeight(this.loco * lw[j]! * (1 - tw) * (1 - this.back));
      a.time = p * gait.duration;
    }
    const bp = this.actions.get('loco_backpedal');
    if (bp && bpMeta) {
      bp.setEffectiveWeight(this.loco * this.back * (1 - tw));
      bp.time = this.backPhase * bpMeta.duration;
    }
    this.stanceTime += dt;
    let total = 0;
    for (const [name, w0] of this.stanceWeights) {
      const w = w0 + ((name === this.stance ? 1 : 0) - w0) * k;
      this.stanceWeights.set(name, w);
      total += w;
    }
    for (const [name, w] of this.stanceWeights) {
      const a = this.actions.get(name)!;
      a.setEffectiveWeight((1 - this.loco) * (total > 0 ? w / total : 0) * (1 - tw));
      a.time = this.stanceTime % a.getClip().duration;
    }
    for (const [name, a] of this.actions) {
      if (this.lib.meta[name]?.kind !== 'transition') continue;
      const on = this.trans?.name === name;
      a.setEffectiveWeight(on ? tw : 0);
      // Just inside the end: at exactly the duration a repeating action wraps to frame 0.
      if (on) a.time = Math.min(this.trans!.t, a.getClip().duration - 1e-4);
    }
    // Everything else (the backpedal, future clips) stays silent unless driven.
    const rootBone = this.bone('root');
    for (const [bone, q] of this.animPose) bone.quaternion.copy(q);
    rootBone.position.copy(this.animRootPos);
    this.mixer.update(0);
    for (const [bone, q] of this.animPose) q.copy(bone.quaternion);
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
    this.player.root.updateMatrixWorld(true);

    // (Passing round 14) The feet as the clips keyed them, before the leans tilt the whole body: a planted foot stays
    // flat on the ground under a lean (lockFoot, for AnimInput.holdFeet).
    if (input.holdFeet) {
      for (const s of FEET) {
        const f = this.bone(`foot_${s}`);
        f.getWorldQuaternion(this.footQ[s]);
        f.getWorldPosition(this.footOff[s]).sub(this.bone(`toe_${s}`).getWorldPosition(_v));
        this.footBall[s] = _v.y;
      }
    }
    // 3. Lean (before the feet are locked, so the lock sees the leaned body).
    this.lean(speed, input.yawRate ?? 0, input.accel ?? 0, this.pressW * PRESS_PITCH);
    // Where the trunk is before any contact lean (contact.ts reads it: leaning must not feed back into the lean).
    this.bone('spine_04').getWorldPosition(this.trunk);
    const cl = input.contactLean;
    if (cl && (cl.x !== 0 || cl.z !== 0)) this.leanToward(cl.x, cl.z);
    // 2. Foot lock.
    // A foot is planted when every clip with weight has it planted (when the
    // warp can't align them, e.g. walk against jog, the stricter of the two).
    const plant = this.plant;
    for (const s of FEET) {
      let down: boolean;
      if (this.trans && trMeta && tw > 0.5) {
        // The transition's own contacts (its frames are absolute, not a cycle).
        down = planted(trMeta, s, Math.min(this.trans.t, trMeta.duration - 1e-4) / trMeta.duration);
        plant[s] = { down, source: 'trans' };
        continue;
      }
      if (this.loco > 0.5 && this.back > 0.5 && bpMeta) {
        down = planted(bpMeta, s, this.backPhase);
      } else if (this.loco > 0.5) {
        down = true;
        for (let j = 0; j < this.locos.length; j++) {
          if (lw[j]! > 0.02) down &&= planted(this.lib.meta[this.locos[j]!.name]!, s, this.locoPhase[j]!);
        }
      } else down = this.loco < 0.5;
      plant[s] = { down, source: this.loco > 0.5 ? 'loco' : 'stand' };
    }
    // (Passing round 14) The body over its planted feet, then each foot's lock.
    this.holdFeet = !!input.holdFeet;
    this.holdOver(dt, input.groundVelocity);
    for (const s of FEET) this.lockFoot(s, plant[s].source, plant[s].down, dt, input.groundVelocity);
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

  private lean(speed: number, yawRate: number, accel: number, press = 0): void {
    // A body turning at ω while moving at v leans by atan(v·ω / g) into the
    // turn; a burst pitches it forward (half the physical angle, which reads
    // right on screen without looking like a fall); a back pressing the hole
    // runs pitched a little further into it.
    const bank = THREE.MathUtils.clamp(Math.atan2(speed * yawRate, G), -0.35, 0.35);
    const pitch = THREE.MathUtils.clamp(Math.atan2(accel, G) * 0.5 + press, -0.15, 0.3);
    if (Math.abs(bank) < 1e-4 && Math.abs(pitch) < 1e-4) return;
    const root = this.bone('root');
    const rootQ = this.player.root.getWorldQuaternion(_q2);
    _fwd.set(0, 0, 1).applyQuaternion(rootQ);
    const right = _w.set(-1, 0, 0).applyQuaternion(rootQ);
    _q.setFromAxisAngle(_fwd, -bank).multiply(new THREE.Quaternion().setFromAxisAngle(right, pitch));
    const wq = root.getWorldQuaternion(new THREE.Quaternion());
    const pq = root.parent ? root.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    root.quaternion.copy(pq.invert().multiply(_q).multiply(wq));
    // About the hips, not the feet (M6.5 #12): the sim's spot is where his
    // mass goes, so the body tilts about it and the feet swing out under a
    // turn. Pivoting at the feet swung the chest up to half a metre off the
    // sim's spot at the bank's limit, into whoever was beside him (a
    // receiver adjusting to the ball banks at the limit on one catch in
    // five; tools/sim/catchcontact.ts).
    if (root.parent) {
      const h = LEAN_PIVOT * this.player.shape.scale;
      root.getWorldPosition(_v);
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
    const root = this.bone('root');
    // Up turns toward (x, z): about the axis up × dir.
    _q.setFromAxisAngle(_w.set(z / ang, 0, -x / ang), ang);
    const wq = root.getWorldQuaternion(_oq2);
    const pq = root.parent ? root.parent.getWorldQuaternion(_oq3) : _oq3.identity();
    root.quaternion.copy(pq.invert().multiply(_q).multiply(wq));
    root.updateMatrixWorld(true);
  }

  /** This frame's AnimInput.holdFeet. */
  private holdFeet = false;
  /** (Passing round 14) Each foot's world rotation and ankle-from-ball offset as the clips keyed them, before the leans (holdFeet). */
  private footQ = { l: new THREE.Quaternion(), r: new THREE.Quaternion() };
  private footOff = { l: new THREE.Vector3(), r: new THREE.Vector3() };
  private footBall = { l: 0, r: 0 };
  /** This frame's plant per foot (down, and what plants it), from the clips' contacts. */
  private plant: Record<'l' | 'r', { down: boolean; source: LockSource }> = { l: { down: false, source: 'stand' }, r: { down: false, source: 'stand' } };

  /**
   * The keyed leg's reach (passing round 14): the hip, the clip's own ankle and the farthest the hip may be from the
   * ankle before the knee is straighter than the clip's less KNEE_GIVE (the pose as the clips and leans left it, before
   * any IK). Fills _hip and _ank.
   */
  private keyedReach(s: 'l' | 'r'): number {
    this.bone(`thigh_${s}`).getWorldPosition(_hip);
    this.bone(`calf_${s}`).getWorldPosition(_knee);
    this.bone(`foot_${s}`).getWorldPosition(_ank);
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
    const root = this.bone('root');
    const on = this.footLock && this.holdFeet && !(ground && ground.lengthSq() > 0);
    let any = false;
    _need.set(0, 0, 0);
    if (on) {
      // The sim's spot (where the game puts the player's root), against where it was when each foot planted.
      const spot = this.player.root.getWorldPosition(_rp);
      const fwd = _fwd.set(0, 0, 1).applyQuaternion(this.player.root.getWorldQuaternion(_q2));
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
    root.getWorldPosition(_v).add(by);
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
  ): void {
    const st = this.feet[s];
    const foot = this.bone(`foot_${s}`);
    // The ball of the foot is what stays put on the ground: through late
    // stance the heel rises and the ankle rolls forward over it.
    const ball = this.bone(`toe_${s}`);
    const down = this.footLock && isDown;
    const target = down ? 1 : 0;
    // Engage in ~50 ms, let go in ~15 ms: a lock that lingers after lift-off
    // drags the swinging foot back toward where it was planted.
    st.weight += (target - st.weight) * (1 - Math.exp(-dt * (down ? 40 : 200)));
    // Plant where the clip puts the foot now; a foot still planted from
    // standing when the gait takes over must re-plant, or it stays pinned to
    // the standing spot while the body runs away from it.
    if (down && (!st.locked || st.source !== source)) {
      ball.getWorldPosition(st.pos);
      this.player.root.getWorldPosition(st.anchor);
      st.travel0 = this.transTravel();
      st.spent = 0;
      st.locked = true;
      st.source = source;
    } else if (!down && st.weight < 0.02) {
      st.locked = false;
      st.source = null;
    }
    this.correction[s] = 0;
    if (!st.locked || st.weight < 0.01) return;
    if (ground) st.pos.addScaledVector(ground, dt);
    // (Passing round 14) For holdFeet the lock holds the ball of the foot where it planted along the ground; its height
    // is the clip's (a front foot keyed toes-up on the stride, heel=-6 deg, 2 cm off the turf: pinned at its landing
    // height the ankle went 2 cm under the keyed one and the leg straightened).
    if (this.holdFeet && down) st.pos.y = this.footBall[s];
    const thigh = this.bone(`thigh_${s}`);
    const calf = this.bone(`calf_${s}`);
    // Keep the foot's own orientation through the solve.
    // (Passing round 14: for holdFeet, as the clip keyed it before the leans. The run's lean pitches the whole body
    // about the hips on the sim's acceleration, the planted foot with it: on the contested ball the QB's drift back
    // tipped him ~15 deg as he threw and his planted front foot rolled onto its heel, the ankle pulled 5 cm down to the
    // turf and the leg dead straight, 4 deg at the release against 34 keyed.)
    const footWorld = this.holdFeet ? this.footQ[s].clone() : foot.getWorldQuaternion(new THREE.Quaternion());
    ball.getWorldPosition(_v);
    if (down) this.correction[s] = _v.distanceTo(st.pos);
    // Ankle target: the locked ball plus the clip's current ankle-to-ball offset.
    const ankleTarget = this.holdFeet ? _w.copy(this.footOff[s]).add(st.pos) : foot.getWorldPosition(_w).sub(_v).add(st.pos);
    this.slid[s] = 0;
    if (this.holdFeet && source === 'trans' && down) {
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
        const spot = this.player.root.getWorldPosition(_rp);
        const away = -((spot.x - st.anchor.x) * ax + (spot.z - st.anchor.z) * az) / r;
        const held = (this.give.x * ax + this.give.z * az) / r;
        const room = Math.max(0, away - Math.max(0, held) - st.spent);
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
    // Knee pole: in front of the current knee.
    calf.getWorldPosition(_pole);
    _fwd.set(0, 0, 1).applyQuaternion(this.player.root.getWorldQuaternion(_q2));
    _pole.addScaledVector(_fwd, 0.5);
    solveTwoBone(thigh, calf, foot, ankleTarget, _pole, st.weight);
    const pq = foot.parent!.getWorldQuaternion(new THREE.Quaternion());
    foot.quaternion.copy(pq.invert().multiply(footWorld));
    foot.updateMatrixWorld(true);
  }

  private lookAt(target: THREE.Vector3 | null, dt: number, wide = false): void {
    const head = this.bone('head');
    const neck = this.bone('neck_02');
    const rootQ = this.player.root.getWorldQuaternion(_q2);
    const facing = _fwd.set(0, 0, 1).applyQuaternion(rootQ);
    let want = new THREE.Quaternion();
    if (target) {
      head.getWorldPosition(_v);
      const d = _w.subVectors(target, _v).normalize();
      // Clamp to what a neck can do: ±70° side to side, ±35° up and down
      // (wide: the chest turns too, and the eyes go down into the hands).
      const yawLim = wide ? LOOK_WIDE : 1.22;
      const yaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(Math.atan2(d.x, d.z) - Math.atan2(facing.x, facing.z)), Math.cos(Math.atan2(d.x, d.z) - Math.atan2(facing.x, facing.z))), -yawLim, yawLim);
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)), wide ? -LOOK_DOWN_WIDE : -0.6, 0.6);
      want = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
      want.premultiply(rootQ).multiply(rootQ.clone().invert());
    }
    // Critically damped-ish follow (~0.15 s).
    this.look.slerp(want, 1 - Math.exp(-dt * 10));
    if (Math.abs(this.look.w) > 0.99999) return;
    // 40% in the neck, 60% in the head; a wide look puts a third of it in the upper back first (the shoulders turn with the head).
    const parts = wide ? LOOK_PARTS_WIDE : LOOK_PARTS;
    for (const [name, share] of parts) {
      const bone = name === 'head' ? head : name === 'neck_02' ? neck : this.bone(name);
      const part = new THREE.Quaternion().slerp(this.look, share);
      const wq = bone.getWorldQuaternion(new THREE.Quaternion());
      const pq = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      bone.quaternion.copy(pq.invert().multiply(part).multiply(wq));
      bone.updateMatrixWorld(true);
    }
  }

  private pads(dt: number): void {
    if (dt <= 0) return;
    const chest = this.bone('spine_04');
    chest.getWorldPosition(_v);
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
    const right = _w.set(1, 0, 0).applyQuaternion(this.player.root.getWorldQuaternion(_q2));
    for (const s of FEET) {
      const pad = this.bone(`pad_${s}`);
      pad.getWorldPosition(_v);
      rotateBoneWorld(pad, _fwd.set(0, 0, 1), _pole.set(0, 0, 1).applyAxisAngle(right, angle));
    }
  }
}
