// The cockpit the mission briefing opens in, modelled in three.js after the original BR_TER*
// videos: a dark green console, the map monitor in a pale bezel under its hood, a switch
// column to its left, banks of pale blue gauges below, a glowing green auxiliary display up
// and to the right with warning lamps under it, and orange arrow indicators. The camera
// pushes in on the map monitor, which stays dead centre, until its black glass fills the view.
import * as THREE from './vendor/three.module.min.js';
import { canvasTexture, panelTexture, metal } from './intro.js';

// Map monitor glass, centred on the origin, facing +z.
const GLASS_W = 1.8, GLASS_H = 1.6;

function roundedRect(w, h, r, path = new THREE.Shape()) {
  path.moveTo(-w / 2 + r, -h / 2);
  path.lineTo(w / 2 - r, -h / 2); path.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  path.lineTo(w / 2, h / 2 - r); path.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  path.lineTo(-w / 2 + r, h / 2); path.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  path.lineTo(-w / 2, -h / 2 + r); path.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return path;
}

/** A rounded frame `w` x `h` with a rounded hole `iw` x `ih`, extruded `depth`. */
function frame(w, h, r, iw, ih, ir, depth) {
  const sh = roundedRect(w, h, r);
  sh.holes.push(roundedRect(iw, ih, ir, new THREE.Path()));
  return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 3, curveSegments: 10 });
}

const glowTex = canvasTexture(64, 64, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, w, h);
});

