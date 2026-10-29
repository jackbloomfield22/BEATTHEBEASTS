import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { contactFor, kickView } from './kickView';
import * as THREE from 'three';
import { useSettings } from '@/app/settings';
import { urlFlags, videoTime } from '@/app/platform';
import { Input } from '@/input/InputManager';
import { practice, usePractice } from '@/game/practice';
import { replay, replayCam } from '@/game/replaySession';
import { YARD } from '../world/constants';
import { view } from '@/game/view';
import { fieldDir } from '@/game/coords';
import { frameEvents } from './frameEvents';
import { montage } from '@/game/montageSession';
import { celebView } from './celebrate';
import { reveal } from '@/game/tunnelReveal';
import { revealPose, type RevealPose } from './tunnelShow';
import { BroadcastCam, PLAY_W, poseToWorld, smooth, Spring, type Pose } from './broadcastCam';

// The play cameras (GDD §11.1, TECH_PLAN §8), driven from the sim snapshot
// through critically damped springs so every cut is a glide:
//   Broadcast: broadcastCam.ts (the live play, the Beasts' drive montage).
//   All-22: high above the backfield, the whole field of play in view.
//   Field level: tight, behind the ball.
// Hits add a shake scaled by their force (Reduce Camera Shake scales it down).

type Mode = 'broadcast' | 'all22' | 'field';

/** The play on screen: a replay's (M7) while one is on, the Beasts' drive montage's, else the live snap's. */
const activeRunner = () => (replay.active ? replay.runner : montage.player ? montage.player.runner : practice.runner);
/** Changes with each play on screen (a replay is its own; so is a montage). */
const activeId = () => (replay.active ? -1 - replay.epoch : montage.active ? -100000 - montage.epoch : practice.playId);


/** The broadcast camera's framing and its frame-to-frame state (broadcastCam.ts: the same code tools/sim/p11_cam.ts measures). */
const broadcast = new BroadcastCam();

