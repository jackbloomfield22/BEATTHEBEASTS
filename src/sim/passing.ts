// Throwing and catching (GDD §9.1–9.2). A throw is committed at the start of
// the release motion: the QB leads his receiver to a catch point, the
// placement input moves it (lead / back shoulder / high / low), and the
// error cone from his accuracy (times on-the-run, pressure, bullet and
// footwork factors) moves it again. The catch is resolved when the ball
// reaches a pair of hands: base Catching, ball speed, how far the ball is
// from the ideal spot, defenders in the catch window, and the catch type.

import { flightTime, G, solveLaunch, speed3, stepFlight, type V3 } from './ball';
import { errorAt20, maxRange, maxThrowSpeed } from './effects';
import { breakCarry, continueDir } from './ai';
import { gauss } from './rand';
import { exp } from '@/engine/math/detmath';
import type { PlayState } from './state';
import { FIELD_HALF_W, TICK, type Agent, type CatchHard, type OffSlot } from './types';
import { dist, len, type V2 } from './vec';

/** Ball height at a comfortable catch (chest), yd. */
export const CATCH_Z = 1.25;
/** Release height above the QB's feet, yd (the ball leaves over the helmet). */
const RELEASE_Z = 2.15;

/**
 * How far a receiver running flat out covers in `T` seconds from his speed
 * now: the sprint model movement.ts accelerates him by (dv/dt = (v∞ − v)/τ,
 * integrated), at the top speed his stamina allows (steer's cap).
 */
export function fullSpeedRun(r: Agent, T: number): number {
  const vTop = r.fx.vmax * (0.86 + 0.14 * r.stamina);
  const v0 = Math.min(len(r.vel), vTop);
  return vTop * T - (vTop - v0) * r.fx.tau * (1 - exp(-T / r.fx.tau));
}

/**
 * The receiver's position `T` seconds ahead along his path, running it at
 * full speed: a ball is led to where he'll be flat out, so he catches it in
 * stride (feedback item 7). Settle routes stop at their settle point.
 */
export function lead(r: Agent, T: number): V2 {
  const rt = r.route;
  if (!rt) {
    // No route: on along the way he's going, flat out.
    const sp = len(r.vel);
    if (sp < 0.5) return { x: r.pos.x, y: r.pos.y };
    const d = fullSpeedRun(r, T);
    return { x: r.pos.x + (r.vel.x / sp) * d, y: r.pos.y + (r.vel.y / sp) * d };
  }
  // Settled on a sit route: he's there.
  if (rt.idx >= rt.pts.length && rt.sit[rt.pts.length - 1]) return { x: r.pos.x, y: r.pos.y };
  // Run the route forward the way he'll run it (M6.5 #6), tick by tick: the
  // stem at ~92%, braking into each break to the speed he can carry through
  // it (breakCarry), the plant, then building back up (the sprint model, τ),
  // exactly as ai.ts runRoute and movement.ts do. M6 charged each break
  // v²(1 − cos θ)/a of ground (~5 yd round a right angle, against the ~2 he
  // loses), so a ball thrown before the break was led short and he
  // throttled down to wait for it coming out of the break.
  const vTop = r.fx.vmax * (0.86 + 0.14 * r.stamina);
  const brake = r.fx.cutAccel * 0.8;
  let v = Math.min(len(r.vel), vTop);
  let at = { x: r.pos.x, y: r.pos.y };
  let t = 0;
  for (let k = rt.idx; k < rt.pts.length; k++) {
    const q = rt.pts[k]!;
    const nx = rt.pts[k + 1];
    let vq = vTop;
    if (rt.sit[k]) vq = 0;
    else if (nx) {
      const d0 = dist(at, q);
      const d1 = dist(q, nx);
      if (d0 > 1e-6 && d1 > 1e-6) vq = breakCarry(r, ((q.x - at.x) * (nx.x - q.x) + (q.y - at.y) * (nx.y - q.y)) / (d0 * d1)) * r.fx.vmax;
    }
    const top = k === 0 ? vTop * 0.92 : vTop;
    for (let n = 0; n < 600; n++) {
      const d = dist(at, q);
      if (d < 1e-3) break;
      if (t >= T) return at;
      const want = Math.min(top, Math.sqrt(vq * vq + 2 * brake * d));
      v = v > want ? Math.max(want, v - brake * TICK) : v + ((want - v) / r.fx.tau) * TICK;
      const step = Math.max(0.01, v * TICK);
      if (step >= d) {
        at = { x: q.x, y: q.y };
        t += d / Math.max(0.5, v);
        break;
      }
      at = { x: at.x + ((q.x - at.x) / d) * step, y: at.y + ((q.y - at.y) / d) * step };
      t += TICK;
    }
    if (rt.sit[k]) return at;
    v = Math.min(v, vq);
  }
  if (t >= T) return at;
  // What's left of the time, run on from his speed out of the last point.
  const rest = T - t;
  let left = vTop * rest - (vTop - v) * r.fx.tau * (1 - exp(-rest / r.fx.tau));
  // Past the last point: keep going the way the route ends (upfield near the sideline).
  const n = rt.pts.length;
  const a = n > 1 ? rt.pts[n - 2]! : r.pos;
  const b = rt.pts[n - 1]!;
  // (Half-yard steps, as far as he runs: up to 60 yd, a bomb's worth.)
  for (let k = 0; k < 120 && left > 0; k++) {
    const dir = continueDir(at, a, b);
    const stepL = Math.min(left, 0.5);
    at = { x: at.x + dir.x * stepL, y: at.y + dir.y * stepL };
    left -= stepL;
  }
  return at;
}

