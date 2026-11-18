let nextId = 1;

/**
 * Base 2D object / entity that lives in crisp 2D stage space while emitting
 * normalized UV footprints (position, velocity, radius, field charge) for shaders.
 *
 * Coordinate convention:
 * - x, y are in normalized UV space [0, 1] where (0, 0) is bottom-left and (1, 1) is top-right
 *   (matching WebGL fragment shader `v_uv` directly).
 * - Stage2D converts to/from screen pixel coordinates when rendering & picking.
 */
export class SceneObject {
  constructor({
    name = '',
    x = 0.5,
    y = 0.5,
    vx = 0.0,
    vy = 0.0,
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
    this.vx = vx;
    this.vy = vy;
    this.radius = radius; // UV-height fraction
    this.charge = charge; // Positive = attract / north, Negative = repel / south
    this.color = color;
    this.draggable = draggable;
    this.visible = visible;
    this.isHovered = false;
    this.isDragged = false;
  }

  /**
   * Override in subclasses for autonomous motion, orbits, or arena physics.
   * @param {number} dt - Delta time in seconds
   * @param {number} elapsed - Total elapsed seconds
   * @param {object} stage - Reference to Stage2D
   */
  update(dt, elapsed, stage) {
    if (this.isDragged) return;
    if (Math.abs(this.vx) > 1e-5 || Math.abs(this.vy) > 1e-5) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      // Gentle damping for free-thrown objects unless overridden
      const damp = Math.pow(0.25, dt);
      this.vx *= damp;
      this.vy *= damp;

      // Keep inside stage bounds
      const pad = 0.04;
      if (this.x < pad) { this.x = pad; this.vx = Math.abs(this.vx) * 0.8; }
      if (this.x > 1 - pad) { this.x = 1 - pad; this.vx = -Math.abs(this.vx) * 0.8; }
      if (this.y < pad) { this.y = pad; this.vy = Math.abs(this.vy) * 0.8; }
      if (this.y > 1 - pad) { this.y = 1 - pad; this.vy = -Math.abs(this.vy) * 0.8; }
    }
  }

  /**
   * Convert to shader bridge descriptor consumed by GLEngine.setObjects().
   */
  toShaderUniform() {
    return {
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      radius: this.radius,
      charge: this.charge,
      color: this.color,
    };
  }

  /**
   * Crisp 2D Canvas rendering (supports 2D, Isometric 2.5D, and 3D Perspective floor projection).
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ width: number, height: number, dpr: number, viewMode?: number, project?: (x:number, y:number) => {px:number, py:number, scaleX:number, scaleY:number} }} view
   */
  render2D(ctx, view) {
    if (!this.visible) return;
    const proj = view.project
      ? view.project(this.x, this.y)
      : { px: this.x * view.width, py: (1.0 - this.y) * view.height, scaleX: 1, scaleY: 1 };
    const pr = this.radius * view.height * proj.scaleX;

    ctx.save();
    ctx.translate(proj.px, proj.py);

    const [r, g, b] = this.color.map((c) => Math.round(c * 255));
    const rgb = `rgb(${r}, ${g}, ${b})`;

    // Outer field ring on the dish floor (foreshortened ellipse in 3D perspective mode)
    ctx.save();
    ctx.scale(1.0, proj.scaleY / Math.max(proj.scaleX, 0.01));
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.strokeStyle = this.isDragged || this.isHovered ? '#ffffff' : rgb;
    ctx.lineWidth = (this.isDragged ? 2.5 : 1.5) * view.dpr;
    ctx.setLineDash(this.charge < 0 ? [5 * view.dpr, 4 * view.dpr] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // In Isometric (1) or 3D Perspective (2) mode, draw a subtle 3D vertical pin to the floating handle
    const isExtruded = (view.viewMode ?? 0) >= 0.5;
    const stemOffset = isExtruded ? -Math.min(26, Math.max(10, Math.abs(this.charge) * 14)) * view.dpr : 0;
    if (isExtruded) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, stemOffset);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 1.5 * view.dpr;
      ctx.stroke();
    }

    // Core handle
    const coreR = Math.max(6 * view.dpr, pr * 0.24);
    ctx.beginPath();
    ctx.arc(0, stemOffset, coreR, 0, Math.PI * 2);
    ctx.fillStyle = rgb;
    ctx.fill();
    ctx.lineWidth = 1.5 * view.dpr;
    ctx.strokeStyle = '#111111';
    ctx.stroke();

    // Polarity sign (+ / -)
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(10 * view.dpr)}px ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.charge >= 0 ? '+' : '−', 0, stemOffset + 0.5 * view.dpr);

    ctx.restore();
  }
}
