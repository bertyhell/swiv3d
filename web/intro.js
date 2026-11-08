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
//   I 118-207  the cockpit wakes up (cockpit.js, shared with the briefing)
//   J 208-274  over the rotor head; the blades start to turn
//   K 275-325  at the pad: amber beacons turn, the rotor runs up; the gunship is still clamped
//   L 326-370  from below, rotor at full speed against the wall
//   M 371-421  the clamp jaws let go and the gunship lifts off
//   N 422-506  orbiting the gunship as it climbs to a hover over the pad
//   O 507-554  under the wing: a missile drops off the rail and lights its motor
//   P 555-569  the missile streaks down the hangar
//   Q 570-595  outside: the hangar, the tower, a tanker
//   R 596-660  the hangar blows apart; the gunship flies out of the fire; fade to black
//   S 661-859  dusk: it buzzes the camera, flies off, turns, hovers and fires four missiles
//              past the lens, then climbs out over the camera
//   T 860-957  white flash to the chrome SWIV 3D logo; fade out
import * as THREE from './vendor/three.module.min.js';
import { SIGN_ICONS } from './signIcons.js';
import { cockpitScene, COCKPIT_VIEW } from './cockpit.js';

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
/** Pull a section point in onto the line |x|/w + |y|/h = 2 - ch, flattening the corners. */
function chamfer(x, y, w, h, ch) {
  const t = Math.abs(x) / w + Math.abs(y) / h, lim = 2 - ch;
  return t > lim ? [x * lim / t, y * lim / t] : [x, y];
}

function loft(sections, segs = 28) {
  const pos = [], uv = [], idx = [];
  const ring = segs + 1;
  sections.forEach((s, j) => {
    const n = s.n ?? 2.6, e = 2 / n;
    for (let i = 0; i <= segs; i++) {
      const a = i / segs * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      let x = Math.sign(c) * Math.abs(c) ** e * s.w;
      let y = Math.sign(sn) * Math.abs(sn) ** e * s.h * (sn > 0 ? (s.top ?? 1) : (s.bot ?? 1));
      // `ch`: cut the corners off flat (a chamfer), as on the gunship's nose.
      if (s.ch) [x, y] = chamfer(x, y, s.w, s.h * (sn > 0 ? (s.top ?? 1) : (s.bot ?? 1)), s.ch);
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
  // Caps face outward; the winding depends on which way the sections run along z.
  const desc = sections[0].z > sections[sections.length - 1].z;
  for (const [j, flip] of [[0, !desc], [sections.length - 1, desc]]) {
    // The cap gets its own copy of the end ring so its normals stay flat and don't bend the
    // hull's shading at the rim.
    const s = sections[j];
    const c = pos.length / 3;
    pos.push(0, s.y ?? 0, s.z); uv.push(0.5, j ? 1 : 0);
    for (let i = 0; i <= segs; i++) {
      const k = (j * ring + i) * 3;
      pos.push(pos[k], pos[k + 1], pos[k + 2]); uv.push(0.5, j ? 1 : 0);
    }
    for (let i = 0; i < segs; i++) {
      const a = c + 1 + i;
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

/**
 * Corrugated sheet: pushes each vertex out along `dir(x, y, z)` (a unit offset direction) by a
 * rounded sine wave of the coordinate `along(x, y, z)`, then re-derives normals so the ridges
 * catch the light like the wavy steel cladding on old hangars.
 */
function corrugate(geo, pitch, depth, along, dir) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = depth * Math.sin(along(x, y, z) / pitch * Math.PI * 2);
    const [dx, dy, dz] = dir(x, y, z);
    p.setXYZ(i, x + dx * d, y + dy * d, z + dz * d);
  }
  geo.computeVertexNormals();
  return geo;
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

const glassMat = () => new THREE.MeshStandardMaterial({ color: 0x6a6a64, roughness: 0.22, metalness: 0.75, envMapIntensity: 1.8 });
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

/**
 * One chain-link diamond: round galvanised wire (dark edge, bright core) zig-zagging down,
 * with the neighbouring wires hooked round each other at the left and right corners.
 */
const fenceTex = canvasTexture(128, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const wire = (path) => {
    for (const [lw, col] of [[7, 'rgba(70,74,80,1)'], [4.5, 'rgba(150,155,162,1)'], [1.6, 'rgba(225,230,236,1)']]) {
      g.lineWidth = lw; g.strokeStyle = col; path(); g.stroke();
    }
  };
  // The four sides, slightly wavy as stretched wire is, stopping short of the hooked corners.
  const side = (x0, y0, x1, y1) => () => {
    g.beginPath(); g.moveTo(x0, y0);
    g.quadraticCurveTo((x0 + x1) / 2 + (y1 - y0) * 0.05, (y0 + y1) / 2 - (x1 - x0) * 0.05, x1, y1);
  };
  const m = 5;
  wire(side(m, h / 2 - m, w / 2, 0)); wire(side(w / 2, 0, w - m, h / 2 - m));
  wire(side(m, h / 2 + m, w / 2, h)); wire(side(w / 2, h, w - m, h / 2 + m));
  // Hooks: each wire bends round its neighbour in a tight loop at the side corners.
  for (const cx of [0, w]) {
    wire(() => { g.beginPath(); g.moveTo(cx - m, h / 2 - m); g.bezierCurveTo(cx + 4, h / 2 - 6, cx + 5, h / 2 + 2, cx - 1, h / 2 + 3); });
    wire(() => { g.beginPath(); g.moveTo(cx + m, h / 2 + m); g.bezierCurveTo(cx - 4, h / 2 + 6, cx - 5, h / 2 - 2, cx + 1, h / 2 - 3); });
  }
});

/**
 * Real chain-link, modelled: a row of zig-zag pickets `s` apart, each a flattened helix whose
 * runs alternate in front of and behind the fence plane. At every bend a picket overshoots its
 * neighbour's bend and the two hooks thread through each other: each passes in front of the
 * other above the joint and behind it below. One picket period (two bends, mid-run to mid-run,
 * so the ends meet seamlessly) is tubed once and instanced over x0..x1, y0..y1.
 */
function chainLink(x0, x1, y0, y1, mat, { s = 0.17, H = 0.32, r = 0.009 } = {}) {
  const o = 0.02;       // how far each bend reaches past its neighbour's
  const d = 0.018;      // fillet length either side of a bend (a bend radius of ~1.5 wire radii)
  const D = 0.04;       // densely sampled zone round each bend
  const c = 0.016;      // height over which the wire swaps sides of the plane at a bend
  const amp = r * 1.08; // the two wires just touch where they cross
  const P0 = new THREE.Vector2(s / 2, H / 4), C1 = new THREE.Vector2(s + o, 0);
  const C2 = new THREE.Vector2(-o, -H / 2), P3 = new THREE.Vector2(s / 2, -3 * H / 4);
  const pts = [P0, C1, C2, P3];
  const lens = [P0.distanceTo(C1), C1.distanceTo(C2), C2.distanceTo(P3)];
  const at = [0, lens[0], lens[0] + lens[1], lens[0] + lens[1] + lens[2]];
  const dir = (i) => pts[i + 1].clone().sub(pts[i]).normalize();
  const sharp = (l) => {
    const i = l < at[1] ? 0 : l < at[2] ? 1 : 2;
    return pts[i].clone().addScaledVector(dir(i), l - at[i]);
  };
  const pos2 = (l) => {
    for (const k of [1, 2]) {
      if (Math.abs(l - at[k]) < d) {
        const a = pts[k].clone().addScaledVector(dir(k - 1), -d), b = pts[k].clone().addScaledVector(dir(k), d);
        const u = (l - (at[k] - d)) / (2 * d);
        return a.multiplyScalar((1 - u) ** 2).addScaledVector(pts[k], 2 * u * (1 - u)).addScaledVector(b, u * u);
      }
    }
    return sharp(l);
  };
  const side = (y) => (y > -H / 4 ? Math.sin(Math.PI / 2 * Math.max(-1, Math.min(1, y / c)))
    : -Math.sin(Math.PI / 2 * Math.max(-1, Math.min(1, (y + H / 2) / c))));
  const point = (l) => { const p = pos2(l); return new THREE.Vector3(p.x, p.y, amp * side(p.y)); };
  // Few samples on the straight runs, many round the bends.
  const breaks = [0, at[1] - D, at[1] + D, at[2] - D, at[2] + D, at[3]];
  const counts = [2, 22, 3, 22, 2];
  const ls = [0];
  counts.forEach((n, i) => { for (let k = 1; k <= n; k++) ls.push(lerp(breaks[i], breaks[i + 1], k / n)); });
  const radial = 7;
  const verts = [], norms = [], idx = [];
  const Z = new THREE.Vector3(0, 0, 1);
  ls.forEach((l) => {
    const p = point(l);
    const T = point(Math.min(at[3], l + 1e-4)).sub(point(Math.max(0, l - 1e-4))).normalize();
    const B = new THREE.Vector3().crossVectors(T, Z).normalize();
    const N = new THREE.Vector3().crossVectors(B, T);
    for (let j = 0; j < radial; j++) {
      const th = j / radial * Math.PI * 2;
      const n = N.clone().multiplyScalar(Math.cos(th)).addScaledVector(B, Math.sin(th));
      verts.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      norms.push(n.x, n.y, n.z);
    }
  });
  for (let i = 0; i < ls.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + (j + 1) % radial;
      idx.push(a, a + radial, b, b, a + radial, b + radial);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  geo.setIndex(idx);
  const cols = Math.ceil((x1 - x0) / s), rows = Math.ceil((y1 - y0) / H) + 1;
  const mesh = new THREE.InstancedMesh(geo, mat, cols * rows);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let j = 0; j < cols; j++) {
    for (let k = 0; k < rows; k++) m.makeTranslation(x0 + j * s, y1 - k * H - (j % 2) * H / 2, 0), mesh.setMatrixAt(n++, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

/** Soft blotches and drips, for anything that should look used. */
const grimeTex = canvasTexture(128, 256, (g, w, h) => {
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(60,55,40,${rand() * 0.12})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 4, 2 + rand() * 10);
  }
});

/**
 * Corrosion relief for old sheet steel (a bump map, tiling): mid grey with raised rust
 * blisters, scabby flakes and pinhole pits. Drawn wrapped so it tiles without seams.
 */
const rustBumpTex = canvasTexture(256, 256, (g, w, h) => {
  const r = seeded(404);
  g.fillStyle = 'rgb(128,128,128)'; g.fillRect(0, 0, w, h);
  const wrapped = (x, y, rad, fn) => { for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) if (x + dx > -rad && x + dx < w + rad && y + dy > -rad && y + dy < h + rad) fn(x + dx, y + dy); };
  // Clusters of blisters: corrosion spreads in patches, not evenly.
  for (let c = 0; c < 9; c++) {
    const cx = r() * w, cy = r() * h, spread = 15 + r() * 40;
    for (let i = 0; i < 40; i++) {
      const x = cx + (r() - 0.5) * spread * 2, y = cy + (r() - 0.5) * spread * 2, rad = 1.5 + r() * 6;
      wrapped(x, y, rad, (px, py) => {
        const grd = g.createRadialGradient(px, py, 0, px, py, rad);
        grd.addColorStop(0, `rgba(255,255,255,${0.35 + r() * 0.4})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(px - rad, py - rad, rad * 2, rad * 2);
      });
    }
  }
  // Flaking scabs: irregular raised plates with a sharp edge.
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h, rad = 3 + r() * 9;
    wrapped(x, y, rad * 1.5, (px, py) => {
      g.fillStyle = `rgba(${r() < 0.5 ? '200,200,200' : '70,70,70'},0.5)`;
      g.beginPath();
      for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2, rr = rad * (0.5 + r() * 0.7); g.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr); }
      g.fill();
    });
  }
  // Pinhole pits everywhere.
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.4})`; const sz = 1 + r() * 1.6; g.fillRect(r() * w, r() * h, sz, sz); }
}, { srgb: false });

/** Weathered galvanising for hangar skins: grime streaks running down, with rust bleeding through in patches. */
const rustSkinTex = canvasTexture(256, 256, (g, w, h) => {
  const r = seeded(405);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  for (let c = 0; c < 9; c++) {
    const x = r() * w, y = r() * h, rad = 12 + r() * 36;
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
      const grd = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
      grd.addColorStop(0, `rgba(150,82,40,${0.35 + r() * 0.3})`); grd.addColorStop(1, 'rgba(150,82,40,0)');
      g.fillStyle = grd; g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
    }
  }
  for (let i = 0; i < 220; i++) {
    g.fillStyle = r() < 0.3 ? `rgba(130,70,30,${r() * 0.25})` : `rgba(60,55,40,${r() * 0.14})`;
    const x = r() * w, y = r() * h, len = 10 + r() * 70;
    g.fillRect(x, y, 1 + r() * 2.5, len);
    if (y + len > h) g.fillRect(x, y - h, 1 + r() * 2.5, len);
  }
});

/**
 * The sign's black printing: KEEP OUT and the six hazard symbols. `ink` paints the print and
 * `field` the knocked-out parts inside the disc icons, so the same layout serves the colour
 * texture and the height map.
 */
function drawSignInk(g, w, h, ink, field) {
  g.fillStyle = ink; g.strokeStyle = ink;
  g.font = '900 136px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // Heavy lettering, as on the video's sign: filled and then stroked to thicken the strokes.
  g.save(); g.scale(0.62, 0.96);
  g.lineJoin = 'round'; g.lineWidth = 10;
  g.strokeText('KEEP OUT', w / 2 / 0.62, h * 0.5 / 0.96);
  g.fillText('KEEP OUT', w / 2 / 0.62, h * 0.5 / 0.96);
  g.restore();
  const icon = (kind) => {
    g.save(); g.lineWidth = 7;
    if (kind === 'man' || kind === 'mask') { g.beginPath(); g.arc(0, 0, 54, 0, Math.PI * 2); g.fill(); }
    if (kind === 'rad' || kind === 'bio') {
      g.lineJoin = 'round';
      g.beginPath(); g.moveTo(0, -62); g.lineTo(62, 0); g.lineTo(0, 62); g.lineTo(-62, 0); g.closePath(); g.stroke();
    }
    // Pictogram size in px; the disc icons are knocked out of the ink in sign colour.
    const size = { man: 80, mask: 76, rad: 64, bio: 62, flame: 100, blast: 100 }[kind];
    g.fillStyle = kind === 'man' || kind === 'mask' ? field : ink;
    g.translate(-size / 2, -size / 2); g.scale(size / 512, size / 512);
    g.fill(new Path2D(SIGN_ICONS[kind]));
    g.restore();
  };
  // Set well in from the sign's edges, as in the video.
  for (const [x, y, k] of [[122, 112, 'man'], [256, 112, 'flame'], [390, 112, 'rad'], [122, 366, 'bio'], [256, 366, 'blast'], [390, 366, 'mask']]) {
    g.save(); g.translate(x, y); g.scale(0.8, 0.8); icon(k); g.restore();
  }
}

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

  drawSignInk(g, w, h, 'rgba(14,16,6,0.94)', '#b4c21e');
  // A last wash of dirt over the ink, so the lettering is stained too.
  for (let i = 0; i < 30; i++) {
    const x = r() * w, y = r() * h, rad = 15 + r() * 50;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(70,80,10,${r() * 0.3})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
});

/**
 * Height map for the KEEP OUT sign, like the original's pressed-steel sign: the black rim and
 * the printed lettering and symbols stand slightly proud, the yellow field sits recessed.
 * Drawn sharp, then blurred a touch so the steps have a rounded pressing edge.
 */
const signBumpTex = canvasTexture(512, 480, (g, w, h) => {
  const flat = document.createElement('canvas');
  flat.width = w; flat.height = h;
  const f = flat.getContext('2d');
  const hi = '#fff', lo = '#000';
  f.fillStyle = hi; f.fillRect(0, 0, w, h);
  f.save();
  f.beginPath(); f.roundRect(10, 10, w - 20, h - 20, 22); f.clip();
  f.fillStyle = lo; f.fillRect(0, 0, w, h);
  f.restore();
  drawSignInk(f, w, h, hi, lo);
  g.fillStyle = hi; g.fillRect(0, 0, w, h);
  g.filter = 'blur(1.5px)';
  g.drawImage(flat, 0, 0);
  g.filter = 'none';
}, { srgb: false });

/** Broken cloud lit violet by the moon, on black (drawn additively), tiling. */
const cloudTex = canvasTexture(512, 512, (g, w, h) => {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const r = seeded(99);
  for (let i = 0; i < 900; i++) {
    const x = r() * w, y = r() * h, rad = 10 + r() * 46;
    const k = (0.05 + r() * 0.12) * (Math.sin(x / w * Math.PI * 4 + y / h * 6) > -0.2 ? 1 : 0.25);
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
      const cx = x + dx, cy = y + dy;
      if (cx < -rad || cx > w + rad || cy < -rad || cy > h + rad) continue;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grd.addColorStop(0, `rgba(120,110,170,${k})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
  }
});

const moonTex = canvasTexture(256, 256, (g) => {
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,248,1)'); grd.addColorStop(0.05, 'rgba(240,240,232,1)');
  grd.addColorStop(0.07, 'rgba(190,185,230,0.5)'); grd.addColorStop(0.3, 'rgba(140,130,190,0.25)');
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
    grd.addColorStop(0, 'rgba(255,255,255,0.75)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  }
});

/** The blast's white core with radiating streaks. */
/**
 * God rays: soft shafts of light fanning out from a centre, of uneven width and length, blurred
 * so they read as light through haze rather than drawn lines.
 */
const godRayTex = canvasTexture(512, 512, (g, w, h) => {
  const r = seeded(6161);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  x.translate(w / 2, h / 2);
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI * 2, spread = 0.01 + r() * 0.05, len = w * (0.25 + r() * 0.25);
    const grd = x.createRadialGradient(0, 0, 0, 0, 0, len);
    const k = 0.12 + r() * 0.3;
    grd.addColorStop(0, `rgba(255,255,255,${k})`); grd.addColorStop(0.35, `rgba(255,255,255,${k * 0.6})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = grd;
    x.beginPath(); x.moveTo(0, 0); x.arc(0, 0, len, a - spread, a + spread); x.closePath(); x.fill();
  }
  g.filter = 'blur(5px)';
  g.drawImage(c, 0, 0);
  g.filter = 'none';
  const core = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.2);
  core.addColorStop(0, 'rgba(255,255,255,0.9)'); core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core; g.fillRect(0, 0, w, h);
});

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
    const up = y / h; // 0 at the top of the canvas, 1 at the lamp
    const spread = 0.18 + 0.82 * Math.pow(1 - up, 0.7);
    for (let x = 0; x < w; x++) {
      const dx = Math.abs(x - w / 2 + 0.5) / (w / 2);
      const across = Math.max(0, 1 - dx / spread);
      const v = Math.pow(across, 1.3) * Math.pow(up, 1.4) * (0.8 + 2.2 * Math.pow(up, 10));
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
/** Grimy cast metal, as on the pad's pedestal and clamps: soft dark blotches over fine grain. */
const mottleTex = canvasTexture(256, 256, (g, w, h) => {
  const r = seeded(4242);
  g.fillStyle = '#b8b0a0'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 260; i++) {
    const x = r() * w, y = r() * h, s = 4 + r() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, s);
    const k = r() < 0.7 ? '40,34,24' : '255,250,235';
    grd.addColorStop(0, `rgba(${k},${0.05 + r() * 0.16})`); grd.addColorStop(1, `rgba(${k},0)`);
    g.fillStyle = grd; g.fillRect(x - s, y - s, 2 * s, 2 * s);
  }
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) { const n = (r() - 0.5) * 34; for (let c = 0; c < 3; c++) img.data[i * 4 + c] += n; }
  g.putImageData(img, 0, 0);
});
/** The hangar floor: dark granite with bright flecks that glint under the ridge lights. */
const speckleTex = canvasTexture(256, 256, (g, w, h) => {
  const r = seeded(777);
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const fleck = r();
    const v = fleck > 0.985 ? 190 + r() * 65 : fleck > 0.93 ? 95 + r() * 40 : 38 + r() * 34;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v * 0.97; img.data[i * 4 + 2] = v * 0.9; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
});
const groundTex = noiseTexture(128, 128, [70, 72, 70], 40, [40, 40]);
/** Height map for the sand: low dunes and drifts, with fine wind ripples over them. */
const duneTex = canvasTexture(256, 256, (g, w, h) => {
  const r = seeded(5150);
  g.fillStyle = '#808080'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const x = r() * w, y = r() * h, s = 20 + r() * 60;
    const k = r() < 0.5 ? '0,0,0' : '255,255,255';
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
      g.save(); g.translate(x + dx, y + dy); g.scale(1.8, 1);
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, s);
      grd.addColorStop(0, `rgba(${k},${0.12 + r() * 0.16})`); grd.addColorStop(1, `rgba(${k},0)`);
      g.fillStyle = grd; g.fillRect(-s, -s, 2 * s, 2 * s); g.restore();
    }
  }
  g.strokeStyle = 'rgba(0,0,0,0.03)';
  for (let y = 0; y < h; y += 5) {
    g.lineWidth = 1 + r() * 1.5; g.beginPath();
    for (let x = 0; x <= w; x += 6) g.lineTo(x, y + Math.sin(x / w * Math.PI * 6 + y * 0.7) * 2.5);
    g.stroke();
  }
}, { srgb: false });

/** The base's sandy ground: soft drifts and ripples of lighter and darker sand over grain. */
const sandTex = canvasTexture(256, 256, (g, w, h) => {
  const r = seeded(31337);
  g.fillStyle = '#a89c86'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 70; i++) {
    const x = r() * w, y = r() * h, s = 18 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, s);
    const k = r() < 0.5 ? '60,52,40' : '230,220,200';
    grd.addColorStop(0, `rgba(${k},${0.1 + r() * 0.15})`); grd.addColorStop(1, `rgba(${k},0)`);
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) { g.save(); g.translate(dx, dy); g.fillStyle = grd; g.fillRect(x - s, y - s, 2 * s, 2 * s); g.restore(); }
  }
  // Wind ripples.
  g.strokeStyle = 'rgba(40,34,26,0.12)';
  for (let y = 0; y < h; y += 7) {
    g.lineWidth = 1 + r() * 2; g.beginPath();
    for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x / w * Math.PI * 4 + y) * 3);
    g.stroke();
  }
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) { const n = (r() - 0.5) * 30; for (let c = 0; c < 3; c++) img.data[i * 4 + c] += n; }
  g.putImageData(img, 0, 0);
});

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
function makeHeli({ color = 0x6c727a, skin = '#8a9098', roughness = 0.42, metalness = 0.55, glass: glassOpts = null, square = 0 } = {}) {
  const g = new THREE.Group();
  const tex = panelTexture(skin, { cols: 6, rows: 3, line: 'rgba(0,0,0,0.35)', repeat: [2, 2] });
  const hull = new THREE.MeshStandardMaterial({ color, map: tex, roughness, metalness });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.55, metalness: 0.5 });
  const black = metal(0x0c0d0f, 0.7, 0.3);
  // A boxy airframe: near-square sections (high superellipse exponent) whose top and bottom
  // lines run straight between stations, so the windscreen and sides come out as flat panes.
  // The cabin's corners are chamfered: flat facets either side of the windscreen and chin, as
  // the video's nose shows head-on.
  const box = (z, w, bot, top, n = 4.6, ch = 0) => ({ z, w, y: (top + bot) / 2, h: (top - bot) / 2, n, ch });
  const fuselage = [
    box(3.3, 0.5, -0.78, -0.2, 4, 0.6),
    box(3.0, 0.8, -0.9, -0.15, 4.6, 0.75),
    box(1.9, 1.0, -0.98, 0.95, 4.6, 0.62),
    box(0.3, 1.05, -0.98, 1.02, 4.6, 0.35),
    box(-1.0, 0.95, -0.8, 1.02, 4.6, 0.2),
    box(-2.0, 0.5, -0.1, 0.9, 4),
    box(-5.4, 0.19, 0.48, 0.86, 3.4),
    box(-6.05, 0.13, 0.6, 0.94, 3.4),
  ];
  g.add(new THREE.Mesh(loft(fuselage, 40), hull));
  // Glazing: the sloped flat windscreen and the side windows back to the cabin, standing just
  // proud of the skin.
  const gm = glassMat();
  if (glassOpts) Object.assign(gm, glassOpts);
  const canopy = [fuselage[1], fuselage[2], box(1.0, 1.02, -0.98, 0.98, 4.6, 0.45)];
  // Two panes, so the hull's chamfered corners show as flat panels between them: the
  // windscreen is a touch narrower and taller than the hull (only its front face stands
  // proud), the side windows a touch wider and lower (only the sides do).
  const glass = new THREE.Mesh(loft(canopy.map((c) => ({ ...c, w: c.w * 0.95, h: c.h * 1.025, bot: 0.02 })), 40), gm);
  g.add(glass);
  g.add(new THREE.Mesh(loft(canopy.map((c) => ({ ...c, w: c.w * 1.02, h: c.h * 0.95, bot: 0.02 })), 40), gm));
  // Frame: a pillar down each side of the sloped windscreen (like a car's A-pillars), running
  // along the glass's corner from the nose (z = 3.0) up to the roof (z = 1.9).
  const frameMat = dark;
  {
    // A point on a glass section's corner, at angle a round the superellipse, just proud of it.
    const corner = (c, a, side) => {
      const e = 2 / c.n, w = c.w * 1.02, h = c.h * 1.02;
      let [x, y] = [Math.cos(a) ** e * w, Math.sin(a) ** e * h];
      if (c.ch) [x, y] = chamfer(x, y, w, h, c.ch);
      return V(side * x * 1.015, c.y + y * 1.015, c.z);
    };
    for (const side of [-1, 1]) {
      const p0 = corner(canopy[0], Math.PI / 4, side), p1 = corner(canopy[1], Math.PI / 4, side);
      const len = p0.distanceTo(p1);
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, len + 0.06), frameMat);
      pillar.position.copy(p0).add(p1).multiplyScalar(0.5);
      pillar.quaternion.setFromUnitVectors(V(0, 0, 1), p1.clone().sub(p0).normalize());
      // Roll it so its flat face lies along the corner's 45-degree bevel.
      pillar.rotateZ(-side * Math.PI / 4);
      g.add(pillar);
    }
  }
  // Engine cowl and exhausts.
  const cowl = new THREE.Mesh(loft([
    { z: 1.0, w: 0.45, h: 0.24, n: 3.6 },
    { z: 0.8, w: 0.6, h: 0.32, n: 4.4 },
    { z: -1.4, w: 0.66, h: 0.34, n: 4.4 },
    { z: -2.1, w: 0.42, h: 0.24, n: 3.8 },
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
  const wings = [];
  for (const s of [-1, 1]) {
    // Thick stub wings with rounded edges and a little droop, as in the video.
    const wing = new THREE.Mesh(plate([[0, 0.6], [1.4, 0.5], [1.4, -0.4], [0, -0.5]].map(([x, y]) => [x * s, y]), 0.16, 0.05), hull);
    wing.rotation.x = Math.PI / 2;
    wing.position.y = 0.1;
    const holder = new THREE.Group();
    holder.position.set(s * 0.95, 0.4, -0.1);
    holder.rotation.z = s * -0.09;
    holder.add(wing);
    g.add(holder);
    wings.push(wing);
    for (const [k, x] of [[0, 1.45], [1, 2.05]]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 1.1), dark);
      rail.position.set(s * x, 0.26, 0.0);
      g.add(rail);
      const m = makeMissile();
      m.position.set(s * x, 0.05, 0.05);
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
  // Main rotor: mast, swashplate with pitch links, a four-armed hub, round blade cuffs on
  // flapping hinges, and airfoil blades. Ghost blades give motion blur, and a faint disc at
  // speed.
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.75, 0.05);
  const steel = metal(0x3a3d42, 0.45, 0.75);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.55, 14), steel);
  mast.position.y = -0.27;
  rotor.add(mast);
  // Swashplate: a fixed lower ring and the rotating upper one, just above the cowl.
  for (const [y, r0, h] of [[-0.33, 0.3, 0.05], [-0.28, 0.27, 0.05]]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, h, 20), y < -0.3 ? dark : steel);
    ring.position.y = y;
    rotor.add(ring);
  }
  // The hub is grey, as in the video, with a grey scissor plate reaching out at 45 degrees
  // between each pair of black blades.
  const hubGrey = metal(0x8c8e92, 0.4, 0.7);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.2, 16), hubGrey);
  rotor.add(hub);
  for (let k = 0; k < 4; k++) {
    const arm = new THREE.Group();
    arm.rotation.y = Math.PI / 4 + k * Math.PI / 2;
    const plateArm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.36), hubGrey);
    plateArm.position.set(0, 0.06, 0.3);
    arm.add(plateArm);
    const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10), hubGrey);
    knuckle.rotation.z = Math.PI / 2;
    knuckle.position.set(0, 0.06, 0.47);
    arm.add(knuckle);
    rotor.add(arm);
  }
  const bladeGeo = bladeGeometry();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.75, metalness: 0.2, transparent: true });
  const blades = [];
  const ghosts = [];
  const flaps = [];
  /** A flapping hinge at r = 0.42 on its arm; the blade hangs off it. */
  const hinge = (parent) => { const f = new THREE.Group(); f.position.z = 0.42; parent.add(f); flaps.push(f); return f; };
  for (let k = 0; k < 4; k++) {
    const arm = new THREE.Group();
    arm.rotation.y = k * Math.PI / 2;
    // Hub arm: a tapered strap out to the hinge, with the hinge's bolt across it.
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.11, 0.34), dark);
    strap.position.z = 0.27;
    arm.add(strap);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.26, 10), steel);
    bolt.rotation.z = Math.PI / 2;
    bolt.position.z = 0.42;
    arm.add(bolt);
    // Pitch link: from the swashplate rim up to the cuff's horn on the leading edge.
    const link = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.36, 6), steel);
    link.position.set(0.17, -0.14, 0.24);
    arm.add(link);
    const f = hinge(arm);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.064, 0.5, 14), dark);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.3;
    f.add(cuff);
    const horn = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.06), dark);
    horn.position.set(0.12, 0.02, 0.1);
    f.add(horn);
    const blade = new THREE.Mesh(bladeGeo, bladeMat.clone());
    blade.position.z = 0.4;
    f.add(blade);
    blades.push(blade);
    for (const lag of [0.12, 0.24, 0.36]) {
      const ga = new THREE.Group();
      ga.rotation.y = -lag;
      arm.add(ga);
      const gh = new THREE.Mesh(bladeGeo, new THREE.MeshBasicMaterial({ color: 0x0c0c0e, transparent: true, opacity: 0, depthWrite: false }));
      gh.position.z = 0.4;
      hinge(ga).add(gh);
      ghosts.push({ m: gh, lag });
    }
    rotor.add(arm);
  }
  // A low fairing cap over the hub.
  // Flat, like the stacked plates of the video's rotor head.
  const dome = new THREE.Mesh(new THREE.LatheGeometry([V(0.25, 0, 0), V(0.24, 0.04, 0), V(0.19, 0.07, 0), V(0.1, 0.09, 0), V(0, 0.095, 0)], 20), hubGrey);
  dome.position.y = 0.09;
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
  g.userData = { rotor, tail, disc, blades, ghosts, flaps, missiles, wings, beacon, hull };
  return g;
}