/**
 * Hang time of a driven ball, the default throw (round-two feedback: a
 * short throw must not float while the defense rallies), s from release to
 * the catch point. From a 90 arm: ~0.6 s at 10 yd and ~0.9 s at 20 (the
 * owner's targets; a quick-game ball is on a receiver in about the time
 * the NFL's fastest throws take, ~0.5–0.7 s), then steeper past 20 as a
 * deep ball needs arc to carry: a driven 40-yard rope in ~1.8 s, 50 in
 * ~2.25 s (a lofted deep shot, 2.4–2.8 s in the NFL, is the touch pass).
 * The slope past 20 also keeps the lead stable: a receiver running ~10 yd/s
 * moves the catch point ~10 yd for every second of hang, so a slope much
 * past 0.05 s/yd runs away (the lead chases him to the end line). A weaker
 * arm takes longer in proportion to its top speed; the throw is never
 * faster than the arm can make it (planThrow).
 */
export function driveTime(d: number, power: number): number {
  const base = 0.3 + 0.03 * Math.min(d, 20) + 0.045 * Math.max(0, d - 20);
  return base * (maxThrowSpeed(90) / maxThrowSpeed(power));
}

/**
 * A touch pass (the icon held briefly): the driven time stretched by 15%
 * for a quick hold up to 35% for a full one. Less loft than M5's touch pass,
 * which took ~0.9 s to go 10 yd from a 90 arm; this one takes 0.69–0.81 s.
 */
export const touchStretch = (loft: number): number => 1.15 + 0.2 * Math.max(0, Math.min(1, loft));

/**
 * Stretch a throw's hang time until it clears the defenders under its path:
 * a defender near the line of the throw (within ~0.9 yd, where he'd be as
 * it passes) who could reach the ball's height there makes the QB put air
 * under it. Up to four 12% steps; past that it's thrown into him anyway.
 */
