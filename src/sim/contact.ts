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
import { TICK, type Agent, type Move } from './types';
import { dist, len } from './vec';
import { has, more } from './traits';

/**
 * The tackle logistic's base: ~90% for an even matchup (NFL missed-tackle
 * rate ~10–15% of attempts, PFF/SIS). M5.5 had 2.1 (~89% before the move and
 * mass terms). With the steeper skill slope (TACKLE_K) the base comes down so
 * an average tackler on an average back lands where 2.4 and 3.2 did.
 */
const TACKLE0 = 2.11;
/**
 * The skill slope (logit per unit of Tackle over Break Tackle). Playtest 2,
 * identity harness: at 3.2, with Tackle 60% of the tackler's side, Ed Reed
 * (Tackle 33) finished 88% of his tries and Kam Chancellor (95) 93%, a gap
 * no fan would see. At 5 with Tackle 75%: ~75% and ~97%.
 */
const TACKLE_K = 5;
/** The juke and spin's evade: the logit at an average move against a good tackler from the side, and its slope (see tackleOdds). */
const EVADE0 = -0.83;
const EVADE_K = 4.3;
/** A QB behind the line is easier to bring down than a back (logit): the sack. */
const QB_BACK_EDGE = 0.8;
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
 * The odds when a defender reaches the ball carrier who's in `mv` (or no
 * move): the chance a juke or spin beats him outright (`evade`, 0 for the
 * other moves), then the chance he makes the tackle (`tackle`). Pure, so the
 * carrier's move options (moves.ts) are ranked by the same numbers the
 * roll uses.
 */
