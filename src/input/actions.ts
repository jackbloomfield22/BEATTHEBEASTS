// Action map: every input the game understands, grouped by context, with the
// keyboard/mouse and gamepad defaults from GDD §8. Bindings are rebindable per
// context; the rebinding UI checks conflicts only within a context because
// contexts never overlap at runtime.

export type InputContext =
  | 'menu'
  | 'playCall'
  | 'preSnap'
  | 'hotRoute'
  | 'pocket'
  | 'ballInAir'
  | 'carrier'
  | 'kick'
  | 'replay'
  | 'global';

export interface ActionDef {
  id: string;
  context: InputContext;
  label: string;
  kb: string[]; // KeyboardEvent.code, or Mouse0/Mouse1/Mouse2, WheelUp/WheelDown
  pad: string[]; // Pad:A … see PAD_BUTTONS / PAD_AXES_AS_BUTTONS
  /** Shown in the rebinding list but not rebindable (e.g. mouse aim). */
  fixed?: boolean;
}

export type Bindings = Record<string, string[]>;

const a = (id: string, context: InputContext, label: string, kb: string[], pad: string[], fixed?: boolean): ActionDef => ({ id, context, label, kb, pad, fixed });

export const ACTIONS: ActionDef[] = [
  // Menus
  a('menu.up', 'menu', 'Navigate up', ['ArrowUp', 'KeyW'], ['Pad:Up', 'Pad:LSUp']),
  a('menu.down', 'menu', 'Navigate down', ['ArrowDown', 'KeyS'], ['Pad:Down', 'Pad:LSDown']),
  a('menu.left', 'menu', 'Navigate left / decrease', ['ArrowLeft', 'KeyA'], ['Pad:Left', 'Pad:LSLeft']),
  a('menu.right', 'menu', 'Navigate right / increase', ['ArrowRight', 'KeyD'], ['Pad:Right', 'Pad:LSRight']),
  a('menu.confirm', 'menu', 'Select', ['Enter', 'Space', 'NumpadEnter'], ['Pad:A']),
  a('menu.back', 'menu', 'Back', ['Escape', 'Backspace'], ['Pad:B']),
  a('menu.tabPrev', 'menu', 'Previous tab', ['KeyQ', 'PageUp'], ['Pad:LB']),
  a('menu.tabNext', 'menu', 'Next tab', ['KeyE', 'PageDown'], ['Pad:RB']),
  a('menu.alt', 'menu', 'Secondary action', ['KeyR'], ['Pad:Y']),
  a('menu.alt2', 'menu', 'Third action', ['KeyF'], ['Pad:X']),

  // Play call
  a('playCall.suggested', 'playCall', 'Suggested plays', ['KeyG'], ['Pad:Y']),
  a('playCall.flip', 'playCall', 'Flip play', ['Tab'], ['Pad:RB']),

  // Pre-snap
  a('preSnap.snap', 'preSnap', 'Snap', ['Space'], ['Pad:A']),
  a('preSnap.routes', 'preSnap', 'Show every route (hold)', ['Tab'], ['Pad:RT']),
  a('preSnap.hotRoute', 'preSnap', 'Hot route', ['KeyH'], ['Pad:Y']),
  a('preSnap.audible', 'preSnap', 'Audible', ['KeyZ'], ['Pad:X']),
  a('preSnap.motion', 'preSnap', 'Motion', ['KeyM'], ['Pad:LB']),
  a('preSnap.flip', 'preSnap', 'Flip play', ['KeyF'], ['Pad:RB']),
  a('preSnap.reads', 'preSnap', 'Show reads / coverage shell', ['AltLeft'], ['Pad:LT']),

  // Hot route picker (pre-snap, after the hot-route key): a receiver's
  // number, then his new route by its number (or up/down and confirm).
  // On a gamepad: his button, then the D-pad and A (B goes back).
  a('hot.n1', 'hotRoute', 'Receiver 1 / route 1', ['Digit1'], ['Pad:A']),
  a('hot.n2', 'hotRoute', 'Receiver 2 / route 2', ['Digit2'], ['Pad:B']),
  a('hot.n3', 'hotRoute', 'Receiver 3 / route 3', ['Digit3'], ['Pad:X']),
  a('hot.n4', 'hotRoute', 'Receiver 4 / route 4', ['Digit4'], ['Pad:Y']),
  a('hot.n5', 'hotRoute', 'Receiver 5 / route 5', ['Digit5'], ['Pad:RB']),
  a('hot.n6', 'hotRoute', 'Route 6', ['Digit6'], []),
  a('hot.n7', 'hotRoute', 'Route 7', ['Digit7'], []),
  a('hot.n8', 'hotRoute', 'Route 8', ['Digit8'], []),
  a('hot.up', 'hotRoute', 'Previous route', ['ArrowUp'], ['Pad:Up']),
  a('hot.down', 'hotRoute', 'Next route', ['ArrowDown'], ['Pad:Down']),
  a('hot.confirm', 'hotRoute', 'Choose route', ['Enter', 'Space'], []),
  a('hot.cancel', 'hotRoute', 'Close the picker', ['KeyH'], ['Pad:LB']),

  // Pocket (QB)
  // Movement is on the arrows so the left hand stays on the number row
  // (receivers, then catches) and on Q–F (carrier moves).
  a('pocket.moveUp', 'pocket', 'Step up', ['ArrowUp'], ['Pad:LSUp']),
  a('pocket.moveDown', 'pocket', 'Drift back', ['ArrowDown'], ['Pad:LSDown']),
  a('pocket.moveLeft', 'pocket', 'Slide / roll left', ['ArrowLeft'], ['Pad:LSLeft']),
  a('pocket.moveRight', 'pocket', 'Slide / roll right', ['ArrowRight'], ['Pad:LSRight']),
  a('pocket.throw1', 'pocket', 'Throw to receiver 1', ['Digit1'], ['Pad:A']),
  a('pocket.throw2', 'pocket', 'Throw to receiver 2', ['Digit2'], ['Pad:B']),
  a('pocket.throw3', 'pocket', 'Throw to receiver 3', ['Digit3'], ['Pad:X']),
  a('pocket.throw4', 'pocket', 'Throw to receiver 4', ['Digit4'], ['Pad:Y']),
  a('pocket.throw5', 'pocket', 'Throw to receiver 5', ['Digit5'], ['Pad:RB']),
  a('pocket.throwClick', 'pocket', 'Throw to clicked receiver', ['Mouse0'], [], true),
  a('pocket.pumpFake', 'pocket', 'Pump fake', ['Mouse2'], ['Pad:LB']),
  a('pocket.throwAway', 'pocket', 'Throw it away', ['KeyQ'], ['Pad:RS']),
  a('pocket.scramble', 'pocket', 'Scramble: tuck it and run', ['KeyR'], ['Pad:RT']),

  // Ball in air
  a('air.switch', 'ballInAir', 'Switch to target', ['Tab'], ['Pad:B']),
  a('air.aggressive', 'ballInAir', 'Go up and get it (aggressive)', ['Digit1'], ['Pad:Y']),
  a('air.possession', 'ballInAir', 'Secure it and go down (possession)', ['Digit2'], ['Pad:A']),
  a('air.rac', 'ballInAir', 'Catch and run', ['Digit3'], ['Pad:X']),

  // Ball carrier
  a('carrier.up', 'carrier', 'Run forward', ['ArrowUp'], ['Pad:LSUp']),
  a('carrier.down', 'carrier', 'Run back', ['ArrowDown'], ['Pad:LSDown']),
  a('carrier.left', 'carrier', 'Run left', ['ArrowLeft'], ['Pad:LSLeft']),
  a('carrier.right', 'carrier', 'Run right', ['ArrowRight'], ['Pad:LSRight']),
  // The number row is the moves (1–6, as the prompts show); Q W E R F C stay as second keys.
  // No speed key: he runs at the pace the play calls for and bursts on his own (out of a cut, into open field).
  a('carrier.juke', 'carrier', 'Juke (toward the side you steer, else away from the tackler)', ['Digit1', 'KeyQ'], []),
  a('carrier.jukeLeft', 'carrier', 'Juke left', [], ['Pad:RSLeft']),
  a('carrier.jukeRight', 'carrier', 'Juke right', [], ['Pad:RSRight']),
  a('carrier.stiffArm', 'carrier', 'Stiff arm', ['Digit2', 'KeyW'], ['Pad:X']),
  a('carrier.spin', 'carrier', 'Spin', ['Digit3', 'KeyE'], ['Pad:B']),
  a('carrier.truck', 'carrier', 'Truck', ['Digit4', 'KeyR'], ['Pad:RSUp']),
  a('carrier.dive', 'carrier', 'Dive / QB slide', ['Digit5', 'KeyF'], ['Pad:A']),
  a('carrier.protect', 'carrier', 'Protect ball (hold)', ['Digit6', 'KeyC'], ['Pad:LB']),

  // Kicking
  a('kick.aim', 'kick', 'Aim and power (drag)', ['Mouse0'], ['Pad:RSDown'], true),

  // Replay
  a('replay.orbit', 'replay', 'Orbit camera (drag)', ['Mouse0'], ['Pad:RS'], true),
  a('replay.scrubBack', 'replay', 'Scrub back', ['KeyA'], ['Pad:LB']),
  a('replay.scrubForward', 'replay', 'Scrub forward', ['KeyD'], ['Pad:RB']),
  a('replay.slowmo', 'replay', 'Slow motion', ['KeyS'], ['Pad:X']),
  a('replay.playPause', 'replay', 'Play / pause', ['Space'], ['Pad:A']),
  a('replay.dof', 'replay', 'Depth of field', ['KeyF'], ['Pad:Y']),

  // Global
  a('global.pause', 'global', 'Pause', ['Escape'], ['Pad:Menu']),
  a('global.replay', 'global', 'Instant replay', ['KeyP', 'Backspace'], ['Pad:View']),
  a('global.spike', 'global', 'Spike (two-minute drill)', ['KeyK'], []),
  a('global.kneel', 'global', 'Kneel', ['KeyJ'], []),
  a('global.timeout', 'global', 'Timeout', ['KeyT'], []),
  a('global.camBroadcast', 'global', 'Camera: Broadcast', ['F1'], []),
  a('global.camAll22', 'global', 'Camera: All-22', ['F2'], []),
  a('global.camField', 'global', 'Camera: Field level', ['F3'], []),
  a('global.perf', 'global', 'Performance screen', ['Backquote'], [], true),
  a('global.fullscreen', 'global', 'Toggle fullscreen', ['F11'], []),
];

