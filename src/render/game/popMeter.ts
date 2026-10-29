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
 * ends when the foot lifts or the lock re-plants (its point jumps); a foot
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
  /** (Round 15) Of those, the ones past 5 cm; and the steps taken by feet that couldn't stay planted (animator.ts stepFoot). */
  jumps5: number;
  steps: number;
  /** (Round 15) Feet let go a little early into the clip's own swing (animator.ts lockFoot LIFT_SOON). */
  lifts: number;
  maxStep: number;
  /** The worst span: who, which foot, its drift, frames planted, and what was playing at its start and end. */
  worst: { slot: string; foot: string; drift: number; frames: number; from: string; clip: string; frame: number } | null;
  /**
   * (Round 15) Why: each jump's cause (a re-plant, by the lock sources it changed between; 'reach', the leg's IK short
   * of the ankle's target by over 1 cm, the body carried off the foot; 'other') and each span past 2 cm's (its frame
   * of greatest IK miss over 1 cm: 'reach', with the clip at that frame; else 'other').
   */
  jumpWhy: Record<string, number>;
  driftWhy: Record<string, number>;
  /** (Round 15) Each step's cause: the lock's source, 'far' (off the clip's foot) or 'reach', and what was playing. */
  stepWhy: Record<string, number>;
  /**
   * (Round 16) Frames of a player the sim moves faster than 0.5 m/s, by what his legs play: 'fwd' the forward gait,
   * 'side' the side layer (the shuffle, the line's slide and set), 'back' the pedal, 'stand' a stance, 'trans' a one-shot.
   */
  modes: Record<string, number>;
}
/** (Round 15) The ten worst spans of the whole play, with their cause. */
export interface WorstSpan {
  slot: string;
  foot: string;
  drift: number;
  frames: number;
  from: string;
  clip: string;
  frame: number;
  miss: number;
  why: string;
  /** Per frame: [frame, speed fed, loco, back, phase, IK miss (cm), root x, z, yaw (deg), lock x, z, toe x, z, anim]. */
  trace?: (number | string)[][];
}
const LOCK_FULL = 0.98;
const JUMP = 0.02;
const JUMP5 = 0.05;
const TRACE = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('trace') : null;
/** (Round 16) ?posedump: every body's key joints every frame (world, 0.01 mm), to check a change to the animator's cost leaves the pose as it was. */
const POSEDUMP = typeof location !== 'undefined' && new URLSearchParams(location.search).has('posedump');
const DUMP_BONES = ['pelvis', 'spine_04', 'head', 'hand_l', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'toe_l', 'thigh_r', 'calf_r', 'foot_r', 'toe_r'];
/**
 * (Round 15) By unit: the QB, the offensive line, the defensive line, the linebackers, the defensive backs, the
 * receivers and tight ends, the backs (render/game/choreo.ts slots).
 */
const groupOf = (slot: string): string =>
  slot === 'QB'
    ? 'qb'
    : /^(LT|LG|C|RG|RT|OL)$/.test(slot)
      ? 'ol'
      : /^(LE|RE|LDT|RDT|D[ET]\d?|NT|DL)$/.test(slot)
        ? 'dl'
        : /LB/.test(slot)
          ? 'lb'
          : /^(LCB|RCB|CB\d?|S|FS|SS|DB\d?|NB|NCB)$/.test(slot)
            ? 'db'
            : /^(WR\d?|X|Y|Z|TE\d?|SLOT|H)$/.test(slot)
              ? 'wr'
              : /^(RB|FB|HB|TB)$/.test(slot)
                ? 'rb'
                : `other:${slot}`;
const newSlide = (): SlideStats => ({ spans: 0, over5mm: 0, over2cm: 0, max: 0, sum: 0, jumps: 0, jumps5: 0, steps: 0, lifts: 0, maxStep: 0, worst: null, jumpWhy: {}, driftWhy: {}, stepWhy: {}, modes: {} });
const REACH_MISS = 0.01;
const bump = (r: Record<string, number>, k: string) => void (r[k] = (r[k] ?? 0) + 1);
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
  /** The largest IK miss over the span (m) and what was playing then. */
  miss: number;
  missAt: string;
  /** The lock's source (stand, loco, trans). */
  src: string;
  trace: (number | string)[][];
}
const span = new Map<Body, Record<'l' | 'r', Span | null>>();
const _toe = new THREE.Vector3();
const _lr0 = new THREE.Vector3();
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
  if (cur.drift > 0.02) {
    g.over2cm++;
    const why = cur.miss > REACH_MISS ? `reach:${cur.src}:${cur.missAt}` : `other:${cur.src}:${cur.from}`;
    bump(g.driftWhy, why);
    const w: WorstSpan = { slot: b.slot, foot: f, drift: Math.round(cur.drift * 1000) / 1000, frames: cur.n, from: cur.from, clip, frame, miss: Math.round(cur.miss * 1000) / 1000, why, trace: cur.trace };
    pops.worstSpans.push(w);
    pops.worstSpans.sort((x, y) => y.drift - x.drift);
    if (pops.worstSpans.length > 12) pops.worstSpans.length = 12;
  }
  if (cur.drift > g.max) {
    g.max = cur.drift;
    g.worst = { slot: b.slot, foot: f, drift: Math.round(cur.drift * 1000) / 1000, frames: cur.n, from: cur.from, clip, frame };
  }
}

