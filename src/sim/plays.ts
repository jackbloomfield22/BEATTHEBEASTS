// Plays as data (TECH_PLAN §10 "Plays as data"). The M5.5 book (feedback
// item 6): quick game, dropback concepts, shots, play action, screens and
// designed runs; M6 grows it to the GDD §10.2 table, with personnel
// groupings (personnel.ts): the drafted roster carries two backs, three
// receivers and two tight ends, and each formation says who fills the sim's
// eleven slots (the second tight end or the fullback in the SLOT slot, the
// second tight end in the Z slot in 22).
//
// Alignments are relative to the ball: dx back from the line of scrimmage
// (negative = offense's backfield), dy across (+ = offense's left). Routes are
// waypoints relative to the receiver's alignment in "stem" coordinates:
// d = yards downfield, o = yards toward his own sideline (outside, + ) or
// toward the middle (−), so one route serves both sides of the formation.

import type { DefSlot, OffSlot } from './types';

export interface RoutePoint {
  d: number;
  o: number;
  /** Settle here (sit/hitch/curl): stop and face the QB. */
  sit?: boolean;
}

export type RouteName =
  | 'go'
  | 'fade'
  | 'seam'
  | 'hitch'
  | 'stick'
  | 'slant'
  | 'out'
  | 'dig'
  | 'corner'
  | 'post'
  | 'flat'
  | 'curl'
  | 'drag'
  | 'wheel'
  | 'checkdown'
  | 'swing'
  | 'sit'
  | 'in'
  | 'comeback'
  | 'qout'
  | 'bubble'
  | 'slip'
  | 'sail'
  | 'cross'
  | 'spot'
  | 'arrow'
  | 'qin'
  | 'leak';

export const ROUTES: Record<RouteName, RoutePoint[]> = {
  go: [{ d: 45, o: 1 }],
  fade: [{ d: 8, o: 1.5 }, { d: 45, o: 4 }],
  seam: [{ d: 45, o: -1 }],
  hitch: [{ d: 6, o: 0 }, { d: 5, o: 0, sit: true }],
  stick: [{ d: 6, o: 0 }, { d: 6, o: -0.8, sit: true }],
  // Slant: two steps, then 45° inside; caught 5–8 yd downfield. Uncaught, it flattens across the field (not on to 20 yd).
  slant: [{ d: 2, o: 0 }, { d: 7, o: -5 }, { d: 10, o: -13 }],
  out: [{ d: 10, o: 0 }, { d: 10, o: 12 }],
  dig: [{ d: 12, o: 0 }, { d: 12, o: -25 }],
  corner: [{ d: 11, o: 0 }, { d: 22, o: 9 }, { d: 30, o: 12 }],
  post: [{ d: 12, o: 0 }, { d: 35, o: -12 }],
  // Out to the flat at full speed; if the ball hasn't come by the numbers he sits down in the space (he doesn't turn it into a wheel).
  flat: [{ d: 1.5, o: 2 }, { d: 4, o: 10 }, { d: 4.5, o: 12, sit: true }],
  curl: [{ d: 12, o: 0 }, { d: 10, o: -1.5, sit: true }],
  // Shallow across to the far numbers (~22 yd), then on up the field.
  drag: [{ d: 2, o: -2 }, { d: 5, o: -22 }],
  wheel: [{ d: 1, o: 6 }, { d: 5, o: 10 }, { d: 40, o: 11 }],
  checkdown: [{ d: 1, o: 2.5 }, { d: 3.5, o: 5, sit: true }],
  swing: [{ d: -1, o: 4 }, { d: 1, o: 10 }, { d: 4, o: 14 }],
  sit: [{ d: 10, o: -1, sit: true }],
  // The mirror of the out: a 10-yard square-in toward the middle.
  in: [{ d: 10, o: 0 }, { d: 10, o: -12 }],
  // Stem 15, snap back to 12 toward the sideline, and sit on it.
  comeback: [{ d: 15, o: 0 }, { d: 12, o: 2.5, sit: true }],
  // Quick game: a five-yard speed out (the ball comes out on his break).
  qout: [{ d: 5, o: 0 }, { d: 5, o: 8 }],
  // Bubble: a step back and out, catching it behind the line with blockers in front.
  bubble: [{ d: -1, o: 1.5 }, { d: -0.8, o: 4 }, { d: 0, o: 7, sit: true }],
  // Slip screen (the back): shows pass protection (ROUTE_DELAY), leaks out behind the line and turns to the QB.
  slip: [{ d: 0, o: 1.5 }, { d: -1, o: 5 }, { d: -0.8, o: 6.5, sit: true }],
  // Sail: the flood's middle level, a deep out at ~17 yd.
  sail: [{ d: 10, o: 1 }, { d: 16, o: 8 }, { d: 17, o: 13 }],
  // Deep cross: under the linebackers, climbing to ~15 yd across the field.
  cross: [{ d: 4, o: -1 }, { d: 12, o: -10 }, { d: 15, o: -30 }],
  // Spot (snag): settle 5 yd deep just inside, in the hole between zones.
  spot: [{ d: 3, o: -1 }, { d: 5.5, o: -2.5, sit: true }],
  // Arrow: the back or tight end to the flat, quick.
  arrow: [{ d: 1, o: 3 }, { d: 3, o: 9 }, { d: 3.5, o: 11, sit: true }],
  // Quick in (the levels concept's underneath level): five yards and square in, the mirror of the quick out.
  qin: [{ d: 5, o: 0 }, { d: 5, o: -9 }],
  // Leak: the tight end shows his block (ROUTE_DELAY), then slips across the formation to the far flat behind the flow.
  leak: [{ d: 1, o: -1.5 }, { d: 3.5, o: -8 }, { d: 5, o: -16 }],
};

