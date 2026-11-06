// SWIV 3D web front-end: file loading, menus, input, HUD and audio.
// The simulation and WebGL rendering live in Rust (crates/swiv-web).
import init, { Game, global_strings, sound_offsets } from './pkg/swiv_web.js';
import { playIntro } from './intro.js';
import { createFrontEnd, runBriefing, store, save, pilot } from './frontend.js';

const LEVEL_ORDER = [
  'TERRAN00', 'TERRAN01', 'TERRAN02', 'TERRAN03', 'TERRAN04', 'TERRAN05', 'TERRAN06', 'TERRANBS',
  'ARCTIC01', 'ARCTIC02', 'ARCTIC03',
  'MARS01', 'MARS02', 'MARS03', 'MARS04', 'MARS05',
  'LUNAR01',
];
// Special weapon glyphs for the HUD icon (inner box spans 10..38), by GLOBAL.BD pickup index.
const GLYPHS = {
  missile: 'M24 11 L27.5 16 V29 L32 35 H16 L20.5 29 V16 Z M20.5 29 H27.5',
  bomb: 'M24 19 a8 8 0 1 0 0.01 0 M27 18 L31 13',
  burst: 'M24 13 V35 M13 24 H35 M16 16 L32 32 M32 16 L16 32',
  boost: 'M15 31 L24 22 L33 31 M15 23 L24 14 L33 23',
};
const SPECIAL_GLYPH = (k) => ([7, 8, 17, 18].includes(k) ? 'bomb' : [2, 5, 12, 15].includes(k) ? 'burst'
  : [9, 19].includes(k) ? 'boost' : 'missile');
const PICKUP_FALLBACK = { 0: 'Missiles', 100: '10% Health', 101: '25% Health', 110: 'Power Up' };
const OBJECTIVE_NAMES = ['PRIMARY TARGETS', 'SECONDARY TARGETS', 'COMMAND CENTRE', 'DEFENCE GRID', 'SUPPLY DEPOTS',
  'OUTPOSTS', 'COMMS', 'FUEL DUMPS', 'BASE', 'FINAL TARGET'];

// Key bits (must match crates/swiv-web/src/lib.rs `keys`).
const K = { LEFT: 1, RIGHT: 2, FORWARD: 4, BACK: 8, SL: 16, SR: 32, SMOD: 64, FIRE: 128, SPECIAL: 256, NEXT: 512, PREV: 1024 };
const KEYMAP = {
  ArrowLeft: K.LEFT, ArrowRight: K.RIGHT, ArrowUp: K.FORWARD, ArrowDown: K.BACK,
  KeyW: K.FORWARD, KeyS: K.BACK, KeyA: K.SL, KeyD: K.SR, KeyZ: K.SL, KeyX: K.SR,
  ShiftLeft: K.SMOD, ShiftRight: K.SMOD, AltLeft: K.SMOD,
  Space: K.FIRE, ControlLeft: K.FIRE, ControlRight: K.FIRE,
  Enter: K.SPECIAL, KeyE: K.NEXT, Tab: K.NEXT, KeyQ: K.PREV,
};

// Sound effect ids (SOUNDS.BD directory id / 100) per sim event code.
// 11 = tractor beam grabs a pickup: its winch sound runs exactly as long as the lift.
// The primary gun (1) is not a sound per shot: recorded from the original in DOSBox, holding
// fire gives a steady rattle, one sharp click every ~140 ms for as long as the trigger is
// held (see `gunRattle`). The single falling zap (2000) is kept for the special weapons.
const EVENT_SOUNDS = { 2: 2004, 3: 1000, 4: 1001, 7: 4001, 8: 1003, 11: 4000 };
const GUN_CLICK = 2005;          // the rattle's click: its first 0.12 s
const GUN_CLICK_MS = 140;
// Level used as the menus' backdrop (the original flies over a level behind its menus).
const MENU_LEVELS = ['TERRAN01', 'TERRAN00', 'TERRAN02'];

const $ = (id) => document.getElementById(id);
const state = {
  files: new Map(),      // lower-case basename -> File | Blob
  game: null,
  running: false,
  paused: false,
  keys: 0,
  levelIndex: 0,
  audio: null,
  sounds: new Map(),
  engine: null,
  music: { el: new Audio(), tracks: [], index: 0 },
  lastHud: 0,
  banner: null,
  carry: null,
  showMap: false,
  pickupNames: new Map(), // GLOBAL.BD strings group 100 (English): pickup index -> name
  assets: null,          // manifest of the swiv-pack layout in assets/, when it is there
  mapCanvas: null,
  mode: 'loader',        // loader | splash | intro | menu | briefing | game
  levels: [],            // campaign order of the available levels
  frontEnd: null,
  nextGun: 0,
};