export function tackleOdds(s: PlayState, d: Agent, c: Agent, mv: Move | null): { evade: number; tackle: number; closing: number; headOn: number } {
  // Approach: closing speed and the angle relative to his run.
  const rvx = d.vel.x - c.vel.x;
  const rvy = d.vel.y - c.vel.y;
  const dx = c.pos.x - d.pos.x;
  const dy = c.pos.y - d.pos.y;
  const dd = Math.max(1e-6, Math.sqrt(dx * dx + dy * dy));
  const closing = Math.max(0, (rvx * dx + rvy * dy) / dd);
  const cs = len(c.vel);
  const headOn = cs > 0.5 ? -(c.vel.x * dx + c.vel.y * dy) / (cs * dd) : 0; // +1 meeting him, −1 from behind
  // Freight Train: at full speed his momentum counts 15% more (the trait catalog's line).
  const pMom = c.fx.mass * cs * (cs > 0.85 * c.fx.vmax && has(c, 'freight-train') ? 1.15 : 1);
  const dMom = d.fx.mass * Math.max(closing, len(d.vel) * 0.5);
  const massEdge = (pMom - dMom) / Math.max(1, pMom + dMom); // + carrier heavier/faster
  const gang = s.def.concat(s.off).filter((k) => {
    const o = s.agents[k]!;
    return o.side === d.side && o.i !== d.i && !o.down && dist(o.pos, c.pos) < 1.6;
  }).length;
  const tackle = d.fx.a('tackle') * 0.75 + d.fx.a('hitPower') * 0.15 + d.fx.a('pursuit') * 0.1;
  // A quarterback behind the line isn't a back running through a tackle
  // (Playtest 1/2: a scrambling QB shrugged off the end chasing him on every
  // long scramble; the tackle was broken as an arm tackle from behind by a
  // man running away): his momentum counts half, a grab from behind isn't
  // weaker, and only a big, strong QB (Break Tackle) gets out of it often.
  const qbBack = c.i === s.qb && (c.pos.x - s.setup.los) * (c.side === 'off' ? 1 : -1) < 0;
  // The carrier's counter: the move he's in, else Break Tackle.
  const counterAttr = mv ? MOVE_ATTR[mv] ?? 'breakTackle' : 'breakTackle';
  // Spam: each recent move takes a bite out of the next (GDD §9.3).
  const counter = c.fx.a(counterAttr) * (1 - Math.min(0.6, c.moveFatigue * 0.25));
  // Juke / spin: beat the tackler outright, or it's a loss if he's squared up.
  let evade = 0;
  if (mv === 'jukeL' || mv === 'jukeR' || mv === 'spin') {
    const squared = headOn > 0.7 && closing < 3;
    // Centred on the band backs occupy (Playtest 2, identity harness: at
    // 4·(Elusiveness − ½ Tackle − 0.3 Pursuit) + 0.6 a 48-Elusiveness back
    // beat a good tackler from the side 41% of the time, so Brandon Jacobs
    // juked, and tacklers were missed 0.3–0.5 a carry). Now from the side
    // against a good tackler (Tackle and Pursuit 90): ~55% for a 99, ~30%
    // for a 75, ~12% for a 48; squared up, about half that.
    const skill = counter - 0.75 - (d.fx.a('tackle') * 0.5 + d.fx.a('pursuit') * 0.3 - 0.72);
    evade = logistic(EVADE0 + EVADE_K * skill + (squared ? -1.2 : 0));
  }
  // Baseline ~85% per attempt for an even matchup (NFL missed-tackle rate
  // runs 10–15% of attempts: PFF / Sports Info Solutions charting).
  let x = TACKLE0 + TACKLE_K * (tackle - counter * 0.85) - (qbBack ? 0.9 : 1.8) * massEdge + 0.7 * gang + (qbBack ? QB_BACK_EDGE : 0);
  if (mv === 'stiffArm') x -= 0.5 * c.fx.a('stiffArm');
  if (mv === 'truck') x -= 0.8 * c.fx.a('trucking') * (c.fx.mass / (c.fx.mass + d.fx.mass)) * 2 - 0.4;
  if (headOn < -0.3 && !qbBack) x -= 0.4; // arm tackles from behind get broken more (not on a QB still behind the line)
  // The traits, as the catalog words them: a factor on the chance he gets
  // away (the miss), so "20% more often" is 1.2.
  const first = ((c.mem.tries as number | undefined) ?? 0) === 0;
  const caught = c.mem.caughtAt !== undefined;
  const db = d.p.pos === 'CB' || d.p.pos === 'S';
  const alone = gang === 0;
  let miss = 1;
  if (caught && first) miss *= more(c, 'yac-monster', 0.2) * more(c, 'big-play', 0.1); // the first missed tackle after the catch
  if (caught && db && alone) miss *= more(c, 'bruiser-te', 0.2); // DBs tackling him alone lose the collision
  if (headOn > 0.3) miss *= more(c, 'battering-ram', 0.2); // runs through arm tackles head on
  if (first && headOn < 0.5) miss *= more(c, 'tackle-breaker', 0.3); // the first attempt needs a clean wrap; glancing hits shrugged off
  if (first && alone) miss *= more(c, 'scatback', 0.1); // the first defender in space
  if (mv === 'stiffArm' && Math.abs(headOn) < 0.5) miss *= more(c, 'stiff-arm-king', 0.2); // a stiff arm on a man from the side
  if (alone && counter > d.fx.a('tackle')) miss *= more(d, 'arm-tackler', 0.2); // in space, against a carrier stronger than his tackling
  if (qbBack && has(d, 'sack-artist')) miss *= 1 / 1.2; // when he wins he finishes: the sack 20% more often
  if (qbBack && first && cs > 2) miss *= more(c, 'escape-artist', 0.2); // the first free rusher on a QB on the move
  if (!alone && has(d, 'tackling-machine')) miss *= 0.5; // in on every pile: no broken tackles against it
  const p = logistic(x);
  if (evade > 0) evade = Math.min(0.95, evade * more(c, 'ankle-breaker', 0.1)); // juke ceiling +10%
  return { evade, tackle: Math.max(0, 1 - (1 - p) * miss), closing, headOn };
}

