// Throwing and catching (GDD §9.1–9.2). A throw is committed at the start of
// the release motion: the QB leads his receiver to a catch point, the
// placement input moves it (lead / back shoulder / high / low), and the
// error cone from his accuracy (times on-the-run, pressure, bullet and
// footwork factors) moves it again. The catch is resolved when the ball
// reaches a pair of hands: base Catching, ball speed, how far the ball is
// from the ideal spot, defenders in the catch window, and the catch type.

import { flightTime, solveLaunch, speed3, stepFlight, type V3 } from './ball';
import { errorAt20, maxRange, maxThrowSpeed } from './effects';
import { continueDir } from './ai';
import { gauss } from './rand';
import type { PlayState } from './state';
import { TICK, type Agent } from './types';
import { dist, len, type V2 } from './vec';

/** Ball height at a comfortable catch (chest), yd. */
export const CATCH_Z = 1.25;
/** Release height above the QB's feet, yd (the ball leaves over the helmet). */
const RELEASE_Z = 2.15;

/** The receiver's position `T` seconds ahead along his current path. */
export function lead(r: Agent, T: number): V2 {
  const rt = r.route;
  if (!rt || rt.idx >= rt.pts.length) return { x: r.pos.x + r.vel.x * T, y: r.pos.y + r.vel.y * T };
  // Walk the rest of his route at his current pace (at least a jog).
  let left = Math.max(len(r.vel), r.fx.vmax * 0.7) * T;
  let at = { x: r.pos.x, y: r.pos.y };
  for (let k = rt.idx; k < rt.pts.length; k++) {
    const q = rt.pts[k]!;
    const d = dist(at, q);
    if (d >= left) return { x: at.x + ((q.x - at.x) / d) * left, y: at.y + ((q.y - at.y) / d) * left };
    left -= d;
    at = { x: q.x, y: q.y };
    if (rt.sit[k]) return at;
  }
  // Past the last point: keep going the way the route ends (upfield near the sideline).
  const n = rt.pts.length;
  const a = n > 1 ? rt.pts[n - 2]! : r.pos;
  const b = rt.pts[n - 1]!;
  for (let k = 0; k < 20 && left > 0; k++) {
    const dir = continueDir(at, a, b);
    const stepL = Math.min(left, 0.5);
    at = { x: at.x + dir.x * stepL, y: at.y + dir.y * stepL };
    left -= stepL;
  }
  return at;
}

/**
 * How much loft a touch pass takes (0 = the flattest throw at that speed,
 * 1 = the lob), by distance: a short touch pass is a soft line drive, a
 * deep one drops in over the top. From a 90 arm this gives ~0.9 s at 8
 * yd, ~1.1 s at 15, ~1.7 s at 25 and ~2.3 s at 35 (NFL Next Gen Stats
 * time-to-target by depth runs ~0.8–1.1 s short, ~1.4–1.8 s at 20–30 yd).
 */
export function touchArc(d: number): number {
  return 0.08 + Math.max(0, Math.min(1, (d - 10) / 40)) * 0.24;
}

export interface ThrowPlan {
  from: V3;
  to: V3;
  v0: V3;
  T: number;
  kind: 'touch' | 'bullet';
  /** Distance from the QB to the catch point, yd (air yards are downfield only). */
  distance: number;
  airYards: number;
  /** Error applied (yd), for the catch roll. */
  miss: number;
}

/**
 * Plan a throw. `charge` 0 = touch; >0 = bullet at that charge. `aim` is the
 * placement input. `pressure` 0..1 and `moving` 0..1 scale the error.
 */
