import { describe, expect, it } from 'vitest';
import { kickFlight, legSpeed } from '@/game/kick';

const calm = { mph: 0, dir: 0 };

describe('kick (GDD §9.6)', () => {
  it('a perfect strike clears the bar out to the kicker’s range and not beyond', () => {
    expect(kickFlight({ distance: 55, power: 1, aim: 0, range: 56, wind: calm }).good).toBe(true);
    expect(kickFlight({ distance: 58, power: 1, aim: 0, range: 56, wind: calm }).why).toBe('short');
    expect(legSpeed(56)).toBeGreaterThan(20);
  });
  it('a PAT is easy; aim decides left and right', () => {
    expect(kickFlight({ distance: 33, power: 0.8, aim: 0, range: 56, wind: calm }).good).toBe(true);
    expect(kickFlight({ distance: 33, power: 0.8, aim: 0.15, range: 56, wind: calm }).why).toBe('wideLeft');
    expect(kickFlight({ distance: 33, power: 0.8, aim: -0.15, range: 56, wind: calm }).why).toBe('wideRight');
  });
  it('wind bends it: a 12 mph crosswind moves a 45-yarder about 2 yards; a headwind costs range', () => {
    const still = kickFlight({ distance: 45, power: 0.95, aim: 0, range: 56, wind: calm });
    const cross = kickFlight({ distance: 45, power: 0.95, aim: 0, range: 56, wind: { mph: 12, dir: Math.PI / 2 } });
    expect(cross.y - still.y).toBeGreaterThan(1.2);
    expect(cross.y - still.y).toBeLessThan(3.5);
    expect(kickFlight({ distance: 54, power: 1, aim: 0, range: 56, wind: { mph: 12, dir: Math.PI } }).why).toBe('short');
  });
  it('is deterministic', () => {
    const k = { distance: 47, power: 0.97, aim: 0.02, range: 56, wind: { mph: 7, dir: 1 } };
    expect(kickFlight(k)).toEqual(kickFlight(k));
  });
});
