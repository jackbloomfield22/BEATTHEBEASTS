// Types for the legacy engine port. Legacy was untyped JS; these describe the
// shapes it actually passes around. Where legacy reads a stat field that only
// some positions carry, the port keeps the exact legacy expression and uses a
// type assertion (no runtime effect), so undefined/NaN behavior is unchanged.

import type { Decade, DefensePosition, Defender, Slot } from '@data/legacy/types';

export type { Decade, Slot };

/** Every stat field any offensive roster entry (players or OL) can carry. */
export interface LooseStats {
  readonly y?: number;
  readonly t?: number;
  readonly i?: number;
  readonly r?: number;
  readonly ry?: number;
  readonly c?: number;
  readonly p?: number;
  readonly b?: number;
  readonly sa?: number;
  readonly pb?: number;
  readonly pbl?: number;
}

/** The same fields, typed as present (legacy reads them unguarded). */
export type AssumedStats = { readonly [K in keyof LooseStats]-?: number };

/**
 * A drafted roster entry. Legacy builds `{ n, t, d, p, imp, slot, s, key }`
 * on pick (handleSelectPick) but data entries work too.
 */
export interface RosterEntry {
  readonly n: string;
  readonly t: string;
  readonly d: string;
  readonly p: string;
  readonly imp: number;
  readonly s: LooseStats;
  readonly slot?: string;
  readonly key?: string;
}

/** A complete roster, as the sim requires. */
export type Roster = { readonly [S in Slot]: RosterEntry };
/** A roster being drafted (empty slots are null or missing). */
export type PartialRoster = { readonly [S in Slot]?: RosterEntry | null };

export type BeastSlot = 'DL' | 'LB' | 'DB';

/** Anything the Beasts rating code can read (legacy beasts are DEFENSE entries + idx/slot/role). */
export interface BeastLike {
  readonly n: string;
  readonly p: string;
  readonly t: string;
  readonly d: string;
  readonly s: { readonly sk?: number; readonly int?: number; readonly ff?: number };
  readonly imp: number;
  readonly slot: string;
  /** Legacy code also checks for 'MLB', which assembly never produces. */
  readonly role: string;
}

/** A DEFENSE entry with its legacy index. */
export type IndexedDefender = Defender & { readonly idx: number };

/** One assembled Beast: `{ ...DEFENSE[idx], idx, slot, role: p }`. */
export type Beast = IndexedDefender & { readonly slot: BeastSlot; readonly role: DefensePosition };

export interface DefenderRatings {
  readonly rush: number;
  readonly cover: number;
  readonly runD: number;
  readonly tackle: number;
}

export type RatedDefender<B extends BeastLike = BeastLike> = B & DefenderRatings;

export interface BeastsRating {
  rating: number;
  basePA: number;
  rushIndex: number;
  covIndex: number;
  avgImp: number;
  sackPressure: number;
  takeawayRate: number;
}

// ---- offense ratings (rateOffense) ----

interface Ident {
  name: string;
  team: string;
  dec: string;
  imp: number;
}

export interface QBRatings extends Ident {
  arm: number;
  acc: number;
  care: number;
  explos: number;
  legs: number;
}

export interface RBRatings extends Ident {
  power: number;
  vol: number;
  recv: number;
  score: number;
}

export interface RecRatings extends Ident {
  isTE: boolean;
  sep: number;
  big: number;
  hands: number;
  score: number;
  block: number;
}

export interface OLRatings extends Ident {
  pass: number;
  run: number;
}

export interface OffenseRatings {
  QB: QBRatings;
  RB1: RBRatings | null;
  RB2: RBRatings | null;
  WR1: RecRatings | null;
  WR2: RecRatings | null;
  WR3: RecRatings | null;
  TE: RecRatings | null;
  TE2: RecRatings | null;
  OL: OLRatings;
}

export interface CoverageAssignment<B extends BeastLike = BeastLike> {
  rec: RecRatings;
  defender: RatedDefender<B>;
  slot: string;
}

export interface Matchups<B extends BeastLike = BeastLike> {
  cov: CoverageAssignment<B>[];
  passRush: number;
  runFront: number;
  defenders: RatedDefender<B>[];
  CBs: RatedDefender<B>[];
  Ss: RatedDefender<B>[];
  LBs: RatedDefender<B>[];
  DL: RatedDefender<B>[];
}

// ---- simulateBeatdown output ----

export interface PassBox {
  name: string;
  team: string;
  dec: string;
  cmp: number;
  att: number;
  yds: number;
  td: number;
  int: number;
}

export interface RushBox {
  name: string;
  team: string;
  dec: string;
  car: number;
  yds: number;
  td: number;
  long: number;
}

export interface RecBox {
  name: string;
  team: string;
  dec: string;
  tgt: number;
  rec: number;
  yds: number;
  td: number;
  long: number;
}

export interface DefBox {
  name: string;
  role: string;
  team: string;
  dec: string;
  tk: number;
  sk: number;
  int: number;
  /** Added on the first forced fumble only. */
  ff?: number;
}

/** A play-by-play event a drive can end on (legacy `d.event`). */
export interface DriveEvent {
  type: string;
  by?: string | null;
  passer?: string;
  off?: string;
  /** null when legacy's `off.RB1 && off.RB1.team` short-circuits on a missing RB1. */
  team?: string | null;
  yard?: number;
}

export interface Drive {
  n: number;
  pts: number;
  end?: string;
  yard?: number;
  event?: DriveEvent;
}

/** One entry of the cinematic timeline (your events and interleaved Beasts scores). */
export interface CinematicEvent {
  type: string;
  by?: string | null;
  passer?: string;
  off?: string;
  team?: string | null;
  yard?: number;
  drive: number;
  q: number;
  clock: string;
  yourScore: number;
  beastScore?: number;
  pts: number;
  leadChange?: boolean;
  opening?: boolean;
}

export interface MatchupNote {
  slot: string;
  off: string;
  offImp: number;
  def: string;
  defImp: number;
  defRole: string;
  recYds: number;
  recCatches: number;
  recTD: number;
  winner: 'offense' | 'defense' | 'even';
  margin: number;
}

export interface Trench {
  olPass: number;
  olRun: number;
  passRush: number;
  runFront: number;
  sacks: number;
  passWin: number;
  runWin: number;
}

export type DominanceGrade = 'A+' | 'A' | 'B' | 'C' | 'L' | 'L-';

export interface BeatdownResult<B extends BeastLike = BeastLike> {
  won: boolean;
  yourScore: number;
  beastScore: number;
  grade: DominanceGrade;
  gradeLabel: string;
  defRating: number;
  defPA: string;
  box: { pass: PassBox; qbRush: { att: number; yds: number }; rush: RushBox[]; rec: RecBox[]; def: DefBox[] };
  matchups: MatchupNote[];
  trench: Trench;
  drives: Drive[];
  cinematicEvents: CinematicEvent[];
  totalYds: number;
  opr: number;
  beasts: readonly B[];
  offense: { opr: number; passYpg: number; rushYpg: number; totalYpg: number; qbRating: string };
}