export function planThrow(s: PlayState, qb: Agent, rec: Agent, charge: number, aim: V2, pressure: number, offPlatform: boolean): ThrowPlan {
  const power = qb.fx.r('throwPower');
  const vmax = maxThrowSpeed(power);
  const range = maxRange(power);
  const bullet = charge > 0;
  const S = bullet ? vmax * (0.84 + 0.16 * Math.min(1, charge)) : vmax * 0.7;
  const from: V3 = { x: qb.pos.x + qb.vel.x * 0.1, y: qb.pos.y + qb.vel.y * 0.1, z: RELEASE_Z * (qb.fx.height / 2.08) };
  // Lead the receiver: iterate the flight time against where he will be.
  let T = 0.8;
  let spot = lead(rec, T);
  for (let k = 0; k < 4; k++) {
    const to = { x: spot.x, y: spot.y, z: CATCH_Z };
    T = flightTime(from, to, S, bullet ? 0.05 : touchArc(dist(from, to))).T + 0.05;
    spot = lead(rec, T);
  }
  // Placement input: lead / back shoulder along his path, high / low.
  const rv = len(rec.vel) > 0.5 ? { x: rec.vel.x / len(rec.vel), y: rec.vel.y / len(rec.vel) } : { x: 1, y: 0 };
  const place = 1.6 * aim.x;
  let tx = spot.x + rv.x * place;
  let ty = spot.y + rv.y * place;
  let tz = CATCH_Z + 0.55 * aim.y;
  const d = dist(from, { x: tx, y: ty });
  // Error cone (GDD §9.1): the accuracy for the throw's depth sets the base.
  const air = tx - s.setup.los;
  const acc = air < 12 ? qb.fx.r('shortAcc') : air < 25 ? qb.fx.r('midAcc') : qb.fx.r('deepAcc');
  let sigma = errorAt20(acc) * Math.max(0.4, d / 20);
  const moving = Math.min(1, len(qb.vel) / 4);
  sigma *= 1 + moving * 1.1 * (1 - qb.fx.a('throwOnRun'));
  sigma *= 1 + pressure * 1.4 * (1 - qb.fx.a('underPressure'));
  sigma *= bullet ? 1 + 0.18 * Math.min(1, charge) : 1;
  sigma *= offPlatform ? 1.2 : 1;
  const ex = gauss(s.rng.throw) * sigma;
  const ey = gauss(s.rng.throw) * sigma;
  const ez = gauss(s.rng.throw) * sigma * 0.35;
  tx += ex;
  ty += ey;
  tz += ez;
  // Beyond his range the ball dies short.
  if (d > range) {
    const k = range / d;
    tx = from.x + (tx - from.x) * k;
    ty = from.y + (ty - from.y) * k;
    tz = 0.3;
  }
  const to: V3 = { x: tx, y: ty, z: tz };
  const final = flightTime(from, to, S, bullet ? 0.05 : touchArc(d));
  const v0 = solveLaunch(from, to, final.T);
  return { from, to, v0, T: final.T, kind: bullet ? 'bullet' : 'touch', distance: d, airYards: Math.max(0, air), miss: Math.sqrt(ex * ex + ey * ey + ez * ez) };
}

/**
 * Where a throw to `rec` would land if it went now, before the error cone:
 * the led catch point with the placement, and the cone's size (1 sigma, yd)
 * for his accuracy at that depth and his motion. Read-only (no dice), for
 * the landing reticle while the user holds an icon.
 */
