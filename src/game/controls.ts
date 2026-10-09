// Keyboard, mouse and gamepad to the sim's InputFrame (TECH_PLAN §13). The
// sticks and the arrow keys are camera-relative and turned into the field frame here,
// so the recorded frames replay the same whatever the camera did. Presses
// are latched between ticks (a tap shorter than a tick still counts); holds
// are read live.

import { Input } from '@/input/InputManager';
import { NEUTRAL, TICK, type CatchType, type InputFrame, type RouteName } from '@/sim';
import type { V2 } from '@/sim/vec';
import { latency, type LatKind } from './latency';
import { AIM_RADIUS, view } from './view';

type HoldSource = { kind: 'key'; action: string; mx: number; my: number } | { kind: 'mouse' } | { kind: 'pad'; action: string };

/** The receiver hold as the sim has counted it (PlayState.hold): the icon and the ticks it has seen. */
export interface SimHold {
  icon: number;
  ticks: number;
}

/**
 * After the button is up, the hold may run on this many ticks at most to
 * bring the sim's count up to the time the button was really down (a long
 * frame, or a press before he could throw, counts fewer ticks than the hold).
 * 0.1 s: enough to recover a frame hitch, short enough not to delay a throw.
 */
const CATCH_UP_TICKS = 6;

/** A receiver hold being made: the icon, the button's event times, and the ticks it ran on after the button came up. */
export interface ThrowHold {
  icon: number;
  /** True until the hold has gone to the sim once. */
  fresh?: boolean;
  downAt: number;
  upAt: number | null;
  extra: number;
}

/**
 * One tick of a receiver hold: true while the sim should see it held.
 * Timed from the button's own events (Playtest 2: "a tap to throw sometimes
 * didn't fire on a controller"; the same fix as the kick, which times its
 * press and release from the input events).
 *
 * The cause: a hold was let go on the first tick the button read up, whether
 * or not the sim had counted it, and the sim ignores the receiver buttons for
 * the first 0.35 s after the snap (the ball is still coming back) and while a
 * throw winds up (sim/play.ts qbThrow). A quick tap in that window went to
 * the sim for one tick it ignored, then came up: nothing thrown. A pad shows
 * it far more than a keyboard because its buttons are polled once a frame,
 * so a pad tap is one to three ticks long, all of them inside the window
 * when the QB is tapped to on the drop (and a long frame could hide it).
 *
 * Now a hold is kept for the sim until it has counted it: a tap always
 * throws, as soon as he can, and a hold's length is the button's, not the
 * frames' (up to CATCH_UP_TICKS of catching up).
 */
export function holdStep(h: ThrowHold, still: boolean, sim: SimHold | null): boolean {
  if (still || h.fresh) {
    h.fresh = false;
    return true;
  }
  // Not counted by the sim yet: keep it held until it is (a tap never vanishes).
  if (sim && (sim.icon !== h.icon || sim.ticks < 1)) return true;
  // Counted, but for fewer ticks than the button was down: catch up, a little.
  const wanted = Math.max(1, Math.round(((h.upAt ?? h.downAt) - h.downAt) / (TICK * 1000)));
  if (sim && sim.ticks < wanted && h.extra < CATCH_UP_TICKS) {
    h.extra++;
    return true;
  }
  return false;
}

const THROW_ACTIONS = ['pocket.throw1', 'pocket.throw2', 'pocket.throw3', 'pocket.throw4', 'pocket.throw5'];
/** Clicks this close to an icon (CSS px) pick it. */
const CLICK_RADIUS = 70;
/** The mouse must move this far (CSS px) during a receiver key's hold to place the ball (a hand resting on it doesn't). */
const AIM_MOVED = 6;

/**
 * A stick (x right, y up on screen) to the field frame, given the camera's
 * forward on the ground: screen up is that forward, screen right its right.
 */
export function stickToField(sx: number, sy: number, fwd: V2): V2 {
  return { x: sy * fwd.x + sx * fwd.y, y: sy * fwd.y - sx * fwd.x };
}

/**
 * Placement (GDD §9.1) from the reticle's offset (CSS px, y down) and the
 * receiver's motion on screen (unit vector). Along his motion is lead (+) or
 * back shoulder (−). Up the screen is high, but only as far as his motion
 * runs across the screen: on a vertical route, "up" is already the lead.
 */
export function placementFrom(ox: number, oy: number, ux: number, uy: number): V2 {
  const lead = (ox * ux + oy * uy) / AIM_RADIUS;
  const high = (-oy / AIM_RADIUS) * Math.abs(ux);
  return { x: Math.max(-1, Math.min(1, lead)), y: Math.max(-1, Math.min(1, high)) };
}