// ---------------------------------------------------------------- files

function addFile(path, file) {
  const name = path.split('/').pop().toLowerCase();
  state.files.set(name, file);
  const m = path.toLowerCase().match(/music\/track(\d+)\.(ogg|mp3|wav)$/);
  if (m) state.files.set(`music:${m[1]}`, file);
}

async function readEntries(entry, path = '') {
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    addFile(path + entry.name, file);
  } else if (entry.isDirectory) {
    const reader = entry.createReader();
    let batch;
    do {
      batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const e of batch) await readEntries(e, `${path}${entry.name}/`);
    } while (batch.length);
  }
}

async function fetchDataDir(base) {
  // Dev mode: ?data=<url> pointing at a served GameData directory (plus optional music/).
  const names = ['GLOBAL.BD', 'SOUNDS.BD', ...LEVEL_ORDER.map((l) => `${l}.SLV`), 'DEMO.SLV'];
  await Promise.all(names.map(async (n) => {
    const r = await fetch(`${base}/${n}`);
    if (r.ok) addFile(n, await r.blob());
  }));
  await Promise.all([2, 3, 4, 5, 6, 7, 8, 9, 10].map(async (t) => {
    const n = `music/track${String(t).padStart(2, '0')}.ogg`;
    const r = await fetch(`${base}/${n}`, { method: 'HEAD' });
    if (r.ok) state.files.set(`music:${String(t).padStart(2, '0')}`, `${base}/${n}`);
  }));
}

function setStatus(msg, error = false) {
  const s = $('load-status');
  s.textContent = msg;
  s.classList.toggle('error', error);
}

// The game data converted by swiv-pack (tools/swiv-extract) into assets/: maps and textures
// as PNGs, slim level bundles, sound effects as WAV and the soundtrack as MP3. When it is
// there the page starts straight into the menu, without asking for the CD.
async function loadPackedAssets() {
  const r = await fetch('assets/manifest.json').catch(() => null);
  if (!r?.ok) return false;
  state.assets = await r.json();
  const g = await fetch('assets/global.bd');
  if (!g.ok) return false;
  addFile('global.bd', await g.blob());
  for (const name of state.assets.music) {
    const m = name.match(/track(\d+)\./);
    if (m) state.files.set(`music:${m[1]}`, `assets/music/${name}`);
  }
  return true;
}

const bytesOf = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};

async function afterFilesLoaded() {
  if (!state.files.has('global.bd') || (!state.assets && !state.files.has('sounds.bd'))) {
    setStatus('GLOBAL.BD / SOUNDS.BD not found in that folder. Pick the GameData folder of the CD.', true);
    return;
  }
  const levels = state.assets
    ? LEVEL_ORDER.filter((l) => l in state.assets.levels)
    : LEVEL_ORDER.filter((l) => state.files.has(`${l.toLowerCase()}.slv`));
  if (!levels.length) {
    setStatus('No level files (*.SLV) found.', true);
    return;
  }
  setStatus('Loading sounds…');
  try {
    const global = new Uint8Array(await state.files.get('global.bd').arrayBuffer());
    state.game.load_font(global);
    const text = global_strings(global);
    for (const line of text.split('\n')) {
      const [lang, group, index, ...rest] = line.split('|');
      if (lang === '0' && group === '100') state.pickupNames.set(+index, rest.join(' '));
    }
  } catch (e) {
    console.warn('strings', e);
  }
  await setupMusic();
  state.levels = levels;
  $('loader').hidden = true;
  showSplash();
}

// ---------------------------------------------------------------- front end

// The browser needs a key press or click before it plays sound: the original's intro starts
// from a black "press any key" screen here.
function showSplash() {
  state.mode = 'splash';
  const splash = $('splash');
  splash.hidden = false;
  const go = async (e) => {
    e?.preventDefault?.();
    removeEventListener('keydown', go, true);
    splash.removeEventListener('pointerdown', go);
    splash.hidden = true;
    await setupAudio();
    await state.audio.resume();
    applySettings();
    if (new URLSearchParams(location.search).get('intro') !== '0') await runIntro();
    await enterFrontEnd();
  };
  addEventListener('keydown', go, true);
  splash.addEventListener('pointerdown', go);
}