/**
 * Resolve a defender reaching the ball carrier. Returns the outcome and the
 * hit's force (kN-ish, for the camera and the ragdoll).
 */
export function resolveTackle(s: PlayState, d: Agent, c: Agent): { out: TackleOutcome; force: number } {
  const rng = s.rng.contact;
  const mv = c.move && c.busy > 0 ? c.move : null;
  const o = tackleOdds(s, d, c, mv);
  c.mem.tries = ((c.mem.tries as number | undefined) ?? 0) + 1;
  if (o.evade > 0 && rng() < o.evade) return { out: 'missed', force: 0 };
  const force = (d.fx.mass * o.closing) / 60;
  if (rng() < o.tackle) return { out: isBigHit(s, d, c, o.closing, o.headOn) ? 'bigHit' : 'tackle', force };
  return { out: 'broken', force: force * 0.6 };
}

/** Fumble on contact: Ball Security against Hit Power; protecting halves it. */
export function fumbles(s: PlayState, d: Agent, c: Agent, big: boolean): boolean {
  // Playtest 2: the ball comes out on a true big hit only, not on every
  // tackle; the exception is a Ball Punch, whose every tackle carries a
  // punch-out attempt (the trait catalog: +30% on the tackle's fumble
  // chance, here 1.3× the ~1.2% a sure-handed back loses per carry).
  if (!big) return has(d, 'ball-punch') && s.rng.contact() < 0.016 * (1.4 - 0.9 * c.fx.a('ballSecurity'));
  // NFL backs fumble on ~1–1.5% of carries (about half lost); M6 trimmed this from 0.008 + 0.03·(…), which ran ~2.8% against the Beasts' hitters.
  const base = 0.004 + 0.02 * Math.max(0, d.fx.a('hitPower') - c.fx.a('ballSecurity') * 0.8);
  // A big hit jars it loose far more often (~5–8% for a sure-handed back,
  // double for a loose one), more again from a Bone Crusher; Ball Security resists.
  // Fumble Risk: +40% on big hits (the trait catalog's line).
  const jar = big ? 0.07 * (1.4 - 0.9 * c.fx.a('ballSecurity')) * (has(d, 'bone-crusher') ? 1.1 : 1) * more(c, 'fumble-risk', 0.4) : 0;
  const p = (base + jar) * (c.move === 'protect' ? 0.4 : 1);
  return s.rng.contact() < p;
}


/**
 * A big hit, by design (feedback item 5): the hit's energy against what the
 * runner can take. Energy is the tackler's closing speed times his weight,
 * put behind the ball carrier by Hit Power (and an Enforcer's intent); the
 * runner takes it with Break Tackle, his own mass and his momentum into the
 * hit (a man running through a tackler braces; one hit from the side or
 * already slowing doesn't). Only a clearly heavier blow than he can take is
 * big, and then not every time: a few a game at Pro (~5% of tackles; the
 * harness counts them).
 */
export function isBigHit(s: PlayState, d: Agent, c: Agent, closing: number, headOn: number): boolean {
  const hp = d.fx.a('hitPower');
  const power = 0.1 + 1.2 * hp * hp + (has(d, 'enforcer') ? 0.15 : 0);
  const energy = closing * (d.fx.mass / 100) * power;
  const into = Math.max(0, headOn) * len(c.vel) * (c.fx.mass / 100);
  const brace = 9.0 + 3 * c.fx.a('breakTackle') + 3 * (c.fx.mass / 100 - 0.9) + 0.25 * into;
  if (energy <= brace) return false;
  return s.rng.contact() < Math.min(0.85, (energy - brace) / 3);
}

/**
 * Ticks over which a move's change of velocity is applied: the plant. A cut
 * at speed takes one or two foot contacts (~80–100 ms at a sprint's ~4.5
 * steps/s), so the juke's sidestep and the spin's slowdown build over that
 * instead of teleporting the velocity in one tick.
 */
