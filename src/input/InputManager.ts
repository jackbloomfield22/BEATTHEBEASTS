import { ACTIONS, type Bindings, type InputContext } from './actions';

// Keyboard, mouse and gamepad -> actions. One instance for the whole app.
// UI code subscribes with `onAction`; gameplay (later milestones) samples
// `isHeld` / per-tick InputFrames. Contexts are a stack: the top context plus
// 'global' are active.

export type Device = 'keyboard' | 'mouse' | 'gamepad';
type Listener = (actionId: string, info: { repeat: boolean; device: Device }) => void;

const PAD_BUTTONS = ['Pad:A', 'Pad:B', 'Pad:X', 'Pad:Y', 'Pad:LB', 'Pad:RB', 'Pad:LT', 'Pad:RT', 'Pad:View', 'Pad:Menu', 'Pad:LS', 'Pad:RS', 'Pad:Up', 'Pad:Down', 'Pad:Left', 'Pad:Right'];
const STICK_THRESHOLD = 0.55;
/** Analog dead zone (typical Xbox pad drift sits under 0.15). */
const STICK_DEAD = 0.2;
const REPEAT_DELAY_MS = 380;
const REPEAT_RATE_MS = 90;

/** Keys the browser would otherwise act on (scroll, back, focus change, help). */
const CAPTURED_CODES = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Backspace', 'PageUp', 'PageDown', 'F1', 'F2', 'F3', 'Home', 'End']);

class InputManagerImpl {
  private contexts: InputContext[] = ['menu'];
  private listeners = new Set<Listener>();
  private held = new Set<string>();
  private kb: Bindings = {};
  private pad: Bindings = {};
  private reverse = new Map<string, string[]>(); // input code -> action ids
  private padPrev = new Set<string>();
  private padRepeatAt = new Map<string, number>();
  private captureCb: ((code: string | null) => void) | null = null;
  private started = false;
  lastDevice: Device = 'keyboard';
  /** Analog sticks (radial dead zone applied), x right, y up. */
  readonly sticks = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
  /** Mouse position in CSS pixels. */
  readonly mouse = { x: 0, y: 0 };
  private deviceListeners = new Set<(d: Device) => void>();
  padConnected = false;

  setBindings(kb: Bindings, pad: Bindings): void {
    this.kb = kb;
    this.pad = pad;
    this.reverse.clear();
    for (const [id, codes] of [...Object.entries(kb), ...Object.entries(pad)]) {
      for (const c of codes) {
        const list = this.reverse.get(c) ?? [];
        list.push(id);
        this.reverse.set(c, list);
      }
    }
  }

  pushContext(ctx: InputContext): () => void {
    this.contexts.push(ctx);
    return () => {
      const i = this.contexts.lastIndexOf(ctx);
      if (i >= 0) this.contexts.splice(i, 1);
    };
  }

  get activeContext(): InputContext {
    return this.contexts[this.contexts.length - 1] ?? 'menu';
  }

