import { expect, test, type Page } from '@playwright/test';
import { noAutoReplay, trackErrors } from './helpers';

// M7, Playtest 1 #4: the Beasts' possession as a broadcast montage. A game
// is kicked off; the Beasts' first drive stages its key play and
// plays it in the stadium (the establishing shot, then the play), and Enter
// skips it at once: the drive is scored and your drive comes up. With the
// setting on "Meanwhile card", the card shows instead.

type W = {
  __btbDraft: { getState(): { phase: string; finishWalkout(go: (s: string) => void): void } };
  __btbApp: { getState(): { screen: string; go(s: string): void } };
  __btbGameUi: { getState(): { stage: string; match: { beastsDrives: unknown[]; score: { beasts: number } } | null; meanwhile: { points: number } | null } };
  __btbMontage: { busy: boolean; active: boolean; player: { tick: number; snapTick: number } | null; staged: { kind: string; label: string } | null };
  __btbMontageUi: { getState(): { open: boolean; shot: string | null } };
  __btbSettings: { getState(): { set(f: (d: { gameplay: { beastsDrives: string } }) => void): void } };
  __btbGame: Record<string, () => void>;
};

const read = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as W;
    const g = w.__btbGameUi.getState();
    const m = w.__btbMontageUi.getState();
    return { stage: g.stage, drives: g.match?.beastsDrives.length ?? 0, open: m.open, shot: m.shot, kind: w.__btbMontage.staged?.kind ?? null, tick: w.__btbMontage.player?.tick ?? -1, snap: w.__btbMontage.player?.snapTick ?? -1 };
  });

test('the Beasts drive montage plays in the stadium and Enter skips it', async ({ page }) => {
  test.setTimeout(1_200_000);
  const errors = trackErrors(page);
  // A full draft (seed 5: the Beasts' opening drive is a touchdown), straight to the game (the walk-out has its own tests).
  await page.goto('/?screen=draft&nointro&quality=low&seed=5&fill=9');
  await page.waitForFunction(() => (window as unknown as W).__btbDraft?.getState().phase === 'complete', null, { timeout: 600_000 });
  await noAutoReplay(page);
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__btbSettings.getState().set((d) => void (d.gameplay.beastsDrives = 'montage'));
    w.__btbDraft.getState().finishWalkout(w.__btbApp.getState().go);
  });
  await page.waitForFunction(() => (window as unknown as W).__btbApp.getState().screen === 'game', null, { timeout: 300_000 });
  await page.waitForFunction(() => (window as unknown as W).__btbGameUi.getState().stage === 'pregame', null, { timeout: 300_000 });
  await page.waitForTimeout(1200);
  await page.keyboard.press('Enter'); // kick off: the Beasts have the ball
  await page.waitForFunction(() => (window as unknown as W).__btbGameUi.getState().stage === 'meanwhile', null, { timeout: 60_000 });
  expect((await read(page)).open).toBe(true);
  // Staged (a few frames under the bumper), then the shots: the establishing look at the offense set, then the snap.
  await page.waitForFunction(() => (window as unknown as W).__btbMontage.active, null, { timeout: 300_000 });
  await expect(page.locator('.mt-bug')).toBeVisible();
  await expect(page.locator('.mt-skip')).toContainText('Skip');
  await page.waitForFunction(() => (window as unknown as W).__btbMontageUi.getState().shot === 'play', null, { timeout: 600_000 });
  const mid = await read(page);
  expect(mid.stage).toBe('meanwhile');
  expect(mid.drives).toBe(0); // not scored until it's over
  expect(mid.tick).toBeGreaterThan(mid.snap - 40);
  // Skip: at once, the drive scored and on to your drive.
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as W).__btbGameUi.getState().stage !== 'meanwhile', null, { timeout: 60_000 });
  const after = await read(page);
  expect(after.open).toBe(false);
  expect(after.drives).toBe(1);
  expect(after.stage).not.toBe('meanwhile');

  // The setting's other choice: the Meanwhile card (the next Beasts possession is called up straight away here, for the test only).
  await page.evaluate(() => {
    const w = window as unknown as W;
    w.__btbSettings.getState().set((d) => void (d.gameplay.beastsDrives = 'card'));
    w.__btbGame['nextBeasts']!.call(w.__btbGame);
  });
  await expect(page.locator('.meanwhile')).toBeVisible();
  expect((await read(page)).open).toBe(false);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as W).__btbGameUi.getState().stage !== 'meanwhile', null, { timeout: 60_000 });
  expect((await read(page)).drives).toBe(2);
  expect(errors).toEqual([]);
});
