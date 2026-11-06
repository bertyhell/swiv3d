// The opening cinematic, rebuilt in real time with three.js after the original's pre-rendered
// INTRO1 + INTRO2 Smacker videos. No video frames are used: every shot is modelled and lit
// procedurally, but each one starts and ends on the same video frame as the original (Smacker
// plays them at one frame per 71 ms), so the videos' own soundtrack, extracted by swiv-pack
// into assets/intro.wav, plays in sync and drives the clock.
//
// INTRO1 (night, outside the base)
//   A   1-106  KEEP OUT sign on the fence; its fluorescent tube glitches off and on
//   B 107-164  low dolly past the parked jets, a searchlight pool sliding over the apron
//   C 158-213  (dissolve) high over a Nissen hut, a bunker and the watchtower by the wall
//   D 207-315  (dissolve) the moon over the hangars; the tower searchlight snaps on and sweeps,
//              a tanker rolls in; fade to black
// INTRO2 (inside the hangar, the breakout, the dusk run)
//   E   1-30   head-on down the dark hangar, only the ridge lights on
//   F  31-56   left wall: its floor uplights clunk on
//   G  57-73   right wall: its uplights clunk on
//   H  74-117  head-on again, wider
//   I 118-207  the cockpit wakes up
//   J 208-274  over the rotor head; the blades start to turn
//   K 275-325  at the pad: amber beacons turn, the gunship lifts off its pedestal
//   L 326-370  from below, rotor spinning against the wall
//   M 371-421  the pedestal clamps fold away under the hovering belly
//   N 422-506  orbiting the gunship as it hovers over the pad
//   O 507-554  under the wing: a missile drops off the rail and lights its motor
//   P 555-569  the missile streaks down the hangar
//   Q 570-595  outside: the hangar, the tower, a tanker
//   R 596-660  the hangar blows apart; the gunship flies out of the fire; fade to black
//   S 661-859  dusk: it buzzes the camera, flies off, turns, hovers and fires four missiles
//              past the lens, then climbs out over the camera
//   T 860-957  white flash to the chrome SWIV 3D logo; fade out
import * as THREE from './vendor/three.module.min.js';

/** Seconds per Smacker frame (the intro videos run at 1000/71 fps). */
const FRAME = 0.071;
/** Start time of INTRO1 frame n (1-based). */
const A = (n) => (n - 1) * FRAME;
/** Start time of Intro2 frame n (1-based); INTRO1 is 315 frames. */
const B = (n) => (314 + n) * FRAME;
/** Length of both videos back to back, seconds. */
export const INTRO_LENGTH = B(958);

const seeded = (seed) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const rand = seeded(1234567);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
const span = (t, a, b) => clamp01((t - a) / (b - a));
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Interpolate a camera path: keys are [time, [x,y,z] position, [x,y,z] target, fov?], times
 * ascending. Positions ease (smoothstep) between keys when `ease` is set, linear otherwise.
 */
function path(cam, T, keys, ease = true) {
  let i = 0;
  while (i < keys.length - 2 && T > keys[i + 1][0]) i++;
  const [t0, p0, q0, f0 = 50] = keys[i];
  const [t1, p1, q1, f1 = f0] = keys[Math.min(i + 1, keys.length - 1)];
  let k = t1 > t0 ? clamp01((T - t0) / (t1 - t0)) : 0;
  if (ease) k = smooth(k);
  cam.position.set(lerp(p0[0], p1[0], k), lerp(p0[1], p1[1], k), lerp(p0[2], p1[2], k));
  cam.lookAt(lerp(q0[0], q1[0], k), lerp(q0[1], q1[1], k), lerp(q0[2], q1[2], k));
  cam.fov = lerp(f0, f1, k);
}

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

// ------------------------------------------------------------------ textures

const fenceTex = canvasTexture(64, 64, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.strokeStyle = 'rgba(150,154,160,1)';
  g.lineWidth = 2.5;
  g.beginPath();
  g.moveTo(0, h / 2); g.lineTo(w / 2, 0); g.lineTo(w, h / 2); g.lineTo(w / 2, h); g.closePath();
  g.stroke();
});

/** Soft blotches and drips, for anything that should look used. */
const grimeTex = canvasTexture(128, 256, (g, w, h) => {
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(60,55,40,${rand() * 0.12})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 4, 2 + rand() * 10);
  }
});

/**
 * The KEEP OUT sign: yellow-green enamel gone blotchy with dirt (dark olive clouds, rust
 * drips from the top edge, grime collecting in the corners), black lettering and six hazard
 * symbols, in the original's arrangement: suited figure, flame, radiation / biohazard,
 * explosion, gas mask.
 */
const signTex = canvasTexture(512, 480, (g, w, h) => {
  const r = seeded(77);
  g.fillStyle = '#0c0d06'; g.fillRect(0, 0, w, h);
  g.save();
  g.beginPath(); g.roundRect(10, 10, w - 20, h - 20, 22); g.clip();
  g.fillStyle = '#b4c21e'; g.fillRect(0, 0, w, h);
  // Large soft stains.
  for (let i = 0; i < 70; i++) {
    const x = r() * w, y = r() * h, rad = 20 + r() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.75;
    grd.addColorStop(0, dark ? `rgba(48,58,6,${0.18 + r() * 0.3})` : `rgba(220,235,80,${0.12 + r() * 0.2})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Mottled speckle.
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(30,38,0,${r() * 0.16})`;
    const s = 1 + r() * 4;
    g.fillRect(r() * w, r() * h, s, s);
  }
  // Drips running down from the top edge.
  for (let i = 0; i < 26; i++) {
    const x = r() * w, len = 30 + r() * 180, wd = 2 + r() * 7;
    const grd = g.createLinearGradient(0, 0, 0, len);
    grd.addColorStop(0, `rgba(40,42,8,${0.3 + r() * 0.3})`); grd.addColorStop(1, 'rgba(40,42,8,0)');
    g.fillStyle = grd; g.fillRect(x, 0, wd, len);
  }
  // Dirt in the corners and along the edges.
  const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.62);
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(25,30,0,0.65)');
  g.fillStyle = edge; g.fillRect(0, 0, w, h);
  g.restore();

  const ink = 'rgba(14,16,6,0.94)';
  g.fillStyle = ink; g.strokeStyle = ink;
  g.font = '900 112px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.save(); g.scale(0.84, 1); g.fillText('KEEP OUT', w / 2 / 0.84, h * 0.47); g.restore();
  const icon = (cx, cy, kind) => {
    g.save(); g.translate(cx, cy); g.lineWidth = 7;
    if (kind === 'man' || kind === 'mask') { g.beginPath(); g.arc(0, 0, 52, 0, Math.PI * 2); g.fill(); }
    if (kind === 'rad' || kind === 'bio') {
      g.beginPath(); g.moveTo(0, -60); g.lineTo(60, 0); g.lineTo(0, 60); g.lineTo(-60, 0); g.closePath(); g.stroke();
    }
    g.fillStyle = '#b4c21e';
    if (kind === 'man') {
      // A figure in a hooded protective suit.
      g.beginPath(); g.ellipse(0, -24, 14, 15, 0, 0, 7); g.fill();
      g.fillRect(-15, -10, 30, 34); g.fillRect(-21, -6, 7, 26); g.fillRect(14, -6, 7, 26);
      g.fillRect(-13, 22, 11, 22); g.fillRect(2, 22, 11, 22);
      g.fillStyle = ink; g.fillRect(-8, -28, 16, 7);
    } else if (kind === 'mask') {
      // Gas mask: goggles and canister.
      g.beginPath(); g.ellipse(0, -2, 30, 36, 0, 0, 7); g.fill();
      g.fillStyle = ink;
      g.beginPath(); g.arc(-12, -12, 9, 0, 7); g.arc(12, -12, 9, 0, 7); g.fill();
      g.beginPath(); g.arc(0, 18, 11, 0, 7); g.fill();
    }
    g.fillStyle = ink;
    if (kind === 'rad') {
      for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 32, k * 2.094 - 1.05 - 0.5, k * 2.094 - 1.05 + 0.5); g.closePath(); g.fill(); }
      g.fillStyle = '#b4c21e'; g.beginPath(); g.arc(0, 0, 9, 0, 7); g.fill();
      g.fillStyle = ink; g.beginPath(); g.arc(0, 0, 6, 0, 7); g.fill();
    } else if (kind === 'bio') {
      g.lineWidth = 6;
      for (let k = 0; k < 3; k++) {
        const a = k * 2.094 - Math.PI / 2;
        g.beginPath(); g.arc(Math.cos(a) * 14, Math.sin(a) * 14, 15, 0, 7); g.stroke();
      }
      g.beginPath(); g.arc(0, 0, 9, 0, 7); g.stroke();
    } else if (kind === 'flame') {
      g.beginPath(); g.moveTo(0, -46); g.quadraticCurveTo(30, -6, 18, 30); g.quadraticCurveTo(8, 12, 0, 34);
      g.quadraticCurveTo(-8, 12, -18, 30); g.quadraticCurveTo(-30, -6, 0, -46); g.fill();
      g.fillRect(-26, 36, 52, 8);
    } else if (kind === 'blast') {
      g.beginPath();
      for (let k = 0; k < 22; k++) { const a = k / 22 * Math.PI * 2; const rr = k % 2 ? 14 : 44 + (k % 4) * 6; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
      g.closePath(); g.fill();
      g.fillStyle = '#b4c21e'; g.beginPath(); g.arc(0, 0, 8, 0, 7); g.fill();
    }
    g.restore();
  };
  icon(108, 92, 'man'); icon(256, 92, 'flame'); icon(404, 92, 'rad');
  icon(108, 372, 'bio'); icon(256, 372, 'blast'); icon(404, 372, 'mask');
  // A last wash of dirt over the ink, so the lettering is stained too.
  for (let i = 0; i < 30; i++) {
    const x = r() * w, y = r() * h, rad = 15 + r() * 50;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(70,80,10,${r() * 0.3})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
});

