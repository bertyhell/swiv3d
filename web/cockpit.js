// The gunship's cockpit, shared by the intro (shot I, where it wakes up) and the opening of the
// mission briefing (BR_TER0, where the camera then pushes in on the map monitor). Modelled in
// three.js after the original's frames. The dashboard's solid shapes (cockpit-shell.js) are a
// tall centre console leaning out at the top under the cabin roof, lamp strips either side of it, boxes for the two
// big screens and the bottom monitor, and the dash plane behind them. On them: the overhead
// (square clock, a protruding wireframe CRT, two green displays, a row of warning lamps), a
// big static MFD on the left, a green display in the console, the map monitor
// on the right, spotlights on the two big screens, and banks of gauges, lamps and toggles.
import * as THREE from './vendor/three.module.min.js';
import { canvasTexture, panelTexture, metal } from './intro.js';
import { COCKPIT_VIEW, surfaceAt, depthScale, shellMeshes } from './cockpit-shell.js';

export { COCKPIT_VIEW };

// Layout positions are percentages of the original frame (x right, y down), so they can be
// read straight off a screenshot. Sizes are in the same units on a flat plane facing the
// camera (one world unit is 10% of the frame's width); each control is then mounted on the
// dashboard face that shows at its position, squared up to that face's own rows and columns
// (sheared with it where the face tapers), and scaled to look that size from there.
const U = 0.1, V = 0.08;
const wx = (x) => (x - 50) * U;
const wy = (y) => (50 - y) * V;

const TAN = Math.tan(THREE.MathUtils.degToRad(COCKPIT_VIEW.fov / 2));

function roundedRect(w, h, r, path = new THREE.Shape()) {
  path.moveTo(-w / 2 + r, -h / 2);
  path.lineTo(w / 2 - r, -h / 2); path.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  path.lineTo(w / 2, h / 2 - r); path.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  path.lineTo(-w / 2 + r, h / 2); path.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  path.lineTo(-w / 2, -h / 2 + r); path.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return path;
}

/** A rounded frame `w` x `h` with a rounded hole `iw` x `ih`, extruded `depth`. */
function frame(w, h, r, iw, ih, ir, depth, bevel = 0.03) {
  const sh = roundedRect(w, h, r);
  sh.holes.push(roundedRect(iw, ih, ir, new THREE.Path()));
  return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 10 });
}

// A fixed seed, so the power-up runs the same way every time.
function seeded(s) {
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ----------------------------------------------------------------- textures

const glowTex = () => canvasTexture(64, 64, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});

const staticTex = () => canvasTexture(128, 128, (g, w, h) => {
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = 60 + Math.random() * 195; img.data.set([v, v, v, 255], i * 4); }
  g.putImageData(img, 0, 0);
}, { repeat: [0.6, 0.6] });

