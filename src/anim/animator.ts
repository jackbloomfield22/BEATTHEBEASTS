import * as THREE from 'three';
import type { Player } from '@/render/players/playerAsset';
import { advancePhase, MIN_LOCO_SPEED, sampleGait, warpPhase } from './blend';
import { rotateBoneWorld, solveTwoBone } from './ik';
import { planted, type AnimLibrary } from './library';

// The per-player animation runtime (TECH_PLAN §9.2), layered:
//   1. clips: a settled stance, or locomotion (the two gait clips that
//      bracket the speed, on one stride-matched phase), crossfaded;
//   2. foot lock: a foot that plants stays where it planted (two-bone IK)
//      until it lifts, which removes the residual slide of blends, speed
//      changes and turns;
//   3. body lean into turns and with acceleration, pivoting at the feet;
//   4. look-at for the neck and head, clamped and spring-smoothed;
//   5. shoulder-pad springs driven by the chest's vertical acceleration.
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
  source: 'stand' | 'loco' | null;
}

export class PlayerAnimator {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private stance = 'stance_idle';
  private stanceWeights = new Map<string, number>();
  private stanceTime = 0;
  private loco = 0; // 0 standing .. 1 moving
  phase = 0;
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
    this.phase = advancePhase(this.phase, speed, dt, g.stride);
    // Both clips plant and lift each foot on the same frame (warped phases),
    // so the blended foot is either planted in both or swinging in both.
    const duty = g.a.duty + (g.b.duty - g.a.duty) * g.w;
    const clipPhase = new Map<string, number>();
    for (const gait of this.lib.gaits) {
      const a = this.actions.get(gait.name)!;
      const w = gait === g.a ? 1 - g.w : gait === g.b ? g.w : 0;
      const p = warpPhase(this.phase, gait.duty, duty);
      clipPhase.set(gait.name, p);
      a.setEffectiveWeight(this.loco * w);
      a.time = p * gait.duration;
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
      a.setEffectiveWeight((1 - this.loco) * (total > 0 ? w / total : 0));
      a.time = this.stanceTime % a.getClip().duration;
    }
    // Everything else (the backpedal, future clips) stays silent unless driven.
    for (const [bone, q] of this.animPose) bone.quaternion.copy(q);
    this.mixer.update(0);
    for (const [bone, q] of this.animPose) q.copy(bone.quaternion);
    this.player.root.updateMatrixWorld(true);

    // 3. Lean (before the feet are locked, so the lock sees the leaned body).
    this.lean(speed, input.yawRate ?? 0, input.accel ?? 0);
    // 2. Foot lock.
    // A foot is planted when every clip with weight has it planted (when the
    // warp can't align them, e.g. walk against jog, the stricter of the two).
    for (const s of FEET) {
      let down: boolean;
      if (this.loco > 0.5) {
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
    source: 'loco' | 'stand',
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
