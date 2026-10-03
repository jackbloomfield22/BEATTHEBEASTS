import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// Touchdown celebrations (M7, Playtest 1 #7): a scripted touchdown in the
// Practice Field (src/game/clips.ts completion-rac), then the prompt, the
// pick, the celebration from the celebration camera, and the result card
// after it. Stills into docs/m7/shots/celeb-*; BTB_CELEB_VIDEO=1 records the
// whole beat (whistle, prompt, pick, celebration, card) to
// docs/m7/celebration-td.mp4. Every drawn frame is a fixed slice of game
// time (?video=N), so the motion is as in play however slowly this machine draws.
//   BTB_CELEB=1 BTB_PORT=5210 npx playwright test -c tools/shots/playwright.config.ts
// BTB_CELEB_ONLY=spike,leap,... limits the gallery (BTB_CELEB_ONLY=none: the prompt only).

const OUT = 'docs/m7/shots';
const VIDEO = !!process.env.BTB_CELEB_VIDEO;
const ONLY = process.env.BTB_CELEB_ONLY?.split(',');
const W = Number(process.env.BTB_CELEB_W ?? 1280);
const H = Math.round((W * 9) / 16);
const FPS = VIDEO ? 30 : 10;

type Clip = { id: string; seed: number; script(s: unknown): unknown };
type Win = {
  __btbPractice: { runner: { paused: boolean; state: { result: unknown } } | null; callClip(c: unknown): Promise<void>; tickWith(f: unknown): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbCeleb: { choose(n: number, auto: boolean): void; skip(): void };
  __btbCelebUi: { getState(): { phase: string; choices: string[] }; setState(p: object): void };
  __btbClips(): Promise<Clip[]>;
  __btbGameReady?: boolean;
  __btbRenderFrame(): void;
};
const ev = <T, A>(page: Page, f: (w: Win, a: A) => T, a?: A) => page.evaluate(`(${f.toString()})(window, ${JSON.stringify(a ?? null)})`) as Promise<T>;
const frame = (page: Page) => page.evaluate(() => (window as unknown as Win).__btbRenderFrame());

function ffmpeg(): string {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
  const py = spawnSync('python3', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())'], { encoding: 'utf8' });
  if (py.status === 0 && py.stdout.trim()) return py.stdout.trim();
  return '/opt/pw-browsers/ffmpeg-1011/ffmpeg-linux';
}

async function boot(page: Page, extra = '') {
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto(`/?screen=practice&nointro&quality=medium&video=${FPS}&seed=1${extra}`);
  await page.waitForFunction(
    () => {
      (window as unknown as { __btbRenderFrame?: () => void }).__btbRenderFrame?.();
      return (window as unknown as Win).__btbPracticeUi?.getState().stage === 'call';
    },
    null,
    { timeout: 1_800_000, polling: 500 },
  );
  if (!VIDEO) await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }' });
}

/** The touchdown, run in the page to its whistle (the dead ball and everything after it then plays frame by frame). */
async function score(page: Page) {
  await ev(page, async (w) => {
    const c = (await w.__btbClips()).find((x) => x.id === 'completion-rac')!;
    (window as unknown as { __clip: Clip }).__clip = c;
    await w.__btbPractice.callClip(c);
  });
  await page.waitForFunction(
    () => {
      (window as unknown as Win).__btbRenderFrame();
      return (window as unknown as Win).__btbGameReady === true;
    },
    null,
    { timeout: 1_800_000, polling: 1000 },
  );
  await ev(page, (w) => {
    w.__btbPractice.runner!.paused = true;
    const c = (window as unknown as { __clip: Clip }).__clip;
    for (let k = 0; k < 60 * 30 && !w.__btbPractice.runner!.state.result; k++) w.__btbPractice.tickWith(c.script(w.__btbPractice.runner!.state));
    w.__btbPractice.runner!.paused = false;
  });
}