/**
 * Keyboard defaults that changed in settings v3 (arrows for movement, 1–3
 * for catches, Q–F for carrier moves), with their v2 values. A saved binding
 * still on its v2 default moves to the new one; one the player changed stays.
 */
export const KB_DEFAULTS_V2: Record<string, string[]> = {
  'pocket.moveUp': ['KeyW'],
  'pocket.moveDown': ['KeyS'],
  'pocket.moveLeft': ['KeyA'],
  'pocket.moveRight': ['KeyD'],
  'air.aggressive': ['Mouse0'],
  'air.rac': ['Mouse2'],
  'air.possession': ['Space'],
  'carrier.up': ['KeyW'],
  'carrier.down': ['KeyS'],
  'carrier.left': ['KeyA'],
  'carrier.right': ['KeyD'],
  'carrier.sprint': ['ShiftLeft'],
  'carrier.jukeLeft': ['KeyQ'],
  'carrier.jukeRight': ['KeyE'],
  'carrier.spin': ['Space'],
  'carrier.stiffArm': ['KeyF'],
  'carrier.truck': ['KeyR'],
  'carrier.dive': ['KeyC'],
  'carrier.protect': ['KeyV'],
};

/** Keyboard defaults that changed in settings v4 (route preview on Tab), with their v3 values. */
export const KB_DEFAULTS_V3: Record<string, string[]> = {
  'preSnap.flip': ['Tab'],
};

