import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// The instant replay (M7; quick and hands-off since the owner's call after
// M7): scripted plays (src/game/clips.ts) in the Practice Field, then their
// replays: the result card's offer, the replay angle at the moment (a beat
// before it, the touch of slow motion through it), held Shift (3x), the
// skip and the hand-back to the card; a big hit; and the results screen's
// play of the game. Stills into docs/m7/shots; with BTB_REPLAY_VIDEO=1 the
// touchdown's replay is recorded instead (docs/m7/replay-quick.mp4): it
// plays at 1x through the moment, Shift is held for a beat, then Space
// skips it. Every drawn frame is 1/30 s of game time (?video=30), so the
// replay runs at its own speeds however slowly this machine draws.
//   BTB_REPLAY=1 BTB_PORT=5391 npx playwright test -c tools/shots/playwright.config.ts
// BTB_REPLAY_ONLY=td,hit,results limits the parts; BTB_REPLAY_CLIP picks the
// first part's clip (default 'touchdown': completion-rac no longer scores
// since the m66 passing round re-drew its throw).

const OUT = 'docs/m7/shots';
const VIDEO = !!process.env.BTB_REPLAY_VIDEO;
const ONLY = process.env.BTB_REPLAY_ONLY?.split(',');
const want = (k: string) => !ONLY || ONLY.includes(k);
const W = Number(process.env.BTB_REPLAY_W ?? 1280);
const H = Math.round((W * 9) / 16);
const QUALITY = process.env.BTB_REPLAY_QUALITY ?? 'medium';

type Clip = { id: string; seed: number; script(s: unknown): unknown };
type Player = { tick: number; start: number; end: number; key: { tick: number; label: string } | null; seeking: boolean; playing: boolean; boost: number; seek(t: number): void };
type Win = {
  __btbPractice: { runner: { paused: boolean; state: { result: unknown } } | null; callClip(c: unknown): Promise<void>; tickWith(f: unknown): void; tick(n: number): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbReplay: { player: Player | null; active: boolean; stopAt: number; openSnap(): boolean; close(): void };
  __btbReplayUi: { getState(): { open: boolean; loading: boolean; fast: boolean }; setState(p: object): void };
  __btbClips(): Promise<Clip[]>;
  __btbGameReady?: boolean;
  __btbHistory: { setState(p: object): void };
  __btbApp: { getState(): { go(s: string): void } };
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

async function still(page: Page, name: string) {
  await frame(page);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name}`);
}

async function boot(page: Page, extra = '') {
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  await page.goto(`/?screen=practice&nointro&quality=${QUALITY}&video=30&seed=1${extra}`);
  await page.waitForFunction(
    () => {
      (window as unknown as { __btbRenderFrame?: () => void }).__btbRenderFrame?.();
      return (window as unknown as Win).__btbPracticeUi?.getState().stage === 'call';
    },
    null,
    { timeout: 600_000, polling: 500 },
  );
  // CSS entrances end at once (they'd stall between the slow frames); the wipe is shot on its own.
  await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }' });
}

/** A clip (with another seed if given) played to its result card. */
async function playClip(page: Page, id: string, seed?: number) {
  await ev(page, async (w, a: { id: string; seed: number | null }) => {
    const c = (await w.__btbClips()).find((x) => x.id === a.id)!;
    const clip = a.seed === null ? c : { ...c, seed: a.seed };
    (window as unknown as { __clip: Clip }).__clip = clip;
    await w.__btbPractice.callClip(clip);
  }, { id, seed: seed ?? null });
  await page.waitForFunction(
    () => {
      (window as unknown as Win).__btbRenderFrame();
      return (window as unknown as Win).__btbGameReady === true;
    },
    null,
    { timeout: 600_000, polling: 1000 },
  );
  await ev(page, (w) => {
    w.__btbPractice.runner!.paused = true;
    const c = (window as unknown as { __clip: Clip }).__clip;
    for (let k = 0; k < 60 * 30 && !w.__btbPractice.runner!.state.result; k++) w.__btbPractice.tickWith(c.script(w.__btbPractice.runner!.state));
    for (let k = 0; k < 600 && w.__btbPracticeUi.getState().stage !== 'result'; k++) w.__btbPractice.tick(1);
  });
  // The dead ball plays on a little (the get-up) under the card.
  for (let k = 0; k < 6; k++) await frame(page);
}

/** Draw frames (each 1/30 s of the replay) until `pred` holds. */
async function until(page: Page, pred: (w: Win) => boolean, max = 600, each?: (n: number) => Promise<void>) {
  for (let n = 0; n < max; n++) {
    if (await ev(page, pred)) return n;
    await frame(page);
    if (each) await each(n);
  }
  return max;
}

test.use({ viewport: { width: W, height: H } });
test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

test('replay · a touchdown: the offer, the replay angle through the moment, held Shift, the skip, the hand-back', async ({ page }) => {
  test.skip(!want('td'));
  test.setTimeout(14_400_000);
  await boot(page);
  await playClip(page, process.env.BTB_REPLAY_CLIP ?? 'touchdown');
  if (!VIDEO) await still(page, '01-td-result-offer');
  await page.keyboard.press('KeyP');
  await frame(page);
  if (VIDEO) {
    const dir = 'tools/shots/out/replay/quick';
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    let n = 0;
    const log: string[] = [];
    const shoot = async () => {
      const at = await ev(page, (w) => (w.__btbReplay.player ? `${w.__btbReplay.player.tick} x${w.__btbReplay.player.boost}` : 'closed'));
      await page.screenshot({ path: `${dir}/${String(n++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 88 });
      log.push(`${n} ${at}`);
    };
    // 1x from the open (the wipe), through the moment and its slow motion, to 0.4 s after it.
    // (A play with nothing flagged: to a second before it would close by itself.)
    await until(page, (w) => { const p = w.__btbReplay.player; return !p || (!p.seeking && p.tick >= (p.key ? p.key.tick + 24 : w.__btbReplay.stopAt - 60)); }, 600, shoot);
    // Shift held for 0.6 s: 3x.
    await page.keyboard.down('Shift');
    for (let k = 0; k < 18; k++) {
      await frame(page);
      await shoot();
    }
    await page.keyboard.up('Shift');
    // A beat at 1x, then Space skips it: the hand-back, and a second of the card.
    for (let k = 0; k < 8; k++) {
      await frame(page);
      await shoot();
    }
    await page.keyboard.press('Space');
    for (let k = 0; k < 30; k++) {
      await frame(page);
      await shoot();
    }
    writeFileSync(`${dir}/log.txt`, log.join('\n') + '\n');
    execFileSync(ffmpeg(), ['-y', '-loglevel', 'error', '-framerate', '30', '-i', `${dir}/%04d.jpg`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'docs/m7/replay-quick.mp4']);
    console.log(`  replay-quick.mp4: ${n} frames`);
    // The video run (often at another size and quality) leaves the stills alone.
    return;
  }
  // A few ticks before the ball crosses: the replay angle.
  await until(page, (w) => !w.__btbReplay.player!.seeking && w.__btbReplay.player!.tick >= w.__btbReplay.player!.key!.tick - 8);
  await still(page, '02-td-key');
  // Held Shift: 3x (the bug says so).
  await page.keyboard.down('Shift');
  for (let k = 0; k < 3; k++) await frame(page);
  await still(page, '03-td-fast');
  await page.keyboard.up('Shift');
  // Space: skipped, on to where the play stands, and back to the card.
  await page.keyboard.press('Space');
  await until(page, (w) => !w.__btbReplay.active);
  for (let k = 0; k < 4; k++) await frame(page);
  await still(page, '04-td-back-to-card');
});

