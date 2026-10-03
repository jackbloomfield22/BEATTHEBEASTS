import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// The broadcast overlay and commentary (M7, GDD §11.4 and §11.7): one game,
// stepped frame by frame (?video=N: every drawn frame is 1/N s of game time,
// however slowly this machine renders), with a still of each state at
// 1920×1080 and again at 2560×1440 (the viewport is resized for the second
// still, so both are the same moment):
//   pregame, the Meanwhile card, the play call, pre-snap,
//   a big play's lower third (a touchdown: the prompt, the celebration, the
//   card), the try, the kick with its wind flag, its result, and the next Beasts
//   possession as the montage (its key play and board shot).
// The big play is a scripted clip (src/game/clips.ts) run inside the game, so
// the match scores it as any snap.
//   BTB_OVERLAY=1 BTB_PORT=5295 npx playwright test -c tools/shots/playwright.config.ts
// BTB_OVERLAY_OUT names the folder under tools/shots/out/overlay (before / after).

const OUT = `tools/shots/out/overlay/${process.env.BTB_OVERLAY_OUT ?? 'after'}`;
const FPS = 15;
const SEED = Number(process.env.BTB_OVERLAY_SEED ?? 7);
const QUALITY = process.env.BTB_OVERLAY_QUALITY ?? 'medium';
const SIZES = (process.env.BTB_OVERLAY_SIZES ?? '1920x1080,2560x1440').split(',').map((s) => s.split('x').map(Number) as [number, number]);

type Clip = { id: string; seed: number; los: number; script(s: unknown): unknown };
type Win = {
  __btbPractice: { runner: { paused: boolean; state: { result: unknown } } | null; callClip(c: unknown): Promise<void>; tickWith(f: unknown): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbGame: { match: { sit: { los: number; down: number; toGo: number; ballY: number } } | null };
  __btbGameUi: { getState(): { stage: string; outcome: string | null }; setState(p: object): void };
  __btbCeleb: { choose(n: number, auto: boolean): void; skip(): void };
  __btbCelebUi: { getState(): { phase: string } };
  __btbMontageUi: { getState(): { open: boolean; shot: string | null } };
  __btbSettings: { getState(): { set(f: (d: { gameplay: { beastsDrives: string } }) => void): void } };
  __btbClips(): Promise<Clip[]>;
  __btbGameReady?: boolean;
  __btbRenderFrame(): void;
};
const ev = <T, A>(page: Page, f: (w: Win, a: A) => T, a?: A) => page.evaluate(`(${f.toString()})(window, ${JSON.stringify(a ?? null)})`) as Promise<T>;
const frame = (page: Page) => page.evaluate(() => (window as unknown as Win).__btbRenderFrame());
const frames = async (page: Page, n: number) => {
  for (let k = 0; k < n; k++) await frame(page);
};

async function until(page: Page, pred: (w: Win) => boolean, max = 900) {
  for (let n = 0; n < max; n++) {
    if (await ev(page, pred)) return true;
    await frame(page);
  }
  return false;
}

/** The same moment at each size: resize, a frame for the canvas, the still. */
async function still(page: Page, name: string) {
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await frames(page, 2);
    await page.screenshot({ path: `${OUT}/${name}-${h}p.png` });
  }
  await page.setViewportSize({ width: SIZES[0]![0], height: SIZES[0]![1] });
  await frame(page);
  console.log(`  ${name}`);
}

