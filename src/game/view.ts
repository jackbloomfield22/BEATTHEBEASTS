// What the render knows about the view that the input layer needs: the
// camera's heading on the ground (sticks are camera-relative) and where the
// receiver icons are on screen (clicks and the placement reticle). The
// render writes it every frame; the input layer reads it every tick.

export interface IconView {
  /** Screen position of the icon's center, CSS px. */
  x: number;
  y: number;
  visible: boolean;
  /** Receiver's motion on screen (unit vector, CSS px axes: y down). */
  ux: number;
  uy: number;
  /** How open he is for a throw now (the icon's glow). */
  open: OpenState;
}

export type OpenState = 'open' | 'tight' | 'covered' | 'none';

/**
 * The icon's state from the sim's openness (separation at the catch, yd).
 * Thresholds from `tools/sim/calib.ts` on the M6 sim (1,314 scripted
 * throws, random receiver and timing): 2 yd or more completes 55–70% with
 * 0–2% intercepted; below 0 (the nearest defender inside him) completes
 * ~40% with 5–8% intercepted; 0–2 yd is in between (40–53%, 5–6%). Open is
 * 2 yd or more, covered below 0, tight between.
 */
export function openState(sep: number): OpenState {
  return sep >= 2 ? 'open' : sep < 0 ? 'covered' : 'tight';
}

export const view = {
  /** Camera forward on the ground, field frame, unit length. */
  fwd: { x: 1, y: 0 },
  icons: Array.from({ length: 5 }, (): IconView => ({ x: 0, y: 0, visible: false, ux: 0, uy: -1, open: 'none' })),
};

/** Reticle radius (CSS px): a mouse this far from the icon is full placement. */
export const AIM_RADIUS = 56;
