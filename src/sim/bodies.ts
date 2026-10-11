// Bodies (docs/physics/TACKLING.md, M6.5 #12): how much room a player takes
// up on the field, fitted to the drawn model, and the bodies on the ground.
//
// Standing, a player is an ellipse at the pads: his pad half-width across
// and his chest's half-depth along his facing. docs/m65/BODIES.md measured
// the shipped player model per body type (tools/blender/measure_bodies.py:
// the mesh posed with the keyed clips and shaped as the runtime shapes it)
// and fitted both to height and weight per position, within 0.7 cm. The sim
// had one circle of 0.36 + (weight − 200) × 0.0008 yd for everyone: ~5 cm a
// side generous across the pads for the skill players, 4 cm tight for an
// end, and twice the chest's depth front to back.
//
// On the ground, a player is a capsule along his body: hips to the top of
// his head one way, hips to his heels the other (DOWN_TORSO, DOWN_LEGS), so
// a man running at him has to go round, step over or hurdle him.

import type { Agent, SimPlayer } from './types';
import { has } from './traits';

const YD_PER_M = 1 / 0.9144;

/**
 * Fits per position: extent (m) = a + b·(lb − 200) + c·(in − 74), the pad
 * half-width (hw: the widest point across the pad caps and sleeves) and the
 * chest's half-depth (hd), from the measure_bodies.py sweep (5 heights × 7
 * weights over each position's roster range). The render's contact layer
 * (src/render/game/contact.ts) draws its trunks from the same table.
 */
