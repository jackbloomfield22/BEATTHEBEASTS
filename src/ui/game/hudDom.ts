// DOM nodes of the in-play HUD that change every frame (receiver icons, the
// power ring, the placement reticle, the stamina bar). React mounts them once
// and registers them here; the render loop writes their transforms directly
// (TECH_PLAN §4.3: React never drives per-frame visuals).

export const hudDom = {
  icons: [] as (HTMLElement | null)[],
  rings: [] as (SVGCircleElement | null)[],
  reticle: null as HTMLElement | null,
  stamina: null as HTMLElement | null,
  staminaFill: null as HTMLElement | null,
};

/** Circumference of the power ring's circle (r = 17). */
export const RING_LEN = 2 * Math.PI * 17;
