// What a catch looks like, for the drawing (passing round 5,
// docs/passing/PASSING5.md). Pure and read-only: the sim's own catchLook
// (passing.ts) decides what the catch does (the dive that lands him, the
// secure that takes him down in traffic, the toe tap's feet); this refines
// how it's drawn from where the ball gets to him and who he is:
//
// - hands: the ball at the chest to the face, in stride, thumbs together
//   (the diamond);
// - handsHigh: above the shoulders but not a jump ball: the arms up, the
//   diamond over the face mask;
// - handsLow: below the belt, the pinkies together, palms up;
// - scoop: at his shoe tops: the knees bend and the hands go under it;
// - reach: across or outside his frame: both arms extended to it, the
//   trunk leaning after them;
// - body: into the chest: elbows in, the forearms and the chest trap it.
//   A body catcher's way (Catching low, the Body Catcher trait), not a sure
//   hand's: a 95 plucks it away from the body, a 60 lets it in;
// - contested: a defender's arm in at the catch point: the hands strong on
//   it, chinned and covered at once, the shoulder into the man;
// - and the sim's own: highPoint, overShoulder, toeTap, oneHand, dive.
//
// The same play always draws the same way (a hash of the play's seed and
// the throw, never a random stream: rendering must not move the sim).

import type { Agent } from './types';
import type { PlayState } from './state';
import { catchLook } from './passing';
import { has } from './traits';
import { cos, sin } from '@/engine/math/detmath';

export type CatchStyle = 'hands' | 'handsHigh' | 'handsLow' | 'scoop' | 'reach' | 'body' | 'contested' | 'highPoint' | 'overShoulder' | 'toeTap' | 'oneHand' | 'dive';

/** The ball below this (yd, ~0.5 m: his knees) is scooped. Ours: a receiver's knee is ~0.5 m up. */
const SCOOP_Z = 0.55;
/** Below this (yd, ~0.9 m: the belt) the pinkies come together (passing.ts / choreo.ts LOW_HANDS). */
const LOW_Z = 1.0;
/** Above this (yd, ~1.5 m: the shoulders) the hands go up over the face mask. */
const HIGH_Z = 1.65;
/** A ball this far across his run (yd, ~0.5 m: past his shoulder) is reached for, arms extended. Ours: a shoulder is ~0.25 m off his centre line, a hand at full stretch ~0.8 m. */
const REACH_ACROSS = 0.55;
/** A ball this close to his line and at the chest (yd) can be let into the body. */
const BODY_ACROSS = 0.4;
const BODY_LO = 1.05;
const BODY_HI = 1.6;
/** A defender predicted within this of him at the arrival (yd) has an arm in: the catch through contact (choreo.ts CONTEST_R). */
export const CONTACT_R = 1.2;

/**
 * How often (0..1) a man lets a chest-high ball into his body instead of
 * catching it in his hands: none for sure hands (Catching 75 and up, or Glue
 * Hands / Sure Hands), rising to 90% for poor ones; a Body Catcher does it
 * 85% of the time whatever his Catching; Drops adds 15 points. Ours, sized
 * on the broadcast: the league's body catchers (Plaxico Burress, Terrell
 * Owens in his later years) trap most chest-high balls; Jerry Rice and Cris
 * Carter in their primes never did.
 */
export function bodyCatchShare(r: Agent): number {
  if (has(r, 'glue-hands') || has(r, 'sure-hands')) return 0;
  const c = r.fx.a('catching');
  let p = Math.max(0, Math.min(0.9, (0.75 - c) / 0.25));
  if (has(r, 'body-catcher')) p = Math.max(p, 0.85);
  if (has(r, 'drops')) p = Math.min(0.95, p + 0.15);
  return p;
}

/**
 * How far out in front of the body the hands meet the ball (0..1): the
 * pluck. A 95 Catching reaches out and takes it at the end of his arms (1);
 * a 60 waits for it to come to him (0). Ours, linear over the band real
 * receivers live in (Catching 60–95: the snapshot's WR median is 71).
 */
export function pluckOf(r: Agent): number {
  return Math.max(0, Math.min(1, (r.fx.a('catching') - 60 / 99) / (35 / 99)));
}

/** A small deterministic hash in [0, 1) of the play and the throw (not a sim stream). */
function hash01(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Where the ball gets to him relative to his run: across it (yd, + his left), its height (yd). */
export function arrivalOf(s: PlayState, r: Agent, at: { x: number; y: number; z: number } = s.ball.aim): { across: number; z: number; ahead: number } {
  const sp = Math.sqrt(r.vel.x * r.vel.x + r.vel.y * r.vel.y);
  const hx = sp > 1 ? r.vel.x / sp : cos(r.face);
  const hy = sp > 1 ? r.vel.y / sp : sin(r.face);
  const T = Math.max(0, s.ball.arrive - s.t);
  const px = at.x - (r.pos.x + r.vel.x * T);
  const py = at.y - (r.pos.y + r.vel.y * T);
  // The sim's y is to the left of its x: positive cross is on his left.
  return { across: hx * py - hy * px, z: at.z, ahead: hx * px + hy * py };
}

/** The defender who'll be on him at the arrival (within CONTACT_R, predicted), or null. */
export function contactAt(s: PlayState, r: Agent): Agent | null {
  const T = Math.max(0, s.ball.arrive - s.t);
  const ax = r.pos.x + r.vel.x * T;
  const ay = r.pos.y + r.vel.y * T;
  let best: Agent | null = null;
  let bd = CONTACT_R;
  for (const o of s.agents) {
    if (o.side === r.side || o.down) continue;
    const dx = o.pos.x + o.vel.x * T - ax;
    const dy = o.pos.y + o.vel.y * T - ay;
    const k = Math.sqrt(dx * dx + dy * dy);
    if (k < bd) {
      bd = k;
      best = o;
    }
  }
  return best;
}

/** How the catch is drawn: the sim's look, refined by where the ball gets to him and who he is. */
export function catchStyle(s: PlayState, r: Agent, at: { x: number; y: number; z: number } = s.ball.aim): CatchStyle {
  const look = catchLook(s, r, at);
  if (look !== 'hands' && look !== 'body') return look;
  const { across, z } = arrivalOf(s, r, at);
  // A defender's arm in at the catch point: through contact, whatever the hands.
  if (contactAt(s, r)) return 'contested';
  if (look === 'body') return 'body';
  if (z < SCOOP_Z) return 'scoop';
  if (Math.abs(across) >= REACH_ACROSS) return 'reach';
  if (z < LOW_Z) return 'handsLow';
  if (z >= HIGH_Z) return 'handsHigh';
  // Into the chest: a body catcher traps it, sure hands take it in the hands.
  if (Math.abs(across) < BODY_ACROSS && z >= BODY_LO && z < BODY_HI && hash01(s.setup.seed, Math.round(s.ball.releaseT * 60), r.i) < bodyCatchShare(r)) return 'body';
  return 'hands';
}
