// The opening cinematic, rebuilt in real time with three.js after the original's pre-rendered
// INTRO1/INTRO2 Smacker videos (same storyboard, procedural models, no video data used):
//   1. a KEEP OUT sign on the perimeter fence at night, under a flickering strip light
//   2. the air base behind it: jets, Nissen hangars, trucks, a watchtower and its searchlight
//   3. inside a hangar: strip lights come on, the cockpit wakes, missiles are loaded and the
//      gunship rises on its lift
//   4. outside, the hangar blows apart and the gunship climbs out of the fireball
//   5. dusk: it skims the hills, swings round to face the camera and fires
//   6. white-out, then the chrome SWIV 3D logo
// Sound comes from the game's own effects (SOUNDS.BD) and a fluorescent hum; no music.
import * as THREE from './vendor/three.module.min.js';

const LENGTH = 48; // seconds

const rand = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const span = (t, a, b) => clamp01((t - a) / (b - a));

export function canvasTexture(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  t.anisotropy = 4;
  return t;
}

function noiseTexture(w, h, base, spread, repeat) {
  return canvasTexture(w, h, (g) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const n = (rand() - 0.5) * spread;
      img.data[i * 4] = base[0] + n; img.data[i * 4 + 1] = base[1] + n; img.data[i * 4 + 2] = base[2] + n;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat });
}

// ------------------------------------------------------------------ models

export const metal = (c, rough = 0.55, met = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: met });

/**
 * A lofted hull: superellipse cross-sections along z. Each section is
 * { z, w, h, y = 0, n = 2.6, top = 1, bot = 1 } (half width, half height, centre height,
 * squareness, and top/bottom height scales). UVs run round (u) and along (v) the hull.
 */
function loft(sections, segs = 28) {
  const pos = [], uv = [], idx = [];
  const ring = segs + 1;
  sections.forEach((s, j) => {
    const n = s.n ?? 2.6, e = 2 / n;
    for (let i = 0; i <= segs; i++) {
      const a = i / segs * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const x = Math.sign(c) * Math.abs(c) ** e * s.w;
      const y = Math.sign(sn) * Math.abs(sn) ** e * s.h * (sn > 0 ? (s.top ?? 1) : (s.bot ?? 1));
      pos.push(x, (s.y ?? 0) + y, s.z);
      uv.push(i / segs, j / (sections.length - 1));
    }
  });
  for (let j = 0; j < sections.length - 1; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * ring + i, b = a + ring;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  // End caps.
  for (const [j, flip] of [[0, true], [sections.length - 1, false]]) {
    const s = sections[j];
    const c = pos.length / 3;
    pos.push(0, s.y ?? 0, s.z); uv.push(0.5, j ? 1 : 0);
    for (let i = 0; i < segs; i++) {
      const a = j * ring + i;
      if (flip) idx.push(c, a + 1, a); else idx.push(c, a, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat plate from an outline (x, z pairs in the plane), extruded `t` thick, bevelled. */
function plate(points, t = 0.08, bevel = 0.02) {
  const sh = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
  g.translate(0, 0, -t / 2);
  return g;
}

/** Panel lines and rivet grime over a base colour, for hull skins. */
export function panelTexture(base, { cols = 6, rows = 4, line = 'rgba(0,0,0,0.55)', repeat = [1, 1] } = {}) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,255,255'},${rand() * 0.05})`;
      g.fillRect(rand() * w, rand() * h, 2 + rand() * 14, 2 + rand() * 6);
    }
    g.strokeStyle = line; g.lineWidth = 1.5;
    for (let c = 0; c <= cols; c++) {
      const x = Math.round(c / cols * w + (c % 2 ? 6 : -4)) + 0.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    }
    for (let r = 0; r <= rows; r++) {
      const y = Math.round(r / rows * h) + 0.5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let r = 0; r <= rows; r++) for (let x = 3; x < w; x += 9) g.fillRect(x, r / rows * h + 3, 1.5, 1.5);
  }, { repeat });
}

const glassMat = () => new THREE.MeshStandardMaterial({ color: 0x0e1822, roughness: 0.04, metalness: 1, envMapIntensity: 1.6 });
const navLight = (col, r = 0.05) => new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), new THREE.MeshBasicMaterial({ color: col }));

function wheel(r = 0.18, w = 0.12) {
  const g = new THREE.Group();
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.3, 8, 18), metal(0x121212, 0.9, 0));
  tyre.rotation.y = Math.PI / 2;
  tyre.scale.z = w / (r * 0.6);
  g.add(tyre);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, w * 0.9, 12), metal(0x7a7e84, 0.4, 0.8));
  hub.rotation.z = Math.PI / 2;
  g.add(hub);
  return g;
}

/**
 * The gunship, after the intro's attack helicopter: angular armoured fuselage with a stepped
 * tandem canopy, twin engine nacelles, anhedral stub wings carrying rocket pods and missile
 * rails, chin gun turret, tail-wheel gear, a swept fin with the tail rotor on its side, and
 * nav lights. +z is forward.
 */
