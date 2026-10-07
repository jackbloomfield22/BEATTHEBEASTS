import * as THREE from 'three';
import type { PlayState } from '@/sim';
import { YARD } from '../world/constants';

// The drawn ball's look in the air and on the ground (docs/passing/PASSING.md).
// The sim owns where the ball is and what happens to it; this only draws how
// it flies, render-only and deterministic (a hash of the play's seed, never
// Math.random), so a recording of a play looks the same every time:
// - the spiral: spinning about its long axis at its real rate, by the arm;
// - its attitude: the nose along the flight, a little up of it on the way
//   down (the gyroscope holds the axis while the path bends under it);
// - the wobble: a tight spiral precesses a degree or two; a ball thrown
//   under a rusher or off his back foot wobbles, a hit as he throws is a
//   wounded duck (the sim's throw event says how good the spiral was);
// - out of the hand: the ball leaves from the hand the throw clip draws, and
//   blends onto the sim's flight over its first tenth of a second;
// - off a hand, a helmet or the turf: end over end, never nose-first along
//   its path; on an incompletion it bounces like a football (high off a tip,
//   a skid off its belly) and rolls to rest on its side.

/** A football's semi-axes (m): 11 in long, 22 in round the middle (football.ts). */
const HALF = 0.142;
const RAD = 0.0855;
/**
 * The spiral's spin (rpm): ~600 for an NFL pass (Brancazio, "The physics of
 * football", Phys. Teach. 1985; Rae, "Flight dynamics of an American
 * football in a forward pass", Am. J. Phys. 2003, uses 10 rev/s). A bigger
 * arm spins it a little faster; the spread by arm is ours.
 */
const RPM_BASE = 600;
/**
 * The most the drawn spin turns in one frame (rad). Without motion blur a
 * spiral sampled at ~90°+ a frame strobes (the laces jump, or spin
 * backward), so at a low frame rate the drawn spin is capped just under a
 * frame's sixth of a turn: 600 rpm at 60 fps is 1.05 rad a frame.
 */
const SPIN_STEP_MAX = 1.0;
/** The tight spiral's precession (half-angle, rad, ~1.5°) and its rate (Hz; Rae 2003: the nutation and precession of a passed football run at a few Hz). */
const WOBBLE_TIGHT = 0.026;
const PRECESS_HZ = 2.6;
/** A wounded duck's wobble (rad, ~28°) and its spin (rpm): a ball that got away from him barely spins. */
const WOBBLE_DUCK = 0.49;
const RPM_DUCK = 180;
/** How far the nose rides above the flight path at the end of a long ball (rad, ~5°): the axis lags the path as it bends down. */
const AOA_MAX = 0.09;
/** The ball blends from the throwing hand onto the sim's flight over this long (s). */
const RELEASE_BLEND = 0.1;
/** A tipped or fumbled ball turns end over end at this rate (rad/s, ~2–4 rev/s), and its axis this far off the flip (a skew). */
const TUMBLE_MIN = 13;
const TUMBLE_MAX = 25;
/** Gravity (m/s²) for the dead-ball bounce. */
const GRAV = 9.81;

/** A small integer hash (deterministic per play and event). */
function hash(a: number, b: number, c = 0): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface BallFlight {
  /** The throw being drawn (its release time, s), or -1. */
  throwT: number;
  spin: number;
  rate: number;
  wobble: number;
  precess: number;
  /** The last place the hand held it (world), and the offset blended off after the release. */
  held: THREE.Vector3;
  hasHeld: boolean;
  offset: THREE.Vector3;
  offsetT: number;
  /** Tumbling: since this sim time (−1 not), its orientation and angular velocity (world, rad/s). */
  tumbleT: number;
  q: THREE.Quaternion;
  w: THREE.Vector3;
  /** The dead ball's bounce: running, and its position and velocity (world). */
  dead: boolean;
  p: THREE.Vector3;
  v: THREE.Vector3;
  rest: boolean;
}

