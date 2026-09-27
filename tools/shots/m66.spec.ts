import { readFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// M6.6 (draft, locker room, post-game, box score): one long session, stills
// only (software GL is slow). The draft with four picks in and a pair on the
// wall (the O-line card, a struck-through full position), the full row with
// the depth chart, a stall's stickers, the O-line stall, the Beasts on the
// wall, the reels, a new draft's rules card; the main menu; the one-screen
// box score at 1920×1080 and 1280×720; My Team and its box score; the
// pre-game moment. A real six-round game record (record-fixture.ts) is put
// in History first. Into tools/shots/out/m66.
//
//   node tools/run-ts.mjs tools/shots/record-fixture.ts 13
//   BTB_M66=1 npx playwright test -c tools/shots/playwright.config.ts
// BTB_ONLY=draft,menu,results,myteam,pregame limits the parts.

const OUT = 'tools/shots/out/m66';
const ONLY = process.env.BTB_ONLY?.split(',');
const want = (k: string) => !ONLY || ONLY.includes(k);
const record = readFileSync('tools/shots/fixtures/record.json', 'utf8');

type W = {
  __btbDraft: { getState(): Record<string, unknown> & { draft: { roster: Record<string, unknown>; pair: unknown } | null; spin(): void; pick(c: unknown): void; offers(): Record<string, { slot: unknown; ovr: number }[]>; setFocus(s: string | null): void; setWallBeasts(p: number | null): void; view(): Promise<boolean>; begin(m: string): Promise<void>; finishWalkout(go: (s: string) => void): void }; setState(p: object): void };
  __btbApp: { getState(): { go(s: string): void } };
  __btbHistory: { setState(p: object): void };
  __btbGameUi: { getState(): { stage: string } };
  __btbGameReady?: boolean;
};
const ev = <T,>(page: Page, f: (w: W) => T) => page.evaluate(`(${f.toString()})(window)`) as Promise<T>;

async function shot(page: Page, name: string, settle = 3000) {
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 240_000 });
}

