import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { test, type Page } from '@playwright/test';

// The feel videos (M5.5): each scripted clip (src/game/clips.ts) played in
// the Practice Field from the broadcast camera and recorded frame by frame.
// Every rendered frame is exactly 1/30 s of game time (?video=30): the sim
// steps two ticks, the animation and the cameras step 1/30 s, so the video
// runs at real speed however slowly this machine renders it (and nothing
// steps in the screenshots' own redraws: platform.ts videoTime; each
// recording checks it, and logs its snap-to-whistle sim time against its
// video time). BTB_PORT runs it on another dev server. The frames are
// encoded with ffmpeg (on the PATH, $FFMPEG, or `pip install imageio-ffmpeg`).
// The pop meter's log (?pops) goes next to each video.
//   BTB_VIDEO=1 npm run shots                 all three clips
//   BTB_VIDEO=1 BTB_CLIP=sack npm run shots   one clip
//   BTB_VIDEO=1 BTB_CONCEPTS=1 npm run shots  the M6.5 broadcast concepts (BTB_CLIP picks one)
// Output: docs/screenshots/m5.5/<clip>.mp4 and <clip>.pops.json (the concepts: docs/screenshots/m6.5/).
// BTB_VIDEO_FPS sets the frame rate (the concepts default to 20: this
// container renders ~2 frames a minute, and 20 still reads a cut).