test('replay · a big hit: slow motion through the collision, pad prompts', async ({ page }) => {
  test.skip(!want('hit'));
  test.setTimeout(7_200_000);
  await boot(page, '&pad');
  // The slant against seed 29: a catch at 13 yd and a big hit (found with tests/replay.test.ts's search).
  await playClip(page, 'slant', 29);
  await still(page, '05-hit-result-offer-pad');
  await ev(page, (w) => w.__btbReplay.openSnap());
  await frame(page);
  await until(page, (w) => !!w.__btbReplay.player && !w.__btbReplay.player.seeking && w.__btbReplay.player.tick >= w.__btbReplay.player.key!.tick - 4, 400);
  await still(page, '06-hit-key-pad');
});

test('replay · the results screen plays back the play of the game', async ({ page }) => {
  test.skip(!want('results'));
  test.setTimeout(7_200_000);
  await page.goto(`/?screen=main&nointro&quality=${QUALITY}&video=30&shot=menu`);
  await page.waitForFunction(
    () => {
      (window as unknown as { __btbRenderFrame?: () => void }).__btbRenderFrame?.();
      return (window as unknown as { __btbReady?: boolean }).__btbReady === true;
    },
    null,
    { timeout: 600_000, polling: 1000 },
  );
  await page.addStyleTag({ content: '*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; }' });
  // The fixture game's record, its play of the game a long completion with its capsule (the replay system's own).
  await page.evaluate(async () => {
    const imp = (p: string) => import(/* @vite-ignore */ p);
    const sim = await imp('/src/sim/index.ts');
    const { capsuleOf } = await imp('/src/game/replay.ts');
    const { SimRunner } = await imp('/src/game/runner.ts');
    const { loadPracticeRosters } = await imp('/src/game/rosters.ts');
    const { CLIPS } = await imp('/src/game/clips.ts');
    const fixture = await (await fetch('/tools/shots/fixtures/record.json')).json();
    const R = await loadPracticeRosters();
    const c = CLIPS.find((x: { id: string }) => x.id === 'completion-rac');
    const play = sim.playById(c.play);
    const def = sim.defById(c.def);
    const s = sim.createPlay({ seed: c.seed, offense: sim.offenseFor(play, R.team), defense: sim.defenseFor(def, R.beasts), play, def, los: c.los, ballY: 0, toGo: 10, user: true, down: 1 });
    const run = new SimRunner(s);
    for (let k = 0; k < 2400 && !s.result; k++) run.step(c.script(s));
    for (let k = 0; k < 90; k++) run.step(sim.input({}));
    fixture.id = 'replay-shots';
    Object.assign(fixture.playOfGame, { headline: 'Touchdown', detail: 'Dwight Clark, 70 yards, from Montana.', playName: play.name, touchdown: true });
    fixture.playOfGame.replay.capsule = capsuleOf(s, run.frames, 1);
    const w = window as unknown as Win;
    w.__btbHistory.setState({ records: [fixture], viewing: fixture.id, from: 'history' });
    w.__btbApp.getState().go('results');
  });
  for (let k = 0; k < 6; k++) await frame(page);
  await still(page, '07-results-offer');
  await page.keyboard.press('KeyP');
  await page.waitForFunction(
    () => {
      (window as unknown as Win).__btbRenderFrame();
      return (window as unknown as Win).__btbReplayUi.getState().loading === false;
    },
    null,
    { timeout: 600_000, polling: 1000 },
  );
  await until(page, (w) => w.__btbReplay.player!.tick >= w.__btbReplay.player!.key!.tick - 20, 600);
  await still(page, '08-results-replay');
  await page.keyboard.press('Space');
  for (let k = 0; k < 4; k++) await frame(page);
  await still(page, '09-results-after');
});