function makeHeli() {
  const g = new THREE.Group();
  const skin = panelTexture('#8a9098', { cols: 5, rows: 3, repeat: [2, 3] });
  const hull = new THREE.MeshStandardMaterial({ color: 0x5f666e, map: skin, roughness: 0.42, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.55, metalness: 0.5 });
  const black = metal(0x0c0d0f, 0.7, 0.3);

  // Fuselage: pointed nose, slab-sided cabin, narrowing into the tail boom.
  const body = new THREE.Mesh(loft([
    { z: 3.05, w: 0.05, h: 0.06, y: -0.32, n: 2 },
    { z: 2.75, w: 0.3, h: 0.28, y: -0.27, n: 2.4 },
    { z: 2.2, w: 0.52, h: 0.5, y: -0.16, n: 3 },
    { z: 1.3, w: 0.66, h: 0.66, y: -0.05, n: 3.4, top: 0.9 },
    { z: 0.2, w: 0.74, h: 0.78, y: 0.02, n: 3.6 },
    { z: -0.9, w: 0.72, h: 0.76, y: 0.08, n: 3.6 },
    { z: -1.6, w: 0.5, h: 0.55, y: 0.18, n: 3.2 },
    { z: -2.2, w: 0.26, h: 0.32, y: 0.3, n: 2.8 },
    { z: -4.6, w: 0.16, h: 0.2, y: 0.42, n: 2.6 },
    { z: -5.5, w: 0.1, h: 0.16, y: 0.5, n: 2.4 },
  ], 32), hull);
  g.add(body);
  // Stepped tandem canopy: gunner low in front, pilot higher behind.
  const canopyFront = new THREE.Mesh(loft([
    { z: 2.45, w: 0.08, h: 0.04, y: 0.12, n: 2.2, bot: 0.1 },
    { z: 2.1, w: 0.36, h: 0.3, y: 0.18, n: 2.6, bot: 0.1 },
    { z: 1.4, w: 0.44, h: 0.42, y: 0.25, n: 2.8, bot: 0.1 },
    { z: 1.05, w: 0.42, h: 0.4, y: 0.27, n: 2.8, bot: 0.1 },
  ], 24), glassMat());
  g.add(canopyFront);
  const canopyRear = new THREE.Mesh(loft([
    { z: 1.25, w: 0.3, h: 0.1, y: 0.5, n: 2.4, bot: 0.1 },
    { z: 0.95, w: 0.44, h: 0.4, y: 0.52, n: 2.8, bot: 0.1 },
    { z: 0.2, w: 0.46, h: 0.46, y: 0.56, n: 2.8, bot: 0.1 },
    { z: -0.25, w: 0.38, h: 0.28, y: 0.56, n: 2.6, bot: 0.1 },
  ], 24), glassMat());
  g.add(canopyRear);
  // Canopy frames.
  for (const [z, y, r, h] of [[1.75, 0.21, 0.42, 0.95], [1.12, 0.27, 0.43, 0.95], [0.95, 0.52, 0.45, 0.9], [0.2, 0.56, 0.47, 0.98]]) {
    const f = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 6, 20, Math.PI), dark);
    f.position.set(0, y, z);
    f.scale.y = h;
    g.add(f);
  }

  // Engine nacelles either side of the rotor mast, with intakes and exhausts.
  for (const s of [-1, 1]) {
    const nac = new THREE.Mesh(loft([
      { z: 0.75, w: 0.24, h: 0.24, n: 2 },
      { z: 0.55, w: 0.3, h: 0.3, n: 2.2 },
      { z: -0.9, w: 0.32, h: 0.33, n: 2.4 },
      { z: -1.6, w: 0.22, h: 0.24, n: 2.2 },
    ], 18), hull);
    nac.position.set(s * 0.7, 0.68, 0);
    g.add(nac);
    const intake = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), black);
    intake.position.set(s * 0.7, 0.68, 0.76);
    g.add(intake);
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.4, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.8, metalness: 0.4, side: THREE.DoubleSide }));
    exhaust.rotation.x = Math.PI / 2 + 0.25;
    exhaust.rotation.z = s * 0.4;
    exhaust.position.set(s * 0.82, 0.72, -1.72);
    g.add(exhaust);
  }
  // Stub wings with slight anhedral, pylons, rocket pods outboard and missile rails inboard.
  const missiles = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(plate([[0, 0.45], [1.55, 0.25], [1.55, -0.3], [0, -0.5]].map(([x, y]) => [x * s, y]), 0.09, 0.02), dark);
    wing.rotation.x = Math.PI / 2;
    const holder = new THREE.Group();
    holder.position.set(s * 0.6, -0.12, 0.15);
    holder.rotation.z = s * -0.1;
    holder.add(wing);
    g.add(holder);
    const tip = navLight(s < 0 ? 0xff2a1a : 0x22ff55);
    tip.position.set(s * 2.17, -0.27, 0.12);
    g.add(tip);
    const pylon = (x) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.55), dark);
      p.position.set(s * x, -0.3, 0.15);
      g.add(p);
    };
    pylon(1.95); pylon(1.3);
    // Rocket pod: blunt cylinder with a honeycomb of tubes at the front.
    const pod = new THREE.Mesh(loft([
      { z: 0.75, w: 0.14, h: 0.14, n: 2 }, { z: 0.65, w: 0.2, h: 0.2, n: 2 },
      { z: -0.55, w: 0.2, h: 0.2, n: 2 }, { z: -0.7, w: 0.12, h: 0.12, n: 2 },
    ], 16), hull);
    pod.position.set(s * 1.95, -0.52, 0.15);
    g.add(pod);
    for (let k = 0; k < 7; k++) {
      const a = k / 6 * Math.PI * 2;
      const tube = new THREE.Mesh(new THREE.CircleGeometry(0.035, 8), black);
      tube.position.set(s * 1.95 + (k ? Math.cos(a) * 0.08 : 0), -0.52 + (k ? Math.sin(a) * 0.08 : 0), 0.9 + 0.001);
      g.add(tube);
    }
    // Missile rail with two rounds.
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 1.0), dark);
    rail.position.set(s * 1.3, -0.42, 0.2);
    g.add(rail);
    for (const k of [0, 1]) {
      const m = makeMissile();
      m.scale.setScalar(0.85);
      m.position.set(s * (1.17 + k * 0.26), -0.55, 0.25);
      g.add(m);
      missiles.push(m);
    }
  }
  // Chin turret and cannon.
  const turret = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), dark);
  turret.position.set(0, -0.55, 2.05);
  g.add(turret);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.75, 8), black);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.6, 2.4);
  g.add(barrel);
  // Nose sensor turret.
  const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), dark);
  sensor.position.set(0, -0.3, 2.85);
  g.add(sensor);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), glassMat());
  lens.position.set(0, -0.3, 2.98);
  g.add(lens);
  // Undercarriage: main wheels on trailing struts, tail wheel.
  for (const s of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6), dark);
    strut.position.set(s * 0.68, -0.8, 0.9);
    strut.rotation.z = s * 0.35;
    g.add(strut);
    const w = wheel(0.2, 0.12);
    w.position.set(s * 0.82, -1.12, 0.85);
    g.add(w);
  }
  const tw = wheel(0.12, 0.08);
  tw.position.set(0, -0.12, -4.9);
  g.add(tw);
  // Tail: swept fin, stabiliser, tail rotor on the left side.
  const fin = new THREE.Mesh(plate([[0, 0], [0.55, 0], [0.15, 1.45], [-0.25, 1.45]], 0.07, 0.02), hull);
  fin.rotation.y = -Math.PI / 2;
  fin.position.set(0, 0.45, -5.35);
  g.add(fin);
  const stab = new THREE.Mesh(plate([[-0.95, 0], [0.95, 0], [0.8, -0.45], [-0.8, -0.45]], 0.05, 0.015), hull);
  stab.rotation.x = Math.PI / 2;
  stab.position.set(0, 0.5, -4.95);
  g.add(stab);
  const beacon = navLight(0xff3020, 0.045);
  beacon.position.set(-0.05, 1.92, -5.65);
  g.add(beacon);

  // Main rotor: mast, hub, swashplate and four tapered blades, plus a blur disc for speed.
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.15, 0.1);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.45, 10), dark);
  mast.position.y = -0.2;
  rotor.add(mast);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.16, 12), dark);
  rotor.add(hub);
  const blades = [];
  for (let k = 0; k < 4; k++) {
    const arm = new THREE.Group();
    arm.rotation.y = k * Math.PI / 2;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.5), dark);
    grip.position.z = 0.35;
    arm.add(grip);
    const blade = new THREE.Mesh(plate([[-0.09, 0], [0.13, 0], [0.12, 4.3], [-0.05, 4.4]], 0.035, 0), black);
    blade.rotation.x = Math.PI / 2;
    blade.rotation.y = 0.06;
    blade.position.set(0, 0, 0.5);
    arm.add(blade);
    rotor.add(arm);
    blades.push(arm);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), dark);
  dome.scale.y = 0.6; dome.position.y = 0.12;
  rotor.add(dome);
  const disc = new THREE.Mesh(new THREE.RingGeometry(0.4, 4.9, 48),
    new THREE.MeshBasicMaterial({ color: 0x80848a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2;
  rotor.add(disc);
  g.add(rotor);
  const tail = new THREE.Group();
  tail.position.set(-0.12, 1.25, -5.45);
  for (let k = 0; k < 4; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.75, 0.12), black);
    b.position.y = 0.38;
    const a = new THREE.Group();
    a.rotation.x = k * Math.PI / 2;
    a.add(b);
    tail.add(a);
  }
  const tailHub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8), dark);
  tailHub.rotation.z = Math.PI / 2;
  tail.add(tailHub);
  g.add(tail);
  g.userData = { rotor, tail, disc, blades, missiles, beacon, spin: 0 };
  return g;
}

function spinRotor(heli, speed, dt) {
  const u = heli.userData;
  u.spin += speed * dt;
  u.rotor.rotation.y = u.spin;
  u.tail.rotation.x = u.spin * 2.3;
  u.disc.material.opacity = clamp01((speed - 6) / 20) * 0.16;
  u.blades.forEach((b) => { b.visible = speed < 30; });
  u.beacon.visible = Math.sin(u.spin * 0.35) > 0.6 || speed === 0;
}

/** A missile: ogive nose, seeker window, body bands, cruciform fins. +z forward. */
function makeMissile() {
  const g = new THREE.Group();
  const white = metal(0xd8d8d0, 0.38, 0.25);
  const prof = [[0, -0.66], [0.07, -0.66], [0.085, -0.6], [0.085, 0.45], [0.075, 0.62], [0.05, 0.76], [0.02, 0.84], [0, 0.86]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 14), white);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const seeker = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), glassMat());
  seeker.position.z = 0.85;
  g.add(seeker);
  for (const z of [0.42, -0.2]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.088, 0.05, 14), metal(z > 0 ? 0xb8a020 : 0x303030, 0.5, 0.2));
    band.rotation.x = Math.PI / 2;
    band.position.z = z;
    g.add(band);
  }
  const finMat = metal(0x8a8a80, 0.5, 0.4);
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(plate([[0, 0], [0.32, 0], [0.32, 0.12], [0.12, 0.22]], 0.015, 0), finMat);
    const a = new THREE.Group();
    a.rotation.z = k * Math.PI / 2 + Math.PI / 4;
    f.rotation.y = -Math.PI / 2;
    f.position.set(0, 0.06, -0.62);
    a.add(f);
    g.add(a);
    const cf = new THREE.Mesh(plate([[0, 0], [0.12, 0], [0.12, 0.06], [0.05, 0.08]], 0.012, 0), finMat);
    const b = new THREE.Group();
    b.rotation.z = k * Math.PI / 2 + Math.PI / 4;
    cf.rotation.y = -Math.PI / 2;
    cf.position.set(0, 0.07, 0.45);
    b.add(cf);
    g.add(b);
  }
  return g;
}