function clearLoft(s: PlayState, from: V3, to: V3, T: number): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1) return T;
  for (let step = 0; step < 4; step++) {
    let blocked = false;
    for (const i of s.def) {
      const d = s.agents[i]!;
      if (d.down) continue;
      for (const u of [0.25, 0.4, 0.55, 0.7, 0.85]) {
        const t = u * T;
        const px = d.pos.x + d.vel.x * Math.min(t, 0.4);
        const py = d.pos.y + d.vel.y * Math.min(t, 0.4);
        const bx = from.x + dx * u;
        const by = from.y + dy * u;
        if ((px - bx) * (px - bx) + (py - by) * (py - by) > 0.81) continue;
        // The ball's height there (vacuum arc; drag lowers it a little more).
        const z = from.z + (to.z - from.z) * u + 0.5 * G * T * T * u * (1 - u);
        if (z < reach(d).top + 0.15) blocked = true;
      }
    }
    if (!blocked) return T;
    T *= 1.12;
  }
  return T;
}

/**
 * The error cone's growth with distance (× the 20-yd error). Past 20 yd it
 * grows in proportion; inside it keeps most of its size, because the misses
 * that matter on a short throw are mechanics and timing, not distance: PFF
 * charts ~10% of an elite passer's short throws off target (σ ≈ 0.36 yd at
 * 10 yd for a 95 accuracy) and ~35% of deep ones (σ ≈ 0.85 at 40).
 */
/** How far from the ball (yd) a defender still contests the catch: fully at a yard, not at all from here. M5.5 used 2 yd; at 2.6 a defender closing on the ball at the catch still gets a hand in. */
const CONTEST_R = 2.6;
/** The mechanics miss for accuracy alone, × (1 − accuracy/99): a 70 passer ~4% of his clean throws, a 95 under 1%. */
const MISS_ACC = 0.14;
/** The most a QB–receiver chemistry of 1 takes off the cone to him (15%), and off the time he takes to find the ball in the air (s). Small by design: a timing bonus, not a new receiver. */
const CHEM_CONE = 0.15;
const CHEM_FIND = 0.08;

/** When a receiver has found the ball in the air: 0.2–0.45 s after the release by Catching, sooner with his QB's chemistry. */
export function findsBallAt(s: PlayState, a: Agent): number {
  return s.ball.releaseT + 0.2 + 0.25 * (1 - a.fx.a('catching')) - CHEM_FIND * Math.max(0, Math.min(1, s.setup.chem?.[a.slot as OffSlot] ?? 0));
}

export const coneScale = (d: number): number => (d >= 20 ? d / 20 : 0.7 + 0.3 * (d / 20));

export interface ThrowPlan {
  from: V3;
  to: V3;
  v0: V3;
  T: number;
  kind: 'driven' | 'touch';
  /** Distance from the QB to the catch point, yd (air yards are downfield only). */
  distance: number;
  airYards: number;
  /** Error applied (yd), for the catch roll. */
  miss: number;
  /** The catch point he meant (lead and placement, before the error). */
  meant: V2;
  /** The ball got away from him (a sailed or short-hopped throw: the mechanics miss). */
  missed: boolean;
  /** Where the error came from (M6.5 #1): each factor on the cone, and the miss. */
  err: ThrowError;
}

/** A throw's error, by source: the cone's 1σ (yd) and what scaled it; the mechanics miss; the error applied. */
export interface ThrowError {
  /** His accuracy for the depth, the base cone at 20 yd and the distance scale on it. */
  acc: number;
  base: number;
  distance: number;
  /** Multipliers on the cone (1 = no effect). */
  moving: number;
  pressure: number;
  platform: number;
  /** Chemistry with this receiver (≤ 1: it tightens the cone). */
  chem: number;
  /** The placement asked for along his path (−1 back shoulder … +1 lead). */
  place: number;
  sigma: number;
  /** The mechanics miss: its odds, and whether it happened ('sail' long and high, 'short' in the dirt). */
  pMiss: number;
  miss: 'sail' | 'short' | null;
  /** The error applied (yd): downfield and across from the meant point, and its size on the ground. */
  dx: number;
  dy: number;
  off: number;
}

