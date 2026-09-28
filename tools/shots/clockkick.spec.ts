import { test, type Page } from '@playwright/test';

// M6.6 stills: the game clock and the kick (Playtest 1 decision 1,
// Playtest 2 "Kicking"). A timed game (Classic's format, the default
// 5-minute quarters) from a Quick Play auto-draft; each moment is set up
// through the dev globals and captured once: the score bug with the
// quarter, the clock and the play clock (at the call, and red at the line),
// the delay-of-game flag, the two-minute warning, a field goal lined up
// (the aim line and the wind on the field, the meter), the charge, the
// result, a punt aimed for the sideline and its result, halftime, the
// final with the line score, and the results. Into tools/shots/out/clockkick.

type M = {
  sit: { los: number; ballY: number; down: number; toGo: number };
  phase: string;
  wind: { mph: number; dir: number };
  playClock: number | null;
  lastWhistle: string;
  clock: { quarter: number; secs: number };
  score: { user: number; beasts: number };
  byQuarter: { user: number[] };
};
type W = {
  __btbDraft: { getState(): { phase: string; begin(mode: string, o?: { seed?: number }): Promise<void>; finishWalkout(go: (s: string) => void): void }; setState(p: object): void };
  __btbApp: { getState(): { screen: string; go(s: string): void } };
  __btbGameUi: { getState(): { stage: string }; setState(p: object): void };
  __btbGame: { match: M | null; second(): void; toPhase(): void; fourth(c: string): void; endKick(): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbPractice: { runner: { paused: boolean } | null };
  __btbKick?: { aim: number; windowFrom: number; tuning: { fillMs: number; hz: number }; press(at: number): boolean };
  __btbKickStrike?: (t: number) => void;
  __btbKickNow?: number;
  __btbGameReady?: boolean;
  __btbReady?: boolean;
};

const OUT = 'tools/shots/out/clockkick';
/** Run `f(window)` in the page (its source is sent; it can't close over test variables). */
const ev = <T>(page: Page, f: (w: W) => T) => page.evaluate(`(${f.toString()})(window)`) as Promise<T>;
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png`, animations: 'disabled' });
const bump = (page: Page) => ev(page, (w) => w.__btbGameUi.setState({ v: Math.random() }));
const stageIs = (page: Page, st: string) => page.waitForFunction((s) => (window as unknown as W).__btbGameUi.getState().stage === s, st, { timeout: 300_000 });

test('clock and kicking', async ({ page }) => {
  test.setTimeout(3_600_000);
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto(`/?screen=main&nointro&quality=${process.env.BTB_QUALITY ?? 'medium'}&shot=practice`);
  await page.waitForFunction(() => (window as unknown as W).__btbReady === true, null, { timeout: 300_000 });
  await ev(page, (w) => {
    void w.__btbDraft.getState().begin('quick', { seed: 11 });
    w.__btbApp.getState().go('draft');
  });
  await page.waitForFunction(() => ['walkout', 'complete'].includes((window as unknown as W).__btbDraft.getState().phase), null, { timeout: 600_000 });
  // A timed game: the draft's mode as Classic, so the game plays the quarter setting (5 minutes by default).
  await ev(page, (w) => {
    w.__btbDraft.setState({ mode: 'classic' });
    if (w.__btbApp.getState().screen !== 'game') w.__btbDraft.getState().finishWalkout(w.__btbApp.getState().go);
  });
  await page.waitForFunction(() => (window as unknown as W).__btbApp.getState().screen === 'game' && !!(window as unknown as W).__btbGame.match, null, { timeout: 600_000 });

  // 1. The play call after the Beasts' opening drive: the quarter, the clock, the play clock.
  await stageIs(page, 'call');
  await page.waitForFunction(() => (window as unknown as W).__btbGameReady === true, null, { timeout: 300_000 });
  await page.waitForTimeout(2500);
  await shot(page, '01-call-scorebug');

  // 2. At the line, the play clock down to 4 and the game clock running: red.
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (window as unknown as W).__btbPracticeUi.getState().stage === 'presnap', null, { timeout: 300_000 });
  await ev(page, (w) => {
    w.__btbPractice.runner!.paused = true;
    const m = w.__btbGame.match!;
    m.playClock = 4;
    m.lastWhistle = 'runs';
  });
  await bump(page);
  await page.waitForTimeout(3000);
  await shot(page, '02-presnap-playclock');

  // 3. The play clock runs out at the line: the flag.
  await ev(page, (w) => {
    w.__btbGame.match!.playClock = 1;
    w.__btbGame.second();
  });
  await page.waitForSelector('.penalty-card', { timeout: 120_000 });
  await page.waitForTimeout(1500);
  await shot(page, '03-delay-of-game');
  await page.keyboard.press('Enter');
  await stageIs(page, 'call');

  // 4. The two-minute warning (a running clock crossing 2:00 in the 2nd).
  await ev(page, (w) => {
    const m = w.__btbGame.match!;
    m.clock.quarter = 2;
    m.clock.secs = 121;
    m.lastWhistle = 'runs';
    m.playClock = 20;
    w.__btbGame.second();
  });
  await page.waitForSelector('.clock-flag', { timeout: 120_000 });
  await page.waitForTimeout(1200);
  await shot(page, '04-two-minute-warning');

  // 5. A 44-yard field goal into a crosswind: the aim line, the wind, the meter.
  await ev(page, (w) => {
    const m = w.__btbGame.match!;
    m.sit = { los: 73, ballY: 0, down: 4, toGo: 6 };
    m.phase = 'fourth';
    m.wind = { mph: 11, dir: 2.0 };
    m.playClock = null;
    w.__btbGame.toPhase();
  });
  await stageIs(page, 'fourth');
  await page.waitForTimeout(1200);
  await shot(page, '05-fourth-card');
  await ev(page, (w) => w.__btbGame.fourth('fg'));
  await page.waitForSelector('.kick-panel', { timeout: 120_000 });
  await page.waitForFunction(() => !!(window as unknown as W).__btbKick, null, { timeout: 60_000 });
  await ev(page, (w) => void (w.__btbKick!.aim = -0.045));
  await page.waitForTimeout(4000);
  await shot(page, '06-fg-aim');
  // The charge, frozen for the still: pressed so the fill reaches full power as the window tops out
  // (its second peak), shown 0.3 s before that; then the strike at that moment, a clean one.
  await ev(page, (w) => {
    const k = w.__btbKick!;
    const peak = k.windowFrom + (1500 / k.tuning.hz);
    const at = peak - k.tuning.fillMs;
    k.press(at);
    w.__btbKickNow = peak - 300;
    (w as unknown as { __strikeAt: number }).__strikeAt = peak;
  });
  await page.waitForTimeout(3000);
  await shot(page, '07-fg-charge');
  await ev(page, (w) => {
    delete w.__btbKickNow;
    w.__btbKickStrike!((w as unknown as { __strikeAt: number }).__strikeAt);
  });
  await page.waitForSelector('.kick-result', { timeout: 120_000 });
  await page.waitForTimeout(2500);
  await shot(page, '08-fg-result');
  await ev(page, (w) => w.__btbGame.endKick());

  // 6. A punt from your 35, aimed for the right sideline.
  await stageIs(page, 'call');
  await ev(page, (w) => {
    const m = w.__btbGame.match!;
    m.sit = { los: 35, ballY: 0, down: 4, toGo: 7 };
    m.phase = 'fourth';
    m.playClock = null;
    w.__btbGame.fourth('punt');
  });
  await page.waitForSelector('.kick-panel', { timeout: 120_000 });
  await page.waitForFunction(() => !!(window as unknown as W).__btbKick, null, { timeout: 60_000 });
  await ev(page, (w) => void (w.__btbKick!.aim = -0.28));
  await page.waitForTimeout(4000);
  await shot(page, '09-punt-aim');
  await ev(page, (w) => {
    const k = w.__btbKick!;
    const peak = k.windowFrom + 1500 / k.tuning.hz;
    k.press(peak - k.tuning.fillMs);
    w.__btbKickStrike!(peak);
  });
  await page.waitForSelector('.kick-result.punt', { timeout: 120_000 });
  await page.waitForTimeout(3000);
  await shot(page, '10-punt-result');
  await ev(page, (w) => w.__btbGame.endKick());

  // 7. Halftime: the clock runs out in the 2nd.
  await stageIs(page, 'call');
  await ev(page, (w) => {
    const m = w.__btbGame.match!;
    m.clock.quarter = 2;
    m.clock.secs = 1;
    m.lastWhistle = 'runs';
    m.playClock = 20;
    w.__btbGame.second();
  });
  await page.waitForSelector('.halftime-card', { timeout: 120_000 });
  await page.waitForTimeout(1200);
  await shot(page, '11-halftime');
  await page.keyboard.press('Enter');

  // 8. The final (you ahead by a field goal as the 4th runs out), and the results with the line score.
  await stageIs(page, 'call');
  await ev(page, (w) => {
    const m = w.__btbGame.match!;
    const add = m.score.beasts + 3 - m.score.user;
    m.score.user += add;
    m.byQuarter.user[3] = (m.byQuarter.user[3] ?? 0) + add;
    m.clock.quarter = 4;
    m.clock.secs = 1;
    m.lastWhistle = 'runs';
    m.playClock = 20;
    w.__btbGame.second();
  });
  await page.waitForSelector('.meanwhile.final', { timeout: 120_000 });
  await page.waitForTimeout(1500);
  await shot(page, '12-final');
  await page.waitForFunction(() => (window as unknown as W).__btbApp.getState().screen === 'results', null, { timeout: 120_000 });
  await page.waitForTimeout(5000);
  await shot(page, '13-results');
});