async function runIntro() {
  state.mode = 'intro';
  playMusic(-1);
  $('frontend').hidden = true;
  await playIntro({ ctx: state.audio, sounds: state.sounds, master: state.sfxBus });
}

async function enterFrontEnd() {
  state.running = false;
  stopEngine();
  $('hud').hidden = true;
  $('pause').hidden = true;
  const backdrop = MENU_LEVELS.find((l) => state.levels.includes(l)) ?? state.levels[0];
  await loadLevel(backdrop);
  state.game.set_attract(true);
  state.game.set_view_distance(viewCells());
  state.mode = 'menu';
  state.running = true;
  state.paused = false;
  playMusic(state.music.tracks.length ? store.settings.track : -1);
  state.frontEnd.open();
}

function viewCells() {
  return 34 + store.settings.detail * 3.6; // 34..70 cells; the default (6) is the old 56
}

function applySettings() {
  const s = store.settings;
  if (state.sfxBus) state.sfxBus.gain.value = s.sfx / 10;
  state.music.el.volume = Math.min(1, s.music / 10);
  if (state.game) state.game.set_view_distance(viewCells());
  if (state.mode === 'menu') {
    const want = state.music.tracks.length ? s.track : -1;
    if (want !== state.music.index || (want >= 0 && state.music.el.paused)) playMusic(want);
  }
}

function uiClick() {
  play(6002, { volume: 0.25, rate: 1.6 });
}

async function startGame(name) {
  state.frontEnd.hide();
  state.mode = 'briefing';
  playMusic(-1);
  state.running = false;
  state.carry = null;
  await loadLevel(name);
  state.game.set_attract(false);
  state.game.set_view_distance(viewCells());
  drawMinimapBase();
  await runBriefing(state.mapCanvas, state.game.briefing(), 'Rookie');
  beginPlay(name);
}

// ---------------------------------------------------------------- audio

async function setupAudio() {
  if (state.audio) return;
  const ctx = new AudioContext();
  state.audio = ctx;
  const master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);
  state.master = master;
  // Effects go through their own bus so Setup's Sound Volume can scale them.
  const sfx = ctx.createGain();
  sfx.connect(master);
  state.sfxBus = sfx;
  if (state.assets) {
    await Promise.all(state.assets.sounds.map(async (id) => {
      try {
        state.sounds.set(id, await ctx.decodeAudioData((await bytesOf(`assets/sounds/${id}.wav`)).buffer));
      } catch (e) {
        console.warn('sound', id, e);
      }
    }));
    return;
  }
  const data = new Uint8Array(await state.files.get('sounds.bd').arrayBuffer());
  const table = sound_offsets(data);
  for (let i = 0; i < table.length; i += 3) {
    const [id, off, len] = [table[i], table[i + 1], table[i + 2]];
    try {
      const buf = await ctx.decodeAudioData(data.slice(off, off + len).buffer);
      state.sounds.set(id, buf);
    } catch (e) {
      console.warn('sound', id, e);
    }
  }
}

function play(id, { volume = 1, rate = 1, duration } = {}) {
  const buf = state.sounds.get(id);
  if (!buf || !state.audio) return;
  const src = state.audio.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const g = state.audio.createGain();
  g.gain.value = volume;
  src.connect(g).connect(state.sfxBus);
  if (duration) {
    const end = state.audio.currentTime + duration;
    g.gain.setValueAtTime(volume, end - 0.015);
    g.gain.linearRampToValueAtTime(0, end);
    src.start(0, 0, duration);
  } else {
    src.start();
  }
}

// The primary gun's sound while the trigger is held: one click every GUN_CLICK_MS.
function gunRattle(now, firing) {
  if (!firing) {
    state.nextGun = 0;
    return;
  }
  if (now >= state.nextGun) {
    play(GUN_CLICK, { volume: 0.55, duration: 0.12 });
    state.nextGun = Math.max(now, state.nextGun) + GUN_CLICK_MS;
    if (state.nextGun < now) state.nextGun = now + GUN_CLICK_MS;
  }
}