/**
 * Plan a throw. `loft` 0 = the driven ball (a tap); >0 = touch, more air the
 * longer the hold. `aim` is the placement input. `pressure` 0..1 and
 * `offPlatform` scale the error.
 */
export function planThrow(s: PlayState, qb: Agent, rec: Agent, loft: number, aim: V2, pressure: number, offPlatform: boolean): ThrowPlan {
  const power = qb.fx.r('throwPower');
  const vmax = maxThrowSpeed(power);
  const range = maxRange(power);
  const touch = loft > 0;
  const from: V3 = { x: qb.pos.x + qb.vel.x * 0.1, y: qb.pos.y + qb.vel.y * 0.1, z: RELEASE_Z * (qb.fx.height / 2.08) };
  const hang = (to: V3) => Math.max(driveTime(dist(from, to), power) * (touch ? touchStretch(loft) : 1), flightTime(from, to, vmax, 0).T);
  // Lead the receiver: iterate the flight time against where he will be.
  let T = 0.8;
  let spot = lead(rec, T);
  for (let k = 0; k < 4; k++) {
    T = hang({ x: spot.x, y: spot.y, z: CATCH_Z }) + 0.05;
    spot = lead(rec, T);
  }
  // Placement input: lead / back shoulder along his path, high / low.
  const rv = len(rec.vel) > 0.5 ? { x: rec.vel.x / len(rec.vel), y: rec.vel.y / len(rec.vel) } : { x: 1, y: 0 };
  const place = 1.6 * aim.x;
  let tx = spot.x + rv.x * place;
  let ty = spot.y + rv.y * place;
  let tz = CATCH_Z + 0.55 * aim.y;
  const meant = { x: tx, y: ty };
  const d = dist(from, { x: tx, y: ty });
  // Error cone (GDD §9.1): the accuracy for the throw's depth sets the base.
  const air = tx - s.setup.los;
  const acc = air < 12 ? qb.fx.r('shortAcc') : air < 25 ? qb.fx.r('midAcc') : qb.fx.r('deepAcc');
  const base = errorAt20(acc);
  const moving = Math.min(1, len(qb.vel) / 4);
  // The cone grows only for a reason (M6.5 #1), and every reason costs even
  // the best something: throwing on the move, a rusher in his face, feet not
  // set. His rating decides how much (M6 scaled by 1 − rating alone, so a
  // Montana under a free rusher threw exactly as he did from a clean pocket).
  const fMoving = 1 + moving * (0.35 + 0.8 * (1 - qb.fx.a('throwOnRun')));
  const fPressure = 1 + pressure * (1.0 + 1.2 * (1 - qb.fx.a('underPressure')));
  const fPlatform = offPlatform ? 1.25 : 1;
  // Chemistry with this receiver (M6.5 #6): a tighter cone, up to CHEM_CONE.
  const fChem = 1 - CHEM_CONE * Math.max(0, Math.min(1, s.setup.chem?.[rec.slot as OffSlot] ?? 0));
  const sigma = base * coneScale(d) * fMoving * fPressure * fPlatform * fChem;
  // The mechanics miss: a ball that gets away from him, sailing or dying in
  // the dirt, 2–4 yd off. Only for a reason (M6.5 #1): M6 gave every throw a
  // 13% floor, so 79% of the misses came from a clean pocket and a quarter of
  // an elite passer's 15-yard throws landed more than a yard from where he
  // meant them (tools/sim/throws.ts). Now: a less accurate passer, a rusher
  // on him, feet not set, on the run, or a long throw. PFF's ~10% of an elite
  // passer's throws off target come from those.
  const accN = acc / 99;
  const deep = Math.max(0, air - 20) / 20;
  const pMiss = Math.min(
    0.3,
    MISS_ACC * (1 - accN) + pressure * 0.25 * (1.3 - qb.fx.a('underPressure')) + (offPlatform ? 0.05 : 0) + moving * 0.06 * (1.1 - qb.fx.a('throwOnRun')) + deep * 0.04 * (1.2 - accN),
  );
  // A sailed ball goes long and high, over his reach; one that dies is
  // short and at his feet (a short hop): either way along the line of the
  // throw, where a receiver can't just drift a step to it.
  const missed = s.rng.throw() < pMiss;
  const sail = s.rng.throw() < 0.55;
  const ux = (tx - from.x) / Math.max(1e-6, d);
  const uy = (ty - from.y) / Math.max(1e-6, d);
  const along = missed ? (sail ? 3 + 1.5 * s.rng.throw() : -(2.5 + s.rng.throw())) : 0;
  const ex = gauss(s.rng.throw) * sigma + along * ux;
  const ey = gauss(s.rng.throw) * sigma + along * uy;
  const ez = gauss(s.rng.throw) * sigma * 0.35 + (missed ? (sail ? 2.2 + 0.8 * s.rng.throw() : -0.6 - tz) : 0);
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
  // Air under it when a defender is in the way (a driven ball becomes a touch pass).
  const Tf = clearLoft(s, from, to, hang(to));
  const kind = touch || Tf > hang(to) * 1.01 ? 'touch' : 'driven';
  const v0 = solveLaunch(from, to, Tf);
  const err: ThrowError = { acc, base, distance: coneScale(d), moving: fMoving, pressure: fPressure, platform: fPlatform, chem: fChem, place: aim.x, sigma, pMiss, miss: missed ? (sail ? 'sail' : 'short') : null, dx: ex, dy: ey, off: Math.sqrt(ex * ex + ey * ey) };
  return { from, to, v0, T: Tf, kind, distance: d, airYards: Math.max(0, air), miss: Math.sqrt(ex * ex + ey * ey + ez * ez), meant, missed, err };
}

