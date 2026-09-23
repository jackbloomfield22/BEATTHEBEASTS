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

export const CONTENDER_KITS = ['blackoutLime', 'arctic', 'royal', 'ember', 'heritage'] as const;
