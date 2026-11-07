// The mission briefing, rebuilt after the original BR_TER*.SMK videos and the overlay scripts
// (BR_TER*.SCR) the game draws over them.
//
// The videos are 320x400 and the game shows them on its 640x480 screen (x2 across, x1.2 down);
// the scripts place their texts in those video pixels. A briefing runs: (BR_TER0 only) the push
// into the cockpit's map monitor; the level map spinning in from the top right while the grid
// draws itself in, vertical lines dropping from the top and rows sliding in from the right; then
// for the start and each objective in turn a sweep sound and a flash of light on the map with
// its dot, and ~1.15 s later a framed close-up of the place with its label; (BR_TER0 only) the
// map globe, "North" by its north arrow and "Objective Guide" by its objective pointer; the
// level's name; then the labels and grid go, the close-ups fade out one by one and the map
// fades to black.
//
// With the packed soundtrack of the level's own video (swiv-pack --anims) the timeline follows
// that video's script frame for frame and plays its audio; otherwise it is timed like
// BR_TER1..6 and built from the briefing's sound effects (cut from BR_TER1): the grid, a
// waypoint sweep, a close-up appearing, the outro, and the hum under them all.
import { createCockpit } from './briefing-cockpit.js';
import { paintGlobe } from './globe.js';

const $ = (id) => document.getElementById(id);

const W = 640, H = 480;               // the original's screen
const VX = 2, VY = 1.2;               // video pixels -> screen pixels
const MAP = { x: 128, y: 40, w: 390, h: 400 }; // where the videos show the level map
const GRID = { x: 19, dx: 46, y: 39, dy: 49.7 };
const DOT_R = 7.5;
const FONT = 'italic 700 15px "Trebuchet MS", Verdana, "DejaVu Sans", system-ui, sans-serif';
const TEXT_H = 16;
const GLOBE = { x: 80, y: 70, r: 50 };  // centre and pointer reach of the Objective Guide
// The Objective Guide's pointer in the briefing: fixed at -15 degrees (right, a little down),
// as in BR_TER0, well clear of the north triangle.
const GUIDE_AIM = 15 * Math.PI / 180;

// Timing (s), measured on the videos. A waypoint's sweep and flash come this long before its
// close-up and label; the map flies in this long before the first sweep and settles in SPIN.
const FRAME = 1786 / 25007;            // one Smacker frame
const SWEEP_LEAD = 1.15;
const BOX_LEAD = 0.15;
const MAP_LEAD = 1.93;
const SPIN = 1.45;
// Without a video: as BR_TER1..6, the first label at frame 52, one every 50 frames, the
// labels gone 4.3 s after the last and the video over 2.2 s after that.
const FIRST_LABEL = 52 * FRAME, STEP = 50 * FRAME, HOLD = 4.3, OUTRO = 2.2;
// Where each effect's sound starts inside its clip (s).
const ONSET = { grid: 0.1, waypoint: 0.06, screenshot: 0.08, outro: 0.06 };

const COLOURS = {
  start: { dot: [168, 168, 255], frame: '#9c9cf0' },
  objective: { dot: [235, 12, 8], frame: '#d41a12' },
};

const span01 = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const easeOut = (t) => 1 - (1 - t) ** 3;

/** Start + one mark per objective group (wrap-aware centroid), in group order. */
function markers(points, text) {
  const marks = [{ x: points[0], z: points[1], kind: 'start', label: text(22, 0, 'Start') }];
  const groups = new Map();
  for (let i = 3; i < points.length; i += 3) {
    const g = points[i + 2];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([points[i], points[i + 1]]);
  }
  const order = [...groups.keys()].sort((a, b) => a - b);
  const w = (d) => ((d + 768) % 512) - 256;
  order.forEach((g, k) => {
    const pts = groups.get(g);
    const [x0, z0] = pts[0];
    const x = x0 + pts.reduce((s, [x]) => s + w(x - x0), 0) / pts.length;
    const z = z0 + pts.reduce((s, [, z]) => s + w(z - z0), 0) / pts.length;
    const last = k === order.length - 1;
    marks.push({
      x: (x + 512) % 512, z: (z + 512) % 512, kind: 'objective',
      label: last ? text(22, 1, 'Final Objective') : text(20, 9 - k, `Objective ${k + 1}`),
    });
  });
  return marks;
}