/** Screen directions of the move keys (x right, y up). */
const MOVE_KEYS: Record<string, [number, number]> = {
  'pocket.moveUp': [0, 1],
  'pocket.moveDown': [0, -1],
  'pocket.moveLeft': [-1, 0],
  'pocket.moveRight': [1, 0],
  'carrier.up': [0, 1],
  'carrier.down': [0, -1],
  'carrier.left': [-1, 0],
  'carrier.right': [1, 0],
};
const PRESS_KIND: Record<string, LatKind> = {
  'preSnap.snap': 'snap',
  'pocket.throw1': 'throwHold',
  'pocket.throw2': 'throwHold',
  'pocket.throw3': 'throwHold',
  'pocket.throw4': 'throwHold',
  'pocket.throw5': 'throwHold',
  'pocket.throwClick': 'throwHold',
  'air.aggressive': 'catch',
  'air.possession': 'catch',
  'air.rac': 'catch',
  'carrier.juke': 'juke',
  'carrier.jukeLeft': 'juke',
  'carrier.jukeRight': 'juke',
  'carrier.spin': 'spin',
  'carrier.stiffArm': 'stiffArm',
  'carrier.truck': 'truck',
  'carrier.dive': 'dive',
  'carrier.protect': 'protect',
};

/** Start a latency sample for a press (the response is marked where it shows). */
function notePress(id: string, time: number): void {
  const mv = MOVE_KEYS[id];
  if (mv) latency.press('move', time, { dir: stickToField(mv[0], mv[1], view.fwd) });
  const kind = PRESS_KIND[id];
  if (kind) latency.press(kind, time);
}

export class Controls {
  private edges = new Set<string>();
  private edgeDevice = new Map<string, string>();
  /** When each latched press happened (its event's time, performance.now() timebase). */
  private edgeTime = new Map<string, number>();
  /**
   * The icon held; `fresh` on the tick it started (a tap shorter than a tick
   * still throws: it's held for that tick). holdStep keeps it held until the
   * sim has counted it.
   */
  private hold: (ThrowHold & { src: HoldSource }) | null = null;
  /** The placement being chosen for the held icon (lead/back shoulder, high/low). */
  aim: V2 = { x: 0, y: 0 };
  private off: () => void;
  /** A hot route to send with the next tick (pre-snap). */
  private pendingHot: { icon: number; route: RouteName } | null = null;
  /** The reticle's offset from the held icon (CSS px), for the HUD. */
  readonly reticle = { x: 0, y: 0, icon: 0 };

  constructor() {
    this.off = Input.onAction((id, info) => {
      if (info.repeat) return;
      this.edges.add(id);
      this.edgeDevice.set(id, info.device);
      this.edgeTime.set(id, info.time);
      notePress(id, info.time);
    });
  }

  dispose(): void {
    this.off();
  }

  /** Call a hot route: it goes to the sim with the next tick. */
  queueHot(icon: number, route: RouteName): void {
    this.pendingHot = { icon, route };
  }

  /** Forget latched presses and holds (a new play, or leaving a pause). */
  clear(): void {
    this.pendingHot = null;
    this.edges.clear();
    this.hold = null;
    this.aim = { x: 0, y: 0 };
    this.reticle.icon = 0;
  }

  /** The icon held right now (1..5, 0 = none) and its charge time is tracked by the sim. */
  get heldIcon(): number {
    return this.hold?.icon ?? 0;
  }

  /** Move stick in the field frame: gamepad left stick, else the arrow keys. */
  private moveVector(carrier: boolean): V2 {
    const L = Input.sticks.left;
    let sx = L.x;
    let sy = L.y;
    if (sx === 0 && sy === 0) {
      const p = carrier ? 'carrier.' : 'pocket.move';
      const up = Input.isHeld(carrier ? `${p}up` : `${p}Up`);
      const down = Input.isHeld(carrier ? `${p}down` : `${p}Down`);
      const left = Input.isHeld(carrier ? `${p}left` : `${p}Left`);
      const right = Input.isHeld(carrier ? `${p}right` : `${p}Right`);
      sx = (right ? 1 : 0) - (left ? 1 : 0);
      sy = (up ? 1 : 0) - (down ? 1 : 0);
      const m = Math.hypot(sx, sy);
      if (m > 1) {
        sx /= m;
        sy /= m;
      }
    }
    return stickToField(sx, sy, view.fwd);
  }

  /** Placement from an offset on screen (CSS px, y down) and the receiver's screen motion. */
  private placement(ox: number, oy: number, icon: number): V2 {
    const m = Math.hypot(ox, oy);
    if (m > AIM_RADIUS) {
      ox *= AIM_RADIUS / m;
      oy *= AIM_RADIUS / m;
    }
    this.reticle.x = ox;
    this.reticle.y = oy;
    this.reticle.icon = icon;
    const v = view.icons[icon - 1]!;
    return placementFrom(ox, oy, v.ux, v.uy);
  }

  private nearestIcon(x: number, y: number): number {
    let best = 0;
    let bd = CLICK_RADIUS;
    view.icons.forEach((v, i) => {
      if (!v.visible) return;
      const d = Math.hypot(v.x - x, v.y - y);
      if (d < bd) {
        bd = d;
        best = i + 1;
      }
    });
    return best;
  }

