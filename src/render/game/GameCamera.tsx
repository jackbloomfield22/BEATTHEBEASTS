import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { contactFor, kickView } from './kickView';
import * as THREE from 'three';
import { useSettings } from '@/app/settings';
import { urlFlags } from '@/app/platform';
import { Input } from '@/input/InputManager';
import { practice, usePractice } from '@/game/practice';
import { view } from '@/game/view';
import { fieldDir, worldX, worldZ } from '@/game/coords';
import { frameEvents } from './frameEvents';

// The play cameras (GDD §11.1, TECH_PLAN §8), driven from the sim snapshot
// through critically damped springs so every cut is a glide:
//   Broadcast: behind the offense, high enough to see both wideouts; once
//   the pass is out it rides behind the ball and pushes in on the catch
//   point, then settles behind the carrier with look-ahead, and on a
//   breakaway eases out to a higher, wider three-quarter angle.
//   All-22: high above the backfield, the whole field of play in view.
//   Field level: tight, behind the ball.
// Hits add a shake scaled by their force (Reduce Camera Shake scales it down).

type Mode = 'broadcast' | 'all22' | 'field';

interface Pose {
  /** Field frame: x downfield, y left, h height (m). */
  ex: number;
  ey: number;
  eh: number;
  lx: number;
  ly: number;
  lh: number;
  fov: number;
}

