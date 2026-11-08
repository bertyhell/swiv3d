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
  // Frame: posts between the side windows, and a pillar down each side of the sloped
  // windscreen (like a car's A-pillars), running along the glass's rounded corner from the
  // nose (z = 3.0) up to the roof (z = 1.9).
  const frameMat = dark;
  for (const [x, y, z, bw, bh, bd] of [[-1.03, 0.47, 1.9, 0.05, 0.98, 0.07], [1.03, 0.47, 1.9, 0.05, 0.98, 0.07], [-1.03, 0.47, 1.0, 0.05, 0.98, 0.07], [1.03, 0.47, 1.0, 0.05, 0.98, 0.07]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), frameMat);
    bar.position.set(x, y, z);
    g.add(bar);
  }
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
    const tip = navLight(s < 0 ? 0xff2a1a : 0x22ff55, 0.05);
    tip.position.set(s * 2.37, 0.3, -0.1);
    g.add(tip);
    wings.push(wing, tip);
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
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.2, 16), dark);
  rotor.add(hub);
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
  const dome = new THREE.Mesh(new THREE.LatheGeometry([V(0.25, 0, 0), V(0.24, 0.04, 0), V(0.19, 0.07, 0), V(0.1, 0.09, 0), V(0, 0.095, 0)], 20), dark);
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
  section([[0, -0.75], [0.05, -0.75], [0.07, -0.745], [0.074, -0.72], [0.076, -0.6]], cream);
  // Rear section: dark, the widest part.
  section([[0.076, -0.6], [0.079, -0.59], [0.079, -0.2], [0.078, -0.19]], dark);
  // Body: cream, tapering gently toward the nose.
  section([[0.078, -0.19], [0.075, 0.0], [0.066, 0.3], [0.058, 0.56]], cream);
  // A dark ring, then a short, blunt ogive nose.
  section([[0.058, 0.56], [0.06, 0.565], [0.06, 0.61], [0.058, 0.615]], dark);
  const ogive = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    ogive.push([0.058 * Math.pow(Math.max(0, 1 - u * u), 0.6), 0.615 + 0.17 * u]);
  }
  ogive.push([0, 0.786]);
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

function makeHangar(len = 22, r = 7, { lamp: withLamp = true, skin: skinCol = 0x6f7378, plain = false, trapezoid = false } = {}) {
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
  g.userData = { door, front, shell, ribs };
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
  g.userData = { door, front, shell, ribs };
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
  const conc = new THREE.MeshStandardMaterial({ color: 0x4a4648, map: repeatOf(concreteTex, len / 6, 1), roughness: 0.95 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 2.6, 0.4), conc);
  wall.position.y = 1.3;
  g.add(wall);
  for (let x = -len / 2; x <= len / 2; x += 3.2) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.9), conc);
    b.position.set(x, 1.2, 0.5);
    g.add(b);
    // Blocky merlons along the top, as in the video.
    for (const dx of [0, 1.6]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.55), conc);
      m.position.set(x + dx, 2.9, 0);
      g.add(m);
    }
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
    const hut = at(makeHangar(len, rr, { lamp: false, skin: 0x9a9ea8 }), M + cx, 0, cz, HUT_YAW);
    hut.scale.y = sy;
    // The moon is behind the huts, so each throws a long shadow toward the camera.
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: pondTex, color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
    shade.rotation.set(-Math.PI / 2, 0, 0.35);
    shade.scale.set(rr * 2.6, rr * 2.2, 1);
    shade.position.set(M + x + rr * 0.5, 0.03, z + rr * 0.9);
    scene.add(shade);
  }
  const moonTower = at(makeTower(), M + 11.5, 0, -35);
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
  const hangar = at(makeHangar(26, 8.5, { lamp: false, skin: 0x4a4c52 }), O, 0, -34);
  hangar.scale.y = 1.15;
  hangar.userData.door.material.color.setScalar(0.25);
  const outTower = at(makeTower(), O + 10, 0, -21);
  const shed = at(makeBunker(), O + 17, 0, -16, -0.3);
  // A Nissen hut on the left, its end toward the camera, and the tanker in the foreground.
  at(makeHangar(16, 4.2, { lamp: false, skin: 0x9a9ea8, trapezoid: true }), O - 12, 0, -14, 0.05);
  at(makeWall(160), O, 0, -60);
  // The tanker from its rear quarter, heading away to the right.
  const outTruck = at(makeTruck('tanker'), O - 6.2, 0, -4.5, 2.45);
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
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.3 + r() * 1.4, 0.05, 0.3 + r() * 1.1), new THREE.MeshStandardMaterial({ color: 0x9aa0aa, map: corrugated, roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }));
    d.visible = false;
    d.userData = { p: V(O + (r() - 0.5) * 14, 2 + r() * 8, -22 + (r() - 0.5) * 6), v: V((r() - 0.5) * 34, 6 + r() * 20, 8 + r() * 26), w: V(r() * 9, r() * 9, r() * 9) };
    scene.add(d);
    debris.push(d);
  }
  const heli = makeHeli({ color: 0x3a3e44, skin: '#6a7078' });
  heli.scale.setScalar(1.3);
  heli.visible = false;
  scene.add(heli);
  return { scene, sky, moon, hemi, moonLight, frontLight, poolSpot, apronJets, apronTanker, pool, bunker, highWall, moonTower, moonTanker, block, hangar, outTower, shed, outLight, outMoon, fire, smoke, core, bloom, rays, fireRays, slab, debris, heli };
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
 * gunsight, `faces` the pale-blue letter faces. Units: the traced area is 1000 wide.
 */
