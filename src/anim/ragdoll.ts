import * as THREE from 'three';
import type { Player } from '@/render/players/playerAsset';

// The tackle's fall (GDD §9.5): a small in-house verlet ragdoll. The sim has
// already decided the tackle; this only shows the body going down. On a hit
// the animated pose seeds point masses at the joints, the hit's impulse and
// the player's run carry them, gravity and the turf do the rest, and the
// skeleton is aimed back along the points and blended in over ~0.12 s.
// Visual only: nothing here feeds the sim (CLAUDE.md rule 4). No physics
// engine: ~17 points and ~45 distance constraints a player, a few
// microseconds a frame.

interface Pt {
  bone: string;
  /** Use the bone's tail (the end of a chain) instead of its head. */
  tail?: boolean;
  /** Ground clearance (m): the body part's thickness. */
  r: number;
  /** Share of the hit's push (upper body takes more). */
  push: number;
}

const PTS: Pt[] = [
  { bone: 'pelvis', r: 0.12, push: 0.6 }, // 0
  { bone: 'spine_03', r: 0.14, push: 1 }, // 1 chest
  { bone: 'neck_01', r: 0.1, push: 1 }, // 2
  { bone: 'head', tail: true, r: 0.13, push: 1 }, // 3 top of the head
  { bone: 'upperarm_l', r: 0.08, push: 0.9 }, // 4
  { bone: 'forearm_l', r: 0.06, push: 0.6 }, // 5 elbow
  { bone: 'hand_l', r: 0.05, push: 0.4 }, // 6 wrist
  { bone: 'upperarm_r', r: 0.08, push: 0.9 }, // 7
  { bone: 'forearm_r', r: 0.06, push: 0.6 }, // 8
  { bone: 'hand_r', r: 0.05, push: 0.4 }, // 9
  { bone: 'thigh_l', r: 0.1, push: 0.4 }, // 10 hip
  { bone: 'calf_l', r: 0.07, push: 0.15 }, // 11 knee
  { bone: 'foot_l', r: 0.06, push: 0 }, // 12 ankle
  { bone: 'thigh_r', r: 0.1, push: 0.4 }, // 13
  { bone: 'calf_r', r: 0.07, push: 0.15 }, // 14
  { bone: 'foot_r', r: 0.06, push: 0 }, // 15
  { bone: 'toe_l', r: 0.03, push: 0 }, // 16
  { bone: 'toe_r', r: 0.03, push: 0 }, // 17
];

// Bones (segments) and the torso's bracing: rigid distances.
const LINKS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [1, 4], [4, 5], [5, 6], [1, 7], [7, 8], [8, 9], [0, 10], [10, 11], [11, 12], [0, 13], [13, 14], [14, 15], [12, 16], [15, 17],
  // Torso box: shoulders, hips, their diagonals, the neck to both shoulders.
  [4, 7], [10, 13], [4, 10], [7, 13], [4, 13], [7, 10], [2, 4], [2, 7], [0, 4], [0, 7], [1, 10], [1, 13], [0, 2], [1, 3], [3, 4], [3, 7],
  // The foot stays a foot.
  [11, 16], [14, 17],
];
// Joints that can't fold flat: knee and elbow keep the chain from closing up
// (hip to ankle, shoulder to wrist at least this share of the full length).
const MIN_REACH: [number, number, number][] = [
  [10, 12, 0.55], [13, 15, 0.55], [4, 6, 0.4], [7, 9, 0.4], [0, 3, 0.9],
];

// Bones aimed along the points (head point -> tail point), parents first.
const AIM: [string, number, number][] = [
  ['spine_01', 0, 1], ['neck_01', 2, 3],
  ['upperarm_l', 4, 5], ['forearm_l', 5, 6], ['upperarm_r', 7, 8], ['forearm_r', 8, 9],
  ['thigh_l', 10, 11], ['calf_l', 11, 12], ['foot_l', 12, 16], ['thigh_r', 13, 14], ['calf_r', 14, 15], ['foot_r', 15, 17],
];

const G = 9.81;
const ITER = 8;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();

