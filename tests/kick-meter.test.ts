import { describe, expect, it } from 'vitest';
import { aimFor, kickFlight, powerNeeded, puntFlight } from '@/game/kick';
import { AIM_MAX, AIM_RATE, KickControl, MAX_HOLD_MS, METER, METER_MAX, powerAt, strikeFrom, WINDOW_HI, WINDOW_LO, windowAt } from '@/game/kickMeter';
import { createMatch, KICKER_RANGE, resolvePunt, SIDELINE } from '@/game/match';

// M6.6 kicking (Playtest 2): aim, then hold to charge and release inside a
// moving accuracy window; PATs, field goals and punts. Timed from the input
// events, never the frames.

const pro = METER.pro;
const calm = { mph: 0, dir: 0 };

describe('kick meter', () => {
  it('power fills linearly to the leg and on to overcooked; the window rides up and down the meter', () => {
    expect(powerAt(0, pro)).toBe(0);
    expect(powerAt(pro.fillMs / 2, pro)).toBeCloseTo(0.5);
    expect(powerAt(pro.fillMs, pro)).toBeCloseTo(1);
    expect(powerAt(10_000, pro)).toBe(METER_MAX);
    expect(windowAt(0, pro)).toBeCloseTo(WINDOW_LO);
    expect(windowAt(500 / pro.hz, pro)).toBeCloseTo(WINDOW_HI);
    expect(windowAt(1000 / pro.hz, pro)).toBeCloseTo(WINDOW_LO);
  });

  it('release inside the window is clean; early hooks it left, late pushes it right, more the farther out', () => {
    // At the top of its travel the window sits still for a moment (at WINDOW_HI).
    const top = 500 / pro.hz;
    const clean = strikeFrom({ pressAt: top - WINDOW_HI * pro.fillMs, releaseAt: top, windowFrom: 0, tuning: pro });
    expect(clean.clean).toBe(true);
    expect(Math.abs(clean.error)).toBeLessThan(0.002);
    expect(clean.power).toBeCloseTo(WINDOW_HI, 5);
    // Not enough hold when it's up there: under the window, hooked left (+).
    const early = strikeFrom({ pressAt: top - 0.85 * pro.fillMs, releaseAt: top, windowFrom: 0, tuning: pro });
    expect(early.clean).toBe(false);
    expect(early.off).toBeLessThan(0);
    expect(early.error).toBeGreaterThan(0.02);
    // At the bottom of its travel, a long hold is over it: pushed right (−), and a bigger miss costs more.
    const bottom = 1000 / pro.hz;
    const late = strikeFrom({ pressAt: bottom - 0.9 * pro.fillMs, releaseAt: bottom, windowFrom: 0, tuning: pro });
    expect(late.off).toBeGreaterThan(0);
    expect(late.error).toBeLessThan(-Math.abs(early.error));
  });

  it('is timed from the press and release events, not the frames: a tap between two frames counts as held', () => {
    const run = (frameMs: number) => {
      const k = new KickControl('FG', pro, 0);
      const pressAt = 1000.4;
      const releaseAt = 1006.1; // a 5.7 ms tap: no frame ever saw it held
      let struck = null;
      for (let now = 0; now < 1100; now += frameMs) {
        if (now >= pressAt && k.phase === 'aim') k.press(pressAt);
        if (now >= releaseAt && !struck) struck = k.release(releaseAt);
        k.frame(now);
      }
      return struck;
    };
    const a = run(1000 / 60);
    const b = run(1000 / 24); // a slow machine
    expect(a).not.toBeNull();
    expect(a!.heldMs).toBeCloseTo(5.7, 6);
    expect(b).toEqual(a);
  });

  it('a press left over from the card before (the A that chose the kick) does not start the charge', () => {
    const k = new KickControl('PAT', pro, 5000);
    expect(k.press(4990)).toBe(false);
    expect(k.release(5010)).toBeNull();
    expect(k.phase).toBe('aim');
    expect(k.press(5100)).toBe(true);
  });

  it('holding forever kicks it at the cap, overcooked', () => {
    const k = new KickControl('FG', pro, 0);
    k.press(100);
    expect(k.frame(100 + MAX_HOLD_MS - 1)).toBeNull();
    const s = k.frame(100 + MAX_HOLD_MS + 250);
    expect(s!.heldMs).toBe(MAX_HOLD_MS);
    expect(s!.power).toBe(METER_MAX);
  });

  it('aim: the keys move it at AIM_RATE, it stops at the edge, and it locks once the charge starts', () => {
    const k = new KickControl('FG', pro, 0);
    k.steer(1, 0.1);
    expect(k.aim).toBeCloseTo(AIM_RATE * 0.1);
    k.steer(-1, 50);
    expect(k.aim).toBe(-AIM_MAX.FG);
    k.steer(0, 0, 0.05);
    const locked = k.aim;
    k.press(10);
    k.steer(1, 1);
    expect(k.aim).toBe(locked);
    // A punt can aim further out, for the sideline.
    expect(AIM_MAX.PUNT).toBeGreaterThan(AIM_MAX.FG);
  });

  it('in the kick: aim into the wind and a clean strike with enough leg goes through; a hook from 45 misses left', () => {
    const wind = { mph: 12, dir: Math.PI / 2 }; // blowing toward +y: the kicker's left
    const need = powerNeeded({ distance: 45, range: KICKER_RANGE.pro, wind });
    expect(need).toBeLessThan(1);
    const power = Math.min(1, need + 0.05);
    const aim = aimFor({ distance: 45, power, range: KICKER_RANGE.pro, wind });
    expect(aim).toBeLessThan(0); // the wind pushes it left, so he aims right of center
    expect(kickFlight({ distance: 45, power, aim, range: KICKER_RANGE.pro, wind }).good).toBe(true);
    // Aimed straight, the same wind drifts it ~2 yd left by the posts (two-thirds of the way to the upright).
    expect(kickFlight({ distance: 45, power, aim: 0, range: KICKER_RANGE.pro, wind }).y).toBeGreaterThan(1.2);
    // Enough leg but released with the window low (late): pushed wide right from 45, however well it was aimed.
    const bottom = 1000 / pro.hz;
    const push = strikeFrom({ pressAt: bottom - 0.95 * pro.fillMs, releaseAt: bottom, windowFrom: 0, tuning: pro });
    expect(push.off).toBeGreaterThan(0.3);
    expect(kickFlight({ distance: 45, power: push.power, aim: aimFor({ distance: 45, power: push.power, range: KICKER_RANGE.pro, wind: calm }) + push.error, range: KICKER_RANGE.pro, wind: calm }).why).toBe('wideRight');
    // A PAT forgives a small miss (just under the window at the top).
    const top = 500 / pro.hz;
    const small = strikeFrom({ pressAt: top - 0.9 * pro.fillMs, releaseAt: top, windowFrom: 0, tuning: pro });
    expect(small.clean).toBe(false);
    expect(kickFlight({ distance: 33, power: small.power, aim: small.error, range: KICKER_RANGE.pro, wind: calm }).good).toBe(true);
  });

  it('punts: power is distance, aim for the sideline puts it out of bounds (no return), a line drive gets returned', () => {
    const m = createMatch({ drives: 6, quarterSecs: 300, seed: 4, beastsRating: 93, diffAdj: 0, kickerRange: KICKER_RANGE.pro });
    m.sit = { los: 45, ballY: 0, down: 4, toGo: 8 };
    const long = puntFlight({ power: 1, aim: 0, wind: calm, y0: 0, halfWidth: SIDELINE });
    const short = puntFlight({ power: 0.8, aim: 0, wind: calm, y0: 0, halfWidth: SIDELINE });
    expect(long.carry).toBeGreaterThan(short.carry + 10);
    expect(long.hang).toBeGreaterThan(4);
    const corner = puntFlight({ power: 0.95, aim: AIM_MAX.PUNT, wind: calm, y0: 0, halfWidth: SIDELINE });
    expect(corner.out).toBe(true);
    const r = resolvePunt(m, corner);
    expect(r.how).toBe('outOfBounds');
    expect(r.ret).toBe(0);
    // Into the end zone from midfield with the full leg: a touchback, their 20.
    m.sit = { los: 70, ballY: 0, down: 4, toGo: 8 };
    const tb = resolvePunt(m, long);
    expect(tb.how).toBe('touchback');
    expect(tb.beastsStart).toBe(20);
    for (const v of [r.gross, r.net, tb.gross, tb.net]) expect(Number.isInteger(v)).toBe(true);
  });
});
