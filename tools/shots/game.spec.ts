import { test, type Page } from '@playwright/test';

// The game screens (M6 gate): the play call with the
// coordinator's Suggested tab, a snap with the officials set, the fourth-down
// card, the kick set, a punt and the results screen (the Meanwhile cut is in
// the drive video). Quick Play from the menu,
// played the way the browser test does; each stage is captured the first
// time it shows (?shot: cameras cut straight to their pose, so a slow
// software-rendered frame still shows the shot as played). Into tools/shots/out/game.

type W = {
  __btbDraft: { getState(): { phase: string; begin(mode: string, o?: { seed?: number }): Promise<void>; finishWalkout(go: (s: string) => void): void } };
  __btbApp: { getState(): { screen: string; go(s: string): void } };
  __btbGameUi: { getState(): { stage: string } };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbPractice: { runner: { paused: boolean } | null; tick(n: number): void };
  __btbGameReady?: boolean;
};

const OUT = 'tools/shots/out/game';
/** Each stage's root element in GameScreen.tsx (the Meanwhile cut advances itself under ?shot). */
const ROOT: Record<string, string> = { call: '.game-call', fourth: '.decision-card', try: '.decision-card', kick: '.kick-panel', punt: '.meanwhile', final: '.meanwhile.final' };
// animations: 'disabled' ends CSS entrances (the menus' screen-in), which
// don't advance between this machine's slow software-rendered frames.
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' });

test('game screens', async ({ page }) => {
  test.setTimeout(3_600_000);
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto(`/?screen=main&nointro&quality=${process.env.BTB_QUALITY ?? 'medium'}&shot=practice`);
  await page.waitForFunction(() => (window as unknown as { __btbReady?: boolean }).__btbReady === true, null, { timeout: 300_000 });
  await page.evaluate(() => {
    const w = window as unknown as W;
    void w.__btbDraft.getState().begin('quick', { seed: 11 });
    w.__btbApp.getState().go('draft');
  });
  // Quick Play drafts all nine, then walks out; the walk-out has its own
  // video (m6video.spec.ts), so once it starts, cut straight to kickoff.
  await page.waitForFunction(() => ['walkout', 'complete'].includes((window as unknown as W).__btbDraft.getState().phase), null, { timeout: 600_000 });
  await page.evaluate(() => {
    const w = window as unknown as W;
    if (w.__btbApp.getState().screen !== 'game') w.__btbDraft.getState().finishWalkout(w.__btbApp.getState().go);
  });
  await page.waitForFunction(() => (window as unknown as W).__btbApp.getState().screen === 'game', null, { timeout: 600_000 });
  const seen = new Set<string>();
  const stage = () => page.evaluate(() => (window as unknown as W).__btbGameUi.getState().stage);
  const pstage = () => page.evaluate(() => (window as unknown as W).__btbPracticeUi.getState().stage);
  const snap = async () => {
    await page.waitForFunction(() => (window as unknown as W).__btbPracticeUi.getState().stage === 'presnap' && (window as unknown as W).__btbGameReady === true, null, { timeout: 300_000 });
    await page.evaluate(() => void ((window as unknown as W).__btbPractice.runner!.paused = true));
    if (!seen.has('presnap')) {
      seen.add('presnap');
      await page.waitForTimeout(3000);
      await shot(page, 'presnap');
    }
    await page.keyboard.press('Space');
    for (let k = 0; k < 120 && (await pstage()) !== 'result'; k++) {
      await page.evaluate(() => (window as unknown as W).__btbPractice.tick(30));
      if (k === 5) await page.keyboard.press('Digit1');
    }
    if (!seen.has('result')) {
      seen.add('result');
      await page.waitForTimeout(2500);
      await shot(page, 'result');
    }
    await page.keyboard.press('Enter');
  };
  for (let step = 0; step < 400; step++) {
    const st = await stage();
    if (st === 'final') break;
    if (!seen.has(st) && st !== 'loading' && st !== 'play' && st !== 'meanwhile') {
      seen.add(st);
      // The store flips before React draws the stage (slow frames here), so
      // wait for its element, then give the scene a moment to settle.
      await page.waitForSelector(ROOT[st] ?? 'body', { timeout: 120_000 }).catch(() => null);
      await page.waitForTimeout(st === 'kick' ? 2500 : 1200);
      if ((await stage()) === st) await shot(page, st);
      continue;
    }
    if (st === 'kick') {
      // Hold to build power, release to strike (GameScreen's KickPanel).
      await page.keyboard.down('Space');
      await page.waitForTimeout(1250);
      await page.keyboard.up('Space');
      await page.waitForFunction(() => (window as unknown as W).__btbGameUi.getState().stage !== 'kick', null, { timeout: 120_000 });
    } else if (st === 'fourth' || st === 'try') await page.keyboard.press('Enter');
    // (The Meanwhile cut ends itself under ?shot; an Enter here would land on the play call.)
    else if (st === 'call') {
      await page.keyboard.press('Enter');
      await snap();
    } else if (st === 'play') {
      const p = await pstage();
      if (p === 'presnap') await snap();
      else if (p === 'result') await page.keyboard.press('Enter');
      else await page.waitForTimeout(300);
    } else await page.waitForTimeout(500);
    await page.waitForTimeout(200);
  }
  await page.waitForFunction(() => (window as unknown as W).__btbApp.getState().screen === 'results', null, { timeout: 60_000 });
  await page.waitForTimeout(3000);
  await shot(page, 'results');
});
