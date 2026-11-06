// The opening cinematic, rebuilt in real time with three.js after the original's pre-rendered
// INTRO1/INTRO2 Smacker videos (same storyboard, procedural models, no video data used):
//   1. a KEEP OUT sign on the perimeter fence at night, under a flickering strip light
//   2. the air base behind it: jets, Nissen hangars, trucks, a watchtower and its searchlight
//   3. inside a hangar: strip lights come on, the cockpit wakes, missiles are loaded and the
//      gunship rises on its lift
//   4. outside, the hangar blows apart and the gunship climbs out of the fireball
//   5. dusk: it skims the hills, swings round to face the camera and fires
//   6. white-out, then the chrome SWIV 3D logo
// Sound comes from the game's own effects (SOUNDS.BD) plus a synthesised drone.
import * as THREE from './vendor/three.module.min.js';

const LENGTH = 48; // seconds

const rand = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const span = (t, a, b) => clamp01((t - a) / (b - a));

function canvasTexture(w, h, draw, { repeat = null, srgb = true } = {}) {
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

const metal = (c, rough = 0.55, met = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: met });

/** The gunship: slim armoured body, stepped canopy, stub wings with missile pylons. */
function makeHeli() {
  const g = new THREE.Group();
  const hull = metal(0x5d6268, 0.5, 0.25);
  const dark = metal(0x2a2c30, 0.6, 0.2);
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), hull);
  body.scale.set(0.85, 0.8, 2.4);
  g.add(body);
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0b1420, roughness: 0.08, metalness: 0.9 }));
  canopy.scale.set(1, 0.9, 1.9);
  canopy.position.set(0, 0.35, 0.9);
  g.add(canopy);
  const chin = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 10), dark);
  chin.rotation.x = Math.PI / 2;
  chin.position.set(0, -0.62, 2.1);
  g.add(chin);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.42, 4.2, 12), hull);
  boom.rotation.x = Math.PI / 2;
  boom.position.set(0, 0.1, -3.6);
  g.add(boom);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.4, 0.8), hull);
  fin.position.set(0, 0.7, -5.5);
  fin.rotation.x = -0.35;
  g.add(fin);
  const stab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.07, 0.5), hull);
  stab.position.set(0, 0.15, -5.1);
  g.add(stab);
  const missiles = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.8), dark);
    wing.position.set(s * 1.4, -0.15, 0.1);
    wing.rotation.z = s * -0.12;
    g.add(wing);
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.3, 10), dark);
    pod.rotation.x = Math.PI / 2;
    pod.position.set(s * 1.65, -0.4, 0.15);
    g.add(pod);
    for (const k of [0, 1]) {
      const m = makeMissile();
      m.position.set(s * (1.2 + k * 0.55), -0.45, 0.2);
      g.add(m);
      missiles.push(m);
    }
    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.6, 12), hull);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(s * 0.62, 0.55, -0.4);
    g.add(engine);
  }
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.05, 0);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.35, 12), dark);
  rotor.add(hub);
  for (let k = 0; k < 4; k++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 4.6), dark);
    blade.position.z = 2.3;
    const arm = new THREE.Group();
    arm.rotation.y = k * Math.PI / 2;
    arm.add(blade);
    rotor.add(arm);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(4.6, 48),
    new THREE.MeshBasicMaterial({ color: 0x80848a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2;
  rotor.add(disc);
  g.add(rotor);
  const tail = new THREE.Group();
  tail.position.set(0.12, 0.9, -5.6);
  for (let k = 0; k < 2; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.4, 0.14), dark);
    b.rotation.x = k * Math.PI / 2;
    tail.add(b);
  }
  g.add(tail);
  g.userData = { rotor, tail, disc, missiles, spin: 0 };
  return g;
}

function spinRotor(heli, speed, dt) {
  const u = heli.userData;
  u.spin += speed * dt;
  u.rotor.rotation.y = u.spin;
  u.tail.rotation.x = u.spin * 2.3;
  u.disc.material.opacity = clamp01((speed - 6) / 20) * 0.16;
  u.rotor.children.forEach((c, i) => { if (i > 0 && i < 5) c.visible = speed < 30; });
}

function makeMissile() {
  const g = new THREE.Group();
  const white = metal(0xd8d8d0, 0.4, 0.2);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.3, 10), white);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 10), white);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 0.8;
  g.add(nose);
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.28, 0.25), metal(0x8a8a80));
    f.position.z = -0.55;
    f.rotation.z = k * Math.PI / 2;
    f.translateY(0.12);
    g.add(f);
  }
  return g;
}

