import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The catch clips (M6.5 #5) in the Animation Lab (/#/dev/anim), into
// tools/shots/out/catch: each at its secure frame and a beat either side.
// The run-speed catches are overlays, so they're shown over the run (blend
// at 6 m/s with the overlay replayed); the full-body ones play raw.
//   BTB_CATCH=1 npx playwright test -c tools/shots/playwright.config.ts

const meta = JSON.parse(readFileSync('public/assets/characters/anims.json', 'utf8')) as {
  fps: number;
  clips: Record<string, { kind: string; events?: Record<string, number> }>;
};
// The Lab plays a blend-mode overlay first at 0.6 s (AnimLab.tsx OVL_START).
const OVL_START = 0.6;
const CAM = process.env.BTB_CATCH_CAM ?? '2.9,1.7,3.6,0,1.05,0';

for (const [clip, m] of Object.entries(meta.clips)) {
  if (!clip.startsWith('catch_')) continue;
  const secure = (m.events?.secure ?? 0) / meta.fps;
  const tuck = (m.events?.tuck ?? 0) / meta.fps;
  for (const [label, t] of [['a_reach', secure - 0.12], ['b_secure', secure], ['c_tuck', tuck]] as const) {
    test(`catch · ${clip} · ${label}`, async ({ page }) => {
      const q =
        m.kind === 'overlay'
          ? `mode=single&clip=blend&speed=6&ovl=${clip}&t=${(OVL_START + t).toFixed(3)}&lod=0&kit=royal&look=0&cam=${CAM}`
          : `mode=single&clip=${clip}&t=${t.toFixed(3)}&lod=0&kit=royal&cam=${CAM}`;
      await page.goto(`/#/dev/anim?${q}`);
      await page.waitForFunction(() => (window as unknown as { __labReady?: boolean }).__labReady === true, null, { timeout: 180_000 });
      await page.waitForTimeout(2500);
      await page.locator('.lab-view').screenshot({ path: `tools/shots/out/catch/${clip}_${label}.png` });
    });
  }
}
