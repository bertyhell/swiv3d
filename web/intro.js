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
    // It throws its light out sideways from the left wall (along -x), not out to the front.
    const spot = new THREE.SpotLight(0xfff0d0, 10, 7, 0.6, 0.8, 1.6);
    spot.position.set(-4.75, 2.6, 3.6);
    spot.target.position.set(-6.6, 0, 3.6);
    g.add(spot, spot.target);
    // A flat fan of light (a wide, thin cone) hanging down from the lamp against the wall.
    const wedgeGeo = new THREE.ConeGeometry(1.9, 3.0, 40, 4, true);
    wedgeGeo.rotateX(Math.PI); wedgeGeo.translate(0, 1.5, 0); wedgeGeo.scale(1, 1, 0.35);
    const wedge = new THREE.Mesh(wedgeGeo, volumeBeam(0xfff2d8, { len: 3.0, rim: 0.6, fall: 0.9, hot: 0.5 }));
    wedge.material.uniforms.opacity.value = 0.75;
    // At the front corner, its flat face turned out to the front so it reads as a triangle,
    // tilted out away from the left wall so it fans along -x (one edge hugging the wall).
    // (The fan opens along its local +y; turning it ~180° about z hangs it from the lamp.)
    wedge.position.set(-4.75, 2.6, 3.6);
    wedge.rotation.set(0, 0, Math.PI - 0.6);
    g.add(wedge);
    const wash = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.6), additive(washTex, 0xfff0d0, 0.35));
    wash.rotation.set(0, -Math.PI / 2, 0);
    wash.position.set(-4.53, 1.3, 2.6);
    g.add(wash);
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(pondTex, 0x4a4840, 0.5));
    pool.rotation.x = -Math.PI / 2;
    pool.scale.set(3.0, 1.8, 1);
    pool.position.set(-6.4, 0.04, 3.4);
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
 * The SWIV 3D logo, traced from the video's logo frame (INTRO2 frames 885-930, which are all
 * the same). The letters' silhouette (remake/tools/logo-mask.png: the frame thresholded, then
 * cleaned up by hand) was traced at the source's own 320 x 400 pixels with potrace, which reads
 * the pixel staircases as straight lines and curves, then stretched to the display aspect.
 * `outline` is the whole chrome silhouette; `faces` is that silhouette inset by the chrome
 * border's width (6 units), which gives the pale-blue letter faces. The gunsight is too small in
 * the source to trace, so it is rebuilt from measured geometry: an elliptical ring, the cross
 * hairs, and "3" and "D" (pale faces in a thin rim). remake/tools/trace-logo.py --mask makes it.
 * Units: the traced area is 1000 wide.
 */
