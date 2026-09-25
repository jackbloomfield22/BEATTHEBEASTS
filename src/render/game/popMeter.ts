import * as THREE from 'three';
import type { Body } from './choreo';

// The pop meter (M5.5, `?pops`): how fast each player's key bones turn,
// frame to frame, and where it spikes. A blend between clips turns a bone
// smoothly; a cut between them turns it in one frame, which shows as a spike
// far above anything a running or tackling body does. Each spike is logged
// with what was playing, so the state change that cut can be found and
// blended. window.__btbPops holds the log; tools/shots/video.spec.ts writes
// it next to each video.

/** The bones that show a pop: the trunk, the head, the limbs. */
const BONES = ['pelvis', 'spine_03', 'head', 'upperarm_l', 'upperarm_r', 'forearm_l', 'forearm_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r'];
/**
 * A bone turning faster than this (rad/s, in its parent's frame) is a pop.
 * A sprint's arm swing peaks near 12–15 rad/s and a tackle's fastest joint
 * near 20; 30 rad/s (a quarter turn in 1/20 s) is past anything we author.
 */
export const POP_RATE = 30;
/**
 * Legs run faster: a sprinter's knee swings at ~20–25 rad/s and, sampled at
 * 30 fps with foot IK, reads up to ~40. A leg pop is past 45.
 */
export const LEG_RATE = 45;
const isLeg = (bone: string) => bone.startsWith('calf') || bone.startsWith('thigh');
/** The root turning faster than this (rad/s) is a yaw snap (a sprinter's hardest cut is ~6–8 rad/s). */
export const YAW_RATE = 14;

export interface PopSpike {
  frame: number;
  slot: string;
  bone: string;
  rate: number;
  clip: string;
  overlay: string;
  anim: string;
  phase: string;
}

const last = new Map<Body, THREE.Quaternion[]>();
const lastYaw = new Map<Body, number>();
export const pops = { frames: 0, spikes: [] as PopSpike[], worst: 0, rates: [] as number[] };
if (typeof window !== 'undefined') (window as unknown as { __btbPops: typeof pops }).__btbPops = pops;

export function resetPops(): void {
  last.clear();
  lastYaw.clear();
  pops.frames = 0;
  pops.spikes.length = 0;
  pops.worst = 0;
  pops.rates.length = 0;
}

/** One body after its update this frame. `lying`: a ragdoll or a lying clip drives him (falls are allowed to be fast). */
export function measure(b: Body, dt: number, frame: number, anim: string, phase: string): void {
  if (dt <= 0) return;
  const prev = last.get(b);
  const now = BONES.map((n) => b.player.bones.get(n)?.quaternion.clone() ?? new THREE.Quaternion());
  const tr = b.animator.transition;
  const ctx = { clip: tr && !tr.done ? tr.name : '', overlay: b.animator.overlayAction?.name ?? '', anim, phase };
  if (prev && !b.ragdoll.active) {
    let worst = 0;
    now.forEach((q, k) => {
      const rate = (2 * Math.acos(Math.min(1, Math.abs(q.dot(prev[k]!))))) / dt;
      worst = Math.max(worst, rate);
      if (rate > (isLeg(BONES[k]!) ? LEG_RATE : POP_RATE)) pops.spikes.push({ frame, slot: b.slot, bone: BONES[k]!, rate: Math.round(rate), ...ctx });
    });
    pops.rates.push(worst);
    pops.worst = Math.max(pops.worst, worst);
  }
  const yaw = b.player.root.rotation.y;
  const py = lastYaw.get(b);
  if (py !== undefined && !b.lie && !b.ragdoll.active) {
    const d = Math.abs(Math.atan2(Math.sin(yaw - py), Math.cos(yaw - py))) / dt;
    if (d > YAW_RATE) pops.spikes.push({ frame, slot: b.slot, bone: 'root-yaw', rate: Math.round(d), ...ctx });
  }
  lastYaw.set(b, yaw);
  last.set(b, now);
}
