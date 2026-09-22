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
  moon?: boolean;
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
    sunElevationDeg: -14,
    sunAzimuthOffAxisDeg: 35,
    sunIlluminance: 22,
    mieScale: 1.2,
    exposure: 1.0,
    envIntensity: 0.25,
    cloudCover: 0.2,
    cloudStreak: 0.5,
    fogDensity: 0.00018,
    fogHeightFalloff: 0.004,
    fogBrightness: 1,
    stadiumLights: 1,
    bloom: { intensity: 0.9, threshold: 0.75 },
    grade: { lift: [0.0, 0.004, 0.012], gamma: [1.02, 1.0, 0.97], gain: [0.96, 1.0, 1.06], saturation: 1.0, contrast: 1.1 },
    moon: true,
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
  },
};
