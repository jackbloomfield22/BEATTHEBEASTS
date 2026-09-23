// Lighting presets are data, not code paths (TECH_PLAN §5.3). Milestone 1
// tunes Golden Hour; the others are first passes that milestone 3 finishes.

export interface Grade {
  lift: [number, number, number];
  gamma: [number, number, number];
  gain: [number, number, number];
  saturation: number;
  contrast: number;
}

export interface LightingPreset {
  id: 'golden' | 'night' | 'overcast' | 'rain' | 'snow';
  label: string;
  /** Key light (the sun, or the moon for night presets): elevation above the horizon. */
  sunElevationDeg: number; // above the horizon (negative = below)
  sunAzimuthOffAxisDeg: number; // from +Z toward -X
  sunIlluminance: number; // scale for the atmosphere integral and the key light
  mieScale: number; // aerosol / haze amount (turbidity)
  exposure: number;
  envIntensity: number;
  cloudCover: number; // 0..1
  cloudStreak: number; // 0 = puffy, 1 = long stratus streaks
  fogDensity: number; // at sea level, per meter
  fogHeightFalloff: number; // per meter
  fogBrightness: number;
  stadiumLights: number; // 0..1 emissive + light banks
  bloom: { intensity: number; threshold: number };
  grade: Grade;
  /**
   * Night: the key light is the moon. The same physical sky integrates
   * moonlight (a dim sky with the same shape as day), tinted cool; stars
   * show; floodlights carry the field; the stadium glows in the haze and on
   * the water.
   */
  moon?: boolean;
  /** Color tint of the key light and the sky it lights (moonlight reads cool). */
  keyTint?: [number, number, number];
  /** Warm light scattered by the haze and reflected by the sea around the lit bowl (0..1). */
  stadiumGlow?: number;
  /** Surface wetness 0..1 (darker, glossier, puddles on flat ground; none under the roofs). */
  wetness?: number;
  /** Snow cover 0..1 on upward-facing surfaces (the field's lines are swept clear). */
  snowCover?: number;
  /** Falling rain or snow around the camera; density 0..1 of the full particle budget. */
  precipitation?: { kind: 'rain' | 'snow'; density: number };
}

const neutral: Grade = { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1, contrast: 1 };

export const LIGHTING_PRESETS: Record<LightingPreset['id'], LightingPreset> = {
  golden: {
    id: 'golden',
    label: 'Golden Hour',
    sunElevationDeg: 5.5,
    sunAzimuthOffAxisDeg: 35,
    sunIlluminance: 22,
    mieScale: 1.6,
    exposure: 1.0,
    envIntensity: 1.0,
    cloudCover: 0.32,
    cloudStreak: 0.75,
    fogDensity: 0.00012,
    fogHeightFalloff: 0.0045,
    fogBrightness: 1.0,
    stadiumLights: 0.55,
    bloom: { intensity: 0.55, threshold: 0.9 },
    grade: { lift: [0.004, 0.0, -0.004], gamma: [0.98, 1.0, 1.03], gain: [1.05, 1.0, 0.94], saturation: 1.12, contrast: 1.06 },
  },
  night: {
    id: 'night',
    label: 'Night',
    // The moon, high over the sea off the open end, so the broadcast view
    // toward the ocean shows a moon glitter path on the water.
    sunElevationDeg: 24,
    sunAzimuthOffAxisDeg: 14,
    sunIlluminance: 0.62,
    mieScale: 1.0,
    exposure: 1.9,
    envIntensity: 0.6,
    cloudCover: 0.28,
    cloudStreak: 0.55,
    fogDensity: 0.00022,
    fogHeightFalloff: 0.004,
    fogBrightness: 1,
    stadiumLights: 1,
    bloom: { intensity: 0.9, threshold: 0.75 },
    grade: { lift: [0.0, 0.002, 0.008], gamma: [1.04, 1.0, 0.95], gain: [0.94, 1.0, 1.08], saturation: 1.0, contrast: 1.14 },
    moon: true,
    keyTint: [0.6, 0.76, 1.0],
    stadiumGlow: 1,
  },
  overcast: {
    id: 'overcast',
    label: 'Overcast',
    sunElevationDeg: 28,
    sunAzimuthOffAxisDeg: 35,
    sunIlluminance: 9,
    mieScale: 4,
    exposure: 1.1,
    envIntensity: 1.3,
    cloudCover: 0.95,
    cloudStreak: 0.2,
    fogDensity: 0.00035,
    fogHeightFalloff: 0.003,
    fogBrightness: 1,
    stadiumLights: 0.3,
    bloom: { intensity: 0.3, threshold: 1 },
    grade: { lift: [0.005, 0.006, 0.008], gamma: [1, 1, 1], gain: [0.97, 1.0, 1.02], saturation: 0.88, contrast: 1.02 },
    wetness: 0.15, // damp after a shower
  },
  rain: {
    id: 'rain',
    label: 'Rain',
    sunElevationDeg: 20,
    sunAzimuthOffAxisDeg: 35,
    sunIlluminance: 6,
    mieScale: 6,
    exposure: 1.15,
    envIntensity: 1.2,
    cloudCover: 1,
    cloudStreak: 0.1,
    fogDensity: 0.0006,
    fogHeightFalloff: 0.0025,
    fogBrightness: 0.9,
    stadiumLights: 1,
    bloom: { intensity: 0.6, threshold: 0.85 },
    grade: { ...neutral, saturation: 0.82, gain: [0.95, 1.0, 1.04], contrast: 1.05 },
    wetness: 1,
    precipitation: { kind: 'rain', density: 1 },
  },
  snow: {
    id: 'snow',
    label: 'Snow',
    sunElevationDeg: 14,
    sunAzimuthOffAxisDeg: 35,
    sunIlluminance: 8,
    mieScale: 5,
    exposure: 1.1,
    envIntensity: 1.3,
    cloudCover: 1,
    cloudStreak: 0.1,
    fogDensity: 0.0007,
    fogHeightFalloff: 0.0025,
    fogBrightness: 1.05,
    stadiumLights: 1,
    bloom: { intensity: 0.5, threshold: 0.9 },
    grade: { ...neutral, saturation: 0.8, gain: [0.97, 1.0, 1.05] },
    wetness: 0.25,
    snowCover: 0.85,
    precipitation: { kind: 'snow', density: 0.8 },
  },
};
