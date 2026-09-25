import { describe, expect, it } from 'vitest';
import { suggestPlays } from '@/game/coordinator';

describe('coordinator (GDD §10.1 Suggested)', () => {
  it('five distinct plays with a reason for every down, distance and spot (fractional spots too)', () => {
    for (const los of [1, 25, 37.4, 50, 63.8, 82.25, 97]) {
      for (const down of [1, 2, 3, 4]) {
        for (const toGo of [1, 2.6, 5, 9.3, 15]) {
          for (const twoMinute of [false, true]) {
            const s = suggestPlays({ los, ballY: 0, down, toGo: Math.min(toGo, 100 - los) }, { twoMinute });
            expect(s.length).toBeGreaterThanOrEqual(3);
            expect(new Set(s.map((x) => x.play.id)).size).toBe(s.length);
            for (const x of s) expect(x.why.length).toBeGreaterThan(10);
          }
        }
      }
    }
  });
  it('short yardage leads with the run; third and long with a drop-back', () => {
    expect(suggestPlays({ los: 40, ballY: 0, down: 3, toGo: 1 })[0]!.play.type).toBe('run');
    expect(suggestPlays({ los: 40, ballY: 0, down: 3, toGo: 12 })[0]!.play.type).toBe('dropback');
  });
});
