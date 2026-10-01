import { describe, expect, it } from 'vitest';
import { afterSnap, emptyFatigue, fatigueOf, freshLegs, type DriveFatigue, type Snap } from '@/game/fatigue';

// Stamina through a drive (src/game/fatigue.ts): a play's exertion mostly
// comes back in the huddle, the carries build up over the drive, the traits
// that read it (Workhorse, Change of Pace, Volume Passer), and the sideline resets it.

const snap = (o: Partial<Snap> = {}): Snap => ({ id: 'rb', start: 1, end: 1, staminaAttr: 0.5, touched: false, dropback: false, traits: [], hit: 0, ...o });
const drive = (n: number, o: Partial<Snap>) => {
  let f: DriveFatigue = emptyFatigue();
  for (let k = 0; k < n; k++) f = afterSnap(f, [snap(o)], false);
  return f;
};

describe('stamina through a drive', () => {
  it('a sprint mostly comes back in the huddle, less of it for a high Stamina rating', () => {
    const avg = afterSnap(emptyFatigue(), [snap({ end: 0.8 })], false);
    const iron = afterSnap(emptyFatigue(), [snap({ end: 0.8, staminaAttr: 0.99 })], false);
    expect(fatigueOf(avg, 'rb')).toBeGreaterThan(0.07);
    expect(fatigueOf(avg, 'rb')).toBeLessThan(0.12);
    expect(fatigueOf(iron, 'rb')).toBeLessThan(fatigueOf(avg, 'rb') - 0.02);
    // A few quiet snaps later it's gone.
    let f = avg;
    for (let k = 0; k < 4; k++) f = afterSnap(f, [snap()], false);
    expect(fatigueOf(f, 'rb')).toBeLessThan(0.01);
  });
  it('the carries build up over a long drive; a Workhorse carries half of it', () => {
    const back = fatigueOf(drive(10, { touched: true }), 'rb');
    expect(back).toBeGreaterThan(0.15);
    expect(back).toBeLessThan(0.3);
    expect(fatigueOf(drive(10, { touched: true, traits: ['workhorse'] }), 'rb')).toBeCloseTo(back / 2, 2);
  });
  it('Change of Pace: fresh legs his first two touches of the drive, then the carries cost him more', () => {
    const t = ['committee-back'];
    expect(freshLegs(emptyFatigue(), 'rb', t)).toBe(true);
    expect(freshLegs(drive(1, { touched: true, traits: t }), 'rb', t)).toBe(true);
    expect(freshLegs(drive(2, { touched: true, traits: t }), 'rb', t)).toBe(false);
    expect(freshLegs(emptyFatigue(), 'rb', [])).toBe(false);
    expect(fatigueOf(drive(8, { touched: true, traits: t }), 'rb')).toBeGreaterThan(fatigueOf(drive(8, { touched: true }), 'rb'));
  });
  it('a Volume Passer never wears down over the drive; another quarterback does a little', () => {
    expect(fatigueOf(drive(12, { id: 'qb', dropback: true }), 'qb')).toBeGreaterThan(0.04);
    expect(fatigueOf(drive(12, { id: 'qb', dropback: true, traits: ['volume-passer'] }), 'qb')).toBe(0);
  });
  it("a big hit's toll stays with him, and a new series starts everyone fresh", () => {
    const f = afterSnap(emptyFatigue(), [snap({ hit: 0.3 })], false);
    expect(fatigueOf(f, 'rb')).toBeCloseTo(0.3, 5);
    expect(fatigueOf(afterSnap(drive(10, { touched: true }), [snap()], true), 'rb')).toBe(0);
  });
});