/** Routes that start late (s after the snap): the slip screen's back shows pass protection first. */
export const ROUTE_DELAY: Partial<Record<RouteName, number>> = { slip: 0.9, leak: 0.7 };

/** The routes a receiver can be hot-routed to at the line (the picker's order). */
export const HOT_ROUTES: RouteName[] = ['go', 'out', 'in', 'slant', 'curl', 'comeback', 'flat', 'hitch'];

/** Display names for routes (the hot-route picker, the play call). */
export const ROUTE_LABEL: Record<RouteName, string> = {
  go: 'Go',
  fade: 'Fade',
  seam: 'Seam',
  hitch: 'Hitch',
  stick: 'Stick',
  slant: 'Slant',
  out: 'Out',
  dig: 'Dig',
  corner: 'Corner',
  post: 'Post',
  flat: 'Flat',
  curl: 'Curl',
  drag: 'Drag',
  wheel: 'Wheel',
  checkdown: 'Check-down',
  swing: 'Swing',
  sit: 'Sit',
  in: 'In',
  comeback: 'Comeback',
  qout: 'Quick out',
  bubble: 'Bubble',
  slip: 'Slip screen',
  sail: 'Sail',
  cross: 'Deep cross',
  spot: 'Spot',
  arrow: 'Arrow',
  qin: 'Quick in',
  leak: 'Leak',
};

export type Assignment =
  | { kind: 'route'; route: RouteName; /** Progression order (1 = first read). */ read: number }
  | { kind: 'passBlock' }
  | { kind: 'runBlock' }
  /** A receiver blocking the man over him from the snap (screens): stalk, then drive him away from the ball. */
  | { kind: 'stalk' }
  | { kind: 'carry' }
  | { kind: 'qb' };

/**
 * Personnel groupings (backs, then tight ends; the rest are receivers).
 * personnel.ts maps the drafted roster into the sim's slots by grouping.
 */
export type Personnel = '10' | '11' | '12' | '21' | '22';

export interface Formation {
  name: string;
  /** Who's on the field (personnel.ts fills the slots from the roster by this). */
  personnel: Personnel;
  /** The QB under center (a quick exchange, a drop, a reverse pivot to hand off); else shotgun (or pistol). */
  center?: boolean;
  align: Record<OffSlot, { dx: number; dy: number }>;
}

/** Drop depth (yd behind the ball) and time (s) the QB takes before he can throw. */
export interface Drop {
  kind: 'gun3' | 'gun5' | 'uc3' | 'uc5' | 'handoff';
  depth: number;
  /** Seconds after the snap the drop is set (throws from then on are on-platform). */
  set: number;
  /**
   * A bootleg: the QB rolls out this many yards across (+ = offense's left)
   * instead of dropping straight back, and sets outside the pocket.
   */
  boot?: number;
}

/** What the play is, for the play call's groups and the AI's call mix. */
export type PlayType = 'quick' | 'dropback' | 'shot' | 'playAction' | 'screen' | 'run';

/**
 * Run schemes (GDD §9.4). Zone: every lineman steps play-side and takes the
 * man in his gap, uncovered ones climb; outside zone reaches wider and the
 * back reads the edge to bounce or cut back. Power: the play side down-blocks,
 * the backside guard pulls and leads through the hole, the tight end kicks
 * out the end. Counter: the back's counter step away, then the backside guard
 * kicks out and the tackle leads. Draw: the line shows pass, the QB shows his
 * drop, then hands it to the back as the rush runs past. Iso (and the dive):
 * the line blocks the man over it and the fullback isolates the linebacker
 * over the hole. Toss: the QB pitches to the back running wide, the line
 * reaches and the fullback leads around the edge. Sneak: the QB keeps it
 * behind a wedge (the line fires straight ahead).
 */
export type RunScheme = 'insideZone' | 'outsideZone' | 'power' | 'counter' | 'draw' | 'iso' | 'toss' | 'sneak';

export interface OffPlay {
  id: string;
  name: string;
  type: PlayType;
  formation: Formation;
  drop: Drop;
  assign: Record<OffSlot, Assignment>;
  /** Run plays: the scheme, the lateral aiming point (yd from the ball, + = left) and the mesh time. */
  run?: { scheme: RunScheme; aim: number; mesh: number };
  /** Play action: the QB fakes the handoff to the back toward `aim` for `fake` s, then sets up to throw. */
  pa?: { aim: number; fake: number };
  /** Screens: the line pass-sets, then releases downfield toward the screen `release` s after the snap. */
  screen?: { release: number };
  /**
   * Situational calls the coordinator saves for their moment and the
   * harness leaves out of the base distribution: short yardage (the sneak),
   * the end of a half (the Hail Mary).
   */
  situ?: 'short' | 'endOfHalf';
  /** A Hail Mary: every receiver to the end zone, the ball lofted to where they gather. */
  hailMary?: boolean;
}

/** The labels for the play call's groups, in order. */
export const PLAY_TYPE_LABEL: Record<PlayType, string> = { quick: 'Quick game', dropback: 'Dropback', shot: 'Shots', playAction: 'Play action', screen: 'Screens', run: 'Runs' };

