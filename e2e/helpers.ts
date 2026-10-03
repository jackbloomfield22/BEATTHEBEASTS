import { expect, type Page } from '@playwright/test';

type W = Window & {
  __btbReady?: boolean;
  __btbGl?: { info: { render: { frame: number } }; getContext(): WebGL2RenderingContext };
};

export async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as W).__btbReady === true, null, { timeout: 150_000 });
}

/** Wait until the renderer has drawn `n` more frames (proves the loop is alive). */
export async function waitFrames(page: Page, n = 3): Promise<void> {
  const start = await page.evaluate(() => (window as W).__btbGl?.info.render.frame ?? 0);
  await page.waitForFunction((s) => ((window as W).__btbGl?.info.render.frame ?? 0) >= s, start + n, { timeout: 120_000 });
}

/** The stage canvas exists, its WebGL context is alive and it keeps rendering. */
export async function expectStageAlive(page: Page): Promise<void> {
  const lost = await page.evaluate(() => {
    const gl = (window as W).__btbGl?.getContext();
    return !gl || gl.isContextLost();
  });
  expect(lost, 'WebGL context lost').toBe(false);
  await waitFrames(page, 2);
}

/** Collect page errors and console errors for a test. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/GL Driver Message|GPU stall/.test(m.text())) errors.push(`console: ${m.text().slice(0, 300)}`);
  });
  return errors;
}

/**
 * Automatic replays off (M7): the full-game tests answer every card with
 * Enter; a touchdown's replay rolling by itself would hold the card for a
 * long time at a software-rendered frame rate. The replay has its own test
 * (replay.spec.ts).
 */
export async function noAutoReplay(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __btbSettings: { getState(): { set(f: (d: { gameplay: { autoReplay: string } }) => void): void } } };
    w.__btbSettings.getState().set((d) => void (d.gameplay.autoReplay = 'off'));
  });
}
