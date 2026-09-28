// Bodies in contact, render side (M6.5 #12). The sim keeps players apart as
// circles (sim/contact.ts separate()); the drawn bodies are broader across
// the pads than they are deep, lean into turns and bursts (anim/animator.ts)
// and reach with their arms, so two men the sim holds a yard apart can still
// be drawn through each other, and two it holds together can be drawn with
// air between them at a contested catch. This works on what is drawn:
//   - every pair of standing bodies whose trunks (ellipses at the pads,
//     from the chest bone's position and the drawn facing) overlap is
//     pushed apart by a small render-only offset, never the sim position;
//   - a contested pair (a defender within CONTEST_R of the receiver at the
//     catch, choreo.ts) leans into each other so the shoulders meet: a
//     shoulder into him, pads on pads, instead of air or overlap.
// Pure functions (tested in tests/contact.test.ts) and a smoother that eases
// the offsets and leans so nothing pops. The sim is only read.

import type { Position } from '../players/variety';

/** Trunk extent at the pads: half-width across the shoulders and half-depth, metres. */
export interface BodyExtent {
  hw: number;
  hd: number;
}

/**
 * Least-squares fits over each position's roster range of height and weight
 * (tools/blender/measure_bodies.py sweep: the shipped mesh at the idle pose,
 * shaped as bodyShape.ts and variety.ts shape it; max error ≤ 0.7 cm):
 * extent = a + b (lb − 200) + c (in − 74). The pad half-width is the widest
 * point across the pad caps and sleeves; the half-depth is the jersey's
 * front-to-back half at the chest.
 */
const FIT: Record<Exclude<Position, 'K'>, { hw: [number, number, number]; hd: [number, number, number] }> = {
  WR: { hw: [0.2895, 0.000157, 0.00305], hd: [0.1646, 0.000346, 0.00018] },
  CB: { hw: [0.288, 0.000185, 0.00289], hd: [0.1608, 0.000337, 0.00035] },
  S: { hw: [0.2876, 0.000213, 0.00271], hd: [0.16, 0.000397, -0.00005] },
  RB: { hw: [0.3348, 0.000185, 0.00355], hd: [0.1651, 0.00045, -0.00042] },
  QB: { hw: [0.3131, 0.000181, 0.0032], hd: [0.1624, 0.000354, 0.00012] },
  LB: { hw: [0.3497, 0.000202, 0.00348], hd: [0.1648, 0.000509, -0.00088] },
  TE: { hw: [0.3507, 0.000166, 0.00384], hd: [0.1698, 0.000433, -0.00022] },
  DL: { hw: [0.379, 0.000139, 0.00437], hd: [0.1743, 0.00046, -0.00045] },
  OL: { hw: [0.3811, 0.000102, 0.00457], hd: [0.1771, 0.000396, 0.00024] },
};

const LB_PER_KG = 1 / 0.45359237;
const IN_PER_M = 1 / 0.0254;

/** The drawn trunk's extent for a body of this position, height and weight. */
export function bodyExtent(pos: Position, heightM: number, weightKg: number): BodyExtent {
  const f = FIT[pos === 'K' ? 'QB' : pos];
  const w = weightKg * LB_PER_KG - 200;
  const h = heightM * IN_PER_M - 74;
  return { hw: f.hw[0] + f.hw[1] * w + f.hw[2] * h, hd: f.hd[0] + f.hd[1] * w + f.hd[2] * h };
}

/** A trunk on the ground plane: its centre (m) and the unit vector it faces. */
export interface Trunk {
  x: number;
  z: number;
  fx: number;
  fz: number;
}

/** How far an ellipse (hw across, hd along its facing) reaches in the unit direction (ux, uz). */
export function reach(e: BodyExtent, t: Trunk, ux: number, uz: number): number {
  const along = ux * t.fx + uz * t.fz;
  const across = ux * t.fz - uz * t.fx;
  return Math.hypot(e.hw * across, e.hd * along);
}

/** Air between two trunks along the line joining their centres (m; negative: overlapping). */
export function trunkGap(a: Trunk, ea: BodyExtent, b: Trunk, eb: BodyExtent): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return -(ea.hw + eb.hw);
  const ux = dx / d;
  const uz = dz / d;
  return d - reach(ea, a, ux, uz) - reach(eb, b, -ux, -uz);
}

/** Most a body is pushed off its sim spot (m): a drawn correction, not a new position. */
export const PUSH_MAX = 0.2;
/** Most a contested pair leans into each other (rad, ~10°). */
export const LEAN_MAX = 0.18;
/** Pads compress a little when they meet (m): the lean aims for this much overlap. */
export const PRESS = 0.03;
/** Height of the pads above the ground (m, base body; ×scale): the lean pivots at the feet. */
export const PAD_HEIGHT = 1.45;
/** The lean reaches for a shoulder this far away at most (m): farther, it's not contact. */
export const LEAN_REACH = 0.35;

