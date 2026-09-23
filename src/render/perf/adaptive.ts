// Adaptive quality, pure logic (the React glue is in Adaptive.tsx):
//  - dynamic resolution: step the render scale down when frames run long,
//    and probe back up after a stretch at the refresh cap;
//  - the first-launch benchmark: move the GPU-name guess one tier up or down
//    from the measured median frame time.

import type { QualityPreset } from '@/app/settings';

export interface DynResState {
  scale: number; // 0.6 .. 1 of the user's base resolution
  goodWindows: number; // consecutive windows at or under target
  cooldown: number; // windows to wait before probing up again
}

export const DYNRES = {
  min: 0.6, // below this the image turns soft enough to hurt readability
  step: 0.05,
  window: 30, // frames per decision (~0.5 s at 60 fps)
  slow: 1.12, // step down when the window average exceeds target × 1.12
  onTarget: 1.03, // "at the cap": average within 3 % of target
  probeAfter: 10, // ~5 s at the cap before trying a step up
  backoff: 40, // after a failed probe, wait ~20 s
} as const;

/** One decision per window of frames. `avgMs` is the window's mean frame time. */
export function stepDynRes(s: DynResState, avgMs: number, targetMs: number): DynResState {
  if (avgMs > targetMs * DYNRES.slow) {
    // A drop right after a probe means the probe failed: back off for longer.
    const failedProbe = s.goodWindows === 0 && s.cooldown === 0;
    return { scale: Math.max(DYNRES.min, +(s.scale - DYNRES.step).toFixed(3)), goodWindows: 0, cooldown: failedProbe ? DYNRES.backoff : Math.max(s.cooldown, 4) };
  }
  if (s.cooldown > 0) return { ...s, cooldown: s.cooldown - 1, goodWindows: avgMs <= targetMs * DYNRES.onTarget ? s.goodWindows + 1 : 0 };
  const good = avgMs <= targetMs * DYNRES.onTarget ? s.goodWindows + 1 : 0;
  if (good >= DYNRES.probeAfter && s.scale < 1) return { scale: Math.min(1, +(s.scale + DYNRES.step).toFixed(3)), goodWindows: 0, cooldown: 0 };
  return { ...s, goodWindows: good };
}

const TIERS: QualityPreset[] = ['low', 'medium', 'high', 'ultra'];

/**
 * Benchmark verdict from the median frame time of a short run in the menu
 * scene (which is at least as heavy as gameplay's broadcast view): clear
 * headroom moves up a tier, a clear miss moves down, otherwise keep.
 */
export function benchmarkVerdict(guess: QualityPreset, medianMs: number, targetMs: number): QualityPreset {
  const i = TIERS.indexOf(guess);
  if (medianMs < targetMs * 0.6 && i < TIERS.length - 1) return TIERS[i + 1]!;
  if (medianMs > targetMs * 1.35 && i > 0) return TIERS[i - 1]!;
  return guess;
}