const PLANT: Record<string, number> = { jukeL: 5, jukeR: 5, spin: 6, dive: 3 };

/** A quarterback's dive is a slide (feet first: he gives himself up and can't be hit); not on a designed QB run (the sneak: he dives for the yard). */
export const slides = (c: Agent): boolean => c.slot === 'QB' && c.side === 'off' && !c.mem.designed;

/** A carrier's move: commits him for a few frames and sets a cooldown. False if he can't start it now. */
export function startMove(s: PlayState, c: Agent, mv: NonNullable<Agent['move']>): boolean {
  if (c.busy > 0 || c.moveCooldown > 0 || c.down) return false;
  const frames: Record<string, number> = { jukeL: 16, jukeR: 16, spin: 24, stiffArm: 20, truck: 18, dive: 30, protect: 1 };
  c.move = mv;
  c.busy = frames[mv] ?? 12;
  // Spin Cycle: spins chain (two in a run); Human Joystick: any move chains with no recovery (the trait catalog's lines).
  c.moveCooldown = c.busy + (has(c, 'human-joystick') ? 0 : mv === 'spin' && has(c, 'spin-cycle') ? 8 : 24);
  c.moveFatigue = Math.min(3, c.moveFatigue + 1);
  c.anim = mv === 'jukeL' || mv === 'jukeR' ? 'juke' : mv === 'protect' ? c.anim : mv;
  // The move's footwork: a juke steps sideways, a spin costs speed, a dive lunges.
  const sp = len(c.vel);
  const hx = sp > 0.3 ? c.vel.x / sp : 1;
  const hy = sp > 0.3 ? c.vel.y / sp : 0;
  let tx = c.vel.x;
  let ty = c.vel.y;
  if (mv === 'jukeL' || mv === 'jukeR') {
    const side = mv === 'jukeL' ? 1 : -1;
    const k = 1.6 + 1.4 * c.fx.a('elusiveness');
    // Jump Cut: the lateral jump cut costs no speed (the trait catalog's line).
    const keep = has(c, 'jump-cut') ? 1 : 0.75;
    tx = hx * sp * keep - hy * side * k;
    ty = hy * sp * keep + hx * side * k;
  } else if (mv === 'spin') {
    // Spin Cycle: keeps 90% of his speed.
    const keep = has(c, 'spin-cycle') ? 0.9 : 0.7;
    tx *= keep;
    ty *= keep;
  } else if (mv === 'dive' && slides(c)) {
    // A QB's slide: feet first, giving himself up. He's down where it began
    // (forward progress), and he slows along the turf (~60% of his speed).
    c.mem.slideX = c.pos.x;
    tx = hx * sp * 0.6;
    ty = hy * sp * 0.6;
  } else if (mv === 'dive') {
    tx = hx * Math.max(sp, 4);
    ty = hy * Math.max(sp, 4);
  }
  const n = PLANT[mv];
  if (n) c.impulse = { x: (tx - c.vel.x) / n, y: (ty - c.vel.y) / n, left: n };
  s.events.push({ t: s.t, type: 'move', who: [c.i], data: { move: mv === 'dive' && slides(c) ? 'slide' : mv } });
  return true;
}

/** One tick of a move's velocity change (see PLANT). */
export function applyImpulse(a: Agent): void {
  const m = a.impulse;
  if (!m) return;
  a.vel.x += m.x;
  a.vel.y += m.y;
  if (--m.left <= 0) a.impulse = null;
}

/** Per-tick bookkeeping for moves: timers, fatigue recovery. */
export function tickMoves(a: Agent): void {
  if (a.busy > 0) a.busy--;
  if (a.moveCooldown > 0) a.moveCooldown--;
  if (a.burst > 0) a.burst--;
  if (a.burstCd > 0) a.burstCd--;
  if (a.busy === 0 && a.move && a.move !== 'protect') a.move = null;
  a.moveFatigue = Math.max(0, a.moveFatigue - TICK * 0.5);
}