/** When everything happens: from the level's video script when it fits, else BR_TER1..6 timing. */
function timeline(marks, plan, text, title) {
  const F = plan?.frame ?? FRAME;
  const rows = plan?.script ?? [];
  const labels = rows.filter(([g, i]) => g === 20 || (g === 22 && i <= 1)).sort((a, b) => a[2] - b[2]);
  const T = { track: null, north: null, guide: null };
  if (plan?.track && labels.length && labels.length === marks.length) {
    T.track = plan.track;
    labels.forEach(([g, i, a], k) => { marks[k].at = a * F; marks[k].label = text(g, i, marks[k].label); });
    T.end = Math.max(...rows.map((r) => r[3])) * F;
    T.total = plan.duration;
    const at = (g, i) => rows.find((r) => r[0] === g && r[1] === i)?.[2] * F;
    T.north = at(22, 2) ?? null;
    T.guide = at(22, 3) ?? null;
    const tr = rows.find((r) => r[0] === 200);
    T.title = tr && { at: tr[2] * F, x: tr[4] * VX, y: tr[5] * VY, align: tr[7] === 'r' ? 'right' : 'left' };
  } else {
    marks.forEach((m, k) => { m.at = FIRST_LABEL + k * STEP; });
    T.end = marks.at(-1).at + HOLD;
    T.total = T.end + OUTRO;
    T.title = { at: 5 * F, x: 10 * VX, y: 10 * VY, align: 'left' };
  }
  if (T.title) T.title.text = title;
  T.mapIn = Math.max(0.15, marks[0].at - SWEEP_LEAD - MAP_LEAD);
  T.cockpit = T.mapIn > 2.5;   // BR_TER0 opens in the cockpit
  marks.forEach((m) => { m.sweep = m.at - SWEEP_LEAD; m.box = m.at - BOX_LEAD; });
  return T;
}

// ------------------------------------------------------------------- layout

const area = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const grow = (r, d) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });
const outside = (r) => {
  const m = 3;
  const inX = Math.max(0, Math.min(r.x + r.w, W - m) - Math.max(r.x, m));
  const inY = Math.max(0, Math.min(r.y + r.h, H - m) - Math.max(r.y, m));
  return r.w * r.h - inX * inY;
};

/**
 * Places each mark's label beside its dot and its close-up directly above or below the label,
 * as the videos do, so that no close-up or label covers another, a dot, or the globe and title.
 */