function makeJet() {
  const g = new THREE.Group();
  const m = metal(0x6a6e74, 0.55, 0.25);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 9, 14), m);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 14), m);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 5.8;
  g.add(nose);
  const shape = new THREE.Shape();
  shape.moveTo(0, 2.5); shape.lineTo(5.2, -1.6); shape.lineTo(5.2, -2.4); shape.lineTo(0, -2.2);
  shape.lineTo(-5.2, -2.4); shape.lineTo(-5.2, -1.6); shape.closePath();
  const wing = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false }), m);
  wing.rotation.x = Math.PI / 2;
  wing.position.y = 0.0;
  g.add(wing);
  for (const s of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2, 1.6), m);
    fin.position.set(s * 0.8, 1.1, -3.6);
    fin.rotation.z = s * 0.35;
    g.add(fin);
  }
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.1, metalness: 0.8 }));
  canopy.scale.set(1, 0.8, 2.6);
  canopy.position.set(0, 0.55, 2.8);
  g.add(canopy);
  for (const [x, z] of [[0, 3.5], [-1.5, -1], [1.5, -1]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), metal(0x222222));
    w.position.set(x, -1, z);
    g.add(w);
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
}, { repeat: [8, 1] });

/** A Nissen hut: corrugated half cylinder with flat end walls. */
function makeHangar(len = 22, r = 7) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x6f7378, map: corrugated, roughness: 0.6, metalness: 0.45, side: THREE.DoubleSide });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 32, 1, true, 0, Math.PI), skin);
  shell.rotation.z = Math.PI / 2;
  shell.rotation.y = Math.PI / 2;
  g.add(shell);
  const wall = new THREE.MeshStandardMaterial({ color: 0x3d4045, roughness: 0.8 });
  for (const s of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.CircleGeometry(r, 32, 0, Math.PI), wall);
    end.position.z = s * len / 2;
    if (s < 0) end.rotation.y = Math.PI;
    g.add(end);
  }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.1, r * 0.75), new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.9 }));
  door.position.set(0, r * 0.375, len / 2 + 0.02);
  g.add(door);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
  lamp.position.set(r * 0.62, r * 0.85, len / 2 + 0.2);
  g.add(lamp);
  const pl = new THREE.PointLight(0xffe4a8, 25, 14, 1.4);
  pl.position.copy(lamp.position).add(new THREE.Vector3(0, -0.3, 0.6));
  g.add(pl);
  return g;
}

function makeTower() {
  const g = new THREE.Group();
  const steel = metal(0x4a4d52, 0.6, 0.7);
  const H = 13;
  for (const [x, z] of [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, H, 6), steel);
    leg.position.set(x * 0.85, H / 2, z * 0.85);
    leg.rotation.z = -x * 0.022; leg.rotation.x = z * 0.022;
    g.add(leg);
  }
  for (let y = 1.5; y < H; y += 2.4) {
    for (let k = 0; k < 4; k++) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(3.3, 0.06, 0.06), steel);
      brace.position.y = y;
      brace.rotation.y = k * Math.PI / 2;
      brace.translateZ(1.4);
      brace.rotation.z = (k % 2 ? 1 : -1) * 0.55;
      g.add(brace);
    }
  }
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.4, 3.6), metal(0x34373b, 0.8, 0.2));
  cabin.position.y = H + 1.2;
  g.add(cabin);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.1, 1, 4), metal(0x26282b));
  roof.position.y = H + 2.9;
  roof.rotation.y = Math.PI / 4;
  g.add(roof);
  const win = new THREE.Mesh(new THREE.BoxGeometry(3.65, 0.7, 3.65), new THREE.MeshBasicMaterial({ color: 0x2a2614 }));
  win.position.y = H + 1.5;
  g.add(win);
  // Searchlight head on the cabin's front corner.
  const head = new THREE.Group();
  head.position.set(1.6, H + 1.5, 1.9);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.6, 12), metal(0x222222));
  lamp.rotation.x = Math.PI / 2;
  head.add(lamp);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.36, 16), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  glow.position.z = 0.31;
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

