// Throwing and catching (GDD §9.1–9.2). A throw is committed at the start of
// the release motion: the QB leads his receiver to a catch point, the
// placement input moves it (lead / back shoulder / high / low), and the
// error cone from his accuracy (times on-the-run, pressure, bullet and
// footwork factors) moves it again. The catch is resolved when the ball
// reaches a pair of hands: base Catching, ball speed, how far the ball is
// from the ideal spot, defenders in the catch window, and the catch type.

import { fitArm, G, solveLaunch, speed3, stepFlight, type V3 } from './ball';
import { errorAt20, maxRange, maxThrowSpeed, releaseTime } from './effects';
import { stepRoute } from './ai';
import { steer } from './movement';
import { blockOf } from './blocks';
import { gauss } from './rand';
import { exp } from '@/engine/math/detmath';
import type { PlayState } from './state';
import type { CatchType } from './input';
import { has, more } from './traits';
import { FIELD_HALF_W, GOAL_X, TICK, type Agent, type CatchHard, type OffSlot } from './types';
import { dist, len, type V2 } from './vec';

/** Ball height at a comfortable catch (chest), yd. */
export const CATCH_Z = 1.25;
/** Release height above the QB's feet, yd (the ball leaves over the helmet). */
const RELEASE_Z = 2.15;
/** yd/s per mph. */
const MPH = 1760 / 3600;

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
  return leadRun(r, T).pos;
}
/** lead(), and the way he'll be running there (his velocity at the catch point). */
export function leadRun(r: Agent, T: number): { pos: V2; vel: V2; offScript: number; settled: number } {
  const rt = r.route;
  if (!rt) {
    // No route: on along the way he's going, flat out.
    const sp = len(r.vel);
    if (sp < 0.5) return { pos: { x: r.pos.x, y: r.pos.y }, vel: { x: r.vel.x, y: r.vel.y }, offScript: 0, settled: 0 };
    const d = fullSpeedRun(r, T);
    return { pos: { x: r.pos.x + (r.vel.x / sp) * d, y: r.pos.y + (r.vel.y / sp) * d }, vel: { x: r.vel.x, y: r.vel.y }, offScript: 0, settled: 0 };
  }
  // Settled on a sit route: he's there (and has been sitting for all of the flight).
  if (rt.idx >= rt.pts.length && rt.sit[rt.pts.length - 1]) return { pos: { x: r.pos.x, y: r.pos.y }, vel: { x: 0, y: 0 }, offScript: 0, settled: T };
  // Run his route forward on a copy of him, tick by tick, on the movement
  // model he really runs on (ai.ts stepRoute: the stem at ~92%, braking
  // into each break, the plant, building back up, and every turn rounded at
  // his Agility). M6.5 #6 ran the route's straight legs instead; a bend he
  // runs round at speed (the slant flattening at 7 yd turns ~25°) he
  // really swings a yard wide of, so the second-pass slant dumps had the
  // driven ball arriving ~1.1 yd off him, mostly across his run, and a
  // third of them where nobody could reach (tools/sim/slantdump.ts).
  const g: Agent = { ...r, pos: { x: r.pos.x, y: r.pos.y }, vel: { x: r.vel.x, y: r.vel.y }, route: { pts: rt.pts, sit: rt.sit, idx: rt.idx }, mem: { room: r.mem.room ?? null, window: r.mem.window ?? null } };
  const n = Math.min(LEAD_TICKS, Math.floor(T / TICK));
  // When he runs past the route's last point (s from now; 0 if he's past it already, T if he never is).
  let ends = rt.idx >= rt.pts.length ? 0 : T;
  for (let k = 0; k < n; k++) {
    if (ends === T && g.route!.idx >= rt.pts.length) ends = k * TICK;
    // Jammed at the line, he's held there until he gets off it (runRoute).
    if (g.busy > 0) {
      g.busy--;
      steer(g, { x: 0, y: 0 });
    } else if (!stepRoute(g)) return { pos: g.pos, vel: g.vel, offScript: 0, settled: T - k * TICK };
  }
  // The part-tick left, and past the cap (a throw hanging more than LEAD_TICKS), on the way he's going.
  const rest = T - n * TICK;
  return { pos: { x: g.pos.x + g.vel.x * rest, y: g.pos.y + g.vel.y * rest }, vel: g.vel, offScript: rt.idx >= rt.pts.length ? OFF_SCRIPT : T - ends, settled: 0 };
}
/** The longest a lead runs his route forward (ticks: 4 s, longer than any throw hangs). */
const LEAD_TICKS = 240;

/**
 * Hang time of a driven ball, the default throw, s from release to the catch
 * point. From a 90 arm: ~0.49 s at 10 yd, ~0.73 s at 20, ~1.13 s at 30,
 * ~1.53 s at 40. Playtest 1 found the round-two times (0.6 s at 10, 0.9 at
 * 20) slow and floaty: the ball hung so long that every throw had to be
 * aimed 8–19 yd ahead of the man (tools/sim/lead.ts). An NFL bullet leaves
 * the hand at ~25–29 yd/s, so 20 yd on a line with a little arc is
 * ~0.7–0.75 s. Steeper past 20 as a deep ball needs arc to carry; the
 * slope stays under ~0.05 s/yd so the lead doesn't run away (a receiver at
 * ~10 yd/s moves the catch point ~10 yd for every second of hang). A
 * weaker arm takes longer in proportion to its top speed; the throw is
 * never faster than the arm can make it (planThrow).
 */
export function driveTime(d: number, power: number): number {
  const base = 0.25 + 0.024 * Math.min(d, 20) + 0.04 * Math.max(0, d - 20);
  return base * (maxThrowSpeed(90) / maxThrowSpeed(power));
}

/**
 * The quickest his arm can get a ball `d` yd (release height to the catch,
 * with drag): the flat solution at his top speed. Short of ~30 yd it's well
 * under the driven time and changes nothing; on a long throw it's the arm
 * that sets the arc, and the gap between arms grows with the distance (the
 * ball has to go up to get there): a 46-yd throw is ~2.0 s from a 96 arm
 * and ~2.5 s from a 72 (tools/sim/ballarc.ts). Passing round 2: the QB's
 * read (ai.ts openness) judged a deep window on driveTime alone, so a
 * 72 arm read a 46-yd seam as a 2.15-s ball and threw a 2.5-s one into the
 * safety; now the read and the throw use the same clock (throwTime).
 */
