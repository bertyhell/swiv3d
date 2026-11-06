// The front end, after the original's: every screen is a 3D-font heading (drawn by the renderer
// over a live flyover of a level) above a grey header box and a list of options.
//
//   SELECT PILOT  -> NEW PILOT (name) -> CONTROLLER TYPE -> CONTROLLER CONFIG -> MAIN MENU
//   MAIN MENU: Start Game / Setup / Replay Intro / Credits / New Player / Exit
//   SETUP: Controller Setup / Sound Volume / Music Volume / Music Preference / Detail Level
// Pilots (name, campaign progress) and settings are kept in localStorage.

import { createCockpit } from './briefing-cockpit.js';
import { paintGlobe } from './globe.js';

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
store.settings = Object.assign({ sfx: 8, music: 7, track: 0, detail: 6, controller: 'Keyboard' }, store.settings);

export function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(store));
  } catch { /* private mode: settings last for the session */ }
}

export const pilot = () => store.pilots[store.current] ?? null;

/**
 * `api` connects the front end to the game page:
 *   setTitle(text, rgb), levels (campaign order of available levels), musicTracks (labels),
 *   applySettings(), startGame(levelName), replayIntro(), click() (UI sound)
 */
export function createFrontEnd(api) {
  let screen = null;
  let sel = 0;
  let items = [];
  let typing = null; // name entry buffer

  const root = $('frontend');

  function render() {
    const s = screen;
    api.setTitle(s.title, COLOURS[s.colour]);
    $('menu-header').textContent = typeof s.header === 'function' ? s.header() : (s.header ?? '');
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
      b.tabIndex = -1;
      b.append(it.label);
      if (it.value !== undefined) {
        const v = document.createElement('span');
        v.className = 'value';
        v.textContent = ` ${it.value}`;
        b.append(v);
      }
      if (it.slider !== undefined) {
        const bar = document.createElement('span');
        bar.className = 'slider';
        const knob = document.createElement('i');
        knob.style.left = `${it.slider * 100}%`;
        bar.append(knob);
        b.append(document.createElement('br'), bar);
      }
      b.addEventListener('mouseenter', () => { if (sel !== i) { sel = i; render(); } });
      b.addEventListener('click', () => { sel = i; choose(); });
      li.append(b);
      return li;
    }));
  }

  const selectable = (it) => it && (it.action || it.adjust);

  function show(next, at = 0) {
    screen = next;
    sel = at;
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
    show(controllerType);
  }

  const controllerType = {
    title: 'CONTROLLER\nTYPE',
    colour: 'red',
    header: 'Please Select Main\nController Type',
    items: () => ['Keyboard', 'Gamepad'].map((c) => ({
      label: c,
      action: () => { store.settings.controller = c; save(); show(controllerConfig); },
    })),
    back: () => show(pilot() ? mainMenu : selectPilot),
  };

  const KEYS = {
    Keyboard: [
      ['Turn ↶', '[Cursor ←]'], ['Turn ↷', '[Cursor →]'], ['Move ↑', '[Cursor ↑]'], ['Move ↓', '[Cursor ↓]'],
      ['Strafe ←', '[A / Z]'], ['Strafe →', '[D / X]'], ['Strafe On', '[Shift]'],
      ['Fire Primary', '[Space]'], ['Fire Special', '[Enter]'], ['Select Up', '[E / Tab]'], ['Select Down', '[Q]'],
      ['Map', '[M]'], ['Pause', '[Esc]'],
    ],
    Gamepad: [
      ['Turn / Move', '[Left Stick]'], ['Strafe', '[Right Stick]'], ['Fire Primary', '[A / RT]'], ['Fire Special', '[B]'],
      ['Select Up', '[RB]'], ['Select Down', '[LB]'],
    ],
  };

  const controllerConfig = {
    title: 'CONTROLLER\nCONFIG',
    colour: 'green',
    header: () => `Main Controller Type\n[${store.settings.controller}]`,
    items: () => [
      ...KEYS[store.settings.controller].map(([a, b]) => ({ label: `${a} ${b}` })),
      { rule: true },
      { label: 'Continue', action: () => show(pilot() ? mainMenu : selectPilot) },
    ],
    back: () => show(pilot() ? mainMenu : selectPilot),
  };

  const mainMenu = {
    title: 'MAIN\nMENU',
    colour: 'red',
    header: () => `Main Menu For Player\n${pilot()?.name ?? ''}`,
    items: () => {
      const p = pilot();
      const unlocked = Math.min(p?.level ?? 0, api.levels.length - 1);
      p.pick = Math.min(p.pick ?? unlocked, unlocked);
      return [
        { label: 'Start Game', value: unlocked > 0 ? `‹ ${api.levels[p.pick]} ›` : undefined, action: () => api.startGame(api.levels[p.pick]),
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

  const bar = (v, max) => v / max;
  const setup = {
    title: 'SETUP',
    colour: 'grey',
    header: '',
    items: () => {
      const s = store.settings;
      const tracks = api.musicTracks();
      return [
        { label: 'Controller Setup', action: () => show(controllerType) },
        { label: 'Sound Volume', slider: bar(s.sfx, 10), adjust: (d) => { s.sfx = Math.max(0, Math.min(10, s.sfx + d)); } },
        { label: 'Music Volume', slider: bar(s.music, 10), adjust: (d) => { s.music = Math.max(0, Math.min(10, s.music + d)); } },
        { label: 'Music Preference', value: tracks.length ? `‹ ${s.track < 0 ? 'Off' : tracks[s.track] ?? 'Off'} ›` : 'No CD audio',
          adjust: (d) => { s.track = Math.max(-1, Math.min(tracks.length - 1, s.track + d)); } },
        { rule: true },
        { label: 'Detail Level', slider: bar(s.detail, 10), adjust: (d) => { s.detail = Math.max(0, Math.min(10, s.detail + d)); } },
        { rule: true },
        { label: 'Back', action: () => show(mainMenu, 1) },
      ];
    },
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

  // ------------------------------------------------------------ input

  function onKey(e) {
    if (root.hidden || !screen) return false;
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

  return {
    onKey,
    hide() { root.hidden = true; api.setTitle('', COLOURS.red); },
    open() { show(pilot() ? mainMenu : selectPilot); },
    openMain() { show(pilot() ? mainMenu : selectPilot); },
    get visible() { return !root.hidden; },
  };
}

// ------------------------------------------------------------ briefing

/**
 * The mission briefing, timed after the original BR_TER* videos: a push into the cockpit's map
 * monitor, the level's colour map spinning up onto a dark grid, the start and each objective
 * flashed, marked and shown in a framed close-up one after another, then the map globe with
 * "North" and "Objective Guide"; difficulty bottom right. Resolves on any key or when it has
 * run its course.
 */
export function runBriefing(mapCanvas, points, difficulty = 'Rookie') {
  return new Promise((resolve) => {
    const wrap = $('briefing');
    const c = $('briefing-map');
    wrap.hidden = false;
    // The opening push into the cockpit is 3D, on its own canvas under the 2D one.
    const view3d = document.createElement('canvas');
    view3d.className = 'briefing-cockpit';
    wrap.prepend(view3d);
    let cockpit = createCockpit(view3d);
    const dropCockpit = () => { cockpit?.dispose(); cockpit = null; view3d.remove(); };
    // Group objective targets: centroid per objective group.
    const start = { x: points[0], z: points[1] };
    const groups = new Map();
    for (let i = 3; i < points.length; i += 3) {
      const g = points[i + 2];
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push([points[i], points[i + 1]]);
    }
    const order = [...groups.keys()].sort((a, b) => a - b);
    const marks = [{ x: start.x, z: start.z, label: 'Start', colour: '#9a9aff', frame: '#a0a0ff' }];
    order.forEach((g, k) => {
      const pts = groups.get(g);
      // Wrap-aware centroid relative to the first point.
      const [x0, z0] = pts[0];
      const w = (d) => ((d + 768) % 512) - 256;
      const x = x0 + pts.reduce((s, [x]) => s + w(x - x0), 0) / pts.length;
      const z = z0 + pts.reduce((s, [, z]) => s + w(z - z0), 0) / pts.length;
      marks.push({ x: (x + 512) % 512, z: (z + 512) % 512, label: k === order.length - 1 ? 'Final Objective' : `Objective ${k + 1}`, colour: '#ff1c14', frame: '#e01a12' });
    });

    // Timeline after the original BR_TER*.SMK briefings (seconds):
    //   0.0-3.8  the camera dollies into the cockpit's map monitor until its black screen fills the view
    //   4.0-6.0  the map spins up out of the dark from a small tilted diamond; the grid fades in
    //   then per marker: a flash and the dot, ~1 s later its framed close-up wipes in, ~4 s apart
    //   the map globe top left flashes in, everything holds, then the close-ups wipe away in
    //   reverse, the grid fades and the view plunges into the map.
    const MAP_IN = 4.0, MAP_SET = 6.0, FIRST = 6.25, STEP = 3.6, INSET = 1.0;
    const globeAt = FIRST + marks.length * STEP - 1.2;
    const outAt = globeAt + 5.5;
    const plungeAt = outAt + 1.6;
    const total = plungeAt + 1.2;
    const t0 = performance.now();
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      dropCockpit();
      removeEventListener('keydown', key, true);
      wrap.removeEventListener('pointerdown', key);
      wrap.hidden = true;
      resolve();
    };
    const key = (e) => { e.preventDefault?.(); e.stopPropagation?.(); end(); };
    setTimeout(() => { addEventListener('keydown', key, true); wrap.addEventListener('pointerdown', key); }, 250);

    const span01 = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
    const easeInOut = (t) => t * t * (3 - 2 * t);
    const easeOut = (t) => 1 - (1 - t) ** 3;
    const M = 370; // map size on screen, in the 640x400 frame
    const cx = 320, cy = 205;
    const toScreen = (m) => [cx - M / 2 + m.x / 512 * M, cy - M / 2 + m.z / 512 * M];

    // Close-up frames sit beside their marker, kept clear of each other and the globe.
    const FW = 132, FH = 110;
    const placed = [{ x: 14, y: 8, w: 112, h: 112 }];
    const globe = document.createElement('canvas');
    const overlap = (a, b) => a.x < b.x + b.w + 6 && b.x < a.x + a.w + 6 && a.y < b.y + b.h + 6 && b.y < a.y + a.h + 6;
    marks.forEach((m) => {
      const [x, y] = toScreen(m);
      const cands = [];
      for (const side of [x < cx ? -1 : 1, x < cx ? 1 : -1]) {
        for (const dy of [-FH / 2, -FH - 4, 8, -FH * 0.2]) {
          const fx = side < 0 ? x - FW - 18 : x + 18;
          cands.push({ x: Math.max(6, Math.min(640 - FW - 6, fx)), y: Math.max(8, Math.min(392 - FH, y + dy)), w: FW, h: FH });
        }
      }
      m.box = cands.find((b) => !placed.some((p) => overlap(p, b))) ?? cands[0];
      placed.push(m.box);
    });

    function draw(now) {
      if (done) return;
      const t = (now - t0) / 1000;
      if (t > total) { end(); return; }
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const g = c.getContext('2d');
      if (t < MAP_IN && cockpit) {
        // The 3D cockpit shows through; darken its edges and fade it out as the glass fills the view.
        cockpit.render(t);
        g.clearRect(0, 0, W, H);
        const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.55);
        v.addColorStop(0, 'rgba(0,0,0,0)');
        v.addColorStop(1, 'rgba(0,0,0,0.7)');
        g.fillStyle = v;
        g.fillRect(0, 0, W, H);
        g.fillStyle = `rgba(0,0,0,${span01(t, 2.6, 3.8)})`;
        g.fillRect(0, 0, W, H);
        requestAnimationFrame(draw);
        return;
      }
      if (cockpit) dropCockpit();
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      // Work in a 640x400 frame, letterboxed, like the original screen.
      const s = Math.min(W / 640, H / 400);
      g.save();
      g.translate((W - 640 * s) / 2, (H - 400 * s) / 2);
      g.scale(s, s);
      g.beginPath(); g.rect(0, 0, 640, 400); g.clip();

      if (t < MAP_IN) {
        g.restore();
        requestAnimationFrame(draw);
        return;
      }

      // The plunge at the end: zoom into the map around the first objective.
      const pk = easeInOut(span01(t, plungeAt, total));
      const focus = toScreen(marks[1] ?? marks[0]);
      if (pk > 0) {
        const z = 1 + pk * 4;
        g.translate(focus[0], focus[1]);
        g.scale(z, z);
        g.translate(-focus[0], -focus[1]);
      }

      // Grid, fading in as the map settles and out before the plunge.
      const gridA = span01(t, MAP_IN + 0.9, MAP_SET) * (1 - span01(t, outAt + 0.8, plungeAt));
      if (gridA > 0) {
        g.strokeStyle = `rgba(110, 150, 30, ${0.45 * gridA})`;
        g.lineWidth = 1;
        for (let x = 0.5; x < 640; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 400); g.stroke(); }
        for (let y = 0.5; y < 400; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(640, y); g.stroke(); }
      }

      // The map spins up from a small tilted diamond.
      const e = easeOut(span01(t, MAP_IN, MAP_SET));
      g.save();
      g.translate(cx, cy);
      g.rotate((1 - e) * -0.9);
      g.scale(0.22 + 0.78 * e, (0.22 + 0.78 * e) * (1 - (1 - e) * 0.25));
      g.globalAlpha = Math.min(1, span01(t, MAP_IN, MAP_IN + 0.8));
      g.imageSmoothingEnabled = true;
      g.drawImage(mapCanvas, -M / 2, -M / 2, M, M);
      // Soft edges into the dark.
      const v = g.createRadialGradient(0, 0, M * 0.32, 0, 0, M * 0.72);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.95)');
      g.fillStyle = v;
      g.fillRect(-M / 2 - 1, -M / 2 - 1, M + 2, M + 2);
      g.restore();
      g.globalAlpha = 1;

      g.font = 'italic 900 15px "Arial Black", Arial, sans-serif';
      g.textBaseline = 'middle';
      const outlined = (text, x, y, align = 'left', colour = '#fff', alpha = 1) => {
        g.globalAlpha = alpha;
        g.textAlign = align;
        g.lineWidth = 3;
        g.strokeStyle = '#000';
        g.strokeText(text, x, y);
        g.fillStyle = colour;
        g.fillText(text, x, y);
        g.globalAlpha = 1;
      };
      const flash = (x, y, a, r) => {
        if (a <= 0 || a >= 1) return;
        const f = g.createRadialGradient(x, y, 0, x, y, r);
        const k = Math.sin(a * Math.PI);
        f.addColorStop(0, `rgba(255,255,230,${0.95 * k})`);
        f.addColorStop(0.4, `rgba(220,255,160,${0.5 * k})`);
        f.addColorStop(1, 'rgba(160,255,80,0)');
        g.fillStyle = f;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      };

      const n = marks.length;
      marks.forEach((m, k) => {
        const a = t - FIRST - k * STEP;
        if (a < 0) return;
        const [x, y] = toScreen(m);
        // Close-ups leave in reverse order, a few tenths apart; the dots stay.
        const gone = span01(t, outAt + (n - 1 - k) * 0.35, outAt + (n - 1 - k) * 0.35 + 0.4);
        const wipe = span01(a, INSET, INSET + 0.45) * (1 - gone);
        if (wipe > 0) {
          const b = m.box;
          g.save();
          g.beginPath(); g.rect(b.x - 2, b.y - 2, b.w + 4, (b.h + 4) * wipe); g.clip();
          // A tighter, sharper view of the ground around the marker.
          const zoom = 44;
          g.imageSmoothingEnabled = true;
          const sx = ((m.x - zoom / 2) % 512 + 512) % 512, sz = ((m.z - zoom * 0.42) % 512 + 512) % 512;
          g.drawImage(mapCanvas, sx, sz, Math.min(zoom, 512 - sx), Math.min(zoom * 0.83, 512 - sz), b.x, b.y, b.w, b.h);
          const sh = g.createLinearGradient(0, b.y, 0, b.y + b.h);
          sh.addColorStop(0, 'rgba(0,0,0,0.35)'); sh.addColorStop(0.35, 'rgba(0,0,0,0)');
          g.fillStyle = sh; g.fillRect(b.x, b.y, b.w, b.h);
          g.strokeStyle = m.frame;
          g.lineWidth = 2;
          g.strokeRect(b.x, b.y, b.w, b.h);
          g.restore();
          const lx = b.x + b.w / 2;
          const ly = b.y + b.h + 12 > 396 ? b.y - 10 : b.y + b.h + 12;
          outlined(m.label, lx, ly, 'center', '#fff', wipe);
        }
        flash(x, y, a / 0.6, 34);
        g.fillStyle = m.colour;
        g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
      });

      // The Objective Guide, top left: the same globe as the in-game HUD.
      const ga = t - globeAt;
      if (ga > 0) {
        const gx = 70, gy = 62, gr = 50;
        const gs = easeOut(span01(ga, 0, 0.4));
        // The game's HUD globe, north up, centred on the start, its white pointer on the first objective.
        const px = Math.max(1, Math.round(gr * 2 * s));
        if (globe.width !== px) { globe.width = globe.height = px; }
        const gg = globe.getContext('2d');
        gg.clearRect(0, 0, px, px);
        const goal = marks[1] ?? marks[0];
        paintGlobe(gg, px, mapCanvas, start.x, start.z, -Math.PI, goal.x, goal.z, 64);
        g.save();
        g.translate(gx, gy);
        g.scale(gs, gs);
        g.drawImage(globe, -gr, -gr, gr * 2, gr * 2);
        g.restore();
        flash(gx, gy, ga / 0.6, 70);
        flash(gx, gy, (ga - 3.5) / 0.6, 70);
        const la = span01(ga, 0.5, 0.9) * (1 - span01(t, outAt + 0.8, plungeAt));
        outlined('North', gx + gr + 8, gy - 22, 'left', '#fff', la);
        outlined('Objective Guide', gx + gr + 8, gy + 4, 'left', '#fff', span01(ga, 1.2, 1.6) * (1 - span01(t, outAt + 0.8, plungeAt)));
      }

      g.font = 'italic 900 13px "Arial Black", Arial, sans-serif';
      outlined(difficulty, 620, 384, 'right', '#c8c8c8', span01(t, MAP_SET, MAP_SET + 0.5) * (1 - pk));
      // Out to black on the plunge.
      g.restore();
      if (pk > 0.6) {
        g.fillStyle = `rgba(0,0,0,${(pk - 0.6) / 0.4})`;
        g.fillRect(0, 0, W, H);
      }
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  });
}