/** Keyboard defaults that changed in settings v5 (carrier moves on the number row), with their v4 values. */
export const KB_DEFAULTS_V4: Record<string, string[]> = {
  'carrier.juke': ['KeyQ'],
  'carrier.stiffArm': ['KeyW'],
  'carrier.spin': ['KeyE'],
  'carrier.truck': ['KeyR'],
  'carrier.dive': ['KeyF'],
  'carrier.protect': ['KeyC'],
};

/** Keyboard defaults that changed in settings v6 (the scramble off Shift), with their v5 values. */
export const KB_DEFAULTS_V5: Record<string, string[]> = {
  'pocket.scramble': ['ShiftLeft', 'ShiftRight'],
};

export const ACTIONS_BY_ID = new Map(ACTIONS.map((d) => [d.id, d]));

export const CONTEXT_LABELS: Record<InputContext, string> = {
  menu: 'Menus',
  playCall: 'Play Call',
  preSnap: 'Pre-Snap',
  hotRoute: 'Hot Route',
  pocket: 'Passing',
  ballInAir: 'Ball in the Air',
  carrier: 'Ball Carrier',
  kick: 'Kicking',
  replay: 'Replay',
  global: 'General',
};

export function defaultBindings(kind: 'kb' | 'pad'): Bindings {
  const out: Bindings = {};
  for (const d of ACTIONS) out[d.id] = [...d[kind]];
  return out;
}

/** Other actions in the same context (or global) already using this input. */
export function findConflicts(bindings: Bindings, actionId: string, input: string): string[] {
  const def = ACTIONS_BY_ID.get(actionId);
  if (!def) return [];
  return ACTIONS.filter(
    (o) => o.id !== actionId && (o.context === def.context || o.context === 'global' || def.context === 'global') && (bindings[o.id] ?? []).includes(input),
  ).map((o) => o.id);
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Tab: 'Tab',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', PageUp: 'PgUp', PageDown: 'PgDn',
  Mouse0: 'Left Click', Mouse1: 'Middle Click', Mouse2: 'Right Click', WheelUp: 'Wheel Up', WheelDown: 'Wheel Down',
  'Pad:A': 'A', 'Pad:B': 'B', 'Pad:X': 'X', 'Pad:Y': 'Y', 'Pad:LB': 'LB', 'Pad:RB': 'RB', 'Pad:LT': 'LT', 'Pad:RT': 'RT',
  'Pad:View': 'View', 'Pad:Menu': 'Menu', 'Pad:LS': 'L-Stick Click', 'Pad:RS': 'R-Stick Click',
  'Pad:Up': 'D-Pad ↑', 'Pad:Down': 'D-Pad ↓', 'Pad:Left': 'D-Pad ←', 'Pad:Right': 'D-Pad →',
  'Pad:LSUp': 'L-Stick ↑', 'Pad:LSDown': 'L-Stick ↓', 'Pad:LSLeft': 'L-Stick ←', 'Pad:LSRight': 'L-Stick →',
  'Pad:RSUp': 'R-Stick ↑', 'Pad:RSDown': 'R-Stick ↓', 'Pad:RSLeft': 'R-Stick ←', 'Pad:RSRight': 'R-Stick →',
};

export function inputLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