const last = new Map<Body, THREE.Quaternion[]>();
const lastYaw = new Map<Body, number>();
export const pops = { frames: 0, spikes: [] as PopSpike[], worst: 0, rates: [] as number[], slide: {} as Record<string, SlideStats>, worstSpans: [] as WorstSpan[], stepSpans: [] as WorstSpan[], trace: [] as (number | string)[][], cost: { n: 0, ms: 0 }, pose: [] as (number | string)[][], bySlot: {} as Record<string, Record<string, number>> };
if (typeof window !== 'undefined') (window as unknown as { __btbPops: typeof pops }).__btbPops = pops;

export function resetPops(): void {
  last.clear();
  lastYaw.clear();
  span.clear();
  lastRoot.clear();
  pops.slide = {};
  pops.worstSpans.length = 0;
  pops.stepSpans.length = 0;
  pops.trace.length = 0;
  pops.cost.n = 0;
  pops.cost.ms = 0;
  pops.pose.length = 0;
  pops.bySlot = {};
  pops.frames = 0;
  pops.spikes.length = 0;
  pops.worst = 0;
  pops.rates.length = 0;
}

/** One body after its update this frame. `lying`: a ragdoll or a lying clip drives him (falls are allowed to be fast). */
export function measure(b: Body, dt: number, frame: number, anim: string, phase: string): void {
  if (dt <= 0) return;
  if (POSEDUMP) {
    const row: (number | string)[] = [frame, b.slot];
    for (const n of DUMP_BONES) {
      const bone = b.player.bones.get(n);
      if (!bone) continue;
      bone.getWorldPosition(_toe);
      row.push(Math.round(_toe.x * 1e5) / 1e5, Math.round(_toe.y * 1e5) / 1e5, Math.round(_toe.z * 1e5) / 1e5);
    }
    pops.pose.push(row);
  }
  const prev = last.get(b);
  const now = BONES.map((n) => b.player.bones.get(n)?.quaternion.clone() ?? new THREE.Quaternion());
  const tr = b.animator.transition;
  const ctx = { clip: tr && !tr.done ? tr.name : '', overlay: b.animator.overlayAction?.name ?? '', anim, phase };
  // (Round 15: nor across a turning clip's hand-over, where the root takes the clip's turn: animator.ts turned.)
  if (prev && !b.ragdoll.active && !b.animator.turned) {
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
  if (py !== undefined && !b.lie && !b.ragdoll.active && !b.animator.turned) {
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
  const lr0 = lr ? _lr0.copy(lr) : null;
  if (lr && Math.hypot(rp.x - lr.x, rp.z - lr.z) > TELEPORT) sp.l = sp.r = null;
  if (lr) lr.copy(rp);
  else lastRoot.set(b, rp.clone());
  const what = ctx.clip || ctx.overlay || ctx.anim;
  // (Round 16) What his legs play while the sim moves him (the drawn root's speed this frame).
  if (lr0 && !b.ragdoll.active && !b.lie && Math.hypot(rp.x - lr0.x, rp.z - lr0.z) / dt > 0.5 && Math.hypot(rp.x - lr0.x, rp.z - lr0.z) < TELEPORT) {
    const gd = b.animator.gaitDbg();
    const mode = ctx.clip ? 'trans' : gd.loco < 0.5 ? 'stand' : Math.abs(gd.side) > 0.5 ? 'side' : gd.back > 0.5 ? 'back' : 'fwd';
    bump((pops.slide[groupOf(b.slot)] ??= newSlide()).modes, mode);
    bump((pops.bySlot[b.slot] ??= {}), `${mode}${mode === 'side' ? (gd.side > 0 ? 'L' : 'R') : ''}@${Math.floor(frame / 60)}`);
  }
  // (Round 15) ?trace=SLOT: that player's feet every frame (the lock, the clip's foot, the drawn foot, the step).
  if (TRACE && b.slot === TRACE) {
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const gd = b.animator.gaitDbg();
    const row: (number | string)[] = [frame, r3(rp.x), r3(rp.z), Math.round((b.player.root.rotation.y * 180) / Math.PI), r3(gd.speed), r3(gd.loco), r3(gd.back), r3(gd.phase), what];
    for (const f of ['l', 'r'] as const) {
      const lk = b.animator.footLockOf(f);
      const d = b.animator.lockDbg[f];
      b.player.bones.get(`toe_${f}`)!.getWorldPosition(_toe);
      row.push(lk.locked ? (lk.source ?? '?') : d.stepped ? 'STEP' : '-', r3(lk.weight), r3(lk.pos.x), r3(lk.pos.z), r3(d.cb.x), r3(d.cb.z), r3(_toe.x), r3(_toe.y), r3(_toe.z), d.why);
    }
    pops.trace.push(row);
  }
  for (const f of ['l', 'r'] as const) {
    const lk = b.animator.footLockOf(f);
    if (b.animator.lockDbg[f].stepped) {
      const g = (pops.slide[groupOf(b.slot)] ??= newSlide());
      // (An early lift into the clip's own swing isn't a step.)
      if (!b.animator.lockDbg[f].why.endsWith(':lift')) g.steps++;
      else g.lifts++;
      bump(g.stepWhy, `${b.animator.lockDbg[f].why}:${what}`);
    }
    const toe = b.player.bones.get(`toe_${f}`);
    const down = !b.ragdoll.active && !b.lie && lk.locked && lk.weight >= LOCK_FULL && !!toe;
    let cur = sp[f];
    if (!down) {
      // (Round 15) A span that ended in a step: its trace, for the step's cause (the first 24 of the play).
      if (cur && b.animator.lockDbg[f].stepped && pops.stepSpans.length < 24 && cur.n >= 3 && /^(wr|db|lb|rb)$/.test(groupOf(b.slot)))
        pops.stepSpans.push({ slot: b.slot, foot: f, drift: Math.round(cur.drift * 1000) / 1000, frames: cur.n, from: cur.from, clip: what, frame, miss: Math.round(cur.miss * 1000) / 1000, why: b.animator.lockDbg[f].why, trace: cur.trace });
      if (cur) closeSpan(b, f, cur, what, frame);
      sp[f] = null;
      continue;
    }
    toe!.getWorldPosition(_toe);
    const dbg = b.animator.lockDbg[f];
    if (cur) {
      const step = Math.hypot(_toe.x - cur.lx, _toe.z - cur.lz);
      const g = (pops.slide[groupOf(b.slot)] ??= newSlide());
      if (step > JUMP) {
        g.jumps++;
        if (step > JUMP5) g.jumps5++;
        bump(g.jumpWhy, dbg.replant ? `replant:${dbg.replant}` : dbg.miss > REACH_MISS ? 'reach' : 'other');
      }
      g.maxStep = Math.max(g.maxStep, step);
      if (Math.hypot(lk.pos.x - cur.px, lk.pos.z - cur.pz) > JUMP) {
        // Re-planted (the lock's point jumped): a new span. (A point that gives a little at a time, animator.ts
        // lockFoot, is the same plant sliding: its drift counts.)
        closeSpan(b, f, cur, what, frame);
        cur = null;
      }
    }
    if (!cur) sp[f] = cur = { x: _toe.x, z: _toe.z, px: lk.pos.x, pz: lk.pos.z, lx: _toe.x, lz: _toe.z, drift: 0, n: 0, from: what, miss: 0, missAt: '', src: lk.source ?? '', trace: [] };
    if (dbg.miss > cur.miss) {
      cur.miss = dbg.miss;
      cur.missAt = what;
    }
    cur.drift = Math.max(cur.drift, Math.hypot(_toe.x - cur.x, _toe.z - cur.z));
    const gd = b.animator.gaitDbg();
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    cur.trace.push([frame, r3(gd.speed), r3(gd.loco), r3(gd.back), r3(gd.back > 0.5 ? gd.backPhase : gd.phase), Math.round(dbg.miss * 1000) / 10, r3(rp.x), r3(rp.z), Math.round((b.player.root.rotation.y * 180) / Math.PI), r3(lk.pos.x), r3(lk.pos.z), r3(_toe.x), r3(_toe.z), what]);
    cur.px = lk.pos.x;
    cur.pz = lk.pos.z;
    cur.lx = _toe.x;
    cur.lz = _toe.z;
    cur.n++;
  }
}
