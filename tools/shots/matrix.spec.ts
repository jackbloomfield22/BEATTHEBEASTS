import { test } from '@playwright/test';

const STATES = [
  { name: 'title', q: 'screen=title&shot=title&t=40' },
  { name: 'menu', q: 'screen=main&shot=menu&t=0' },
  { name: 'settings', q: 'screen=settings&shot=settings&t=0' },
  { name: 'flyover-cliff', q: 'screen=intro&shot=title&t=6' },
  { name: 'flyover-bowl', q: 'screen=intro&shot=title&t=55' },
  { name: 'flyover-sea', q: 'screen=intro&shot=title&t=100' },
  // M3 subjects: turf at field level, the crowd up close, the cliff face and
  // surf, and the stadium exterior from the air.
  { name: 'field', q: 'screen=main&shot=practice&t=0' },
  { name: 'crowd', q: 'screen=main&shot=daily&t=0&cam=-30,3.5,5,-45,9,-5,35' },
  { name: 'cliff', q: 'screen=main&shot=menu&t=0&cam=70,-25,200,25,-44,125,50' },
  { name: 'exterior', q: 'screen=main&shot=menu&t=0&cam=-230,70,-230,0,0,-20,40' },
];
const LIGHTING = (process.env.BTB_LIGHTING ?? 'golden,night,overcast,rain,snow').split(',');
// Software rendering is slow: by default every state at Golden Hour, and the
// two most telling states for the other presets. BTB_FULL=1 runs everything.
const OTHER_PRESET_STATES = ['menu', 'flyover-bowl', 'field'];

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
