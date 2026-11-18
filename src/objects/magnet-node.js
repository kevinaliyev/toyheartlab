import { SceneObject } from '../core/scene-object.js';

/**
 * Interactive 2D Magnetic Field Node for Ferrofluid & Reactive Shader Sandboxes.
 * Supports:
 * - Free user dragging & throw momentum (`mode: 'manual'`)
 * - Autonomous figure-8 / orbital patrol (`mode: 'orbit'`)
 * - Harmonic pulse oscillation (`mode: 'pulse'`)
 */
export class MagnetNode extends SceneObject {
  constructor({
    name = '',
    x = 0.5,
    y = 0.5,
    radius = 0.065,
    charge = 1.2,
    mode = 'manual', // 'manual' | 'orbit' | 'pulse'
    orbitRadius = 0.14,
    orbitSpeed = 0.55,
    phase = 0.0,
    color = null,
  } = {}) {
    const defaultColor = charge >= 0 ? [0.95, 0.36, 0.22] : [0.22, 0.62, 0.96];
    const initX = mode === 'orbit' ? Math.max(0.08, Math.min(0.92, x + Math.cos(phase) * orbitRadius)) : x;
    const initY = mode === 'orbit' ? Math.max(0.08, Math.min(0.92, y + Math.sin(phase * 1.5) * (orbitRadius * 0.75))) : y;

    super({
      name,
      x: initX,
      y: initY,
      radius,
      charge,
      color: color || defaultColor,
      draggable: true,
    });
    this.mode = mode;
    this.anchorX = x;
    this.anchorY = y;
    this.orbitRadius = orbitRadius;
    this.orbitSpeed = orbitSpeed;
    this.phase = phase;
    this.baseCharge = charge;
  }

  setCharge(val) {
    this.charge = val;
    this.baseCharge = val;
    this.color = val >= 0 ? [0.95, 0.36, 0.22] : [0.22, 0.62, 0.96];
  }

  update(dt, elapsed, stage) {
    if (this.isDragged) {
      this.anchorX = this.x;
      this.anchorY = this.y;
      return;
    }

    if (this.mode === 'orbit') {
      const t = elapsed * this.orbitSpeed + this.phase;
      const ry = this.orbitRadius * 0.75;
      const nextX = Math.max(0.08, Math.min(0.92, this.anchorX + Math.cos(t) * this.orbitRadius));
      const nextY = Math.max(0.08, Math.min(0.92, this.anchorY + Math.sin(t * 1.5) * ry));

      // Analytical derivative (avoids division-by-dt spikes on frame 0 or mode switch)
      this.vx = -Math.sin(t) * this.orbitRadius * this.orbitSpeed;
      this.vy = Math.cos(t * 1.5) * 1.5 * ry * this.orbitSpeed;
      this.x = nextX;
      this.y = nextY;
      return;
    }

    if (this.mode === 'pulse') {
      const wave = Math.sin(elapsed * 2.4 + this.phase);
      this.charge = this.baseCharge * (0.70 + 0.45 * wave);
      super.update(dt, elapsed, stage);
      return;
    }

    super.update(dt, elapsed, stage);
  }
}
