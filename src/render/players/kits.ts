// Uniform kits (GDD §12.5). Colors are sRGB hex; the player material converts
// them. None of these resemble a real NFL team, and nothing carries a logo.

export interface Kit {
  id: string;
  label: string;
  helmet: string;
  helmetStripe: string;
  /** Emissive strength of the helmet stripe (the Beasts' crimson stripe glows at night). */
  stripeGlow: number;
  facemask: string;
  jersey: string;
  trim: string;
  number: string;
  numberOutline: string;
  pants: string;
  pantsStripe: string;
  socks: string;
  gloves: string;
  cleats: string;
}

export const KITS: Record<string, Kit> = {
  // The Contenders' default (M6.6, Playtest 1 decision 5): white with lime
  // trim and black numbers, so the user's eleven never melt into the
  // Beasts' black. Black numbers with a lime keyline read at broadcast
  // distance on white; the facemask stays the Blackout kit's matte black.
  whiteLime: {
    id: 'whiteLime',
    label: 'White Lime',
    helmet: '#eef0f2',
    helmetStripe: '#9ee600',
    stripeGlow: 0,
    facemask: '#141517',
    jersey: '#f3f4f6',
    trim: '#9ee600',
    number: '#111214',
    numberOutline: '#9ee600',
    pants: '#e9ebee',
    pantsStripe: '#9ee600',
    socks: '#141517',
    gloves: '#eef0f2',
    cleats: '#141517',
  },
  blackoutLime: {
    id: 'blackoutLime',
    label: 'Blackout Lime',
    helmet: '#111214',
    helmetStripe: '#aaff00',
    stripeGlow: 0,
    facemask: '#0c0c0d',
    jersey: '#121315',
    trim: '#aaff00',
    number: '#f2f2f2',
    numberOutline: '#aaff00',
    pants: '#1a1b1e',
    pantsStripe: '#aaff00',
    socks: '#121315',
    gloves: '#161719',
    cleats: '#141416',
  },
  arctic: {
    id: 'arctic',
    label: 'Arctic',
    helmet: '#eef1f4',
    helmetStripe: '#7fc4ec',
    stripeGlow: 0,
    facemask: '#a9b1b8',
    jersey: '#f4f6f8',
    trim: '#7fc4ec',
    number: '#5aa8d8',
    numberOutline: '#c7ccd1',
    pants: '#e7eaed',
    pantsStripe: '#7fc4ec',
    socks: '#f4f6f8',
    gloves: '#e9ecef',
    cleats: '#f2f2f2',
  },
  royal: {
    id: 'royal',
    label: 'Royal',
    helmet: '#15254f',
    helmetStripe: '#d8b24a',
    stripeGlow: 0,
    facemask: '#d8b24a',
    jersey: '#172a5a',
    trim: '#d8b24a',
    number: '#f5f2e8',
    numberOutline: '#d8b24a',
    pants: '#d8b24a',
    pantsStripe: '#172a5a',
    socks: '#172a5a',
    gloves: '#f5f2e8',
    cleats: '#101216',
  },
  ember: {
    id: 'ember',
    label: 'Ember',
    helmet: '#2a2b2e',
    helmetStripe: '#ff7a1a',
    stripeGlow: 0,
    facemask: '#ff7a1a',
    jersey: '#2c2d31',
    trim: '#ff7a1a',
    number: '#ff7a1a',
    numberOutline: '#f2f2f2',
    pants: '#2c2d31',
    pantsStripe: '#ff7a1a',
    socks: '#2c2d31',
    gloves: '#ff7a1a',
    cleats: '#141416',
  },
  heritage: {
    id: 'heritage',
    label: 'Heritage',
    helmet: '#6e1f25',
    helmetStripe: '#efe6d2',
    stripeGlow: 0,
    facemask: '#6b4a32',
    jersey: '#efe6d2',
    trim: '#6e1f25',
    number: '#6e1f25',
    numberOutline: '#6b4a32',
    pants: '#efe6d2',
    pantsStripe: '#6e1f25',
    socks: '#6e1f25',
    gloves: '#6b4a32',
    cleats: '#1a1614',
  },
  // The Beasts (fixed): black and deep crimson, with a crimson helmet stripe
  // that glows (emissive) and reads under the lights at night.
  beasts: {
    id: 'beasts',
    label: 'Beasts',
    helmet: '#0b0b0c',
    helmetStripe: '#9e0f1c',
    stripeGlow: 1,
    facemask: '#161617',
    jersey: '#0e0e10',
    trim: '#8a0f1a',
    number: '#b0121f',
    numberOutline: '#e8e8e8',
    pants: '#0e0e10',
    pantsStripe: '#8a0f1a',
    socks: '#0e0e10',
    gloves: '#0e0e10',
    cleats: '#0b0b0c',
  },
};

/** The Contenders' presets, the default first. Blackout Lime stays (it's refused only against a dark opponent: kitAgainst). */
export const CONTENDER_KITS = ['whiteLime', 'blackoutLime', 'arctic', 'royal', 'ember', 'heritage'] as const;

/** The Contenders' kit unless the player picks another (GDD §12.5 as amended by Playtest 1 decision 5). */
export const CONTENDERS_DEFAULT_KIT = 'whiteLime';

/** Relative luminance (WCAG) of an sRGB hex colour. */
export function kitLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

/**
 * A dark kit: its jersey (the colour that fills the screen from the
 * broadcast camera) below this luminance. 0.18 puts every black, charcoal,
 * navy and oxblood shell on the dark side and every white, cream and silver
 * on the light side (Royal's navy is 0.025, Heritage's cream 0.79).
 */
export const DARK_KIT_LUMINANCE = 0.18;

export const isDarkKit = (k: Kit): boolean => kitLuminance(k.jersey) < DARK_KIT_LUMINANCE;

/**
 * The kit a team wears against this opponent: its own, unless both are
 * dark, when it changes to the Contenders' white default (Playtest 1: "both
 * teams in black on the field"; decision 5: never two dark kits). The
 * Beasts never change; the Contenders do. An unknown id falls back to the default.
 */
export function kitAgainst(id: string, opponent: string): Kit {
  const want = KITS[id] ?? KITS[CONTENDERS_DEFAULT_KIT]!;
  const opp = KITS[opponent];
  if (opp && isDarkKit(want) && isDarkKit(opp)) return KITS[CONTENDERS_DEFAULT_KIT]!;
  return want;
}

// The officials (M6): a black-and-white vertically striped short-sleeve
// shirt (jersey = the white, trim = the black stripes and collar), black
// long pants, black shoes and a black cap; the referee's cap is white. No
// numbers, names or marks (officialLook sets none). Only the fields the
// official's parts read matter; the rest match so nothing stands out.
export const OFFICIAL_KIT: Kit = {
  id: 'official',
  label: 'Official',
  helmet: '#141416', // the cap
  helmetStripe: '#141416',
  stripeGlow: 0,
  facemask: '#141416',
  jersey: '#f1f1ee',
  trim: '#111214',
  number: '#111214',
  numberOutline: '#111214',
  pants: '#17181a',
  pantsStripe: '#17181a',
  socks: '#111214',
  gloves: '#111214',
  cleats: '#0e0e0f',
};

/** The referee's white cap; the rest of the crew wear black. */
export const REFEREE_KIT: Kit = { ...OFFICIAL_KIT, id: 'referee', label: 'Referee', helmet: '#f1f1ee', helmetStripe: '#f1f1ee' };
