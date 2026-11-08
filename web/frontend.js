// The front end, after the original's: every screen is a 3D-font heading (drawn by the renderer
// over a live flyover of a level) above a grey header box and a list of options.
//
//   SELECT PILOT  -> NEW PILOT (name) -> CONTROLLER TYPE -> CONTROLLER CONFIG -> MAIN MENU
//   MAIN MENU: Start Game / Setup / Replay Intro / Credits / New Player / Exit
//   SETUP: Controller Setup / Sound Volume / Music Volume / Music Preference / Fullscreen
//   PAUSE (in game): Resume / Restart Level / the audio settings / Controls / Quit
// Pilots (name, campaign progress) and settings are kept in localStorage.

import {
  KEY_ACTIONS, PAD_ACTIONS, DEFAULT_KEYS, DEFAULT_PAD, keyName, padName, normaliseBindings, bindKey, bindPad,
} from './controls.js';

const $ = (id) => document.getElementById(id);

// Heading colours of the original's screens.
const COLOURS = {
  chrome: [0.78, 0.8, 0.84],
  yellow: [0.72, 0.62, 0.08],
  red: [0.78, 0.05, 0.03],
  green: [0.08, 0.6, 0.12],
  grey: [0.62, 0.63, 0.66],
};

const STORE = 'swiv3d';
const MAX_PILOTS = 8;

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORE)) ?? {};
  } catch {
    return {};
  }
}

export const store = Object.assign({ pilots: [], current: -1, settings: {} }, load());
store.settings = Object.assign({ sfx: 8, music: 7, track: 0, controller: 'Keyboard', swapSticks: false, deadZone: 35 }, store.settings);
delete store.settings.detail; // the old Detail Level: the view distance is now always the furthest
normaliseBindings(store.settings);

export function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(store));
  } catch { /* private mode: settings last for the session */ }
}

export const pilot = () => store.pilots[store.current] ?? null;

/**
 * `api` connects the front end to the game page:
 *   setTitle(text, rgb), levels (campaign order of available levels), musicTracks (labels),
 *   applySettings(), startGame(levelName), replayIntro(), click() (UI sound),
 *   resume(), restart(), quit() (the in-game pause menu)
 */
