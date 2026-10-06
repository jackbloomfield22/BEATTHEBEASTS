// The tackle as a resolution over several frames (Playtest 1, "Tackling and
// physics"; docs/physics/TACKLING.md). Being touched is not being tackled.
//
// contact.ts decides what the tackler gets when he reaches the ball carrier
// (the roll every harness and identity pair is calibrated on: missed, a
// hand on him, a tackle, a big hit). This plays it out as two bodies:
//
// 1. The hit. Momentum is exchanged along the line between them (an
//    inelastic collision, harder with Hit Power), by mass and speed. A
//    safety meeting a back square stops him; a linebacker sliding off his
//    hip barely slows him.
// 2. The hold. A wrap, a shoulder hit, a big hit, a grab at the ankles, a
//    wrap from behind (the drag) or an arm. Every man who has hold of him is
//    carried with him (one pile, one velocity), pushes with his legs (the
//    sprint force-velocity curve his own Speed and Acceleration already
//    give the sim) or hangs on and brakes, and holds on only as hard as his
//    grip: an arm on a 240-lb back running away gives.
// 3. His feet. His balance (1 on his feet, 0 going down) goes with the jolt
//    of the hit and drains while he's held, faster for a better tackler, a
//    lower man (leverage), a bigger man, a hold at the legs, and when he's
//    being driven back; slower for Break Tackle and Strength. Moves of his
//    own inside it (a spin, a stiff arm, the shoulder) can still shed a man.
// 4. The fall. Out of balance he goes down the way the pile is moving (the
//    extra yard falling forward, or back where he was stopped), and the
//    ball is spotted where it is when he's down, or at his forward progress
//    if he was driven back. Held up with no ground gained, the officials
//    blow it dead.
//
// Pure and deterministic: no random numbers but the contact stream (moves
// inside the hold), no transcendental functions.

import { has, more } from './traits';
import type { PlayState } from './state';
import { TICK, type Agent, type Move } from './types';
import { DOWN_R, layDown, lyingGap, runMeets } from './bodies';
import { tackleOdds } from './contact';

/** How he has hold of the ball carrier. */
export type HoldKind = 'wrap' | 'hit' | 'big' | 'arm' | 'ankle' | 'drag';

export interface Grip {
  by: number;
  kind: HoldKind;
  /** The most force his hold carries before it gives (kg·yd/s²). */
  grip: number;
  /** Balance he takes out of the carrier a second. */
  drain: number;
  /** The way he drives (unit, into the ball carrier), and whether he's behind him (he brakes instead). */
  dx: number;
  dy: number;
  behind: boolean;
  /** Where he rides, from the carrier (yd). */
  ox: number;
  oy: number;
  t0: number;
  /** Leverage −1…1: + the tackler is the lower man. */
  lev: number;
}

export interface Pile {
  /** The ball carrier. */
  c: number;
  t0: number;
  /** The way he's driving (unit). */
  hx: number;
  hy: number;
  /** The pile's velocity (yd/s): the carrier and everyone holding him. */
  vx: number;
  vy: number;
  grips: Grip[];
  /** Everyone who had hold of him (the tackle and the assists). */
  inOn: number[];
  /** Forward progress: the furthest the ball's nose got (x, the way he attacks). */
  prog: number;
  /** Going down: since when (−1: on his feet), which way, and how far the ball reaches with it. */
  fallT: number;
  fx: number;
  fy: number;
  /** The yards the catalog's after-contact traits add or take at the fall (Battering Ram, Grinder, Thumper...). */
  extra: number;
  /** Held with no ground gained (s): the officials blow forward progress at STALL_T. */
  stall: number;
  /** The first hold's kind, for the render and the harness. */
  kind: HoldKind;
  /** Where the pile put him last tick (his own steering this tick is replaced by the pile's). */
  px: number;
  py: number;
}

const G_YD = 9.81 / 0.9144; // gravity, yd/s²
const N_TO_KGYD = 1 / 0.9144; // 1 N = 1.094 kg·yd/s²

/**
 * Grip by hold (N, before the ratings). An arm: a hand and forearm on the
 * jersey or a shoulder, about what one hand holds (grip dynamometry in
 * strength athletes ~500–700 N: Cronin et al. 2017 for rugby players).
 * A wrap: both arms locked round him and the tackler's weight in it, several
 * times that (it's broken by a move, not by running). An ankle: both hands
 * round the shoes from the turf.
 */
const GRIP_N: Record<HoldKind, number> = { arm: 600, ankle: 900, drag: 1600, wrap: 3000, hit: 3000, big: 3000 };
/**
 * Balance a second for a typical tackler on a typical back (before the
 * ratings, mass and leverage), sized from film: a solo form tackle has him
 * on the turf ~0.4–0.7 s after the hit; a shoestring grab trips him in a
 * couple of strides (~0.3 s); a man hanging on from behind drags for a
 * second or more; an arm alone rarely takes a man down unless he stops.
 */
const DRAIN: Record<HoldKind, number> = { arm: 0.45, ankle: 3.2, drag: 1.0, wrap: 1.6, hit: 2.0, big: 99 };
/**
 * The share of the closing speed along the line between them the hit takes
 * out (1 = they stick; 1 + e bounces him back, e ~0.25 for a big hit:
 * padded collisions are mostly plastic). An arm and a grab at the ankles
 * are glancing.
 */