function build() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.Fog(0x000000, 8, 16);
  const add = (mesh, x, y, z, parent = scene) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };

  // Console: a wide, gently curved dark green shell around the instruments.
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(9, 9, 9, 48, 1, true, Math.PI - 0.95, 1.9),
    new THREE.MeshStandardMaterial({ color: 0x24332e, map: panelTexture('#3d4f48', { cols: 9, rows: 6, line: 'rgba(0,0,0,0.5)', repeat: [3, 2] }), roughness: 0.85, metalness: 0.15, side: THREE.BackSide }),
  );
  add(shell, 0.6, 0, 8.7);
  // Recessed navy panel the monitor and the gauges sit in.
  const recess = new THREE.Mesh(new THREE.CircleGeometry(2.9, 48), new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.8, metalness: 0.2 }));
  recess.scale.set(0.95, 1.12, 1);
  add(recess, -0.15, -0.55, -0.24);
  const recessRim = new THREE.Mesh(new THREE.TorusGeometry(2.9, 0.07, 8, 64), metal(0x2c3a36, 0.6, 0.4));
  recessRim.scale.copy(recess.scale);
  add(recessRim, -0.15, -0.55, -0.22);

  // The map monitor: housing, pale bezel, hood, dead black glass with a faint sheen.
  const housing = new THREE.Mesh(new THREE.BoxGeometry(2.3, 2.1, 0.5), metal(0x262b2b, 0.7, 0.4));
  add(housing, 0, 0, -0.22);
  const bezelMat = metal(0x9aa29f, 0.38, 0.55);
  add(new THREE.Mesh(frame(2.34, 2.14, 0.42, GLASS_W, GLASS_H, 0.3, 0.16), bezelMat), 0, 0, 0);
  const glass = new THREE.Mesh(
    new THREE.ShapeGeometry(roundedRect(GLASS_W + 0.02, GLASS_H + 0.02, 0.3), 10),
    new THREE.MeshStandardMaterial({ color: 0x050707, roughness: 0.12, metalness: 0.2 }),
  );
  add(glass, 0, 0, 0.02);
  const sheen = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.35),
    new THREE.MeshBasicMaterial({ map: glowTex, color: 0x9fb0a8, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  sheen.rotation.z = 0.35;
  add(sheen, -0.35, 0.45, 0.04);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.85), metal(0x7d8584, 0.45, 0.5));
  hood.rotation.x = 0.32;
  add(hood, 0, 1.2, 0.3);
  const hoodBack = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.42, 0.3), metal(0x5a6262, 0.5, 0.5));
  add(hoodBack, 0, 1.18, -0.05);

  const lamps = [];
  const lamp = (x, y, w, h, colour, z = 0.04, glow = 0.9) => {
    const m = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), new THREE.MeshBasicMaterial({ color: colour })), x, y, z);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: colour, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(Math.max(w, h) * 2.6 * glow);
    add(s, x, y, z + 0.05);
    lamps.push({ m, s, base: s.material.opacity, phase: Math.random() * 6 });
    return m;
  };
  const housingAt = (x, y, w, h, colour = 0x252d2c) => add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.16), metal(colour, 0.7, 0.3)), x, y, -0.1);

  // Left switch column: a white tab, toggles with orange tips, a pink lamp.
  housingAt(-1.48, -0.05, 0.36, 2.2, 0x1b2230);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.05), new THREE.MeshBasicMaterial({ color: 0x8a9298 })), -1.48, 0.85, 0.02);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.22, 0.05), metal(0x9aa29f, 0.5, 0.4)), -1.48, 0.55, 0.02);
  const toggle = (x, y) => {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 12).rotateX(Math.PI / 2), metal(0x4a5250, 0.4, 0.6)), x, y, 0.03);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.2, 6), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
    lever.rotation.set(0.9, 0, 0.7);
    add(lever, x - 0.05, y - 0.03, 0.1);
  };
  toggle(-1.48, 0.2);
  lamp(-1.48, -0.25, 0.13, 0.09, 0xff7a8a);
  toggle(-1.48, -0.6);

  // Static screen bottom left.
  const noise = canvasTexture(64, 64, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = 120 + Math.random() * 110; img.data.set([v, v, v * 0.97, 255], i * 4); }
    g.putImageData(img, 0, 0);
  }, { repeat: [0.5, 0.5] });
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping;
  add(new THREE.Mesh(frame(0.62, 0.62, 0.12, 0.46, 0.46, 0.08, 0.08), metal(0x8a9290, 0.45, 0.5)), -1.62, -1.55, -0.02);
  add(new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.48), new THREE.MeshBasicMaterial({ map: noise, color: 0x9a9a98 })), -1.62, -1.55, 0.0);
  toggle(-1.62, -2.15);
  lamp(-1.3, -2.15, 0.13, 0.09, 0xffe040);

  // Gauges: pale blue dials with dark needles, in a bank under the monitor.
  const dialTex = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#9fd0e0'; g.beginPath(); g.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2); g.fill();
    const s = g.createRadialGradient(w * 0.4, h * 0.35, 4, w / 2, h / 2, w / 2);
    s.addColorStop(0, 'rgba(255,255,255,0.35)'); s.addColorStop(1, 'rgba(0,30,50,0.35)');
    g.fillStyle = s; g.fill();
    g.strokeStyle = '#2a4a58'; g.lineWidth = 3;
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2;
      g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * w * 0.4, h / 2 + Math.sin(a) * h * 0.4); g.lineTo(w / 2 + Math.cos(a) * w * 0.47, h / 2 + Math.sin(a) * h * 0.47); g.stroke();
    }
  });
  const needles = [];
  const gauge = (x, y, r = 0.2) => {
    add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 8, 24), metal(0x1d2526, 0.5, 0.6)), x, y, 0.02);
    add(new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ map: dialTex, color: 0x8a9ea4 })), x, y, 0.01);
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.022, r * 0.85, 0.01).translate(0, r * 0.38, 0), new THREE.MeshBasicMaterial({ color: 0x1a2a30 }));
    n.rotation.z = Math.random() * 5;
    needles.push({ n, base: n.rotation.z, rate: 0.6 + Math.random() * 1.6 });
    add(n, x, y, 0.03);
  };
  housingAt(0.35, -1.85, 3.1, 1.1, 0x161d29);
  for (const [x, y] of [[-0.95, -1.6], [-0.95, -2.15], [-0.2, -2.15], [0.4, -1.6], [0.4, -2.15], [1.05, -1.6], [1.05, -2.15], [1.65, -1.65]]) gauge(x, y);
  lamp(-0.25, -1.52, 0.2, 0.12, 0x40ff70);
  for (const y of [-1.75, -1.95]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 10).rotateX(Math.PI / 2), metal(0x6a7270, 0.4, 0.6)), -0.25, y, 0.03);
  toggle(-0.25, -2.2);

  // Auxiliary display up and to the right, glowing pale green, with a faint trace.
  const auxTex = canvasTexture(256, 160, (g, w, h) => {
    g.fillStyle = '#a8c098'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(70,100,60,0.35)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 32) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke(); }
    for (let y = 0; y < h; y += 32) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
    g.strokeStyle = 'rgba(60,90,50,0.6)'; g.lineWidth = 2;
    g.beginPath();
    for (let x = 0; x <= w; x += 4) g.lineTo(x, h * 0.62 + Math.sin(x * 0.07) * 10 + Math.sin(x * 0.23) * 4);
    g.stroke();
    const v = g.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w * 0.7);
    v.addColorStop(0, 'rgba(255,255,255,0.12)'); v.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  });
  const aux = new THREE.Group();
  aux.position.set(2.95, 1.25, 0.1);
  aux.rotation.y = -0.22;
  scene.add(aux);
  aux.add(new THREE.Mesh(new THREE.BoxGeometry(2.55, 1.75, 0.2), metal(0x1d2624, 0.7, 0.4)));
  const auxScreen = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.5), new THREE.MeshBasicMaterial({ map: auxTex, color: 0xb8c8b0 }));
  auxScreen.position.z = 0.11;
  aux.add(auxScreen);
  const auxLight = new THREE.PointLight(0xa8d090, 6, 6, 1.4);
  auxLight.position.set(2.4, 1.0, 1.4);
  scene.add(auxLight);
  // Warning lamps and knobs under it.
  housingAt(3.0, -0.1, 2.4, 0.5);
  lamp(2.25, -0.1, 0.4, 0.22, 0xff7080);
  lamp(2.8, -0.1, 0.4, 0.22, 0xffe24a);
  for (const x of [3.4, 3.85]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.12, 14).rotateX(Math.PI / 2), metal(0x3a4240, 0.4, 0.6)), x, -0.1, 0.04);
  // Orange arrow indicators.
  const arrow = (x, y, up) => {
    const m = lamp(x, y, 0.001, 0.001, 0xff8020, 0.04, 0);
    m.geometry = new THREE.CircleGeometry(0.15, 3);
    m.rotation.z = up ? Math.PI / 2 : -Math.PI / 2;
    m.scale.set(1, 0.75, 1);
    lamps.at(-1).s.scale.setScalar(0.55);
  };
  housingAt(2.95, -0.95, 1.9, 0.6);
  arrow(2.35, -0.95, true); arrow(2.95, -0.9, false); arrow(3.55, -0.9, false);
  // Lamp box bottom right.
  add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.6, 0.4), metal(0x8a9290, 0.45, 0.5)), 2.9, -1.9, 0.05);
  lamp(2.6, -1.9, 0.42, 0.24, 0xff8a98, 0.26);
  lamp(3.2, -1.9, 0.42, 0.24, 0xffe24a, 0.26);
  // Overhead: a yellow lamp and a small pale screen.
  housingAt(-0.2, 2.35, 3.2, 0.5);
  lamp(-0.75, 2.35, 0.32, 0.2, 0xffe24a);
  add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.36), new THREE.MeshBasicMaterial({ color: 0x8a9a88 })), 0.45, 2.35, 0.0);

  scene.add(new THREE.HemisphereLight(0x6a8078, 0x101418, 1.1));
  const key = new THREE.PointLight(0xc8d8d0, 10, 12, 1.2);
  key.position.set(-1.5, 2.5, 4);
  scene.add(key);
  return { scene, lamps, needles, noise };
}

