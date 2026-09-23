// Types for the ratings system (BRIEF "Player ratings", TECH_PLAN §7).
// Every attribute is traceable: a value, a confidence, and the list of
// contributions that produced it (they sum exactly to the value).

export type Conf = 'verified' | 'reference' | 'estimated' | 'legacy' | 'prior';

/** A single input value with provenance. */
export interface Sourced<T = number> {
  v: T;
  src: string;
  conf: Conf;
  /** Games behind this value when fewer than the stint's (e.g. targets exist only for some seasons). */
  games?: number;
}

export type OffPos = 'QB' | 'RB' | 'WR' | 'TE';
export type DefPos = 'DE' | 'DT' | 'LB' | 'CB' | 'S';
export type RatedPos = OffPos | DefPos | 'OL';

export interface Contribution {
  /** Human-readable reason, e.g. "Completion % vs league (+4.1 pts)". */
  label: string;
  /** Rating points this input moved the attribute by. */
  delta: number;
  /** The input value shown in the explorer (already formatted or numeric). */
  input?: string;
  /** Provenance of the input. */
  conf?: Conf;
  src?: string;
  kind: 'base' | 'stat' | 'accolade' | 'reputation' | 'physical' | 'body' | 'aging' | 'prior' | 'unit';
}

export interface AttributeResult {
  value: number; // 0–99, one decimal internally
  /** 0–1 share of this attribute's weight backed by verified/reference inputs. */
  confScore: number;
  conf: 'high' | 'medium' | 'low';
  contributions: Contribution[];
}

export interface TraitResult {
  id: TraitId;
  reasons: string[];
}

export type TraitId =
  | 'deep-threat'
  | 'route-technician'
  | 'possession'
  | 'contested-catch'
  | 'yac-monster'
  | 'elusive'
  | 'bruiser'
  | 'workhorse'
  | 'receiving-back'
  | 'pocket-passer'
  | 'gunslinger'
  | 'scrambler'
  | 'field-general'
  | 'speed-rusher'
  | 'power-rusher'
  | 'interior-wrecker'
  | 'ballhawk'
  | 'shutdown-corner'
  | 'enforcer'
  | 'run-stuffer'
  | 'sideline-to-sideline'
  | 'coverage-linebacker';

/** Stint-level rate stats the formulas read. All optional; provenance on each. */
export interface StintStats {
  // QB
  passYdsPerGame?: Sourced;
  passTdPerGame?: Sourced;
  intPerGame?: Sourced;
  passerRating?: Sourced;
  cmpPct?: Sourced;
  ypa?: Sourced;
  tdPct?: Sourced;
  intPct?: Sourced;
  sackPct?: Sourced;
  attPerGame?: Sourced;
  qbRushYdsPerGame?: Sourced;
  // RB
  rushYdsPerGame?: Sourced;
  ypc?: Sourced;
  carriesPerGame?: Sourced;
  rushTdPerGame?: Sourced;
  fumblesPerTouch?: Sourced;
  // receiving (RB/WR/TE)
  recYdsPerGame?: Sourced;
  recPerGame?: Sourced;
  yardsPerRec?: Sourced;
  yardsPerTarget?: Sourced;
  catchPct?: Sourced;
  tdPerGame?: Sourced; // all TDs per game (legacy `t` for RB/WR/TE)
  blockGrade?: Sourced; // legacy TE `b` (hand-set)
  // defense
  sacksPerGame?: Sourced;
  defIntPerGame?: Sourced;
  ffPerGame?: Sourced;
  frPerGame?: Sourced;
  defTdPerGame?: Sourced;
  pdPerGame?: Sourced;
  tacklesPerGame?: Sourced;
  sacksOfficial?: boolean;
}

export interface Accolades {
  seasons: number; // denominator (seasons in stint)
  allPro1: number;
  allPro2: number;
  proBowl: number;
  mvp: number;
  poy: number; // OPOY / DPOY
  /** Mean honors score of the best three seasons in the stint (fewer if the stint is shorter), when season lists exist. */
  peak3?: number;
  src: string;
  conf: Conf;
}

/** League averages over the stint's seasons (games-weighted). */
export interface Baseline {
  cmpPct: number;
  ypa: number;
  tdPct: number;
  intPct: number;
  sackPct: number;
  passerRating: number;
  ypc: number;
  pointsPerTeamGame: number;
  passYdsPerTeamGame: number;
  passTdPerTeamGame: number;
  intPerTeamGame: number;
  sacksPerTeamGame: number;
  rushYdsPerTeamGame: number;
  rushTdPerTeamGame: number;
  passCmpPerTeamGame: number;
  yardsPerReception: number;
  yardsPerTarget?: number;
  catchRate?: number;
  src: string;
  conf: Conf;
}

export interface Measurables {
  forty?: Sourced;
  bench?: Sourced;
  vertical?: Sourced;
  broad?: Sourced;
  cone?: Sourced;
  shuttle?: Sourced;
  /** 10-yard split of the 40. */
  tenSplit?: Sourced;
}

/** Everything the formulas may read for one stint. Built by inputs.ts. */
export interface RatingInputs {
  id: string;
  personId: string;
  name: string;
  pos: RatedPos;
  team: string;
  decade: string;
  imp: number;
  seasons: Sourced<number[]>;
  games: Sourced;
  /** Mean age during the stint. */
  age?: Sourced;
  heightIn?: Sourced;
  weightLb?: Sourced;
  measurables: Measurables;
  stats: StintStats;
  accolades?: Accolades;
  baseline: Baseline;
  /** OL only: the unit's legacy numbers and this lineman's slot in it. */
  olUnit?: {
    unitId: string;
    rushYdsPerGame: number;
    sacksAllowedPerGame: number;
    passBlockGrade: number;
    proBowlLinemen: number;
    unitImp: number;
    slot: 'LT' | 'LG' | 'C' | 'RG' | 'RT';
    fromKeyList: boolean;
    generated: boolean;
  };
  /** Years in the league at the stint midpoint (experience). */
  experience?: Sourced;
}

export interface RatedEntry {
  id: string;
  personId: string;
  name: string;
  pos: RatedPos;
  team: string;
  decade: string;
  imp: number;
  attrs: Record<string, AttributeResult>;
  ovr: AttributeResult;
  traits: TraitResult[];
  inputs: RatingInputs;
  /** Legacy archetype label (deriveProfile), for cross-checking traits. */
  legacyArchetype?: string;
}