export function armTime(d: number, vmax: number): number {
  const key = Math.round(vmax * 1000);
  let tab = ARM_T.get(key);
  if (!tab) {
    tab = armTable(vmax);
    ARM_T.set(key, tab);
  }
  const f = Math.max(0, Math.min(ARM_D - 1, d));
  const i = Math.min(ARM_D - 2, Math.floor(f));
  return tab[i]! + (tab[i + 1]! - tab[i]!) * (f - i);
}
/** The arm tables' reach (yd, 1-yd steps) and the tables by top speed (a pure function of it, filled on first use). */
const ARM_D = 81;
const ARM_T = new Map<number, number[]>();
function armTable(vmax: number): number[] {
  const out: number[] = [];
  for (let d = 0; d < ARM_D; d++) {
    const from: V3 = { x: 0, y: 0, z: RELEASE_Z };
    const to: V3 = { x: Math.max(0.5, d), y: 0, z: CATCH_Z };
    const sp = (t: number) => speed3(solveLaunch(from, to, t));
    // The bottom of the speed curve; the flat solution lies between a bullet and it.
    let lo = 0.05;
    let hi = 7;
    for (let k = 0; k < 26; k++) {
      const m1 = lo + (hi - lo) * 0.382;
      const m2 = lo + (hi - lo) * 0.618;
      if (sp(m1) < sp(m2)) hi = m2;
      else lo = m1;
    }
    const tMin = (lo + hi) / 2;
    if (sp(tMin) > vmax) {
      out.push(tMin);
      continue;
    }
    let a = 0.05;
    let b = tMin;
    for (let k = 0; k < 22; k++) {
      const m = (a + b) / 2;
      if (sp(m) > vmax) a = m;
      else b = m;
    }
    out.push(b);
  }
  return out;
}

/** The hang of the throw he'd make to a spot `d` yd away, driven: the arm's driven time, or longer when his arm can't get it there that fast. */
export function throwTime(d: number, qb: Agent): number {
  return Math.max(driveTime(d, qb.fx.r('throwPower')), armTime(d, arm(qb).vmax));
}

/**
 * The AI QB's deep ball is layered, not driven (the coaching line on a
 * vertical: drop it in over the outside shoulder, between the corner and the
 * safety). M5.5–M6.6 threw every AI ball as the driven one, so a 40-yd post
 * left at ~60 mph on a 15° line, 4 m at its apex, and landed in ~1.5 s: a
 * frozen rope no NFL deep ball is (a 50-yd deep ball hangs ~2.2–2.8 s on the
 * broadcast). Past LAYER_FROM yd of throw he puts air on it, a full touch
 * pass's worth by LAYER_FULL, never more than LAYER_MAX (he still wants it
 * there before the safety). Distances and the cap are ours, sized on that
 * hang. The player's own throws are his: a tap drives it, a hold layers it.
 * The read (ai.ts openness) still judges the window on the driven ball: he
 * reads the receiver's leverage, then layers it, and the extra hang is the
 * deep ball's real risk (the safety gets there). Judging the window on the
 * layered hang held every deep ball too long: sacks 6.8% → 8.4% of
 * dropbacks, ypa 8.6 → 7.3 (tools/sim/outcomes.ts; docs/passing/PASSING.md).
 */
export function layer(d: number): number {
  return LAYER_MAX * Math.max(0, Math.min(1, (d - LAYER_FROM) / (LAYER_FULL - LAYER_FROM)));
}
const LAYER_FROM = 24;
const LAYER_FULL = 44;
const LAYER_MAX = 0.8;

/**
 * A touch pass (the icon held): the driven time stretched by 10% for a
 * quick hold up to 30% for a full one (Playtest 1: less float than the
 * 15–35% before), and it leads him (HOLD_LEAD).
 */
export const touchStretch = (loft: number): number => 1.1 + 0.2 * Math.max(0, Math.min(1, loft));
/** How far a full hold leads him past the catch point along his run, yd (Playtest 1: a tap puts it on him, a hold throws him open). */
const HOLD_LEAD = 1.5;
/** A QB moving slower than this (yd/s) is setting his feet, not throwing on the run. */
const ONRUN_FREE = 2;

/** An engaged rusher this close to the release (yd) still makes the QB put air on it: he's in his lap (the bat at the line reaches 0.7 yd round the ball's path; a step more for his arms coming up). */
export const LAP_R = 1.5;

/**
 * Stretch a throw's hang time until it clears the defenders under its path:
 * a defender near the line of the throw (within ~0.9 yd, where he'd be as
 * it passes) who could reach the ball's height there makes the QB put air
 * under it. Up to four 12% steps; if that still doesn't clear him, it's
 * thrown on a line anyway (he's on the catch point: see the end).
 */
