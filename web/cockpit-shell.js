// The cockpit's dashboard structure: the solid shapes the instruments sit on, read off the
// original's opening frame. Every shape is given by where its front face appears in that
// frame (x, y in percent, as in cockpit.js) and how far it stands out from the dash (h, world
// units). The dash itself is a plane the original's camera looks down on from slightly to the
// right, so every shape's sides run back towards a vanishing point up and to the right of the
// frame's centre.
import * as THREE from './vendor/three.module.min.js';

const FOV = 50;
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2));

/** The original's framing: the layout's full height in view, from slightly right of centre. */
export const COCKPIT_VIEW = { pos: [0.45, 0.1, 4 / TAN], target: [0, 0, 0], fov: FOV };

/** Where the dash's depth lines vanish: tangents of the camera's yaw and pitch off its normal. */
const VANISH = { x: 0.26, y: 0.24 };
/** A point on the dash plane (h = 0). */
const BASE = new THREE.Vector3(0, -0.5, -0.5);
/** The frame the layout was measured on. */
const ASPECT = 1.25;

/**
 * The parts: each is a list of rows down its front face, [[left x, y], [right x, y], h].
 * Faces between rows may fold; the sides run straight back to the dash.
 */
export const SHELL = {
  // The tall centre console: overhead section, centre display section, toggle section. It
  // narrows downwards and leans out towards the pilot at the top.
  console: [
    [[16, 7], [60.2, 5.3], 2.2],
    [[23.4, 35.3], [56.1, 36], 1.9],
    [[30.4, 62.4], [52.2, 64], 1.2],
    [[33.5, 74.5], [50.6, 75.5], 1.0],
  ],
  // The lamp strips either side of the console, just below its overhead section.
  wingL: [[[13, 27.3], [24, 27], 0.8], [[15, 34], [25, 34], 0.8]],
  wingR: [[[56, 26.8], [69, 26.8], 0.8], [[56, 34.2], [68, 34.3], 0.8]],
  // The two big screens' boxes.
  mfdL: [[[4.5, 38], [29, 39], 0.8], [[6, 67.5], [29.5, 69.5], 0.8]],
  mfdR: [[[62, 39.5], [94.5, 40], 1.3], [[62.2, 73], [93, 75], 1.3]],
  // The bottom monitor, and the two-lamp box standing on its top, flush with its front.
  monitor: [[[33.5, 81.4], [51.3, 83.2], 1.0], [[33.6, 101], [51.3, 101], 1.0]],
  lampBox: [[[36.5, 74.6], [47, 75.6], 1.0], [[36.6, 81.7], [47, 82.7], 1.0]],
};

/** The dash plane's extent: from below the overhead down past the frame, wider than it. */
const DASH = { x0: -35, x1: 135, y0: 36, y1: 105 };

/**
 * The darker panels on the dash the side and bottom instruments sit on: [x0, y0, x1, y1] and
 * how far each stands off the dash. Each is a true rectangle on the dash, laid out on its own
 * grid from `at`, where it matches the frame: its rows run along the dash and its columns up
 * it, so in perspective they converge as the dash recedes, as the boxes' edges do.
 */
export const DASH_ZONES = {
  edgeL: { rect: [-35, 39, 3.9, 71], at: [2, 56], h: 0.004 },
  edgeR: { rect: [95.6, 56, 135, 77], at: [98, 70], h: 0.004 },
  gaugesL: { rect: [-35, 69.5, 31, 92], at: [16, 79], h: 0.008 },
  bottomR: { rect: [54, 76, 135, 100], at: [80, 87], h: 0.008 },
};

const normal = new THREE.Vector3(-VANISH.x, -VANISH.y, 1).normalize();   // out of the dash
const base = BASE.dot(normal);
const cam = new THREE.PerspectiveCamera(FOV, ASPECT, 0.05, 40);
cam.position.set(...COCKPIT_VIEW.pos);
cam.lookAt(...COCKPIT_VIEW.target);
cam.updateMatrixWorld();

/** The camera ray through (x, y) percent of the original frame. */
function ray(x, y) {
  const d = new THREE.Vector3((x - 50) / 50, (50 - y) / 50, 0.5).unproject(cam).sub(cam.position).normalize();
  return new THREE.Ray(cam.position.clone(), d);
}

/** The point that appears at (x, y) percent of the original frame, `h` out from the dash. */
export function onShell(x, y, h = 0) {
  const r = ray(x, y);
  const t = (base + h - r.origin.dot(normal)) / r.direction.dot(normal);
  return r.at(t, new THREE.Vector3());
}