const HIT_K: Record<HoldKind, number> = { arm: 0.35, ankle: 0.45, drag: 0.6, wrap: 0.85, hit: 1.0, big: 1.25 };
/**
 * A tackler's speed into the man at the hit (yd/s): his breakdown (~2.5
 * yd/s, the choppy steps that let him mirror a cut) plus his explosion
 * through the hips, up to ~4 yd/s more with Hit Power. Ours, film-sized: a
 * linebacker filling meets a back at 2–3 m/s; a safety who "arrives" at 5–6.
 */
const BREAKDOWN = 2.5;
const EXPLODE = 4;
/** A change in his velocity this big at the hit takes all his balance (yd/s; ours, film-sized: a back stopped dead from full speed, ~9 yd/s, by a square hit is going down at once). */
const V_JOLT = 9;
/** A hand gets this long to take hold (s): the impulse an arm can take is its grip times this. */
const T_GRAB = 0.18;
/** His feet back after a broken hold: balance a second (Low Center: +30%, the catalog's line). */
const RECOVER = 1.2;
/** The balance a broken tackle takes from him (see shed). */
const SHED_JOLT = 0.6;
/** Going down (s): from losing his feet to a knee on the turf. Film: ~0.25–0.35 s. */
const FALL_T = 0.3;
/** The pile slows on the way down (yd/s²): cleats still in the turf, ~0.7 g. */
const FALL_DECEL = 0.7 * G_YD;
/** How far ahead of his feet the ball is when a knee touches, falling forward (yd, ~0.7 m): carried at the chest of a man pitching forward from ~1.85 m, the knee lands under his hips. Film-sized. */
const FALL_REACH = 0.75;
/** Held up with no ground gained this long (s): forward progress, whistled. */
const STALL_T = 0.7;
/** Driven back, he loses his base this much faster (balance a second). */
const BACK_DRAIN = 1.4;
/** Cleats and a body dragging on grass (kinetic friction ~0.5; Villwock et al. 2009 measured cleated shoes on natural turf at ~1.0–1.4 static, a sliding body less). */
const MU_DRAG = 0.5;
/** Pad level as a share of his height, running: shoulders at ~0.82 of stature standing (Drillis & Contini 1966), lower with a forward lean and technique. */
const PAD = 0.78;
const PAD_TECH = 0.1;
/** A tackler who goes low (a dive, the shins) hits at this share of his height. */
const PAD_LOW = 0.45;
/** A leverage of 1 is this much lower (m). */
const LEV_M = 0.15;

/** He and the man he's holding move as one (separate() leaves them be). */
export function heldTogether(s: PlayState, i: number, j: number): boolean {
  const p = s.pile;
  if (!p) return false;
  const inIt = (k: number) => k === p.c || p.grips.some((g) => g.by === k);
  return inIt(i) && inIt(j);
}

/** He's going down (balance gone, not yet down). */
export const falling = (s: PlayState, c: Agent): boolean => !!s.pile && s.pile.c === c.i && s.pile.fallT >= 0;

/** The man's balance (1 on his feet). */
export const balanceOf = (a: Agent): number => (a.mem.bal as number | undefined) ?? 1;

/** Shoulder height in a run (m), lower with his technique (0–1). */
function padM(a: Agent, tech: number): number {
  return a.fx.height * 0.9144 * (PAD - PAD_TECH * tech);
}

/** The carrier's power in a pile: Trucking (running through a man), Strength and Break Tackle. */
function power(c: Agent): number {
  return 0.5 * c.fx.a('trucking') + 0.3 * c.fx.a('strength') + 0.2 * c.fx.a('breakTackle');
}
/** The tackler's finish: Tackle, Strength, Hit Power. */
function finish(o: Agent): number {
  return 0.6 * o.fx.a('tackle') + 0.2 * o.fx.a('strength') + 0.2 * o.fx.a('hitPower');
}
/** How hard he is to take off his feet: Break Tackle, Strength, Agility. */
function steady(c: Agent): number {
  return 0.6 + 0.8 * (0.5 * c.fx.a('breakTackle') + 0.25 * c.fx.a('strength') + 0.25 * c.fx.a('agility'));
}

/**
 * His legs' push at speed v along the push (kg·yd/s²): the sprint model's
 * force-velocity line, m·vmax/τ·(1 − v/vmax) (effects.ts: the 40 and the
 * 10-yd split his Speed and Acceleration were rated from; Samozino et al.
 * 2016 for the line), times his technique in a pile, and never more than
 * his cleats hold: traction, μ·m·g with μ ~1.0 for cleats on grass
 * (Villwock et al. 2009 measured 1.0–1.4), more for the lower man (the low
 * man lifts the high man off his feet: leverage ±25%). Pushing contests in
 * football are traction contests, which is why mass wins them.
 */
function legs(a: Agent, v: number, tech: number, lev: number): number {
  const fv = a.fx.mass * (a.fx.vmax / a.fx.tau) * Math.max(0, Math.min(1, 1 - v / a.fx.vmax)) * tech;
  return Math.min(fv, MU_PUSH * a.fx.mass * G_YD * (1 + 0.25 * lev));
}
/** Cleats on grass, pushing (see legs). */
const MU_PUSH = 1.0;