/** A twin-finned air-superiority jet parked on the apron. +z forward. */
function makeJet() {
  const g = new THREE.Group();
  const skin = panelTexture('#8c9298', { cols: 8, rows: 4, repeat: [2, 2] });
  const m = new THREE.MeshStandardMaterial({ color: 0x6a7078, map: skin, roughness: 0.5, metalness: 0.45 });
  const dark = metal(0x25282c, 0.6, 0.4);
  const fus = new THREE.Mesh(loft([
    { z: 7.4, w: 0.04, h: 0.04, y: 0.1, n: 2 },
    { z: 6.6, w: 0.32, h: 0.3, y: 0.05, n: 2.2 },
    { z: 5.2, w: 0.55, h: 0.55, y: 0.05, n: 2.4 },
    { z: 3.6, w: 0.68, h: 0.62, y: 0.1, n: 2.6 },
    { z: 2.4, w: 1.55, h: 0.55, y: 0, n: 4, top: 0.9 },
    { z: -1.5, w: 1.7, h: 0.52, y: 0, n: 4.5, top: 0.85 },
    { z: -4.3, w: 1.45, h: 0.5, y: 0, n: 4 },
    { z: -4.9, w: 1.3, h: 0.46, y: 0, n: 3.6 },
  ], 32), m);
  g.add(fus);
  // Box intakes with dark mouths.
  for (const s of [-1, 1]) {
    const intake = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.85, 2.4), m);
    intake.position.set(s * 1.15, -0.15, 2.1);
    intake.rotation.x = 0.06;
    g.add(intake);
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.7), metal(0x050505, 1, 0));
    mouth.position.set(s * 1.15, -0.12, 3.31);
    g.add(mouth);
    // Exhaust nozzles.
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.9, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.5, metalness: 0.8, side: THREE.DoubleSide }));
    noz.rotation.x = Math.PI / 2;
    noz.position.set(s * 0.55, 0, -5.25);
    g.add(noz);
    const inner = new THREE.Mesh(new THREE.CircleGeometry(0.42, 16), metal(0x0a0806, 1, 0));
    inner.position.set(s * 0.55, 0, -5.0);
    inner.rotation.y = Math.PI;
    g.add(inner);
  }
  // Cropped-delta wings, stabilators and canted twin fins.
  const wing = (s) => {
    const w = new THREE.Mesh(plate([[0, 2.2], [5.4, -1.4], [5.4, -2.3], [0, -2.6]].map(([x, y]) => [x * s, y]), 0.12, 0.03), m);
    w.rotation.x = Math.PI / 2;
    w.position.set(s * 1.3, 0, -0.6);
    g.add(w);
    const tip = navLight(s < 0 ? 0xff2a1a : 0x22ff55, 0.07);
    tip.position.set(s * 6.72, 0, -2.4);
    g.add(tip);
    const st = new THREE.Mesh(plate([[0, 0.4], [2.3, -0.8], [2.3, -1.4], [0, -1.5]].map(([x, y]) => [x * s, y]), 0.08, 0.02), m);
    st.rotation.x = Math.PI / 2;
    st.position.set(s * 1.3, -0.05, -3.8);
    g.add(st);
    const fin = new THREE.Mesh(plate([[0, 0], [1.9, 0], [0.9, 2.3], [0.1, 2.3]], 0.1, 0.02), m);
    fin.rotation.y = -Math.PI / 2;
    fin.rotation.z = 0;
    const holder = new THREE.Group();
    holder.position.set(s * 0.95, 0.35, -4.6);
    holder.rotation.z = -s * 0.2;
    holder.add(fin);
    g.add(holder);
    // Underwing missile and pylon.
    const pyl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 1.4), dark);
    pyl.position.set(s * 3.6, -0.2, -0.9);
    g.add(pyl);
    const msl = makeMissile();
    msl.scale.setScalar(1.4);
    msl.position.set(s * 3.6, -0.45, -0.7);
    g.add(msl);
  };
  wing(-1); wing(1);
  // Bubble canopy with a frame bow.
  const canopy = new THREE.Mesh(loft([
    { z: 5.3, w: 0.1, h: 0.05, y: 0.45, n: 2, bot: 0.1 },
    { z: 4.6, w: 0.42, h: 0.4, y: 0.5, n: 2.3, bot: 0.1 },
    { z: 3.4, w: 0.48, h: 0.5, y: 0.55, n: 2.3, bot: 0.1 },
    { z: 2.4, w: 0.3, h: 0.22, y: 0.55, n: 2.2, bot: 0.1 },
  ], 22), glassMat());
  g.add(canopy);
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.03, 6, 18, Math.PI), dark);
  bow.position.set(0, 0.55, 4.55);
  g.add(bow);
  // Centreline tank.
  const tank = new THREE.Mesh(loft([
    { z: 1.8, w: 0.02, h: 0.02, n: 2 }, { z: 1.2, w: 0.38, h: 0.38, n: 2 },
    { z: -1.4, w: 0.38, h: 0.38, n: 2 }, { z: -2.0, w: 0.05, h: 0.05, n: 2 },
  ], 16), metal(0x7a8086, 0.5, 0.4));
  tank.position.set(0, -0.95, 0);
  g.add(tank);
  // Undercarriage.
  for (const [x, z, h] of [[0, 4.6, 1.0], [-1.2, -0.8, 1.0], [1.2, -0.8, 1.0]]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, h, 8), metal(0x8a8e94, 0.4, 0.8));
    strut.position.set(x, -0.5 - h / 2 + 0.1, z);
    g.add(strut);
    const w = wheel(0.38, 0.22);
    w.position.set(x, -1.12, z);
    g.add(w);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.6, 1.0), m);
    door.position.set(x + (x ? Math.sign(x) * 0.3 : 0.25), -0.8, z);
    g.add(door);
  }
  g.position.y = 1.5;
  return g;
}

const corrugated = canvasTexture(64, 64, (g, w, h) => {
  for (let x = 0; x < w; x++) {
    const v = 130 + 28 * Math.sin(x / w * Math.PI * 8);
    g.fillStyle = `rgb(${v},${v + 4},${v + 10})`;
    g.fillRect(x, 0, 1, h);
  }
  // Streaks of weathering.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(30,25,20,${rand() * 0.15})`;
    g.fillRect(rand() * w, rand() * h * 0.5, 1 + rand() * 2, h * (0.3 + rand() * 0.6));
  }
}, { repeat: [8, 1] });

const doorTex = canvasTexture(128, 128, (g, w, h) => {
  g.fillStyle = '#4a4e54'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 8) { g.fillStyle = x % 16 ? '#3a3e44' : '#565a60'; g.fillRect(x, 0, 4, h); }
  g.fillStyle = '#1a1c1e'; g.fillRect(w / 2 - 1, 0, 2, h);
  g.fillStyle = '#b89a2a';
  for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, h - 10); g.lineTo(x + 8, h - 10); g.lineTo(x + 16, h); g.lineTo(x + 8, h); g.fill(); }
});

/** A Nissen hut: ribbed corrugated half cylinder, brick end walls, sliding doors, door lamp. */
function makeHangar(len = 22, r = 7) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x6f7378, map: corrugated, roughness: 0.55, metalness: 0.55, side: THREE.DoubleSide });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 40, 1, true, 0, Math.PI), skin);
  shell.rotation.z = Math.PI / 2;
  shell.rotation.y = Math.PI / 2;
  g.add(shell);
  const ribMat = metal(0x50545a, 0.5, 0.6);
  for (let k = 0; k <= 6; k++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(r + 0.05, 0.09, 6, 40, Math.PI), ribMat);
    rib.position.z = -len / 2 + k * len / 6;
    g.add(rib);
  }
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2 * r + 0.8, 0.5, len + 0.8), new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.95 }));
  plinth.position.y = 0.05;
  g.add(plinth);
  const wall = new THREE.MeshStandardMaterial({ color: 0x3d4045, map: panelTexture('#5a5d62', { cols: 10, rows: 6 }), roughness: 0.85 });
  for (const s of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.CircleGeometry(r, 40, 0, Math.PI), wall);
    end.position.z = s * len / 2;
    if (s < 0) end.rotation.y = Math.PI;
    g.add(end);
  }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.1, r * 0.75), new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.7, metalness: 0.4 }));
  door.position.set(0, r * 0.375 + 0.3, len / 2 + 0.03);
  g.add(door);
  const track = new THREE.Mesh(new THREE.BoxGeometry(r * 1.5, 0.12, 0.15), metal(0x2a2c30));
  track.position.set(0, r * 0.75 + 0.36, len / 2 + 0.08);
  g.add(track);
  for (const s of [-1, 1]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({ color: 0x3a3418 }));
    win.position.set(s * r * 0.72, r * 0.42, len / 2 + 0.03);
    g.add(win);
  }
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.22, 12, 1, true), metal(0x2a2c30, 0.6, 0.5));
  shade.position.set(r * 0.62, r * 0.88, len / 2 + 0.3);
  g.add(shade);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
  lamp.position.set(r * 0.62, r * 0.84, len / 2 + 0.3);
  g.add(lamp);
  const pl = new THREE.PointLight(0xffe4a8, 25, 14, 1.4);
  pl.position.copy(lamp.position).add(new THREE.Vector3(0, -0.3, 0.6));
  g.add(pl);
  return g;
}

/** A flat-roofed concrete bunker with a row of three lit windows on the roof edge. */
function makeBunker() {
  const g = new THREE.Group();
  const conc = new THREE.MeshStandardMaterial({ color: 0x45484a, map: panelTexture('#6a6d70', { cols: 4, rows: 2, line: 'rgba(0,0,0,0.3)' }), roughness: 0.95 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(9, 3.2, 7), conc);
  body.position.y = 1.6;
  g.add(body);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.5, 7.6), conc);
  roof.position.y = 3.45;
  g.add(roof);
  for (let k = -1; k <= 1; k++) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.6), new THREE.MeshBasicMaterial({ color: 0xd8d2b0 }));
    w.position.set(k * 1.2, 3.75, 1.2);
    g.add(w);
  }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.2), metal(0x222426, 0.8, 0.4));
  door.position.set(2, 1.1, 3.51);
  g.add(door);
  const lamp = new THREE.PointLight(0xfff0c8, 8, 9, 1.5);
  lamp.position.set(2, 2.7, 4.2);
  g.add(lamp);
  return g;
}

