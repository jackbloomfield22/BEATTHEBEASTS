// Plays as data (TECH_PLAN §10 "Plays as data"). The M5.5 book (feedback
// item 6): quick game, dropback concepts, shots, play action, screens and
// five designed runs, from five formations of the same 11 personnel (the
// roster is one back, one tight end, three receivers).
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
  | 'arrow';

export const ROUTES: Record<RouteName, RoutePoint[]> = {
  go: [{ d: 45, o: 1 }],
  fade: [{ d: 8, o: 1.5 }, { d: 45, o: 4 }],
  seam: [{ d: 45, o: -1 }],
  hitch: [{ d: 6, o: 0 }, { d: 5, o: 0, sit: true }],
  stick: [{ d: 6, o: 0 }, { d: 6, o: -0.8, sit: true }],
  slant: [{ d: 2, o: 0 }, { d: 9, o: -7 }, { d: 20, o: -16 }],
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
};

/** Routes that start late (s after the snap): the slip screen's back shows pass protection first. */
export const ROUTE_DELAY: Partial<Record<RouteName, number>> = { slip: 0.9 };

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
};

export type Assignment =
  | { kind: 'route'; route: RouteName; /** Progression order (1 = first read). */ read: number }
  | { kind: 'passBlock' }
  | { kind: 'runBlock' }
  /** A receiver blocking the man over him from the snap (screens): stalk, then drive him away from the ball. */
  | { kind: 'stalk' }
  | { kind: 'carry' }
  | { kind: 'qb' };

export interface Formation {
  name: string;
  /** The QB under center (a quick exchange, a drop, a reverse pivot to hand off); else shotgun. */
  center?: boolean;
  align: Record<OffSlot, { dx: number; dy: number }>;
}

/** Drop depth (yd behind the ball) and time (s) the QB takes before he can throw. */
export interface Drop {
  kind: 'gun3' | 'gun5' | 'uc3' | 'uc5' | 'handoff';
  depth: number;
  /** Seconds after the snap the drop is set (throws from then on are on-platform). */
  set: number;
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
 * drop, then hands it to the back as the rush runs past.
 */
export type RunScheme = 'insideZone' | 'outsideZone' | 'power' | 'counter' | 'draw';

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
    align: { ...OL, QB: { dx: -5, dy: 0 }, RB: { dx: -5, dy: 1.3 }, X: { dx: -0.6, dy: 14 }, TE: { dx: -0.9, dy: -4.1 }, SLOT: { dx: -1.2, dy: -8.5 }, Z: { dx: -1.2, dy: -13.5 } },
  },
  gunDoubles: {
    name: 'Shotgun Doubles',
    align: { ...OL, QB: { dx: -5, dy: 0 }, RB: { dx: -5, dy: -1.3 }, X: { dx: -0.6, dy: 14 }, SLOT: { dx: -1.2, dy: 8.5 }, TE: { dx: -0.9, dy: -4.1 }, Z: { dx: -1.2, dy: -13.5 } },
  },
  // Under center, the back at 7 yd, the tight end in-line right: the run and play-action look.
  singleback: {
    name: 'Singleback',
    center: true,
    align: { ...OL, QB: { dx: -1.25, dy: 0 }, RB: { dx: -7, dy: 0 }, X: { dx: -0.6, dy: 14 }, SLOT: { dx: -1.2, dy: 8.5 }, TE: { dx: -0.9, dy: -4.1 }, Z: { dx: -1.2, dy: -13.5 } },
  },
  // Three receivers stacked in a triangle to the right: free releases and natural picks.
  gunBunch: {
    name: 'Shotgun Bunch Right',
    align: { ...OL, QB: { dx: -5, dy: 0 }, RB: { dx: -5, dy: 1.3 }, X: { dx: -0.6, dy: 14 }, Z: { dx: -0.6, dy: -9 }, SLOT: { dx: -1.8, dy: -8 }, TE: { dx: -1.8, dy: -10.2 } },
  },
  // Five out, nobody in the backfield: three left, two right.
  gunEmpty: {
    name: 'Shotgun Empty',
    align: { ...OL, QB: { dx: -5, dy: 0 }, X: { dx: -0.6, dy: 14 }, SLOT: { dx: -1.2, dy: 9.5 }, RB: { dx: -1.2, dy: 5.6 }, TE: { dx: -1.2, dy: -8.5 }, Z: { dx: -0.6, dy: -13.5 } },
  },
};

