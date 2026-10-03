// How the playbook uses the men on the field (Playtest 2, "every player is
// himself"): the traits whose catalog line changes an assignment rather than
// a rating. A play is drawn for anyone; `personalize` turns it into the play
// this eleven runs, at the snap (createPlay) and on the play-call screen's
// art, so the two can't disagree.
//
// - Volume TE: "the QB's progression starts with him": a tight end who holds
//   it is the first read whenever he runs a route (the rest keep their order
//   behind him).
// - Receiving Back: "runs the full receiver route tree from the backfield
//   (wheel, option, angle)": where the book gives the back an outlet (the
//   check-down, the play-action arrow), a receiving back runs a real route
//   instead: the angle in the quick game, the option on the drop-backs and
//   shots, the wheel off play action.

import { has } from './traits';
import type { Assignment, OffPlay, RouteName } from './plays';
import type { OffSlot, SimPlayer } from './types';

const holds = (p: SimPlayer | undefined, id: string): boolean => !!p && has({ p }, id);

/** The receiving back's route for an outlet the book gives him, or null to keep it. */
export function receivingBackRoute(play: OffPlay, route: RouteName): RouteName | null {
  if (route === 'checkdown') return play.type === 'quick' ? 'angle' : play.type === 'dropback' || play.type === 'shot' ? 'option' : null;
  if (route === 'arrow' && play.type === 'playAction') return 'wheel';
  return null;
}

/** The play as this eleven runs it (the same object when nothing changes). */
export function personalize(play: OffPlay, offense: Record<OffSlot, SimPlayer>): OffPlay {
  let assign: Record<OffSlot, Assignment> | null = null;
  const edit = (): Record<OffSlot, Assignment> => (assign ??= { ...play.assign });
  // Receiving Back: the back's outlet becomes a route.
  const rb = play.assign.RB;
  if (rb.kind === 'route' && holds(offense.RB, 'receiving-back')) {
    const to = receivingBackRoute(play, rb.route);
    if (to) edit().RB = { kind: 'route', route: to, read: rb.read };
  }
  // Volume TE: the progression starts with him.
  const te = (['TE', 'SLOT', 'Z', 'X'] as OffSlot[]).find((k) => {
    const a = play.assign[k];
    return a.kind === 'route' && offense[k]?.pos === 'TE' && holds(offense[k], 'volume-te');
  });
  const ta = te ? play.assign[te] : undefined;
  if (te && ta?.kind === 'route' && ta.read > 1) {
    const m = edit();
    for (const k of Object.keys(m) as OffSlot[]) {
      const a = m[k];
      if (a.kind === 'route' && a.read < ta.read) m[k] = { ...a, read: a.read + 1 };
    }
    m[te] = { ...ta, read: 1 };
  }
  return assign ? { ...play, assign } : play;
}