export function previewThrow(s: PlayState, qb: Agent, rec: Agent, charge: number, aim: V2): { x: number; y: number; sigma: number } {
  const power = qb.fx.r('throwPower');
  const vmax = maxThrowSpeed(power);
  const bullet = charge > 0;
  const S = bullet ? vmax * (0.84 + 0.16 * Math.min(1, charge)) : vmax * 0.7;
  const from: V3 = { x: qb.pos.x + qb.vel.x * 0.1, y: qb.pos.y + qb.vel.y * 0.1, z: RELEASE_Z * (qb.fx.height / 2.08) };
  let T = 0.8;
  let spot = lead(rec, T);
  for (let k = 0; k < 4; k++) {
    T = flightTime(from, { x: spot.x, y: spot.y, z: CATCH_Z }, S, bullet ? 0.05 : touchArc(dist(from, spot))).T + 0.05;
    spot = lead(rec, T);
  }
  const rv = len(rec.vel) > 0.5 ? { x: rec.vel.x / len(rec.vel), y: rec.vel.y / len(rec.vel) } : { x: 1, y: 0 };
  let x = spot.x + rv.x * 1.6 * aim.x;
  let y = spot.y + rv.y * 1.6 * aim.x;
  const d = dist(from, { x, y });
  const range = maxRange(power);
  if (d > range) {
    x = from.x + (x - from.x) * (range / d);
    y = from.y + (y - from.y) * (range / d);
  }
  const air = x - s.setup.los;
  const acc = air < 12 ? qb.fx.r('shortAcc') : air < 25 ? qb.fx.r('midAcc') : qb.fx.r('deepAcc');
  const moving = Math.min(1, len(qb.vel) / 4);
  const sigma = errorAt20(acc) * Math.max(0.4, d / 20) * (1 + moving * 1.1 * (1 - qb.fx.a('throwOnRun'))) * (bullet ? 1 + 0.18 * Math.min(1, charge) : 1);
  return { x, y, sigma };
}

/** Release the planned throw: the ball flies. */
export function release(s: PlayState, qb: Agent, rec: Agent, plan: ThrowPlan): void {
  const b = s.ball;
  b.mode = 'air';
  b.holder = -1;
  b.pos = { ...plan.from };
  b.vel = { ...plan.v0 };
  b.target = rec.i;
  b.aim = { ...plan.to };
  b.arrive = s.t + plan.T;
  b.thrower = qb.i;
  b.kind = plan.kind;
  b.spin = 0;
  s.touched = [];
  s.phase = 'air';
  s.pass = { attempted: true, complete: false, intercepted: false, airYards: Math.round(plan.airYards * 10) / 10, target: rec.i };
  s.events.push({ t: s.t, type: 'throw', who: [qb.i, rec.i], at: { x: plan.to.x, y: plan.to.y }, data: { kind: plan.kind, air: Math.round(plan.airYards) } });
}

/** How far a player can reach for a ball: standing reach plus a jump. */
export function reach(a: Agent): { r: number; top: number } {
  const jump = a.fx.a('jumping') * 0.35 + 0.15;
  return { r: 0.75 + a.fx.height * 0.05, top: a.fx.height * 1.28 + jump };
}

/**
 * Resolve a ball arriving at an agent. Returns what happened; the caller
 * applies it (possession, a live deflection, or the ball flying on).
 */