/**
 * A main-rotor blade running along +z from its root (z = 0) to the tip at `len`: a symmetric
 * NACA-style airfoil, leading edge toward +x (the way the rotor turns), round where it leaves
 * the cuff, a few degrees of twist washing out toward the tip, and a swept, tapered tip.
 */
function bladeGeometry(len = 5.1) {
  // [fraction of span, chord, thickness / chord, twist (rad), sweep of the quarter-chord (-x)]
  const stations = [
    [0, 0.13, 0.95, 0.14, 0], [0.03, 0.15, 0.8, 0.14, 0], [0.07, 0.3, 0.2, 0.13, 0],
    [0.11, 0.32, 0.13, 0.12, 0], [0.5, 0.32, 0.12, 0.07, 0], [0.9, 0.32, 0.11, 0.01, 0],
    [0.95, 0.29, 0.1, 0, 0.05], [0.985, 0.2, 0.09, 0, 0.13], [1, 0.11, 0.08, 0, 0.18],
  ];
  const N = 10; // points per surface
  const xs = [];
  for (let i = 0; i <= N; i++) xs.push((1 - Math.cos(i / N * Math.PI)) / 2); // LE-clustered
  const yt = (x, t) => 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  const pos = [], idx = [];
  // Ring: upper surface TE -> LE, then lower surface LE -> TE (LE shared).
  const ring = [];
  for (let i = N; i >= 0; i--) ring.push([xs[i], 1]);
  for (let i = 1; i <= N; i++) ring.push([xs[i], -1]);
  const M = ring.length;
  for (const [f, c, t, tw, sw] of stations) {
    for (const [x, s] of ring) {
      const X = (0.25 - x) * c, Y = s * yt(x, t) * c;
      pos.push(X * Math.cos(tw) - Y * Math.sin(tw) - sw, X * Math.sin(tw) + Y * Math.cos(tw), f * len);
    }
  }
  for (let j = 0; j < stations.length - 1; j++) {
    for (let i = 0; i < M; i++) {
      const a = j * M + i, b = j * M + (i + 1) % M;
      idx.push(a, a + M, b, b, a + M, b + M);
    }
  }
  // Caps at root and tip.
  for (const [j, flip] of [[0, false], [stations.length - 1, true]]) {
    const c = pos.length / 3;
    let cx = 0, cy = 0;
    for (let i = 0; i < M; i++) { cx += pos[(j * M + i) * 3]; cy += pos[(j * M + i) * 3 + 1]; }
    pos.push(cx / M, cy / M, stations[j][0] * len);
    for (let i = 0; i < M; i++) {
      const a = j * M + i, b = j * M + (i + 1) % M;
      if (flip) idx.push(c, b, a); else idx.push(c, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
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
  // The blades droop at rest and cone upward once they carry the weight.
  const lift = smooth(speed / 30);
  u.flaps.forEach((f) => { f.rotation.x = lerp(0.035, -0.035, lift); });
  const blur = clamp01((speed - 5) / 25);
  u.disc.material.opacity = blur * 0.1;
  u.blades.forEach((b) => { b.material.opacity = 1 - blur * 0.55; });
  u.ghosts.forEach((gh) => { gh.m.material.opacity = blur * (0.42 - gh.lag * 0.8); });
}

/** A missile: cream body, dark seeker nose and band, dark tail section with cruciform fins. +z forward. */
/**
 * The missile's cream skin: off-white paint with fine grain, faint grime, and rows of small
 * dark stencil marks and scribbles, as on the video's missiles. u runs round the body, v along.
 */
const missileSkinTex = canvasTexture(256, 512, (g, w, h) => {
  const r = seeded(9091);
  g.fillStyle = '#e8e2d2'; g.fillRect(0, 0, w, h);
  // Soft grime: darker blotches and a few long streaks down the body.
  for (let i = 0; i < 60; i++) {
    const x = r() * w, y = r() * h, s = 10 + r() * 40;
    const grd = g.createRadialGradient(x, y, 0, x, y, s);
    grd.addColorStop(0, `rgba(90,80,60,${0.04 + r() * 0.08})`); grd.addColorStop(1, 'rgba(90,80,60,0)');
    g.fillStyle = grd; g.fillRect(x - s, y - s, 2 * s, 2 * s);
  }
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(70,62,48,${0.05 + r() * 0.08})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 30 + r() * 120);
  }
  // Stencil marks: short dark dashes and tiny scribbles, mostly in loose rows along the body.
  g.lineCap = 'round';
  for (let i = 0; i < 520; i++) {
    const x = r() * w, y = r() * h;
    g.strokeStyle = `rgba(30,28,24,${0.35 + r() * 0.5})`;
    g.lineWidth = 0.8 + r() * 1.4;
    g.beginPath(); g.moveTo(x, y);
    // Mostly short dashes running along the body (the canvas's y on the lathed sections), like
    // the video's stencilling.
    if (r() < 0.65) g.lineTo(x + (r() - 0.5) * 1.5, y + 8 + r() * 20);
    else { g.quadraticCurveTo(x + r() * 4, y - 3 + r() * 6, x + 2 + r() * 5, y + (r() - 0.5) * 4); }
    g.stroke();
  }
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) { const n = (r() - 0.5) * 16; for (let c = 0; c < 3; c++) img.data[i * 4 + c] += n; }
  g.putImageData(img, 0, 0);
}, { repeat: [1, 1] });

/** Dark paint for the nose, the ring behind it and the rear section: worn, slightly mottled. */
const missileDarkTex = canvasTexture(128, 128, (g, w, h) => {
  const r = seeded(4040);
  g.fillStyle = '#3c3c3a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    const x = r() * w, y = r() * h, s = 6 + r() * 20;
    const grd = g.createRadialGradient(x, y, 0, x, y, s);
    const k = r() < 0.5 ? '0,0,0' : '120,116,104';
    grd.addColorStop(0, `rgba(${k},${0.1 + r() * 0.15})`); grd.addColorStop(1, `rgba(${k},0)`);
    g.fillStyle = grd; g.fillRect(x - s, y - s, 2 * s, 2 * s);
  }
});

/**
 * A missile, nose toward +z (0.8) and tail at -0.75, as the video's: a dark ogive nose with a
 * thin dark ring behind it, a cream body with stencil marks that widens toward the back, a wide
 * dark rear section, then a short cream tail with four small fins joined by a ring.
 */
function makeMissile() {
  const g = new THREE.Group();
  const cream = new THREE.MeshStandardMaterial({ color: 0xffffff, map: missileSkinTex, bumpMap: grimeTex, bumpScale: 0.5, roughness: 0.55, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0xffffff, map: missileDarkTex, roughness: 0.5, metalness: 0.3 });
  /** One lathed section; points are [radius, position along the missile]. */
  const section = (pts, mat) => {
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([rr, y]) => new THREE.Vector2(rr, y)), 24), mat);
    m.rotation.x = Math.PI / 2;
    g.add(m);
    return m;
  };
  // Tail: a short cream collar, closed at the back.
  section([[0, -0.75], [0.06, -0.75], [0.075, -0.745], [0.079, -0.73], [0.079, -0.6]], cream);
  // Rear section: dark, the widest part.
  section([[0.076, -0.6], [0.079, -0.59], [0.079, -0.2], [0.078, -0.19]], dark);
  // Body: cream, tapering gently toward the nose.
  // The white body widens steadily from the thin nose to the full width, which then holds
  // to the tail, as in the video.
  section([[0.078, -0.19], [0.079, -0.12], [0.074, 0.05], [0.064, 0.22], [0.052, 0.38], [0.042, 0.5]], cream);
  // A dark ring, then a slim, pointed nose.
  section([[0.042, 0.5], [0.043, 0.505], [0.043, 0.55], [0.041, 0.555]], dark);
  const ogive = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    ogive.push([0.041 * Math.pow(1 - u, 0.75), 0.555 + 0.23 * u]);
  }
  // The nose cap is a lighter, worn grey than the ring behind it.
  section(ogive, new THREE.MeshStandardMaterial({ color: 0xa8a6a0, map: missileDarkTex, roughness: 0.45, metalness: 0.3 }));
  // Fins: four small swept plates at the tail, set in an X, joined at their tips by a ring.
  const finMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, map: missileSkinTex, roughness: 0.6, metalness: 0.15, side: THREE.DoubleSide });
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(plate([[0, 0], [0.14, 0], [0.11, 0.05], [0.04, 0.05]], 0.008, 0), finMat);
    const arm = new THREE.Group();
    arm.rotation.z = k * Math.PI / 2 + Math.PI / 4;
    f.rotation.y = -Math.PI / 2;
    f.position.set(0, 0.072, -0.74);
    arm.add(f);
    g.add(arm);
  }
  const finRing = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.005, 6, 28), finMat);
  finRing.position.z = -0.665;
  g.add(finRing);
  // The motor's jet: a bright cylinder of light out of the nozzle, as in the video.
  const jetGeo = new THREE.CylinderGeometry(0.05, 0.062, 0.9, 16, 6, true).translate(0, 0.45, 0);
  const jet = new THREE.Mesh(jetGeo, volumeBeam(0xffd27a, { len: 0.9, rim: 0.5, fall: 0.9, hot: 1.0 }));
  jet.rotation.x = -Math.PI / 2;
  jet.position.z = -0.75;
  g.add(jet);
  g.userData.jet = jet;
  // Motor flame and glow, hidden until it fires.
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  flame.position.z = -0.95;
  flame.scale.set(0.7, 0.7, 1);
  g.add(flame);
  g.userData.flame = flame;
  return g;
}

/** A twin-finned air-superiority jet parked on the apron. +z forward. */
/**
 * A jet's air-to-air missile, nose toward +z, as the video's: a long thin body (dark forward
 * section, white aft), a pointed nose, four mid-body wings and four larger tail fins in a
 * cross. `light`: an all-white short-range missile.
 */
function makeJetMissile(len = 3.6, r = 0.1, light = false) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xdedcd4, roughness: 0.5, metalness: 0.15 });
  const grey = light ? white : new THREE.MeshStandardMaterial({ color: 0x3e4044, roughness: 0.55, metalness: 0.3 });
  const tip = new THREE.MeshStandardMaterial({ color: 0x6a6c70, roughness: 0.3, metalness: 0.4 });
  const half = len / 2;
  const fwd = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len * 0.5, 12).rotateX(Math.PI / 2), grey);
  fwd.position.z = len * 0.18;
  g.add(fwd);
  const aft = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len * 0.43, 12).rotateX(Math.PI / 2), white);
  aft.position.z = -len * 0.285;
  g.add(aft);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(r, len * 0.1, 12).rotateX(Math.PI / 2), tip);
  nose.position.z = half - len * 0.07 + len * 0.05;
  g.add(nose);
  const finMat = new THREE.MeshStandardMaterial({ color: 0xd0cec6, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide });
  const fin = (z, root, span, sweep) => {
    for (let k = 0; k < 4; k++) {
      const f = new THREE.Mesh(plate([[0, 0], [root, 0], [root - sweep * 0.2, span], [root - sweep, span]].map(([u, v]) => [u, v]), 0.012, 0), finMat);
      const arm = new THREE.Group();
      arm.rotation.z = k * Math.PI / 2 + Math.PI / 4;
      f.rotation.y = -Math.PI / 2;
      f.position.set(0, r * 0.9, z);
      arm.add(f);
      g.add(arm);
    }
  };
  // Mid wings (delta), then the tail fins at the very back.
  fin(-len * 0.02, len * 0.14, r * 2.4, len * 0.1);
  fin(-half + len * 0.01, len * 0.12, r * 3.2, len * 0.06);
  return g;
}