export function createBallFlight(): BallFlight {
  return { throwT: -1, spin: 0, rate: 0, wobble: 0, precess: 0, held: new THREE.Vector3(), hasHeld: false, offset: new THREE.Vector3(), offsetT: 0, tumbleT: -1, q: new THREE.Quaternion(), w: new THREE.Vector3(), dead: false, p: new THREE.Vector3(), v: new THREE.Vector3(), rest: false };
}

/** New play: nothing in flight. */
export function resetFlight(f: BallFlight): void {
  f.throwT = -1;
  f.hasHeld = false;
  f.offsetT = 0;
  f.tumbleT = -1;
  f.dead = false;
  f.rest = false;
}

/** The ball is in a hand this frame (drawn there by choreo's ballInHands): remember where. */
export function heldAt(f: BallFlight, ball: THREE.Object3D): void {
  f.held.copy(ball.position);
  f.hasHeld = true;
  f.dead = false;
  f.tumbleT = -1;
}

const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _X = new THREE.Vector3(1, 0, 0);
const _Y = new THREE.Vector3(0, 1, 0);

/** The throw's spiral (0 a wounded duck … 1 a tight one) and spin (rpm), from the sim's throw event. */
function spiralOf(s: PlayState): { spiral: number; rpm: number } {
  for (let k = s.events.length - 1; k >= 0; k--) {
    const e = s.events[k]!;
    if (e.type !== 'throw') continue;
    const d = e.data ?? {};
    if (typeof d.spiral === 'number' && typeof d.rpm === 'number') return { spiral: d.spiral, rpm: d.rpm };
    // (An older sim: a mechanics miss wobbles, a clean throw spirals.)
    return { spiral: d.mech ? 0.35 : 0.9, rpm: RPM_BASE };
  }
  return { spiral: 0.9, rpm: RPM_BASE };
}

/**
 * Draw the ball off the hand: the position is the sim's (interpolated, set
 * by the caller); this sets its orientation, the release blend, the tumble
 * and the dead-ball bounce. `vel` is the sim's velocity (world, m/s), `dt`
 * the frame's animation step (s), `simT` the sim time drawn.
 */
export function placeFlight(f: BallFlight, ball: THREE.Object3D, s: PlayState, vel: THREE.Vector3, dt: number, simT: number): void {
  const b = s.ball;
  // (A bobble juggled over his hands turns end over end too: passing round 2.)
  const loose = b.mode === 'loose' || (b.mode === 'air' && (b.target === -2 || s.bobble !== null));
  const dead = s.phase === 'dead' && b.mode !== 'held';
  // A new throw: its spiral, its spin, and the hand it left from.
  if (b.mode === 'air' && b.releaseT !== f.throwT && !loose) {
    f.throwT = b.releaseT;
    const { spiral, rpm } = spiralOf(s);
    f.rate = ((rpm * Math.PI * 2) / 60) * (spiral < 0.25 ? RPM_DUCK / RPM_BASE : 1);
    f.wobble = WOBBLE_TIGHT + (WOBBLE_DUCK - WOBBLE_TIGHT) * (1 - spiral) * (1 - spiral);
    f.spin = hash(s.setup.seed, Math.round(b.releaseT * 60)) * Math.PI * 2;
    f.precess = 0;
    if (f.hasHeld) {
      f.offset.subVectors(f.held, ball.position);
      // A hand more than a stride from the sim's release point is a clip that didn't play (a throw-away, a skipped frame): no blend.
      f.offsetT = f.offset.length() < 1.2 ? RELEASE_BLEND : 0;
    }
    f.hasHeld = false;
  }
  if (dead) {
    deadBall(f, ball, s, vel, dt);
    return;
  }
  f.dead = false;
  if (loose) {
    tumble(f, ball, s, vel, dt, simT);
    return;
  }
  f.tumbleT = -1;
  // The release blend: from the hand onto the flight.
  if (f.offsetT > 0) {
    const k = f.offsetT / RELEASE_BLEND;
    ball.position.addScaledVector(f.offset, k * k);
    f.offsetT = Math.max(0, f.offsetT - dt);
  }
  if (vel.lengthSq() < 1) return;
  _dir.copy(vel).normalize();
  // The nose rides a little above the path once it's coming down (the axis
  // lags the path's bend), more on a long, falling ball.
  const fall = Math.max(0, -_dir.y);
  if (fall > 0) {
    const aoa = AOA_MAX * Math.min(1, fall / 0.45);
    _ax.crossVectors(_dir, _Y);
    if (_ax.lengthSq() > 1e-6) _dir.applyAxisAngle(_ax.normalize(), -aoa);
  }
  _q.setFromUnitVectors(_X, _dir);
  // The wobble: the nose circles the axis (precession), tight for a spiral, wide for a duck.
  f.precess += dt * PRECESS_HZ * Math.PI * 2 * (f.wobble > 0.2 ? 0.55 : 1);
  _up.set(0, Math.cos(f.precess), Math.sin(f.precess));
  _q2.setFromAxisAngle(_up, f.wobble);
  _q.multiply(_q2);
  // The spin about the long axis (capped per frame against strobing).
  f.spin += Math.sign(f.rate) * Math.min(Math.abs(f.rate) * dt, SPIN_STEP_MAX);
  _q2.setFromAxisAngle(_X, f.spin);
  ball.quaternion.copy(_q).multiply(_q2);
}

