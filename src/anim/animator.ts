import * as THREE from 'three';
import type { Player } from '@/render/players/playerAsset';
import { advancePhase, MIN_LOCO_SPEED, sampleGait, warpPhase } from './blend';
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
  /** World velocity of the ground under the player (the Lab's treadmill; 0 in the game). */
  groundVelocity?: THREE.Vector3;
  /** Moving backward facing forward (a defensive back's pedal): `speed` is then the backward speed. */
  backpedal?: boolean;
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

const OVERLAY_IN = 0.13;
const OVERLAY_OUT = 0.16;
const _oq = new THREE.Quaternion();

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
    l: { weight: 0, locked: false, pos: new THREE.Vector3(), source: null },
    r: { weight: 0, locked: false, pos: new THREE.Vector3(), source: null },
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
  private trans: TransitionState | null = null;
  /** A stop waiting for the left foot's touch-down (the clip starts there). */
  private queued: string | null = null;
  /** Overlays: a held one (the ball carried, the QB's hold) and a one-shot action over it. */
  private holdLayer: Overlay | null = null;
  private actionLayer: Overlay | null = null;
  /** Root motion this update (m along the facing, body-scaled) and its rate (m/s). */
  rootMotion = 0;
  rootSpeed = 0;
  footLock = true;
  /** Last frame's foot-lock correction per foot (m): how much slide the lock removed. */
  readonly correction = { l: 0, r: 0 };

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
    this.look.identity();
    this.padSpring = { x: 0, v: 0 };
    this.chestY = [];
    this.trans = null;
    this.queued = null;
    this.holdLayer = null;
    this.actionLayer = null;
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
    const t = Math.min(o.t, o.duration - 1e-4);
    for (const k of o.tracks) {
      const v = k.interp.evaluate(t);
      _oq.set(v[0]!, v[1]!, v[2]!, v[3]!);
      k.bone.quaternion.slerp(_oq, Math.min(1, o.w));
    }
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
    const g = sampleGait(this.lib.gaits, speed, scale);
    const lastPhase = this.phase;
    this.back += ((input.backpedal ? 1 : 0) - this.back) * k;
    const bpMeta = this.lib.meta.loco_backpedal;
    if (bpMeta && this.back > 0.01) this.backPhase = advancePhase(this.backPhase, speed, dt, bpMeta.speed * bpMeta.duration * scale);
    if (!input.backpedal) this.phase = advancePhase(this.phase, speed, dt, g.stride);
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
    // Both clips plant and lift each foot on the same frame (warped phases),
    // so the blended foot is either planted in both or swinging in both.
    const duty = g.a.duty + (g.b.duty - g.a.duty) * g.w;
    const clipPhase = new Map<string, number>();
    for (const gait of this.lib.gaits) {
      const a = this.actions.get(gait.name)!;
      const w = gait === g.a ? 1 - g.w : gait === g.b ? g.w : 0;
      const p = warpPhase(this.phase, gait.duty, duty);
      clipPhase.set(gait.name, p);
      a.setEffectiveWeight(this.loco * w * (1 - tw) * (1 - this.back));
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
    for (const [bone, q] of this.animPose) bone.quaternion.copy(q);
    this.mixer.update(0);
    for (const [bone, q] of this.animPose) q.copy(bone.quaternion);
    // Overlays over the clips (the snapshot above is what the next frame
    // restores, so they never compound).
    this.holdLayer = this.stepOverlay(this.holdLayer, dt);
    this.actionLayer = this.stepOverlay(this.actionLayer, dt);
    this.player.root.updateMatrixWorld(true);

    // 3. Lean (before the feet are locked, so the lock sees the leaned body).
    this.lean(speed, input.yawRate ?? 0, input.accel ?? 0);
    // 2. Foot lock.
    // A foot is planted when every clip with weight has it planted (when the
    // warp can't align them, e.g. walk against jog, the stricter of the two).
    for (const s of FEET) {
      let down: boolean;
      if (this.trans && trMeta && tw > 0.5) {
        // The transition's own contacts (its frames are absolute, not a cycle).
        down = planted(trMeta, s, Math.min(this.trans.t, trMeta.duration - 1e-4) / trMeta.duration);
        this.lockFoot(s, 'trans', down, dt, input.groundVelocity);
        continue;
      }
      if (this.loco > 0.5 && this.back > 0.5 && bpMeta) {
        down = planted(bpMeta, s, this.backPhase);
      } else if (this.loco > 0.5) {
        down = true;
        for (const [gait, w] of [[g.a, 1 - g.w], [g.b, g.w]] as const) {
          if (w > 0.02) down &&= planted(this.lib.meta[gait.name]!, s, clipPhase.get(gait.name)!);
        }
      } else down = this.loco < 0.5;
      this.lockFoot(s, this.loco > 0.5 ? 'loco' : 'stand', down, dt, input.groundVelocity);
    }
    // 4 and 5.
    this.lookAt(input.lookAt ?? null, dt);
    this.pads(dt);
  }

  private lean(speed: number, yawRate: number, accel: number): void {
    // A body turning at ω while moving at v leans by atan(v·ω / g) into the
    // turn; a burst pitches it forward (half the physical angle, which reads
    // right on screen without looking like a fall).
    const bank = THREE.MathUtils.clamp(Math.atan2(speed * yawRate, G), -0.35, 0.35);
    const pitch = THREE.MathUtils.clamp(Math.atan2(accel, G) * 0.5, -0.15, 0.25);
    if (Math.abs(bank) < 1e-4 && Math.abs(pitch) < 1e-4) return;
    const root = this.bone('root');
    const rootQ = this.player.root.getWorldQuaternion(_q2);
    _fwd.set(0, 0, 1).applyQuaternion(rootQ);
    const right = _w.set(-1, 0, 0).applyQuaternion(rootQ);
    _q.setFromAxisAngle(_fwd, -bank).multiply(new THREE.Quaternion().setFromAxisAngle(right, pitch));
    const wq = root.getWorldQuaternion(new THREE.Quaternion());
    const pq = root.parent ? root.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    root.quaternion.copy(pq.invert().multiply(_q).multiply(wq));
    root.updateMatrixWorld(true);
  }

  private lockFoot(
    s: 'l' | 'r',
    source: 'loco' | 'stand' | 'trans',
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
      st.locked = true;
      st.source = source;
    } else if (!down && st.weight < 0.02) {
      st.locked = false;
      st.source = null;
    }
    this.correction[s] = 0;
    if (!st.locked || st.weight < 0.01) return;
    if (ground) st.pos.addScaledVector(ground, dt);
    const thigh = this.bone(`thigh_${s}`);
    const calf = this.bone(`calf_${s}`);
    // Keep the foot's own orientation through the solve.
    const footWorld = foot.getWorldQuaternion(new THREE.Quaternion());
    ball.getWorldPosition(_v);
    if (down) this.correction[s] = _v.distanceTo(st.pos);
    // Ankle target: the locked ball plus the clip's current ankle-to-ball offset.
    const ankleTarget = foot.getWorldPosition(_w).sub(_v).add(st.pos);
    // Knee pole: in front of the current knee.
    calf.getWorldPosition(_pole);
    _fwd.set(0, 0, 1).applyQuaternion(this.player.root.getWorldQuaternion(_q2));
    _pole.addScaledVector(_fwd, 0.5);
    solveTwoBone(thigh, calf, foot, ankleTarget, _pole, st.weight);
    const pq = foot.parent!.getWorldQuaternion(new THREE.Quaternion());
    foot.quaternion.copy(pq.invert().multiply(footWorld));
    foot.updateMatrixWorld(true);
  }

  private lookAt(target: THREE.Vector3 | null, dt: number): void {
    const head = this.bone('head');
    const neck = this.bone('neck_02');
    const rootQ = this.player.root.getWorldQuaternion(_q2);
    const facing = _fwd.set(0, 0, 1).applyQuaternion(rootQ);
    let want = new THREE.Quaternion();
    if (target) {
      head.getWorldPosition(_v);
      const d = _w.subVectors(target, _v).normalize();
      // Clamp to what a neck can do: ±70° side to side, ±35° up and down.
      const yaw = THREE.MathUtils.clamp(Math.atan2(d.x, d.z) - Math.atan2(facing.x, facing.z), -1.22, 1.22);
      const pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)), -0.6, 0.6);
      want = new THREE.Quaternion().setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ'));
      want.premultiply(rootQ).multiply(rootQ.clone().invert());
    }
    // Critically damped-ish follow (~0.15 s).
    this.look.slerp(want, 1 - Math.exp(-dt * 10));
    if (Math.abs(this.look.w) > 0.99999) return;
    // 40% in the neck, 60% in the head.
    for (const [bone, share] of [
      [neck, 0.4],
      [head, 0.6],
    ] as const) {
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
