import type * as THREE from 'three';
import type { Grade } from './lighting/presets';

// What the one canvas shows this frame (M6). The stadium is R3F's scene and
// stays built and alive; the Contenders' locker room is a second scene that
// the composer's render pass draws instead while it's set. Switching is a
// pointer swap: the post chain, its buffers and every compiled program stay
// as they are (rebuilding the composer on a scene change costs a hitch).

export const view: {
  /** A scene to draw instead of the stadium (the locker room), or null. */
  room: THREE.Scene | null;
  /** Display grade and exposure while `room` is drawn (null: the lighting preset's). */
  grade: { grade: Grade; exposure: number; bloom: number; threshold: number } | null;
  /** Transition multipliers: exposure (a white-out walking into daylight) and fade to black. */
  exposureMul: number;
  fade: number;
} = { room: null, grade: null, exposureMul: 1, fade: 1 };