export function resolveCatch(s: PlayState, a: Agent): 'catch' | 'drop' | 'deflect' | 'int' | 'miss' {
  const b = s.ball;
  const rng = s.rng.catch;
  const vs = speed3(b.vel);
  // How far the ball's path passes from his hands (closest approach over the
  // next few frames, to his chest), not where it first came within reach.
  const px = b.pos.x - a.pos.x;
  const py = b.pos.y - a.pos.y;
  const pz = b.pos.z - CATCH_Z;
  const vv = b.vel.x * b.vel.x + b.vel.y * b.vel.y + b.vel.z * b.vel.z;
  const tc = Math.max(0, Math.min(0.2, -(px * b.vel.x + py * b.vel.y + pz * b.vel.z) / Math.max(1e-6, vv)));
  const cx = px + b.vel.x * tc;
  const cy = py + b.vel.y * tc;
  const cz = pz + b.vel.z * tc;
  const off = Math.sqrt(cx * cx + cy * cy + cz * cz * 0.6);
  // Harder: a ball away from the body, a fast ball.
  const hard = Math.max(0, off - 0.35) * 0.6 + Math.max(0, vs - 20) * 0.02;
  // Defenders contesting at the catch point (within a yard, playing the ball) and nearby.
  // Contest strength: full at arm's length, fading out by ~2 yd; a defender
  // who hasn't found the ball contests at half strength.
  let contest = 0;
  let near = 0;
  for (const o of s.agents) {
    if (o.side === a.side || o.down) continue;
    const k = dist(o.pos, { x: b.pos.x, y: b.pos.y });
    const w = Math.max(0, Math.min(1, (2.6 - k) / 1.5)) * (o.mem.onBall ? 1 : 0.5);
    contest += w;
    if (w === 0 && k < 3) near++;
  }
  if (a.side === 'off') {
    const type = s.catchType ?? (contest > 0.3 ? 'possession' : 'rac');
    const hands = a.fx.a('catching');
    const tough = a.fx.a('catchInTraffic');
    const spect = a.fx.a('spectacular');
    // Uncontested, catchable: ~93–98% by Catching (NFL drop rates run 3–6%).
    let p = 0.86 + 0.12 * hands - hard * (1.1 - 0.5 * spect);
    // Contested: ~40–60% (contested-catch rates, PFF/NGS), by Catch in Traffic and the catch type.
    // Fully contested: ~45–55% for a good hands-in-traffic receiver (contested-catch rates, PFF/NGS).
    if (contest > 0) p -= Math.min(1.4, contest) * (0.78 - 0.36 * tough - (type === 'aggressive' ? 0.1 : type === 'possession' ? 0.06 : -0.1));
    p -= near * 0.03;
    if (a.fx.r('catching', -1) < 0) p -= 0.3; // linemen and QBs
    p = Math.max(0.02, Math.min(0.985, p));
    if (rng() < p) return 'catch';
    return contest > 0.3 && rng() < 0.6 ? 'deflect' : off < 0.8 ? 'drop' : 'miss';
  }
  // A defender at the ball: he has to be playing it, and close to its path.
  if (!a.mem.onBall && off > 0.45) return 'miss';
  const skill = a.fx.a('ballSkills');
  const ballhawk = a.p.traits?.includes('ballhawk') ? 0.1 : 0;
  // In front of the intended receiver (undercutting) he can catch it; from behind he mostly knocks it away.
  const r = b.target >= 0 ? s.agents[b.target]! : null;
  const front = r ? ((a.pos.x - r.pos.x) * (s.agents[b.thrower]!.pos.x - r.pos.x) + (a.pos.y - r.pos.y) * (s.agents[b.thrower]!.pos.y - r.pos.y)) > 0 : true;
  const close = Math.max(0, 1 - off / 0.9);
  // Breakups outnumber interceptions about 4 to 1 in the NFL (passes defensed
  // vs interceptions); a ballhawk undercutting a route gets his hands on more.
  const pInt = (0.05 + 0.2 * skill + ballhawk) * close * (front ? 1 : 0.3) * (b.target === -2 ? 0.6 : 1);
  const pBreak = (0.35 + 0.35 * skill) * close;
  const u = rng();
  if (u < pInt) return 'int';
  if (u < pInt + pBreak) return 'deflect';
  return 'miss';
}

/** One tick of the ball in the air; returns the agent whose hands it reached (or −1). */
export function stepAir(s: PlayState): number {
  const b = s.ball;
  // The same integrator the throw was planned with.
  stepFlight(b.pos, b.vel);
  b.spin += 12 * TICK;
  // Who can get a hand on it this tick: the closest, among players who
  // haven't already tried.
  let best = -1;
  let bestD = Infinity;
  for (const a of s.agents) {
    if (a.down || s.touched.includes(a.i) || a.i === b.thrower) continue;
    const { r, top } = reach(a);
    if (b.pos.z > top || b.pos.z < 0.15) continue;
    const hx = b.pos.x - a.pos.x;
    const hy = b.pos.y - a.pos.y;
    const dh = Math.sqrt(hx * hx + hy * hy);
    // Defenders only play the ball once they've read it (mem.onBall).
    if (a.side === 'def' && !a.mem.onBall && dh > 0.55) continue;
    // Linemen are ineligible: they never play a pass (they can't be the target either).
    if (a.side === 'off' && a.i !== b.target && (dh > 0.6 || a.p.pos === 'OL')) continue;
    if (dh < r && dh < bestD) {
      best = a.i;
      bestD = dh;
    }
  }
  return best;
}
