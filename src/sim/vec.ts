// 2D vectors for the sim (yards). Plain objects, mutated in place on hot
// paths. Only + - * / and Math.sqrt (IEEE-exact everywhere) are used here;
// angles go through engine/math/detmath (TECH_PLAN §4.4).

import { atan2, cos, sin } from '@/engine/math/detmath';

export interface V2 {
  x: number;
  y: number;
}

export const v2 = (x = 0, y = 0): V2 => ({ x, y });
export const copy = (a: V2): V2 => ({ x: a.x, y: a.y });
export const set = (o: V2, x: number, y: number): V2 => ((o.x = x), (o.y = y), o);
export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: V2, k: number): V2 => ({ x: a.x * k, y: a.y * k });
export const addScaled = (a: V2, b: V2, k: number): V2 => ({ x: a.x + b.x * k, y: a.y + b.y * k });
export const dot = (a: V2, b: V2): number => a.x * b.x + a.y * b.y;
export const cross = (a: V2, b: V2): number => a.x * b.y - a.y * b.x;
export const len = (a: V2): number => Math.sqrt(a.x * a.x + a.y * a.y);
export const len2 = (a: V2): number => a.x * a.x + a.y * a.y;
export const dist = (a: V2, b: V2): number => Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
export const lerp = (a: V2, b: V2, t: number): V2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function norm(a: V2): V2 {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

/** Clamp a vector's length to at most `max`. */
export function clampLen(a: V2, max: number): V2 {
  const l = len(a);
  return l > max && l > 1e-9 ? { x: (a.x / l) * max, y: (a.y / l) * max } : { x: a.x, y: a.y };
}

/** Heading of a direction, radians (0 = +x, downfield). */
export const heading = (a: V2): number => atan2(a.y, a.x);
export const fromHeading = (h: number, l = 1): V2 => ({ x: cos(h) * l, y: sin(h) * l });

/** Smallest signed difference between two angles, in (-π, π]. */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  const TAU = 6.283185307179586;
  d -= Math.floor(d / TAU) * TAU; // [0, 2π)
  return d > Math.PI ? d - TAU : d;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
