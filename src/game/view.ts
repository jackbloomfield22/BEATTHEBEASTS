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
}

export const view = {
  /** Camera forward on the ground, field frame, unit length. */
  fwd: { x: 1, y: 0 },
  icons: Array.from({ length: 5 }, (): IconView => ({ x: 0, y: 0, visible: false, ux: 0, uy: -1 })),
};

/** Reticle radius (CSS px): a mouse this far from the icon is full placement. */
export const AIM_RADIUS = 56;
