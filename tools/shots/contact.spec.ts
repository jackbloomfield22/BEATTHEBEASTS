import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Contact sheets for every authored clip, from the Animation Lab
// (/#/dev/anim), into tools/shots/out/contact. Locomotion: eight evenly
// spaced moments of one cycle, side on. Stances: every roster body type in
// the stance, three-quarter view. Review them next to docs/ANIMATION.md.

const meta = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as {
  clips: Record<string, { kind: 'stance' | 'locomotion' }>;
};

for (const [clip, m] of Object.entries(meta.clips)) {
  test(`contact · ${clip}`, async ({ page }) => {
    const q =
      m.kind === 'locomotion'
        ? `mode=sheet&clip=${clip}&t=0&lod=0&cam=12,1.2,0,0,0.95,0`
        : `mode=lineup&clip=${clip}&t=0.5&lod=0&cam=6.5,2.6,6.5,0,0.6,0`;
    await page.goto(`/#/dev/anim?${q}`);
    await page.waitForFunction(() => (window as unknown as { __labReady?: boolean }).__labReady === true, null, { timeout: 180_000 });
    await page.waitForTimeout(2500);
    await page.locator('.lab-view').screenshot({ path: `tools/shots/out/contact/${clip}.png` });
  });
}