// Linemen sit just behind the ball in a three-point stance; splits ~1.3 yd.
const OL = {
  LT: { dx: -0.9, dy: 2.7 },
  LG: { dx: -0.8, dy: 1.35 },
  C: { dx: -0.55, dy: 0 },
  RG: { dx: -0.8, dy: -1.35 },
  RT: { dx: -0.9, dy: -2.7 },
};

export const FORMATIONS: Record<string, Formation> = {
  gunTrips: {
    name: 'Shotgun Trips Right',
    personnel: '11',
    align: { ...OL, QB: { dx: -5, dy: 0 }, RB: { dx: -5, dy: 1.3 }, X: { dx: -0.6, dy: 14 }, TE: { dx: -0.9, dy: -4.1 }, SLOT: { dx: -1.2, dy: -8.5 }, Z: { dx: -1.2, dy: -13.5 } },
  },
  gunDoubles: {
    name: 'Shotgun Doubles',
    personnel: '11',
    align: { ...OL, QB: { dx: -5, dy: 0 }, RB: { dx: -5, dy: -1.3 }, X: { dx: -0.6, dy: 14 }, SLOT: { dx: -1.2, dy: 8.5 }, TE: { dx: -0.9, dy: -4.1 }, Z: { dx: -1.2, dy: -13.5 } },
  },
  // Under center, the back at 7 yd, the tight end in-line right: the run and play-action look.
  singleback: {
    name: 'Singleback',
    personnel: '11',
    center: true,
    align: { ...OL, QB: { dx: -1.25, dy: 0 }, RB: { dx: -7, dy: 0 }, X: { dx: -0.6, dy: 14 }, SLOT: { dx: -1.2, dy: 8.5 }, TE: { dx: -0.9, dy: -4.1 }, Z: { dx: -1.2, dy: -13.5 } },
  },
  // Three receivers stacked in a triangle to the right: free releases and natural picks.
  gunBunch: {
    name: 'Shotgun Bunch Right',
    personnel: '11',
    align: { ...OL, QB: { dx: -5, dy: 0 }, RB: { dx: -5, dy: 1.3 }, X: { dx: -0.6, dy: 14 }, Z: { dx: -0.6, dy: -9 }, SLOT: { dx: -1.8, dy: -8 }, TE: { dx: -1.8, dy: -10.2 } },
  },
  // Five out, nobody in the backfield: three left, two right (GDD §10.2's 1-3-1, the back split out).
  gunEmpty: {
    name: 'Shotgun Empty',
    personnel: '11',
    align: { ...OL, QB: { dx: -5, dy: 0 }, X: { dx: -0.6, dy: 14 }, SLOT: { dx: -1.2, dy: 9.5 }, RB: { dx: -1.2, dy: 5.6 }, TE: { dx: -1.2, dy: -8.5 }, Z: { dx: -0.6, dy: -13.5 } },
  },
  // Ace (12 personnel): two tight ends in-line, a receiver wide each side, one back.
  singlebackAce: {
    name: 'Singleback Ace',
    personnel: '12',
    center: true,
    align: { ...OL, QB: { dx: -1.25, dy: 0 }, RB: { dx: -7, dy: 0 }, X: { dx: -0.6, dy: 14 }, SLOT: { dx: -0.9, dy: 4.1 }, TE: { dx: -0.9, dy: -4.1 }, Z: { dx: -1.2, dy: -13.5 } },
  },
  // I-Form Pro (21): the fullback at 4½ yd and the tailback at 7 behind the QB, the tight end right, a split end and a flanker.
  iForm: {
    name: 'I-Form Pro',
    personnel: '21',
    center: true,
    align: { ...OL, QB: { dx: -1.25, dy: 0 }, SLOT: { dx: -4.4, dy: -0.2 }, RB: { dx: -7.2, dy: 0 }, X: { dx: -0.6, dy: 14 }, TE: { dx: -0.9, dy: -4.1 }, Z: { dx: -1.2, dy: -12.5 } },
  },
  // Pistol (11): the QB at 4 yd, the back straight behind him (downhill runs and play action from the gun).
  pistol: {
    name: 'Pistol',
    personnel: '11',
    align: { ...OL, QB: { dx: -4, dy: 0 }, RB: { dx: -7, dy: 0 }, X: { dx: -0.6, dy: 14 }, SLOT: { dx: -1.2, dy: 8.5 }, TE: { dx: -0.9, dy: -4.1 }, Z: { dx: -1.2, dy: -13.5 } },
  },
  // Heavy (22): two tight ends in-line, the fullback and the tailback in an I, one receiver in a reduced split.
  heavy: {
    name: 'Heavy',
    personnel: '22',
    center: true,
    align: { ...OL, QB: { dx: -1.25, dy: 0 }, SLOT: { dx: -4.3, dy: -0.2 }, RB: { dx: -7, dy: 0 }, X: { dx: -0.6, dy: -9.5 }, TE: { dx: -0.9, dy: -4.1 }, Z: { dx: -0.9, dy: 4.1 } },
  },
};

const OL_SLOTS: OffSlot[] = ['LT', 'LG', 'C', 'RG', 'RT'];

/**
 * A non-lineman aligned in-line next to a tackle (a tight end's spot): he
 * blocks like a tight end on runs, whoever fills the slot (the second tight
 * end in 12 and 22 personnel).
 */
export const inLine = (f: Formation, k: OffSlot): boolean => {
  const a = f.align[k];
  return k !== 'QB' && k !== 'RB' && !OL_SLOTS.includes(k) && Math.abs(a.dy) < 5.5 && a.dx > -1.5;
};