/** Leverage of tackler o on carrier c, −1…1 (+ the tackler is lower). */
export function leverage(c: Agent, o: Agent, low: boolean): number {
  const cTech = c.move === 'truck' && c.busy > 0 ? 1 : 0.5 * c.fx.a('trucking') + 0.5 * c.fx.a('breakTackle');
  const cPad = padM(c, cTech) - (c.move === 'truck' && c.busy > 0 ? 0.1 : 0);
  const oPad = low ? o.fx.height * 0.9144 * PAD_LOW : padM(o, o.fx.a('tackle'));
  return Math.max(-1, Math.min(1, (cPad - oPad) / LEV_M));
}

/** The hold a tackle is, from how he got there. */
export function holdKind(c: Agent, o: Agent, headOn: number, closing: number, big: boolean, dive: boolean, low: boolean): HoldKind {
  if (big) return 'big';
  if (dive || (low && headOn < 0.3)) return 'ankle';
  if (headOn < -0.3) return 'drag';
  if (headOn > 0.5 && closing > 3) return 'hit';
  return 'wrap';
}

function sideOf(c: Agent, o: Agent): 'front' | 'left' | 'right' | 'back' {
  const sp = Math.sqrt(c.vel.x * c.vel.x + c.vel.y * c.vel.y);
  const hx = sp > 0.5 ? c.vel.x / sp : c.side === 'off' ? 1 : -1;
  const hy = sp > 0.5 ? c.vel.y / sp : 0;
  const rx = o.pos.x - c.pos.x;
  const ry = o.pos.y - c.pos.y;
  const r = Math.max(1e-6, Math.sqrt(rx * rx + ry * ry));
  const f = (rx * hx + ry * hy) / r;
  if (f > 0.5) return 'front';
  if (f < -0.5) return 'back';
  return hx * ry - hy * rx > 0 ? 'left' : 'right';
}

/**
 * A tackler reaches him with this hold: the hit, and (unless it's an arm
 * that he runs straight through) the man takes hold. `engaged`: he reached
 * out of a block. `extra`: the after-contact yards the catalog's traits put
 * on the fall. Returns false when an arm was shed at once (broken).
 */