export interface ContactBody extends Trunk {
  ext: BodyExtent;
  /** Body scale (height / 1.88 m). */
  scale: number;
  /** Standing and free: not lying, falling or in a clip that owns his body (a tackle). */
  free: boolean;
}

export interface ContactTarget {
  /** Render offset (m, world x and z). */
  ox: number;
  oz: number;
  /** Lean toward the other body: world horizontal direction times angle (rad). */
  lx: number;
  lz: number;
}

/**
 * Where each body should be drawn this frame, relative to its sim spot: the
 * push-apart for overlapping trunks and the lean for contested pairs
 * (index pairs into `bodies`). `out` is filled (one per body).
 */
export function contactTargets(bodies: readonly ContactBody[], contested: readonly (readonly [number, number])[], out: ContactTarget[]): void {
  for (let i = 0; i < bodies.length; i++) {
    const o = out[i] ?? (out[i] = { ox: 0, oz: 0, lx: 0, lz: 0 });
    o.ox = o.oz = o.lx = o.lz = 0;
  }
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]!;
    if (!a.free) continue;
    for (let j = i + 1; j < bodies.length; j++) {
      const b = bodies[j]!;
      if (!b.free) continue;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      // Far apart: skip without the ellipse maths.
      if (Math.abs(dx) > a.ext.hw + b.ext.hw || Math.abs(dz) > a.ext.hw + b.ext.hw) continue;
      const gap = trunkGap(a, a.ext, b, b.ext);
      if (gap >= 0) continue;
      const d = Math.hypot(dx, dz);
      const ux = d > 1e-6 ? dx / d : 1;
      const uz = d > 1e-6 ? dz / d : 0;
      const push = -gap / 2;
      out[i]!.ox -= ux * push;
      out[i]!.oz -= uz * push;
      out[j]!.ox += ux * push;
      out[j]!.oz += uz * push;
    }
  }
  for (const [i, j] of contested) {
    const a = bodies[i];
    const b = bodies[j];
    if (!a || !b || !a.free || !b.free) continue;
    const gap = trunkGap(a, a.ext, b, b.ext);
    if (gap < 0 || gap > LEAN_REACH) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) continue;
    const ux = dx / d;
    const uz = dz / d;
    // Each closes half the gap (and the press) at his pads, pivoting at the feet.
    for (const [k, s, body] of [[i, 1, a], [j, -1, b]] as const) {
      const ang = Math.min(LEAN_MAX, Math.atan2(gap / 2 + PRESS, PAD_HEIGHT * body.scale));
      out[k]!.lx += ux * s * ang;
      out[k]!.lz += uz * s * ang;
    }
  }
  for (const o of out) {
    const m = Math.hypot(o.ox, o.oz);
    if (m > PUSH_MAX) {
      o.ox *= PUSH_MAX / m;
      o.oz *= PUSH_MAX / m;
    }
    const l = Math.hypot(o.lx, o.lz);
    if (l > LEAN_MAX) {
      o.lx *= LEAN_MAX / l;
      o.lz *= LEAN_MAX / l;
    }
  }
}

/** Offsets and leans eased toward their targets: in over ~0.1 s, out over ~0.25 s. */
export class ContactSmoother {
  readonly cur: ContactTarget[] = [];
  private readonly targets: ContactTarget[] = [];

  update(bodies: readonly ContactBody[], contested: readonly (readonly [number, number])[], dt: number): readonly ContactTarget[] {
    contactTargets(bodies, contested, this.targets);
    for (let i = 0; i < bodies.length; i++) {
      const t = this.targets[i]!;
      const c = this.cur[i] ?? (this.cur[i] = { ox: 0, oz: 0, lx: 0, lz: 0 });
      // Coming in (the target is further from rest than we are) is quicker than letting go.
      const growing = Math.hypot(t.ox, t.oz) + Math.hypot(t.lx, t.lz) > Math.hypot(c.ox, c.oz) + Math.hypot(c.lx, c.lz);
      const k = 1 - Math.exp(-dt / (growing ? 0.1 : 0.25));
      c.ox += (t.ox - c.ox) * k;
      c.oz += (t.oz - c.oz) * k;
      c.lx += (t.lx - c.lx) * k;
      c.lz += (t.lz - c.lz) * k;
    }
    this.cur.length = bodies.length;
    return this.cur;
  }

  reset(): void {
    for (const c of this.cur) c.ox = c.oz = c.lx = c.lz = 0;
  }
}
