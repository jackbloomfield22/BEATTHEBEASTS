// World layout for Blackcliff (GDD §12.1). Units: meters, Y up.
// Field centered at the origin, long axis along Z. North (-Z) is the closed
// end with the tunnel and video board; south (+Z) is the open end over the sea.

export const YARD = 0.9144;
export const FIELD_LENGTH = 120 * YARD; // goal line to goal line + end zones
export const FIELD_WIDTH = (160 / 3) * YARD; // 53⅓ yards
export const HALF_L = FIELD_LENGTH / 2;
export const HALF_W = FIELD_WIDTH / 2;

/** The plateau (field level) is y = 0; the sea sits at the foot of the cliff. */
export const SEA_LEVEL = -46;

/** Stand inner edge: rounded U open to the south. */
export const STAND = {
  halfWidth: 39, // sideline front wall, x = ±39
  northZ: -70, // north end front wall
  southZ: 60, // where the sideline stands end (open end)
  cornerRadius: 30,
};

/** Coastline: land where z < coastZ(x). A promontory pointing south. */
export function coastZ(x: number): number {
  return 104 - 0.00085 * x * x;
}

/**
 * Sun over the sea, 35° off the field axis toward the west (GDD §12.2).
 * Azimuth measured from +Z (the open end) toward -X.
 */
export const SUN_AZIMUTH_OFF_AXIS_DEG = 35;