/**
 * Where a throw to `rec` would land if it went now, before the error cone:
 * the led catch point with the placement, and the cone's size (1 sigma, yd)
 * for his accuracy at that depth and his motion. Read-only (no dice), for
 * the landing reticle while the user holds an icon.
 */
export function previewThrow(s: PlayState, qb: Agent, rec: Agent, loft: number, aim: V2): { x: number; y: number; sigma: number } {
  const power = qb.fx.r('throwPower');
  const vmax = maxThrowSpeed(power);
  const touch = loft > 0;
  const from: V3 = { x: qb.pos.x + qb.vel.x * 0.1, y: qb.pos.y + qb.vel.y * 0.1, z: RELEASE_Z * (qb.fx.height / 2.08) };
  let T = 0.8;
  let spot = lead(rec, T);
  for (let k = 0; k < 4; k++) {
    const to = { x: spot.x, y: spot.y, z: CATCH_Z };
    T = Math.max(driveTime(dist(from, to), power) * (touch ? touchStretch(loft) : 1), flightTime(from, to, vmax, 0).T) + 0.05;
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
  const sigma = errorAt20(acc) * coneScale(d) * (1 + moving * 1.1 * (1 - qb.fx.a('throwOnRun')));
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
  b.meant = { ...plan.meant };
  b.place = plan.err.place;
  b.releaseT = s.t;
  b.thrower = qb.i;
  b.kind = plan.kind;
  b.spin = 0;
  s.touched = [];
  s.phase = 'air';
  rec.mem.catchLeg = catchLeg(rec, plan.meant);
  s.pass = { attempted: true, complete: false, intercepted: false, airYards: Math.round(plan.airYards * 10) / 10, target: rec.i };
  s.events.push({ t: s.t, type: 'throw', who: [qb.i, rec.i], at: { x: plan.to.x, y: plan.to.y }, data: { kind: plan.kind, air: Math.round(plan.airYards), ...(plan.missed ? { missed: true } : {}), ...throwErrData(plan) } });
}

/**
 * The main reason a throw was off, for the result card: the mechanics miss
 * first (it's the big one), else whichever factor widened the cone most,
 * else a clean throw (within his cone for the distance).
 */
export function throwWhy(e: ThrowError): 'pressure' | 'on the run' | 'feet not set' | 'long throw' | 'clean' {
  const f: [ReturnType<typeof throwWhy>, number][] = [
    ['pressure', e.pressure],
    ['on the run', e.moving],
    ['feet not set', e.platform],
    ['long throw', e.distance],
  ];
  const [top, k] = f.reduce((a, b) => (b[1] > a[1] ? b : a));
  return k > 1.15 && (e.miss || e.off > 1) ? top : 'clean';
}

/** A throw's error sources, flat for its event (the result card and tools/sim/throws.ts read them). */
export function throwErrData(plan: ThrowPlan): Record<string, number | string> {
  const e = plan.err;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { why: throwWhy(e), meantX: r(plan.meant.x), meantY: r(plan.meant.y), acc: e.acc, sigma: r(e.sigma), base: r(e.base), fDist: r(e.distance), fMoving: r(e.moving), fPressure: r(e.pressure), fPlatform: r(e.platform), fChem: r(e.chem), place: r(e.place), pMiss: r(e.pMiss), mech: e.miss ?? '', off: r(e.off) };
}

/**
 * The leg of his route the ball is thrown to (M6.5 #6): the index of the
 * route point that ends it (the route's length for the run on past its last
 * point), or −1 when the ball isn't on his route at all (a scramble throw,
 * a back-shoulder). A ball thrown before the break to a spot after it is an
 * anticipation throw: he keeps running his route through the break and the
 * ball meets him on that leg.
 */
export function catchLeg(r: Agent, meant: V2): number {
  const rt = r.route;
  if (!rt) return -1;
  // The nearest leg (a catch point just past a break is nearer the leg out of it than the stem into it).
  let from: V2 = r.pos;
  let best = -1;
  let bd = LEG_NEAR;
  for (let k = rt.idx; k < rt.pts.length; k++) {
    const q = rt.pts[k]!;
    const d = segDist(meant, from, q);
    if (d <= bd) {
      bd = d;
      best = k;
    }
    from = q;
  }
  if (best >= 0) return best;
  // On past the last point (not a settle route): along the last leg carried on.
  const n = rt.pts.length;
  if (n > 0 && !rt.sit[n - 1]) {
    const a = n > 1 ? rt.pts[n - 2]! : r.pos;
    const b = rt.pts[n - 1]!;
    const l = dist(a, b) || 1;
    const far = { x: b.x + ((b.x - a.x) / l) * 40, y: b.y + ((b.y - a.y) / l) * 40 };
    if (segDist(meant, b, far) < LEG_NEAR * 2) return n;
  }
  return -1;
}
/** How near his route the meant catch point must be to count as on it (yd). */
const LEG_NEAR = 1.5;
function segDist(p: V2, a: V2, b: V2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / Math.max(1e-9, dx * dx + dy * dy)));
  return dist(p, { x: a.x + dx * u, y: a.y + dy * u });
}