function layout(marks, toScreen, measure, reserved) {
  const dots = marks.map((m) => {
    const [x, y] = toScreen(m);
    return { x: x - DOT_R - 2, y: y - DOT_R - 2, w: 2 * DOT_R + 4, h: 2 * DOT_R + 4 };
  });
  const n = marks.length;
  const full = n <= 4 ? 128 : n <= 6 ? 116 : 104;
  const place = (m, k, taken) => {
    const [dx, dy] = toScreen(m);
    const tw = measure(m.label);
    const base = m.kind === 'start' ? 96 : full;
    let best = null;
    for (const scale of [1, 0.86, 0.74]) {
      const size = Math.round(base * scale);
      for (const side of [1, -1]) {
        for (const ldy of [0, 11, -11]) {
          for (const above of [true, false]) {
            for (const align of ['edge', 'centre']) {
              const label = { x: side > 0 ? dx + 13 : dx - 13 - tw, y: dy + ldy - TEXT_H / 2, w: tw, h: TEXT_H };
              const bx = align === 'centre' ? label.x + tw / 2 - size / 2 : side > 0 ? label.x - 2 : label.x + tw + 2 - size;
              const box = { x: bx, y: above ? label.y - 4 - size : label.y + TEXT_H + 4, w: size, h: size };
              let cost = (1 - scale) * 4000 + (side < 0 ? 2 : 0) + Math.abs(ldy) * 0.2 + (align === 'centre' ? 1 : 0);
              cost += (outside(box) + outside(label)) * 60;
              for (const r of taken) cost += (area(grow(box, 4), r) + area(grow(label, 2), r)) * 25;
              dots.forEach((d, j) => { cost += (area(box, d) + (j === k ? 0 : area(label, d))) * 40; });
              if (!best || cost < best.cost) best = { cost, label, box, side };
            }
          }
        }
      }
      if (best.cost < 50) break;
    }
    m.labelRect = best.label;
    m.boxRect = best.box;
    m.cost = best.cost;
  };
  // Greedy in order, then a few passes re-placing each one against all the others.
  marks.forEach((m, k) => place(m, k, [...reserved, ...marks.slice(0, k).flatMap((o) => [o.labelRect, o.boxRect])]));
  for (let pass = 0; pass < 6 && marks.some((m) => m.cost >= 50); pass++) {
    marks.forEach((m, k) => place(m, k, [...reserved, ...marks.filter((o) => o !== m).flatMap((o) => [o.labelRect, o.boxRect])]));
  }
}

// ------------------------------------------------------------------- drawing helpers

/** The level map as the videos show it: dimmed, with edges that fade into the dark. */
function mapImage(mapCanvas) {
  const k = 2;
  const c = document.createElement('canvas');
  c.width = MAP.w * k; c.height = MAP.h * k;
  const g = c.getContext('2d');
  g.filter = 'brightness(0.62) contrast(1.15) saturate(0.85)';
  g.imageSmoothingEnabled = true;
  g.drawImage(mapCanvas, 0, 0, c.width, c.height);
  g.filter = 'none';
  const mask = document.createElement('canvas');
  mask.width = c.width; mask.height = c.height;
  const mg = mask.getContext('2d');
  const e = 22 * k;
  mg.filter = `blur(${e * 0.55}px)`;
  mg.fillStyle = '#fff';
  mg.fillRect(e * 0.9, e * 0.9, c.width - e * 1.8, c.height - e * 1.8);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(mask, 0, 0);
  return c;
}

function drawGrid(g, p, alpha) {
  if (alpha <= 0 || p <= 0) return;
  g.strokeStyle = `rgba(96, 110, 34, ${0.55 * alpha})`;
  g.lineWidth = 1;
  const cols = Math.ceil((W - GRID.x) / GRID.dx), rows = Math.ceil((H - GRID.y) / GRID.dy);
  g.beginPath();
  // Vertical lines drop from the top, left ones a little ahead.
  for (let i = 0; i < cols; i++) {
    const len = H * Math.max(0, Math.min(1, p * 1.45 - (i / cols) * 0.35));
    if (len <= 0) continue;
    const x = Math.round(GRID.x + i * GRID.dx) + 0.5;
    g.moveTo(x, 0); g.lineTo(x, len);
  }
  // Rows slide in from the right, top row first.
  for (let j = 0; j < rows; j++) {
    const f = Math.max(0, Math.min(1, (p - (j / rows) * 0.6) / 0.4));
    if (f <= 0) continue;
    const y = Math.round(GRID.y + j * GRID.dy) + 0.5;
    g.moveTo(W, y); g.lineTo(W - W * f, y);
  }
  g.stroke();
}

function flash(g, x, y, a, r) {
  if (a <= 0 || a >= 1) return;
  const k = Math.sin(a * Math.PI) * (1 - a * 0.3);
  g.save();
  g.globalCompositeOperation = 'lighter';
  const f = g.createRadialGradient(x, y, 0, x, y, r);
  f.addColorStop(0, `rgba(255,255,225,${0.9 * k})`);
  f.addColorStop(0.35, `rgba(230,240,150,${0.55 * k})`);
  f.addColorStop(1, 'rgba(160,200,60,0)');
  g.fillStyle = f;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.restore();
}

