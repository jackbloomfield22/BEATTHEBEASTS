// Plays as data (TECH_PLAN §10 "Plays as data"). M5 ships a handful from
// GDD §10.2 so a full play runs snap to whistle; M6 grows the book to ≥ 30.
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
  | 'comeback';

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
  drag: [{ d: 2, o: -2 }, { d: 5, o: -30 }],
  wheel: [{ d: 1, o: 6 }, { d: 5, o: 10 }, { d: 40, o: 11 }],
  checkdown: [{ d: 1, o: 2.5 }, { d: 3.5, o: 5, sit: true }],
  swing: [{ d: -1, o: 4 }, { d: 1, o: 10 }, { d: 4, o: 14 }],
  sit: [{ d: 10, o: -1, sit: true }],
  // The mirror of the out: a 10-yard square-in toward the middle.
  in: [{ d: 10, o: 0 }, { d: 10, o: -12 }],
  // Stem 15, snap back to 12 toward the sideline, and sit on it.
  comeback: [{ d: 15, o: 0 }, { d: 12, o: 2.5, sit: true }],
};

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
};

export type Assignment =
  | { kind: 'route'; route: RouteName; /** Progression order (1 = first read). */ read: number }
  | { kind: 'passBlock' }
  | { kind: 'runBlock' }
  | { kind: 'carry' }
  | { kind: 'qb' };

export interface Formation {
  name: string;
  align: Record<OffSlot, { dx: number; dy: number }>;
}

/** Drop depth (yd behind the ball) and time (s) the QB takes before he can throw. */
export interface Drop {
  kind: 'gun3' | 'gun5' | 'handoff';
  depth: number;
  /** Seconds after the snap the drop is set (throws from then on are on-platform). */
  set: number;
}

export interface OffPlay {
  id: string;
  name: string;
  formation: Formation;
  drop: Drop;
  assign: Record<OffSlot, Assignment>;
  /** Run plays: lateral aiming point (yd from the ball, + = left) and the mesh time. */
  run?: { aim: number; mesh: number };
}

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
};

const PASS_PRO: Pick<OffPlay['assign'], 'LT' | 'LG' | 'C' | 'RG' | 'RT'> = { LT: { kind: 'passBlock' }, LG: { kind: 'passBlock' }, C: { kind: 'passBlock' }, RG: { kind: 'passBlock' }, RT: { kind: 'passBlock' } };
const RUN_BLOCK: Pick<OffPlay['assign'], 'LT' | 'LG' | 'C' | 'RG' | 'RT'> = { LT: { kind: 'runBlock' }, LG: { kind: 'runBlock' }, C: { kind: 'runBlock' }, RG: { kind: 'runBlock' }, RT: { kind: 'runBlock' } };
const route = (r: RouteName, read: number): Assignment => ({ kind: 'route', route: r, read });

export const PLAYS: OffPlay[] = [
  {
    id: 'trips-stick',
    name: 'Stick',
    formation: FORMATIONS.gunTrips!,
    drop: { kind: 'gun3', depth: 7, set: 0.75 },
    assign: { ...PASS_PRO, QB: { kind: 'qb' }, TE: route('stick', 1), SLOT: route('flat', 2), Z: route('fade', 3), X: route('slant', 4), RB: route('checkdown', 5) },
  },
  {
    id: 'trips-four-verts',
    name: 'Four Verticals',
    formation: FORMATIONS.gunTrips!,
    drop: { kind: 'gun5', depth: 8, set: 1.05 },
    assign: { ...PASS_PRO, QB: { kind: 'qb' }, SLOT: route('seam', 1), TE: route('seam', 2), Z: route('go', 3), X: route('go', 4), RB: route('checkdown', 5) },
  },
  {
    id: 'doubles-smash',
    name: 'Smash',
    formation: FORMATIONS.gunDoubles!,
    drop: { kind: 'gun5', depth: 8, set: 1.0 },
    assign: { ...PASS_PRO, QB: { kind: 'qb' }, SLOT: route('corner', 1), X: route('hitch', 2), Z: route('hitch', 3), TE: route('dig', 4), RB: route('checkdown', 5) },
  },
  {
    id: 'doubles-mesh',
    name: 'Mesh',
    formation: FORMATIONS.gunDoubles!,
    drop: { kind: 'gun3', depth: 7, set: 0.85 },
    assign: { ...PASS_PRO, QB: { kind: 'qb' }, X: route('drag', 1), TE: route('drag', 2), SLOT: route('sit', 3), Z: route('corner', 4), RB: route('swing', 5) },
  },
];

/**
 * Designed runs are built but not in the M5 book: zone, gap and pull schemes
 * and the run fits that make them honest are M6 work (GDD §9.4). Kept here so
 * the blocking and handoff code stays exercised by tests.
 */
export const RUN_PLAYS: OffPlay[] = [
  {
    id: 'trips-inside-zone',
    name: 'Inside Zone',
    formation: FORMATIONS.gunTrips!,
    drop: { kind: 'handoff', depth: 5, set: 0.6 },
    assign: { ...RUN_BLOCK, QB: { kind: 'qb' }, RB: { kind: 'carry' }, TE: { kind: 'runBlock' }, X: { kind: 'runBlock' }, SLOT: { kind: 'runBlock' }, Z: { kind: 'runBlock' } },
    run: { aim: -1.5, mesh: 0.55 },
  },
];

export const playById = (id: string): OffPlay => PLAYS.find((p) => p.id === id) ?? RUN_PLAYS.find((p) => p.id === id) ?? PLAYS[0]!;

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
