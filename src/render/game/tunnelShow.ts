// The tunnel reveal on screen (M7; the timeline is src/game/tunnelReveal.ts):
// where the twenty-two stand and run, the three shots' cameras, the
// exposure, the pyro and smoke at the mouth, the crowd. Render-only: it
// reads the rosters and never touches the match or the sim (CLAUDE.md rule 4).
//
// The run-out: the Contenders' eleven wait in a pack inside the tunnel,
// fastest at the front, and run out on curves that leave the mouth straight
// and fan to a line across their side of midfield (TEAM_Z), where each one
// pulls up and turns to face the Beasts. Each man's pace is his own: 64% of
// his top speed from the sim (effects.vmax, the 40 and the 10-yd split), up
// to it on his own acceleration (tau), so the fast men pull away out of the
// mouth and the linemen come last, as they would. The QB raises both arms
// as he comes into the light, the lead man one (the officials' touchdown
// signal clip on the arms only: no new motion).
//
// The Beasts stand in a line across their side (BEASTS_Z), facing the
// tunnel, the best of them in the middle: the Beasts shot tracks down the
// line to him.

import * as THREE from 'three';
import { effects, type SimPlayer } from '@/sim';
import { reveal, REVEAL_SECS } from '@/game/tunnelReveal';
import { TUNNEL, YARD } from '../world/constants';
import { crowdEnergy } from '../crowd/reactions';
import { activeVfx } from '../vfx/active';
import { Audio } from '@/audio/audio';
import { view } from '../view';
import type { Body } from './choreo';
import { resetBody } from './choreo';

/** The Contenders pull up on this line (world z, m): their side of midfield, ~20 yd short of it. */
const TEAM_Z = -18.5;
/** The Beasts wait on this line (world z, m): their side, ~6 yd past midfield. */
const BEASTS_Z = 5.5;
/** Spacing along each line (m) and the pack's rows (front to back, world z) and columns (x off the tunnel's line). */
const LINE_GAP = 3;
/** The Beasts stand closer: shoulder pads a stride apart, a wall on the long lens. */
const BEASTS_GAP = 2.2;
/** Tight to the mouth, so the Steadicam has room behind the last row. */
const PACK_ROWS = [TUNNEL.mouth - 0.8, TUNNEL.mouth - 2.0, TUNNEL.mouth - 3.2, TUNNEL.mouth - 4.4];
const PACK_COLS = [-1.55, 0, 1.55];
/** Jog-out pace as a share of his top speed (a run, not a sprint: the stride reads as the run gait). */
const PACE = 0.64;
/** Braking (m/s²) as he pulls up: a few strides, not a skid. */
const BRAKE = 2.4;
/** Arms: the clip's arm bones (tools/blender/lib/actions.py arm_mask). */
const FINGERS = ['fingers_01', 'fingers_02', 'fingers_03', 'index_01', 'index_02', 'index_03', 'thumb_01', 'thumb_02', 'thumb_03'];
const arm = (s: 'l' | 'r') => ['clavicle', 'upperarm', 'upperarm_twist', 'forearm', 'forearm_twist', 'hand', ...FINGERS].map((b) => `${b}_${s}`);