const PASS_PRO: Pick<OffPlay['assign'], 'LT' | 'LG' | 'C' | 'RG' | 'RT'> = { LT: { kind: 'passBlock' }, LG: { kind: 'passBlock' }, C: { kind: 'passBlock' }, RG: { kind: 'passBlock' }, RT: { kind: 'passBlock' } };
const RUN_BLOCK: Pick<OffPlay['assign'], 'LT' | 'LG' | 'C' | 'RG' | 'RT'> = { LT: { kind: 'runBlock' }, LG: { kind: 'runBlock' }, C: { kind: 'runBlock' }, RG: { kind: 'runBlock' }, RT: { kind: 'runBlock' } };
const route = (r: RouteName, read: number): Assignment => ({ kind: 'route', route: r, read });

const G3 = (set: number): Drop => ({ kind: 'gun3', depth: 7, set });
const G5 = (set: number): Drop => ({ kind: 'gun5', depth: 8, set });
const UC5 = (set: number): Drop => ({ kind: 'uc5', depth: 7, set });
const QB = { QB: { kind: 'qb' } } as const;
const pb: Assignment = { kind: 'passBlock' };
const F = FORMATIONS as Record<'gunTrips' | 'gunDoubles' | 'singleback' | 'gunBunch' | 'gunEmpty', Formation>;

/** The passing book: 16 plays across the quick game, dropback, shots, play action and screens. */
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
];

/** The whole book, as the play call lists it (passes first, then runs). */
export const PLAYS: OffPlay[] = [...PASS_PLAYS, ...RUN_PLAYS];

export const playById = (id: string): OffPlay => PLAYS.find((p) => p.id === id) ?? PLAYS[0]!;

// ---- Defense (base 4-3, GDD §10.4) ----------------------------------------

export type ZoneName = 'deepL' | 'deepM' | 'deepR' | 'halfL' | 'halfR' | 'flatL' | 'flatR' | 'curlL' | 'curlR' | 'hookL' | 'hookR' | 'middle';

/** Zone landmarks: depth past the line (yd) and lateral position (+ = offense's left). */
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
};

export type DefAssign =
  | { kind: 'rush' }
  | { kind: 'zone'; zone: ZoneName }
  /** Man on the receiver in that offensive slot. */
  | { kind: 'man'; on: OffSlot; press?: boolean };

export interface DefCall {
  id: string;
  name: string;
  assign: Record<DefSlot, DefAssign>;
}

const RUSH4 = { LE: { kind: 'rush' }, LDT: { kind: 'rush' }, RDT: { kind: 'rush' }, RE: { kind: 'rush' } } as const;

export const DEF_CALLS: DefCall[] = [
  {
    id: 'cover3',
    name: 'Cover 3',
    assign: { ...RUSH4, LCB: { kind: 'zone', zone: 'deepL' }, RCB: { kind: 'zone', zone: 'deepR' }, FS: { kind: 'zone', zone: 'deepM' }, SS: { kind: 'zone', zone: 'curlR' }, SLB: { kind: 'zone', zone: 'curlL' }, WLB: { kind: 'zone', zone: 'hookR' }, MLB: { kind: 'zone', zone: 'hookL' } },
  },
  {
    id: 'cover1',
    name: 'Cover 1',
    assign: { ...RUSH4, LCB: { kind: 'man', on: 'X', press: true }, RCB: { kind: 'man', on: 'Z', press: true }, SS: { kind: 'man', on: 'TE' }, WLB: { kind: 'man', on: 'SLOT' }, SLB: { kind: 'man', on: 'RB' }, MLB: { kind: 'zone', zone: 'middle' }, FS: { kind: 'zone', zone: 'deepM' } },
  },
  {
    id: 'cover2',
    name: 'Cover 2',
    assign: { ...RUSH4, LCB: { kind: 'zone', zone: 'flatL' }, RCB: { kind: 'zone', zone: 'flatR' }, FS: { kind: 'zone', zone: 'halfL' }, SS: { kind: 'zone', zone: 'halfR' }, SLB: { kind: 'zone', zone: 'curlL' }, WLB: { kind: 'zone', zone: 'curlR' }, MLB: { kind: 'zone', zone: 'middle' } },
  },
];

export const defById = (id: string): DefCall => DEF_CALLS.find((d) => d.id === id) ?? DEF_CALLS[0]!;

export const OFF_SLOTS: OffSlot[] = ['QB', 'RB', 'X', 'Z', 'SLOT', 'TE', 'LT', 'LG', 'C', 'RG', 'RT'];
export const DEF_SLOTS: DefSlot[] = ['LE', 'LDT', 'RDT', 'RE', 'WLB', 'MLB', 'SLB', 'LCB', 'RCB', 'FS', 'SS'];