/** The watchtower: braced lattice legs, ladder, railed deck, windowed cabin, roof searchlight. */
function makeTower() {
  const g = new THREE.Group();
  const steel = metal(0x4a4d52, 0.6, 0.7);
  const H = 13;
  const legs = [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]];
  for (const [x, z] of legs) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, H, 6), steel);
    leg.position.set(x * 0.85, H / 2, z * 0.85);
    leg.rotation.z = -x * 0.022; leg.rotation.x = z * 0.022;
    g.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.95 }));
    foot.position.set(x * 0.9, 0.15, z * 0.9);
    g.add(foot);
  }
  // X-bracing on every face, every bay, with horizontal girts.
  const bay = 2.4;
  for (let y = 0.6; y + bay <= H + 0.1; y += bay) {
    const half = 1.38 - y * 0.012;
    for (let k = 0; k < 4; k++) {
      const face = new THREE.Group();
      face.rotation.y = k * Math.PI / 2;
      face.position.y = y;
      const diag = Math.hypot(2 * half, bay);
      for (const s of [-1, 1]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(diag, 0.05, 0.05), steel);
        b.position.set(0, bay / 2, half);
        b.rotation.z = s * Math.atan2(bay, 2 * half);
        face.add(b);
      }
      const girt = new THREE.Mesh(new THREE.BoxGeometry(2 * half, 0.07, 0.07), steel);
      girt.position.set(0, 0, half);
      face.add(girt);
      g.add(face);
    }
  }
  // Ladder up one leg.
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, H, 0.04), steel);
    rail.position.set(s * 0.22, H / 2, 1.55);
    g.add(rail);
  }
  for (let y = 0.4; y < H; y += 0.35) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.025, 0.025), steel);
    rung.position.set(0, y, 1.55);
    g.add(rung);
  }
  // Deck with railing.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.2, 4.6), steel);
  deck.position.y = H;
  g.add(deck);
  for (let k = 0; k < 4; k++) {
    const side = new THREE.Group();
    side.rotation.y = k * Math.PI / 2;
    side.position.y = H;
    const top = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.05, 0.05), steel);
    top.position.set(0, 1.0, 2.28);
    side.add(top);
    for (let x = -2.2; x <= 2.21; x += 0.55) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.0, 0.04), steel);
      post.position.set(x, 0.5, 2.28);
      side.add(post);
    }
    g.add(side);
  }
  const cabinMat = new THREE.MeshStandardMaterial({ color: 0x34373b, map: panelTexture('#55585c', { cols: 6, rows: 3 }), roughness: 0.8, metalness: 0.2 });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 3.4), cabinMat);
  cabin.position.y = H + 1.3;
  g.add(cabin);
  // Window band on all four sides, dimly lit, with mullions.
  for (let k = 0; k < 4; k++) {
    const side = new THREE.Group();
    side.rotation.y = k * Math.PI / 2;
    side.position.y = H + 1.6;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 0.8), new THREE.MeshBasicMaterial({ color: 0x2a2614 }));
    pane.position.z = 1.71;
    side.add(pane);
    for (let x = -1.5; x <= 1.51; x += 0.75) {
      const mull = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, 0.04), steel);
      mull.position.set(x, 0, 1.73);
      side.add(mull);
    }
    g.add(side);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.25, 4.0), metal(0x26282b));
  roof.position.y = H + 2.62;
  g.add(roof);
  // Searchlight on a yoke on the roof.
  const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.6, 8), metal(0x222222));
  yoke.position.set(0, H + 3.0, 0.6);
  g.add(yoke);
  const head = new THREE.Group();
  head.position.set(0, H + 3.45, 0.6);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.7, 16), metal(0x222222, 0.5, 0.6));
  lamp.rotation.x = Math.PI / 2;
  head.add(lamp);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 6, 16), metal(0x666a70, 0.3, 0.9));
  rim.position.z = 0.36;
  head.add(rim);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.4, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  glow.position.z = 0.36;
  head.add(glow);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(4.5, 40, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xc8d4ff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.rotation.x = -Math.PI / 2;
  beam.position.z = 20.3;
  head.add(beam);
  const spot = new THREE.SpotLight(0xdfe6ff, 0, 90, 0.11, 0.5, 0.8);
  spot.position.set(0, 0, 0.4);
  head.add(spot);
  const target = new THREE.Object3D();
  target.position.set(0, 0, 30);
  head.add(target);
  spot.target = target;
  g.add(head);
  g.userData = { head, beam, spot, glow };
  return g;
}

/** A military truck: bonneted cab with windscreen, grille and mirrors, and either a ribbed
 *  canvas tilt or a fuel tank on the back. +z forward. */
function makeTruck(kind = 'troop') {
  const g = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({ color: 0x3b4030, map: panelTexture('#6b7058', { cols: 3, rows: 2, line: 'rgba(0,0,0,0.35)' }), roughness: 0.8, metalness: 0.2 });
  const dark = metal(0x161616, 0.8, 0.3);
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 6.6), dark);
  chassis.position.set(0, 0.75, 0);
  g.add(chassis);
  const bonnet = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.85, 1.3), olive);
  bonnet.position.set(0, 1.3, 2.75);
  g.add(bonnet);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.5, 1.5), olive);
  cab.position.set(0, 1.85, 1.45);
  g.add(cab);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.6), glassMat());
  screen.position.set(0, 2.15, 2.21);
  g.add(screen);
  for (const s of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), glassMat());
    side.rotation.y = s * Math.PI / 2;
    side.position.set(s * 1.11, 2.15, 1.5);
    g.add(side);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.22), dark);
    mirror.position.set(s * 1.3, 2.2, 2.15);
    g.add(mirror);
    const guard = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.45, 14, 1, true, 0, Math.PI), olive);
    guard.rotation.z = Math.PI / 2;
    guard.position.set(s * 1.0, 0.55, 2.4);
    g.add(guard);
  }
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.6), new THREE.MeshStandardMaterial({ map: canvasTexture(32, 32, (c, w, h) => {
    c.fillStyle = '#111'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#3a3e30'; for (let x = 1; x < w; x += 4) c.fillRect(x, 0, 2, h);
  }), roughness: 0.9 }));
  grille.position.set(0, 1.3, 3.41);
  g.add(grille);
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.22, 0.2), dark);
  bumper.position.set(0, 0.75, 3.5);
  g.add(bumper);
  for (const x of [-0.75, 0.75]) {
    const hl = new THREE.Mesh(new THREE.CircleGeometry(0.15, 12), new THREE.MeshBasicMaterial({ color: 0xfff6d0 }));
    hl.position.set(x, 1.45, 3.42);
    g.add(hl);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.035, 6, 12), dark);
    rim.position.copy(hl.position);
    g.add(rim);
  }
  if (kind === 'tanker') {
    const tank = new THREE.Mesh(loft([
      { z: 0.6, w: 1.0, h: 0.85, n: 2.6 }, { z: 0.55, w: 1.08, h: 0.92, n: 2.6 },
      { z: -3.1, w: 1.08, h: 0.92, n: 2.6 }, { z: -3.15, w: 1.0, h: 0.85, n: 2.6 },
    ], 24), metal(0x4a5040, 0.5, 0.5));
    tank.position.y = 1.9;
    g.add(tank);
    for (const z of [0, -1.25, -2.5]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.04, 6, 24), dark);
      band.scale.set(1.08, 0.92, 1);
      band.position.set(0, 1.9, z);
      g.add(band);
    }
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.15, 12), dark);
    hatch.position.set(0, 2.85, -1.2);
    g.add(hatch);
  } else {
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.7, 4.0), olive);
    bed.position.set(0, 1.25, -1.2);
    g.add(bed);
    const tarpMat = new THREE.MeshStandardMaterial({ color: 0x4a4a38, roughness: 1, side: THREE.DoubleSide });
    const tarp = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 4.0, 18, 1, false, 0, Math.PI), tarpMat);
    tarp.rotation.z = Math.PI / 2; tarp.rotation.y = Math.PI / 2;
    tarp.position.set(0, 2.2, -1.2);
    tarp.scale.x = 0.7;
    g.add(tarp);
    const sides = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.6, 4.0), tarpMat);
    sides.position.set(0, 1.9, -1.2);
    g.add(sides);
    for (let k = 0; k <= 4; k++) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(1.16, 0.035, 5, 16, Math.PI), dark);
      rib.position.set(0, 2.2, -3.2 + k);
      rib.scale.y = 0.7;
      g.add(rib);
    }
  }
  for (const [x, z] of [[-1.0, 2.4], [1.0, 2.4], [-1.0, -0.9], [1.0, -0.9], [-1.0, -2.3], [1.0, -2.3]]) {
    const w = wheel(0.55, 0.38);
    w.position.set(x, 0.55, z);
    g.add(w);
  }
  return g;
}

// ------------------------------------------------------------------ textures

const fenceTex = canvasTexture(64, 64, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(170,175,180,1)';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(0, h / 2); g.lineTo(w / 2, 0); g.lineTo(w, h / 2); g.lineTo(w / 2, h); g.closePath();
  g.stroke();
}, { repeat: [1400, 52] });

const signTex = canvasTexture(512, 600, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, '#c9d62a'); grd.addColorStop(0.5, '#a9b51c'); grd.addColorStop(1, '#7f8a10');
  g.fillStyle = '#16180c'; g.fillRect(0, 0, w, h);
  g.fillStyle = grd; g.beginPath(); g.roundRect(14, 14, w - 28, h - 28, 26); g.fill();
  // Grime.
  for (let i = 0; i < 2200; i++) { g.fillStyle = `rgba(40,45,0,${rand() * 0.12})`; g.fillRect(rand() * w, rand() * h, 3 + rand() * 9, 2 + rand() * 6); }
  g.fillStyle = '#121208'; g.strokeStyle = '#121208';
  g.font = '900 104px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save(); g.scale(0.92, 1); g.fillText('KEEP OUT', w / 2 / 0.92, h / 2); g.restore();
  const icon = (cx, cy, kind) => {
    g.save(); g.translate(cx, cy); g.lineWidth = 7;
    if (kind === 'diamond' || kind === 'rad') {
      g.beginPath(); g.moveTo(0, -62); g.lineTo(62, 0); g.lineTo(0, 62); g.lineTo(-62, 0); g.closePath(); g.stroke();
    } else { g.beginPath(); g.arc(0, 0, 60, 0, Math.PI * 2); g.stroke(); }
    if (kind === 'rad') {
      for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 32, k * 2.094 - 0.5, k * 2.094 + 0.5); g.closePath(); g.fill(); }
      g.beginPath(); g.arc(0, 0, 7, 0, 7); g.fill();
    } else if (kind === 'diamond') {
      g.beginPath(); g.moveTo(0, -38); g.quadraticCurveTo(26, -6, 12, 28); g.quadraticCurveTo(0, 12, -12, 28); g.quadraticCurveTo(-26, -6, 0, -38); g.fill();
    } else if (kind === 'man') {
      g.beginPath(); g.arc(0, -30, 11, 0, 7); g.fill(); g.fillRect(-10, -18, 20, 30); g.fillRect(-14, 12, 10, 30); g.fillRect(4, 12, 10, 30);
    } else if (kind === 'blast') {
      g.beginPath(); for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; const r = k % 2 ? 16 : 46; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill();
    } else if (kind === 'skull') {
      g.beginPath(); g.arc(0, -8, 26, 0, 7); g.fill(); g.fillRect(-14, 10, 28, 18);
      g.fillStyle = '#a9b51c'; g.beginPath(); g.arc(-10, -10, 7, 0, 7); g.arc(10, -10, 7, 0, 7); g.fill();
    }
    g.restore();
  };
  icon(110, 110, 'man'); icon(256, 110, 'diamond'); icon(402, 110, 'rad');
  icon(110, 490, 'rad'); icon(256, 490, 'blast'); icon(402, 490, 'skull');
});

