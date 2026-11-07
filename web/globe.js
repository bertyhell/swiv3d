// The HUD's map globe, shared by the game HUD and the mission briefing's Objective Guide.

// The map globe: a machined metal disk holding a glass window onto the colour map. Disk and
// window turn with the craft so its heading points up. North is a black triangle set into the
// disk's grey border, so it turns with the disk; four notches cut the rim 45 degrees either side
// of it. Under the disk sits a Y-shaped piece that turns towards the objective: its stem ends
// past the rim in a white arrow with a grey border at the nearest target, its two arms in grey
// blocks 40 degrees wide with rounded corners.
export const GLOBE_CELLS = 36; // map cells from the centre of the window to its edge

/** A closed polygon through `pts` ([x, y] pairs) with corners rounded to radius `r`. */
function roundedPolygon(g, pts, r) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m = mid(pts[n - 1], pts[0]);
  g.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = mid(pts[i], pts[(i + 1) % n]);
    g.arcTo(p[0], p[1], q[0], q[1], r);
  }
  g.closePath();
}

/** A triangle's inset by `d`: every edge moved `d` inwards, so the two outlines are parallel. */
function insetTriangle([A, B, C], d) {
  const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const a = len(B, C), b = len(C, A), c = len(A, B), per = a + b + c;
  const I = [(a * A[0] + b * B[0] + c * C[0]) / per, (a * A[1] + b * B[1] + c * C[1]) / per];
  const area = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1])) / 2;
  const k = Math.max(0, 1 - d / (2 * area / per)); // about the incentre, by (r - d) / r
  return [A, B, C].map((p) => [I[0] + (p[0] - I[0]) * k, I[1] + (p[1] - I[1]) * k]);
}

/** Brushed metal lit from the top left, in the globe's unrotated frame. */
function metalFill(g, D) {
  const f = g.createLinearGradient(-D, -D, D, D);
  f.addColorStop(0, '#f2f4f7');
  f.addColorStop(0.35, '#b8bdc4');
  f.addColorStop(0.7, '#767b82');
  f.addColorStop(1, '#3e4247');
  return f;
}

/**
 * Paints the globe into a `size` x `size` box at the context's origin. `x, z` is the map
 * position at the window's centre, `heading` the craft's heading (-PI keeps north up),
 * `gx, gz` the objective the white pointer shows (gx < 0: none), `cells` the map cells
 * from the window's centre to its edge. `aim`, when given, fixes the Y's direction instead
 * (screen radians, 0 = right, positive = clockwise).
 */
