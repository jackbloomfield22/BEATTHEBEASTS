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

/** Flight of a ball struck at `v` yd/s along elevation `elev` and lateral angle `aim` from height `z0`, until it lands or passes `stopX`. */
function fly(v: number, aim: number, wind: { mph: number; dir: number }, slice: number, stopX: number, path?: [number, number, number][], elev = ELEV, z0 = 0, side?: { y0: number; half: number }) {
  let x = 0;
  let y = 0;
  let z = z0;
  let vx = v * cos(elev) * cos(aim);
  let vy = v * cos(elev) * sin(aim);
  let vz = v * sin(elev);
  // Wind: dir 0 blows toward the posts (+x), π/2 toward +y (the kicker's left).
  const wx = WIND_ACCEL * wind.mph * cos(wind.dir);
  const wy = WIND_ACCEL * wind.mph * sin(wind.dir);
  let t = 0;
  let crossed: { y: number; z: number } | null = null;
  /** Where it first crossed a sideline (a punt), in the kick frame. */
  let out: { x: number; y: number; t: number } | null = null;
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
    if (path && k++ % 4 === 0) path.push([x, y, Math.max(0, z)]);
    if (!crossed && px < stopX && x >= stopX) {
      const f = (stopX - px) / (x - px);
      crossed = { y: py + (y - py) * f, z: pz + (z - pz) * f };
    }
    if (side && !out && Math.abs(side.y0 + y) > side.half) {
      const edge = Math.sign(side.y0 + y) * side.half - side.y0;
      const f = (edge - py) / (y - py || 1e-9);
      out = { x: px + (x - px) * f, y: edge, t: t - DT + DT * f };
    }
    if (z <= 0 && vz < 0) {
      // Back to the ground: the landing spot, interpolated to z = 0.
      const f = pz / Math.max(1e-9, pz - z);
      x = px + (x - px) * f;
      y = py + (y - py) * f;
      t = t - DT + DT * f;
      if (path) path.push([x, y, 0]);
      break;
    }
    if (x > stopX + 15) break;
  }
  return { crossed, t, x, y, out };
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

/** The least power that clears the bar straight down the middle (the meter's "enough leg" mark); above 1 when he can't get there clean. */
export function powerNeeded(k: Omit<KickInput, 'aim' | 'power'>): number {
  const at = (power: number) => kickFlight({ ...k, power, aim: aimFor({ ...k, power }) });
  let lo = 0.3;
  let hi = 1.12;
  if (at(hi).why === 'short') return hi;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid).why === 'short') lo = mid;
    else hi = mid;
  }
  return hi;
}

// ---- Punts ------------------------------------------------------------------------------

/**
 * A punt leaves the foot steep, from about knee height (contact ~0.4 m,
 * ks_punt frame 42). 60° is set by the hang: with the sim's spiral drag a
 * full 52-yard punt hangs 4.2 s, the NFL's average hang (~4.3 s); a flatter
 * launch carried as far but came down in 3.5 s, a line drive.
 */
const PUNT_ELEV = (60 * Math.PI) / 180;
const PUNT_Z0 = 0.45;
/**
 * The Contenders punter's leg: a full, clean strike carries 52 yd in the air
 * in still air. NFL gross average 2015–2023 ≈ 46–47 yd with ~4.4 s of hang;
 * a good punter's best ~55–60 (the overcooked strike, past 1, gets there
 * with a slice).
 */
export const PUNT_CARRY = 52;
/**
 * Where the punter meets the ball, behind the line of scrimmage: he lines up
 * 15 yd deep (NFL spread punt: 14–15) and his two steps (ks_punt's root
 * travel, 1.35 m to contact) bring him to 13.5.
 */
export const PUNT_DEPTH = 13.5;

let puntV = 0;
/** Launch speed at full power so a straight punt in still air carries PUNT_CARRY yards (bisection; cached). */
export function puntLeg(): number {
  if (puntV) return puntV;
  let lo = 10;
  let hi = 60;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const f = fly(mid, 0, { mph: 0, dir: 0 }, 0, 1000, undefined, PUNT_ELEV, PUNT_Z0);
    if (f.x >= PUNT_CARRY) hi = mid;
    else lo = mid;
  }
  puntV = hi;
  return hi;
}

export interface PuntInput {
  /** 0..1 of the punter's leg; past 1 overcooks it (a little more carry, and a slice). */
  power: number;
  /** Aim, radians, + = left (toward the left sideline, looking downfield). */
  aim: number;
  wind: { mph: number; dir: number };
  /** The ball's lateral spot on the field (+ = left of the middle), yd; the sidelines are ±halfWidth from the middle. */
  y0: number;
  halfWidth: number;
}

export interface PuntFlight {
  /** Carry in the air from the punter, yd (to the landing, or to where it crossed a sideline). */
  carry: number;
  /** Lateral landing (or crossing) offset in the kick frame, yd. */
  y: number;
  /** Seconds in the air (to the landing, or to the sideline). */
  hang: number;
  /** It went out of bounds in the air. */
  out: boolean;
  /** The flight, sampled every 1/30 s: [x, y, z] in the kick frame. */
  path: [number, number, number][];
}

export function puntFlight(k: PuntInput): PuntFlight {
  const over = Math.max(0, k.power - 1);
  const p = Math.min(k.power, 1.08);
  const path: [number, number, number][] = [[0, 0, PUNT_Z0]];
  const f = fly(puntLeg() * p, k.aim, k.wind, -over * 9, 1000, path, PUNT_ELEV, PUNT_Z0, { y0: k.y0, half: k.halfWidth });
  // Out of bounds in the air: the spot is where it crossed (the drawn flight carries on out of the picture).
  if (f.out) return { carry: f.out.x, y: f.out.y, hang: f.out.t, out: true, path };
  return { carry: f.x, y: f.y, hang: f.t, out: false, path };
}