/** The fullback: a second back aligned between the QB and the tailback (21 and 22 personnel), or null. */
export function fullbackSlot(f: Formation): OffSlot | null {
  for (const k of ['SLOT', 'Z', 'X', 'TE'] as OffSlot[]) {
    const a = f.align[k];
    if (a.dx < -2.5 && Math.abs(a.dy) < 3) return k;
  }
  return null;
}

const PASS_PRO: Pick<OffPlay['assign'], 'LT' | 'LG' | 'C' | 'RG' | 'RT'> = { LT: { kind: 'passBlock' }, LG: { kind: 'passBlock' }, C: { kind: 'passBlock' }, RG: { kind: 'passBlock' }, RT: { kind: 'passBlock' } };
const RUN_BLOCK: Pick<OffPlay['assign'], 'LT' | 'LG' | 'C' | 'RG' | 'RT'> = { LT: { kind: 'runBlock' }, LG: { kind: 'runBlock' }, C: { kind: 'runBlock' }, RG: { kind: 'runBlock' }, RT: { kind: 'runBlock' } };
const route = (r: RouteName, read: number): Assignment => ({ kind: 'route', route: r, read });

const G3 = (set: number): Drop => ({ kind: 'gun3', depth: 7, set });
const G5 = (set: number): Drop => ({ kind: 'gun5', depth: 8, set });
const UC5 = (set: number): Drop => ({ kind: 'uc5', depth: 7, set });
const QB = { QB: { kind: 'qb' } } as const;
const pb: Assignment = { kind: 'passBlock' };
const F = FORMATIONS as Record<'gunTrips' | 'gunDoubles' | 'singleback' | 'gunBunch' | 'gunEmpty' | 'singlebackAce' | 'iForm' | 'pistol' | 'heavy', Formation>;

