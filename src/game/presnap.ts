// What a quarterback sees and gets before the snap (the trait catalog's
// pre-snap traits). Pure; the screens and the clock read it.
//
// - Field General: "sees the Beasts' coverage shell pre-snap (shown on the
//   play-call screen)": the shell they'll line up in (one deep safety or
//   two: their call, or the disguise they'll show), on the play call before
//   he picks the play. His fifth audible is audible.ts audiblesFor.
// - Pre-Snap Wizard: "blitzers are highlighted before the snap; a hot-route
//   change costs no play-clock time": the men who'll really rush that
//   aren't linemen (not the ones who walk up to show it and drop), marked
//   at the line; and the play clock holds while his hot-route picker is open.

import { holds, SINGLE_HIGH, type DefCall, type PlayState, type SimPlayer } from '@/sim';

export type Shell = 'single-high' | 'two-high';

/** The shell a Field General reads off the Beasts' call before the play call, or null for anyone else. */
export function shellFor(qb: SimPlayer | null | undefined, call: DefCall | null | undefined): Shell | null {
  if (!call || !holds(qb ?? undefined, 'field-general')) return null;
  return SINGLE_HIGH.includes(call.shell ?? call.id) ? 'single-high' : 'two-high';
}

/** The play-call screen's line for the shell. */
export const SHELL_LABEL: Record<Shell, string> = { 'single-high': 'Single-high shell: one deep safety', 'two-high': 'Two-high shell: two deep safeties' };

/** The Beasts who'll blitz on this snap (agent indices): rushers who aren't linemen, from the real call. Empty unless his QB is a Pre-Snap Wizard. */
export function blitzersShown(s: PlayState): number[] {
  if (!holds(s.agents[s.qb]!.p, 'pre-snap-wizard')) return [];
  return s.def.filter((i) => {
    const d = s.agents[i]!;
    return s.setup.def.assign[d.slot as keyof typeof s.setup.def.assign].kind === 'rush' && d.p.pos !== 'DE' && d.p.pos !== 'DT';
  });
}

/** The play clock holds while this QB's hot-route picker is open (a Pre-Snap Wizard's hot route costs no time). */
export const hotRouteHoldsClock = (qb: SimPlayer | null | undefined): boolean => holds(qb ?? undefined, 'pre-snap-wizard');
