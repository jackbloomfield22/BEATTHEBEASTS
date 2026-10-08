import { describe, expect, it } from 'vitest';
import { GLYPH_CHARS, downsampleField, jerseyName, layoutText, sdfFromCoverage } from '@/render/players/glyphs';

describe('jersey glyphs', () => {
  it('builds a signed distance field with the edge at 128', () => {
    // A 5-px-wide vertical bar in a 21x9 image.
    const w = 21;
    const h = 9;
    const cov = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 8; x < 13; x++) cov[y * w + x] = 255;
    const sdf = sdfFromCoverage(cov, w, h, 4);
    const row = Array.from(sdf.slice(4 * w, 5 * w));
    // Center of the bar is 2.5 px inside, far outside is clamped.
    expect(row[10]).toBeGreaterThan(128 + 2 * (127 / 4) - 1);
    expect(row[0]).toBe(0);
    // Edge pixels straddle 128 symmetrically.
    expect(row[8]! - 128).toBeCloseTo(128 - row[7]!, 0);
    // Monotonic toward the center.
    for (let x = 1; x <= 10; x++) expect(row[x]).toBeGreaterThanOrEqual(row[x - 1]!);
  });

  it('keeps sub-texel edges when built supersampled and box-filtered down (round two)', () => {
    // A bar whose edge sits at x = 10.25 texels: at 4x it is exact, and the
    // filtered field crosses 128 a quarter of the way into texel 10.
    const ss = 4;
    const w = 24 * ss;
    const h = 4 * ss;
    const cov = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 41; x < w; x++) cov[y * w + x] = 255;
    const lo = downsampleField(sdfFromCoverage(cov, w, h, 4 * ss), w, h, ss);
    expect(lo.length).toBe(24 * 4);
    const row = Array.from(lo.slice(24, 48));
    // Interpolating the field between texel centres 9.5 and 10.5 puts the edge at ~10.25.
    const edge = 9.5 + (128 - row[9]!) / (row[10]! - row[9]!);
    expect(edge).toBeGreaterThan(10.1);
    expect(edge).toBeLessThan(10.4);
  });

  it('lays out text with advances and pads empty slots', () => {
    const metrics = GLYPH_CHARS.split('').map((c) => ({ advance: c === '1' ? 0.4 : 0.6 }));
    const l = layoutText('81', metrics, 2);
    expect(l.index).toEqual([8, 1]);
    expect(l.x).toEqual([0, 0.6]);
    expect(l.width).toBeCloseTo(1.0);
    const n = layoutText('rice', metrics, 6, 0.1);
    expect(n.index.slice(0, 4)).toEqual(['R', 'I', 'C', 'E'].map((c) => GLYPH_CHARS.indexOf(c)));
    expect(n.index.slice(4)).toEqual([-1, -1]);
    expect(n.width).toBeCloseTo(4 * 0.6 + 3 * 0.1);
  });

  it('drops characters the atlas lacks and caps at the slot count', () => {
    const metrics = GLYPH_CHARS.split('').map(() => ({ advance: 0.5 }));
    expect(layoutText('#9', metrics, 2).index).toEqual([9, -1]);
    expect(layoutText('Muñoz', metrics, 5).index).toEqual([...'MUNOZ'].map((c) => GLYPH_CHARS.indexOf(c)));
    expect(layoutText('ABCDEFG', metrics, 3).index).toEqual([10, 11, 12]);
  });

  it('prints the surname with suffixes and particles', () => {
    expect(jerseyName('Jerry Rice')).toBe('Rice');
    expect(jerseyName('Odell Beckham Jr.')).toBe('Beckham Jr.');
    expect(jerseyName('Amon-Ra St. Brown')).toBe('St. Brown');
    expect(jerseyName('Kyle Van Noy')).toBe('Van Noy');
    expect(jerseyName('Madonna')).toBe('Madonna');
  });
});
