// The sim's field frame (yards; x downfield from the offense's goal line,
// y to the offense's left, z up) to the world (meters; the field's long
// axis is Z, north is −Z). The offense attacks north, like the M4 line-up:
// their goal line is the south one (z = +50 yd), and facing north their
// left is −X.

import { YARD } from '@/render/world/constants';

export const worldX = (y: number): number => -y * YARD;
export const worldZ = (x: number): number => (50 - x) * YARD;
export const worldY = (z: number): number => z * YARD;

/** Field-frame x/y of a world point on the ground. */
export const fieldX = (wz: number): number => 50 - wz / YARD;
export const fieldY = (wx: number): number => -wx / YARD;

/**
 * Sim facing (radians, 0 = +x downfield) to the player root's Y rotation.
 * The model faces +Z at rotation 0 and +x is world −Z, so it's a half turn.
 */
export const yawOf = (face: number): number => face + Math.PI;

/** A field-frame direction to world (x, z) components. */
export const worldDir = (dx: number, dy: number): [number, number] => [-dy, -dx];

/** A world direction on the ground (x, z) to the field frame. */
export const fieldDir = (wx: number, wz: number): [number, number] => [-wz, -wx];