/** Pale green glass with a soft hot spot; `lines` draws whatever the display shows. */
const greenTex = (lines) => canvasTexture(128, 128, (g, w, h) => {
  g.fillStyle = '#93c48e'; g.fillRect(0, 0, w, h);
  const v = g.createRadialGradient(w * 0.45, h * 0.4, 8, w / 2, h / 2, w * 0.75);
  v.addColorStop(0, 'rgba(255,255,255,0.12)'); v.addColorStop(1, 'rgba(0,30,0,0.3)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,40,0,0.05)';
  for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  lines?.(g, w, h);
});

/** The overhead CRT: a cyan grid with wireframe helicopters. */
const radarTex = () => canvasTexture(256, 224, (g, w, h) => {
  g.fillStyle = '#10272c'; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(70,160,175,0.35)'; g.lineWidth = 1;
  for (let x = 0; x < w; x += 12) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke(); }
  for (let y = 0; y < h; y += 12) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
  g.strokeStyle = '#4fd0de'; g.lineWidth = 2; g.lineJoin = 'round';
  const heli = (cx, cy, s, a) => {
    g.save(); g.translate(cx, cy); g.rotate(a); g.scale(s, s);
    g.beginPath(); g.ellipse(0, 0, 22, 9, 0, 0, Math.PI * 2);   // cabin
    g.moveTo(20, -2); g.lineTo(62, -4); g.lineTo(66, -14);        // tail boom and fin
    g.moveTo(-40, -15); g.lineTo(40, -15); g.moveTo(0, -9); g.lineTo(0, -15);   // rotor
    g.moveTo(-16, 9); g.lineTo(-14, 15); g.moveTo(12, 9); g.lineTo(10, 15);
    g.moveTo(-24, 15); g.lineTo(20, 15);                          // skids
    g.moveTo(-22, 0); g.lineTo(22, 0); g.moveTo(-8, -8); g.lineTo(-8, 8); g.moveTo(8, -8); g.lineTo(8, 8);
    g.stroke(); g.restore();
  };
  heli(160, 52, 1.05, -0.12);
  heli(84, 112, 0.95, -0.95);
  heli(176, 178, 0.75, 0.05);
  const v = g.createRadialGradient(w / 2, h / 2, 30, w / 2, h / 2, w * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = v; g.fillRect(0, 0, w, h);
});

/** A pale blue instrument face; `clock` adds hour marks and hands. */
const dialTex = (clock) => canvasTexture(128, 128, (g, w, h) => {
  g.fillStyle = '#8fc7d8'; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); g.fill();
  const s = g.createRadialGradient(w * 0.4, h * 0.35, 4, w / 2, h / 2, w / 2);
  s.addColorStop(0, 'rgba(255,255,255,0.3)'); s.addColorStop(1, 'rgba(0,30,50,0.4)');
  g.fillStyle = s; g.fill();
  g.strokeStyle = '#163a48'; g.lineWidth = clock ? 4 : 3;
  const n = clock ? 12 : 9;
  for (let k = 0; k < n; k++) {
    const a = clock ? k / 12 * Math.PI * 2 : Math.PI * 0.75 + k / (n - 1) * Math.PI * 1.5;
    g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * w * 0.36, h / 2 + Math.sin(a) * h * 0.36); g.lineTo(w / 2 + Math.cos(a) * w * 0.46, h / 2 + Math.sin(a) * h * 0.46); g.stroke();
  }
  if (clock) {
    g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 - w * 0.08, h / 2 + h * 0.28); g.stroke();
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + w * 0.3, h / 2 + h * 0.12); g.stroke();
  }
});

// -------------------------------------------------------------------- build