const cloudTex = canvasTexture(512, 256, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const x = rand() * w, y = rand() * h, r = 20 + rand() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(70,72,95,${0.12 + rand() * 0.12})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
}, { repeat: [2, 1] });

const moonTex = canvasTexture(128, 128, (g) => {
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,240,1)'); grd.addColorStop(0.18, 'rgba(240,238,220,1)');
  grd.addColorStop(0.24, 'rgba(160,160,200,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
});

const fireTex = canvasTexture(64, 64, (g) => {
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,220,1)'); grd.addColorStop(0.3, 'rgba(255,190,60,0.9)');
  grd.addColorStop(0.65, 'rgba(220,70,10,0.5)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
});

const groundTex = noiseTexture(128, 128, [70, 72, 70], 40, [40, 40]);

// ------------------------------------------------------------------ scenes

function nightBase() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060c);
  scene.fog = new THREE.Fog(0x07080f, 40, 180);
  scene.add(new THREE.HemisphereLight(0x4a5070, 0x101010, 0.55));
  const moonLight = new THREE.DirectionalLight(0x9aa4d8, 0.9);
  moonLight.position.set(-40, 60, -80);
  scene.add(moonLight);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x55585a, map: groundTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(70, 50), new THREE.MeshStandardMaterial({ color: 0x6a6c70, roughness: 0.95 }));
  apron.rotation.x = -Math.PI / 2; apron.position.set(0, 0.02, -30);
  scene.add(apron);
  // Sky: clouds and the moon.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: cloudTex, side: THREE.BackSide, fog: false, transparent: true, blending: THREE.AdditiveBlending }));
  scene.add(sky);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  moon.scale.set(60, 60, 1);
  moon.position.set(-60, 120, -300);
  scene.add(moon);
  // Perimeter fence along z = 0 with its sign and strip light.
  const fence = new THREE.Mesh(new THREE.PlaneGeometry(120, 4.5), new THREE.MeshStandardMaterial({ map: fenceTex, alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 }));
  fence.position.set(0, 2.25, 0);
  scene.add(fence);
  for (let x = -60; x <= 60; x += 4) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.6, 6), metal(0x6a6e73));
    post.position.set(x + 2, 2.3, -0.05);
    scene.add(post);
  }
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.76), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.65, color: 0x8a8a7a }));
  sign.position.set(0, 1.75, 0.05);
  scene.add(sign);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.5, 8), new THREE.MeshBasicMaterial({ color: 0xf4f8ff }));
  tube.rotation.z = Math.PI / 2;
  tube.position.set(0, 2.85, 0.25);
  scene.add(tube);
  const tubeLight = new THREE.PointLight(0xe8f0ff, 6, 6, 1.2);
  tubeLight.position.set(0, 2.7, 0.7);
  scene.add(tubeLight);
  // The base.
  const jets = [[-7, -14, 0.4], [9, -19, -0.5], [-18, -22, 0.9]].map(([x, z, r]) => {
    const j = makeJet(); j.position.x = x; j.position.z = z; j.rotation.y = r; scene.add(j); return j;
  });
  const hangars = [[-22, -48], [0, -50], [22, -48], [44, -44]].map(([x, z]) => {
    const h = makeHangar(); h.position.set(x, 0, z); scene.add(h); return h;
  });
  const tower = makeTower();
  tower.position.set(30, 0, -30);
  scene.add(tower);
  const trucks = [[14, -32, 1.2, 'tanker'], [-30, -34, -0.3, 'troop'], [4, -38, 1.6, 'troop']].map(([x, z, r, kind]) => {
    const t = makeTruck(kind); t.position.set(x, 0, z); t.rotation.y = r; scene.add(t); return t;
  });
  for (const [x, z, r] of [[40, -24, -0.5], [-40, -30, 0.3]]) {
    const b = makeBunker(); b.position.set(x, 0, z); b.rotation.y = r; scene.add(b);
  }
  // Fire for the exploding hangar (index 1), pooled sprites.
  const fire = [];
  for (let i = 0; i < 90; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.userData = { born: -1e9, life: 1, vx: 0, vy: 0, vz: 0 };
    scene.add(s);
    fire.push(s);
  }
  const debris = [];
  for (let i = 0; i < 26; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(1 + rand() * 2.5, 0.08, 1 + rand() * 2), metal(0x5c6065, 0.6, 0.5));
    d.visible = false;
    d.userData = { v: new THREE.Vector3(), w: new THREE.Vector3() };
    scene.add(d);
    debris.push(d);
  }
  const blast = new THREE.PointLight(0xffaa55, 0, 140, 1.2);
  blast.position.set(0, 6, -40);
  scene.add(blast);
  return { scene, tube, tubeLight, tower, jets, hangars, trucks, fire, debris, blast, sky };
}

