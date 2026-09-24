// Down, distance and the spot for the Practice Field's free play (GDD §4):
// the series carries on from each result like a real one, and resets to the
// chosen start on a score, a turnover or a failed fourth down.

import { FIELD_HALF_W, type PlayResult } from '@/sim';

export interface Situation {
  /** Line of scrimmage, yards from the offense's goal line. */
  los: number;
  /** Ball's lateral spot (on or between the hashes), yd. */
  ballY: number;
  down: number;
  /** Yards to the line to gain (to the goal line on goal to go). */
  toGo: number;
}

/** NFL hash marks: 70 ft 9 in from each sideline, so ±3.08 yd from the middle. */
export const HASH_Y = FIELD_HALF_W - 70.75 / 3;

export const START_SPOTS = [
  { label: 'Own 25', los: 25 },
  { label: 'Own 40', los: 40 },
  { label: 'Midfield', los: 50 },
  { label: 'Opp 35', los: 65 },
  { label: 'Red zone (Opp 15)', los: 85 },
  { label: 'Goal line (Opp 5)', los: 95 },
];

export const START_DOWNS = [
  { label: '1st & 10', down: 1, toGo: 10 },
  { label: '2nd & 7', down: 2, toGo: 7 },
  { label: '3rd & 3', down: 3, toGo: 3 },
  { label: '3rd & 9', down: 3, toGo: 9 },
  { label: '4th & 1', down: 4, toGo: 1 },
];

export function startSituation(spot: number, downs: number): Situation {
  const los = START_SPOTS[spot]!.los;
  const d = START_DOWNS[downs]!;
  return { los, ballY: 0, down: d.down, toGo: Math.min(d.toGo, 100 - los) };
}

/** "Own 25", "50", "Opp 12" for a yard line. */
export function spotLabel(x: number): string {
  const y = Math.round(x);
  if (y === 50) return 'the 50';
  return y < 50 ? `Own ${y}` : `Opp ${100 - y}`;
}

export function downLabel(s: Situation): string {
  const n = ['1st', '2nd', '3rd', '4th'][s.down - 1] ?? `${s.down}th`;
  const goal = s.los + s.toGo >= 100;
  return `${n} & ${goal ? 'Goal' : Math.max(1, Math.round(s.toGo))}`;
}

/**
 * The next snap after a result, or null when the series is over (a score,
 * a turnover, a turnover on downs): the caller restarts from the chosen start.
 * `endY` is where the ball was dead across the field.
 */
export function nextSituation(s: Situation, r: PlayResult, endY: number): Situation | null {
  if (r.touchdown || !r.offenseBall || r.reason === 'safety') return null;
  // An incompletion comes back to the old spot; everything else is spotted where it died.
  const los = r.reason === 'incomplete' ? s.los : Math.max(1, Math.min(99, r.spot));
  const ballY = r.reason === 'incomplete' ? s.ballY : Math.max(-HASH_Y, Math.min(HASH_Y, endY));
  const gained = los - s.los;
  if (gained >= s.toGo - 1e-6) return { los, ballY, down: 1, toGo: Math.min(10, 100 - los) };
  if (s.down >= 4) return null;
  return { los, ballY, down: s.down + 1, toGo: s.toGo - gained };
}