/** Off a hand, a helmet or a fumble: end over end about an axis across the ball. */
function tumble(f: BallFlight, ball: THREE.Object3D, s: PlayState, vel: THREE.Vector3, dt: number, simT: number): void {
  if (f.tumbleT < 0) {
    f.tumbleT = simT;
    f.q.copy(ball.quaternion);
    // Across the ball's long axis, toward the side its flight was carrying it, with a skew.
    const k = Math.round(simT * 60);
    const u = hash(s.setup.seed, k, 1);
    const w = TUMBLE_MIN + (TUMBLE_MAX - TUMBLE_MIN) * hash(s.setup.seed, k, 2);
    _ax.set(0, 1, 0).applyQuaternion(f.q);
    _dir.set(0, 0, 1).applyQuaternion(f.q);
    f.w.copy(_ax).multiplyScalar(Math.cos(u * Math.PI * 2)).addScaledVector(_dir, Math.sin(u * Math.PI * 2)).normalize().multiplyScalar(w);
    f.offsetT = 0;
  }
  integrate(f, dt);
  ball.quaternion.copy(f.q);
  // Nothing to keep from the bounce yet: the dead ball starts from here.
  f.p.copy(ball.position);
  f.v.copy(vel);
}

/** Turn f.q by f.w for dt. */
function integrate(f: BallFlight, dt: number): void {
  const w = f.w.length();
  if (w < 1e-4 || dt <= 0) return;
  _q.setFromAxisAngle(_ax.copy(f.w).divideScalar(w), w * dt);
  f.q.premultiply(_q);
}

/** The height of the ball's centre resting on its lowest point (m), for its long axis at elevation `sinE` (|sin|). */
const restHeight = (sinE: number) => Math.sqrt(HALF * HALF * sinE * sinE + RAD * RAD * (1 - sinE * sinE));

/**
 * The dead ball after an incompletion: it lands where the sim put it down
 * and bounces like a football. A tip into the turf kicks it up and off at an
 * angle and flips it; a belly landing skids low and rolls about its long
 * axis. Each bounce's luck is a hash of the play, so the same play bounces
 * the same way every time. Then it settles lying on its side.
 */
