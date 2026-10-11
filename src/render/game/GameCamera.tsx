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
import { fieldDir, worldX, worldY, worldZ } from '@/game/coords';
import { frameEvents } from './frameEvents';
import { montage } from '@/game/montageSession';
import { celebView } from './celebrate';
import { reveal } from '@/game/tunnelReveal';
import { revealPose, type RevealPose } from './tunnelShow';
import { catchAhead } from '@/sim/passing';

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

/** The play on screen: a replay's (M7) while one is on, the Beasts' drive montage's, else the live snap's. */
const activeRunner = () => (replay.active ? replay.runner : montage.player ? montage.player.runner : practice.runner);
/** Changes with each play on screen (a replay is its own; so is a montage). */
const activeId = () => (replay.active ? -1 - replay.epoch : montage.active ? -100000 - montage.epoch : practice.playId);

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
  const r = activeRunner();
  if (!r) return;
  const s = r.state;
  const cur = r.cur;
  if (breakaway.play !== activeId()) {
    breakaway.play = activeId();
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
    // The catch beat (passing round 5): for a moment after the ball is
    // caught the air camera's framing holds on him (carried along with him),
    // tight on the hands and the tuck, then eases out to the run. Before,
    // the carrier pose took over the frame the sim called the catch.
    const beat = catchBeat(s, cur.carrier, c, near);
    if (beat) return beat;
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

/** The air camera's last framing (the catch beat holds it for a moment after the catch) and the catch it's holding on. */
const lastAir: { pose: Pose | null; arrive: number; at: { x: number; y: number } } = { pose: null, arrive: -1, at: { x: 0, y: 0 } };
/**
 * The catch beat: how long (s) the air camera's framing holds on the catcher
 * after the catch before it has eased out to the carrier follow, and when
 * the ease starts. Ours, sized so the hands, the give and the tuck (~0.33 s
 * in the clips) are framed tight at broadcast distance without the run
 * after the catch leaving the frame; the game clock never slows.
 */
const BEAT_T = 0.45;
const BEAT_HOLD = 0.12;

/** The framing on a just-caught ball: the air camera's last pose, carried with the catcher, blending out to `near`; null when there's no beat. */
function catchBeat(s: NonNullable<typeof practice.runner>['state'], who: number, c: { x: number; y: number }, near: Pose): Pose | null {
  const air = lastAir.pose;
  if (!air || lastAir.arrive !== s.ball.arrive || s.ball.target !== who) return null;
  const caught = s.agents[who]!.mem.caughtAt;
  if (typeof caught !== 'number' || s.agents[who]!.side !== 'off') return null;
  const since = s.t - caught;
  if (since < 0 || since >= BEAT_T) return null;
  const k = smooth(Math.min(1, Math.max(0, (since - BEAT_HOLD) / (BEAT_T - BEAT_HOLD))));
  // The held framing rides with him: translated by how far he's run since the ball got to him.
  const dx = c.x - lastAir.at.x;
  const dy = c.y - lastAir.at.y;
  const hold: Pose = { ex: air.ex + dx, ey: air.ey + dy, eh: air.eh, lx: air.lx + dx, ly: air.ly + dy, lh: air.lh, fov: air.fov };
  const mix = (a: number, b: number) => a + (b - a) * k;
  return { ex: mix(hold.ex, near.ex), ey: mix(hold.ey, near.ey), eh: mix(hold.eh, near.eh), lx: mix(hold.lx, near.lx), ly: mix(hold.ly, near.ly), lh: mix(hold.lh, near.lh), fov: mix(hold.fov, near.fov) };
}

/** The most the air camera's line turns off straight downfield (rad: 15°). Ours. */
const AIR_YAW = (15 * Math.PI) / 180;

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

/** The throw being followed: where and when it left, and the flight time it was given. */
const flight = { arrive: -1, x0: 0, y0: 0, total: 1 };

/** The camera as drawn last frame (world m) and its aspect: the air framing fits its zoom to where the eye really is (the dolly lags the pose). */
const camNow = { ok: false, eye: new THREE.Vector3(), aspect: 16 / 9 };

/**
 * The air framing's zoom (passing round 9). From the broadcast camera the
 * quick throws were never framed: on the slant (0.7 s in the air) the look
 * and the dolly were still swinging off the pocket when the ball got there,
 * so the catch was drawn in the left third of the frame, ~70 px tall at
 * 960×540, with the line's pile filling the near corner, and the ball (a
 * brown speck) and the receiver only met on screen on the catch frame. Now
 * the lens leads the landing spot from the release and zooms to keep the
 * ball, the man and the spot where they'll meet in the frame together, as a
 * broadcast operator does on a pass (pan to the receiver, the ball flies into
 * the shot), tightening as the ball comes in:
 * - FIT_MARGIN: the points sit inside the frame by this share (ours: a
 *   tenth either side, so the ball isn't on the edge);
 * - AIR_FOV_MAX: no wider than the pre-snap shot's lens (52°);
 * - CATCH_FRAME: never tighter than this much field height (m) at the
 *   catch point, so the receiver is about a quarter of the frame (~1.9 m of
 *   7.5) on a quick throw; a deep ball (two seconds in the air and more) no
 *   tighter than CATCH_FRAME_DEEP, a fifth, so the race with the man on him
 *   and the safety coming over read as they do on a broadcast;
 * - the defender nearest the spot as the ball gets there (within
 *   NEAR_DEF yd) is held in the frame too: the catch is a contest.
 */
const FIT_MARGIN = 1.22;
const AIR_FOV_MAX = 52;
const CATCH_FRAME = 7.5;
const CATCH_FRAME_DEEP = 10;
const NEAR_DEF = 4;
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _d = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _look = new THREE.Vector3();
const _spot = new THREE.Vector3();
const _pts: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3());