const LOGO_TRACE = {"w": 1000, "h": 312.5, "outline": "M19.3,201.2C21.3,194.2 30.2,172.6 37.2,157.9C38.8,154.4 45.1,154.0 102.9,154.0L166.8,154.0 170.2,148.3C172.1,145.2 173.6,142.2 173.6,141.7C173.6,141.1 144.7,140.7 109.4,140.7C74.0,140.7 45.1,140.3 45.1,139.8C45.1,134.0 76.4,71.4 85.2,59.6C98.2,42.0 107.7,34.6 127.2,26.8C150.6,17.3 161.6,16.3 242.2,15.7C329.3,15.1 323.6,13.7 314.3,33.2C311.5,39.2 307.0,49.0 304.4,55.1L299.6,66.2 235.3,66.9C166.4,67.5 167.0,67.4 166.7,79.0C166.7,79.9 194.8,80.7 229.2,80.7C267.0,80.7 291.7,81.5 291.7,82.8C291.7,84.0 289.4,89.3 286.7,94.5C283.9,99.7 278.3,112.4 274.1,122.7C254.1,172.6 228.0,195.9 182.5,204.9C161.9,209.0 150.2,209.6 88.0,209.6L17.0,209.6 19.3,201.2ZM218.8,208.6C218.8,208.0 224.8,203.5 232.2,198.5C255.7,182.7 266.2,166.3 296.7,98.0C312.6,62.2 327.5,28.7 329.6,23.5L333.6,14.0 373.8,14.0C410.4,14.0 413.7,14.4 411.6,17.9C410.4,20.0 406.2,29.2 402.3,38.4C398.5,47.6 386.7,74.1 376.0,97.4C351.2,151.5 351.7,150.2 359.6,149.2C363.4,148.8 367.0,145.7 368.4,141.8C369.7,138.1 377.2,121.1 385.0,104.0C392.8,86.9 404.0,61.9 410.0,48.5C426.8,10.4 421.3,14.0 461.7,14.0C480.9,14.0 496.5,14.6 496.5,15.2C496.5,15.8 489.7,31.6 481.3,50.2C472.9,68.8 460.3,97.0 453.4,112.9C446.4,128.8 439.8,143.6 438.7,145.9C437.3,149.0 438.4,149.8 443.2,149.2C448.4,148.6 455.1,136.0 479.2,81.8L508.8,15.1 550.0,14.5C588.1,13.9 591.0,14.2 589.4,17.8C534.6,141.5 523.4,163.5 507.3,178.5C477.3,206.4 458.5,209.6 321.3,209.6C264.9,209.6 218.8,209.1 218.8,208.6ZM486.1,208.8C486.1,208.1 493.2,202.9 501.9,197.4C523.0,183.9 534.3,166.9 557.6,114.3C568.1,90.3 578.5,67.9 580.5,64.6L584.2,58.5 630.6,58.5C666.7,58.5 677.1,59.1 677.1,61.4C677.1,64.5 650.6,123.6 638.6,147.4C623.2,177.6 598.9,196.7 566.4,204.1C550.6,207.7 486.1,211.5 486.1,208.8ZM593.8,207.5C593.8,206.4 596.5,204.9 599.8,204.2C608.0,202.5 633.8,177.8 642.2,163.7C646.0,157.4 661.7,123.4 677.2,88.1C692.7,52.9 706.8,21.8 708.5,19.0C711.5,14.3 713.4,14.0 751.1,14.0C772.8,14.0 791.3,14.5 792.3,15.2C793.3,15.8 789.0,27.6 782.8,41.3C729.4,158.7 732.6,150.4 741.8,149.2C747.0,148.5 794.8,49.0 800.8,26.2C804.1,14.0 808.3,13.0 856.8,13.0C881.2,12.9 903.6,13.6 906.7,14.4C917.8,17.3 870.0,108.0 840.0,141.1C809.7,174.5 759.4,199.4 708.6,206.2C680.9,209.9 593.8,210.9 593.8,207.5ZM592.2,38.1C593.5,34.1 596.5,27.3 598.9,23.0L603.1,15.1 650.5,14.5C703.9,13.8 701.4,12.8 691.1,31.8L684.5,44.0 637.1,44.6L589.7,45.3 592.2,38.1ZM899.2,286.1L899.2,271.5 898.4,271.4C898.0,271.3 896.9,271.2 896.0,271.1C886.6,270.3 875.8,265.7 867.6,259.1C854.9,249.0 846.2,232.7 844.6,216.2C844.6,215.4 844.4,214.1 844.4,213.4L844.2,212.0 826.6,212.0L809.0,212.0 809.0,209.1L809.0,206.2 826.6,206.2L844.2,206.2 844.4,204.9C844.4,204.1 844.6,202.9 844.6,202.1C846.2,185.6 854.9,169.3 867.6,159.1C875.8,152.6 886.6,148.0 896.0,147.1C896.9,147.0 898.0,146.9 898.4,146.9L899.2,146.7 899.2,132.6L899.2,118.5 902.1,118.5L905.0,118.5 905.0,132.6L905.0,146.7 905.8,146.9C906.3,146.9 907.4,147.0 908.2,147.1C917.6,148.0 928.5,152.6 936.7,159.1C949.3,169.3 958.0,185.6 959.6,202.1C959.7,202.9 959.8,204.1 959.9,204.9L960.0,206.2 974.9,206.2L989.8,206.2 989.8,209.1L989.8,212.0 974.9,212.0L960.0,212.0 959.9,213.4C959.8,214.1 959.7,215.4 959.6,216.2C958.0,232.7 949.3,249.0 936.7,259.1C928.5,265.7 917.6,270.3 908.2,271.1C907.4,271.2 906.3,271.3 905.8,271.4L905.0,271.5 905.0,286.1L905.0,300.8 902.1,300.8L899.2,300.8 899.2,286.1ZM899.2,239.0L899.2,212.0 895.2,212.0L891.2,212.0 891.4,212.6C893.4,219.9 890.0,226.1 882.6,228.2C876.3,230.1 864.2,229.2 861.8,226.7L861.1,226.0 861.1,221.8C861.1,217.6 861.1,217.5 861.7,216.9C862.7,215.9 863.8,215.8 866.0,216.7C868.7,217.8 870.8,218.3 873.1,218.3C876.5,218.3 878.1,217.6 878.0,216.1C877.8,214.8 876.3,214.3 872.1,214.1C867.1,213.8 867.1,213.8 867.1,208.7L867.1,205.0 867.8,204.3C868.5,203.6 868.6,203.6 872.2,203.5C876.1,203.4 877.3,203.0 877.2,202.1C877.2,200.3 873.5,199.9 868.9,201.2C865.5,202.1 864.2,202.1 863.3,201.2L862.6,200.5 862.6,196.5L862.6,192.5 863.3,191.8C864.7,190.4 868.7,189.6 875.4,189.6C880.9,189.7 882.7,190.0 885.6,191.4C887.6,192.4 889.8,194.7 890.5,196.6C891.5,199.2 891.2,204.3 890.0,205.6C889.5,206.2 890.0,206.2 894.5,206.2L899.2,206.2 899.2,179.3L899.2,152.3 898.2,152.4C879.9,154.4 864.9,164.8 856.4,181.5C838.1,217.2 859.5,261.5 897.0,265.7C898.0,265.8 899.0,265.9 899.1,266.0C899.2,266.0 899.2,253.8 899.2,239.0ZM909.7,265.3C925.4,263.0 940.0,252.2 947.9,236.8C962.6,208.0 951.8,171.7 924.3,157.7C918.6,154.8 913.2,153.2 906.1,152.4L905.0,152.3 905.0,179.3L905.0,206.2 909.0,206.2L913.0,206.2 913.1,198.6L913.1,191.0 913.8,190.3L914.5,189.6 921.4,189.5C935.3,189.4 940.1,190.4 944.8,194.7C948.4,198.1 950.2,201.7 950.8,206.8C951.9,216.7 946.9,225.0 938.4,227.7C934.6,229.0 932.7,229.1 923.2,229.1L914.5,229.1 913.8,228.4L913.1,227.7 913.1,219.9L913.0,212.0 909.0,212.0L905.0,212.0 905.0,239.0L905.0,266.0 906.1,265.8C906.6,265.8 908.3,265.6 909.7,265.3ZM931.7,216.9C933.5,216.3 934.9,215.2 935.7,213.7C936.7,211.8 936.7,207.0 935.8,205.2C934.4,202.6 931.7,201.3 927.8,201.3L927.0,201.2 927.0,209.4L927.0,217.6 928.7,217.4C929.6,217.3 931.0,217.1 931.7,216.9Z", "faces": "M24.8,203.7C24.8,203.1 27.7,194.6 28.3,193.4C28.5,193.0 28.9,191.8 29.3,190.9C29.6,189.9 30.3,188.0 30.9,186.6C31.6,185.2 32.5,182.9 33.1,181.4C34.2,178.7 36.1,174.3 38.8,168.4C39.6,166.7 40.3,165.1 40.4,164.8C40.9,163.0 42.0,161.2 42.6,161.2C42.9,161.2 44.4,161.1 45.9,161.0C54.6,160.2 58.0,160.2 112.5,160.0C165.4,159.9 168.2,159.9 169.1,159.4C170.6,158.8 171.6,157.6 172.8,155.5C173.4,154.5 174.5,152.5 175.3,151.2C178.0,146.8 179.3,143.7 179.3,142.1C179.3,138.8 177.2,136.4 173.8,135.8C171.2,135.3 151.1,135.0 105.6,134.7C58.8,134.5 53.2,134.4 53.2,133.9C53.2,133.8 54.2,131.8 55.3,129.4C56.4,127.1 58.3,123.0 59.4,120.4C64.5,109.1 79.6,79.9 85.8,69.6C93.7,56.3 103.1,46.3 113.3,40.1C122.0,34.8 137.7,28.6 148.4,26.2C156.4,24.4 162.4,23.7 179.9,22.8C195.7,21.9 281.8,21.0 298.2,21.5C307.3,21.8 312.7,22.3 312.8,22.9C312.8,23.1 311.7,25.4 309.1,30.5C307.6,33.6 306.2,36.5 306.1,36.8C306.0,37.1 305.3,38.8 304.4,40.5C303.6,42.2 302.6,44.6 302.1,45.8C300.7,48.9 300.2,50.2 297.9,55.5L295.8,60.4 273.8,60.5C245.1,60.8 205.7,61.2 194.2,61.5C179.4,61.8 171.1,63.0 167.1,65.4C163.1,67.8 161.4,70.7 161.0,76.1C160.7,79.9 161.1,81.6 162.8,83.2C165.8,86.0 168.9,86.1 221.8,86.5C254.6,86.7 266.9,86.9 279.7,87.5L283.5,87.6 281.5,91.6C280.4,93.8 279.0,96.7 278.5,98.0C277.9,99.3 276.9,101.4 276.3,102.8C275.6,104.1 274.9,105.6 274.8,106.1C274.6,106.6 274.0,108.0 273.4,109.2C272.9,110.4 272.2,112.0 271.9,112.9C271.6,113.7 270.7,115.7 270.1,117.2C269.4,118.8 267.8,122.5 266.7,125.4C257.1,148.8 244.2,167.1 228.8,178.9C214.0,190.2 196.0,197.1 171.9,200.7C170.1,201.0 167.9,201.4 167.0,201.5C163.2,202.1 156.0,202.5 142.5,203.1C134.3,203.5 24.7,204.0 24.8,203.7ZM263.4,203.5C249.2,203.4 237.2,203.2 236.6,203.2L235.6,203.1 237.6,201.9C245.7,196.9 256.3,186.2 263.4,176.1C270.1,166.4 281.2,146.1 288.3,130.2C289.9,126.7 292.2,121.7 293.5,119.0C294.8,116.3 297.3,110.8 299.1,106.6C301.0,102.5 303.0,97.9 303.7,96.4C304.5,94.9 305.8,91.8 306.8,89.6C307.7,87.4 309.1,84.3 309.9,82.6C310.7,81.0 312.1,77.8 313.0,75.6C313.9,73.4 315.8,69.2 317.2,66.1C318.6,63.1 320.6,58.6 321.7,56.1C323.4,51.9 329.7,37.8 332.9,30.8C333.6,29.0 334.5,27.0 334.8,26.2C335.1,25.5 335.8,23.8 336.3,22.5L337.4,20.1 367.3,20.0C397.0,20.0 403.8,20.1 403.8,20.6C403.8,20.7 403.0,22.5 402.0,24.5C401.1,26.5 399.7,29.7 398.9,31.6C398.1,33.5 397.3,35.5 397.0,36.1C396.7,36.7 395.7,38.8 394.9,40.9C394.0,42.9 392.5,46.4 391.5,48.6C390.5,50.8 388.6,55.1 387.4,58.1C386.1,61.1 384.4,65.0 383.6,66.6C381.5,71.1 378.2,78.3 376.1,83.0C375.1,85.3 374.0,87.7 373.7,88.4C373.3,89.1 372.5,91.0 371.8,92.6C371.1,94.3 369.7,97.4 368.6,99.6C365.9,105.2 362.8,112.0 360.4,117.7C359.2,120.3 357.8,123.5 357.2,124.7C355.2,128.5 350.8,139.6 349.6,143.6C348.9,145.7 349.0,149.6 349.7,151.1C351.6,155.3 356.5,156.4 363.4,154.3C368.2,152.8 372.5,148.1 374.8,141.6C375.2,140.7 376.0,138.7 376.6,137.2C377.3,135.8 378.1,133.8 378.5,132.9C378.9,131.9 379.9,129.6 380.8,127.8C381.6,125.9 382.9,123.1 383.5,121.5C384.2,119.9 385.2,117.6 385.7,116.4C386.3,115.1 387.3,112.9 388.0,111.4C388.7,109.9 390.2,106.6 391.4,104.1C392.6,101.7 393.9,98.7 394.4,97.5C394.8,96.3 395.8,94.1 396.6,92.6C397.4,91.0 398.7,88.1 399.5,86.1C400.4,84.0 401.6,81.2 402.3,79.8C404.2,75.8 407.4,68.6 408.4,66.3C408.9,65.1 409.7,63.4 410.1,62.5C410.6,61.5 412.1,58.3 413.3,55.2C414.6,52.1 416.3,48.4 417.0,46.9C417.7,45.4 419.0,42.5 419.8,40.6C425.3,27.3 428.2,22.6 431.6,21.2C434.6,19.9 440.3,19.7 466.0,20.0C477.9,20.1 487.7,20.3 487.8,20.5C487.9,20.6 487.6,21.5 487.1,22.6C486.6,23.7 486.0,25.3 485.6,26.1C485.3,27.0 484.7,28.4 484.2,29.3C483.8,30.1 483.1,31.8 482.6,32.9C482.2,34.0 481.0,36.7 480.0,38.9C479.0,41.1 477.4,44.7 476.4,47.0C475.4,49.3 474.1,52.0 473.6,53.0C473.1,54.0 472.0,56.4 471.2,58.2C470.4,60.1 468.3,64.9 466.6,68.9C464.8,72.9 462.4,78.3 461.3,80.9C460.1,83.5 458.1,88.0 456.7,90.9C454.3,96.1 452.9,99.3 450.4,105.2C449.7,107.0 448.6,109.4 448.0,110.6C447.4,111.9 446.2,114.5 445.4,116.5C444.5,118.5 443.1,121.8 442.1,123.8C441.2,125.7 440.0,128.4 439.5,129.8C438.6,132.1 434.5,141.2 433.5,143.1C432.3,145.3 432.1,149.2 433.1,151.2C433.7,152.3 435.5,153.9 436.8,154.5C439.4,155.6 444.9,155.3 447.5,153.8C449.7,152.5 453.4,148.4 455.5,145.0C461.0,135.7 469.8,117.3 482.7,88.1C484.7,83.6 492.3,66.6 499.5,50.5L512.6,21.1 528.9,20.9C537.8,20.8 549.1,20.6 553.9,20.5C562.7,20.2 581.3,20.2 581.6,20.5C581.8,20.7 576.7,32.3 570.1,47.0C567.8,52.0 563.5,61.5 560.6,68.0C557.7,74.5 553.9,82.9 552.3,86.5C550.6,90.1 547.4,97.0 545.2,101.8C540.4,112.3 526.9,140.0 524.0,145.1C513.4,164.2 508.9,169.8 495.2,181.1C486.3,188.5 474.0,194.4 462.0,197.0C450.1,199.6 441.2,200.6 414.4,202.2C393.7,203.5 334.4,204.0 263.4,203.5ZM503.3,203.4C503.6,203.3 505.1,202.3 506.8,201.2C518.0,193.9 529.6,181.3 537.4,167.9C546.1,153.1 557.0,131.1 564.0,114.1C564.7,112.5 565.6,110.6 565.9,109.9C566.3,109.2 567.4,106.8 568.4,104.5C571.1,98.3 575.4,88.7 577.7,83.8C578.9,81.3 580.2,78.4 580.7,77.2C581.6,75.1 584.1,70.0 586.2,66.3L587.4,64.3 609.5,64.3C643.5,64.3 668.8,64.7 669.4,65.3C669.4,65.4 669.0,66.5 668.5,67.7C667.9,69.0 666.8,71.9 665.9,74.2C665.0,76.4 663.7,79.4 663.0,80.7C662.4,82.0 661.2,84.6 660.4,86.5C658.6,90.6 652.1,105.3 650.2,109.1C649.5,110.6 648.4,113.2 647.7,114.8C647.0,116.3 645.3,120.0 643.9,123.0C632.0,147.7 631.8,148.1 628.1,153.9C622.0,163.4 616.7,169.9 610.6,175.2C599.6,184.9 586.0,192.5 572.9,196.2C564.7,198.5 560.1,199.5 555.2,199.9C554.1,200.0 550.2,200.4 546.6,200.8C538.8,201.7 517.6,203.2 509.6,203.4C506.5,203.5 503.6,203.6 503.4,203.6C502.9,203.8 502.9,203.7 503.3,203.4ZM615.1,203.6L612.7,203.5 615.2,201.5C617.8,199.4 625.2,192.5 630.4,187.4C633.4,184.4 641.4,175.2 643.5,172.4C646.5,168.4 651.8,158.4 656.1,148.9C657.1,146.7 659.2,142.2 660.8,138.9C664.9,130.0 665.5,128.7 671.3,115.5C674.3,108.8 677.3,102.1 678.0,100.6C678.7,99.1 680.8,94.4 682.6,90.2C684.3,86.1 686.4,81.4 687.1,80.0C687.8,78.6 689.2,75.5 690.1,73.2C691.1,71.0 692.3,68.1 693.0,66.8C693.7,65.4 695.3,61.7 696.7,58.5C700.2,50.6 704.6,40.8 707.0,35.8C709.5,30.4 711.8,25.5 712.6,23.8C713.7,21.3 714.2,21.0 718.8,20.5C724.4,19.9 784.3,20.0 784.9,20.6C785.0,20.6 784.6,21.7 784.1,23.0C783.6,24.3 782.8,26.5 782.3,27.9C781.7,29.2 781.0,31.0 780.7,31.7C780.3,32.4 779.7,33.9 779.3,35.0C778.9,36.0 776.2,42.0 773.2,48.4C770.3,54.7 766.1,63.9 763.9,68.9C761.6,73.8 757.8,82.2 755.4,87.5C736.9,127.6 730.6,143.0 730.7,148.0C730.7,151.0 732.4,153.9 734.8,154.8C736.8,155.7 741.8,155.5 744.1,154.5C745.7,153.8 748.0,151.6 749.7,148.9C763.0,128.8 798.7,53.0 806.0,29.4C807.7,23.9 808.2,23.0 809.7,22.2C814.6,19.5 824.1,18.9 858.5,18.9C878.2,18.9 886.1,19.1 898.7,19.7L902.2,19.8 901.7,21.9C899.3,32.9 886.4,60.1 871.8,84.9C846.7,127.5 831.4,145.4 804.5,163.8C795.9,169.7 781.2,177.8 771.4,182.0C738.1,196.5 714.0,201.5 671.5,202.7C667.0,202.9 661.3,203.1 658.8,203.2C654.0,203.5 619.3,203.8 615.1,203.6ZM598.1,38.9C598.1,38.8 598.7,37.4 599.2,35.9C599.8,34.5 601.7,30.5 603.3,27.2L606.4,21.1 623.5,21.0C632.9,20.9 646.5,20.7 653.8,20.5C670.6,20.2 685.8,20.2 688.3,20.5L690.2,20.8 689.1,23.2C688.5,24.5 687.5,26.5 686.9,27.5C686.3,28.5 684.8,31.4 683.5,33.8L681.2,38.2 662.4,38.4C652.1,38.4 633.7,38.7 621.6,38.9C609.5,39.1 599.2,39.2 598.8,39.2C598.2,39.2 598.0,39.2 598.1,38.9ZM869.7,226.5C867.7,226.2 865.2,225.7 864.2,225.3L863.5,225.0 863.5,221.8C863.5,220.0 863.5,218.5 863.6,218.5C863.6,218.5 864.3,218.8 865.0,219.1C870.9,221.7 878.0,221.4 879.9,218.5C880.7,217.4 880.7,215.3 880.0,214.1C878.9,212.4 875.9,211.5 871.2,211.5L869.5,211.5 869.5,208.8L869.5,206.0 873.1,206.0C878.1,205.8 879.7,204.8 879.7,202.0C879.8,198.1 874.6,196.8 867.4,198.9C866.2,199.2 865.2,199.5 865.1,199.5C865.1,199.5 865.0,198.1 865.0,196.5C865.0,193.0 864.7,193.3 868.6,192.6C872.0,192.0 878.9,191.9 881.3,192.6C886.2,193.8 888.5,196.3 888.6,200.3C888.6,204.1 887.0,206.3 883.4,207.8L882.6,208.1 883.9,208.5C887.4,209.9 889.3,212.7 889.4,216.4C889.4,222.2 885.8,225.5 878.4,226.5C876.2,226.8 872.1,226.8 869.7,226.5ZM915.5,209.4L915.5,192.0 922.2,192.0C934.7,192.0 939.0,192.9 943.0,196.5C950.0,202.7 950.2,215.8 943.5,221.9C939.2,225.7 936.1,226.5 923.9,226.7L915.5,226.8 915.5,209.4ZM931.1,219.6C934.6,218.9 936.9,217.2 938.2,214.4C939.2,212.1 939.2,206.7 938.2,204.4C936.3,200.4 932.9,198.8 926.8,198.8L924.5,198.8 924.5,209.4L924.5,220.0 926.9,220.0C928.3,220.0 930.1,219.8 931.1,219.6Z"};