export function grab(s: PlayState, c: Agent, o: Agent, kind: HoldKind, opts: { engaged?: boolean; low?: boolean; extra?: number; force?: number } = {}): boolean {
  const attack = c.side === 'off' ? 1 : -1;
  const pile = s.pile && s.pile.c === c.i ? s.pile : null;
  // The line of the hit: from him into the ball carrier.
  let nx = c.pos.x - o.pos.x;
  let ny = c.pos.y - o.pos.y;
  const nl = Math.max(1e-6, Math.sqrt(nx * nx + ny * ny));
  nx /= nl;
  ny /= nl;
  // The carrier's side of the collision: him alone, or the whole pile.
  const cvx = pile ? pile.vx : c.vel.x;
  const cvy = pile ? pile.vy : c.vel.y;
  let mc = c.fx.mass;
  if (pile) for (const g of pile.grips) mc += s.agents[g.by]!.fx.mass;
  // Freight Train: at full speed his momentum counts 15% more (the catalog's line).
  const sp = Math.sqrt(c.vel.x * c.vel.x + c.vel.y * c.vel.y);
  if (!pile && sp > 0.85 * c.fx.vmax && has(c, 'freight-train')) mc *= 1.15;
  const mo = o.fx.mass;
  const mu = (mc * mo) / (mc + mo);
  // He comes to balance before the hit (break down, buzz the feet, then the
  // hips through him: how every tackler is coached), so what he brings into
  // the man is his breakdown speed and how hard he explodes out of it (Hit
  // Power), not his pursuit speed. Only a big hit arrives at full tilt.
  const vIn = o.vel.x * nx + o.vel.y * ny;
  const cap = BREAKDOWN + EXPLODE * o.fx.a('hitPower');
  const ovx = kind !== 'big' && vIn > cap ? o.vel.x - nx * (vIn - cap) : o.vel.x;
  const ovy = kind !== 'big' && vIn > cap ? o.vel.y - ny * (vIn - cap) : o.vel.y;
  const closing = Math.max(0, (ovx - cvx) * nx + (ovy - cvy) * ny);
  // Hit Power: he puts his hips through it (the shoulder and wrap hits; an arm is an arm).
  const hp = kind === 'big' || kind === 'hit' || kind === 'wrap' ? 0.85 + 0.3 * o.fx.a('hitPower') : 1;
  let J = HIT_K[kind] * hp * closing * mu;
  const lev = leverage(c, o, !!opts.low || kind === 'ankle');
  const headOn = sp > 0.5 ? -((c.vel.x * -nx + c.vel.y * -ny) / sp) : 0;
  // The hit: equal and opposite along the line.
  let c2x = cvx + (J / mc) * nx;
  let c2y = cvy + (J / mc) * ny;
  let o2x = ovx - (J / mo) * nx;
  let o2y = ovy - (J / mo) * ny;
  // His grip, as this carrier tests it: Break Tackle rips out of it (ours: ±25%), Tackle holds it (±20%).
  const gripN = GRIP_N[kind] * (opts.engaged ? 0.5 : 1);
  const grip = gripN * N_TO_KGYD * (0.8 + 0.4 * o.fx.a('tackle')) * (1.25 - 0.5 * c.fx.a('breakTackle'));
  // An arm: if matching his speed takes more than the hand can take in the moment, he runs through it.
  if (kind === 'arm') {
    const rvx = c2x - o2x;
    const rvy = c2y - o2y;
    const rv = Math.sqrt(rvx * rvx + rvy * rvy);
    const need = mu * rv;
    const cap = grip * T_GRAB;
    if (need > cap) {
      // What the hand took out of him on the way through.
      const k = rv > 1e-6 ? cap / rv : 0;
      c2x -= (k / mc) * rvx;
      c2y -= (k / mc) * rvy;
      o2x += (k / mo) * rvx;
      o2y += (k / mo) * rvy;
      J += cap;
      jolt(c, Math.sqrt((c2x - cvx) * (c2x - cvx) + (c2y - cvy) * (c2y - cvy)), lev);
      c.vel.x = c2x;
      c.vel.y = c2y;
      o.vel.x = o2x * 0.5;
      o.vel.y = o2y * 0.5;
      // Run over: the hand had a third of what it would have taken (a big man through a small one).
      const flat = need > 3 * cap && c.fx.mass > o.fx.mass * 0.95;
      shed(s, c, o, flat ? 'runOver' : 'runThrough', flat, Math.round(J * 0.9144));
      return false;
    }
  }
  // The jolt.
  jolt(c, Math.sqrt((c2x - cvx) * (c2x - cvx) + (c2y - cvy) * (c2y - cvy)), lev);
  if (kind === 'big') c.mem.bal = 0;
  // He has hold: one body with the pile from here (momentum kept: the pile's velocity is the mass-weighted mean).
  const M = mc + mo;
  const vx = (mc * c2x + mo * o2x) / M;
  const vy = (mc * c2y + mo * o2y) / M;
  const behind = (o.pos.x - c.pos.x) * (sp > 0.5 ? c.vel.x / sp : attack) + (o.pos.y - c.pos.y) * (sp > 0.5 ? c.vel.y / sp : 0) < -0.3 * nl;
  // Balance he takes a second: the hold, his finish, the mass between them, the leverage.
  // Low Center: a man hitting above the waist (leverage against the tackler) loses 30% of it (the catalog's line: "tacklers hitting above the waist lose leverage").
  const highOnLowCenter = lev < 0 && has(c, 'low-center') ? 1 / 1.3 : 1;
  const drain = (DRAIN[kind] * (0.6 + 0.8 * finish(o)) * Math.sqrt(mo / c.fx.mass) * (1 + 0.5 * lev) * highOnLowCenter) / steady(c);
  const reachYd = (o.fx.radius + c.fx.radius) * 0.8;
  const g: Grip = { by: o.i, kind, grip, drain: Math.max(0, drain), dx: nx, dy: ny, behind, ox: -nx * reachYd, oy: -ny * reachYd, t0: s.t, lev };
  if (kind === 'ankle') {
    // At his feet: the tackler is on the turf behind his heels.
    g.ox = -nx * reachYd * 1.1;
    g.oy = -ny * reachYd * 1.1;
  }
  const hx0 = sp > 0.5 ? c.vel.x / sp : attack;
  const hy0 = sp > 0.5 ? c.vel.y / sp : 0;
  if (pile) {
    pile.vx = vx;
    pile.vy = vy;
    pile.grips.push(g);
    if (!pile.inOn.includes(o.i)) pile.inOn.push(o.i);
    pile.extra = Math.max(pile.extra, opts.extra ?? 0) + Math.min(0, opts.extra ?? 0);
  } else {
    // His drive: half his run, half straight at the goal line (a back fights forward).
    const hx = hx0 + attack;
    const hy = hy0;
    const hl = Math.max(1e-6, Math.sqrt(hx * hx + hy * hy));
    const nose = c.pos.x + attack * 0.4;
    s.pile = { c: c.i, t0: s.t, hx: hx / hl, hy: hy / hl, vx, vy, grips: [g], inOn: [o.i], prog: nose, fallT: -1, fx: 0, fy: 0, extra: opts.extra ?? 0, stall: 0, kind, px: c.pos.x, py: c.pos.y };
  }
  c.vel.x = vx;
  c.vel.y = vy;
  o.vel.x = vx;
  o.vel.y = vy;
  o.busy = Math.max(o.busy, 600);
  o.anim = kind === 'ankle' ? 'dive' : 'tackle';
  if (kind === 'ankle') {
    o.down = true;
    o.lie = layDown(o, nx, ny);
  }
  s.events.push({
    t: s.t,
    type: 'hit',
    who: [o.i, c.i],
    at: { ...c.pos },
    data: {
      force: Math.round((opts.force ?? 0) * 10) / 10,
      big: kind === 'big',
      wrap: true,
      kind,
      side: sideOf(c, o),
      // The impulse (N·s), the line of the hit (sim x, y: from him into the carrier) and the point of contact (pads, between them).
      imp: Math.round(J * 0.9144),
      nx: Math.round(nx * 1000) / 1000,
      ny: Math.round(ny * 1000) / 1000,
      px: Math.round((c.pos.x - nx * c.fx.radius) * 100) / 100,
      py: Math.round((c.pos.y - ny * c.fx.radius) * 100) / 100,
      lev: Math.round(lev * 100) / 100,
      headOn: Math.round(headOn * 100) / 100,
      // When he'd be down on this hold alone (s from now), so a clip can be timed to it.
      eta: Math.round(Math.min(2, balanceOf(c) / Math.max(0.05, (s.pile?.grips ?? []).reduce((a, k) => a + k.drain, 0)) + FALL_T) * 100) / 100,
      ...(pile ? { join: true } : {}),
    },
  });
  return true;
}

