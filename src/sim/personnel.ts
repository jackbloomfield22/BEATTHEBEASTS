// Personnel (GDD §10.2): the drafted Contenders roster is nine slots (a QB,
// two backs, three receivers, two tight ends and a five-man line), and the
// sim keeps its eleven offensive slots. A formation's personnel grouping
// (backs then tight ends) decides who fills them; where each man lines up
// stays in the formation's alignment.

import type { OffPlay, Personnel } from './plays';
import type { OffSlot, SimPlayer } from './types';

export interface ContendersRoster {
  QB: SimPlayer;
  RB: SimPlayer;
  RB2: SimPlayer;
  WR1: SimPlayer;
  WR2: SimPlayer;
  WR3: SimPlayer;
  TE: SimPlayer;
  TE2: SimPlayer;
  /** LT LG C RG RT */
  OL: [SimPlayer, SimPlayer, SimPlayer, SimPlayer, SimPlayer];
}

/** A roster slot that fills one of the sim's skill slots. */
export type RosterSkill = 'RB' | 'RB2' | 'WR1' | 'WR2' | 'WR3' | 'TE' | 'TE2';

/**
 * Who plays each skill slot, by grouping.
 * - 11 (one back, one tight end): the three receivers, the tight end, the back.
 * - 12: the second tight end takes the SLOT slot (the formation aligns him in-line).
 * - 21: the second back takes the SLOT slot as the fullback.
 * - 22: the fullback in the SLOT slot and the second tight end in the Z slot (one receiver left).
 * - 10 (one back, no tight end, four wide): the roster carries three receivers,
 *   so the fourth wideout is the tight end detached from the line.
 */
export const PERSONNEL: Record<Personnel, Record<'RB' | 'X' | 'Z' | 'SLOT' | 'TE', RosterSkill>> = {
  '10': { RB: 'RB', X: 'WR1', Z: 'WR2', SLOT: 'WR3', TE: 'TE' },
  '11': { RB: 'RB', X: 'WR1', Z: 'WR2', SLOT: 'WR3', TE: 'TE' },
  '12': { RB: 'RB', X: 'WR1', Z: 'WR2', SLOT: 'TE2', TE: 'TE' },
  '21': { RB: 'RB', X: 'WR1', Z: 'WR2', SLOT: 'RB2', TE: 'TE' },
  '22': { RB: 'RB', X: 'WR1', Z: 'TE2', SLOT: 'RB2', TE: 'TE' },
};

/** The eleven on the field for a play: the formation's grouping fills the skill slots, the line is the line. */
export function offenseFor(play: OffPlay, team: ContendersRoster): Record<OffSlot, SimPlayer> {
  const g = PERSONNEL[play.formation.personnel];
  const [LT, LG, C, RG, RT] = team.OL;
  return { QB: team.QB, RB: team[g.RB], X: team[g.X], Z: team[g.Z], SLOT: team[g.SLOT], TE: team[g.TE], LT, LG, C, RG, RT };
}

/** How many wide receivers a grouping puts on the field (the Beasts' nickel trigger: three or more). */
export const receiversIn = (p: Personnel): number => (Object.values(PERSONNEL[p]) as RosterSkill[]).filter((k) => k.startsWith('WR')).length + (p === '10' ? 1 : 0);
