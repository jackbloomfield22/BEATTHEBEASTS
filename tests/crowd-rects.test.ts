import { describe, expect, it } from 'vitest';
import { CARD_H, CARD_W, DIRS, PHONE_AT, POSES, cellRects } from '@/render/crowd/spectator';

describe('crowd card bounds', () => {
  const rects = cellRects();
  it('has one rect per atlas cell, inside the card', () => {
    expect(rects).toHaveLength(POSES * DIRS);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(-CARD_W / 2);
      expect(r.z).toBeLessThanOrEqual(CARD_W / 2);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.w).toBeLessThanOrEqual(CARD_H);
      expect(r.z).toBeGreaterThan(r.x);
      expect(r.w).toBeGreaterThan(r.y);
    }
  });
  it('covers the phone flash in every cell', () => {
    rects.forEach((r, i) => {
      const [px, py] = PHONE_AT[Math.floor(i / DIRS)]!;
      expect(px).toBeGreaterThan(r.x);
      expect(px).toBeLessThan(r.z);
      expect(py).toBeGreaterThan(r.y);
      expect(py).toBeLessThan(r.w);
    });
  });
  it('shrinks the seated cards to well under half the full card', () => {
    const area = (i: number) => ((rects[i]!.z - rects[i]!.x) * (rects[i]!.w - rects[i]!.y)) / (CARD_W * CARD_H);
    const seated = Array.from({ length: DIRS }, (_, d) => area(d));
    const mean = seated.reduce((a, b) => a + b, 0) / DIRS;
    expect(mean).toBeLessThan(0.45);
  });
});
