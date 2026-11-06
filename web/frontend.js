// The front end, after the original's: every screen is a 3D-font heading (drawn by the renderer
// over a live flyover of a level) above a grey header box and a list of options.
//
//   SELECT PILOT  -> NEW PILOT (name) -> CONTROLLER TYPE -> CONTROLLER CONFIG -> MAIN MENU
//   MAIN MENU: Start Game / Setup / Replay Intro / Credits / New Player / Exit
//   SETUP: Controller Setup / Sound Volume / Music Volume / Music Preference / Detail Level
// Pilots (name, campaign progress) and settings are kept in localStorage.

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
 * The mission briefing: the level's colour map on a dark grid, with the start and each
 * objective marked, labelled and shown in a framed close-up, one after another; "North" and
 * "Objective Guide" point at the map globe; difficulty bottom right. Resolves on any key or
 * when it has run its course.
 */
export function runBriefing(mapCanvas, points, difficulty = 'Rookie') {
  return new Promise((resolve) => {
    const wrap = $('briefing');
    const c = $('briefing-map');
    wrap.hidden = false;
    // Group objective targets: centroid per objective group.
    const start = { x: points[0], z: points[1] };
    const groups = new Map();
    for (let i = 3; i < points.length; i += 3) {
      const g = points[i + 2];
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push([points[i], points[i + 1]]);
    }
    const order = [...groups.keys()].sort((a, b) => a - b);
    const marks = [{ x: start.x, z: start.z, label: 'Start', colour: '#8f8fff', frame: '#9a9aff' }];
    order.forEach((g, k) => {
      const pts = groups.get(g);
      // Wrap-aware centroid relative to the first point.
      const [x0, z0] = pts[0];
      const w = (d) => ((d + 768) % 512) - 256;
      const x = x0 + pts.reduce((s, [x]) => s + w(x - x0), 0) / pts.length;
      const z = z0 + pts.reduce((s, [, z]) => s + w(z - z0), 0) / pts.length;
      marks.push({ x: (x + 512) % 512, z: (z + 512) % 512, label: k === order.length - 1 ? 'Final Objective' : `Objective ${k + 1}`, colour: '#ff1c14', frame: '#e01a12' });
    });
    const STEP = 1.1;
    const total = 1.4 + marks.length * STEP + 3.2;
    const t0 = performance.now();
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      removeEventListener('keydown', key, true);
      wrap.removeEventListener('pointerdown', key);
      wrap.hidden = true;
      resolve();
    };
    const key = (e) => { e.preventDefault?.(); e.stopPropagation?.(); end(); };
    setTimeout(() => { addEventListener('keydown', key, true); wrap.addEventListener('pointerdown', key); }, 250);

    function draw(now) {
      if (done) return;
      const t = (now - t0) / 1000;
      if (t > total) { end(); return; }
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const g = c.getContext('2d');
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      // Work in a 640x400 frame, letterboxed, like the original screen.
      const s = Math.min(W / 640, H / 400);
      g.save();
      g.translate((W - 640 * s) / 2, (H - 400 * s) / 2);
      g.scale(s, s);
      g.strokeStyle = 'rgba(120, 160, 40, 0.35)';
      g.lineWidth = 1;
      for (let x = 10; x < 640; x += 40) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 400); g.stroke(); }
      for (let y = 10; y < 400; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(640, y); g.stroke(); }
      // The map swings in flat from a tilted diamond.
      const intro = Math.min(1, t / 1.3);
      const e = 1 - (1 - intro) ** 3;
      const M = 300; // map size on screen
      const cx = 320, cy = 200;
      g.save();
      g.translate(cx, cy);
      g.rotate((1 - e) * 0.785);
      g.scale(1, 1 - (1 - e) * 0.45);
      g.globalAlpha = 0.25 + 0.75 * e;
      g.imageSmoothingEnabled = true;
      g.drawImage(mapCanvas, -M / 2, -M / 2, M, M);
      // Dim the edges into the dark.
      const v = g.createRadialGradient(0, 0, M * 0.35, 0, 0, M * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.85)');
      g.fillStyle = v;
      g.fillRect(-M / 2, -M / 2, M, M);
      g.restore();
      g.globalAlpha = 1;
      const toScreen = (m) => [cx - M / 2 + m.x / 512 * M, cy - M / 2 + m.z / 512 * M];
      g.font = 'italic 900 15px "Arial Black", Arial, sans-serif';
      g.textBaseline = 'middle';
      const outlined = (text, x, y, align = 'left', colour = '#fff') => {
        g.textAlign = align;
        g.lineWidth = 3;
        g.strokeStyle = '#000';
        g.strokeText(text, x, y);
        g.fillStyle = colour;
        g.fillText(text, x, y);
      };
      marks.forEach((m, k) => {
        const a = t - 1.4 - k * STEP;
        if (a < 0) return;
        const [x, y] = toScreen(m);
        g.fillStyle = m.colour;
        g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill();
        // Close-up of the area in a frame, off to one side.
        const side = x < cx ? -1 : 1;
        const fw = 120, fh = 92;
        const fx = side < 0 ? Math.max(8, x - fw - 30) : Math.min(640 - fw - 8, x + 30);
        const fy = Math.max(12, Math.min(400 - fh - 40, y - fh - 10 + (k % 2) * (fh + 20)));
        const grow = Math.min(1, a / 0.35);
        g.save();
        g.globalAlpha = grow;
        const zoom = 40;
        g.imageSmoothingEnabled = false;
        const sx = ((m.x - zoom / 2) % 512 + 512) % 512, sz = ((m.z - zoom * 0.38) % 512 + 512) % 512;
        g.drawImage(mapCanvas, sx, sz, Math.min(zoom, 512 - sx), Math.min(zoom * 0.77, 512 - sz), fx, fy, fw, fh);
        g.strokeStyle = m.frame;
        g.lineWidth = 2;
        g.strokeRect(fx, fy, fw, fh);
        g.restore();
        outlined(m.label, side < 0 ? x - 12 : x + 12, y + 16, side < 0 ? 'right' : 'left');
      });
      const late = t - 1.4 - marks.length * STEP;
      if (late > -1) outlined('North', 30, 18);
      if (late > 0) outlined('Objective Guide', 30, 48);
      g.font = 'italic 900 13px "Arial Black", Arial, sans-serif';
      outlined(difficulty, 620, 382, 'right', '#c8c8c8');
      g.restore();
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  });
}
