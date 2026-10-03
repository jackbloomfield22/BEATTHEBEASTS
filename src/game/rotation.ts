// The backfield rotation (Playtest 2, M6.6): RB2 is the change-of-pace and
// third-down back, not a man who only lines up at fullback. Game layer only:
// the sim's personnel groupings (sim/personnel.ts) still decide which slots
// a formation fills; this decides which of your two backs is "the back" for
// a snap. TE2 needs nothing here: he comes on in 12 personnel and the heavy
// sets through the groupings (12: the SLOT spot; 22: the Z spot).
//
// Who's the back (first rule that applies):
//   1. 21 and 22 personnel: the starter. RB2 is already on the field as the
//      fullback there.
//   2. Short yardage and the goal line (a 'short' play, or 2 or fewer to go
//      inside the 5): the starter finishes.
//   3. Screens: RB2 ("most screens"; the ones from 21/22 stay the starter's).
//   4. Passing downs (3rd or 4th with 5+ to go): RB2, the third-down back,
//      unless only the starter holds the Third-Down Back trait (blitz pickup
//      and the check-release: the trait catalog), and then he stays on.
//   5. Otherwise every third snap of a drive (the 3rd, 6th, 9th...): RB2
//      spells the starter, the change of pace.
// Rule 5 gives RB2 a third of the early-down snaps, which is where most
// carries come from, so he ends up near a third of the carries (the
// playtest's target; an NFL RB2 averages 30–35% of his team's RB carries,
// Pro Football Reference team splits 2018–23, approximate). Deterministic:
// the same snap in the same spot always has the same back.

import { holds, type ContendersRoster, type OffPlay } from '@/sim';
import type { Situation } from './situation';

export type BackCall = { back: 'RB' | 'RB2'; why: 'fullback set' | 'short yardage' | 'screen' | 'passing down' | 'third-down back' | 'change of pace' | 'starter' };

/** Which back plays the RB spot on this snap. `snapInDrive` is 1-based; `team` (when given) reads the backs' traits. */
export function backFor(play: OffPlay, sit: Situation, snapInDrive: number, team?: ContendersRoster): BackCall {
  const p = play.formation.personnel;
  if (p === '21' || p === '22') return { back: 'RB', why: 'fullback set' };
  if (play.situ === 'short' || (sit.toGo <= 2 && sit.los >= 95)) return { back: 'RB', why: 'short yardage' };
  if (play.type === 'screen') return { back: 'RB2', why: 'screen' };
  if (sit.down >= 3 && sit.toGo >= 5) return team && holds(team.RB, 'third-down-back') && !holds(team.RB2, 'third-down-back') ? { back: 'RB', why: 'third-down back' } : { back: 'RB2', why: 'passing down' };
  if (snapInDrive > 0 && snapInDrive % 3 === 0) return { back: 'RB2', why: 'change of pace' };
  return { back: 'RB', why: 'starter' };
}

/** The squad for a snap: the two backs swapped when RB2 has it (the personnel groupings then fill the eleven as always). */
export function squadFor(team: ContendersRoster, play: OffPlay, sit: Situation, snapInDrive: number): ContendersRoster {
  return backFor(play, sit, snapInDrive, team).back === 'RB2' ? { ...team, RB: team.RB2, RB2: team.RB } : team;
}
