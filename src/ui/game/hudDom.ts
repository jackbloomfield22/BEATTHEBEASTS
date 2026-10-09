// DOM nodes of the in-play HUD that change every frame (receiver icons, the
// power ring, the placement reticle, the stamina bar). React mounts them once
// and registers them here; the render loop writes their transforms directly
// (TECH_PLAN §4.3: React never drives per-frame visuals).

export const hudDom = {
  icons: [] as (HTMLElement | null)[],
  rings: [] as (SVGCircleElement | null)[],
  /** The throw-timing cue (passing round 4): the ring filling to the press, and his QB's release segment at its end. */
  cueFill: [] as (SVGCircleElement | null)[],
  cueRel: [] as (SVGCircleElement | null)[],
  reticle: null as HTMLElement | null,
  stamina: null as HTMLElement | null,
  /** The carrier's cluster (stamina and his move keys), placed under him every frame. */
  carrierHud: null as HTMLElement | null,
  staminaFill: null as HTMLElement | null,
  /** The carrier's three move options (their words are written every frame; the one he's in lights up). */
  opts: [] as (HTMLElement | null)[],
  /** The sprint cue: lit while he's sprinting (the sim's mem.sprint). */
  sprint: null as HTMLElement | null,
  /** A Pre-Snap Wizard's blitz tags over the Beasts who'll blitz (presnap.ts blitzersShown), at the line. */
  blitz: [] as (HTMLElement | null)[],
};

/** How many blitz tags the HUD mounts (the most rushers a call sends from off the line). */
export const BLITZ_TAGS = 4;

/** Circumference of the power ring's circle (r = 17). */
export const RING_LEN = 2 * Math.PI * 17;

/** Circumference of the throw-timing cue's circle (r = 20.5, just outside the icon's ring). */
export const CUE_LEN = 2 * Math.PI * 20.5;
