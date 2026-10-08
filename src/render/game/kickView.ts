// The kick view (M6, M6.6): a field goal, PAT or punt. The ball at the spot
// of the kick, the camera behind it, the aim line and the wind on the field
// while you line it up, and, once struck, the flight along the path
// src/game/kick.ts computed. Written by the game screen's kick panel (and by
// the Beasts' drive, M7, for their punts and field goals:
// src/game/montageSession.ts), read by the game camera, KickBall and KickAim.

export const kickView: {
  active: boolean;
  kind: 'PAT' | 'FG' | 'PUNT';
  /** Spot of the kick (the holder's spot, or where the punter meets the ball), field x (yards from your goal line). */
  spotX: number;
  /** A field goal's distance to the posts' plane, yd. */
  distance: number;
  /** The aim now, rad (+ = left); the aim line follows it. */
  aim: number;
  /** Still lining it up (the aim line and the wind show). */
  aiming: boolean;
  /** Wind: mph and direction (0 = downfield, π/2 = toward the kicker's left). */
  wind: { mph: number; dir: number };
  /** The flight in the kick frame (x toward the posts, y left, z up), sampled every 1/30 s; null before the strike. */
  path: [number, number, number][] | null;
  /** Seconds since the strike. */
  t: number;
  /** Where the ball is now (kick frame), for the camera to follow a punt. */
  ball: [number, number, number];
  /** Who's kicking: yours, or the Beasts' (their drive's punt or field goal, M7: the scene dresses the units for it). */
  team: 'con' | 'bst';
} = { active: false, kind: 'FG', spotX: 0, distance: 0, aim: 0, aiming: false, wind: { mph: 0, dir: 0 }, path: null, t: 0, ball: [0, 0, 0], team: 'con' };

/**
 * Seconds from the strike (the snap) to the foot meeting the ball: the snap
 * (0.17 s release, ~0.55 s to the holder) and the hold, ~1.3 s snap to
 * kick, the NFL operation time.
 */
export const KICK_CONTACT = 1.3;

/**
 * A punt, snap to foot: the snap leaves at 0.17 s and covers 15 yd in
 * ~0.75 s (ks_long_snap; tools/blender says snap to punter ~0.75 s), the
 * punter catches it (ks_punt frame 3) and meets it 1.3 s later (frame 42):
 * ~2.2 s, the NFL's 2.0–2.1 s get-off plus the catch.
 */
export const PUNT_SNAP = { release: 0.17, flight: 0.75, clipLead: 3 / 30, drop: 34 / 30, contact: 42 / 30 };
export const PUNT_CONTACT = PUNT_SNAP.release + PUNT_SNAP.flight - PUNT_SNAP.clipLead + PUNT_SNAP.contact;

/** Seconds from the strike to contact for this kind of kick. */
export const contactFor = (kind: 'PAT' | 'FG' | 'PUNT'): number => (kind === 'PUNT' ? PUNT_CONTACT : KICK_CONTACT);