/** The passing book: the quick game, dropback, shots, play action and screens (M5.5's 16, then M6's). */
export const PASS_PLAYS: OffPlay[] = [
  // Quick game: three-step timing, the ball out on the break.
  { id: 'trips-stick', name: 'Stick', type: 'quick', formation: F.gunTrips, drop: G3(0.75), assign: { ...PASS_PRO, ...QB, TE: route('stick', 1), SLOT: route('flat', 2), Z: route('fade', 3), X: route('slant', 4), RB: route('checkdown', 5) } },
  { id: 'doubles-slants', name: 'Slants', type: 'quick', formation: F.gunDoubles, drop: G3(0.6), assign: { ...PASS_PRO, ...QB, X: route('slant', 1), SLOT: route('slant', 2), Z: route('slant', 3), TE: route('seam', 4), RB: route('checkdown', 5) } },
  { id: 'doubles-quick-outs', name: 'Quick Outs', type: 'quick', formation: F.gunDoubles, drop: G3(0.6), assign: { ...PASS_PRO, ...QB, X: route('qout', 1), Z: route('qout', 2), SLOT: route('seam', 3), TE: route('spot', 4), RB: route('checkdown', 5) } },
  { id: 'bunch-snag', name: 'Snag', type: 'quick', formation: F.gunBunch, drop: G3(0.7), assign: { ...PASS_PRO, ...QB, SLOT: route('spot', 1), TE: route('flat', 2), Z: route('corner', 3), X: route('slant', 4), RB: route('checkdown', 5) } },
  { id: 'empty-quick', name: 'Empty Quick', type: 'quick', formation: F.gunEmpty, drop: G3(0.65), assign: { ...PASS_PRO, ...QB, X: route('slant', 1), SLOT: route('qout', 2), RB: route('spot', 3), TE: route('stick', 4), Z: route('hitch', 5) } },
  // Dropback: five steps, reads that take time.
  { id: 'doubles-smash', name: 'Smash', type: 'dropback', formation: F.gunDoubles, drop: G5(1.0), assign: { ...PASS_PRO, ...QB, SLOT: route('corner', 1), X: route('hitch', 2), Z: route('hitch', 3), TE: route('dig', 4), RB: route('checkdown', 5) } },
  { id: 'doubles-mesh', name: 'Mesh', type: 'dropback', formation: F.gunDoubles, drop: G3(0.85), assign: { ...PASS_PRO, ...QB, X: route('drag', 1), TE: route('drag', 2), SLOT: route('sit', 3), Z: route('corner', 4), RB: route('swing', 5) } },
  { id: 'doubles-curls', name: 'Curl Flat', type: 'dropback', formation: F.gunDoubles, drop: G5(0.95), assign: { ...PASS_PRO, ...QB, X: route('curl', 1), Z: route('curl', 2), SLOT: route('flat', 3), TE: route('sit', 4), RB: route('checkdown', 5) } },
  { id: 'bunch-flood', name: 'Flood', type: 'dropback', formation: F.gunBunch, drop: G5(1.0), assign: { ...PASS_PRO, ...QB, SLOT: route('sail', 1), TE: route('flat', 2), Z: route('go', 3), X: route('dig', 4), RB: route('checkdown', 5) } },
  { id: 'singleback-drive', name: 'Drive', type: 'dropback', formation: F.singleback, drop: UC5(1.3), assign: { ...PASS_PRO, ...QB, SLOT: route('drag', 1), X: route('dig', 2), Z: route('go', 3), TE: route('curl', 4), RB: route('checkdown', 5) } },
  // Shots: a clear-out and a deep window.
  { id: 'trips-four-verts', name: 'Four Verticals', type: 'shot', formation: F.gunTrips, drop: G5(1.05), assign: { ...PASS_PRO, ...QB, SLOT: route('seam', 1), TE: route('seam', 2), Z: route('go', 3), X: route('go', 4), RB: route('checkdown', 5) } },
  { id: 'doubles-dagger', name: 'Dagger', type: 'shot', formation: F.gunDoubles, drop: G5(1.05), assign: { ...PASS_PRO, ...QB, X: route('dig', 1), Z: route('go', 2), SLOT: route('seam', 3), TE: route('drag', 4), RB: route('checkdown', 5) } },
  // Play action: the run look first.
  { id: 'singleback-pa-post', name: 'PA Post', type: 'playAction', formation: F.singleback, drop: UC5(1.45), pa: { aim: -1.5, fake: 0.5 }, assign: { ...PASS_PRO, ...QB, X: route('post', 1), SLOT: route('cross', 2), Z: route('go', 3), TE: route('drag', 4), RB: route('arrow', 5) } },
  { id: 'singleback-pa-yankee', name: 'PA Yankee', type: 'playAction', formation: F.singleback, drop: UC5(1.5), pa: { aim: -1.5, fake: 0.55 }, assign: { ...PASS_PRO, ...QB, SLOT: route('cross', 1), Z: route('post', 2), X: route('go', 3), TE: pb, RB: pb } },
  // Screens.
  { id: 'doubles-rb-screen', name: 'RB Screen', type: 'screen', formation: F.gunDoubles, drop: G5(1.05), screen: { release: 0.95 }, assign: { ...PASS_PRO, ...QB, RB: route('slip', 1), SLOT: route('drag', 2), X: route('go', 3), Z: route('go', 4), TE: pb } },
  { id: 'bunch-bubble', name: 'Bubble', type: 'screen', formation: F.gunBunch, drop: { kind: 'gun3', depth: 5.5, set: 0.35 }, assign: { ...PASS_PRO, ...QB, SLOT: route('bubble', 1), X: route('hitch', 2), Z: { kind: 'stalk' }, TE: { kind: 'stalk' }, RB: pb } },
  // ---- M6 (GDD §10.2) ----
  // Quick game: hitches outside, the seams inside to hold the safeties; the spot (snag) concept from empty.
  { id: 'doubles-hitch-seam', name: 'Hitch-Seam', type: 'quick', formation: F.gunDoubles, drop: G3(0.7), assign: { ...PASS_PRO, ...QB, X: route('hitch', 1), Z: route('hitch', 2), SLOT: route('seam', 3), TE: route('seam', 4), RB: route('checkdown', 5) } },
  { id: 'empty-spot', name: 'Spot', type: 'quick', formation: F.gunEmpty, drop: G3(0.7), assign: { ...PASS_PRO, ...QB, SLOT: route('spot', 1), X: route('corner', 2), RB: route('flat', 3), TE: route('slant', 4), Z: route('hitch', 5) } },
  // Dropback: the Y-cross from trips (the tight end's deep cross behind the clear-out), levels from empty, the tight ends up the seams from Ace.
  { id: 'trips-y-cross', name: 'Y-Cross', type: 'dropback', formation: F.gunTrips, drop: G5(1.05), assign: { ...PASS_PRO, ...QB, TE: route('cross', 1), SLOT: route('flat', 2), X: route('post', 3), Z: route('go', 4), RB: route('checkdown', 5) } },
  { id: 'empty-levels', name: 'Levels', type: 'dropback', formation: F.gunEmpty, drop: G5(0.95), assign: { ...PASS_PRO, ...QB, X: route('dig', 1), SLOT: route('qin', 2), RB: route('seam', 3), TE: route('curl', 4), Z: route('hitch', 5) } },
  { id: 'ace-te-seam', name: 'TE Seam', type: 'dropback', formation: F.singlebackAce, drop: UC5(1.25), assign: { ...PASS_PRO, ...QB, TE: route('seam', 1), X: route('dig', 2), SLOT: route('seam', 3), Z: route('curl', 4), RB: route('checkdown', 5) } },
  // Shots: the Hail Mary (end of a half only: everyone to the end zone, the ball lofted to where they gather).
  { id: 'doubles-hail-mary', name: 'Hail Mary', type: 'shot', formation: F.gunDoubles, drop: { kind: 'gun5', depth: 9, set: 1.3 }, situ: 'endOfHalf', hailMary: true, assign: { ...PASS_PRO, ...QB, X: route('go', 1), Z: route('go', 2), SLOT: route('post', 3), TE: route('seam', 4), RB: pb } },
  // Play action: two crossers from Ace; the I-form's max-protect deep shot and its fullback to the flat; the pistol's bootleg; the goal-line tight end leak.
  { id: 'ace-pa-crossers', name: 'PA Crossers', type: 'playAction', formation: F.singlebackAce, drop: UC5(1.5), pa: { aim: -1.5, fake: 0.5 }, assign: { ...PASS_PRO, ...QB, X: route('cross', 1), SLOT: route('drag', 2), Z: route('go', 3), RB: route('arrow', 4), TE: pb } },
  { id: 'iform-pa-deep-shot', name: 'PA Deep Shot', type: 'playAction', formation: F.iForm, drop: { kind: 'uc5', depth: 8, set: 1.65 }, pa: { aim: -1.5, fake: 0.6 }, assign: { ...PASS_PRO, ...QB, X: route('post', 1), Z: route('go', 2), RB: route('checkdown', 3), TE: pb, SLOT: pb } },
  { id: 'iform-fb-flat', name: 'Fullback Flat', type: 'playAction', formation: F.iForm, drop: UC5(1.3), pa: { aim: -1.5, fake: 0.45 }, assign: { ...PASS_PRO, ...QB, SLOT: route('flat', 1), TE: route('corner', 2), Z: route('go', 3), X: route('dig', 4), RB: pb } },
  { id: 'pistol-pa-boot', name: 'PA Boot', type: 'playAction', formation: F.pistol, drop: { kind: 'gun5', depth: 6, set: 1.45, boot: 7 }, pa: { aim: -1.5, fake: 0.45 }, assign: { ...PASS_PRO, ...QB, SLOT: route('sail', 1), TE: route('drag', 2), Z: route('cross', 3), X: route('go', 4), RB: pb } },
  { id: 'heavy-pa-te-leak', name: 'PA TE Leak', type: 'playAction', formation: F.heavy, drop: UC5(1.45), pa: { aim: -2.8, fake: 0.55 }, assign: { ...PASS_PRO, ...QB, TE: route('leak', 1), Z: route('corner', 2), X: route('post', 3), SLOT: route('flat', 4), RB: pb } },
];