function deadBall(f: BallFlight, ball: THREE.Object3D, s: PlayState, vel: THREE.Vector3, dt: number): void {
  if (!f.dead) {
    f.dead = true;
    f.rest = false;
    if (f.tumbleT < 0) {
      // From flight: the orientation it came down with, spinning about its axis.
      f.q.copy(ball.quaternion);
      _ax.set(1, 0, 0).applyQuaternion(f.q);
      f.w.copy(_ax).multiplyScalar(f.rate * 0.6);
      f.p.copy(ball.position);
      f.v.copy(vel);
    }
    // (A throw-away or a ball dead in a hand never had a flight here: lie it down.)
    if (f.v.lengthSq() < 0.01 && f.p.y > 0.3) f.rest = true;
    f.tumbleT = -1;
  }
  if (f.rest) {
    // Lying on its side: its axis level, its centre on its belly.
    _ax.set(1, 0, 0).applyQuaternion(f.q);
    _ax.y = 0;
    if (_ax.lengthSq() < 1e-6) _ax.set(1, 0, 0);
    _ax.normalize();
    _q.setFromUnitVectors(_X, _ax);
    f.q.slerp(_q, 1 - Math.exp(-dt * 6));
    f.p.y += (RAD - f.p.y) * (1 - Math.exp(-dt * 8));
    ball.position.copy(f.p);
    ball.quaternion.copy(f.q);
    return;
  }
  // A few sub-steps a frame: the bounce is quick.
  const n = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    f.v.y -= GRAV * h;
    f.p.addScaledVector(f.v, h);
    integrate(f, h);
    _ax.set(1, 0, 0).applyQuaternion(f.q);
    const sinE = Math.abs(_ax.y);
    const floor = restHeight(sinE);
    if (f.p.y <= floor && f.v.y < 0) {
      f.p.y = floor;
      const k = Math.round((f.p.x * 7 + f.p.z * 13) * 10);
      const r1 = hash(s.setup.seed, k, 3);
      const r2 = hash(s.setup.seed, k, 4);
      const vin = -f.v.y;
      if (sinE > 0.45) {
        // On a tip: it kicks up and off to a side, and flips (the oblong
        // ball's lottery). Restitution ~0.5 off a point, its run turned up to ±50°.
        f.v.y = vin * (0.38 + 0.25 * r1);
        const turn = (r2 - 0.5) * 1.75;
        const c = Math.cos(turn);
        const sn = Math.sin(turn);
        const vx = f.v.x;
        f.v.x = (vx * c - f.v.z * sn) * 0.7;
        f.v.z = (vx * sn + f.v.z * c) * 0.7;
        _dir.set(f.v.z, 0, -f.v.x);
        if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, 1);
        f.w.copy(_dir.normalize()).multiplyScalar(TUMBLE_MIN + 10 * r1);
      } else {
        // On its belly: a low skid (restitution ~0.2), the turf takes its pace, and it rolls about its long axis.
        f.v.y = vin * (0.12 + 0.12 * r1);
        f.v.x *= 0.55;
        f.v.z *= 0.55;
        f.w.copy(_ax).multiplyScalar((r2 - 0.5) * 18);
      }
    }
  }
  if (f.p.y <= restHeight(Math.abs(_ax.set(1, 0, 0).applyQuaternion(f.q).y)) + 0.01 && Math.abs(f.v.y) < 0.5) {
    // Rolling on the turf: friction takes it.
    const k = Math.exp(-dt * 2.2);
    f.v.x *= k;
    f.v.z *= k;
    f.w.multiplyScalar(Math.exp(-dt * 3));
    if (Math.hypot(f.v.x, f.v.z) < 0.15) f.rest = true;
  }
  ball.position.copy(f.p);
  ball.quaternion.copy(f.q);
}

/** World velocity (m/s) of the sim's ball snapshot. */
export function ballWorldVel(vx: number, vy: number, vz: number, out: THREE.Vector3): THREE.Vector3 {
  return out.set(-vy * YARD, vz * YARD, -vx * YARD);
}