  onAction(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onDevice(cb: (d: Device) => void): () => void {
    this.deviceListeners.add(cb);
    return () => this.deviceListeners.delete(cb);
  }

  /** Next raw input is delivered to cb instead of firing actions (rebinding). Esc cancels. */
  captureNext(cb: (code: string | null) => void): void {
    this.captureCb = cb;
  }

  isHeld(actionId: string): boolean {
    const codes = [...(this.kb[actionId] ?? []), ...(this.pad[actionId] ?? [])];
    return codes.some((c) => this.held.has(c));
  }

  /** A raw input (key code, Mouse0, Pad:A) is down right now, whatever the context. */
  isCodeHeld(code: string): boolean {
    return this.held.has(code);
  }

  private setDevice(d: Device): void {
    if (d !== this.lastDevice) {
      this.lastDevice = d;
      this.deviceListeners.forEach((l) => l(d));
    }
  }

  private fire(code: string, repeat: boolean, device: Device): boolean {
    const ids = this.reverse.get(code);
    if (!ids) return false;
    const ctx = this.activeContext;
    let handled = false;
    for (const id of ids) {
      const def = ACTIONS.find((d) => d.id === id);
      if (!def || (def.context !== ctx && def.context !== 'global')) continue;
      handled = true;
      this.listeners.forEach((l) => l(id, { repeat, device }));
    }
    return handled;
  }

  private handleCapture(code: string): boolean {
    if (!this.captureCb) return false;
    const cb = this.captureCb;
    this.captureCb = null;
    cb(code === 'Escape' ? null : code);
    return true;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    window.addEventListener('keydown', (e) => {
      this.setDevice('keyboard');
      // Let text fields (search boxes) type normally except navigation keys.
      const typing = (e.target as HTMLElement | null)?.dataset?.textInput === 'true';
      if (typing && !['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab'].includes(e.code)) return;
      if (CAPTURED_CODES.has(e.code) || (e.altKey && e.code.startsWith('Arrow'))) e.preventDefault();
      if (!e.repeat && this.handleCapture(e.code)) {
        e.preventDefault();
        return;
      }
      if (!e.repeat) this.held.add(e.code);
      if (this.fire(e.code, e.repeat, 'keyboard')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());

    window.addEventListener('mousedown', (e) => {
      this.setDevice('mouse');
      const code = `Mouse${e.button}`;
      if (this.captureCb && this.handleCapture(code)) return;
      this.held.add(code);
      // Menus take clicks from their own elements; gameplay contexts bind mouse buttons.
      if (this.activeContext !== 'menu') this.fire(code, false, 'mouse');
    });
    window.addEventListener('mouseup', (e) => this.held.delete(`Mouse${e.button}`));
    window.addEventListener(
      'mousemove',
      (e) => {
        this.mouse.x = e.clientX;
        this.mouse.y = e.clientY;
        this.setDevice('mouse');
      },
      { passive: true },
    );
    // No browser context menu anywhere in the game.
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    // Middle-click autoscroll and ctrl+wheel zoom would break the fixed layout.
    window.addEventListener('auxclick', (e) => e.button === 1 && e.preventDefault());
    window.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });

    window.addEventListener('gamepadconnected', () => (this.padConnected = true));
    window.addEventListener('gamepaddisconnected', () => (this.padConnected = navigator.getGamepads().some(Boolean)));

    const loop = (t: number) => {
      this.pollGamepads(t);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  private pollGamepads(now: number): void {
    const pads = navigator.getGamepads?.() ?? [];
    const pressed = new Set<string>();
    const stick = (out: { x: number; y: number }, x: number, y: number) => {
      // Radial dead zone, rescaled so the edge of the zone is 0 (no jump).
      const m = Math.hypot(x, y);
      const k = m < STICK_DEAD ? 0 : Math.min(1, (m - STICK_DEAD) / (1 - STICK_DEAD)) / m;
      out.x = x * k;
      out.y = -y * k;
    };
    stick(this.sticks.left, 0, 0);
    stick(this.sticks.right, 0, 0);
    for (const gp of pads) {
      if (!gp || gp.mapping !== 'standard') continue;
      this.padConnected = true;
      gp.buttons.forEach((b, i) => {
        const name = PAD_BUTTONS[i];
        if (name && (b.pressed || b.value > 0.5)) pressed.add(name);
      });
      const [lx = 0, ly = 0, rx = 0, ry = 0] = gp.axes;
      if (Math.hypot(lx, ly) > STICK_DEAD) stick(this.sticks.left, lx, ly);
      if (Math.hypot(rx, ry) > STICK_DEAD) stick(this.sticks.right, rx, ry);
      if (ly < -STICK_THRESHOLD) pressed.add('Pad:LSUp');
      if (ly > STICK_THRESHOLD) pressed.add('Pad:LSDown');
      if (lx < -STICK_THRESHOLD) pressed.add('Pad:LSLeft');
      if (lx > STICK_THRESHOLD) pressed.add('Pad:LSRight');
      if (ry < -STICK_THRESHOLD) pressed.add('Pad:RSUp');
      if (ry > STICK_THRESHOLD) pressed.add('Pad:RSDown');
      if (rx < -STICK_THRESHOLD) pressed.add('Pad:RSLeft');
      if (rx > STICK_THRESHOLD) pressed.add('Pad:RSRight');
    }
    for (const code of pressed) {
      if (!this.padPrev.has(code)) {
        this.setDevice('gamepad');
        this.held.add(code);
        if (this.captureCb) {
          if (code.startsWith('Pad:')) this.handleCapture(code);
        } else this.fire(code, false, 'gamepad');
        this.padRepeatAt.set(code, now + REPEAT_DELAY_MS);
      } else {
        const at = this.padRepeatAt.get(code) ?? Infinity;
        if (now >= at && this.activeContext === 'menu') {
          this.fire(code, true, 'gamepad');
          this.padRepeatAt.set(code, now + REPEAT_RATE_MS);
        }
      }
    }
    for (const code of this.padPrev) {
      if (!pressed.has(code)) {
        this.held.delete(code);
        this.padRepeatAt.delete(code);
      }
    }
    this.padPrev = pressed;
  }

  rumble(strong: number, weak: number, ms: number): void {
    for (const gp of navigator.getGamepads?.() ?? []) {
      const act = (gp as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null)?.vibrationActuator;
      act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => undefined);
    }
  }
}

export const Input = new InputManagerImpl();
