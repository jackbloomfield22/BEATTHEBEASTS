import { expect, test, type Page } from '@playwright/test';
import { trackErrors, waitReady } from './helpers';

// Every game ends on its results (the bug: a Classic game could end with no
// results screen and no way back to it). A full Classic game from the real
// draft flow to the results, its box score tabs, the Locker Room's Last Game
// board and History; then the other endings: overtime, the two-minute drill
// running out, and leaving from the pause menu on the final play. The sim is
// stepped tick by tick (the software renderer's frames are slow); every
// card is answered with the keyboard, as a player would.

type Rec = { id: string; end: string; ot: number; clock: string; score: { user: number; beasts: number }; grade: { grade: string } | null; userDrives: { result: string }[]; box: { plays: number }; playOfGame: unknown };
type M = { round: number; ot: number; phase: string; score: { user: number; beasts: number }; cfg: { drives: number }; clock: { quarter: number; secs: number; live: boolean; timeouts: number }; sit: { los: number; ballY: number; down: number; toGo: number }; lastWhistle: string };
type W = {
  __btbDraft: { getState(): { phase: string; finishWalkout(go: (s: string) => void): void } };
  __btbApp: { getState(): { screen: string; go(s: string): void } };
  __btbGameUi: { getState(): { stage: string; paused: boolean; record: Rec | null; match: M | null }; setState(p: object): void };
  __btbGame: { match: M | null };
  __btbHistory: { getState(): { records: Rec[] } };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbPractice: { runner: { paused: boolean; state: { result: unknown } } | null; tick(n: number): void };
  __btbSettings: { getState(): { set(f: (d: { gameplay: { gameLength: number } }) => void): void } };
  __btbGameReady?: boolean;
};

/** Run `f(window)` in the page (the function's source is sent; it can't close over test variables). */
const ev = <T>(page: Page, f: (w: W) => T) => page.evaluate(`(${f.toString()})(window)`) as Promise<T>;
const gameStage = (page: Page) => ev(page, (w) => w.__btbGameUi.getState().stage);
const practiceStage = (page: Page) => ev(page, (w) => w.__btbPracticeUi.getState().stage);
const screen = (page: Page) => ev(page, (w) => w.__btbApp.getState().screen);

/** A screenshot for review (tools/shots/out/results/): CSS entrances end first (they stall between software-rendered frames). */
async function shot(page: Page, name: string) {
  await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `tools/shots/out/results/${name}.png` });
}

/** Wait for the snap, hike it, step the sim until the result card; throw to the first read after the drop. */
async function playSnap(page: Page, opts: { beforeReport?: () => Promise<void>; hold?: boolean } = {}) {
  await page.waitForFunction(() => (window as unknown as W).__btbPracticeUi.getState().stage === 'presnap' && (window as unknown as W).__btbGameReady === true, null, { timeout: 150_000 });
  await ev(page, (w) => void (w.__btbPractice.runner!.paused = true));
  await page.keyboard.press('Space'); // snap
  for (let k = 0; k < 400; k++) {
    if (opts.beforeReport && (await ev(page, (w) => !!w.__btbPractice.runner?.state.result))) return opts.beforeReport();
    await page.evaluate((n) => (window as unknown as W).__btbPractice.tick(n), opts.beforeReport ? 3 : 30);
    if ((await practiceStage(page)) === 'result') return;
    if (!opts.hold && k === (opts.beforeReport ? 50 : 5)) await page.keyboard.press('Digit1');
  }
  throw new Error('the play never ended');
}

/** Answer every card until the match is final (or `until` says stop). */
async function playOn(page: Page, until?: () => Promise<boolean>, snap: { hold?: boolean } = {}) {
  let snaps = 0;
  for (let step = 0; step < 1500; step++) {
    const st = await gameStage(page);
    if (st === 'final' || (await screen(page)) !== 'game') return snaps;
    if (until && (await until())) return snaps;
    if (st === 'loading') await page.waitForTimeout(500);
    else if (st === 'meanwhile' || st === 'fourth' || st === 'try') {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    } else if (st === 'call') {
      await page.keyboard.press('Enter');
      await playSnap(page, snap);
      snaps++;
    } else if (st === 'play') {
      if ((await practiceStage(page)) === 'result') await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    } else await page.waitForTimeout(500); // kick (autokick) and punt cuts run themselves
  }
  throw new Error('the game never ended');
}

async function expectResults(page: Page) {
  await page.waitForFunction(() => (window as unknown as W).__btbApp.getState().screen === 'results', null, { timeout: 60_000 });
  await expect(page.locator('.res-score')).toBeVisible();
  // The reveal lands, then the box score opens.
  await expect(page.locator('.rep-tabs')).toBeVisible({ timeout: 30_000 });
}

/** Straight to kickoff with the saved roster (the Locker Room's walk-out, without the camera move). */
async function kickoff(page: Page) {
  await ev(page, (w) => w.__btbDraft.getState().finishWalkout((s) => w.__btbApp.getState().go(s)));
  await page.waitForFunction(() => (window as unknown as W).__btbApp.getState().screen === 'game' && !!(window as unknown as W).__btbGame.match, null, { timeout: 120_000 });
}

