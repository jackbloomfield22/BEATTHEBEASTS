import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, N8AO, SMAA } from '@react-three/postprocessing';
import * as THREE from 'three';
import type { EffectComposer as EffectComposerImpl } from 'postprocessing';
import { World, type WorldQuality } from './World';
import { Lineup } from './players/Lineup';
import { CameraDirector } from './cameras/CameraDirector';
import { FlyCamera } from './cameras/FlyCamera';
import { GameScene } from './game/GameScene';
import { GameCamera } from './game/GameCamera';
import { ColorPipelineEffect } from './post/ColorPipelineEffect';
import { LIGHTING_PRESETS, type LightingPreset } from './lighting/presets';
import { renderDpr, useSettings, type QualityPreset } from '@/app/settings';
import { guessQuality } from './quality';
import { useApp } from '@/app/appStore';
import { perfStats, recordFrame } from '@/dev/perfStats';
import { DynamicResolution, FirstLaunchBenchmark } from './perf/Adaptive';
import { urlFlags } from '@/app/platform';

// The one WebGL canvas. Everything 3D lives here and persists across screens.

function useLightingPreset(): LightingPreset {
  const lighting = useSettings((s) => s.settings.gameplay.lighting);
  const id = (urlFlags.lighting as LightingPreset['id'] | null) ?? (lighting === 'random' ? 'golden' : lighting);
  return LIGHTING_PRESETS[id] ?? LIGHTING_PRESETS.golden;
}