/**
 * What a catch looks like (M6.5 #5): the call and the ball decide the
 * motion, so the call changes what you see, not only the odds. Pure: the
 * render asks it a beat before the ball arrives to start the right clip,
 * and the catch event carries the final answer.
 * - dive: low and away, he has to lay out for it;
 * - oneHand: high and outside his frame, and he's a spectacular catcher;
 * - highPoint: GO UP, or a ball over his head, taken at the top of his jump;
 * - overShoulder: a deep ball dropping in over him as he runs away from the throw;
 * - toeTap: on the sideline, feet dragged in bounds;
 * - body: SECURE, cradled into the chest (he goes down with it in traffic);
 * - hands: RUN, the hands catch in stride.
 */
export type CatchLook = 'dive' | 'oneHand' | 'highPoint' | 'overShoulder' | 'toeTap' | 'body' | 'hands';
export function catchLook(s: PlayState, r: Agent, at: { x: number; y: number; z: number } = s.ball.aim): CatchLook {
  const call = s.catchType ?? 'rac';
  const sp = len(r.vel);
  const hx = sp > 1 ? r.vel.x / sp : 1;
  const hy = sp > 1 ? r.vel.y / sp : 0;
  // Where the ball arrives relative to where he'll be: across his run, and its height.
  const T = Math.max(0, s.ball.arrive - s.t);
  const px = r.pos.x + r.vel.x * T;
  const py = r.pos.y + r.vel.y * T;
  const across = Math.abs((at.x - px) * -hy + (at.y - py) * hx);
  const away = Math.sqrt((at.x - px) * (at.x - px) + (at.y - py) * (at.y - py));
  const air = at.x - s.setup.los;
  const bv = len(s.ball.vel);
  const fromBehind = sp > 5 && bv > 1 && (s.ball.vel.x * hx + s.ball.vel.y * hy) / bv > 0.55;
  if (at.z < 0.8 && away > 1.1) return 'dive';
  if (at.z > 1.9 && across > 0.8 && r.fx.a('spectacular') > 0.6) return 'oneHand';
  if (call === 'aggressive' || at.z > 2.35) return 'highPoint';
  if (air >= 18 && fromBehind) return 'overShoulder';
  if (FIELD_HALF_W - Math.abs(at.y) < 1.2) return 'toeTap';
  if (call === 'possession') return 'body';
  return 'hands';
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
  // Relative to him: a receiver running through the catch closes on the ball too.
  const px = b.pos.x - a.pos.x;
  const py = b.pos.y - a.pos.y;
  const pz = b.pos.z - CATCH_Z;
  const rx = b.vel.x - a.vel.x;
  const ry = b.vel.y - a.vel.y;
  const vv = rx * rx + ry * ry + b.vel.z * b.vel.z;
  const tc = Math.max(0, Math.min(0.2, -(px * rx + py * ry + pz * b.vel.z) / Math.max(1e-6, vv)));
  const cx = px + rx * tc;
  const cy = py + ry * tc;
  const cz = pz + b.vel.z * tc;
  const off = Math.sqrt(cx * cx + cy * cy + cz * cz * 0.6);
  if (a.side === 'off') {
    // Separation decides it (feedback item 7). The defender best placed to
    // play the ball: how close he is to it at the catch point (in phase is
    // within about a yard; by two yards he's out of it), whether he's
    // playing the ball (read the throw) and his leverage (at the ball as
    // soon as the receiver, or trailing him to it).
    const ball = { x: b.pos.x, y: b.pos.y };
    const mine = dist(a.pos, ball);
    let contest = 0;
    let by: Agent | null = null;
    for (const o of s.agents) {
      if (o.side === a.side || o.down) continue;
      const k = dist(o.pos, ball);
      let w = Math.max(0, Math.min(1, (CONTEST_R - k) / (CONTEST_R - 1)));
      if (w === 0) continue;
      // Not looking for it: he can only play through the receiver's hands.
      w *= o.mem.onBall ? 1 : 0.35;
      // Trailing: each yard farther from the ball than the receiver takes most of it away.
      w *= Math.max(0.25, 1 - Math.max(0, k - mine - 0.3) / 1.2);
      if (w > contest) {
        contest = w;
        by = o;
      }
    }
    // For the stats: how open he was when the ball got to him (the first time).
    if (s.pass && a.i === b.target && s.pass.sep === undefined) {
      let k = 99;
      for (const o of s.agents) if (o.side !== a.side && !o.down) k = Math.min(k, dist(o.pos, ball));
      s.pass.sep = Math.round(Math.min(k, 99) * 100) / 100;
      s.pass.contest = Math.round(contest * 100) / 100;
    }
    const type = s.catchType ?? (contest > 0.3 ? 'possession' : 'rac');
    const hands = a.fx.a('catching');
    const tough = a.fx.a('catchInTraffic');
    const spect = a.fx.a('spectacular');
    // Open and catchable, nothing making it hard: 98% for sure hands (0.9
    // Catching), 92% for poor ones (0.1), the owner's M6.5 #3 numbers (NFL
    // drop rates run ~3% of catchable balls for the best hands, ~7% for the
    // worst). M6 took every open ball down to ~95% and ~90% with a lump
    // "hard" term, so wide-open balls went down for no reason you could see.
    // Now each drop has a cause, and the biggest one is kept for the card.
    const sp = len(a.vel);
    const along = sp > 3 ? (cx * a.vel.x + cy * a.vel.y) / sp : 0;
    const thrower = s.agents[b.thrower]!;
    const range = dist(thrower.pos, a.pos);
    let hit = 0;
    for (const o of s.agents) {
      if (o.side === a.side || o.down) continue;
      const k = dist(o.pos, a.pos);
      if (k > 1.1) continue;
      const closing = ((o.vel.x - a.vel.x) * (a.pos.x - o.pos.x) + (o.vel.y - a.vel.y) * (a.pos.y - o.pos.y)) / Math.max(1e-6, k);
      hit = Math.max(hit, Math.min(1, (1.1 - k) / 0.6) * (closing > 2 ? 1 : 0.4));
    }
    const costs: [CatchHard, number][] = [
      // A hit as the ball arrives (Catch in Traffic holds on through it).
      ['contact', hit * 0.1 * (1.1 - 0.6 * tough)],
      // Thrown behind him: he has to turn back into it at speed.
      ['behind', Math.min(0.15, Math.max(0, -along - 0.3) * 0.12)],
      // A fastball from close range: no time to get the hands right.
      ['bullet', range < 12 ? Math.min(0.08, Math.max(0, vs - 17) * 0.012) : 0],
      // Away from his body: a reach at full stretch (Spectacular Catch for the one-handers).
      ['reach', Math.max(0, off - 0.45) * 0.5 * (1.1 - 0.5 * spect)],
    ];
    const worst = costs.reduce((m, c) => (c[1] > m[1] ? c : m));
    const clean = 0.91 + 0.075 * hands - costs.reduce((t, c) => t + c[1], 0);
    if (s.pass && a.i === b.target && s.pass.hard === undefined) s.pass.hard = worst[1] > 0.02 ? worst[0] : 'hands';
    // In phase: the receiver's Catch in Traffic against the defender's Ball
    // Skills. Contested-catch rates (PFF, NGS) run ~40–50% for the best
    // hands-in-traffic receivers going up for it, ~20–30% for most: here an
    // elite receiver (0.9) against a good defender (0.85) is ~0.33, ~0.43
    // going up; an ordinary one (0.5) ~0.15.
    const defSkill = by ? by.fx.a('ballSkills') : 0.5;
    const cont = 0.12 + 0.38 * tough + 0.1 * spect - 0.25 * defSkill + (type === 'aggressive' ? 0.1 : type === 'possession' ? 0.04 : -0.12);
    let p = clean + (Math.min(clean, cont) - clean) * Math.min(1, contest);
    if (a.fx.r('catching', -1) < 0) p -= 0.3; // linemen and QBs
    p = Math.max(0.02, Math.min(0.985, p));
    if (rng() < p) return 'catch';
    // A contested ball is mostly broken up; an open one that's missed is a drop (or off his fingertips).
    return contest > 0.4 && rng() < 0.8 ? 'deflect' : off < 0.8 ? 'drop' : 'miss';
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
  // A defender there first gets a hand on it about half the time when he's
  // right in its path; what he doesn't reach, the receiver still has to catch
  // through him (the in-phase roll above), so contested balls mostly fail
  // without being decided by this first touch alone.
  const pBreak = (0.2 + 0.3 * skill) * close;
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
    // A defender who's been out of bounds can't make a play on it.
    if (a.down || s.touched.includes(a.i) || a.i === b.thrower || (a.side === 'def' && a.mem.outOfPlay)) continue;
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