function targetPose(mode: Mode): Pose | null {
  // A field goal or PAT: from behind and above the kicker, the protection and
  // the block unit across the bottom of the frame, the posts square above them.
  if (kickView.active && kickView.kind === 'PUNT' && !replay.active) {
    // A punt: from behind the punter over the protection, the coverage lanes and the returner in frame;
    // once it's off his foot the lens rides the ball up and down the field, the dolly following.
    const sx = kickView.spotX;
    if (kickView.team === 'bst' && kickView.path) {
      // The Beasts' punt on their drive (M7): the broadcast's punt shot, not the kicker's-eye one. High behind the
      // play, it travels downfield with the ball's track on the turf and looks ahead to where it comes down, so the
      // coverage, the returner and the catch share the frame; it never tilts up after the ball (a speck against the
      // stands at the top of its flight).
      const land = kickView.path[kickView.path.length - 1]!;
      const contact = contactFor('PUNT');
      const k = smooth(Math.min(1, Math.max(0, (kickView.t - contact) / Math.max(1, kickView.path.length / 30))));
      const bx = kickView.t < contact ? 0 : kickView.ball[0];
      const fx = sx + Math.max(bx, land[0] * k);
      return { ex: fx - 22, ey: land[1] * 0.3, eh: 11, lx: fx + (land[0] - Math.max(bx, land[0] * k)) * 0.45 + 4, ly: land[1] * 0.6, lh: 0.8, fov: 44 };
    }
    if (!kickView.path || kickView.t < contactFor('PUNT')) return { ex: sx - 11, ey: 0, eh: 4.4, lx: sx + 30, ly: 0, lh: 2, fov: 52 };
    const [bx, by, bz] = kickView.ball;
    return { ex: sx - 11 + bx * 0.55, ey: by * 0.4, eh: 4.4 + bz * 0.25, lx: sx + bx + 4, ly: by, lh: bz * 0.9144 * 0.8, fov: 52 };
  }
  if (kickView.active && !replay.active) return { ex: kickView.spotX - 12, ey: 0, eh: 3.6, lx: 110, ly: 0, lh: 2.4, fov: 36 };
  if (celebView.on && !replay.active) return celebPose();
  const r = activeRunner();
  if (!r) {
    // Before the first snap (the play call): the field from behind the line.
    const sit = usePractice.getState().situation;
    return { ex: sit.los - 20, ey: 0, eh: 11, lx: sit.los + 10, ly: 0, lh: 0, fov: 50 };
  }
  const s = r.state;
  const cur = r.cur;
  const los = s.setup.los;
  const by = s.setup.ballY ?? 0;
  const qb = cur.agents[s.qb]!;
  // ?follow=slot[,dx,dy,h,fov,ax,lh]: a close camera (ax: looking that far downfield of him, lh: at that height) on one man (dev and the passing round 2 recordings), so footwork, eyes and hands can be judged.
  if (urlFlags.follow) {
    const [slot, ...o] = urlFlags.follow.split(',');
    const i = s.agents.findIndex((a) => a.slot === slot);
    const a = i >= 0 ? cur.agents[i]! : qb;
    // (Round 16: lh, the height it looks at, m: low on a man's feet.)
    const [dx = 4, dy = -7, h = 2.4, fov = 40, ax = 0, lh = 1.1] = o.map(Number);
    return { ex: a.x + dx, ey: a.y + dy, eh: h, lx: a.x + ax, ly: a.y, lh, fov };
  }
  const c = cur.carrier >= 0 ? cur.agents[cur.carrier]! : null;
  const ball = cur.ball;
  const focus = c ?? qb;
  if (mode === 'all22') {
    const x = cur.phase === 'presnap' ? los : ball.x;
    return { ex: x - 24, ey: 0, eh: 30, lx: x + 9, ly: 0, lh: 0, fov: 46 };
  }
  if (mode === 'field') {
    const f = cur.phase === 'presnap' ? { x: los, y: by } : focus;
    return { ex: f.x - 7.5, ey: f.y * 0.9, eh: 1.75, lx: f.x + 12, ly: f.y, lh: 1.1, fov: 56 };
  }
  return broadcast.pose(s, cur);
}

// ---- Touchdown celebration (M7) --------------------------------------------------------------

/** Where the shot is from (field angle from the scorer to the camera) and which way it arcs, set at each cut. */
const celebCam = { az: 0, arc: 1, done: false };
/**
 * Where the celebration camera may stand (field yd): the playing surface and
 * its apron (the turf runs ~17 yd past each end line and ~12 yd outside
 * each sideline, render/stadium/props.ts), short of the walls and benches.
 */
const celebFits = (ex: number, ey: number) => ex < 121 && ex > -11 && Math.abs(ey) < 30;
/** Offsets tried in turn (rad off his facing): in front a little to one side, then wider round, so the camera never ends up in the stands. */
const CELEB_SIDES = [0.35, -0.35, 0.9, -0.9, 1.6, -1.6, 2.4, -2.4];
/** Two men facing each other (the chest bump, the high five): from the side, square to the line between them, so neither hides the other. */
const CELEB_SIDES_PAIR = [1.57, -1.57, 1.2, -1.2, 1.95, -1.95];
const CELEB_DIST = { from: 7.4, to: 5.0, card: 9.6 };

/**
 * The celebration: low (chest height, a little under), tight, in front of
 * the scorer and to one side, the field or the stands behind him. It cuts
 * in with the prompt and again as the celebration starts (in front of the
 * way he plays it: the stands, the official, his team-mate); between cuts
 * it holds its own bearing like an operator on the field (he turns, the
 * shot doesn't swing round with him), arcs ~30° and pushes in from ~7.4 m
 * to 5 m as the lens closes a few degrees. Under the result card it eases
 * back and up so the card and the end zone share the frame.
 * (GDD §11: the camera sells the moment.)
 */
