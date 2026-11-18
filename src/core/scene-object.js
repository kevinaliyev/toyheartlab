let nextId = 1;

/**
 * Base 2D/3D-projected object that lives in crisp stage space while emitting
 * normalized UV footprints (x, y, z, velocity, radius, field charge) for shaders.
 *
 * Coordinate convention:
 * - x, y are in normalized dish/canvas UV space [0, 1] where (0.5, 0.5) is dish center.
 * - z >= 0 is elevation above the dish floor in dish-radius units.
 */
export class SceneObject {
  constructor({
    name = '',
    x = 0.5,
    y = 0.5,
    z = 0.0,
    vx = 0.0,
    vy = 0.0,
    vz = 0.0,
    radius = 0.055,
    charge = 1.0,
    color = [0.95, 0.38, 0.22],
    draggable = true,
    visible = true,
  } = {}) {
    this.id = `obj-${nextId++}`;
    this.name = name || `Object ${this.id.split('-')[1]}`;
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = vx;
    this.vy = vy;
    this.vz = vz;
    this.radius = radius;
    this.charge = charge; // Positive = attract / north, Negative = repel / south
    this.color = color;
    this.draggable = draggable;
    this.visible = visible;
    this.isHovered = false;
    this.isDragged = false;
  }

  /**
   * Override in subclasses for autonomous motion, orbits, or arena physics.
   */
  update(dt, elapsed, stage) {
    if (this.isDragged) return;
    if (Math.abs(this.vx) > 1e-5 || Math.abs(this.vy) > 1e-5) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const damp = Math.pow(0.22, dt);
      this.vx *= damp;
      this.vy *= damp;

      if (stage?.viewMode >= 0.5) {
        // Keep inside circular dish radius 0.38
        const dx = this.x - 0.5;
        const dy = this.y - 0.5;
        const dist = Math.hypot(dx, dy);
        const maxR = 0.38;
        if (dist > maxR) {
          const nx = dx / dist;
          const ny = dy / dist;
          this.x = 0.5 + nx * maxR;
          this.y = 0.5 + ny * maxR;
          const dot = this.vx * nx + this.vy * ny;
          if (dot > 0) {
            this.vx -= 1.6 * dot * nx;
            this.vy -= 1.6 * dot * ny;
          }
        }
      } else {
        const pad = 0.04;
        if (this.x < pad) { this.x = pad; this.vx = Math.abs(this.vx) * 0.8; }
        if (this.x > 1 - pad) { this.x = 1 - pad; this.vx = -Math.abs(this.vx) * 0.8; }
        if (this.y < pad) { this.y = pad; this.vy = Math.abs(this.vy) * 0.8; }
        if (this.y > 1 - pad) { this.y = 1 - pad; this.vy = -Math.abs(this.vy) * 0.8; }
      }
    }
  }

  /**
   * Convert to shader bridge descriptor consumed by GLEngine.setObjects().
   */
  toShaderUniform() {
    return {
      x: this.x,
      y: this.y,
      z: this.z,
      vx: this.vx,
      vy: this.vy,
      vz: this.vz,
      radius: this.radius,
      charge: this.charge,
      color: this.color,
    };
  }

  /**
   * Crisp 2D Canvas rendering (supports both flat 2D and true Isometric 3D dish projection).
   */
  render2D(ctx, view) {
    if (!this.visible) return;
    const isIso = (view.viewMode ?? 0) >= 0.5 && view.project3D;
    const [r, g, b] = this.color.map((c) => Math.round(c * 255));
    const rgb = `rgb(${r}, ${g}, ${b})`;
    const dpr = view.dpr;

    if (!isIso) {
      const px = this.x * view.width;
      const py = (1.0 - this.y) * view.height;
      const pr = this.radius * view.height;

      ctx.save();
      ctx.translate(px, py);

      ctx.beginPath();
      ctx.arc(0, 0, pr, 0, Math.PI * 2);
      ctx.strokeStyle = this.isDragged || this.isHovered ? '#ffffff' : rgb;
      ctx.lineWidth = (this.isDragged ? 2.5 : 1.5) * dpr;
      ctx.setLineDash(this.charge < 0 ? [5 * dpr, 4 * dpr] : []);
      ctx.stroke();
      ctx.setLineDash([]);

      const coreR = Math.max(6 * dpr, pr * 0.24);
      ctx.beginPath();
      ctx.arc(0, 0, coreR, 0, Math.PI * 2);
      ctx.fillStyle = rgb;
      ctx.fill();
      ctx.lineWidth = 1.5 * dpr;
      ctx.strokeStyle = '#111111';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = `bold ${Math.round(10 * dpr)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.charge >= 0 ? '+' : '−', 0, 0.5 * dpr);
      ctx.restore();
      return;
    }

    // True Isometric 3D Magnet Rendering:
    // 1. Floor projection (shadow & drop-line onto dish floor z = 0)
    const floorPos = view.project3D(this.x, this.y, 0);
    const bodyPos = view.project3D(this.x, this.y, this.z);
    const pr = Math.max(10 * dpr, this.radius * 0.42 * view.height * bodyPos.scale);

    ctx.save();

    // Soft shadow ellipse on dish floor (fades & widens slightly as z increases)
    const shadowAlpha = Math.max(0.08, 0.28 - this.z * 0.45);
    const shadowRx = pr * (0.95 + this.z * 1.4);
    const shadowRy = shadowRx * 0.58;
    ctx.beginPath();
    ctx.ellipse(floorPos.px, floorPos.py, shadowRx, shadowRy, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(10, 12, 16, ${shadowAlpha.toFixed(3)})`;
    ctx.fill();

    // Subtle dashed vertical plumb-line from floor shadow to magnet center
    if (this.z > 0.012) {
      ctx.beginPath();
      ctx.moveTo(floorPos.px, floorPos.py);
      ctx.lineTo(bodyPos.px, bodyPos.py);
      ctx.strokeStyle = this.isDragged || this.isHovered ? 'rgba(255, 255, 255, 0.55)' : 'rgba(17, 17, 17, 0.28)';
      ctx.lineWidth = 1.1 * dpr;
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Tiny floor crosshair dot
      ctx.beginPath();
      ctx.arc(floorPos.px, floorPos.py, 2 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(17, 17, 17, 0.4)';
      ctx.fill();
    }

    // 2. 3D Magnet Capsule / Sphere Body at (x, y, z)
    ctx.translate(bodyPos.px, bodyPos.py);

    // Metallic cylinder/sphere silhouette with specular highlight
    const grad = ctx.createRadialGradient(-pr * 0.3, -pr * 0.35, pr * 0.1, 0, 0, pr);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.28, rgb);
    grad.addColorStop(1, '#1a1c20');

    ctx.beginPath();
    ctx.arc(0, 0, pr * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = (this.isDragged || this.isHovered ? 2.0 : 1.3) * dpr;
    ctx.strokeStyle = this.isDragged || this.isHovered ? '#ffffff' : '#111111';
    ctx.stroke();

    // Polarity mark (+ / -)
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.max(10, Math.round(pr * 0.58))}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.charge >= 0 ? '+' : '−', 0, 0.5 * dpr);

    ctx.restore();
  }
}
