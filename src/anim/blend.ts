// Locomotion blending (TECH_PLAN §9.2), pure logic.
//
// The locomotion clips are in-place cycles, each authored at one speed with
// a stride (distance covered per cycle = speed × duration). A player moving
// at speed v plays the two clips that bracket v, weighted by where v falls
// between their speeds, on ONE shared phase (0..1 through the cycle), so both
// clips put the same foot down at the same moment. The phase advances by
// distance: dφ = v·dt / stride(v), with the stride interpolated between the
// clips and scaled by the player's size. That is stride matching: the feet
// move backward at exactly the ground speed, so they don't slide.

export interface GaitClip {
  name: string;
  speed: number; // m/s the clip was authored at
  duration: number; // s per cycle
  /** Share of the cycle each foot is planted (the left plants at phase 0, the right at 0.5). */
  duty: number;
}

export interface GaitSample {
  a: GaitClip;
  b: GaitClip;
  /** Weight of `b` (0..1); `a` gets 1 - w. */
  w: number;
  /** Stride length (m per cycle) at this speed and body scale. */
  stride: number;
}

/** Below this the player stands (idle stance) instead of walking. */
export const MIN_LOCO_SPEED = 0.25;

export function sampleGait(gaits: readonly GaitClip[], speed: number, scale = 1): GaitSample {
  const sorted = [...gaits].sort((x, y) => x.speed - y.speed);
  const s = Math.max(speed, 0);
  let i = 0;
  while (i < sorted.length - 2 && s > sorted[i + 1]!.speed) i++;
  const a = sorted[i]!;
  const b = sorted[Math.min(i + 1, sorted.length - 1)]!;
  const w = b === a ? 0 : Math.min(1, Math.max(0, (s - a.speed) / (b.speed - a.speed)));
  const strideA = a.speed * a.duration * scale;
  const strideB = b.speed * b.duration * scale;
  return { a, b, w, stride: strideA + (strideB - strideA) * w };
}

/** Advance the shared phase by the distance travelled. */
export function advancePhase(phase: number, speed: number, dt: number, stride: number): number {
  if (stride <= 1e-6) return phase;
  const p = phase + (Math.max(speed, 0) * dt) / stride;
  return p - Math.floor(p);
}

/**
 * Speed a clip plays back at, as a multiple of its authored rate, when driven
 * by the shared phase at ground speed v (for display and sanity checks).
 */
export function playbackRate(clip: GaitClip, speed: number, stride: number): number {
  return stride > 1e-6 ? (speed / stride) * clip.duration : 0;
}

/** The four foot events of a cycle: left down, left up, right down, right up. */
function events(duty: number): number[] {
  return [0, duty % 1, 0.5, (0.5 + duty) % 1];
}

/** Event order around the cycle (walks, with double support, differ from runs, with flight). */
function order(duty: number): string {
  const e = events(duty);
  return e
    .map((t, i) => [t, i] as const)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .map((x) => x[1])
    .join('');
}

/**
 * Warp a shared phase into one clip's own phase so that both clips of a
 * blend plant and lift each foot at the same moment: the blend's events sit
 * at the weighted duty, each clip's at its own, and the phase maps
 * piecewise-linearly between them. Returns the phase unchanged when the two
 * gaits order their events differently (no warp can align those).
 */
export function warpPhase(phase: number, clipDuty: number, blendDuty: number): number {
  if (order(clipDuty) !== order(blendDuty)) return phase;
  const idx = [0, 1, 2, 3].sort((a, b) => events(blendDuty)[a]! - events(blendDuty)[b]! || a - b);
  const src = [...idx.map((i) => events(blendDuty)[i]!), 1];
  const dst = [...idx.map((i) => events(clipDuty)[i]!), 1];
  for (let k = 0; k < 4; k++) {
    if (phase >= src[k]! && phase < src[k + 1]!) {
      const span = src[k + 1]! - src[k]!;
      const t = span > 1e-9 ? (phase - src[k]!) / span : 0;
      return dst[k]! + (dst[k + 1]! - dst[k]!) * t;
    }
  }
  return phase;
}