/**
 * The briefing's opening shot. `render(t)` draws time `t` (s) of the push-in; it reaches the
 * glass by `END`. Returns null when WebGL is not available.
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
  const { scene, lamps, needles, noise } = build();
  const cam = new THREE.PerspectiveCamera(50, 1, 0.05, 40);
  const ease = (t) => t * t * (3 - 2 * t);
  const clamp01 = (t) => Math.max(0, Math.min(1, t));
  const END = 3.6;

  return {
    render(t) {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      // End distance: the glass just overfills the view whatever the aspect.
      const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      const end = Math.min(GLASS_H / 2, GLASS_W / 2 / cam.aspect) / tan * 0.82;
      const k = ease(clamp01(t / END));
      // Start up and to the right, a little rolled, like the original's camera; the monitor's
      // centre stays on the view's centre all the way in.
      cam.position.set(1.1 * (1 - k), 0.75 * (1 - k), end + (6.4 - end) * (1 - k));
      cam.up.set(Math.sin(0.08 * (1 - k)), 1, 0);
      cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
      lamps.forEach((l) => { l.s.material.opacity = l.base * (0.85 + 0.15 * Math.sin(t * 9 + l.phase)); });
      needles.forEach((n) => { n.n.rotation.z = n.base + Math.sin(t * n.rate) * 0.15; });
      noise.offset.set(Math.random(), Math.random());
      renderer.render(scene, cam);
    },
    dispose() {
      scene.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [o.material].flat()) { if (m) { m.map?.dispose(); m.dispose(); } }
      });
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
}