/** A jolt at the hit takes his balance with it (yd/s of change in his velocity). */
function jolt(c: Agent, dv: number, lev: number): void {
  const k = lev < 0 && has(c, 'low-center') ? 1.3 : 1;
  c.mem.bal = Math.max(0, balanceOf(c) - dv / (V_JOLT * k * steady(c)));
}

/** He's shed this man: a broken tackle, the man stumbling off or on the turf. */
function shed(s: PlayState, c: Agent, o: Agent, how: string, flat: boolean, imp: number): void {
  o.busy = flat ? 0 : 28;
  o.mem.tackleCd = s.t + 0.9;
  if (o.anim === 'tackle') o.anim = 'run';
  if (flat) knockDown(s, o, o.pos.x - c.pos.x, o.pos.y - c.pos.y);
  // Breaking a tackle costs him his feet for a stride or two (the man got
  // into his body, his line is knocked off): ~60% of his balance, back in
  // about half a second. (The sim had taken 38% of his speed at once; with
  // only the impulse of the hand, broken tackles barely slowed him and runs
  // of 40+ after the catch went 4.6% → 6.0% of completions.)
  c.mem.bal = Math.min(balanceOf(c), 1 - SHED_JOLT);
  s.events.push({ t: s.t, type: 'brokenTackle', who: [c.i, o.i], at: { ...c.pos }, data: { force: 0, move: c.move ?? '', how, flat, imp } });
}

/** On the turf (a man run over, spun off, a diver who missed): a body on the ground until he gets up. */
export function knockDown(s: PlayState, o: Agent, dx: number, dy: number): void {
  o.down = true;
  o.anim = 'down';
  o.lie = layDown(o, dx, dy);
  o.mem.downAt = s.t;
  o.vel.x = 0;
  o.vel.y = 0;
}

/** A man on the ground gets up after this long (s), then the get-up (getup_prone, 1.1 s). Film: a missed diver is moving again in ~1.5–2 s. */
const DOWN_FOR = 0.5;
const GETUP = 66;

/** Bodies on the ground mid-play: still, and up again after a beat. */
export function tickDowned(s: PlayState): void {
  if (s.phase === 'dead') return;
  for (const a of s.agents) {
    if (!a.down) {
      // His feet back after a stumble.
      const b = balanceOf(a);
      if (b < 1 && !(s.pile && s.pile.c === a.i)) a.mem.bal = Math.min(1, b + RECOVER * (has(a, 'low-center') ? 1.3 : 1) * TICK);
      continue;
    }
    a.vel.x = 0;
    a.vel.y = 0;
    const at = a.mem.downAt as number | undefined;
    if (at === undefined || a.i === s.carrier || heldBy(s, a.i)) continue;
    if (s.t - at >= DOWN_FOR) {
      a.down = false;
      a.lie = null;
      a.mem.downAt = undefined as unknown as number;
      delete a.mem.downAt;
      a.busy = GETUP;
      a.anim = 'run';
      a.mem.bal = 1;
      s.events.push({ t: s.t, type: 'move', who: [a.i], data: { move: 'getup' } });
    }
  }
}

const heldBy = (s: PlayState, i: number): boolean => !!s.pile && s.pile.grips.some((g) => g.by === i);

/**
 * One tick of the pile. The carrier steered this tick already (his legs
 * want somewhere); here the bodies settle it. Returns 'down' when he's down
 * (the caller whistles at the returned spot), 'free' when the last hold
 * gave, else 'held'.
 */