/** The dash's own axes: `normal` out of it, `up` and `right` along it, `center` mid-frame on it. */
const up = new THREE.Vector3(0, 1, 0).projectOnPlane(normal).normalize();
export const SHELL_FRAME = { normal, up, right: new THREE.Vector3().crossVectors(up, normal), center: onShell(50, 50, 0) };

// Each part's front face, as sections between its rows: the corners in the frame and in 3D,
// and the section's plane.
const sections = [];
for (const [part, rows] of Object.entries(SHELL)) {
  for (let i = 0; i + 1 < rows.length; i++) {
    const img = [rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]];   // TL TR BR BL
    const hs = [rows[i][2], rows[i][2], rows[i + 1][2], rows[i + 1][2]];
    const p = img.map(([x, y], k) => onShell(x, y, hs[k]));
    const n = new THREE.Vector3().crossVectors(p[2].clone().sub(p[0]), p[1].clone().sub(p[3])).normalize();
    if (n.dot(cam.position.clone().sub(p[0])) < 0) n.negate();
    const mid = p.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(0.25);
    sections.push({ part, img, p, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(n, mid), normal: n, h: Math.max(...hs) });
  }
}

const inside = (poly, x, y) => {
  let sign = 0;
  for (let k = 0; k < poly.length; k++) {
    const [ax, ay] = poly[k], [bx, by] = poly[(k + 1) % poly.length];
    const c = Math.sign((bx - ax) * (y - ay) - (by - ay) * (x - ax));
    if (c && sign && c !== sign) return false;
    sign ||= c;
  }
  return true;
};

/**
 * Where (x, y) of the frame falls on a section's face, laid out on the face's own grid: a row
 * of the frame is a row across the face, between its top and bottom edges, and across it a
 * point keeps its share of the face's width. So rows run parallel to the face's edges and
 * columns lean with its sides. Right runs along the row, up along the column (on a tapering
 * face the two are not square).
 */
function onSection(s, x, y) {
  const [TL, TR, BR, BL] = s.img;
  const top = (TL[1] + TR[1]) / 2, bottom = (BL[1] + BR[1]) / 2;
  const v = (y - top) / (bottom - top);
  const xl = TL[0] + (BL[0] - TL[0]) * v, xr = TR[0] + (BR[0] - TR[0]) * v;
  const u = (x - xl) / (xr - xl);
  const [a, b, c, d] = s.p;
  const point = a.clone().lerp(b, u).lerp(d.clone().lerp(c, u), v);
  s.plane.projectPoint(point, point);
  const right = b.clone().sub(a).lerp(c.clone().sub(d), v).projectOnPlane(s.normal).normalize();
  const up = a.clone().sub(d).lerp(b.clone().sub(c), u).projectOnPlane(s.normal).normalize();
  return { part: s.part, point, normal: s.normal.clone(), right, up };
}

// The dash's own axes: right along its top edge, up square to it.
const dashRight = onShell(DASH.x1, DASH.y0).sub(onShell(DASH.x0, DASH.y0)).normalize();
const dashUp = new THREE.Vector3().crossVectors(normal, dashRight);

/** The point of a dash zone's grid for (x, y) of the frame, `h` out from the dash. */
function onZone(zone, x, y, h = zone.h) {
  const [ax, ay] = zone.at;
  const A = onShell(ax, ay, h);
  const kx = onShell(ax + 1, ay, h).sub(A).dot(dashRight), ky = A.clone().sub(onShell(ax, ay + 1, h)).dot(dashUp);
  return A.addScaledVector(dashRight, (x - ax) * kx).addScaledVector(dashUp, (ay - y) * ky);
}

/**
 * The surface that shows at (x, y) percent of the original frame: the front-most part face
 * there, else the dash zone, else the dash. Returns the point on it, its outward normal, and
 * its right and up directions.
 */
export function surfaceAt(x, y) {
  let best = null;
  for (const s of sections) if (inside(s.img, x, y) && (!best || s.h > best.h)) best = s;
  if (best) return onSection(best, x, y);
  const dash = (part, point) => ({ part, point, normal: normal.clone(), right: dashRight.clone(), up: dashUp.clone() });
  for (const [name, z] of Object.entries(DASH_ZONES)) {
    const [x0, y0, x1, y1] = z.rect;
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return dash(name, onZone(z, x, y, z.h));
  }
  return dash('dash', onShell(x, y, 0));
}

/**
 * How much bigger something at `p` must be than at `flat` (its spot on the old flat layout
 * plane) to look the same size from the original camera.
 */