function dot(g, x, y, rgb, white) {
  const [r, gr, b] = rgb.map((c) => Math.round(c + (255 - c) * white));
  const s = g.createRadialGradient(x - DOT_R * 0.35, y - DOT_R * 0.4, 0, x, y, DOT_R);
  s.addColorStop(0, `rgb(${Math.min(255, r + 70)},${Math.min(255, gr + 70)},${Math.min(255, b + 70)})`);
  s.addColorStop(0.55, `rgb(${r},${gr},${b})`);
  s.addColorStop(1, `rgb(${Math.round(r * 0.7)},${Math.round(gr * 0.7)},${Math.round(b * 0.7)})`);
  g.fillStyle = s;
  g.beginPath(); g.arc(x, y, DOT_R, 0, Math.PI * 2); g.fill();
}

function text(g, s, x, y, align, colour, alpha) {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.font = FONT;
  g.letterSpacing = '0.6px';
  g.textAlign = align;
  g.textBaseline = 'top';
  g.lineJoin = 'round';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(20,20,22,0.9)';
  g.strokeText(s, x, y);
  g.fillStyle = colour;
  g.fillText(s, x, y);
  g.restore();
}

// ------------------------------------------------------------------- sound

/** Plays the briefing's sound against the audio clock; `now()` is the briefing's time (s). */
function briefingSound(sound, T, marks) {
  if (!sound?.ctx) return null;
  const { ctx } = sound;
  const out = ctx.createGain();
  out.connect(sound.out ?? ctx.destination);
  const t0 = ctx.currentTime + 0.08;
  const sources = [];
  const play = (buf, at, { loop = false, dest = out } = {}) => {
    if (!buf) return null;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    s.connect(dest);
    s.start(t0 + Math.max(0, at), Math.max(0, -at));
    sources.push(s);
    return s;
  };
  if (T.track) {
    play(T.track, 0);
  } else if (sound.clips) {
    const c = sound.clips;
    const cues = [];
    const cue = (name, at) => { if (c[name]) cues.push([at - ONSET[name], name]); };
    cue('grid', T.mapIn);
    marks.forEach((m) => { cue('waypoint', m.sweep); cue('screenshot', m.box); });
    cue('outro', T.end);
    for (const [at, name] of cues) play(c[name], at);
    // The hum runs under everything; the clips carry their own, so it ducks under them.
    if (c.hum) {
      const hum = ctx.createGain();
      hum.connect(out);
      const g = hum.gain;
      g.setValueAtTime(0, t0);
      g.setValueAtTime(0, t0 + T.mapIn);
      g.linearRampToValueAtTime(1, t0 + T.mapIn + 0.3);
      const spans = cues.map(([at, name]) => [at, name === 'outro' ? T.total + 1 : at + c[name].duration]).sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const s of spans) {
        if (merged.length && s[0] <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(merged.at(-1)[1], s[1]);
        else merged.push([...s]);
      }
      for (const [a, b] of merged) {
        if (b < T.mapIn + 0.3) continue;
        g.setValueAtTime(1, t0 + Math.max(a, T.mapIn + 0.3));
        g.linearRampToValueAtTime(0, t0 + Math.max(a, T.mapIn + 0.3) + 0.015);
        g.setValueAtTime(0, t0 + Math.max(a + 0.02, b - 0.08));
        g.linearRampToValueAtTime(1, t0 + b);
      }
      play(c.hum, T.mapIn, { loop: true, dest: hum });
    }
  }
  return {
    now: () => ctx.currentTime - t0,
    stop() {
      const t = ctx.currentTime;
      out.gain.setValueAtTime(out.gain.value, t);
      out.gain.linearRampToValueAtTime(0, t + 0.15);
      for (const s of sources) { try { s.stop(t + 0.2); } catch { /* not started */ } }
      setTimeout(() => out.disconnect(), 400);
    },
  };
}