export function paintGlobe(g, size, mapCanvas, x, z, heading, gx = -1, gz = -1, cells = GLOBE_CELLS, aim = null) {
  const R = size / 2;
  const D = R * 0.78; // disk radius; the objective piece reaches out to R
  const turn = Math.PI + heading; // rotates the craft's heading to screen-up
  const rot = (dx, dy) => [dx * Math.cos(turn) - dy * Math.sin(turn), dx * Math.sin(turn) + dy * Math.cos(turn)];
  g.save();
  g.translate(R, R);

  // The objective piece, under the disk: a Y whose stem points at the objective.
  if (gx >= 0 || aim != null) {
    const wrapd = (d) => ((d + 768) % 512) - 256;
    const [mx, my] = aim != null ? [Math.cos(aim), Math.sin(aim)] : rot(wrapd(gx - x), wrapd(gz - z));
    if (mx || my) {
      const a = Math.atan2(my, mx);
      const leg = R * 0.2;           // width of the legs (they show only as the arm ends)
      const shadow = () => {
        g.shadowColor = 'rgba(0,0,0,0.6)';
        g.shadowBlur = R * 0.04;
        g.shadowOffsetX = R * 0.015;
        g.shadowOffsetY = R * 0.03;
      };
      // Grey, one piece: the hub, the legs, two arm ends that come out from under the rim 40
      // degrees wide and taper outwards (trapezoids), and the arrow's border. Its outline is stroked first and the fill covers the inner
      // half, so only the outer edge shows (the legs' edges would show through the notches).
      const turnBy = (t) => ([px, py]) => [px * Math.cos(t) - py * Math.sin(t), px * Math.sin(t) + py * Math.cos(t)];
      const border = [[R * 0.995, 0], [R * 0.64, -R * 0.36], [R * 0.64, R * 0.36]].map(turnBy(a));
      // An arm end along +x: a block under the disk, 40 degrees wide where it meets the rim,
      // narrowing to its flat outer edge.
      const wRim = D * Math.sin(20 * Math.PI / 180), wOut = wRim * 0.62, xRim = D * 0.93;
      const armEnd = [[R * 0.6, -wRim], [xRim, -wRim], [R * 0.86, -wOut], [R * 0.86, wOut], [xRim, wRim], [R * 0.6, wRim]];
      const piece = () => {
        g.beginPath();
        g.arc(0, 0, R * 0.3, 0, Math.PI * 2);
        for (const da of [0, Math.PI - 0.62, Math.PI + 0.62]) {
          g.save();
          g.rotate(a + da);
          g.rect(0, -leg / 2, R * 0.8, leg);
          g.restore();
          if (da) roundedPolygon(g, armEnd.map(turnBy(a + da)), R * 0.035);
        }
        roundedPolygon(g, border, R * 0.07);
      };
      g.save();
      piece();
      shadow();
      g.lineWidth = Math.max(2, R * 0.04);
      g.strokeStyle = 'rgba(30,32,36,0.9)';
      g.stroke();
      g.shadowColor = 'transparent';
      g.fillStyle = metalFill(g, D);
      piece();
      g.fill();
      // The white arrow, set into its grey border.
      const b = R * 0.045;
      g.beginPath();
      roundedPolygon(g, insetTriangle(border, b), R * 0.07 * 0.55);
      g.fillStyle = '#f4f6f8';
      g.fill();
      g.lineWidth = Math.max(0.75, R * 0.015);
      g.strokeStyle = 'rgba(40,42,46,0.6)';
      g.stroke();
      g.restore();
    }
  }

  g.save();
  g.rotate(turn);
  // The disk outline: a circle with four notches cut into its rim on the quadrants, 45 degrees
  // either side of north (north is up in the disk's frame).
  const notch = D * 0.075;
  const polar = (r, a) => [Math.cos(a) * r, Math.sin(a) * r];
  const north = -Math.PI / 2;
  const diskPath = () => {
    g.beginPath();
    for (let q = 0; q < 4; q++) {
      const a0 = q * Math.PI / 2 + Math.PI / 4;
      const half = Math.asin(notch / D);
      g.arc(0, 0, D, a0 - Math.PI / 2 + half, a0 - half);
      const nx = Math.cos(a0) * D, ny = Math.sin(a0) * D;
      // Inner half of a small circle centred on the rim: a cut into the disk.
      g.arc(nx, ny, notch, a0 - Math.PI / 2 - half / 2, a0 + Math.PI / 2 + half / 2, true);
    }
    g.closePath();
  };
  // Drop shadow and the disk's thickness (its edge shows below-right).
  g.save();
  g.rotate(-turn);
  g.translate(R * 0.04, R * 0.06);
  g.rotate(turn);
  diskPath();
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.filter = `blur(${Math.max(1, R * 0.03)}px)`;
  g.fill();
  g.filter = 'none';
  g.restore();
  g.save();
  g.rotate(-turn);
  g.translate(R * 0.015, R * 0.035);
  g.rotate(turn);
  diskPath();
  g.fillStyle = '#2c2f33';
  g.fill();
  g.restore();
  // Face: brushed metal lit from the top left (light stays fixed while the disk turns).
  diskPath();
  g.save();
  g.clip();
  g.rotate(-turn);
  g.fillStyle = metalFill(g, D);
  g.fillRect(-R, -R, size, size);
  g.lineWidth = Math.max(0.5, R * 0.008);
  for (let k = 0; k < 18; k++) {
    g.strokeStyle = k % 2 ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)';
    g.beginPath(); g.arc(0, 0, D * (0.3 + k * 0.04), 0, Math.PI * 2); g.stroke();
  }
  const spec = g.createRadialGradient(-D * 0.45, -D * 0.5, 0, -D * 0.45, -D * 0.5, D * 0.8);
  spec.addColorStop(0, 'rgba(255,255,255,0.55)');
  spec.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spec;
  g.fillRect(-R, -R, size, size);
  g.restore();
  // Bevel: a bright upper-left rim and a dark lower-right rim.
  g.save();
  diskPath();
  g.clip();
  g.rotate(-turn);
  g.lineWidth = Math.max(1.5, R * 0.05);
  const bevel = g.createLinearGradient(-D, -D, D, D);
  bevel.addColorStop(0, 'rgba(255,255,255,0.9)');
  bevel.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  bevel.addColorStop(1, 'rgba(0,0,0,0.75)');
  g.strokeStyle = bevel;
  g.rotate(turn);
  diskPath();
  g.stroke();
  g.restore();

  // The north triangle, set into the grey border between the window and the rim: black,
  // rounded, with a lit edge.
  g.save();
  g.beginPath();
  roundedPolygon(g, [polar(D * 0.95, north), polar(D * 0.775, north - 0.17), polar(D * 0.775, north + 0.17)], D * 0.03);
  g.fillStyle = '#0c0c0e';
  g.fill();
  g.lineWidth = Math.max(0.75, R * 0.018);
  g.strokeStyle = 'rgba(255,255,255,0.35)';
  g.stroke();
  g.restore();

  // Window: a rounded square recessed into the disk, the map clipped inside.
  const w = R * 1.12;
  const rr = w * 0.22;
  g.beginPath();
  g.roundRect(-w / 2, -w / 2, w, w, rr);
  g.fillStyle = '#05070a';
  g.fill();
  g.save();
  g.clip();
  if (mapCanvas) {
    const scale = (w / 2) / cells;
    g.save();
    g.scale(scale, scale);
    for (const ox of [-512, 0, 512]) {
      for (const oz of [-512, 0, 512]) {
        if (Math.abs(x - ox - 256) > 256 + cells * 1.5 || Math.abs(z - oz - 256) > 256 + cells * 1.5) continue;
        g.drawImage(mapCanvas, ox - x, oz - z);
      }
    }
    g.restore();
  }
  // Glass: the recess casts a shadow on the map, then the glare of a light at the top right.
  g.rotate(-turn);
  const inner = g.createRadialGradient(0, 0, w * 0.3, 0, 0, w * 0.72);
  inner.addColorStop(0, 'rgba(0,0,0,0)');
  inner.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = inner;
  g.fillRect(-R, -R, size, size);
  // Rounded glass lit from the top right: a broad soft glare in that corner, a bright oval
  // reflection along the curve there, and the far corner a little darker.
  const glare = g.createRadialGradient(w * 0.3, -w * 0.3, 0, w * 0.3, -w * 0.3, w * 0.75);
  glare.addColorStop(0, 'rgba(255,255,255,0.3)');
  glare.addColorStop(0.3, 'rgba(255,255,255,0.1)');
  glare.addColorStop(0.65, 'rgba(255,255,255,0)');
  glare.addColorStop(1, 'rgba(0,0,0,0.18)');
  g.fillStyle = glare;
  g.fillRect(-R, -R, size, size);
  g.save();
  g.translate(w * 0.24, -w * 0.24);
  g.rotate(Math.PI / 4);
  const spot = g.createLinearGradient(0, -w * 0.09, 0, w * 0.09);
  spot.addColorStop(0, 'rgba(255,255,255,0.8)');
  spot.addColorStop(1, 'rgba(255,255,255,0.05)');
  g.fillStyle = spot;
  g.beginPath();
  g.ellipse(0, 0, w * 0.22, w * 0.06, 0, 0, Math.PI * 2);
  g.filter = `blur(${Math.max(0.4, w * 0.005)}px)`;
  g.fill();
  g.filter = 'none';
  g.restore();
  g.restore();
  // Recess lip: dark on the lit side, bright on the shaded side (it is sunk into the disk).
  g.save();
  g.lineWidth = Math.max(1.5, R * 0.035);
  g.rotate(-turn);
  const lip = g.createLinearGradient(-w / 2, -w / 2, w / 2, w / 2);
  lip.addColorStop(0, '#1b1d20');
  lip.addColorStop(1, '#eef1f4');
  g.strokeStyle = lip;
  g.rotate(turn);
  g.beginPath(); g.roundRect(-w / 2, -w / 2, w, w, rr); g.stroke();
  g.restore();
  g.restore();
  g.restore();
}