const HANDOFF = (set: number): Drop => ({ kind: 'handoff', depth: 5, set });
const RUN_PERSONNEL = { ...RUN_BLOCK, ...QB, RB: { kind: 'carry' }, TE: { kind: 'runBlock' }, X: { kind: 'runBlock' }, SLOT: { kind: 'runBlock' }, Z: { kind: 'runBlock' } } as const;

/**
 * Designed runs (GDD §9.4). Aiming points are the scheme's: inside zone at
 * the play-side guard's outside hip (~1.5 yd), outside zone at the tight
 * end's outside hip (~5), power and counter off the play-side tackle (~2.8,
 * behind the puller), the draw in the A/B gap. Mesh times: shotgun ~0.55 s,
 * under center with the reverse pivot ~0.75 s, gap schemes later so the
 * puller clears, the draw after the QB's show of a drop.
 */
export const RUN_PLAYS: OffPlay[] = [
  { id: 'singleback-inside-zone', name: 'Inside Zone', type: 'run', formation: F.singleback, drop: HANDOFF(0.75), assign: RUN_PERSONNEL, run: { scheme: 'insideZone', aim: -1.5, mesh: 0.75 } },
  { id: 'trips-inside-zone', name: 'Inside Zone', type: 'run', formation: F.gunTrips, drop: HANDOFF(0.6), assign: RUN_PERSONNEL, run: { scheme: 'insideZone', aim: -1.5, mesh: 0.55 } },
  { id: 'singleback-outside-zone', name: 'Outside Zone', type: 'run', formation: F.singleback, drop: HANDOFF(0.7), assign: RUN_PERSONNEL, run: { scheme: 'outsideZone', aim: -5, mesh: 0.7 } },
  { id: 'singleback-power', name: 'Power', type: 'run', formation: F.singleback, drop: HANDOFF(0.85), assign: RUN_PERSONNEL, run: { scheme: 'power', aim: -2.8, mesh: 0.85 } },
  { id: 'singleback-counter', name: 'Counter', type: 'run', formation: F.singleback, drop: HANDOFF(0.95), assign: RUN_PERSONNEL, run: { scheme: 'counter', aim: -2.8, mesh: 0.95 } },
  { id: 'doubles-draw', name: 'Draw', type: 'run', formation: F.gunDoubles, drop: HANDOFF(1.1), assign: { ...RUN_PERSONNEL, X: route('go', 1), Z: route('go', 2), SLOT: route('seam', 3) }, run: { scheme: 'draw', aim: -0.8, mesh: 1.1 } },
  // ---- M6 (GDD §10.2) ----
  // I-Form Pro: the fullback leads (iso, the B gap), kicks out the end (Power O, the backside guard wrapping up to the linebacker), or leads the toss around the edge.
  { id: 'iform-iso', name: 'Iso', type: 'run', formation: F.iForm, drop: HANDOFF(0.8), assign: RUN_PERSONNEL, run: { scheme: 'iso', aim: -1.6, mesh: 0.8 } },
  { id: 'iform-power', name: 'Power O', type: 'run', formation: F.iForm, drop: HANDOFF(0.85), assign: RUN_PERSONNEL, run: { scheme: 'power', aim: -2.8, mesh: 0.85 } },
  { id: 'iform-toss', name: 'Toss', type: 'run', formation: F.iForm, drop: HANDOFF(0.5), assign: RUN_PERSONNEL, run: { scheme: 'toss', aim: -7, mesh: 0.45 } },
  // Pistol: the stretch (outside zone downhill from the pistol).
  { id: 'pistol-stretch', name: 'Stretch', type: 'run', formation: F.pistol, drop: HANDOFF(0.65), assign: RUN_PERSONNEL, run: { scheme: 'outsideZone', aim: -5, mesh: 0.6 } },
  // Heavy: the dive (the A gap, fast), power, and the sneak for a yard.
  { id: 'heavy-dive', name: 'Dive', type: 'run', formation: F.heavy, drop: HANDOFF(0.6), assign: RUN_PERSONNEL, run: { scheme: 'iso', aim: -0.8, mesh: 0.6 } },
  { id: 'heavy-power', name: 'Power', type: 'run', formation: F.heavy, drop: HANDOFF(0.85), assign: RUN_PERSONNEL, run: { scheme: 'power', aim: -2.8, mesh: 0.85 } },
  { id: 'heavy-sneak', name: 'QB Sneak', type: 'run', formation: F.heavy, drop: HANDOFF(0.1), situ: 'short', assign: RUN_PERSONNEL, run: { scheme: 'sneak', aim: -0.4, mesh: 0.1 } },
];

