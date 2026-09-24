// Contact (TECH_PLAN §10, GDD §9.3 and §9.5). Bodies separate as circles.
// A tackle is an approach plus a resolution: the angle and closing speed
// and both players' mass, Tackle / Hit Power / Pursuit against the
// carrier's Break Tackle, or the move he is in (juke and spin against
// Elusiveness, stiff arm, truck). Gang tackles add. A hit can knock the ball
// loose (Ball Security against Hit Power). The sim decides; the render's
// ragdoll only shows the fall.

import { exp } from '@/engine/math/detmath';
import { blockOf } from './blocks';
import type { PlayState } from './state';
import { TICK, type Agent } from './types';
import { dist, len } from './vec';

const logistic = (x: number): number => 1 / (1 + exp(-x));

/** Push overlapping bodies apart (not engaged pairs), heavier players move less. */
export function separate(s: PlayState): void {
  const A = s.agents;
  for (let i = 0; i < A.length; i++) {
    const a = A[i]!;
    for (let j = i + 1; j < A.length; j++) {
      const b = A[j]!;
      const min = a.fx.radius + b.fx.radius;
      const dx = b.pos.x - a.pos.x;
      const dy = b.pos.y - a.pos.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 < 1e-10) continue;
      const blk = blockOf(s, a.i);
      if (blk && (blk.b === b.i || blk.d === b.i)) continue;
      if (a.down || b.down) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) * 0.5;
      const wa = b.fx.mass / (a.fx.mass + b.fx.mass);
      const wb = 1 - wa;
      a.pos.x -= (dx / d) * push * wa * 2;
      a.pos.y -= (dy / d) * push * wa * 2;
      b.pos.x += (dx / d) * push * wb * 2;
      b.pos.y += (dy / d) * push * wb * 2;
    }
  }
}

export type TackleOutcome = 'tackle' | 'bigHit' | 'broken' | 'missed';

/** Moves the carrier is in, and what beats them. */
const MOVE_ATTR: Record<string, string> = { jukeL: 'elusiveness', jukeR: 'elusiveness', spin: 'elusiveness', stiffArm: 'stiffArm', truck: 'trucking' };

/**
 * Resolve a defender reaching the ball carrier. Returns the outcome and the
 * hit's force (kN-ish, for the camera and the ragdoll).
 */
export function resolveTackle(s: PlayState, d: Agent, c: Agent): { out: TackleOutcome; force: number } {
  const rng = s.rng.contact;
  // Approach: closing speed and the angle relative to his run.
  const rvx = d.vel.x - c.vel.x;
  const rvy = d.vel.y - c.vel.y;
  const dx = c.pos.x - d.pos.x;
  const dy = c.pos.y - d.pos.y;
  const dd = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
  const closing = Math.max(0, (rvx * dx + rvy * dy) / dd);
  const cs = len(c.vel);
  const headOn = cs > 0.5 ? -(c.vel.x * dx + c.vel.y * dy) / (cs * dd) : 0; // +1 meeting him, −1 from behind
  const pMom = c.fx.mass * cs;
  const dMom = d.fx.mass * Math.max(closing, len(d.vel) * 0.5);
  const massEdge = (pMom - dMom) / Math.max(1, pMom + dMom); // + carrier heavier/faster
  const gang = s.def.concat(s.off).filter((k) => {
    const o = s.agents[k]!;
    return o.side === d.side && o.i !== d.i && !o.down && dist(o.pos, c.pos) < 1.6;
  }).length;
  const tackle = d.fx.a('tackle') * 0.6 + d.fx.a('hitPower') * 0.2 + d.fx.a('pursuit') * 0.2;
  // The carrier's counter: the move he's in, else Break Tackle.
  const mv = c.move && c.busy > 0 ? c.move : null;
  const counterAttr = mv ? MOVE_ATTR[mv] ?? 'breakTackle' : 'breakTackle';
  // Spam: each recent move takes a bite out of the next (GDD §9.3).
  const counter = c.fx.a(counterAttr) * (1 - Math.min(0.6, c.moveFatigue * 0.25));
  // Juke / spin: beat the tackler outright, or it's a loss if he's squared up.
  if (mv === 'jukeL' || mv === 'jukeR' || mv === 'spin') {
    const squared = headOn > 0.7 && closing < 3;
    const p = logistic(4 * (counter - d.fx.a('tackle') * 0.5 - d.fx.a('pursuit') * 0.3) + (squared ? -1.2 : 0.6));
    if (rng() < p) return { out: 'missed', force: 0 };
  }
  // Baseline ~85% per attempt for an even matchup (NFL missed-tackle rate
  // runs 10–15% of attempts: PFF / Sports Info Solutions charting).
  let x = 2.1 + 3.2 * (tackle - counter * 0.85) - 1.8 * massEdge + 0.7 * gang;
  if (mv === 'stiffArm') x -= 0.5 * c.fx.a('stiffArm');
  if (mv === 'truck') x -= 0.8 * c.fx.a('trucking') * (c.fx.mass / (c.fx.mass + d.fx.mass)) * 2 - 0.4;
  if (headOn < -0.3) x -= 0.4; // arm tackles from behind get broken more
  const p = logistic(x);
  const force = (d.fx.mass * closing) / 60;
  if (rng() < p) {
    const big = closing > 5.5 && d.fx.a('hitPower') > 0.8 && rng() < 0.5;
    return { out: big ? 'bigHit' : 'tackle', force };
  }
  return { out: 'broken', force: force * 0.6 };
}

