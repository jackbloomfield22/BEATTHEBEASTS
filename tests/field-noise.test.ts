import { describe, expect, it } from 'vitest';
import { fieldNoiseUniforms } from '@/render/field/fieldNoise';

describe('baked turf noise', () => {
  const t0 = performance.now();
  const u = fieldNoiseUniforms();
  const ms = performance.now() - t0;

  it('bakes quickly enough for startup', () => {
    expect(ms).toBeLessThan(1500);
  });

  it('spans a useful range like the shader fbm (0..~0.94)', () => {
    for (const tex of [u.uFieldNoise.value, u.uTurfNoise.value]) {
      const d = tex.image.data as Uint8Array;
      let lo = 255;
      let hi = 0;
      for (let i = 0; i < d.length; i += 4) {
        lo = Math.min(lo, d[i]!);
        hi = Math.max(hi, d[i]!);
      }
      expect(lo).toBeLessThan(90);
      expect(hi).toBeGreaterThan(160);
      expect(hi).toBeLessThanOrEqual(245);
    }
  });

  it('tiles the fine turf seamlessly', () => {
    const tex = u.uTurfNoise.value;
    const { width: n } = tex.image;
    const d = tex.image.data as Uint8Array;
    // Neighbours across the wrap differ no more than neighbours inside the tile.
    let across = 0;
    let inside = 0;
    for (let j = 0; j < n; j++) {
      for (const c of [0, 1]) {
        across = Math.max(across, Math.abs(d[(j * n + (n - 1)) * 4 + c]! - d[(j * n) * 4 + c]!));
        inside = Math.max(inside, Math.abs(d[(j * n + n / 2) * 4 + c]! - d[(j * n + n / 2 - 1) * 4 + c]!));
      }
    }
    expect(across).toBeLessThanOrEqual(inside + 2);
  });
});