export function pileStep(s: PlayState, c: Agent, wantX: number, wantY: number): { state: 'held' | 'free' | 'down' | 'stood'; spot: number } {
  const p = s.pile!;
  const attack = c.side === 'off' ? 1 : -1;
  const dt = TICK;
  // His drive: the player's stick (or the AI's want) if he's pushing somewhere, else the line to gain.
  const wl = Math.sqrt(wantX * wantX + wantY * wantY);
  if (wl > 0.5 && p.fallT < 0) {
    const ux = wantX / wl;
    const uy = wantY / wl;
    // (Turned toward it at ~3 rad/s: a pile doesn't spin on a dime.)
    p.hx += (ux - p.hx) * 0.05;
    p.hy += (uy - p.hy) * 0.05;
    const hl = Math.max(1e-6, Math.sqrt(p.hx * p.hx + p.hy * p.hy));
    p.hx /= hl;
    p.hy /= hl;
  }
  // A move of his own against the holds (one try per move per man).
  if (p.fallT < 0 && c.busy > 0 && c.move && c.move !== 'protect' && c.move !== 'dive' && c.move !== 'hurdle') breakTry(s, c, c.move);
  // The dive inside a tackle: he gives up his feet and falls forward for it (the line to gain, the goal line).
  if (p.fallT < 0 && c.move === 'dive' && c.busy > 0 && p.grips.length > 0) {
    p.hx = attack;
    p.hy = 0;
    const fwd = Math.max(0, p.vx * attack);
    p.vx = attack * Math.max(fwd, 1.5);
    fallStart(s, c, p, 'fall');
  }
  if (p.grips.length === 0 && p.fallT < 0) {
    s.pile = null;
    return { state: 'free', spot: 0 };
  }
  const vAlong = p.vx * p.hx + p.vy * p.hy;
  let M = c.fx.mass;
  let fx = 0;
  let fy = 0;
  if (p.fallT < 0) {
    // His legs: his power in a pile, the lower man's traction (leverage), less as his feet go.
    let levAvg = 0;
    for (const g of p.grips) levAvg += g.lev / p.grips.length;
    const fc = legs(c, vAlong, 0.7 + 0.6 * power(c), -levAvg) * (0.5 + 0.5 * balanceOf(c));
    fx += fc * p.hx;
    fy += fc * p.hy;
  }
  // Each man holding him: drive into him with his legs, or (behind him, at his ankles, an arm) hang on and brake.
  const own: { fx: number; fy: number }[] = [];
  const sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
  for (const g of p.grips) {
    const o = s.agents[g.by]!;
    M += o.fx.mass;
    let gx = 0;
    let gy = 0;
    if (!g.behind && (g.kind === 'wrap' || g.kind === 'hit' || g.kind === 'big')) {
      const vInto = p.vx * g.dx + p.vy * g.dy;
      const f = legs(o, vInto, 0.6 + 0.8 * finish(o), g.lev);
      gx = f * g.dx;
      gy = f * g.dy;
    } else if (sp > 0.05) {
      // Hanging on: his weight dragging, as much as his grip carries.
      const f = Math.min(g.grip, MU_DRAG * o.fx.mass * G_YD);
      gx = (-p.vx / sp) * f;
      gy = (-p.vy / sp) * f;
    }
    own.push({ fx: gx, fy: gy });
    fx += gx;
    fy += gy;
  }
  let ax = fx / M;
  let ay = fy / M;
  if (p.fallT >= 0) {
    // Going down: the pile slides to a stop.
    if (sp > 1e-3) {
      const d = Math.min(sp, FALL_DECEL * dt);
      ax = (-p.vx / sp) * (d / dt);
      ay = (-p.vy / sp) * (d / dt);
    } else ax = ay = 0;
  } else {
    // A hold that can't carry what it takes to stay with him gives (an arm on a man running away).
    for (let k = p.grips.length - 1; k >= 0; k--) {
      const g = p.grips[k]!;
      const o = s.agents[g.by]!;
      const lx = o.fx.mass * ax - own[k]!.fx;
      const ly = o.fx.mass * ay - own[k]!.fy;
      // (Only pulling him along: a man pushing into the ball carrier needs no grip.)
      const pull = -(lx * g.dx + ly * g.dy);
      const shear = Math.abs(lx * g.dy - ly * g.dx);
      const load = Math.max(0, pull) + 0.5 * shear;
      if (load > g.grip) {
        p.grips.splice(k, 1);
        o.vel.x = p.vx * 0.5;
        o.vel.y = p.vy * 0.5;
        if (g.kind === 'ankle' || g.kind === 'arm') knockDown(s, o, -g.dx, -g.dy);
        shed(s, c, o, 'shed', g.kind === 'ankle' || g.kind === 'arm', 0);
        if (g.kind === 'ankle' || g.kind === 'arm') {
          o.mem.downAt = s.t;
        }
      }
    }
    if (p.grips.length === 0) {
      s.pile = null;
      c.vel.x = p.vx;
      c.vel.y = p.vy;
      return { state: 'free', spot: 0 };
    }
  }
  p.vx += ax * dt;
  p.vy += ay * dt;
  c.pos.x = p.px + p.vx * dt;
  c.pos.y = p.py + p.vy * dt;
  p.px = c.pos.x;
  p.py = c.pos.y;
  c.vel.x = p.vx;
  c.vel.y = p.vy;
  for (const g of p.grips) {
    const o = s.agents[g.by]!;
    o.pos.x = c.pos.x + g.ox;
    o.pos.y = c.pos.y + g.oy;
    o.vel.x = p.vx;
    o.vel.y = p.vy;
    if (o.lie) {
      o.lie.x = o.pos.x;
      o.lie.y = o.pos.y;
    }
  }
  const nose = c.pos.x + attack * 0.4;
  if ((nose - p.prog) * attack > 0) p.prog = nose;
  if (p.fallT < 0) {
    // His feet: every hold takes its share, more if he's going backwards.
    let drain = 0;
    for (const g of p.grips) drain += g.drain;
    const back = p.vx * p.hx + p.vy * p.hy < -0.3;
    if (back) drain += BACK_DRAIN / steady(c);
    c.mem.bal = Math.max(0, balanceOf(c) - drain * dt);
    // Held up, no ground gained: the officials blow it (forward progress).
    if (p.vx * attack < 0.3) p.stall += dt;
    else p.stall = 0;
    if (p.stall >= STALL_T && balanceOf(c) > 0) {
      fallStart(s, c, p, 'held');
      return { state: 'stood', spot: spotOf(s, c, p) };
    }
    if (balanceOf(c) <= 0) fallStart(s, c, p, 'fall');
    return { state: 'held', spot: 0 };
  }
  // The ball goes with him as he falls (into the end zone too: lineCheck reads ballNose).
  c.mem.fallReach = Math.min(1, (s.t - p.fallT) / FALL_T) * FALL_REACH * p.fx + Math.min(1, (s.t - p.fallT) / FALL_T) * p.extra * attack;
  if (s.t - p.fallT >= FALL_T - 1e-9) return { state: 'down', spot: spotOf(s, c, p) };
  return { state: 'held', spot: 0 };
}