function celebPose(): Pose {
  const v = celebView;
  const ease = (k: number) => smooth(Math.min(1, Math.max(0, k)));
  const k = ease(v.t / 7);
  if (v.cut) {
    // In the field of play and the end zone, off the bench areas: the first side that fits for the whole push.
    // Of the sides that fit, the one farthest round from where his team-mates are (they'd walk through the shot).
    const far = CELEB_DIST.from / YARD;
    const fits = (v.pair ? CELEB_SIDES_PAIR : CELEB_SIDES).filter((a) => celebFits(v.x + Math.cos(v.face + a) * far, v.y + Math.sin(v.face + a) * far));
    const front = fits.slice(0, 2);
    const away = (a: number) => (Number.isFinite(v.mates) ? Math.abs(Math.atan2(Math.sin(v.face + a - v.mates), Math.cos(v.face + a - v.mates))) : 0);
    const side = front.length ? front.reduce((b, a) => (away(a) > away(b) + 0.2 ? a : b)) : (fits[0] ?? Math.PI);
    celebCam.az = v.face + side;
    celebCam.arc = side >= 0 ? 1 : -1;
  }
  // Under the card it backs off: round to where that distance still fits, gliding there.
  if (v.done && !celebCam.done) {
    const far = CELEB_DIST.card / YARD;
    const base = celebCam.az - celebCam.arc * 0.5 * k;
    const d = [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2, Math.PI].find((o) => celebFits(v.x + Math.cos(base + o) * far, v.y + Math.sin(base + o) * far)) ?? 0;
    celebCam.az += d;
  }
  celebCam.done = v.done;
  // The arc swings toward his front as it pushes in.
  const a = celebCam.az - celebCam.arc * 0.5 * k;
  const back = v.done ? 1 : 0;
  const dist = (CELEB_DIST.from + (CELEB_DIST.to - CELEB_DIST.from) * k + (CELEB_DIST.card - CELEB_DIST.to) * back) / YARD;
  // A pair: framed on the point between them, a touch higher so the far man's head clears the near one's shoulder.
  const lx = v.x + (v.pair ? Math.cos(v.face) * v.pair * 0.5 : 0);
  const ly = v.y + (v.pair ? Math.sin(v.face) * v.pair * 0.5 : 0);
  const up = v.pair ? 0.35 : 0;
  // Under the card (it covers the top of the screen): back, up, and looking over their heads, so they stand in the lower half.
  return { ex: lx + Math.cos(a) * dist, ey: ly + Math.sin(a) * dist, eh: 1.35 + up - 0.15 * k + 1.5 * back, lx, ly, lh: 1.15 + 1.2 * back, fov: 34 - 5 * k + 8 * back + (v.pair ? 4 : 0) };
}

// ---- The replay angle (M7) ------------------------------------------------------------------

/**
 * The quick replay's one camera: the high three-quarter the replay used to
 * open its orbit on (and the angle M7's automatic replays played on), now
 * fixed. From the offense's side, behind and off the ball's right, 15 m
 * from it and ~24° down (yaw −0.7 rad off straight downfield), following
 * the ball. The live broadcast camera is behind the play; this one is off
 * its shoulder, so the replay is a second look rather than the same shot again.
 */
const REPLAY_ANGLE = { yaw: -0.7, pitch: 0.42, dist: 15, fov: 42 };
/** Its rig (eye ×3, look ×3, fov): the orbit's tight springs, so it keeps the ball framed through a throw. */
const REPLAY_RATES = [9, 9, 9, 7, 7, 7, 6];

function replayPose(): Pose {
  const b = replay.player!.runner.cur.ball;
  const h = Math.max(0.5, b.z * YARD);
  const c = REPLAY_ANGLE;
  const horiz = (c.dist * Math.cos(c.pitch)) / YARD;
  return { ex: b.x - Math.cos(c.yaw) * horiz, ey: b.y - Math.sin(c.yaw) * horiz, eh: h + c.dist * Math.sin(c.pitch), lx: b.x, ly: b.y, lh: h, fov: c.fov };
}


/** Game time the video camera last stepped to. */
const videoClock = { t: 0 };

/** The tunnel reveal's camera this frame (M7, tunnelShow.ts). */
const revealCam: RevealPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 50 };

