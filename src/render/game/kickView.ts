// The field-goal and PAT view (M6): the ball on the tee at the spot of the
// kick, the camera behind it, and, once struck, the flight along the path
// src/game/kick.ts computed. Written by the game screen, read by the game
// camera and KickBall.

export const kickView: {
  active: boolean;
  /** Spot of the kick, field x (yards from your goal line). */
  spotX: number;
  /** The flight in the kick frame (x toward the posts, y left, z up), sampled every 1/30 s; null before the strike. */
  path: [number, number, number][] | null;
  /** Seconds since the strike. */
  t: number;
} = { active: false, spotX: 0, path: null, t: 0 };

/**
 * Seconds from the strike (the snap) to the foot meeting the ball: the snap
 * (0.17 s release, ~0.55 s to the holder) and the hold, ~1.3 s snap to
 * kick, the NFL operation time.
 */
export const KICK_CONTACT = 1.3;