/** Night sky: broken cloud lit violet by the moon, on transparent. */
const cloudTex = canvasTexture(1024, 256, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const r = seeded(99);
  for (let i = 0; i < 700; i++) {
    const x = r() * w, y = h * (0.15 + r() * 0.85), rad = 12 + r() * 50;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const k = 0.1 + r() * 0.16;
    grd.addColorStop(0, `rgba(105,95,150,${k})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - rad, y - rad * 0.5, rad * 2, rad);
  }
}, { repeat: [3, 1] });

const moonTex = canvasTexture(256, 256, (g) => {
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,248,1)'); grd.addColorStop(0.085, 'rgba(250,250,240,1)');
  grd.addColorStop(0.11, 'rgba(200,195,235,0.55)'); grd.addColorStop(0.3, 'rgba(150,140,200,0.22)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
});

const fireTex = canvasTexture(64, 64, (g) => {
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,250,220,1)'); grd.addColorStop(0.3, 'rgba(255,190,60,0.9)');
  grd.addColorStop(0.65, 'rgba(220,70,10,0.5)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
});

/** A soft, lumpy puff (white; tinted per sprite). */
const puffTex = canvasTexture(64, 64, (g) => {
  const r = seeded(5);
  for (let i = 0; i < 9; i++) {
    const x = 20 + r() * 24, y = 20 + r() * 24, rad = 10 + r() * 12;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  }
});

/** The blast's white core with radiating streaks. */
const raysTex = canvasTexture(256, 256, (g) => {
  const r = seeded(11);
  g.translate(128, 128);
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2, len = 60 + r() * 68;
    g.strokeStyle = `rgba(220,235,255,${0.08 + r() * 0.2})`;
    g.lineWidth = 1 + r() * 3;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * len, Math.sin(a) * len); g.stroke();
  }
  const grd = g.createRadialGradient(0, 0, 0, 0, 0, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(240,248,255,0.95)');
  grd.addColorStop(0.55, 'rgba(170,200,255,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(-128, -128, 256, 256);
});

/** The fan of light a floor uplight throws up a wall: bright at the foot, spreading and fading. */
const washTex = canvasTexture(64, 128, (g, w, h) => {
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const up = 1 - y / h; // 0 at the top
    const spread = 0.12 + 0.88 * Math.pow(up, 0.8);
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x - w / 2 + 0.5) / (w / 2);
      const across = Math.max(0, 1 - dx / spread);
      const v = Math.pow(across, 1.6) * Math.pow(1 - up, 1.7) * (1 + 2.5 * Math.pow(1 - up, 12));
      const i = (y * w + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 240; img.data[i + 2] = 190; img.data[i + 3] = Math.min(255, v * 255);
    }
  }
  g.putImageData(img, 0, 0);
}, { srgb: true });

/** A light beam's falloff along its length (v = 1 at the lamp). */
const beamTex = canvasTexture(8, 128, (g, w, h) => {
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});

const concreteTex = noiseTexture(128, 128, [80, 80, 78], 46, [14, 14]);
const groundTex = noiseTexture(128, 128, [70, 72, 70], 40, [40, 40]);

/** Corrugated sheet, ribs running along v (vertical on a wall). */
const ribTex = canvasTexture(64, 16, (g, w, h) => {
  for (let x = 0; x < w; x++) {
    const v = 92 + 60 * Math.max(0, Math.sin(x / w * Math.PI * 4));
    g.fillStyle = `rgb(${v},${v},${v - 4})`;
    g.fillRect(x, 0, 1, h);
  }
});

// ------------------------------------------------------------------ models

/**
 * The gunship as the intro renders it: a deep, rounded fuselage with a blunt nose under a big
 * wrap-round windscreen, a rounded engine cowl on the roof with exhaust stubs, high stub wings
 * each carrying two missiles on underwing rails, a chin gun, a slim boom rising to a swept fin
 * with the tail rotor on its left, and a broad-bladed four-blade main rotor. +z is forward; the
 * belly is at y = -1.
 */
function makeHeli({ color = 0x6c727a, skin = '#8a9098' } = {}) {
  const g = new THREE.Group();
  const tex = panelTexture(skin, { cols: 6, rows: 3, line: 'rgba(0,0,0,0.35)', repeat: [2, 2] });
  const hull = new THREE.MeshStandardMaterial({ color, map: tex, roughness: 0.42, metalness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.55, metalness: 0.5 });
  const black = metal(0x0c0d0f, 0.7, 0.3);
  const fuselage = [
    { z: 3.15, w: 0.12, h: 0.12, y: -0.2, n: 2 },
    { z: 3.0, w: 0.55, h: 0.5, y: -0.2, n: 2.2 },
    { z: 2.6, w: 0.86, h: 0.78, y: -0.1, n: 2.4 },
    { z: 1.7, w: 1.02, h: 0.95, y: 0.0, n: 2.7 },
    { z: 0.3, w: 1.05, h: 1.0, y: 0.05, n: 2.9 },
    { z: -1.0, w: 0.95, h: 0.9, y: 0.12, n: 2.7 },
    { z: -2.0, w: 0.5, h: 0.5, y: 0.4, n: 2.4 },
    { z: -5.4, w: 0.19, h: 0.21, y: 0.66, n: 2.2 },
    { z: -6.05, w: 0.13, h: 0.17, y: 0.76, n: 2.2 },
  ];
  g.add(new THREE.Mesh(loft(fuselage, 36), hull));
  // Windscreen: the upper half of the nose in glass, standing just proud of the skin.
  const glass = new THREE.Mesh(loft(fuselage.slice(0, 5).map((s) => ({ ...s, w: s.w * 1.025, h: s.h * 1.03, bot: 0.02 })), 30), glassMat());
  glass.scale.z = 0.999;
  g.add(glass);
  // A skin band over the glass splits it into windscreen and side windows.
  const frameMat = dark;
  for (const z of [2.25, 1.35]) {
    const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 6, 24, Math.PI), frameMat);
    const s = fuselage[z > 2 ? 2 : 3];
    r.scale.set(s.w * 1.04, s.h * 1.05, 1);
    r.position.set(0, s.y, z);
    g.add(r);
  }
  // Engine cowl and exhausts.
  const cowl = new THREE.Mesh(loft([
    { z: 1.0, w: 0.3, h: 0.2, n: 2.4 },
    { z: 0.8, w: 0.6, h: 0.32, n: 3.2 },
    { z: -1.4, w: 0.66, h: 0.34, n: 3.6 },
    { z: -2.1, w: 0.4, h: 0.22, n: 3 },
  ], 24), hull);
  cowl.position.y = 1.0;
  g.add(cowl);
  for (const s of [-1, 1]) {
    const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0x1a1816, roughness: 0.8, metalness: 0.4, side: THREE.DoubleSide }));
    ex.rotation.x = Math.PI / 2 + 0.3;
    ex.rotation.z = s * 0.5;
    ex.position.set(s * 0.62, 0.95, -1.7);
    g.add(ex);
    const intake = new THREE.Mesh(new THREE.CircleGeometry(0.16, 14), black);
    intake.position.set(s * 0.45, 1.05, 0.98);
    g.add(intake);
  }
  // Stub wings with two missiles each.
  const missiles = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(plate([[0, 0.5], [1.35, 0.35], [1.35, -0.3], [0, -0.45]].map(([x, y]) => [x * s, y]), 0.12, 0.03), dark);
    wing.rotation.x = Math.PI / 2;
    const holder = new THREE.Group();
    holder.position.set(s * 0.95, 0.25, -0.1);
    holder.rotation.z = s * -0.08;
    holder.add(wing);
    g.add(holder);
    const tip = navLight(s < 0 ? 0xff2a1a : 0x22ff55, 0.05);
    tip.position.set(s * 2.32, 0.15, -0.1);
    g.add(tip);
    for (const [k, x] of [[0, 1.45], [1, 2.05]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 1.1), dark);
      rail.position.set(s * x, 0.06, 0.0);
      g.add(rail);
      const m = makeMissile();
      m.position.set(s * x, -0.1, 0.05);
      m.userData.home = m.position.clone();
      m.userData.side = s; m.userData.slot = k;
      g.add(m);
      missiles.push(m);
    }
  }
  // Chin gun.
  const turret = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), dark);
  turret.position.set(0, -0.82, 2.25);
  g.add(turret);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.85, 8), black);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, -0.88, 2.65);
  g.add(barrel);
  // Tail: swept fin, stabiliser, tail rotor on the left.
  const fin = new THREE.Mesh(plate([[0, 0], [0.75, 0], [0.2, 1.5], [-0.3, 1.5]], 0.08, 0.02), hull);
  fin.rotation.y = -Math.PI / 2;
  fin.position.set(0, 0.7, -5.55);
  g.add(fin);
  const stab = new THREE.Mesh(plate([[-0.9, 0], [0.9, 0], [0.75, -0.45], [-0.75, -0.45]], 0.05, 0.015), hull);
  stab.rotation.x = Math.PI / 2;
  stab.position.set(0, 0.7, -5.0);
  g.add(stab);
  const beacon = navLight(0xff3020, 0.05);
  beacon.position.set(0, 2.25, -5.9);
  g.add(beacon);
  // Main rotor with ghost blades for motion blur and a faint disc at speed.
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.55, 0.05);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.4, 10), dark);
  mast.position.y = -0.2;
  rotor.add(mast);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.18, 14), dark);
  rotor.add(hub);
  const bladeGeo = plate([[-0.16, 0], [0.2, 0], [0.18, 5.3], [-0.12, 5.4]], 0.04, 0);
  const blades = [];
  const ghosts = [];
  for (let k = 0; k < 4; k++) {
    const arm = new THREE.Group();
    arm.rotation.y = k * Math.PI / 2;
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.6), dark);
    grip.position.z = 0.4;
    arm.add(grip);
    const blade = new THREE.Mesh(bladeGeo, new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.6, metalness: 0.3, transparent: true }));
    blade.rotation.x = Math.PI / 2;
    blade.rotation.y = 0.05;
    blade.position.set(0, 0, 0.55);
    arm.add(blade);
    blades.push(blade);
    for (const lag of [0.12, 0.24, 0.36]) {
      const gh = new THREE.Mesh(bladeGeo, new THREE.MeshBasicMaterial({ color: 0x0c0c0e, transparent: true, opacity: 0, depthWrite: false }));
      gh.rotation.x = Math.PI / 2;
      gh.position.set(0, 0, 0.55);
      const ga = new THREE.Group();
      ga.rotation.y = -lag;
      ga.add(gh);
      arm.add(ga);
      ghosts.push({ m: gh, lag });
    }
    rotor.add(arm);
  }
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 8), dark);
  dome.scale.y = 0.55; dome.position.y = 0.12;
  rotor.add(dome);
  const disc = new THREE.Mesh(new THREE.RingGeometry(0.5, 5.9, 48),
    new THREE.MeshBasicMaterial({ color: 0x6a6e74, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2;
  rotor.add(disc);
  g.add(rotor);
  const tail = new THREE.Group();
  tail.position.set(-0.16, 1.65, -5.95);
  for (let k = 0; k < 4; k++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.85, 0.14), black);
    b.position.y = 0.42;
    const a = new THREE.Group();
    a.rotation.x = k * Math.PI / 2;
    a.add(b);
    tail.add(a);
  }
  const tailHub = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 8), dark);
  tailHub.rotation.z = Math.PI / 2;
  tail.add(tailHub);
  g.add(tail);
  g.userData = { rotor, tail, disc, blades, ghosts, missiles, beacon, hull };
  return g;
}

/**
 * Pose the rotor: `angle` in radians, `speed` in rad/s. Fast blades fade into ghosted smears
 * and a faint disc, the way the video's motion blur shows them.
 */
function setRotor(heli, angle, speed = 0) {
  const u = heli.userData;
  u.rotor.rotation.y = angle;
  u.tail.rotation.x = angle * 2.7;
  const blur = clamp01((speed - 5) / 25);
  u.disc.material.opacity = blur * 0.1;
  u.blades.forEach((b) => { b.material.opacity = 1 - blur * 0.55; });
  u.ghosts.forEach((gh) => { gh.m.material.opacity = blur * (0.42 - gh.lag * 0.8); });
}

/** A missile: cream body, dark seeker nose and band, dark tail section with cruciform fins. +z forward. */
function makeMissile() {
  const g = new THREE.Group();
  const cream = new THREE.MeshStandardMaterial({ color: 0xcfc6a8, map: grimeTex, roughness: 0.55, metalness: 0.15 });
  const dark = metal(0x26272a, 0.5, 0.4);
  const prof = [[0, -0.75], [0.075, -0.75], [0.09, -0.68], [0.09, 0.5], [0.08, 0.62], [0.055, 0.72], [0.025, 0.79], [0, 0.8]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 16), cream);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), dark);
  nose.scale.z = 1.6; nose.position.z = 0.72;
  g.add(nose);
  for (const [z, len] of [[0.5, 0.08], [-0.5, 0.28]]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.093, 0.093, len, 16), dark);
    band.rotation.x = Math.PI / 2;
    band.position.z = z;
    g.add(band);
  }
  const finMat = metal(0x3a3b3e, 0.5, 0.4);
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(plate([[0, 0], [0.3, 0], [0.3, 0.13], [0.1, 0.22]], 0.015, 0), finMat);
    const a = new THREE.Group();
    a.rotation.z = k * Math.PI / 2 + Math.PI / 4;
    f.rotation.y = -Math.PI / 2;
    f.position.set(0, 0.07, -0.74);
    a.add(f);
    g.add(a);
  }
  // Motor flame and glow, hidden until it fires.
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  flame.position.z = -0.95;
  flame.scale.set(0.7, 0.7, 1);
  g.add(flame);
  g.userData.flame = flame;
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
  let front;
  for (const s of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.CircleGeometry(r, 40, 0, Math.PI), wall);
    end.position.z = s * len / 2;
    if (s < 0) end.rotation.y = Math.PI;
    else front = end;
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
  g.userData = { door, front, shell };
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

// ------------------------------------------------------------------ sets

const additive = (map, color = 0xffffff, opacity = 0) => new THREE.MeshBasicMaterial({
  map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
});
const repeatOf = (tex, x, y) => { const t = tex.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(x, y); t.needsUpdate = true; return t; };

/** A sky dome that rides with the camera: violet cloud over a near-black night. */
function nightSky(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2 + 0.05),
    new THREE.MeshBasicMaterial({ map: cloudTex, side: THREE.BackSide, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  sky.renderOrder = -2;
  scene.add(sky);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  moon.scale.set(300, 300, 1);
  moon.renderOrder = -1;
  scene.add(moon);
  return { sky, moon };
}

/** Put the moon sprite where it sits on screen at normalised (sx, sy) (0..1 from top left). */
function placeMoon(moon, cam, sx, sy) {
  const v = new THREE.Vector3(sx * 2 - 1, 1 - sy * 2, 0.5).unproject(cam).sub(cam.position).normalize();
  moon.position.copy(cam.position).addScaledVector(v, 850);
}

/** The perimeter wall: concrete panels between buttresses, chain-link and posts on top. */
function makeWall(len) {
  const g = new THREE.Group();
  const conc = new THREE.MeshStandardMaterial({ color: 0x4a4648, map: repeatOf(concreteTex, len / 6, 1), roughness: 0.95 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 2.6, 0.4), conc);
  wall.position.y = 1.3;
  g.add(wall);
  for (let x = -len / 2; x <= len / 2; x += 3.2) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.9), conc);
    b.position.set(x, 1.2, 0.5);
    g.add(b);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), metal(0x6a6e73));
    post.position.set(x, 3.4, 0);
    post.rotation.x = 0.25;
    g.add(post);
  }
  const fence = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.4), new THREE.MeshStandardMaterial({ map: repeatOf(fenceTex, len / 0.25, 1.4 / 0.25), alphaTest: 0.4, side: THREE.DoubleSide, metalness: 0.5, roughness: 0.5, color: 0x9a9ea4 }));
  fence.position.set(0, 3.3, 0.1);
  fence.rotation.x = 0.25;
  g.add(fence);
  return g;
}

// A: the sign on the perimeter fence.
function signSet() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06070b);
  scene.fog = new THREE.Fog(0x0b0c12, 20, 160);
  scene.add(new THREE.HemisphereLight(0x3a4060, 0x0c0c0c, 0.45));
  const moonLight = new THREE.DirectionalLight(0x8a90c0, 0.55);
  moonLight.position.set(-30, 40, -60);
  scene.add(moonLight);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x4a4c4e, map: groundTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const { sky, moon } = nightSky(scene);
  const fence = new THREE.Mesh(new THREE.PlaneGeometry(80, 4.4), new THREE.MeshStandardMaterial({ map: repeatOf(fenceTex, 80 / 0.22, 4.4 / 0.22), alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.55, roughness: 0.45, color: 0xb0b4ba }));
  fence.position.set(0, 2.2, 0);
  scene.add(fence);
  for (let x = -40; x <= 40; x += 3) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 4.5, 6), metal(0x6a6e73));
    post.position.set(x + 2.2, 2.25, -0.05);
    scene.add(post);
  }
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.24, 1.16, 0.035), metal(0x0e0f0a, 0.8, 0.3));
  board.position.set(0, 1.62, 0.03);
  scene.add(board);
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.62, metalness: 0.15 });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.12), signMat);
  sign.position.set(0, 1.62, 0.05);
  scene.add(sign);
  // The strip light: a dark batten on a stem above the sign, and its tube.
  const batten = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.05, 0.07), metal(0x111214, 0.6, 0.5));
  batten.position.set(0, 2.36, 0.09);
  scene.add(batten);
  const stem = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.03), metal(0x111214, 0.6, 0.5));
  stem.position.set(0, 2.27, 0.06);
  scene.add(stem);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.8, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  tube.rotation.z = Math.PI / 2;
  tube.position.set(0, 2.32, 0.12);
  scene.add(tube);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.22), additive(beamTex, 0xcfd8ff, 0));
  glow.position.set(0, 2.32, 0.14);
  glow.material.map = canvasTexture(64, 16, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  scene.add(glow);
  const lamp = new THREE.SpotLight(0xeef2ff, 0, 7, 1.15, 0.7, 1.4);
  lamp.position.set(0, 2.38, 0.42);
  lamp.target.position.set(0, 1.3, 0);
  scene.add(lamp, lamp.target);
  const spill = new THREE.PointLight(0xdfe6ff, 0, 5, 1.6);
  spill.position.set(0, 2.3, 0.3);
  scene.add(spill);
  const jet = makeJet();
  jet.position.set(5.2, 1.5, -15);
  jet.rotation.y = -Math.PI / 2 - 0.25;
  scene.add(jet);
  const hut = makeHangar(18, 5);
  hut.position.set(-6, 0, -45);
  scene.add(hut);
  return { scene, sky, moon, tube, glow, lamp, spill, signMat };
}

/**
 * The base at night, laid out as separate sets far enough apart (the fog hides each from the
 * others) for the apron dolly, the high shot, the moon shot and the hangar breakout.
 */
const SET = { apron: 0, high: 500, moon: 1000, out: 1500 };

function baseSet() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  scene.fog = new THREE.Fog(0x0a0a12, 50, 260);
  const hemi = new THREE.HemisphereLight(0x50557a, 0x0e0e10, 0.5);
  scene.add(hemi);
  const moonLight = new THREE.DirectionalLight(0x9a98d8, 0.75);
  moonLight.position.set(-40, 60, -90);
  scene.add(moonLight);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 800), new THREE.MeshStandardMaterial({ color: 0x5a5c5e, map: repeatOf(groundTex, 260, 52), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.x = 750;
  scene.add(ground);
  const { sky, moon } = nightSky(scene);
  const at = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; scene.add(o); return o; };

  // Apron: two jets close, huts end-on behind, the tower, the wall; a tanker on the right.
  const X = SET.apron;
  const apronJets = [at(makeJet(), X + 0, 1.5, 0, -Math.PI / 2 + 0.35), at(makeJet(), X - 3, 1.5, -11, -Math.PI / 2 + 0.3), at(makeJet(), X + 24, 1.5, -16, -Math.PI / 2 + 0.3)];
  for (const x of [-16, -4, 8, 20]) at(makeHangar(18, 4.2), X + x, 0, -52);
  at(makeTower(), X + 26, 0, -58);
  at(makeWall(140), X, 0, -66);
  const apronTanker = at(makeTruck('tanker'), X + 22, 0, -4, -Math.PI / 2 - 0.5);
  const pool = new THREE.SpotLight(0xe8eeff, 0, 120, 0.075, 0.25, 0.6);
  pool.position.set(X + 26, 45, -58);
  scene.add(pool, pool.target);

  // High shot: hut, bunker and tower inside the wall's corner.
  const H = SET.high;
  at(makeHangar(16, 4.2), H - 9, 0, 1, 0.55);
  const bunker = at(makeBunker(), H + 5, 0, 3.5, 0.75);
  at(makeTower(), H - 1, 0, -7);
  const highWall = at(makeWall(120), H - 4, 0, -16, 0.22);

  // Moon shot: two huts end-on, the tower behind, a lit block with a door lamp, the wall.
  const M = SET.moon;
  at(makeHangar(22, 6.2), M - 9, 0, -26, 0.12);
  at(makeHangar(22, 5.2), M + 3, 0, -34, 0.12);
  const moonTower = at(makeTower(), M + 9, 0, -46);
  const block = at(makeBunker(), M + 22, 0, -44, 0);
  block.scale.set(2.2, 0.85, 1);
  at(makeWall(160), M, 0, -55);
  const moonTanker = at(makeTruck('tanker'), M + 14, 0, -6, -Math.PI / 2 - 0.4);
  // The searchlight's beam is a long additive cone from the tower's lamp head.
  const tw = moonTower.userData;
  tw.beam.material = additive(beamTex, 0xdfe6ff, 0);
  tw.beam.geometry = new THREE.ConeGeometry(3.2, 70, 24, 1, true);
  tw.beam.position.z = 35.3;

  // Outside the hangar for the breakout.
  const O = SET.out;
  const hangar = at(makeHangar(26, 8.5), O, 0, -34);
  const outTower = at(makeTower(), O + 15, 0, -42);
  const shed = at(makeBunker(), O + 17, 0, -24, -0.3);
  at(makeHangar(16, 4.2), O - 17, 0, -24, 0.3);
  at(makeWall(160), O, 0, -60);
  at(makeTruck('troop'), O - 6.5, 0, -9, Math.PI / 2 + 0.2);
  const outLight = new THREE.PointLight(0xc8ccff, 0, 120, 1);
  scene.add(outLight);
  // Fireball, smoke, the white core and the debris.
  const r = seeded(4242);
  const fire = [];
  for (let i = 0; i < 140; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.userData = { x: (r() - 0.5) * 16, y: r() * 6, z: (r() - 0.5) * 18, vx: (r() - 0.5) * 2, vy: 2 + r() * 5, life: 0.7 + r() * 1.3, phase: r() * 3, size: 3 + r() * 4 };
    scene.add(s);
    fire.push(s);
  }
  const smoke = [];
  for (let i = 0; i < 50; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0x2a2018, depthWrite: false, transparent: true, opacity: 0 }));
    s.userData = { x: (r() - 0.5) * 18, z: (r() - 0.5) * 16, vy: 3 + r() * 3, life: 2 + r() * 2, phase: r() * 4, size: 7 + r() * 6 };
    scene.add(s);
    smoke.push(s);
  }
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: raysTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false }));
  core.position.set(O, 5, -20);
  scene.add(core);
  const debris = [];
  for (let i = 0; i < 34; i++) {
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.6 + r() * 3, 0.06, 0.6 + r() * 2.2), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, map: corrugated, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }));
    d.visible = false;
    d.userData = { p: V(O + (r() - 0.5) * 14, 2 + r() * 8, -22 + (r() - 0.5) * 6), v: V((r() - 0.5) * 34, 6 + r() * 20, 8 + r() * 26), w: V(r() * 9, r() * 9, r() * 9) };
    scene.add(d);
    debris.push(d);
  }
  const heli = makeHeli({ color: 0x3a3e44, skin: '#6a7078' });
  heli.visible = false;
  scene.add(heli);
  return { scene, sky, moon, hemi, moonLight, apronJets, apronTanker, pool, bunker, highWall, moonTower, moonTanker, block, hangar, outTower, shed, outLight, fire, smoke, core, debris, heli };
}

// E-P: inside the hangar.
const HALL = { w: 12, wall: 4.6, arch: 6.8, len: 22 };

function hangarSet() {
  const { w: W, wall: HW, arch: AH, len: L } = HALL;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010101);
  scene.fog = new THREE.Fog(0x020202, 30, 80);
  const ambient = new THREE.AmbientLight(0x2a2a30, 0.25);
  scene.add(ambient);
  const sheet = (rx, ry) => new THREE.MeshStandardMaterial({ color: 0x77777a, map: repeatOf(ribTex, rx, ry), roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(2 * L, HW), sheet(2 * L / 0.55, 1));
    wall.rotation.y = -s * Math.PI / 2;
    wall.position.set(s * W, HW / 2, 0);
    scene.add(wall);
  }
  const roofGeo = new THREE.CylinderGeometry(W, W, 2 * L, 48, 1, true, Math.PI / 2, Math.PI);
  roofGeo.rotateX(Math.PI / 2);
  roofGeo.scale(1, AH / W, 1);
  roofGeo.translate(0, HW, 0);
  const roofTex = canvasTexture(16, 64, (g, w, h) => {
    for (let y = 0; y < h; y++) { const v = 80 + 60 * Math.max(0, Math.sin(y / h * Math.PI * 4)); g.fillStyle = `rgb(${v},${v},${v - 4})`; g.fillRect(0, y, w, 1); }
  }, { repeat: [1, 2 * L / 0.6] });
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0x6a6a6e, map: roofTex, roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide }));
  scene.add(roof);
  for (const s of [-1, 1]) {
    const sh = new THREE.Shape();
    sh.moveTo(-W, 0); sh.lineTo(W, 0); sh.lineTo(W, HW);
    sh.absellipse(0, HW, W, AH, 0, Math.PI, false);
    sh.lineTo(-W, 0);
    const end = new THREE.Mesh(new THREE.ShapeGeometry(sh, 24), sheet(2 * W / 0.55 / 24, 1 / (HW + AH)));
    end.material.map.repeat.set(2 * W / 0.55 / 24, 1 / (HW + AH));
    end.position.z = -s * L;
    if (s < 0) end.rotation.y = Math.PI;
    scene.add(end);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 2 * L), new THREE.MeshStandardMaterial({ color: 0x5a5a56, map: repeatOf(concreteTex, 10, 18), roughness: 0.75, metalness: 0.2 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // Ridge lights: a beam carrying a row of fluorescent panels.
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.25, 2 * L), metal(0x1a1a1c, 0.7, 0.4));
  ridge.position.set(0, HW + AH - 0.2, 0);
  scene.add(ridge);
  for (let k = 0; k < 9; k++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.06, 2.4), new THREE.MeshBasicMaterial({ color: 0xf8faff }));
    p.position.set(0, HW + AH - 0.36, -L + 2.5 + k * 4.9);
    scene.add(p);
  }
  const ridgeLights = [-12, 0, 12].map((z) => {
    const l = new THREE.PointLight(0xeef2ff, 70, 34, 1.15);
    l.position.set(0, HW + AH - 1.2, z);
    scene.add(l);
    return l;
  });
  // Floor uplights along both walls, each throwing a fan of warm light up the wall.
  const uplights = { [-1]: [], [1]: [] };
  const washMat = { [-1]: additive(washTex, 0xfff0c8, 0), [1]: additive(washTex, 0xfff0c8, 0) };
  const lampMat = { [-1]: new THREE.MeshBasicMaterial({ color: 0x111111 }), [1]: new THREE.MeshBasicMaterial({ color: 0x111111 }) };
  for (const s of [-1, 1]) {
    for (let z = -L + 2.5; z < L - 1; z += 3) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.36), lampMat[s]);
      lamp.position.set(s * (W - 0.3), 0.08, z);
      scene.add(lamp);
      const wash = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.2), washMat[s]);
      wash.rotation.y = -s * Math.PI / 2;
      wash.position.set(s * (W - 0.04), 2.1, z);
      scene.add(wash);
    }
    const fill = [-10, 6].map((z) => {
      const l = new THREE.PointLight(0xffe0a8, 0, 16, 1.3);
      l.position.set(s * (W - 1.2), 1.0, z);
      scene.add(l);
      return l;
    });
    uplights[s] = { wash: washMat[s], lamp: lampMat[s], fill };
  }

  // The pad: two tiers, a hazard ring on the floor, hoses, amber beacons round the lower tier.
  const padTop = new THREE.MeshStandardMaterial({ color: 0x3c3c3a, map: repeatOf(concreteTex, 3, 3), roughness: 0.55, metalness: 0.5 });
  const t1 = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.75, 0.42, 64), padTop);
  t1.position.y = 0.21;
  scene.add(t1);
  const t2 = new THREE.Mesh(new THREE.CylinderGeometry(4.7, 4.8, 0.45, 64), padTop);
  t2.position.y = 0.42 + 0.225;
  scene.add(t2);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(6.66, 0.06, 6, 64), metal(0x8a8a86, 0.4, 0.8));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.42;
  scene.add(rim);
  const stripes = canvasTexture(256, 16, (g, w, h) => {
    g.fillStyle = '#121212'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 16) { if ((x / 16) % 2) continue; g.fillStyle = '#c8a818'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 12, 0); g.lineTo(x + 6, h); g.lineTo(x - 6, h); g.fill(); }
  }, { repeat: [10, 1] });
  const ring = new THREE.Mesh(new THREE.RingGeometry(8.0, 8.6, 96, 1), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
  // RingGeometry's UVs are planar; remap u round the ring so the stripes run along it.
  { const p = ring.geometry.attributes.position, uv = ring.geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getY(i), p.getX(i)); uv.setXY(i, (a / (Math.PI * 2) + 0.5), Math.hypot(p.getX(i), p.getY(i)) > 8.3 ? 1 : 0); } }
  scene.add(ring);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.6, metalness: 0.2 });
  for (const [a, len] of [[0.35, 1], [2.8, 0.9], [3.5, 1.1], [5.9, 0.9]]) {
    const pts = [];
    for (let i = 0; i <= 7; i++) {
      const rr = 6.6 + i * 0.75 * len;
      const ww = a + Math.sin(i * 1.3 + a) * 0.1;
      pts.push(V(Math.cos(ww) * rr, i === 0 ? 0.3 : 0.12, Math.sin(ww) * rr));
    }
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.14, 8), rubber));
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 12), metal(0xa0a2a6, 0.3, 0.9));
    c.position.copy(pts[0]); c.rotation.z = Math.PI / 2; c.rotation.y = -a;
    scene.add(c);
  }
  const beacons = [];
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2 + Math.PI / 8;
    const p = V(Math.cos(a) * 6.75, 0.22, Math.sin(a) * 6.75);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 14), metal(0x8a8c90, 0.35, 0.85));
    housing.rotation.z = Math.PI / 2; housing.rotation.y = -a;
    housing.position.copy(p);
    scene.add(housing);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.27, 14, 10), new THREE.MeshBasicMaterial({ color: 0x302010 }));
    lens.position.copy(p).add(V(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12));
    scene.add(lens);
    const head = new THREE.Group();
    head.position.copy(p);
    const beam = new THREE.Mesh(new THREE.ConeGeometry(1.0, 7, 20, 1, true), additive(beamTex, 0xffb020, 0));
    beam.rotation.x = -Math.PI / 2;
    beam.position.z = 3.5;
    head.add(beam);
    scene.add(head);
    beacons.push({ a, head, lens, beam });
  }
  const amber = [0, 1].map(() => {
    const l = new THREE.SpotLight(0xffa818, 0, 22, 0.32, 0.5, 1.2);
    scene.add(l, l.target);
    return l;
  });
  // The pedestal the gunship sits on, with four clamp arms that fold down once it lifts.
  const cream = new THREE.MeshStandardMaterial({ color: 0xc9b98a, roughness: 0.45, metalness: 0.35 });
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, 1.4, 20), cream);
  ped.position.y = 0.87 + 0.7;
  scene.add(ped);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.7, 0.45, 24), cream);
  cap.position.y = 2.35;
  scene.add(cap);
  const capTop = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24), new THREE.MeshStandardMaterial({ color: 0xe8e2d0, roughness: 0.35, metalness: 0.2 }));
  capTop.rotation.x = -Math.PI / 2; capTop.position.y = 2.58;
  scene.add(capTop);
  const clamps = [];
  for (let k = 0; k < 4; k++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = k * Math.PI / 2 + Math.PI / 4;
    const hinge = new THREE.Group();
    hinge.position.set(0, 2.2, 1.0);
    const arm = new THREE.Mesh(plate([[-0.32, 0], [0.32, 0], [0.42, 1.3], [0.2, 1.55], [-0.2, 1.55], [-0.42, 1.3]], 0.22, 0.04), cream);
    arm.rotation.x = -Math.PI / 2;
    hinge.add(arm);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.6, 0.3), cream);
    jaw.position.set(0, 0.25, 1.45);
    hinge.add(jaw);
    pivot.add(hinge);
    scene.add(pivot);
    clamps.push(hinge);
  }
  const heli = makeHeli({ color: 0x3a3d42, skin: '#5c6068' });
  scene.add(heli);
  // The loose missile for P (and the one that falls in O, which is the heli's own).
  const shot = makeMissile();
  shot.visible = false;
  scene.add(shot);
  const motor = new THREE.PointLight(0xffb060, 0, 10, 1.4);
  scene.add(motor);
  const key = new THREE.SpotLight(0xd8dcff, 30, 30, 0.6, 0.8, 1.2);
  key.position.set(0, HW + AH - 1, 4);
  key.target.position.set(0, 3, 0);
  scene.add(key, key.target);
  return { scene, ridgeLights, uplights, beacons, amber, clamps, heli, shot, motor, key, ambient };
}

// I: the cockpit.
function cockpitSet() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.add(new THREE.AmbientLight(0x404858, 0.4));
  const panelLight = new THREE.PointLight(0x9fb0c8, 6, 14, 1.2);
  panelLight.position.set(0, 1.5, 4);
  scene.add(panelLight);
  const faceMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, map: panelTexture('#4a5058', { cols: 7, rows: 5, line: 'rgba(0,0,0,0.6)' }), roughness: 0.75, metalness: 0.3 });
  const bezelMat = metal(0x3a3e44, 0.35, 0.7);
  const tealMat = new THREE.MeshStandardMaterial({ color: 0x2a5a66, roughness: 0.5, metalness: 0.3, emissive: 0x0a1c22 });
  const rr = (w, h, r, p = new THREE.Shape()) => {
    p.moveTo(-w / 2 + r, -h / 2); p.lineTo(w / 2 - r, -h / 2); p.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    p.lineTo(w / 2, h / 2 - r); p.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); p.lineTo(-w / 2 + r, h / 2);
    p.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); p.lineTo(-w / 2, -h / 2 + r); p.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    return p;
  };
  const bezel = (w, h, r) => {
    const sh = rr(w + 0.36, h + 0.36, r + 0.1);
    sh.holes.push(rr(w, h, r, new THREE.Path()));
    return new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
  };
  // Screen pages, drawn once each.
  const page = (kind) => canvasTexture(256, 256, (g, w, h) => {
    const r = seeded(kind.length * 31);
    g.fillStyle = '#020604'; g.fillRect(0, 0, w, h);
    if (kind === 'map') {
      for (let i = 0; i < 9000; i++) { const v = 40 + r() * 140; g.fillStyle = `rgba(${v * 0.6},${v},${v * 0.55},${r() * 0.8})`; g.fillRect(r() * w, r() * h, 2, 2); }
      g.strokeStyle = 'rgba(120,255,140,0.5)'; g.lineWidth = 2;
      for (let k = 0; k < 6; k++) { g.beginPath(); g.moveTo(0, k * 45 + 10); for (let x = 0; x < w; x += 16) g.lineTo(x, k * 45 + 10 + Math.sin(x * 0.05 + k) * 12); g.stroke(); }
    } else if (kind === 'radar') {
      g.fillStyle = '#04141a'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#4ae0ff'; g.lineWidth = 2;
      for (let k = 0; k < 14; k++) { g.beginPath(); let x = r() * w, y = r() * h; g.moveTo(x, y); for (let j = 0; j < 4; j++) { x += (r() - 0.5) * 120; y += (r() - 0.5) * 120; g.lineTo(x, y); } g.stroke(); }
    } else if (kind === 'green') {
      g.fillStyle = '#5ee87a'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,60,10,0.25)'; for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);
    } else if (kind === 'dim') {
      g.fillStyle = '#0a160c'; g.fillRect(0, 0, w, h);
    }
  });
  const items = [];
  const screen = (x, y, z, w, h, kind, ry = 0, rx = 0, onAt = 0) => {
    const grp = new THREE.Group();
    grp.position.set(x, y, z); grp.rotation.set(rx, ry, 0);
    const fr = new THREE.Mesh(bezel(w, h, Math.min(w, h) * 0.18), bezelMat);
    fr.position.z = -0.08;
    grp.add(fr);
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: page(kind), color: 0x000000 }));
    sc.position.z = 0.0;
    grp.add(sc);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.05, metalness: 1, transparent: true, opacity: 0.4 }));
    gl.position.z = 0.02;
    grp.add(gl);
    scene.add(grp);
    items.push({ kind: 'screen', m: sc.material, onAt, level: kind === 'dim' ? 0.35 : 1 });
    return grp;
  };
  // Panel faces: the main dash, the centre stack and the side consoles.
  const dash = new THREE.Mesh(new THREE.BoxGeometry(9, 5, 0.3), faceMat);
  dash.position.set(0, -0.6, -0.4);
  scene.add(dash);
  const stack = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 0.4), faceMat);
  stack.position.set(0, 1.85, -0.15);
  stack.rotation.x = 0.2;
  scene.add(stack);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 1.0), metal(0x15171a, 0.8, 0.2));
  hood.position.set(0, 2.75, 0.2);
  scene.add(hood);
  // Big side displays angled in towards the seat.
  screen(-2.55, -0.45, 0.35, 1.9, 1.75, 'map', 0.42, 0, 0.55);
  screen(2.55, -0.45, 0.35, 1.9, 1.75, 'dim', -0.42, 0, 0.9);
  // Centre stack: a round gauge, the radar page and a narrow green page; lamps below.
  screen(0.0, 1.9, 0.12, 1.15, 0.85, 'radar', 0, 0.2, 0.45);
  screen(0.98, 1.85, 0.12, 0.36, 0.8, 'green', 0, 0.2, 0.62);
  const g1 = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 8, 24), bezelMat);
  g1.position.set(-0.98, 1.92, 0.1);
  scene.add(g1);
  screen(0.12, 0.55, 0.1, 1.1, 0.8, 'green', 0, 0, 0.3);
  // White-noise monitor low in the middle.
  const noise = canvasTexture(64, 48, () => {});
  const noiseCanvas = noise.image;
  const tv = screen(-0.05, -1.45, 0.35, 0.75, 0.6, 'dim', 0, -0.15, 0.2);
  tv.children[1].material.map = noise;
  items[items.length - 1].noise = noiseCanvas;
  const lampCols = [0xffcc30, 0xff3018, 0x30ff60, 0xffcc30];
  const lamp = (x, y, w, h, col, onAt) => {
    const l = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), new THREE.MeshBasicMaterial({ color: 0x0c0c0c }));
    l.position.set(x, y, 0.02);
    scene.add(l);
    items.push({ kind: 'lamp', m: l.material, col: new THREE.Color(col), onAt });
  };
  for (let k = 0; k < 8; k++) lamp(-1.2 + k * 0.32, 1.22, 0.2, 0.1, k === 0 || k === 7 ? 0xff3018 : 0xffcc30, 0.15 + k * 0.03);
  for (let k = 0; k < 4; k++) lamp(0.85 + (k % 2) * 0.25, 0.7 - Math.floor(k / 2) * 0.22, 0.17, 0.12, 0xff3018, 0.4 + k * 0.05);
  const r = seeded(321);
  // Rows of teal push-buttons and coloured status LEDs on both sides of the stack.
  for (const s of [-1, 1]) {
    for (let row = 0; row < 4; row++) for (let c = 0; c < 4; c++) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.06, 12), tealMat);
      b.rotation.x = Math.PI / 2;
      b.position.set(s * (0.85 + c * 0.22), -0.35 - row * 0.24, 0.05);
      scene.add(b);
    }
    for (let k = 0; k < 10; k++) lamp(s * (0.75 + r() * 1.0), -1.3 - r() * 0.9, 0.07, 0.07, lampCols[k % 4], 0.3 + r() * 0.6);
    for (let k = 0; k < 6; k++) lamp(s * (3.55 + (k % 2) * 0.15), 0.5 - Math.floor(k / 2) * 0.3, 0.09, 0.09, lampCols[(k + 1) % 4], 0.5 + r() * 0.4);
  }
  return { scene, items };
}

// S: the dusk run.
function duskSet() {
  const scene = new THREE.Scene();
  const haze = new THREE.Color(0x5e5d4e);
  scene.background = haze;
  scene.fog = new THREE.FogExp2(0x4a4a40, 0.0042);
  scene.add(new THREE.HemisphereLight(0x9aa2b4, 0x26301e, 1.2));
  const sun = new THREE.DirectionalLight(0xffe2b0, 1.4);
  sun.position.set(-20, 30, -100);
  scene.add(sun);
  const front = new THREE.DirectionalLight(0x9aa4b8, 0.8);
  front.position.set(10, 20, 60);
  scene.add(front);
  const skyTex = canvasTexture(8, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#20242e'); grd.addColorStop(0.35, '#2e333c'); grd.addColorStop(0.47, '#5a5a50');
    grd.addColorStop(0.5, '#8a8668'); grd.addColorStop(0.53, '#4a4c40'); grd.addColorStop(1, '#1c2018');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 24), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -2;
  scene.add(sky);
  const cloud = new THREE.Mesh(new THREE.SphereGeometry(880, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2 - 0.03),
    new THREE.MeshBasicMaterial({ map: repeatOf(cloudTex, 4, 1), color: 0x9a96a0, side: THREE.BackSide, fog: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
  cloud.renderOrder = -1;
  scene.add(cloud);
  const landTex = canvasTexture(256, 256, (g, w, h) => {
    const r = seeded(17);
    g.fillStyle = '#1c2418'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = r() * w, y = r() * h, rad = 4 + r() * 22;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      const k = r();
      grd.addColorStop(0, k < 0.5 ? 'rgba(10,14,8,0.5)' : 'rgba(60,70,50,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }, { repeat: [40, 40] });
  const land = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: landTex, color: 0x8a9080, roughness: 1 }));
  land.rotation.x = -Math.PI / 2;
  scene.add(land);
  const heli = makeHeli({ color: 0x8c929a, skin: '#a4aab2' });
  scene.add(heli);
  // Four missiles, each laying a trail of puffs that start fiery red and cool to white.
  const r = seeded(808);
  const missiles = heli.userData.missiles.map((src, i) => {
    const m = makeMissile();
    m.visible = false;
    m.scale.setScalar(1);
    scene.add(m);
    const puffs = [];
    for (let k = 0; k < 70; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.userData = { jx: (r() - 0.5) * 0.5, jy: (r() - 0.5) * 0.5, sz: 0.6 + r() * 0.5 };
      scene.add(s);
      puffs.push(s);
    }
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    scene.add(flash);
    return { m, puffs, flash, src, i };
  });
  return { scene, heli, missiles, sky, cloud };
}

// T: the logo.
function logoSet() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const tex = canvasTexture(1024, 320, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.save();
    g.translate(70, 232);
    g.transform(1, 0, -0.38, 1, 0, 0);
    g.scale(1.32, 1);
    g.font = '900 196px "Arial Black", Impact, sans-serif';
    const chrome = g.createLinearGradient(0, -150, 0, 4);
    chrome.addColorStop(0, '#f4f8ff'); chrome.addColorStop(0.28, '#b8c8e0'); chrome.addColorStop(0.46, '#6a7c98');
    chrome.addColorStop(0.52, '#2a3446'); chrome.addColorStop(0.62, '#7c90b0'); chrome.addColorStop(0.85, '#d0dcf0'); chrome.addColorStop(1, '#8a9ab4');
    g.lineJoin = 'round';
    g.lineWidth = 14; g.strokeStyle = '#05070a'; g.strokeText('SWIV', 0, 0);
    g.lineWidth = 4; g.strokeStyle = '#a8bcd8'; g.strokeText('SWIV', 0, 0);
    g.fillStyle = chrome; g.fillText('SWIV', 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(-60, -118, 900, 7);
    g.fillStyle = 'rgba(20,30,50,0.35)';
    g.fillRect(-60, -60, 900, 18);
    g.restore();
    // The "3D" gunsight at the foot of the V.
    const cx = 908, cy = 238;
    g.strokeStyle = '#b8c4d4'; g.lineWidth = 5;
    g.beginPath(); g.arc(cx, cy, 34, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 3;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) { g.beginPath(); g.moveTo(cx + dx * 26, cy + dy * 26); g.lineTo(cx + dx * 56, cy + dy * 56); g.stroke(); }
    g.font = '900 30px "Arial Black", Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#dfe8f4'; g.fillText('3D', cx, cy + 2);
  });
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(10.24, 3.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
  scene.add(logo);
  return { scene, logo };
}

// ------------------------------------------------------------------ timeline

/** Piecewise-linear value over time from [t, v] keys. */
function keyed(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    if (t <= t1) return lerp(v0, v1, (t - t0) / (t1 - t0));
  }
  return keys[keys.length - 1][1];
}

/** The integral of a piecewise-linear speed (rad/s) from keys[0][0] to t: a rotor's angle. */
function spun(t, keys) {
  let a = 0;
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, s0] = keys[i], [t1, s1] = keys[i + 1];
    if (t <= t0) break;
    const d = Math.min(t, t1) - t0;
    a += s0 * d + 0.5 * (s1 - s0) / (t1 - t0) * d * d;
  }
  const [tl, sl] = keys[keys.length - 1];
  if (t > tl) a += sl * (t - tl);
  return a;
}

/** Catmull-Rom through [t, x, y, z] keys. */
function track(t, keys) {
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
  const k0 = keys[Math.max(0, i - 1)], k1 = keys[i], k2 = keys[i + 1], k3 = keys[Math.min(keys.length - 1, i + 2)];
  const u = clamp01((t - k1[0]) / (k2[0] - k1[0]));
  const cr = (a, b, c, d) => 0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
  return V(cr(k0[1], k1[1], k2[1], k3[1]), cr(k0[2], k1[2], k2[2], k3[2]), cr(k0[3], k1[3], k2[3], k3[3]));
}

/** INTRO1 frames where the sign's tube is dark. */
const TUBE_OFF = new Set([34, 37, 55, 62, 65, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 81, 84, 85]);

// Hangar clock: lights, lift, rotor.
const LEFT_ON = B(46), RIGHT_ON = B(64), BEACONS_ON = B(283);
const ROTOR = [[B(214), 0], [B(274), 3.2], [B(300), 14], [B(345), 30]];
const heliLift = (t) => 3.58 + 3.9 * smooth(span(t, B(277), B(470))) + 0.06 * Math.sin(t * 2.3) * span(t, B(300), B(330));
// Dusk clock, seconds from the first frame of S.
const S0 = B(661);
const DUSK_PATH = [
  [0.0, -26, 40.6, -24], [1.2, -14, 40.4, -16], [2.15, -3, 40.0, -11], [2.75, 2.5, 40.2, -16],
  [3.6, 5, 40.8, -32], [5.0, 8, 41.6, -62], [6.3, 10, 42.0, -82], [7.2, 9, 41.8, -78],
  [8.6, 6.5, 41.2, -56], [10.0, 5.5, 41.0, -44], [11.4, 5.4, 41.1, -42], [12.3, 5.2, 41.5, -40],
  [13.0, 4, 45, -27], [13.7, 2.5, 52, -10], [14.5, 1, 58, 6],
];
const DUSK_YAW = [[0, Math.PI / 2 + 0.25], [1.8, Math.PI / 2 + 0.1], [2.5, Math.PI - 0.35], [3.4, Math.PI - 0.15], [5.6, Math.PI - 0.2], [6.4, Math.PI + 0.7], [7.3, 2 * Math.PI - 0.6], [8.6, 2 * Math.PI - 0.12], [14, 2 * Math.PI - 0.1]];
const DUSK_BANK = [[0, 0.12], [1.8, 0.1], [2.4, -0.5], [3.2, -0.2], [5.6, 0], [6.3, -0.55], [7.3, -0.5], [8.4, 0.05], [10, 0], [12.3, 0], [13.3, 0]];
const DUSK_PITCH = [[0, 0.12], [2.4, 0.18], [5, 0.15], [7.5, 0.05], [8.6, -0.12], [10, 0.05], [12.4, 0.05], [13.2, -0.5], [14.5, -0.5]];
const FIRE_AT = B(822) - S0;

/**
 * Build the intro's sets for `renderer`. Returns { length, render(t) }: render(t) draws the
 * frame for time t (seconds) into the renderer's canvas, cuts, dissolves and fades included.
 */
export function createIntro(renderer) {
  const cam = new THREE.PerspectiveCamera(50, 4 / 3, 0.05, 2400);
  const sign = signSet();
  const base = baseSet();
  const hall = hangarSet();
  const pit = cockpitSet();
  const dusk = duskSet();
  const logo = logoSet();

  // Reflection environments so metal and glass pick up something of their surroundings.
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
  sign.scene.environment = base.scene.environment = envFrom(C(0x2a2c48), C(0x121420), C(0x080808), [[-4, 6, -8, 3, 3, 1.2]]);
  sign.scene.environmentIntensity = base.scene.environmentIntensity = 0.5;
  hall.scene.environment = envFrom(C(0x2a2a28), C(0x14130f), C(0x0a0806), [[0, 9, 0, 2, 14, 3], [-9, -1, 0, 1, 14, 1], [9, -1, 0, 1, 14, 1]]);
  hall.scene.environmentIntensity = 0.7;
  pit.scene.environment = hall.scene.environment;
  dusk.scene.environment = envFrom(C(0x4a5060), C(0x9a9070), C(0x22281c), [[0, 1, -9, 8, 2, 1.6]]);
  dusk.scene.environmentIntensity = 0.9;
  pmrem.dispose();

  // Full-screen passes: the outgoing shot of a dissolve, and black / white fades.
  const overlay = new THREE.Scene();
  const ocam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = (mat) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); m.frustumCulled = false; overlay.add(m); return m; };
  let grab = null;
  const dissolveMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: null }, opacity: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D map; uniform float opacity; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb, opacity); }',
    transparent: true, depthTest: false, depthWrite: false,
  });
  const dissolveQuad = quad(dissolveMat);
  const fadeQuad = quad(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));

  const look = (p, q, fov = 50) => { cam.position.set(...p); cam.up.set(0, 1, 0); cam.lookAt(...q); cam.fov = fov; };
  const frameNo = (t) => Math.floor(t / FRAME + 1e-6) + 1;

  // ---------------------------------------------------------------- INTRO1
  function shotSign(t) {
    const on = !TUBE_OFF.has(frameNo(t));
    sign.tube.material.color.setHex(on ? 0xffffff : 0x2c2e32);
    sign.glow.material.opacity = on ? 0.55 : 0;
    sign.lamp.intensity = on ? 9 : 0;
    sign.spill.intensity = on ? 1.6 : 0;
    look([0.42, 1.6, 2.6], [0.42, 1.74, 0], 41);
    cam.updateMatrixWorld();
    placeMoon(sign.moon, cam, -0.4, -0.4);
    sign.sky.position.copy(cam.position);
    return { scene: sign.scene, black: 1 - span(t, A(4.5), A(14)) };
  }

  function shotApron(t) {
    const T = t - A(107);
    path(cam, T, [[0, [-2.5, 1.25, 10.5], [-5, 2.0, -6], 48], [4.2, [13, 1.3, 9.5], [10, 2.0, -7], 48]], false);
    base.pool.intensity = 2600;
    base.pool.target.position.set(SET.apron + lerp(-4, 26, span(T, 0, 2.8)), 0, lerp(3, 6, span(T, 0, 2.8)));
    base.pool.target.updateMatrixWorld();
    return { scene: night(t) };
  }

  function shotHigh(t) {
    const T = t - A(158);
    const X = SET.high;
    path(cam, T, [[0, [X + 9, 17, 24], [X - 1, 0, -2], 46], [4.0, [X + 7, 16, 22], [X - 2, 0.5, -2], 46]], false);
    base.pool.intensity = 0;
    return { scene: night(t) };
  }

  function shotMoon(t) {
    const T = t - A(207);
    const X = SET.moon;
    path(cam, T, [[0, [X + 1, 1.8, 6], [X + 2.4, 6.5, -40], 50], [7.6, [X + 1.6, 1.8, 6], [X + 4, 6.5, -40], 50]], false);
    const tw = base.moonTower.userData;
    const lit = t >= A(244) ? 1 : 0;
    tw.beam.material.opacity = lit * 0.16;
    tw.glow.material.color.setScalar(lit ? 1 : 0.12);
    tw.spot.intensity = lit * 4000;
    const yaw = keyed(t, [[A(244), -1.3], [A(258), -1.05], [A(263), -0.25], [A(266), 0.6], [A(272), 1.25], [A(287), 1.4], [A(292), 0.7], [A(296), -0.4], [A(310), -1.0]]);
    tw.head.rotation.set(0.13, yaw, 0);
    const k = span(t, A(250), A(300));
    base.moonTanker.position.set(X + lerp(15, 9.2, k), 0, lerp(-3, 1.5, k));
    base.moonTanker.rotation.y = -Math.PI / 2 - 0.55;
    base.pool.intensity = 0;
    return { scene: night(t), black: span(t, A(298), A(310)) };
  }

  /** Shared state of the night base for this frame. */
  function night(t) {
    cam.updateMatrixWorld();
    base.sky.position.copy(cam.position);
    placeMoon(base.moon, cam, t < A(207) ? 0.2 : 0.29, t < A(207) ? -0.3 : 0.2);
    const tw = base.moonTower.userData;
    if (t < A(207)) { tw.beam.material.opacity = 0; tw.spot.intensity = 0; }
    return base.scene;
  }

  // ---------------------------------------------------------------- INTRO2: inside
  function hallState(t) {
    const h = hall;
    for (const [s, at] of [[-1, LEFT_ON], [1, RIGHT_ON]]) {
      const on = t >= at ? 1 : 0;
      h.uplights[s].wash.opacity = on * 0.85;
      h.uplights[s].lamp.color.setScalar(on ? 1 : 0.06);
      h.uplights[s].fill.forEach((l) => { l.intensity = on * 14; });
    }
    const bOn = t >= BEACONS_ON ? 1 : 0;
    h.beacons.forEach((b, k) => {
      const a = b.a + Math.PI / 2 + (t - BEACONS_ON) * 4.2 + k * 0.7;
      b.head.rotation.set(-0.35, a, 0);
      b.beam.material.opacity = bOn * 0.22;
      b.lens.material.color.setHex(bOn ? 0xffb030 : 0x2a1a08);
    });
    h.amber.forEach((l, i) => {
      const b = h.beacons[i ? 1 : 2];
      l.intensity = bOn * 60;
      l.position.copy(b.head.position);
      const d = V(0, 0, 1).applyEuler(b.head.rotation);
      l.target.position.copy(b.head.position).addScaledVector(d, 6);
      l.target.updateMatrixWorld();
    });
    const y = heliLift(t);
    h.heli.position.set(0, y, 0);
    h.heli.rotation.set(0, keyed(t, [[B(422), 0], [B(507), 0.5]]), 0);
    const speed = keyed(t, ROTOR);
    setRotor(h.heli, spun(t, ROTOR), speed);
    const fold = smooth(span(t, B(380), B(418)));
    h.clamps.forEach((c) => { c.rotation.x = fold * 1.25; });
    h.heli.userData.missiles.forEach((m) => { m.position.copy(m.userData.home); m.rotation.set(0, 0, 0); m.visible = true; m.userData.flame.material.opacity = 0; });
    h.shot.visible = false;
    h.motor.intensity = 0;
    return h.scene;
  }

  function shotHall(t) {
    const scene = hallState(t);
    if (t < B(31)) look([0, 3.0, 20], [0, 3.6, 0], 52);
    else if (t < B(57)) path(cam, t - B(31), [[0, [4.5, 2.4, 13], [-9, 4.2, 1], 52], [1.85, [4.2, 2.4, 12.6], [-9, 4.2, 0.6], 52]], false);
    else if (t < B(74)) path(cam, t - B(57), [[0, [-4.5, 2.4, 13], [9, 4.2, 1], 52], [1.2, [-4.3, 2.4, 12.7], [9, 4.2, 0.8], 52]], false);
    else if (t < B(118)) look([0, 3.2, 21.5], [0, 3.6, 0], 54);
    return { scene };
  }

  function shotCockpit(t) {
    const k = (t - B(118)) / (B(208) - B(118));
    const wake = span(t, B(170), B(202));
    for (const it of pit.items) {
      const on = wake > it.onAt ? 1 : 0;
      if (it.kind === 'screen') {
        const flick = on && wake - it.onAt < 0.06 ? 0.5 : 1;
        it.m.color.setScalar(on ? it.level * flick * 0.9 : 0.04);
        if (it.noise && on) {
          const g = it.noise.getContext('2d');
          const img = g.createImageData(64, 48);
          const r = seeded(1 + frameNo(t));
          for (let i = 0; i < 64 * 48; i++) { const v = 90 + r() * 165; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
          g.putImageData(img, 0, 0);
          it.m.map.needsUpdate = true;
        }
      } else {
        it.m.color.copy(on ? it.col : C(0x0c0c0c));
      }
    }
    look([lerp(0.15, -0.05, k), 0.35, 6.4], [0, 0.3, 0], 50);
    return { scene: pit.scene };
  }

  function shotRotor(t) {
    const scene = hallState(t);
    look([1.4, 6.9, -5.4], [-0.2, 4.6, 1.2], 50);
    return { scene };
  }

  function shotLift(t) {
    const scene = hallState(t);
    path(cam, t - B(275), [[0, [4.2, 0.85, 9.8], [0.2, 2.6, 0], 50], [3.6, [4.2, 0.95, 9.6], [0.2, 3.0, 0], 50]], false);
    return { scene };
  }

  function shotUnder(t) {
    const scene = hallState(t);
    path(cam, t - B(326), [[0, [-3, 2.4, 6], [8, 6.6, -9], 52], [3.2, [-3.3, 2.4, 5.6], [8, 6.6, -9.4], 52]], false);
    return { scene };
  }

  function shotClamps(t) {
    const scene = hallState(t);
    path(cam, t - B(371), [[0, [2.5, 2.9, 3.1], [-0.3, 2.9, 0.1], 50], [3.6, [2.4, 2.9, 3.0], [-0.3, 2.9, 0.1], 50]], false);
    return { scene };
  }

  function shotHover(t) {
    const scene = hallState(t);
    path(cam, t - B(422), [
      [0, [7.5, 1.6, 6.5], [0, 6.2, 0.5], 52], [2.6, [3.6, 3.5, 1.2], [-0.5, 7.0, -0.5], 52],
      [4.0, [6.2, 4.4, -3], [0, 7.0, 0], 52], [6.0, [10.5, 4.2, -13], [0, 6.6, 0], 52],
    ], true);
    return { scene };
  }

  function shotDrop(t) {
    const scene = hallState(t);
    const h = hall.heli;
    h.updateMatrixWorld();
    const m = h.userData.missiles.find((x) => x.userData.side === 1 && x.userData.slot === 1);
    const drop = span(t, B(529), B(546));
    const T = Math.max(0, t - B(548));
    m.position.copy(m.userData.home).add(V(0, -0.32 * drop * drop, -0.5 * drop + 30 * T * T));
    m.userData.flame.material.opacity = t >= B(546) ? 0.6 + 0.4 * Math.sin(t * 70) : 0;
    m.userData.flame.scale.setScalar(t >= B(546) ? 0.6 + 0.6 * span(t, B(546), B(551)) : 0.1);
    const p = (x, y, z) => V(x, y, z).applyMatrix4(h.matrixWorld);
    cam.position.copy(p(1.62, -1.5, -0.55));
    cam.up.copy(V(0, 0, 1).transformDirection(h.matrixWorld));
    cam.lookAt(p(1.78, 0.2, 0.25));
    cam.fov = 52;
    const mp = V().setFromMatrixPosition(m.matrixWorld);
    hall.motor.position.copy(mp);
    hall.motor.intensity = t >= B(546) ? 12 : 0;
    return { scene };
  }

  function shotStreak(t) {
    const scene = hallState(t);
    const T = t - B(555);
    hall.heli.userData.missiles.find((x) => x.userData.side === 1 && x.userData.slot === 1).visible = false;
    const s = hall.shot;
    s.visible = true;
    s.position.set(-4, 4.6, -6 + T * 26);
    s.rotation.set(0, 0, T * 2);
    s.userData.flame.material.opacity = 0.9;
    s.userData.flame.scale.setScalar(1.1);
    hall.motor.position.copy(s.position).add(V(0, 0, -1));
    hall.motor.intensity = 16;
    const wob = Math.sin(T * 5) * 0.9;
    look([3.2, 4.4, s.position.z - 0.3 + wob], [-12, 4.3, s.position.z - 0.3 + wob], 34);
    return { scene };
  }

  // ---------------------------------------------------------------- INTRO2: outside
  function shotOutside(t) {
    const O = SET.out;
    look([O - 1.2, 2.0, 7], [O + 1.5, 5.6, -30], 50);
    cam.updateMatrixWorld();
    base.sky.position.copy(cam.position);
    placeMoon(base.moon, cam, 0.79, 0.06);
    const hg = base.hangar.userData;
    const blown = t >= B(597);
    hg.door.visible = !blown;
    hg.front.visible = !blown;
    const F = t - B(596);
    // White core with rays, swelling then collapsing into the fire.
    const flash = F < 0 ? 0 : F < 0.2 ? F / 0.2 : Math.max(0, 1 - (F - 0.7) / 0.6);
    base.core.material.opacity = flash;
    base.core.scale.setScalar(lerp(10, 46, smooth(F / 0.3)) * (F > 0.7 ? lerp(1, 0.6, span(F, 0.7, 1.3)) : 1));
    base.outLight.position.set(O, 5, -18);
    const fireLevel = smooth(span(t, B(608), B(622))) * lerp(1, 0.75, span(t, B(622), B(660)));
    base.outLight.color.setRGB(lerp(1, 1, fireLevel), lerp(1, 0.55, fireLevel), lerp(1, 0.25, fireLevel));
    base.outLight.intensity = flash * 900 + fireLevel * (260 + 50 * Math.sin(t * 31) + 30 * Math.sin(t * 13));
    base.hemi.intensity = 0.5 + flash * 2.2;
    for (const f of base.fire) {
      const u = f.userData;
      const age = ((F + u.phase) % u.life) / u.life;
      f.position.set(O + u.x + u.vx * age * u.life, 1 + u.y * 0.5 + u.vy * age * u.life, -32 + u.z);
      f.material.opacity = F > 0.8 ? Math.sin(age * Math.PI) * fireLevel * 0.9 : 0;
      const sz = u.size * (0.6 + age);
      f.scale.set(sz, sz, 1);
    }
    for (const s of base.smoke) {
      const u = s.userData;
      const age = ((F + u.phase) % u.life) / u.life;
      s.position.set(O + u.x, 8 + u.vy * age * u.life, -34 + u.z);
      s.material.opacity = F > 1 ? Math.sin(age * Math.PI) * 0.55 * fireLevel : 0;
      s.scale.setScalar(u.size * (0.7 + age));
    }
    base.debris.forEach((d) => {
      const T = t - B(598);
      d.visible = T > 0;
      if (T <= 0) return;
      const u = d.userData;
      d.position.set(u.p.x + u.v.x * T, Math.max(0.05, u.p.y + u.v.y * T - 11 * T * T), u.p.z + u.v.z * T);
      d.rotation.set(u.w.x * T, u.w.y * T, u.w.z * T);
    });
    // The gunship bursts out of the fire and away to the right.
    const H = base.heli;
    const k = span(t, B(626), B(660));
    H.visible = t >= B(626);
    const p = track(k, [[0, O - 1, 4.5, -36], [0.35, O + 2.5, 5.2, -26], [0.65, O + 8.5, 7.0, -19], [1, O + 17, 10, -12]]);
    H.position.copy(p);
    H.rotation.set(0.15, lerp(0.15, 1.0, k), lerp(0, -0.35, k));
    setRotor(H, t * 30, 30);
    return { scene: base.scene, black: span(t, B(650), B(659)), white: flash * 0.35 };
  }

  // ---------------------------------------------------------------- dusk
  function shotDusk(t) {
    const T = t - S0;
    const H = dusk.heli;
    H.position.copy(track(T, DUSK_PATH));
    H.rotation.set(keyed(T, DUSK_PITCH), keyed(T, DUSK_YAW), keyed(T, DUSK_BANK), 'YXZ');
    setRotor(H, t * 26, 30);
    // Camera: pans with the fly-by, then holds on the horizon ahead.
    const yaw = keyed(T, [[0, 0.55], [1.2, 0.3], [2.2, -0.05], [2.9, -0.2], [4, -0.24], [14, -0.24]]);
    const pitch = keyed(T, [[0, 0.02], [3, 0.0], [12.3, 0.0], [13.2, 0.04], [14, 0.06]]);
    cam.position.set(0, 40, 0);
    cam.up.set(0, 1, 0);
    cam.lookAt(-Math.sin(yaw) * 100, 40 + Math.sin(pitch) * 100 - 6, -Math.cos(yaw) * 100);
    cam.fov = 46;
    dusk.sky.position.copy(cam.position);
    dusk.cloud.position.copy(cam.position);
    H.updateMatrixWorld();
    // Missiles: off the rails at FIRE_AT, out past the lens in a spreading X.
    const out = [V(-9, 5, 6), V(-11, -6, 4), V(9, 6, 6), V(12, -5, 5)];
    for (const ms of dusk.missiles) {
      const order = [1, 0, 3, 2][ms.i];
      const f0 = FIRE_AT + order * 0.07;
      const F = T - f0;
      const start = V().setFromMatrixPosition(ms.src.matrixWorld);
      ms.src.visible = F < 0;
      const end = cam.position.clone().add(out[ms.i]);
      const along = (u) => start.clone().lerp(end, u).add(V(Math.sin(u * 9 + ms.i) * 0.8, Math.cos(u * 7 + ms.i) * 0.6, 0).multiplyScalar(u));
      const u = F < 0 ? 0 : Math.min(1.2, F * F * 2.2 + F * 0.6);
      ms.m.visible = F > 0 && u < 1.05;
      if (ms.m.visible) {
        ms.m.position.copy(along(u));
        ms.m.lookAt(along(u + 0.05));
        ms.m.userData.flame.material.opacity = 1;
        ms.m.userData.flame.scale.setScalar(1.4);
      }
      ms.flash.position.copy(start);
      ms.flash.material.opacity = F > 0 && F < 0.25 ? 1 - F / 0.25 : 0;
      ms.flash.scale.setScalar(3.5);
      ms.puffs.forEach((p, j) => {
        const pu = (j / ms.puffs.length) * 1.05;
        const born = F < 0 ? Infinity : Math.sqrt(Math.max(0, pu / 2.2));
        const age = F - born;
        p.visible = age > 0;
        if (!p.visible) return;
        const q = along(pu);
        p.position.set(q.x + p.userData.jx * (1 + age), q.y + p.userData.jy * (1 + age) + age * 0.3, q.z);
        const hot = clamp01(1 - age / 0.9);
        p.material.color.setRGB(lerp(0.85, 1, hot), lerp(0.82, 0.35, hot), lerp(0.85, 0.22, hot));
        p.material.opacity = 0.75 * clamp01(1 - age / 3.2);
        p.scale.setScalar(p.userData.sz * (1 + age * 1.6));
      });
    }
    return { scene: dusk.scene, black: 1 - span(t, B(658), B(668)) };
  }

  function shotLogo(t) {
    const fade = span(t, B(860), B(871));
    logo.scene.background.setScalar(lerp(0.75, 0, fade));
    look([0, 0.15, 11.6], [0, 0.15, 0], 40);
    return { scene: logo.scene, white: 1 - span(t, B(860), B(861.5)), black: span(t, B(937), B(946)) };
  }

  // Shot list: [from, to, draw]. Overlapping neighbours dissolve across the overlap.
  const shots = [
    [A(1), A(107), shotSign],
    [A(107), A(165), shotApron],
    [A(158), A(214), shotHigh],
    [A(207), B(1), shotMoon],
    [B(1), B(118), shotHall],
    [B(118), B(208), shotCockpit],
    [B(208), B(275), shotRotor],
    [B(275), B(326), shotLift],
    [B(326), B(371), shotUnder],
    [B(371), B(422), shotClamps],
    [B(422), B(507), shotHover],
    [B(507), B(555), shotDrop],
    [B(555), B(570), shotStreak],
    [B(570), B(661), shotOutside],
    [B(661), B(860), shotDusk],
    [B(860), INTRO_LENGTH + 1, shotLogo],
  ];

  const size = new THREE.Vector2();
  function draw(shot, t) {
    cam.up.set(0, 1, 0);
    const r = shot[2](t);
    cam.aspect = size.x / size.y;
    cam.updateProjectionMatrix();
    renderer.render(r.scene, cam);
    return r;
  }

  function render(t) {
    renderer.getDrawingBufferSize(size);
    const live = shots.filter(([a, b]) => t >= a && t < b);
    if (!live.length) { renderer.setClearColor(0x000000); renderer.clear(); return; }
    let r;
    renderer.autoClear = true;
    if (live.length > 1) {
      const [out, inc] = live;
      const k = span(t, inc[0], out[1]);
      draw(out, t);
      if (!grab || grab.image.width !== size.x || grab.image.height !== size.y) {
        grab?.dispose();
        grab = new THREE.FramebufferTexture(size.x, size.y);
      }
      renderer.copyFramebufferToTexture(grab);
      r = draw(inc, t);
      dissolveMat.uniforms.map.value = grab;
      dissolveMat.uniforms.opacity.value = 1 - k;
      dissolveQuad.visible = true;
      fadeQuad.visible = false;
      renderer.autoClear = false;
      renderer.render(overlay, ocam);
    } else {
      r = draw(live[0], t);
    }
    const black = r.black ?? 0, white = r.white ?? 0;
    if (black > 0 || white > 0) {
      dissolveQuad.visible = false;
      fadeQuad.visible = true;
      fadeQuad.material.color.setScalar(white > black ? 1 : 0);
      fadeQuad.material.opacity = Math.max(black, white);
      renderer.autoClear = false;
      renderer.render(overlay, ocam);
    }
    renderer.autoClear = true;
  }

  return { length: INTRO_LENGTH, render };
}

// ------------------------------------------------------------------ audio

/**
 * Without the videos' soundtrack, a few of the game's own effects stand in for it.
 * Returns { stop() }.
 */
function fallbackAudio(ctx, sounds, out, offset) {
  const started = [];
  const t0 = ctx.currentTime - offset;
  const play = (id, at, { volume = 1, rate = 1 } = {}) => {
    const buf = sounds?.get(id);
    if (!buf || at < offset) return;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = volume;
    src.connect(g).connect(out);
    src.start(t0 + at);
    started.push(src);
  };
  play(6004, B(46), { volume: 0.7, rate: 0.6 });
  play(6004, B(64), { volume: 0.7, rate: 0.6 });
  for (let k = 0; k < 6; k++) play(6002, B(172) + k * 0.25, { volume: 0.35, rate: 1.4 });
  play(1001, B(596), { volume: 1 });
  play(1003, B(598), { volume: 0.8, rate: 0.8 });
  play(1000, B(612), { volume: 0.6 });
  for (let k = 0; k < 4; k++) play(2001, B(822) + k * 0.07, { volume: 0.8, rate: 1 + k * 0.03 });
  return started;
}

// ------------------------------------------------------------------ player

/**
 * Play the intro over the page. Resolves when it ends or is skipped (any key, click or tap).
 * `audio` is { ctx, master, sounds: Map(effect id -> AudioBuffer), soundtrack?: AudioBuffer }
 * or null; with `soundtrack` (the videos' own audio) the picture follows its clock.
 */
export function playIntro(audio) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.id = 'intro';
    const canvas = document.createElement('canvas');
    const skip = document.createElement('div');
    skip.className = 'intro-skip';
    skip.textContent = 'Press any key to skip';
    wrap.append(canvas, skip);
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
    renderer.toneMappingExposure = 1.1;
    const resize = () => renderer.setSize(innerWidth, innerHeight, false);
    resize();
    addEventListener('resize', resize);
    const intro = createIntro(renderer);

    const offset = +(new URLSearchParams(location.search).get('introAt') ?? 0);
    let clock;
    const stops = [];
    if (audio?.ctx) {
      const { ctx } = audio;
      const out = ctx.createGain();
      out.connect(audio.master);
      stops.push(() => { out.gain.setTargetAtTime(0, ctx.currentTime, 0.08); setTimeout(() => out.disconnect(), 400); });
      const at = ctx.currentTime + 0.05;
      if (audio.soundtrack) {
        const src = ctx.createBufferSource();
        src.buffer = audio.soundtrack;
        src.connect(out);
        src.start(at, offset);
        stops.push(() => { try { src.stop(ctx.currentTime + 0.4); } catch { /* ended */ } });
      } else {
        const started = fallbackAudio(ctx, audio.sounds, out, offset);
        stops.push(() => started.forEach((s) => { try { s.stop(ctx.currentTime + 0.4); } catch { /* ended */ } }));
      }
      // Follow the audio clock so picture and sound stay locked together.
      clock = () => Math.max(0, ctx.currentTime - at) + offset;
    } else {
      const start = performance.now() - offset * 1000;
      clock = () => (performance.now() - start) / 1000;
    }

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      stops.forEach((s) => s());
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

    function frame() {
      if (done) return;
      const t = clock();
      if (t >= intro.length) { finish(); return; }
      intro.render(t);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