function makeTruck() {
  const g = new THREE.Group();
  const olive = metal(0x3b4030, 0.8, 0.2);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.8, 1.8), olive);
  cab.position.set(0, 1.5, 2.4);
  g.add(cab);
  const tarp = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 4.2, 16, 1, false, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x4a4a38, roughness: 1 }));
  tarp.rotation.z = Math.PI / 2; tarp.rotation.y = Math.PI / 2;
  tarp.position.set(0, 1.9, -0.6);
  g.add(tarp);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.9, 4.3), olive);
  bed.position.set(0, 1.2, -0.6);
  g.add(bed);
  for (const [x, z] of [[-1.1, 2.3], [1.1, 2.3], [-1.1, -0.2], [1.1, -0.2], [-1.1, -1.8], [1.1, -1.8]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12), metal(0x111111, 0.9, 0.1));
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.5, z);
    g.add(w);
  }
  const hl = new THREE.Mesh(new THREE.CircleGeometry(0.16, 10), new THREE.MeshBasicMaterial({ color: 0xfff6d0 }));
  hl.position.set(0.7, 1.1, 3.31);
  g.add(hl);
  const hl2 = hl.clone(); hl2.position.x = -0.7; g.add(hl2);
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
  const trucks = [[14, -32, 1.2], [-30, -34, -0.3], [4, -38, 1.6]].map(([x, z, r]) => {
    const t = makeTruck(); t.position.set(x, 0, z); t.rotation.y = r; scene.add(t); return t;
  });
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
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 4.9, 48), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
  scene.add(ring);
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
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.5), metal(0xb89a2a, 0.5, 0.4));
    post.position.y = 1.2; arm.add(post);
    const boom = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.35, 0.35), metal(0xb89a2a, 0.5, 0.4));
    boom.position.set(-s * 1.2, 2.3, 0); arm.add(boom);
    const m = makeMissile();
    m.position.set(-s * 2.4, 1.95, 0); arm.add(m);
    arm.position.set(s * 6.5, 0, 0.2);
    arm.userData = { s, missile: m };
    scene.add(arm);
    return arm;
  });
  // Cockpit instrument panel (its own close-up set, placed out of the way).
  const panel = new THREE.Group();
  panel.position.set(0, 60, 0);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.7, metalness: 0.2 }));
  panel.add(face);
  const lamps = [];
  const screens = [];
  for (const [x, y, w, h] of [[-1.9, 0.1, 1.6, 1.4], [1.9, 0.1, 1.6, 1.4], [0, 0.9, 1.1, 0.9], [0, -0.6, 1, 0.8]]) {
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.2, h + 0.2), metal(0x3a3e44, 0.4, 0.7));
    frame.position.set(x, y, 0.01); panel.add(frame);
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x050805 }));
    sc.position.set(x, y, 0.02); panel.add(sc);
    screens.push(sc);
  }
  const lampCols = [0xffd23a, 0xff3020, 0x30ff60, 0x40c0ff];
  for (let i = 0; i < 46; i++) {
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.06, 8), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    const x = (rand() - 0.5) * 5.6, y = (rand() - 0.5) * 3.6;
    if (Math.abs(x) < 2.8 && Math.abs(y) < 1.6 && (Math.abs(Math.abs(x) - 1.9) < 0.9 || Math.abs(x) < 0.6)) continue;
    l.position.set(x, y, 0.03);
    l.userData = { on: lampCols[i % 4], at: rand() * 1.8 };
    panel.add(l);
    lamps.push(l);
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
  // Drone: two detuned saws through a slowly opening low-pass.
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 180; lp.Q.value = 6;
  const droneGain = ctx.createGain(); droneGain.gain.value = 0;
  lp.connect(droneGain).connect(out);
  for (const f of [55, 55.4, 82.4]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    o.connect(lp); o.start(); started.push(o);
  }
  // Fluorescent hum.
  const hum = ctx.createOscillator(); hum.type = 'square'; hum.frequency.value = 100;
  const humGain = ctx.createGain(); humGain.gain.value = 0;
  const humLp = ctx.createBiquadFilter(); humLp.type = 'lowpass'; humLp.frequency.value = 600;
  hum.connect(humLp).connect(humGain).connect(out); hum.start(); started.push(hum);
  const t0 = ctx.currentTime;
  const at = (s) => t0 + s;
  droneGain.gain.setValueAtTime(0, at(0));
  droneGain.gain.linearRampToValueAtTime(0.09, at(4));
  droneGain.gain.linearRampToValueAtTime(0.12, at(24));
  lp.frequency.setValueAtTime(160, at(0));
  lp.frequency.linearRampToValueAtTime(420, at(25));
  lp.frequency.linearRampToValueAtTime(900, at(40));
  droneGain.gain.linearRampToValueAtTime(0.16, at(40));
  droneGain.gain.linearRampToValueAtTime(0, at(41));
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
          arm.position.x = s * lerp(6.5, 3.1, k);
          arm.userData.missile.visible = t < 21.7;
          const back = smooth(span(t, 21.8, 22.6));
          if (back > 0) arm.position.x = s * lerp(3.1, 6.5, back);
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
          h.screens.forEach((sc, i) => sc.material.color.setRGB(0.03, k > 0.3 + i * 0.12 ? 0.16 + 0.04 * Math.sin(t * 20 + i) : 0.02, 0.05));
        } else if (t < 22.4) {
          const k = smooth((t - 19) / 3.4);
          cam.fov = 50;
          look([lerp(9, 6, k), lerp(1, 1.6, k), lerp(5, 3, k)], [0, 1.8, 0]);
        } else {
          const k = smooth((t - 22.4) / 2.6);
          cam.fov = 60;
          look([10, lerp(3, 7, k), 13], [0, lerp(2.5, 9, k), 0]);
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