/** The vertical fov (deg) from `eye` looking at `look` that holds every point (world) inside FIT_MARGIN of the frame. */
function fitFov(eye: THREE.Vector3, look: THREE.Vector3, pts: THREE.Vector3[], n: number, aspect: number): number {
  _f.subVectors(look, eye).normalize();
  _r.crossVectors(_f, _UP).normalize();
  _u.crossVectors(_r, _f);
  let tv = 0;
  for (let k = 0; k < n; k++) {
    _d.subVectors(pts[k]!, eye);
    const z = _d.dot(_f);
    if (z < 1) continue;
    tv = Math.max(tv, Math.abs(_d.dot(_u)) / z, Math.abs(_d.dot(_r)) / z / aspect);
  }
  return (2 * Math.atan(tv * FIT_MARGIN) * 180) / Math.PI;
}

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
  // The camera's line: the throw's direction, leaning downfield, and never
  // swung more than AIR_YAW off straight down the field (passing round 4:
  // on an out to the boundary it swung ~35° toward the catch in a second,
  // so the player lost the frame he judged the lead in; the broadcast's
  // high camera pans with the ball, it doesn't wheel round).
  const dx = ax - flight.x0;
  const dy = ay - flight.y0;
  const ux0 = Math.max(0, dx) + 0.35 * Math.hypot(dx, dy) + 1e-3;
  const yaw = Math.max(-AIR_YAW, Math.min(AIR_YAW, Math.atan2(dy * 0.8, ux0)));
  const ux = Math.cos(yaw);
  const uy = Math.sin(yaw);
  // Where the ball and the man will meet (passing round 9): the sim's own catch (the tick it gets to his hands,
  // sim/passing.ts catchAhead), else between the aim and where he'll be at the arrival (he's often a stride short).
  const tr = b.target >= 0 ? s.agents[b.target] : undefined;
  const r = b.target >= 0 ? cur.agents[b.target] : undefined;
  const meet = tr && b.mode === 'air' ? catchAhead(s, tr) : null;
  const T = Math.max(0, b.arrive - s.t);
  const cx = meet ? meet.pos.x : r ? (ax + r.x + r.vx * T) / 2 : ax;
  const cy = meet ? meet.pos.y : r ? (ay + r.y + r.vy * T) / 2 : ay;
  // Look: the landing spot, led from the release (passing round 9: round two's look started 70% of the way back at
  // the ball and came to the catch only as it arrived, so a quick throw was never framed); halfway between the ball
  // and the spot as it leaves his hand, on the spot as it gets there.
  const lead = 0.5 * (1 - e);
  const lx = cx + (ball.x - cx) * lead;
  const ly = cy + (ball.y - cy) * lead;
  // Back off along the line: wide at release, 13 yd off the catch and 4.8 m up at arrival (passing round 9: the long
  // lens. Round two's 10.5 yd and 3.9 m put the eye among the underneath defenders, so with the zoom framing the catch a
  // linebacker between the camera and the ball filled a corner of the frame; from further back and higher, on a
  // tighter lens, the catch is framed as large with the perspective flatter, as a broadcast's long lens has it).
  const back = 20 - 7 * e;
  const pose: Pose = {
    ex: lx - ux * back,
    ey: ly - uy * back,
    eh: 8 - 3.2 * e,
    lx,
    ly,
    // Low enough that the catch sits just above center, clear of the catch-call panel.
    lh: 0.4 + 0.2 * e,
    fov: 50 - 12 * e,
  };
  if (camNow.ok) {
    // The zoom (passing round 9): the ball, the man, the spot and the nearest defender to it held in the frame from
    // where the eye really is, no tighter than CATCH_FRAME at the spot.
    let n = 0;
    _pts[n++]!.set(worldX(ball.y), worldY(ball.z), worldZ(ball.x));
    _pts[n++]!.set(worldX(cy), 0, worldZ(cx));
    _pts[n++]!.set(worldX(cy), 2.1, worldZ(cx));
    if (r) {
      _pts[n++]!.set(worldX(r.y), 0, worldZ(r.x));
      _pts[n++]!.set(worldX(r.y), 2.1, worldZ(r.x));
    }
    let nd = -1;
    let bd = NEAR_DEF;
    for (const j of s.def) {
      const o = cur.agents[j];
      if (!o || o.down) continue;
      const k = Math.hypot(o.x + o.vx * T - cx, o.y + o.vy * T - cy);
      if (k < bd) {
        bd = k;
        nd = j;
      }
    }
    if (nd >= 0) {
      const o = cur.agents[nd]!;
      _pts[n++]!.set(worldX(o.y), 0, worldZ(o.x));
      _pts[n++]!.set(worldX(o.y), 2.1, worldZ(o.x));
    }
    const fit = fitFov(camNow.eye, _look.set(worldX(ly), pose.lh, worldZ(lx)), _pts, n, camNow.aspect);
    const toSpot = camNow.eye.distanceTo(_spot.set(worldX(cy), 1, worldZ(cx)));
    const frameH = CATCH_FRAME + (CATCH_FRAME_DEEP - CATCH_FRAME) * Math.min(1, Math.max(0, flight.total - 1));
    const tight = (2 * Math.atan(frameH / 2 / Math.max(1, toSpot)) * 180) / Math.PI;
    pose.fov = Math.min(AIR_FOV_MAX, Math.max(fit, tight));
  }
  // Kept for the catch beat (with where the receiver is), while the ball is in the air.
  if (cur.phase === 'air') {
    lastAir.pose = pose;
    lastAir.arrive = b.arrive;
    if (r) lastAir.at = { x: r.x, y: r.y };
  }
  return pose;
}

