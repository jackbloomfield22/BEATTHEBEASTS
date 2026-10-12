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

/**
 * (Passing round 14) Foot slide in play: a planted foot (its lock fully on,
 * animator.ts footLockOf) should not move on the ground while it stays down.
 * Each planted span's drift is how far the drawn ball of the foot (toe_*)
 * gets from where it was on the span's first frame, along the ground; the
 * clips' own gate is 0.5 cm (tools/blender/build_anims.py SLIDE_MAX). A span
 * ends when the foot lifts or the lock re-plants (its point moves); a foot
 * moving more than 2 cm in one frame while it's down is a jump (a re-plant
 * the drawn foot follows at once). By group: the QB, the line (both sides),
 * the backs and receivers, the back seven.
 */
export interface SlideStats {
  spans: number;
  /** Spans whose drift passed 0.5 cm and 2 cm. */
  over5mm: number;
  over2cm: number;
  /** The largest drift (m) and the sum over spans. */
  max: number;
  sum: number;
  /** Frames a planted foot moved more than JUMP in one frame, and the largest such move (m). */
  jumps: number;
  maxStep: number;
  /** The worst span: who, which foot, its drift, frames planted, and what was playing at its start and end. */
  worst: { slot: string; foot: string; drift: number; frames: number; from: string; clip: string; frame: number } | null;
}
const LOCK_FULL = 0.98;
const JUMP = 0.02;
const OL = new Set(['LT', 'LG', 'C', 'RG', 'RT', 'DE1', 'DT1', 'DT2', 'DE2', 'NT', 'DE', 'DT']);
const groupOf = (slot: string): string => (slot === 'QB' ? 'qb' : OL.has(slot) || /^(D[ET]|NT)/.test(slot) ? 'line' : /^(RB|FB|HB|WR|X|Y|Z|TE|SLOT|H)/.test(slot) ? 'skill' : 'def');
const newSlide = (): SlideStats => ({ spans: 0, over5mm: 0, over2cm: 0, max: 0, sum: 0, jumps: 0, maxStep: 0, worst: null });
interface Span {
  x: number;
  z: number;
  px: number;
  pz: number;
  lx: number;
  lz: number;
  drift: number;
  n: number;
  from: string;
}
const span = new Map<Body, Record<'l' | 'r', Span | null>>();
const _toe = new THREE.Vector3();
/** Where each body's root was last frame: a root moving more than TELEPORT (m) in a frame was placed (a new play, a lineup), not moved. */
const lastRoot = new Map<Body, THREE.Vector3>();
const TELEPORT = 0.5;

function closeSpan(b: Body, f: 'l' | 'r', cur: Span, clip: string, frame: number): void {
  // A span of a frame or two is a touch-down's blend, not a plant.
  if (cur.n < 3) return;
  const g = (pops.slide[groupOf(b.slot)] ??= newSlide());
  g.spans++;
  g.sum += cur.drift;
  if (cur.drift > 0.005) g.over5mm++;
  if (cur.drift > 0.02) g.over2cm++;
  if (cur.drift > g.max) {
    g.max = cur.drift;
    g.worst = { slot: b.slot, foot: f, drift: Math.round(cur.drift * 1000) / 1000, frames: cur.n, from: cur.from, clip, frame };
  }
}

const last = new Map<Body, THREE.Quaternion[]>();
const lastYaw = new Map<Body, number>();
export const pops = { frames: 0, spikes: [] as PopSpike[], worst: 0, rates: [] as number[], slide: {} as Record<string, SlideStats> };
if (typeof window !== 'undefined') (window as unknown as { __btbPops: typeof pops }).__btbPops = pops;

export function resetPops(): void {
  last.clear();
  lastYaw.clear();
  span.clear();
  lastRoot.clear();
  pops.slide = {};
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
  // (Passing round 14) The planted feet's drift.
  let sp = span.get(b);
  if (!sp) span.set(b, (sp = { l: null, r: null }));
  const rp = b.player.root.position;
  const lr = lastRoot.get(b);
  if (lr && Math.hypot(rp.x - lr.x, rp.z - lr.z) > TELEPORT) sp.l = sp.r = null;
  if (lr) lr.copy(rp);
  else lastRoot.set(b, rp.clone());
  const what = ctx.clip || ctx.overlay || ctx.anim;
  for (const f of ['l', 'r'] as const) {
    const lk = b.animator.footLockOf(f);
    const toe = b.player.bones.get(`toe_${f}`);
    const down = !b.ragdoll.active && !b.lie && lk.locked && lk.weight >= LOCK_FULL && !!toe;
    let cur = sp[f];
    if (!down) {
      if (cur) closeSpan(b, f, cur, what, frame);
      sp[f] = null;
      continue;
    }
    toe!.getWorldPosition(_toe);
    if (cur) {
      const step = Math.hypot(_toe.x - cur.lx, _toe.z - cur.lz);
      const g = (pops.slide[groupOf(b.slot)] ??= newSlide());
      if (step > JUMP) g.jumps++;
      g.maxStep = Math.max(g.maxStep, step);
      if (Math.hypot(lk.pos.x - cur.px, lk.pos.z - cur.pz) > 0.001) {
        // Re-planted (the lock's point moved): a new span.
        closeSpan(b, f, cur, what, frame);
        cur = null;
      }
    }
    if (!cur) sp[f] = cur = { x: _toe.x, z: _toe.z, px: lk.pos.x, pz: lk.pos.z, lx: _toe.x, lz: _toe.z, drift: 0, n: 0, from: what };
    cur.drift = Math.max(cur.drift, Math.hypot(_toe.x - cur.x, _toe.z - cur.z));
    cur.lx = _toe.x;
    cur.lz = _toe.z;
    cur.n++;
  }
}
