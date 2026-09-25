// Acceleration-limited steering (TECH_PLAN §10 "Movement"). An agent asks
// for a velocity; he gets there within his limits: speeding up along his run
// follows the sprint model (dv/dt = (vmax − v)/tau), braking and turning are
// capped by his cut acceleration (Agility). The player-controlled agent goes
// through exactly the same limits, so a slow player feels slow.

import { atan2, cos, sin } from '@/engine/math/detmath';
import { angleDiff, clamp, heading, len, type V2 } from './vec';
import { FIELD_HALF_W, TICK, type Agent } from './types';

/** Top backpedal (facing away from where he's going) as a share of top speed. */
export const BACKPEDAL = 0.62;

/** Share of top speed an AI agent uses when not in a hurry (jogging a route stem, drifting in zone). */
export const CRUISE = 0.82;

/** How many ticks of history agents keep for delayed perception (0.6 s). */
export const HIST = 36;

export interface SteerOpts {
  /** Speed cap as a share of top speed (0–1). Default 1. */
  pace?: number;
  /** Face this direction (rad) instead of the direction of travel (backpedal, QB set). */
  face?: number;
  /** Extra speed multiplier (carrying the ball, protecting it, stamina). */
  mult?: number;
  /** Braking as a share of the cut deceleration (a carrier coasting off the stick). Default 1. */
  brake?: number;
  /**
   * A burst (a carrier out of a cut or into open field): he gets back to top
   * speed faster. From the sprint model: the acceleration phase compressed
   * (τ × 0.55), not a higher top end (the ratings' "Burst" trait: top speed
   * ~0.15 s sooner out of a cut). Round two's automatic burst ran 4% over top
   * speed at first; pursuers could never close, and runs went +0.85 yd a carry.
   */
  burst?: boolean;
}

export function steer(a: Agent, want0: V2, opts: SteerOpts = {}): void {
  const fx = a.fx;
  // Everyone but the ball carrier plays inside the lines (stepPlay sets the room each tick).
  const room = a.mem.room;
  const want = typeof room === 'number' ? boundaryGovern(a, want0, room) : want0;
  const vTop = fx.vmax;
  const tau = fx.tau * (opts.burst ? 0.55 : 1);
  const cap = vTop * (opts.pace ?? 1) * (opts.mult ?? 1) * (0.86 + 0.14 * a.stamina);
  let wx = want.x;
  let wy = want.y;
  const wl = Math.sqrt(wx * wx + wy * wy);
  if (wl > cap) {
    wx = (wx / wl) * cap;
    wy = (wy / wl) * cap;
  }
  // Facing one way and moving the other (a defensive back's backpedal, a
  // lineman's kick-slide): the pedal tops out at ~62% of his top speed (DBs
  // pedal at ~6 yd/s against ~10 flat out). Asked to go faster than that
  // backward, he turns and runs: the hip flip, at his turn rate.
  let faceTo = opts.face;
  if (faceTo !== undefined && wl > 1e-6) {
    const back = (wx * cos(faceTo) + wy * sin(faceTo)) / wl < -0.3;
    if (back && wl > fx.vmax * BACKPEDAL) faceTo = atan2(wy, wx);
  }
  if (faceTo !== undefined) {
    const vl = len(a.vel);
    const wc = Math.sqrt(wx * wx + wy * wy);
    if (vl > 0.5 && (a.vel.x * cos(a.face) + a.vel.y * sin(a.face)) / vl < -0.3 && wc > fx.vmax * BACKPEDAL) {
      wx = (wx / wc) * fx.vmax * BACKPEDAL;
      wy = (wy / wc) * fx.vmax * BACKPEDAL;
    }
  }
  const v = a.vel;
  const sp = len(v);
  // Direction the agent is running (or wants to run from a standstill).
  let hx: number;
  let hy: number;
  if (sp > 0.05) {
    hx = v.x / sp;
    hy = v.y / sp;
  } else if (wl > 1e-6) {
    hx = wx / Math.max(wl, 1e-9);
    hy = wy / Math.max(wl, 1e-9);
  } else {
    hx = 1;
    hy = 0;
  }
  const dvx = wx - v.x;
  const dvy = wy - v.y;
  let along = dvx * hx + dvy * hy;
  let px = dvx - hx * along;
  let py = dvy - hy * along;
  // Speeding up: the sprint model. Braking: cut acceleration.
  const upMax = (Math.max(0, vTop - sp) / tau) * TICK;
  const downMax = fx.cutAccel * TICK * (opts.brake ?? 1);
  along = clamp(along, -downMax, upMax);
  // Turning: lateral acceleration, a little less at speed (a faster runner
  // can't change direction as sharply: centripetal limit).
  const latMax = fx.cutAccel * TICK * (1 - 0.35 * Math.min(1, sp / fx.vmax));
  const pl = Math.sqrt(px * px + py * py);
  if (pl > latMax) {
    px = (px / pl) * latMax;
    py = (py / pl) * latMax;
  }
  v.x += hx * along + px;
  v.y += hy * along + py;
  a.pos.x += v.x * TICK;
  a.pos.y += v.y * TICK;
  // Facing.
  const target = faceTo ?? (len(v) > 0.6 ? heading(v) : a.face);
  const d = angleDiff(target, a.face);
  const maxTurn = fx.turnRate * TICK;
  a.face += clamp(d, -maxTurn, maxTurn);
  // Stamina: sprinting drains it, anything slower recovers (GDD §9.3).
  const effort = sp / fx.vmax;
  const drain = (0.018 + 0.02 * (1 - fx.a('stamina'))) * TICK;
  a.stamina = clamp(a.stamina + (effort > 0.9 ? -drain : 0.01 * TICK), 0, 1);
}

