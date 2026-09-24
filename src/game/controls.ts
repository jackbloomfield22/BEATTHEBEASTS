// Keyboard, mouse and gamepad to the sim's InputFrame (TECH_PLAN §13). The
// sticks and the arrow keys are camera-relative and turned into the field frame here,
// so the recorded frames replay the same whatever the camera did. Presses
// are latched between ticks (a tap shorter than a tick still counts); holds
// are read live.

import { Input } from '@/input/InputManager';
import { NEUTRAL, type CatchType, type InputFrame, type RouteName } from '@/sim';
import type { V2 } from '@/sim/vec';
import { latency, type LatKind } from './latency';
import { AIM_RADIUS, view } from './view';

type HoldSource = { kind: 'key'; action: string } | { kind: 'mouse' } | { kind: 'pad'; action: string };

const THROW_ACTIONS = ['pocket.throw1', 'pocket.throw2', 'pocket.throw3', 'pocket.throw4', 'pocket.throw5'];
/** Clicks this close to an icon (CSS px) pick it. */
const CLICK_RADIUS = 70;

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
  'carrier.sprint': 'sprint',
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
  private hold: { icon: number; src: HoldSource } | null = null;
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

  sample(): InputFrame {
    const ctx = Input.activeContext;
    const e = this.edges;
    const f: InputFrame = { ...NEUTRAL, move: { x: 0, y: 0 }, aim: { x: 0, y: 0 } };
    const pocket = ctx === 'pocket';
    const carrier = ctx === 'carrier';
    f.sprint = Input.isHeld('carrier.sprint');
    f.snap = e.has('preSnap.snap');
    if (this.pendingHot) {
      f.hotRoute = this.pendingHot;
      this.pendingHot = null;
    }

    if (pocket) {
      // Start a hold: a receiver key or button, or a click near an icon.
      if (!this.hold) {
        THROW_ACTIONS.forEach((a, k) => {
          if (!this.hold && e.has(a)) this.hold = { icon: k + 1, src: this.edgeDevice.get(a) === 'gamepad' ? { kind: 'pad', action: a } : { kind: 'key', action: a } };
        });
        if (!this.hold && e.has('pocket.throwClick')) {
          const icon = this.nearestIcon(Input.mouse.x, Input.mouse.y);
          if (icon) this.hold = { icon, src: { kind: 'mouse' } };
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
          const ox = Input.mouse.x - v.x;
          const oy = Input.mouse.y - v.y;
          this.aim = Math.hypot(ox, oy) < AIM_RADIUS * 2.5 ? this.placement(ox, oy, h.icon) : this.placement(0, 0, h.icon);
        }
        f.aim = { ...this.aim };
        if (still) f.throwHeld = h.icon;
        else {
          // Released this tick: the sim throws with this frame's placement.
          latency.press('throwRelease', h.src.kind === 'mouse' ? Input.releasedAt('pocket.throwClick') : Input.releasedAt(h.src.action));
          this.hold = null;
          this.reticle.icon = 0;
        }
      }
      if (!h || h.src.kind !== 'pad') f.move = this.moveVector(false);
      f.pumpFake = e.has('pocket.pumpFake');
      f.throwAway = e.has('pocket.throwAway');
    } else {
      this.hold = null;
      this.reticle.icon = 0;
    }

    if (ctx === 'ballInAir') {
      const c: CatchType | null = e.has('air.aggressive') ? 'aggressive' : e.has('air.rac') ? 'rac' : e.has('air.possession') ? 'possession' : null;
      f.catchType = c;
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
    }
    e.clear();
    return f;
  }
}
