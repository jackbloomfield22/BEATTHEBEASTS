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
 * Thresholds from `tools/sim/calib.ts` (1,200 scripted throws): 1–3 yd of
 * separation completes ~65–68% with no interceptions, 2+ yd inside the
 * nearest defender ~38–41% with 7–8% intercepted. Open is 1.5 yd or more,
 * covered below −1 yd, tight between.
 */
export function openState(sep: number): OpenState {
  return sep >= 1.5 ? 'open' : sep < -1 ? 'covered' : 'tight';
}

export const view = {
  /** Camera forward on the ground, field frame, unit length. */
  fwd: { x: 1, y: 0 },
  icons: Array.from({ length: 5 }, (): IconView => ({ x: 0, y: 0, visible: false, ux: 0, uy: -1, open: 'none' })),
};

/** Reticle radius (CSS px): a mouse this far from the icon is full placement. */
export const AIM_RADIUS = 56;
