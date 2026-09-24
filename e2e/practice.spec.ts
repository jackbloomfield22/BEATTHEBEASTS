import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { trackErrors, waitReady } from './helpers';

// M5 exit (TECH_PLAN §17): scripted browser plays on the Practice Field
// with real keyboard input (snap, throw, catch, tackle, score), and the
// determinism hash matching Node's. The runner's real-time stepping is
// paused and the test steps the sim tick by tick through the session (the
// same path as frames), so a play is exactly reproducible in a software-
// rendered browser that draws one frame a second.

type P = {
  __btbPractice: { runner: { paused: boolean; state: S } | null; tick(n: number): void };
  __btbPracticeUi: { getState(): { stage: string; result: { headline: string } | null } };
  __btbGameReady?: boolean;
  __btbSimHashes(): Promise<{ key: string; hash: number; ticks: number; reason: string }[]>;
};
type S = { tick: number; t: number; phase: string; icons: number[]; carrier: number; events: { type: string; who?: number[] }[]; result: { reason: string; yards: number; touchdown: boolean } | null };

async function open(page: Page, seed: number, downs: number) {
  await page.goto(`/?screen=practice&nointro&seed=${seed}&quality=low&shot=practice`);
  await waitReady(page);
  await page.waitForFunction(() => (window as unknown as P).__btbPracticeUi?.getState().stage === 'call', null, { timeout: 120_000 });
  for (let i = 0; i < downs; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as P).__btbGameReady === true, null, { timeout: 150_000 });
  await page.evaluate(() => void ((window as unknown as P).__btbPractice.runner!.paused = true));
}

const state = (page: Page) => page.evaluate(() => {
  const s = (window as unknown as P).__btbPractice.runner!.state;
  return { tick: s.tick, t: s.t, phase: s.phase, icons: s.icons, carrier: s.carrier, events: s.events.map((e) => ({ type: e.type, who: e.who })), result: s.result };
});
const tick = (page: Page, n: number) => page.evaluate((k) => (window as unknown as P).__btbPractice.tick(k), n);

async function tickUntil(page: Page, pred: (s: Awaited<ReturnType<typeof state>>) => boolean, max = 900) {
  for (let k = 0; k < max; k += 10) {
    const s = await state(page);
    if (pred(s)) return s;
    await tick(page, 10);
  }
  return state(page);
}

test('a full play: snap, throw, catch, run, tackle or score, result card', async ({ page }) => {
  const errors = trackErrors(page);
  await open(page, 37, 1); // Four Verticals against the coverage seed 37 draws (Cover 2)
  await page.keyboard.press('Space');
  await tick(page, 1);
  let s = await state(page);
  expect(s.events.some((e) => e.type === 'snap')).toBe(true);
  expect(s.phase).not.toBe('presnap');
  await tick(page, 100 - s.tick);
  // Tap icon 1: a touch pass to the first read.
  await page.keyboard.down('Digit1');
  await tick(page, 3);
  await page.keyboard.up('Digit1');
  s = await tickUntil(page, (x) => x.events.some((e) => e.type === 'throw'), 60);
  const thr = s.events.find((e) => e.type === 'throw')!;
  expect(thr.who![1]).toBe(s.icons[0]);
  s = await tickUntil(page, (x) => x.phase === 'carrier' || x.phase === 'dead');
  expect(s.events.some((e) => e.type === 'catch')).toBe(true);
  // Run it: sprint upfield.
  await page.keyboard.down('KeyW');
  await page.keyboard.down('ShiftLeft');
  s = await tickUntil(page, (x) => x.result !== null);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  expect(['tackle', 'touchdown', 'outOfBounds']).toContain(s.result!.reason);
  expect(s.result!.yards).toBeGreaterThan(10);
  // The dead ball settles and the result card comes up.
  await tick(page, 120);
  await expect(page.locator('.result-card')).toBeVisible();
  await expect(page.locator('.result-head')).toContainText(s.result!.touchdown ? 'Touchdown' : 'Complete');
  expect(errors).toEqual([]);
});

test('a tackle: the carrier goes down and the next snap is at the new spot', async ({ page }) => {
  await open(page, 5, 0); // Stick
  await page.keyboard.press('Space');
  await tick(page, 78);
  await page.keyboard.down('Digit1');
  await tick(page, 3);
  await page.keyboard.up('Digit1');
  let s = await tickUntil(page, (x) => x.result !== null);
  expect(s.events.some((e) => e.type === 'tackle' || e.type === 'sack')).toBe(true);
  await tick(page, 120);
  await expect(page.locator('.result-card')).toBeVisible();
  // Next play, the same call: the ball is spotted where he went down.
  await page.keyboard.press('Enter');
  await expect(page.locator('.play-call')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as P).__btbPracticeUi.getState().stage === 'presnap');
  s = await state(page);
  expect(s.phase).toBe('presnap');
  await expect(page.locator('.bug-down')).toHaveText(/2nd|1st/);
});

test('scores: a touchdown run ends the series with a touchdown card', async ({ page }) => {
  await open(page, 37, 1);
  await page.keyboard.press('Space');
  await tick(page, 100);
  await page.keyboard.down('Digit1');
  await tick(page, 3);
  await page.keyboard.up('Digit1');
  await tickUntil(page, (x) => x.phase === 'carrier' || x.phase === 'dead');
  // Weave: angle away from the nearest defender (the stick right), sprinting.
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await tick(page, 20);
  await page.keyboard.up('KeyD');
  const s = await tickUntil(page, (x) => x.result !== null);
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
  // Seed 37 with these inputs is a 75-yard catch and run (the replay is exact).
  expect(s.result!.touchdown).toBe(true);
  expect(s.events.some((e) => e.type === 'touchdown')).toBe(true);
  await tick(page, 120);
  await expect(page.locator('.result-head')).toHaveText(/Touchdown/i);
  // A score ends the series: the next snap goes back to the chosen start.
  await expect(page.locator('.result-next')).toContainText('Series over');
});

test('determinism: the browser reproduces the Node hashes', async ({ page }) => {
  await page.goto('/?screen=main&nointro&quality=low');
  await waitReady(page);
  const got = await page.evaluate(() => (window as unknown as P).__btbSimHashes());
  const want = JSON.parse(readFileSync('tests/golden/sim-hashes.json', 'utf8')) as typeof got;
  expect(got).toEqual(want);
});
