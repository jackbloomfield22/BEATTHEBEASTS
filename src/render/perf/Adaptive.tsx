import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useApp } from '@/app/appStore';
import { urlFlags } from '@/app/platform';
import { useSettings, type QualityPreset } from '@/app/settings';
import { perfStats } from '@/dev/perfStats';
import { benchmarkVerdict, DYNRES, stepDynRes, type DynResState } from './adaptive';

// Dynamic resolution and the first-launch benchmark (logic in adaptive.ts).
// Both stay off in the screenshot harness so captures are reproducible.

export function DynamicResolution({ baseDpr, enabled, targetFps }: { baseDpr: number; enabled: boolean; targetFps: number }) {
  const setDpr = useThree((s) => s.setDpr);
  const state = useRef<DynResState>({ scale: 1, goodWindows: 0, cooldown: 0 });
  const acc = useRef({ sum: 0, n: 0 });
  const active = enabled && urlFlags.shot === null;
  useEffect(() => {
    state.current = { scale: 1, goodWindows: 0, cooldown: 0 };
    setDpr(baseDpr);
    perfStats.dynScale = 1;
  }, [baseDpr, active, setDpr]);
  useFrame((_, dt) => {
    if (!active) return;
    // Ignore hitches from tab switches and shader compiles.
    if (dt > 0.25) return;
    acc.current.sum += dt * 1000;
    if (++acc.current.n < DYNRES.window) return;
    const avg = acc.current.sum / acc.current.n;
    acc.current = { sum: 0, n: 0 };
    const next = stepDynRes(state.current, avg, 1000 / targetFps);
    if (next.scale !== state.current.scale) setDpr(baseDpr * next.scale);
    state.current = next;
    perfStats.dynScale = next.scale;
  });
  return null;
}

/**
 * After the GPU-name guess on first launch, time ~150 frames of the live menu
 * scene and move the preset one tier if the evidence is clear. Runs once.
 */
export function FirstLaunchBenchmark({ targetFps }: { targetFps: number }) {
  const ready = useApp((s) => s.sceneReady);
  const samples = useRef<number[]>([]);
  const skip = useRef(0);
  const settings = useSettings((s) => s.settings);
  const pending = !!settings.detectedPreset && !settings.benchmarked && urlFlags.shot === null && !urlFlags.quality;
  useFrame((_, dt) => {
    if (!pending || !ready) return;
    // Let shaders compile and the first transitions settle (~1 s).
    if (skip.current++ < 60) return;
    samples.current.push(dt * 1000);
    if (samples.current.length < 150) return;
    const sorted = [...samples.current].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const st = useSettings.getState();
    const current = (st.settings.graphics.preset === 'custom' ? st.settings.detectedPreset : st.settings.graphics.preset) as QualityPreset;
    const verdict = benchmarkVerdict(current, median, 1000 / targetFps);
    if (verdict !== current) st.applyPreset(verdict);
    st.set((d) => {
      d.benchmarked = verdict;
    });
    samples.current = [];
  });
  return null;
}
