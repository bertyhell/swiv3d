// Control bindings shared by the menus (Controller Config) and the game's input handling.
// Keyboard bindings are KeyboardEvent.code values; gamepad bindings are button indices of the
// standard gamepad mapping. Both are kept in the pilot settings (see frontend.js `store`).

// Key bits (must match crates/swiv-web/src/lib.rs `keys`).
export const K = { LEFT: 1, RIGHT: 2, FORWARD: 4, BACK: 8, SL: 16, SR: 32, SMOD: 64, FIRE: 128, SPECIAL: 256, NEXT: 512, PREV: 1024 };

/** Rebindable keyboard actions: `bit` ones are held controls, the others trigger once. */
export const KEY_ACTIONS = [
  { id: 'left', label: 'Turn ↶', bit: K.LEFT },
  { id: 'right', label: 'Turn ↷', bit: K.RIGHT },
  { id: 'forward', label: 'Move ↑', bit: K.FORWARD },
  { id: 'back', label: 'Move ↓', bit: K.BACK },
  { id: 'sl', label: 'Strafe ←', bit: K.SL },
  { id: 'sr', label: 'Strafe →', bit: K.SR },
  { id: 'smod', label: 'Strafe On', bit: K.SMOD },
  { id: 'fire', label: 'Fire Primary', bit: K.FIRE },
  { id: 'special', label: 'Fire Special', bit: K.SPECIAL },
  { id: 'next', label: 'Select Up', bit: K.NEXT },
  { id: 'prev', label: 'Select Down', bit: K.PREV },
  { id: 'map', label: 'Map' },
  { id: 'pause', label: 'Pause' },
  { id: 'music', label: 'Next Track' },
];

export const DEFAULT_KEYS = {
  left: ['ArrowLeft'], right: ['ArrowRight'], forward: ['ArrowUp', 'KeyW'], back: ['ArrowDown', 'KeyS'],
  sl: ['KeyA', 'KeyZ'], sr: ['KeyD', 'KeyX'], smod: ['ShiftLeft', 'ShiftRight', 'AltLeft'],
  fire: ['Space', 'ControlLeft', 'ControlRight'], special: ['Enter'], next: ['KeyE', 'Tab'], prev: ['KeyQ'],
  map: ['KeyM'], pause: ['KeyP'], music: ['KeyN'],
};

/** Rebindable gamepad buttons (the sticks are fixed; see `swapSticks`). */
export const PAD_ACTIONS = [
  { id: 'fire', label: 'Fire Primary', bit: K.FIRE },
  { id: 'special', label: 'Fire Special', bit: K.SPECIAL },
  { id: 'next', label: 'Select Up', bit: K.NEXT },
  { id: 'prev', label: 'Select Down', bit: K.PREV },
  { id: 'map', label: 'Map' },
  { id: 'pause', label: 'Pause' },
];

export const DEFAULT_PAD = { fire: [0, 7], special: [1], next: [5], prev: [4], map: [3], pause: [9] };

const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L-Stick', 'R-Stick', 'D-Pad ↑', 'D-Pad ↓', 'D-Pad ←', 'D-Pad →', 'Home'];
export const padName = (i) => PAD_NAMES[i] ?? `Button ${i}`;

const KEY_NAMES = {
  ArrowLeft: 'Cursor ←', ArrowRight: 'Cursor →', ArrowUp: 'Cursor ↑', ArrowDown: 'Cursor ↓',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl',
  AltLeft: 'L-Alt', AltRight: 'R-Alt', MetaLeft: 'L-Meta', MetaRight: 'R-Meta',
  NumpadEnter: 'Num Enter', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
};
export function keyName(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** Fill in missing bindings (new actions, or settings saved before rebinding existed). */
export function normaliseBindings(settings) {
  settings.keys = Object.assign(structuredClone(DEFAULT_KEYS), settings.keys);
  settings.pad = Object.assign(structuredClone(DEFAULT_PAD), settings.pad);
}

/** The action bound to a key code, or undefined. */
export function keyAction(settings, code) {
  return KEY_ACTIONS.find((a) => settings.keys[a.id]?.includes(code));
}

/** Bind `code` alone to `id`, taking it away from any other action. */
export function bindKey(settings, id, code) {
  for (const a of KEY_ACTIONS) settings.keys[a.id] = (settings.keys[a.id] ?? []).filter((c) => c !== code);
  settings.keys[id] = [code];
}

export function bindPad(settings, id, button) {
  for (const a of PAD_ACTIONS) settings.pad[a.id] = (settings.pad[a.id] ?? []).filter((b) => b !== button);
  settings.pad[id] = [button];
}
