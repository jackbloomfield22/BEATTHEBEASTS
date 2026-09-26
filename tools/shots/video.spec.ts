import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// The feel videos (M5.5): each scripted clip (src/game/clips.ts) played in
// the Practice Field from the broadcast camera and recorded frame by frame.
// Every rendered frame is exactly 1/30 s of game time (?video=30): the sim
// steps two ticks, the animation and the cameras step 1/30 s, so the video
// runs at real speed however slowly this machine renders it. The frames are
// encoded with ffmpeg (on the PATH, $FFMPEG, or `pip install imageio-ffmpeg`).
// The pop meter's log (?pops) goes next to each video.
//   BTB_VIDEO=1 npm run shots                 all three clips
//   BTB_VIDEO=1 BTB_CLIP=sack npm run shots   one clip
//   BTB_VIDEO=1 BTB_CONCEPTS=1 npm run shots  the M6.5 broadcast concepts (BTB_CLIP picks one)
// Output: docs/screenshots/m5.5/<clip>.mp4 and <clip>.pops.json (the concepts: docs/screenshots/m6.5/).
// BTB_VIDEO_FPS sets the frame rate (the concepts default to 20: this
// container renders ~2 frames a minute, and 20 still reads a cut).

const CONCEPTS = !!process.env.BTB_CONCEPTS;
const OUT = CONCEPTS ? 'docs/screenshots/m6.5' : 'docs/screenshots/m5.5';
const FPS = Number(process.env.BTB_VIDEO_FPS ?? (CONCEPTS ? 20 : 30));
const TICKS_PER_FRAME = 60 / FPS;
/** Frames before the snap (the camera settles on the formation) and after the whistle (the dead ball, the get-up). */
const LEAD_IN = Math.round(FPS * 1.2);
const TAIL = Math.round(FPS * 2.5);
/** Frame size (BTB_VIDEO_W, 16:9): the concepts record at 960 wide here, where a frame takes seconds to draw. */
const W = Number(process.env.BTB_VIDEO_W ?? 1280);
const H = Math.round((W * 9) / 16);
/** Quality tier for the recording (Low renders fastest here; the look is judged on the screenshots). */
const QUALITY = process.env.BTB_VIDEO_QUALITY ?? 'medium';

type Clip = { id: string; title: string };
type Win = {
  __btbPractice: { runner: { paused: boolean; state: { result: unknown; tick: number; phase: string } } | null; callClip(c: unknown): void; tickWith(f: unknown): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbGameReady?: boolean;
  __btbClips(): Promise<(Clip & { script(s: unknown): unknown })[]>;
  __btbPops: { frames: number; spikes: unknown[]; worst: number; rates: number[] };
};

function ffmpeg(): string {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
  const py = spawnSync('python3', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())'], { encoding: 'utf8' });
  if (py.status === 0 && py.stdout.trim()) return py.stdout.trim();
  throw new Error('No ffmpeg: install it, set $FFMPEG, or `pip install imageio-ffmpeg`.');
}

// Draw exactly one frame of the new state (in video mode the page only draws when asked).
const frame = (page: Page) => page.evaluate(() => (window as unknown as { __btbRenderFrame(): void }).__btbRenderFrame());

async function record(page: Page, clip: Clip) {
  const dir = `tools/shots/out/video/${clip.id}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // No tutorial card in the videos.
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto(`/?screen=practice&nointro&quality=${QUALITY}&video=${FPS}&pops&seed=1`);
  // The page only draws when asked: keep it drawing while it loads.
  const pump = (pred: string) =>
    page.waitForFunction(
      (p) => {
        (window as unknown as { __btbRenderFrame?: () => void }).__btbRenderFrame?.();
        return new Function(`return (${p})`)() as boolean;
      },
      pred,
      { timeout: 300_000, polling: 250 },
    );
  await pump(`window.__btbPracticeUi?.getState().stage === 'call'`);
  await page.evaluate(async (id) => {
    const w = window as unknown as Win;
    const c = (await w.__btbClips()).find((x) => x.id === id)!;
    w.__btbPractice.callClip(c);
  }, clip.id);
  await pump('window.__btbGameReady === true');
  await page.evaluate(() => void ((window as unknown as Win).__btbPractice.runner!.paused = true));
  let n = 0;
  const shot = async () => {
    await frame(page);
    await page.screenshot({ path: `${dir}/${String(n++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 88 });
  };
  // Before the snap: the formation set, the camera settling (presnap ticks, no input).
  for (let k = 0; k < LEAD_IN; k++) {
    await page.evaluate((n) => (window as unknown as Win & { __btbPractice: { tick(n: number): void } }).__btbPractice.tick(n), TICKS_PER_FRAME);
    await shot();
  }
  let tail = -1;
  for (let guard = 0; guard < 60 * 20 && tail < TAIL; guard++) {
    const done = await page.evaluate(
      async ({ id, k }) => {
        const w = window as unknown as Win;
        const c = (await w.__btbClips()).find((x) => x.id === id)!;
        for (let t = 0; t < k; t++) {
          const s = w.__btbPractice.runner!.state;
          if (s.result) break;
          w.__btbPractice.tickWith(c.script(s));
        }
        return !!w.__btbPractice.runner!.state.result;
      },
      { id: clip.id, k: TICKS_PER_FRAME },
    );
    if (done && tail < 0) tail = 0;
    if (tail >= 0) {
      // After the whistle the dead ball plays on in the render (the pull-up, the get-up): advance it by ticks too.
      await page.evaluate((k) => {
        const w = window as unknown as Win & { __btbPractice: { tick(n: number): void } };
        w.__btbPractice.tick(k);
      }, TICKS_PER_FRAME);
      tail++;
    }
    await shot();
  }
  const pops = await page.evaluate(() => {
    const p = (window as unknown as Win).__btbPops;
    const sorted = [...p.rates].sort((a, b) => a - b);
    return { frames: p.rates.length, worst: Math.round(p.worst), p99: Math.round(sorted[Math.floor(sorted.length * 0.99)] ?? 0), spikes: p.spikes };
  });
  writeFileSync(`${OUT}/${clip.id}.pops.json`, JSON.stringify(pops, null, 1) + '\n');
  execFileSync(ffmpeg(), ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}/%04d.jpg`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${OUT}/${clip.id}.mp4`]);
  console.log(`${clip.id}: ${n} frames, pops worst ${pops.worst} rad/s, ${pops.spikes.length} spikes`);
}

const CONCEPT_IDS = ['slant', 'out', 'curl', 'go', 'post', 'corner', 'crosser', 'screen', 'back-shoulder', 'scramble-drill'];
const IDS = (CONCEPTS ? CONCEPT_IDS : ['completion-rac', 'sack', 'broken-tackle']).filter((id) => !process.env.BTB_CLIP || process.env.BTB_CLIP === id);
test.use({ viewport: { width: W, height: H } });
for (const id of IDS) {
  test(`feel video · ${id}`, async ({ page }) => {
    if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
    await record(page, { id, title: id });
  });
}
