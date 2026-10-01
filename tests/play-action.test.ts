import { describe, expect, it } from 'vitest';
import { bite } from '../tools/sim/pabite';

// Playtest 2: play action readable after the snap. Zone linebackers come
// downhill on the fake (none do on a straight drop-back), and how far is
// theirs: a 60 Play Recognition linebacker bites harder than a 95.

describe('play action: the linebackers bite (Playtest 2)', () => {
  it('zone linebackers step up on the fake and not on a drop-back', () => {
    const pa = bite('singleback-pa-post', undefined, 2);
    expect(pa.step).toBeGreaterThan(1);
    expect(pa.bite).toBeGreaterThan(0.6);
    expect(bite('doubles-smash', undefined, 2).step).toBeLessThan(0.2);
  });
  it('Play Recognition decides how far: a 60 comes up further than a 95', () => {
    expect(bite('iform-pa-deep-shot', 60, 2).step - bite('iform-pa-deep-shot', 95, 2).step).toBeGreaterThan(0.2);
  });
});