function hangarInterior() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020203);
  scene.fog = new THREE.Fog(0x020203, 20, 70);
  scene.add(new THREE.AmbientLight(0x202024, 0.35));
  const R = 9, L = 36;
  const skin = new THREE.MeshStandardMaterial({ color: 0x5a5d62, map: corrugated, roughness: 0.55, metalness: 0.5, side: THREE.DoubleSide });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(R, R, L, 40, 1, true, 0, Math.PI), skin);
  shell.rotation.z = Math.PI / 2; shell.rotation.y = Math.PI / 2;
  scene.add(shell);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * R, L), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, map: noiseTexture(128, 128, [60, 60, 60], 50, [8, 16]), roughness: 0.7, metalness: 0.3 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // Ceiling strip lights: switched on one after another.
  const strips = [];
  for (let k = 0; k < 8; k++) {
    const z = 14 - k * 4;
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 2.6), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    m.position.set(0, R - 0.25, z);
    scene.add(m);
    const l = new THREE.PointLight(0xf0f4ff, 0, 22, 1.3);
    l.position.set(0, R - 1.2, z);
    scene.add(l);
    strips.push({ m, l });
  }
  // Wall uplights along the floor.
  const uplights = [];
  for (const s of [-1, 1]) for (let k = 0; k < 6; k++) {
    const l = new THREE.SpotLight(0xffe2a0, 0, 10, 0.5, 0.6, 1.4);
    l.position.set(s * (R - 1.2), 0.2, 10 - k * 4.5);
    l.target.position.set(s * R, 5, 10 - k * 4.5);
    scene.add(l, l.target);
    uplights.push(l);
  }
  // The lift: a round pad sunk in a hazard-striped well.
  const stripes = canvasTexture(256, 16, (g, w, h) => {
    for (let x = 0; x < w; x += 16) { g.fillStyle = (x / 16) % 2 ? '#111' : '#d8b414'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 16, 0); g.lineTo(x + 8, h); g.lineTo(x - 8, h); g.fill(); }
  }, { repeat: [6, 1] });
  // Stepped plinth round the well, hazard ring on top, hoses snaking off across the floor.
  for (const [r, h] of [[6.6, 0.18], [5.5, 0.38]]) {
    const step = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.1, h, 56), new THREE.MeshStandardMaterial({ color: 0x2e2f31, map: noiseTexture(64, 64, [70, 70, 70], 40, [6, 1]), roughness: 0.6, metalness: 0.5 }));
    step.position.y = h / 2;
    scene.add(step);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.25, 5.3, 56), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.385;
  scene.add(ring);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.75, metalness: 0.1 });
  for (const [a, len] of [[0.5, 1], [2.2, 0.8], [3.6, 1.1], [5.2, 0.9]]) {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const r = 5.6 + i * 0.6 * len;
      const w = a + Math.sin(i * 1.3 + a) * 0.12;
      pts.push(new THREE.Vector3(Math.cos(w) * r, i === 0 ? 0.3 : 0.1, Math.sin(w) * r));
    }
    const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.11, 8), rubber);
    scene.add(hose);
    const coupling = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 10), metal(0x9a9da2, 0.3, 0.9));
    coupling.position.copy(pts[0]);
    coupling.rotation.z = Math.PI / 2; coupling.rotation.y = -a;
    scene.add(coupling);
  }
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.1, 0.5, 48), metal(0x3a3b3d, 0.4, 0.8));
  pad.position.y = 0.25;
  scene.add(pad);
  const ram = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 12, 20), metal(0x9a9da2, 0.2, 0.95));
  ram.position.y = -6;
  scene.add(ram);
  const heli = makeHeli();
  heli.position.y = 1.85;
  heli.rotation.y = Math.PI;
  scene.add(heli);
  // Rotating amber beacons at the well's rim.
  const beacons = [];
  for (const [x, z] of [[-5.2, 3.5], [5.2, 3.5], [-5.2, -3.5], [5.2, -3.5]]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: 0x553300 }));
    b.position.set(x, 0.4, z);
    scene.add(b);
    const l = new THREE.SpotLight(0xffb020, 0, 26, 0.35, 0.4, 1);
    l.position.copy(b.position);
    scene.add(l, l.target);
    beacons.push({ b, l });
  }
  // Loading arms bringing missiles to the pylons.
  const arms = [-1, 1].map((s) => {
    const arm = new THREE.Group();
    const yellow = metal(0xb89a2a, 0.5, 0.4);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.5), yellow);
    post.position.y = 0.9; arm.add(post);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 1.4), metal(0x2a2a2a, 0.7, 0.4));
    base.position.y = 0.15; arm.add(base);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 0.3), yellow);
    boom.position.set(-s * 1.2, 1.75, 0); arm.add(boom);
    const cradle = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.15, 1.2), yellow);
    cradle.position.set(-s * 2.4, 1.52, 0); arm.add(cradle);
    const m = makeMissile();
    m.scale.setScalar(0.85);
    m.position.set(-s * 2.4, 1.32, 0.05); arm.add(m);
    arm.position.set(s * 6.5, 0, 0.2);
    arm.userData = { s, missile: m };
    scene.add(arm);
    return arm;
  });
  // Cockpit instrument panel (its own close-up set, placed out of the way).
  const panel = new THREE.Group();
  panel.position.set(0, 60, 0);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.4), new THREE.MeshStandardMaterial({ color: 0x3a4048, map: panelTexture('#4a5058', { cols: 7, rows: 4, line: 'rgba(0,0,0,0.6)' }), roughness: 0.75, metalness: 0.25 }));
  panel.add(face);
  // Glare shield across the top.
  const shield = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 7.2, 16, 1, false, 0, Math.PI), metal(0x1a1c1f, 0.9, 0.1));
  shield.rotation.z = Math.PI / 2;
  shield.position.set(0, 2.2, 0.2);
  shield.scale.set(1, 1, 0.8);
  panel.add(shield);
  const bezelMat = metal(0x30343a, 0.35, 0.7);
  const btnMat = metal(0x5a5e64, 0.5, 0.4);
  // Multi-function displays: rounded bezels with push buttons, screens drawn as MFD pages.
  const mfdTex = (kind) => canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#020a04'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3cff70'; g.fillStyle = '#3cff70'; g.lineWidth = 2;
    g.font = 'bold 16px monospace';
    if (kind === 0) {
      // Radar sweep.
      for (let r = 30; r < 130; r += 30) { g.beginPath(); g.arc(w / 2, h - 20, r, Math.PI, 0); g.stroke(); }
      for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(w / 2, h - 20); g.lineTo(w / 2 + Math.sin(k * 0.6) * 130, h - 20 - Math.cos(k * 0.6) * 130); g.stroke(); }
      for (const [x, y] of [[90, 120], [170, 90], [150, 170]]) g.fillRect(x, y, 6, 6);
      g.fillText('RDR  TWS', 12, 22);
    } else if (kind === 1) {
      // Attitude / horizon.
      g.beginPath(); g.moveTo(0, h / 2 + 10); g.lineTo(w, h / 2 - 10); g.stroke();
      for (let k = -2; k <= 2; k++) if (k) { g.beginPath(); g.moveTo(w / 2 - 40, h / 2 - k * 30); g.lineTo(w / 2 + 40, h / 2 - k * 30); g.stroke(); }
      g.beginPath(); g.moveTo(w / 2 - 30, h / 2); g.lineTo(w / 2 - 10, h / 2); g.lineTo(w / 2, h / 2 + 10); g.lineTo(w / 2 + 10, h / 2); g.lineTo(w / 2 + 30, h / 2); g.stroke();
      g.fillText('ALT 0040', 12, 22); g.fillText('SPD 000', 150, 22); g.fillText('HDG 270', 90, h - 12);
    } else {
      // Systems page.
      ['ENG1', 'ENG2', 'HYD', 'FUEL', 'WPN'].forEach((t, i) => {
        g.fillText(t, 14, 40 + i * 42);
        g.strokeRect(80, 26 + i * 42, 150, 18);
        g.fillRect(80, 26 + i * 42, 40 + ((i * 53) % 110), 18);
      });
    }
  });
  const bezel = (w, h, r) => {
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2 + r, -h / 2); sh.lineTo(w / 2 - r, -h / 2); sh.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    sh.lineTo(w / 2, h / 2 - r); sh.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); sh.lineTo(-w / 2 + r, h / 2);
    sh.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); sh.lineTo(-w / 2, -h / 2 + r); sh.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const iw = w - 0.3, ih = h - 0.3, ir = r * 0.7;
    const hole = new THREE.Path();
    hole.moveTo(-iw / 2 + ir, -ih / 2); hole.lineTo(iw / 2 - ir, -ih / 2); hole.quadraticCurveTo(iw / 2, -ih / 2, iw / 2, -ih / 2 + ir);
    hole.lineTo(iw / 2, ih / 2 - ir); hole.quadraticCurveTo(iw / 2, ih / 2, iw / 2 - ir, ih / 2); hole.lineTo(-iw / 2 + ir, ih / 2);
    hole.quadraticCurveTo(-iw / 2, ih / 2, -iw / 2, ih / 2 - ir); hole.lineTo(-iw / 2, -ih / 2 + ir); hole.quadraticCurveTo(-iw / 2, -ih / 2, -iw / 2 + ir, -ih / 2);
    sh.holes.push(hole);
    return new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  };
  const lamps = [];
  const screens = [];
  [[-2.15, 0.1, 1.9, 1.75, 0], [2.15, 0.1, 1.9, 1.75, 1], [0, 0.95, 1.25, 1.05, 2], [0, -0.75, 1.1, 0.9, 0]].forEach(([x, y, w, h, kind]) => {
    const fr = new THREE.Mesh(bezel(w + 0.3, h + 0.3, 0.28), bezelMat);
    fr.position.set(x, y, 0.01);
    panel.add(fr);
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: mfdTex(kind), color: 0x0d0d0d }));
    sc.position.set(x, y, 0.03);
    panel.add(sc);
    screens.push(sc);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.05, metalness: 1, transparent: true, opacity: 0.35 }));
    glass.position.set(x, y, 0.05);
    panel.add(glass);
    if (w > 1.5) {
      for (let k = 0; k < 5; k++) {
        for (const sy of [-1, 1]) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.06), btnMat);
          b.position.set(x - w / 2 + 0.25 + k * (w - 0.5) / 4, y + sy * (h / 2 + 0.06), 0.14);
          panel.add(b);
        }
        for (const sx of [-1, 1]) {
          const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.06), btnMat);
          b.position.set(x + sx * (w / 2 + 0.06), y - h / 2 + 0.25 + k * (h - 0.5) / 4, 0.14);
          panel.add(b);
        }
      }
    }
  });
  // Warning lamp clusters and switch rows, lit in sequence as the systems wake.
  const lampCols = [0xffd23a, 0xff3020, 0x30ff60, 0x40c0ff];
  const addLamp = (x, y, w, h, col) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    l.position.set(x, y, 0.04);
    l.userData = { on: col, at: rand() * 1.8 };
    panel.add(l);
    lamps.push(l);
  };
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) addLamp(-0.95 + c * 0.22 - 0.0, 0.3 - r * 0.2, 0.17, 0.13, lampCols[(r + c) % 2]);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) addLamp(0.73 + c * 0.22, 0.3 - r * 0.2, 0.17, 0.13, lampCols[(r + c + 1) % 2]);
  for (let k = 0; k < 12; k++) addLamp(-3.42 + (k % 2) * 0.15, 1.5 - Math.floor(k / 2) * 0.3, 0.08, 0.08, lampCols[k % 4]);
  for (let k = 0; k < 12; k++) addLamp(3.27 + (k % 2) * 0.15, 1.5 - Math.floor(k / 2) * 0.3, 0.08, 0.08, lampCols[(k + 2) % 4]);
  for (let k = 0; k < 14; k++) addLamp(-1.95 + k * 0.3, -1.75, 0.09, 0.09, lampCols[(k * 3) % 4]);
  // Round gauges with needles.
  for (const [x, y] of [[-3.0, -1.2], [-2.35, -1.2], [-1.7, -1.2], [1.7, -1.2], [2.35, -1.2], [3.0, -1.2]]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.04, 6, 20), bezelMat);
    ring.position.set(x, y, 0.05);
    panel.add(ring);
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.22, 20), new THREE.MeshBasicMaterial({ color: 0x0a0c0e }));
    dial.position.set(x, y, 0.04);
    panel.add(dial);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.01), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    needle.geometry.translate(0, 0.08, 0);
    needle.position.set(x, y, 0.06);
    needle.rotation.z = rand() * 4 - 2;
    panel.add(needle);
  }
  // Toggle switches.
  for (let k = 0; k < 8; k++) {
    const sw = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.14, 6), btnMat);
    sw.rotation.x = Math.PI / 2 - 0.4;
    sw.position.set(-1.05 + k * 0.3, -1.45, 0.08);
    panel.add(sw);
  }
  const panelLight = new THREE.PointLight(0x99aabb, 3, 10, 1);
  panelLight.position.set(0, 0, 3);
  panel.add(panelLight);
  scene.add(panel);
  return { scene, strips, uplights, heli, pad, ram, beacons, arms, panel, lamps, screens };
}

