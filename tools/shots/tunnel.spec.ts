import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// The tunnel reveal (M7; docs/m7/TUNNEL.md): a full draft in the locker
// room, the walk-out, and the reveal in the stadium (the run-out, the
// Beasts, the face-off) to the pre-game card, recorded frame by frame
// (?video=N: every drawn frame is 1/N s of game time, so it plays at real
// speed however slowly this machine renders), with a still at each beat.
//   BTB_TUNNEL=1 BTB_PORT=5293 npx playwright test -c tools/shots/playwright.config.ts
// BTB_TUNNEL_FPS (30), BTB_TUNNEL_W (1280), BTB_TUNNEL_QUALITY (medium),
// BTB_TUNNEL_SEED (7), BTB_TUNNEL_MODE (classic | quick: the fast version),
// BTB_TUNNEL_TAG names the output: docs/m7/tunnel[-tag].mp4 and
// docs/m7/shots/tunnel[-tag]-*.png. BTB_TUNNEL_NOVIDEO=1 takes the stills only.

const FPS = Number(process.env.BTB_TUNNEL_FPS ?? 30);
const W = Number(process.env.BTB_TUNNEL_W ?? 1280);
const H = Math.round((W * 9) / 16);
const QUALITY = process.env.BTB_TUNNEL_QUALITY ?? 'medium';
const SEED = Number(process.env.BTB_TUNNEL_SEED ?? 7);
const MODE = process.env.BTB_TUNNEL_MODE ?? 'classic';
const TAG = process.env.BTB_TUNNEL_TAG ? `-${process.env.BTB_TUNNEL_TAG}` : MODE === 'quick' ? '-fast' : '';
const VIDEO = !process.env.BTB_TUNNEL_NOVIDEO;
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

type W = {
  __btbRenderFrame(): void;
  __btbDraft: { getState(): { phase: string; mode: string }; setState(p: object): void };
  __btbRevealUi: { getState(): { open: boolean; shot: string | null; beat: number } };
  __btbGameUi: { getState(): { stage: string } };
};

const state = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as W;
    const r = w.__btbRevealUi?.getState();
    return { phase: w.__btbDraft.getState().phase, open: !!r?.open, shot: r?.shot ?? null, beat: r?.beat ?? 0, stage: w.__btbGameUi?.getState().stage ?? null };
  });

test('the tunnel reveal', async ({ page }) => {
  test.setTimeout(14_400_000);
  await page.setViewportSize({ width: W, height: H });
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto(`/?screen=draft&nointro&quality=${QUALITY}&video=${FPS}&seed=${SEED}&fill=9&room=pregame`);
  await pump(page, `window.__btbReady === true && window.__btbDraft?.getState().phase === 'complete'`);
  if (MODE === 'quick') await page.evaluate(() => (window as unknown as W).__btbDraft.setState({ mode: 'quick' }));
  const dir = `tools/shots/out/video/tunnel${TAG}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  mkdirSync(`${OUT}/shots`, { recursive: true });
  let n = 0;
  const frame = async () => {
    await page.evaluate(() => (window as unknown as W).__btbRenderFrame());
    if (VIDEO) await page.screenshot({ path: `${dir}/${String(n).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 88 });
    n++;
  };
  for (let k = 0; k < FPS / 2; k++) await frame(); // the full row
  await page.evaluate(() => (window as unknown as W).__btbDraft.setState({ phase: 'walkout', focus: null, wallBeasts: null }));
  const stills = new Set<string>();
  const still = async (name: string) => {
    if (stills.has(name)) return;
    stills.add(name);
    await page.screenshot({ path: `${OUT}/shots/tunnel${TAG}-${name}.png` });
  };
  let lastKey = '';
  let keyAt = 0;
  let after = -1;
  for (let i = 0; i < FPS * 60; i++) {
    await frame();
    const s = await state(page);
    if (i === Math.round(FPS * 3)) await still('room');
    const key = `${s.shot}:${s.beat}`;
    if (key !== lastKey) {
      lastKey = key;
      keyAt = n;
    }
    // A still a beat into each shot and each graphic (the lower thirds have come up).
    if (s.open && s.shot && s.shot !== 'hold' && n - keyAt === Math.round(FPS * 0.9)) await still(`${s.shot}-${s.beat}`);
    if (s.shot === 'tunnel' && n - keyAt === Math.round(FPS * 0.15) && s.beat === 0) await still('tunnel-light');
    if (!s.open && s.stage === 'pregame' && s.phase !== 'walkout') {
      if (after < 0) after = n;
      if (n - after === Math.round(FPS * 1.5)) await still('pregame');
      if (n - after > FPS * 2) break;
    }
  }
  if (VIDEO) execFileSync(ffmpeg(), ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}/%04d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', `${OUT}/tunnel${TAG}.mp4`]);
});
