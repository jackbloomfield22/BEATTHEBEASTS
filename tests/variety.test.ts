import { describe, expect, it } from 'vitest';
import { playerVariety, rng, toPosition } from '@/render/players/variety';

describe('player variety', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = playerVariety('WR', 1.85, 90, 'Jerry Rice');
    expect(playerVariety('WR', 1.85, 90, 'Jerry Rice')).toEqual(a);
    const others = ['Randy Moss', 'Terrell Owens', 'Cris Carter', 'Tim Brown'].map((n) => playerVariety('WR', 1.85, 90, n));
    // Twenty-two players should not look alike: at least a few differences in gear.
    const keys = new Set(others.map((v) => JSON.stringify([v.mask, v.visor, v.towel, v.sleeves, v.tape, v.gloveColor, v.sockStripes])));
    expect(keys.size).toBeGreaterThan(2);
  });

  it('dresses positions differently', () => {
    const line = Array.from({ length: 40 }, (_, i) => playerVariety('OL', 1.96, 140, `ol${i}`));
    const wr = Array.from({ length: 40 }, (_, i) => playerVariety('WR', 1.85, 90, `wr${i}`));
    const share = (xs: boolean[]) => xs.filter(Boolean).length / xs.length;
    expect(share(line.map((v) => v.mask === 'cage'))).toBeGreaterThan(0.7);
    expect(share(wr.map((v) => v.mask === 'cage'))).toBe(0);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(line.map((v) => v.morph.pads))).toBeGreaterThan(0.7);
    expect(mean(wr.map((v) => v.morph.pads))).toBeLessThan(-0.4);
    expect(mean(line.map((v) => v.shoulder))).toBeGreaterThan(mean(wr.map((v) => v.shoulder)));
  });

  it('keeps proportions in range', () => {
    for (let i = 0; i < 200; i++) {
      const v = playerVariety(i % 2 ? 'DL' : 'CB', 1.8 + (i % 10) * 0.02, 80 + i, `p${i}`);
      expect(v.arm).toBeGreaterThanOrEqual(0.97);
      expect(v.arm).toBeLessThanOrEqual(1.03);
      expect(Math.abs(v.shoulder)).toBeLessThan(0.02);
      for (const m of Object.values(v.morph)) expect(Math.abs(m)).toBeLessThanOrEqual(1.2);
    }
  });

  it('seeds a uniform stream', () => {
    const r = rng('x');
    const xs = Array.from({ length: 1000 }, r);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(Math.abs(xs.reduce((a, b) => a + b) / 1000 - 0.5)).toBeLessThan(0.05);
  });

  it('maps roster codes', () => {
    expect(toPosition('DT')).toBe('DL');
    expect(toPosition('fs')).toBe('S');
    expect(toPosition('OT')).toBe('OL');
  });
});