  /** One tick's input. `sim`: the hold as the sim has counted it so far (a tap is held until the sim has seen it). */
  sample(sim: SimHold | null = null): InputFrame {
    const ctx = Input.activeContext;
    const e = this.edges;
    const f: InputFrame = { ...NEUTRAL, move: { x: 0, y: 0 }, aim: { x: 0, y: 0 } };
    const pocket = ctx === 'pocket';
    const carrier = ctx === 'carrier';
    f.snap = e.has('preSnap.snap');
    if (this.pendingHot) {
      f.hotRoute = this.pendingHot;
      this.pendingHot = null;
    }

    if (pocket) {
      // Start a hold: a receiver key or button, or a click near an icon.
      if (!this.hold) {
        THROW_ACTIONS.forEach((a, k) => {
          if (!this.hold && e.has(a))
            this.hold = {
              icon: k + 1,
              fresh: true,
              src: this.edgeDevice.get(a) === 'gamepad' ? { kind: 'pad', action: a } : { kind: 'key', action: a, mx: Input.mouse.x, my: Input.mouse.y },
              downAt: this.edgeTime.get(a) ?? performance.now(),
              upAt: null,
              extra: 0,
            };
        });
        if (!this.hold && e.has('pocket.throwClick')) {
          const icon = this.nearestIcon(Input.mouse.x, Input.mouse.y);
          if (icon) this.hold = { icon, fresh: true, src: { kind: 'mouse' }, downAt: this.edgeTime.get('pocket.throwClick') ?? performance.now(), upAt: null, extra: 0 };
        }
      }
      const h = this.hold;
      if (h) {
        const still = h.src.kind === 'mouse' ? Input.isCodeHeld('Mouse0') : Input.isHeld(h.src.action);
        const v = view.icons[h.icon - 1]!;
        if (h.src.kind === 'pad') {
          // Gamepad: the left stick places the ball while the button is held (the QB stands).
          const L = Input.sticks.left;
          this.aim = this.placement(L.x * AIM_RADIUS, -L.y * AIM_RADIUS, h.icon);
        } else {
          // Mouse: the cursor's offset from the icon (ignored when it's far away).
          // A receiver key places it only once the mouse is moved while it's down
          // (passing round 3): a cursor left resting near an icon put the key's
          // ball behind the man, a back shoulder nobody asked for.
          const ox = Input.mouse.x - v.x;
          const oy = Input.mouse.y - v.y;
          const still = h.src.kind === 'key' && Math.hypot(Input.mouse.x - h.src.mx, Input.mouse.y - h.src.my) < AIM_MOVED;
          this.aim = !still && Math.hypot(ox, oy) < AIM_RADIUS * 2.5 ? this.placement(ox, oy, h.icon) : this.placement(0, 0, h.icon);
        }
        f.aim = { ...this.aim };
        if (!still && h.upAt === null) {
          // The button's release, from its event (a tap inside one poll reads as released at its press).
          h.upAt = Math.max(h.downAt, h.src.kind === 'mouse' ? Input.releasedAt('pocket.throwClick') : Input.releasedAt(h.src.action));
          latency.press('throwRelease', h.upAt);
        }
        if (holdStep(h, still, sim)) f.throwHeld = h.icon;
        else {
          // Up, and counted by the sim: it throws on this tick with this frame's placement.
          this.hold = null;
          this.reticle.icon = 0;
        }
      }
      if (!h || h.src.kind !== 'pad') f.move = this.moveVector(false);
      f.pumpFake = e.has('pocket.pumpFake');
      f.throwAway = e.has('pocket.throwAway');
      f.scramble = e.has('pocket.scramble');
      // A scrambling QB sprints on the carrier's key, or by keeping the scramble button down (RT on a pad).
      f.sprint = Input.isHeld('carrier.sprint') || Input.isHeld('pocket.scramble');
    } else {
      this.hold = null;
      this.reticle.icon = 0;
    }

    if (ctx === 'ballInAir') {
      const c: CatchType | null = e.has('air.aggressive') ? 'aggressive' : e.has('air.rac') ? 'rac' : e.has('air.possession') ? 'possession' : null;
      f.catchType = c;
      f.auto = e.has('air.auto');
    }

    if (carrier) {
      f.move = this.moveVector(true);
      f.jukeL = e.has('carrier.jukeLeft');
      f.jukeR = e.has('carrier.jukeRight');
      f.juke = e.has('carrier.juke');
      f.spin = e.has('carrier.spin');
      f.stiffArm = e.has('carrier.stiffArm');
      f.truck = e.has('carrier.truck');
      f.dive = e.has('carrier.dive');
      f.protect = Input.isHeld('carrier.protect');
      f.option = e.has('carrier.option1') ? 1 : e.has('carrier.option2') ? 2 : e.has('carrier.option3') ? 3 : 0;
      f.auto = e.has('carrier.auto');
      f.sprint = Input.isHeld('carrier.sprint');
    }
    e.clear();
    return f;
  }
}