function duskFlight() {
  const scene = new THREE.Scene();
  const sky = new THREE.Color(0x3a3f3a);
  scene.background = sky;
  scene.fog = new THREE.FogExp2(0x3c4038, 0.0085);
  scene.add(new THREE.HemisphereLight(0x9aa090, 0x2a3020, 1.5));
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.6);
  sun.position.set(40, 45, 90);
  scene.add(sun);
  const N = 160, S = 900;
  const geo = new THREE.PlaneGeometry(S, S, N, N);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = Math.sin(x * 0.018) * Math.cos(z * 0.015) * 14 + Math.sin(x * 0.051 + z * 0.037) * 5 + Math.sin(z * 0.09) * 1.5;
    pos.setY(i, h - 12);
    const c = new THREE.Color().setHSL(0.22 + h * 0.002, 0.35, 0.16 + h * 0.006 + rand() * 0.03);
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  scene.add(land);
  const heli = makeHeli();
  scene.add(heli);
  const missiles = [0, 1].map(() => {
    const m = makeMissile();
    m.visible = false;
    const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.scale.set(1.6, 1.6, 1); flame.position.z = -0.9;
    m.add(flame);
    scene.add(m);
    return m;
  });
  const flashes = [0, 1].map(() => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.scale.set(2.2, 2.2, 1);
    heli.add(s);
    return s;
  });
  return { scene, heli, missiles, flashes };
}

function logoScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const tex = canvasTexture(1024, 400, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.save();
    g.translate(60, 300);
    g.transform(1, 0, -0.32, 1, 0, 0);
    g.font = '900 250px "Arial Black", Impact, sans-serif';
    const chrome = g.createLinearGradient(0, -230, 0, 10);
    chrome.addColorStop(0, '#ffffff'); chrome.addColorStop(0.3, '#c9d3e0'); chrome.addColorStop(0.48, '#5b6878');
    chrome.addColorStop(0.52, '#1e2732'); chrome.addColorStop(0.7, '#8c9cb0'); chrome.addColorStop(1, '#e8eef6');
    g.lineJoin = 'round';
    g.lineWidth = 18; g.strokeStyle = '#0a0d12'; g.strokeText('SWIV', 0, 0);
    g.lineWidth = 6; g.strokeStyle = '#9fb4cc'; g.strokeText('SWIV', 0, 0);
    g.fillStyle = chrome; g.fillText('SWIV', 0, 0);
    // Highlight streaks through the letters.
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(-40, -150, 900, 10);
    g.fillRect(-40, -105, 900, 4);
    g.restore();
    // The "3D" gunsight.
    const cx = 900, cy = 250;
    g.strokeStyle = '#c8d2de'; g.lineWidth = 7;
    g.beginPath(); g.arc(cx, cy, 58, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 5;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { g.beginPath(); g.moveTo(cx + dx * 46, cy + dy * 46); g.lineTo(cx + dx * 84, cy + dy * 84); g.stroke(); }
    g.font = '900 52px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#e8eef6'; g.fillText('3D', cx, cy + 3);
  });
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(10.24, 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  scene.add(logo);
  // A sheen sweeping across.
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
  sheen.rotation.z = -0.4;
  sheen.position.z = 0.05;
  scene.add(sheen);
  return { scene, logo, sheen };
}

// ------------------------------------------------------------------ audio

function introAudio(ctx, sounds, master) {
  const out = ctx.createGain();
  out.gain.value = 1;
  out.connect(master);
  const started = [];
  const play = (id, { at = 0, volume = 1, rate = 1, loop = false } = {}) => {
    const buf = sounds.get(id);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = loop; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = volume;
    src.connect(g).connect(out);
    src.start(ctx.currentTime + Math.max(0, at));
    started.push(src);
    return { src, g };
  };
  // Fluorescent hum.
  const hum = ctx.createOscillator(); hum.type = 'square'; hum.frequency.value = 100;
  const humGain = ctx.createGain(); humGain.gain.value = 0;
  const humLp = ctx.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 600;
  hum.connect(humLp).connect(humGain).connect(out); hum.start(); started.push(hum);
  const t0 = ctx.currentTime;
  const at = (s) => t0 + s;
  humGain.gain.setValueAtTime(0.035, at(0));
  humGain.gain.linearRampToValueAtTime(0, at(6.5));
  // Cues (effect ids from SOUNDS.BD).
  for (let k = 0; k < 8; k++) play(6004, { at: 13.3 + k * 0.32, volume: 0.6, rate: 0.7 }); // strip lights clunk on
  for (let k = 0; k < 6; k++) play(6002, { at: 16.8 + k * 0.28, volume: 0.35, rate: 1.4 }); // cockpit beeps
  play(4000, { at: 19.4, volume: 0.6 }); // loading arms
  const rotor = play(5000, { at: 22.4, volume: 0, loop: true, rate: 0.6 });
  if (rotor) {
    rotor.g.gain.setValueAtTime(0, at(22.4));
    rotor.g.gain.linearRampToValueAtTime(0.45, at(25));
    rotor.src.playbackRate.linearRampToValueAtTime(1.0, at(25));
    rotor.g.gain.setValueAtTime(0, at(25.05));
    rotor.g.gain.setValueAtTime(0.5, at(28.2));
    rotor.g.gain.setValueAtTime(0.5, at(40.2));
    rotor.g.gain.linearRampToValueAtTime(0, at(40.4));
  }
  play(1001, { at: 26.5, volume: 1 });
  play(1003, { at: 26.7, volume: 0.8, rate: 0.8 });
  play(1000, { at: 27.4, volume: 0.6 });
  play(2001, { at: 38.0, volume: 0.9 });
  play(2001, { at: 38.25, volume: 0.9, rate: 1.06 });
  play(1001, { at: 40.25, volume: 1 });
  return {
    stop() {
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => { for (const s of started) { try { s.stop(); } catch { /* not started */ } } out.disconnect(); }, 400);
    },
  };
}

// ------------------------------------------------------------------ player

/**
 * Play the intro over the page. Resolves when it ends or is skipped (any key, click or tap).
 * `audio` is { ctx, sounds: Map(effect id -> AudioBuffer), master: GainNode } or null.
 */