function startEngine() {
  stopEngine();
  const buf = state.sounds.get(5000);
  if (!buf) return;
  const src = state.audio.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const g = state.audio.createGain();
  g.gain.value = 0.35;
  src.connect(g).connect(state.sfxBus);
  src.start();
  state.engine = { src, g };
}

function stopEngine() {
  if (state.engine) {
    state.engine.src.stop();
    state.engine = null;
  }
}

// CD audio: either extracted OGGs or straight out of the BIN via the CUE sheet.
async function setupMusic() {
  const tracks = [];
  for (let t = 2; t <= 10; t++) {
    const f = state.files.get(`music:${String(t).padStart(2, '0')}`);
    if (f) tracks.push({ n: t, url: typeof f === 'string' ? f : URL.createObjectURL(f) });
  }
  const cue = [...state.files.entries()].find(([k]) => k.endsWith('.cue'));
  if (!tracks.length && cue) {
    const text = await cue[1].text();
    const binName = (text.match(/FILE\s+"([^"]+)"/i) || [])[1]?.toLowerCase();
    const bin = binName && state.files.get(binName);
    if (bin) {
      const starts = [];
      let cur = 0;
      for (const line of text.split(/\r?\n/)) {
        const t = line.match(/TRACK\s+(\d+)/i);
        if (t) cur = +t[1];
        const i = line.match(/INDEX\s+01\s+(\d+):(\d+):(\d+)/i);
        if (i) starts.push([cur, (+i[1] * 60 + +i[2]) * 75 + +i[3]]);
      }
      const total = bin.size / 2352;
      starts.forEach(([n, s], k) => {
        if (n === 1) return;
        const end = k + 1 < starts.length ? starts[k + 1][1] : total;
        const pcm = bin.slice(s * 2352, end * 2352);
        tracks.push({ n, url: URL.createObjectURL(new Blob([wavHeader(pcm.size), pcm], { type: 'audio/wav' })) });
      });
    }
  }
  state.music.tracks = tracks;
  if (store.settings.track >= tracks.length) store.settings.track = tracks.length ? 0 : -1;
  state.music.el.loop = true;
  state.music.el.volume = Math.min(1, store.settings.music / 10);
}

function wavHeader(bytes) {
  const b = new DataView(new ArrayBuffer(44));
  const s = (o, t) => [...t].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  s(0, 'RIFF'); b.setUint32(4, 36 + bytes, true); s(8, 'WAVEfmt ');
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 2, true);
  b.setUint32(24, 44100, true); b.setUint32(28, 176400, true); b.setUint16(32, 4, true); b.setUint16(34, 16, true);
  s(36, 'data'); b.setUint32(40, bytes, true);
  return b.buffer;
}

function playMusic(index) {
  const el = state.music.el;
  // The intro and the briefings run silent of CD music, like the original.
  if (state.mode === 'intro' || state.mode === 'briefing') index = -1;
  const t = state.music.tracks[index];
  state.music.index = index;
  if (!t || store.settings.music === 0) {
    el.pause();
    return;
  }
  if (el.src !== t.url) el.src = t.url;
  el.play().catch(() => {});
}

// ---------------------------------------------------------------- game flow

async function loadLevel(name) {
  if (state.assets) {
    const dir = `assets/levels/${name}`;
    const ids = state.assets.levels[name].textures;
    const [bd, height, type, colour, ...textures] = await Promise.all([
      bytesOf(`${dir}/level.bd`), bytesOf(`${dir}/height.png`), bytesOf(`${dir}/type.png`), bytesOf(`${dir}/colour.png`),
      ...ids.map((id) => bytesOf(`${dir}/tex/${id}.png`)),
    ]);
    state.game.load_level_parts(bd, height, type, colour, new Uint32Array(ids), textures);
  } else {
    const bytes = new Uint8Array(await state.files.get(`${name.toLowerCase()}.slv`).arrayBuffer());
    state.game.load_level(bytes);
  }
  state.levelIndex = LEVEL_ORDER.indexOf(name);
}

function beginPlay(name) {
  if (state.carry) state.game.carry_over(...state.carry);
  state.mode = 'game';
  state.running = true;
  state.paused = false;
  state.banner = null;
  state.keys = 0;
  drawMinimapBase();
  $('hud').hidden = false;
  showBanner('Rookie', 2500);
  startEngine();
  playMusic(state.music.tracks.length ? store.settings.track : -1);
}

