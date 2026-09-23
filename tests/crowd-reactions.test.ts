import { describe, expect, it } from 'vitest';
import { CrowdEnergy, REACTIONS } from '@/render/crowd/reactions';

describe('crowd reactions', () => {
  it('sits at ambient until something happens', () => {
    const c = new CrowdEnergy(0.3);
    expect(c.value(0)).toBe(0.3);
    expect(c.value(1000)).toBe(0.3);
  });

  it('a touchdown lifts the bowl to its peak, holds, and settles back', () => {
    const c = new CrowdEnergy(0.3);
    c.trigger('touchdown', 10);
    expect(c.value(10)).toBeCloseTo(0.3);
    expect(c.value(10.2)).toBeGreaterThan(0.5);
    expect(c.value(10.5)).toBeCloseTo(REACTIONS.touchdown.peak);
    expect(c.value(13.9)).toBeCloseTo(REACTIONS.touchdown.peak);
    const mid = c.value(10 + 4 + 3);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(1);
    expect(c.value(10 + 4 + 6.01)).toBeCloseTo(0.3);
  });

  it('a groan sits the crowd down below ambient', () => {
    const c = new CrowdEnergy(0.3);
    c.trigger('groan', 0);
    expect(c.value(1)).toBeLessThan(0.15);
    expect(c.value(10)).toBeCloseTo(0.3);
  });

  it('a new event replaces the one in progress', () => {
    const c = new CrowdEnergy(0.3);
    c.trigger('groan', 0);
    c.trigger('touchdown', 1);
    expect(c.value(2)).toBeCloseTo(1);
  });

  it('is monotone non-increasing after the hold', () => {
    const c = new CrowdEnergy(0.3);
    c.trigger('bigPlay', 0);
    let prev = Infinity;
    for (let t = REACTIONS.bigPlay.hold; t < 8; t += 0.1) {
      const v = c.value(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-12);
      prev = v;
    }
  });
});
