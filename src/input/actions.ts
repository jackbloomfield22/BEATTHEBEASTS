// Action map: every input the game understands, grouped by context, with the
// keyboard/mouse and gamepad defaults from GDD §8. Bindings are rebindable per
// context; the rebinding UI checks conflicts only within a context because
// contexts never overlap at runtime.

export type InputContext =
  | 'menu'
  | 'playCall'
  | 'preSnap'
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

  // Play call
  a('playCall.suggested', 'playCall', 'Suggested plays', ['KeyG'], ['Pad:Y']),
  a('playCall.flip', 'playCall', 'Flip play', ['Tab'], ['Pad:RB']),

  // Pre-snap
  a('preSnap.snap', 'preSnap', 'Snap', ['Space'], ['Pad:A']),
  a('preSnap.hotRoute', 'preSnap', 'Hot route', ['KeyH'], ['Pad:Y']),
  a('preSnap.audible', 'preSnap', 'Audible', ['KeyZ'], ['Pad:X']),
  a('preSnap.motion', 'preSnap', 'Motion', ['KeyM'], ['Pad:LB']),
  a('preSnap.flip', 'preSnap', 'Flip play', ['Tab'], ['Pad:RB']),
  a('preSnap.reads', 'preSnap', 'Show reads / coverage shell', ['AltLeft'], ['Pad:LT']),

  // Pocket (QB)
  a('pocket.moveUp', 'pocket', 'Step up', ['KeyW'], ['Pad:LSUp']),
  a('pocket.moveDown', 'pocket', 'Drift back', ['KeyS'], ['Pad:LSDown']),
  a('pocket.moveLeft', 'pocket', 'Slide / roll left', ['KeyA'], ['Pad:LSLeft']),
  a('pocket.moveRight', 'pocket', 'Slide / roll right', ['KeyD'], ['Pad:LSRight']),
  a('pocket.throw1', 'pocket', 'Throw to receiver 1', ['Digit1'], ['Pad:A']),
  a('pocket.throw2', 'pocket', 'Throw to receiver 2', ['Digit2'], ['Pad:B']),
  a('pocket.throw3', 'pocket', 'Throw to receiver 3', ['Digit3'], ['Pad:X']),
  a('pocket.throw4', 'pocket', 'Throw to receiver 4', ['Digit4'], ['Pad:Y']),
  a('pocket.throw5', 'pocket', 'Throw to receiver 5', ['Digit5'], ['Pad:RB']),
  a('pocket.throwClick', 'pocket', 'Throw to clicked receiver', ['Mouse0'], [], true),
  a('pocket.pumpFake', 'pocket', 'Pump fake', ['Mouse2'], ['Pad:LB']),
  a('pocket.throwAway', 'pocket', 'Throw it away', ['KeyQ'], ['Pad:RS']),

  // Ball in air
  a('air.switch', 'ballInAir', 'Switch to target', ['Tab'], ['Pad:B']),
  a('air.aggressive', 'ballInAir', 'Aggressive catch', ['Mouse0'], ['Pad:Y']),
  a('air.rac', 'ballInAir', 'Run-after-catch catch', ['Mouse2'], ['Pad:X']),
  a('air.possession', 'ballInAir', 'Possession catch', ['Space'], ['Pad:A']),

  // Ball carrier
  a('carrier.up', 'carrier', 'Run forward', ['KeyW'], ['Pad:LSUp']),
  a('carrier.down', 'carrier', 'Run back', ['KeyS'], ['Pad:LSDown']),
  a('carrier.left', 'carrier', 'Run left', ['KeyA'], ['Pad:LSLeft']),
  a('carrier.right', 'carrier', 'Run right', ['KeyD'], ['Pad:LSRight']),
  a('carrier.sprint', 'carrier', 'Sprint', ['ShiftLeft'], ['Pad:RT']),
  a('carrier.jukeLeft', 'carrier', 'Juke left', ['KeyQ'], ['Pad:RSLeft']),
  a('carrier.jukeRight', 'carrier', 'Juke right', ['KeyE'], ['Pad:RSRight']),
  a('carrier.spin', 'carrier', 'Spin', ['Space'], ['Pad:B']),
  a('carrier.stiffArm', 'carrier', 'Stiff arm', ['KeyF'], ['Pad:X']),
  a('carrier.truck', 'carrier', 'Truck', ['KeyR'], ['Pad:RSUp']),
  a('carrier.dive', 'carrier', 'Dive / QB slide', ['KeyC'], ['Pad:A']),
  a('carrier.protect', 'carrier', 'Protect ball', ['KeyV'], ['Pad:LB']),

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

export const ACTIONS_BY_ID = new Map(ACTIONS.map((d) => [d.id, d]));

export const CONTEXT_LABELS: Record<InputContext, string> = {
  menu: 'Menus',
  playCall: 'Play Call',
  preSnap: 'Pre-Snap',
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
