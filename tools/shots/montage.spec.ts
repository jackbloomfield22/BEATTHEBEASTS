import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// The Beasts' drive montage (M7, Playtest 1 #4; docs/m7/MONTAGE.md): a game
// started straight from a full draft, kicked off, and the Beasts' first
// possession's montage recorded frame by frame (?video=30: every drawn
// frame is 1/30 s of game time, so it plays at real speed however slowly
// this machine renders), with a still of each shot.
//   BTB_MONTAGE=1 BTB_PORT=5220 npx playwright test -c tools/shots/playwright.config.ts
// BTB_MONTAGE_SEED picks the draft's seed (its game's first drive is what it
// is: the resolver decides it), BTB_MONTAGE_DRIVES records that many Beasts
// possessions (each of your drives in between is skipped by the harness:
// the match's own resolver plays the Contenders' drives out quickly).
// Output: docs/m7/montage-<seed>-<n>.mp4 and docs/m7/shots/montage-*.png.

const FPS = Number(process.env.BTB_MONTAGE_FPS ?? 30);
const W = Number(process.env.BTB_MONTAGE_W ?? 960);
const H = Math.round((W * 9) / 16);
const QUALITY = process.env.BTB_MONTAGE_QUALITY ?? 'low';
const SEED = Number(process.env.BTB_MONTAGE_SEED ?? 7);
const OUT = 'docs/m7';

function ffmpeg(): string {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
  const py = spawnSync('python3', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())'], { encoding: 'utf8' });
  if (py.status === 0 && py.stdout.trim()) return py.stdout.trim();
  throw new Error('No ffmpeg: install it, set $FFMPEG, or `pip install imageio-ffmpeg`.');
}

const pump = (page: Page, pred: string) =>
  page.waitForFunction(
    (p) => {
      (window as unknown as { __btbRenderFrame?: () => void }).__btbRenderFrame?.();
      return new Function(`return (${p})`)() as boolean;
    },
    pred,
    { timeout: 900_000, polling: 250 },
  );

const frame = (page: Page) => page.evaluate(() => (window as unknown as { __btbRenderFrame(): void }).__btbRenderFrame());
const ui = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __btbMontageUi: { getState(): { open: boolean; shot: string | null; info: { drive: { result: string } } | null } }; __btbGameUi: { getState(): { stage: string } } };
    const m = w.__btbMontageUi.getState();
    return { open: m.open, shot: m.shot, result: m.info?.drive.result ?? null, stage: w.__btbGameUi.getState().stage };
  });

test('the Beasts drive montage', async ({ page }) => {
  test.setTimeout(14_400_000);
  await page.setViewportSize({ width: W, height: H });
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto(`/?screen=draft&nointro&quality=${QUALITY}&video=${FPS}&seed=${SEED}&fill=9&autokick`);
  await pump(page, `window.__btbReady === true && window.__btbDraft?.getState().phase === 'complete'`);
  // Straight to the game (the walk-out has its own video).
  await page.evaluate(() => {
    const w = window as unknown as { __btbDraft: { getState(): { finishWalkout(go: (s: string) => void): void } }; __btbApp: { getState(): { go(s: string): void } } };
    w.__btbDraft.getState().finishWalkout(w.__btbApp.getState().go);
  });
  await pump(page, `['pregame', 'meanwhile'].includes(window.__btbGameUi?.getState().stage) && window.__btbGameReady === true`);
  await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }' });
  if ((await ui(page)).stage === 'pregame') {
    for (let k = 0; k < 40; k++) await frame(page);
    await page.waitForTimeout(1200);
    await page.keyboard.press('Enter');
  }
  const drives = Number(process.env.BTB_MONTAGE_DRIVES ?? 1);
  mkdirSync(`${OUT}/shots`, { recursive: true });
  for (let n = 1; n <= drives; n++) {
    await pump(page, `window.__btbMontageUi.getState().open || window.__btbGameUi.getState().stage !== 'meanwhile'`);
    const dir = `tools/shots/out/video/montage-${n}`;
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    let i = 0;
    let last = '';
    let result = '';
    const stillAt: Record<string, number> = {};
    for (; i < 900; i++) {
      const u = await ui(page);
      if (!u.open) break;
      result = u.result ?? result;
      await frame(page);
      await page.screenshot({ path: `${dir}/${String(i).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 88 });
      // A still a few frames into each shot (the camera has cut and the graphic is up).
      if (u.shot !== last) {
        last = u.shot ?? '';
        stillAt[last] = i + Math.round(FPS * (last === 'play' ? 1.3 : 0.3));
      }
      for (const [shot, f] of Object.entries(stillAt)) if (f === i) await page.screenshot({ path: `${OUT}/shots/montage-${SEED}-${n}-${shot}.png` });
    }
    console.log(`drive ${n}: ${result}, ${i} frames (${(i / FPS).toFixed(1)} s)`);
    if (i > 0) execFileSync(ffmpeg(), ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}/%04d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', `${OUT}/montage-${SEED}-${n}.mp4`]);
    if (n < drives) {
      // Your drive: let the match play it out (quit the snap engine's part: every card answered with Enter, every snap a quick pass).
      for (let k = 0; k < 400; k++) {
        const u = await ui(page);
        if (u.stage === 'meanwhile' || u.stage === 'final') break;
        if (u.stage === 'call' || u.stage === 'fourth' || u.stage === 'try' || u.stage === 'break' || u.stage === 'penalty') await page.keyboard.press('Enter');
        if (u.stage === 'play') {
          await page.keyboard.press('Space');
          for (let f = 0; f < 6; f++) await frame(page);
          await page.keyboard.press('Digit1');
          await page.keyboard.press('Enter');
        }
        await frame(page);
      }
    }
  }
});
