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
  return sampleSorted(sorted, speed, scale, { a: sorted[0]!, b: sorted[0]!, w: 0, stride: 0 });
}

/** sampleGait for clips already sorted by speed, written into `out` (no allocation: the animator calls it every frame). */
export function sampleSorted(sorted: readonly GaitClip[], speed: number, scale: number, out: GaitSample): GaitSample {
  const s = Math.max(speed, 0);
  let i = 0;
  while (i < sorted.length - 2 && s > sorted[i + 1]!.speed) i++;
  const a = sorted[i]!;
  const b = sorted[Math.min(i + 1, sorted.length - 1)]!;
  const w = b === a ? 0 : Math.min(1, Math.max(0, (s - a.speed) / (b.speed - a.speed)));
  const strideA = a.speed * a.duration * scale;
  const strideB = b.speed * b.duration * scale;
  out.a = a;
  out.b = b;
  out.w = w;
  out.stride = strideA + (strideB - strideA) * w;
  return out;
}

/**
 * The gait families' shares (M6.5 #11): the receiver's gaits, and the ball
 * carrier's in space, in traffic and in the burst's drive. `carry` is how
 * much he runs like a carrier, `traffic` and `drive` how much of that is the
 * choppy traffic set or the burst's drive (the drive wins over traffic: a
 * burst is the clearing of it). Written into `out` as [base, carry, traffic, drive].
 */
export function familyWeights(carry: number, traffic: number, drive: number, out: number[], left = 0): number[] {
  const c = Math.min(1, Math.max(0, carry));
  const t = Math.min(1, Math.max(0, traffic));
  const d = Math.min(1, Math.max(0, drive));
  // (Passing round 6) The ball's arm: the carrier families' weight shared between the right-arm ones and the left-arm ones (families 4-6).
  const l = Math.min(1, Math.max(0, left));
  out[0] = 1 - c;
  out[1] = c * (1 - t) * (1 - d) * (1 - l);
  out[2] = c * t * (1 - d) * (1 - l);
  out[3] = c * d * (1 - l);
  out[4] = c * (1 - t) * (1 - d) * l;
  out[5] = c * t * (1 - d) * l;
  out[6] = c * d * l;
  return out;
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
function events(duty: number, out: number[]): number[] {
  out[0] = 0;
  out[1] = duty % 1;
  out[2] = 0.5;
  out[3] = (0.5 + duty) % 1;
  return out;
}

/**
 * The events' order around the cycle (walks, with double support, differ from runs, with flight): the indices sorted by
 * event, ties by index, into `idx`; returned as one number (each index a digit) to compare orders.
 * (Round 16: allocation-free, the same order as the sort it replaces; warpPhase runs for every clip with weight every
 * frame, and its arrays and sorts were a tenth of the animator's cost: docs/anim/FEET16.md.)
 */
function order(ev: readonly number[], idx: number[]): number {
  for (let i = 0; i < 4; i++) idx[i] = i;
  // Insertion sort of four by (event, index): a strict order, so the same permutation as any sort.
  for (let i = 1; i < 4; i++) {
    const k = idx[i]!;
    let j = i - 1;
    while (j >= 0 && (ev[idx[j]!]! > ev[k]! || (ev[idx[j]!]! === ev[k]! && idx[j]! > k))) {
      idx[j + 1] = idx[j]!;
      j--;
    }
    idx[j + 1] = k;
  }
  return idx[0]! * 1000 + idx[1]! * 100 + idx[2]! * 10 + idx[3]!;
}
const _evC = [0, 0, 0, 0];
const _evB = [0, 0, 0, 0];
const _idxC = [0, 0, 0, 0];
const _idxB = [0, 0, 0, 0];

/**
 * Warp a shared phase into one clip's own phase so that both clips of a
 * blend plant and lift each foot at the same moment: the blend's events sit
 * at the weighted duty, each clip's at its own, and the phase maps
 * piecewise-linearly between them. Returns the phase unchanged when the two
 * gaits order their events differently (no warp can align those).
 */
export function warpPhase(phase: number, clipDuty: number, blendDuty: number): number {
  const evC = events(clipDuty, _evC);
  const evB = events(blendDuty, _evB);
  if (order(evC, _idxC) !== order(evB, _idxB)) return phase;
  const idx = _idxB;
  for (let k = 0; k < 4; k++) {
    const s0 = evB[idx[k]!]!;
    const s1 = k < 3 ? evB[idx[k + 1]!]! : 1;
    if (phase >= s0 && phase < s1) {
      const span = s1 - s0;
      const t = span > 1e-9 ? (phase - s0) / span : 0;
      const d0 = evC[idx[k]!]!;
      const d1 = k < 3 ? evC[idx[k + 1]!]! : 1;
      return d0 + (d1 - d0) * t;
    }
  }
  return phase;
}