export class Ragdoll {
  private pos: THREE.Vector3[] = [];
  private prev: THREE.Vector3[] = [];
  private rest: number[] = [];
  private min: number[] = [];
  /** Blend weight 0..1 (the fall takes over from the animation). */
  w = 0;
  /** A big hit's fall: limbs trail, the body slides on landing. */
  private big = false;
  private landed = false;
  /** Where the body first hit the turf hard (m, world), for the dust; the caller takes it and clears it. */
  landing: THREE.Vector3 | null = null;
  active = false;
  private t = 0;
  /** Per-bone local rotations the fall ended on (held once it settles). */
  private settled = false;
  /** The pelvis's world rotation relative to the frame built from the points, captured at the start. */
  private pelvisOffset = new THREE.Quaternion();
  private readonly bones: Map<string, THREE.Bone>;

  private readonly pelvisRest: THREE.Vector3;

  constructor(private player: Player) {
    this.bones = player.bones;
    this.pelvisRest = player.bones.get('pelvis')!.position.clone();
  }

  private at(p: Pt, out: THREE.Vector3): THREE.Vector3 {
    const b = this.bones.get(p.bone)!;
    if (!p.tail) return b.getWorldPosition(out);
    // Tail: the head of the first child, or the bone's own length along +Y.
    const c = b.children.find((o) => (o as THREE.Bone).isBone);
    if (c) return c.getWorldPosition(out);
    return out.set(0, 0.2, 0).applyMatrix4(b.matrixWorld);
  }

  /**
   * Start the fall from the current (animated) pose. `vel` is the body's
   * velocity (m/s, world), `push` the hit's impulse as a velocity change on
   * the upper body (m/s, world).
   */
  start(vel: THREE.Vector3, push: THREE.Vector3, big = false): void {
    this.player.root.updateMatrixWorld(true);
    const dt = 1 / 60;
    // A big hit (feedback item 5): the torso braced and taking the blow,
    // the limbs trailing it (they take half their share), and a slide on
    // landing (the turf holds him less while he's still moving fast).
    this.big = big;
    this.landed = false;
    this.landing = null;
    this.pos = PTS.map((p) => this.at(p, new THREE.Vector3()));
    const share = (i: number) => PTS[i]!.push * (big && i >= 4 && i !== 10 && i !== 13 ? 0.5 : 1);
    this.prev = this.pos.map((x, i) => x.clone().addScaledVector(vel, -dt).addScaledVector(push, -dt * share(i)));
    this.rest = LINKS.map(([a, b]) => this.pos[a]!.distanceTo(this.pos[b]!));
    this.min = MIN_REACH.map(([a, b, k]) => {
      // Full chain length through the middle joint.
      const mid = a === 0 ? 1 : a + 1;
      return (this.pos[a]!.distanceTo(this.pos[mid]!) + this.pos[mid]!.distanceTo(this.pos[b]!)) * k;
    });
    this.pelvisOffset.copy(this.frame(_q).invert().premultiply(this.bones.get('pelvis')!.getWorldQuaternion(_pq)));
    this.active = true;
    this.fading = false;
    this.settled = false;
    this.t = 0;
    this.w = 0;
  }

  stop(): void {
    if (this.active) this.bones.get('pelvis')!.position.copy(this.pelvisRest);
    this.active = false;
    this.w = 0;
  }

  /** The body frame from the points: x across the hips, y up the spine, z forward. */
  private frame(out: THREE.Quaternion): THREE.Quaternion {
    const P = this.pos;
    _y.subVectors(P[1]!, P[0]!).normalize();
    _x.subVectors(P[10]!, P[13]!);
    _x.addScaledVector(_y, -_x.dot(_y)).normalize();
    _z.crossVectors(_x, _y).normalize();
    _m.makeBasis(_x, _y, _z);
    return out.setFromRotationMatrix(_m);
  }

  private step(dt: number): void {
    const P = this.pos;
    const Q = this.prev;
    for (let i = 0; i < P.length; i++) {
      const p = P[i]!;
      const q = Q[i]!;
      _v.subVectors(p, q).multiplyScalar(0.995);
      q.copy(p);
      p.add(_v);
      p.y -= G * dt * dt;
    }
    for (let k = 0; k < ITER; k++) {
      LINKS.forEach(([a, b], j) => this.keep(a, b, this.rest[j]!, 'eq'));
      MIN_REACH.forEach(([a, b], j) => this.keep(a, b, this.min[j]!, 'min'));
      // The turf: no point below its radius; on contact, friction takes the
      // slide out (a big hit's body slides further: less grip at speed).
      const grip = this.big ? 0.12 : 0.35;
      for (let i = 0; i < P.length; i++) {
        const r = PTS[i]!.r;
        const p = P[i]!;
        if (p.y < r) {
          const q = Q[i]!;
          // The hips or the chest landing hard: that's where the dust goes up.
          if (!this.landed && (i === 0 || i === 1) && (q.y - p.y) / dt > 1.2) {
            this.landed = true;
            this.landing = p.clone().setY(0.02);
          }
          p.y = r;
          q.x += (p.x - q.x) * grip;
          q.z += (p.z - q.z) * grip;
        }
      }
    }
  }

