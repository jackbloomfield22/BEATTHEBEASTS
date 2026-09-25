// Field goals and PATs (GDD §9.6): the ball's flight from the kicker's
// strike to the posts, pure and deterministic (detmath, fixed step) so a
// kick replays exactly. Units are the sim's: yards, seconds; x toward the
// posts from the spot of the kick, y to the kicker's left, z up.
//
// The strike sets the launch speed (power 0..1 of the kicker's leg) and the
// aim (a lateral angle); a slice from an overcooked strike (power past 1)
// curls it away. Wind pushes the ball along its direction. Drag and gravity
// are the sim's ball constants (src/sim/ball.ts).

import { cos, sin, sqrt } from '@/engine/math/detmath';
import { G, K_DRAG } from '@/sim/ball';

/** NFL goalposts: crossbar 10 ft up, uprights 18 ft 6 in apart (so 3.083 yd either side of center). */
export const CROSSBAR = 10 / 3;
export const UPRIGHT = 18.5 / 3 / 2;
/** Launch elevation of a field-goal kick (≈ 38°: kicks leave the tee at 35–40°). */
const ELEV = (38 * Math.PI) / 180;
/**
 * Wind's push, yd/s² per mph of wind: a 12 mph crosswind drifts a 45-yard
 * kick about 2 yd by the posts (it gets there in ~2.3 s: 0.5·a·t² = 2 →
 * a ≈ 0.75), the scale NFL kickers describe for a stiff crosswind.
 */
const WIND_ACCEL = 0.062;
const DT = 1 / 120;

export interface KickInput {
  /** Yards from the spot of the kick to the goal posts (the plane of the crossbar). */
  distance: number;
  /** 0..1 of the kicker's leg; past 1 is an overcooked strike (more distance, and a slice). */
  power: number;
  /** Aim, radians, + = left. */
  aim: number;
  /** Kicker's range: the longest kick that clears the bar with a perfect strike in no wind, yd. */
  range: number;
  wind: { mph: number; dir: number };
}

export interface KickResult {
  good: boolean;
  why: 'good' | 'short' | 'wideLeft' | 'wideRight' | 'doink';
  /** Where it crossed (or fell short of) the goal line plane: lateral offset and height, yd. */
  y: number;
  z: number;
  /** The flight, sampled every 1/30 s: [x, y, z] in the kick frame. */
  path: [number, number, number][];
  hang: number;
}

/** Flight of a ball struck at `v` yd/s along elevation ELEV and lateral angle `aim`, until it lands or passes `stopX`. */
function fly(v: number, aim: number, wind: { mph: number; dir: number }, slice: number, stopX: number, path?: [number, number, number][]) {
  let x = 0;
  let y = 0;
  let z = 0;
  let vx = v * cos(ELEV) * cos(aim);
  let vy = v * cos(ELEV) * sin(aim);
  let vz = v * sin(ELEV);
  // Wind: dir 0 blows toward the posts (+x), π/2 toward +y (the kicker's left).
  const wx = WIND_ACCEL * wind.mph * cos(wind.dir);
  const wy = WIND_ACCEL * wind.mph * sin(wind.dir);
  let t = 0;
  let crossed: { y: number; z: number } | null = null;
  let k = 0;
  while (t < 8) {
    const sp = sqrt(vx * vx + vy * vy + vz * vz);
    vx += (-K_DRAG * sp * vx + wx) * DT;
    vy += (-K_DRAG * sp * vy + wy + slice) * DT;
    vz += (-K_DRAG * sp * vz - G) * DT;
    const px = x;
    const py = y;
    const pz = z;
    x += vx * DT;
    y += vy * DT;
    z += vz * DT;
    t += DT;
    if (path && k++ % 4 === 0) path.push([x, y, z]);
    if (!crossed && px < stopX && x >= stopX) {
      const f = (stopX - px) / (x - px);
      crossed = { y: py + (y - py) * f, z: pz + (z - pz) * f };
    }
    if (z <= 0 && vz < 0) break;
    if (x > stopX + 15) break;
  }
  return { crossed, t, x };
}

/** Launch speed at full power so a straight kick with no wind just clears the bar at `range` (bisection; cached). */
const vmaxCache = new Map<number, number>();
export function legSpeed(range: number): number {
  const c = vmaxCache.get(range);
  if (c !== undefined) return c;
  let lo = 10;
  let hi = 60;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const f = fly(mid, 0, { mph: 0, dir: 0 }, 0, range);
    if (f.crossed && f.crossed.z >= CROSSBAR) hi = mid;
    else lo = mid;
  }
  vmaxCache.set(range, hi);
  return hi;
}

export function kickFlight(k: KickInput): KickResult {
  const over = Math.max(0, k.power - 1);
  const p = Math.min(k.power, 1.08);
  // An overcooked strike slices (to the kicker's right) in proportion to how far past the leg he swung.
  const slice = -over * 9;
  const path: [number, number, number][] = [[0, 0, 0]];
  const f = fly(legSpeed(k.range) * p, k.aim, k.wind, slice, k.distance, path);
  const hang = f.t;
  if (!f.crossed) return { good: false, why: 'short', y: 0, z: 0, path, hang };
  const { y, z } = f.crossed;
  const off = Math.abs(y) - UPRIGHT;
  if (z < CROSSBAR) return { good: false, why: 'short', y, z, path, hang };
  // Within a ball's width of the upright: it hits it (a doink stays out; the ball is ~0.2 yd across).
  if (Math.abs(off) < 0.1) return { good: false, why: 'doink', y, z, path, hang };
  if (off > 0) return { good: false, why: y > 0 ? 'wideLeft' : 'wideRight', y, z, path, hang };
  return { good: true, why: 'good', y, z, path, hang };
}

/** The aim that goes straight through the middle against the wind's push (the ideal line for a hint), rad. */
export function aimFor(k: Omit<KickInput, 'aim'>): number {
  let lo = -0.25;
  let hi = 0.25;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const r = fly(legSpeed(k.range) * Math.min(k.power, 1.08), mid, k.wind, -Math.max(0, k.power - 1) * 9, k.distance);
    const y = r.crossed ? r.crossed.y : 0;
    if (y > 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