const smooth = (a: number, b: number, x: number) => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const ease = (k: number) => {
  const x = Math.min(1, Math.max(0, k));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

interface Runner {
  i: number;
  curve: THREE.QuadraticBezierCurve;
  len: number;
  s: number;
  v: number;
  pace: number;
  tau: number;
  t0: number;
  hype: 'both' | 'r' | null;
  done: boolean;
}

/** The run-out's state for the current reveal (epoch). */
const show = {
  epoch: -1,
  runners: [] as Runner[],
  /** Body index of the Beast the Beasts shot ends on, and where he stands (world x). */
  star: -1,
  starX: 0,
  pyroAcc: 0,
  smokeAcc: 0,
  roared: { out: false, beasts: false },
  /** The bodies the last frame drew (the camera frames the pack from them). */
  bodies: null as Body[] | null,
};

/** Lay the twenty-two out for a new reveal: the pack in the tunnel, the Beasts' line. */
function setUp(bodies: Body[], roster: SimPlayer[], nOff: number): void {
  show.epoch = reveal.epoch;
  show.roared = { out: false, beasts: false };
  show.pyroAcc = 0;
  show.smokeAcc = 0;
  for (const b of bodies) {
    b.player.root.visible = true;
    resetBody(b);
    b.animator.reset();
    b.animator.stopOverlay();
    b.animator.setStance('stance_idle');
    b.gaitSpeed = 0;
    b.lastSpeed = 0;
  }
  // The Contenders: fastest at the front of the pack.
  const off = roster.slice(0, nOff).map((p, i) => ({ i, p, fx: effects(p) }));
  off.sort((a, b) => b.fx.vmax - a.fx.vmax);
  const packed = off.map((m, k) => {
    const row = Math.min(PACK_ROWS.length - 1, Math.floor(k / 3));
    const col = PACK_COLS[k % 3]!;
    // A little stagger inside a row, so the pack isn't a grid (seeded by the slot, no randomness).
    const jz = ((m.i * 37) % 7) / 7 - 0.5;
    return { ...m, x: TUNNEL.x + col + (((m.i * 53) % 5) / 5 - 0.4) * 0.3, z: PACK_ROWS[row]! + jz * 0.35, row };
  });
  // Their spots on the line keep the pack's left to right.
  const byX = [...packed].sort((a, b) => a.x - b.x || a.z - b.z);
  const qb = roster.findIndex((p, i) => i < nOff && p.pos === 'QB');
  show.runners = packed.map((m) => {
    const k = byX.indexOf(m);
    const ex = (k - (nOff - 1) / 2) * LINE_GAP;
    const ez = TEAM_Z + (((m.i * 29) % 5) / 5 - 0.4) * 0.8;
    // Out of the mouth straight (the control point is on his line down the tunnel), then fanning to his spot.
    const curve = new THREE.QuadraticBezierCurve(new THREE.Vector2(m.x, m.z), new THREE.Vector2(m.x, -50), new THREE.Vector2(ex, ez));
    const b = bodies[m.i]!;
    b.player.root.position.set(m.x, 0, m.z);
    b.player.root.rotation.set(0, 0, 0);
    b.yaw = 0;
    b.lastYaw = 0;
    b.animator.update(10, { speed: 0 });
    return {
      i: m.i,
      curve,
      len: curve.getLength(),
      s: 0,
      v: 0,
      // 64% of his top speed (yd/s to m/s).
      pace: PACE * m.fx.vmax * YARD,
      tau: Math.max(0.35, m.fx.tau * 0.8),
      t0: 0.25 + m.row * 0.32 + (((m.i * 17) % 5) / 5) * 0.12,
      hype: m.i === qb ? 'both' : m === packed[0] && m.i !== qb ? 'r' : null,
      done: false,
    } satisfies Runner;
  });
  // The Beasts: a line facing the tunnel, the best man in the middle.
  const starId = reveal.info?.star.id;
  const beasts = roster.slice(nOff).map((p, k) => ({ i: nOff + k, p }));
  // Left to right as the Beasts shot sees them (from the north): corners outside, the front in the middle.
  const ORDER = ['RCB', 'SS', 'SLB', 'RE', 'RDT', 'MLB', 'LDT', 'LE', 'WLB', 'FS', 'LCB'];
  const slotOf = (k: number) => bodies[k]!.slot;
  const line = ORDER.map((s) => beasts.find((x) => slotOf(x.i) === s)).filter((x): x is { i: number; p: SimPlayer } => !!x);
  for (const x of beasts) if (!line.includes(x)) line.push(x);
  const si = line.findIndex((x) => x.p.id === starId);
  const mid = Math.floor(line.length / 2);
  if (si >= 0 && si !== mid) [line[si], line[mid]] = [line[mid]!, line[si]!];
  show.star = line[mid]?.i ?? -1;
  line.forEach((x, k) => {
    // Seen from the north, left of frame is +x.
    const wx = ((line.length - 1) / 2 - k) * BEASTS_GAP;
    const b = bodies[x.i]!;
    // Facing the tunnel (north, −z: a half turn), each a touch off square.
    const yaw = Math.PI + (((x.i * 41) % 9) / 9 - 0.5) * 0.24;
    b.player.root.position.set(wx, 0, BEASTS_Z + (((x.i * 13) % 5) / 5 - 0.4) * 0.5);
    b.player.root.rotation.set(0, yaw, 0);
    b.yaw = b.lastYaw = yaw;
    // Out of step with each other: the breathing loop starts somewhere different for each.
    b.animator.update(((x.i * 7) % 11) / 5 + 10, { speed: 0 });
    if (x.i === show.star) show.starX = wx;
  });
}

/**
 * One frame of the reveal's bodies (GameScene, in place of the play):
 * the run-out on the run-out's clock, the Beasts breathing in their line.
 */
/** What the reveal's per-frame body pass costs (dev: the perf numbers in docs/m7/TUNNEL.md). */
export const revealStats = { frames: 0, ms: 0, worstMs: 0, setUpMs: 0 };
if (import.meta.env.DEV) Object.assign(globalThis, { __btbRevealStats: revealStats });

export function revealBodies(bodies: Body[], roster: SimPlayer[], nOff: number, dt: number, now: number, camera: THREE.Camera, viewportPx: number): void {
  const t0 = performance.now();
  if (show.epoch !== reveal.epoch) {
    setUp(bodies, roster, nOff);
    revealStats.setUpMs = performance.now() - t0;
  }
  runOut(bodies, nOff, dt, now, camera, viewportPx);
  const ms = performance.now() - t0;
  revealStats.frames++;
  revealStats.ms += ms;
  revealStats.worstMs = Math.max(revealStats.worstMs, ms);
}

function runOut(bodies: Body[], nOff: number, dt: number, now: number, camera: THREE.Camera, viewportPx: number): void {
  show.bodies = bodies;
  const t = reveal.t;
  for (const r of show.runners) {
    const b = bodies[r.i]!;
    const root = b.player.root;
    if (!r.done && t >= r.t0) {
      // Up to his pace on his own acceleration, pulling up over the last few strides.
      r.v += (r.pace - r.v) * (1 - Math.exp(-dt / r.tau));
      r.v = Math.min(r.v, Math.sqrt(2 * BRAKE * Math.max(0, r.len - r.s)));
      r.s += r.v * dt;
      if (r.len - r.s < 0.08 || r.v < 0.15) {
        r.s = Math.min(r.s, r.len);
        r.done = r.len - r.s < 0.5;
        if (r.done) r.v = 0;
      }
      const u = Math.min(1, r.s / r.len);
      const p = r.curve.getPointAt(u);
      root.position.set(p.x, 0, p.y);
      if (r.v > 0.3) {
        const tg = r.curve.getTangentAt(u);
        b.yaw = Math.atan2(tg.x, tg.y);
      }
      // The hype, as he comes out into the light.
      if (r.hype && p.y > TUNNEL.mouth + 1.5) {
        b.animator.playOverlay('ref_touchdown', { rate: 1.15, t0: 0.15, mask: r.hype === 'both' ? [...arm('l'), ...arm('r')] : arm('r') });
        r.hype = null;
      }
    }
    // Pulled up: turn square to the Beasts (yaw 0 faces +z).
    if (r.done) b.yaw += (0 - b.yaw) * (1 - Math.exp(-dt * 3));
    root.rotation.y = b.yaw;
    const yawRate = dt > 0 ? (b.yaw - b.lastYaw) / dt : 0;
    const accel = dt > 0 ? (r.v - b.lastSpeed) / dt : 0;
    b.lastYaw = b.yaw;
    b.lastSpeed = r.v;
    b.animator.update(dt, { speed: r.v, yawRate: Math.max(-4, Math.min(4, yawRate)), accel: Math.max(-12, Math.min(12, accel)) });
    b.player.updateLod(camera, viewportPx);
  }
  for (let i = nOff; i < bodies.length; i++) {
    const b = bodies[i]!;
    b.animator.update(dt, { speed: 0 });
    b.player.updateLod(camera, viewportPx);
  }
  stage(dt, now);
}

/** The mouth's pyro and smoke and the crowd, on the reveal's clock. */
function stage(dt: number, now: number): void {
  const vfx = activeVfx();
  const shot = reveal.shot;
  const st = reveal.shotT;
  if (shot === 'tunnel') {
    // Smoke rolling out of the mouth as the team comes through it.
    if (vfx && st < 2.2) {
      show.smokeAcc += dt;
      while (show.smokeAcc > 0.3) {
        show.smokeAcc -= 0.3;
        const side = Math.sin(st * 9.1) > 0 ? 1 : -1;
        vfx.emit('smoke', [TUNNEL.x + side * (TUNNEL.width / 2 + 0.6), 0.15, TUNNEL.mouth + 0.5], { dir: [side * 0.5, 0, 1], scale: 0.5 });
      }
    }
    // Two gerbs either side of the mouth as the front of the pack comes out.
    if (vfx && st > 1.1 && st < 3.2) {
      show.pyroAcc += dt;
      while (show.pyroAcc > 0.12) {
        show.pyroAcc -= 0.12;
        for (const s of [-1, 1]) vfx.emit('pyro', [TUNNEL.x + s * (TUNNEL.width / 2 + 1.1), 0.3, TUNNEL.mouth + 0.8], { dir: [0, 1, 0], scale: 0.14 });
      }
    }
    // The visitors: the bowl comes up as they hit the light (it's the Beasts' house: not all the way).
    if (!show.roared.out && st > 1.4) {
      show.roared.out = true;
      crowdEnergy.trigger('walkout', now);
      Audio.crowdRoar(0.7, 1.1, 5);
    }
  }
  // The home team on the big screen: the bowl at its loudest.
  // (The fast version has no Beasts shot: the roar comes on the face-off.)
  if ((shot === 'beasts' || shot === 'faceoff') && !show.roared.beasts) {
    show.roared.beasts = true;
    crowdEnergy.trigger('beastsRoar', now);
    // The Beasts' cue: the stadium horn and the sub hit, and the roar on top.
    Audio.titleSting();
    Audio.crowdRoar(1, 0.5, 6);
  }
}

export interface RevealPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const TX = TUNNEL.x;
/** The tunnel shot's Steadicam-to-skycam path (t, world x y z), on the normal timing: behind the pack, out of the mouth, up and over. */
const TUNNEL_KEYS: [number, THREE.Vector3][] = [
  [0, v3(TX + 0.9, 1.78, TUNNEL.back + 0.7)],
  [1.2, v3(TX + 0.85, 1.76, TUNNEL.back + 1.4)],
  [2.6, v3(TX + 0.5, 1.72, TUNNEL.back + 5.2)],
  [3.8, v3(TX - 0.3, 2.4, TUNNEL.mouth + 0.9)],
  [5.5, v3(TX - 2.6, 6.2, TUNNEL.mouth + 6.6)],
  [7.4, v3(TX - 5.6, 11.5, TUNNEL.mouth + 12.4)],
];
const tunnelPath = new THREE.CatmullRomCurve3(
  TUNNEL_KEYS.map((k) => k[1]),
  false,
  'centripetal',
);
/** The path's parameter at a key's time (the keys are spaced by time, not distance). */
function pathAt(t: number): THREE.Vector3 {
  const K = TUNNEL_KEYS;
  const last = K.length - 1;
  if (t <= 0) return K[0]![1].clone();
  if (t >= K[last]![0]) return K[last]![1].clone();
  let i = 0;
  while (K[i + 1]![0] < t) i++;
  const f = (t - K[i]![0]) / (K[i + 1]![0] - K[i]![0]);
  return tunnelPath.getPoint((i + f) / last);
}

const _c = new THREE.Vector3();
/** Where the run-out's leaders are (the Steadicam frames the pack's front half). */
function packFront(bodies: Body[]): THREE.Vector3 {
  _c.set(0, 0, 0);
  let n = 0;
  for (const r of show.runners.slice(0, 6)) {
    _c.add(bodies[r.i]!.player.root.position);
    n++;
  }
  return n ? _c.divideScalar(n) : _c.set(TX, 0, TUNNEL.mouth);
}

/** The camera this frame (world). The tunnel shot's time runs on the normal timing (the fast version plays its first 5.6 s). */
export function revealPose(out: RevealPose): RevealPose {
  const bodies = show.epoch === reveal.epoch ? show.bodies : null;
  const shot = reveal.shot;
  const st = reveal.shotT;
  if (shot === 'hold' || shot === 'tunnel') {
    const t = shot === 'hold' ? 0 : st;
    const fast = reveal.info?.fast ?? false;
    // The fast version goes up sooner: its keys are squeezed into its length.
    const tk = fast ? t * (REVEAL_SECS.normal.tunnel / REVEAL_SECS.fast.tunnel) : t;
    out.pos.copy(pathAt(tk));
    // A walking bob while on foot in the tunnel, gone once the wire takes him up.
    const onFoot = 1 - smooth(3.0, 4.2, tk);
    out.pos.y += onFoot * (0.022 * Math.sin(tk * 10.5) + 0.008 * Math.sin(tk * 3.1));
    out.pos.x += onFoot * 0.015 * Math.sin(tk * 5.2 + 1);
    // Look: at the pack's front (ahead of them, at chest height) to the field and the Beasts beyond.
    const front = bodies && show.runners.length ? packFront(bodies) : v3(TX, 0, TUNNEL.mouth);
    const near = v3(front.x * 0.7 + TX * 0.3, 1.25, front.z + 9);
    const far = v3(1.5, 0.6, BEASTS_Z - 4);
    out.look.copy(near).lerp(far, smooth(2.4, 6.4, tk));
    out.fov = 58 - 12 * smooth(2.4, 7.4, tk);
    return out;
  }
  if (shot === 'beasts') {
    // Low and long across the line from the north-west, the sun off the camera's right shoulder
    // (straight on, they're silhouettes against it): a dolly that tracks down the wall of black
    // jerseys to the best man and settles with him right of center, clear of his lower third.
    const k = ease(st / REVEAL_SECS.normal.beasts);
    const sx = show.starX;
    // (Seen from the north-west, east of him is left of frame: look a little east of him to sit him right.)
    // It ends as a full-length portrait of him (~5 m on a 22° lens) with his neighbours either side.
    out.pos.set(sx - 9.5 + 6.6 * k, 1.3, BEASTS_Z - 8.8 + 3.7 * k);
    out.look.set(sx + 6 - 5.2 * k, 1.35, BEASTS_Z);
    out.fov = 26 - 4 * k;
    return out;
  }
  // The face-off: over the Contenders' shoulders from behind their line, the Beasts facing them
  // across midfield and the sea past them, the sun going down over it; a slow push in.
  const total = reveal.info?.fast ? REVEAL_SECS.fast.faceoff : REVEAL_SECS.normal.faceoff;
  const k = ease(st / total);
  out.pos.set(-3 + 1.5 * k, 5.6 - 0.8 * k, TEAM_Z - 14 + 2.5 * k);
  out.look.set(-0.5, 1.3, BEASTS_Z - 6);
  out.fov = 44 - 3 * k;
  return out;
}

/** The exposure the reveal holds: the white of the walk-out resolving like an eye adjusting, the Beasts' backlit shot opened up a little. */
export function revealExposure(): number {
  const shot = reveal.shot;
  const st = reveal.shotT;
  if (shot === 'hold') return 8;
  if (shot === 'tunnel') {
    const fast = reveal.info?.fast ?? false;
    const tk = fast ? st * (REVEAL_SECS.normal.tunnel / REVEAL_SECS.fast.tunnel) : st;
    return 1 + 7 * Math.exp(-tk / 0.32) + 0.9 * (1 - smooth(2.6, 4.2, tk));
  }
  return shot === 'beasts' ? 1.35 : 1;
}

/** Apply the reveal's exposure (and give it back when it's over). */
export function revealView(on: boolean): void {
  view.exposureMul = on ? revealExposure() : 1;
}
