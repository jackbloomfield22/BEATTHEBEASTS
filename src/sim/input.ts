// The sim's input (TECH_PLAN §13): one frame per 60 Hz tick, already in the
// field frame (the input layer turns camera-relative sticks into field
// directions before recording). This is exactly what gets recorded, so a
// play replays from its seed plus these frames.

import type { RouteName } from './plays';
import type { V2 } from './vec';

export type CatchType = 'aggressive' | 'rac' | 'possession';

export interface InputFrame {
  /** Desired move direction in the field frame, length 0..1. */
  /** For a ball carrier only its direction counts: his speed is the situation's (and his burst is his own). */
  move: V2;
  /** Snap (pressed this tick). */
  snap: boolean;
  /**
   * Receiver icon held (1..5, 0 = none). A throw goes on release: a tap is
   * the driven ball, holding adds touch (the ring fills with the loft).
   */
  throwHeld: number;
  /**
   * Placement while choosing (GDD §9.1): x back shoulder (−1) .. lead (+1),
   * y low (−1) .. high (+1).
   */
  aim: V2;
  pumpFake: boolean;
  throwAway: boolean;
  /** Catch type pressed while the ball is in the air. */
  catchType: CatchType | null;
  jukeL: boolean;
  jukeR: boolean;
  /**
   * Juke with the side left to the carrier: toward the side he's steering
   * (relative to his heading), else away from the nearest tackler.
   */
  juke: boolean;
  spin: boolean;
  stiffArm: boolean;
  truck: boolean;
  dive: boolean;
  /** Protect the ball (held). */
  protect: boolean;
  /**
   * The carrier's move option pressed this tick, 1–3 (0: none): whatever
   * move sits in that slot now (moves.ts carrierOptions, held on him as
   * mem.opts and shown on the HUD). M6.5 #9.
   */
  option: 0 | 1 | 2 | 3;
  /** In the pocket: tuck it and run (pressed this tick). He can still throw on the run until he crosses the line. */
  scramble: boolean;
  /** Pre-snap: change a receiver's route (icon 1..5 and one of HOT_ROUTES). Applied before the snap. */
  hotRoute: { icon: number; route: RouteName } | null;
}

export const NEUTRAL: InputFrame = Object.freeze({
  move: Object.freeze({ x: 0, y: 0 }) as V2,
  snap: false,
  throwHeld: 0,
  aim: Object.freeze({ x: 0, y: 0 }) as V2,
  pumpFake: false,
  throwAway: false,
  catchType: null,
  jukeL: false,
  jukeR: false,
  juke: false,
  spin: false,
  stiffArm: false,
  option: 0,
  truck: false,
  dive: false,
  protect: false,
  scramble: false,
  hotRoute: null,
}) as InputFrame;

export const input = (patch: Partial<InputFrame>): InputFrame => ({ ...NEUTRAL, ...patch });

/** Seconds of hold past a tap that give a touch pass its full loft. */
export const LOFT_CHARGE = 0.5;
/** A hold this long or shorter is a tap: the driven ball (PlaySetup.tapMax carries the player's setting). */
export const TAP_MAX = 0.18;
