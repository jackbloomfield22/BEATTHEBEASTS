// VFX effect presets and burst generation: pure data and a seeded stream, so
// every burst is reproducible (replays, screenshots) and testable without a
// GPU. The particle pool (particles.ts) uploads what `burst` returns; the
// motion itself runs in the vertex shader from the spawn state.

export type EffectId = 'turfKick' | 'hitDust' | 'confetti' | 'pyro' | 'breath';

export interface Particle {
  pos: [number, number, number];
  vel: [number, number, number];
  life: number; // s
  size: [number, number]; // start, end (m)
  color: [number, number, number]; // linear
  alpha: number;
  gravity: number; // m/s² (negative = rises, e.g. warm breath)
  drag: number; // 1/s, exponential
  spin: number; // rad/s (confetti flutter)
  emissive: number; // 0 lit, 1 self-lit (sparks)
}

interface Range {
  min: number;
  max: number;
}
const R = (min: number, max: number): Range => ({ min, max });

export interface EffectSpec {
  count: number;
  /** Cone around +y (radians) and speed of launch. */
  spread: number;
  speed: Range;
  /** Launch bias along the burst's `dir` (e.g. a cleat's push-off). */
  push: number;
  jitter: number; // spawn radius (m)
  life: Range;
  size: [Range, Range];
  colors: [number, number, number][];
  alpha: number;
  gravity: number;
  drag: number;
  spin: Range;
  emissive: number;
}

/**
 * Presets. Physical ranges where they matter: turf plugs and sand leave a
 * cleat at ~2-4 m/s; confetti falls at ~0.3-1 m/s (paper flutters, so heavy
 * drag); pyro sparks travel a few meters and burn out in ~1 s; exhaled
 * breath (~0.5 L) leaves at ~1 m/s and dissipates in ~1.5 s.
 */
export const EFFECTS: Record<EffectId, EffectSpec> = {
  turfKick: {
    count: 26, spread: 0.7, speed: R(1.8, 4.2), push: 0.6, jitter: 0.08, life: R(0.5, 0.9),
    size: [R(0.015, 0.035), R(0.01, 0.025)],
    colors: [[0.05, 0.15, 0.03], [0.08, 0.2, 0.04], [0.2, 0.15, 0.08]], // grass plugs and root-zone sand
    alpha: 1, gravity: 9.81, drag: 1.2, spin: R(-12, 12), emissive: 0,
  },
  hitDust: {
    count: 18, spread: 1.3, speed: R(0.4, 1.4), push: 0, jitter: 0.3, life: R(0.8, 1.6),
    size: [R(0.12, 0.25), R(0.5, 0.9)],
    colors: [[0.32, 0.3, 0.24], [0.36, 0.33, 0.26]],
    alpha: 0.28, gravity: 0.3, drag: 2.2, spin: R(-1, 1), emissive: 0,
  },
  confetti: {
    count: 900, spread: 0.5, speed: R(8, 16), push: 0, jitter: 1.5, life: R(5, 8),
    size: [R(0.035, 0.05), R(0.035, 0.05)],
    colors: [[0.45, 0.03, 0.05], [0.9, 0.9, 0.88], [0.02, 0.02, 0.02], [0.4, 0.85, 0.03]], // crimson, white, black, lime
    alpha: 1, gravity: 9.81, drag: 2.6, spin: R(-18, 18), emissive: 0,
  },
  pyro: {
    count: 260, spread: 0.35, speed: R(9, 16), push: 0, jitter: 0.2, life: R(0.6, 1.2),
    size: [R(0.06, 0.1), R(0.01, 0.02)],
    colors: [[1, 0.55, 0.18], [1, 0.8, 0.4]],
    alpha: 1, gravity: 9.81, drag: 1.6, spin: R(0, 0), emissive: 1,
  },
  breath: {
    count: 10, spread: 0.35, speed: R(0.6, 1.2), push: 0.9, jitter: 0.02, life: R(1.0, 1.8),
    size: [R(0.04, 0.07), R(0.3, 0.5)],
    colors: [[0.75, 0.77, 0.8]],
    alpha: 0.18, gravity: -0.15, drag: 1.8, spin: R(-0.5, 0.5), emissive: 0,
  },
};

/** Tiny seeded PRNG (mulberry32): the same seed gives the same burst. */
function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A burst of `id` at `pos`, launched around +y and pushed along `dir`
 * (normalized; e.g. a cleat's plant direction or a breath's facing).
 * `scale` multiplies the particle count (quality tiers, crowd energy).
 */
export function burst(id: EffectId, pos: [number, number, number], seed: number, dir: [number, number, number] = [0, 0, 0], scale = 1): Particle[] {
  const s = EFFECTS[id];
  const rnd = stream(seed);
  const pick = (r: Range) => r.min + (r.max - r.min) * rnd();
  const n = Math.max(1, Math.round(s.count * scale));
  const out: Particle[] = [];
  for (let i = 0; i < n; i++) {
    // Uniform direction in a cone of half-angle `spread` around +y.
    const cosT = 1 - rnd() * (1 - Math.cos(s.spread));
    const sinT = Math.sqrt(1 - cosT * cosT);
    const ph = rnd() * Math.PI * 2;
    const sp = pick(s.speed);
    const v: [number, number, number] = [sinT * Math.cos(ph) * sp + dir[0] * s.push * sp, cosT * sp + dir[1] * s.push * sp, sinT * Math.sin(ph) * sp + dir[2] * s.push * sp];
    const ja = rnd() * Math.PI * 2;
    const jr = Math.sqrt(rnd()) * s.jitter;
    out.push({
      pos: [pos[0] + Math.cos(ja) * jr, pos[1], pos[2] + Math.sin(ja) * jr],
      vel: v,
      life: pick(s.life),
      size: [pick(s.size[0]), pick(s.size[1])],
      color: s.colors[Math.floor(rnd() * s.colors.length)]!,
      alpha: s.alpha,
      gravity: s.gravity,
      drag: s.drag,
      spin: pick(s.spin),
      emissive: s.emissive,
    });
  }
  return out;
}

/**
 * Closed-form motion with exponential drag k and gravity g (what the vertex
 * shader evaluates): v(t) = v0·e^(−kt) − (g/k)(1 − e^(−kt)) ŷ, integrated.
 */
export function positionAt(p: Particle, t: number): [number, number, number] {
  const k = Math.max(p.drag, 1e-4);
  const e = Math.exp(-k * t);
  const f = (1 - e) / k; // ∫ e^(−kt)
  const gy = (p.gravity / k) * (t - f);
  return [p.pos[0] + p.vel[0] * f, p.pos[1] + p.vel[1] * f - gy, p.pos[2] + p.vel[2] * f];
}