/**
 * Paints the logo from LOGO_TRACE onto a 2-D context `w` pixels wide (height w * 0.3125): the
 * chrome silhouette (letters, bevels and the 3-D gunsight) and the pale-blue letter faces
 * inside it. Also used by the "press any key" splash.
 */
export function drawLogo(g, w, h) {
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
  // The streaks are soft-edged ovals (a radial gradient squashed flat): hard-edged bars cut across
  // the thin chrome rim and read as nicks in the outline.
  for (let i = 0; i < 260; i++) {
    const y = r() * LOGO_TRACE.h, x = r() * LOGO_TRACE.w;
    const k = r();
    const c = k < 0.35 ? `20,28,40,${0.25 + r() * 0.35}` : k < 0.7 ? `240,248,255,${0.25 + r() * 0.4}` : `150,200,170,${0.2 + r() * 0.3}`;
    const len = 6 + r() * 40, thick = 1 + r() * 2.5;
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grd.addColorStop(0, `rgba(${c})`); grd.addColorStop(0.5, `rgba(${c.replace(/,[^,]*$/, m => ',' + parseFloat(m.slice(1)) * 0.6)})`);
    grd.addColorStop(1, `rgba(${c.replace(/,[^,]*$/, ',0')})`);
    g.save(); g.translate(x + len / 2, y + thick / 2); g.scale(len / 2 + 2, thick + 1);
    g.fillStyle = grd; g.fillRect(-1, -1, 2, 2);
    g.restore();
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
}

function logoSet() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const tex = canvasTexture(1024, 320, drawLogo);
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
const heliLift = (t) => 4.02 + keyed(t, [[B(393), 0], [B(405), 0.08], [B(415), 0.2], [B(422), 0.32], [B(432), 1.1], [B(460), 1.7], [B(520), 2.0]])
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
    // It hovers pointing straight down the hall, as in the video, without turning.
    h.heli.rotation.set(0, 0, 0);
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
      [0, [6.6, 5.4, 6.6], [-0.5, 4.1, -0.5], 52], [2.6, [6.8, 2.6, 2.5], [-0.5, 5.0, -0.5], 52],
      [4.0, [7.6, 3.8, -4], [0, 5.4, 0], 52], [6.0, [7.8, 3.6, -14], [0, 5.2, 0], 52],
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