/** Record this tick's position and velocity for other agents' delayed perception. */
export function remember(a: Agent): void {
  a.hist.push({ pos: { x: a.pos.x, y: a.pos.y }, vel: { x: a.vel.x, y: a.vel.y } });
  if (a.hist.length > HIST) a.hist.shift();
}

/** Where an agent was `delay` seconds ago (clamped to the history). */
export function seen(a: Agent, delay: number): { pos: V2; vel: V2 } {
  const k = Math.min(a.hist.length - 1, Math.max(0, Math.round(delay / TICK)));
  const h = a.hist[a.hist.length - 1 - k];
  return h ?? { pos: a.pos, vel: a.vel };
}

/** Velocity toward a point, slowing to arrive (m/s² braking at cutAccel). */
export function arrive(a: Agent, to: V2, pace = 1, slowRadius = 0): V2 {
  const dx = to.x - a.pos.x;
  const dy = to.y - a.pos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d < 1e-4) return { x: 0, y: 0 };
  // Speed that can still stop in the remaining distance: v = sqrt(2 a d).
  const stop = Math.sqrt(2 * a.fx.cutAccel * 0.8 * d);
  const sp = Math.min(a.fx.vmax * pace, slowRadius > 0 ? stop : Infinity);
  return { x: (dx / d) * sp, y: (dy / d) * sp };
}

/** Time for an agent at his current velocity to reach a point (rough, for pursuit and reads). */
export function timeTo(a: Agent, to: V2): number {
  const dx = to.x - a.pos.x;
  const dy = to.y - a.pos.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const sp = len(a.vel);
  // Already moving that way helps; turning costs roughly a tau.
  const toward = sp > 0.1 ? (a.vel.x * dx + a.vel.y * dy) / (sp * Math.max(d, 1e-6)) : 0;
  const v0 = Math.max(0, sp * toward);
  const vm = a.fx.vmax;
  const tAcc = (a.fx.tau * (vm - v0)) / vm;
  return d / vm + tAcc * 0.8 + (toward < 0 ? 0.25 : 0);
}

/**
 * Keep a defender (or a receiver running his route) from running out of
 * bounds: the speed he's asked for toward the nearer sideline is capped at
 * what he can stop from before `room` yd from it (v = √(2·a·d) at his
 * braking, the same law arrive() slows by).
 */
export function boundaryGovern(a: Agent, want: V2, room: number): V2 {
  const lim = FIELD_HALF_W - room;
  const out = Math.sign(want.y) || 0;
  if (out === 0 || Math.sign(a.pos.y) !== out) return want;
  const left = lim - Math.abs(a.pos.y);
  const vmax = Math.sqrt(2 * a.fx.cutAccel * 0.5 * Math.max(0, left));
  if (Math.abs(want.y) <= vmax) return want;
  return { x: want.x, y: out * vmax };
}