export function createFrontEnd(api) {
  let screen = null;
  let sel = 0;
  let items = [];
  let typing = null; // name entry buffer
  let capture = null; // { kind: 'key' | 'pad', id, label } while waiting for a new binding

  const root = $('frontend');
  const HELP = '<kbd>&uarr;</kbd><kbd>&darr;</kbd> select &nbsp; <kbd>&larr;</kbd><kbd>&rarr;</kbd> adjust &nbsp; <kbd>Enter</kbd> choose &nbsp; <kbd>Esc</kbd> back';

  function render() {
    const s = screen;
    api.setTitle(s.title, COLOURS[s.colour]);
    root.classList.toggle('paused', !!s.pause);
    $('menu-box').classList.toggle('compact', !!s.compact);
    $('menu-header').textContent = capture
      ? `Press ${capture.kind === 'key' ? 'A Key' : 'A Button'} For\n${capture.label}`
      : typeof s.header === 'function' ? s.header() : (s.header ?? '');
    $('menu-help').innerHTML = capture ? 'Press the new control &nbsp; <kbd>Esc</kbd> cancel' : HELP;
    items = s.items();
    if (sel >= items.length || !selectable(items[sel])) sel = items.findIndex(selectable);
    const ul = $('menu-items');
    ul.replaceChildren(...items.map((it, i) => {
      const li = document.createElement('li');
      if (it.rule) { li.className = 'rule'; return li; }
      if (!it.action && !it.adjust) {
        li.className = it.empty ? 'text empty' : 'text';
        li.textContent = it.label;
        return li;
      }
      const b = document.createElement('button');
      b.className = i === sel ? 'sel' : '';
      if (capture && i === sel) b.classList.add('capture');
      b.tabIndex = -1;
      b.append(it.label);
      if (it.value !== undefined) {
        const v = document.createElement('span');
        v.className = 'value';
        if (it.adjust) {
          // Clickable arrows either side of the value (stopPropagation: no "choose" on the row).
          const arrow = (t, d) => {
            const a = document.createElement('span');
            a.className = 'arrow';
            a.textContent = t;
            a.addEventListener('click', (e) => { e.stopPropagation(); sel = i; adjust(d); });
            return a;
          };
          v.append(' ', arrow('‹', -1), ` ${it.value} `, arrow('›', 1));
        } else {
          v.textContent = ` ${it.value}`;
        }
        b.append(v);
      }
      if (it.slider !== undefined) b.append(document.createElement('br'), slider(it, i));
      // mousemove, not mouseenter: re-rendering under a still pointer must not steal the selection.
      b.addEventListener('mousemove', () => { if (sel !== i && !capture) { sel = i; render(); } });
      b.addEventListener('click', () => { if (!capture) { sel = i; choose(); } });
      li.append(b);
      return li;
    }));
    ul.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  // A slider bar: click or drag on it to set the value directly.
  function slider(it, i) {
    const bar = document.createElement('span');
    bar.className = 'slider';
    const knob = document.createElement('i');
    knob.style.left = `${it.slider * 100}%`;
    bar.append(knob);
    if (!it.set) return bar;
    let last = null;
    const update = (e) => {
      const r = bar.getBoundingClientRect();
      const f = it.set(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
      knob.style.left = `${f * 100}%`;
      if (f !== last) { last = f; save(); api.applySettings(); }
    };
    bar.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      sel = i;
      bar.setPointerCapture(e.pointerId);
      update(e);
      bar.addEventListener('pointermove', update);
      bar.addEventListener('pointerup', () => { bar.removeEventListener('pointermove', update); api.click(); render(); }, { once: true });
    });
    bar.addEventListener('click', (e) => e.stopPropagation());
    return bar;
  }

  const selectable = (it) => it && (it.action || it.adjust);

  function show(next, at = 0) {
    screen = next;
    sel = at;
    capture = null;
    typing = next.typing ? '' : null;
    root.hidden = false;
    render();
  }

  function move(d) {
    if (!items.length) return;
    let i = sel;
    for (let n = 0; n < items.length; n++) {
      i = (i + d + items.length) % items.length;
      if (selectable(items[i])) break;
    }
    if (i !== sel) { sel = i; api.click(); render(); }
  }

  function choose() {
    const it = items[sel];
    if (it?.action) { api.click(); it.action(); }
  }

  function adjust(d) {
    const it = items[sel];
    if (it?.adjust) { it.adjust(d); save(); api.applySettings(); api.click(); render(); }
  }

  // ------------------------------------------------------------ screens

  const selectPilot = {
    title: 'SELECT\nPILOT',
    colour: 'chrome',
    header: 'Select An Existing Pilot\nOr Create New Pilot',
    items: () => {
      const list = [{ label: 'New Pilot', action: () => (store.pilots.length < MAX_PILOTS ? show(newPilot) : null) }];
      if (store.pilots.length) list.push({ label: 'Delete Pilot', action: () => show(deletePilot, 1) });
      list.push({ rule: true });
      for (let k = 0; k < MAX_PILOTS; k++) {
        const p = store.pilots[k];
        list.push(p ? { label: p.name, action: () => { store.current = k; save(); show(mainMenu); } } : { label: '.....', empty: true });
      }
      return list;
    },
    back: null,
  };

  const deletePilot = {
    title: 'DELETE\nPILOT',
    colour: 'red',
    header: 'Select The Pilot\nTo Delete',
    items: () => [
      { label: 'Cancel', action: () => show(selectPilot) },
      { rule: true },
      ...store.pilots.map((p, k) => ({
        label: p.name,
        action: () => {
          store.pilots.splice(k, 1);
          if (store.current >= store.pilots.length) store.current = store.pilots.length - 1;
          save();
          show(selectPilot);
        },
      })),
    ],
    back: () => show(selectPilot),
  };

  const newPilot = {
    title: 'NEW\nPILOT',
    colour: 'yellow',
    header: 'Please Enter\nNew Pilot Name',
    typing: true,
    items: () => [{ label: `[${typing ?? ''}_]`, action: () => confirmName() }],
    back: () => show(selectPilot),
  };

  function confirmName() {
    const name = (typing ?? '').trim();
    if (!name) return;
    store.pilots.push({ name, level: 0 });
    store.current = store.pilots.length - 1;
    save();
    openControls(null);
  }

  // Where the controller screens return to: the pause menu in game, else the main menu.
  let controlsReturn = null;
  const leaveControls = () => (controlsReturn ? controlsReturn() : show(pilot() ? mainMenu : selectPilot));
  const openControls = (ret, at = 0) => { controlsReturn = ret; show(controllerType, at); };

  const controllerType = {
    title: 'CONTROLLER\nTYPE',
    colour: 'red',
    header: 'Please Select Main\nController Type',
    items: () => ['Keyboard', 'Gamepad'].map((c) => ({
      label: c,
      action: () => { store.settings.controller = c; save(); show(controllerConfig); },
    })),
    back: leaveControls,
  };

  const bindingRow = (kind, a) => {
    const s = store.settings;
    const bound = kind === 'key' ? (s.keys[a.id] ?? []).map(keyName) : (s.pad[a.id] ?? []).map(padName);
    return {
      label: a.label,
      value: `[${bound.join(' / ') || '-'}]`,
      action: () => { capture = { kind, id: a.id, label: a.label }; render(); },
    };
  };

  const range = (label, key, min, max, step = 1) => {
    const s = store.settings;
    const clamp = (v) => Math.max(min, Math.min(max, v));
    const frac = () => (s[key] - min) / (max - min);
    return {
      label,
      slider: frac(),
      adjust: (d) => { s[key] = clamp(s[key] + d * step); },
      set: (f) => { s[key] = clamp(min + Math.round((f * (max - min)) / step) * step); return frac(); },
    };
  };

  const toggle = (label, key) => {
    const s = store.settings;
    const flip = () => { s[key] = !s[key]; };
    return { label, value: s[key] ? 'On' : 'Off', action: () => { flip(); save(); api.applySettings(); render(); }, adjust: flip };
  };

  const controllerConfig = {
    title: 'CONTROLLER\nCONFIG',
    colour: 'green',
    compact: true,
    header: () => `Main Controller Type\n[${store.settings.controller}]\nChoose An Action To Change It`,
    items: () => {
      const s = store.settings;
      if (s.controller === 'Gamepad') {
        const [move, strafe] = s.swapSticks ? ['Right', 'Left'] : ['Left', 'Right'];
        return [
          { label: `Turn / Move [${move} Stick]` },
          { label: `Strafe [${strafe} Stick]` },
          ...PAD_ACTIONS.map((a) => bindingRow('pad', a)),
          { rule: true },
          toggle('Swap Sticks', 'swapSticks'),
          range('Stick Dead Zone', 'deadZone', 10, 60, 5),
          { rule: true },
          { label: 'Reset To Defaults', action: () => { s.pad = structuredClone(DEFAULT_PAD); s.swapSticks = false; s.deadZone = 35; save(); render(); } },
          { label: 'Continue', action: leaveControls },
        ];
      }
      return [
        ...KEY_ACTIONS.map((a) => bindingRow('key', a)),
        { rule: true },
        { label: 'Reset To Defaults', action: () => { s.keys = structuredClone(DEFAULT_KEYS); save(); render(); } },
        { label: 'Continue', action: leaveControls },
      ];
    },
    back: leaveControls,
  };

  /** A gamepad button was pressed while Controller Config waits for one. */
  function padPressed(button) {
    if (capture?.kind !== 'pad') return;
    bindPad(store.settings, capture.id, button);
    capture = null;
    save();
    api.click();
    render();
  }

  const mainMenu = {
    title: 'MAIN\nMENU',
    colour: 'red',
    header: () => `Main Menu For Player\n${pilot()?.name ?? ''}`,
    items: () => {
      const p = pilot();
      const unlocked = Math.min(p?.level ?? 0, api.levels.length - 1);
      p.pick = Math.min(p.pick ?? unlocked, unlocked);
      return [
        { label: 'Start Game', value: unlocked > 0 ? api.levels[p.pick] : undefined, action: () => api.startGame(api.levels[p.pick]),
          adjust: unlocked > 0 ? (d) => { p.pick = Math.max(0, Math.min(unlocked, p.pick + d)); } : undefined },
        { label: 'Setup', action: () => show(setup) },
        { label: 'Replay Intro', action: () => api.replayIntro() },
        { label: 'Credits', action: () => show(credits) },
        { label: 'New Player', action: () => show(selectPilot) },
        { rule: true },
        { label: 'Exit', action: () => { store.current = -1; save(); show(selectPilot); } },
      ];
    },
    back: () => show(selectPilot),
  };

  // Fullscreen needs a user gesture: keyboard and mouse count, gamepad buttons do not.
  const fullscreen = () => {
    const flip = () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      else document.documentElement.requestFullscreen?.().catch(() => {});
    };
    return { label: 'Fullscreen', value: document.fullscreenElement ? 'On' : 'Off', action: flip, adjust: flip };
  };
  document.addEventListener('fullscreenchange', () => { if (!root.hidden && screen) render(); });

  const audioItems = () => {
    const s = store.settings;
    const tracks = api.musicTracks();
    return [
      range('Sound Volume', 'sfx', 0, 10),
      range('Music Volume', 'music', 0, 10),
      tracks.length
        ? { label: 'Music Preference', value: s.track < 0 ? 'Off' : tracks[s.track] ?? 'Off',
          adjust: (d) => { s.track = Math.max(-1, Math.min(tracks.length - 1, s.track + d)); } }
        : { label: 'Music Preference: No CD audio' },
    ];
  };

  const setup = {
    title: 'SETUP',
    colour: 'grey',
    header: '',
    items: () => [
      { label: 'Controller Setup', action: () => openControls(() => show(setup, 0)) },
      ...audioItems(),
      { rule: true },
      fullscreen(),
      { rule: true },
      { label: 'Back', action: () => show(mainMenu, 1) },
    ],
    back: () => show(mainMenu, 1),
  };

  const credits = {
    title: 'CREDITS',
    colour: 'chrome',
    header: 'SWIV 3D',
    items: () => [
      { label: 'Original game' },
      { label: 'SCi, 1996' },
      { rule: true },
      { label: 'Browser rebuild' },
      { label: 'Rust · WebAssembly · WebGL 2' },
      { label: 'Intro recreated in real time' },
      { label: 'with three.js' },
      { rule: true },
      { label: 'Back', action: () => show(mainMenu, 3) },
    ],
    back: () => show(mainMenu, 3),
  };

  // In game: no 3D heading (the simulation, and with it the heading's animation, is stopped).
  const pause = {
    title: '',
    colour: 'grey',
    pause: true,
    header: 'Game Paused',
    items: () => [
      { label: 'Resume', action: () => api.resume() },
      { label: 'Restart Level', action: () => api.restart() },
      { rule: true },
      ...audioItems(),
      fullscreen(),
      { label: 'Controls', action: () => openControls(() => show(pause, 7)) },
      { rule: true },
      { label: 'Quit To Main Menu', action: () => api.quit() },
    ],
    back: () => api.resume(),
  };

  // ------------------------------------------------------------ input

  function onKey(e) {
    if (root.hidden || !screen) return false;
    if (capture) {
      if (e.code === 'Escape') capture = null;
      else if (capture.kind === 'key') { bindKey(store.settings, capture.id, e.code); capture = null; save(); api.click(); }
      render();
      return true;
    }
    if (typing !== null) {
      if (e.key === 'Enter') { confirmName(); return true; }
      if (e.key === 'Escape') { screen.back?.(); return true; }
      if (e.key === 'Backspace') { typing = typing.slice(0, -1); render(); return true; }
      if (e.key.length === 1 && /[\w .'-]/.test(e.key) && typing.length < 12) { typing += e.key; render(); return true; }
      return true;
    }
    switch (e.code) {
      case 'ArrowUp': move(-1); return true;
      case 'ArrowDown': move(1); return true;
      case 'ArrowLeft': adjust(-1); return true;
      case 'ArrowRight': adjust(1); return true;
      case 'Enter': case 'Space': case 'NumpadEnter': choose(); return true;
      case 'Escape': case 'Backspace': screen.back?.(); return true;
      default: return false;
    }
  }

  /** Menu navigation from a gamepad: 'up' | 'down' | 'left' | 'right' | 'ok' | 'back'. */
  function onPad(cmd) {
    if (root.hidden || !screen || capture) return;
    if (cmd === 'up') move(-1);
    else if (cmd === 'down') move(1);
    else if (cmd === 'left') adjust(-1);
    else if (cmd === 'right') adjust(1);
    else if (cmd === 'ok') { if (typing !== null) confirmName(); else choose(); }
    else if (cmd === 'back') screen.back?.();
  }

  return {
    onKey,
    onPad,
    padPressed,
    hide() { root.hidden = true; root.classList.remove('paused'); capture = null; api.setTitle('', COLOURS.red); },
    open() { show(pilot() ? mainMenu : selectPilot); },
    openMain() { show(pilot() ? mainMenu : selectPilot); },
    openPause() { show(pause); },
    get visible() { return !root.hidden; },
    get capturing() { return capture?.kind ?? null; },
  };
}

// The mission briefing lives in briefing.js.
export { runBriefing } from './briefing.js';