/** Where the ball is spotted: where it is as he goes down, or his forward progress if he was driven back (yd, x). */
function spotOf(s: PlayState, c: Agent, p: Pile): number {
  const attack = c.side === 'off' ? 1 : -1;
  const at = c.pos.x + attack * 0.4 + ((c.mem.fallReach as number | undefined) ?? 0);
  return attack > 0 ? Math.max(p.prog, at) : Math.min(p.prog, at);
}

/** His feet go: the fall begins, the way the pile is moving (or the way the man in front drives him). */
function fallStart(s: PlayState, c: Agent, p: Pile, how: 'fall' | 'held'): void {
  const attack = c.side === 'off' ? 1 : -1;
  p.fallT = s.t;
  let fx = p.vx;
  let fy = p.vy;
  const sp = Math.sqrt(fx * fx + fy * fy);
  if (sp < 0.6) {
    // Stopped: down the way the strongest hold drives him; at the ankles, forward over them.
    const g = p.grips[0];
    if (g && g.kind === 'ankle') {
      fx = p.hx;
      fy = p.hy;
    } else if (g) {
      fx = g.dx;
      fy = g.dy;
    } else {
      fx = attack;
      fy = 0;
    }
  }
  const l = Math.max(1e-6, Math.sqrt(fx * fx + fy * fy));
  p.fx = how === 'held' ? 0 : (fx / l) * attack;
  p.fy = fy / l;
  // (fx above is the fall's share toward his goal: fallReach is along x the way he attacks.)
  const dirx = fx / l;
  const diry = fy / l;
  const forward = dirx * attack;
  const fall = how === 'held' ? 'held' : forward > 0.5 ? 'forward' : forward < -0.5 ? 'back' : 'side';
  c.anim = 'tackled';
  const by = p.inOn[0] ?? -1;
  s.events.push({
    t: s.t,
    type: 'tackle',
    who: [by, c.i],
    at: { ...c.pos },
    data: {
      big: p.kind === 'big',
      kind: p.kind,
      fall,
      fx: Math.round(dirx * 1000) / 1000,
      fy: Math.round(diry * 1000) / 1000,
      v: Math.round(sp * 100) / 100,
      gang: p.inOn.length,
      wrapT: Math.round((s.t - p.t0) * 100) / 100,
      assists: p.inOn.slice(1).join(','),
    },
  });
}

/**
 * A move of his own inside the hold: one try a move against each man (a
 * wrap only early, before the tackler's arms lock: WRAP_BREAK_T; an arm, a
 * drag or a grab at the ankles any time), at WRAP_BREAK of the chance the
 * tackle had of failing (contact.ts tackleOdds, the same odds the HUD
 * ranks). A stiff arm or the shoulder puts a man his size or smaller on the
 * turf; a spin or a juke leaves him stumbling.
 */
function breakTry(s: PlayState, c: Agent, mv: Move): void {
  const p = s.pile!;
  const key = `brk${(c.mem.moveT as number | undefined) ?? 0}`;
  for (let k = p.grips.length - 1; k >= 0; k--) {
    const g = p.grips[k]!;
    const o = s.agents[g.by]!;
    const tag = `${key}_${o.i}`;
    if (c.mem[tag]) continue;
    // Only a move begun with him already holding on gets the extra try (the one he was in counted in the roll).
    if (((c.mem.moveT as number | undefined) ?? -1) < g.t0) continue;
    c.mem[tag] = true;
    const early = s.t - g.t0 < WRAP_BREAK_T;
    if ((g.kind === 'wrap' || g.kind === 'hit' || g.kind === 'big') && !early) continue;
    if (g.kind === 'big') continue;
    const odds = tackleOdds(s, o, c, mv);
    const share = g.kind === 'arm' || g.kind === 'drag' ? 1 : WRAP_BREAK;
    if (s.rng.contact() < share * (1 - odds.tackle) * more(c, 'low-center', 0.3)) {
      p.grips.splice(k, 1);
      const flat = (mv === 'stiffArm' || mv === 'truck') && c.fx.mass >= o.fx.mass * 0.9;
      o.vel.x = p.vx * 0.3 - g.dx * 2;
      o.vel.y = p.vy * 0.3 - g.dy * 2;
      shed(s, c, o, mv, flat, 0);
      // He comes out of it with some of his stride (the old wrap's 60%).
      p.vx *= 0.85;
      p.vy *= 0.85;
    }
  }
}
/** A move of his own this early in a wrap (s) gets one try to break it... */
const WRAP_BREAK_T = 0.25;
/** ...at this share of the chance the tackle had of failing in the first place. */
const WRAP_BREAK = 0.5;