  private keep(a: number, b: number, d: number, mode: 'eq' | 'min'): void {
    const pa = this.pos[a]!;
    const pb = this.pos[b]!;
    _w.subVectors(pb, pa);
    const L = _w.length();
    if (L < 1e-6) return;
    if (mode === 'min' && L >= d) return;
    const k = ((L - d) / L) * 0.5;
    pa.addScaledVector(_w, k);
    pb.addScaledVector(_w, -k);
  }

  /** Seconds since the fall started. */
  get time(): number {
    return this.t;
  }

  private fading = false;

  /**
   * Hand over to a lying pose: where the body came to rest (the pelvis on
   * the turf), which way the head lies (world yaw of the body's up axis on
   * the ground), and whether it's face down. The ragdoll then fades out
   * over the lying clip the caller starts.
   */
  handOff(): { x: number; z: number; yaw: number; prone: boolean } {
    const P = this.pos;
    this.frame(_q);
    const front = _z.set(0, 0, 1).applyQuaternion(_q);
    const up = _y.subVectors(P[3]!, P[0]!);
    this.fading = true;
    return { x: P[0]!.x, z: P[0]!.z, yaw: Math.atan2(up.x, up.z), prone: front.y < 0 };
  }

  /** Advance the fall and pose the skeleton (call after the animator). */
  update(dt: number): void {
    if (!this.active) return;
    if (this.fading) {
      this.w -= dt / 0.45;
      if (this.w <= 0) {
        this.stop();
        return;
      }
    } else this.w = Math.min(1, this.w + dt / 0.12);
    if (!this.settled) {
      // Fixed substeps: stable at any frame rate.
      const n = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 120))));
      for (let k = 0; k < n; k++) this.step(dt / n);
      this.t += dt;
      // Settled: every point still and the fall over.
      let moving = 0;
      for (let i = 0; i < this.pos.length; i++) moving = Math.max(moving, this.pos[i]!.distanceTo(this.prev[i]!));
      if (this.t > 1.2 && moving < 0.0005) this.settled = true;
    }
    this.pose();
  }

  private pose(): void {
    const w = this.w;
    const pelvis = this.bones.get('pelvis')!;
    // The pelvis: placed at its point and turned with the body frame.
    const parent = pelvis.parent!;
    parent.updateMatrixWorld(true);
    const target = parent.worldToLocal(_v.copy(this.pos[0]!));
    pelvis.position.lerp(target, w);
    this.frame(_q).multiply(this.pelvisOffset);
    parent.getWorldQuaternion(_pq).invert();
    pelvis.quaternion.slerp(_pq.multiply(_q), w);
    pelvis.updateMatrixWorld(true);
    // Then each segment aimed from its point to the next.
    for (const [name, a, b] of AIM) {
      const bone = this.bones.get(name);
      if (!bone) continue;
      const head = bone.getWorldPosition(_v);
      // The bone's current direction: toward its first child (or its +Y).
      const c = bone.children.find((o) => (o as THREE.Bone).isBone);
      const from = c ? c.getWorldPosition(_w).sub(head) : _w.set(0, 1, 0).transformDirection(bone.matrixWorld);
      const to = _x.subVectors(this.pos[b]!, this.pos[a]!);
      aim(bone, from, to, w);
    }
  }
}

const _fq = new THREE.Quaternion();
const _wq = new THREE.Quaternion();
const _pp = new THREE.Quaternion();
const _o = new THREE.Quaternion();

function aim(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, weight: number): void {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  _fq.setFromUnitVectors(from.normalize(), to.normalize());
  bone.getWorldQuaternion(_wq);
  bone.parent!.getWorldQuaternion(_pp);
  _o.copy(bone.quaternion);
  bone.quaternion.copy(_pp.invert()).multiply(_fq).multiply(_wq);
  if (weight < 1) bone.quaternion.copy(_o.slerp(bone.quaternion, weight));
  bone.updateMatrixWorld(true);
}