/** The whole book, as the play call lists it (passes first, then runs). */
export const PLAYS: OffPlay[] = [...PASS_PLAYS, ...RUN_PLAYS];

export const playById = (id: string): OffPlay => PLAYS.find((p) => p.id === id) ?? PLAYS[0]!;

/**
 * A play flipped: the formation's skill players, the run's aiming point,
 * the fake and the bootleg to the other side. The line stays where it is
 * (the left tackle is still on the left), as a flipped call does on a real field.
 */
export function mirrorPlay(p: OffPlay): OffPlay {
  const align = { ...p.formation.align };
  for (const k of Object.keys(align) as OffSlot[]) if (!OL_SLOTS.includes(k)) align[k] = { dx: align[k].dx, dy: -align[k].dy };
  return {
    ...p,
    formation: { ...p.formation, align },
    drop: p.drop.boot ? { ...p.drop, boot: -p.drop.boot } : p.drop,
    ...(p.run ? { run: { ...p.run, aim: -p.run.aim } } : {}),
    ...(p.pa ? { pa: { ...p.pa, aim: -p.pa.aim } } : {}),
  };
}

/** The base book: every play but the situational ones (the harness's distribution, the coordinator's everyday calls). */
export const BASE_PLAYS: OffPlay[] = PLAYS.filter((p) => !p.situ);

// ---- Defense (base 4-3 with nickel and dime packages, GDD §10.4) ------------

export type ZoneName = 'deepL' | 'deepM' | 'deepR' | 'halfL' | 'halfR' | 'flatL' | 'flatR' | 'curlL' | 'curlR' | 'hookL' | 'hookR' | 'middle' | 'tampa';

/**
 * Zone landmarks: depth past the line (yd) and lateral position (+ =
 * offense's left). The Tampa 2 middle linebacker's landmark is the deep
 * middle hole between the halves (he opens and runs to ~15 yd, carrying a
 * seam or a post: the Dungy/Kiffin Tampa 2).
 */
export const ZONES: Record<ZoneName, { d: number; y: number; deep: boolean }> = {
  deepL: { d: 18, y: 15, deep: true },
  deepM: { d: 20, y: 0, deep: true },
  deepR: { d: 18, y: -15, deep: true },
  halfL: { d: 17, y: 11, deep: true },
  halfR: { d: 17, y: -11, deep: true },
  flatL: { d: 5, y: 18, deep: false },
  flatR: { d: 5, y: -18, deep: false },
  curlL: { d: 10, y: 12, deep: false },
  curlR: { d: 10, y: -12, deep: false },
  hookL: { d: 9, y: 5, deep: false },
  hookR: { d: 9, y: -5, deep: false },
  middle: { d: 10, y: 0, deep: false },
  tampa: { d: 14, y: 0, deep: true },
};

export type DefAssign =
  | { kind: 'rush' }
  | { kind: 'zone'; zone: ZoneName }
  /** Man on the receiver in that offensive slot: pressed at the line, or off (a 6–7 yd cushion, bailing with him). */
  | { kind: 'man'; on: OffSlot; press?: boolean };

/** Who's on the field: base 4-3, nickel (the sub corner for a linebacker), dime (the sub safety for another). */
export type Package = 'base' | 'nickel' | 'dime';

export interface DefCall {
  id: string;
  name: string;
  assign: Record<DefSlot, DefAssign>;
  /** The package on the field (the coordinator sets it by situation and personnel). */
  package: Package;
  /** The linebacker slot the nickel corner takes (its job is the call's for that slot), and the dime safety's. */
  nickel: DefSlot;
  dime: DefSlot;
  /** Defenders who walk up to the line before the snap to show pressure (simulated pressure, a fire zone's blitzers). */
  show?: DefSlot[];
  /**
   * The disguise (GDD §10.4, higher difficulties): the defense aligns in
   * this call's shell before the snap and rotates to its real call at the snap.
   */
  shell?: string;
  /**
   * A bracket on the receiver the offense keeps going to (tendency
   * learning): a deep safety shades to him, or a robber sits on his area.
   * `id` is the receiver's player id (whatever slot he's in this play).
   */
  bracket?: { id: string; by: DefSlot; how: 'shade' | 'lurk' };
}

const RUSH4 = { LE: { kind: 'rush' }, LDT: { kind: 'rush' }, RDT: { kind: 'rush' }, RE: { kind: 'rush' } } as const;
const Zn = (zone: ZoneName): DefAssign => ({ kind: 'zone', zone });
const Man = (on: OffSlot, press = false): DefAssign => ({ kind: 'man', on, ...(press ? { press } : {}) });
const Rush: DefAssign = { kind: 'rush' };

/**
 * The call sheet. Each call is written for the base 4-3 and names the
 * linebacker slots its nickel and dime subs take: the nickel corner takes
 * the job that's really a slot receiver's (the curl-flat in the zones, the
 * man on the SLOT in man), the dime safety the next one in.
 */