function makeJet() {
  const g = new THREE.Group();
  // Light grey, as the video's jets are.
  const skin = panelTexture('#c4c8cc', { cols: 8, rows: 4, repeat: [2, 2], line: 'rgba(0,0,0,0.25)' });
  const m = new THREE.MeshStandardMaterial({ color: 0xb4b8bc, map: skin, roughness: 0.5, metalness: 0.3 });
  const dark = metal(0x25282c, 0.6, 0.4);
  const fus = new THREE.Mesh(loft([
    { z: 7.4, w: 0.04, h: 0.04, y: 0.1, n: 2 },
    { z: 6.6, w: 0.32, h: 0.3, y: 0.05, n: 2.2 },
    { z: 5.2, w: 0.55, h: 0.55, y: 0.05, n: 2.4 },
    { z: 3.6, w: 0.68, h: 0.62, y: 0.1, n: 2.6 },
    { z: 2.4, w: 1.5, h: 0.55, y: 0, n: 2.9, top: 0.9 },
    { z: -1.5, w: 1.7, h: 0.52, y: 0, n: 3.1, top: 0.85 },
    { z: -4.3, w: 1.45, h: 0.5, y: 0, n: 3 },
    { z: -4.9, w: 1.3, h: 0.46, y: 0, n: 2.8 },
  ], 32), m);
  g.add(fus);
  // Box intakes with dark mouths.
  for (const s of [-1, 1]) {
    // Intakes with rounded corners instead of sharp boxes.
    const intake = new THREE.Mesh(loft([{ z: 1.2, w: 0.38, h: 0.42, n: 3.2 }, { z: -1.2, w: 0.38, h: 0.42, n: 3.2 }], 20), m);
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
  // Cropped-delta wings, stabilators and canted twin fins. A long, thin root extension runs
  // from beside the cockpit into each wing, so wing and body blend as in the video.
  const wing = (s) => {
    const lerx = new THREE.Mesh(plate([[0, 3.6], [0.55, 2.2], [1.6, 0.6], [1.6, -2.6], [0, -2.6]].map(([x, y]) => [x * s, y]), 0.16, 0.06), m);
    lerx.rotation.x = Math.PI / 2;
    lerx.position.set(s * 0.6, 0.06, -0.6);
    g.add(lerx);
    const w = new THREE.Mesh(plate([[0, 2.2], [5.4, -1.4], [5.4, -2.3], [0, -2.6]].map(([x, y]) => [x * s, y]), 0.12, 0.03), m);
    w.rotation.x = Math.PI / 2;
    w.position.set(s * 1.3, 0, -0.6);
    g.add(w);
    if (s < 0) {
      const tip = navLight(0xff2a1a, 0.07);
      tip.position.set(s * 6.72, 0, -2.4);
      g.add(tip);
    }
    const st = new THREE.Mesh(plate([[0, 0.4], [2.3, -0.8], [2.3, -1.15], [0, -1.15]].map(([x, y]) => [x * s, y]), 0.08, 0.02), m);
    st.rotation.x = Math.PI / 2;
    st.position.set(s * 1.3, -0.05, -3.8);
    g.add(st);
    // The stabiliser's trailing-edge flap, hinged behind a dark gap and drooped a little.
    const flapHinge = new THREE.Group();
    flapHinge.position.set(s * 1.3, -0.05, -3.8 - 1.2);
    flapHinge.rotation.x = 0.12;
    const flap = new THREE.Mesh(plate([[0.15, 0], [2.3, 0], [2.3, -0.42], [0.15, -0.5]].map(([x, y]) => [x * s, y]), 0.06, 0.015), m);
    flap.rotation.x = Math.PI / 2;
    flapHinge.add(flap);
    g.add(flapHinge);
    const gap = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.05, 0.05), dark);
    gap.position.set(s * (1.3 + 1.22), -0.05, -3.8 - 1.17);
    g.add(gap);
    const fin = new THREE.Mesh(plate([[0, 0], [1.9, 0], [0.9, 2.3], [0.1, 2.3]], 0.1, 0.02), m);
    fin.rotation.y = -Math.PI / 2;
    fin.rotation.z = 0;
    const holder = new THREE.Group();
    holder.position.set(s * 0.95, 0.35, -4.6);
    holder.rotation.z = -s * 0.2;
    holder.add(fin);
    g.add(holder);
    // Underwing pylon with a long air-to-air missile, and a short one on the wingtip rail.
    const pyl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 1.6), m);
    pyl.position.set(s * 3.4, -0.22, -0.9);
    g.add(pyl);
    const aam = makeJetMissile(3.6, 0.1);
    aam.position.set(s * 3.4, -0.5, -0.6);
    g.add(aam);
    const tipRail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 1.8), m);
    tipRail.position.set(s * 6.7, 0, -1.7);
    g.add(tipRail);
    const tipMsl = makeJetMissile(2.6, 0.065, true);
    tipMsl.position.set(s * 6.7, -0.1, -1.4);
    g.add(tipMsl);
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
/** `lamp`: the lamp over the door; `skin`: shell colour. */
/**
 * A Nissen-hut cross-section as the video's huts have it: sides sloping straight up to a flat
 * top, the two top corners rounded. Points (x, y) run from the left foot over to the right foot.
 */
function trapezoidProfile(r) {
  const top = r * 0.9, half = r * 0.5, d = r * 0.3;
  const pts = [];
  const line = (a, b, n) => { for (let i = 0; i < n; i++) pts.push([lerp(a[0], b[0], i / n), lerp(a[1], b[1], i / n)]); };
  // A corner: a quadratic curve from `d` back along one edge to `d` along the next.
  const back = (at, from) => { const l = Math.hypot(from[0] - at[0], from[1] - at[1]); return [at[0] + (from[0] - at[0]) * d / l, at[1] + (from[1] - at[1]) * d / l]; };
  const corner = (from, at, to, n) => {
    const p1 = back(at, from), p2 = back(at, to);
    for (let i = 0; i < n; i++) {
      const t = i / n, u = 1 - t;
      pts.push([u * u * p1[0] + 2 * u * t * at[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * at[1] + t * t * p2[1]]);
    }
    return p2;
  };
  const A = [-r, 0], B = [-half, top], C = [half, top], D = [r, 0];
  line(A, back(B, A), 10);
  const b2 = corner(A, B, C, 8);
  line(b2, back(C, B), 8);
  const c2 = corner(B, C, D, 8);
  line(c2, D, 10);
  pts.push(D);
  return pts;
}

function makeHangar(len = 22, r = 7, { lamp: withLamp = true, skin: skinCol = 0x6f7378, plain = false, trapezoid = false, breach = false } = {}) {
  const profile = trapezoid ? trapezoidProfile(r) : null;
  const g = new THREE.Group();
  // `plain`: clean light-grey sheeting, without the rust streaks.
  const skin = new THREE.MeshStandardMaterial({ color: skinCol, map: plain ? null : repeatOf(rustSkinTex, Math.PI * r / 3, len / 3), bumpMap: repeatOf(rustBumpTex, Math.PI * r / 1.5, len / 1.5), bumpScale: 1.6,
    roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide });
  // Corrugations run over the arch from ground to ground, so the waves step along the length.
  let shell;
  if (trapezoid) {
    // Sweep the profile along the length, corrugated the same way as the round huts.
    const segs = Math.round(len / 0.32 * 6), pos = [], uv = [], idx = [];
    const n = profile.length;
    let total = 0;
    const arc = profile.map((pt, i) => (i ? (total += Math.hypot(pt[0] - profile[i - 1][0], pt[1] - profile[i - 1][1])) : 0));
    for (let j = 0; j <= segs; j++) {
      const z = -len / 2 + j * len / segs;
      const wave = 0.05 * Math.sin(z / 0.32 * Math.PI * 2);
      for (let i = 0; i < n; i++) {
        const a = profile[Math.max(0, i - 1)], b = profile[Math.min(n - 1, i + 1)];
        const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // Outward normal of the profile (it runs left to right over the top).
        const nx = -(b[1] - a[1]) / tl, ny = (b[0] - a[0]) / tl;
        pos.push(profile[i][0] + nx * wave, profile[i][1] + ny * wave, z);
        uv.push(arc[i] / total, j / segs);
      }
    }
    for (let j = 0; j < segs; j++) for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + n;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    shell = new THREE.Mesh(geo, skin);
  } else {
    const shellGeo = corrugate(new THREE.CylinderGeometry(r, r, len, 40, Math.round(len / 0.32 * 6), true, 0, Math.PI), 0.32, 0.05,
      (x, y) => y, (x, y, z) => { const l = Math.hypot(x, z) || 1; return [x / l, 0, z / l]; });
    shell = new THREE.Mesh(shellGeo, skin);
    shell.rotation.z = Math.PI / 2;
    shell.rotation.y = Math.PI / 2;
  }
  g.add(shell);
  const ribMat = metal(0x50545a, 0.5, 0.6);
  const ribs = [];
  for (let k = 0; k <= 6; k++) {
    const ribGeo = trapezoid
      ? new THREE.TubeGeometry(new THREE.CatmullRomCurve3(profile.map(([x, y]) => V(x * (1 + 0.05 / r), y * (1 + 0.05 / r), 0))), 48, 0.09, 6)
      : new THREE.TorusGeometry(r + 0.05, 0.09, 6, 40, Math.PI);
    const rib = new THREE.Mesh(ribGeo, ribMat);
    rib.position.z = -len / 2 + k * len / 6;
    g.add(rib);
    ribs.push(rib);
  }
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2 * r + 0.8, 0.5, len + 0.8), new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.95 }));
  plinth.position.y = 0.05;
  g.add(plinth);
  const wall = new THREE.MeshStandardMaterial({ color: 0x3d4045, map: panelTexture('#5a5d62', { cols: 10, rows: 6 }), roughness: 0.85 });
  let front;
  for (const s of [-1, 1]) {
    const endGeo = trapezoid ? new THREE.ShapeGeometry(new THREE.Shape(profile.map(([x, y]) => new THREE.Vector2(x, y)))) : new THREE.CircleGeometry(r, 40, 0, Math.PI);
    const end = new THREE.Mesh(endGeo, wall);
    end.position.z = s * len / 2;
    if (s < 0) end.rotation.y = Math.PI;
    else front = end;
    g.add(end);
  }
  // Half the end wall's width at height y, so the fittings on it stay inside its outline.
  const halfAt = (y) => {
    if (!trapezoid) return Math.sqrt(Math.max(0, r * r - y * y));
    let best = 0;
    for (let i = 1; i < profile.length; i++) {
      const [x0, y0] = profile[i - 1], [x1, y1] = profile[i];
      if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) best = Math.max(best, Math.abs(lerp(x0, x1, (y - y0) / (y1 - y0))));
    }
    return best;
  };
  const doorH = r * 0.75;
  const door = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(r * 1.1, 2 * halfAt(doorH + 0.3) - 0.5), doorH), new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.7, metalness: 0.4 }));
  door.position.set(0, doorH / 2 + 0.3, len / 2 + 0.03);
  g.add(door);
  const trackY = doorH + 0.36;
  const track = new THREE.Mesh(new THREE.BoxGeometry(Math.min(r * 1.5, 2 * halfAt(trackY + 0.06) - 0.5), 0.12, 0.15), metal(0x2a2c30));
  track.position.set(0, trackY, len / 2 + 0.08);
  g.add(track);
  const wins = [-1, 1].map((s) => {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshBasicMaterial({ color: 0x3a3418 }));
    win.position.set(s * Math.min(r * 0.72, halfAt(r * 0.42 + 0.3) - 0.75), r * 0.42, len / 2 + 0.03);
    g.add(win);
    return win;
  });
  // `breach`: a second front wall with a wide arched hole where the door was, swapped in when
  // the door is blown out.
  let frontBlown = null;
  if (breach) {
    const hw = r * 0.78, hy = r * 0.4, ht = r * 0.3;
    const sh = new THREE.Shape();
    sh.moveTo(r, 0);
    sh.absarc(0, 0, r, 0, Math.PI, false);
    sh.lineTo(-hw, 0);
    sh.lineTo(-hw, hy);
    sh.absellipse(0, hy, hw, ht, Math.PI, 0, true);
    sh.lineTo(hw, 0);
    sh.closePath();
    frontBlown = new THREE.Mesh(new THREE.ShapeGeometry(sh, 24), wall);
    frontBlown.position.z = len / 2;
    frontBlown.visible = false;
    g.add(frontBlown);
  }
  // Everything that goes when the door is blown out.
  const frontParts = [front, door, track, ...wins];
  g.userData = { door, front, shell, ribs, frontParts, frontBlown };
  if (!withLamp) {
    g.children.filter((c) => c.material?.color?.getHex() === 0x3a3418).forEach((c) => c.material.color.setHex(0x0c0c0e));
    door.material.color.setScalar(0.22);
    return g;
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
  g.userData = { door, front, shell, ribs, frontParts, frontBlown };
  return g;
}

/** A soft round pool of light, for lamps' footprints on the ground (white, alpha falls off). */
const pondTex = canvasTexture(128, 128, (g, w, h) => {
  const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});

/**
 * A flat-roofed concrete bunker with a row of three lit windows on the roof edge.
 * `cornerLamp`: a wall lamp on the left side by the front corner, pooling light on the ground.
 */
function makeBunker({ cornerLamp = false } = {}) {
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
  const lamp = new THREE.PointLight(0xfff0c8, cornerLamp ? 0 : 8, 9, 1.5);
  lamp.position.set(2, 2.7, 4.2);
  g.add(lamp);
  if (cornerLamp) {
    const fix = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.5), metal(0x2a2c30, 0.6, 0.5));
    fix.position.set(-4.65, 2.75, 3.6);
    g.add(fix);
    const bulb = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.24), new THREE.MeshBasicMaterial({ color: 0xfff6dc }));
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(-4.7, 2.63, 3.6);
    g.add(bulb);
    // The lamp lights mostly the air under it, as in the video: a soft wedge of light fanning
    // down the wall, with only a faint patch on the ground.
    const spot = new THREE.SpotLight(0xfff0d0, 10, 7, 0.6, 0.8, 1.6);
    spot.position.set(-4.75, 2.6, 2.6);
    spot.target.position.set(-5.3, 0, 2.6);
    g.add(spot, spot.target);
    // A flat fan of light (a wide, thin cone) hanging down from the lamp against the wall.
    const wedgeGeo = new THREE.ConeGeometry(1.9, 3.0, 40, 4, true);
    wedgeGeo.rotateX(Math.PI); wedgeGeo.translate(0, 1.5, 0); wedgeGeo.scale(1, 1, 0.35);
    const wedge = new THREE.Mesh(wedgeGeo, volumeBeam(0xfff2d8, { len: 3.0, rim: 0.6, fall: 0.9, hot: 0.5 }));
    wedge.material.uniforms.opacity.value = 0.75;
    // At the front corner, its flat face turned out to the front so it reads as a triangle.
    // (The fan opens along its local +y, so it is turned upside down to hang from the lamp.)
    wedge.position.set(-4.75, 2.6, 3.7);
    wedge.rotation.set(Math.PI - 0.12, -0.6, 0);
    g.add(wedge);
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.6), additive(washTex, 0xfff0d0, 0.35));
    wash.rotation.set(0, -Math.PI / 2, 0);
    wash.position.set(-4.53, 1.3, 2.6);
    g.add(wash);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(pondTex, 0x4a4840, 0.5));
    pool.rotation.x = -Math.PI / 2;
    pool.scale.set(1.8, 3.0, 1);
    pool.position.set(-5.2, 0.04, 4.4);
    g.add(pool);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: pondTex, color: 0x9a968a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.position.set(-4.75, 2.6, 3.7);
    halo.scale.setScalar(1.4);
    g.add(halo);
  }
  return g;
}

/** The watchtower: braced lattice legs, ladder, railed deck, windowed cabin, roof searchlight. */
function makeTower() {
  const g = new THREE.Group();
  const steel = metal(0x4a4d52, 0.6, 0.7);
  const H = 13;
  // Straight, plumb legs: the lattice is as wide at the foot as under the deck.
  const half = 1.45;
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, H, 6), steel);
    leg.position.set(x * half, H / 2, z * half);
    g.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.6), new THREE.MeshStandardMaterial({ color: 0x4a4a48, roughness: 0.95 }));
    foot.position.set(x * half, 0.15, z * half);
    g.add(foot);
  }
  // X-bracing on every face, every bay, with horizontal girts.
  const bay = 2.4;
  for (let y = 0.6; y + bay <= H + 0.1; y += bay) {
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
    rail.position.set(s * 0.22, H / 2, half + 0.18);
    g.add(rail);
  }
  for (let y = 0.4; y < H; y += 0.35) {
    const rung = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.025, 0.025), steel);
    rung.position.set(0, y, half + 0.18);
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
  // Searchlight on a yoke at the roof's front left corner.
  const yoke = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.6, 8), metal(0x222222));
  yoke.position.set(-1.55, H + 3.0, 1.55);
  g.add(yoke);
  const head = new THREE.Group();
  head.rotation.order = 'YXZ'; // pan on the yoke, then tilt
  head.position.set(-1.55, H + 3.45, 1.55);
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
  // Glare when the lamp swings round to face the lens.
  // Drawn over everything, so the lamp head's own geometry never cuts a dark shape out of it.
  const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: raysTex, color: 0xdfe6ff, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0, fog: false }));
  flare.renderOrder = 5;
  flare.position.z = 0.45;
  flare.scale.setScalar(5);
  head.add(flare);
  g.add(head);
  g.userData = { head, beam, spot, glow, flare };
  return g;
}

/** A cross-section with vertical sides and a rounded top: half width w, from y0 up to y1,
 *  shoulder radius r. */
function roundTop(w, y0, y1, r) {
  const sh = new THREE.Shape();
  sh.moveTo(-w, y0);
  sh.lineTo(w, y0);
  sh.absarc(w - r, y1 - r, r, 0, Math.PI / 2, false);
  sh.absarc(-w + r, y1 - r, r, Math.PI / 2, Math.PI, false);
  sh.closePath();
  return sh;
}

/** Extrude a Shape along +z from z0 to z1 with its edges rounded off by `b` (the outline grows
 *  by b too), then smooth the normals across the curves so it doesn't shade faceted. */
function extrudeZ(sh, z0, z1, b, curveSegments = 10) {
  const g = new THREE.ExtrudeGeometry(sh, { depth: z1 - z0 - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 3, curveSegments });
  g.translate(0, 0, z0 + b);
  return smoothNormals(g);
}

/**
 * Vertex normals for a non-indexed geometry, averaged over the faces that meet at each point
 * unless they fold by more than `crease` radians, so curves shade smooth and edges stay crisp.
 */
function smoothNormals(geo, crease = 0.7) {
  const p = geo.attributes.position, n = p.count;
  const fn = new Float32Array(n * 3);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    c.sub(b); a.sub(b); c.cross(a);
    const area = c.length();
    if (area > 0) c.divideScalar(area);
    for (let k = 0; k < 3; k++) fn.set([c.x * area, c.y * area, c.z * area], (i + k) * 3);
  }
  const at = new Map();
  const key = (i) => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
  for (let i = 0; i < n; i++) { const k = key(i); if (!at.has(k)) at.set(k, []); at.get(k).push(i); }
  const out = new Float32Array(n * 3), cos = Math.cos(crease);
  const u = new THREE.Vector3(), v = new THREE.Vector3(), sum = new THREE.Vector3();
  for (const list of at.values()) {
    for (const i of list) {
      u.fromArray(fn, i * 3).normalize();
      sum.set(0, 0, 0);
      for (const j of list) if (v.fromArray(fn, j * 3).normalize().dot(u) > cos) sum.add(v.fromArray(fn, j * 3));
      sum.normalize().toArray(out, i * 3);
    }
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return geo;
}

/** A flat Shape with its UVs stretched over its bounding box (ShapeGeometry uses raw x, y). */
function shapeFill(sh, curveSegments = 8) {
  const g = new THREE.ShapeGeometry(sh, curveSegments);
  g.computeBoundingBox();
  const { min, max } = g.boundingBox, uv = g.attributes.uv, p = g.attributes.position;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - min.x) / (max.x - min.x), (p.getY(i) - min.y) / (max.y - min.y));
  return g;
}

/** A military truck after INTRO1's 1940s six-wheelers: a narrow bonnet with rounded shoulders
 *  and a grille, flowing front mudguards that run back into the running boards, a round-roofed
 *  cab with a split windscreen, headlamps on the wings, and either a ribbed canvas tilt or a fuel
 *  tank on the back. +z forward. */