export const BODY_FIT: Record<'WR' | 'CB' | 'S' | 'RB' | 'QB' | 'LB' | 'TE' | 'DL' | 'OL', { hw: [number, number, number]; hd: [number, number, number] }> = {
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

export type FitPos = keyof typeof BODY_FIT;
/** The fit a rated position uses (ends and tackles wear the same lineman's pads). */
export const fitPos = (pos: SimPlayer['pos']): FitPos => (pos === 'DE' || pos === 'DT' ? 'DL' : pos);

/** Pad half-width and chest half-depth (m) for this position, height (m) and weight (kg). */
export function bodyExtentM(pos: FitPos, heightM: number, weightKg: number): { hw: number; hd: number } {
  const f = BODY_FIT[pos];
  const w = weightKg / 0.45359237 - 200;
  const h = heightM / 0.0254 - 74;
  return { hw: f.hw[0] + f.hw[1] * w + f.hw[2] * h, hd: f.hd[0] + f.hd[1] * w + f.hd[2] * h };
}

/**
 * The sim's body: half-width across the pads (`radius`) and half-depth along
 * his facing (`depth`), in yards, from the listed height and weight (the
 * body the render draws, not the era-equivalent weight the collision's mass
 * uses).
 */
export function bodyOf(p: SimPlayer): { radius: number; depth: number } {
  // Linemen and the quarterback work with their hands out in front of them
  // (a pass set's punch, the rusher's hands, the QB's ball at the numbers):
  // their working room is their arms', round, and the line's engagements
  // (blocks.ts spacing, the pass-set and rush reaches) are built on it. They
  // keep the sim's circle, which BODIES.md measured "about right across the
  // pads for the big men" (OL −1.4 cm, DT −0.4, DE +4.3 a side). Fitted
  // to their pads instead, the best and worst pass-blocking units held up
  // within 0.2–0.35 s of each other (0.6 s now: tests/sim.test.ts), and
  // with the chest's depth rushers slid past the sets (pressure 25% → 29%).
  if (p.pos === 'OL' || p.pos === 'DE' || p.pos === 'DT' || p.pos === 'QB') {
    const r = 0.36 + ((p.weightEq ?? p.weightLb) - 200) * 0.0008;
    return { radius: r, depth: r };
  }
  const e = bodyExtentM(fitPos(p.pos), p.heightIn * 0.0254, p.weightLb * 0.45359237);
  return { radius: e.hw * YD_PER_M, depth: e.hd * YD_PER_M };
}

/**
 * How far his body reaches from its centre in the unit direction (ux, uy):
 * the ellipse's support, his facing given as (cf, sf) = (cos, sin).
 */
export function reachDir(a: Agent, cf: number, sf: number, ux: number, uy: number): number {
  const along = ux * cf + uy * sf;
  const across = -ux * sf + uy * cf;
  return Math.sqrt(a.fx.depth * a.fx.depth * along * along + a.fx.radius * a.fx.radius * across * across);
}

// ---- Bodies on the ground ---------------------------------------------------------

/**
 * A man on the ground, from his hips: his trunk and head one way (DOWN_TORSO
 * along `dir`), his legs the other (DOWN_LEGS). Anthropometric shares of
 * stature (Drillis & Contini 1966): hip to the top of the head ~0.48,
 * hip to heel ~0.53 of a man's height, so ~0.95 yd and ~1.05 yd for a 6'0" player.
 */
export const DOWN_TORSO = 0.48;
export const DOWN_LEGS = 0.53;
/** A lying body's half-thickness as an obstacle (yd): the pads lying flat stand ~0.3 m off the turf; legs less. */
export const DOWN_R = 0.22;

export interface Lying {
  /** Hips (yd). */
  x: number;
  y: number;
  /** Unit vector hips → head. */
  dx: number;
  dy: number;
  /** Torso and legs lengths (yd). */
  torso: number;
  legs: number;
}

/** Lay him down at his spot, his head along (dx, dy) (the way he fell). */
export function layDown(a: Agent, dx: number, dy: number): Lying {
  const l = Math.sqrt(dx * dx + dy * dy);
  const ux = l > 1e-6 ? dx / l : 1;
  const uy = l > 1e-6 ? dy / l : 0;
  const h = a.fx.height;
  return { x: a.pos.x, y: a.pos.y, dx: ux, dy: uy, torso: DOWN_TORSO * h, legs: DOWN_LEGS * h };
}

/**
 * The closest point of a lying body to p: along his length from heels
 * (−legs) to head (+torso). Returns the distance and where along him (yd
 * from the hips, + toward the head).
 */
export function lyingGap(b: Lying, px: number, py: number): { d: number; along: number } {
  const rx = px - b.x;
  const ry = py - b.y;
  const t = Math.max(-b.legs, Math.min(b.torso, rx * b.dx + ry * b.dy));
  const ex = rx - b.dx * t;
  const ey = ry - b.dy * t;
  return { d: Math.sqrt(ex * ex + ey * ey), along: t };
}

/**
 * Where a straight run from p along unit (hx, hy) first crosses a lying
 * body (within DOWN_R plus his own half-width), as distance along the run;
 * null if it doesn't within `range`. Sampled every 0.1 yd: lying bodies are
 * few, and this is read only by the carrier's lane choice and his feet.
 */
export function runMeets(b: Lying, px: number, py: number, hx: number, hy: number, halfW: number, range: number): number | null {
  for (let s = 0; s <= range; s += 0.1) {
    if (lyingGap(b, px + hx * s, py + hy * s).d < DOWN_R + halfW) return s;
  }
  return null;
}

/**
 * The box-out (passing round 8, docs/passing/PASSING8.md): how well a
 * receiver walls a defender off the ball with his body (0..1). "Post up":
 * the near hip and shoulder into the man, the near arm a bar on his chest,
 * then up for the ball. His share of their mass (2·m/(m + m_d) − 1: about
 * +0.14 for Gronkowski, 265 lb, on Ronnie Lott, 199), his Strength over the
 * other's, his height over the other's (yd), and Big Body (the trait
 * catalog: "boxes out defenders"). Ours, sized so a big, strong tight end
 * on a safety (Gronkowski ~0.7, Tony Gonzalez ~0.55) and Kelvin Benjamin on
 * a corner (~0.7) box out, Terrell Owens a little (~0.2), and a 185-lb
 * slot receiver not at all. The contest (passing.ts resolveCatch), the
 * bodies' push (contact.ts separate) and the boxed man's first tackle after
 * the catch (contact.ts tackleOdds) use it.
 */
export function boxOut(r: Agent, d: Agent): number {
  const mass = (2 * r.fx.mass) / (r.fx.mass + d.fx.mass) - 1;
  const str = r.fx.a('strength') - d.fx.a('strength');
  const tall = r.fx.height - d.fx.height;
  const k = BOX_MASS_K * mass + BOX_STR_K * str + BOX_TALL_K * tall + (has(r, 'big-body') ? BOX_BIG : 0);
  return Math.max(0, Math.min(1, k));
}
/** The box-out's weights: per unit of mass share, of Strength (0..1) over his, and per yd of height over his; Big Body's own. Ours (see boxOut). */
const BOX_MASS_K = 2.5;
const BOX_STR_K = 1.5;
const BOX_TALL_K = 0.6;
const BOX_BIG = 0.3;
