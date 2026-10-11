// The broadcast camera's framing (GDD §11.1, TECH_PLAN §8), out of
// GameCamera.tsx (passing round 11) so the same code frames the play in the
// game and in Node (tools/sim/p11_cam.ts measures its pan, zoom and dolly and
// the QB's drawn height frame by frame, the way the 60-fps recordings do).
// No React and no DOM: the sim state and its snapshot in, a pose out.
//   Broadcast: behind the offense, high enough to see both wideouts; once
//   the pass is out it rides behind the ball and pushes in on the catch
//   point, then settles behind the carrier with look-ahead, and on a
//   breakaway eases out to a higher, wider three-quarter angle.

import * as THREE from 'three';
import type { PlayState } from '@/sim';
import type { Snapshot } from '@/game/snapshot';
import { worldX, worldY, worldZ } from '@/game/coords';
import { arm, armTime, catchAhead, driveTime, lead, touchStretch } from '@/sim/passing';
import { boxOut } from '@/sim/bodies';

export interface Pose {
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
export class Spring {
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

export const smooth = (k: number) => k * k * (3 - 2 * k);
/** An eased move with a steady middle: speeds up evenly over the first `a` of it, holds its pace, slows evenly over the last `a` (0 < a ≤ 0.5; 0.5 is a parabolic ease). Its top speed is 1/(1 − a) of the mean (a smoothstep's is 1.5). */
export function ramp(u: number, a: number): number {
  if (a <= 0) return smooth(u);
  const v = 1 / (1 - a);
  if (u <= a) return (0.5 * v * u * u) / a;
  if (u >= 1 - a) return 1 - (0.5 * v * (1 - u) * (1 - u)) / a;
  return 0.5 * v * a + v * (u - a);
}

/** A pose to the rig's seven world values: the eye (x, y, z), the look (x, y, z), the lens. */
export function poseToWorld(p: Pose): number[] {
  return [worldX(p.ey), p.eh, worldZ(p.ex), worldX(p.ly), p.lh, worldZ(p.lx), p.fov];
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
/** Enter past the line by this much at this pace; leave below LEAVE_SPEED (yd, yd/s). */
const BREAK_PAST = 15;
const BREAK_SPEED = 6.3;
const LEAVE_SPEED = 4.6;
/** Seconds to ease in and out (the blend runs through a smoothstep, so the swing starts and ends at rest). */
const BREAK_IN = 1.1;
const BREAK_OUT = 0.9;

/**
 * The catch beat: how long (s) the air camera's framing holds on the catcher
 * after the catch before it has eased out to the carrier follow, and when
 * the ease starts. Ours, sized so the hands, the give and the tuck (~0.33 s
 * in the clips) are framed tight at broadcast distance without the run
 * after the catch leaving the frame; the game clock never slows.
 */
export const BEAT_T = 0.45;
const BEAT_HOLD = 0.12;

/** The most the air camera's line turns off straight downfield (rad: 15°). Ours. */
const AIR_YAW = (15 * Math.PI) / 180;

/**
 * The move with the ball (passing round 10), read from the windup (round 11).
 * Round nine's air framing was a step the frame the ball left, chased by a
 * stiff spring: a whip-pan. Round ten eased the target itself, from the
 * pocket's framing as the ball left to the catch framing, but a slant's whole
 * move then fitted between the release and 0.22 s before the catch (~0.45 s):
 * a pan peaking at ~56°/s and ~88°/s of lens (docs/passing/PASSING10.md).
 * A broadcast operator doesn't wait for the ball: he reads the QB's eyes and
 * shoulders and is moving as the arm comes through. The throw is known when
 * the key goes down (or the AI decides: sim/play.ts qbThrow, s.windup), a
 * third of a second before the ball is out, so the move begins there, in
 * three parts on their own clocks:
 * - the pan (the look) from the windup's start to LOOK_SETTLE s before the
 *   catch, on a ramp with a steady middle (LOOK_RAMP): mostly sideways (the
 *   slant's 20° of yaw against 2° of tilt), so the QB at the bottom of the
 *   frame stays in it while the shot drifts toward the target;
 * - the lens and the eye's travel from the release (later on a longer ball,
 *   ZOOM_K s a second of flight past 0.7 s, at most ZOOM_MAX: the drive's
 *   finish seen before the zoom takes the QB out of the bottom of the frame) to
 *   ZOOM_SETTLE s before the catch, never quicker than ZOOM_MIN (a screen's
 *   half-second ball finishes it into the catch beat);
 * - the push on the passer through the windup (below).
 * Ours, measured frame by frame at 60 fps on tools/sim/p11_cam.ts (the same
 * code) and the broadcast recordings (docs/passing/PASSING11.md).
 */
/** The move begins at most this long (s) before the planned release (a key pressed in the drop waits for the plant). */
const ANTIC_MAX = 0.45;
const LOOK_SETTLE = 0.1;
/** The share of the pan spent gathering pace (and as much easing out): its top speed is 1/(1 − LOOK_RAMP) of its mean (a smoothstep's is 1.5×). */
const LOOK_RAMP = 0.25;
const ZOOM_K = 0.3;
const ZOOM_MAX = 0.2;
const ZOOM_SETTLE = 0.18;
const ZOOM_MIN = 0.4;
const ZOOM_RAMP = 0.3;
/**
 * The push on the passer (passing round 11): through the windup the eye comes
 * in PUSH_IN m along its line and down PUSH_DOWN m, and the lens closes by
 * PUSH_LENS, so the QB is drawn ~1.3× as large at the release (77 → ~98 px
 * tall at 960×540 on the slant) where he sits in the frame (the lower eye
 * lifts him as the nearer one drops him). The lens's share eases out from
 * PUSH_HOLD s after the release over PUSH_OUT s; the eye's is taken over by
 * its own travel to the catch framing (which goes down, so it never rises
 * again). Ours.
 */
const PUSH_IN = 2;
const PUSH_DOWN = 3;
const PUSH_LENS = 0.1;
const PUSH_HOLD = 0.1;
const PUSH_OUT = 0.3;
/**
 * How far the eye itself moves toward the air framing's along the ground (the
 * rest is the pan and the zoom): EYE_SHARE_MIN of the way on a quick throw,
 * all of it on a ball (EYE_FROM + EYE_SPAN) s in the air or more; its height
 * goes all the way (round 11: down onto the long lens's 4.8 m, after the push
 * on the passer, so it never cranes back up). Ours: a slant's dolly peaked at
 * ~30 m/s at the full share.
 */
const EYE_SHARE_MIN = 0.35;
const EYE_FROM = 0.6;
const EYE_SPAN = 1.2;
/** The look's lead toward the ball: this share of the way from the spot back to the ball as it leaves his hand, none at the catch (round 9's 0.5; round 11's pan already starts from the pocket). */
const LOOK_LEAD = 0.25;
/** The air rig's springs (rad/s: eye, look, lens): stiff, since the target itself is eased now (lag ~0.1–0.2 s). */
export const AIR_W = [10, 10, 10, 16, 16, 16, 14];
/** The rig's springs on the catch beat, and everywhere else (rad/s: eye, look, lens). The eye slower than the look: the lens leads, the dolly follows. */
export const BEAT_W = [4.2, 4.2, 4.2, 7, 7, 7, 4.5];
export const PLAY_W = [2.6, 2.6, 2.6, 4, 4, 4, 3];

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
/** The box-out drawn as a post-up (choreo.ts BOX_CLIP). */
const POSTED_BOX = 0.4;

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
 * The broadcast camera's state from frame to frame: the breakaway blend, the
 * throw being followed, the pocket's last framing, the air camera's last
 * framing (for the catch beat) and the camera as drawn last frame.
 */
export class BroadcastCam {
  breakaway = { k: 0, side: 1, play: -1, on: false };
  /** The throw being followed: where and when it left, the flight time it was given, and the pocket's framing as it left. */
  flight = { arrive: -1, x0: 0, y0: 0, total: 1, t0: 0, from: null as Pose | null };
  /** The pocket's framing, last frame (the air camera leaves from it: passing round 10). */
  pocket: { pose: Pose | null } = { pose: null };
  /** The throw read from the windup (passing round 11): the play and the windup it's from, when the move began and the pocket's framing then. */
  antic = { play: null as PlayState | null, key: -1, tw: 0, from: null as Pose | null };
  /** The windup's throw as last estimated: where it'll meet him and its flight (s). */
  private est = { state: null as PlayState | null, tick: -1, charge: 0, at: 0, F: 0, x: 0, y: 0 };
  /** The air camera's last framing (the catch beat holds it for a moment after the catch) and the catch it's holding on. */
  lastAir: { pose: Pose | null; arrive: number; at: { x: number; y: number } } = { pose: null, arrive: -1, at: { x: 0, y: 0 } };
  /** The camera as drawn last frame (world m) and its aspect: the air framing fits its zoom to where the eye really is (the dolly lags the pose). */
  camNow = { ok: false, eye: new THREE.Vector3(), aspect: 16 / 9 };

  /** Advance the breakaway blend by dt (the frame's step); a screenshot jumps straight to where it's heading. */
  stepBreakaway(s: PlayState, cur: Snapshot, playId: number, dt: number, snap: boolean): void {
    const breakaway = this.breakaway;
    if (breakaway.play !== playId) {
      breakaway.play = playId;
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

  /** The broadcast framing of the play. */
  pose(s: PlayState, cur: Snapshot): Pose {
    const los = s.setup.los;
    const by = s.setup.ballY ?? 0;
    const qb = cur.agents[s.qb]!;
    const c = cur.carrier >= 0 ? cur.agents[cur.carrier]! : null;
    const ball = cur.ball;
    const base: Pose = { ex: los - 17, ey: by * 0.5, eh: 8.5, lx: los + 8, ly: by * 0.7, lh: 0, fov: 52 };
    if (cur.phase === 'presnap' || cur.phase === 'snap' || cur.phase === 'dropback' || cur.phase === 'pocket') {
      // Ease back with the drop and drift with a QB who leaves the pocket.
      base.ex += Math.min(0, qb.x - (los - 5)) * 0.6;
      base.ey += (qb.y - by) * 0.5;
      base.ly += (qb.y - by) * 0.3;
      this.pocket.pose = { ...base };
      const w = s.windup;
      if (w && !w.away && (cur.phase === 'pocket' || cur.phase === 'dropback')) {
        if (this.antic.play !== s || this.antic.key !== w.from) this.antic = { play: s, key: w.from, tw: Math.max(s.t, w.at - ANTIC_MAX), from: { ...base } };
        if (s.t >= this.antic.tw) return this.windupPose(s, cur, w, this.antic.from!);
        this.antic.from = { ...base };
        return base;
      }
      // (A windup smothered before the ball's out: the camera goes back to the pocket.)
      if (this.antic.play === s) this.antic.key = -1;
      return base;
    }
    // A dead ball after a throw holds on the catch point; after a sack (no
    // throw, no carrier) it holds on the ball where he went down.
    const thrown = s.ball.thrower >= 0 && s.ball.arrive > s.snapT;
    if (cur.phase === 'air' || (cur.phase === 'dead' && !c && thrown)) {
      return this.airPose(s, cur);
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
      const beat = this.catchBeat(s, cur.carrier, c, near);
      if (beat) return beat;
      const k = dir > 0 ? smooth(this.breakaway.k) : 0;
      if (k <= 0) return near;
      // The breakaway: high and wide at three-quarters, 40° off his run from
      // the side he's farther from, 25 yd from him (the old sideline pose was
      // 24 at 40° fov; this is 46°, so the pursuit and the open field ahead
      // stay in frame), looking further ahead of him.
      const side = this.breakaway.side;
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

  /** Whether the rig is on the catch beat (the air framing held on the man who just caught it). */
  beating(s: PlayState, cur: Snapshot): boolean {
    const caughtAt = cur.phase === 'carrier' && cur.carrier >= 0 ? s.agents[cur.carrier]!.mem.caughtAt : undefined;
    return typeof caughtAt === 'number' && s.t - caughtAt < BEAT_T;
  }

  /** The broadcast rig's spring frequencies (rad/s) this frame. */
  weights(s: PlayState, cur: Snapshot): number[] {
    // (Passing round 10) In the air the target is eased in time (airPose: the release beat and the move), so the
    // rig is stiff enough to follow it closely (round nine's AIR_QUICK stiffened a spring chasing a step instead).
    if (cur.phase === 'air') return AIR_W;
    // (Passing round 11) The move begins with the windup: the rig is as stiff from there.
    if ((cur.phase === 'pocket' || cur.phase === 'dropback') && this.antic.play === s && this.antic.key >= 0 && s.windup && s.t >= this.antic.tw) return AIR_W;
    return this.beating(s, cur) ? BEAT_W : PLAY_W;
  }

  /** The framing on a just-caught ball: the air camera's last pose, carried with the catcher, blending out to `near`; null when there's no beat. */
  private catchBeat(s: PlayState, who: number, c: { x: number; y: number }, near: Pose): Pose | null {
    const lastAir = this.lastAir;
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

  /**
   * The pass: from the moment it's out, the camera rides behind the ball on
   * its line to the receiver and pushes in so the catch point fills the frame
   * as it arrives (then the carrier follow takes over). The line is biased
   * downfield so a screen or a throw to the flat never swings the camera
   * round to face the offense.
   */
  private airPose(s: PlayState, cur: Snapshot): Pose {
    const flight = this.flight;
    const ball = cur.ball;
    const b = s.ball;
    if (b.arrive !== flight.arrive) {
      flight.arrive = b.arrive;
      flight.x0 = ball.x;
      flight.y0 = ball.y;
      flight.total = Math.max(0.3, b.arrive - s.t);
      flight.t0 = s.t;
      flight.from = this.pocket.pose ? { ...this.pocket.pose } : null;
      // (Passing round 11) The move began with the windup: it carries on from there, from the pocket's framing then.
      const a = this.antic;
      if (a.play === s && a.key >= 0 && a.from && s.t - a.tw < 1.5) {
        flight.t0 = a.tw;
        flight.from = a.from;
      }
      a.key = -1;
    }
    // Where the ball and the man will meet (passing round 9): the sim's own catch (the tick it gets to his hands,
    // sim/passing.ts catchAhead), else between the aim and where he'll be at the arrival (he's often a stride short).
    const tr = b.target >= 0 ? s.agents[b.target] : undefined;
    const r = b.target >= 0 ? cur.agents[b.target] : undefined;
    const meet = tr && b.mode === 'air' ? catchAhead(s, tr) : null;
    const T = Math.max(0, b.arrive - s.t);
    const cx = meet ? meet.pos.x : r ? (b.aim.x + r.x + r.vx * T) / 2 : b.aim.x;
    const cy = meet ? meet.pos.y : r ? (b.aim.y + r.y + r.vy * T) / 2 : b.aim.y;
    // Progress through the flight, eased out.
    const p = Math.min(1, Math.max(0, 1 - (b.arrive - s.t) / flight.total));
    const pose = this.catchFrame(s, cur, { x0: flight.x0, y0: flight.y0, ax: b.aim.x, ay: b.aim.y, cx, cy, bx: ball.x, by: ball.y, bz: ball.z, r: r ? { x: r.x, y: r.y, vx: r.vx, vy: r.vy } : null, tr, T, F: flight.total, e: smooth(p) });
    if (flight.from) this.move(s, pose, flight.from, flight.t0, flight.total, b.arrive - flight.total);
    // Kept for the catch beat (with where the receiver is), while the ball is in the air.
    if (cur.phase === 'air') {
      this.lastAir.pose = pose;
      this.lastAir.arrive = b.arrive;
      if (r) this.lastAir.at = { x: r.x, y: r.y };
    }
    return pose;
  }

  /**
   * The windup (passing round 11): the throw's known when the key goes down (or the AI decides), a third of a second
   * before the ball's out, so the camera reads it the way a broadcast operator reads the QB's eyes and shoulders: the
   * move to the catch begins here, toward the release framing of the throw he's winding up (where it'll meet the man,
   * on the same lead the sim throws on), with the QB held in the shot through his release and finish.
   */
  private windupPose(s: PlayState, cur: Snapshot, w: NonNullable<PlayState['windup']>, from: Pose): Pose {
    const qb = s.agents[s.qb]!;
    const rec = s.agents[s.icons[w.icon]!]!;
    const wait = Math.max(0, w.at - s.t);
    // The flight it'll have: iterated against where he'll be (sim/passing.ts leadFor's loop, from his release time on).
    // (Once a tick: the lead runs his route forward.)
    const est = this.est;
    if (est.state !== s || est.tick !== s.tick || est.charge !== w.charge || est.at !== w.at) {
      const power = qb.fx.r('throwPower');
      const vmax = arm(qb).vmax;
      const hang = (d: number) => Math.max(driveTime(d, power) * (w.charge > 0 ? touchStretch(w.charge) : 1), armTime(d, vmax));
      let F = 0.8;
      let spot = lead(rec, wait + F);
      for (let k = 0; k < 3; k++) {
        F = hang(Math.hypot(spot.x - qb.pos.x, spot.y - qb.pos.y));
        spot = lead(rec, wait + F);
      }
      Object.assign(est, { state: s, tick: s.tick, charge: w.charge, at: w.at, F, x: spot.x, y: spot.y });
    }
    const F = est.F;
    const spot = { x: est.x, y: est.y };
    const q = cur.agents[s.qb]!;
    const rc = cur.agents[rec.i]!;
    const pose = this.catchFrame(s, cur, { x0: q.x, y0: q.y, ax: spot.x, ay: spot.y, cx: spot.x, cy: spot.y, bx: q.x, by: q.y, bz: 2.3, r: { x: rc.x + rc.vx * wait, y: rc.y + rc.vy * wait, vx: rc.vx, vy: rc.vy }, tr: rec, T: wait + F, F, e: 0 });
    this.move(s, pose, from, this.antic.tw, F, w.at);
    return pose;
  }

  /**
   * The catch framing at a moment of the flight (passing rounds 2, 9 and 10): `e` the eased progress, (cx, cy) where the
   * ball and the man will meet, (bx, by, bz) the ball, `r` the man (the field frame, now), T s to the catch and F the flight.
   */
  private catchFrame(s: PlayState, cur: Snapshot, c: { x0: number; y0: number; ax: number; ay: number; cx: number; cy: number; bx: number; by: number; bz: number; r: { x: number; y: number; vx: number; vy: number } | null; tr: PlayState['agents'][number] | undefined; T: number; F: number; e: number }): Pose {
    const camNow = this.camNow;
    const { cx, cy, e, r, T } = c;
    // The camera's line: the throw's direction, leaning downfield, and never
    // swung more than AIR_YAW off straight down the field (passing round 4:
    // on an out to the boundary it swung ~35° toward the catch in a second,
    // so the player lost the frame he judged the lead in; the broadcast's
    // high camera pans with the ball, it doesn't wheel round).
    const dx = c.ax - c.x0;
    const dy = c.ay - c.y0;
    const ux0 = Math.max(0, dx) + 0.35 * Math.hypot(dx, dy) + 1e-3;
    const yaw = Math.max(-AIR_YAW, Math.min(AIR_YAW, Math.atan2(dy * 0.8, ux0)));
    const ux = Math.cos(yaw);
    const uy = Math.sin(yaw);
    // Look: the landing spot, led from the release (passing round 9: round two's look started 70% of the way back at
    // the ball and came to the catch only as it arrived, so a quick throw was never framed); halfway between the ball
    // and the spot as it leaves his hand, on the spot as it gets there.
    const lead = LOOK_LEAD * (1 - e);
    const lx = cx + (c.bx - cx) * lead;
    const ly = cy + (c.by - cy) * lead;
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
      // Low enough that the catch sits just above center (the catch-call panel is in the bottom-right corner since passing round 10).
      lh: 0.4 + 0.2 * e,
      fov: 50 - 12 * e,
    };
    if (camNow.ok) {
      // The zoom (passing round 9): the ball, the man, the spot and the nearest defender to it held in the frame from
      // where the eye really is, no tighter than CATCH_FRAME at the spot.
      let n = 0;
      _pts[n++]!.set(worldX(c.by), worldY(c.bz), worldZ(c.bx));
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
      // (Passing round 10) A man posting up the defender on him (the box-out, sim/bodies.ts boxOut, drawn as catch_box when
      // it's 0.4 or more: choreo.ts BOX_CLIP) is framed as tight as a quick throw whatever the depth: the post-up is the play.
      const posted = nd >= 0 && c.tr !== undefined && boxOut(c.tr, s.agents[nd]!) >= POSTED_BOX;
      const frameH = posted ? CATCH_FRAME : CATCH_FRAME + (CATCH_FRAME_DEEP - CATCH_FRAME) * Math.min(1, Math.max(0, c.F - 1));
      const tight = (2 * Math.atan(frameH / 2 / Math.max(1, toSpot)) * 180) / Math.PI;
      pose.fov = Math.min(AIR_FOV_MAX, Math.max(fit, tight));
    }
    return pose;
  }

  /**
   * The move from the pocket's framing (`from`, as it was when the move began at t0) to `pose` (the catch framing now),
   * eased in time, in place (passing round 10, from the windup since round 11). `rel` is the release (planned, during the
   * windup) and F the flight.
   */
  private move(s: PlayState, pose: Pose, from: Pose, t0: number, F: number, rel: number): void {
    const clamp = (u: number) => Math.min(1, Math.max(0, u));
    // The pan: from the windup to just before the catch.
    const m = ramp(clamp((s.t - t0) / Math.max(0.3, rel + F - LOOK_SETTLE - t0)), LOOK_RAMP);
    // The lens and the eye: from the release (a beat later on a longer ball) to a little earlier before the catch.
    const z0 = rel + Math.min(ZOOM_MAX, ZOOM_K * Math.max(0, F - 0.7));
    const z1 = Math.max(z0 + ZOOM_MIN, rel + F - ZOOM_SETTLE);
    const mz = ramp(clamp((s.t - z0) / (z1 - z0)), ZOOM_RAMP);
    const mx = (a: number, z: number) => a + (z - a) * m;
    const mzx = (a: number, z: number) => a + (z - a) * mz;
    // The eye goes only part of the way on a quick throw: the shot pans and zooms from about where it is, as a
    // broadcast camera does (a 0.7-s slant's full dolly was ~30 m/s at its peak, the perspective swinging under the zoom).
    const me = mz * Math.min(1, Math.max(EYE_SHARE_MIN, (F - EYE_FROM) / EYE_SPAN));
    const mxe = (a: number, z: number) => a + (z - a) * me;
    pose.ex = mxe(from.ex, pose.ex);
    pose.ey = mxe(from.ey, pose.ey);
    pose.eh = mzx(from.eh, pose.eh);
    pose.lx = mx(from.lx, pose.lx);
    pose.ly = mx(from.ly, pose.ly);
    pose.lh = mx(from.lh, pose.lh);
    pose.fov = mzx(from.fov, pose.fov);
    // The push on the passer: in through the windup, the lens's share out after the release, the eye's into its travel.
    const wIn = smooth(clamp((s.t - t0) / Math.max(0.1, rel - t0)));
    const wLens = wIn * (1 - smooth(clamp((s.t - rel - PUSH_HOLD) / PUSH_OUT)));
    const wEye = wIn * (1 - mz);
    pose.fov *= 1 - PUSH_LENS * wLens;
    const gx = pose.lx - pose.ex;
    const gy = pose.ly - pose.ey;
    const gl = Math.hypot(gx, gy) || 1;
    pose.ex += (gx / gl) * PUSH_IN * wEye;
    pose.ey += (gy / gl) * PUSH_IN * wEye;
    pose.eh -= PUSH_DOWN * wEye;
  }
}
