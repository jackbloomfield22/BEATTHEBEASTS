import { create } from 'zustand';
import { loadJSON, saveJSON } from './storage';
import type { Bindings } from '@/input/actions';

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
export type Difficulty = 'rookie' | 'pro' | 'legend' | 'beast';
export type LightingPreset = 'golden' | 'night' | 'overcast' | 'rain' | 'snow' | 'random';

export interface GraphicsSettings {
  preset: QualityPreset | 'custom';
  shadows: 'off' | 'low' | 'medium' | 'high';
  ao: 'off' | 'half' | 'full';
  crowdDensity: 'low' | 'medium' | 'high' | 'ultra';
  grassDetail: 'low' | 'medium' | 'high' | 'ultra';
  bloom: boolean;
  vignette: boolean;
  replayDof: boolean;
  replayMotionBlur: boolean;
  weatherParticles: boolean;
  antialias: 'smaa' | 'smaa+msaa';
}

export interface Settings {
  version: 1;
  display: {
    fullscreen: boolean;
    resolutionScale: number; // 0.5 .. 1.0
    dynamicResolution: boolean;
    frameCap: 0 | 30 | 60 | 120 | 144; // 0 = unlimited (display refresh)
    fov: number; // broadcast camera vertical FOV offset, degrees (-10..10)
    hudScale: number; // 0.8 .. 1.25
    ultrawideSafeArea: boolean;
    showFps: boolean;
  };
  graphics: GraphicsSettings;
  controls: {
    mouseSensitivity: number; // 0.25 .. 2
    invertY: boolean;
    reticleSensitivity: number; // 0.25 .. 2
    bulletHoldMs: number; // 120 .. 400
    ballInAir: 'off' | 'assist' | 'full';
    keyboard: Bindings;
    gamepad: Bindings;
  };
  audio: { master: number; music: number; sfx: number; crowd: number; ui: number; muteUnfocused: boolean };
  gameplay: {
    difficulty: Difficulty;
    gameLength: 4 | 6 | 10;
    camera: 'broadcast' | 'all22' | 'field';
    lighting: LightingPreset;
    skipIntros: boolean;
    fastReveal: boolean;
    autoReplay: 'on' | 'big' | 'off';
  };
  accessibility: {
    colorblind: 'off' | 'deuteranopia' | 'protanopia' | 'tritanopia';
    captionSize: 'small' | 'medium' | 'large';
    reduceShake: boolean;
    reduceFlashing: boolean;
    holdToToggle: boolean;
    uiScale: number; // 0.85 .. 1.3
  };
  /** Set once the first-launch auto-detect has run. */
  detectedPreset?: QualityPreset;
}

export const PRESET_GRAPHICS: Record<QualityPreset, Omit<GraphicsSettings, 'preset'>> = {
  low: { shadows: 'low', ao: 'off', crowdDensity: 'low', grassDetail: 'low', bloom: false, vignette: true, replayDof: false, replayMotionBlur: false, weatherParticles: true, antialias: 'smaa' },
  medium: { shadows: 'medium', ao: 'half', crowdDensity: 'medium', grassDetail: 'medium', bloom: true, vignette: true, replayDof: true, replayMotionBlur: false, weatherParticles: true, antialias: 'smaa' },
  high: { shadows: 'high', ao: 'full', crowdDensity: 'high', grassDetail: 'high', bloom: true, vignette: true, replayDof: true, replayMotionBlur: true, weatherParticles: true, antialias: 'smaa+msaa' },
  ultra: { shadows: 'high', ao: 'full', crowdDensity: 'ultra', grassDetail: 'ultra', bloom: true, vignette: true, replayDof: true, replayMotionBlur: true, weatherParticles: true, antialias: 'smaa+msaa' },
};

/** Default internal resolution scale per preset (before dynamic scaling). */
export const PRESET_RES_SCALE: Record<QualityPreset, number> = { low: 0.75, medium: 0.9, high: 1, ultra: 1 };

export function defaultSettings(keyboard: Bindings, gamepad: Bindings): Settings {
  return {
    version: 1,
    display: { fullscreen: true, resolutionScale: 0.9, dynamicResolution: true, frameCap: 0, fov: 0, hudScale: 1, ultrawideSafeArea: true, showFps: false },
    graphics: { preset: 'medium', ...PRESET_GRAPHICS.medium },
    controls: { mouseSensitivity: 1, invertY: false, reticleSensitivity: 1, bulletHoldMs: 200, ballInAir: 'assist', keyboard, gamepad },
    audio: { master: 0.8, music: 0.6, sfx: 0.8, crowd: 0.8, ui: 0.7, muteUnfocused: true },
    gameplay: { difficulty: 'pro', gameLength: 6, camera: 'broadcast', lighting: 'golden', skipIntros: false, fastReveal: false, autoReplay: 'big' },
    accessibility: { colorblind: 'off', captionSize: 'medium', reduceShake: false, reduceFlashing: false, holdToToggle: false, uiScale: 1 },
  };
}

const STORAGE_KEY = 'settings.v1';

interface SettingsStore {
  settings: Settings;
  set: (mutate: (draft: Settings) => void) => void;
  applyPreset: (preset: QualityPreset) => void;
  reset: (section?: keyof Omit<Settings, 'version' | 'detectedPreset'>) => void;
}

let defaultsFactory: () => Settings = () => {
  throw new Error('settings: initSettings() not called');
};

/** Deep merge persisted values over defaults so new settings get sane defaults. */
function mergeDeep<T>(base: T, over: unknown): T {
  if (over === null || typeof over !== 'object' || Array.isArray(over)) return (over as T) ?? base;
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    if (b !== undefined && typeof b === typeof v) out[k] = typeof v === 'object' && v !== null && !Array.isArray(v) ? mergeDeep(b, v) : v;
  }
  return out as T;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: undefined as unknown as Settings,
  set: (mutate) => {
    const next = structuredClone(get().settings);
    mutate(next);
    saveJSON(STORAGE_KEY, next);
    set({ settings: next });
  },
  applyPreset: (preset) => {
    get().set((d) => {
      d.graphics = { preset, ...PRESET_GRAPHICS[preset] };
      d.display.resolutionScale = PRESET_RES_SCALE[preset];
    });
  },
  reset: (section) => {
    const defaults = defaultsFactory();
    get().set((d) => {
      if (!section) Object.assign(d, defaults, { detectedPreset: d.detectedPreset });
      else (d as unknown as Record<string, unknown>)[section] = defaults[section];
    });
  },
}));

export function initSettings(factory: () => Settings): void {
  defaultsFactory = factory;
  const stored = loadJSON<Settings>(STORAGE_KEY);
  const settings = stored && stored.version === 1 ? mergeDeep(factory(), stored) : factory();
  useSettings.setState({ settings });
}

export const getSettings = (): Settings => useSettings.getState().settings;