function makeTruck(kind = 'troop') {
  const g = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({ color: 0x3b4030, map: panelTexture('#6b7058', { cols: 3, rows: 2, line: 'rgba(0,0,0,0.35)' }), roughness: 0.8, metalness: 0.2 });
  // The extruded body panels carry world-unit UVs, so their skin tiles instead of stretching.
  const body = new THREE.MeshStandardMaterial({ color: 0x3b4030, map: panelTexture('#6b7058', { cols: 2, rows: 2, line: 'rgba(0,0,0,0.25)', repeat: [0.45, 0.45] }), roughness: 0.75, metalness: 0.25 });
  const dark = metal(0x161616, 0.8, 0.3);
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 6.6), dark);
  chassis.position.set(0, 0.75, 0);
  g.add(chassis);

  // Bonnet: vertical sides rolling over into a flat top, narrowing and dropping a touch toward
  // the grille.
  const HZ0 = 2.1, HZ1 = 3.42;
  const bonnetGeo = extrudeZ(roundTop(0.6, 0.95, 1.72, 0.3), HZ0, HZ1, 0.035);
  const bp = bonnetGeo.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const k = clamp01((bp.getZ(i) - HZ0) / (HZ1 - HZ0));
    const y = bp.getY(i);
    bp.setXY(i, bp.getX(i) * (1 - 0.07 * k), y - 0.07 * k * clamp01((y - 0.95) / 0.8));
  }
  g.add(new THREE.Mesh(bonnetGeo, body));
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.025, HZ1 - HZ0 - 0.05), dark);
  seam.position.set(0, 1.735, (HZ0 + HZ1) / 2);
  seam.rotation.x = 0.053;
  g.add(seam);
  const grille = new THREE.Mesh(shapeFill(roundTop(0.44, 1.0, 1.58, 0.2)), new THREE.MeshStandardMaterial({ map: canvasTexture(32, 32, (c, w, h) => {
    c.fillStyle = '#111'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#3a3e30'; for (let x = 1; x < w; x += 4) c.fillRect(x, 0, 2, h);
  }), roughness: 0.9 }));
  grille.position.z = HZ1 + 0.004;
  g.add(grille);

  // Cab: round-shouldered roof, split windscreen, side windows, mirrors on arms.
  g.add(new THREE.Mesh(extrudeZ(roundTop(1.0, 1.0, 2.7, 0.34), 0.72, HZ0, 0.06), body));
  for (const s of [-1, 1]) {
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.56), glassMat());
    screen.position.set(s * 0.48, 2.2, HZ0 + 0.004);
    g.add(screen);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.52), glassMat());
    side.rotation.y = s * Math.PI / 2;
    side.position.set(s * 1.064, 2.2, 1.6);
    g.add(side);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.03), dark);
    arm.position.set(s * 1.2, 2.05, 2.0);
    g.add(arm);
    const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.22), dark);
    mirror.position.set(s * 1.36, 2.2, 2.0);
    g.add(mirror);
    // Hood louvres down each side.
    for (let k = 0; k < 5; k++) {
      const z = 2.4 + k * 0.13;
      const kz = (z - HZ0) / (HZ1 - HZ0);
      const slot = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.26, 0.04), dark);
      slot.position.set(s * (0.635 * (1 - 0.07 * kz) + 0.002), 1.3, z);
      g.add(slot);
    }

    // Front wing: crowned sheet that sweeps up over the wheel and down in front of it, and back
    // into the running board under the cab door. Drawn side-on (u = z, v = y), extruded across x.
    const wing = new THREE.Shape();
    const arc = (r, a0, a1, n = 14) => Array.from({ length: n + 1 }, (_, i) => {
      const a = lerp(a0, a1, i / n);
      return [2.4 + r * Math.cos(a), 0.55 + r * Math.sin(a)];
    });
    const outer = arc(0.74, Math.PI * 5 / 6, 0.12), inner = arc(0.63, 0.12, Math.PI * 5 / 6);
    wing.moveTo(0.5, 0.92);
    wing.lineTo(outer[0][0] - 0.06, 0.92);
    for (const [u, v] of outer) wing.lineTo(u, v);
    for (const [u, v] of inner) wing.lineTo(u, v);
    wing.lineTo(outer[0][0] - 0.1, 0.84);
    wing.lineTo(0.5, 0.84);
    wing.closePath();
    const wingGeo = smoothNormals(new THREE.ExtrudeGeometry(wing, { depth: 0.46, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.035, bevelSegments: 3 }));
    wingGeo.translate(0, 0, -0.23);
    const wingMesh = new THREE.Mesh(wingGeo, body);
    wingMesh.rotation.y = -Math.PI / 2;
    wingMesh.position.x = s * 0.96;
    g.add(wingMesh);

    // Headlamp in a deep bowl on a stalk, sitting on the wing beside the bonnet.
    const lamp = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.2, 14), dark);
    bowl.rotation.x = Math.PI / 2;
    lamp.add(bowl);
    // Lamps are off: a dull glass lens that only shows what light falls on it.
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.12, 14), new THREE.MeshStandardMaterial({ color: 0x55574e, roughness: 0.25, metalness: 0.4 }));
    lens.position.z = 0.101;
    lamp.add(lens);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 6, 14), dark);
    rim.position.z = 0.1;
    lamp.add(rim);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22), dark);
    stalk.position.y = -0.18;
    lamp.add(stalk);
    lamp.position.set(s * 0.86, 1.36, 3.0);
    g.add(lamp);
  }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.2, 0.18), dark);
  bumper.position.set(0, 0.66, 3.5);
  g.add(bumper);
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

/** A cloud deck that rides with the camera, lit by the moon, over a near-black night. */
/** A night cloud deck: ragged, wind-stretched banks of cloud, density in the alpha channel. */
const nightCloudTex = (() => {
  const t = canvasTexture(512, 512, (g, w, h) => {
    const r = seeded(7373);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 520; i++) {
      const x = r() * w, y = r() * h, sx = 14 + r() * 60, sy = sx * (0.25 + r() * 0.2);
      // Banks: denser along a few diagonal bands, thin between them.
      const band = 0.5 + 0.5 * Math.sin(y / h * Math.PI * 6 + x / w * 2.4);
      const a = (0.04 + r() * 0.1) * (0.3 + band);
      for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
        const cx = x + dx, cy = y + dy;
        if (cx < -sx || cx > w + sx || cy < -sx || cy > h + sx) continue;
        g.save(); g.translate(cx, cy); g.scale(1, sy / sx);
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, sx);
        grd.addColorStop(0, `rgba(255,255,255,${a})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(-sx, -sx, 2 * sx, 2 * sx); g.restore();
      }
    }
  }, { srgb: false });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
})();

/**
 * The night sky: a cloud deck lying flat high above the camera (it follows the camera), and the
 * moon beyond it. The deck is dark where it is thick and lit silver near the moon, brightest
 * at its thin edges, so the moon glows through it and the clouds drift across its face.
 */
function nightSky(scene, tint = 0xffffff) {
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.ShaderMaterial({
    uniforms: { map: { value: nightCloudTex }, tint: { value: new THREE.Color(tint) }, moonDir: { value: V(0, 0.3, -1).normalize() },
      shift: { value: new THREE.Vector2() } },
    vertexShader: `varying vec2 vUv; varying vec3 vW;
      void main() { vUv = uv * 9.0; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 tint; uniform vec3 moonDir; uniform vec2 shift;
      varying vec2 vUv; varying vec3 vW;
      void main() {
        vec3 dir = normalize(vW);
        float dens = texture2D(map, vUv + shift).a;
        dens = clamp(dens * 1.6, 0.0, 1.0);
        float c = max(dot(dir, normalize(moonDir)), 0.0);
        float glow = pow(c, 80.0) * 2.2 + pow(c, 14.0) * 0.6 + pow(c, 3.0) * 0.12;
        vec3 col = tint * (0.07 + glow * 0.9) + vec3(0.85, 0.85, 1.0) * glow * (1.0 - dens) * 0.9;
        float a = dens * 0.92 * smoothstep(0.03, 0.15, dir.y);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  }));
  sky.rotation.x = Math.PI / 2;
  sky.geometry.translate(0, 0, -260);
  // Drawn after the moon, so the clouds pass in front of it.
  sky.renderOrder = 0;
  scene.add(sky);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }));
  moon.scale.set(300, 300, 1);
  moon.renderOrder = -1;
  scene.add(moon);
  /** Point the deck's lighting at the moon and drift it with time. */
  sky.userData.update = (cam, t) => {
    sky.material.uniforms.moonDir.value.copy(moon.position).sub(cam.position).normalize();
    sky.material.uniforms.shift.value.set(t * 0.0025, t * 0.001);
  };
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
  const conc = new THREE.MeshStandardMaterial({ color: 0x7a7678, map: repeatOf(concreteTex, len / 6, 1), roughness: 0.95 });
  // A tall perimeter wall, as in the video: a plain face with a coping ledge along the top,
  // square buttresses with sloped tops on the inner side, and a row of tall, thin poles along
  // the top leaning outward, strung with a few strands of wire.
  const WH = 5.0;
  const wall = new THREE.Mesh(new THREE.BoxGeometry(len, WH, 0.5), conc);
  wall.position.y = WH / 2;
  g.add(wall);
  const coping = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, 0.8), conc);
  coping.position.set(0, WH + 0.11, 0.05);
  g.add(coping);
  // The buttresses share one geometry: a box with its top sloping down toward the inside.
  const bGeo = (() => {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.lineTo(1.1, 0); sh.lineTo(1.1, 3.3); sh.lineTo(0, 4.3); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.9, bevelEnabled: false });
    geo.translate(0, 0, -0.45);
    geo.rotateY(-Math.PI / 2);
    return geo;
  })();
  const pole = new THREE.CylinderGeometry(0.05, 0.06, 3.8, 6).translate(0, 1.9, 0);
  const poleMat = metal(0x5a5e63, 0.6, 0.5);
  const tops = [];
  let n = 0;
  for (let x = -len / 2 + 1.6; x <= len / 2; x += 3.2) {
    const b = new THREE.Mesh(bGeo, conc);
    b.position.set(x, 0, 0.25);
    g.add(b);
    // A pole over every other buttress.
    if (n++ % 2) continue;
    const p = new THREE.Mesh(pole, poleMat);
    p.position.set(x + 1.6, WH + 0.2, -0.1);
    p.rotation.x = -0.28;
    g.add(p);
    p.updateMatrix();
    tops.push(V(0, 3.75, 0).applyMatrix4(p.matrix));
  }
  // Faint wire strands between the poles, at three heights.
  const wire = new THREE.LineBasicMaterial({ color: 0x24262a, transparent: true, opacity: 0.5 });
  for (const f of [0.35, 0.65, 0.97]) {
    const pts = tops.map((t) => V(t.x, lerp(WH + 0.2, t.y, f), lerp(-0.1, t.z, f)));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wire));
  }
  return g;
}

// A: the sign on the perimeter fence.
function signSet() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06070b);
  scene.fog = new THREE.Fog(0x0b0c12, 20, 160);
  scene.add(new THREE.HemisphereLight(0x404450, 0x0c0c0c, 0.45));
  const moonLight = new THREE.DirectionalLight(0x9a9cb0, 0.55);
  moonLight.position.set(-30, 40, -60);
  scene.add(moonLight);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x4a4c4e, map: groundTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const { sky, moon } = nightSky(scene, 0x6a6a78);
  // Modelled wire where the camera can see it, the flat texture further out.
  const NEAR = [-5.1, 6.1];
  // Neutral galvanised steel, as in the video (it read blue under the moonlight).
  const wire = chainLink(NEAR[0], NEAR[1], 0, 4.4, new THREE.MeshStandardMaterial({ color: 0xb8b6b0, metalness: 0.3, roughness: 0.5, envMapIntensity: 0.15 }));
  wire.position.z = -0.02;
  scene.add(wire);
  for (const [a, b] of [[-40, NEAR[0]], [NEAR[1], 40]]) {
    const far = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 4.4), new THREE.MeshStandardMaterial({ map: repeatOf(fenceTex, (b - a) / 0.34, 4.4 / 0.32), alphaTest: 0.35, side: THREE.DoubleSide, metalness: 0.3, roughness: 0.6, color: 0x80848a }));
    far.position.set((a + b) / 2, 2.2, -0.02);
    scene.add(far);
  }
  for (let x = -38.5; x <= 40; x += 6) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 4.5, 6), metal(0x6a6e73));
    post.position.set(x, 2.25, -0.08);
    scene.add(post);
  }
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.29, 1.16, 0.035), metal(0x0e0f0a, 0.8, 0.3));
  board.position.set(0, 1.62, 0.03);
  scene.add(board);
  const signMat = new THREE.MeshStandardMaterial({ map: signTex, bumpMap: signBumpTex, bumpScale: 3, roughness: 0.62, metalness: 0.15 });
  // Old enamelled steel: bowed, with a bent corner and a scatter of dents and knocks.
  const signGeo = new THREE.PlaneGeometry(1.25, 1.12, 50, 45);
  {
    const r = seeded(31);
    const dents = Array.from({ length: 14 }, () => [(r() - 0.5) * 1.2, (r() - 0.5) * 1.06, 0.03 + r() * 0.09, (r() < 0.7 ? -1 : 1) * (0.008 + r() * 0.016)]);
    const p = signGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      let z = 0.02 * Math.sin(x * 2.2 + 0.4) * Math.cos(y * 1.7) + 0.006 * Math.sin(x * 7 + y * 5);
      z += 0.035 * Math.max(0, (x - 0.35) / 0.27 + (-y - 0.3) / 0.26 - 1) ** 2; // lower right corner bent out
      for (const [dx, dy, rad, d] of dents) z += d * Math.exp(-((x - dx) ** 2 + (y - dy) ** 2) / (rad * rad));
      p.setZ(i, Math.max(0.001, z + 0.022));
    }
    signGeo.computeVertexNormals();
  }
  const sign = new THREE.Mesh(signGeo, signMat);
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
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.1), additive(beamTex, 0xcfd8ff, 0));
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
  jet.position.set(3.4, 1.5, -11);
  jet.rotation.y = -Math.PI / 2 - 0.35;
  const jetLight = new THREE.DirectionalLight(0xa0a4c0, 2.2);
  jetLight.position.set(20, 30, 20);
  jetLight.target = jet;
  scene.add(jetLight);
  scene.add(jet);
  // Moonlight on the sign and fence, so it still reads when the tube is out.
  const fill = new THREE.PointLight(0xb8b8bc, 3.2, 14, 1);
  fill.position.set(1.5, 2.5, 4);
  scene.add(fill);
  const hut = makeHangar(18, 5, { lamp: false });
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
  const hemi = new THREE.HemisphereLight(0x70728a, 0x2a2a2c, 0.9);
  scene.add(hemi);
  const moonLight = new THREE.DirectionalLight(0xb0b0e0, 1.3);
  moonLight.position.set(-40, 60, -90);
  scene.add(moonLight);
  // A second, frontal moonlight for the shots that look away from the moon.
  const frontLight = new THREE.DirectionalLight(0xb4b4c8, 0);
  frontLight.position.set(30, 50, 70);
  scene.add(frontLight);
  // Sand, as in the video: drifts and ripples, warm under the cold moonlight.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 800), new THREE.MeshStandardMaterial({ color: 0x8e8a80, map: repeatOf(sandTex, 200, 40), roughness: 1,
    bumpMap: repeatOf(duneTex, 220, 44), bumpScale: 14 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.x = 750;
  scene.add(ground);
  const { sky, moon } = nightSky(scene, 0x9890b8);
  const at = (o, x, y, z, ry = 0) => { o.position.set(x, y, z); o.rotation.y = ry; scene.add(o); return o; };

  // Apron: two jets close, huts end-on behind, the tower, the wall; a tanker on the right.
  const X = SET.apron;
  const apronJets = [at(makeJet(), X + 0, 1.5, 0, -Math.PI / 2 + 0.75), at(makeJet(), X - 3, 1.5, -11, -Math.PI / 2 + 0.7), at(makeJet(), X + 24, 1.5, -16, -Math.PI / 2 + 0.6)];
  for (const x of [-16, -6, 4, 14]) at(makeHangar(18, 4.2, { lamp: false, skin: 0x8a8e94, trapezoid: true }), X + x, 0, -52);
  at(makeTower(), X + 26, 0, -58);
  at(makeWall(140), X, 0, -66);
  const apronTanker = at(makeTruck('tanker'), X + 22, 0, -4, -Math.PI / 2 - 0.5);
  const pool = new THREE.SpotLight(0xe8eeff, 0, 120, 0.05, 0.5, 0.6);
  pool.position.set(X + 26, 45, -58);
  scene.add(pool, pool.target);
  // What the camera sees of the searchlight on the ground: a long ellipse with a soft rim,
  // laid on the apron (the spotlight above only lights whatever stands in it).
  const poolTex = canvasTexture(128, 64, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(0.78, 'rgba(255,255,255,0.75)');
    grd.addColorStop(0.92, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.scale(1, h / w); g.fillStyle = grd; g.fillRect(0, 0, w, w); g.restore();
  });
  const poolSpot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: poolTex, color: 0x4a4e56, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  poolSpot.rotation.x = -Math.PI / 2;
  poolSpot.scale.set(9, 4.2, 1);
  poolSpot.position.y = 0.03;
  scene.add(poolSpot);

  // High shot: hut, bunker and tower inside the wall's corner.
  const H = SET.high;
  at(makeHangar(14, 4.0, { lamp: false, skin: 0xb8b8bc, plain: true, trapezoid: true }), H - 9, 0, 1, 1.0);
  at(makeHangar(14, 4.0, { lamp: false, skin: 0xb8b8bc, plain: true, trapezoid: true }), H - 22, 0, 4, 1.0);
  const bunker = at(makeBunker({ cornerLamp: true }), H + 5, 0, 3.5, 0.75);
  at(makeTower(), H - 1, 0, -7);
  const highWall = at(makeWall(120), H - 4, 0, -16, 0.22);

  // Moon shot, as the video frames it: two huts with their ends turned toward the camera's
  // right, so their left flanks run back into the dark; the tower just behind the second
  // hut; a low block on the right with a lamp over its door; the wall; and a tanker parked
  // close on the right, which the camera's drift brings into frame.
  const M = SET.moon;
  const HUT_YAW = 0.5;
  for (const [x, z, rr, len, sy] of [[-4.6, -20, 6.2, 22, 1.18], [5.8, -27, 6.0, 20, 1.22]]) {
    // (x, z) is the middle of the hut's front end; the body runs back from it.
    const cx = x - Math.sin(HUT_YAW) * len / 2, cz = z - Math.cos(HUT_YAW) * len / 2;
    const hut = at(makeHangar(len, rr, { lamp: false, skin: 0x9a9ea8, trapezoid: true }), M + cx, 0, cz, HUT_YAW);
    hut.scale.y = sy;
    // The moon is behind the huts, so each throws a long shadow toward the camera.
    hut.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }
  // The moon shot's moonlight, the one light there that casts shadows.
  const moonShade = new THREE.DirectionalLight(0xb0b0e0, 0);
  moonShade.position.set(M - 32, 52, -120);
  moonShade.target.position.set(M + 3, 0, -24);
  moonShade.castShadow = true;
  moonShade.visible = false;
  moonShade.shadow.mapSize.set(2048, 2048);
  Object.assign(moonShade.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 10, far: 220 });
  moonShade.shadow.bias = -0.0008;
  scene.add(moonShade, moonShade.target);
  const moonTower = at(makeTower(), M + 11.5, 0, -35);
  moonTower.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  // A big shed far back by the wall, its lamp high on the front near the right-hand end.
  const block = at(makeBunker(), M + 31, 0, -64, 0);
  block.scale.set(2, 2.6, 1.2);
  // The block's door lamp: a hooded fitting, the fan of light it throws down the wall, and its
  // pool on the ground.
  {
    const lx = M + 37, ly = 6, lz = -64 + 4.21;
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.6), metal(0x2a2c30, 0.6, 0.5));
    hood.position.set(lx, ly + 0.15, lz + 0.3);
    const bulb = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    bulb.rotation.x = Math.PI / 2;
    bulb.position.set(lx, ly - 0.01, lz + 0.3);
    const fan = new THREE.Mesh(new THREE.PlaneGeometry(7, ly), additive(washTex, 0xd8dce8, 0.6));
    fan.rotation.z = Math.PI;
    fan.position.set(lx, ly / 2, lz + 0.05);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(pondTex, 0x7a7e88, 1));
    pool.rotation.x = -Math.PI / 2;
    pool.scale.set(9, 7, 1);
    pool.position.set(lx, 0.04, lz + 3);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: pondTex, color: 0xb8bcc8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    halo.position.set(lx, ly - 0.1, lz + 0.4);
    halo.scale.setScalar(2.4);
    const spot = new THREE.SpotLight(0xe8ecff, 400, 18, 0.9, 0.6, 1.4);
    spot.position.set(lx, ly - 0.1, lz + 0.4);
    spot.target.position.set(lx, 0, lz + 3);
    scene.add(hood, bulb, fan, pool, halo, spot, spot.target);
  }
  at(makeWall(160), M, 0, -72);
  const moonTanker = at(makeTruck('tanker'), M + 11, 0, -3.5, -0.45);
  // The searchlight's beam is a long additive frustum from the tower's lamp head: it starts
  // as wide as the lens (radius 0.4) rather than at a point, and spreads out from there.
  const tw = moonTower.userData;
  // Misty, as in the video: a wide soft glow round a brighter core, fading along its length,
  // with uneven density as if lighting drifting haze. (Drawn as fake volumetric light.)
  tw.beam.material = volumeBeam(0xcfd8f0, { len: 40, rim: 0.8, fall: 1.7, hot: 0.4, mist: 0.45 });
  tw.beam.geometry = new THREE.CylinderGeometry(1.0, 0.25, 40, 32, 16, true).translate(0, 20, 0);
  tw.beam.rotation.x = Math.PI / 2;
  tw.beam.position.z = 0.3;
  // A second, wider and fainter shell gives the beam its fuzzy edge.
  tw.beamHalo = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 0.5, 40, 32, 16, true).translate(0, 20, 0), volumeBeam(0xb8c4e0, { len: 40, rim: 0.5, fall: 2.0, hot: 0, mist: 0.6 }));
  tw.beamHalo.rotation.x = Math.PI / 2;
  tw.beamHalo.position.z = 0.3;
  tw.beam.parent.add(tw.beamHalo);
  tw.setBeam = (v) => { tw.beam.material.uniforms.opacity.value = v * 1.6; tw.beamHalo.material.uniforms.opacity.value = v * 0.45; };

  // Outside the hangar for the breakout.
  const O = SET.out;
  const hangar = at(makeHangar(26, 8.5, { lamp: false, skin: 0x4a4c52, breach: true }), O, 0, -34);
  hangar.scale.y = 1.15;
  hangar.userData.door.material.color.setScalar(0.25);
  // Turned so one of its faces looks at the hangar, as in the video.
  const outTower = at(makeTower(), O + 10, 0, -21, 0.66);
  const shed = at(makeBunker(), O + 17, 0, -16, -0.3);
  // A Nissen hut on the left, its end toward the camera, and the tanker in the foreground.
  at(makeHangar(16, 4.2, { lamp: false, skin: 0x9a9ea8, trapezoid: true }), O - 12, 0, -14, 0.05);
  at(makeWall(160), O, 0, -60);
  // The tanker from its rear quarter, heading away to the right.
  // Its right side faces the hangar, so the blast throws it over onto its left side.
  const outTruck = at(makeTruck('tanker'), O - 6.2, 0, -4.5, -1.95);
  outTruck.rotation.order = 'YXZ';
  outTruck.userData.home = outTruck.position.clone();
  // Moonlight from behind the tower, the one light here that casts shadows: the tower's lattice,
  // the hut, the shed and the tanker throw long shadows toward the camera.
  const outMoon = new THREE.DirectionalLight(0xb8c2e6, 0);
  outMoon.position.set(O + 16, 34, -78);
  outMoon.target.position.set(O + 4, 0, -8);
  outMoon.castShadow = true;
  outMoon.visible = false;
  outMoon.shadow.mapSize.set(2048, 2048);
  Object.assign(outMoon.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 10, far: 160 });
  outMoon.shadow.bias = -0.0008;
  scene.add(outMoon, outMoon.target);
  for (const o of [outTower, shed, outTruck, hangar]) o.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  scene.children.filter((o) => o.isGroup && Math.abs(o.position.x - (O - 12)) < 0.01).forEach((o) => o.traverse((m) => { if (m.isMesh) m.castShadow = true; }));
  ground.receiveShadow = true;
  const outLight = new THREE.PointLight(0xc8ccff, 0, 70, 1.5);
  scene.add(outLight);
  // Fireball, smoke, the white core and the debris.
  const r = seeded(4242);
  const fire = [];
  for (let i = 0; i < 140; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fireTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    s.userData = { x: (r() - 0.5) * 16, y: r() * 6, z: (r() - 0.5) * 18, vx: (r() - 0.5) * 2, vy: 1 + r() * 2.5, life: 0.7 + r() * 1.3, phase: r() * 3, size: 2.5 + r() * 3 };
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
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: raysTex, color: 0xb4d2ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false }));
  core.position.set(O, 5, -20);
  scene.add(core);
  // A wide, soft blue-white bloom round the core that washes the whole frame cyan.
  const bloom = new THREE.Sprite(new THREE.SpriteMaterial({ map: pondTex, color: 0x5c9cff, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0, fog: false }));
  bloom.position.set(O, 5, -19);
  bloom.scale.setScalar(70);
  scene.add(bloom);
  // God rays round the flash, and shafts of light out of the fire once it takes hold.
  const rays = new THREE.Sprite(new THREE.SpriteMaterial({ map: godRayTex, color: 0xbcd8ff, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0, fog: false }));
  rays.position.set(O, 5, -19);
  scene.add(rays);
  const fireRays = new THREE.Sprite(new THREE.SpriteMaterial({ map: godRayTex, color: 0xffa040, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0, fog: false }));
  fireRays.position.set(O, 4.2, -20);
  scene.add(fireRays);
  // One big sheet of hangar skin that tumbles toward the camera.
  const slab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 3.4), new THREE.MeshStandardMaterial({ color: 0x5a5c62, map: corrugated, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }));
  slab.visible = false;
  scene.add(slab);
  const debris = [];
  for (let i = 0; i < 18; i++) {
    // Pieces of the door, blown out of the opening toward the camera and past it on all sides.
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.4 + r() * 1.6, 0.06, 0.4 + r() * 1.3), new THREE.MeshStandardMaterial({ color: 0x6a6e74, map: doorTex, roughness: 0.6, metalness: 0.4, side: THREE.DoubleSide }));
    d.visible = false;
    d.userData = { p: V(O + (r() - 0.5) * 9, 0.6 + r() * 6, -20.6), v: V((r() - 0.5) * 30, 1 + r() * 15, 16 + r() * 18), w: V(r() * 9, r() * 9, r() * 9) };
    scene.add(d);
    debris.push(d);
  }
  const heli = makeHeli({ color: 0x3a3e44, skin: '#6a7078' });
  // A little smaller than elsewhere, so its rotor clears the opening in the hangar's front.
  heli.scale.setScalar(1.12);
  heli.visible = false;
  scene.add(heli);
  return { scene, sky, moon, hemi, moonLight, frontLight, poolSpot, apronJets, apronTanker, pool, bunker, highWall, moonTower, moonTanker, block, hangar, outTower, shed, outLight, outMoon, outTruck, moonShade, fire, smoke, core, bloom, rays, fireRays, slab, debris, heli };
}

