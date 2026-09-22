import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { EffectComposer, Bloom, N8AO, SMAA } from '@react-three/postprocessing';
import * as THREE from 'three';
import { World, type WorldQuality } from './World';
import { CameraDirector } from './cameras/CameraDirector';
import { ColorPipelineEffect } from './post/ColorPipelineEffect';
import { LIGHTING_PRESETS, type LightingPreset } from './lighting/presets';
import { useSettings, type QualityPreset } from '@/app/settings';
import { useApp } from '@/app/appStore';
import { perfStats, recordFrame } from '@/dev/perfStats';
import { urlFlags } from '@/app/platform';

// The one WebGL canvas. Everything 3D lives here and persists across screens.

function useLightingPreset(): LightingPreset {
  const lighting = useSettings((s) => s.settings.gameplay.lighting);
  const id = (urlFlags.lighting as LightingPreset['id'] | null) ?? (lighting === 'random' ? 'golden' : lighting);
  return LIGHTING_PRESETS[id] ?? LIGHTING_PRESETS.golden;
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
  return (
    <EffectComposer multisampling={g.antialias === 'smaa+msaa' ? 4 : 0} frameBufferType={THREE.HalfFloatType} enableNormalPass={false}>
      {ao ? <N8AO halfRes={g.ao === 'half'} aoRadius={1.6} distanceFalloff={0.6} intensity={2.2} quality={quality === 'ultra' ? 'high' : quality === 'high' ? 'medium' : 'low'} /> : <></>}
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
  return (urlFlags.quality as QualityPreset | null) ?? (s.graphics.preset === 'custom' ? 'high' : s.graphics.preset);
}

export function Stage() {
  const preset = useLightingPreset();
  const shot = useApp((s) => s.shot);
  const setSceneReady = useApp((s) => s.setSceneReady);
  const display = useSettings((s) => s.settings.display);
  const graphics = useSettings((s) => s.settings.graphics);
  const quality = currentQuality();

  const worldQuality: WorldQuality = {
    shadowMapSize: { off: 0, low: 1024, medium: 2048, high: 4096 }[graphics.shadows],
    terrainSegments: quality === 'low' ? 240 : quality === 'medium' ? 320 : 400,
  };
  const dpr = Math.min(window.devicePixelRatio || 1, 2) * display.resolutionScale;

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
        perfStats.quality = quality;
      }}
    >
      <FrameDriver cap={display.frameCap} />
      <World preset={preset} quality={worldQuality} onReady={setSceneReady} />
      <CameraDirector shot={shot} fovOffset={display.fov} />
      <Post preset={preset} quality={quality} />
      <PerfProbe preset={preset.id} />
    </Canvas>
  );
}