// ------------------------------------------------------------------- the briefing

/**
 * Runs the briefing; resolves on any key or click, or when it has run its course.
 *   mapCanvas  the level's 512x512 colour map
 *   points     Game.briefing(): start x, z, -1, then x, z, group per objective target
 *   title      the level's name
 *   text       (group, index, fallback) -> GLOBAL.BD string
 *   plan       the level's video, when packed: { frame, duration, script, track (AudioBuffer) }
 *   sound      { ctx, out, clips: { grid, waypoint, screenshot, outro, hum } } (AudioBuffers)
 *   snapshot   (x, z, size px, range) -> a canvas with a 3D view of that place, or null
 */
export function runBriefing({ mapCanvas, points, title = '', text: str = (g, i, f) => f, plan = null, sound = null, snapshot = null }) {
  return new Promise((resolve) => {
    const wrap = $('briefing');
    const c = $('briefing-map');
    wrap.hidden = false;
    const marks = markers(points, str);
    const T = timeline(marks, plan, str, title);
    const start = marks[0];
    const goal = marks[1] ?? null;

    const toScreen = (m) => [MAP.x + m.x / 512 * MAP.w, MAP.y + m.z / 512 * MAP.h];
    const mg = document.createElement('canvas').getContext('2d');
    mg.font = FONT;
    mg.letterSpacing = '0.6px';
    const measure = (s) => Math.ceil(mg.measureText(s).width) + 2;

    // The globe and its two labels (BR_TER0), and the title, are placed first.
    const reserved = [];
    const globe = T.north != null ? { ...GLOBE } : null;
    if (globe) {
      reserved.push({ x: globe.x - globe.r, y: globe.y - globe.r, w: globe.r * 2, h: globe.r * 2 });
      const nw = measure(str(22, 2, 'North'));
      // Just above the rim, over the north triangle (the disk's radius is 0.78 of the reach).
      globe.north = { x: globe.x - nw / 2, y: globe.y - globe.r * 0.78 - TEXT_H - 1, w: nw, h: TEXT_H };
      reserved.push(globe.north);
      if (goal) {
        // The white pointer's tip, and "Objective Guide" right beside it.
        const ang = GUIDE_AIM;
        const tx = globe.x + Math.cos(ang) * globe.r, ty = globe.y + Math.sin(ang) * globe.r;
        const gw = measure(str(22, 3, 'Objective Guide'));
        const cands = [
          { x: tx + 7, y: ty - TEXT_H / 2 },
          { x: tx - gw / 2, y: ty + 5 },
          { x: tx - gw / 2, y: ty - TEXT_H - 5 },
          { x: tx - 7 - gw, y: ty - TEXT_H / 2 },
        ].map((r) => ({ ...r, w: gw, h: TEXT_H }));
        const disk = grow({ x: globe.x - globe.r * 0.78, y: globe.y - globe.r * 0.78, w: globe.r * 1.56, h: globe.r * 1.56 }, -6);
        globe.guide = cands.find((r) => !outside(r) && !area(r, globe.north) && !area(r, disk)) ?? cands[0];
        globe.tip = [tx, ty];
        reserved.push(globe.guide);
      }
    }
    if (T.title?.text) {
      const tw = measure(T.title.text);
      reserved.push({ x: T.title.align === 'right' ? T.title.x - tw : T.title.x, y: T.title.y, w: tw, h: TEXT_H });
    }
    layout(marks, toScreen, measure, reserved);

    // Close-ups: the place itself, rendered in 3D, else the colour map around it.
    for (const m of marks) {
      const b = m.boxRect;
      const px = Math.round(b.w * 2);
      try {
        m.shot = snapshot?.(m.x, m.z, px, m.kind === 'start' ? 0.38 : 1) ?? null;
      } catch (e) {
        console.warn('briefing snapshot', e);
      }
      if (!m.shot) {
        const s = document.createElement('canvas');
        s.width = s.height = px;
        const zoom = 40;
        const sx = Math.max(0, Math.min(512 - zoom, m.x - zoom / 2)), sz = Math.max(0, Math.min(512 - zoom, m.z - zoom / 2));
        s.getContext('2d').drawImage(mapCanvas, sx, sz, zoom, zoom, 0, 0, px, px);
        m.shot = s;
      }
    }

    const map = mapImage(mapCanvas);
    const globeCanvas = document.createElement('canvas');
    let globeKey = '';

    // The opening push into the cockpit (BR_TER0) is 3D, on its own canvas under the 2D one.
    let cockpit = null, view3d = null;
    if (T.cockpit) {
      view3d = document.createElement('canvas');
      view3d.className = 'briefing-cockpit';
      wrap.prepend(view3d);
      cockpit = createCockpit(view3d);
    }
    const dropCockpit = () => { cockpit?.dispose(); cockpit = null; view3d?.remove(); view3d = null; };

    const audio = briefingSound(sound, T, marks);
    const t0 = performance.now();
    const clock = audio ? audio.now : () => (performance.now() - t0) / 1000;
    let done = false;
    const end = () => {
      if (done) return;
      done = true;
      audio?.stop();
      dropCockpit();
      removeEventListener('keydown', key, true);
      wrap.removeEventListener('pointerdown', key);
      wrap.hidden = true;
      resolve();
    };
    const key = (e) => { e.preventDefault?.(); e.stopPropagation?.(); end(); };
    setTimeout(() => { if (!done) { addEventListener('keydown', key, true); wrap.addEventListener('pointerdown', key); } }, 250);

    function draw() {
      if (done) return;
      const t = clock();
      if (t > T.total) { end(); return; }
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const cw = Math.round(c.clientWidth * dpr), ch = Math.round(c.clientHeight * dpr);
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const g = c.getContext('2d');

      if (cockpit && t < Math.min(3.8, T.mapIn)) {
        // The cockpit shows through; darken its edges and fade it out as the glass fills the view.
        cockpit.render(Math.max(0, t));
        g.clearRect(0, 0, cw, ch);
        const v = g.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.hypot(cw, ch) * 0.55);
        v.addColorStop(0, 'rgba(0,0,0,0)');
        v.addColorStop(1, 'rgba(0,0,0,0.7)');
        g.fillStyle = v;
        g.fillRect(0, 0, cw, ch);
        g.fillStyle = `rgba(0,0,0,${span01(t, 2.6, 3.8)})`;
        g.fillRect(0, 0, cw, ch);
        requestAnimationFrame(draw);
        return;
      }
      if (cockpit) dropCockpit();
      g.fillStyle = '#000';
      g.fillRect(0, 0, cw, ch);
      // The 640x480 screen, letterboxed.
      const s = Math.min(cw / W, ch / H);
      g.save();
      g.translate((cw - W * s) / 2, (ch - H * s) / 2);
      g.scale(s, s);
      g.beginPath(); g.rect(0, 0, W, H); g.clip();
      if (t < T.mapIn) { g.restore(); requestAnimationFrame(draw); return; }

      const out = 1 - span01(t, T.total - 1.1, T.total - 0.3);   // the final fade
      const gone = span01(t, T.end - 0.1, T.end + 0.4);           // grid and labels leave
      const gridP = span01(t, T.mapIn + 0.2, T.mapIn + SPIN + 0.15);
      drawGrid(g, gridP, 1 - gone);

      // The map spins in from the top right, turning a quarter turn as it comes.
      const e = easeOut(span01(t, T.mapIn, T.mapIn + SPIN));
      const swirl = (1 - e) * 2.1;
      const r = (1 - e) ** 1.2;
      const ox = (130 * Math.cos(swirl) + 90 * Math.sin(swirl)) * r, oy = (-100 * Math.cos(swirl) + 40 * Math.sin(swirl)) * r;
      g.save();
      g.globalAlpha = span01(t, T.mapIn, T.mapIn + 0.35) * out;
      g.translate(MAP.x + MAP.w / 2 + ox, MAP.y + MAP.h / 2 + oy);
      g.rotate((1 - e) * -1.65);
      g.scale(0.25 + 0.75 * e, 0.25 + 0.75 * e);
      g.drawImage(map, -MAP.w / 2, -MAP.h / 2, MAP.w, MAP.h);
      g.restore();
      // The grid shows faintly over the map too.
      g.save();
      g.globalAlpha = 0.3 * out;
      drawGrid(g, gridP, 1 - gone);
      g.restore();

      // Waypoints: flash and dot, then the close-up and label.
      marks.forEach((m, k) => {
        if (t < m.sweep) return;
        const [x, y] = toScreen(m);
        const col = COLOURS[m.kind];
        const leave = T.end + 0.3 + k * 0.45;
        const a = span01(t, m.box, m.box + 0.3) * (1 - span01(t, leave, leave + 0.3)) * out;
        if (a > 0) {
          const b = m.boxRect;
          g.save();
          g.globalAlpha = a;
          g.drawImage(m.shot, b.x, b.y, b.w, b.h);
          g.strokeStyle = col.frame;
          g.lineWidth = 2;
          g.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
          g.restore();
        }
        flash(g, x, y, (t - m.sweep) / 0.6, 46);
        g.save();
        g.globalAlpha = out;
        dot(g, x, y, col.dot, 1 - span01(t, m.sweep + 0.15, m.sweep + 0.45));
        g.restore();
        const L = m.labelRect;
        const right = L.x + L.w < x;
        text(g, m.label, right ? L.x + L.w : L.x, L.y, right ? 'right' : 'left', '#fff', span01(t, m.at, m.at + 0.12) * (1 - gone));
      });

      // The Objective Guide (BR_TER0): the in-game map globe, north up, centred on the start.
      if (globe && t > T.north - 0.8) {
        const gt = t - (T.north - 0.8);
        const pointer = T.guide != null && t > T.guide - 0.73 && goal;
        const R = globe.r;
        const px = Math.max(1, Math.round(R * 2 * s));
        const keyNow = `${px}|${pointer}`;
        if (keyNow !== globeKey) {
          globeKey = keyNow;
          globeCanvas.width = globeCanvas.height = px;
          paintGlobe(globeCanvas.getContext('2d'), px, mapCanvas, start.x, start.z, -Math.PI, pointer ? goal.x : -1, pointer ? goal.z : -1, 64, pointer ? GUIDE_AIM : null);
        }
        const gs = easeOut(span01(gt, 0, 0.35));
        g.save();
        g.globalAlpha = out;
        g.translate(globe.x, globe.y);
        g.scale(gs, gs);
        g.drawImage(globeCanvas, -R, -R, R * 2, R * 2);
        g.restore();
        flash(g, globe.x, globe.y, gt / 0.6, 70);
        if (T.guide != null) flash(g, globe.x, globe.y, (t - T.guide + 0.73) / 0.6, 70);
        const n = globe.north;
        text(g, str(22, 2, 'North'), n.x, n.y, 'left', '#fff', span01(t, T.north, T.north + 0.12) * (1 - gone));
        if (globe.guide) {
          const q = globe.guide;
          text(g, str(22, 3, 'Objective Guide'), q.x, q.y, 'left', '#fff', span01(t, T.guide, T.guide + 0.12) * (1 - gone));
        }
      }

      if (T.title?.text) {
        text(g, T.title.text, T.title.x, T.title.y, T.title.align, '#a4a4a8', span01(t, T.title.at, T.title.at + 0.15) * (1 - gone));
      }
      g.restore();
      requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
  });
}
