import { expect, test, type Page } from '@playwright/test';
import { trackErrors, waitReady } from './helpers';

// M7 instant replay (Playtest 1 #8): after a snap, the replay key opens the
// replay over the result card; it plays, pauses, changes speed, scrubs and
// changes camera; it ends on the very state the live play is in (the same
// hash); Esc goes back to the result card, which still stands. The results
// screen plays the play of the game back from the record's capsule. The sim
// is stepped tick by tick as in practice.spec.ts (software rendering is slow).

type Player = { verified: boolean; tick: number; start: number; end: number; target: number; seeking: boolean; runner: { hash(): number }; seek(t: number): void };
type W = {
  __btbPractice: { runner: { paused: boolean; hash(): number; state: { result: unknown } } | null; tick(n: number): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbReplay: { player: Player | null; active: boolean };
  __btbReplayUi: { getState(): { open: boolean; playing: boolean; speed: number; cam: string; from: string | null; loading: boolean } };
  __btbInput: { activeContext: string };
  __btbHistory: { setState(p: object): void; getState(): { records: unknown[] } };
  __btbApp: { getState(): { screen: string; go(s: string): void } };
  __btbGameReady?: boolean;
};
const ev = <T>(page: Page, f: (w: W) => T) => page.evaluate(`(${f.toString()})(window)`) as Promise<T>;
const tick = (page: Page, n: number) => page.evaluate((k) => (window as unknown as W).__btbPractice.tick(k), n);
const ui = (page: Page) => ev(page, (w) => w.__btbReplayUi.getState());
/** Let the scene draw until a scrub has landed (its catch-up runs in the frame). */
const settled = (page: Page) => page.waitForFunction(() => !(window as unknown as W).__btbReplay.player?.seeking, null, { timeout: 120_000 });

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

test('a snap: the replay opens over the result card, plays, scrubs, matches the play, and goes back', async ({ page }) => {
  test.setTimeout(600_000);
  const errors = trackErrors(page);
  await toResult(page);
  // The card prompts for it (the replay key's glyph).
  await expect(page.locator('.result-card .replay-cue').first()).toBeVisible();

  await page.keyboard.press('KeyP');
  await expect(page.locator('.replay-hud')).toBeVisible();
  await expect(page.locator('.result-card')).toHaveCount(0);
  await expect(page.locator('.replay-bug')).toContainText('Replay');
  expect(await ev(page, (w) => [w.__btbReplay.player!.verified, w.__btbInput.activeContext])).toEqual([true, 'replay']);

  // Pause, slow it down, back to the start, on a second, the broadcast camera.
  await page.keyboard.press('Space');
  expect((await ui(page)).playing).toBe(false);
  await page.keyboard.press('KeyS');
  expect((await ui(page)).speed).toBe(0.5);
  await page.keyboard.press('KeyR');
  await settled(page);
  expect(await ev(page, (w) => w.__btbReplay.player!.tick === w.__btbReplay.player!.start)).toBe(true);
  await page.keyboard.press('KeyD');
  await settled(page);
  expect(await ev(page, (w) => w.__btbReplay.player!.tick - w.__btbReplay.player!.start)).toBe(60);
  await page.keyboard.press('KeyC');
  expect((await ui(page)).cam).toBe('broadcast');
  await page.screenshot({ path: 'test-results/replay-practice.png' });

  // Run to its end: the very state the live play is in.
  await ev(page, (w) => w.__btbReplay.player!.seek(w.__btbReplay.player!.end));
  await settled(page);
  expect(await ev(page, (w) => w.__btbReplay.player!.runner.hash() === w.__btbPractice.runner!.hash())).toBe(true);

  // Esc: back to the result card, the snap still at its result.
  await page.keyboard.press('Escape');
  await expect(page.locator('.result-card')).toBeVisible();
  expect(await ev(page, (w) => [w.__btbReplay.active, w.__btbReplayUi.getState().open, w.__btbPracticeUi.getState().stage])).toEqual([false, false, 'result']);

  // Backspace is the replay key here, not Back: it opens the replay again (and the card stays), and closes it.
  await page.keyboard.press('Backspace');
  await expect(page.locator('.replay-hud')).toBeVisible();
  await page.waitForTimeout(300);
  await page.keyboard.press('Backspace');
  await expect(page.locator('.result-card')).toBeVisible();
  expect(await ev(page, (w) => w.__btbPracticeUi.getState().stage)).toBe('result');
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
  await page.screenshot({ path: 'test-results/replay-results.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.pog-replay')).toBeVisible();
  expect(await ev(page, (w) => [w.__btbReplay.active, w.__btbApp.getState().screen])).toEqual([false, 'results']);
  expect(errors).toEqual([]);
});
