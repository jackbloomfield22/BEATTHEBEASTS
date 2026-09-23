import { describe, expect, it } from 'vitest';
import { benchmarkVerdict, DYNRES, stepDynRes, type DynResState } from '@/render/perf/adaptive';

const T = 1000 / 60;
const start: DynResState = { scale: 1, goodWindows: 0, cooldown: 0 };

describe('dynamic resolution', () => {
  it('steps down when frames run long, never below the floor', () => {
    let s = start;
    for (let i = 0; i < 40; i++) s = stepDynRes(s, T * 1.5, T);
    expect(s.scale).toBe(DYNRES.min);
  });

  it('holds while on target, then probes back up', () => {
    let s: DynResState = { scale: 0.8, goodWindows: 0, cooldown: 0 };
    for (let i = 0; i < DYNRES.probeAfter - 1; i++) s = stepDynRes(s, T, T);
    expect(s.scale).toBe(0.8);
    s = stepDynRes(s, T, T);
    expect(s.scale).toBeCloseTo(0.85);
  });

  it('backs off after a failed probe', () => {
    let s: DynResState = { scale: 0.85, goodWindows: 0, cooldown: 0 };
    s = stepDynRes(s, T * 1.3, T); // the probe failed
    expect(s.scale).toBeCloseTo(0.8);
    expect(s.cooldown).toBe(DYNRES.backoff);
    for (let i = 0; i < DYNRES.backoff - 1; i++) s = stepDynRes(s, T, T);
    expect(s.scale).toBeCloseTo(0.8);
  });

  it('never exceeds full scale', () => {
    let s = start;
    for (let i = 0; i < 200; i++) s = stepDynRes(s, T * 0.5, T);
    expect(s.scale).toBe(1);
  });
});

describe('first-launch benchmark', () => {
  it('moves one tier at most, and only with clear evidence', () => {
    expect(benchmarkVerdict('medium', T * 0.4, T)).toBe('high');
    expect(benchmarkVerdict('medium', T * 2, T)).toBe('low');
    expect(benchmarkVerdict('medium', T * 0.9, T)).toBe('medium');
    expect(benchmarkVerdict('ultra', T * 0.2, T)).toBe('ultra');
    expect(benchmarkVerdict('low', T * 3, T)).toBe('low');
  });
});