function build() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const rand = seeded(1996);
  const glow = glowTex();

  // Controls are built in flat layout coordinates; while one is being built, `mount` holds the
  // group that carries it onto its dashboard face, and `add` places meshes relative to it.
  let mount = null;
  const add = (obj, x, y, z) => {
    if (mount) { obj.position.set(x - mount.ax, y - mount.ay, z); mount.g.add(obj); }
    else { obj.position.set(x, y, z); scene.add(obj); }
    return obj;
  };
  /** `fn(x, y, ...)` with everything it adds mounted on the dashboard face at (x, y). */
  const mounted = (fn) => (x, y, ...rest) => {
    const s = surfaceAt(x, y);
    const k = depthScale(s.point, new THREE.Vector3(wx(x), wy(y), 0));
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    g.matrix.makeBasis(s.right.clone().multiplyScalar(k), s.up.clone().multiplyScalar(k), s.normal.clone().multiplyScalar(k)).setPosition(s.point);
    g.matrixWorldNeedsUpdate = true;
    scene.add(g);
    const outer = mount;
    mount = { g, k, ax: wx(x), ay: wy(y), surface: s };
    try { return fn(x, y, ...rest); } finally { mount = outer; }
  };

  // Everything that lights up registers here: `at` (0..1) is when in the power-up it comes
  // on, `set(p)` applies the power level p (0 off, 1 on).
  const powered = [];
  const power = (set, at = rand()) => { powered.push({ set, at, phase: rand() * 6 }); set(0); };
  const fade = (col, off, on) => {
    const a = new THREE.Color(off), b = new THREE.Color(on);
    return (p) => col.lerpColors(a, b, p);
  };
  // Glows stand well off their face, towards the camera: they always face it, so on a tilted
  // face they would otherwise cut into it.
  const eye = new THREE.Vector3(...COCKPIT_VIEW.pos);
  const halo = (x, y, z, size, colour, strength = 0.5) => {
    const p = new THREE.Vector3(x, y, z);
    if (mount) {
      mount.g.updateMatrixWorld(true);
      const local = new THREE.Vector3(x - mount.ax, y - mount.ay, z);
      const toEye = mount.g.worldToLocal(eye.clone()).sub(local).normalize();
      p.addScaledVector(toEye, 0.35);
    }
    const s = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: colour, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })), p.x, p.y, p.z);
    s.scale.setScalar(size);
    return (p) => { s.material.opacity = strength * p; };
  };

  // ---- materials
  const panelMap = panelTexture('#3a4246', { cols: 4, rows: 3, line: 'rgba(0,0,0,0.5)' });
  panelMap.wrapS = panelMap.wrapT = THREE.RepeatWrapping;
  const shellMat = (color) => new THREE.MeshStandardMaterial({ color, map: panelMap, roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide });
  const navyMat = metal(0x0f1d29, 0.8, 0.3);
  const bezelMat = metal(0x7d8384, 0.45, 0.5);
  const darkBezelMat = metal(0x2a3034, 0.6, 0.4);
  const knobMat = metal(0xa8acaa, 0.35, 0.7);
  const nutMat = metal(0x4a5052, 0.4, 0.7);

  // ---- the dashboard's shapes, the darker panels on the dash around the gauges, the roof
  const back = new THREE.Mesh(new THREE.PlaneGeometry(44, 26), new THREE.MeshStandardMaterial({ color: 0x0c1012, roughness: 0.9, metalness: 0.1 }));
  add(back, 0, 0, -3);
  scene.add(shellMeshes({
    default: shellMat(0x1c2428),
    dash: shellMat(0x151c20),
    mfdL: shellMat(0x181e22),
    mfdR: shellMat(0x181e22),
    monitor: metal(0x2a3034, 0.6, 0.4),
    lampBox: bezelMat,
    zone: navyMat,
    roof: shellMat(0x090c0e),
  }));

  // Canopy frame across the top right, far behind.
  const strut = new THREE.Mesh(new THREE.BoxGeometry(Math.hypot(26 * U, 25 * V), 0.14, 0.1), metal(0x1a2022, 0.7, 0.3));
  strut.rotation.z = -Math.atan2(25 * V, 26 * U);
  add(strut, wx(75), wy(18.5), -0.35);

  // ---- components (x, y and sizes in layout percent; z out from the face they sit on)

  /** A rectangular lamp in a dark rim. */
  const lamp = mounted((x, y, colour, w = 3, h = 2.4) => {
    add(new THREE.Mesh(new THREE.BoxGeometry(w * U + 0.05, h * V + 0.05, 0.05), darkBezelMat), wx(x), wy(y), 0.02);
    const mat = new THREE.MeshBasicMaterial();
    add(new THREE.Mesh(new THREE.BoxGeometry(w * U, h * V, 0.05), mat), wx(x), wy(y), 0.04);
    const off = new THREE.Color(colour).multiplyScalar(0.012).add(new THREE.Color(0x0b0c0c));
    const f = fade(mat.color, off, colour), g = halo(wx(x), wy(y), 0.06, Math.max(w * U, h * V) * 2.6, colour, 0.5);
    power((p) => { f(p); g(p); });
  });

  /** A round knob on a nut, optionally with a red index mark. */
  const knob = mounted((x, y, red = false, r = 0.085) => {
    add(new THREE.Mesh(new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.04, 6).rotateX(Math.PI / 2), nutMat), wx(x), wy(y), 0.02);
    add(new THREE.Mesh(new THREE.CylinderGeometry(r * 0.8, r, 0.12, 14).rotateX(Math.PI / 2), knobMat), wx(x), wy(y), 0.1);
    const mark = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, r * 0.9, 0.02), red ? new THREE.MeshStandardMaterial({ color: 0x9a2020, roughness: 0.6 }) : nutMat), wx(x), wy(y), 0.17);
    mark.rotation.z = rand() * 6;
  });

  /** A toggle on a nut; its orange lever glows when lit, pointing `dir` (1 up, -1 down). */
  const toggle = mounted((x, y, dir = 1) => {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 6).rotateX(Math.PI / 2), nutMat), wx(x), wy(y), 0.02);
    const lever = add(new THREE.Group(), wx(x), wy(y), 0.06);
    lever.rotation.z = dir > 0 ? 0 : Math.PI;
    const mat = new THREE.MeshBasicMaterial();
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.24, 12), mat);
    m.position.set(0, 0.1, 0.04); m.rotation.x = 0.55;
    lever.add(m);
    const f = fade(mat.color, 0x3a3836, 0xff8a24), g = halo(wx(x), wy(y) + dir * 0.1, 0.12, 0.42, 0xff8020, 0.45);
    power((p) => { f(p); g(p); });
  });

  /** A three-position rocker, `h` percent tall. */
  const rocker = mounted((x, y, h = 5) => {
    add(new THREE.Mesh(new THREE.BoxGeometry(0.17, h * V, 0.06), darkBezelMat), wx(x), wy(y), 0.03);
    for (const k of [-1, 1]) add(new THREE.Mesh(new THREE.BoxGeometry(0.11, h * V * 0.36, 0.05), nutMat), wx(x), wy(y) + k * h * V * 0.24, 0.07);
  });

  /** A backlit gauge in a square navy housing. */
  const needles = [];
  const gaugeFace = dialTex(false);
  const gauge = mounted((x, y, r = 0.22) => {
    add(new THREE.Mesh(new THREE.BoxGeometry(r * 2.45, r * 2.45, 0.06), navyMat), wx(x), wy(y), 0.03);
    add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.03, 8, 28), metal(0x1d2526, 0.5, 0.6)), wx(x), wy(y), 0.07);
    const mat = new THREE.MeshBasicMaterial({ map: gaugeFace });
    add(new THREE.Mesh(new THREE.CircleGeometry(r, 28), mat), wx(x), wy(y), 0.065);
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.02, r * 0.8, 0.01).translate(0, r * 0.36, 0), new THREE.MeshBasicMaterial({ color: 0x12242a }));
    n.rotation.z = rand() * 5;
    needles.push({ n, base: n.rotation.z, rate: 0.6 + rand() * 1.6 });
    add(n, wx(x), wy(y), 0.075);
    power(fade(mat.color, 0x1a262c, 0x6aa0ae));
  });

  /** The square clock. */
  const clock = mounted((x, y, size = 0.8) => {
    add(new THREE.Mesh(new THREE.BoxGeometry(size, size, 0.08), metal(0x10303a, 0.7, 0.3)), wx(x), wy(y), 0.04);
    const mat = new THREE.MeshBasicMaterial({ map: dialTex(true) });
    add(new THREE.Mesh(new THREE.CircleGeometry(size * 0.37, 32), mat), wx(x), wy(y), 0.09);
    add(new THREE.Mesh(new THREE.TorusGeometry(size * 0.37, 0.025, 8, 32), metal(0x1d2526, 0.5, 0.6)), wx(x), wy(y), 0.095);
    power(fade(mat.color, 0x1a262c, 0x6aa0ae));
  });

  /**
   * A screen centred on (x, y), `w` x `h` percent of glass. `bezel` is 'round' (a pale rounded
   * frame `border` percent wide), 'flat' (a plain dark surround) or 'none'. `z` stands it out
   * from its face on a housing. The glass glows its texture tinted from `off` to `on`, and
   * still catches the cabin light, so a `spot` shows on it once the panel is up. `grid` lays
   * a yellow grid over it, `sheen` a faint reflection. Returns the glass's frame in the world.
   */
  const yellowGrid = canvasTexture(128, 128, (g, w, h) => {
    g.strokeStyle = 'rgba(210,200,70,0.55)'; g.lineWidth = 1.5;
    for (let k = 1; k < 8; k++) {
      g.beginPath(); g.moveTo(k * w / 8, 0); g.lineTo(k * w / 8, h); g.stroke();
      g.beginPath(); g.moveTo(0, k * h / 8); g.lineTo(w, k * h / 8); g.stroke();
    }
  });
  const screen = mounted((x, y, w, h, { map = null, on = 0xffffff, off = 0x000000, bezel = 'round', border = 0.7, light = null, z = 0, spot = 0, grid = false, sheen = false }) => {
    const gw = w * U, gh = h * V, b = border * U, cx = wx(x), cy = wy(y);
    if (z > 0) add(new THREE.Mesh(new THREE.BoxGeometry(gw + 2 * b + 0.04, gh + 2 * b + 0.04, z + 0.05), darkBezelMat), cx, cy, (z - 0.05) / 2);
    if (bezel === 'round') {
      const ir = Math.min(gw, gh) * 0.12;
      add(new THREE.Mesh(frame(gw + 2 * b, gh + 2 * b, ir + b, gw, gh, ir, 0.06, 0.025), bezelMat), cx, cy, z + 0.01);
    } else if (bezel === 'flat') {
      add(new THREE.Mesh(frame(gw + 2 * b, gh + 2 * b, 0.03, gw, gh, 0.01, 0.05, 0.01), darkBezelMat), cx, cy, z + 0.01);
    }
    // Glossy only under a spotlight: elsewhere a sheen would just show the screen's own glow light.
    const mat = new THREE.MeshStandardMaterial({ color: 0x14181a, roughness: spot ? 0.35 : 0.95, metalness: spot ? 0.2 : 0, emissiveMap: map });
    // A little larger than the hole: the bezel hides the corners.
    const pad = bezel === 'none' ? 0 : 0.04;
    const glass = add(new THREE.Mesh(new THREE.PlaneGeometry(gw + pad, gh + pad), mat), cx, cy, z + 0.02);
    const f = fade(mat.emissive, off, on);
    let gridMat = null, l = null, s = null;
    if (grid) {
      gridMat = new THREE.MeshBasicMaterial({ map: yellowGrid, transparent: true, opacity: 0, depthWrite: false });
      add(new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), gridMat), cx, cy, z + 0.025);
    }
    if (sheen) {
      const m = add(new THREE.Mesh(new THREE.PlaneGeometry(gw * 0.6, gh * 0.2), new THREE.MeshBasicMaterial({ map: glow, color: 0x9fb0a8, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false })), cx - gw * 0.2, cy + gh * 0.24, z + 0.03);
      m.rotation.z = 0.35;
    }
    if (light) l = add(new THREE.PointLight(light, 0, 3.5, 1.6), cx, cy, z + 0.9);
    if (spot) {
      s = add(new THREE.SpotLight(0xe6eef0, 0, 10, 0.36, 0.75, 1.3), cx + 0.4, cy + 2.6, z + 3.4);
      add(s.target, cx, cy + 0.25, z);
    }
    power((p) => { f(p); if (gridMat) gridMat.opacity = 0.6 * p; if (l) l.intensity = p * 2.2; if (s) s.intensity = p * spot; });
    mount.g.updateMatrixWorld(true);
    const k = mount.k;
    return {
      center: glass.getWorldPosition(new THREE.Vector3()),
      normal: mount.surface.normal.clone(),
      up: mount.surface.up.clone(),
      w: gw * k, h: gh * k,
    };
  });

  const noise = staticTex();

  // ---- overhead (console top)
  clock(23.6, 14);
  screen(38.5, 17.5, 15.5, 16, { map: radarTex(), border: 0.6, z: 0.2, light: 0x40a8b8 });
  screen(52.6, 14, 7.6, 14, {
    map: greenTex((g, w, h) => {
      g.strokeStyle = 'rgba(40,80,40,0.55)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(w * 0.52, 0); g.lineTo(w * 0.52, h);
      for (const y of [0.3, 0.55, 0.8]) { g.moveTo(w * 0.15, h * y); g.lineTo(w * 0.42, h * y); g.moveTo(w * 0.6, h * (y - 0.1)); g.lineTo(w * 0.85, h * (y - 0.1)); }
      g.stroke();
    }), bezel: 'none', light: 0x90d088,
  });
  screen(27, 28, 6.2, 11, { map: greenTex(), bezel: 'flat', border: 0.6, light: 0x90d088 });
  lamp(33.5, 31, 0xff4a40);
  lamp(38.8, 31, 0xffe030);
  lamp(43.8, 31, 0xffe030);
  lamp(48.3, 31, 0xffe030);
  rocker(52.5, 30.5, 5.5);
  // Lamp strips either side.
  knob(15.5, 31);
  lamp(19.5, 31, 0xffe030);
  lamp(62.5, 31, 0xff4a40);
  knob(66.5, 31);

  // ---- left MFD (5:4): static under a yellow grid
  screen(17.25, 53, 20.5, 20.5, { map: noise, on: 0x8a8a84, border: 0.6, spot: 26, grid: true });

  // Left edge column.
  rocker(2, 47, 5);
  toggle(2, 53.5, 1);
  lamp(2.2, 60.8, 0xff4a40, 2.6, 2.2);
  toggle(2, 65, -1);

  // ---- centre console: the green display, knobs, lamps and toggles below it
  screen(40.75, 47, 16.5, 15.5, { map: greenTex(), bezel: 'flat', border: 0.5, light: 0x90d088 });
  knob(31, 41, false, 0.075);
  knob(31, 47.5, true, 0.075);
  knob(51.7, 42.5, true);
  knob(51.7, 49);
  lamp(33.8, 59, 0xff4a40);
  lamp(38.3, 59, 0xffe030);
  knob(42.3, 59.5);
  knob(46.2, 59.5);
  rocker(49.8, 59, 5);
  knob(35, 70);
  toggle(38.6, 70.5, 1);
  toggle(42.2, 69.8, -1);
  toggle(46.2, 69.8, -1);
  knob(49.6, 70.5);

  // ---- map monitor (right): stays dark; the briefing map appears on it
  const glass = screen(77.7, 56.5, 27, 29, { off: 0x000000, on: 0x070909, border: 0.7, spot: 30, sheen: true });

  // Right edge column.
  lamp(98, 60, 0xffe030, 2.8, 2.2);
  knob(98, 63.5);
  rocker(98, 68, 5);
  knob(98, 73.5);

  // ---- bottom left: a small static screen, a block of gauges
  screen(3.6, 74.75, 6.4, 7, { map: noise, on: 0x8a8a86, border: 0.6, bezel: 'flat' });
  toggle(3, 82.5, -1);
  lamp(6.5, 83, 0xffe030, 2.6, 2.2);
  for (const y of [75, 83]) for (const x of [11, 21.5, 27.5]) gauge(x, y);
  lamp(16, 73.5, 0x40ff60, 2.4, 2.2);
  knob(16, 77.5);
  knob(16, 81, true);
  toggle(16, 85, 1);

  // ---- bottom centre: the bright static monitor, and the lamp box on top of it
  screen(42, 92.3, 13, 15, { map: noise, on: 0xd8d8d4, border: 1.1 });
  lamp(39.8, 78.4, 0xff4a40);
  lamp(44.6, 78.4, 0xffe030);

  // ---- bottom right
  gauge(58.5, 79.5);
  gauge(58.5, 88);
  knob(65.5, 80.5);
  toggle(68.6, 80.5, -1);
  toggle(71.6, 80.5, -1);
  toggle(75, 81, 1);
  lamp(78.4, 80.8, 0x40ff60);
  lamp(82, 81, 0xff4a40);
  rocker(85.6, 81, 4.6);
  toggle(92, 80.5, -1);
  for (const [y, c] of [[86.5, 0xff4a40], [89.3, 0x40ff60], [92.1, 0x40ff60]]) lamp(64.5, y, c);
  screen(72.5, 89.5, 7.6, 9, { map: noise, on: 0x7a7a76, border: 0.9 });
  toggle(81.5, 88.3, -1);
  lamp(85.3, 89, 0x40ff60, 2.8, 2.2);
  toggle(81.5, 95, 1);
  knob(84.8, 94.8, true);
  for (const [y, c] of [[86.5, 0xffe030], [89.4, 0xff4a40], [92.3, 0x40ff60], [95.2, 0xff4a40]]) lamp(91.3, y, c);
  gauge(98.5, 83);
  gauge(98.5, 92.5);

  // ---- light: dim cabin light, raised a little once the panel is up
  const hemi = new THREE.HemisphereLight(0x8a9aa0, 0x101418, 0.6);
  scene.add(hemi);
  const key = new THREE.PointLight(0xc8d4d8, 10, 16, 1.3);
  key.position.set(-2.5, 3.5, 5);
  scene.add(key);
  power((p) => { hemi.intensity = 0.6 + 0.6 * p; key.intensity = 10 + 8 * p; }, 0);
  return { scene, powered, needles, noise, glass };
}

