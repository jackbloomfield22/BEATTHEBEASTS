import { expect, test, type Page } from '@playwright/test';
import { trackErrors, waitReady } from './helpers';

// M7 touchdown celebrations (Playtest 1 #7): a touchdown in the Practice
// Field brings up three choices (1/2/3 on the keys), the pick plays on the
// field, and the result card comes after it. Render-only: the play's state
// hash is the same after the celebration as at the whistle. The scripted
// touchdown is src/game/clips.ts completion-rac; the sim is stepped in the
// page to the whistle, then the frames run (?shot: 1/60 s each).

type Clip = { id: string; seed: number; script(s: unknown): unknown };
type W = {
  __btbPractice: { runner: { paused: boolean; hash(): number; state: { result: { touchdown: boolean } | null } } | null; callClip(c: unknown): Promise<void>; tickWith(f: unknown): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbCelebUi: { getState(): { phase: string; choices: string[]; picked: string | null; auto: boolean } };
  __btbInput: { activeContext: string };
  __btbClips(): Promise<Clip[]>;
  __btbGameReady?: boolean;
};
const ev = <T>(page: Page, f: (w: W) => T) => page.evaluate(`(${f.toString()})(window)`) as Promise<T>;

async function touchdown(page: Page) {
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto('/?screen=practice&nointro&seed=1&quality=low&shot=practice');
  await waitReady(page);
  await page.waitForFunction(() => (window as unknown as W).__btbPracticeUi?.getState().stage === 'call', null, { timeout: 120_000 });
  await ev(page, async (w) => {
    const c = (await w.__btbClips()).find((x) => x.id === 'completion-rac')!;
    (window as unknown as { __clip: Clip }).__clip = c;
    await w.__btbPractice.callClip(c);
  });
  await page.waitForFunction(() => (window as unknown as W).__btbGameReady === true, null, { timeout: 150_000 });
  await ev(page, (w) => {
    const r = w.__btbPractice.runner!;
    r.paused = true;
    const c = (window as unknown as { __clip: Clip }).__clip;
    for (let k = 0; k < 60 * 30 && !r.state.result; k++) w.__btbPractice.tickWith(c.script(r.state));
    r.paused = false;
  });
  expect(await ev(page, (w) => w.__btbPractice.runner!.state.result?.touchdown)).toBe(true);
}

test('a touchdown: three celebrations offered, one picked and played, then the result card', async ({ page }) => {
  test.setTimeout(900_000);
  const errors = trackErrors(page);
  await touchdown(page);
  const prompt = page.locator('.celeb-prompt');
  await expect(prompt).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.celeb-choice')).toHaveCount(3);
  // Its own input context, and no result card under it.
  expect(await ev(page, (w) => w.__btbInput.activeContext)).toBe('celebrate');
  await expect(page.locator('.result-card')).toHaveCount(0);
  const ui = await ev(page, (w) => w.__btbCelebUi.getState());
  expect(new Set(ui.choices).size).toBe(3);

  // The second one, on its key.
  await page.keyboard.press('Digit2');
  await expect(prompt).toHaveCount(0);
  const picked = await ev(page, (w) => w.__btbCelebUi.getState());
  expect([picked.phase, picked.picked, picked.auto]).toEqual(['play', ui.choices[1], false]);
  await page.screenshot({ path: 'test-results/celebration-practice.png' });

  // It plays out; the card comes up after it.
  await page.waitForFunction(() => (window as unknown as W).__btbCelebUi.getState().phase === 'done', null, { timeout: 600_000, polling: 500 });
  await expect(page.locator('.result-card')).toBeVisible();
  expect(await ev(page, (w) => w.__btbPracticeUi.getState().stage)).toBe('result');
  expect(errors).toEqual([]);
});

test('nothing pressed: the first plays by itself; skip goes straight to the card', async ({ page }) => {
  test.setTimeout(900_000);
  const errors = trackErrors(page);
  await touchdown(page);
  await expect(page.locator('.celeb-prompt')).toBeVisible({ timeout: 120_000 });
  const first = (await ev(page, (w) => w.__btbCelebUi.getState())).choices[0];
  await page.waitForFunction(() => (window as unknown as W).__btbCelebUi.getState().phase === 'play', null, { timeout: 300_000, polling: 200 });
  const ui = await ev(page, (w) => w.__btbCelebUi.getState());
  expect([ui.picked, ui.auto]).toEqual([first, true]);
  await page.keyboard.press('Enter');
  await expect(page.locator('.result-card')).toBeVisible();
  expect(await ev(page, (w) => w.__btbCelebUi.getState().phase)).toBe('done');
  expect(errors).toEqual([]);
});