function useWindowSize(): { w: number; h: number } {
  const [s, setS] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setS({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return s;
}

function PerfProbe({ preset }: { preset: string }) {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const viewport = useThree((s) => s.viewport);
  useEffect(() => {
    gl.info.autoReset = false;
    const ext = gl.getContext().getExtension('WEBGL_debug_renderer_info');
    perfStats.gpu = ext ? String(gl.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unavailable';
  }, [gl]);
  useEffect(() => {
    perfStats.width = size.width;
    perfStats.height = size.height;
    perfStats.dpr = viewport.dpr;
    perfStats.preset = preset;
  }, [size, viewport.dpr, preset]);
  // First in the frame: reset counters. Last: read them (after the composer rendered).
  useFrame(() => {
    gl.info.reset();
  }, -1000);
  useFrame(() => {
    recordFrame(performance.now());
    perfStats.drawCalls = gl.info.render.calls;
    perfStats.triangles = gl.info.render.triangles;
    perfStats.lines = gl.info.render.lines;
    perfStats.points = gl.info.render.points;
    perfStats.geometries = gl.info.memory.geometries;
    perfStats.textures = gl.info.memory.textures;
    perfStats.programs = gl.info.programs?.length ?? 0;
  }, 1000);
  return null;
}

function Post({ preset, quality }: { preset: LightingPreset; quality: QualityPreset }) {
  const g = useSettings((s) => s.settings.graphics);
  const reduceFlashing = useSettings((s) => s.settings.accessibility.reduceFlashing);
  const color = useMemo(() => new ColorPipelineEffect(), []);
  useEffect(() => {
    color.setGrade(preset.grade, preset.exposure);
    color.vignette = g.vignette ? 0.38 : 0;
  }, [color, preset, g.vignette]);
  const ao = g.ao !== 'off' && !(import.meta.env.DEV && location.search.includes('noao'));
  // The composer resizes its buffers only when the canvas's CSS size changes,
  // not its pixel ratio, so a preset switch or a dynamic-resolution step
  // would leave every effect pass at the old resolution (upscaled: soft, and
  // no cheaper). Resize it whenever the ratio moves.
  const composer = useRef<EffectComposerImpl | null>(null);
  const dpr = useThree((s) => s.viewport.dpr);
  const size = useThree((s) => s.size);
  useEffect(() => {
    composer.current?.setSize(size.width, size.height);
  }, [dpr, size]);
  return (
    <EffectComposer ref={composer} multisampling={g.antialias === 'smaa+msaa' ? 4 : 0} frameBufferType={THREE.HalfFloatType} enableNormalPass={false}>
      {/* Medium: half resolution each way (a quarter of the pixels) and the fewest samples (M5 perf, the broadcast gate). */}
      {ao ? <N8AO halfRes={g.ao === 'half'} aoRadius={1.6} distanceFalloff={0.6} intensity={2.2} quality={quality === 'ultra' ? 'high' : quality === 'high' ? 'medium' : quality === 'medium' ? 'performance' : 'low'} /> : <></>}
      {g.bloom ? <Bloom mipmapBlur intensity={preset.bloom.intensity * (reduceFlashing ? 0.6 : 1)} luminanceThreshold={preset.bloom.threshold} luminanceSmoothing={0.2} radius={0.72} /> : <></>}
      <primitive object={color} dispose={null} />
      <SMAA />
    </EffectComposer>
  );
}

/** Frame cap: when set, drive R3F manually at the capped rate. */
function FrameDriver({ cap }: { cap: number }) {
  const advance = useThree((s) => s.advance);
  const setFrameloop = useThree((s) => s.setFrameloop);
  const last = useRef(0);
  useEffect(() => {
    if (!cap) {
      setFrameloop('always');
      return;
    }
    setFrameloop('never');
    let raf = 0;
    const interval = 1000 / cap;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last.current >= interval - 1) {
        last.current = t - ((t - last.current) % interval);
        advance(t);
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cap, advance, setFrameloop]);
  return null;
}

export function currentQuality(): QualityPreset {
  const s = useSettings.getState().settings;
  // Custom settings keep the tier the hardware was detected as (render budget,
  // DPR cap, terrain detail); treating them as High doubled the pixels.
  return (urlFlags.quality as QualityPreset | null) ?? (s.graphics.preset === 'custom' ? (s.detectedPreset ?? 'medium') : s.graphics.preset);
}

export function Stage({ onContextLost }: { onContextLost?: (canvas: HTMLCanvasElement) => void } = {}) {
  const preset = useLightingPreset();
  const shot = useApp((s) => s.shot);
  const inGame = useApp((s) => s.screen === 'practice');
  const setSceneReady = useApp((s) => s.setSceneReady);
  const display = useSettings((s) => s.settings.display);
  const graphics = useSettings((s) => s.settings.graphics);
  const quality = currentQuality();

  const worldQuality: WorldQuality = {
    shadows: graphics.shadows,
    tier: quality,
    terrainSegments: quality === 'low' ? 240 : quality === 'medium' ? 320 : 400,
    crowdDensity: graphics.crowdDensity,
    grassDetail: graphics.grassDetail,
    // Vegetation follows the grass-detail setting (both are ground clutter).
    vegetationDensity: { low: 0.35, medium: 0.6, high: 1, ultra: 1 }[graphics.grassDetail],
    weatherParticles: graphics.weatherParticles,
  };
  const win = useWindowSize();
  // The tier's pixel budget caps the render size (settings.ts RENDER_PIXEL_BUDGET).
  const dpr = +renderDpr(win.w, win.h, window.devicePixelRatio, quality, display.resolutionScale).toFixed(3);

  return (
    <Canvas
      className="stage"
      flat
      dpr={dpr}
      shadows={{ type: THREE.PCFShadowMap }}
      gl={{ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false, preserveDrawingBuffer: urlFlags.shot !== null }}
      camera={{ fov: 40, near: 0.5, far: 16000, position: [-420, -8, 520] }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x05040a);
        // three already preventDefault()s the loss so the context can come
        // back; the app remounts the stage on a fresh canvas (App.tsx).
        gl.domElement.addEventListener('webglcontextlost', () => onContextLost?.(gl.domElement), { once: true });
        if (import.meta.env.DEV) Object.assign(window, { __btbLoseContext: () => gl.getContext().getExtension('WEBGL_lose_context')?.loseContext() });
        perfStats.quality = quality;
        // First launch: pick a preset from the GPU name.
        const st = useSettings.getState();
        if (!st.settings.detectedPreset && !urlFlags.quality) {
          const ext = gl.getContext().getExtension('WEBGL_debug_renderer_info');
          const gpu = ext ? String(gl.getContext().getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
          const guess = guessQuality(gpu);
          st.applyPreset(guess);
          st.set((d) => {
            d.detectedPreset = guess;
          });
        }
      }}
    >
      <FrameDriver cap={display.frameCap} />
      <DynamicResolution baseDpr={dpr} enabled={display.dynamicResolution} targetFps={display.frameCap || 60} />
      <FirstLaunchBenchmark targetFps={display.frameCap || 60} />
      <World preset={preset} quality={worldQuality} onReady={setSceneReady} />
      {urlFlags.lineup ? <Lineup /> : null}
      {inGame ? <GameScene /> : null}
      {urlFlags.fly ? <FlyCamera /> : inGame ? <GameCamera fovOffset={display.fov} /> : <CameraDirector shot={shot} fovOffset={display.fov} />}
      <Post preset={preset} quality={quality} />
      <PerfProbe preset={preset.id} />
    </Canvas>
  );
}