// Next mission after one is complete: through its briefing, keeping score and weapons.
async function nextMission(name) {
  state.mode = 'briefing';
  playMusic(-1);
  state.running = false;
  stopEngine();
  $('hud').hidden = true;
  await loadLevel(name);
  state.game.set_attract(false);
  state.game.set_view_distance(viewCells());
  drawMinimapBase();
  await runBriefing(state.mapCanvas, state.game.briefing(), 'Rookie');
  beginPlay(name);
}

function showBanner(text, ms) {
  const b = $('banner');
  b.textContent = text;
  b.hidden = false;
  clearTimeout(state.bannerTimer);
  if (ms) state.bannerTimer = setTimeout(() => { b.hidden = true; }, ms);
}

function toMenu() {
  state.carry = null;
  $('banner').hidden = true;
  enterFrontEnd();
}

function setPaused(p) {
  state.paused = p;
  state.keys = 0;
  $('pause').hidden = !p;
  if (p) $('resume').focus();
  if (state.engine) state.engine.g.gain.value = p ? 0 : 0.35;
}

function handleEvents(events) {
  for (const e of events) {
    if (EVENT_SOUNDS[e]) play(EVENT_SOUNDS[e], { volume: e === 2 ? 0.35 : 0.8 });
    if (e === 1 && state.keys & K.SPECIAL) play(2000, { volume: 0.5 });
    if (e >= 1000) {
      state.game.fly_text(pickupName(e - 1000).trim());
    }
    if (e >= 100 && e < 110) showBanner(`${OBJECTIVE_NAMES[e - 100] ?? 'OBJECTIVE'} DESTROYED`, 2500);
    if (e === 9) {
      showBanner('MISSION COMPLETE', 0);
      const h = state.game.hud();
      state.carry = [h[0], h[1], h[5], state.game.ammo(), h[3]];
      const next = state.levels.find((l) => LEVEL_ORDER.indexOf(l) > state.levelIndex);
      const p = pilot();
      if (p) {
        p.level = Math.max(p.level ?? 0, next ? state.levels.indexOf(next) : state.levels.length - 1);
        p.pick = p.level;
        save();
      }
      setTimeout(() => {
        if (next) nextMission(next);
        else { showBanner('ALL MISSIONS COMPLETE', 0); setTimeout(toMenu, 5000); }
      }, 4000);
    }
    if (e === 10) {
      showBanner('GAME OVER', 0);
      setTimeout(toMenu, 4000);
    }
  }
}

function pickupName(index) {
  return state.pickupNames.get(index) ?? PICKUP_FALLBACK[index] ?? 'Bonus';
}

function updateHud(h) {
  const [score, lives, health, special, ammo, , obj, left, total, phase, speed] = h;
  $('score').textContent = String(Math.max(0, score)).padStart(7, '0');
  if ($('lives').childElementCount !== lives) {
    $('lives').replaceChildren(...Array.from({ length: Math.max(0, lives) }, () => document.createElement('span')));
  }
  // Energy fills the trapezoid window (y 13..88 in the capsule's viewBox) from the bottom.
  const fill = 75 * Math.max(0, Math.min(100, health)) / 100;
  $('energy-level').setAttribute('y', 88 - fill);
  $('energy-level').setAttribute('height', fill);
  $('energy').classList.toggle('low', health < 30);
  const empty = special < 0 || ammo <= 0;
  $('special').classList.toggle('empty', empty);
  if (!empty && $('special').dataset.kind !== `${special}`) {
    $('special').dataset.kind = `${special}`;
    $('special-name').textContent = pickupName(special);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', GLYPHS[SPECIAL_GLYPH(special)]);
    $('special-glyph').replaceChildren(path);
  }
  $('special-count').textContent = `x ${String(ammo).padStart(2, '0')}`;
  $('objective').textContent = obj >= 0 ? `${OBJECTIVE_NAMES[obj] ?? 'TARGETS'}  ${total - left}/${total}` : 'ALL CLEAR';
  if (state.engine) {
    state.engine.src.playbackRate.value = 0.9 + Math.min(speed, 5000) / 5000 * 0.35;
  }
  if (phase === 1 && $('banner').hidden) showBanner('DESTROYED', 2000);
}

// ---------------------------------------------------------------- radar & map