async function until(page: Page, pred: (w: Win) => boolean, max = 900, each?: () => Promise<void>) {
  for (let n = 0; n < max; n++) {
    if (await ev(page, pred)) return n;
    await frame(page);
    if (each) await each();
  }
  return max;
}

async function still(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
}

test.use({ viewport: { width: W, height: H } });
test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

/** The gallery: each one picked from the prompt (forced into the three on offer), stills through it. */
const GALLERY: { id: string; at: number[] }[] = [
  { id: 'spike', at: [0.9, 1.5, 2.4] },
  { id: 'leap', at: [1.4, 1.9, 2.6] },
  { id: 'flex', at: [1.4, 2.2] },
  { id: 'chestBump', at: [1.0, 1.4, 2.0] },
  { id: 'kneel', at: [1.8, 2.9] },
  { id: 'flip', at: [0.9, 1.5, 2.2] },
  { id: 'point', at: [1.0, 2.0] },
  { id: 'salute', at: [1.4, 1.9] },
  { id: 'spinSpike', at: [0.7, 1.4] },
  { id: 'ballHigh', at: [1.5] },
  { id: 'jumpFist', at: [0.9] },
  { id: 'shrug', at: [0.8, 1.4] },
];

test('celebrations · the prompt, a pick, the celebration, the card', async ({ page }) => {
  test.setTimeout(14_400_000);
  // BTB_CELEB_PAD=1: the prompt in pad glyphs (A, B, X) instead of the keys.
  const PAD = !!process.env.BTB_CELEB_PAD;
  await boot(page, PAD && !VIDEO ? '&pad' : '');
  if (VIDEO) {
    const dir = 'tools/shots/out/celebrate/td';
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    let n = 0;
    const shoot = async () => void (await page.screenshot({ path: `${dir}/${String(n++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 88 }));
    // The last stride of the run, the whistle, the prompt; the choice is left to run out (the first plays by itself).
    await score(page);
    await until(page, (w) => w.__btbCelebUi.getState().phase === 'done', 600, shoot);
    // A beat of the card over it.
    for (let k = 0; k < 45; k++) {
      await frame(page);
      await shoot();
    }
    execFileSync(ffmpeg(), ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `${dir}/%04d.jpg`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'docs/m7/celebration-td.mp4']);
    console.log(`  celebration-td.mp4: ${n} frames`);
    return;
  }
  await score(page);
  await until(page, (w) => w.__btbCelebUi.getState().phase === 'choose');
  await frame(page);
  await still(page, PAD ? 'celeb-01-prompt-pad' : 'celeb-02-prompt-keys');
  // The first in the list plays out to the card (BTB_CELEB_ONLY without "card": none does).
  let first = !ONLY || ONLY.includes('card');
  let scored = true;
  for (const g of GALLERY) {
    if (ONLY && !ONLY.includes(g.id)) continue;
    if (!scored) {
      await score(page);
      await until(page, (w) => w.__btbCelebUi.getState().phase === 'choose');
    }
    scored = false;
    await ev(page, (w, id: string) => {
      const ui = w.__btbCelebUi.getState();
      w.__btbCelebUi.setState({ choices: [id, ...ui.choices.filter((c) => c !== id)].slice(0, 3) });
      w.__btbCeleb.choose(0, false);
    }, g.id);
    let t = 0;
    for (const at of g.at) {
      while (t < at) {
        await frame(page);
        t += 1 / FPS;
      }
      await still(page, `celeb-${g.id}-${at.toFixed(1)}`);
    }
    if (first) {
      // The first plays out to the card (the team-mate's high five on the way); the rest are skipped once shot (frames are slow here).
      first = false;
      await until(page, (w) => w.__btbCelebUi.getState().phase === 'done');
      for (let k = 0; k < 15; k++) await frame(page); // the camera eases back under the card
      await still(page, 'celeb-03-after-card');
    } else await ev(page, (w) => w.__btbCeleb.skip());
  }
});