export function depthScale(p, flat) {
  const fwd = new THREE.Vector3(...COCKPIT_VIEW.target).sub(cam.position).normalize();
  return p.clone().sub(cam.position).dot(fwd) / flat.clone().sub(cam.position).dot(fwd);
}

/**
 * A part as a solid: its folded front face plus sides back to the dash, UV-mapped by size.
 * `at(x, y, h)` places the frame's points (by default, where they show in the frame).
 */
function solid(rows, at = onShell) {
  const front = rows.map(([l, r, h]) => [at(...l, h), at(...r, h)]);
  const back = front.map((row, i) => row.map((p) => p.clone().addScaledVector(normal, -rows[i][2])));
  const pos = [], uv = [];
  const quad = (a, b, c, d) => {
    // Planar UVs along the quad's own edges, half a texture per world unit.
    const w = b.distanceTo(a), h = d.distanceTo(a);
    for (const [v, s, t] of [[a, 0, 0], [b, w, 0], [c, w, h], [a, 0, 0], [c, w, h], [d, 0, h]]) { pos.push(v.x, v.y, v.z); uv.push(s * 0.5, t * 0.5); }
  };
  for (let i = 0; i + 1 < rows.length; i++) {
    const [l0, r0] = front[i], [l1, r1] = front[i + 1], [bl0, br0] = back[i], [bl1, br1] = back[i + 1];
    quad(l1, r1, r0, l0);       // front
    quad(bl1, l1, l0, bl0);     // left side
    quad(r1, br1, br0, r0);     // right side
  }
  const [tl, tr] = front[0], [btl, btr] = back[0];
  quad(tl, tr, btr, btl);       // top
  const [bl, br] = front.at(-1), [bbl, bbr] = back.at(-1);
  quad(bbl, bbr, br, bl);       // bottom
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** A flat panel on the dash between percentage corners, `h` out from it (to layer panels). */
export function dashPanel(x0, y0, x1, y1, h = 0, at = onShell) {
  return solid([[[x0, y0], [x1, y0], h], [[x0, y1], [x1, y1], h]], at);
}

/**
 * The cabin roof: a dark ceiling from the console's top edge, carried across the whole frame,
 * out over the pilot's head.
 */
function roof() {
  const [[l, r, h]] = SHELL.console;
  const a = onShell(...l, h), b = onShell(...r, h);
  const along = b.clone().sub(a).normalize();
  const out = normal.clone().addScaledVector(dashUp, 0.35).normalize();
  const p0 = a.clone().addScaledVector(along, -8), p1 = b.clone().addScaledVector(along, 8);
  const p2 = p1.clone().addScaledVector(out, 7), p3 = p0.clone().addScaledVector(out, 7);
  const w = p1.distanceTo(p0) * 0.5, d = 7 * 0.5;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([p0, p1, p2, p0, p2, p3].flatMap((v) => v.toArray()), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, w, 0, w, d, 0, 0, w, d, 0, d], 2));
  g.computeVertexNormals();
  return g;
}

/** The dash and every part as meshes; `materials[name]` (or `.default`) skins each. */
export function shellMeshes(materials) {
  const group = new THREE.Group();
  const dash = new THREE.Mesh(dashPanel(DASH.x0, DASH.y0, DASH.x1, DASH.y1, 0.001), materials.dash ?? materials.default);
  dash.name = 'dash';
  group.add(dash);
  for (const [name, z] of Object.entries(DASH_ZONES)) {
    const m = new THREE.Mesh(dashPanel(...z.rect, z.h, (x, y, h) => onZone(z, x, y, h)), materials.zone ?? materials.dash ?? materials.default);
    m.name = name;
    group.add(m);
  }
  const top = new THREE.Mesh(roof(), materials.roof ?? materials.default);
  top.name = 'roof';
  group.add(top);
  for (const [name, rows] of Object.entries(SHELL)) {
    const m = new THREE.Mesh(solid(rows), materials[name] ?? materials.default);
    m.name = name;
    group.add(m);
  }
  return group;
}

/** The blockout: the shell flat grey with its edges drawn, for checking the structure. */
export function shellBlockout({ edges = 0xf2d02a } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x6c7276, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide, flatShading: true });
  const group = shellMeshes({ default: mat, dash: new THREE.MeshStandardMaterial({ color: 0x30363a, roughness: 0.9, side: THREE.DoubleSide }) });
  if (edges != null) {
    for (const m of [...group.children]) {
      if (m.name === 'dash' || m.name === 'roof' || m.name in DASH_ZONES) continue;
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 4), new THREE.LineBasicMaterial({ color: edges }));
      e.renderOrder = 1;
      group.add(e);
    }
  }
  return group;
}