// The map globe: a machined metal disk holding a glass window onto the colour map. Disk and
// window turn with the craft so its heading points up. Behind the disk, two pointers poke
// out past the rim: black for north, white towards the nearest target of the objective.
const GLOBE_CELLS = 36; // map cells from the centre of the window to its edge

function drawGlobe() {
  const c = $('globe');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const size = Math.round(c.clientWidth * dpr);
  if (!size) return;
  if (c.width !== size || c.height !== size) { c.width = size; c.height = size; }
  const g = c.getContext('2d');
  const R = size / 2;
  const D = R * 0.84; // disk radius; pointers reach out to R
  const [x, z, heading, gx, gz] = state.game.player_map();
  const turn = Math.PI + heading; // rotates the craft's heading to screen-up
  const rot = (dx, dy) => [dx * Math.cos(turn) - dy * Math.sin(turn), dx * Math.sin(turn) + dy * Math.cos(turn)];
  g.clearRect(0, 0, size, size);
  g.save();
  g.translate(R, R);

  // Pointers, behind the disk: wide wedges whose tips show past the rim.
  const pointer = (dx, dy, fill, stroke) => {
    const [mx, my] = rot(dx, dy);
    g.save();
    g.rotate(Math.atan2(my, mx));
    g.beginPath();
    g.moveTo(R * 1.0, 0);
    g.lineTo(D * 0.6, -R * 0.26);
    g.lineTo(D * 0.6, R * 0.26);
    g.closePath();
    g.fillStyle = fill;
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = R * 0.04;
    g.shadowOffsetY = R * 0.02;
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = Math.max(1, R * 0.025);
    g.strokeStyle = stroke;
    g.stroke();
    g.restore();
  };
  pointer(0, -1, '#0c0c0e', '#55595f'); // north
  if (gx >= 0) {
    const wrapd = (d) => ((d + 768) % 512) - 256;
    const dx = wrapd(gx - x);
    const dz = wrapd(gz - z);
    if (dx || dz) pointer(dx, dz, '#f4f6f8', '#1a1c1f');
  }

  g.save();
  g.rotate(turn);
  // The disk outline: a circle with four notches cut into its rim on the quadrants.
  const notch = D * 0.15;
  const diskPath = () => {
    g.beginPath();
    for (let q = 0; q < 4; q++) {
      const a0 = q * Math.PI / 2 + Math.PI / 4;
      const half = Math.asin(notch / D);
      g.arc(0, 0, D, a0 - Math.PI / 2 + half, a0 - half);
      const nx = Math.cos(a0) * D, ny = Math.sin(a0) * D;
      // Inner half of a small circle centred on the rim: a cut into the disk.
      g.arc(nx, ny, notch, a0 - Math.PI / 2 - half / 2, a0 + Math.PI / 2 + half / 2, true);
    }
    g.closePath();
  };
  // Drop shadow and the disk's thickness (its edge shows below-right).
  g.save();
  g.rotate(-turn);
  g.translate(R * 0.04, R * 0.06);
  g.rotate(turn);
  diskPath();
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.filter = `blur(${Math.max(1, R * 0.03)}px)`;
  g.fill();
  g.filter = 'none';
  g.restore();
  g.save();
  g.rotate(-turn);
  g.translate(R * 0.015, R * 0.035);
  g.rotate(turn);
  diskPath();
  g.fillStyle = '#2c2f33';
  g.fill();
  g.restore();
  // Face: brushed metal lit from the top left (light stays fixed while the disk turns).
  diskPath();
  g.save();
  g.clip();
  g.rotate(-turn);
  const face = g.createLinearGradient(-D, -D, D, D);
  face.addColorStop(0, '#f2f4f7');
  face.addColorStop(0.35, '#b8bdc4');
  face.addColorStop(0.7, '#767b82');
  face.addColorStop(1, '#3e4247');
  g.fillStyle = face;
  g.fillRect(-R, -R, size, size);
  g.lineWidth = Math.max(0.5, R * 0.008);
  for (let k = 0; k < 18; k++) {
    g.strokeStyle = k % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
    g.beginPath(); g.arc(0, 0, D * (0.3 + k * 0.04), 0, Math.PI * 2); g.stroke();
  }
  const spec = g.createRadialGradient(-D * 0.45, -D * 0.5, 0, -D * 0.45, -D * 0.5, D * 0.8);
  spec.addColorStop(0, 'rgba(255,255,255,0.55)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spec;
  g.fillRect(-R, -R, size, size);
  g.restore();
  // Bevel: a bright upper-left rim and a dark lower-right rim.
  g.save();
  diskPath();
  g.clip();
  g.rotate(-turn);
  g.lineWidth = Math.max(1.5, R * 0.05);
  const bevel = g.createLinearGradient(-D, -D, D, D);
  bevel.addColorStop(0, 'rgba(255,255,255,0.9)');
  bevel.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  bevel.addColorStop(1, 'rgba(0,0,0,0.75)');
  g.strokeStyle = bevel;
  g.rotate(turn);
  diskPath();
  g.stroke();
  g.restore();

  // Window: a rounded square recessed into the disk, the map clipped inside.
  const w = D * 1.2;
  const rr = w * 0.18;
  g.beginPath();
  g.roundRect(-w / 2, -w / 2, w, w, rr);
  g.fillStyle = '#05070a';
  g.fill();
  g.save();
  g.clip();
  if (state.mapCanvas) {
    const scale = (w / 2) / GLOBE_CELLS;
    g.save();
    g.scale(scale, scale);
    for (const ox of [-512, 0, 512]) {
      for (const oz of [-512, 0, 512]) {
        if (Math.abs(x - ox - 256) > 256 + GLOBE_CELLS * 1.5 || Math.abs(z - oz - 256) > 256 + GLOBE_CELLS * 1.5) continue;
        g.drawImage(state.mapCanvas, ox - x, oz - z);
      }
    }
    g.restore();
  }
  // Glass: the recess casts a shadow on the map, then a highlight and a specular streak.
  g.rotate(-turn);
  const inner = g.createRadialGradient(0, 0, w * 0.3, 0, 0, w * 0.72);
  inner.addColorStop(0, 'rgba(0,0,0,0)');
  inner.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = inner;
  g.fillRect(-R, -R, size, size);
  const shine = g.createLinearGradient(-w / 2, -w / 2, w / 4, w / 4);
  shine.addColorStop(0, 'rgba(255,255,255,0.5)');
  shine.addColorStop(0.35, 'rgba(255,255,255,0.1)');
  shine.addColorStop(0.36, 'rgba(255,255,255,0)');
  g.fillStyle = shine;
  g.fillRect(-R, -R, size, size);
  g.restore();
  // Recess lip: dark on the lit side, bright on the shaded side (it is sunk into the disk).
  g.save();
  g.lineWidth = Math.max(1.5, R * 0.035);
  g.rotate(-turn);
  const lip = g.createLinearGradient(-w / 2, -w / 2, w / 2, w / 2);
  lip.addColorStop(0, '#1b1d20');
  lip.addColorStop(1, '#eef1f4');
  g.strokeStyle = lip;
  g.rotate(turn);
  g.beginPath(); g.roundRect(-w / 2, -w / 2, w, w, rr); g.stroke();
  g.restore();
  g.restore();
  g.restore();
}

function drawMinimapBase() {
  const rgba = state.game.colour_map();
  state.mapImage = new ImageData(new Uint8ClampedArray(rgba), 512, 512);
  state.mapCanvas = document.createElement('canvas');
  state.mapCanvas.width = state.mapCanvas.height = 512;
  state.mapCanvas.getContext('2d').putImageData(state.mapImage, 0, 0);
}

function drawMinimap() {
  const c = $('minimap');
  const g = c.getContext('2d');
  g.putImageData(state.mapImage, 0, 0);
  const [x, z, a] = state.game.player_map();
  g.save();
  g.translate(x, z);
  g.rotate(-a);
  g.fillStyle = '#fff';
  g.strokeStyle = '#000';
  g.beginPath(); g.moveTo(0, 8); g.lineTo(-5, -5); g.lineTo(5, -5); g.closePath(); g.fill(); g.stroke();
  g.restore();
}

// ---------------------------------------------------------------- input

function gamepadBits() {
  let bits = 0;
  for (const p of navigator.getGamepads?.() ?? []) {
    if (!p) continue;
    const [lx, ly, rx] = p.axes;
    if (lx < -0.35) bits |= K.LEFT;
    if (lx > 0.35) bits |= K.RIGHT;
    if (ly < -0.35) bits |= K.FORWARD;
    if (ly > 0.35) bits |= K.BACK;
    if (rx < -0.35) bits |= K.SL;
    if (rx > 0.35) bits |= K.SR;
    const b = (i) => p.buttons[i]?.pressed;
    if (b(0) || b(7)) bits |= K.FIRE;
    if (b(1)) bits |= K.SPECIAL;
    if (b(5)) bits |= K.NEXT;
    if (b(4)) bits |= K.PREV;
  }
  return bits;
}

addEventListener('keydown', (e) => {
  if (state.mode === 'menu') {
    if (state.frontEnd.onKey(e)) e.preventDefault();
    return;
  }
  if (state.mode !== 'game' || !state.running) return;
  if (e.code === 'Escape' || e.code === 'KeyP') { setPaused(!state.paused); e.preventDefault(); return; }
  if (state.paused) {
    const opts = [$('resume'), $('quit')];
    const at = opts.indexOf(document.activeElement);
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      opts[(Math.max(0, at) + (e.code === 'ArrowUp' ? -1 : 1) + opts.length) % opts.length].focus();
      e.preventDefault();
    } else if (e.code === 'Enter' || e.code === 'Space') {
      (opts[at] ?? opts[0]).click();
      e.preventDefault();
    }
    return;
  }
  if (e.code === 'KeyM') { state.showMap = !state.showMap; $('minimap').hidden = !state.showMap; return; }
  if (e.code === 'KeyN') {
    const n = state.music.tracks.length;
    if (n) playMusic((state.music.index + 1) % n);
    return;
  }
  const bit = KEYMAP[e.code];
  if (bit) { state.keys |= bit; e.preventDefault(); }
});
addEventListener('keyup', (e) => {
  const bit = KEYMAP[e.code];
  if (bit) state.keys &= ~bit;
});
addEventListener('blur', () => { state.keys = 0; if (state.mode === 'game' && state.running) setPaused(true); });

