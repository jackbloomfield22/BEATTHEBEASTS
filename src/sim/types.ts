// Sim data types (TECH_PLAN §10). The sim works in yards: x runs downfield
// from the offense's own goal line (0) to the opponent's (100), end zones to
// −10 and 110; y runs across the field, +y to the offense's left, sidelines at
// ±26.667. The offense always attacks +x. Time advances in fixed 1/60 s ticks.

import type { V2 } from './vec';
import type { Effects } from './effects';

export const TICK = 1 / 60;
export const FIELD_HALF_W = 160 / 6; // 26.667 yd
export const GOAL_X = 100;

export type Side = 'off' | 'def';

/** A player as the sim sees him: ratings and body, nothing else. */
export interface SimPlayer {
  id: string;
  name: string;
  /** Rated position (OL for linemen). */
  pos: 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'DE' | 'DT' | 'LB' | 'CB' | 'S';
  num: number;
  attrs: Record<string, number>;
  heightIn: number;
  weightLb: number;
  /** Era-equivalent weight for contact (ratings snapshot), when known. */
  weightEq?: number;
  /** Trait ids (the AI reads a few: Ballhawk, Speed Rusher, ...). */
  traits?: string[];
}

/** Offensive slots in the play definitions. */
export type OffSlot = 'QB' | 'RB' | 'X' | 'Z' | 'SLOT' | 'TE' | 'LT' | 'LG' | 'C' | 'RG' | 'RT';
/** Defensive slots (base 4-3). */
export type DefSlot = 'LE' | 'LDT' | 'RDT' | 'RE' | 'WLB' | 'MLB' | 'SLB' | 'LCB' | 'RCB' | 'FS' | 'SS';

export type Anim =
  | 'stance'
  | 'run'
  | 'backpedal'
  | 'block'
  | 'rush'
  | 'engaged'
  | 'drop'
  | 'throw'
  | 'handoff'
  | 'catch'
  | 'carry'
  | 'juke'
  | 'spin'
  | 'stiffArm'
  | 'truck'
  | 'dive'
  | 'tackle'
  | 'tackled'
  | 'down'
  | 'celebrate';

/** Carrier moves (GDD §9.3). */
export type Move = 'jukeL' | 'jukeR' | 'spin' | 'stiffArm' | 'truck' | 'dive' | 'protect';

export interface Agent {
  i: number;
  side: Side;
  slot: OffSlot | DefSlot;
  p: SimPlayer;
  fx: Effects;
  pos: V2;
  vel: V2;
  /** Facing, radians (0 = +x). */
  face: number;
  anim: Anim;
  /** Ticks left in a committed action (a move, a throw motion, a stumble). */
  busy: number;
  /** A move in progress and its cooldown. */
  move: Move | null;
  moveCooldown: number;
  /** Recent moves (spamming loses effectiveness). */
  moveFatigue: number;
  /** Sprint stamina 0–1. */
  stamina: number;
  /** On the ground (tackled, dove, cut). */
  down: boolean;
  /** Recent positions/velocities for delayed perception (ring buffer, newest last). */
  hist: { pos: V2; vel: V2 }[];
  /** Route runners: world waypoints, which ones are settle points, and the next one. */
  route: { pts: V2[]; sit: boolean[]; idx: number } | null;
  /** Per-role scratch state. */
  mem: Record<string, number | string | boolean | V2 | null>;
}

export type BallMode = 'held' | 'air' | 'loose' | 'dead';

export interface Ball {
  mode: BallMode;
  /** Agent index holding it (mode 'held'). */
  holder: number;
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  /** Throw: intended receiver, catch point and time of arrival (play time). */
  target: number;
  aim: { x: number; y: number; z: number };
  arrive: number;
  thrower: number;
  /** 'touch' | 'bullet' of the last throw. */
  kind: 'touch' | 'bullet' | null;
  /** Nose-over-tail spin phase for the render (radians). */
  spin: number;
}

export type Phase = 'presnap' | 'snap' | 'dropback' | 'pocket' | 'air' | 'carrier' | 'loose' | 'dead';

export type WhistleReason = 'tackle' | 'sack' | 'incomplete' | 'outOfBounds' | 'touchdown' | 'interceptionDown' | 'safety' | 'fumbleOut' | 'timeout';

export interface SimEvent {
  t: number;
  type:
    | 'snap'
    | 'handoff'
    | 'throw'
    | 'catch'
    | 'drop'
    | 'deflection'
    | 'interception'
    | 'engage'
    | 'shed'
    | 'move'
    | 'brokenTackle'
    | 'missedTackle'
    | 'hit'
    | 'tackle'
    | 'sack'
    | 'fumble'
    | 'recovery'
    | 'touchdown'
    | 'outOfBounds'
    | 'whistle';
  /** Agents involved (actor first). */
  who?: number[];
  at?: V2;
  /** Free-form details (catch type, move, hit force, reason, ...). */
  data?: Record<string, number | string | boolean>;
}

export interface PlayResult {
  reason: WhistleReason;
  /** Ball spot at the whistle, x yards. */
  spot: number;
  /** Yards gained from the line of scrimmage. */
  yards: number;
  /** The offense kept the ball (false on an interception or lost fumble). */
  offenseBall: boolean;
  touchdown: boolean;
  /** Pass result for stats. */
  pass?: { attempted: boolean; complete: boolean; intercepted: boolean; airYards: number; target: number };
  sack: boolean;
  ticks: number;
}
