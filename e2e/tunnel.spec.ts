import { expect, test, type Page } from '@playwright/test';
import { trackErrors, waitReady } from './helpers';

// M7 tunnel reveal (docs/m7/TUNNEL.md): the walk-out to the game through the
// reveal, by the keyboard. A Classic draft Auto-Drafted, Walk out, the room's walk
// hands over to the reveal in the stadium; Enter skips it to the pre-game
// card, whose own arming means that press can't kick off; a second press
// kicks off. And Enter during the room's walk goes straight to the game with
// no reveal. Real time on the software renderer: slow, so long timeouts.

type W = {
  __btbDraft: { getState(): { phase: string; begin(mode: string, o?: { seed?: number }): Promise<void> } };
  __btbApp: { getState(): { screen: string; go(s: string): void } };
  __btbGameUi?: { getState(): { stage: string } };
  __btbRevealUi?: { getState(): { open: boolean; shot: string | null } };
};

/** Run `f` on the page's window (as a string: page.evaluate passes no argument). */
const ev = <T,>(page: Page, f: (w: W) => T): Promise<T> => page.evaluate(`(${f.toString()})(window)`) as Promise<T>;

/** A Classic draft, Auto-Drafted (R), the full row: the way a player gets there. */
async function fullRoom(page: Page) {
  await page.goto('/?screen=main&nointro&quality=low');
  await waitReady(page);
  await page.evaluate(() => {
    const w = window as unknown as W;
    void w.__btbDraft.getState().begin('classic', { seed: 7 });
    w.__btbApp.getState().go('draft');
  });
  await page.waitForFunction(() => (window as unknown as W).__btbDraft.getState().phase === 'intro', null, { timeout: 300_000 });
  await page.keyboard.press('KeyR'); // Auto-Draft
  await page.waitForFunction(() => (window as unknown as W).__btbDraft.getState().phase === 'complete', null, { timeout: 300_000 });
  await expect(page.locator('.stage-btn', { hasText: 'Walk out' })).toBeVisible();
}

test('walk out, the tunnel reveal, skip it, and kick off', async ({ page }) => {
  test.setTimeout(1_800_000);
  const errors = trackErrors(page);
  await fullRoom(page);
  await page.keyboard.press('Enter'); // Walk out
  await page.waitForFunction(() => (window as unknown as W).__btbDraft.getState().phase === 'walkout', null, { timeout: 60_000 });
  // The room's walk hands over to the reveal in the stadium, and the game starts under it.
  await page.waitForFunction(() => (window as unknown as W).__btbRevealUi?.getState().open && (window as unknown as W).__btbApp.getState().screen === 'game', null, { timeout: 900_000 });
  await page.waitForFunction(() => (window as unknown as W).__btbRevealUi?.getState().shot === 'tunnel', null, { timeout: 600_000 });
  await expect(page.locator('.tunnel-hud .tn-skip')).toBeVisible();
  await expect(page.locator('.pregame')).toHaveCount(0);
  expect(await ev(page, (w) => w.__btbGameUi?.getState().stage)).toBe('pregame');
  await page.keyboard.press('Enter'); // skip
  await page.waitForFunction(() => !(window as unknown as W).__btbRevealUi?.getState().open, null, { timeout: 60_000 });
  await expect(page.locator('.pregame')).toBeVisible();
  // The press that skipped didn't kick off; the next one (once the card is armed) does.
  expect(await ev(page, (w) => w.__btbGameUi?.getState().stage)).toBe('pregame');
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as W).__btbGameUi?.getState().stage !== 'pregame', null, { timeout: 120_000 });
  expect(errors).toEqual([]);
});

test('Enter during the room walk goes straight to the game, no reveal', async ({ page }) => {
  test.setTimeout(1_200_000);
  const errors = trackErrors(page);
  await fullRoom(page);
  await page.keyboard.press('Enter'); // Walk out
  await page.waitForFunction(() => (window as unknown as W).__btbDraft.getState().phase === 'walkout', null, { timeout: 60_000 });
  await page.keyboard.press('Enter'); // skip the walk
  await page.waitForFunction(() => (window as unknown as W).__btbApp.getState().screen === 'game' && (window as unknown as W).__btbGameUi?.getState().stage === 'pregame', null, { timeout: 300_000 });
  expect(await ev(page, (w) => w.__btbRevealUi?.getState().open)).toBe(false);
  await expect(page.locator('.pregame')).toBeVisible();
  expect(errors).toEqual([]);
});