test('broadcast overlay', async ({ page }) => {
  test.setTimeout(14_400_000);
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: SIZES[0]![0], height: SIZES[0]![1] });
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto(`/?screen=draft&nointro&quality=${QUALITY}&video=${FPS}&seed=${SEED}&fill=9`);
  await page.waitForFunction(
    () => {
      (window as unknown as { __btbRenderFrame?: () => void }).__btbRenderFrame?.();
      const w = window as unknown as { __btbReady?: boolean; __btbDraft?: { getState(): { phase: string } } };
      return w.__btbReady === true && w.__btbDraft?.getState().phase === 'complete';
    },
    null,
    { timeout: 1_800_000, polling: 500 },
  );
  await page.evaluate(() => {
    const w = window as unknown as { __btbDraft: { getState(): { finishWalkout(go: (s: string) => void): void } }; __btbApp: { getState(): { go(s: string): void } } };
    w.__btbDraft.getState().finishWalkout(w.__btbApp.getState().go);
  });
  await until(page, (w) => w.__btbGameUi?.getState().stage === 'pregame' && w.__btbGameReady === true, 3000);
  await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }' });
  await frames(page, 20);
  await page.waitForTimeout(1200);
  await still(page, '01-pregame');

  // The Beasts' first possession as the Meanwhile card (held for the still: its 5.6 s timer is real time, these frames are slow).
  await ev(page, (w) => w.__btbSettings.getState().set((d) => void (d.gameplay.beastsDrives = 'card')));
  await page.evaluate(() => {
    const st = window.setTimeout;
    (window as unknown as { setTimeout: unknown }).setTimeout = (f: () => void, ms?: number, ...a: unknown[]) => st(f, ms === 5600 ? 1e9 : ms, ...a);
  });
  await page.keyboard.press('Enter');
  if (await until(page, (w) => w.__btbGameUi.getState().stage === 'meanwhile', 600)) {
    await frames(page, 4);
    await still(page, '02-meanwhile-card');
    await page.keyboard.press('Enter');
  }

  // The play call, then pre-snap.
  await until(page, (w) => w.__btbGameUi.getState().stage === 'call', 600);
  await frames(page, 6);
  await page.waitForTimeout(800);
  await still(page, '04-playcall');
  await page.keyboard.press('Enter');
  await until(page, (w) => w.__btbPracticeUi.getState().stage === 'presnap' && w.__btbGameReady === true, 1200);
  await frames(page, 20);
  await page.waitForTimeout(800);
  await still(page, '05-presnap');

  // A big play: a scripted clip run inside the game, from its own spot.
  const order = (process.env.BTB_OVERLAY_CLIPS ?? 'go,completion-rac,post').split(',');
  let scored = false;
  for (const id of order) {
    await ev(page, async (w, cid: string) => {
      const c = (await w.__btbClips()).find((x) => x.id === cid)!;
      (window as unknown as { __clip: Clip }).__clip = c;
      const m = w.__btbGame.match!;
      m.sit = { ...m.sit, los: c.los, down: 1, toGo: 10, ballY: 0 };
      await w.__btbPractice.callClip(c);
      w.__btbGameUi.setState({ stage: 'play' });
    }, id);
    await until(page, (w) => w.__btbGameReady === true && w.__btbPracticeUi.getState().stage === 'presnap', 600);
    await ev(page, (w) => {
      w.__btbPractice.runner!.paused = true;
      const c = (window as unknown as { __clip: Clip }).__clip;
      for (let k = 0; k < 60 * 30 && !w.__btbPractice.runner!.state.result; k++) w.__btbPractice.tickWith(c.script(w.__btbPractice.runner!.state));
      w.__btbPractice.runner!.paused = false;
    });
    // The whistle has blown; the game hears the result after the dead-ball hold (a touchdown's prompt comes sooner).
    await until(page, (w) => w.__btbCelebUi.getState().phase === 'choose' || w.__btbPracticeUi.getState().stage === 'result', 600);
    const td = (await ev(page, (w) => w.__btbCelebUi.getState().phase)) === 'choose';
    console.log(`  clip ${id}: ${td ? 'touchdown' : await ev(page, (w) => w.__btbGameUi.getState().outcome)}`);
    if (td) {
      scored = true;
      break;
    }
    // Not a score: its result card (a big gain still gets the lower third), then on.
    await frames(page, 10);
    await still(page, `06-result-${id}`);
    await page.keyboard.press('Enter');
    await until(page, (w) => w.__btbGameUi.getState().stage === 'call', 600);
  }
  if (scored) {
    await until(page, (w) => w.__btbCelebUi.getState().phase === 'choose', 600);
    await frame(page);
    await still(page, '07-td-prompt');
    await ev(page, (w) => w.__btbCeleb.choose(0, false));
    await frames(page, Math.round(FPS * 1.4));
    await still(page, '08-td-lowerthird');
    await until(page, (w) => w.__btbCelebUi.getState().phase === 'done', 900);
    await frames(page, 12);
    await still(page, '09-td-result');
    await page.keyboard.press('Enter');
    await until(page, (w) => w.__btbGameUi.getState().stage === 'try', 300);
    await frames(page, 4);
    await still(page, '10-try');
    await page.keyboard.press('Enter');
    await until(page, (w) => w.__btbGameUi.getState().stage === 'kick', 300);
    await frames(page, 20);
    await page.waitForTimeout(600);
    await still(page, '11-kick-aim');
    await page.keyboard.down('Space');
    await page.waitForTimeout(900);
    await page.keyboard.up('Space');
    // The flight and the call come on real time (KickPanel's timers).
    for (let k = 0; k < 40; k++) {
      await frame(page);
      if (await page.locator('.kick-result').count()) break;
    }
    await frames(page, 3);
    await still(page, '12-kick-result');
  }
  // The next Beasts possession as the montage: its key play, then the board shot.
  await ev(page, (w) => w.__btbSettings.getState().set((d) => void (d.gameplay.beastsDrives = 'montage')));
  if (!(await until(page, (w) => w.__btbMontageUi.getState().shot === 'play', 4000))) return;
  await frames(page, 12);
  await still(page, '13-montage-play');
  if (!(await until(page, (w) => w.__btbMontageUi.getState().shot === 'board' || w.__btbGameUi.getState().stage !== 'meanwhile', 4000))) return;
  if ((await ev(page, (w) => w.__btbMontageUi.getState().shot)) !== 'board') return;
  await frames(page, 15);
  await still(page, '14-montage-board');
});
