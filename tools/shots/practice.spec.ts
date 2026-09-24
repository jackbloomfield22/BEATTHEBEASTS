import { test, type Page } from '@playwright/test';

// The Practice Field, one play through (M5): play call, pre-snap, the pocket
// with a receiver held (power ring and placement reticle), the ball in the
// air, the run, the tackle and the fall, the result card, the pause menu,
// All-22 and field level. The sim is stepped tick by tick (the runner's
// real-time stepping paused), so every capture is the same play.
// BTB_PRACTICE=1 npm run shots  ->  tools/shots/out/practice/

type P = {
  __btbPractice: { runner: { paused: boolean; state: { tick: number; phase: string; result: unknown; ball: { mode: string; arrive: number }; t: number } } | null; tick(n: number): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbGameReady?: boolean;
  __btbReady?: boolean;
};
const W = () => window as unknown as P;
const OUT = 'tools/shots/out/practice';
const LIGHTING = process.env.BTB_LIGHTING ?? 'golden';

async function shot(page: Page, name: string) {
  // A few rendered frames so the camera, animation and HUD settle on the tick.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/${LIGHTING}-${name}.png` });
}
const tick = (page: Page, n: number) => page.evaluate((k) => (window as unknown as P).__btbPractice.tick(k), n);
const phase = (page: Page) => page.evaluate(() => (window as unknown as P).__btbPractice.runner!.state.phase);

test(`practice play-through · ${LIGHTING}`, async ({ page }) => {
  await page.goto(`/?screen=practice&nointro&seed=37&quality=${process.env.BTB_QUALITY ?? 'high'}&shot=practice&lighting=${LIGHTING}`);
  await page.waitForFunction(() => W().__btbReady === true, null, { timeout: 300_000 });
  await page.waitForFunction(() => W().__btbPracticeUi?.getState().stage === 'call', null, { timeout: 120_000 });
  await page.keyboard.press('ArrowDown');
  await shot(page, '01-play-call');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => W().__btbGameReady === true, null, { timeout: 300_000 });
  await page.evaluate(() => void (W().__btbPractice.runner!.paused = true));
  await shot(page, '02-presnap');
  await page.keyboard.press('Space');
  await tick(page, 40);
  await shot(page, '03-drop');
  await tick(page, 60);
  // Hold icon 1 with the mouse off to its lead side: the ring charges, the reticle shows.
  const icon = await page.locator('.rec-icon').first().boundingBox();
  if (icon) await page.mouse.move(icon.x + 30, icon.y - 20);
  await page.keyboard.down('Digit1');
  await tick(page, 14);
  await shot(page, '04-pocket-hold');
  await page.keyboard.up('Digit1');
  await tick(page, 8);
  await shot(page, '05-throw');
  await tick(page, 60);
  await shot(page, '06-ball-in-air');
  for (let k = 0; k < 40 && (await phase(page)) === 'air'; k++) await tick(page, 6);
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await tick(page, 20);
  await page.keyboard.up('KeyD');
  await shot(page, '07-run');
  await tick(page, 70);
  await shot(page, '08-long-run');
  for (let k = 0; k < 80 && (await phase(page)) !== 'dead'; k++) await tick(page, 6);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  await tick(page, 30);
  await page.keyboard.press('F3');
  await shot(page, '09-field-level-dead-ball');
  await page.keyboard.press('F1');
  await tick(page, 100);
  await shot(page, '10-result');
  await page.keyboard.press('F2');
  await shot(page, '11-all22');
  await page.keyboard.press('F1');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => W().__btbPracticeUi.getState().stage === 'presnap');
  await page.evaluate(() => void (W().__btbPractice.runner!.paused = true));
  await shot(page, '12-next-snap');
  await page.keyboard.press('Escape');
  await shot(page, '13-pause');
});

test(`practice tackle and fall · ${LIGHTING}`, async ({ page }) => {
  // Stick: a short completion and a tackle, from field level.
  await page.goto(`/?screen=practice&nointro&seed=5&quality=${process.env.BTB_QUALITY ?? 'high'}&shot=practice&lighting=${LIGHTING}`);
  await page.waitForFunction(() => W().__btbPracticeUi?.getState().stage === 'call', null, { timeout: 300_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => W().__btbGameReady === true, null, { timeout: 300_000 });
  await page.evaluate(() => void (W().__btbPractice.runner!.paused = true));
  await page.keyboard.press('F3');
  await page.keyboard.press('Space');
  await tick(page, 78);
  await page.keyboard.down('Digit1');
  await tick(page, 3);
  await page.keyboard.up('Digit1');
  for (let k = 0; k < 60 && (await phase(page)) !== 'dead'; k++) await tick(page, 4);
  await tick(page, 6);
  await shot(page, '20-tackle');
  await tick(page, 30);
  await shot(page, '21-fall');
  await tick(page, 60);
  await shot(page, '22-down');
  await tick(page, 70);
  await shot(page, '23-getting-up');
});
