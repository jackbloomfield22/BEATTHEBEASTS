import { describe, expect, it } from 'vitest';
import { burst, EFFECTS, positionAt, type EffectId } from '@/render/vfx/effects';

describe('vfx bursts', () => {
  it('are deterministic per seed', () => {
    expect(burst('confetti', [0, 20, 0], 42)).toEqual(burst('confetti', [0, 20, 0], 42));
    expect(burst('confetti', [0, 20, 0], 42)).not.toEqual(burst('confetti', [0, 20, 0], 43));
  });

  it('scale the count and never drop to zero', () => {
    expect(burst('turfKick', [0, 0, 0], 1, [0, 0, 0], 0.5).length).toBe(Math.round(EFFECTS.turfKick.count * 0.5));
    expect(burst('breath', [0, 0, 0], 1, [0, 0, 0], 0).length).toBe(1);
  });

  it('launch inside their cone and speed range', () => {
    for (const id of Object.keys(EFFECTS) as EffectId[]) {
      const s = EFFECTS[id];
      for (const p of burst(id, [0, 0, 0], 7)) {
        const sp = Math.hypot(...p.vel);
        if (s.push === 0) {
          expect(sp).toBeGreaterThanOrEqual(s.speed.min - 1e-9);
          expect(sp).toBeLessThanOrEqual(s.speed.max + 1e-9);
          expect(Math.acos(p.vel[1] / sp)).toBeLessThanOrEqual(s.spread + 1e-9);
        }
        expect(p.life).toBeGreaterThanOrEqual(s.life.min);
        expect(p.life).toBeLessThanOrEqual(s.life.max);
      }
    }
  });

  it('closed-form motion: gravity pulls down, drag slows, breath rises', () => {
    const [plug] = burst('turfKick', [0, 0, 0], 3);
    expect(positionAt(plug!, 0)).toEqual(plug!.pos);
    // Turf plugs come back down within a second.
    expect(positionAt(plug!, 1.2)[1]).toBeLessThan(positionAt(plug!, 0.15)[1]);
    const [puff] = burst('breath', [0, 1.8, 0], 3, [0, 0, 1]);
    expect(positionAt(puff!, 1.5)[1]).toBeGreaterThan(1.8);
    expect(positionAt(puff!, 1.5)[2]).toBeGreaterThan(0);
  });

  it('confetti drifts down slowly (paper terminal speed well under 2 m/s)', () => {
    const [c] = burst('confetti', [0, 30, 0], 9);
    const y4 = positionAt(c!, 4)[1];
    const y5 = positionAt(c!, 5)[1];
    expect(y4 - y5).toBeGreaterThan(0);
    expect(y4 - y5).toBeLessThan(EFFECTS.confetti.gravity / EFFECTS.confetti.drag + 0.01);
  });
});