export function playIntro(audio) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.id = 'intro';
    const canvas = document.createElement('canvas');
    const flash = document.createElement('div');
    flash.className = 'intro-flash';
    const skip = document.createElement('div');
    skip.className = 'intro-skip';
    skip.textContent = 'Press any key to skip';
    wrap.append(canvas, flash, skip);
    document.body.append(wrap);

    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch (e) {
      console.warn('intro: no WebGL', e);
      wrap.remove();
      resolve();
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1200);
    const resize = () => {
      renderer.setSize(innerWidth, innerHeight, false);
      cam.aspect = innerWidth / innerHeight;
      cam.updateProjectionMatrix();
    };
    resize();
    addEventListener('resize', resize);

    const base = nightBase();
    const hangar = hangarInterior();
    const dusk = duskFlight();
    const logo = logoScene();
    // Soft reflection environments so the metal and glass pick up their surroundings.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envFrom = (top, mid, bottom, panels = []) => {
      const s = new THREE.Scene();
      const geo = new THREE.SphereGeometry(10, 32, 16);
      const col = [];
      const p = geo.attributes.position;
      const c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) / 10;
        if (y > 0) c.copy(mid).lerp(top, y); else c.copy(mid).lerp(bottom, -y);
        col.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      for (const [x, y, z, w, h, k] of panels) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
        m.position.set(x, y, z); m.lookAt(0, 0, 0);
        s.add(m);
      }
      return pmrem.fromScene(s, 0.04).texture;
    };
    const C = (h) => new THREE.Color(h);
    base.scene.environment = envFrom(C(0x2a3050), C(0x141826), C(0x0a0a0a), [[-4, 6, -8, 3, 3, 1.2]]);
    base.scene.environmentIntensity = 0.6;
    hangar.scene.environment = envFrom(C(0x30302c), C(0x15140f), C(0x080808), [[0, 9, 0, 2, 12, 3], [-9, -1, 0, 1, 14, 1.2], [9, -1, 0, 1, 14, 1.2]]);
    hangar.scene.environmentIntensity = 0.7;
    dusk.scene.environment = envFrom(C(0x5a6070), C(0xc0a070), C(0x2a3020), [[6, 3, 9, 6, 2, 2]]);
    dusk.scene.environmentIntensity = 0.8;
    pmrem.dispose();
    const sound = audio ? introAudio(audio.ctx, audio.sounds, audio.master) : null;

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      sound?.stop();
      removeEventListener('resize', resize);
      removeEventListener('keydown', onKey, true);
      wrap.removeEventListener('pointerdown', onKey);
      wrap.classList.add('fade');
      setTimeout(() => {
        renderer.dispose();
        renderer.forceContextLoss?.();
        wrap.remove();
        resolve();
      }, 450);
    };
    const onKey = (e) => { e.preventDefault?.(); e.stopPropagation?.(); finish(); };
    // Ignore the key that started us.
    setTimeout(() => {
      addEventListener('keydown', onKey, true);
      wrap.addEventListener('pointerdown', onKey);
    }, 300);

    const look = (p, t) => { cam.position.set(...p); cam.lookAt(...t); };
    const offset = +(new URLSearchParams(location.search).get('introAt') ?? 0);
    const start = performance.now() - offset * 1000;
    let last = start;

    function frame(now) {
      if (done) return;
      const t = (now - start) / 1000;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let scene;
      let white = 0;

      if (t < 13) {
        // 1 + 2: the fence, then over it onto the base.
        scene = base.scene;
        const flick = t < 6.5 ? (Math.sin(t * 43) > 0.93 || (t > 2.2 && t < 2.45) || (t > 4.1 && t < 4.2) ? 0.15 : 1) : 1;
        base.tubeLight.intensity = 6 * flick;
        base.tube.material.color.setScalar(flick > 0.5 ? 1 : 0.2);
        if (t < 6.5) {
          const k = smooth(t / 6.5);
          cam.fov = 42;
          look([lerp(-1.6, 1.4, k), 1.75, lerp(3.4, 2.6, k)], [lerp(-0.2, 0.5, k), 1.7, -2]);
        } else {
          const k = smooth((t - 6.5) / 6.5);
          cam.fov = 50;
          look([lerp(-12, 6, k), lerp(2.2, 7, k), lerp(1, -8, k)], [lerp(-4, 18, k), 2, -36]);
        }
        const tw = base.tower.userData;
        const on = t > 9.2 ? 1 : 0;
        tw.beam.material.opacity = on * 0.09;
        tw.spot.intensity = on * 900;
        tw.glow.material.color.setScalar(on ? 1 : 0.15);
        tw.head.rotation.set(0.32, -2.4 + Math.sin((t - 9.2) * 0.7) * 0.6, 0);
        base.trucks[2].position.x = 4 + Math.max(0, t - 9) * 2.2;
        base.sky.rotation.y = t * 0.004;
      } else if (t < 25) {
        // 3: inside the hangar.
        scene = hangar.scene;
        const h = hangar;
        h.strips.forEach((s, k) => {
          const on = t > 13.3 + k * 0.32 ? 1 : 0;
          s.l.intensity = on * 30;
          s.m.material.color.setScalar(on ? 1 : 0.07);
        });
        h.uplights.forEach((l, k) => { l.intensity = t > 14.5 + k * 0.08 ? 40 : 0; });
        const rise = smooth(span(t, 22.4, 25)) * 9;
        h.pad.position.y = 0.25 + rise;
        h.heli.position.y = 1.85 + rise;
        h.ram.position.y = -6 + rise;
        spinRotor(h.heli, lerp(0, 22, span(t, 22, 25)), dt);
        h.beacons.forEach((b, k) => {
          const on = t > 19 ? 1 : 0;
          b.b.material.color.set(on ? 0xffb020 : 0x332200);
          b.l.intensity = on * 120;
          const a = t * 4 + k;
          b.l.target.position.set(b.b.position.x + Math.cos(a) * 5, 0.4, b.b.position.z + Math.sin(a) * 5);
        });
        h.arms.forEach((arm) => {
          const s = arm.userData.s;
          const k = smooth(span(t, 19.4, 21.6));
          arm.position.x = s * lerp(6.5, 3.6, k);
          arm.userData.missile.visible = t < 21.7;
          const back = smooth(span(t, 21.8, 22.6));
          if (back > 0) arm.position.x = s * lerp(3.6, 6.5, back);
        });
        h.heli.userData.missiles.forEach((m) => { m.visible = t > 21.6; });
        if (t < 16.5) {
          const k = smooth((t - 13) / 3.5);
          cam.fov = 55;
          look([0, lerp(2, 3, k), lerp(17, 12, k)], [0, 3.2, 0]);
        } else if (t < 19) {
          // Cockpit panel close-up: lamps and screens come alive.
          const k = (t - 16.5) / 2.5;
          cam.fov = 45;
          look([lerp(-0.8, 0.6, k), 60 + lerp(0.4, -0.2, k), 5.4 - k * 0.6], [0, 60, 0]);
          h.lamps.forEach((l) => l.material.color.set(k * 1.8 > l.userData.at ? l.userData.on : 0x111111));
          h.screens.forEach((sc, i) => sc.material.color.setScalar(k > 0.3 + i * 0.12 ? 0.85 + 0.1 * Math.sin(t * 20 + i) : 0.05));
        } else if (t < 22.4) {
          const k = smooth((t - 19) / 3.4);
          cam.fov = 50;
          look([lerp(9, 6, k), lerp(1, 1.6, k), lerp(5, 3, k)], [0, 1.8, 0]);
        } else {
          const k = smooth((t - 22.4) / 2.6);
          cam.fov = 60;
          look([6.5, lerp(2.5, 6, k), 7.5], [0, lerp(2.5, 9, k), 0]);
        }
      } else if (t < 30.5) {
        // 4: the hangar goes up and the gunship climbs out of the fire.
        scene = base.scene;
        const T = t - 25;
        const target = base.hangars[1];
        cam.fov = 50;
        look([7 + T * 0.3, 2.2 + T * 0.25, -22], [0, 4 + T * 0.6, -50]);
        base.tubeLight.intensity = 6;
        const boom = 1.5;
        if (T >= boom) {
          target.visible = false;
          white = Math.max(0, 1 - (T - boom) / 0.6);
          base.blast.position.set(0, 5, -48);
          base.blast.intensity = Math.max(0, 260 * (1 - (T - boom) / 4)) + 60 * Math.max(0, 1 - (T - boom) / 9) * (0.8 + 0.2 * Math.sin(T * 30));
          if (!base.exploded) {
            base.exploded = true;
            base.debris.forEach((d) => {
              d.visible = true;
              d.position.set((rand() - 0.5) * 12, 3 + rand() * 4, -50 + (rand() - 0.5) * 18);
              d.userData.v.set((rand() - 0.5) * 30, 12 + rand() * 18, (rand() - 0.3) * 24);
              d.userData.w.set(rand() * 8, rand() * 8, rand() * 8);
            });
          }
          base.debris.forEach((d) => {
            d.userData.v.y -= 22 * dt;
            d.position.addScaledVector(d.userData.v, dt);
            if (d.position.y < 0.1) { d.position.y = 0.1; d.userData.v.multiplyScalar(0.3); }
            d.rotation.x += d.userData.w.x * dt; d.rotation.y += d.userData.w.y * dt;
          });
          // Billowing fire.
          for (const f of base.fire) {
            const u = f.userData;
            if (now / 1000 - u.born > u.life) {
              u.born = now / 1000; u.life = 0.8 + rand() * 1.4;
              f.position.set((rand() - 0.5) * 14, 1 + rand() * 4, -50 + (rand() - 0.5) * 16);
              u.vx = (rand() - 0.5) * 3; u.vy = 3 + rand() * 6; u.vz = (rand() - 0.5) * 3;
            }
            const a = (now / 1000 - u.born) / u.life;
            const fade = Math.max(0, 1 - (T - boom) / 9);
            f.material.opacity = Math.sin(a * Math.PI) * fade;
            const sz = 3 + a * 7;
            f.scale.set(sz, sz, 1);
            f.position.x += u.vx * dt; f.position.y += u.vy * dt; f.position.z += u.vz * dt;
          }
        }
        // The gunship (reuses the dusk model) bursting out towards the camera.
        if (!base.heli) {
          base.heli = makeHeli();
          base.scene.add(base.heli);
        }
        const k = span(T, 3, 5.5);
        base.heli.visible = T > 3;
        base.heli.position.set(lerp(0, 4, k), lerp(4, 14, k), lerp(-46, -30, smooth(k)));
        base.heli.rotation.set(-0.25, 0.35, 0);
        spinRotor(base.heli, 40, dt);
      } else if (t < 40.5) {
        // 5: dusk run.
        scene = dusk.scene;
        const H = dusk.heli;
        spinRotor(H, 40, dt);
        const T = t - 30.5;
        if (T < 4) {
          // Fly-by past the camera.
          const k = T / 4;
          H.position.set(lerp(-40, 30, k), 6 + Math.sin(k * 3) * 1.5, lerp(-10, 6, k));
          H.rotation.set(0.15, Math.PI / 2 - 0.25, -0.35);
          cam.fov = 48;
          look([0, 5, 14], [H.position.x * 0.8, H.position.y, H.position.z]);
        } else {
          // Far ahead, swinging round to face the camera and closing in.
          const k = smooth(span(T, 4, 8.2));
          const d = lerp(120, 15, k);
          H.position.set(Math.sin((1 - k) * 2) * 30 * (1 - k), 8 + (1 - k) * 4, -d);
          H.rotation.set(0.12, lerp(Math.PI / 2 + 1, 0, smooth(span(T, 4, 7))), lerp(0.4, 0, k));
          H.lookAt(H.position.x, H.position.y - 1.5, 30);
          cam.fov = 46;
          look([0, 7, 10], [H.position.x * 0.5, 7.5, -40]);
          // Fire: two missiles straight at the lens, guns flashing.
          const F = T - 7.5;
          dusk.missiles.forEach((m, i) => {
            if (F < 0) { m.visible = false; return; }
            const f = Math.max(0, F - i * 0.25);
            m.visible = f > 0;
            const s = (i ? 1 : -1) * 1.5;
            m.position.set(H.position.x + s * (1 - f * 0.6), H.position.y - 0.5 + f * 1.2, H.position.z + f * f * 30 + f * 8);
            m.lookAt(0, 7, 12);
          });
          dusk.flashes.forEach((fl, i) => {
            fl.position.set(i ? 0.25 : -0.25, -0.65, 2.4);
            fl.material.opacity = F > 0 && Math.sin(t * 60 + i * 2) > 0.2 ? 1 : 0;
          });
          if (t > 40.2) white = span(t, 40.2, 40.5);
        }
      } else {
        // 6: white-out, then the logo.
        scene = logo.scene;
        const T = t - 40.5;
        white = Math.max(0, 1 - T / 1.4);
        cam.fov = 40;
        look([0, 0, lerp(13, 11, smooth(T / 6))], [0, 0, 0]);
        logo.logo.material.opacity = 1;
        const s = span(T, 1.8, 3.2);
        logo.sheen.material.opacity = 0;
        logo.logo.scale.setScalar(1 + 0.04 * smooth(T / 6));
        logo.sheen.position.x = lerp(-7, 7, s);
        if (t > LENGTH) finish();
      }
      cam.updateProjectionMatrix();
      flash.style.opacity = white;
      renderer.render(scene, cam);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