// ---------------------------------------------------------------- main loop

let last = performance.now();
function frame(now) {
  const dt = now - last;
  last = now;
  if (state.game && state.running && state.mode === 'menu') {
    state.game.update(dt, 0);
    state.game.render();
  } else if (state.game && state.running) {
    if (!state.paused) {
      const bits = state.keys | gamepadBits();
      state.game.update(dt, bits);
      gunRattle(now, (bits & K.FIRE) !== 0 && state.game.hud()[9] === 0);
      const h = state.game.hud();
      handleEvents(state.game.take_events());
      if (now - state.lastHud > 80) { updateHud(h); state.lastHud = now; }
      drawGlobe();
      if (state.showMap) drawMinimap();
    }
    state.game.render();
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot

async function boot() {
  await init();
  try {
    state.game = new Game($('view'));
  } catch (e) {
    setStatus(`Cannot start WebGL 2: ${e}`, true);
    return;
  }
  $('pick').addEventListener('change', async (e) => {
    for (const f of e.target.files) addFile(f.webkitRelativePath || f.name, f);
    await afterFilesLoaded();
  });
  const loader = $('loader');
  addEventListener('dragover', (e) => { e.preventDefault(); loader.classList.add('drop'); });
  addEventListener('dragleave', () => loader.classList.remove('drop'));
  addEventListener('drop', async (e) => {
    e.preventDefault();
    loader.classList.remove('drop');
    for (const item of e.dataTransfer.items) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) await readEntries(entry);
    }
    await afterFilesLoaded();
  });
  state.frontEnd = createFrontEnd({
    setTitle: (text, [r, g, b]) => state.game.set_title(text, r, g, b),
    get levels() { return state.levels; },
    musicTracks: () => state.music.tracks.map((t) => `CD Track ${t.n}`),
    applySettings,
    startGame: (name) => startGame(name),
    replayIntro: async () => {
      state.frontEnd.hide();
      state.mode = 'intro';
      await runIntro();
      state.mode = 'menu';
      playMusic(state.music.tracks.length ? store.settings.track : -1);
      state.frontEnd.openMain();
    },
    click: uiClick,
  });
  $('resume').addEventListener('click', () => setPaused(false));
  $('quit').addEventListener('click', toMenu);
  const data = new URLSearchParams(location.search).get('data');
  setStatus('Loading game data…');
  if (!data && await loadPackedAssets()) {
    await afterFilesLoaded();
  } else if (data) {
    await fetchDataDir(data);
    await afterFilesLoaded();
  } else {
    setStatus('');
  }
  requestAnimationFrame(frame);
}

boot();