export const DEF_CALLS: DefCall[] = [
  { id: 'cover3', name: 'Cover 3', package: 'base', nickel: 'SLB', dime: 'WLB', assign: { ...RUSH4, LCB: Zn('deepL'), RCB: Zn('deepR'), FS: Zn('deepM'), SS: Zn('curlR'), SLB: Zn('curlL'), WLB: Zn('hookR'), MLB: Zn('hookL') } },
  { id: 'cover1', name: 'Cover 1', package: 'base', nickel: 'WLB', dime: 'SLB', assign: { ...RUSH4, LCB: Man('X', true), RCB: Man('Z', true), SS: Man('TE'), WLB: Man('SLOT'), SLB: Man('RB'), MLB: Zn('middle'), FS: Zn('deepM') } },
  { id: 'cover2', name: 'Cover 2', package: 'base', nickel: 'SLB', dime: 'WLB', assign: { ...RUSH4, LCB: Zn('flatL'), RCB: Zn('flatR'), FS: Zn('halfL'), SS: Zn('halfR'), SLB: Zn('curlL'), WLB: Zn('curlR'), MLB: Zn('middle') } },
];

/**
 * M5.5 additions (feedback item 7: the book above is built to beat three
 * base coverages; an NFL defense mixes in quarters, man-under and pressure).
 * Quarters: four deep (the corners and safeties each a quarter), three under.
 * Two-man: two deep halves, man underneath with the corners pressing.
 * Cover 1 blitz: the middle linebacker rushes (five-man pressure), man
 * behind it with a single high safety.
 */
DEF_CALLS.push(
  { id: 'cover4', name: 'Cover 4', package: 'base', nickel: 'SLB', dime: 'WLB', assign: { ...RUSH4, LCB: Zn('deepL'), RCB: Zn('deepR'), FS: Zn('halfL'), SS: Zn('halfR'), SLB: Zn('curlL'), WLB: Zn('curlR'), MLB: Zn('middle') } },
  { id: 'cover2man', name: 'Cover 2 Man', package: 'base', nickel: 'WLB', dime: 'MLB', assign: { ...RUSH4, LCB: Man('X', true), RCB: Man('Z', true), FS: Zn('halfL'), SS: Zn('halfR'), WLB: Man('SLOT'), SLB: Man('RB'), MLB: Man('TE') } },
  { id: 'cover1blitz', name: 'Cover 1 Blitz', package: 'base', nickel: 'WLB', dime: 'SLB', show: ['MLB'], assign: { ...RUSH4, MLB: Rush, LCB: Man('X', true), RCB: Man('Z', true), SS: Man('TE'), WLB: Man('SLOT'), SLB: Man('RB'), FS: Zn('deepM') } },
);

/**
 * M6 additions (GDD §10.4's coverage set).
 * - Cover 1 (off): the same man-free, the corners off at 7 yd and bailing
 *   (they give up the underneath to stay on top; press is the other variant).
 * - Tampa 2: Cover 2 with the middle linebacker running the deep middle
 *   between the halves.
 * - Fire zone (zone blitz): five rush with two linebackers, the right end
 *   drops into the curl-flat; three deep, three under (the Dick LeBeau fire zone).
 * - Simulated pressure: six show at the line, four rush (the middle
 *   linebacker in, the left end out into the hook); Cover 3 behind it.
 */
DEF_CALLS.push(
  { id: 'cover1off', name: 'Cover 1 (Off)', package: 'base', nickel: 'WLB', dime: 'SLB', assign: { ...RUSH4, LCB: Man('X'), RCB: Man('Z'), SS: Man('TE'), WLB: Man('SLOT'), SLB: Man('RB'), MLB: Zn('middle'), FS: Zn('deepM') } },
  { id: 'tampa2', name: 'Tampa 2', package: 'base', nickel: 'SLB', dime: 'WLB', assign: { ...RUSH4, LCB: Zn('flatL'), RCB: Zn('flatR'), FS: Zn('halfL'), SS: Zn('halfR'), SLB: Zn('curlL'), WLB: Zn('curlR'), MLB: Zn('tampa') } },
  { id: 'firezone', name: 'Fire Zone', package: 'base', nickel: 'SLB', dime: 'WLB', show: ['SLB', 'WLB'], assign: { LE: Rush, LDT: Rush, RDT: Rush, RE: Zn('curlR'), SLB: Rush, WLB: Rush, MLB: Zn('middle'), SS: Zn('curlL'), LCB: Zn('deepL'), RCB: Zn('deepR'), FS: Zn('deepM') } },
  { id: 'simpressure', name: 'Sim Pressure', package: 'base', nickel: 'SLB', dime: 'WLB', show: ['MLB', 'WLB'], assign: { LE: Zn('hookL'), LDT: Rush, RDT: Rush, RE: Rush, MLB: Rush, WLB: Zn('hookR'), SLB: Zn('curlL'), SS: Zn('curlR'), LCB: Zn('deepL'), RCB: Zn('deepR'), FS: Zn('deepM') } },
);

export const defById = (id: string): DefCall => DEF_CALLS.find((d) => d.id === id) ?? DEF_CALLS[0]!;

/** Single-high shells (one deep middle safety) and two-high shells: a disguise shows the other family. */
export const SINGLE_HIGH = ['cover3', 'cover1', 'cover1off', 'cover1blitz', 'firezone', 'simpressure'];

export const OFF_SLOTS: OffSlot[] = ['QB', 'RB', 'X', 'Z', 'SLOT', 'TE', 'LT', 'LG', 'C', 'RG', 'RT'];
export const DEF_SLOTS: DefSlot[] = ['LE', 'LDT', 'RDT', 'RE', 'WLB', 'MLB', 'SLB', 'LCB', 'RCB', 'FS', 'SS'];