// ---- Bodies on the ground in his path ------------------------------------------

/** A body this far ahead (yd) at speed is one he hurdles or goes round; nearer, he's on it. */
const OVER_NEAR = 1.0;
const OVER_FAR = 2.4;
/** Fast enough to hurdle (yd/s): a man jogging steps over or round. */
const OVER_SPEED = 4.5;
/** Spring enough to go over a man rather than through him (Jumping, else Agility: 0–1; ~84 on the 0–99 scale: Barry Sanders and Saquon go over, the Bus goes through). */
const OVER_SPRING = 0.85;

/** The nearest body on the ground across his run within `range` (yd): who, how far, and whether it's the trunk. */
export function bodyAhead(s: PlayState, c: Agent, range: number): { g: Agent; at: number; trunk: boolean } | null {
  const sp = Math.sqrt(c.vel.x * c.vel.x + c.vel.y * c.vel.y);
  if (sp < 0.5) return null;
  const hx = c.vel.x / sp;
  const hy = c.vel.y / sp;
  let best: { g: Agent; at: number; trunk: boolean } | null = null;
  for (const g of s.agents) {
    if (!g.down || !g.lie || g === c || heldTogether(s, g.i, c.i)) continue;
    // (One he's already on, or just ran over, isn't ahead of him: that's his feet, below.)
    if (lyingGap(g.lie, c.pos.x, c.pos.y).d < DOWN_R + c.fx.radius) continue;
    const at = runMeets(g.lie, c.pos.x, c.pos.y, hx, hy, c.fx.radius * 0.5, range);
    if (at === null || (best && at >= best.at)) continue;
    const m = lyingGap(g.lie, c.pos.x + hx * at, c.pos.y + hy * at);
    best = { g, at, trunk: m.along > -0.3 };
  }
  return best;
}

/**
 * The ball carrier and the bodies on the ground. The AI (and the one
 * button) hurdles a man lying across his run at speed if he has the spring
 * for it; otherwise he goes through: a stumble over the legs, a worse one
 * over a man's trunk, and an opponent on the ground who trips him up has
 * him down by contact (a runner touched by an opponent as he goes down is
 * down). Returns true if he went down.
 */
export function feetStep(s: PlayState, c: Agent, ai: boolean, startHurdle: (data: Record<string, number | string | boolean>) => boolean): boolean {
  if (c.down || (c.move === 'hurdle' && c.busy > 0)) return false;
  const sp = Math.sqrt(c.vel.x * c.vel.x + c.vel.y * c.vel.y);
  const ahead = bodyAhead(s, c, OVER_FAR);
  if (ai && ahead && ahead.trunk && ahead.at >= OVER_NEAR && sp > OVER_SPEED && c.busy === 0 && c.moveCooldown === 0 && !c.mem[`over${ahead.g.i}`]) {
    c.mem[`over${ahead.g.i}`] = true;
    const spring = c.p.attrs.jumping !== undefined ? c.fx.a('jumping') : c.fx.a('agility');
    if (spring >= OVER_SPRING || has(c, 'hurdler')) startHurdle({ over: ahead.g.i, tc: Math.round((ahead.at / sp) * 100) / 100 });
  }
  if (sp < 3) return false;
  for (const g of s.agents) {
    if (!g.down || !g.lie || g === c || heldTogether(s, g.i, c.i) || c.mem[`trip${g.i}`]) continue;
    const m = lyingGap(g.lie, c.pos.x, c.pos.y);
    if (m.d > DOWN_R + c.fx.radius * 0.3) continue;
    c.mem[`trip${g.i}`] = true;
    // Over the legs, a stride's stumble; into a man's trunk, a real one (Agility keeps him up).
    const hit = (m.along > -0.3 ? 0.7 : 0.3) * (1.3 - 0.6 * c.fx.a('agility'));
    c.mem.bal = Math.max(0, balanceOf(c) - hit);
    c.vel.x *= 0.85;
    c.vel.y *= 0.85;
    s.events.push({ t: s.t, type: 'move', who: [c.i], data: { move: 'stumble', over: g.i } });
    if (balanceOf(c) <= 0.05 && g.side !== c.side) {
      c.down = true;
      c.anim = 'tackled';
      s.events.push({ t: s.t, type: 'tackle', who: [g.i, c.i], at: { ...c.pos }, data: { kind: 'trip', fall: 'forward', fx: c.vel.x / Math.max(0.1, sp), fy: c.vel.y / Math.max(0.1, sp), gang: 1, wrapT: 0 } });
      return true;
    }
  }
  return false;
}
