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
// BTB_PASSING6=1: passing round 6 (docs/passing/PASSING6.md; src/game/clips.ts PASSING6), as round 5's, into
// docs/passing/round6/<BTB_PASSING_TAG>; BTB_FOLLOW=1 records each from the close camera on its catcher (FOLLOW6).
const PASSING6 = !!process.env.BTB_PASSING6;
// BTB_PASSING7=1: passing round 7 (docs/passing/PASSING7.md; src/game/clips.ts PASSING7), as round 6's, into
// docs/passing/round7/<BTB_PASSING_TAG>; BTB_FOLLOW=1 records each from the close camera on its catcher (FOLLOW7).
const PASSING7 = !!process.env.BTB_PASSING7;
const FOLLOW7: Record<string, string> = {
  'p7-slant': 'X,4,5,1.8,40',
  'p7-slant-bat': 'X,4,5,1.8,40',
  'p7-cross': 'TE,5,-5,2,42',
  'p7-dig': 'X,5,5,2,42',
  'p7-drag': 'X,4,5,1.8,40',
  'p7-corner': 'SLOT,6,-5,2.2,42',
  'p7-hitch': 'X,4,5,1.8,40',
};
// BTB_PASSING8=1: passing round 8 (docs/passing/PASSING8.md; src/game/clips.ts PASSING8), as round 7's, into
// docs/passing/round8/<BTB_PASSING_TAG>; BTB_FOLLOW=1 records each from the close camera (FOLLOW8: the catcher, or the QB for the lane).
const PASSING8 = !!process.env.BTB_PASSING8;
const FOLLOW8: Record<string, string> = {
  'p8-reach': 'X,4,5,1.8,40',
  'p8-low-shoulder': 'SLOT,6,-5,2.2,42',
  'p8-lane': 'QB,4,-5,2.2,40',
  'p8-lane-side': 'QB,4,5,2.2,40',
  'p8-box': 'TE,4,5,1.9,42',
};
// BTB_PASSING9=1: passing round 9 (docs/passing/PASSING9.md; src/game/clips.ts PASSING9): the ten passes from the default
// broadcast camera, into docs/passing/round9/<BTB_PASSING_TAG>; BTB_FOLLOW=1 records each from a close camera (FOLLOW9).
const PASSING9 = !!process.env.BTB_PASSING9;
const FOLLOW9: Record<string, string> = {
  'p9-slant': 'X,4,5,1.8,40',
  'p9-out': 'X,3,-6,1.9,42',
  'p9-dig': 'X,5,5,2,42',
  'p9-curl': 'X,4,5,1.8,40',
  'p9-go': 'X,6,5,2.2,42',
  'p9-post': 'X,6,-5,2.2,42',
  'p9-corner': 'SLOT,6,-5,2.2,42',
  'p9-cross': 'TE,5,-5,2,42',
  'p9-screen': 'RB,4,5,1.8,40',
  'p9-contested': 'TE,-1.5,-4,1.7,36',
  'p9-reach-mid': 'X,4,5,1.8,40',
  'p9-rac-a': 'X,-6,6,2.4,46',
  'p9-rac-b': 'X,-6,6,2.4,46',
};
// BTB_PASSING10=1: passing round 10 (docs/passing/PASSING10.md): round nine's passes plus the fade (src/game/clips.ts PASSING10)
// from the default broadcast camera, into docs/passing/round10/<BTB_PASSING_TAG>; BTB_FOLLOW=1 records each from a close
// camera (FOLLOW10: the QB for the throw, the tight end for the box-out). BTB_WINDOW=1 records only from the windup to the
// ball's end (+ BTB_AFTER_BALL s): the frames before it are drawn at 30 fps (the camera and the clips step as in play) but
// not kept, so a 60-fps recording (BTB_VIDEO_FPS=60) of the throw and the camera's move costs half the frames.
// BTB_PASSING11=1: passing round 11 (docs/passing/PASSING11.md): round ten's recordings (the same clips, cameras and window),
// into docs/passing/round11/<BTB_PASSING_TAG>.
// BTB_PASSING12=1: passing round 12 (docs/passing/PASSING12.md): the same, into docs/passing/round12/<BTB_PASSING_TAG>; the
// per-frame log (BTB_DIAG) also has the QB's arms, legs and trunk (the finish's silhouette) and the contested pair's
// (the bar's visibility), each bone's head in world m.
// BTB_PASSING13=1: passing round 13 (docs/passing/PASSING13.md): round twelve's recordings and log, into
// docs/passing/round13/<BTB_PASSING_TAG>.
// BTB_PASSING14=1: passing round 14 (docs/passing/PASSING14.md): round thirteen's recordings and log, into
// docs/passing/round14/<BTB_PASSING_TAG>; the log also has the QB's feet at the mm (the balls of the feet, the root, each
// foot's lock: locked, weight, the lock's point) and his sim velocity, and the pop meter's log the planted feet's drift.
// BTB_PASSING15=1: animation round 15 (docs/anim/FEET15.md, the planted feet): round fourteen's recordings and log, into
// docs/anim/feet15/<BTB_PASSING_TAG>, on the six plays of BTB_PASSING15_IDS. BTB_MEASURE=1 draws every frame and keeps
// none (no screenshots, no video): the pop meter's log alone (the planted feet by unit, their causes, the animator's cost).
// (Round 16) BTB_FEET_DIR=docs/anim/feet16: round 15's recordings and measurements into round 16's folder (docs/anim/FEET16.md).
const PASSING15 = !!process.env.BTB_PASSING15;
const MEASURE = !!process.env.BTB_MEASURE;
const PASSING14 = !!process.env.BTB_PASSING14 || PASSING15;
const PASSING13 = !!process.env.BTB_PASSING13 || PASSING14;
const PASSING12 = !!process.env.BTB_PASSING12 || PASSING13;
const PASSING11 = !!process.env.BTB_PASSING11 || PASSING12;
const PASSING10 = !!process.env.BTB_PASSING10 || PASSING11;
const WINDOW = !!process.env.BTB_WINDOW;
const FOLLOW10: Record<string, string> = {
  'p9-slant': 'QB,4,-5,2.2,40',
  'p9-out': 'QB,4,-5,2.2,40',
  'p9-dig': 'QB,4,-5,2.2,40',
  'p9-curl': 'QB,4,-5,2.2,40',
  'p9-go': 'QB,4,-5,2.2,40',
  'p9-post': 'QB,4,-5,2.2,40',
  'p9-corner': 'QB,4,-5,2.2,40',
  'p9-cross': 'QB,4,-5,2.2,40',
  'p9-screen': 'QB,4,-5,2.2,40',
  'p9-contested': 'TE,-1.5,-4,1.7,36',
  'p10-fade': 'QB,4,-5,2.2,40',
};
const FOLLOW6: Record<string, string> = {
  'p6-go': 'X,6,5,2.2,42',
  'p6-post': 'X,6,-5,2.2,42',
  'p6-corner': 'SLOT,6,-5,2.2,42',
  'p6-cross': 'TE,5,-5,2,42',
  'p6-out': 'X,3,-6,1.9,42',
  'p6-weak-go': 'X,6,-5,2.2,42',
  'p6-shoulder': 'Z,6,5,2.2,42',
  'p6-highpoint': 'X,6,-5,2.2,42',
  'p6-toetap': 'X,2,6,1.8,40',
  'p6-carry': 'X,4,5,1.8,40',
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
const OUT = PASSING15 ? `${process.env.BTB_FEET_DIR ?? 'docs/anim/feet15'}/${process.env.BTB_PASSING_TAG ?? 'after'}${MEASURE ? '-measure' : ''}` : PASSING14 ? `docs/passing/round14/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING13 ? `docs/passing/round13/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING12 ? `docs/passing/round12/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING11 ? `docs/passing/round11/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING10 ? `docs/passing/round10/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING9 ? `docs/passing/round9/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING8 ? `docs/passing/round8/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING7 ? `docs/passing/round7/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING6 ? `docs/passing/round6/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING5 ? `docs/passing/round5/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING4 ? `docs/passing/round4/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING3 ? `docs/passing/round3/${process.env.BTB_PASSING_TAG ?? 'after'}` : PASSING2 ? `docs/passing/round2/${process.env.BTB_PASSING_TAG ?? 'after'}` : PHYSICS ? 'docs/physics' : PASSING ? `docs/passing/${process.env.BTB_PASSING_TAG ?? 'after'}` : IDENTITY ? 'docs/screenshots/m6.5/identity' : CONCEPTS ? 'docs/screenshots/m6.5' : 'docs/screenshots/m5.5';
const FPS = Number(process.env.BTB_VIDEO_FPS ?? (CONCEPTS || IDENTITY || PASSING || PASSING2 || PHYSICS ? 20 : 30));
const TICKS_PER_FRAME = 60 / FPS;
/** Frames before the snap (the camera settles on the formation) and after the whistle (the dead ball, the get-up). */
const LEAD_IN = Math.round(FPS * (PASSING || PASSING2 || PASSING3 || PASSING4 || PASSING5 || PASSING6 || PASSING7 || PASSING8 || PASSING9 || PASSING10 ? 0.6 : 1.2));
const TAIL = Math.round(FPS * (PASSING || PASSING2 || PASSING3 || PASSING4 || PASSING5 || PASSING6 || PASSING7 || PASSING8 || PASSING9 || PASSING10 ? 0.6 : 2.5));
/** The passing clips stop this long (s) after the ball is caught or dead: the catch and the first steps after it are the moment (this container draws a frame in several seconds). */
const AFTER_BALL = PASSING || PASSING2 || PASSING3 || PASSING4 || PASSING5 || PASSING6 || PASSING7 || PASSING8 || PASSING9 || PASSING10 ? Number(process.env.BTB_AFTER_BALL ?? 1.8) : Infinity;
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
  const w = window as unknown as { __btbBodies?: B[]; __btbBall?: { position: V }; __btbPractice: { runner: { state: { t: number; phase: string; carrier: number; qb: number; ball: { mode: string; target: number; pos: V; arrive: number } } } | null } };
  // (No runner yet: a swapped-in roster is still loading.)
  if (!w.__btbPractice.runner) return { n };
  const s = w.__btbPractice.runner.state;
  const i = s.ball.target >= 0 ? s.ball.target : s.carrier;
  const r2 = (v: number) => Math.round(v * 100) / 100;
  // (Passing round 12) The bones logged for a figure (each bone's head: the joint it turns at).
  const SK = ['pelvis', 'spine_04', 'neck_01', 'head', 'upperarm_l', 'forearm_l', 'hand_l', 'upperarm_r', 'forearm_r', 'hand_r', 'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r'];
  const out: Record<string, unknown> = { n, t: r2(s.t), phase: s.phase, mode: s.ball.mode, i, arrive: r2(s.ball.arrive), simBall: [r2(s.ball.pos.x), r2(s.ball.pos.y), r2(s.ball.pos.z)] };
  const ball = w.__btbBall?.position;
  if (ball) out.ball = [r2(ball.x), r2(ball.y), r2(ball.z)];
  // (Passing round 10) The camera: where it is, where it looks (a unit vector) and its lens, for the pan's speed frame to frame.
  const cam = (window as unknown as { __btbCamera?: { position: V & { clone(): V }; fov: number; getWorldDirection(v: V): V } }).__btbCamera;
  if (cam) {
    const d = cam.getWorldDirection(cam.position.clone());
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    out.cam = [r2(cam.position.x), r2(cam.position.y), r2(cam.position.z), r3(d.x), r3(d.y), r3(d.z), r2(cam.fov)];
  }
  // The QB (his hands and feet) for the follow-through.
  const qbi = (s as unknown as { qb: number }).qb;
  const q = w.__btbBodies?.[qbi];
  if (q) {
    const qp = (name: string) => {
      const bone = q.player.bones.get(name);
      if (!bone) return null;
      const v = bone.getWorldPosition(q.player.root.position.clone());
      return [r2(v.x), r2(v.y), r2(v.z)];
    };
    out.qb = { hr: qp('hand_r'), fl: qp('foot_l'), fr: qp('foot_r'), pelvis: qp('pelvis'), head: qp('head'), clip: q.animator.transition && [q.animator.transition.name, r2(q.animator.transition.t)], ovl: q.animator.overlayAction && [q.animator.overlayAction.name, r2(q.animator.overlayAction.t)] };
    // (Passing round 12) The whole figure, for the finish's silhouette from the camera.
    (out.qb as Record<string, unknown>).sk = Object.fromEntries(SK.map((n) => [n, qp(n)]));
    // (Passing round 14) The feet at the mm, the root and the locks, and the sim's velocity (yd/s).
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const mm = (name: string) => {
      const bone = q.player.bones.get(name);
      if (!bone) return null;
      const v = bone.getWorldPosition(q.player.root.position.clone());
      return [r3(v.x), r3(v.y), r3(v.z)];
    };
    // (Round 15) The lean (deg): the bank and the pitch.
    const ld = (q.animator as unknown as { leanDbg?: { bank: number; pitch: number } }).leanDbg;
    if (ld) (out.qb as Record<string, unknown>).lean = [Math.round((ld.bank * 1800) / Math.PI) / 10, Math.round((ld.pitch * 1800) / Math.PI) / 10];
    const an = q.animator as unknown as { footLockOf?(f: string): { locked: boolean; weight: number; pos: V }; give?: V; slid?: { l: number; r: number }; keyedKnee?: { l: number; r: number } };
    const lk = (f: string) => {
      const l = an.footLockOf?.(f);
      return l ? [l.locked ? 1 : 0, r3(l.weight), r3(l.pos.x), r3(l.pos.y), r3(l.pos.z)] : null;
    };
    const qa = (s as unknown as { agents: { vel: { x: number; y: number } }[] }).agents[qbi]!;
    Object.assign(out.qb as Record<string, unknown>, { mm: { toe_l: mm('toe_l'), toe_r: mm('toe_r'), foot_l: mm('foot_l'), foot_r: mm('foot_r'), thigh_l: mm('thigh_l'), thigh_r: mm('thigh_r'), calf_l: mm('calf_l'), calf_r: mm('calf_r'), pelvis: mm('pelvis') }, root: [r3(q.player.root.position.x), r3(q.player.root.position.z), r3(q.player.root.rotation.y)], lock: { l: lk('l'), r: lk('r') }, vel: [r3(qa.vel.x), r3(qa.vel.y)], ...(an.give ? { give: [r3(an.give.x), r3(an.give.z)], slid: [r3(an.slid!.l), r3(an.slid!.r)], kk: [Math.round((an.keyedKnee!.l * 180) / Math.PI), Math.round((an.keyedKnee!.r * 180) / Math.PI)] } : {}) });
  }
  const b = i >= 0 ? w.__btbBodies?.[i] : undefined;
  if (b) {
    const p = (name: string) => {
      const bone = b.player.bones.get(name);
      if (!bone) return null;
      const v = bone.getWorldPosition(b.player.root.position.clone());
      return [r2(v.x), r2(v.y), r2(v.z)];
    };
    const a = b.animator;
    // (Passing round 12) The catcher's and his contest partner's figures, for the box-out bar's visibility.
    const sk = (body: B) => Object.fromEntries(SK.map((n) => { const bone = body.player.bones.get(n); if (!bone) return [n, null]; const v = bone.getWorldPosition(body.player.root.position.clone()); return [n, [r2(v.x), r2(v.y), r2(v.z)]]; }));
    out.rsk = sk(b);
    const pw = (b as unknown as { contest: { with: number } | null }).contest?.with;
    const pd = pw !== undefined ? w.__btbBodies?.[pw] : undefined;
    if (pd) Object.assign(out, { pw, psk: sk(pd) });
    else {
      // (Passing round 13) Before the render pairs them (choreo.ts contests), the nearest defender's figure, for the bar's
      // visibility from the box clip's own bar key on (`pnear`: not paired yet).
      const st = s as unknown as { agents: { pos: { x: number; y: number }; side: string }[] };
      const me = st.agents[i]!;
      let best = -1;
      let bd = 3;
      st.agents.forEach((o, j) => {
        const dd = Math.hypot(o.pos.x - me.pos.x, o.pos.y - me.pos.y);
        if (o.side !== me.side && dd < bd) {
          bd = dd;
          best = j;
        }
      });
      const nd = best >= 0 ? w.__btbBodies?.[best] : undefined;
      if (nd) Object.assign(out, { pw: best, pnear: true, psk: sk(nd) });
    }
    Object.assign(out, { trunk: r2((a as unknown as { trunkReach?: number }).trunkReach ?? 0), clip: b.catchClip, trans: a.transition && [a.transition.name, r2(a.transition.t)], ovl: a.overlayAction && [a.overlayAction.name, r2(a.overlayAction.t)], act: a.actionLayer && [a.actionLayer.name, r2(a.actionLayer.w)], hold: a.holdLayer && [a.holdLayer.name, r2(a.holdLayer.w)], root: [r2(b.player.root.position.x), r2(b.player.root.position.z), r2(b.player.root.rotation.y)], fl: p('fingers_01_l'), fr: p('fingers_01_r'), chest: p('spine_04'), head: p('head') });
  }
  return out;
}

// Draw exactly one frame of the new state (in video mode the page only draws when asked).
const frame = (page: Page) => page.evaluate(() => (window as unknown as { __btbRenderFrame(): void }).__btbRenderFrame());

async function record(page: Page, clip: Clip) {
  // (Round five records a clip from two cameras at once: each its own frames.)
  const dir = `tools/shots/out/video/${clip.id}${PASSING5 || PASSING6 || PASSING7 || PASSING8 || PASSING9 || PASSING10 ? `-${process.env.BTB_PASSING_TAG ?? 'after'}${process.env.BTB_FOLLOW || process.env.BTB_FOLLOW15 ? '-close' : ''}${WINDOW ? `-w${FPS}` : ''}` : ''}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  // No tutorial card in the videos.
  await page.addInitScript(() => localStorage.setItem('btb3d:practice.tutorialDone', 'true'));
  // (Round 15) BTB_FOLLOW15=slot,dx,dy,h,fov: a close camera on one man (the feet), for any of the round's plays.
  const follow = PASSING15 && process.env.BTB_FOLLOW15 ? `&follow=${process.env.BTB_FOLLOW15}` : PASSING10 && process.env.BTB_FOLLOW && FOLLOW10[clip.id] ? `&follow=${FOLLOW10[clip.id]}` : PASSING9 && process.env.BTB_FOLLOW && FOLLOW9[clip.id] ? `&follow=${FOLLOW9[clip.id]}` : PASSING8 && process.env.BTB_FOLLOW && FOLLOW8[clip.id] ? `&follow=${FOLLOW8[clip.id]}` : PASSING7 && process.env.BTB_FOLLOW && FOLLOW7[clip.id] ? `&follow=${FOLLOW7[clip.id]}` : PASSING6 && process.env.BTB_FOLLOW && FOLLOW6[clip.id] ? `&follow=${FOLLOW6[clip.id]}` : PASSING5 && process.env.BTB_FOLLOW && FOLLOW5[clip.id] ? `&follow=${FOLLOW5[clip.id]}` : PASSING2 && FOLLOW[clip.id] ? `&follow=${FOLLOW[clip.id]}` : (PASSING3 || PASSING4) && process.env.BTB_FOLLOW ? `&follow=${process.env.BTB_FOLLOW}` : '';
  await page.goto(`/?screen=practice&nointro&quality=${QUALITY}&video=${FPS}&pops&seed=1${follow}${MEASURE ? '&noshadow&noao' : ''}${process.env.BTB_TRACE ? `&trace=${process.env.BTB_TRACE}` : ''}${process.env.BTB_POSEDUMP ? '&posedump' : ''}`);
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
  // BTB_WINDOW: only the frames from the windup on are kept (steps counts every scene step, kept or not).
  let steps = 0;
  let inWindow = !WINDOW;
  const shot = async () => {
    await frame(page);
    steps++;
    if (!inWindow) return;
    if (DIAG) diag.push(await page.evaluate(diagFrame, n));
    if (MEASURE) {
      n++;
      return;
    }
    await page.screenshot({ path: `${dir}/${String(n++).padStart(4, '0')}.jpg`, type: 'jpeg', quality: 88 });
  };
  // Before the snap: the formation set, the camera settling. Drawn frames
  // only, no sim ticks: the play snaps on its first tick, as in Node (time
  // before the snap changes the play).
  for (let k = 0; k < LEAD_IN; k++) await shot();
  // (Round 16) BTB_PROFILE=1: a CPU profile of the play (Chrome's sampling profiler), next to the pop meter's log, for the
  // animator's hot paths (docs/anim/FEET16.md, perf).
  const prof = process.env.BTB_PROFILE ? await page.context().newCDPSession(page) : null;
  if (prof) {
    await prof.send('Profiler.enable');
    await prof.send('Profiler.setSamplingInterval', { interval: 100 });
    await prof.send('Profiler.start');
  }
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
      { id: clip.id, k: inWindow ? TICKS_PER_FRAME : 2 },
    );
    if (!inWindow) inWindow = await page.evaluate(() => { const s = (window as unknown as { __btbPractice: { runner: { state: { windup: unknown; phase: string } } } }).__btbPractice.runner.state; return !!s.windup || s.phase === 'air'; });
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
  if (prof) {
    const { profile } = await prof.send('Profiler.stop');
    writeFileSync(`${OUT}/${clip.id}.cpuprofile`, JSON.stringify(profile));
  }
  // The recording's own check: one scene step per recorded frame, none in the screenshots'
  // redraws (platform.ts videoTime; a recording that ran fast: docs/m7/MONTAGE.md).
  const end = await clocks(page);
  if (end.frames - start.frames !== steps) throw new Error(`${clip.id}: the scene stepped ${end.frames - start.frames} times for ${n} recorded frames`);
  console.log(
    `${clip.id}: snap to whistle ${whistle.ticks} sim ticks = ${(whistle.ticks / 60).toFixed(3)} s, on ${whistle.frames} frames = ${(whistle.frames / FPS).toFixed(3)} s of video; ` +
      `whole clip ${n} frames = ${(n / FPS).toFixed(2)} s (${(LEAD_IN / FPS).toFixed(1)} s before the snap, ${(TAIL / FPS).toFixed(1)} s after the whistle), ${end.tick - start.tick} ticks, ${end.frames - start.frames} scene steps`,
  );
  const pops = await page.evaluate(() => {
    const p = (window as unknown as Win).__btbPops;
    const sorted = [...p.rates].sort((a, b) => a - b);
    // (Passing round 14) The planted feet's drift, by group (popMeter.ts).
    const slide = (p as unknown as { slide?: unknown }).slide;
    // (Round 15) The ten worst planted spans and the animator's cost (ms per body per frame, GameScene).
    const ex = p as unknown as { worstSpans?: unknown[]; stepSpans?: unknown[]; trace?: unknown[]; cost?: { n: number; ms: number }; bySlot?: unknown; steps?: unknown[] };
    const cost = ex.cost && ex.cost.n > 0 ? { bodies: ex.cost.n, msPerBody: Math.round((ex.cost.ms / ex.cost.n) * 10000) / 10000 } : undefined;
    return { frames: p.rates.length, worst: Math.round(p.worst), p99: Math.round(sorted[Math.floor(sorted.length * 0.99)] ?? 0), ...(slide ? { slide } : {}), ...(ex.worstSpans ? { worstSpans: ex.worstSpans } : {}), ...(ex.stepSpans ? { stepSpans: ex.stepSpans } : {}), ...(ex.trace?.length ? { trace: ex.trace } : {}), ...(cost ? { cost } : {}), ...(ex.bySlot ? { bySlot: ex.bySlot } : {}), ...(ex.steps ? { stepLog: ex.steps } : {}), spikes: p.spikes };
  });
  // (Round ten: the close camera's and the 60-fps window's recordings sit next to the broadcast one.)
  const sfx = PASSING10 ? `${process.env.BTB_FOLLOW || process.env.BTB_FOLLOW15 ? '-close' : ''}${WINDOW ? `-${FPS}` : ''}` : '';
  writeFileSync(`${OUT}/${clip.id}${sfx}.pops.json`, JSON.stringify(pops, null, 1) + '\n');
  // (Round 16) ?posedump (BTB_POSEDUMP=1): every body's joints every frame, beside the log.
  if (process.env.BTB_POSEDUMP) writeFileSync(`${OUT}/${clip.id}${sfx}.pose.json`, JSON.stringify(await page.evaluate(() => (window as unknown as { __btbPops: { pose: unknown } }).__btbPops.pose)));
  if (DIAG) writeFileSync(`${dir}/diag.json`, JSON.stringify(diag) + '\n');
  if (MEASURE) {
    console.log(`${clip.id}: measured ${n} frames, pops worst ${pops.worst} rad/s`);
    if (!DIAG) rmSync(dir, { recursive: true, force: true });
    return;
  }
  execFileSync(ffmpeg(), ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', `${dir}/%04d.jpg`, '-c:v', 'libx264', '-preset', 'slow', '-crf', PASSING6 || PASSING7 || PASSING8 || PASSING9 || PASSING10 ? '28' : '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${OUT}/${clip.id}${sfx}.mp4`]);
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
const PASSING9_IDS = (process.env.BTB_PASSING9_IDS ?? Object.keys(FOLLOW9).join(',')).split(',');
const PASSING8_IDS = (process.env.BTB_PASSING8_IDS ?? Object.keys(FOLLOW8).join(',')).split(',');
const PASSING7_IDS = (process.env.BTB_PASSING7_IDS ?? Object.keys(FOLLOW7).join(',')).split(',');
const PASSING6_IDS = (process.env.BTB_PASSING6_IDS ?? Object.keys(FOLLOW6).join(',')).split(',');
const PASSING5_IDS = (process.env.BTB_PASSING5_IDS ?? Object.keys(FOLLOW5).join(',')).split(',');
const PASSING10_IDS = (process.env.BTB_PASSING10_IDS ?? Object.keys(FOLLOW10).join(',')).split(',');
const PASSING15_IDS = (process.env.BTB_PASSING15_IDS ?? 'p9-slant,p9-go,cut-run,p9-screen,p9-contested,sack').split(',');
const IDS = (PASSING15 ? PASSING15_IDS : PASSING10 ? PASSING10_IDS : PASSING9 ? PASSING9_IDS : PASSING8 ? PASSING8_IDS : PASSING7 ? PASSING7_IDS : PASSING6 ? PASSING6_IDS : PASSING5 ? PASSING5_IDS : PASSING4 ? PASSING4_IDS : PASSING3 ? PASSING3_IDS : PASSING2 ? PASSING2_IDS : PHYSICS ? PHYSICS_IDS : PASSING ? PASSING_IDS : IDENTITY ? PAIRS.flatMap((p) => [`${p}-a`, `${p}-b`]) : CONCEPTS ? CONCEPT_IDS : ['completion-rac', 'sack', 'broken-tackle']).filter((id) => !process.env.BTB_CLIP || id.startsWith(process.env.BTB_CLIP));
test.use({ viewport: { width: W, height: H } });
for (const id of IDS) {
  test(`feel video · ${id}`, async ({ page }) => {
    if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
    await record(page, { id, title: id });
    // The second of a pair: the two side by side, held on the last frame of the shorter one.
    if ((IDENTITY || PASSING || PASSING2 || PASSING9) && id.endsWith('-b')) {
      const pair = id.slice(0, -2);
      execFileSync(ffmpeg(), ['-y', '-loglevel', 'error', '-i', `${OUT}/${pair}-a.mp4`, '-i', `${OUT}/${pair}-b.mp4`, '-filter_complex', '[0:v]tpad=stop=-1:stop_mode=clone[a];[1:v]tpad=stop=-1:stop_mode=clone[b];[a][b]hstack=inputs=2:shortest=0[v];[v]trim=duration=12[o]', '-map', '[o]', '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', `${OUT}/${pair}.mp4`]);
    }
  });
}