// E-P: inside the hangar.
const HALL = { w: 9.5, wall: 4.8, arch: 5.6, len: 22 };

/** A shaft of light: an open cone with its apex at the origin, opening along +y. */
const beamGeo = (() => { const g = new THREE.ConeGeometry(0.55, 3.6, 24, 6, true); g.rotateX(Math.PI); g.translate(0, 1.8, 0); return g; })();
/**
 * Fake volumetric light for a beam cone: brightest along its axis and at the lamp, fading to
 * nothing at the cone's silhouette and toward its far end, so it reads as lit dust in the air
 * rather than a solid cone.
 */
function volumeBeam(color, { len = 3.6, rim = 1.3, fall = 1.5, hot = 0.6, mist = 0 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: 0 }, len: { value: len },
      rimPow: { value: rim }, fallPow: { value: fall }, hot: { value: hot }, mist: { value: mist } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vP;
      void main() { vY = position.y; vP = position; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = -mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; uniform float opacity; uniform float len;
      uniform float rimPow; uniform float fallPow; uniform float hot; uniform float mist;
      varying vec3 vN; varying vec3 vV; varying float vY; varying vec3 vP;
      void main() {
        float rim = pow(abs(dot(normalize(vN), normalize(vV))), rimPow);
        float along = clamp(vY / len, 0.0, 1.0);
        float fall = pow(1.0 - along, fallPow);
        // Drifting density in the air: soft, uneven patches along and across the beam.
        float m = 1.0 - mist * (0.5 + 0.5 * sin(vP.y * 0.45 + sin(vP.x * 0.8) * 1.7) * sin(vP.y * 0.17 + vP.z * 0.6 + 1.3));
        // Hotter and whiter near the lamp.
        vec3 c = mix(color, vec3(1.0, 0.97, 0.8), hot * pow(1.0 - along, 6.0));
        gl_FragColor = vec4(c * rim * fall * m * opacity, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
}

function hangarSet() {
  const { w: W, wall: HW, arch: AH, len: L } = HALL;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x010101);
  scene.fog = new THREE.Fog(0x020202, 30, 80);
  const ambient = new THREE.AmbientLight(0x2a2a30, 0.25);
  scene.add(ambient);
  const sheet = (rx, ry) => new THREE.MeshStandardMaterial({ color: 0x5e5e60, map: repeatOf(ribTex, rx, ry), roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide,
    bumpMap: repeatOf(rustBumpTex, rx / 4, ry * 3), bumpScale: 1.6 });
  for (const s of [-1, 1]) {
    const wallGeo = corrugate(new THREE.PlaneGeometry(2 * L, HW, Math.round(2 * L / 0.275 * 6), 1), 0.275, 0.045, (x) => x, () => [0, 0, 1]);
    const wall = new THREE.Mesh(wallGeo, sheet(2 * L / 0.55, 1));
    wall.rotation.y = -s * Math.PI / 2;
    wall.position.set(s * W, HW / 2, 0);
    scene.add(wall);
  }
  const roofGeo = corrugate(new THREE.CylinderGeometry(W, W, 2 * L, 48, Math.round(2 * L / 0.3 * 6), true, Math.PI / 2, Math.PI), 0.3, 0.05,
    (x, y) => y, (x, y, z) => { const l = Math.hypot(x, z) || 1; return [x / l, 0, z / l]; });
  roofGeo.rotateX(Math.PI / 2);
  roofGeo.scale(1, AH / W, 1);
  roofGeo.translate(0, HW, 0);
  const roofTex = canvasTexture(16, 64, (g, w, h) => {
    for (let y = 0; y < h; y++) { const v = 80 + 60 * Math.max(0, Math.sin(y / h * Math.PI * 4)); g.fillStyle = `rgb(${v},${v},${v - 4})`; g.fillRect(0, y, w, 1); }
  }, { repeat: [1, 2 * L / 0.6] });
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0x6a6a6e, map: roofTex, roughness: 0.5, metalness: 0.55, side: THREE.DoubleSide, bumpMap: repeatOf(rustBumpTex, 2, 2 * L / 1.5), bumpScale: 1.6 }));
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
  // Dark granite with bright flecks, which glint as the camera moves.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 2 * L), new THREE.MeshStandardMaterial({ color: 0x8a8884, map: repeatOf(speckleTex, 8, 18), roughness: 0.42, metalness: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  // Ridge lights: a beam carrying a row of fluorescent panels.
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.25, 2 * L), new THREE.MeshBasicMaterial({ color: 0x050505 }));
  ridge.position.set(0, HW + AH - 0.2, 0);
  scene.add(ridge);
  for (let k = 0; k < 9; k++) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 2.6), new THREE.MeshBasicMaterial({ color: 0xf8faff }));
    p.position.set(0, HW + AH - 0.36, -L + 2.5 + k * 4.9);
    scene.add(p);
    // The haze of light round each panel, as in the video.
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 5.6), additive(pondTex, 0xdfe6ff, 0.8));
    glow.rotation.x = Math.PI / 2;
    glow.position.set(0, HW + AH - 0.4, p.position.z);
    scene.add(glow);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: pondTex, color: 0xcfd8f0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.35, fog: false }));
    halo.position.set(0, HW + AH - 0.6, p.position.z);
    halo.scale.set(5.2, 3.2, 1);
    halo.material.opacity = 0.5;
    scene.add(halo);
  }
  const ridgeLights = [-12, 0, 12].map((z) => {
    const l = new THREE.PointLight(0xeef2ff, 16, 30, 1.2);
    l.position.set(0, HW + AH - 1.2, z);
    scene.add(l);
    return l;
  });
  // Floor uplights along both walls, each throwing a fan of warm light up the wall.
  const uplights = { [-1]: [], [1]: [] };
  const washMat = { [-1]: additive(washTex, 0xfff0c8, 0), [1]: additive(washTex, 0xfff0c8, 0) };
  for (const s of [-1, 1]) {
    for (let z = -L + 2.5; z < L - 1; z += 3) {
      // No visible housing: in the video only the lamp's light shows.
      // A short fan, about a quarter of the way up the wall, as in the video.
      const wash = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), washMat[s]);
      wash.rotation.y = -s * Math.PI / 2;
      wash.position.set(s * (W - 0.04), 0.8, z);
      scene.add(wash);
    }
    const fill = [-10, 6].map((z) => {
      const l = new THREE.PointLight(0xffe0a8, 0, 16, 1.3);
      l.position.set(s * (W - 1.2), 1.0, z);
      scene.add(l);
      return l;
    });
    uplights[s] = { wash: washMat[s], fill };
  }

  // The pad: two tiers, a hazard ring on the floor, hoses, amber beacons round the lower tier.
  const padTop = new THREE.MeshStandardMaterial({ color: 0x77756f, map: repeatOf(speckleTex, 4, 4), roughness: 0.45, metalness: 0.45 });
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
  }, { repeat: [22, 1] });
  // A narrow band, as in the video, not a wide road marking.
  const ring = new THREE.Mesh(new THREE.RingGeometry(8.0, 8.32, 160, 1), new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
  // RingGeometry's UVs are planar; remap u round the ring so the stripes run along it.
  { const p = ring.geometry.attributes.position, uv = ring.geometry.attributes.uv;
    for (let i = 0; i < p.count; i++) { const a = Math.atan2(p.getY(i), p.getX(i)); uv.setXY(i, (a / (Math.PI * 2) + 0.5), Math.hypot(p.getX(i), p.getY(i)) > 8.16 ? 1 : 0); } }
  scene.add(ring);
  const rubber = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.6, metalness: 0.2 });
  // A thick ribbed hose laid round the top of the lower tier's wall.
  const ribs = canvasTexture(64, 8, (g, w, h) => {
    for (let x = 0; x < w; x++) { const v = 40 + 70 * Math.max(0, Math.sin(x / w * Math.PI * 8)); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, h); }
  }, { repeat: [60, 1] });
  const hose = new THREE.Mesh(new THREE.TorusGeometry(6.42, 0.21, 12, 180), new THREE.MeshStandardMaterial({ color: 0x6a6a64, map: ribs, bumpMap: ribs, bumpScale: 2, roughness: 0.4, metalness: 0.55 }));
  hose.rotation.x = Math.PI / 2; hose.position.y = 0.42 + 0.2;
  scene.add(hose);
  for (const [a, len] of [[0.35, 1], [0.85, 0.7], [1.95, 0.85], [2.8, 0.9], [3.5, 1.1], [5.9, 0.9]]) {
    const pts = [];
    for (let i = 0; i <= 7; i++) {
      const rr = 6.6 + i * 0.75 * len;
      const ww = a + Math.sin(i * 1.3 + a) * 0.1;
      pts.push(V(Math.cos(ww) * rr, i === 0 ? 0.3 : 0.12, Math.sin(ww) * rr));
    }
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.14, 8), rubber));
    // White couplings where the hoses plug into the pad.
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 12), metal(0xd8d8d0, 0.35, 0.4));
    c.position.copy(pts[0]); c.rotation.z = Math.PI / 2; c.rotation.y = -a;
    scene.add(c);
  }
  // Amber beacons round the lower tier, as in the video: a lamp that spins like a propeller in
  // the plane facing out from the pad, throwing two opposite shafts of light. Each has a soft
  // flare on its lens, a pool where the lower shaft meets the floor, and a streak reflected in
  // the polished floor under it.
  const beacons = [];
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2 + Math.PI / 8;
    const out = V(Math.cos(a), 0, Math.sin(a));
    const p = V(Math.cos(a) * 6.9, 0.24, Math.sin(a) * 6.9);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.32, 16), metal(0x8a8c90, 0.35, 0.85));
    housing.rotation.z = Math.PI / 2; housing.rotation.y = -a;
    housing.position.copy(p);
    scene.add(housing);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.12, 14, 10), new THREE.MeshBasicMaterial({ color: 0x302010 }));
    lens.position.copy(p).addScaledVector(out, 0.14).add(V(0, 0.02, 0));
    scene.add(lens);
    const flare = (map, color, size) => {
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, fog: false }));
      f.position.copy(lens.position).addScaledVector(out, 0.06);
      f.scale.setScalar(size);
      scene.add(f);
      return f;
    };
    const core = flare(pondTex, 0xfffbe8, 0.75);
    const glow = flare(pondTex, 0xffc828, 2.2);
    // The spinning head: local z points out from the pad; the shafts lie in its x-y plane,
    // tipped a little outward so the lower one lands on the floor in front of the lamp.
    const mount = new THREE.Group();
    mount.position.copy(lens.position);
    mount.lookAt(lens.position.clone().add(out));
    const spin = new THREE.Group();
    mount.add(spin);
    const beams = [1, -1].map((s) => {
      const beam = new THREE.Mesh(beamGeo, volumeBeam(0xffd23a));
      beam.quaternion.setFromUnitVectors(V(0, 1, 0), V(0, s * Math.cos(0.22), Math.sin(0.22)));
      spin.add(beam);
      return beam;
    });
    scene.add(mount);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(pondTex, 0xffd040, 0));
    pool.rotation.x = -Math.PI / 2;
    scene.add(pool);
    const streak = new THREE.Sprite(new THREE.SpriteMaterial({ map: pondTex, color: 0xffd040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
    streak.center.set(0.5, 0.92);
    streak.position.copy(p).addScaledVector(out, 0.42).setY(0.02);
    streak.scale.set(0.34, 1.3, 1);
    scene.add(streak);
    // The two beacons in front of the pad also light the floor and the pad's wall for real, so
    // the polished floor shows a highlight under them.
    let light = null;
    if (k === 1 || k === 2) {
      light = new THREE.PointLight(0xffc840, 0, 4.5, 1.6);
      light.position.copy(lens.position).addScaledVector(out, 0.35).add(V(0, 0.15, 0));
      scene.add(light);
    }
    beacons.push({ a, out, lens, mount, spin, beams, core, glow, pool, streak, light, phase: k * 0.9 });
  }
  const amber = [0, 1].map(() => {
    const l = new THREE.SpotLight(0xffc830, 0, 14, 0.2, 0.6, 1.3);
    scene.add(l, l.target);
    return l;
  });
  // Third tier: a raised ring round a sunken well. The pedestal and the four clamps stand on
  // the well's floor (the top of the second tier).
  const WELL = 0.87;
  const tier3 = new THREE.Mesh(new THREE.LatheGeometry([V(2.7, WELL, 0), V(2.7, WELL + 0.3, 0), V(2.78, WELL + 0.34, 0), V(3.5, WELL + 0.34, 0), V(3.6, WELL, 0)].map((v) => new THREE.Vector2(v.x, v.y)), 72), padTop.clone());
  tier3.material.side = THREE.DoubleSide;
  scene.add(tier3);
  const wellFloor = new THREE.Mesh(new THREE.CircleGeometry(2.7, 64), new THREE.MeshStandardMaterial({ color: 0x8a7e66, map: repeatOf(mottleTex, 2, 2), roughness: 0.6, metalness: 0.3 }));
  wellFloor.rotation.x = -Math.PI / 2; wellFloor.position.y = WELL + 0.005;
  scene.add(wellFloor);
  // Pedestal: a waisted column under a wide cushion with a rolled, rounded rim, in grimy
  // olive-bronze cast metal like the clamps.
  const bronze = new THREE.MeshStandardMaterial({ color: 0x9a8a62, map: repeatOf(mottleTex, 2, 1), roughness: 0.4, metalness: 0.45, bumpMap: mottleTex, bumpScale: 0.6 });
  // A lamp in the gap under the belly for the clamp shot, which is lit from there in the video:
  // a sheen across the cushion and bright bevels on the clamps.
  const clampLight = new THREE.PointLight(0xfff2dc, 0, 5, 1.5);
  clampLight.position.set(0.3, 3.2, -1.7);
  scene.add(clampLight);
  // The gunship stands high on its clamps, as in the video, so the column is tall.
  const pedProfile = [[0.85, 0], [0.7, 0.1], [0.62, 0.28], [0.66, 1.0], [0.7, 1.27], [0.95, 1.35], [1.12, 1.41], [1.17, 1.49], [1.12, 1.56], [0.9, 1.59], [0.5, 1.6], [0.001, 1.605]];
  const ped = new THREE.Mesh(new THREE.LatheGeometry(pedProfile.map(([r, y]) => new THREE.Vector2(r, WELL + y)), 48), bronze);
  scene.add(ped);
  // Clamps, as in the video: a fixed J-shaped arm of straight, bevelled segments rising from
  // beside the pedestal's foot, topped by an anvil jaw (a trapezoid block under a thin flange
  // with an upturned horn) that grips the belly. Only the jaw moves: it tilts level to let go.
  // Each clamp is drawn in its own radial plane (u outward, v up) and extruded sideways.
  const facet = new THREE.MeshStandardMaterial({ color: 0x9a8a62, map: repeatOf(mottleTex, 1, 1), roughness: 0.5, metalness: 0.35, flatShading: true });
  const prism = (pts, width, bevel = 0.025) => {
    const sh = new THREE.Shape();
    pts.forEach(([u, v], i) => (i ? sh.lineTo(u, v) : sh.moveTo(u, v)));
    sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
    geo.translate(0, 0, -width / 2);
    return geo;
  };
  const sideways = (pts, width, bevel) => { const g = prism(pts, width, bevel); g.rotateY(-Math.PI / 2); return new THREE.Mesh(g, facet); };
  const ARM_RISE = 1.6;
  // The arm: up and out, then straight up, then a short step back in under the jaw.
  const spine = [[0, 0], [0.5, 0.36], [0.56, 1.47], [0.5, ARM_RISE]];
  const armPts = [];
  for (const side of [1, -1]) {
    const pts = spine.map(([u, v], i) => {
      const [u0, v0] = spine[Math.max(0, i - 1)], [u1, v1] = spine[Math.min(spine.length - 1, i + 1)];
      const l = Math.hypot(u1 - u0, v1 - v0);
      return [u - (v1 - v0) / l * 0.16 * side, v + (u1 - u0) / l * 0.16 * side];
    });
    armPts.push(...(side > 0 ? pts : pts.reverse()));
  }
  const clamps = [];
  for (let k = 0; k < 4; k++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = Math.PI / 4 + k * Math.PI / 2;
    const base = new THREE.Group();
    base.position.set(0, WELL, 1.15);
    base.add(sideways(armPts, 0.4, 0.04));
    // The jaw hinges on a tangential axis at the arm's head.
    const jaw = new THREE.Group();
    jaw.position.set(0, ARM_RISE, 0.5);
    // Block: wider at the top, its trapezoid face turned round the pedestal (x).
    const block = new THREE.Mesh(prism([[-0.25, 0], [0.25, 0], [0.38, 0.2], [-0.38, 0.2]], 0.56, 0.02), facet);
    jaw.add(block);
    // Flanges: two thin plates crossing on top (a cross seen from above), each longer than the
    // block, with one end turned up in a horn.
    for (const turn of [0, -Math.PI / 2]) {
      const flange = new THREE.Mesh(prism([[-0.8, 0], [0.7, 0], [0.94, 0.22], [0.85, 0.27], [0.63, 0.07], [-0.8, 0.07]], 0.4, 0.015), facet);
      flange.rotation.y = turn;
      flange.position.y = 0.19 + (turn ? 0.004 : 0);
      jaw.add(flange);
    }
    base.add(jaw);
    pivot.add(base);
    scene.add(pivot);
    clamps.push({ group: base, jaw });
  }
  // In the hangar the video's gunship is matte, with a squarer nose and a dull windscreen
  // catching the ridge lights.
  const heli = makeHeli({ color: 0x4a4640, skin: '#8a847a', roughness: 0.82, metalness: 0.2, square: 1.4,
    // Clear glass: dark, with the hall's ceiling lights and walls mirrored in it.
    glass: { color: new THREE.Color(0x4a4c52), roughness: 0.06, metalness: 0.95, envMapIntensity: 1.6 } });
  heli.scale.setScalar(1.3);
  scene.add(heli);
  // The loose missile for P (and the one that falls in O, which is the heli's own).
  const shot = makeMissile();
  shot.visible = false;
  scene.add(shot);
  const motor = new THREE.PointLight(0xffb060, 0, 10, 1.4);
  scene.add(motor);
  const key = new THREE.SpotLight(0xd8dcff, 34, 30, 0.6, 0.8, 1.2);
  key.position.set(0, HW + AH - 1, 4);
  key.target.position.set(0, 3, 0);
  scene.add(key, key.target);
  return { scene, ridgeLights, uplights, beacons, amber, clamps, clampLight, pedestal: [ped, tier3, wellFloor], heli, shot, motor, key, ambient };
}

// S: the dusk run.
/** Overcast dusk: dark, ragged cloud banks with paler gaps, stretched wide. */
const duskCloudTex = (() => {
  const t = canvasTexture(512, 256, (g, w, h) => {
    const r = seeded(2468);
    for (let i = 0; i < 260; i++) {
      const x = r() * w, y = r() * h, sx = 30 + r() * 90, sy = 6 + r() * 16;
      const dark = r() < 0.6;
      // Thinner toward the horizon (the bottom of the canvas), where the haze takes over.
      const a = (dark ? 0.4 : 0.22) * (1 - 0.7 * y / h);
      for (const dx of [-w, 0, w]) {
        g.save(); g.translate(x + dx, y); g.scale(1, sy / sx);
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, sx);
        grd.addColorStop(0, dark ? `rgba(22,24,30,${a})` : `rgba(170,166,150,${a})`); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(-sx, -sx, 2 * sx, 2 * sx); g.restore();
      }
    }
    // Fade the dome's lower edge out, so it doesn't leave a hard line above the horizon.
    g.globalCompositeOperation = 'destination-in';
    const fade = g.createLinearGradient(0, 0, 0, h);
    fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.6, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade; g.fillRect(0, 0, w, h);
  });
  t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1);
  return t;
})();

