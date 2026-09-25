import * as THREE from 'three';
import { SLOT_ORDER } from '@data/legacy/constants';
import type { Slot } from '@data/legacy/types';

// The Contenders' locker room (M6, GDD §6): one row of nine lockers on an
// arc, in draft order left to right, facing the room's center; the video
// wall closes the row on the left and the tunnel door on the right. Units are
// meters in the room's own scene; the floor is y = 0 and the arc's center is
// the origin, with the row toward -Z.
//
// Sizes follow a pro locker (the references in docs/reference/ref-04..06):
// ~1 m wide, ~2.4 m tall, ~0.6 m deep stalls with a top cabinet carrying the
// nameplate, a shelf for the helmet at shoulder height, a hanging rod, and a
// seat cabinet at the base. The OL stall is a double-wide for five men.

export const ARC_R = 9;
export const LOCKER_H = 2.45;
export const LOCKER_D = 0.62;
export const SHELF_Y = 1.84;
export const ROD_Y = 1.72;
export const SEAT_H = 0.44;
export const TOP_H = 0.36;
/** Gap between stalls along the arc. */
const GAP = 0.12;
export const WALL = { width: 4.4, height: 2.5, base: 0.75 };
export const DOOR = { width: 2.3, height: 2.85, depth: 12 };
const END_GAP = 0.7;
export const ROOM_R = ARC_R + LOCKER_D + 0.08;
export const CEILING_Y = 3.9;

export const widthOf = (slot: Slot): number => (slot === 'OL' ? 2.55 : 1.04);

export interface LockerPlace {
  slot: Slot;
  index: number;
  width: number;
  /** Angle of the stall's center on the arc, rad (0 = straight ahead, + = right). */
  angle: number;
  /** Front-center of the stall on the floor. */
  pos: THREE.Vector3;
  /** Rotation about Y that turns the stall's front (+Z local) toward the room's center. */
  rotY: number;
}

/** Position on the arc at `angle` and radius `r`. */
export function onArc(angle: number, r = ARC_R, y = 0): THREE.Vector3 {
  return new THREE.Vector3(r * Math.sin(angle), y, -r * Math.cos(angle));
}

const rowLength = SLOT_ORDER.reduce((s, k) => s + widthOf(k), 0) + GAP * (SLOT_ORDER.length - 1);

export const LOCKERS: LockerPlace[] = (() => {
  let s = -rowLength / 2;
  return SLOT_ORDER.map((slot, index) => {
    const width = widthOf(slot);
    const angle = (s + width / 2) / ARC_R;
    s += width + GAP;
    return { slot, index, width, angle, pos: onArc(angle), rotY: -angle };
  });
})();

export const LOCKER_OF: Record<Slot, LockerPlace> = Object.fromEntries(LOCKERS.map((l) => [l.slot, l])) as Record<Slot, LockerPlace>;

/** The video wall's center angle (left end of the row) and the tunnel door's (right end). */
export const WALL_ANGLE = -(rowLength / 2 + END_GAP + WALL.width / 2) / ARC_R;
export const DOOR_ANGLE = (rowLength / 2 + END_GAP + DOOR.width / 2 + 0.2) / ARC_R;

/** A point `depth` meters in front of a stall (toward the center), at height y. */
export function frontOf(l: { angle: number }, depth: number, y: number): THREE.Vector3 {
  return onArc(l.angle, ARC_R - depth, y);
}