/** Spring toward a target: critically damped, frequency w (rad/s). */
class Spring {
  v = 0;
  constructor(public x: number) {}
  step(to: number, w: number, dt: number): number {
    // Semi-implicit critically damped spring (x'' = w²(to − x) − 2w x').
    const a = w * w * (to - this.x) - 2 * w * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

/**
 * The breakaway blend (M6.6, Playtest 2: "stay a bit wider on a breakaway
 * and ease the swing so it doesn't distract"). Before, a long run cut to a
 * sideline pose 24 yd off him the frame he crossed 18 yd at 6.5 yd/s: a 90°
 * swing that swung back the moment he slowed for a cut or the whistle blew,
 * and changed sides if he crossed the middle. Now `k` eases 0 → 1 over
 * about a second once he's clear (and back only when he's caught up to
 * the pursuit's pace, never at the whistle), the side is chosen once, and
 * the breakaway angle is 40° off his run rather than square to it.
 */
const breakaway = { k: 0, side: 1, play: -1, on: false };
/** Enter past the line by this much at this pace; leave below LEAVE_SPEED (yd, yd/s). */
const BREAK_PAST = 15;
const BREAK_SPEED = 6.3;
const LEAVE_SPEED = 4.6;
/** Seconds to ease in and out (the blend runs through a smoothstep, so the swing starts and ends at rest). */
const BREAK_IN = 1.1;
const BREAK_OUT = 0.9;

/** Advance the breakaway blend by dt (the frame's step); a screenshot jumps straight to where it's heading. */
function stepBreakaway(dt: number, snap: boolean): void {
  const r = practice.runner;
  if (!r) return;
  const s = r.state;
  const cur = r.cur;
  if (breakaway.play !== practice.playId) {
    breakaway.play = practice.playId;
    breakaway.k = 0;
    breakaway.on = false;
  }
  const c = cur.carrier >= 0 ? cur.agents[cur.carrier]! : null;
  const mine = !!c && s.agents[cur.carrier]!.side === 'off';
  if (c && mine && cur.phase === 'carrier') {
    const sp = Math.hypot(c.vx, c.vy);
    const past = c.x - s.setup.los;
    if (!breakaway.on && past > BREAK_PAST && sp > BREAK_SPEED) {
      breakaway.on = true;
      // The camera goes to the side he's farther from, and stays there.
      breakaway.side = c.y >= 0 ? -1 : 1;
    } else if (breakaway.on && sp < LEAVE_SPEED) breakaway.on = false;
  } else if (cur.phase !== 'dead') breakaway.on = false;
  const to = breakaway.on ? 1 : 0;
  if (snap) breakaway.k = to;
  else breakaway.k = to > breakaway.k ? Math.min(1, breakaway.k + dt / BREAK_IN) : Math.max(0, breakaway.k - dt / BREAK_OUT);
}

const smooth = (k: number) => k * k * (3 - 2 * k);

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
  // Broadcast.
  const base: Pose = { ex: los - 17, ey: by * 0.5, eh: 8.5, lx: los + 8, ly: by * 0.7, lh: 0, fov: 52 };
  if (cur.phase === 'presnap' || cur.phase === 'snap' || cur.phase === 'dropback' || cur.phase === 'pocket') {
    // Ease back with the drop and drift with a QB who leaves the pocket.
    base.ex += Math.min(0, qb.x - (los - 5)) * 0.6;
    base.ey += (qb.y - by) * 0.5;
    base.ly += (qb.y - by) * 0.3;
    return base;
  }
  // A dead ball after a throw holds on the catch point; after a sack (no
  // throw, no carrier) it holds on the ball where he went down.
  const thrown = s.ball.thrower >= 0 && s.ball.arrive > s.snapT;
  if (cur.phase === 'air' || (cur.phase === 'dead' && !c && thrown)) {
    return airPose(s, cur);
  }
  if (cur.phase === 'dead' && !c) {
    return { ex: ball.x - 13, ey: ball.y * 0.75, eh: 6.8, lx: ball.x + 2, ly: ball.y, lh: 0.6, fov: 52 };
  }
  if (c) {
    // Follow the carrier with look-ahead; he runs toward his own attack direction.
    const dir = s.agents[cur.carrier]!.side === 'off' ? 1 : -1;
    const lx = c.x + c.vx * 0.55;
    const ly = c.y + c.vy * 0.45;
    // Normal plays: behind him, 11 yd back and 6 up (M6.6: pushed in from
    // 13 and 6.8, Playtest 2 "it can push in a little closer on normal plays").
    const near: Pose = { ex: c.x - dir * 11, ey: c.y * 0.75, eh: 6, lx, ly, lh: 0.6, fov: 50 };
    const k = dir > 0 ? smooth(breakaway.k) : 0;
    if (k <= 0) return near;
    // The breakaway: high and wide at three-quarters, 40° off his run from
    // the side he's farther from, 25 yd from him (the old sideline pose was
    // 24 at 40° fov; this is 46°, so the pursuit and the open field ahead
    // stay in frame), looking further ahead of him.
    const side = breakaway.side;
    const wide: Pose = { ex: c.x - 19, ey: c.y + side * 16, eh: 11, lx: c.x + c.vx * 0.9 + 3, ly: c.y + c.vy * 0.6, lh: 0.4, fov: 46 };
    return {
      ex: near.ex + (wide.ex - near.ex) * k,
      ey: near.ey + (wide.ey - near.ey) * k,
      eh: near.eh + (wide.eh - near.eh) * k,
      lx: near.lx + (wide.lx - near.lx) * k,
      ly: near.ly + (wide.ly - near.ly) * k,
      lh: near.lh + (wide.lh - near.lh) * k,
      fov: near.fov + (wide.fov - near.fov) * k,
    };
  }
  return base;
}

/** The throw being followed: where and when it left, and the flight time it was given. */
const flight = { arrive: -1, x0: 0, y0: 0, total: 1 };

/**
 * The pass: from the moment it's out, the camera rides behind the ball on
 * its line to the receiver and pushes in so the catch point fills the frame
 * as it arrives (then the carrier follow takes over). The line is biased
 * downfield so a screen or a throw to the flat never swings the camera
 * round to face the offense.
 */
function airPose(s: NonNullable<typeof practice.runner>['state'], cur: NonNullable<typeof practice.runner>['cur']): Pose {
  const ball = cur.ball;
  const b = s.ball;
  if (b.arrive !== flight.arrive) {
    flight.arrive = b.arrive;
    flight.x0 = ball.x;
    flight.y0 = ball.y;
    flight.total = Math.max(0.3, b.arrive - s.t);
  }
  const ax = b.aim.x;
  const ay = b.aim.y;
  // Progress through the flight, eased out: the camera moves off with the
  // ball the moment it's thrown and settles as the ball arrives.
  const p = Math.min(1, Math.max(0, 1 - (b.arrive - s.t) / flight.total));
  const e = 1 - (1 - p) * (1 - p);
  // The camera's line: the throw's direction, leaning downfield.
  const dx = ax - flight.x0;
  const dy = ay - flight.y0;
  let ux = Math.max(0, dx) + 0.35 * Math.hypot(dx, dy) + 1e-3;
  let uy = dy * 0.8;
  const m = Math.hypot(ux, uy);
  ux /= m;
  uy /= m;
  // Look: the ball early, the catch late. The catch is between the aim
  // point and the receiver closing on it (he's often a stride short).
  const r = b.target >= 0 ? cur.agents[b.target] : undefined;
  const cx = r ? (ax + r.x) / 2 : ax;
  const cy = r ? (ay + r.y) / 2 : ay;
  const lx = ball.x + (cx - ball.x) * (0.3 + 0.7 * e);
  const ly = ball.y + (cy - ball.y) * (0.3 + 0.7 * e);
  // Back off along the line: wide at release, 10.5 yd off the catch at
  // arrival (round two: the push-in ends ~17% wider than M5.5's 9 yd, 3.4 up,
  // so the receiver and the nearest defenders are all in frame).
  const back = 20 - 9.5 * e;
  return {
    ex: lx - ux * back,
    ey: ly - uy * back,
    eh: 8 - 4.1 * e,
    lx,
    ly,
    // Low enough that the catch sits just above center, clear of the catch-call panel.
    lh: 0.4 + 0.2 * e,
    fov: 50 - 12 * e,
  };
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
    stepBreakaway(step, urlFlags.shot !== null && !urlFlags.video);
    const goal = targetPose(modeSetting);
    if (!goal) return;
    // World-space target: eye and look.
    const t = [worldX(goal.ey), goal.eh, worldZ(goal.ex), worldX(goal.ly), goal.lh, worldZ(goal.lx), goal.fov];
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
    const air = practice.runner?.cur.phase === 'air' && modeSetting === 'broadcast';
    const w = air ? [4.2, 4.2, 4.2, 7, 7, 7, 4.5] : [2.6, 2.6, 2.6, 4, 4, 4, 3];
    const v = sp.map((s, i) => s.step(t[i]!, w[i]!, step));
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
