import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RENDER_DPR_CAP, renderDpr } from '@/app/settings';
import { lodForScreenHeight, screenHeightPx } from '@/render/players/playerAsset';

describe('render pixel ratio', () => {
  it('caps each tier, even for small windows on dense displays', () => {
    // The M4.5 report: a 1126x870 window on a Retina display.
    expect(renderDpr(1126, 870, 2, 'medium', 1)).toBeCloseTo(RENDER_DPR_CAP.medium);
    expect(renderDpr(1126, 870, 2, 'low', 1)).toBe(1);
    expect(renderDpr(1126, 870, 2, 'ultra', 1)).toBe(2);
  });
  it('still holds Medium to about 1080p of pixels in a big window', () => {
    const dpr = renderDpr(1512, 982, 2, 'medium', 1);
    expect(1512 * 982 * dpr * dpr).toBeLessThanOrEqual(1920 * 1080 + 1);
  });
  it('applies the resolution scale on top', () => {
    expect(renderDpr(1920, 1080, 1, 'medium', 0.75)).toBeCloseTo(0.75);
  });
});

describe('player LOD by screen size', () => {
  const cam = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 1000);
  it('measures a player on screen', () => {
    cam.position.set(0, 1, 10);
    // 1.88 m at 10 m through a 40° lens on a 1080 px target: ~279 px.
    expect(screenHeightPx(cam, new THREE.Vector3(0, 0, 0), 1.88, 1080)).toBeCloseTo(279, -1);
  });
  it('draws the broadcast view at Medium or Low detail', () => {
    cam.position.set(0, 30, 55);
    const px = screenHeightPx(cam, new THREE.Vector3(0, 0, 0), 1.88, 1134);
    expect(lodForScreenHeight(px)).toBeGreaterThanOrEqual(1);
    expect(lodForScreenHeight(300)).toBe(0);
    expect(lodForScreenHeight(100)).toBe(1);
    expect(lodForScreenHeight(30)).toBe(2);
  });
});