test('m6.6 draft, locker, post-game', async ({ page }) => {
  test.setTimeout(7_200_000);
  await page.addInitScript((rec) => {
    try {
      localStorage.setItem('btb3d:history.v1', `[${rec}]`);
    } catch {
      /* no storage */
    }
  }, record);
  await page.goto(`/?screen=draft&shot=menu&nointro&seed=7&room=pregame&lighting=golden&quality=${process.env.BTB_QUALITY ?? 'medium'}&fill=4`);
  await page.waitForFunction(() => (window as unknown as { __btbReady?: boolean }).__btbReady === true, null, { timeout: 900_000 });
  await page.waitForFunction(() => {
    const d = (window as unknown as W).__btbDraft;
    return !!d && d.getState().phase !== 'loading' && Object.keys(d.getState().draft?.roster ?? {}).length === 4;
  }, null, { timeout: 300_000 });
  // CSS entrances end at once (they stall between software-rendered frames).
  await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }' });

  if (want('draft')) {
    // A pair with a line on the wall: the Dallas 1990s (Aikman, Smith, Irvin, Novacek and the line).
    await ev(page, (w) => {
      const st = w.__btbDraft.getState();
      st.draft!.pair = { t: 'DAL', d: '1990s' };
      w.__btbDraft.setState({ phase: 'choosing', version: (st.version as number) + 1, focus: null, wallBeasts: null });
    });
    await page.waitForSelector('.pick-list li');
    await page.hover('.pick-list li:has(.pl-pos:text-is("OL"))');
    await shot(page, 'draft-pick-ol', 5000);
    const full = await page.$('.pick-list li.is-full');
    if (full) {
      await full.hover();
      await shot(page, 'draft-pick-full', 1500);
    }
    // The rest of the draft (best available), then the full row with the depth chart.
    await ev(page, (w) => {
      const st = w.__btbDraft.getState();
      st.draft!.pair = null;
      for (let i = 0; i < 9 && Object.keys(st.draft!.roster).length < 9; i++) {
        w.__btbDraft.getState().spin();
        const all = Object.values(w.__btbDraft.getState().offers()).flat().filter((c) => c.slot);
        const best = all.sort((a, b) => b.ovr - a.ovr)[0];
        if (best) w.__btbDraft.getState().pick(best);
      }
      w.__btbDraft.setState({ phase: 'complete', focus: null, wallBeasts: null, lastPick: null, instantSeq: (w.__btbDraft.getState().instantSeq as number) + 1 });
    });
    await shot(page, 'draft-complete-depth', 9000);
    await ev(page, (w) => w.__btbDraft.setState({ phase: 'ready', focus: 'WR1' }));
    await shot(page, 'stall-wr-stickers', 6000);
    await ev(page, (w) => w.__btbDraft.setState({ phase: 'ready', focus: 'QB' }));
    await shot(page, 'stall-qb-stickers', 6000);
    await ev(page, (w) => w.__btbDraft.setState({ phase: 'ready', focus: 'OL' }));
    await shot(page, 'stall-ol-stickers', 6000);
    await ev(page, (w) => w.__btbDraft.setState({ phase: 'ready', focus: null, wallBeasts: 0 }));
    await shot(page, 'wall-beasts', 7000);
  }

  if (want('menu')) {
    await ev(page, (w) => w.__btbApp.getState().go('main'));
    await page.waitForSelector('.main-menu');
    await shot(page, 'main-menu', 5000);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await shot(page, 'main-menu-last-game', 2500);
  }

  if (want('results')) {
    await ev(page, (w) => {
      w.__btbHistory.setState({ viewing: null, from: 'menu' });
      w.__btbApp.getState().go('results');
    });
    await page.waitForSelector('.bx');
    await shot(page, 'box-score-1080', 4000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await shot(page, 'box-score-720', 4000);
    await page.setViewportSize({ width: 1920, height: 1080 });
  }

  if (want('myteam')) {
    await ev(page, (w) => {
      void w.__btbDraft
        .getState()
        .view()
        .then(() => w.__btbApp.getState().go('draft'));
    });
    await page.waitForSelector('.draft-slots-wrap.is-depth');
    await shot(page, 'my-team', 8000);
    await page.keyboard.press('KeyF');
    await page.waitForSelector('.report-overlay');
    await shot(page, 'my-team-box-score', 2500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
  }

  if (want('draft')) {
    // A new draft: the rules card while the Beasts are on the wall.
    await ev(page, (w) => {
      void w.__btbDraft.getState().begin('classic');
      w.__btbApp.getState().go('draft');
    });
    await page.waitForSelector('.rules-card');
    await shot(page, 'draft-rules-card', 8000);
    // The reels on the wall, held (the harness would otherwise go straight to the pick panel).
    await ev(page, (w) => {
      w.__btbDraft.setState({ setPhase: () => undefined });
      w.__btbDraft.getState().spin();
      w.__btbDraft.setState({ phase: 'spinning' });
    });
    await shot(page, 'draft-reels', 7000);
  }

  if (want('pregame')) {
    await ev(page, (w) => {
      const st = w.__btbDraft.getState();
      for (let i = 0; i < 9 && Object.keys(st.draft!.roster).length < 9; i++) {
        w.__btbDraft.getState().spin();
        const all = Object.values(w.__btbDraft.getState().offers()).flat().filter((c) => c.slot);
        const best = all.sort((a, b) => b.ovr - a.ovr)[0];
        if (best) w.__btbDraft.getState().pick(best);
      }
      w.__btbDraft.getState().finishWalkout((s) => w.__btbApp.getState().go(s));
    });
    await page.waitForFunction(() => (window as unknown as W).__btbGameUi.getState().stage === 'pregame' && (window as unknown as W).__btbGameReady === true, null, { timeout: 600_000 });
    await shot(page, 'pregame', 10000);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => (window as unknown as W).__btbGameUi.getState().stage === 'meanwhile', null, { timeout: 60_000 });
    await shot(page, 'pregame-after-kickoff', 2000);
  }
});
