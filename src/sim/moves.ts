// The ball carrier's three move options (M6.5 #9, the owner's brief): three
// of the six moves at a time, chosen by the picture in front of him and
// mapped to 1, 2, 3 in that moment, the move most likely to work always in
// slot 1. Pure and deterministic: the sim holds the current three on the
// carrier (mem.opts) so the HUD shows exactly what a press will do.
//
// - A tackler coming from the side (35–120° off his run): juke, stiff arm, spin.
// - One square in front (within 35°): truck, spin, juke.
// - Open field (nobody who can get to him within OPEN_R): dive, protect, and
//   the best move for the nearest defender's angle.
// Inside each set the order is the odds (contact.ts tackleOdds, the same
// numbers the tackle roll uses): the chance he isn't brought down by that man.

import { atan2, cos, sin } from '@/engine/math/detmath';
import { blockOf } from './blocks';
import { tackleOdds } from './contact';
import type { PlayState } from './state';
import { GOAL_X, type Agent, type Move } from './types';
import { dist } from './vec';

/** A move as the HUD names it: the juke's side is picked when it's pressed (away from the tackler). */
export type MoveOption = 'juke' | 'stiffArm' | 'spin' | 'truck' | 'dive' | 'protect';

/** Nobody within this (yd) in front of him: the open field. */
const OPEN_R = 6;
/** How often the options are re-read (ticks): steady enough to read, quick enough to follow the picture. */
export const OPTIONS_EVERY = 12;
/** A tackler inside this angle off his run (deg) is square in front of him. */
const SQUARE_DEG = 35;

/** The defender the options are about: the nearest one in front of him or beside him who isn't blocked. */
export function threatOf(s: PlayState, c: Agent): Agent | null {
  const attack = c.side === 'off' ? 1 : -1;
  let best: Agent | null = null;
  let bd = Infinity;
  for (const i of c.side === 'off' ? s.def : s.off) {
    const d = s.agents[i]!;
    if (d.down || blockOf(s, i)) continue;
    // Behind him and falling away doesn't count: he's past.
    if ((d.pos.x - c.pos.x) * attack < -1) continue;
    const k = dist(d.pos, c.pos);
    if (k < bd) {
      bd = k;
      best = d;
    }
  }
  return best;
}

/** How likely a move is to keep him up against this man: evade outright, else break it. */
export function moveOdds(s: PlayState, c: Agent, d: Agent, mv: MoveOption): number {
  if (mv === 'dive' || mv === 'protect') return 0;
  const m: Move = mv === 'juke' ? 'jukeL' : mv;
  const o = tackleOdds(s, d, c, m);
  return o.evade + (1 - o.evade) * (1 - o.tackle);
}

/** The three options for him now, the likeliest to work first. */
export function carrierOptions(s: PlayState, c: Agent): [MoveOption, MoveOption, MoveOption] {
  const d = threatOf(s, c);
  const rank = (ms: MoveOption[]) => (d ? [...ms].sort((a, b) => moveOdds(s, c, d, b) - moveOdds(s, c, d, a)) : ms);
  if (!d || dist(d.pos, c.pos) > OPEN_R) {
    // Open field: the best move for the nearest man's angle, then the dive and protecting it.
    const best = d ? rank(angleSet(c, d))[0]! : 'juke';
    return [best, 'dive', 'protect'];
  }
  const r = rank(angleSet(c, d));
  return [r[0]!, r[1]!, r[2]!];
}

/** The three moves that suit a man at this angle to his run. */
function angleSet(c: Agent, d: Agent): MoveOption[] {
  const attack = c.side === 'off' ? 1 : -1;
  const sp = Math.sqrt(c.vel.x * c.vel.x + c.vel.y * c.vel.y);
  const heading = sp > 1 ? atan2(c.vel.y, c.vel.x) : attack > 0 ? 0 : Math.PI;
  const to = atan2(d.pos.y - c.pos.y, d.pos.x - c.pos.x);
  const off = Math.abs(atan2(sin(to - heading), cos(to - heading)));
  return off < (SQUARE_DEG * Math.PI) / 180 ? ['truck', 'spin', 'juke'] : ['juke', 'stiffArm', 'spin'];
}

/**
 * The AI carrier's move against this man: the likeliest to work of the three
 * that suit his angle, by the same odds the HUD ranks (Playtest 2, identity
 * harness: the AI picked by comparing two ratings, so Brandon Jacobs, Trucking
 * 97, stiff-armed as often as he trucked, and his broken tackles were 7%
 * trucks). A juke goes away from him.
 */
export function aiMove(s: PlayState, c: Agent, d: Agent): Move {
  const best = [...angleSet(c, d)].sort((a, b) => moveOdds(s, c, d, b) - moveOdds(s, c, d, a))[0]!;
  if (best !== 'juke') return best as Move;
  const attack = c.side === 'off' ? 1 : -1;
  return (d.pos.y - c.pos.y) * attack > 0 ? 'jukeR' : 'jukeL';
}

/** A tackler this close (yd) is one the one-button move is made against; farther, the button waits for him. */
const AUTO_R = 3.5;
/** Two or more tacklers this close (yd): he wraps up the ball instead of trying a move. */
const SWARM_R = 2;
/** Within this of the line to gain or the goal line (yd), a tackler on him means he dives for it. */
const REACH_R = 2;

/**
 * The one-button move (Space / A with the ball): the move a back would make
 * himself against what's in front of him now.
 * - Two or more tacklers converging: protect the ball.
 * - A man on him short of the sticks or the goal line: dive for it.
 * - Otherwise the likeliest move for the angle and the man (the same ranking
 *   as the HUD's options: juke, spin, stiff arm, truck); a juke goes away from him.
 * Null when nobody is close enough to beat yet (the press is ignored, not wasted).
 */
export function autoMove(s: PlayState, c: Agent): Move | 'protect' | null {
  const d = threatOf(s, c);
  if (!d || dist(d.pos, c.pos) > AUTO_R) return null;
  const attack = c.side === 'off' ? 1 : -1;
  let swarm = 0;
  for (const i of c.side === 'off' ? s.def : s.off) {
    const o = s.agents[i]!;
    if (!o.down && !blockOf(s, i) && dist(o.pos, c.pos) < SWARM_R) swarm++;
  }
  if (swarm >= 2) return 'protect';
  const x = c.pos.x * attack;
  const sticks = (s.setup.los + s.setup.toGo) * attack;
  const goal = attack > 0 ? GOAL_X : 0;
  const short = (target: number) => target - x > 0 && target - x < REACH_R;
  if (short(sticks) || short(goal * attack)) return 'dive';
  return aiMove(s, c, d);
}
