import { describe, expect, it } from 'vitest';
import { advancePhase, playbackRate, sampleGait, warpPhase, type GaitClip } from '@/anim/blend';

const GAITS: GaitClip[] = [
  { name: 'walk', speed: 1.3, duration: 32 / 30, duty: 0.62 },
  { name: 'jog', speed: 3.5, duration: 22 / 30, duty: 0.36 },
  { name: 'run', speed: 5.8, duration: 20 / 30, duty: 0.24 },
  { name: 'sprint', speed: 8.5, duration: 14 / 30, duty: 0.22 },
];

describe('locomotion blend', () => {
  it('plays a clip alone at its own speed', () => {
    const s = sampleGait(GAITS, 3.5);
    expect(s.a.name === 'jog' ? 1 - s.w : s.w).toBeCloseTo(1);
    expect(playbackRate(s.w > 0.5 ? s.b : s.a, 3.5, s.stride)).toBeCloseTo(1);
  });

  it('blends the two clips that bracket the speed', () => {
    const s = sampleGait(GAITS, 4.65); // halfway between jog and run
    expect([s.a.name, s.b.name]).toEqual(['jog', 'run']);
    expect(s.w).toBeCloseTo(0.5);
  });

  it('clamps outside the authored range', () => {
    expect(sampleGait(GAITS, 0.4).w).toBe(0);
    expect(sampleGait(GAITS, 0.4).a.name).toBe('walk');
    const top = sampleGait(GAITS, 11);
    expect(top.b.name).toBe('sprint');
    expect(top.w).toBe(1);
  });

  it('matches stride so the feet cover exactly the ground speed', () => {
    // Over one full cycle the body travels exactly one stride.
    const s = sampleGait(GAITS, 5.8);
    let phase = 0;
    const dt = 1 / 60;
    let steps = 0;
    for (;;) {
      steps++;
      const next = advancePhase(phase, 5.8, dt, s.stride);
      if (next < phase) break; // wrapped: one full cycle done
      phase = next;
    }
    const dist = steps * 5.8 * dt;
    expect(Math.abs(dist - s.stride)).toBeLessThanOrEqual(5.8 * dt);
  });

  it('scales stride with body size', () => {
    const base = sampleGait(GAITS, 3.5, 1).stride;
    expect(sampleGait(GAITS, 3.5, 0.93).stride).toBeCloseTo(base * 0.93);
  });

  it('wraps the phase', () => {
    expect(advancePhase(0.95, 5, 0.1, 1)).toBeCloseTo(0.45);
  });

  it('warps phases so blended clips plant and lift together', () => {
    const D = 0.3; // blend of a 0.36 and a 0.24 duty gait
    // Lift-off of the left foot: the blend's event maps onto each clip's own.
    expect(warpPhase(D, 0.36, D)).toBeCloseTo(0.36);
    expect(warpPhase(D, 0.24, D)).toBeCloseTo(0.24);
    // Touch-downs stay put, and the map is monotonic.
    expect(warpPhase(0, 0.36, D)).toBeCloseTo(0);
    expect(warpPhase(0.5, 0.36, D)).toBeCloseTo(0.5);
    let prev = -1;
    for (let p = 0; p < 1; p += 0.01) {
      const w = warpPhase(p, 0.36, D);
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
  });

  it('leaves the phase alone across the walk/run boundary (event orders differ)', () => {
    expect(warpPhase(0.3, 0.62, 0.4)).toBe(0.3);
  });
});
