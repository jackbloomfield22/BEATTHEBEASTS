// The ball in flight (TECH_PLAN §10 "Ball"): an analytic 3D projectile with
// quadratic drag, integrated at 60 Hz. Throws are solved for a catch point
// and a launch speed; drag is corrected by shooting. Outcome-bearing ball
// physics never touch the render's physics engine.

import { TICK } from './types';

/** Gravity, yd/s² (9.81 m/s²). */
export const G = 9.81 / 0.9144;
/**
 * Drag, per yard: a = K·|v|·v. A spiralling ball (0.42 kg, 17 cm across,
 * Cd ≈ 0.1 nose-on; Rae 2004, "Flight dynamics of an American football")
 * gives ½ρCdA/m ≈ 0.0029 /m, 0.0027 per yard in yard units.
 */
export const K_DRAG = 0.0027;

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** One tick of flight (semi-implicit Euler: velocity then position). */
export function stepFlight(p: V3, v: V3, dt = TICK): void {
  const s = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  v.x -= K_DRAG * s * v.x * dt;
  v.y -= K_DRAG * s * v.y * dt;
  v.z -= (G + K_DRAG * s * v.z) * dt;
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;
}

/** Where a launch from `p0` with `v0` is after `T` seconds (same integrator). */
export function flyFor(p0: V3, v0: V3, T: number): V3 {
  const p = { ...p0 };
  const v = { ...v0 };
  const n = Math.round(T / TICK);
  for (let i = 0; i < n; i++) stepFlight(p, v);
  return p;
}

/** Vacuum launch velocity reaching `to` from `from` in `T` seconds. */
function vacuum(from: V3, to: V3, T: number): V3 {
  return { x: (to.x - from.x) / T, y: (to.y - from.y) / T, z: (to.z - from.z) / T + 0.5 * G * T };
}

const speed = (v: V3) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

/**
 * Flight time for a throw from `from` to `to` at launch speed `S`
 * (vacuum). Two solutions when in range: the flat one (bullet) and the high
 * one (lob); `arc` 0..1 picks between them. Out of range, the max-range time.
 */
export function flightTime(from: V3, to: V3, S: number, arc: number): { T: number; inRange: boolean } {
  const f = (T: number) => speed(vacuum(from, to, T));
  // |v0(T)| falls then rises; find its minimum by golden-section search.
  let lo = 0.05;
  let hi = 6;
  for (let i = 0; i < 60; i++) {
    const m1 = lo + (hi - lo) * 0.382;
    const m2 = lo + (hi - lo) * 0.618;
    if (f(m1) < f(m2)) hi = m2;
    else lo = m1;
  }
  const tMin = (lo + hi) / 2;
  if (f(tMin) >= S) return { T: tMin, inRange: false };
  const root = (a: number, b: number) => {
    // f(a) - S and f(b) - S have opposite signs.
    let x0 = a;
    let x1 = b;
    const sa = f(a) > S;
    for (let i = 0; i < 50; i++) {
      const m = (x0 + x1) / 2;
      if (f(m) > S === sa) x0 = m;
      else x1 = m;
    }
    return (x0 + x1) / 2;
  };
  const t1 = root(0.05, tMin);
  const t2 = root(tMin, 6);
  return { T: t1 + (t2 - t1) * arc, inRange: true };
}

/**
 * Launch velocity that lands the ball at `to` after `T` seconds with drag:
 * start from the vacuum solution and correct the miss three times.
 */
export function solveLaunch(from: V3, to: V3, T: number): V3 {
  let v = vacuum(from, to, T);
  for (let k = 0; k < 4; k++) {
    const hit = flyFor(from, v, T);
    v = { x: v.x + (to.x - hit.x) / T, y: v.y + (to.y - hit.y) / T, z: v.z + (to.z - hit.z) / T };
  }
  return v;
}

export { speed as speed3 };