/** Fumble on contact: Ball Security against Hit Power; protecting halves it. */
export function fumbles(s: PlayState, d: Agent, c: Agent, big: boolean): boolean {
  const base = 0.008 + 0.03 * Math.max(0, d.fx.a('hitPower') - c.fx.a('ballSecurity') * 0.8);
  const p = (base + (big ? 0.025 : 0)) * (c.move === 'protect' ? 0.4 : 1);
  return s.rng.contact() < p;
}

/** A carrier's move: commits him for a few frames and sets a cooldown. */
export function startMove(s: PlayState, c: Agent, mv: NonNullable<Agent['move']>): void {
  if (c.busy > 0 || c.moveCooldown > 0 || c.down) return;
  const frames: Record<string, number> = { jukeL: 16, jukeR: 16, spin: 24, stiffArm: 20, truck: 18, dive: 30, protect: 1 };
  c.move = mv;
  c.busy = frames[mv] ?? 12;
  c.moveCooldown = c.busy + 24;
  c.moveFatigue = Math.min(3, c.moveFatigue + 1);
  c.anim = mv === 'jukeL' || mv === 'jukeR' ? 'juke' : mv === 'protect' ? c.anim : mv;
  // The move's footwork: a juke steps sideways, a spin costs speed, a dive lunges.
  const sp = len(c.vel);
  const hx = sp > 0.3 ? c.vel.x / sp : 1;
  const hy = sp > 0.3 ? c.vel.y / sp : 0;
  if (mv === 'jukeL' || mv === 'jukeR') {
    const side = mv === 'jukeL' ? 1 : -1;
    const k = 1.6 + 1.4 * c.fx.a('elusiveness');
    c.vel.x = hx * sp * 0.75 - hy * side * k;
    c.vel.y = hy * sp * 0.75 + hx * side * k;
  } else if (mv === 'spin') {
    c.vel.x *= 0.7;
    c.vel.y *= 0.7;
  } else if (mv === 'dive') {
    c.vel.x = hx * Math.max(sp, 4);
    c.vel.y = hy * Math.max(sp, 4);
  }
  s.events.push({ t: s.t, type: 'move', who: [c.i], data: { move: mv } });
}

/** Per-tick bookkeeping for moves: timers, fatigue recovery. */
export function tickMoves(a: Agent): void {
  if (a.busy > 0) a.busy--;
  if (a.moveCooldown > 0) a.moveCooldown--;
  if (a.busy === 0 && a.move && a.move !== 'protect') a.move = null;
  a.moveFatigue = Math.max(0, a.moveFatigue - TICK * 0.5);
}
