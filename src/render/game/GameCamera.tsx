import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { contactFor, kickView } from './kickView';
import * as THREE from 'three';
import { useSettings } from '@/app/settings';
import { urlFlags } from '@/app/platform';
import { Input } from '@/input/InputManager';
import { practice, usePractice } from '@/game/practice';
import { view } from '@/game/view';
import { fieldDir } from '@/game/coords';
import { frameEvents } from './frameEvents';
import { BroadcastCam, PLAY_W, poseToWorld, Spring, type Pose } from './broadcastCam';

// The play cameras (GDD §11.1, TECH_PLAN §8), driven from the sim snapshot
// through critically damped springs so every cut is a glide:
//   Broadcast: broadcastCam.ts.
//   All-22: high above the backfield, the whole field of play in view.
//   Field level: tight, behind the ball.
// Hits add a shake scaled by their force (Reduce Camera Shake scales it down).

type Mode = 'broadcast' | 'all22' | 'field';

/** The broadcast camera's framing and its frame-to-frame state (broadcastCam.ts: the same code tools/sim/p11_cam.ts measures). */
const broadcast = new BroadcastCam();

function targetPose(mode: Mode): Pose | null {
  // A field goal or PAT: from behind and above the kicker, the protection and
  // the block unit across the bottom of the frame, the posts square above them.
  if (kickView.active && kickView.kind === 'PUNT') {
    // A punt: from behind the punter over the protection, the coverage lanes and the returner in frame;
    // once it's off his foot the lens rides the ball up and down the field, the dolly following.
    const sx = kickView.spotX;
    if (!kickView.path || kickView.t < contactFor('PUNT')) return { ex: sx - 11, ey: 0, eh: 4.4, lx: sx + 30, ly: 0, lh: 2, fov: 52 };
    const [bx, by, bz] = kickView.ball;
    return { ex: sx - 11 + bx * 0.55, ey: by * 0.4, eh: 4.4 + bz * 0.25, lx: sx + bx + 4, ly: by, lh: bz * 0.9144 * 0.8, fov: 52 };
  }
  if (kickView.active) return { ex: kickView.spotX - 12, ey: 0, eh: 3.6, lx: 110, ly: 0, lh: 2.4, fov: 36 };
  const r = practice.runner;
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
  // ?follow=slot[,dx,dy,h,fov,ax]: a close camera (ax: looking that far downfield of him) on one man (dev and the passing round 2 recordings), so footwork, eyes and hands can be judged.
  if (urlFlags.follow) {
    const [slot, ...o] = urlFlags.follow.split(',');
    const i = s.agents.findIndex((a) => a.slot === slot);
    const a = i >= 0 ? cur.agents[i]! : qb;
    const [dx = 4, dy = -7, h = 2.4, fov = 40, ax = 0] = o.map(Number);
    return { ex: a.x + dx, ey: a.y + dy, eh: h, lx: a.x + ax, ly: a.y, lh: 1.1, fov };
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

/** Game time the video camera last stepped to. */
const videoClock = { t: 0 };

export function GameCamera({ fovOffset = 0 }: { fovOffset?: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const modeSetting = useSettings((s) => s.settings.gameplay.camera);
  const reduceShake = useSettings((s) => s.settings.accessibility.reduceShake);
  const springs = useRef<Spring[] | null>(null);
  const shake = useRef({ amp: 0, t: 0 });

  // F1–F3 switch the camera (and remember it).
  useEffect(() => {
    return Input.onAction((id, info) => {
      if (info.repeat) return;
      const m: Mode | null = id === 'global.camBroadcast' ? 'broadcast' : id === 'global.camAll22' ? 'all22' : id === 'global.camField' ? 'field' : null;
      if (m) useSettings.getState().set((d) => void (d.gameplay.camera = m));
    });
  }, []);

  useFrame((_, dt) => {
    // Video recording: the camera moves by the game time that passed (the
    // page renders freely between recorded frames), so its easing is as in play.
    let step = urlFlags.shot !== null ? 1 / 60 : Math.min(dt, 0.1);
    if (urlFlags.video) {
      const r = practice.runner;
      const now = r ? r.cur.t : 0;
      step = Math.max(0, Math.min(0.1, now - videoClock.t));
      videoClock.t = now;
      if (!springs.current) step = 0;
    }
    const pr = practice.runner;
    if (pr) broadcast.stepBreakaway(pr.state, pr.cur, practice.playId, step, urlFlags.shot !== null && !urlFlags.video);
    const goal = targetPose(modeSetting);
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
    // Screenshots and browser tests cut straight to the pose every frame.
    if (urlFlags.shot !== null && !urlFlags.video) springs.current.forEach((s, i) => ((s.x = t[i]!), (s.v = 0)));
    const sp = springs.current;
    // Eye slower than the look: the lens leads, the dolly follows.
    // In the air the whole rig tightens up so it keeps pace with the ball.
    const rr = practice.runner;
    // (?follow rides its man close: a stiff rig, or a man on the move leaves the frame.)
    // (Passing round 10) In the air the target is eased in time (airPose: the release beat and the move), so the
    // rig is stiff enough to follow it closely (round nine's AIR_QUICK stiffened a spring chasing a step instead).
    const w = urlFlags.follow ? [9, 9, 9, 14, 14, 14, 9] : rr && modeSetting === 'broadcast' ? broadcast.weights(rr.state, rr.cur) : PLAY_W;
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