function clearLoft(s: PlayState, from: V3, to: V3, T0: number): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const L2 = dx * dx + dy * dy;
  let T = T0;
  if (L2 < 1) return T;
  for (let step = 0; step < 4; step++) {
    let blocked = false;
    for (const i of s.def) {
      const d = s.agents[i]!;
      if (d.down) continue;
      // A rusher locked up with a blocker isn't in the lane: he can't leave
      // the block to undercut it, and the QB throws over the scrum on a line
      // (the AI's read, ai.ts openness, already ignores engaged linemen).
      // Only one driven back into the QB's lap, within LAP_R, has the ball
      // over his hands as it leaves (batAtLine's tipped ball at the line).
      if (blockOf(s, i) && dist(d.pos, from) > LAP_R) continue;
      for (const u of [0.25, 0.4, 0.55, 0.7, 0.85]) {
        const t = u * T;
        const px = d.pos.x + d.vel.x * Math.min(t, 0.4);
        const py = d.pos.y + d.vel.y * Math.min(t, 0.4);
        // The man covering at the catch point isn't under the path: air
        // can't take the ball over him there, it comes down into his hands
        // whatever its arc. (Lofted over him, a 20–30 yd throw with the
        // corner trailing became a 3–5 s moon ball: passing round 2,
        // tools/sim/deeptail.ts.)
        if ((px - to.x) * (px - to.x) + (py - to.y) * (py - to.y) < AT_CATCH * AT_CATCH) continue;
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
  // Air didn't clear him: he's sitting on the catch point, where the ball
  // comes down to the hands whatever its arc (the second-pass slant dumps:
  // every lofted on-time slant was still blocked after the fourth step, all
  // by a linebacker within a yard of the last tenth of its path). Floating it
  // only gives him and everyone else ~0.4 s more to close, so it's thrown on
  // a line, into the window as it is.
  return T0;
}
/** A defender this close to the catch point (yd) is at it, not under the path: CONTEST_R's reach, where he plays the ball at the hands. */
const AT_CATCH = 2.6;

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

/**
 * Timing (M6.6, the second slant pass): how far a running receiver is from
 * the spot the QB led him to, 1σ along his run (yd), a step early or late,
 * a stride long or short. The QB leads him `horizon` seconds ahead: the
 * ball's flight, plus however long he'll have been past the end of his
 * route by then (running on, working free: a spot nobody drew up). It grows
 * with his speed and that horizon, and faster than the horizon: on a slant
 * on rhythm (0.7 s, the drop's last step and the break one motion) it's a
 * few tenths of a yard; on a 2-s deep ball, or a slant thrown a second
 * after the route ran out, a couple of yards. Route running (short or deep
 * for the throw's depth, or the all-round figure if better) takes
 * TIMING_RR of it off for a perfect route runner, chemistry with his QB
 * CHEM_TIMING of what's left. Jerry Rice on time: ~0.45 yd; John Taylor
 * (74 short) ~0.6. M5–M6.6 got this from a bug: the lead ran the route's
 * straight legs while he ran it round, so every throw to a man on a bend
 * landed ~1 yd off him whoever threw it or ran it.
 */
export function timingSigma(s: PlayState, rec: Agent, air: number, speed: number, horizon: number, acc: number): number {
  const rr = Math.max(air < 12 ? rec.fx.a('shortRoute') : rec.fx.a('deepRoute'), rec.fx.a('routeRunning'));
  const chem = Math.max(0, Math.min(1, s.setup.chem?.[rec.slot as OffSlot] ?? 0));
  return TIMING * timingQb(acc, air) * (1 - TIMING_RR * rr) * (1 - CHEM_TIMING * chem) * speed * horizon * Math.min(1, horizon / TIMING_H);
}
/**
 * The QB's share of the timing (passing round 3): on a ball down the field,
 * how well he puts it where his man will be, by his accuracy for the throw's
 * depth. Round two's timing was the receiver's and the chemistry's alone, so
 * Joe Montana's deep ball missed its man along his run by as much as
 * anyone's: ~2.7 yd at 1σ on a 1.7-s go to Jerry Rice, four times his cone,
 * and the player watched a great passer's deep balls land a couple of yards
 * behind or past his man (tools/sim/passing3.ts). An accurate passer leads
 * him: × TIMING_QB_TOP at 99, 1 at TIMING_QB_REF, growing past it for a
 * scattershot arm. It comes in with the depth (none by TIMING_QB_FROM air
 * yards, all of it by TIMING_QB_FULL): on a short ball the timing is the
 * route's (a few tenths of a yard either way), and the AI pass game's
 * completion, held up by the short game, stays in its band. Ours.
 */
export function timingQb(acc: number, air: number): number {
  const k = Math.max(0, Math.min(1, (air - TIMING_QB_FROM) / (TIMING_QB_FULL - TIMING_QB_FROM)));
  return 1 + (TIMING_QB_TOP - 1 + (1 - TIMING_QB_TOP) * Math.max(0, (99 - acc) / (99 - TIMING_QB_REF))) * k;
}
const TIMING_QB_TOP = 0.6;
const TIMING_QB_REF = 85;
const TIMING_QB_FROM = 8;
const TIMING_QB_FULL = 20;
/**
 * Calibrated on the AI pass game (tools/sim/outcomes.ts, 20 a cell): with
 * the lead running his real path and no timing, the 80s 49ers completed
 * 74% against the Beasts for 9.5 yd an attempt, open men catching 95% of
 * their targets (PFF's ~80%: tests/outcomes.test.ts); 0.4 (and the
 * receiver tracking the ball, play.ts runToBall) puts them at 69% and 8.4,
 * open men at 89%.
 */
const TIMING = 0.4;
/** The horizon (s) past which it grows only with the horizon, not faster: a deep ball's hang. */
const TIMING_H = 2;
/** A perfect route runner takes 60% of it off: where he is is mostly how he runs it. */
const TIMING_RR = 0.6;
/** Full chemistry takes half of what's left (CHEM_CONE and CHEM_FIND's kind: a timing bonus, not a new receiver). */
const CHEM_TIMING = 0.5;
/** A man already past his route's end at the throw counts as this long past it (s) at the catch (when he ran out of it isn't kept). */
const OFF_SCRIPT = 1;

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
  /**
   * How tight the spiral is (1 a tight spiral … 0 a wounded duck) and its
   * spin (rpm): the throw's own mechanics, for the drawn ball (render only;
   * the outcome is the error above). See spiralOf.
   */
  spiral: number;
  rpm: number;
  /** He was hit as he let it go: the arm never finished (HIT_HANG, HIT_CONE). */
  hit: boolean;
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
  /** The timing error's 1σ along his run (yd): his speed, the horizon, his route running and the chemistry (timingSigma). */
  timing: number;
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
/** His arm: the bullet's speed (yd/s) and the longest throw (yd). Cannon: +2 mph and 4 yd; Noodle Arm: 5 yd less (the trait catalog's lines). */
export function arm(qb: Agent): { vmax: number; range: number } {
  const power = qb.fx.r('throwPower');
  return { vmax: maxThrowSpeed(power) + (has(qb, 'cannon') ? 2 * MPH : 0), range: maxRange(power) + (has(qb, 'cannon') ? 4 : 0) - (has(qb, 'noodle-arm') ? 5 : 0) };
}

/** Wind-up to release (s): his Release rating, 0.04 s quicker for a Quick Trigger (the trait catalog's line). */
export function releaseOf(qb: Agent): number {
  return releaseTime(qb.fx.r('release')) - (has(qb, 'quick-trigger') ? 0.04 : 0);
}

/**
 * Where the ball meets him: the flight time iterated against where he'll be
 * (`hang` is the flight to a spot), and the way he'll be running there.
 */
function leadFor(rec: Agent, hang: (at: V2) => number, from: V2): { spot: V2; rv: V2; T: number; speed: number; offScript: number } {
  let T = 0.8;
  let run = leadRun(rec, T);
  let spot = run.pos;
  for (let k = 0; k < 4; k++) {
    T = hang(spot);
    run = leadRun(rec, T);
    spot = comeBackTo(rec, run.pos, run.settled, from);
  }
  // Coming back to it on a settle route: the way he'll be moving at the catch is at the QB.
  if (spot !== run.pos) {
    const dx = from.x - run.pos.x;
    const dy = from.y - run.pos.y;
    const k = Math.sqrt(dx * dx + dy * dy) || 1;
    return { spot, rv: { x: dx / k, y: dy / k }, T, speed: len(run.vel), offScript: run.offScript };
  }
  const v = len(run.vel) > 0.5 ? run.vel : rec.vel;
  const sp = len(v);
  return { spot, rv: sp > 0.5 ? { x: v.x / sp, y: v.y / sp } : { x: 1, y: 0 }, T, speed: len(run.vel), offScript: run.offScript };
}

/**
 * Coming back to the ball (passing round 3): a man sat down on a settle
 * route (a curl, a comeback, a hitch, a spot) doesn't wait for it standing
 * still. He sits, squares to the QB, and as it comes he drives back down the
 * line to it (the coaching point on every settle route: "come back to the
 * football", so the defender on his back can't undercut it). He's sat for
 * `settled` s before the ball gets there (passing.ts leadRun); after a beat
 * (COME_SET) he comes at COME_V, at most COME_MAX yd, a sharp route runner a
 * little further (he's out of his break and back to it quicker). The QB
 * throws to where he'll meet it, as he throws every man to where he'll be.
 * Before this the ball was thrown to the spot where he stood, and the
 * player watched his curl and comeback runners stand still with the ball in
 * the air (the owner: "a comeback comes back to the ball").
 */
export function comeBackTo(rec: Agent, at: V2, settled: number, from: V2): V2 {
  if (settled <= 0 || !rec.route || !comesBack(rec.route)) return at;
  // Sat down already, he takes a beat (COME_SET) to go; still on his way into the settle, he carries on through it.
  const sat = rec.route.idx >= rec.route.pts.length;
  const rr = Math.max(rec.fx.a('shortRoute'), rec.fx.a('routeRunning'));
  const d = Math.min(COME_MAX * (0.6 + 0.4 * rr), COME_V * Math.max(0, settled - (sat ? COME_SET : 0)));
  if (d <= 0) return at;
  const dx = from.x - at.x;
  const dy = from.y - at.y;
  const k = Math.sqrt(dx * dx + dy * dy);
  if (k < 3 * d) return at;
  return { x: at.x + (dx / k) * d, y: at.y + (dy / k) * d };
}
/**
 * A settle route whose last leg turns back toward the line (the curl, the
 * comeback, the hitch): the ones coached to come back to the ball. A flat,
 * a spot or a checkdown settles on its way out, facing the QB, and the ball
 * comes to him there (coming back off those is turning round).
 */
export function comesBack(rt: { pts: V2[]; sit: boolean[] }): boolean {
  const n = rt.pts.length;
  return n >= 2 && rt.sit[n - 1] === true && rt.pts[n - 1]!.x < rt.pts[n - 2]!.x - 0.5;
}
/** The pace (yd/s) he comes back to the ball at: two hard steps, about half his speed. Ours, from the broadcast's curls and comebacks. */
export const COME_V = 4;
/** The beat (s) he's sat, square to the QB, before he comes back to it. Ours. */
const COME_SET = 0.15;
/** The most he comes back (yd), for a perfect route runner (60% of it for a 0): about two steps. Ours. */
const COME_MAX = 1.5;

export function planThrow(s: PlayState, qb: Agent, rec: Agent, loft: number, aim: V2, pressure: number, offPlatform: boolean, hit = false): ThrowPlan {
  const power = qb.fx.r('throwPower');
  const { vmax, range } = arm(qb);
  const touch = loft > 0;
  const from: V3 = { x: qb.pos.x + qb.vel.x * 0.1, y: qb.pos.y + qb.vel.y * 0.1, z: RELEASE_Z * (qb.fx.height / 2.08) };
  const hang0 = (to: V3) => Math.max(driveTime(dist(from, to), power) * (touch ? touchStretch(loft) : 1), armTime(dist(from, to), vmax));
  // Hit as he throws: he led him for the ball he meant, but the arm never
  // finishes, so it comes out slow and fluttering (HIT_HANG) and arrives late, behind him.
  const hang = (to: V3) => hang0(to) * (hit ? HIT_HANG : 1);
  // Lead the receiver: iterate the flight time against where he will be.
  // (M5 to M6.6 led him for 0.05 s more than the ball flies, with no reason
  // given: the driven slant landed ~0.5 yd in front of him, and with the
  // cone on top a fifth of them out of his reach. On time is on him.)
  const { spot, rv, speed: recSpeed, T: leadT, offScript } = leadFor(rec, (at) => hang0({ x: at.x, y: at.y, z: CATCH_Z }), from);
  // Placement input: lead / back shoulder along his path (the way he'll be running at the catch), high / low.
  const place = 1.6 * aim.x + HOLD_LEAD * Math.max(0, Math.min(1, loft));
  let tx = spot.x + rv.x * place;
  let ty = spot.y + rv.y * place;
  let tz = CATCH_Z + 0.55 * aim.y;
  const meant = { x: tx, y: ty };
  const d = dist(from, { x: tx, y: ty });
  // Error cone (GDD §9.1): the accuracy for the throw's depth sets the base.
  const air = tx - s.setup.los;
  const acc = air < 12 ? qb.fx.r('shortAcc') : air < 25 ? qb.fx.r('midAcc') : qb.fx.r('deepAcc');
  const base = errorAt20(acc);
  // Throwing on the run (Playtest 2: a core skill here, the QB is always
  // moving). A drift in the pocket is free (under ONRUN_FREE yd/s); past it
  // the cost grows with his speed and with how far outside the pocket he is
  // (the tackles are ~3 yd out, a rollout's launch point ~8). A good passer
  // on the move is accurate within that window; a poor one sprays it.
  const speedOn = Math.min(1, Math.max(0, len(qb.vel) - ONRUN_FREE) / 4);
  const wideOut = Math.min(1, Math.max(0, Math.abs(qb.pos.y - (s.setup.ballY ?? 0)) - 4) / 6);
  const moving = Math.min(1, 0.7 * speedOn + 0.3 * wideOut * (speedOn > 0 ? 1 : 0.5));
  // The cone grows only for a reason (M6.5 #1), and every reason costs even
  // the best something: throwing on the move, a rusher in his face, feet not
  // set. His rating decides how much (M6 scaled by 1 − rating alone, so a
  // Montana under a free rusher threw exactly as he did from a clean pocket).
  // Off Platform: on the run or off balance, half the usual cost. Ice in
  // His Veins: pressure widens it half as much; Happy Feet: a rusher on him
  // (pressure past ~0.6, inside 2 yd) 25% more (the trait catalog's lines).
  const platformK = has(qb, 'off-platform') ? 0.5 : 1;
  const pressK = (has(qb, 'ice-veins') ? 0.5 : 1) * (pressure > 0.6 && has(qb, 'happy-feet') ? 1.25 : 1);
  const fMoving = 1 + platformK * moving * (0.15 + 0.9 * (1 - qb.fx.a('throwOnRun')));
  const fPressure = 1 + pressK * pressure * (1.0 + 1.2 * (1 - qb.fx.a('underPressure')));
  const fPlatform = offPlatform ? 1 + 0.25 * platformK : 1;
  // The throw itself, by the catalog: a Deep Ball Artist's 30+ yd throws
  // 20% tighter; a Red Zone Sniper's into the end zone inside the 20, 20%;
  // a Laser's driven ball over the middle at 10–20 yd, 15% (his "no bullet
  // penalty"); a placed ball (back shoulder, high or low, away from
  // leverage) costs everyone 10% of cone except a Surgeon short and intermediate.
  const inMiddle = Math.abs(ty) < 9;
  const placed = Math.abs(aim.x) > 0.2 || Math.abs(aim.y) > 0.2;
  const fTrait =
    (air >= 30 && has(qb, 'deep-ball-artist') ? 0.8 : 1) *
    (s.setup.los >= GOAL_X - 20 && tx > GOAL_X && has(qb, 'red-zone-sniper') ? 0.8 : 1) *
    (!touch && inMiddle && air >= 10 && air <= 20 && has(qb, 'laser') ? 0.85 : 1) *
    (placed && !(air < 25 && has(qb, 'surgeon')) ? 1.1 : 1);
  // Chemistry with this receiver (M6.5 #6): a tighter cone, up to CHEM_CONE.
  const fChem = 1 - CHEM_CONE * Math.max(0, Math.min(1, s.setup.chem?.[rec.slot as OffSlot] ?? 0));
  const sigma = base * coneScale(d) * fMoving * fPressure * fPlatform * fChem * fTrait * (hit ? HIT_CONE : 1);
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
    hit ? 0.6 : 0.3,
    MISS_ACC * (1 - accN) + pressure * 0.25 * (1.3 - qb.fx.a('underPressure')) + (offPlatform ? 0.05 : 0) + moving * 0.06 * (1.1 - qb.fx.a('throwOnRun')) + deep * 0.04 * (1.2 - accN) + (hit ? HIT_MISS : 0),
  );
  // A sailed ball goes long and high, over his reach; one that dies is
  // short and at his feet (a short hop): either way along the line of the
  // throw, where a receiver can't just drift a step to it.
  const missed = s.rng.throw() < pMiss;
  const sail = s.rng.throw() < 0.55;
  const ux = (tx - from.x) / Math.max(1e-6, d);
  const uy = (ty - from.y) / Math.max(1e-6, d);
  const along = missed ? (sail ? 3 + 1.5 * s.rng.throw() : -(2.5 + s.rng.throw())) : 0;
  // Timing: the QB throws to where this man should be when it gets there;
  // how close he is to it is how long he's been led for (the flight, and any
  // time he's been running on past his route), his speed, his route running
  // and their chemistry (timingSigma). Along his run: a step early or late.
  const tSigma = timingSigma(s, rec, air, recSpeed, leadT + offScript, acc);
  const late = gauss(s.rng.throw) * tSigma;
  const ex = gauss(s.rng.throw) * sigma + along * ux + late * rv.x;
  const ey = gauss(s.rng.throw) * sigma + along * uy + late * rv.y;
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
  // Never out of the hand faster than his arm: flightTime is solved in a
  // vacuum, and drag asks a long throw for more speed than that (a 55-yd
  // ball from a 75 arm left at 58 mph against his 54: tools/sim/ballarc.ts).
  // A weaker arm has to put more air under it instead (ball.ts fitArm).
  const { T: Tf, v0 } = fitArm(from, to, clearLoft(s, from, to, hang(to)), vmax);
  const kind = touch || Tf > hang(to) * 1.01 ? 'touch' : 'driven';
  const err: ThrowError = { acc, base, distance: coneScale(d), moving: fMoving, pressure: fPressure, platform: fPlatform, chem: fChem, place: aim.x, sigma, timing: tSigma, pMiss, miss: missed ? (sail ? 'sail' : 'short') : null, dx: ex, dy: ey, off: Math.sqrt(ex * ex + ey * ey) };
  return { from, to, v0, T: Tf, kind, distance: d, airYards: Math.max(0, air), miss: Math.sqrt(ex * ex + ey * ey + ez * ez), meant, missed, err, spiral: spiralOf(accN, fPressure, offPlatform, moving, missed, hit), rpm: rpmOf(power), hit };
}

/**
 * The spiral's tightness (render only: the drawn ball's wobble; the outcome
 * is the error). A clean throw from a set platform is a tight spiral, a
 * little less so from a less accurate passer; a rusher in his face, his feet
 * not set or throwing on the run cost it some; a ball that got away from him
 * (the mechanics miss) wobbles; a hit as he throws is a wounded duck. Ours,
 * shaped so a clean throw from a 99 passer is ~0.95 and a duck under 0.2.
 */
export function spiralOf(accN: number, fPressure: number, offPlatform: boolean, moving: number, missed: boolean, hit: boolean): number {
  if (hit) return 0.1;
  const q = 0.75 + 0.2 * accN - 0.25 * Math.min(1, (fPressure - 1) / 1.5) - (offPlatform ? 0.1 : 0) - 0.08 * moving - (missed ? 0.35 : 0);
  return Math.round(Math.max(0.15, Math.min(1, q)) * 100) / 100;
}

/**
 * The spiral's spin (rpm): ~600 for an NFL pass (Brancazio, "The physics of
 * football", Phys. Teach. 1985; Rae, Am. J. Phys. 2003, uses 10 rev/s), a
 * little more from a bigger arm (the ±10% by Throw Power is ours).
 */
export function rpmOf(power: number): number {
  return Math.round(600 * (0.9 + 0.2 * Math.max(0, Math.min(1, (power - 60) / 39))));
}

/**
 * Hit as he throws (a rusher wrapped up on him as the ball leaves, play.ts
 * WRAP_THROW): the arm never finishes. The ball comes out ~25% slower (the
 * hang × 1.3), the cone nearly doubles and it gets away from him far more
 * often: the fluttering, short ball that so often ends up picked. Ours, on
 * the broadcast picture of a QB hit in his motion.
 */
const HIT_HANG = 1.3;
const HIT_CONE = 1.8;
const HIT_MISS = 0.3;

/**
 * Where a throw to `rec` would land if it went now, before the error cone:
 * the led catch point with the placement, and the cone's size (1 sigma, yd)
 * for his accuracy at that depth and his motion. Read-only (no dice), for
 * the landing reticle while the user holds an icon.
 */
export function previewThrow(s: PlayState, qb: Agent, rec: Agent, loft: number, aim: V2): { x: number; y: number; sigma: number } {
  const power = qb.fx.r('throwPower');
  const { vmax, range } = arm(qb);
  const touch = loft > 0;
  const from: V3 = { x: qb.pos.x + qb.vel.x * 0.1, y: qb.pos.y + qb.vel.y * 0.1, z: RELEASE_Z * (qb.fx.height / 2.08) };
  const run = leadFor(
    rec,
    (at) => {
      const to = { x: at.x, y: at.y, z: CATCH_Z };
      return Math.max(driveTime(dist(from, to), power) * (touch ? touchStretch(loft) : 1), armTime(dist(from, to), vmax));
    },
    from,
  );
  const { spot, rv } = run;
  let x = spot.x + rv.x * 1.6 * aim.x;
  let y = spot.y + rv.y * 1.6 * aim.x;
  const d = dist(from, { x, y });
  if (d > range) {
    x = from.x + (x - from.x) * (range / d);
    y = from.y + (y - from.y) * (range / d);
  }
  const air = x - s.setup.los;
  const acc = air < 12 ? qb.fx.r('shortAcc') : air < 25 ? qb.fx.r('midAcc') : qb.fx.r('deepAcc');
  // Throwing on the run (Playtest 2: a core skill here, the QB is always
  // moving). A drift in the pocket is free (under ONRUN_FREE yd/s); past it
  // the cost grows with his speed and with how far outside the pocket he is
  // (the tackles are ~3 yd out, a rollout's launch point ~8). A good passer
  // on the move is accurate within that window; a poor one sprays it.
  const speedOn = Math.min(1, Math.max(0, len(qb.vel) - ONRUN_FREE) / 4);
  const wideOut = Math.min(1, Math.max(0, Math.abs(qb.pos.y - (s.setup.ballY ?? 0)) - 4) / 6);
  const moving = Math.min(1, 0.7 * speedOn + 0.3 * wideOut * (speedOn > 0 ? 1 : 0.5));
  // (The same moving cost as planThrow, Off Platform included, so the reticle tells the truth.)
  const cone = errorAt20(acc) * coneScale(d) * (1 + (has(qb, 'off-platform') ? 0.5 : 1) * moving * (0.15 + 0.9 * (1 - qb.fx.a('throwOnRun'))));
  // ...and the timing along his run, folded in (the reticle is a circle).
  const timing = timingSigma(s, rec, air, run.speed, run.T + run.offScript, acc);
  return { x, y, sigma: Math.sqrt(cone * cone + timing * timing) };
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
  s.events.push({ t: s.t, type: 'throw', who: [qb.i, rec.i], at: { x: plan.to.x, y: plan.to.y }, data: { kind: plan.kind, air: Math.round(plan.airYards), ...(plan.missed ? { missed: true } : {}), ...(plan.hit ? { hit: true } : {}), spiral: plan.spiral, rpm: plan.rpm, ...throwErrData(plan) } });
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
  // A throw off by a yard with a reason that widened his cone by 8%+ names it (Playtest 2: a good passer on the run widens it only ~10–20%, and that miss is still "on the run").
  return k > 1.08 && (e.miss || e.off > 1) ? top : 'clean';
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
 * - highPoint: GO UP on a ball at his shoulders or higher, or a ball over his head, taken at the top of his jump;
 * - overShoulder: a deep ball dropping in over him as he runs away from the throw;
 * - toeTap: on the sideline, feet dragged in bounds;
 * - body: SECURE, cradled into the chest (he goes down with it in traffic);
 * - hands: RUN, the hands catch in stride.
 */
/** A GO UP call jumps only for a ball arriving this high (yd, about his shoulders): below it the jump reads as leaping over the ball (the M6.5 #5 in-game capture). */
const GO_UP_Z = 1.75;
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
  // GO UP leaps only for a ball at the shoulders or higher (GO_UP_Z); lower, he attacks it with his hands.
  if ((call === 'aggressive' && at.z > GO_UP_Z) || at.z > 2.35) return 'highPoint';
  if (air >= 18 && fromBehind) return 'overShoulder';
  if (FIELD_HALF_W - Math.abs(at.y) < 1.2) return 'toeTap';
  if (call === 'possession') return 'body';
  return 'hands';
}

/**
 * The one-button catch (Space / A in the air): the call a receiver would make
 * himself from what he sees as the ball comes. A defender who'll be at the
 * catch point with him: go up for a ball at the shoulders or higher (or deep),
 * else secure it through the hit. At the sideline: secure it and get both feet
 * down. Open: catch it in stride and run.
 */
export function autoCatch(s: PlayState): CatchType {
  const r = s.ball.target >= 0 ? s.agents[s.ball.target]! : null;
  const at = s.ball.aim;
  if (!r) return 'rac';
  let near = Infinity;
  for (const o of s.agents) if (o.side !== r.side && !o.down) near = Math.min(near, dist(o.pos, { x: at.x, y: at.y }));
  const contested = near < AUTO_CONTEST;
  if (contested && (at.z > GO_UP_Z || at.x - s.setup.los > 18)) return 'aggressive';
  if (contested || FIELD_HALF_W - Math.abs(at.y) < AUTO_SIDELINE) return 'possession';
  return 'rac';
}
/**
 * Body position in the 50/50 ball (Playtest 2, identity harness): the
 * contested-catch chance per unit of the receiver's share of the pair's mass
 * (2·m/(m + m_d) − 1, about ±0.1 between a 175-lb and a 215-lb man against a
 * 205-lb corner) and per unit of Strength over the defender's. Catch in
 * Traffic and the high point alone had Anquan Boldin (217 lb, Strength 56)
 * winning the ball in a crowd ~7 points more often than DeSean Jackson
 * (175 lb, 43), with the box-out that made Boldin who he was not counted at
 * all. Owner-feel numbers, sized so body alone is ~4 points of contested
 * catch rate between those two (×0.8 on a ball at the chest, ×0.5 above
 * the shoulders, where the high point decides more; PFF's charting has the big possession
 * receivers ~15–25 points over the light speed men in contested catches;
 * Catch in Traffic and reach carry the rest). A wide receiver against a
 * corner averages out (201 and 200 lb, Strength 51 and 50 across the
 * snapshot); a tight end on a safety gains, a back on a linebacker loses.
 */
const BOX_MASS = 0.4;
const BOX_STR = 0.25;
/** A defender within this of the catch point (yd) makes it a contested ball for the one-button catch. */
const AUTO_CONTEST = 2;
/** Within this of the sideline (yd) the one-button catch secures it for the toe tap. */
const AUTO_SIDELINE = 1.5;

/** How far a player can reach for a ball: standing reach plus a jump. */
export function reach(a: Agent): { r: number; top: number } {
  const jump = a.fx.a('jumping') * 0.35 + 0.15;
  // Skyscraper: +6 inches at the high point; Basketball Body: +4 inches on
  // the jump ball (the trait catalog's lines).
  const tall = (has(a, 'skyscraper') ? 6 / 36 : 0) + (has(a, 'basketball-body') ? 4 / 36 : 0);
  return { r: 0.75 + a.fx.height * 0.05, top: a.fx.height * 1.28 + jump + tall };
}

/** The biggest single catch cost. */
const worstOf = (costs: readonly [CatchHard, number][]): number => costs.reduce((m, c) => Math.max(m, c[1]), 0);

/**
 * Resolve a ball arriving at an agent. Returns what happened; the caller
 * applies it (possession, a live deflection, or the ball flying on).
 */
export function resolveCatch(s: PlayState, a: Agent): 'catch' | 'bobble' | 'drop' | 'deflect' | 'int' | 'miss' {
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
    let hitBy: Agent | null = null;
    for (const o of s.agents) {
      if (o.side === a.side || o.down) continue;
      const k = dist(o.pos, a.pos);
      if (k > 1.1) continue;
      const closing = ((o.vel.x - a.vel.x) * (a.pos.x - o.pos.x) + (o.vel.y - a.vel.y) * (a.pos.y - o.pos.y)) / Math.max(1e-6, k);
      const h = Math.min(1, (1.1 - k) / 0.6) * (closing > 2 ? 1 : 0.4);
      if (h > hit) {
        hit = h;
        hitBy = o;
      }
    }
    const costs: [CatchHard, number][] = [
      // A hit as the ball arrives (Catch in Traffic holds on through it; a
      // Missile's hit dislodges it 15% more often, Sure Hands never lets a hit
      // cost him the ball: the trait catalog's lines).
      ['contact', hit * 0.1 * (1.1 - 0.6 * tough) * (hitBy && has(hitBy, 'missile') ? 1.15 : 1) * (has(a, 'sure-hands') ? 0 : 1)],
      // Thrown behind him: he has to turn back into it at speed.
      ['behind', Math.min(0.15, Math.max(0, -along - 0.3) * 0.12)],
      // A fastball from close range: no time to get the hands right.
      ['bullet', range < 12 ? Math.min(0.08, Math.max(0, vs - 17) * 0.012) : 0],
      // Away from his body: a reach at full stretch (Spectacular Catch for the one-handers).
      // Highlight Reel: one-handed and diving catches 15% more often (about
      // 0.6 of the cost at the reaches where it's a ~40% catch); a Body
      // Catcher 10% less often away from his frame.
      ['reach', Math.max(0, off - 0.45) * 0.5 * (1.1 - 0.5 * spect) * (has(a, 'highlight-reel') ? 0.6 : 1) + (off > 0.45 && has(a, 'body-catcher') ? 0.1 : 0)],
      // On him before he's had his eyes on it long enough to get his hands
      // right (findsBallAt: sure hands find it sooner): the ball that's in
      // on him coming out of his break. A good-hands man has ~LOOK_T on a
      // quick slant; a poor one sees it a beat late and fights it.
      ['late', LATE_K * Math.max(0, 1 - (s.t - findsBallAt(s, a)) / LOOK_T) * (1.1 - hands)],
      // Over his shoulder on a deep ball coming from behind him: he has to
      // track it in the air and catch it where he can't see his hands (PFF
      // charts deep drop rates well above short ones).
      ['tracking', overShoulder(s, a) ? TRACK_K * (1.1 - hands) * (1.1 - 0.4 * spect) : 0],
    ];
    // Alligator Arms: a defender closing on a crossing route, −10%.
    if (hit > 0.3 && Math.abs(a.vel.y) > Math.abs(a.vel.x) && has(a, 'alligator-arms')) costs.push(['contact', 0.1]);
    const worst = costs.reduce((m, c) => (c[1] > m[1] ? c : m));
    const routine = worstOf(costs) < 0.02;
    // Drops: routine catches carry 4% on top of his Catching. Glue Hands:
    // +5% on catchable balls in stride and never a routine drop. Sure Hands:
    // +5% over the middle (between the numbers). Chain Mover: +5% on third
    // down past the sticks. (The trait catalog's lines.)
    const middle = Math.abs(a.pos.y) < 9;
    const sticks = (s.setup.down ?? 1) >= 3 && a.pos.x - s.setup.los >= s.setup.toGo;
    // (Checkdown Charlie: his back or tight end in the flat, +5%.)
    const checkdown = (a.p.pos === 'RB' || a.p.pos === 'TE') && a.pos.x - s.setup.los < 5 && has(thrower, 'checkdown-charlie');
    const bonus = (checkdown ? 0.05 : 0) + (has(a, 'glue-hands') ? 0.05 : 0) + (middle && has(a, 'sure-hands') ? 0.05 : 0) + (sticks && has(a, 'chain-mover') ? 0.05 : 0) - (routine && has(a, 'drops') ? 0.04 : 0);
    const clean = 0.91 + 0.075 * hands + bonus - costs.reduce((t, c) => t + c[1], 0);
    if (s.pass && a.i === b.target && s.pass.hard === undefined) s.pass.hard = worst[1] > 0.02 ? worst[0] : 'hands';
    // In phase: the receiver's Catch in Traffic against the defender's Ball
    // Skills. Contested-catch rates (PFF, NGS) run ~40–50% for the best
    // hands-in-traffic receivers going up for it, ~20–30% for most: here an
    // elite receiver (0.9) against a good defender (0.85) is ~0.33, ~0.43
    // going up; an ordinary one (0.5) ~0.15.
    //
    // Playtest 2 (identity harness): the M6 line, 0.12 + 0.38·CIT, spread
    // the whole 0–99 scale over 38 points, so across the band real receivers
    // live in (Catch in Traffic ~70–99) Fitzgerald, Megatron and Boldin won
    // the 50/50 ball no more often than DeSean Jackson or Keenan Allen. Now
    // the slope is spent where the players are: ~0.49 for a 99 against a
    // good defender, ~0.33 for an 84, ~0.22 for a 73 (the PFF range, elite
    // hands in traffic to a speed receiver who isn't one).
    const defSkill = by ? by.fx.a('ballSkills') : 0.5;
    let cont = 0.33 + 1.0 * (tough - 0.84) + 0.1 * (spect - 0.8) - 0.3 * (defSkill - 0.8) + (type === 'aggressive' ? 0.1 : type === 'possession' ? 0.04 : -0.12);
    if (by) {
      // The high point: the taller man who jumps higher gets his hands on it
      // first (up to ±0.06 for a head's height of reach).
      const high = cz > 0.35 ? 1 : 0.4;
      cont += 0.06 * high * Math.max(-1, Math.min(1, (reach(a).top - reach(by).top) / 0.4));
      // Body position: the hand fight for the spot at the catch point. The
      // bigger, stronger man holds his spot and keeps the other's hands off
      // the ball; above the shoulders it's more the high point than the body
      // (see BOX_MASS).
      cont += (1 - 0.5 * high) * (BOX_MASS * ((2 * a.fx.mass) / (a.fx.mass + by.fx.mass) - 1) + BOX_STR * (a.fx.a('strength') - by.fx.a('strength')));
      // Mismatch: against a smaller man at the high point, +10%.
      if (cz > 0.35 && by.fx.height < a.fx.height && has(a, 'mismatch')) cont *= 1.1;
      // Big Body: boxing him out, the ball in front of the defender, +10%.
      if (mine < dist(by.pos, ball) && has(a, 'big-body')) cont *= 1.1;
      // Big Slot: against a nickel or dime back, +10%.
      if (by.p.pos === 'CB' && by.slot !== 'LCB' && by.slot !== 'RCB' && has(a, 'big-slot')) cont *= 1.1;
      // Breakup Machine: the ball is knocked away 10% more often.
      if (has(by, 'pbu-machine')) cont = 1 - (1 - cont) * 1.1;
    }
    // Contested Catch King: wins the 50/50 ball 15% more often. Red Zone
    // Threat: inside the 20, +10% on the fade and back shoulder.
    cont *= more(a, 'contested-catch-king', 0.15) * (s.setup.los >= GOAL_X - 20 && has(a, 'red-zone-threat') ? 1.1 : 1);
    let p = clean + (Math.min(clean, cont) - clean) * Math.min(1, contest);
    // Glue Hands: a routine ball is never dropped.
    if (routine && contest < 0.3 && has(a, 'glue-hands')) p = Math.max(p, 0.985);
    if (a.fx.r('catching', -1) < 0) p -= 0.3; // linemen and QBs
    p = Math.max(0.02, Math.min(0.985, p));
    const u = rng();
    // A bobble (passing round 2): the ball in his hands but not secured, the
    // marginal catch either side of the line. It pops up off his hands and
    // he gets a second chance at it as it comes down (play.ts ballStep):
    // `q` his odds then, before whoever has closed on him by then. The band
    // is set so his odds over both chances are the ones above (a bobble
    // isn't a new way to drop it: it's how the close ones look), wider for
    // poorer hands, a faster ball and a hit as it arrives.
    if (off < 0.8 && a.fx.r('catching', -1) >= 0) {
      const q = resecureOdds(a);
      const lo = Math.min(p, BOB_BASE * (1.2 - hands) + BOB_SPEED * Math.max(0, vs - BOB_FAST) + BOB_HIT * hit);
      const hi = (lo * (1 - q)) / q;
      if (u >= p - lo && u < p + hi) {
        s.bobble = { who: a.i, q, t: s.t };
        return 'bobble';
      }
    }
    if (u < p) return 'catch';
    // A contested ball is mostly broken up; an open one that's missed is a drop (or off his fingertips).
    return contest > 0.4 && rng() < 0.8 ? 'deflect' : off < 0.8 ? 'drop' : 'miss';
  }
  // A defender at the ball: he has to be playing it, and close to its path.
  if (!a.mem.onBall && off > 0.45) return 'miss';
  const skill = a.fx.a('ballSkills');
  const ballhawk = has(a, 'ballhawk') ? 0.1 : 0;
  // In front of the intended receiver (undercutting) he can catch it; from behind he mostly knocks it away.
  const r = b.target >= 0 ? s.agents[b.target]! : null;
  // In front means on the QB's side of him and not on his hip: a man trailing him (a step behind along his run, as 2-man's
  // trail technique lives, under him on the QB's side) on a ball led to the receiver reaches across him for it and plays
  // through the hands, a breakup far more often than a pick (M6.6: counted as in front, 2-man picked 10% of the on-time
  // slants thrown blind, tools/sim/slants.ts). A ball thrown behind the receiver is the trailer's to take.
  const rv = r ? len(r.vel) : 0;
  const along = (p: { x: number; y: number }) => (r ? ((p.x - r.pos.x) * r.vel.x + (p.y - r.pos.y) * r.vel.y) / Math.max(1e-6, rv) : 0);
  const onHip = !!r && rv > 2 && dist(a.pos, r.pos) < HIP_R && along(a.pos) < 0 && along(b.pos) > HIP_BEHIND;
  const front = r ? !onHip && (a.pos.x - r.pos.x) * (s.agents[b.thrower]!.pos.x - r.pos.x) + (a.pos.y - r.pos.y) * (s.agents[b.thrower]!.pos.y - r.pos.y) > 0 : true;
  const close = Math.max(0, 1 - off / 0.9);
  // Breakups outnumber interceptions about 4 to 1 in the NFL (passes defensed
  // vs interceptions); a ballhawk undercutting a route gets his hands on more.
  // The thrower: a Turnover Machine's contested throws are picked 25% more
  // often, a Game Manager's forced throws 25% less; a Gambler undercutting
  // in front gets to more of them (the trait catalog's lines).
  const qb = s.agents[b.thrower]!;
  const lean = more(qb, 'turnover-machine', 0.25) * (has(qb, 'game-manager') ? 0.75 : 1) * (front && has(a, 'gambler') ? 1.2 : 1);
  const pInt = (0.05 + 0.2 * skill + ballhawk) * close * (front ? 1 : 0.3) * (b.target === -2 ? 0.6 : 1) * lean;
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

/**
 * The bobble's band below the catch line (resolveCatch): BOB_BASE × (1.2 −
 * Catching), plus BOB_SPEED per yd/s past BOB_FAST (a bullet), plus BOB_HIT
 * for a hit as it arrives. About 1.5% of balls to a sure-handed man in the
 * open, 3–4% to a poor one, more on a fastball or through contact: the
 * broadcast's juggles. Ours (no public bobble rate; PFF counts only the
 * drops), sized so the juggle is something a fan sees a few times a game.
 */
const BOB_BASE = 0.05;
const BOB_SPEED = 0.003;
const BOB_FAST = 22;
const BOB_HIT = 0.04;

/** His odds of securing a bobble as it comes back down, before contact (play.ts takes off for a man on him then): 60% for poor hands to ~85% for sure ones; Glue Hands and Sure Hands hold on more. */
export function resecureOdds(a: Agent): number {
  return Math.min(0.95, 0.3 + 0.6 * a.fx.a('catching') + (has(a, 'glue-hands') || has(a, 'sure-hands') ? 0.08 : 0));
}

/**
 * Seeing the ball in (resolveCatch's 'late' cost): a ball on him less than
 * LOOK_T s after he found it costs up to LATE_K (× 1.1 − Catching). Ours,
 * sized so a sure-handed man on a quick slant (found at ~0.22 s of a ~0.5-s
 * ball) pays almost nothing and a poor-handed one (found at ~0.33 s) ~2–3
 * points: NFL drop rates run ~3% of catchable balls for the best hands, ~7%
 * for the worst, and the quick game's bullets are where they happen.
 */
const LOOK_T = 0.3;
const LATE_K = 0.12;
/** The over-the-shoulder catch's cost (× 1.1 − Catching): ~1.5 points for sure hands, ~4 for poor ones. Ours, on PFF's deep drop rates. */
const TRACK_K = 0.07;

/** A deep ball (18+ yd downfield) coming in from behind a receiver running away from the throw: he catches it over his shoulder. */
function overShoulder(s: PlayState, a: Agent): boolean {
  const b = s.ball;
  const sp = len(a.vel);
  const bv = Math.sqrt(b.vel.x * b.vel.x + b.vel.y * b.vel.y);
  if (sp < 5 || bv < 1 || b.pos.x - s.setup.los < 18) return false;
  return (b.vel.x * a.vel.x + b.vel.y * a.vel.y) / (bv * sp) > 0.55;
}

/** Seconds out of the hand before a teammate other than the target can touch it (a tip drill, not his own blocker). */
const OWN_CLEAR = 0.25;

/** A defender within this (yd) of the receiver and behind him along his run is on his hip (resolveCatch): ai.ts TRAIL_R's trail. */
const HIP_R = 3;
/** ...on a ball no more than this (yd) behind the receiver along his run: further behind him, it's thrown to the trailer. */
const HIP_BEHIND = -0.5;

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
    // Nor does a man blocking for him (no route) or anyone in the ball's first
    // tenths out of the hand: a fullback in front of the QB on a play-action
    // shot "caught" the 30-yd post 0.07 s after the release (passing round 2,
    // tools/sim/findpassing2.ts), the ball still over his helmet at his set.
    if (a.side === 'off' && a.i !== b.target && (dh > 0.6 || a.p.pos === 'OL' || !a.route || s.t - b.releaseT < OWN_CLEAR)) continue;
    if (dh < r && dh < bestD) {
      best = a.i;
      bestD = dh;
    }
  }
  return best;
}