function duskSet() {
  const scene = new THREE.Scene();
  const haze = new THREE.Color(0x5e5d4e);
  scene.background = haze;
  // Denser haze, the same colour as the sky's horizon band, so land and sky melt together
  // instead of meeting at a hard line.
  // A touch brighter than the sky's horizon colour: fully fogged land renders a little darker, and
  // this makes the two meet without a line.
  scene.fog = new THREE.FogExp2(0x828e6e, 0.0019);
  scene.add(new THREE.HemisphereLight(0x9aa2b4, 0x1c2c16, 1.2));
  const sun = new THREE.DirectionalLight(0xffe8c4, 1.2);
  sun.position.set(-20, 30, -100);
  scene.add(sun);
  const front = new THREE.DirectionalLight(0x9aa4b8, 0.8);
  front.position.set(10, 20, 60);
  scene.add(front);
  const skyTex = canvasTexture(8, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#1e222c'); grd.addColorStop(0.3, '#2c313a'); grd.addColorStop(0.4, '#4a4c46');
    grd.addColorStop(0.45, '#62645a'); grd.addColorStop(0.48, '#727460'); grd.addColorStop(0.5, '#727c60'); grd.addColorStop(1, '#727c60');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 24), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -2;
  scene.add(sky);
  const cloud = new THREE.Mesh(new THREE.SphereGeometry(880, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2 - 0.03),
    new THREE.MeshBasicMaterial({ map: duskCloudTex, side: THREE.BackSide, fog: false, transparent: true, depthWrite: false }));
  cloud.renderOrder = -1;
  scene.add(cloud);
  const landTex = canvasTexture(256, 256, (g, w, h) => {
    const r = seeded(17);
    g.fillStyle = '#26381e'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = r() * w, y = r() * h, rad = 4 + r() * 22;
      const grd = g.createRadialGradient(x, y, 0, x, y, rad);
      const k = r();
      grd.addColorStop(0, k < 0.5 ? 'rgba(10,14,8,0.5)' : 'rgba(60,70,50,0.35)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }, { repeat: [200, 200] });
  // Dark green country, as in the video. Big enough to reach past the camera's far plane, so
  // its edge never shows as a line under the haze.
  const land = new THREE.Mesh(new THREE.PlaneGeometry(20000, 20000), new THREE.MeshStandardMaterial({ map: landTex, color: 0xffffff, roughness: 1, envMapIntensity: 0.2 }));
  land.rotation.x = -Math.PI / 2;
  scene.add(land);
  const heli = makeHeli({ color: 0x9aa0a8, skin: '#b0b6be', roughness: 0.5, metalness: 0.3 });
  heli.scale.setScalar(1.3);
  scene.add(heli);
  // Four missiles, each laying a trail of puffs that start fiery red and cool to white.
  const r = seeded(808);
  const missiles = heli.userData.missiles.map((src, i) => {
    const m = makeMissile();
    m.visible = false;
    m.scale.setScalar(1.8);
    scene.add(m);
    const puffs = [];
    for (let k = 0; k < 130; k++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.userData = { jx: (r() - 0.5) * 0.3, jy: (r() - 0.5) * 0.3, sz: 0.65 + r() * 0.3 };
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
/**
 * The SWIV 3D logo, traced from the video's logo frames (an average of frames 885-930 of
 * INTRO2, thresholded and traced): `outline` is the whole chrome silhouette including the 3-D
 * gunsight; `faces` is that silhouette shrunk by the chrome border's width (about 3 video
 * pixels), which gives the pale-blue letter faces. Units: the traced area is 1000 wide.
 */
const LOGO_TRACE = {"w": 1000, "h": 312.5, "outline": "M343,15 347,15 350,16 353,16 354,17 355,18 355,20 355,21 354,23 354,25 355,26 355,27 356,27 357,28 360,28 364,28 369,28 373,27 376,27 377,25 378,24 378,22 379,21 380,19 380,18 381,17 382,17 383,16 384,16 386,16 389,16 394,15 400,15 405,15 408,15 410,15 411,16 411,17 410,18 410,20 408,22 407,24 406,28 404,32 403,37 400,45 396,55 390,67 384,82 378,94 374,103 372,109 371,112 369,116 367,120 365,124 363,128 361,131 359,134 359,136 359,137 358,138 357,139 356,141 355,142 354,144 354,145 354,146 354,147 355,148 356,148 357,149 359,149 361,149 363,149 364,148 366,148 367,147 368,146 368,144 368,143 368,141 369,140 370,139 371,138 375,131 381,118 389,100 400,76 408,57 413,45 416,38 416,37 416,35 417,34 418,33 419,32 420,31 420,30 420,29 420,28 420,26 421,25 421,23 421,21 422,20 423,18 423,17 424,17 424,16 425,16 426,15 428,15 429,15 432,15 434,15 437,15 440,15 441,16 442,16 443,17 443,18 443,19 443,21 443,23 443,25 443,26 444,27 444,28 446,28 448,28 451,28 455,28 458,27 460,27 461,25 461,23 462,22 463,20 464,19 465,18 468,17 472,16 477,15 484,15 489,15 493,15 495,15 496,15 493,23 487,36 479,57 467,84 458,105 451,119 447,128 446,130 444,132 444,134 443,136 442,137 442,139 441,141 440,142 439,143 438,144 438,145 438,146 438,147 439,147 440,148 441,148 443,149 445,149 447,149 448,148 450,148 451,147 452,146 453,144 453,143 453,141 454,140 455,139 456,138 457,137 457,136 458,135 458,133 458,132 459,131 460,130 461,129 461,127 462,126 462,125 462,124 465,118 470,107 477,92 486,71 493,56 497,45 500,38 500,37 500,35 501,34 502,33 503,33 504,32 504,31 504,30 504,28 504,27 504,25 505,23 505,21 505,20 506,19 506,18 507,17 508,16 509,16 510,15 511,15 513,15 515,15 518,15 521,15 523,16 525,16 526,17 527,17 527,18 527,20 527,21 527,23 527,25 527,26 527,27 528,28 530,28 533,28 538,28 544,28 550,27 553,26 555,24 556,22 557,20 558,19 559,18 560,17 562,16 566,16 571,15 577,15 582,15 586,16 588,16 588,17 588,18 588,20 587,21 585,23 584,24 584,26 583,27 584,28 583,29 583,30 582,32 581,33 579,37 576,43 572,52 567,63 563,74 559,83 556,90 553,97 550,103 548,109 545,115 543,120 540,125 538,129 537,133 536,136 534,140 533,143 530,147 528,150 525,153 523,156 522,159 521,162 520,164 518,167 516,170 514,173 511,176 507,179 502,183 497,187 491,191 485,194 479,197 472,200 465,202 456,204 446,206 435,208 418,209 394,209 363,210 325,210 295,210 273,210 259,209 253,209 248,209 244,209 242,208 240,207 238,207 235,208 232,208 229,209 227,209 225,209 223,209 222,209 221,208 220,207 221,207 221,206 222,205 224,205 226,204 227,203 228,202 229,201 230,200 232,199 233,198 235,197 237,196 239,195 241,193 243,192 244,190 246,189 247,188 248,186 249,184 251,183 253,180 255,178 258,175 261,172 263,169 266,165 270,156 277,143 285,125 294,103 303,83 310,67 317,54 322,43 325,35 328,29 329,26 330,24 330,23 330,22 331,20 331,19 332,18 333,17 334,16 335,15 337,15 340,15ZM611,15 614,15 617,16 618,16 620,17 621,18 621,19 621,20 621,21 621,22 621,23 622,23 625,24 630,24 638,24 648,24 656,24 662,23 665,22 666,20 667,18 669,17 672,16 676,16 679,15 682,15 686,15 690,15 693,15 695,15 696,15 697,16 697,17 697,18 697,20 696,21 695,23 693,26 692,29 690,31 689,35 687,38 686,41 685,43 684,44 683,45 677,45 667,45 651,46 631,46 615,45 604,45 599,45 598,44 597,44 596,44 595,44 593,44 592,44 591,44 590,43 590,42 590,41 591,39 592,38 593,37 594,35 594,33 595,30 596,28 597,26 598,25 599,24 600,23 600,21 601,20 601,19 601,18 602,17 602,16 604,15 605,15 608,15ZM719,15 723,15 726,16 728,16 729,17 730,17 730,18 730,20 730,22 730,24 730,26 730,27 731,28 733,28 736,28 741,28 748,28 753,28 756,28 758,27 759,26 759,25 759,24 760,22 760,21 761,19 762,18 764,17 766,16 770,16 775,15 781,15 786,15 789,15 791,15 792,16 790,21 786,32 780,48 771,68 764,86 757,100 753,111 749,118 746,124 744,128 743,131 742,132 741,133 740,134 740,135 740,137 739,138 738,139 738,141 737,142 736,143 735,144 735,145 735,146 735,147 736,148 737,149 738,149 740,149 742,149 744,149 745,149 746,149 748,148 749,146 749,145 750,143 750,142 751,140 752,139 754,139 755,138 755,136 755,135 755,133 757,128 761,118 767,105 775,88 781,74 786,62 790,53 793,46 795,40 797,36 799,33 800,32 801,31 801,30 801,29 801,28 801,26 802,25 802,23 803,21 804,20 804,18 805,17 806,16 807,16 808,15 810,15 812,15 814,15 816,15 818,15 820,15 822,16 824,16 824,17 825,17 825,18 825,20 825,21 825,23 825,25 825,26 825,27 826,28 829,28 835,28 844,28 856,28 865,28 872,28 875,28 875,27 876,27 876,26 877,24 877,22 878,21 879,19 880,18 882,17 884,16 888,16 894,15 900,15 905,15 908,15 910,15 910,16 911,16 911,17 911,18 911,19 910,21 909,23 907,27 905,31 902,36 899,43 895,50 892,58 889,65 886,71 883,76 881,80 879,84 877,87 875,90 874,94 873,97 871,99 870,101 868,103 867,105 865,108 863,111 861,115 858,120 852,127 846,134 838,143 829,152 821,159 812,166 803,172 794,178 786,183 778,187 771,190 764,193 757,196 750,198 742,200 735,202 728,204 721,205 715,206 708,207 702,208 695,208 688,209 681,209 673,209 663,210 653,210 646,210 640,209 636,209 634,209 632,208 630,208 627,209 624,209 620,209 616,209 610,209 604,209 600,209 596,208 595,208 595,207 595,206 596,206 597,205 598,204 600,204 602,203 605,202 608,200 612,197 616,194 620,191 623,189 624,187 626,185 627,183 629,181 630,179 633,177 635,175 637,172 640,169 642,165 645,161 647,158 649,155 650,153 651,150 652,148 653,146 653,145 654,141 656,135 660,127 665,117 670,108 673,100 676,94 678,88 680,83 682,78 685,73 687,69 690,64 692,59 694,54 695,49 697,44 699,40 701,37 703,34 704,31 705,29 705,27 706,26 706,24 706,23 707,21 708,19 709,18 710,17 711,16 712,15 714,15 716,15ZM317,15 318,15 319,16 319,17 319,18 319,20 318,21 317,22 316,24 315,25 315,26 315,28 315,29 314,31 313,33 312,36 310,38 309,41 308,44 307,47 306,49 306,51 305,53 304,54 303,55 302,57 302,59 301,61 301,63 300,64 299,66 298,67 290,67 273,68 249,68 217,69 193,69 176,71 168,73 167,76 167,78 167,79 167,80 168,81 169,81 170,82 171,81 173,81 174,81 176,80 179,80 182,80 189,80 201,80 218,80 239,80 256,80 269,80 278,80 282,80 285,80 288,81 290,81 291,82 291,83 292,84 292,85 291,86 291,87 290,88 288,89 287,91 286,92 285,94 285,96 284,99 282,103 279,109 276,115 273,121 271,126 270,131 269,134 268,138 266,141 264,144 262,147 261,150 259,152 258,154 257,155 255,156 254,158 253,160 253,162 251,164 249,167 246,171 243,175 239,179 235,183 231,186 226,189 221,192 216,195 211,198 205,200 200,202 197,203 194,203 192,203 190,204 189,204 187,205 185,205 182,206 180,206 177,207 175,207 172,207 168,207 165,208 161,208 150,209 134,209 111,210 82,210 60,210 46,209 38,209 37,209 35,208 33,208 30,208 26,209 23,209 21,209 19,209 19,208 18,208 18,207 18,206 18,205 18,204 19,203 20,201 21,200 21,198 21,197 21,195 21,193 22,191 23,189 24,187 26,185 27,182 29,179 30,176 31,173 32,170 33,168 33,166 34,164 35,162 37,160 39,157 41,155 43,154 46,154 48,154 50,154 52,154 53,154 54,155 55,155 57,155 59,155 61,154 67,154 79,153 95,153 115,153 131,153 142,154 148,154 150,154 152,155 155,155 158,154 161,154 164,153 167,152 169,150 170,148 172,146 172,145 173,144 173,143 172,143 171,142 163,141 148,141 127,141 99,141 78,141 62,141 53,140 50,140 49,136 50,130 53,121 58,110 63,99 67,90 72,81 76,73 80,66 83,61 86,57 89,55 91,52 92,50 93,49 94,48 95,46 97,45 98,43 100,42 102,41 104,40 106,39 107,39 109,38 110,37 111,36 113,34 114,32 116,31 118,30 119,29 121,28 123,28 124,27 125,27 125,28 126,28 127,28 128,29 129,29 130,29 130,28 131,28 131,27 132,26 134,25 135,25 137,24 138,23 140,22 141,21 143,20 146,20 149,20 153,20 156,19 158,19 160,19 161,18 163,17 164,17 166,16 168,16 170,16 172,16 173,16 175,16 176,16 178,16 179,17 180,17 180,18 180,19 180,20 179,21 178,22 177,23 177,24 176,24 176,25 176,26 176,27 177,27 177,28 184,28 198,28 218,28 244,28 265,28 279,27 288,27 290,27 292,26 293,25 295,23 296,21 297,20 298,18 299,17 301,16 303,16 306,15 310,15 313,15 315,15ZM595,58 597,59 598,59 600,59 602,59 604,59 608,58 614,58 622,58 633,58 643,58 652,58 660,58 666,58 672,58 675,58 677,58 677,59 678,59 678,60 678,61 677,62 677,63 676,64 675,65 674,66 674,67 674,69 674,70 673,72 672,73 671,75 670,78 667,82 664,89 660,99 655,110 651,119 648,126 646,131 646,132 645,136 643,140 640,146 636,153 632,159 627,166 623,171 617,177 613,182 609,186 605,189 602,191 598,193 594,195 589,197 585,199 579,201 573,203 566,205 558,206 548,207 537,208 525,209 510,209 500,209 492,209 489,208 488,207 488,206 489,205 490,204 492,204 494,203 497,201 500,199 504,196 509,193 515,188 520,184 524,180 526,176 528,173 530,169 533,165 536,160 539,155 542,151 544,148 545,146 545,144 547,139 551,131 556,119 563,104 569,92 573,82 576,76 577,72 578,69 580,66 581,64 583,63 584,61 586,60 588,59 590,59 592,58 594,58ZM900,118 901,118 902,119 903,119 904,120 904,122 904,125 905,130 905,136 906,141 908,145 910,147 914,148 918,149 922,150 926,152 929,154 933,156 936,158 939,160 941,162 943,164 945,166 947,168 949,170 950,172 951,174 953,176 954,178 955,181 956,185 957,190 959,195 960,199 961,202 961,203 962,204 963,204 966,204 970,204 975,204 979,204 982,205 984,205 985,206 986,206 986,207 987,208 987,209 986,210 986,211 985,212 985,213 983,213 980,214 977,214 972,214 968,214 965,214 964,215 963,215 962,217 961,219 960,223 958,228 957,232 954,237 952,243 948,248 945,253 940,258 936,262 931,265 926,268 921,270 917,271 913,272 910,273 908,274 906,274 906,275 905,276 905,279 905,284 905,290 904,294 904,298 904,300 903,300 902,301 901,301 900,301 899,301 898,301 897,300 896,298 896,294 896,289 896,283 894,278 892,274 889,272 884,271 879,269 875,266 870,263 865,260 861,256 857,251 853,245 849,239 846,233 845,229 844,226 843,223 843,221 843,219 843,218 842,217 841,216 838,216 835,215 830,215 826,215 822,215 820,215 817,216 816,216 814,216 813,215 812,215 811,214 811,213 810,213 810,212 810,211 810,210 810,209 810,208 810,207 811,206 812,206 814,205 817,205 822,204 828,204 833,204 837,204 839,204 840,203 841,202 842,201 842,199 843,197 843,195 843,193 844,190 845,188 846,185 848,182 851,178 853,173 856,169 859,165 863,162 866,159 869,157 872,155 875,153 878,152 880,150 883,149 887,148 890,147 893,145 895,142 896,137 896,131 896,126 896,123 897,121 898,120 898,119 899,119ZM885,160 880,162 876,164 872,166 868,169 865,173 862,176 860,179 857,183 856,186 854,190 853,194 852,198 851,202 851,206 850,210 851,215 851,219 852,223 852,226 853,229 854,231 855,233 857,237 860,241 864,247 868,251 872,255 876,257 880,259 883,260 887,261 889,262 891,262 893,262 894,262 895,262 896,258 896,252 896,243 896,231 895,222 895,216 894,213 893,213 892,213 891,214 891,216 891,217 891,219 890,221 889,223 888,225 886,226 884,228 881,229 878,230 874,230 870,230 868,230 865,230 864,230 862,229 861,228 860,227 860,226 859,225 859,224 859,223 859,222 859,221 859,220 860,219 861,219 862,219 864,219 866,219 868,219 870,219 871,219 872,218 873,218 873,217 873,216 872,215 871,215 870,214 867,213 866,212 865,211 864,210 864,209 864,208 864,207 864,206 865,205 866,205 867,204 868,204 870,204 871,204 872,203 873,203 873,202 873,201 872,200 871,199 870,199 868,199 866,198 863,198 862,198 860,197 859,196 859,195 859,193 859,192 859,191 860,191 861,190 863,189 865,189 867,188 870,188 873,188 876,188 879,189 882,189 884,190 886,192 888,194 889,195 890,197 891,199 891,201 891,202 892,203 892,204 893,204 894,204 895,204 895,203 896,200 896,194 896,186 896,175 896,167 895,161 894,158 893,157 891,157 889,158ZM906,157 905,158 905,161 905,167 905,175 905,187 905,195 905,201 905,204 906,204 907,205 908,204 909,204 910,203 910,202 911,199 911,197 911,194 911,192 912,191 914,190 917,190 921,190 926,190 930,190 934,191 938,192 940,194 943,196 945,198 946,200 947,203 947,206 947,209 947,213 946,217 945,221 944,223 943,225 942,227 941,228 940,229 939,229 938,230 936,230 932,231 928,231 922,231 918,231 915,231 913,230 912,230 912,228 911,227 911,224 911,221 911,218 911,217 910,215 909,215 908,215 907,215 906,215 906,219 905,225 905,233 905,245 905,253 905,259 905,262 906,263 907,263 908,263 910,263 913,262 917,260 922,258 927,255 931,252 935,249 938,246 940,243 942,241 944,238 945,236 946,234 947,232 948,229 949,226 950,223 950,219 951,214 951,209 951,204 950,199 949,194 947,189 945,184 943,180 940,176 937,173 934,170 930,167 926,164 922,162 918,160 915,158 912,157 910,157 909,157 907,157Z", "faces": "M435,21 436,21 437,22 438,24 438,26 438,28 438,30 438,31 439,32 439,33 441,33 444,33 449,33 455,33 460,33 464,31 467,29 468,26 470,24 473,22 477,21 481,21 481,27 478,39 471,58 460,82 451,102 444,117 440,127 437,132 435,136 433,141 432,144 433,148 433,150 434,152 436,153 438,154 440,154 442,154 445,155 448,155 451,154 453,154 455,154 456,153 457,152 457,151 458,150 458,148 458,147 459,146 460,145 461,144 464,138 469,127 476,112 485,92 492,76 497,64 500,56 502,52 503,49 504,46 505,44 505,42 505,41 506,39 507,39 508,38 509,37 510,35 510,32 511,29 511,26 511,24 512,23 512,22 513,22 514,21 515,21 517,21 518,21 519,21 520,21 521,22 521,24 521,26 521,28 521,30 522,31 522,32 522,33 525,33 529,33 536,33 545,33 552,33 557,31 560,29 562,26 564,24 566,23 569,22 573,21 575,21 577,22 578,22 578,24 577,27 574,34 569,44 563,56 557,69 551,83 545,97 539,112 534,124 529,134 526,140 523,144 520,148 518,151 517,154 516,156 515,159 513,162 510,166 507,169 503,173 498,177 493,181 487,185 481,189 476,192 471,194 466,196 461,197 455,199 450,200 444,201 438,202 432,203 427,203 422,204 409,204 389,204 361,204 326,204 298,204 278,204 264,204 258,204 253,204 249,204 247,203 246,202 246,201 248,197 252,193 257,188 261,182 266,177 270,172 273,166 277,159 282,149 288,136 294,121 301,106 308,90 315,74 323,58 328,45 332,36 335,31 335,29 335,28 336,26 337,25 338,23 340,22 341,21 343,21 346,21 347,22 348,24 349,26 349,28 349,30 349,31 350,32 350,33 353,33 357,33 363,33 370,33 376,33 380,32 382,31 383,29 383,27 384,26 385,25 386,23 387,23 390,22 392,21 396,21 398,22 399,24 399,28 398,32 395,40 391,49 385,62 378,76 373,88 369,97 366,104 365,107 364,111 362,114 360,118 357,123 356,126 354,129 354,131 353,132 353,133 352,134 351,136 350,137 349,139 348,141 348,144 348,147 348,150 348,151 348,153 349,153 350,153 353,154 357,154 362,154 366,154 369,154 371,153 372,152 373,151 373,150 374,149 374,147 374,146 375,145 375,144 377,143 380,136 386,123 394,105 405,81 413,62 418,50 421,43 421,42 422,41 422,39 423,38 424,37 425,36 426,34 426,31 427,28 428,26 428,24 430,22 431,21 432,21 434,21ZM611,21 613,22 614,22 615,23 615,24 615,26 616,27 616,28 617,29 620,29 627,29 637,30 650,30 660,29 666,28 670,27 672,25 673,23 676,22 679,22 682,22 685,23 686,25 685,28 683,32 681,35 680,38 679,39 678,40 673,40 665,40 654,41 638,41 626,41 616,40 610,40 606,39 603,38 601,37 601,36 601,34 602,33 602,31 603,30 604,29 605,28 606,27 606,25 606,24 606,23 606,22 607,21 608,21 609,21 610,21ZM718,20 720,20 721,21 722,21 723,21 724,22 724,23 725,24 725,26 725,29 725,31 725,32 725,33 726,33 728,34 733,34 739,34 748,34 755,33 759,33 762,33 763,32 764,32 764,31 764,30 764,28 765,27 765,25 766,24 768,23 769,22 772,21 775,21 778,21 779,25 776,34 772,48 764,67 757,83 750,98 744,111 738,122 734,131 731,138 730,144 730,147 730,150 730,151 730,153 731,153 733,154 735,154 739,154 744,154 748,154 751,154 753,153 754,153 754,152 755,151 755,149 755,148 756,147 756,146 757,145 759,144 760,143 760,142 761,140 761,138 763,132 767,123 772,110 780,93 787,79 792,67 796,58 798,51 800,45 802,41 804,39 805,37 806,36 807,34 808,31 808,28 809,26 810,24 810,22 811,22 812,21 814,21 815,21 817,21 818,22 819,24 819,26 819,28 820,30 820,31 820,32 821,33 824,33 832,33 843,33 858,33 869,33 877,31 881,29 883,27 885,24 888,23 891,22 896,21 897,26 894,35 889,48 880,66 873,80 868,90 864,96 863,98 861,100 860,103 858,106 856,110 852,115 847,122 841,129 833,138 824,146 816,153 808,160 801,165 793,170 787,174 782,177 777,180 771,183 764,185 755,189 746,192 736,195 728,197 719,199 712,200 704,201 697,202 690,203 683,204 676,204 669,204 662,204 655,204 649,204 644,204 641,204 640,203 637,203 634,203 629,203 624,204 621,203 619,202 620,200 623,198 627,195 630,192 633,189 636,185 639,181 643,177 646,172 649,167 653,160 658,150 664,138 670,123 676,110 681,98 686,88 690,80 693,72 696,65 699,59 701,54 702,50 704,46 706,42 708,39 709,37 710,34 711,32 711,31 711,29 712,27 713,26 714,23 716,22 717,21ZM307,21 308,21 309,21 310,22 310,23 309,26 308,29 305,34 302,41 300,46 298,50 297,54 296,56 296,58 295,59 294,60 293,61 284,62 268,63 244,63 212,63 187,64 171,65 163,67 162,69 162,71 161,74 161,76 161,80 161,82 162,84 162,86 163,86 167,87 174,87 185,86 199,86 213,86 228,85 243,85 258,86 268,89 274,95 274,104 269,116 265,126 261,134 257,141 254,145 252,149 250,152 248,155 247,157 246,159 244,162 241,166 238,170 234,174 230,177 226,181 221,184 216,187 211,190 206,192 200,195 193,197 185,199 176,200 165,202 150,203 129,204 103,204 73,204 50,203 35,202 27,200 27,199 28,196 29,192 31,188 34,183 36,179 37,176 38,173 39,171 39,169 40,167 42,165 43,163 45,161 48,161 52,160 56,161 60,161 63,160 65,160 67,159 72,159 82,159 96,158 114,158 128,159 138,159 145,159 148,160 151,160 152,161 153,163 153,164 154,165 156,166 158,167 161,167 164,166 165,165 166,164 166,162 167,160 168,159 169,158 171,158 172,157 174,156 175,155 176,153 177,151 178,149 178,146 178,143 178,142 179,141 179,140 180,141 182,142 183,142 186,142 189,142 191,141 193,139 194,137 194,133 193,130 193,128 192,126 191,125 189,124 187,123 185,123 181,123 179,124 177,125 176,128 176,131 169,134 156,135 136,136 110,136 89,136 74,136 65,136 61,135 59,133 59,128 61,121 65,112 69,103 73,94 77,86 81,78 85,71 89,65 92,61 95,57 98,53 101,51 104,49 106,47 108,46 109,45 111,44 112,44 114,44 115,43 117,41 118,39 120,38 122,37 125,36 129,36 132,35 134,35 135,34 136,33 137,32 138,30 141,29 143,27 146,26 150,25 154,25 158,25 161,25 164,24 165,24 167,23 168,23 169,22 170,22 170,23 170,24 171,26 171,28 171,30 171,31 171,32 172,33 180,33 196,33 219,33 250,33 273,32 290,30 299,28 302,25 304,23 306,22ZM660,63 663,63 666,64 668,64 668,65 668,66 668,67 667,68 666,70 665,73 662,77 659,84 655,93 649,105 645,114 643,121 641,125 641,127 640,130 638,134 635,140 632,146 628,152 624,158 619,164 614,170 609,175 605,179 601,183 597,185 593,188 588,190 583,192 577,195 571,197 564,199 558,200 551,201 544,202 536,203 529,203 520,203 516,202 514,200 516,197 521,193 526,189 529,185 532,181 533,178 535,174 538,170 540,166 544,162 546,158 548,155 549,153 550,150 552,145 556,136 562,124 569,109 574,97 578,88 581,81 582,78 583,75 585,72 586,70 588,68 593,67 602,65 614,65 630,64 643,63 653,63Z"};

function logoSet() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  // The logo is drawn from LOGO_TRACE: the chrome silhouette (letters, bevels and the 3-D
  // gunsight) and the pale-blue letter faces inside it.
  const tex = canvasTexture(1024, 320, (g, w, h) => {
    const r = seeded(2024);
    g.clearRect(0, 0, w, h);
    g.save();
    g.scale(w / LOGO_TRACE.w, w / LOGO_TRACE.w);
    const outline = new Path2D(LOGO_TRACE.outline), faces = new Path2D(LOGO_TRACE.faces);
    // Chrome: bright and dark bands, as if reflecting a pale sky over a dark horizon, broken up
    // by streaks of blue-green reflection.
    g.save();
    g.clip(outline, 'evenodd');
    const chrome = g.createLinearGradient(0, 0, 40, LOGO_TRACE.h);
    chrome.addColorStop(0, '#f2f7ff'); chrome.addColorStop(0.16, '#9aa8b8'); chrome.addColorStop(0.3, '#2e3848');
    chrome.addColorStop(0.42, '#e4ecf4'); chrome.addColorStop(0.55, '#5e6c7c'); chrome.addColorStop(0.68, '#dfe8e4');
    chrome.addColorStop(0.82, '#46524e'); chrome.addColorStop(1, '#c8d4dc');
    g.fillStyle = chrome; g.fillRect(0, 0, LOGO_TRACE.w, LOGO_TRACE.h);
    for (let i = 0; i < 260; i++) {
      const y = r() * LOGO_TRACE.h, x = r() * LOGO_TRACE.w;
      const k = r();
      g.fillStyle = k < 0.35 ? `rgba(20,28,40,${0.25 + r() * 0.35})` : k < 0.7 ? `rgba(240,248,255,${0.25 + r() * 0.4})` : `rgba(150,200,170,${0.2 + r() * 0.3})`;
      g.fillRect(x, y, 6 + r() * 40, 1 + r() * 2.5);
    }
    g.restore();
    // A dark hairline round the whole silhouette.
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(4,6,12,0.9)'; g.lineWidth = 2.2; g.stroke(outline);
    // The letter faces: pale blue, a little lighter toward the top, set into the chrome with a
    // dark groove and a light lip.
    const face = g.createLinearGradient(0, 30, 30, 230);
    face.addColorStop(0, '#e2eaff'); face.addColorStop(0.5, '#b6c6f2'); face.addColorStop(1, '#cad6fa');
    g.fillStyle = face; g.fill(faces, 'evenodd');
    g.strokeStyle = 'rgba(16,22,40,0.85)'; g.lineWidth = 2.6; g.stroke(faces);
    g.save(); g.translate(-1.2, -1.2);
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1.2; g.stroke(faces);
    g.restore();
    g.restore();
  });
  // Untone-mapped, so the chrome and the blue faces come out as painted.
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(10.24, 3.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
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
// The gunship stays clamped to its pedestal while the rotor runs up to speed; the clamp jaws
// let go (CLAMPS_OPEN) and only then does it lift off and climb to its hover.
const CLAMPS_OPEN = [B(380), B(392)];
// It sits with its belly on the clamp jaws, and creeps up only a little while the clamp shot
// (M) lasts: the climb proper happens across the cut to N.
const heliLift = (t) => 4.02 + keyed(t, [[B(393), 0], [B(405), 0.08], [B(415), 0.2], [B(422), 0.32], [B(432), 1.7], [B(460), 2.9], [B(520), 3.4]])
  + 0.06 * Math.sin(t * 2.3) * span(t, B(400), B(420));
// Dusk clock, seconds from the first frame of S.
const S0 = B(661);
const DUSK_PATH = [
  [-0.4, 6, 41.2, -30], [0.21, 2.7, 41, -24], [1.35, 4.2, 39.6, -16], [2.2, -2.8, 40, -10.5], [2.77, -9, 41.2, -19],
  [3.5, -13, 41, -40], [5.2, -3, 41.4, -54], [6.7, 5, 40.6, -47], [7.9, 1.7, 39.6, -28], [9.2, 0, 38.8, -21],
  [10.7, 0, 38.6, -23], [12.3, 0, 38.7, -23], [13.1, 5, 44, -22], [13.6, 6, 50, -12], [14.5, 7, 58, 0],
];
const DUSK_YAW = [[0, -1.25], [2.2, -1.1], [2.8, -0.75], [5.2, -0.85], [6.2, -0.55], [7.6, 0.05], [9.2, 0], [14.5, 0]];
const DUSK_BANK = [[0, 0.1], [2.2, 0.2], [3.5, 0.1], [5.2, -0.15], [6.6, -0.35], [7.8, -0.05], [9.2, 0], [13.6, 0.1]];
const DUSK_PITCH = [[0, 0.1], [2.8, 0.12], [5, -0.05], [7.5, 0.05], [9.2, 0.02], [12.4, 0.0], [13.0, 0.35], [14.5, 0.4]];
const FIRE_AT = B(822) - S0;

/**
 * Build the intro's sets for `renderer`. Returns { length, render(t) }: render(t) draws the
 * frame for time t (seconds) into the renderer's canvas, cuts, dissolves and fades included.
 */
export function createIntro(renderer) {
  const cam = new THREE.PerspectiveCamera(50, 4 / 3, 0.05, 2400);
  const toneMapping = renderer.toneMapping;
  // Shadows: only the outside shot's moonlight casts them.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const sign = signSet();
  const base = baseSet();
  const hall = hangarSet();
  const pit = cockpitScene();
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
    sign.lamp.intensity = on ? 4.5 : 0;
    sign.spill.intensity = on ? 0.5 : 0;
    // Fitted to the sign's corners in INTRO1 frame 20: the camera stands off to its right.
    look([0.74, 1.45, 2.55], [0.42, 1.6, 0], 44);
    cam.updateMatrixWorld();
    placeMoon(sign.moon, cam, -0.4, -0.4);
    sign.sky.position.copy(cam.position);
    sign.sky.userData.update(cam, t);
    return { scene: sign.scene, black: 1 - span(t, A(4.5), A(14)) };
  }

  function shotApron(t) {
    const T = t - A(107);
    path(cam, T, [[0, [1, 3.0, 12], [-1.5, 1.0, -6], 46], [4.2, [12, 3.0, 12], [9.5, 1.0, -6], 46]], false);
    base.frontLight.intensity = 1.6;
    const px = SET.apron + lerp(-2.5, 24, smooth(span(T, 0.1, 2.9))), pz = 4.8;
    // Mostly real light, so the sand's bumps show in the pool, with a fainter flat decal.
    base.pool.intensity = 70;
    base.pool.target.position.set(px, 0, pz);
    base.pool.target.updateMatrixWorld();
    base.poolSpot.position.set(px, 0.03, pz);
    base.poolSpot.material.opacity = 0.4;
    return { scene: night(t) };
  }

  function shotHigh(t) {
    const T = t - A(158);
    const X = SET.high;
    // High and looking steeply down, the wall running diagonally across the top of frame.
    path(cam, T, [[0, [X + 13, 25, 21], [X - 3, 1.5, -5], 46], [4.0, [X + 12.5, 24.7, 20.5], [X - 3.3, 1.6, -5], 46]], false);
    base.frontLight.intensity = 1.1;
    base.pool.intensity = 0;
    base.poolSpot.material.opacity = 0;
    return { scene: night(t) };
  }

  function shotMoon(t) {
    const T = t - A(207);
    const X = SET.moon;
    // The camera drifts right, bringing the parked tanker in at the edge of frame.
    // Fitted to the video's first and last frames: a 2.8 m crab right with a 5 degree pan.
    path(cam, T, [[0, [X, 3, 6], [X, 7.3, -40], 50], [7.6, [X + 2.8, 3, 6], [X + 6.8, 7.3, -40], 50]], false);
    const tw = base.moonTower.userData;
    const lit = t >= A(244) ? 1 : 0;
    tw.setBeam(lit * 0.3);
    tw.glow.material.color.setScalar(lit ? 1 : 0.12);
    tw.spot.intensity = lit * 4000;
    // The searchlight snaps on aimed down to the left, sweeps across to the right, then swings
    // back toward the camera, glaring straight into the lens as it passes over it.
    const yaw = keyed(t, [[A(244), -1.3], [A(258), -1.05], [A(263), -0.25], [A(266), 0.6], [A(272), 1.25], [A(282), 1.4],
      [A(287), 0.95], [A(292), 0.3], [A(297), -0.15], [A(303), -0.45], [A(310), -0.7]]);
    const pitch = keyed(t, [[A(244), 0.32], [A(263), 0.3], [A(272), 0.2], [A(287), 0.24], [A(294), 0.31], [A(310), 0.32]]);
    tw.head.rotation.set(pitch, yaw, 0);
    tw.head.updateMatrixWorld();
    const fwd = V(0, 0, 1).transformDirection(tw.head.matrixWorld);
    const toCam = cam.position.clone().sub(V().setFromMatrixPosition(tw.head.matrixWorld)).normalize();
    const facing = fwd.dot(toCam);
    tw.flare.material.opacity = lit * smooth((facing - 0.95) / 0.045);
    // Seen end-on the beam is just the glare, not a solid wedge across the frame.
    tw.setBeam(lit * 0.3 * (1 - 0.85 * smooth((facing - 0.9) / 0.08)));
    base.pool.intensity = 0;
    base.poolSpot.material.opacity = 0;
    const scene = night(t);
    // A darker night than the other base shots, so the searchlight carries the frame.
    base.frontLight.intensity = 0.35;
    base.hemi.intensity = 0.35;
    base.moonLight.intensity = 0.4;
    base.moonShade.visible = true;
    base.moonShade.intensity = 1.6;
    return { scene, black: span(t, A(298), A(310)) };
  }

  /** Shared state of the night base for this frame. */
  function night(t) {
    base.moon.visible = true;
    base.outMoon.visible = false;
    base.moonShade.visible = false;
    base.hemi.intensity = 0.9;
    base.moonLight.intensity = 1.3;
    cam.updateMatrixWorld();
    base.sky.position.copy(cam.position);
    placeMoon(base.moon, cam, t < A(207) ? 0.2 : 0.29, t < A(207) ? -0.3 : 0.2);
    base.sky.userData.update(cam, t);
    const tw = base.moonTower.userData;
    if (t < A(207)) { tw.setBeam(0); tw.spot.intensity = 0; }
    return base.scene;
  }

  // ---------------------------------------------------------------- INTRO2: inside
  function hallState(t) {
    const h = hall;
    // The hall opens nearly black: the ridge panels glow but throw little light. Each bank of
    // wall uplights that comes on brings the room (and the gunship) up with it.
    const lvl = (t >= LEFT_ON ? 0.5 : 0) + (t >= RIGHT_ON ? 0.5 : 0);
    h.key.intensity = lerp(3, 34, lvl);
    h.ambient.intensity = lerp(0.1, 0.25, lvl);
    // Reflections too: the environment map's bright wall strips are the uplights.
    h.scene.environmentIntensity = lerp(0.1, 0.7, lvl);
    h.pedestal.forEach((m) => { m.visible = true; });
    h.clamps.forEach((c) => { c.group.visible = true; });
    h.clampLight.intensity = 0;
    h.ridgeLights.forEach((l) => { l.intensity = lerp(1.5, 16, lvl); });
    for (const [s, at] of [[-1, LEFT_ON], [1, RIGHT_ON]]) {
      const on = t >= at ? 1 : 0;
      h.uplights[s].wash.opacity = on;
      h.uplights[s].fill.forEach((l) => { l.intensity = on * 10; });
    }
    const bOn = t >= BEACONS_ON ? 1 : 0;
    const dir = V(), hit = V();
    h.beacons.forEach((b) => {
      // Spinning clockwise as the camera sees it, a little over a turn every five seconds.
      b.spin.rotation.z = -(t - BEACONS_ON) * 1.25 - b.phase;
      b.mount.updateMatrixWorld(true);
      b.on = bOn;
      b.pool.material.opacity = 0;
      b.beams.forEach((beam) => {
        beam.material.uniforms.opacity.value = bOn * 0.9;
        dir.set(0, 1, 0).applyQuaternion(beam.getWorldQuaternion(new THREE.Quaternion()));
        // Where the lower shaft meets the floor: a pool, longer the flatter the shaft.
        if (dir.y < -0.05) {
          const d = Math.min(2.6, b.lens.position.y / -dir.y);
          hit.copy(b.lens.position).addScaledVector(dir, d).setY(0.02);
          b.pool.position.copy(hit);
          b.pool.rotation.z = -Math.atan2(dir.z, dir.x);
          b.pool.scale.set(0.7 + d * 0.9, 0.7, 1);
          b.pool.material.opacity = bOn * (0.6 + 0.4 * smooth(-dir.y)) * (1 - d / 3.4) * 1.4;
        }
      });
      b.lens.material.color.setHex(bOn ? 0xffe8a0 : 0x2a1a08);
    });
    // Real light along the upper shafts of the two beacons in front of the pad, so the wall and
    // the gunship catch them.
    h.amber.forEach((l, i) => {
      const b = h.beacons[i ? 1 : 2];
      l.intensity = bOn * 30;
      l.position.copy(b.lens.position);
      const up = b.beams.map((beam) => V(0, 1, 0).applyQuaternion(beam.getWorldQuaternion(new THREE.Quaternion())))
        .reduce((x, y) => (y.y > x.y ? y : x));
      l.target.position.copy(b.lens.position).addScaledVector(up, 6);
      l.target.updateMatrixWorld();
    });
    const y = heliLift(t);
    h.heli.position.set(0, y, 0);
    h.heli.rotation.set(0, keyed(t, [[B(422), 0], [B(507), 0.5]]), 0);
    const speed = keyed(t, ROTOR);
    // Parked with the blades at about 40 degrees to the airframe, as in the video.
    setRotor(h.heli, spun(t, ROTOR) + 0.7, speed);
    const fold = smooth(span(t, ...CLAMPS_OPEN));
    // The jaws grip tilted to the belly's curve and let go by tilting level.
    h.clamps.forEach((c) => { c.jaw.rotation.x = -0.3 * (1 - fold); });
    h.heli.userData.missiles.forEach((m) => { m.position.copy(m.userData.home); m.rotation.set(0, 0, 0); m.visible = true; m.userData.flame.material.opacity = 0; m.userData.jet.material.uniforms.opacity.value = 0; });
    h.heli.userData.wings.forEach((w) => { w.visible = true; });
    h.shot.visible = false;
    h.motor.intensity = 0;
    return h.scene;
  }

  /** The beacons' lens flares swell as a shaft swings toward the camera (once it is placed). */
  function beaconFlares() {
    cam.updateMatrixWorld();
    const dir = V(), to = V(), q = new THREE.Quaternion();
    hall.beacons.forEach((b) => {
      let facing = 0;
      to.copy(cam.position).sub(b.lens.position).normalize();
      b.beams.forEach((beam) => { facing = Math.max(facing, dir.set(0, 1, 0).applyQuaternion(beam.getWorldQuaternion(q)).dot(to)); });
      const f = smooth((facing - 0.6) / 0.4);
      b.core.material.opacity = b.on;
      b.glow.material.opacity = b.on * (0.45 + 0.55 * f);
      b.glow.scale.setScalar(1.9 + 1.8 * f);
      b.streak.material.opacity = b.on * (0.45 + 0.4 * f);
      if (b.light) b.light.intensity = b.on * (2.5 + 2.5 * f);
    });
  }

  function shotHall(t) {
    const scene = hallState(t);
    if (t < B(31)) look([0, 4.3, 12.5], [0, 3.3, 0], 50);
    else if (t < B(57)) path(cam, t - B(31), [[0, [-7.8, 1.2, 9], [-5, 3.2, -12], 50], [1.85, [-7.8, 1.2, 8.7], [-5.1, 3.2, -12], 50]], false);
    else if (t < B(74)) path(cam, t - B(57), [[0, [7.8, 1.2, 9], [5, 3.2, -12], 50], [1.2, [7.8, 1.2, 8.8], [5.1, 3.2, -12], 50]], false);
    else if (t < B(118)) look([0, 4.5, 13.5], [0, 3.4, 0], 52);
    return { scene };
  }

  function shotCockpit(t) {
    const k = (t - B(118)) / (B(208) - B(118));
    pit.update(t, t - B(170), B(202) - B(170));
    const [x, y, z] = COCKPIT_VIEW.pos;
    look([x + lerp(0.05, -0.05, k), y, z], COCKPIT_VIEW.target, COCKPIT_VIEW.fov);
    // Drawn untone-mapped, so it looks the same here as in the briefing.
    return { scene: pit.scene, toneMapping: THREE.NoToneMapping };
  }

  function shotRotor(t) {
    const scene = hallState(t);
    const h = hall.heli;
    h.updateMatrixWorld();
    const p = (x, y, z) => V(x, y, z).applyMatrix4(h.matrixWorld);
    // Solved to the video's frame: the hub high in the middle, the cowl's back filling the
    // lower left.
    cam.position.copy(p(-0.47, 2.41, -3.63));
    cam.lookAt(p(0, 0.26, 2.55));
    cam.fov = 50;
    hall.ridgeLights.forEach((l) => { l.intensity = 5; });
    return { scene };
  }

  function shotLift(t) {
    const scene = hallState(t);
    // Low by the pad's rim, a beacon to the right of frame and another at the left edge.
    path(cam, t - B(275), [[0, [3.96, 0.7, 10.57], [-1.54, 1.65, 0], 50], [3.6, [3.96, 0.74, 10.5], [-1.54, 2.0, 0], 50]], false);
    return { scene };
  }

  function shotUnder(t) {
    const scene = hallState(t);
    hall.beacons.forEach((b) => { b.beams.forEach((beam) => { beam.material.uniforms.opacity.value = 0; }); });
    // The pad and its pedestal stay out of this one, as in the video: just the gunship's
    // silhouette against the far wall.
    hall.key.intensity = 2;
    hall.ridgeLights.forEach((l) => { l.intensity = 5; });
    hall.pedestal.forEach((m) => { m.visible = false; });
    hall.clamps.forEach((c) => { c.group.visible = false; });
    // Low under the tail boom, looking across at the right wall: the wall fills the frame, its
    // uplights along the bottom, the cabin's belly a dark slope cutting in from the right.
    path(cam, t - B(326), [[0, [-1.2, 2.9, -2.8], [9.5, 3.2, -1.0], 36], [3.2, [-1.2, 2.9, -3.2], [9.5, 3.2, -1.4], 36]], false);
    return { scene };
  }

  function shotClamps(t) {
    const scene = hallState(t);
    hall.ridgeLights.forEach((l) => { l.intensity = 3; });
    // Low at the pedestal's rim, as in the video: the cushion fills the bottom left, one clamp
    // stands to its right and another beyond it, and the belly hangs over them all.
    path(cam, t - B(371), [[0, [0.78, 2.47, -2.56], [-1.16, 2.61, -0.28], 55], [3.6, [0.82, 2.47, -2.6], [-1.16, 2.61, -0.28], 55]], false);
    hall.clampLight.intensity = 6;
    return { scene };
  }

  function shotHover(t) {
    const scene = hallState(t);
    // Kept inside the hall (its walls stand at x = ±9.5) so the lens never passes through them.
    path(cam, t - B(422), [
      [0, [6.6, 5.4, 6.6], [-0.5, 4.1, -0.5], 52], [2.6, [6.8, 2.6, 2.5], [-0.5, 5.8, -0.5], 52],
      [4.0, [7.6, 3.8, -4], [0, 6.4, 0], 52], [6.0, [7.8, 3.6, -14], [0, 6.2, 0], 52],
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
    m.position.copy(m.userData.home).add(V(0, -0.08 * drop * drop, -0.45 * drop + 30 * T * T));
    // A small, white-hot jet with hardly any glow round it, as in the video.
    m.userData.flame.material.opacity = t >= B(546) ? 0.85 + 0.15 * Math.sin(t * 70) : 0;
    m.userData.flame.material.color.setHex(0xfff4d8);
    m.userData.flame.scale.set(0.22, t >= B(546) ? 0.3 + 0.25 * span(t, B(546), B(551)) : 0.1, 1);
    m.userData.jet.material.uniforms.opacity.value = t >= B(546) ? 2.2 + 0.4 * Math.sin(t * 90) : 0;
    m.userData.jet.scale.set(1, t >= B(546) ? 0.6 + 0.6 * span(t, B(546), B(549)) : 1, 1);
    const p = (x, y, z) => V(x, y, z).applyMatrix4(h.matrixWorld);
    // Below the wing and ahead of the outer pair, looking back along them, so their noses are
    // nearest the lens and the wing they hang from runs across the top of the frame.
    // Neutral light here: the warm wall fills and reflections turned the cream missiles gold.
    hall.uplights[-1].fill.forEach((l) => { l.intensity = 1.5; });
    hall.uplights[1].fill.forEach((l) => { l.intensity = 1.5; });
    scene.environmentIntensity = 0.25;
    hall.ambient.intensity = 1.4;
    cam.position.copy(p(1.75, -1.25, 2.3));
    cam.up.copy(V(0, 0, 1).transformDirection(h.matrixWorld));
    cam.lookAt(p(1.75, 0.15, -0.3));
    cam.fov = 44;
    const mp = V().setFromMatrixPosition(m.matrixWorld);
    hall.motor.position.copy(mp);
    hall.motor.intensity = t >= B(546) ? 2.5 : 0;
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
    s.userData.flame.material.opacity = 0;
    s.userData.jet.material.uniforms.opacity.value = 0;
    hall.motor.intensity = 0;
    hall.uplights[-1].wash.opacity = 0.18;
    hall.uplights[1].wash.opacity = 0;
    for (const sd of [-1, 1]) hall.uplights[sd].fill.forEach((l) => { l.intensity = 0; });
    hall.amber.forEach((l) => { l.intensity = 0; });
    hall.ridgeLights.forEach((l) => { l.intensity = 4; });
    const wob = Math.sin(T * 6) * 0.25;
    // Close alongside, as in the video: the nose a quarter in from the left, the body running
    // off the right of frame.
    look([-2.0, 4.6, s.position.z + 0.46 + wob], [-12, 4.55, s.position.z + 0.46 + wob], 32);
    return { scene };
  }

  // ---------------------------------------------------------------- INTRO2: outside
  function shotOutside(t) {
    const O = SET.out;
    look([O - 1.2, 2.0, 7], [O + 1.5, 6.4, -30], 50);
    base.frontLight.intensity = 0.45;
    cam.updateMatrixWorld();
    base.sky.position.copy(cam.position);
    // The moon stands just behind the tower's cabin, as in the video, and its light throws the
    // tower's shadow toward the camera. The tower's own lamp is dark.
    base.moon.visible = true;
    const hp = base.outTower.userData.head.getWorldPosition(V()).project(cam);
    placeMoon(base.moon, cam, (hp.x + 1) / 2 - 0.006, (1 - hp.y) / 2 - 0.006);
    base.sky.userData.update(cam, t);
    base.outTower.userData.glow.material.color.setScalar(0.08);
    base.outMoon.visible = true;
    base.outMoon.intensity = 1.8;
    base.moonShade.visible = false;
    const hg = base.hangar.userData;
    const blown = t >= B(597);
    // Only the door goes: the front wall stays, with a ragged opening where the door was.
    hg.frontParts.forEach((o) => { o.visible = !blown; });
    hg.frontBlown.visible = blown;
    hg.shell.visible = true;
    hg.ribs.forEach((rib) => { rib.visible = true; });
    const F = t - B(596);
    // White core with rays, swelling then collapsing into the fire.
    const flash = F < 0 ? 0 : F < 0.2 ? F / 0.2 : Math.max(0, 1 - (F - 0.7) / 0.6);
    base.core.material.opacity = flash * 0.5;
    base.bloom.material.opacity = flash * 0.6;
    base.rays.material.opacity = flash;
    base.rays.material.rotation = F * 0.15;
    base.rays.scale.setScalar(lerp(14, 46, smooth(F / 0.35)));
    base.core.scale.setScalar(lerp(6, 20, smooth(F / 0.3)) * (F > 0.7 ? lerp(1, 0.6, span(F, 0.7, 1.3)) : 1));
    base.outLight.position.set(O, 5, -18);
    const fireLevel = smooth(span(t, B(608), B(622))) * lerp(1, 0.75, span(t, B(622), B(660)));
    // Blue-white in the flash, orange once the fire takes hold.
    base.outLight.color.setRGB(lerp(0.72, 1, fireLevel), lerp(0.88, 0.55, fireLevel), lerp(1, 0.25, fireLevel));
    base.outLight.intensity = flash * 16 + fireLevel * (70 + 15 * Math.sin(t * 31) + 10 * Math.sin(t * 13));
    base.hemi.intensity = 0.9 + flash * 0.5;
    // Light shafts out of the fire, flickering with it.
    base.fireRays.material.opacity = fireLevel * (0.85 + 0.15 * Math.sin(t * 23) + 0.1 * Math.sin(t * 9));
    base.fireRays.material.rotation = t * 0.05;
    base.fireRays.scale.setScalar(36 + 3 * Math.sin(t * 7));
    for (const f of base.fire) {
      const u = f.userData;
      const age = ((F + u.phase) % u.life) / u.life;
      f.position.set(O + u.x * 0.55 + u.vx * age * u.life, 0.5 + u.y * 0.7 + u.vy * age * u.life, -22.5 + u.z * 0.2);
      f.material.opacity = F > 0.8 ? Math.sin(age * Math.PI) * fireLevel * 0.9 : 0;
      const sz = u.size * (0.6 + age);
      f.scale.set(sz, sz, 1);
    }
    for (const s of base.smoke) {
      const u = s.userData;
      const age = ((F + u.phase) % u.life) / u.life;
      s.position.set(O + u.x * 0.8, 9 + u.vy * age * u.life, -28 + u.z * 0.4);
      s.material.opacity = F > 1 ? Math.sin(age * Math.PI) * 0.55 * fireLevel : 0;
      s.scale.setScalar(u.size * (0.7 + age));
    }
    {
      // The big sheet: out of the fire, over the ground toward the lens, tumbling.
      const T = t - B(604);
      base.slab.visible = T > 0 && T < 2.2;
      base.slab.position.set(O + 0.5 + 1.2 * T, Math.max(0.1, 0.8 + 2.6 * T - 2.2 * T * T), -18 + 12 * T);
      base.slab.rotation.set(1.3 * T, 0.4 + 0.6 * T, 2.1 * T);
    }
    {
      // The blast rolls the tanker over onto its left side, pivoting on the left wheels, and
      // shoves it a little away from the fire.
      const tr = base.outTruck, yaw = -1.95, w = 1.15;
      const tip = smooth(span(t, B(599), B(607)));
      const a = Math.PI / 2 * tip;
      const lx = w - w * Math.cos(a), ly = w * Math.sin(a);
      tr.rotation.set(0, yaw, -a);
      tr.position.copy(tr.userData.home).add(V(lx * Math.cos(yaw), ly, -lx * Math.sin(yaw)))
        .add(V(-0.37, 0, 0.93).multiplyScalar(1.4 * tip));
    }
    base.debris.forEach((d) => {
      const T = t - B(598);
      d.visible = T > 0.12;
      if (T <= 0) return;
      const u = d.userData;
      d.position.set(u.p.x + u.v.x * T, Math.max(0.05, u.p.y + u.v.y * T - 5 * T * T), u.p.z + u.v.z * T);
      d.rotation.set(u.w.x * T, u.w.y * T, u.w.z * T);
    });
    // The gunship bursts out of the fire and away to the right.
    const H = base.heli;
    const k = span(t, B(626), B(660));
    H.visible = t >= B(626);
    // Straight out along the hangar's axis until the rotor is clear of the frame, then away to
    // the right.
    // Out through the opening the door left, then away to the right.
    const p = track(k, [[0, O, 3.4, -27], [0.3, O + 0.4, 4.2, -17], [0.6, O + 5.5, 6.4, -13], [1, O + 17, 10, -9]]);
    H.position.copy(p);
    // Nose down and banked as it bursts out, as in the video, turning only once it is clear.
    H.rotation.set(lerp(0.38, 0.18, k), lerp(0.25, 1.45, smooth(span(k, 0.2, 0.7))), lerp(-0.5, -0.3, k));
    setRotor(H, t * 30, 30);
    return { scene: base.scene, black: span(t, B(650), B(659)) };
  }

  // ---------------------------------------------------------------- dusk
  /** Pose `o` where the gunship is T seconds into the dusk shot. */
  const duskPose = (o, T) => {
    o.position.copy(track(T, DUSK_PATH));
    o.rotation.set(keyed(T, DUSK_PITCH), keyed(T, DUSK_YAW), keyed(T, DUSK_BANK), 'YXZ');
    o.scale.copy(dusk.heli.scale);
    o.updateMatrixWorld();
  };
  const ghost = new THREE.Object3D();

  function shotDusk(t) {
    const T = t - S0;
    const H = dusk.heli;
    duskPose(H, T);
    setRotor(H, t * 26, 30);
    // Camera: hangs in the air looking at the horizon, tilting up as the gunship comes round.
    const pitch = keyed(T, [[0, -0.11], [3, -0.08], [8, -0.035], [12.5, -0.035], [13.3, 0.04]]);
    // A little off to the gunship's right, so its right flank shows beside the windscreen as
    // in the video.
    cam.position.set(-1.8, 40, 0);
    cam.up.set(0, 1, 0);
    cam.lookAt(-1.8, 40 + Math.tan(pitch) * 100, -100);
    cam.fov = 46;
    dusk.sky.position.copy(cam.position);
    dusk.cloud.position.copy(cam.position);
    H.updateMatrixWorld();
    // Missiles: off the rails at FIRE_AT, out past the lens in a spreading X.
    const out = [V(-15, 1.5, -5), V(-14, -3.5, -4), V(12, 8, -5), V(14, -6, -4)];
    for (const ms of dusk.missiles) {
      const order = [1, 0, 3, 2][ms.i];
      const f0 = FIRE_AT + order * 0.07;
      const F = T - f0;
      // Each missile leaves from where its rail was at the instant it fired; from then on it
      // and its smoke are on their own, not carried along by the gunship.
      duskPose(ghost, Math.min(T, f0));
      const start = ms.src.position.clone().applyMatrix4(ghost.matrixWorld);
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
        ms.m.userData.jet.material.uniforms.opacity.value = 2.4;
      }
      ms.flash.position.copy(start);
      ms.flash.material.opacity = F > 0 && F < 0.25 ? 1 - F / 0.25 : 0;
      ms.flash.scale.setScalar(3.5);
      ms.puffs.forEach((p, j) => {
        const pu = (j / ms.puffs.length) * 1.05;
        // When the missile passed this point of its path (inverse of u(F) above).
        const born = F < 0 ? Infinity : (-0.6 + Math.sqrt(0.36 + 8.8 * pu)) / 4.4;
        const age = F - born;
        p.visible = age > 0;
        if (!p.visible) return;
        const q = along(pu);
        p.position.set(q.x + p.userData.jx * (1 + age), q.y + p.userData.jy * (1 + age) + age * 0.3, q.z);
        // Motor-fire yellow for an instant, then red-orange smoke cooling to grey-white.
        if (age < 0.2) p.material.color.setRGB(1, lerp(0.85, 0.2, age / 0.2), lerp(0.55, 0.06, age / 0.2));
        // Thin, wispy, pinkish red, as in the video.
        else if (age < 0.9) p.material.color.setRGB(0.88, 0.36, 0.34);
        else { const c = smooth((age - 0.9) / 2.0); p.material.color.setRGB(lerp(0.88, 0.8, c), lerp(0.36, 0.62, c), lerp(0.34, 0.62, c)); }
        p.material.opacity = 0.35 * clamp01(1 - age / 2.4);
        p.scale.setScalar(p.userData.sz * (1 + age * 0.4));
      });
    }
    return { scene: dusk.scene, black: 1 - span(t, B(658), B(668)) };
  }

  function shotLogo(t) {
    logo.scene.background.setScalar(keyed(t, [[B(860), 1], [B(861), 0.45], [B(863), 0.2], [B(866), 0.05], [B(871), 0]]));
    // Framed so the traced area lands where it sits in the video frame (x 40-616, y 166-346 of
    // 640 x 512).
    look([-0.14, 0, 12.5], [-0.14, 0, 0], 40);
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
    if (r.scene === hall.scene) beaconFlares();
    cam.aspect = size.x / size.y;
    cam.updateProjectionMatrix();
    renderer.toneMapping = r.toneMapping ?? toneMapping;
    renderer.render(r.scene, cam);
    renderer.toneMapping = toneMapping;
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