/** The most a quick throw stiffens the air rig (× its springs' frequency). Ours: a 0.7-s slant at ~1.4×, settled on the spot as the ball gets there. */
const AIR_QUICK = 1.5;

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
    stepBreakaway(step, urlFlags.shot !== null && !urlFlags.video);
    // A replay: its one angle.
    const rmode = replay.active;
    // The Beasts' drive (M7): the broadcast camera on the deciding play (a kick's is the kick view's), cut to on its first frame.
    const mshot = !replay.active && montage.active ? montage.shot : null;
    const goal = rmode ? replayPose() : targetPose(mshot ? 'broadcast' : modeSetting);
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
    // Screenshots and browser tests cut straight to the pose every frame; so does a replay's camera change.
    const cut = (urlFlags.shot !== null && !urlFlags.video) || (rmode && replayCam.cut) || (mshot !== null && montage.cut) || (!rmode && !mshot && celebView.on && celebView.cut) || revealCut;
    if (!rmode) celebView.cut = false;
    if (cut) springs.current.forEach((s, i) => ((s.x = t[i]!), (s.v = 0)));
    replayCam.cut = false;
    if (mshot) montage.cut = false;
    const sp = springs.current;
    // Eye slower than the look: the lens leads, the dolly follows.
    // In the air the whole rig tightens up so it keeps pace with the ball.
    // The replay angle follows the ball closely (a ball in the air crosses the frame fast at 15 m).
    // The catch beat (passing round 5): the air framing holds a moment past the catch.
    const rr = rmode ? null : activeRunner();
    const caughtAt = rr && rr.cur.phase === 'carrier' && rr.cur.carrier >= 0 ? rr.state.agents[rr.cur.carrier]!.mem.caughtAt : undefined;
    const beating = !!rr && typeof caughtAt === 'number' && rr.state.t - caughtAt < BEAT_T;
    const air = !rmode && (rr?.cur.phase === 'air' || beating) && (mshot ? 'broadcast' : modeSetting) === 'broadcast';
    // The celebration's: the dolly slow and smooth (the push), the lens keeping him framed as he moves.
    const celeb = !rmode && !mshot && celebView.on;
    // (?follow rides its man close: a stiff rig, or a man on the move leaves the frame.)
    // (Passing round 9) A quick throw tightens it further: a slant's 0.7 s in the air is over before the
    // rig settles at its usual pace (the eye's time constant ~0.24 s), so the stiffness goes with the flight's
    // shortness, up to AIR_QUICK times for a ball in the air under a second.
    const quick = air && rr?.cur.phase === 'air' ? Math.min(AIR_QUICK, Math.max(1, 1 / flight.total)) : 1;
    const w = rmode ? REPLAY_RATES : celeb ? [2.2, 2.2, 2.2, 5, 5, 5, 3] : urlFlags.follow ? [9, 9, 9, 14, 14, 14, 9] : air ? [4.2, 4.2, 4.2, 7, 7, 7, 4.5].map((x) => x * quick) : [2.6, 2.6, 2.6, 4, 4, 4, 3];
    const v = sp.map((s, i) => s.step(t[i]!, w[i]!, step));
    camNow.eye.set(v[0]!, v[1]!, v[2]!);
    camNow.aspect = camera.aspect;
    camNow.ok = true;
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