/**
 * The cockpit scene. `update(t, wake, span)` animates it at clock time `t` (s): the panel is
 * dark until `wake` reaches 0 (seconds since power-up began), and its parts come on one by one
 * over the next `span` seconds. `glass` is the map monitor's glass (centre, normal, up, size).
 */
export function cockpitScene() {
  const { scene, powered, needles, noise, glass } = build();
  return {
    scene,
    glass,
    update(t, wake, span = 0.65) {
      for (const e of powered) {
        // Each part flickers as it catches, then holds with a faint shimmer.
        const on = wake - e.at * span;
        let p = 0;
        if (on >= 0) p = on < 0.16 ? (Math.random() < 0.55 ? 1 : 0.25) : 0.93 + 0.07 * Math.sin(t * 9 + e.phase);
        e.set(p);
      }
      needles.forEach((n) => { n.n.rotation.z = n.base + Math.sin(t * n.rate) * 0.15; });
      noise.offset.set(Math.random(), Math.random());
    },
    dispose() {
      scene.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [o.material].flat()) { if (m) { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); } }
      });
    },
  };
}

const WAKE = 0.2;   // the briefing's panel starts powering up
const HOLD = 1.1;   // the camera holds while it does
const END = 3.6;    // the camera reaches the glass

/**
 * The briefing's opening shot. `render(t)` draws time `t` (s): the panel powers up while the
 * camera holds on the original's framing, then it pushes in on the map monitor, turning to
 * face its glass square on, and reaches it by `END`. Returns null when WebGL is not available.
 */