/** Skip to the last round's play call: `secs` on the live clock, the ball on the 20, this score. */
async function lastSnapWith(page: Page, secs: number, score: { user: number; beasts: number }) {
  await playOn(page, async () => (await gameStage(page)) === 'call');
  await page.evaluate(
    ([s, u, b]) => {
      const w = window as unknown as W;
      const m = w.__btbGame.match!;
      m.round = m.cfg.drives;
      m.clock = { quarter: 4, secs: s, live: true, timeouts: 0 };
      m.score = { user: u, beasts: b };
      m.sit = { los: 20, ballY: 0, down: 1, toGo: 10 };
      m.lastWhistle = 'stops';
      w.__btbGameUi.setState({ match: m, v: Math.random() });
    },
    [secs, score.user, score.beasts] as const,
  );
}

test('Classic: the real draft, a full game, the results and box score, the Locker Room and History', async ({ page }) => {
  test.setTimeout(5_400_000);
  const errors = trackErrors(page);
  const t0 = Date.now();
  await page.goto('/?screen=main&nointro&quality=low&autokick');
  await waitReady(page);
  // Play (Classic) from the main menu, Auto-Draft in the locker room, walk out.
  await expect(page.locator('.menu-item.is-focused')).toContainText('Play');
  await expect(page.locator('.menu-item.is-focused')).toContainText('Classic');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as W).__btbDraft.getState().phase === 'intro', null, { timeout: 180_000 });
  await page.keyboard.press('KeyR'); // Auto-Draft
  await page.waitForFunction(() => (window as unknown as W).__btbDraft.getState().phase === 'complete', null, { timeout: 60_000 });
  await page.keyboard.press('Enter'); // Walk out
  await page.waitForFunction(() => (window as unknown as W).__btbApp.getState().screen === 'game', null, { timeout: 600_000 });
  const snaps = await playOn(page);
  expect(snaps).toBeGreaterThan(6);
  // The record exists the moment the match is final, before any navigation.
  const rec = await ev(page, (w) => w.__btbGameUi.getState().record);
  expect(rec?.end).toBe('final');
  expect(await ev(page, (w) => w.__btbHistory.getState().records[0]?.id)).toBe(rec!.id);
  await expectResults(page);
  console.log(`classic game: ${snaps} snaps, ${rec!.score.user}-${rec!.score.beasts}, ${Math.round((Date.now() - t0) / 60000)} min`);

  // Every tab of the box score.
  await expect(page.locator('.pog')).toBeVisible();
  await expect(page.locator('.drive-chart')).toBeVisible();
  for (const [tab, sel] of [
    ['Passing & Rushing', 'text=Rating'],
    ['Receiving', 'text=YAC'],
    ['O-Line', 'text=Run-block win rate'],
    ['The Beasts', 'text=Coverage snapshot'],
  ] as const) {
    await page.keyboard.press('KeyE');
    await expect(page.locator('.tab.is-active')).toHaveText(tab);
    await expect(page.locator(`.rep-body >> ${sel}`).first()).toBeVisible();
  }
  // It survives a reload: History has it.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('btb3d:history.v1') ?? '[]') as { id: string }[]);
  expect(stored[0]?.id).toBe(rec!.id);

  // The Locker Room: the last game on the board, the full box score a key away.
  await page.keyboard.press('Enter'); // Locker Room (the first action)
  await page.waitForFunction(() => (window as unknown as W).__btbDraft.getState().phase === 'viewing', null, { timeout: 120_000 });
  await expect(page.locator('.last-game')).toBeVisible();
  await expect(page.locator('.last-game .lg-score')).toContainText(`Contenders ${rec!.score.user}`);
  await page.keyboard.press('KeyF');
  await expect(page.locator('.report-overlay .rep-tabs')).toBeVisible();
  await page.keyboard.press('KeyE');
  await expect(page.locator('.report-overlay .tab.is-active')).toHaveText('Passing & Rushing');
  await page.keyboard.press('Escape');
  await expect(page.locator('.report-overlay')).toHaveCount(0);
  await expect(page.locator('.last-game')).toBeVisible();

  // History: the game is there, and opens to its box score.
  await ev(page, (w) => w.__btbApp.getState().go('main'));
  await expect(page.locator('.main-menu')).toBeVisible();
  await page.keyboard.press('ArrowUp'); // wraps to History
  await expect(page.locator('.menu-item.is-focused')).toContainText('History');
  await page.keyboard.press('Enter');
  await expect(page.locator('.hist-row')).toHaveCount(1);
  await page.keyboard.press('Enter');
  await expectResults(page);
  await expect(page.locator('.res-actions')).toContainText('Back to History');
  await page.keyboard.press('Escape');
  await expect(page.locator('.history-screen')).toBeVisible();
  expect(errors).toEqual([]);
});

