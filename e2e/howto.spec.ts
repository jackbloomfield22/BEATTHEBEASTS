import { expect, test, type Page } from '@playwright/test';
import { expectStageAlive, trackErrors, waitReady } from './helpers';

// Owner's M3 report: clicking "The Draft" in How to Play crashed the UI (a
// black screen, then the error screen). Root cause: an effect returned
// scrollTo()'s result, which current Chrome makes a Promise; React then
// called that Promise as the effect's cleanup on the first page change. The
// test Chromium here is older (scrollTo returns undefined), so the tests
// emulate current Chrome's Promise-returning scroll methods, and every page
// must show its own content with no error screen.

const PAGES: [string, string][] = [
  ['The Game', 'Possessions'],
  ['The Draft', 'Nine rounds'],
  ['Controls', 'Snap'],
];

async function emulateCurrentChromeScroll(page: Page) {
  await page.addInitScript(() => {
    for (const m of ['scrollTo', 'scrollBy', 'scroll', 'scrollIntoView'] as const) {
      const orig = Element.prototype[m] as (...a: unknown[]) => unknown;
      Object.defineProperty(Element.prototype, m, {
        configurable: true,
        value(this: Element, ...a: unknown[]) {
          orig.apply(this, a);
          return Promise.resolve();
        },
      });
    }
  });
}

/** The page's own content is on screen, and nothing crashed. */
async function expectPage(page: Page, i: number) {
  const [name, text] = PAGES[i]!;
  await expect(page.locator('.tab.is-active')).toHaveText(name);
  await expect(page.locator('.howto-body').getByText(text, { exact: false }).first()).toBeVisible();
  await expect(page.locator('[role=alert]')).toHaveCount(0);
  await expect(page.locator('.howto-screen')).toBeVisible();
}

async function openHowTo(page: Page) {
  await emulateCurrentChromeScroll(page);
  await page.goto('/?nointro');
  await waitReady(page);
  await page.waitForTimeout(500);
  await page.keyboard.press('Enter');
  await expect(page.locator('.main-menu')).toBeVisible();
  await page.locator('.menu-item', { hasText: 'How to Play' }).click();
  await expect(page.locator('.howto-screen')).toBeVisible();
}

test('every How to Play page opens by click, Q/E and arrows, with the stage alive', async ({ page }) => {
  const errors = trackErrors(page);
  await openHowTo(page);
  await expectPage(page, 0);

  // Mouse: each tab, the Draft first (the reported case).
  for (const i of [1, 2, 0, 1]) {
    await page.locator('.tab', { hasText: PAGES[i]![0] }).click();
    await expectPage(page, i);
    await expectStageAlive(page);
  }
  // Keyboard: E / Q cycle forward and back, arrows too.
  for (const [key, expected] of [['KeyE', 2], ['KeyE', 0], ['KeyQ', 2], ['ArrowLeft', 1], ['ArrowRight', 2], ['ArrowRight', 0]] as const) {
    await page.keyboard.press(key);
    await expectPage(page, expected);
  }
  // Scroll keys on a long page, then back out: the UI still answers.
  await page.locator('.tab', { hasText: 'Controls' }).click();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expectStageAlive(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('.main-menu')).toBeVisible();
  expect(errors).toEqual([]);
});

test('a lost WebGL context rebuilds the stage instead of leaving a black screen', async ({ page }) => {
  const errors = trackErrors(page);
  await openHowTo(page);
  await page.locator('.tab', { hasText: 'The Draft' }).click();
  await page.evaluate(() => (window as unknown as { __btbLoseContext: () => void }).__btbLoseContext());
  await expect(page.locator('.toast')).toContainText('graphics device was reset');
  // A fresh canvas renders again and the menus still work.
  await page.waitForFunction(() => {
    const gl = (window as unknown as { __btbGl?: { getContext(): WebGL2RenderingContext } }).__btbGl?.getContext();
    return !!gl && !gl.isContextLost();
  }, null, { timeout: 150_000 });
  await expectStageAlive(page);
  await expect(page.locator('.tab.is-active')).toHaveText('The Draft');
  await page.keyboard.press('Escape');
  await expect(page.locator('.main-menu')).toBeVisible();
  // three logs the loss itself; nothing else may fail.
  expect(errors.filter((e) => !/Context Lost/i.test(e))).toEqual([]);
});