export function createCockpit(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (e) {
    console.warn('briefing: no WebGL', e);
    return null;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const pit = cockpitScene();
  const { glass } = pit;
  const cam = new THREE.PerspectiveCamera(COCKPIT_VIEW.fov, 4 / 3, 0.05, 60);
  const ease = (t) => t * t * (3 - 2 * t);
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const from = new THREE.Vector3(...COCKPIT_VIEW.pos), aim = new THREE.Vector3(...COCKPIT_VIEW.target);
  // End: square on to the glass, which just overfills the view.
  const end = glass.center.clone().addScaledVector(glass.normal, Math.min(glass.h / 2, glass.w / 2 / cam.aspect) / TAN * 0.82);
  const Y = new THREE.Vector3(0, 1, 0), look = new THREE.Vector3();

  return {
    render(t) {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      // A 4:3 view, letterboxed like the briefing screens that follow it.
      const vw = Math.min(w, h * 4 / 3), vh = vw * 3 / 4;
      renderer.setScissorTest(false);
      renderer.clear();
      renderer.setViewport((w - vw) / 2, (h - vh) / 2, vw, vh);
      renderer.setScissor((w - vw) / 2, (h - vh) / 2, vw, vh);
      renderer.setScissorTest(true);
      const k = ease(clamp01((t - HOLD) / (END - HOLD)));
      cam.position.lerpVectors(from, end, k);
      cam.up.lerpVectors(Y, glass.up, k).normalize();
      cam.lookAt(look.lerpVectors(aim, glass.center, k));
      cam.updateProjectionMatrix();
      pit.update(t, t - WAKE);
      renderer.render(pit.scene, cam);
    },
    dispose() {
      pit.dispose();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
