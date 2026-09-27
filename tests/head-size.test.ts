import { describe, expect, it } from 'vitest';
import { BASE_HEIGHT, bodyShape, headScale, HEAD_BASE } from '@/render/players/bodyShape';

// M6.6 (Playtest 1: "player heads are too small"). The built player's head
// (helmet crown to facemask chin) is 0.260 m on a 1.914 m stature, 7.37
// heads (tools/reports/head-size.mjs). A real player in pads and helmet is
// about 7 to 7.5, and helmets vary far less than statures do.

/** The head (m) and heads-tall on the field for a stature, from the measured base (0.260 m head, 0.239 m of it above the head joint). */
function onField(heightM: number) {
  const s = bodyShape(heightM, 100).scale;
  const hs = headScale(s);
  const head = 0.26 * s * hs;
  const stature = (1.914 + 0.239 * (hs - 1)) * s;
  return { head, heads: stature / head };
}

describe('head size', () => {
  it('gives the base body 5% more head: about 7 heads tall', () => {
    expect(headScale(1)).toBeCloseTo(HEAD_BASE);
    expect(onField(BASE_HEIGHT).heads).toBeGreaterThan(6.95);
    expect(onField(BASE_HEIGHT).heads).toBeLessThan(7.15);
  });

  it('keeps helmets close to one real size across the roster (5\'9" to 6\'6")', () => {
    const small = onField(1.753);
    const big = onField(1.98);
    expect(small.head).toBeGreaterThan(0.255);
    expect(big.head).toBeLessThan(0.285);
    // A short back is a little more head than a tall tackle, as in life, and neither is a bobblehead.
    expect(small.heads).toBeLessThan(big.heads);
    expect(small.heads).toBeGreaterThan(6.7);
    expect(big.heads).toBeLessThan(7.35);
  });
});
