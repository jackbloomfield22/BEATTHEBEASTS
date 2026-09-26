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
import type { Agent, Move } from './types';
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
