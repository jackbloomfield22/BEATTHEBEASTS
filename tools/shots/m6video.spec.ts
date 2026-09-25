import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// The M6 gate videos, recorded frame by frame at ?video=30 (every drawn
// frame is 1/30 s of game time, so they play at real speed however slowly
// this machine renders):
//   pick   one pick dressing its locker: the reels on the video wall, the
//          camera to the stall, the nameplate, jersey, helmet, gloves,
//          towel, cleats and stickers, and the hologram's signature move;
//   walk   the ninth locker done: the pull back down the row and the walk
//          out of the tunnel into the stadium;
//   drive  a full drive in a game, from the Meanwhile cut to the end of the
//          possession, with scripted input.
//   BTB_M6VIDEO=pick npx playwright test -c tools/shots/playwright.config.ts
// Output: docs/screenshots/m6/<name>.mp4

const OUT = 'docs/screenshots/m6';
const FPS = 30;
const QUALITY = process.env.BTB_VIDEO_QUALITY ?? 'medium';

type Win = {
  __btbRenderFrame(): void;
  __btbDraft: { getState(): { phase: string; spin(): unknown; offers(): Record<string, { slot: string | null; ovr: number }[]>; pick(c: unknown): unknown; setPhase(p: string): void; draft: { roster: Record<string, unknown> } | null }; setState(p: object): void };
};

function ffmpeg(): string {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
  const py = spawnSync('python3', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())'], { encoding: 'utf8' });
  if (py.status === 0 && py.stdout.trim()) return py.stdout.trim();
  throw new Error('No ffmpeg: install it, set $FFMPEG, or `pip install imageio-ffmpeg`.');
}

async function recorder(page: Page, name: string) {
  const dir = `tools/shots/out/video/${name}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let n = 0;
  return {
    async frames(k: number) {
      for (let i = 0; i < k; i++) {
        await page.evaluate(() => (window as unknown as Win).__btbRenderFrame());
        await page.screenshot({ path: `${dir}/${String(n++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 88 });
      }
    },
    encode() {
      mkdirSync(OUT, { recursive: true });
      execFileSync(ffmpeg(), ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}/%04d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', `${OUT}/${name}.mp4`]);
    },
  };
}

const pump = (page: Page, pred: string) =>
  page.waitForFunction(
    (p) => {
      (window as unknown as { __btbRenderFrame?: () => void }).__btbRenderFrame?.();
      return new Function(`return (${p})`)() as boolean;
    },
    pred,
    { timeout: 600_000, polling: 250 },
  );

const which = (process.env.BTB_M6VIDEO ?? 'pick').split(',');

test.describe.configure({ timeout: 7_200_000 });

if (which.includes('pick'))
  test('pick: a locker dresses itself', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/?screen=draft&nointro&quality=${QUALITY}&video=${FPS}&seed=7&fill=4&room=pregame`);
    await pump(page, `window.__btbReady === true && window.__btbDraft?.getState().phase === 'ready'`);
    const rec = await recorder(page, 'pick');
    await rec.frames(30); // the row, settled
    await page.evaluate(() => (window as unknown as Win).__btbDraft.getState().spin());
    await rec.frames(Math.round(FPS * 3)); // the reels on the video wall
    await page.evaluate(() => (window as unknown as Win).__btbDraft.getState().setPhase('choosing'));
    await rec.frames(Math.round(FPS * 1.5));
    await page.evaluate(() => {
      const d = (window as unknown as Win).__btbDraft.getState();
      const all = Object.values(d.offers()).flat().filter((c) => c.slot);
      d.pick(all.sort((a, b) => b.ovr - a.ovr)[0]);
    });
    await rec.frames(Math.round(FPS * 5.2)); // the camera to the stall, the dressing, the hologram
    await page.evaluate(() => (window as unknown as Win).__btbDraft.setState({ phase: 'ready', focus: null }));
    await rec.frames(Math.round(FPS * 1.6)); // back to the row
    rec.encode();
  });

if (which.includes('walk'))
  test('walk: the pull back and the walk out to the field', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/?screen=draft&nointro&quality=${QUALITY}&video=${FPS}&seed=7&fill=9&room=pregame`);
    await pump(page, `window.__btbReady === true && window.__btbDraft?.getState().phase === 'complete'`);
    const rec = await recorder(page, 'walk');
    await rec.frames(45);
    await page.evaluate(() => (window as unknown as Win).__btbDraft.setState({ phase: 'walkout', focus: null, wallBeasts: null }));
    await rec.frames(Math.round(FPS * 10.5));
    rec.encode();
  });
