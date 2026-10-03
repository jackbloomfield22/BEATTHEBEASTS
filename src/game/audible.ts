// Audibles at the line (Playtest 2): a small set the quarterback can check
// to after seeing the defense, on a key with prompts. A real audible can't
// change who's on the field, so each call stays in the same personnel
// (sim/personnel.ts fills the slots from it), and in the same formation when
// the book has one, so the line just re-sets; the coordinator's ranking for
// the situation picks between candidates. A call the personnel has no play
// for is offered greyed out with the reason.

import { holds, PLAYS, playUnlocked, suggestPlays, type ContendersRoster, type OffPlay, type OffSituation, type SimPlayer } from '@/sim';

export type AudibleKind = 'quick' | 'run' | 'paShot' | 'screen' | 'dropback';

/** The picker's order (keys 1–4; on a pad A, B, X, Y). */
export const AUDIBLES: { kind: AudibleKind; label: string }[] = [
  { kind: 'quick', label: 'Quick pass' },
  { kind: 'run', label: 'Run' },
  { kind: 'paShot', label: 'PA shot' },
  { kind: 'screen', label: 'Screen' },
];

/** A Field General's fifth slot (the trait catalog's line): a drop-back concept (key 5; on a pad RB). */
const FIFTH: { kind: AudibleKind; label: string } = { kind: 'dropback', label: 'Drop-back' };

/** The audibles this quarterback has at the line: four, five for a Field General. */
export function audiblesFor(qb: SimPlayer | null | undefined): { kind: AudibleKind; label: string }[] {
  return holds(qb ?? undefined, 'field-general') ? [...AUDIBLES, FIFTH] : AUDIBLES;
}

const fits = (p: OffPlay, kind: AudibleKind): boolean => {
  if (p.situ || p.hailMary) return false;
  if (kind === 'quick') return p.type === 'quick';
  if (kind === 'run') return p.type === 'run';
  if (kind === 'screen') return p.type === 'screen';
  if (kind === 'dropback') return p.type === 'dropback';
  return p.type === 'playAction';
};

/** The play an audible of `kind` checks to from `current`, or null when this personnel has none. */
export function audiblePlay(current: OffPlay, kind: AudibleKind, sit: OffSituation, team: ContendersRoster | null): OffPlay | null {
  const pool = PLAYS.filter((p) => p.id !== current.id && fits(p, kind) && p.formation.personnel === current.formation.personnel && playUnlocked(p, team));
  if (!pool.length) return null;
  const rank = team ? suggestPlays(sit, team, PLAYS.length) : [];
  const at = (p: OffPlay) => {
    const k = rank.indexOf(p.id);
    return k < 0 ? PLAYS.length + PLAYS.indexOf(p) : k;
  };
  // Same formation first (the line re-sets in place), then the coordinator's order.
  const sameForm = (p: OffPlay) => (p.formation.name === current.formation.name ? 0 : 1);
  return [...pool].sort((a, b) => sameForm(a) - sameForm(b) || at(a) - at(b))[0]!;
}