export function GameCamera({ fovOffset = 0 }: { fovOffset?: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const modeSetting = useSettings((s) => s.settings.gameplay.camera);
  const reduceShake = useSettings((s) => s.settings.accessibility.reduceShake);
  const springs = useRef<Spring[] | null>(null);
  const shake = useRef({ amp: 0, t: 0 });
  const seenEpoch = useRef(-1);
  const pendingCut = useRef(false);

  // F1–F3 switch the camera (and remember it).
  useEffect(() => {
    return Input.onAction((id, info) => {
      if (info.repeat) return;
      const m: Mode | null = id === 'global.camBroadcast' ? 'broadcast' : id === 'global.camAll22' ? 'all22' : id === 'global.camField' ? 'field' : null;
      if (m) useSettings.getState().set((d) => void (d.gameplay.camera = m));
    });
  }, []);

  useFrame((_, dt) => {
    // The tunnel reveal (M7) flies its own shots; when it hands back, the play camera cuts to the pre-game picture.
    if (reveal.active) {
      revealPose(revealCam);
      camera.position.copy(revealCam.pos);
      camera.lookAt(revealCam.look);
      const rf = revealCam.fov + fovOffset * 0.5;
      if (Math.abs(camera.fov - rf) > 1e-3) {
        camera.fov = rf;
        camera.updateProjectionMatrix();
      }
      return;
    }
    const revealCut = reveal.handback;
    reveal.handback = false;
    // Video recording: the camera moves by the game time that passed (the
    // page renders freely between recorded frames), so its easing is as in play.
    let step = urlFlags.shot !== null ? 1 / 60 : Math.min(dt, 0.1);
    if (urlFlags.video) {
      const r = activeRunner();
      const now = r ? r.cur.t : 0;
      step = Math.max(0, Math.min(0.1, now - videoClock.t));
      videoClock.t = now;
      if (!springs.current) step = 0;
      // A replay's camera answers in the frame's time (it moves while the replay is paused or slowed, as it would in play);
      // so does the celebration's (the dead ball's sim stops a few seconds after the whistle). They, and the montage's,
      // step only in the frames the recorder asked for (platform.ts videoTime).
      if (replay.active || montage.active || celebView.on) step = videoTime.step();
    }
    // A replay rebuilt for a scrub back (or a new replay): the camera holds while the scene catches it up,
    // then cuts to where it lands, as a broadcast would; never a glide across the field through the fast-forward.
    if (replay.active) {
      if (replay.epoch !== seenEpoch.current) {
        seenEpoch.current = replay.epoch;
        pendingCut.current = true;
      }
      if (replay.player!.seeking && pendingCut.current) return;
      if (pendingCut.current) {
        pendingCut.current = false;
        replayCam.cut = true;
      }
    }
    const ar = activeRunner();
    if (ar) broadcast.stepBreakaway(ar.state, ar.cur, activeId(), step, urlFlags.shot !== null && !urlFlags.video);
    // A replay: its one angle.
    const rmode = replay.active;
    // The Beasts' drive (M7): the broadcast camera on the deciding play (a kick's is the kick view's), cut to on its first frame.
    const mshot = !replay.active && montage.active ? montage.shot : null;
    const goal = rmode ? replayPose() : targetPose(mshot ? 'broadcast' : modeSetting);
    if (!goal) return;
    // World-space target: eye and look.
    const t = poseToWorld(goal);
    if (!springs.current && urlFlags.video) {
      // A recorded clip opens on the broadcast shot (in play, the glide in from the menu happens during the play call).
      springs.current = t.map((v) => new Spring(v));
    }
    if (!springs.current) {
      // Start from wherever the menu camera was: the first move is a glide in.
      const dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      const look = camera.position.clone().addScaledVector(dir, 30);
      springs.current = [camera.position.x, camera.position.y, camera.position.z, look.x, look.y, look.z, camera.fov].map((v) => new Spring(v));
    }
    // Screenshots and browser tests cut straight to the pose every frame; so does a replay's camera change.
    const cut = (urlFlags.shot !== null && !urlFlags.video) || (rmode && replayCam.cut) || (mshot !== null && montage.cut) || (!rmode && !mshot && celebView.on && celebView.cut) || revealCut;
    if (!rmode) celebView.cut = false;
    if (cut) springs.current.forEach((s, i) => ((s.x = t[i]!), (s.v = 0)));
    replayCam.cut = false;
    if (mshot) montage.cut = false;
    // (Passing round 11) A recording draws its pre-snap frames with no game time passing (the camera steps by game
    // time), so it opened a second into the play still gliding down from the play call's framing (a quick throw's
    // windup came with the camera 2 m high and 5 yd back). In play it has settled long before the snap: so here.
    if (urlFlags.video && !rmode && !mshot && !celebView.on && practice.runner?.cur.phase === 'presnap') springs.current.forEach((s, i) => ((s.x = t[i]!), (s.v = 0)));
    const sp = springs.current;
    // Eye slower than the look: the lens leads, the dolly follows.
    // In the air the whole rig tightens up so it keeps pace with the ball.
    // The replay angle follows the ball closely (a ball in the air crosses the frame fast at 15 m).
    const rr = rmode ? null : activeRunner();
    // The celebration's: the dolly slow and smooth (the push), the lens keeping him framed as he moves.
    const celeb = !rmode && !mshot && celebView.on;
    // (?follow rides its man close: a stiff rig, or a man on the move leaves the frame.)
    // The broadcast rig's own rates (broadcastCam.ts weights: the windup's move, the air, the catch beat).
    const w = rmode ? REPLAY_RATES : celeb ? [2.2, 2.2, 2.2, 5, 5, 5, 3] : urlFlags.follow ? [9, 9, 9, 14, 14, 14, 9] : rr && (mshot ? 'broadcast' : modeSetting) === 'broadcast' ? broadcast.weights(rr.state, rr.cur) : PLAY_W;
    const v = sp.map((s, i) => s.step(t[i]!, w[i]!, step));
    broadcast.camNow.eye.set(v[0]!, v[1]!, v[2]!);
    broadcast.camNow.aspect = camera.aspect;
    broadcast.camNow.ok = true;
    // Shake: hits kick it, it rings down in ~0.3 s.
    for (const e of frameEvents) {
      if (e.type === 'hit' || e.type === 'sack') {
        const f = Number(e.data?.force ?? 6);
        shake.current.amp = Math.max(shake.current.amp, Math.min(0.16, f * 0.011) * (reduceShake ? 0.25 : 1) * (e.data?.big ? 1.6 : 1));
      }
    }
    shake.current.t += step;
    shake.current.amp *= Math.exp(-step * 9);
    const a = shake.current.amp;
    const st = shake.current.t * 47;
    camera.position.set(v[0]! + Math.sin(st) * a, v[1]! + Math.sin(st * 1.37 + 1) * a * 0.7, v[2]! + Math.sin(st * 0.83 + 2) * a * 0.5);
    camera.lookAt(v[3]!, v[4]!, v[5]!);
    const fov = v[6]! + fovOffset * 0.5;
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    // The sticks are camera-relative: tell the input layer where "up" points
    // on the field. Once the ball is thrown, the pocket's frame holds for the
    // rest of the play: the camera riding the ball toward the sideline, or
    // swinging to the sideline on a long run, mustn't turn the carrier's
    // controls mid-stride.
    if (rmode || mshot) return;
    const ph = practice.runner?.cur.phase;
    const fx = ph === 'air' || ph === 'carrier' || ph === 'dead' ? NaN : v[3]! - v[0]!;
    const fz = v[5]! - v[2]!;
    const [gx, gy] = fieldDir(fx, fz);
    const m = Math.hypot(gx, gy);
    if (m > 1e-6 && Number.isFinite(m)) {
      view.fwd.x = gx / m;
      view.fwd.y = gy / m;
    }
  }, -90);

  return null;
}
