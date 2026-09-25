import { expect, test, type Page } from '@playwright/test';

async function waitReady(page: Page) {
  await page.waitForFunction(() => (window as unknown as { __btbReady?: boolean }).__btbReady === true, null, { timeout: 150_000 });
}

test('boots like a PC game: intro → press any key → main menu → settings → back', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.studio-intro')).toBeVisible();
  await waitReady(page);
  await page.keyboard.press('Space'); // skip the intro
  await expect(page.locator('.title-screen')).toBeVisible();
  await expect(page.getByText('Press any key')).toBeVisible();
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await expect(page.locator('.main-menu')).toBeVisible();
  await expect(page.locator('.menu-item.is-focused')).toHaveText(/Play/);

  // Keyboard navigation reaches Settings (index 5) and opens it.
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('.menu-item.is-focused')).toHaveText(/Settings/);
  await page.keyboard.press('Enter');
  await expect(page.locator('.settings-screen')).toBeVisible();
  await expect(page.locator('.tab.is-active')).toHaveText('Display');
  await page.keyboard.press('KeyE');
  await expect(page.locator('.tab.is-active')).toHaveText('Graphics');

  // Toggle the FPS counter on the Display tab.
  await page.keyboard.press('KeyQ');
  for (let i = 0; i < 7; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('.setting-row.is-focused .setting-label')).toHaveText('FPS counter');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.fps-counter')).toBeVisible();

  // Hidden perf screen.
  await page.keyboard.press('Backquote');
  await expect(page.locator('.perf-screen')).toBeVisible();
  await expect(page.locator('.perf-rows')).toContainText('Draw calls');
  await page.keyboard.press('Backquote');

  await page.keyboard.press('Escape');
  await expect(page.locator('.main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('locked modes explain themselves; Play opens the locker room', async ({ page }) => {
  await page.goto('/?nointro');
  await waitReady(page);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await expect(page.locator('.main-menu')).toBeVisible();
  // History is still to come: it says so instead of opening a stand-in screen.
  await page.keyboard.press('ArrowUp'); // wraps to the last item
  await expect(page.locator('.menu-item.is-focused')).toContainText('History');
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast')).toContainText('arrives with');
  await expect(page.locator('.main-menu')).toBeVisible();
  // Play (M6): the draft in the Contenders' locker room.
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.menu-item.is-focused')).toContainText('Play');
  await page.keyboard.press('Enter');
  await expect(page.locator('.draft-screen')).toBeVisible();
});

test('settings rebinding moves a clashing key and persists', async ({ page }) => {
  await page.goto('/?screen=settings');
  await waitReady(page);
  await page.keyboard.press('KeyE');
  await page.keyboard.press('KeyE'); // Controls tab
  await expect(page.locator('.tab.is-active')).toHaveText('Controls');
  // First bind row in the Pre-Snap group is "Snap".
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('.setting-row.is-focused .setting-label')).toHaveText('Snap');
  await page.keyboard.press('Enter');
  await expect(page.locator('.bind.capturing')).toBeVisible();
  await page.keyboard.press('KeyH'); // H is Hot Route in the same context
  await expect(page.locator('.setting-row.is-focused .bind').first()).toHaveText(/H/);
  await expect(page.locator('.settings-desc .conflict')).toContainText('Hot route');
  const stored = await page.evaluate(() => localStorage.getItem('btb3d:settings.v1'));
  expect(JSON.parse(stored!).controls.keyboard['preSnap.snap'][0]).toBe('KeyH');
});

test('skin-tone editor is reachable from settings and edits entries', async ({ page }) => {
  await page.goto('/?screen=settings');
  await waitReady(page);
  for (let i = 0; i < 4; i++) await page.keyboard.press('KeyE'); // Gameplay tab
  await expect(page.locator('.tab.is-active')).toHaveText('Gameplay');
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('.setting-row.is-focused .setting-label')).toHaveText('Skin-tone editor');
  await page.keyboard.press('Enter');
  await expect(page.locator('.char-screen')).toBeVisible();
  await page.keyboard.press('Digit4');
  await expect(page.locator('.char-count b')).toHaveText('1');
  await expect(page.locator('.char-count .unsaved')).toBeVisible();
});

test('phones get the keyboard-and-mouse screen', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByText('built for keyboard and mouse or a controller')).toBeVisible();
  await ctx.close();
});