const LOGO_TRACE = {"w": 1000, "h": 312.5, "outline": "M343,14 346,14 349,14 351,15 352,15 354,16 358,16 364,16 374,16 386,15 395,15 402,14 406,14 408,14 409,14 410,15 411,15 411,17 411,19 409,23 407,27 405,30 404,33 404,35 404,36 403,38 403,39 402,41 401,43 399,49 395,57 390,68 383,83 378,94 374,103 372,109 371,112 369,115 368,119 366,123 363,127 361,131 360,134 359,136 359,137 358,139 357,140 357,141 356,142 355,144 354,144 354,145 354,146 354,147 354,148 355,148 356,149 357,149 359,149 361,149 363,149 365,148 366,148 367,147 367,146 368,145 368,144 368,143 368,141 369,139 370,137 372,134 374,130 376,126 379,120 382,113 384,108 386,104 387,102 387,101 388,100 388,99 389,98 389,97 390,94 391,91 393,88 396,83 398,79 399,75 401,71 401,68 403,64 405,60 408,54 411,48 413,42 415,39 416,36 416,35 417,34 417,33 418,33 419,32 419,31 419,30 419,29 419,27 420,25 421,23 422,20 423,18 425,16 426,15 428,15 430,14 432,14 435,14 437,14 439,14 441,15 442,15 443,15 445,16 450,16 457,15 465,15 473,15 479,14 485,14 489,14 493,14 495,15 496,15 497,15 496,17 495,20 494,23 491,28 489,32 488,35 487,37 486,40 484,45 481,52 477,61 473,68 471,74 469,78 468,81 467,84 466,86 465,87 465,88 464,89 464,90 463,91 463,92 462,95 461,99 458,104 455,111 452,117 450,121 449,123 449,124 449,125 448,126 447,128 446,130 445,132 444,134 442,137 441,140 440,142 439,144 439,146 439,147 439,148 440,148 441,149 442,149 443,149 445,149 446,149 447,149 448,149 449,148 450,148 451,148 451,147 452,146 452,145 452,143 452,141 454,139 455,136 458,132 459,128 460,126 461,124 461,123 462,121 462,120 463,119 464,118 464,117 465,116 465,115 465,113 467,109 470,102 475,91 482,78 487,66 491,56 494,49 496,43 498,39 500,36 501,34 502,33 503,32 504,31 504,29 504,28 504,26 504,24 505,22 506,20 507,18 508,16 509,15 511,15 512,15 515,15 517,14 520,15 523,15 525,15 526,15 526,16 530,16 538,16 550,15 565,15 576,15 584,15 588,15 589,15 589,16 590,17 589,18 589,20 588,21 587,23 586,25 585,27 584,28 584,29 584,30 583,31 583,32 582,34 581,36 580,38 579,41 578,44 575,49 572,56 567,66 562,78 558,87 555,93 553,97 553,98 552,101 550,105 548,111 544,118 541,124 540,128 539,131 539,133 538,134 538,135 538,136 537,136 536,137 536,138 536,139 535,140 535,142 533,144 531,147 528,151 526,154 524,158 522,161 521,164 519,167 517,170 514,173 512,176 508,179 504,182 500,185 495,189 490,192 485,195 479,198 473,200 467,202 461,204 454,205 448,207 441,208 435,208 430,209 425,209 411,210 389,210 358,210 318,209 287,209 264,209 249,209 243,209 238,209 234,209 232,209 230,210 229,210 227,210 226,210 224,210 222,209 221,209 220,208 219,207 220,206 221,205 223,205 225,204 226,203 227,202 228,201 229,200 232,198 235,196 239,194 242,191 245,189 247,188 247,186 249,185 250,183 251,182 253,180 255,179 257,177 258,175 260,173 262,170 264,167 266,163 269,159 272,154 274,148 277,142 280,134 283,128 285,123 287,120 288,117 290,115 290,113 291,111 291,110 292,109 292,106 294,104 295,101 297,98 297,96 298,95 298,94 298,92 299,90 300,88 302,85 304,81 306,76 309,70 311,64 313,59 315,55 316,53 317,52 318,50 319,47 321,43 324,38 326,33 327,30 328,27 328,25 329,24 330,22 330,20 331,19 332,18 333,17 334,16 336,15 338,14 340,14ZM789,14 790,14 791,14 792,15 793,16 793,17 793,19 793,20 792,22 792,23 791,24 790,25 789,27 788,29 786,33 785,37 782,44 778,53 773,63 767,76 763,86 760,93 759,97 758,98 758,99 758,100 757,101 756,101 755,103 754,106 752,110 750,115 748,120 746,125 743,130 741,135 739,139 737,142 736,145 736,146 736,147 737,148 738,148 740,149 741,149 743,149 745,148 747,148 748,147 749,146 749,144 749,143 749,142 750,140 751,139 752,138 753,138 753,137 754,136 754,135 754,133 755,130 757,127 759,123 761,119 763,114 765,109 767,104 770,97 773,89 778,79 783,69 787,59 791,52 793,47 794,44 795,41 796,39 797,37 797,36 797,35 798,34 799,33 800,32 800,31 801,31 801,30 801,29 801,27 801,25 802,23 803,20 805,18 806,16 807,15 809,15 810,15 813,15 815,14 818,15 821,15 822,15 824,16 825,16 831,16 841,16 857,16 878,15 894,15 905,15 911,15 911,16 912,17 912,18 911,20 911,22 909,24 907,28 905,32 902,36 900,41 898,46 896,51 894,55 893,58 892,60 891,61 890,62 889,64 888,66 888,69 886,72 885,75 883,78 881,81 879,85 877,88 875,91 874,95 873,97 872,99 871,101 870,101 869,103 867,106 865,109 862,114 859,119 855,125 850,131 845,137 839,143 834,148 830,152 825,156 820,161 814,165 807,170 799,175 792,180 785,184 778,187 771,190 764,193 757,196 750,198 742,200 734,202 723,204 712,206 699,207 687,209 675,209 665,210 654,210 646,210 641,210 637,209 635,209 633,209 631,209 629,209 627,209 624,210 619,210 613,210 606,210 600,210 596,209 594,209 594,208 594,207 594,206 595,205 597,204 599,204 602,203 605,201 609,199 613,196 617,192 621,189 624,187 625,185 626,184 627,182 629,180 630,179 633,177 635,174 638,171 640,167 643,162 646,158 648,155 649,152 650,151 651,149 652,147 652,146 652,144 653,143 654,141 655,138 656,136 658,133 659,130 660,127 661,125 662,121 664,117 666,113 669,108 671,103 672,100 673,98 673,97 674,96 674,94 676,91 677,88 679,86 679,84 680,82 680,81 681,79 682,76 684,72 687,68 689,64 691,60 692,57 693,54 693,51 695,48 696,45 697,43 699,40 700,38 700,37 700,35 701,34 702,33 702,32 703,31 704,30 704,29 704,28 704,27 705,25 705,24 706,22 707,20 708,19 709,17 710,16 711,15 713,15 715,15 718,14 722,14 725,14 727,15 729,15 731,16 736,16 743,16 754,16 768,15 778,14 785,14ZM311,14 314,15 317,15 319,15 320,16 320,17 320,18 320,19 319,20 318,21 317,22 317,24 317,25 317,27 316,29 315,31 314,33 312,36 311,39 310,41 309,42 309,43 309,45 308,47 307,49 305,52 304,54 303,57 303,58 302,60 302,62 301,63 300,65 299,66 290,67 274,68 250,68 218,68 195,68 178,69 170,69 169,69 169,70 169,71 169,72 169,73 169,74 168,75 168,76 167,77 167,79 167,80 168,80 168,81 169,81 170,81 171,81 172,81 180,80 195,80 217,80 246,80 268,80 283,80 290,81 291,81 292,82 292,83 292,84 292,85 292,86 291,87 290,88 289,89 288,90 288,91 288,92 287,94 286,97 284,100 282,104 280,107 279,110 278,112 278,113 277,115 277,117 275,119 274,122 272,126 271,129 270,132 269,136 268,139 267,141 265,144 264,146 262,147 261,149 261,150 260,151 260,152 259,153 259,154 258,154 257,156 255,158 253,161 251,166 248,170 245,173 242,177 238,181 234,184 231,187 227,189 224,191 221,193 217,195 213,197 209,199 205,200 200,202 196,203 191,204 186,205 182,206 177,207 172,208 167,208 162,209 156,209 150,210 139,210 124,210 103,210 77,210 57,210 43,210 34,209 31,209 29,209 26,209 24,209 21,209 20,209 19,209 18,209 17,208 17,207 17,206 17,205 18,203 19,202 20,200 21,198 21,197 20,195 20,193 21,191 22,189 24,187 25,184 27,182 28,179 28,177 29,175 30,173 31,172 31,171 32,170 33,168 33,167 33,165 34,163 35,161 37,159 39,157 41,155 42,154 43,154 45,154 46,154 47,154 49,154 50,154 52,154 53,154 54,154 55,154 56,155 58,155 59,154 61,154 67,154 78,153 95,153 116,153 132,153 143,153 149,154 151,154 152,154 155,154 158,154 162,154 164,153 167,152 168,151 168,149 169,148 170,147 171,146 172,145 172,144 173,144 172,143 172,142 171,142 170,142 163,141 148,141 127,141 98,141 77,141 61,141 52,141 49,140 47,140 46,139 45,139 45,138 45,137 46,136 47,135 48,134 48,132 49,130 50,127 51,125 51,124 52,122 53,122 54,120 56,117 58,112 60,107 62,103 63,99 65,95 65,93 66,90 68,87 69,84 71,81 73,79 74,77 74,75 75,73 76,71 77,69 78,67 80,65 81,62 83,59 86,57 88,54 90,52 92,50 92,49 93,48 93,47 95,46 97,44 99,42 101,40 103,39 105,38 106,38 108,37 109,36 110,35 112,34 113,32 115,31 118,30 120,28 123,27 125,26 127,26 128,25 130,25 131,25 133,24 134,25 135,24 137,24 138,23 140,21 142,20 145,20 149,19 153,19 156,19 158,19 160,18 162,17 163,17 166,16 169,16 171,16 174,16 176,16 178,16 180,17 181,18 181,19 181,20 180,21 180,22 179,23 178,23 177,24 177,25 177,26 178,27 179,27 186,27 200,27 220,27 246,27 267,27 280,27 288,27 290,27 291,26 292,25 293,23 295,20 296,18 298,17 300,16 302,15 305,15 308,15ZM610,14 613,14 616,14 618,15 619,15 620,16 626,16 635,16 650,16 668,15 682,15 692,15 697,15 698,16 698,17 698,18 698,20 697,21 696,23 694,26 692,28 691,31 689,35 688,38 687,41 686,43 685,44 684,45 678,45 667,45 651,46 630,46 614,45 603,45 598,45 597,44 596,44 594,44 593,44 591,44 590,44 590,43 589,42 589,41 590,40 590,39 591,38 592,37 593,35 594,33 595,30 596,28 597,26 598,24 599,23 600,22 600,21 600,20 600,19 601,17 601,16 602,16 603,15 605,15 607,14ZM596,58 597,58 599,59 602,59 606,58 610,58 617,58 627,57 639,57 654,57 666,57 673,58 677,58 678,58 678,59 678,60 677,62 676,63 676,65 675,66 675,68 675,69 674,71 674,73 672,75 671,78 668,82 666,88 662,96 658,105 655,112 653,118 650,122 649,125 648,127 647,129 647,131 646,133 646,135 645,137 644,139 642,141 641,143 640,145 640,146 639,147 639,149 638,150 637,152 636,153 635,155 634,157 633,158 633,159 632,161 629,164 625,169 619,175 614,181 610,185 606,188 602,191 598,193 594,195 590,197 586,199 581,201 575,202 567,204 559,206 549,207 537,208 524,209 509,209 498,209 490,208 487,208 487,206 488,205 490,204 493,203 496,201 499,200 502,198 505,195 508,193 510,191 513,189 514,188 516,188 517,187 519,185 520,184 522,182 523,181 524,179 524,178 524,177 525,176 526,175 527,174 528,172 529,171 529,170 530,169 531,167 533,164 535,160 539,155 541,152 543,149 544,146 544,145 545,143 546,141 547,138 549,135 551,131 553,125 556,120 558,113 561,107 562,103 564,101 564,100 565,99 565,98 566,97 566,95 567,92 569,89 571,85 573,82 574,80 574,78 574,77 575,76 575,75 576,74 577,73 577,72 578,71 578,69 579,68 579,66 580,65 581,63 583,61 584,60 586,59 588,58 590,58 592,58 594,58ZM900,118 901,118 902,118 903,119 904,120 905,122 905,126 905,130 905,137 906,141 907,144 908,146 910,146 912,147 915,148 917,148 921,150 924,151 927,152 930,154 933,156 936,158 939,160 942,162 945,165 947,168 950,171 952,175 954,179 956,184 958,188 959,192 960,197 960,200 961,202 961,204 962,204 963,204 966,204 971,204 977,204 981,205 984,205 986,205 986,206 987,206 987,207 987,209 987,210 986,212 986,213 985,214 984,214 981,214 978,214 973,214 969,215 966,215 965,215 963,215 962,217 961,219 960,223 959,228 958,232 956,236 954,241 952,245 950,249 948,252 946,254 945,255 943,257 940,259 936,262 931,265 926,268 921,270 917,272 912,273 909,275 906,279 905,284 905,290 905,295 904,298 904,300 903,301 902,302 901,302 900,302 899,302 898,301 897,301 897,300 896,298 896,295 895,290 895,283 894,278 892,275 889,272 885,271 880,269 876,267 871,264 865,260 861,256 856,251 852,245 849,239 846,233 844,229 843,224 842,221 841,218 838,216 834,216 829,215 825,215 821,216 818,216 817,216 815,216 814,216 812,216 811,215 810,214 810,213 809,211 809,210 809,209 809,208 810,207 810,206 811,205 813,205 817,205 822,204 829,204 834,204 838,204 840,204 841,204 841,203 842,201 842,200 842,197 843,195 843,192 844,190 845,187 847,184 849,180 852,176 855,171 858,167 861,163 865,160 869,157 873,155 877,152 882,150 888,148 892,145 894,141 896,136 896,130 896,125 896,122 897,120 898,119 899,118ZM906,157 905,161 905,166 905,175 905,186 905,195 906,201 907,204 908,204 909,204 910,204 911,204 911,203 911,201 911,198 911,195 912,192 915,191 919,190 925,190 929,190 932,190 935,190 936,191 938,191 939,192 941,194 943,195 945,197 946,198 947,200 947,203 948,206 948,209 947,213 946,217 945,221 944,224 943,226 942,227 941,228 940,229 939,230 938,231 936,231 932,231 928,231 922,232 917,232 914,231 912,231 912,230 911,229 911,227 911,224 911,221 911,218 910,216 909,215 908,215 907,215 906,215 905,216 905,219 905,225 905,233 905,245 905,254 906,260 906,263 907,263 908,263 910,263 912,263 914,262 916,261 919,260 922,259 925,257 928,255 931,253 934,250 938,246 940,243 942,241 944,238 945,236 946,235 946,233 947,231 947,230 947,228 948,227 948,225 949,224 950,222 950,218 950,214 951,209 951,204 950,201 950,198 949,197 948,195 948,193 947,191 947,189 947,188 946,186 946,184 945,182 943,180 941,177 939,174 936,171 933,168 929,166 926,163 921,161 918,160 914,158 912,157 910,157 908,157 907,157ZM885,160 881,162 876,164 872,167 869,170 865,173 862,176 860,180 857,183 856,187 854,191 853,195 852,198 851,202 851,207 851,212 852,217 853,223 854,228 856,233 857,236 859,239 861,242 863,245 866,248 869,251 872,254 875,256 878,258 881,260 884,261 887,262 889,262 891,262 893,262 894,262 895,262 895,259 895,253 896,244 896,232 896,223 895,217 895,214 894,213 893,213 892,213 891,214 891,215 892,216 892,217 892,218 892,219 891,221 890,222 890,224 889,226 887,227 886,228 885,229 883,229 881,230 880,230 877,230 874,231 871,230 867,230 864,230 862,229 860,228 859,227 859,226 858,225 858,224 858,223 858,222 858,221 859,220 860,219 861,219 862,218 864,219 867,219 869,219 870,219 872,219 872,218 873,218 873,217 873,216 873,215 871,215 870,215 868,214 866,214 865,214 864,213 864,212 863,211 863,210 863,208 864,207 865,206 867,205 869,205 871,204 872,204 873,203 873,202 873,201 872,200 871,199 869,199 868,199 866,199 865,199 864,200 863,200 862,200 861,200 860,199 859,198 859,197 858,195 858,194 858,192 859,191 860,191 861,190 863,189 865,188 868,188 871,188 874,188 877,188 879,188 882,189 884,190 886,191 888,193 889,194 890,196 891,198 891,201 892,203 892,204 893,204 894,204 895,201 895,195 896,186 896,175 895,166 895,161 894,158 893,157 891,158 889,159Z", "faces": "M217,36 242,36 261,37 275,37 282,37 283,38 283,39 283,40 283,42 283,44 276,45 262,46 241,47 214,47 194,47 179,47 171,48 170,48 168,49 167,49 166,50 166,52 165,53 164,53 163,54 162,54 161,54 160,55 159,56 159,58 158,59 158,60 157,60 156,60 156,59 155,58 155,57 155,56 155,55 154,55 153,55 152,55 151,56 150,57 149,58 149,59 148,61 147,63 147,65 146,67 146,71 146,75 146,79 146,83 146,87 146,90 146,93 147,95 147,97 148,98 148,99 150,100 154,100 159,101 165,102 170,102 173,102 175,101 175,100 175,99 176,98 177,98 181,97 187,97 195,97 206,97 214,98 220,98 223,98 224,98 224,99 224,100 224,101 226,102 230,103 236,104 244,104 249,104 253,105 255,106 255,107 254,109 253,112 252,116 250,120 248,123 247,126 247,128 247,129 246,130 245,132 244,135 242,138 240,140 239,142 239,144 239,146 238,147 238,148 237,148 236,148 234,149 233,151 232,152 231,154 230,155 230,157 230,158 230,159 231,159 232,159 233,159 233,160 234,160 234,161 232,163 230,165 226,168 221,172 217,175 214,177 212,178 211,178 210,179 209,179 207,180 206,181 203,182 200,183 196,184 190,185 178,186 159,187 133,187 101,187 77,187 60,186 53,184 53,182 53,180 54,179 55,178 56,177 57,176 58,175 58,174 58,173 64,172 75,171 93,171 115,171 133,172 144,172 150,173 150,174 151,175 153,176 156,176 160,176 163,176 167,176 170,175 174,174 177,173 179,172 182,171 184,170 185,169 187,167 188,165 189,162 190,159 191,156 191,151 192,146 192,141 192,137 191,133 191,130 190,128 189,126 188,124 188,123 180,122 167,121 147,121 120,120 101,120 87,119 81,118 81,117 82,114 84,110 87,103 91,94 96,86 100,79 104,73 109,67 113,63 117,59 121,55 125,52 129,50 133,48 137,46 141,44 145,43 151,41 158,40 166,38 179,37 196,37ZM359,37 364,37 368,37 370,37 372,38 373,38 373,39 373,40 371,46 366,58 359,74 349,96 342,115 337,131 334,143 334,153 335,160 336,164 337,167 339,167 341,167 342,168 344,168 345,169 348,170 351,170 356,170 362,170 367,170 371,170 374,169 376,169 378,168 380,167 382,166 383,165 388,156 396,140 406,116 420,85 432,61 441,45 447,38 451,37 454,38 456,38 457,39 457,40 455,44 452,52 447,63 440,77 436,88 432,96 431,100 431,102 430,104 429,107 427,110 424,115 422,120 420,124 419,128 418,132 417,137 417,142 417,149 417,156 419,162 421,166 425,168 429,169 434,170 438,170 443,170 447,170 452,170 456,169 460,167 463,166 469,156 478,140 489,116 503,85 513,62 520,46 524,38 525,38 527,38 530,37 534,37 539,37 544,37 547,38 549,38 550,39 551,39 551,40 552,41 551,42 551,43 550,44 549,46 548,47 548,48 548,49 548,50 547,52 546,55 544,59 541,64 539,68 537,72 536,76 535,79 535,81 534,83 533,84 532,85 531,87 530,89 529,91 528,94 527,97 526,100 524,103 523,106 521,109 520,112 519,115 518,118 517,122 514,127 510,134 505,142 501,148 499,152 497,155 497,156 498,156 498,157 499,157 500,157 501,158 501,159 501,160 500,161 499,162 497,164 494,167 491,169 488,171 484,172 480,174 477,175 474,177 473,178 472,179 469,181 462,182 453,184 441,186 423,187 399,188 370,188 336,188 310,188 292,188 284,187 283,186 284,184 286,179 289,174 294,166 300,153 308,136 319,112 331,84 340,63 347,48 350,40 351,39 353,38 356,38ZM738,38 745,38 749,40 751,43 751,47 749,53 747,59 744,64 742,69 740,74 738,78 737,81 736,83 736,84 734,88 732,94 728,103 723,114 719,124 716,134 715,144 716,152 716,159 717,164 718,167 719,168 720,168 723,169 726,170 730,170 735,170 740,170 745,170 750,169 754,168 758,167 762,166 764,164 769,156 776,140 786,119 799,90 808,68 815,53 820,44 821,41 825,39 832,38 841,37 853,37 861,38 867,38 871,40 871,41 870,45 867,51 863,60 858,70 852,80 847,90 841,98 836,106 831,112 829,116 827,119 827,120 827,121 828,121 829,122 830,122 831,122 831,123 830,125 828,127 826,130 823,133 820,136 817,139 814,142 812,144 809,146 808,147 806,147 805,148 804,148 803,149 802,150 801,152 799,153 797,154 795,155 792,156 790,157 788,158 786,159 785,161 784,162 783,163 782,163 781,163 780,164 779,164 777,165 776,166 774,168 769,170 763,173 755,176 746,178 736,181 724,183 710,185 698,186 687,188 678,188 671,188 665,188 661,188 659,187 659,186 660,184 662,180 665,174 669,168 674,157 681,143 689,125 698,102 706,84 713,69 718,57 722,49 727,43 732,39ZM606,75 607,75 608,75 608,76 609,76 609,78 611,79 615,79 621,79 629,79 634,80 638,82 640,84 639,86 638,90 636,94 634,98 632,103 629,108 628,111 626,115 626,117 624,122 621,127 617,134 612,143 609,150 607,155 606,158 606,160 606,162 605,164 604,165 602,167 600,168 598,169 595,170 593,171 591,172 589,173 588,174 588,175 587,175 586,176 585,176 584,176 583,177 582,177 581,178 580,179 578,180 574,181 569,182 562,184 556,184 553,184 551,184 551,183 552,181 554,177 557,172 561,165 566,156 572,144 578,128 586,110 592,97 597,87 600,82 601,81 603,80 604,78 604,77 605,76 605,75 606,75Z"};

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
    base.moonLight.intensity = 1.6;
    return { scene, black: span(t, A(298), A(310)) };
  }

  /** Shared state of the night base for this frame. */
  function night(t) {
    base.moon.visible = true;
    base.outMoon.visible = false;
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
    setRotor(h.heli, spun(t, ROTOR), speed);
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
    // Close below the outer pair, so the missiles fill the frame as in the video. The video
    // shows them against the roof, so the wing (and its tip light) is left out of this shot.
    h.userData.wings.forEach((w) => { w.visible = false; });
    // Neutral light here: the warm wall fills and reflections turned the cream missiles gold.
    hall.uplights[-1].fill.forEach((l) => { l.intensity = 1.5; });
    hall.uplights[1].fill.forEach((l) => { l.intensity = 1.5; });
    scene.environmentIntensity = 0.25;
    hall.ambient.intensity = 1.4;
    cam.position.copy(p(1.75, -1.45, -0.95));
    cam.up.copy(V(0, 0, 1).transformDirection(h.matrixWorld));
    cam.lookAt(p(1.75, 0.2, 0.3));
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
    const hg = base.hangar.userData;
    const blown = t >= B(597);
    hg.door.visible = !blown;
    hg.front.visible = !blown;
    // The blast strips the skin off: the fire burns inside the bare ribs. The front of the frame
    // goes too, leaving the gunship a clear way out.
    hg.shell.visible = !blown;
    hg.ribs.forEach((rib) => { rib.visible = !blown || rib.position.z < 0; });
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
    base.debris.forEach((d) => {
      const T = t - B(598);
      // Hidden in the glare at first; they show once the flash dies down.
      d.visible = T > 0.35;
      if (T <= 0) return;
      const u = d.userData;
      d.position.set(u.p.x + u.v.x * T, Math.max(0.05, u.p.y + u.v.y * T - 11 * T * T), u.p.z + u.v.z * T);
      d.rotation.set(u.w.x * T, u.w.y * T, u.w.z * T);
    });
    // The gunship bursts out of the fire and away to the right.
    const H = base.heli;
    const k = span(t, B(626), B(660));
    H.visible = t >= B(626);
    // Straight out along the hangar's axis until the rotor is clear of the frame, then away to
    // the right.
    const p = track(k, [[0, O, 4.0, -26], [0.3, O + 0.5, 4.8, -17], [0.6, O + 5.5, 6.6, -13], [1, O + 17, 10, -9]]);
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
