// The HUD's map globe, shared by the game HUD and the mission briefing's Objective Guide.

// The map globe: a machined metal disk holding a glass window onto the colour map. Disk and
// window turn with the craft so its heading points up. Behind the disk, two pointers poke
// out past the rim: black for north, white towards the nearest target of the objective.
export const GLOBE_CELLS = 36; // map cells from the centre of the window to its edge

/**
 * Paints the globe into a `size` x `size` box at the context's origin. `x, z` is the map
 * position at the window's centre, `heading` the craft's heading (-PI keeps north up),
 * `gx, gz` the objective the white pointer shows (gx < 0: none), `cells` the map cells
 * from the window's centre to its edge.
 */
export function paintGlobe(g, size, mapCanvas, x, z, heading, gx = -1, gz = -1, cells = GLOBE_CELLS) {
  const R = size / 2;
  const D = R * 0.84; // disk radius; pointers reach out to R
  const turn = Math.PI + heading; // rotates the craft's heading to screen-up
  const rot = (dx, dy) => [dx * Math.cos(turn) - dy * Math.sin(turn), dx * Math.sin(turn) + dy * Math.cos(turn)];
  g.save();
  g.translate(R, R);

  // Pointers, behind the disk: wide wedges whose tips show past the rim.
  const pointer = (dx, dy, fill, stroke) => {
    const [mx, my] = rot(dx, dy);
    g.save();
    g.rotate(Math.atan2(my, mx));
    g.beginPath();
    g.moveTo(R * 1.0, 0);
    g.lineTo(D * 0.6, -R * 0.26);
    g.lineTo(D * 0.6, R * 0.26);
    g.closePath();
    g.fillStyle = fill;
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = R * 0.04;
    g.shadowOffsetY = R * 0.02;
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = Math.max(1, R * 0.025);
    g.strokeStyle = stroke;
    g.stroke();
    g.restore();
  };
  pointer(0, -1, '#0c0c0e', '#55595f'); // north
  if (gx >= 0) {
    const wrapd = (d) => ((d + 768) % 512) - 256;
    const dx = wrapd(gx - x);
    const dz = wrapd(gz - z);
    if (dx || dz) pointer(dx, dz, '#f4f6f8', '#1a1c1f');
  }

  g.save();
  g.rotate(turn);
  // The disk outline: a circle with four notches cut into its rim on the quadrants.
  const notch = D * 0.15;
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
  const face = g.createLinearGradient(-D, -D, D, D);
  face.addColorStop(0, '#f2f4f7');
  face.addColorStop(0.35, '#b8bdc4');
  face.addColorStop(0.7, '#767b82');
  face.addColorStop(1, '#3e4247');
  g.fillStyle = face;
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

  // Window: a rounded square recessed into the disk, the map clipped inside.
  const w = D * 1.2;
  const rr = w * 0.18;
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
  // Glass: the recess casts a shadow on the map, then a highlight and a specular streak.
  g.rotate(-turn);
  const inner = g.createRadialGradient(0, 0, w * 0.3, 0, 0, w * 0.72);
  inner.addColorStop(0, 'rgba(0,0,0,0)');
  inner.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = inner;
  g.fillRect(-R, -R, size, size);
  const shine = g.createLinearGradient(-w / 2, -w / 2, w / 4, w / 4);
  shine.addColorStop(0, 'rgba(255,255,255,0.5)');
  shine.addColorStop(0.35, 'rgba(255,255,255,0.1)');
  shine.addColorStop(0.36, 'rgba(255,255,255,0)');
  g.fillStyle = shine;
  g.fillRect(-R, -R, size, size);
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
