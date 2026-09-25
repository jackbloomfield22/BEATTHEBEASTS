import { expect, test, type Page } from '@playwright/test';
import { trackErrors, waitReady } from './helpers';

// M6 gate: a full game with no dead ends. Quick Play drafts a team in the
// locker room, walks out the tunnel and plays a six-round game against the
// Beasts to the results screen: every Meanwhile cut, play call, snap,
// result, fourth down, try and kick is answered the way a player would
// (keyboard), with the sim stepped tick by tick so the software renderer's
// slow frames don't matter.

type W = {
  __btbDraft: { getState(): { phase: string; begin(mode: string, o?: { seed?: number }): Promise<void> } };
  __btbApp: { getState(): { screen: string; go(s: string): void } };
  __btbGameUi: { getState(): { stage: string; match: { round: number; phase: string; score: { user: number; beasts: number }; cfg: { drives: number } } | null } };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbPractice: { runner: { paused: boolean; state: { result: unknown } } | null; tick(n: number): void };
  __btbGameReady?: boolean;
};

const gameStage = (page: Page) => page.evaluate(() => (window as unknown as W).__btbGameUi.getState().stage);
const practiceStage = (page: Page) => page.evaluate(() => (window as unknown as W).__btbPracticeUi.getState().stage);

async function playSnap(page: Page) {
  await page.waitForFunction(() => (window as unknown as W).__btbPracticeUi.getState().stage === 'presnap' && (window as unknown as W).__btbGameReady === true, null, { timeout: 150_000 });
  await page.evaluate(() => void ((window as unknown as W).__btbPractice.runner!.paused = true));
  await page.keyboard.press('Space'); // snap
  for (let k = 0; k < 120; k++) {
    await page.evaluate(() => (window as unknown as W).__btbPractice.tick(30));
    if ((await practiceStage(page)) === 'result') return;
    // A pass play: throw to the first read after the drop so the game moves.
    if (k === 5) await page.keyboard.press('Digit1');
  }
  throw new Error('the play never ended');
}

test('Quick Play: locker room, walk-out and a full six-round game to the results screen', async ({ page }) => {
  test.setTimeout(3_600_000);
  const errors = trackErrors(page);
  await page.goto('/?screen=main&nointro&quality=low&autokick');
  await waitReady(page);
  await page.evaluate(() => {
    const w = window as unknown as W;
    void w.__btbDraft.getState().begin('quick', { seed: 5 });
    w.__btbApp.getState().go('draft');
  });
  // The full room, then the walk-out to the field.
  await page.waitForFunction(() => (window as unknown as W).__btbApp.getState().screen === 'game', null, { timeout: 300_000 });
  const seen = new Set<string>();
  let snaps = 0;
  for (let step = 0; step < 600; step++) {
    const st = await gameStage(page);
    seen.add(st);
    if (st === 'final') break;
    if (st === 'loading') await page.waitForTimeout(500);
    else if (st === 'meanwhile' || st === 'fourth' || st === 'try') {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    } else if (st === 'call') {
      await page.keyboard.press('Enter');
      await playSnap(page);
      snaps++;
    } else if (st === 'play') {
      if ((await practiceStage(page)) === 'result') await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    } else await page.waitForTimeout(500); // kick (autokick) and punt cuts run themselves
  }
  const m = await page.evaluate(() => (window as unknown as W).__btbGameUi.getState().match!);
  expect(m.phase).toBe('final');
  expect(m.cfg.drives).toBe(6);
  expect(snaps).toBeGreaterThan(6);
  expect([...seen]).toEqual(expect.arrayContaining(['meanwhile', 'call', 'play', 'final']));
  await page.waitForFunction(() => (window as unknown as W).__btbApp.getState().screen === 'results', null, { timeout: 60_000 });
  await expect(page.locator('.res-score')).toBeVisible();
  expect(errors).toEqual([]);
});
