import { test } from '@playwright/test';

const STATES = [
  { name: 'title', q: 'screen=title&shot=title&t=40' },
  { name: 'menu', q: 'screen=main&shot=menu&t=0' },
  { name: 'settings', q: 'screen=settings&shot=settings&t=0' },
  { name: 'flyover-cliff', q: 'screen=intro&shot=title&t=6' },
  { name: 'flyover-bowl', q: 'screen=intro&shot=title&t=55' },
  { name: 'flyover-sea', q: 'screen=intro&shot=title&t=100' },
];
const LIGHTING = (process.env.BTB_LIGHTING ?? 'golden,night,overcast,rain,snow').split(',');
// Software rendering is slow: by default every state at Golden Hour, and the
// two most telling states for the other presets. BTB_FULL=1 runs everything.
const OTHER_PRESET_STATES = ['menu', 'flyover-bowl'];

for (const lighting of LIGHTING) {
  for (const s of STATES) {
    if (!process.env.BTB_FULL && lighting !== 'golden' && !OTHER_PRESET_STATES.includes(s.name)) continue;
    test(`${s.name} · ${lighting}`, async ({ page }) => {
      await page.goto(`/?${s.q}&lighting=${lighting}&quality=${process.env.BTB_QUALITY ?? 'high'}`);
      await page.waitForFunction(() => (window as unknown as { __btbReady?: boolean }).__btbReady === true, null, { timeout: 180_000 });
      // The intro overlay would cover flyover frames; hide it for scene-only captures.
      if (s.q.startsWith('screen=intro')) await page.addStyleTag({ content: '.studio-intro{display:none!important}' });
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `tools/shots/out/matrix/${lighting}-${s.name}.png` });
    });
  }
}
