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
  version: 2;
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
  /** Set once the first-launch benchmark has refined the guess (its verdict). */
  benchmarked?: QualityPreset;
}

export const PRESET_GRAPHICS: Record<QualityPreset, Omit<GraphicsSettings, 'preset'>> = {
  low: { shadows: 'low', ao: 'off', crowdDensity: 'low', grassDetail: 'low', bloom: false, vignette: true, replayDof: false, replayMotionBlur: false, weatherParticles: true, antialias: 'smaa' },
  medium: { shadows: 'medium', ao: 'half', crowdDensity: 'medium', grassDetail: 'medium', bloom: true, vignette: true, replayDof: true, replayMotionBlur: false, weatherParticles: true, antialias: 'smaa' },
  high: { shadows: 'high', ao: 'full', crowdDensity: 'high', grassDetail: 'high', bloom: true, vignette: true, replayDof: true, replayMotionBlur: true, weatherParticles: true, antialias: 'smaa+msaa' },
  ultra: { shadows: 'high', ao: 'full', crowdDensity: 'ultra', grassDetail: 'ultra', bloom: true, vignette: true, replayDof: true, replayMotionBlur: true, weatherParticles: true, antialias: 'smaa+msaa' },
};

/**
 * Default internal resolution scale per preset (before dynamic scaling). The
 * tier's pixel budget (RENDER_PIXEL_BUDGET) already caps the render size, so
 * the scale only trims Low further.
 */
export const PRESET_RES_SCALE: Record<QualityPreset, number> = { low: 0.85, medium: 1, high: 1, ultra: 1 };

/**
 * Most pixels a tier renders at 100% resolution scale. A Retina display at
 * DPR 2 would otherwise render a 1920×1080 window at 3840×2160, four times the
 * work of 1080p, which no Medium-class GPU holds at 60 fps with this scene.
 * Medium renders at most 1080p worth of pixels and High 1440p; Ultra renders
 * at the display's own density (DPR capped at 2). The HTML UI stays at the
 * display's density either way.
 */
export const RENDER_PIXEL_BUDGET: Record<QualityPreset, number> = { low: 1920 * 1080, medium: 1920 * 1080, high: 2560 * 1440, ultra: Infinity };

/** Canvas pixel ratio for a window of cssW×cssH on a display of deviceDpr. */
export function renderDpr(cssW: number, cssH: number, deviceDpr: number, preset: QualityPreset, scale: number): number {
  const native = Math.min(deviceDpr || 1, 2);
  const budget = RENDER_PIXEL_BUDGET[preset];
  const fit = Number.isFinite(budget) ? Math.sqrt(budget / Math.max(1, cssW * cssH)) : native;
  return Math.min(native, fit) * scale;
}

export function defaultSettings(keyboard: Bindings, gamepad: Bindings): Settings {
  return {
    version: 2,
    display: { fullscreen: false, resolutionScale: 1, dynamicResolution: true, frameCap: 0, fov: 0, hudScale: 1, ultrawideSafeArea: true, showFps: false },
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
      if (!section) Object.assign(d, defaults, { detectedPreset: d.detectedPreset, benchmarked: d.benchmarked });
      else (d as unknown as Record<string, unknown>)[section] = defaults[section];
    });
  },
}));

/** Bring older saved settings up to the current version. */
function migrate(stored: Settings): Settings {
  const s = structuredClone(stored);
  if ((s.version as number) === 1) {
    // v2: fullscreen became opt-in (it was requested on the title keypress),
    // and the per-tier pixel budget replaced Medium's 0.9 resolution scale.
    s.display.fullscreen = false;
    const p = s.graphics?.preset;
    if (p && p !== 'custom') s.display.resolutionScale = PRESET_RES_SCALE[p];
    s.version = 2;
  }
  return s;
}

export function initSettings(factory: () => Settings): void {
  defaultsFactory = factory;
  const stored = loadJSON<Settings>(STORAGE_KEY);
  const settings = stored && (stored.version as number) >= 1 ? mergeDeep(factory(), migrate(stored)) : factory();
  useSettings.setState({ settings });
}

export const getSettings = (): Settings => useSettings.getState().settings;
