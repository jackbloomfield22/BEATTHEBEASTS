// Button prompts (M6.6, Playtest 1: "with a controller connected, every
// prompt shows the button, never a number"). Pure: which input a prompt
// shows for an action on the device in use, and how a gamepad input is
// drawn (the glyph's shape, its letter and its colour). The drawing itself
// is src/ui/components/Glyph.tsx; the device in use is InputManager's.

import { inputLabel, type Bindings } from './actions';

/** What the prompts show: keys and mouse, or the pad's buttons. */
export type PromptDevice = 'kb' | 'pad';

/** A gamepad input as drawn. */
export type PadGlyphSpec =
  | { kind: 'face'; letter: 'A' | 'B' | 'X' | 'Y'; color: string }
  | { kind: 'bumper'; label: 'LB' | 'RB' }
  | { kind: 'trigger'; label: 'LT' | 'RT' }
  | { kind: 'stick'; side: 'L' | 'R'; dir: 'up' | 'down' | 'left' | 'right' | null; click: boolean }
  | { kind: 'dpad'; dir: 'up' | 'down' | 'left' | 'right' | 'vertical' | 'horizontal' | null }
  | { kind: 'view' }
  | { kind: 'menu' };

/**
 * The face buttons' colours, the Xbox layout's (the controller the owner
 * plays on): A green, B red, X blue, Y yellow. Brightened from the pad's
 * own plastics so the letters read on the dark HUD panels.
 */
export const FACE_COLOR = { A: '#6fd34f', B: '#ff5a4f', X: '#4ba6ff', Y: '#ffd23f' } as const;

const DIRS = { Up: 'up', Down: 'down', Left: 'left', Right: 'right' } as const;

/** How a `Pad:…` input code is drawn; null for a key or mouse input. */
export function padGlyph(code: string): PadGlyphSpec | null {
  if (!code.startsWith('Pad:')) return null;
  const k = code.slice(4);
  if (k === 'A' || k === 'B' || k === 'X' || k === 'Y') return { kind: 'face', letter: k, color: FACE_COLOR[k] };
  if (k === 'LB' || k === 'RB') return { kind: 'bumper', label: k };
  if (k === 'LT' || k === 'RT') return { kind: 'trigger', label: k };
  if (k === 'View') return { kind: 'view' };
  if (k === 'Menu') return { kind: 'menu' };
  if (k === 'LS' || k === 'RS') return { kind: 'stick', side: k[0] as 'L' | 'R', dir: null, click: true };
  if (k === 'LStick' || k === 'RStick') return { kind: 'stick', side: k[0] as 'L' | 'R', dir: null, click: false };
  const stick = /^(L|R)S(Up|Down|Left|Right)$/.exec(k);
  if (stick) return { kind: 'stick', side: stick[1] as 'L' | 'R', dir: DIRS[stick[2] as keyof typeof DIRS], click: false };
  if (k === 'DPad') return { kind: 'dpad', dir: null };
  if (k === 'DPadV') return { kind: 'dpad', dir: 'vertical' };
  if (k === 'DPadH') return { kind: 'dpad', dir: 'horizontal' };
  if (k in DIRS) return { kind: 'dpad', dir: DIRS[k as keyof typeof DIRS] };
  return null;
}

/** The input a prompt shows for an action on this device (its first binding), or null if it has none there. */
export function promptCode(action: string, device: PromptDevice, kb: Bindings, pad: Bindings): string | null {
  const list = (device === 'pad' ? pad : kb)[action];
  return list?.[0] ?? null;
}

/** A prompt as text (for places that can't draw a glyph: titles, logs); never a number on a pad. */
export function promptText(action: string, device: PromptDevice, kb: Bindings, pad: Bindings): string {
  const c = promptCode(action, device, kb, pad);
  return c ? inputLabel(c) : '—';
}

/**
 * The pad side of a written hint ("A", "LB / RB", "Hold A", "D-Pad",
 * "Stick", "—") as input codes and words, so every hint in the menus draws
 * glyphs without each screen spelling out codes. `kb` (the key side of the
 * same hint) says which way a bare "D-Pad" points. Null: the hint has no
 * pad input (it's hidden on a pad rather than show a dash).
 */
export function parsePadHint(pad: string, kb = ''): (string | { code: string })[] | null {
  const t = pad.trim();
  if (!t || t === '—' || t === '-') return null;
  const vertical = /[↑↓]/.test(kb);
  const horizontal = /[←→]/.test(kb);
  const out: (string | { code: string })[] = [];
  for (const w of t.split(/\s+/)) {
    if (w === '/') continue;
    const code = HINT_WORDS[w] ?? (w === 'D-Pad' ? (vertical && !horizontal ? 'Pad:DPadV' : horizontal && !vertical ? 'Pad:DPadH' : 'Pad:DPad') : null);
    if (code) out.push({ code });
    else if (w === '←' || w === '→') {
      if (!out.some((o) => typeof o !== 'string' && o.code === 'Pad:DPadH')) out.push({ code: 'Pad:DPadH' });
    } else if (w === '↑' || w === '↓') {
      if (!out.some((o) => typeof o !== 'string' && o.code === 'Pad:DPadV')) out.push({ code: 'Pad:DPadV' });
    } else out.push(w);
  }
  return out;
}

const HINT_WORDS: Record<string, string> = {
  A: 'Pad:A',
  B: 'Pad:B',
  X: 'Pad:X',
  Y: 'Pad:Y',
  LB: 'Pad:LB',
  RB: 'Pad:RB',
  LT: 'Pad:LT',
  RT: 'Pad:RT',
  View: 'Pad:View',
  Menu: 'Pad:Menu',
  Start: 'Pad:Menu',
  Stick: 'Pad:LStick',
  'L-Stick': 'Pad:LStick',
  'R-Stick': 'Pad:RStick',
};

/**
 * The prompt device from the last input used. A pad press, or the stick
 * pushed past the dead zone, is the pad; a key or a click is the keyboard.
 * Mouse travel only counts past MOUSE_SWITCH_PX since the last other input,
 * so a bumped desk or a settling cursor doesn't flip the prompts away from a
 * controller mid-play (the likeliest reason the owner still saw numbers).
 */
export const MOUSE_SWITCH_PX = 48;

export function promptDeviceOf(last: 'keyboard' | 'mouse' | 'gamepad'): PromptDevice {
  return last === 'gamepad' ? 'pad' : 'kb';
}