test('every other ending reaches the results: overtime, the two-minute drill running out, leaving from the pause menu on the final play', async ({ page }) => {
  test.setTimeout(5_400_000);
  const errors = trackErrors(page);
  await page.goto('/?screen=main&nointro&quality=low&autokick');
  await waitReady(page);
  await ev(page, (w) => w.__btbSettings.getState().set((d) => void (d.gameplay.gameLength = 4)));
  // The Classic draft (Auto-Draft), saved as the Locker Room's roster.
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as W).__btbDraft.getState().phase === 'intro', null, { timeout: 180_000 });
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => (window as unknown as W).__btbDraft.getState().phase === 'complete', null, { timeout: 60_000 });

  // 1. The two-minute drill runs out: a second left, down 7, on your 20.
  let t = Date.now();
  await kickoff(page);
  await lastSnapWith(page, 1, { user: 0, beasts: 7 });
  await playOn(page, undefined, { hold: true }); // he holds it: the snap outlasts the last second
  let rec = await ev(page, (w) => w.__btbGameUi.getState().record);
  expect(rec?.end).toBe('final');
  expect(rec?.clock).toBe('FINAL');
  expect(rec?.userDrives.at(-1)?.result).toBe('EndOfGame');
  await expectResults(page);
  console.log(`two-minute expiry: ${rec!.score.user}-${rec!.score.beasts}, ${Math.round((Date.now() - t) / 1000)} s`);
  await ev(page, (w) => w.__btbApp.getState().go('main'));

  // 2. Overtime: tied with a second left, the snap runs the clock out, then overtime to a result.
  t = Date.now();
  await kickoff(page);
  await lastSnapWith(page, 1, { user: 3, beasts: 3 });
  await playOn(page, undefined, { hold: true });
  rec = await ev(page, (w) => w.__btbGameUi.getState().record);
  expect(rec?.end).toBe('final');
  expect(rec?.ot).toBeGreaterThanOrEqual(1);
  expect(rec?.clock).toMatch(/^FINAL\/\d*OT$/);
  expect(rec?.score.user).not.toBe(rec?.score.beasts);
  await expectResults(page);
  await expect(page.locator('.res-grade .ot')).toBeVisible();
  await shot(page, 'overtime-results');
  console.log(`overtime: ${rec!.score.user}-${rec!.score.beasts} (${rec!.clock}), ${Math.round((Date.now() - t) / 1000)} s`);
  await ev(page, (w) => w.__btbApp.getState().go('main'));

  // 3. The final play's whistle, then Esc and Leave game from the pause menu: it's a final, on the results.
  t = Date.now();
  await kickoff(page);
  await lastSnapWith(page, 1, { user: 0, beasts: 3 });
  await page.keyboard.press('Enter'); // call the play
  await playSnap(page, {
    hold: true, // he holds it: the snap outlasts the last second
    beforeReport: async () => {
      // The whistle has blown; the dead-ball hold is still running. Pause.
      await page.keyboard.press('Escape');
      await expect(page.locator('.game-pause')).toBeVisible();
      await shot(page, 'pause-final-play');
      await page.keyboard.press('ArrowDown');
      await expect(page.locator('.game-pause .menu-item.is-focused')).toContainText('Leave game');
      await page.keyboard.press('Enter');
    },
  });
  await expectResults(page);
  rec = await ev(page, (w) => w.__btbGameUi.getState().record);
  // The last snap counted: the clock ran out on it, so the game is a final, not "left early".
  expect(rec?.box.plays).toBe(1);
  expect(rec?.end).toBe('final');
  expect(rec?.clock).toBe('FINAL');
  await expect(page.locator('.res-banner')).toHaveText('Defeat');
  console.log(`pause on the final play: ${rec!.end} ${rec!.score.user}-${rec!.score.beasts} (${rec!.clock}), ${Math.round((Date.now() - t) / 1000)} s`);

  // 4. Esc during a snap brings the pause menu (it used to freeze the game with nothing on screen); Resume carries on.
  await ev(page, (w) => w.__btbApp.getState().go('main'));
  await kickoff(page);
  await playOn(page, async () => (await gameStage(page)) === 'call');
  // Over a card (the play call): Esc pauses, Esc resumes.
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-pause')).toBeVisible();
  await shot(page, 'pause-play-call');
  await expect(page.locator('.game-call')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-pause')).toHaveCount(0);
  await expect(page.locator('.game-call')).toBeVisible();
  // During a snap.
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as W).__btbPracticeUi.getState().stage === 'presnap' && (window as unknown as W).__btbGameReady === true, null, { timeout: 150_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-pause')).toBeVisible();
  expect(await practiceStage(page)).toBe('paused');
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-pause')).toHaveCount(0);
  expect(await practiceStage(page)).toBe('presnap');
  // Leaving mid-game still lands on the results, as it stood.
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-pause')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expectResults(page);
  rec = await ev(page, (w) => w.__btbGameUi.getState().record);
  expect(rec?.end).toBe('left');
  await expect(page.locator('.res-banner')).toHaveText('Left early');

  const n = await ev(page, (w) => w.__btbHistory.getState().records.length);
  expect(n).toBe(4);
  expect(errors).toEqual([]);
});