const CONCEPTS = !!process.env.BTB_CONCEPTS;
// BTB_IDENTITY=1: the side-by-side identity pairs (Playtest 2): each pair's
// two clips (<pair>-a, <pair>-b: the same play with one man swapped) are
// recorded, then put side by side in <pair>.mp4.
const IDENTITY = !!process.env.BTB_IDENTITY;
// BTB_PHYSICS=1: the tackling videos (docs/physics/TACKLING.md; src/game/clips.ts PHYSICS).
const PHYSICS = !!process.env.BTB_PHYSICS;
// BTB_PASSING=1: the passing-game clips (docs/passing/PASSING.md), into
// docs/passing/<BTB_PASSING_TAG> (before / after), so the same plays can be
// compared across a change.
const PASSING = !!process.env.BTB_PASSING;
// BTB_PASSING2=1: passing round 2's clips (docs/passing/PASSING2.md; src/game/clips.ts PASSING2), each on a
// close camera on its man (`?follow`), into docs/passing/round2/<BTB_PASSING_TAG>.
const PASSING2 = !!process.env.BTB_PASSING2;
// BTB_PASSING3=1: passing round 3's clips (docs/passing/PASSING3.md; src/game/clips.ts PASSING3), the player's own
// throws from the default broadcast camera (BTB_FOLLOW=slot,... rides one man instead), at 30 fps, into
// docs/passing/round3/<BTB_PASSING_TAG>.
const PASSING3 = !!process.env.BTB_PASSING3;
// BTB_PASSING4=1: passing round 4's clips (docs/passing/PASSING4.md; src/game/clips.ts PASSING4), as round 3's, into docs/passing/round4/<BTB_PASSING_TAG>.
const PASSING4 = !!process.env.BTB_PASSING4;
// BTB_PASSING5=1: passing round 5's catches (docs/passing/PASSING5.md; src/game/clips.ts PASSING5), as round 3's, into
// docs/passing/round5/<BTB_PASSING_TAG>; BTB_FOLLOW=1 records each from the close camera on its catcher (FOLLOW5).
const PASSING5 = !!process.env.BTB_PASSING5;
const FOLLOW5: Record<string, string> = {
  'p5-hands': 'X,4,-4,1.8,40',
  'p5-body': 'X,4,-4,1.8,40',
  'p5-high': 'X,-4,-4,1.8,40',
  'p5-low': 'SLOT,4,-4,1.6,40',
  'p5-scoop': 'Z,-4,4,1.6,40',
  'p5-reach': 'SLOT,4,-4,1.8,40',
  'p5-contested': 'TE,4,5,1.9,42',
  'p5-highpoint': 'X,6,-5,2.2,42',
  'p5-shoulder': 'Z,6,5,2.2,42',
  'p5-toetap': 'X,2,6,1.8,40',
};
const FOLLOW: Record<string, string> = {
  'p2-drop5': 'QB,3,-6,2.2,38',
  'p2-drop3': 'QB,3,-6,2.2,38',
  'p2-drop7': 'QB,3,-7,2.4,40',
  'p2-drop5-ai': 'QB,3,-6,2.2,38',
  'p2-drop7-ai': 'QB,3,-7,2.4,40',
  'p2-gun-slant': 'QB,3,-6,2.2,38',
  'p2-head-slant': 'X,5,-5,2,42',
  'p2-shoulder': 'Z,7,5,2.4,45',
  'p2-bobble': 'X,5,-5,2,42',
  'p2-lookoff-a': 'QB,-13,0,13,55,13',
  'p2-lookoff-b': 'QB,-13,0,13,55,13',
  'p2-arm-a': 'QB,22,36,8,50,22',
  'p2-arm-b': 'QB,22,36,8,50,22',
};
const OUT = PASSING5 ? `docs/passing/round5/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING4 ? `docs/passing/round4/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING3 ? `docs/passing/round3/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING2 ? `docs/passing/round2/${process.env.BTB_PASSING_TAG ?? 'after'}` : PHYSICS ? 'docs/physics' : PASSING ? `docs/passing/${process.env.BTB_PASSING_TAG ?? 'after'}` : IDENTITY ? 'docs/screenshots/m6.5/identity' : CONCEPTS ? 'docs/screenshots/m6.5' : 'docs/screenshots/m5.5';
const FPS = Number(process.env.BTB_VIDEO_FPS ?? (CONCEPTS || IDENTITY || PASSING || PASSING2 || PHYSICS ? 20 : 30));
const TICKS_PER_FRAME = 60 / FPS;
/** Frames before the snap (the camera settles on the formation) and after the whistle (the dead ball, the get-up). */
const LEAD_IN = Math.round(FPS * (PASSING || PASSING2 || PASSING3 || PASSING4 || PASSING5 ? 0.6 : 1.2));
const TAIL = Math.round(FPS * (PASSING || PASSING2 || PASSING3 || PASSING4 || PASSING5 ? 0.6 : 2.5));
/** The passing clips stop this long (s) after the ball is caught or dead: the catch and the first steps after it are the moment (this container draws a frame in several seconds). */
const AFTER_BALL = PASSING || PASSING2 || PASSING3 || PASSING4 || PASSING5 ? Number(process.env.BTB_AFTER_BALL ?? 1.8) : Infinity;
/** Frame size (BTB_VIDEO_W, 16:9): the concepts record at 960 wide here, where a frame takes seconds to draw. */
const W = Number(process.env.BTB_VIDEO_W ?? 1280);
const H = Math.round((W * 9) / 16);
/** Quality tier for the recording (Low renders fastest here; the look is judged on the screenshots). */
const QUALITY = process.env.BTB_VIDEO_QUALITY ?? 'medium';

type Clip = { id: string; title: string };
type Win = {
  __btbPractice: { runner: { paused: boolean; state: { result: unknown; tick: number; phase: string } } | null; callClip(c: unknown): void | Promise<void>; tickWith(f: unknown): void };
  __btbPracticeUi: { getState(): { stage: string } };
  __btbGameReady?: boolean;
  __btbClips(): Promise<(Clip & { script(s: unknown): unknown })[]>;
  __btbPops: { frames: number; spikes: unknown[]; worst: number; rates: number[] };
  __btbLatency: { frame: number };
};

/** What the scene has stepped so far: its frames (GameScene's count) and the sim's ticks. */
const clocks = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as Win;
    return { frames: w.__btbLatency.frame, tick: w.__btbPractice.runner!.state.tick };
  });

function ffmpeg(): string {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  if (spawnSync('ffmpeg', ['-version']).status === 0) return 'ffmpeg';
  const py = spawnSync('python3', ['-c', 'import imageio_ffmpeg as f; print(f.get_ffmpeg_exe())'], { encoding: 'utf8' });
  if (py.status === 0 && py.stdout.trim()) return py.stdout.trim();
  throw new Error('No ffmpeg: install it, set $FFMPEG, or `pip install imageio-ffmpeg`.');
}

/**
 * BTB_DIAG=1 (passing round 5): a per-frame log of the catch next to the
 * frames (tools/shots/out/video/<clip>/diag.json): the sim's ball and the
 * drawn one, and for the man it's thrown to (then the carrier) what he's
 * playing and where his hands are (world m).
 */
const DIAG = !!process.env.BTB_DIAG;
function diagFrame(n: number) {
  type V = { x: number; y: number; z: number };
  type B = { player: { root: { position: V & { clone(): V }; rotation: { y: number } }; bones: Map<string, { getWorldPosition(v: V): V }> }; catchClip: string | null; animator: { transition: { name: string; t: number } | null; overlayAction: { name: string; t: number } | null; holdLayer?: { name: string; w: number } | null; actionLayer?: { name: string; w: number } | null } };
  const w = window as unknown as { __btbBodies?: B[]; __btbBall?: { position: V }; __btbPractice: { runner: { state: { t: number; phase: string; carrier: number; ball: { mode: string; target: number; pos: V; arrive: number } } } } };
  const s = w.__btbPractice.runner.state;
  const i = s.ball.target >= 0 ? s.ball.target : s.carrier;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const out: Record<string, unknown> = { n, t: r2(s.t), phase: s.phase, mode: s.ball.mode, i, arrive: r2(s.ball.arrive), simBall: [r2(s.ball.pos.x), r2(s.ball.pos.y), r2(s.ball.pos.z)] };
  const ball = w.__btbBall?.position;
  if (ball) out.ball = [r2(ball.x), r2(ball.y), r2(ball.z)];
  const b = i >= 0 ? w.__btbBodies?.[i] : undefined;
  if (b) {
    const p = (name: string) => {
      const bone = b.player.bones.get(name);
      if (!bone) return null;
      const v = bone.getWorldPosition(b.player.root.position.clone());
      return [r2(v.x), r2(v.y), r2(v.z)];
    };
    const a = b.animator;
    Object.assign(out, { clip: b.catchClip, trans: a.transition && [a.transition.name, r2(a.transition.t)], ovl: a.overlayAction && [a.overlayAction.name, r2(a.overlayAction.t)], act: a.actionLayer && [a.actionLayer.name, r2(a.actionLayer.w)], hold: a.holdLayer && [a.holdLayer.name, r2(a.holdLayer.w)], root: [r2(b.player.root.position.x), r2(b.player.root.position.z), r2(b.player.root.rotation.y)], fl: p('fingers_01_l'), fr: p('fingers_01_r'), chest: p('spine_04'), head: p('head') });
  }
  return out;
}

// Draw exactly one frame of the new state (in video mode the page only draws when asked).
const frame = (page: Page) => page.evaluate(() => (window as unknown as { __btbRenderFrame(): void }).__btbRenderFrame());

async function record(page: Page, clip: Clip) {
  const dir = `tools/shots/out/video/${clip.id}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // No tutorial card in the videos.
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  const follow = PASSING5 && process.env.BTB_FOLLOW && FOLLOW5[clip.id] ? `&follow=${FOLLOW5[clip.id]}` : PASSING2 && FOLLOW[clip.id] ? `&follow=${FOLLOW[clip.id]}` : (PASSING3 || PASSING4) && process.env.BTB_FOLLOW ? `&follow=${process.env.BTB_FOLLOW}` : '';
  await page.goto(`/?screen=practice&nointro&quality=${QUALITY}&video=${FPS}&pops&seed=1${follow}`);
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
    await w.__btbPractice.callClip(c);
  }, clip.id);
  await pump('window.__btbGameReady === true');
  await page.evaluate(() => void ((window as unknown as Win).__btbPractice.runner!.paused = true));
  let n = 0;
  const start = await clocks(page);
  const diag: unknown[] = [];
  const shot = async () => {
    await frame(page);
    if (DIAG) diag.push(await page.evaluate(diagFrame, n));
    await page.screenshot({ path: `${dir}/${String(n++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 88 });
  };
  // Before the snap: the formation set, the camera settling. Drawn frames
  // only, no sim ticks: the play snaps on its first tick, as in Node (time
  // before the snap changes the play).
  for (let k = 0; k < LEAD_IN; k++) await shot();
  let tail = -1;
  let whistle = { frames: 0, ticks: 0 };
  let ballDone = -1;
  let wasAir = false;
  for (let guard = 0; guard < 60 * 20 && tail < TAIL; guard++) {
    if (tail < 0 && ballDone >= 0 && n - ballDone >= AFTER_BALL * FPS) break;
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
    const phase = await page.evaluate(() => (window as unknown as Win).__btbPractice.runner!.state.phase);
    if (phase === 'air') wasAir = true;
    else if (wasAir && ballDone < 0) ballDone = n;
    if (done && tail < 0) {
      tail = 0;
      // The snap to the whistle: frames LEAD_IN .. n (this one included), the sim's ticks to here.
      whistle = { frames: n + 1 - LEAD_IN, ticks: (await clocks(page)).tick - start.tick };
    }
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
  // The recording's own check: one scene step per recorded frame, none in the screenshots'
  // redraws (platform.ts videoTime; a recording that ran fast: docs/m7/MONTAGE.md).
  const end = await clocks(page);
  if (end.frames - start.frames !== n) throw new Error(`${clip.id}: the scene stepped ${end.frames - start.frames} times for ${n} recorded frames`);
  console.log(
    `${clip.id}: snap to whistle ${whistle.ticks} sim ticks = ${(whistle.ticks / 60).toFixed(3)} s, on ${whistle.frames} frames = ${(whistle.frames / FPS).toFixed(3)} s of video; ` +
      `whole clip ${n} frames = ${(n / FPS).toFixed(2)} s (${(LEAD_IN / FPS).toFixed(1)} s before the snap, ${(TAIL / FPS).toFixed(1)} s after the whistle), ${end.tick - start.tick} ticks, ${end.frames - start.frames} scene steps`,
  );
  const pops = await page.evaluate(() => {
    const p = (window as unknown as Win).__btbPops;
    const sorted = [...p.rates].sort((a, b) => a - b);
    return { frames: p.rates.length, worst: Math.round(p.worst), p99: Math.round(sorted[Math.floor(sorted.length * 0.99)] ?? 0), spikes: p.spikes };
  });
  writeFileSync(`${OUT}/${clip.id}.pops.json`, JSON.stringify(pops, null, 1) + '\n');
  if (DIAG) writeFileSync(`${dir}/diag.json`, JSON.stringify(diag) + '\n');
  execFileSync(ffmpeg(), ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}/%04d.jpg`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${OUT}/${clip.id}.mp4`]);
  console.log(`${clip.id}: ${n} frames, pops worst ${pops.worst} rad/s, ${pops.spikes.length} spikes`);
  // BTB_KEEP_FRAMES unset: the frames go once they're encoded (a 20-fps clip is ~20 MB of JPEGs; disk was tight in passing round 2).
  if (!process.env.BTB_KEEP_FRAMES && PASSING2) rmSync(dir, { recursive: true, force: true });
}

const CONCEPT_IDS = ['slant', 'out', 'curl', 'go', 'post', 'corner', 'crosser', 'screen', 'back-shoulder', 'scramble-drill'];
const PAIRS = ['speed', 'elusive', 'accuracy', 'rush', 'coverage'];
const PHYSICS_IDS = ['tackle-fall-forward', 'tackle-gang', 'tackle-arm-broken', 'tackle-big-hit', 'tackle-hurdle', 'tackle-driven-back'];
const PASSING_IDS = ['pass-slant', 'pass-dig', 'pass-post', 'pass-back-shoulder', 'pass-touch', 'pass-onrun', 'pass-pressure', 'pass-contested', 'pass-drop', 'arm-a', 'arm-b'];
const PASSING2_IDS = (process.env.BTB_PASSING2_IDS ?? Object.keys(FOLLOW).join(',')).split(',');
const PASSING3_IDS = (process.env.BTB_PASSING3_IDS ?? 'p3-slant,p3-out,p3-dig,p3-curl,p3-post,p3-go,p3-cross,p3-comeback,p3-slant-late,p3-out-late,p3-dig-late,p3-go-late').split(',');
const PASSING4_IDS = (process.env.BTB_PASSING4_IDS ?? 'p4-cue-dig,p4-out,p4-out-late,p4-go,p4-post').split(',');
const PASSING5_IDS = (process.env.BTB_PASSING5_IDS ?? Object.keys(FOLLOW5).join(',')).split(',');
const IDS = (PASSING5 ? PASSING5_IDS : PASSING4 ? PASSING4_IDS : PASSING3 ? PASSING3_IDS : PASSING2 ? PASSING2_IDS : PHYSICS ? PHYSICS_IDS : PASSING ? PASSING_IDS : IDENTITY ? PAIRS.flatMap((p) => [`${p}-a`, `${p}-b`]) : CONCEPTS ? CONCEPT_IDS : ['completion-rac', 'sack', 'broken-tackle']).filter((id) => !process.env.BTB_CLIP || id.startsWith(process.env.BTB_CLIP));
test.use({ viewport: { width: W, height: H } });
for (const id of IDS) {
  test(`feel video · ${id}`, async ({ page }) => {
    if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
    await record(page, { id, title: id });
    // The second of a pair: the two side by side, held on the last frame of the shorter one.
    if ((IDENTITY || PASSING || PASSING2) && id.endsWith('-b')) {
      const pair = id.slice(0, -2);
      execFileSync(ffmpeg(), ['-y', '-loglevel', 'error', '-i', `${OUT}/${pair}-a.mp4`, '-i', `${OUT}/${pair}-b.mp4`, '-filter_complex', '[0:v]tpad=stop=-1:stop_mode=clone[a];[1:v]tpad=stop=-1:stop_mode=clone[b];[a][b]hstack=inputs=2:shortest=0[v];[v]trim=duration=12[o]', '-map', '[o]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${OUT}/${pair}.mp4`]);
    }
  });
}
