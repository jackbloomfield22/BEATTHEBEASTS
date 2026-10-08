import { expect, test, type Page } from '@playwright/test';
import { trackErrors, waitReady } from './helpers';

// M7 instant replay, quick and hands-off (the owner's call after M7): after
// a snap, the replay key opens the replay over the result card; it plays
// once by itself from the replay angle and hands back to the card, on the
// very state the live play is in (the same hash). Holding Shift runs it at
// 3x; Space skips it. No deck: no scrub, speeds, cameras or focus. The
// results screen plays the play of the game back the same way. The sim is
// stepped tick by tick as in practice.spec.ts (software rendering is slow).

type Player = { verified: boolean; tick: number; start: number; end: number; boost: number; seeking: boolean; runner: { hash(): number } };
type W = {
  __btbPractice: { runner: { paused: boolean; hash(): number; state: { result: unknown } } | null; tick(n: number): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbReplay: { player: Player | null; active: boolean; stopAt: number };
  __btbReplayUi: { getState(): { open: boolean; fast: boolean; from: string | null; loading: boolean; key: { label: string } | null } };
  __btbReplayStats: { lastHash: number };
  __btbInput: { activeContext: string };
  __btbHistory: { setState(p: object): void; getState(): { records: unknown[] } };
  __btbApp: { getState(): { screen: string; go(s: string): void } };
  __btbGameReady?: boolean;
};
const ev = <T>(page: Page, f: (w: W) => T) => page.evaluate(`(${f.toString()})(window)`) as Promise<T>;
const tick = (page: Page, n: number) => page.evaluate((k) => (window as unknown as W).__btbPractice.tick(k), n);

/** Stick against the coverage seed 5 draws: snap, throw to the first read, step to the result card. */
async function toResult(page: Page) {
  await page.goto('/?screen=practice&nointro&seed=5&quality=low&shot=practice');
  await waitReady(page);
  await page.waitForFunction(() => (window as unknown as W).__btbPracticeUi?.getState().stage === 'call', null, { timeout: 120_000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as W).__btbGameReady === true, null, { timeout: 150_000 });
  await ev(page, (w) => void (w.__btbPractice.runner!.paused = true));
  await page.keyboard.press('Space');
  await tick(page, 78);
  await page.keyboard.down('Digit1');
  await tick(page, 3);
  await page.keyboard.up('Digit1');
  for (let k = 0; k < 120 && !(await ev(page, (w) => !!w.__btbPractice.runner?.state.result)); k++) await tick(page, 10);
  await tick(page, 120);
  await expect(page.locator('.result-card')).toBeVisible();
}

test('a snap: the quick replay plays once by itself, Shift speeds it up, it hands back on the live play; Space skips it', async ({ page }) => {
  test.setTimeout(900_000);
  const errors = trackErrors(page);
  await toResult(page);
  // The card prompts for it (the replay key's glyph).
  await expect(page.locator('.result-card .replay-cue').first()).toBeVisible();

  await page.keyboard.press('KeyP');
  await expect(page.locator('.replay-hud')).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(0);
  await expect(page.locator('.replay-bug')).toContainText('Replay');
  expect(await ev(page, (w) => [w.__btbReplay.player!.verified, w.__btbInput.activeContext])).toEqual([true, 'replay']);
  // Two prompts and nothing else: skip, and hold to speed it up. No deck, scrub bar or camera.
  await expect(page.locator('.replay-keys .rc')).toHaveCount(2);
  await expect(page.locator('.replay-keys')).toContainText('Skip');
  await expect(page.locator('.replay-keys')).toContainText('3× speed');
  await expect(page.locator('.replay-deck, .replay-bar, .replay-cams')).toHaveCount(0);
  // The window: up to where it closes by itself (never past the last recorded input).
  expect(await ev(page, (w) => w.__btbReplay.stopAt > 0 && w.__btbReplay.stopAt <= w.__btbReplay.player!.end)).toBe(true);
  // The keys that drove the old deck do nothing to it now.
  for (const k of ['KeyS', 'KeyC', 'KeyR', 'Tab']) await page.keyboard.press(k);
  expect(await ev(page, (w) => [w.__btbReplay.active, w.__btbReplay.player!.boost])).toEqual([true, 1]);
  await page.screenshot({ path: 'test-results/replay-practice.png' });

  // Held Shift: 3x, and the bug says so; let go, back to 1x.
  await page.keyboard.down('Shift');
  await page.waitForFunction(() => (window as unknown as W).__btbReplayUi.getState().fast, null, { timeout: 60_000 });
  expect(await ev(page, (w) => w.__btbReplay.player!.boost)).toBe(3);
  await expect(page.locator('.rb-speed')).toHaveText('3×');
  await page.keyboard.up('Shift');
  await page.waitForFunction(() => !(window as unknown as W).__btbReplayUi.getState().fast, null, { timeout: 60_000 });
  expect(await ev(page, (w) => w.__btbReplay.player?.boost ?? 1)).toBe(1);
  // Held again to the end: it closes by itself and hands back to the card, on the very state the live play is in.
  await page.keyboard.down('Shift');
  await page.waitForFunction(() => !(window as unknown as W).__btbReplay.active, null, { timeout: 600_000 });
  await page.keyboard.up('Shift');
  await expect(page.locator('.result-card')).toBeVisible();
  expect(await ev(page, (w) => [w.__btbReplayUi.getState().open, w.__btbPracticeUi.getState().stage, w.__btbReplayStats.lastHash === w.__btbPractice.runner!.hash()])).toEqual([false, 'result', true]);

  // Backspace is the replay key here, not Back: it opens the replay again (the card stays); Space skips it at once.
  await page.keyboard.press('Backspace');
  await expect(page.locator('.replay-hud')).toBeVisible();
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await expect(page.locator('.result-card')).toBeVisible();
  expect(await ev(page, (w) => [w.__btbReplay.active, w.__btbPracticeUi.getState().stage, w.__btbReplayStats.lastHash === w.__btbPractice.runner!.hash()])).toEqual([false, 'result', true]);
  // And with the mouse: the Skip prompt is a button.
  await page.keyboard.press('KeyP');
  await expect(page.locator('.replay-hud')).toBeVisible();
  await page.waitForTimeout(300);
  await page.locator('.replay-keys .rc', { hasText: 'Skip' }).click();
  await expect(page.locator('.result-card')).toBeVisible();
  expect(await ev(page, (w) => w.__btbReplay.active)).toBe(false);
  expect(errors).toEqual([]);
});

test('the results screen: the play of the game plays back from the record and returns to the results', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = trackErrors(page);
  await page.goto('/?screen=main&nointro&quality=low&shot=menu');
  await waitReady(page);
  // A record whose play of the game carries its capsule: a Practice Field play, run to its whistle in the page.
  await page.evaluate(async () => {
    const imp = (p: string) => import(/* @vite-ignore */ p);
    const sim = await imp('/src/sim/index.ts');
    const { capsuleOf } = await imp('/src/game/replay.ts');
    const { SimRunner } = await imp('/src/game/runner.ts');
    const { loadPracticeRosters } = await imp('/src/game/rosters.ts');
    const fixture = await (await fetch('/tools/shots/fixtures/record.json')).json();
    const R = await loadPracticeRosters();
    const play = sim.playById('trips-four-verts');
    const def = sim.defById('cover2');
    const s = sim.createPlay({ seed: 18, offense: sim.offenseFor(play, R.team), defense: sim.defenseFor(def, R.beasts), play, def, los: 30, toGo: 10, user: false, down: 1 });
    const run = new SimRunner(s);
    for (let k = 0; k < 2400 && !s.result; k++) run.step(sim.input({}));
    for (let k = 0; k < 60; k++) run.step(sim.input({}));
    fixture.id = 'replay-e2e';
    fixture.playOfGame.replay.capsule = capsuleOf(s, run.frames, 1);
    const w = window as unknown as W;
    w.__btbHistory.setState({ records: [fixture], viewing: fixture.id, from: 'history' });
    w.__btbApp.getState().go('results');
  });
  await expect(page.locator('.pog-replay')).toBeVisible();
  await page.keyboard.press('KeyP');
  await expect(page.locator('.replay-hud')).toBeVisible();
  // The play scene mounts for it and builds the record's players.
  await page.waitForFunction(() => (window as unknown as W).__btbReplayUi.getState().loading === false, null, { timeout: 150_000 });
  expect(await ev(page, (w) => [w.__btbReplay.player!.verified, w.__btbReplayUi.getState().from])).toEqual([true, 'record']);
  await expect(page.locator('.replay-keys .rc')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/replay-results.png' });
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await expect(page.locator('.pog-replay')).toBeVisible();
  expect(await ev(page, (w) => [w.__btbReplay.active, w.__btbApp.getState().screen])).toEqual([false, 'results']);
  expect(errors).toEqual([]);
});
